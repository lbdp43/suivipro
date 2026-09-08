// Intégration EasyBeer : réglages, webhooks, clients, audit des liens — routes déplacées telles quelles depuis routes.js.
import { Router } from 'express';
import crypto from 'crypto';
import * as eb from '../easybeer-client.js';
import db from '../db.js';
import { preuvesDeLien, verdictDeLien } from '../../shared/rapprochement.js';
import { encrypt, decrypt } from '../crypto.js';
import { adminOnly, asyncHandler, authMiddleware } from '../lib/auth.js';
import { clientLocalDepuisEasybeerId, createVisiteFromCommandeRow, createVisitesFromCommandes, ensureSiteInternetGroup, estCommandeWeb, extractEbFieldsSync, findMatchingClient, findMatchingProspect, importerClientDepuisCommande, linkClientToProspect, mapEasyBeerTypeToClientType, resolveCommercialFromEasybeer, upsertClientFromEasybeer } from '../lib/easybeer-sync.js';
import { notifyAdmins } from '../lib/journal.js';
import { calculateNextVisit } from '../lib/visites.js';

const router = Router();

// { apiBase, hdrs } for the configured EasyBeer API, or null if not configured.
async function easybeerAuthHeaders() {
  const config = (await db.query('SELECT * FROM easybeer_config WHERE id = 1')).rows[0];
  if (!config || !config.username || !config.api_url) return null;
  const authHeader = 'Basic ' + Buffer.from(`${config.username}:${decrypt(config.password)}`).toString('base64');
  const apiBase = (config.api_url || 'https://api.easybeer.fr').replace(/\/$/, '');
  return { apiBase, hdrs: { 'Authorization': authHeader } };
}

// Background job: pull all EasyBeer clients (verified endpoint) and upsert them. Clients only.
let clientSyncRunning = false;

async function runClientSync() {
  if (clientSyncRunning) return { ok: false, message: 'Synchronisation deja en cours' };
  const auth = await easybeerAuthHeaders();
  if (!auth) return { ok: false, message: 'Configuration EasyBeer incomplete' };
  clientSyncRunning = true;
  const logId = (await db.query("INSERT INTO easybeer_sync_logs (kind,status,started_at) VALUES ('clients','running',$1) RETURNING id", [new Date().toISOString()])).rows[0].id;
  let created = 0, updated = 0, skipped = 0, errors = 0;
  try {
    // Clients uniquement (jamais les prospects EasyBeer) : filtre inclureProspect=false.
    // Pagination robuste : on ne se fie PAS au seul totalPages (avec un gros nombreParPage
    // l'API en renvoie un incoherent, ce qui coupait la recuperation ~1186/3402 fiches).
    // On pagine par lots de 200 et on s'arrete sur la premiere page incomplete.
    const clients = [];
    const parPage = 200;
    let apiTotal = null;
    for (let page = 1; page <= 100; page++) {
      const res = await eb.listeClientsPage(auth.apiBase, auth.hdrs, { page, parPage, filtre: { inclureProspect: false } });
      const liste = (res && res.liste) || [];
      if (page === 1 && res && res.totalElements != null) apiTotal = res.totalElements;
      clients.push(...liste);
      if (liste.length < parPage) break; // derniere page atteinte
    }
    console.log(`[EasyBeer SyncClients] ${clients.length} fiches recuperees (totalElements annonce par l'API: ${apiTotal ?? '?'})`);
    for (const cli of clients) {
      try {
        const r = await upsertClientFromEasybeer(cli);
        if (r === 'created') created++; else if (r === 'updated') updated++; else skipped++;
      } catch (e) { errors++; console.error('[EasyBeer SyncClients] client:', e.message); }
    }
    await db.query("UPDATE easybeer_sync_logs SET status='done', created=$2, updated=$3, skipped=$4, errors=$5, finished_at=$6, message=$7 WHERE id=$1",
      [logId, created, updated, skipped, errors, new Date().toISOString(),
       `${clients.length} fiches API (annonce ${apiTotal ?? '?'}) - ${created} crees, ${updated} maj, ${skipped} inchanges, ${errors} erreurs`]);
    console.log(`[EasyBeer SyncClients] termine: ${created} crees, ${updated} maj, ${errors} erreurs`);
    return { ok: true, created, updated, skipped, errors };
  } catch (err) {
    await db.query("UPDATE easybeer_sync_logs SET status='error', message=$2, finished_at=$3 WHERE id=$1", [logId, err.message, new Date().toISOString()]);
    await notifyAdmins('sync_erreur', 'Synchronisation des clients en erreur', err.message, { kind: 'clients' }).catch(() => {});
    return { ok: false, message: err.message };
  } finally { clientSyncRunning = false; }
}

// Helper: récupérer un client Easybeer (endpoint vérifié GET /parametres/client/detail/{id}),
// avec tentatives espacées : le webhook part parfois avant que la fiche soit lisible.
async function fetchFromEasyBeerWithRetry(apiBase, headers, id, maxRetries = 3) {
  const delays = [5000, 15000, 30000];
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const found = await eb.detailClient(apiBase, headers, id);
      if (found) {
        console.log(`[EasyBeer] Client ${id} recupere (tentative ${attempt + 1})`);
        return found;
      }
    } catch (err) {
      console.log(`[EasyBeer] detailClient ${id} erreur: ${err.message}`);
    }
    if (attempt < maxRetries) {
      const delay = delays[Math.min(attempt, delays.length - 1)];
      console.log(`[EasyBeer] Client ${id} introuvable (tentative ${attempt + 1}), retry dans ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return null;
}

// Webhook endpoint (no auth, uses secret header)
// EasyBeer webhook handler (shared by both routes)
async function handleEasyBeerWebhook(req, res) {
  const webhookSecret = req.params.secret || req.headers['x-webhook-secret'];

  // Check secret from config
  const configResult = await db.query('SELECT * FROM easybeer_config WHERE id = 1');
  const config = configResult.rows[0];
  if (config?.webhook_secret && webhookSecret !== config.webhook_secret) {
    console.log('[EasyBeer Webhook] Secret invalide recu:', webhookSecret?.substring(0, 8) + '...');
    return res.status(403).json({ error: 'Invalid webhook secret' });
  }

  const body = req.body || {};
  const now = new Date().toISOString();

  // Extract type and id flexibly from various EasyBeer payload formats
  // Handle nested data wrapper
  const payloadRoot = body.data && typeof body.data === 'object' ? { ...body, ...body.data } : body;

  const type = payloadRoot.type || payloadRoot.event || payloadRoot.eventType || payloadRoot.action || '';

  // Extract order-specific ID (for commande/facture webhooks)
  const orderId = String(payloadRoot.commandeId || payloadRoot.commande_id || payloadRoot.factureId || payloadRoot.facture_id
    || payloadRoot.documentId || payloadRoot.document_id || payloadRoot.blId || payloadRoot.bl_id || '');
  // Extract general entity ID
  const entityId = String(payloadRoot.id || payloadRoot.externalId || payloadRoot.external_id || '');
  // Extract client-specific ID
  const webhookClientId = String(payloadRoot.clientId || payloadRoot.client_id || payloadRoot.tiersId || payloadRoot.tiers_id
    || payloadRoot.idClient || payloadRoot.id_client || payloadRoot.idTiers || payloadRoot.id_tiers || '');

  // For general use: prefer order-specific ID, then entity ID, then client ID
  const id = orderId || entityId || webhookClientId;

  console.log(`[EasyBeer Webhook] Recu: type=${type}, id=${id}, orderId=${orderId}, entityId=${entityId}, clientId=${webhookClientId}, body keys=${Object.keys(body).join(',')}`);

  // Log webhook
  const webhookInsert = await db.query(
    'INSERT INTO webhooks (source, type, external_id, payload, received_at) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    ['easybeer', type, id, JSON.stringify(body), now]
  );
  const webhookDbId = webhookInsert.rows[0]?.id;

  // Keep only last 100 webhooks
  await db.query(`DELETE FROM webhooks WHERE id NOT IN (SELECT id FROM webhooks ORDER BY received_at DESC LIMIT 100)`);

  // Handle EasyBeer event types
  const typeLower = type.toLowerCase().replace(/[_.-]/g, '');
  const isClientCreation = ['clientcreation', 'clientcreated', 'newclient', 'tiercreation', 'tiercreated', 'newtier'].includes(typeLower)
    || type.includes('CLIENT') || type.includes('client') || type.includes('TIER') || type.includes('tier');
  const isCommande = ['commandefacturation', 'commandecreation', 'facturecreation', 'facturecreated', 'commandecreated',
    'nouvellecommande', 'nouvellefacture', 'blcreation', 'blcreated', 'documentcreation', 'documentcreated',
    'livraison', 'livraisoncreation', 'validation', 'validationcommande'].includes(typeLower)
    || type.includes('COMMANDE') || type.includes('FACTUR') || type.includes('commande') || type.includes('factur')
    || type.includes('DOCUMENT') || type.includes('document') || type.includes('LIVRAI') || type.includes('livrai')
    || type.includes('BL') || type.includes('VALID') || type.includes('valid');

  // Fallback: if type is unknown but payload has order-like data (amounts, orderId), treat as commande
  const hasOrderData = !!(payloadRoot.montantTTC || payloadRoot.montantHT || payloadRoot.totalTTC || payloadRoot.totalHT
    || payloadRoot.commandeId || payloadRoot.factureId || payloadRoot.documentId || payloadRoot.blId
    || payloadRoot.numero || payloadRoot.lignes || payloadRoot.elements);
  const isLikelyCommande = isCommande || (!isClientCreation && hasOrderData);

  console.log(`[EasyBeer Webhook] Type detection: typeLower="${typeLower}", isCommande=${isCommande}, isClientCreation=${isClientCreation}, hasOrderData=${hasOrderData}, isLikelyCommande=${isLikelyCommande}`);

  // ============================================
  // Handle COMMANDE / FACTURATION webhooks
  // ============================================
  if (isLikelyCommande && id && config?.username && config?.api_url) {
    setTimeout(async () => {
      const updateWebhookResult = async (result) => {
        try { await db.query('UPDATE webhooks SET processing_result = $1 WHERE id = $2', [result, webhookDbId]); } catch {}
      };
      try {
        const authHeader = 'Basic ' + Buffer.from(`${config.username}:${decrypt(config.password)}`).toString('base64');
        const apiBase = (config.api_url || 'https://api.easybeer.fr').replace(/\/$/, '');
        const headers = { 'Authorization': authHeader, 'Accept': 'application/json' };

        console.log(`[EasyBeer Webhook] Traitement commande/facture id=${id}...`);

        // Try to fetch the order/invoice details from EasyBeer
        let orderData = null;
        let fetchedFrom = '';

        // Un seul endpoint fiable : GET /commande/detail/{id} (vérifié en réel).
        // Tentatives espacées : Easybeer envoie parfois le webhook avant que la
        // commande soit lisible. Fini les rafales multi-endpoints qui déclenchaient
        // le ban 10 req/s et faisaient tout échouer.
        let parsed = null;
        for (let attempt = 0; attempt <= 3 && !parsed; attempt++) {
          if (attempt > 0) {
            const delay = [5000, 15000, 30000][attempt - 1];
            console.log(`[EasyBeer Webhook] Commande id=${id} tentative ${attempt} echouee, retry dans ${delay / 1000}s...`);
            await new Promise(r => setTimeout(r, delay));
          }
          try {
            const det = await eb.detailCommande(apiBase, headers, id);
            if (det) { orderData = det; parsed = eb.parseCommandeDetail(det); fetchedFrom = '/commande/detail'; }
          } catch (err) {
            console.log(`[EasyBeer Webhook] detailCommande ${id}: ${err.message}`);
          }
        }

        if (!parsed) {
          console.log(`[EasyBeer Webhook] Impossible de recuperer la commande id=${id}, payload brut en secours`);
          orderData = payloadRoot;
        }

        console.log(`[EasyBeer Webhook] Commande recue: keys=${Object.keys(orderData).join(',')}${fetchedFrom ? ` from ${fetchedFrom}` : ' (payload brut)'}`);

        // Extraction depuis le parsing vérifié (elementsBouteilles/Autres/SaisieLibre,
        // etat.code, totalHT/totalTTC, client.idClient). En secours (payload brut) :
        // valeurs minimales, la commande partira en orpheline à compléter.
        const numero = parsed ? parsed.numero : String(payloadRoot.numero || id);
        const dateCmd = parsed ? parsed.dateCommande : now;
        const dateLiv = parsed ? parsed.dateLivraison : '';
        const statut = parsed ? parsed.statut : 'en_cours';
        const montantHt = parsed ? parsed.montantHt : (parseFloat(payloadRoot.totalHT || payloadRoot.montantHT || 0) || 0);
        const montantTtc = parsed ? parsed.montantTtc : (parseFloat(payloadRoot.totalTTC || payloadRoot.montantTTC || 0) || 0);
        const lignes = parsed ? parsed.lignes : [];

        // Le client Easybeer de la commande — par IDENTIFIANT, jamais par nom.
        const ebClientId = String((parsed && parsed.clientEb && parsed.clientEb.id) || webhookClientId || '');
        const orderClientName = (parsed && parsed.clientEb && parsed.clientEb.nom) || '';
        let orderClientEmail = '';
        let orderClientPhone = '';
        let orderClientSiret = '';

        console.log(`[EasyBeer Webhook] Commande #${numero}: ebClientId=${ebClientId}, client="${orderClientName}", ${montantTtc.toFixed(2)}€ TTC, ${lignes.length} lignes, statut=${statut}`);

        let clientId = null;

        // 0. Commande du site internet (WooCommerce/Shopify…) : pas d'affectation à
        // un commercial ni de suggestion — tout part dans le groupe « Site internet »,
        // sauf si le client Easybeer est déjà lié à un vrai client SuiviPro (un pro
        // qui commande via le site reste chez son commercial).
        const commandeWeb = estCommandeWeb(orderData);
        if (commandeWeb) {
          const lienExistant = await clientLocalDepuisEasybeerId(ebClientId);
          if (lienExistant) {
            clientId = lienExistant;
            console.log(`[EasyBeer Webhook] Commande web d'un client lie -> ${clientId}`);
          } else {
            clientId = await ensureSiteInternetGroup();
            console.log(`[EasyBeer Webhook] Commande web -> groupe Site internet`);
            // Le client Easybeer web sort de la file « en attente » (pas un prospect terrain)
            if (ebClientId) {
              await db.query(
                `INSERT INTO easybeer_clients (easybeer_id, name, status, synced_at, updated_at)
                 VALUES ($1,$2,'site_internet',$3,$3)
                 ON CONFLICT (easybeer_id) DO UPDATE SET status = CASE WHEN easybeer_clients.status = 'imported' THEN easybeer_clients.status ELSE 'site_internet' END, updated_at = $3`,
                [ebClientId, orderClientName, now]
              );
            }
          }
        }

        // 1. Lien par identifiant EasyBeer natif (clients.easybeer_id), puis staging.
        if (!clientId && ebClientId) {
          clientId = await clientLocalDepuisEasybeerId(ebClientId);
          if (clientId) console.log(`[EasyBeer Webhook] Client trouve par easybeer_id ${ebClientId}: ${clientId}`);
        }

        // 2. Rapprochement par identifiants forts UNIQUEMENT (siret/email/téléphone).
        // Un nom identique ne suffit JAMAIS à lier automatiquement : c'était la
        // source des mauvaises affectations mémorisées à vie.
        if (!clientId) {
          const match = await findMatchingClient(orderClientName, orderClientEmail, orderClientPhone, orderClientSiret);
          if (match && match.confidence === 'high') {
            clientId = match.client.id;
            console.log(`[EasyBeer Webhook] Client trouve via matching (${match.matchType}, ${match.confidence}): ${match.client.nom} (${clientId})`);
            // Also link the easybeer_clients entry if ebClientId exists
            if (ebClientId) {
              await db.query(
                `INSERT INTO easybeer_clients (easybeer_id, name, status, imported_client_id, synced_at, updated_at)
                VALUES ($1,$2,'imported',$3,$4,$4)
                ON CONFLICT (easybeer_id) DO UPDATE SET status = 'imported', imported_client_id = $3, updated_at = $4`,
                [ebClientId, orderClientName, clientId, now]
              );
              console.log(`[EasyBeer Webhook] Client ${orderClientName} lie via commande: easybeer_id=${ebClientId} -> ${clientId}`);
            }
          } else if (match) {
            console.log(`[EasyBeer Webhook] Match non auto (${match.matchType}, ${match.confidence}) pour commande: "${orderClientName}" ~ "${match.client.nom}" -> a valider`);
            await notifyAdmins('easybeer_doublon',
              `Commande: doublon possible`,
              `La commande du client "${orderClientName}" ressemble au client existant "${match.client.nom}" (match par ${match.matchType}). A valider manuellement.`,
              { easybeer_client_name: orderClientName, existing_client_id: match.client.id, existing_client_name: match.client.nom, match_type: match.matchType }
            );
          }
        }

        // 3. If we have ebClientId but no match, try fetching client from EasyBeer API
        if (!clientId && ebClientId) {
          try {
            const clientData = await fetchFromEasyBeerWithRetry(apiBase, headers, ebClientId, 2);
            if (clientData) {
              const cf = extractEbFieldsSync(clientData);
              console.log(`[EasyBeer Webhook] Client EasyBeer fetche pour commande: name="${cf.name}", email="${cf.email}", siret="${cf.siret}"`);
              const match = await findMatchingClient(cf.name || orderClientName, cf.email || orderClientEmail, cf.phone || orderClientPhone, cf.siret || orderClientSiret);
              if (match && match.confidence === 'high') {
                clientId = match.client.id;
                console.log(`[EasyBeer Webhook] Client trouve via fetch EasyBeer + matching (${match.matchType}, ${match.confidence}): ${match.client.nom} (${clientId})`);
                await db.query(
                  `INSERT INTO easybeer_clients (easybeer_id, name, status, imported_client_id, synced_at, updated_at)
                  VALUES ($1,$2,'imported',$3,$4,$4)
                  ON CONFLICT (easybeer_id) DO UPDATE SET status = 'imported', imported_client_id = $3, updated_at = $4`,
                  [ebClientId, cf.name || orderClientName, clientId, now]
                );
              } else if (match) {
                console.log(`[EasyBeer Webhook] Match non auto via fetch EasyBeer (${match.matchType}, ${match.confidence}): "${cf.name}" ~ "${match.client.nom}" -> a valider`);
                await notifyAdmins('easybeer_doublon',
                  `Commande: doublon possible`,
                  `Le client EasyBeer "${cf.name || orderClientName}" ressemble au client existant "${match.client.nom}" (match par ${match.matchType}). Commande en orpheline, a valider.`,
                  { easybeer_id: ebClientId, easybeer_client_name: cf.name || orderClientName, existing_client_id: match.client.id, existing_client_name: match.client.nom }
                );
              }
            }
          } catch (err) {
            console.log(`[EasyBeer Webhook] Fetch client ${ebClientId} echoue: ${err.message}`);
          }
        }

        // 4. Toujours rien : la fiche EasyBeer commande mais n'existe pas chez nous
        // (fiche restee cote « prospect » dans EasyBeer). On l'importe comme client
        // plutot que de laisser la commande en orpheline.
        if (!clientId && ebClientId) {
          clientId = await importerClientDepuisCommande(apiBase, headers, ebClientId);
          if (clientId) console.log(`[EasyBeer Webhook] Client ${ebClientId} importe depuis sa commande -> ${clientId}`);
        }

        // Store client name from order for orphan display
        const cmdClientName = orderClientName || '';

        if (!clientId) {
          // Anti-doublon orphelins: check by easybeer_id OR numero
          const existingOrphan = await db.query(
            'SELECT id FROM commandes WHERE client_id IS NULL AND (easybeer_id = $1 OR numero = $2)',
            [String(id), numero]
          );
          if (existingOrphan.rows.length > 0) {
            console.log(`[EasyBeer Webhook] Commande orpheline ${numero} deja existante, mise a jour`);
            await db.query(
              `UPDATE commandes SET statut = $1, montant_ht = $2, montant_ttc = $3, lignes = $4, client_name = $5, raw_data = $6 WHERE id = $7`,
              [statut, montantHt, montantTtc, JSON.stringify(lignes), cmdClientName, JSON.stringify(orderData), existingOrphan.rows[0].id]
            );
            await updateWebhookResult(`MAJ ORPHELINE: #${numero}, ${montantTtc.toFixed(2)}€ TTC`);
            return;
          }

          // Store as orphan commande (client_id = null) for admin to assign
          const cmdId = `cmd-${crypto.randomUUID()}`;
          await db.query(
            `INSERT INTO commandes (id, client_id, easybeer_id, numero, date_commande, date_livraison, statut, montant_ht, montant_ttc, lignes, notes, source, client_name, raw_data, date_creation)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [cmdId, null, String(id), numero, dateCmd, dateLiv, statut, montantHt, montantTtc,
             JSON.stringify(lignes), '', 'easybeer', cmdClientName, JSON.stringify(orderData), now]
          );

          const lignesStr = lignes.length > 0 ? lignes.map(l => `${l.produit} x${l.quantite}`).join(', ') : 'aucun detail';
          console.log(`[EasyBeer Webhook] Commande ORPHELINE: #${numero}, client="${cmdClientName}" (ebClientId=${ebClientId}), ${montantTtc.toFixed(2)}€ TTC, ${lignes.length} produits (${lignesStr})`);
          await updateWebhookResult(`ORPHELINE: #${numero}, client="${cmdClientName}", ${montantTtc.toFixed(2)}€ TTC, ${lignes.length} produits, fetched=${fetchedFrom || 'payload brut'}`);

          // Notify admins
          try {
            const admins = await db.query("SELECT id FROM commerciaux WHERE role = 'admin'");
            for (const admin of admins.rows) {
              const notifId = `notif-${crypto.randomUUID()}`;
              await db.query(
                `INSERT INTO notifications (id, user_id, type, title, message, data, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [notifId, admin.id, 'commande_orpheline',
                 `Commande #${numero} sans client`,
                 `${cmdClientName || 'Client inconnu'} - ${montantTtc.toFixed(2)}€ TTC - A assigner manuellement`,
                 JSON.stringify({ commande_id: cmdId }), now]
              );
            }
          } catch (err) { console.error('[EasyBeer Webhook] Notif orpheline error:', err.message); }
          return;
        }

        // Anti-doublon: check by easybeer_id OR by numero for this client
        const existing = await db.query(
          'SELECT id, easybeer_id FROM commandes WHERE client_id = $1 AND (easybeer_id = $2 OR numero = $3)',
          [clientId, String(id), numero]
        );
        if (existing.rows.length > 0) {
          console.log(`[EasyBeer Webhook] Commande ${numero} deja importee, mise a jour...`);
          await db.query(
            `UPDATE commandes SET statut = $1, montant_ht = $2, montant_ttc = $3, lignes = $4, date_livraison = $5, easybeer_id = $6 WHERE id = $7`,
            [statut, montantHt, montantTtc, JSON.stringify(lignes), dateLiv, String(id), existing.rows[0].id]
          );
          await updateWebhookResult(`MAJ: #${numero} -> client ${clientId}, ${montantTtc.toFixed(2)}€ TTC`);
          return;
        }

        // Create the commande
        const cmdId = `cmd-${crypto.randomUUID()}`;
        await db.query(
          `INSERT INTO commandes (id, client_id, easybeer_id, numero, date_commande, date_livraison, statut, montant_ht, montant_ttc, lignes, notes, source, client_name, raw_data, date_creation)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [cmdId, clientId, String(id), numero, dateCmd, dateLiv, statut, montantHt, montantTtc,
           JSON.stringify(lignes), '', 'easybeer', cmdClientName, JSON.stringify(orderData), now]
        );

        // Une commande = une visite (avec le commentaire de la commande), au fil de l'eau.
        // Jusqu'ici seule la synchro en masse la creait : les commandes arrivees par
        // webhook restaient sans visite jusqu'au prochain balayage.
        const visiteCreee = await createVisiteFromCommandeRow({
          id: cmdId,
          client_id: clientId,
          numero,
          montant_ttc: montantTtc,
          date_commande: dateCmd,
          commentaire: '',
          commercial_easybeer_id: '',
          raw_data: JSON.stringify(orderData),
          visite_created: false,
        });

        const lignesStr = lignes.length > 0
          ? lignes.map(l => `${l.produit} x${l.quantite}`).join(', ')
          : 'aucun detail produit';
        console.log(`[EasyBeer Webhook] Commande importee: #${numero} -> client ${clientId}, ${montantHt.toFixed(2)}€ HT / ${montantTtc.toFixed(2)}€ TTC, ${lignes.length} lignes (${lignesStr})${visiteCreee ? ' + visite creee' : ''}`);
        await updateWebhookResult(`OK: #${numero} -> client ${clientId}, ${montantTtc.toFixed(2)}€ TTC, ${lignes.length} produits${visiteCreee ? ', visite creee' : ''}, fetched=${fetchedFrom || 'payload brut'}`);

        // Pas de notification « nouvelle commande » : ce n'est pas un problème à régler
        // (décision : les notifications ne servent qu'aux anomalies).


      } catch (err) {
        console.error(`[EasyBeer Webhook] Erreur traitement commande id=${id}:`, err.message);
        await updateWebhookResult(`ERREUR: ${err.message}`);
      }
    }, 3000);

    return res.json({ ok: true, received: { type, id }, action: 'commande_processing' });
  }

  // ============================================
  // Handle CLIENT creation webhooks
  // ============================================

  // Always create a pending entry when we receive a webhook with an id, even if we can't fetch details
  if (id) {
    // Extract any name/info directly from the webhook payload
    // Handle nested data object: EasyBeer may wrap the actual data
    const payloadData = body.data && typeof body.data === 'object' ? { ...body, ...body.data } : body;

    const directName = payloadData.nom || payloadData.name || payloadData.libelle || payloadData.raisonSociale || payloadData.raison_sociale || '';
    const directEmail = payloadData.emailPrincipal || payloadData.email || payloadData.mail || '';
    const directPhone = payloadData.phone || payloadData.telephone || payloadData.telephonePrincipal || payloadData.mobile || payloadData.portable || '';
    const directCity = payloadData.ville || payloadData.city || '';
    const directAddress = payloadData.adresse || payloadData.address || payloadData.rue || '';
    const directPostalCode = payloadData.codePostal || payloadData.code_postal || payloadData.cp || payloadData.postal_code || '';
    const directContact = payloadData.contact || payloadData.contactName || payloadData.contact_name || '';

    // Handle type as string or nested object { libelle: "Cave", code: "CAV" }
    let directType = payloadData.type || payloadData.typeClient || payloadData.type_client || payloadData.categorie || '';
    if (typeof directType === 'object' && directType !== null) {
      directType = directType.libelle || directType.nom || directType.code || directType.label || '';
    }

    // Handle commercial as nested object { email: "...", nom: "..." } or direct fields
    let directCommercialEmail = '';
    if (payloadData.commercial && typeof payloadData.commercial === 'object') {
      directCommercialEmail = payloadData.commercial.email || payloadData.commercial.emailPrincipal || payloadData.commercial.mail || '';
    }
    if (!directCommercialEmail) {
      directCommercialEmail = payloadData.commercialEmail || payloadData.commercial_email || payloadData.emailCommercial || payloadData.email_commercial || '';
    }
    // Also check representant / vendeur fields
    if (!directCommercialEmail) {
      const rep = payloadData.representant || payloadData.vendeur || payloadData.agent;
      if (rep && typeof rep === 'object') {
        directCommercialEmail = rep.email || rep.emailPrincipal || rep.mail || '';
      } else if (typeof rep === 'string' && rep.includes('@')) {
        directCommercialEmail = rep;
      }
    }

    // Extract commercial name for fuzzy matching
    let directCommercialName = '';
    if (payloadData.commercial && typeof payloadData.commercial === 'object') {
      directCommercialName = `${payloadData.commercial.prenom || ''} ${payloadData.commercial.nom || ''}`.trim()
        || payloadData.commercial.libelle || payloadData.commercial.denomination || '';
    }
    if (!directCommercialName) {
      const rep = payloadData.representant || payloadData.vendeur || payloadData.agent;
      if (rep && typeof rep === 'object') {
        directCommercialName = `${rep.prenom || ''} ${rep.nom || ''}`.trim() || rep.libelle || '';
      } else if (typeof rep === 'string' && !rep.includes('@')) {
        directCommercialName = rep;
      }
    }
    if (!directCommercialName && typeof payloadData.commercial === 'string') {
      directCommercialName = payloadData.commercial;
    }

    // Handle SIRET from payload
    const directSiret = payloadData.siret || payloadData.siren || '';

    // Handle contacts array from payload
    let contactFromPayload = directContact;
    let emailFromContacts = '';
    let phoneFromContacts = '';
    if (!contactFromPayload && payloadData.contacts && Array.isArray(payloadData.contacts) && payloadData.contacts.length > 0) {
      const c = payloadData.contacts.find(c => c.type === 'Principal' || c.principal) || payloadData.contacts[0];
      contactFromPayload = c.denomination || c.libelle || `${c.prenom || ''} ${c.nom || ''}`.trim();
      emailFromContacts = c.email || c.emailPrincipal || c.mail || '';
      phoneFromContacts = c.mobile || c.telephone || c.portable || '';
    }

    const finalEmail = directEmail || emailFromContacts;
    const finalPhone = directPhone || phoneFromContacts;

    // Insert/update pending client with whatever info we have from the payload
    await db.query(
      `INSERT INTO easybeer_clients (easybeer_id, name, type, contact_name, phone, email, city, address, postal_code, notes, commercial_email, commercial_name, siret, raw_data, status, synced_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (easybeer_id) DO UPDATE SET
        name = CASE WHEN $2 != '' THEN $2 ELSE easybeer_clients.name END,
        type = CASE WHEN $3 != '' THEN $3 ELSE easybeer_clients.type END,
        contact_name = CASE WHEN $4 != '' THEN $4 ELSE easybeer_clients.contact_name END,
        phone = CASE WHEN $5 != '' THEN $5 ELSE easybeer_clients.phone END,
        email = CASE WHEN $6 != '' THEN $6 ELSE easybeer_clients.email END,
        city = CASE WHEN $7 != '' THEN $7 ELSE easybeer_clients.city END,
        address = CASE WHEN $8 != '' THEN $8 ELSE easybeer_clients.address END,
        postal_code = CASE WHEN $9 != '' THEN $9 ELSE easybeer_clients.postal_code END,
        commercial_email = CASE WHEN $11 != '' THEN $11 ELSE easybeer_clients.commercial_email END,
        commercial_name = CASE WHEN $12 != '' THEN $12 ELSE easybeer_clients.commercial_name END,
        siret = CASE WHEN $13 != '' THEN $13 ELSE easybeer_clients.siret END,
        raw_data = $14, updated_at = $17`,
      [id, directName, String(directType), contactFromPayload, finalPhone, finalEmail,
       directCity, directAddress, directPostalCode, payloadData.notes || payloadData.commentaire || payloadData.observation || '',
       directCommercialEmail, directCommercialName, directSiret, JSON.stringify(body), 'pending', now, now]
    );
    console.log(`[EasyBeer Webhook] Client en attente cree/maj: easybeer_id=${id}, name="${directName || '(depuis webhook)'}", type="${directType}", commercial="${directCommercialEmail}" (${directCommercialName}), siret="${directSiret}", email="${finalEmail}", phone="${finalPhone}"`);
  }

  // Use shared extractEbFieldsSync function (defined above)
  const extractEbFields = extractEbFieldsSync;

  // Try to enrich with EasyBeer API data in background (with retries and backoff)
  if (id && config?.username && config?.api_url) {
    setTimeout(async () => {
      const updateClientWebhookResult = async (result) => {
        try { await db.query('UPDATE webhooks SET processing_result = $1 WHERE id = $2', [result, webhookDbId]); } catch {}
      };
      try {
        const authHeader = 'Basic ' + Buffer.from(`${config.username}:${decrypt(config.password)}`).toString('base64');
        const apiBase = (config.api_url || 'https://api.easybeer.fr').replace(/\/$/, '');
        const headers = { 'Authorization': authHeader, 'Accept': 'application/json' };

        const found = await fetchFromEasyBeerWithRetry(apiBase, headers, id, 4);

        if (found) {
          const f = extractEbFields(found);
          const clientNow = new Date().toISOString();
          await db.query(
            `UPDATE easybeer_clients SET
              name = COALESCE(NULLIF($2, ''), name),
              type = COALESCE(NULLIF($3, ''), type),
              contact_name = COALESCE(NULLIF($4, ''), contact_name),
              phone = COALESCE(NULLIF($5, ''), phone),
              phone_mobile = COALESCE(NULLIF($6, ''), phone_mobile),
              email = COALESCE(NULLIF($7, ''), email),
              city = COALESCE(NULLIF($8, ''), city),
              address = COALESCE(NULLIF($9, ''), address),
              postal_code = COALESCE(NULLIF($10, ''), postal_code),
              notes = COALESCE(NULLIF($11, ''), notes),
              commercial_email = COALESCE(NULLIF($12, ''), commercial_email),
              siret = COALESCE(NULLIF($13, ''), siret),
              tournee = COALESCE(NULLIF($14, ''), tournee),
              latitude = CASE WHEN $15::double precision != 0 THEN $15 ELSE latitude END,
              longitude = CASE WHEN $16::double precision != 0 THEN $16 ELSE longitude END,
              raw_data = $17, updated_at = $18
            WHERE easybeer_id = $1`,
            [id, f.name, f.type, f.contact_name, f.phone, f.phone_mobile, f.email,
             f.city, f.address, f.postal_code, f.notes, f.commercial_email,
             f.siret, f.tournee, f.latitude, f.longitude, JSON.stringify(found), clientNow]
          );
          console.log(`[EasyBeer Webhook] Enrichi: ${f.name}, GPS=${f.latitude},${f.longitude}, tournee=${f.tournee}, mobile=${f.phone_mobile}`);

          // Rapprochement avec un client existant : liaison automatique UNIQUEMENT
          // sur identifiant fort (siret/email/téléphone). Nom identique -> suggestion
          // à valider par l'admin, jamais de lien automatique.
          const match = await findMatchingClient(f.name, f.email, f.phone, f.siret);

          if (match && match.confidence === 'high') {
            const existingClient = match.client;
            // Link EasyBeer entry to existing client - no duplicate creation
            await db.query("UPDATE easybeer_clients SET status = 'imported', imported_client_id = $1 WHERE easybeer_id = $2", [existingClient.id, id]);

            // Enrich existing client with EasyBeer data (fill in missing fields)
            await db.query(
              `UPDATE clients SET
                telephone_mobile = CASE WHEN (telephone_mobile IS NULL OR telephone_mobile = '') AND $2 != '' THEN $2 ELSE telephone_mobile END,
                siret = CASE WHEN (siret IS NULL OR siret = '') AND $3 != '' THEN $3 ELSE siret END,
                tournee = CASE WHEN (tournee IS NULL OR tournee = '') AND $4 != '' THEN $4 ELSE tournee END,
                latitude = CASE WHEN (latitude IS NULL OR latitude = 0) AND $5::double precision != 0 THEN $5 ELSE latitude END,
                longitude = CASE WHEN (longitude IS NULL OR longitude = 0) AND $6::double precision != 0 THEN $6 ELSE longitude END,
                contact = CASE WHEN (contact IS NULL OR contact = '') AND $7 != '' THEN $7 ELSE contact END,
                date_modification = $8
              WHERE id = $1`,
              [existingClient.id, f.phone_mobile, f.siret, f.tournee, f.latitude, f.longitude, f.contact_name, clientNow]
            );

            // Also link prospect if one matches
            const prospect = await findMatchingProspect(f.name, f.email, f.phone);
            if (prospect && !existingClient.prospect_id) {
              await linkClientToProspect(existingClient.id, prospect, clientNow);
            }

            console.log(`[EasyBeer Webhook] Client existant lie (${match.matchType}): ${f.name} (${existingClient.id}) <- easybeer_id=${id}`);
            await updateClientWebhookResult(`OK CLIENT LIE: ${f.name} -> client existant ${existingClient.id} (via ${match.matchType})`);

          } else if (match) {
            // Correspondance par nom (exacte ou floue) : suggestion seulement
            console.log(`[EasyBeer Webhook] Match non auto (${match.matchType}, ${match.confidence}): "${f.name}" ~ "${match.client.nom}" -> a valider par admin`);
            await updateClientWebhookResult(`DOUBLON POSSIBLE: "${f.name}" ~ "${match.client.nom}" (${match.matchType}) -> a valider`);

            await notifyAdmins('easybeer_doublon',
              `Doublon possible: ${f.name}`,
              `Le client EasyBeer "${f.name}" ressemble au client existant "${match.client.nom}" (match par ${match.matchType}). A valider manuellement.`,
              { easybeer_id: id, easybeer_client_name: f.name, existing_client_id: match.client.id, existing_client_name: match.client.nom, match_type: match.matchType }
            );
          } else {
            // No existing client found - try to find commercial assignment
            let commercialId = null;

            // 0. Native EasyBeer commercial id (most reliable — emails differ between systems)
            if (f.commercial_easybeer_id) {
              const mapped = await resolveCommercialFromEasybeer(f.commercial_easybeer_id);
              if (mapped) {
                commercialId = mapped;
                console.log(`[EasyBeer Webhook] Commercial via idCommercial natif: ${f.commercial_easybeer_id} -> ${commercialId}`);
              }
            }

            // 1. Match by commercial email via assignment_rules
            if (!commercialId && f.commercial_email) {
              const ruleResult = await db.query('SELECT * FROM assignment_rules WHERE LOWER(email) = LOWER($1)', [f.commercial_email]);
              if (ruleResult.rows.length > 0) {
                commercialId = ruleResult.rows[0].commercial_id;
                console.log(`[EasyBeer Webhook] Commercial trouve via assignment_rule email: ${f.commercial_email} -> ${commercialId}`);
              }
            }

            // 2. Match by commercial name against commerciaux table (fuzzy)
            if (!commercialId && f.commercial_name) {
              const nameParts = f.commercial_name.toLowerCase().trim().split(/\s+/);
              if (nameParts.length >= 2) {
                // Try matching prenom + nom or nom + prenom
                const comResult = await db.query(
                  `SELECT id FROM commerciaux WHERE
                    (LOWER(prenom) = $1 AND LOWER(nom) = $2) OR (LOWER(prenom) = $2 AND LOWER(nom) = $1)
                    OR LOWER(prenom || ' ' || nom) = $3 OR LOWER(nom || ' ' || prenom) = $3
                  LIMIT 1`,
                  [nameParts[0], nameParts.slice(1).join(' '), f.commercial_name.toLowerCase().trim()]
                );
                if (comResult.rows.length > 0) {
                  commercialId = comResult.rows[0].id;
                  console.log(`[EasyBeer Webhook] Commercial trouve par nom: "${f.commercial_name}" -> ${commercialId}`);
                }
              }
              // ⚠️ pas d'affectation sur un nom partiel (un seul mot) : trop de
              // faux positifs -> le client part en attente, l'admin choisit.
            }

            // 3. Match by commercial email directly against commerciaux table
            if (!commercialId && f.commercial_email) {
              const comResult = await db.query('SELECT id FROM commerciaux WHERE LOWER(email) = LOWER($1) LIMIT 1', [f.commercial_email]);
              if (comResult.rows.length > 0) {
                commercialId = comResult.rows[0].id;
                console.log(`[EasyBeer Webhook] Commercial trouve par email direct: ${f.commercial_email} -> ${commercialId}`);
              }
            }

            const prospect = await findMatchingProspect(f.name, f.email, f.phone);

            // 4. Fallback to prospect's commercial
            if (!commercialId && prospect?.commercial_id) {
              commercialId = prospect.commercial_id;
              console.log(`[EasyBeer Webhook] Commercial via prospect: ${prospect.nom_etablissement} -> ${commercialId}`);
            }

            if (commercialId) {
              const clientType = mapEasyBeerTypeToClientType(f.type);
              const nextVisit = await calculateNextVisit(clientType, null, null);
              const clientId = `cli-${crypto.randomUUID()}`;

              console.log(`[EasyBeer Webhook] Auto-import: type EasyBeer="${f.type}" -> type SuiviPro="${clientType}"`);

              await db.query(
                `INSERT INTO clients (id, nom, ville, adresse, code_postal, telephone, telephone_mobile, email, contact,
                 type_client, statut, commercial_id, next_visit, notes, siret, tournee, latitude, longitude, prospect_id, date_creation, date_modification)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
                [clientId, f.name, f.city, f.address, f.postal_code,
                 f.phone, f.phone_mobile, f.email, f.contact_name, clientType, 'ACTIF',
                 commercialId, nextVisit || null,
                 [prospect?.notes, f.notes].filter(Boolean).join('\n') || '',
                 f.siret, prospect?.tournee || f.tournee,
                 f.latitude || prospect?.latitude || 0, f.longitude || prospect?.longitude || 0,
                 prospect?.id || null, clientNow, clientNow]
              );
              await db.query("UPDATE easybeer_clients SET status = 'imported', imported_client_id = $1 WHERE easybeer_id = $2", [clientId, id]);
              // Store native EasyBeer join keys on the new client
              await db.query(
                `UPDATE clients SET easybeer_id=$2, easybeer_numero=$3, easybeer_commercial_id=$4, easybeer_type_id=$5, easybeer_tournee_id=$6 WHERE id=$1`,
                [clientId, String(id), f.numero, f.commercial_easybeer_id, f.type_id, f.tournee_id]
              );

              if (prospect) {
                await linkClientToProspect(clientId, prospect, clientNow);
              }

              console.log(`[EasyBeer Webhook] Nouveau client cree: ${f.name} -> commercial ${commercialId}`);
              await updateClientWebhookResult(`OK CLIENT CREE: ${f.name} -> commercial ${commercialId}`);

            } else {
              console.log(`[EasyBeer Webhook] Client ${f.name} en attente: aucun commercial trouve (email="${f.commercial_email}", nom="${f.commercial_name}")`);
              await updateClientWebhookResult(`EN ATTENTE: ${f.name}, pas de commercial (email="${f.commercial_email}", nom="${f.commercial_name}")`);

              // Notify admin about pending client requiring action
              await notifyAdmins('easybeer_client_pending',
                `Client EasyBeer en attente`,
                `"${f.name}" (${f.city || 'ville inconnue'}) - Aucun commercial trouve. A assigner manuellement.`,
                { easybeer_id: id, client_name: f.name, commercial_email: f.commercial_email, commercial_name: f.commercial_name }
              );
            }
          }
        } else {
          console.log(`[EasyBeer Webhook] Impossible de recuperer les details pour id=${id} apres 5 tentatives`);
          await updateClientWebhookResult(`ECHEC API: impossible de recuperer les details pour id=${id}`);
        }
      } catch (err) {
        console.error(`[EasyBeer Webhook] Enrichissement echoue:`, err.message);
        await updateClientWebhookResult(`ERREUR: ${err.message}`);
      }
    }, 5000); // Initial delay 5s (EasyBeer needs time to propagate)
  }

  res.json({ ok: true, received: { type, id } });
}

// Register webhook routes (two separate routes for Express 5 compatibility)
router.post('/webhook/easybeer', handleEasyBeerWebhook);

router.post('/webhook/easybeer/:secret', handleEasyBeerWebhook);

// EasyBeer config
router.get('/easybeer/config', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM easybeer_config WHERE id = 1');
  if (result.rows.length === 0) {
    return res.json({ id: 1, username: '', password: '', api_url: 'https://api.easybeer.fr', webhook_secret: '' });
  }
  const config = result.rows[0];
  res.json({ ...config, password: config.password ? '***' : '' });
}));

router.post('/easybeer/config', authMiddleware, asyncHandler(async (req, res) => {
  const { username, password, api_url, webhook_secret } = req.body;
  const now = new Date().toISOString();
  // If password is '***', keep the existing password
  let finalPassword = password || '';
  if (password === '***') {
    const existing = await db.query('SELECT password FROM easybeer_config WHERE id = 1');
    finalPassword = existing.rows.length > 0 ? existing.rows[0].password : '';
  } else if (finalPassword) {
    finalPassword = encrypt(finalPassword);
  }
  await db.query(
    `INSERT INTO easybeer_config (id, username, password, api_url, webhook_secret, updated_at)
    VALUES (1, $1, $2, $3, $4, $5)
    ON CONFLICT (id) DO UPDATE SET username=$1, password=$2, api_url=$3, webhook_secret=$4, updated_at=$5`,
    [username || '', finalPassword, api_url || 'https://api.easybeer.fr', webhook_secret || '', now]
  );
  res.json({ ok: true });
}));

// Full client pull sync (clients only, not prospects). Runs in background.
router.post('/easybeer/sync-clients', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  if (clientSyncRunning) return res.json({ ok: false, message: 'Synchronisation clients deja en cours' });
  runClientSync().catch((e) => console.error('[EasyBeer SyncClients] fatal:', e.message));
  res.json({ ok: true, message: 'Synchronisation des clients lancee (suivi via les logs de sync)' });
}));

// Recent pull-sync runs (clients).
router.get('/easybeer/sync-logs', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const r = await db.query('SELECT * FROM easybeer_sync_logs ORDER BY id DESC LIMIT 20');
  res.json(r.rows);
}));

// Generate "visites" from imported commandes (idempotent). sinceDays limits how far back.
router.post('/easybeer/generer-visites', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const sinceDays = Number(req.body?.sinceDays) || 365;
  const result = await createVisitesFromCommandes({ sinceDays });
  res.json(result);
}));

router.post('/easybeer/test-connection', authMiddleware, asyncHandler(async (req, res) => {
  let { username, password, api_url } = req.body;
  // If password is masked, retrieve the real one from DB
  if (password === '***') {
    const existing = await db.query('SELECT password FROM easybeer_config WHERE id = 1');
    password = existing.rows.length > 0 ? decrypt(existing.rows[0].password) : '';
  }
  const baseUrl = (api_url || 'https://api.easybeer.fr').replace(/\/$/, '');
  const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const headers = { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' };

  // Try EasyBeer endpoint: POST /parametres/client/liste
  // Swagger format: pagination as query params, ModeleClientFiltre as body
  const testFormats = [
    { url: `${baseUrl}/parametres/client/liste?colonneTri=libelle&nombreParPage=10&numeroPage=0`, body: {} },
    { url: `${baseUrl}/parametres/client/liste`, body: { colonneTri: 'libelle', mode: 'ASC', nombreParPage: 10, numeroPage: 0 } },
  ];

  for (const fmt of testFormats) {
    try {
      const resp = await fetch(fmt.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(fmt.body),
        signal: AbortSignal.timeout(8000)
      });
      if (resp.status === 200 || resp.status === 206) {
        const data = await resp.json().catch(() => null);
        const count = data?.liste?.length || (Array.isArray(data) ? data.length : 0);
        return res.json({ ok: true, message: `Connexion reussie (${count} clients)` });
      }
      if (resp.status === 401 || resp.status === 403) {
        return res.json({ ok: false, message: `Serveur accessible mais identifiants refuses (${resp.status})` });
      }
    } catch {
      // network error → try next format
    }
  }

  // Last resort: just ping the base URL
  try {
    const pingResp = await fetch(baseUrl, { headers, signal: AbortSignal.timeout(8000) });
    if (pingResp.status < 500) {
      return res.json({ ok: true, message: `Serveur accessible (verifiez les identifiants)` });
    }
    return res.json({ ok: false, message: `Serveur repond avec erreur ${pingResp.status}` });
  } catch (err) {
    return res.json({ ok: false, message: `Impossible de joindre ${baseUrl}: ${err.message}` });
  }
}));

// Explore EasyBeer API - try new endpoint approaches to find commandes (max 5 calls, 500ms delay)
router.post('/easybeer/explore-api', authMiddleware, asyncHandler(async (req, res) => {
  const configResult = await db.query('SELECT * FROM easybeer_config WHERE id = 1');
  const config = configResult.rows[0];
  if (!config?.username || !config?.api_url) {
    return res.json({ ok: false, message: 'Configuration EasyBeer incomplete' });
  }
  const authHeader = 'Basic ' + Buffer.from(`${config.username}:${decrypt(config.password)}`).toString('base64');
  const apiBase = (config.api_url || 'https://api.easybeer.fr').replace(/\/$/, '');
  const headers = { 'Authorization': authHeader, 'Accept': 'application/json', 'Content-Type': 'application/json' };

  // Get first linked client for detail test
  const linkedClient = await db.query(
    "SELECT easybeer_id FROM easybeer_clients WHERE status = 'imported' AND easybeer_id IS NOT NULL LIMIT 1"
  );
  const ebClientId = linkedClient.rows[0]?.easybeer_id;

  const results = [];
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  async function tryEndpoint(label, method, path, body, queryParams) {
    try {
      const opts = { method, headers, signal: AbortSignal.timeout(10000) };
      if (body) opts.body = JSON.stringify(body);
      let url = `${apiBase}${path}`;
      if (queryParams) {
        const qs = new URLSearchParams(queryParams).toString();
        url += `?${qs}`;
      }
      const resp = await fetch(url, opts);
      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); } catch { data = null; }
      results.push({
        label, method, path, body: body || null,
        status: resp.status,
        succes: data?.succes,
        message: data?.message,
        keys: data ? Object.keys(data) : [],
        sample: text.substring(0, 800),
        hasData: data ? !!(data.liste || data.contenu || data.results || data.data || data.commandes || data.documents) : false,
      });
      // Stop if rate limited
      if (resp.status === 429 || (resp.status === 400 && text.includes('banned'))) {
        results.push({ label: 'RATE_LIMIT', message: 'Banni - arret immediat' });
        return 'stop';
      }
      return resp.status;
    } catch (err) {
      results.push({ label, method, path, error: err.message });
      return 'error';
    }
  }

  // Round 2: Based on previous discovery, /parametres/client/detail/{id} works (HTTP 200)
  // Now test sub-resources of client and other /parametres/ patterns
  const round = req.body?.round || 2;
  let status;

  if (round === 2 && ebClientId) {
    // Test 1: Client sub-resource - documents
    status = await tryEndpoint('client documents', 'GET', `/parametres/client/${ebClientId}/documents`, null);
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    // Test 2: Client sub-resource - commandes
    status = await tryEndpoint('client commandes', 'GET', `/parametres/client/${ebClientId}/commandes`, null);
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    // Test 3: Client sub-resource - factures
    status = await tryEndpoint('client factures', 'GET', `/parametres/client/${ebClientId}/factures`, null);
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    // Test 4: /devis/liste and /avoir/liste (POST)
    status = await tryEndpoint('devis/liste', 'POST', '/devis/liste',
      { colonneTri: 'libelle', mode: 'ASC', nombreParPage: 10 });
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    // Test 5: /bon-livraison/liste or /bl/liste
    status = await tryEndpoint('bon-livraison/liste', 'POST', '/bon-livraison/liste',
      { colonneTri: 'libelle', mode: 'ASC', nombreParPage: 10 });

  } else if (round === 3 && ebClientId) {
    // Test more /parametres/ prefixed paths and POST variants
    status = await tryEndpoint('parametres/devis/liste', 'POST', '/parametres/devis/liste',
      { colonneTri: 'libelle', mode: 'ASC', nombreParPage: 10 });
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    status = await tryEndpoint('parametres/avoir/liste', 'POST', '/parametres/avoir/liste',
      { colonneTri: 'libelle', mode: 'ASC', nombreParPage: 10 });
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    status = await tryEndpoint('parametres/bon-livraison/liste', 'POST', '/parametres/bon-livraison/liste',
      { colonneTri: 'libelle', mode: 'ASC', nombreParPage: 10 });
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    // POST client documents/commandes (maybe POST is required like /liste endpoints)
    status = await tryEndpoint('client commandes POST', 'POST', `/parametres/client/${ebClientId}/commandes`,
      { colonneTri: 'dateCreation', mode: 'DESC', nombreParPage: 10 });
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    status = await tryEndpoint('client documents POST', 'POST', `/parametres/client/${ebClientId}/documents`,
      { colonneTri: 'dateCreation', mode: 'DESC', nombreParPage: 10 });

  } else if (round === 4) {
    // Round 4: Follow EXACT same pattern as /parametres/client/liste (which works)
    // Try other entity names with /parametres/{entity}/liste
    status = await tryEndpoint('parametres/commande/liste', 'POST', '/parametres/commande/liste',
      { colonneTri: 'libelle', mode: 'ASC', nombreParPage: 10 });
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    status = await tryEndpoint('parametres/document/liste', 'POST', '/parametres/document/liste',
      { colonneTri: 'libelle', mode: 'ASC', nombreParPage: 10 });
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    status = await tryEndpoint('parametres/facture/liste', 'POST', '/parametres/facture/liste',
      { colonneTri: 'libelle', mode: 'ASC', nombreParPage: 10 });
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    status = await tryEndpoint('parametres/article/liste', 'POST', '/parametres/article/liste',
      { colonneTri: 'libelle', mode: 'ASC', nombreParPage: 10 });
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    status = await tryEndpoint('parametres/produit/liste', 'POST', '/parametres/produit/liste',
      { colonneTri: 'libelle', mode: 'ASC', nombreParPage: 10 });

  } else if (round === 5) {
    // Round 5: More entity names + singular/plural variants
    status = await tryEndpoint('parametres/bl/liste', 'POST', '/parametres/bl/liste',
      { colonneTri: 'libelle', mode: 'ASC', nombreParPage: 10 });
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    status = await tryEndpoint('parametres/bonLivraison/liste', 'POST', '/parametres/bonLivraison/liste',
      { colonneTri: 'libelle', mode: 'ASC', nombreParPage: 10 });
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    status = await tryEndpoint('parametres/tournee/liste', 'POST', '/parametres/tournee/liste',
      { colonneTri: 'libelle', mode: 'ASC', nombreParPage: 10 });
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    status = await tryEndpoint('parametres/commercial/liste', 'POST', '/parametres/commercial/liste',
      { colonneTri: 'libelle', mode: 'ASC', nombreParPage: 10 });
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    status = await tryEndpoint('parametres/paiement/liste', 'POST', '/parametres/paiement/liste',
      { colonneTri: 'libelle', mode: 'ASC', nombreParPage: 10 });

  } else if (round === 7) {
    // Round 7: Last attempts for /document/liste + test other useful Swagger endpoints

    // Test 1: /document/liste with NO query params, just body (maybe query params cause the 500?)
    status = await tryEndpoint('document/liste body-only', 'POST', '/document/liste',
      { periodeSelectionnee: { dateDebut: '2024-01-01T00:00:00', dateFin: '2026-03-17T23:59:59' } });
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    // Test 2: /document/liste with ALL params in body (original format, Swagger might be wrong)
    status = await tryEndpoint('document/liste all-in-body', 'POST', '/document/liste',
      { colonneTri: 'dateCreation', nombreParPage: 10, numeroPage: 0,
        periodeSelectionnee: { dateDebut: '2024-01-01T00:00:00', dateFin: '2026-03-17T23:59:59' } });
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    // Test 3: /parametres/fournisseur/liste (another Swagger endpoint)
    status = await tryEndpoint('fournisseur/liste', 'POST', '/parametres/fournisseur/liste',
      { colonneTri: 'libelle', mode: 'ASC', nombreParPage: 10 });
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    // Test 4: /commande/detail/{id} - try getting the commande we found (2479707)
    status = await tryEndpoint('commande/detail/2479707', 'GET', '/commande/detail/2479707', null);
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    // Test 5: /parametres/client/liste with query params (same pattern as document/liste Swagger)
    status = await tryEndpoint('client/liste query params', 'POST', '/parametres/client/liste',
      {},
      { colonneTri: 'libelle', nombreParPage: '5', numeroPage: '0' });

  } else if (round === 6) {
    // Round 6: SWAGGER-CORRECT calls - query params in URL, proper body schemas
    // /document/liste: colonneTri, nombreParPage, numeroPage are QUERY params per Swagger
    status = await tryEndpoint('document/liste (Swagger)', 'POST', '/document/liste',
      {}, // empty ModeleDocumentParametre body
      { colonneTri: 'dateCreation', nombreParPage: '10', numeroPage: '0' });
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    // /document/liste with FACTURE type filter
    status = await tryEndpoint('document/liste FACTURE', 'POST', '/document/liste',
      { types: ['FACTURE'] },
      { colonneTri: 'dateCreation', nombreParPage: '10', numeroPage: '0' });
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    // Client commandes-en-cours (GET, per Swagger)
    if (ebClientId) {
      status = await tryEndpoint('commandes-en-cours client', 'GET',
        `/parametres/client/commandes-en-cours/${ebClientId}`, null);
      if (status === 'stop') return res.json({ ok: true, results, round });
      await delay(500);

      // Client historique-commande (POST with Periode body)
      status = await tryEndpoint('historique-commande client', 'POST',
        `/parametres/client/historique-commande/${ebClientId}`,
        { dateDebut: '2024-01-01T00:00:00', dateFin: '2026-03-17T23:59:59' });
      if (status === 'stop') return res.json({ ok: true, results, round });
      await delay(500);

      // Client avoirs-disponibles (GET)
      status = await tryEndpoint('avoirs-disponibles client', 'GET',
        `/parametres/client/avoirs-disponibles/${ebClientId}`, null);
    } else {
      results.push({ label: 'SKIP', message: 'Pas de client EasyBeer lie - impossible de tester les endpoints client' });
    }

  } else {
    // Fallback round 1 (original tests)
    status = await tryEndpoint('document/liste format-client', 'POST', '/document/liste',
      { colonneTri: 'libelle', mode: 'ASC', nombreParPage: 10 });
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    if (ebClientId) {
      status = await tryEndpoint(`client/detail/${ebClientId}`, 'GET', `/parametres/client/detail/${ebClientId}`, null);
      if (status === 'stop') return res.json({ ok: true, results, round });
      await delay(500);
    }

    status = await tryEndpoint('commande/liste (root)', 'POST', '/commande/liste',
      { colonneTri: 'libelle', mode: 'ASC', nombreParPage: 10 });
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    status = await tryEndpoint('facture/liste (root)', 'POST', '/facture/liste',
      { colonneTri: 'libelle', mode: 'ASC', nombreParPage: 10 });
    if (status === 'stop') return res.json({ ok: true, results, round });
    await delay(500);

    status = await tryEndpoint('document/liste GET', 'GET', '/document/liste', null);
  }

  res.json({ ok: true, results, api_url: apiBase, client_id_tested: ebClientId || 'aucun' });
}));

// Webhook logs
router.get('/easybeer/webhook-logs', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM webhooks ORDER BY received_at DESC LIMIT 20');
  res.json(result.rows);
}));

// Test webhook: simulate a webhook call by inserting directly into webhooks table
// and triggering the same processing logic
router.post('/easybeer/test-webhook', authMiddleware, asyncHandler(async (req, res) => {
  const { type } = req.body; // 'commande' or 'client'

  let testPayload;
  let testId = '999999';

  if (type === 'commande') {
    try {
      const lastCmd = await db.query("SELECT easybeer_id FROM commandes WHERE source = 'easybeer' AND easybeer_id != '' ORDER BY date_creation DESC LIMIT 1");
      if (lastCmd.rows.length > 0) testId = lastCmd.rows[0].easybeer_id;
    } catch { /* use default */ }
    testPayload = { type: 'COMMANDE_FACTURATION', id: parseInt(testId) || 999999 };
  } else {
    try {
      const lastClient = await db.query("SELECT easybeer_id FROM easybeer_clients WHERE easybeer_id != '' ORDER BY synced_at DESC LIMIT 1");
      if (lastClient.rows.length > 0) testId = lastClient.rows[0].easybeer_id;
    } catch { /* use default */ }
    testPayload = { type: 'CLIENT_CREATION', id: parseInt(testId) || 999999 };
  }

  // Insert a test webhook entry
  const now = new Date().toISOString();
  const webhookInsert = await db.query(
    'INSERT INTO webhooks (source, type, external_id, payload, received_at, processing_result) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    ['easybeer-test', testPayload.type, String(testPayload.id), JSON.stringify(testPayload), now, 'En cours de traitement...']
  );
  const webhookDbId = webhookInsert.rows[0]?.id;

  // Now trigger the actual webhook handler logic
  // Use a mock req/res that won't interfere with the real response
  try {
    const mockReq = {
      params: { secret: '' },
      headers: { 'content-type': 'application/json', 'x-webhook-secret': '' },
      body: testPayload,
      get: () => ''
    };

    // Skip secret validation by setting it to empty
    const configResult = await db.query('SELECT * FROM easybeer_config WHERE id = 1');
    const config = configResult.rows[0];
    if (config?.webhook_secret) {
      mockReq.params.secret = config.webhook_secret;
      mockReq.headers['x-webhook-secret'] = config.webhook_secret;
    }

    let mockResponseData = null;
    const mockRes = {
      status: function(code) { this._code = code; return this; },
      json: (data) => { mockResponseData = data; },
      _code: 200
    };

    await handleEasyBeerWebhook(mockReq, mockRes);

    res.json({
      ok: true,
      message: `Test ${type} envoyé avec ID: ${testPayload.id}. Résultat visible dans le journal après rafraîchissement (traitement en ~5s).`,
      payload: testPayload,
      webhook_id: webhookDbId
    });
  } catch (err) {
    // Update the webhook entry with the error
    try { await db.query('UPDATE webhooks SET processing_result = $1 WHERE id = $2', [`ERREUR TEST: ${err.message}`, webhookDbId]); } catch {}
    res.json({ ok: false, message: `Erreur serveur: ${err.message || 'inconnue'}`, payload: testPayload });
  }
}));

// Liste tous les liens « imported » avec un score de cohérence, pour détecter les
// mauvaises affectations héritées de l'ancien matching par nom.
router.get('/easybeer/audit-liens', authMiddleware, asyncHandler(async (req, res) => {
  const liens = await db.query(`
    SELECT ec.easybeer_id, ec.name AS eb_name, ec.email AS eb_email, ec.siret AS eb_siret,
           ec.phone AS eb_phone, ec.imported_client_id,
           c.nom AS client_nom, c.email AS client_email, c.siret AS client_siret,
           c.telephone AS client_tel, c.telephone_mobile AS client_mobile,
           (SELECT COUNT(*) FROM commandes cm WHERE cm.client_id = c.id AND cm.source = 'easybeer') AS nb_commandes
    FROM easybeer_clients ec
    JOIN clients c ON c.id = ec.imported_client_id
    WHERE ec.status = 'imported' AND ec.imported_client_id IS NOT NULL
    ORDER BY ec.name`);

  const resultats = liens.rows.map(l => {
    // Même moteur que les doublons : les preuves d'un lien et le verdict qui en découle.
    const preuves = preuvesDeLien(
      { nom: l.eb_name, email: l.eb_email, siret: l.eb_siret, telephone: l.eb_phone },
      { nom: l.client_nom, email: l.client_email, siret: l.client_siret, telephone: l.client_tel, telephone_mobile: l.client_mobile },
    );
    const verdict = verdictDeLien(preuves);

    return {
      easybeer_id: l.easybeer_id,
      eb_name: l.eb_name,
      client_id: l.imported_client_id,
      client_nom: l.client_nom,
      nb_commandes: Number(l.nb_commandes) || 0,
      preuves,
      verdict,
    };
  });

  resultats.sort((a, b) => ({ suspect: 0, a_verifier: 1, ok: 2 })[a.verdict] - ({ suspect: 0, a_verifier: 1, ok: 2 })[b.verdict]);
  res.json({
    total: resultats.length,
    suspects: resultats.filter(r => r.verdict === 'suspect').length,
    a_verifier: resultats.filter(r => r.verdict === 'a_verifier').length,
    liens: resultats,
  });
}));

// Délier un client Easybeer (le lien redevient « pending », les futures commandes
// de ce client Easybeer partiront en orphelines jusqu'à re-liaison).
router.post('/easybeer/liens/:easybeerId/delier', authMiddleware, asyncHandler(async (req, res) => {
  const r = await db.query(
    "UPDATE easybeer_clients SET status = 'pending', imported_client_id = NULL, updated_at = $2 WHERE easybeer_id = $1 RETURNING name",
    [req.params.easybeerId, new Date().toISOString()]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Lien inconnu' });
  console.log(`[EasyBeer Audit] Lien delie: easybeer_id=${req.params.easybeerId} (${r.rows[0].name})`);
  res.json({ ok: true });
}));

// Relier un client Easybeer au bon client SuiviPro (et rapatrier ses commandes orphelines).
router.post('/easybeer/liens/:easybeerId/relier', authMiddleware, asyncHandler(async (req, res) => {
  const { client_id } = req.body || {};
  if (!client_id) return res.status(400).json({ error: 'client_id requis' });
  const cli = await db.query('SELECT id, nom FROM clients WHERE id = $1', [client_id]);
  if (cli.rows.length === 0) return res.status(404).json({ error: 'Client SuiviPro inconnu' });

  await db.query(
    `INSERT INTO easybeer_clients (easybeer_id, status, imported_client_id, synced_at, updated_at)
     VALUES ($1, 'imported', $2, $3, $3)
     ON CONFLICT (easybeer_id) DO UPDATE SET status = 'imported', imported_client_id = $2, updated_at = $3`,
    [req.params.easybeerId, client_id, new Date().toISOString()]
  );

  // Rapatrier les commandes orphelines de ce client Easybeer (via raw_data.client.idClient)
  const orphelines = await db.query("SELECT id, raw_data FROM commandes WHERE client_id IS NULL AND source = 'easybeer'");
  let rattachees = 0;
  for (const o of orphelines.rows) {
    try {
      const raw = JSON.parse(o.raw_data || '{}');
      const ebCli = raw.client && raw.client.idClient ? String(raw.client.idClient) : '';
      if (ebCli === String(req.params.easybeerId)) {
        await db.query('UPDATE commandes SET client_id = $1, client_name = $2 WHERE id = $3', [client_id, cli.rows[0].nom, o.id]);
        rattachees++;
      }
    } catch { /* raw illisible */ }
  }

  console.log(`[EasyBeer Audit] Lien cree: easybeer_id=${req.params.easybeerId} -> client ${client_id} (${rattachees} commande(s) rattachee(s))`);
  res.json({ ok: true, commandes_rattachees: rattachees });
}));

export default router;
