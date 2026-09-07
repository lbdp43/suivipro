// Commandes (EasyBeer) et leur synchronisation — routes déplacées telles quelles depuis routes.js.
import { Router } from 'express';
import crypto from 'crypto';
import * as eb from '../easybeer-client.js';
import db from '../db.js';
import { dateLocale } from '../../shared/regles.js';
import { normaliserIdentifiant, chiffresTelephone } from '../../shared/normalisation.js';
import { encrypt, decrypt } from '../crypto.js';
import { asyncHandler, authMiddleware } from '../lib/auth.js';
import { createVisitesFromCommandes, ensureSiteInternetGroup, estCommandeWeb, importerClientDepuisCommande } from '../lib/easybeer-sync.js';
import { notifyAdmins } from '../lib/journal.js';
import { validationError } from '../lib/validation.js';

const router = Router();

router.get('/commandes', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM commandes ORDER BY date_commande DESC');
  res.json(result.rows.map(c => ({ ...c, lignes: JSON.parse(c.lignes || '[]') })));
}));

// Debug: inspect raw EasyBeer element structure for a commande
router.get('/commandes/:id/debug-elements', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT raw_data FROM commandes WHERE id = $1', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Commande non trouvee' });
  const raw = JSON.parse(result.rows[0].raw_data || '{}');
  const elementTypes = ['elementsBouteilles', 'elementsVolumes', 'elementsContenants', 'elementsSaisieLibre', 'elementsAutres', 'elementsMatierePremieres'];
  const elements = {};
  for (const type of elementTypes) {
    if (raw[type] && raw[type].length > 0) {
      elements[type] = { count: raw[type].length, first_element_keys: Object.keys(raw[type][0]), first_element: raw[type][0] };
    }
  }
  res.json({ commande_keys: Object.keys(raw), elements });
}));

router.post('/commandes', authMiddleware, asyncHandler(async (req, res) => {
  const c = req.body;
  if (!c.client_id) return validationError(res, ['client_id est requis']);
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO commandes (id, client_id, easybeer_id, numero, date_commande, date_livraison, statut, montant_ht, montant_ttc, lignes, notes, source, date_creation)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [c.id, c.client_id, c.easybeer_id || '', c.numero || '', c.date_commande || now, c.date_livraison || '',
     c.statut || 'en_cours', c.montant_ht || 0, c.montant_ttc || 0, JSON.stringify(c.lignes || []),
     c.notes || '', c.source || 'easybeer', now]
  );
  res.json({ ok: true });
}));

router.delete('/commandes/:id', authMiddleware, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM commandes WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// Orphan commandes (no client assigned)
router.get('/commandes/orphelines', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query("SELECT * FROM commandes WHERE client_id IS NULL ORDER BY date_commande DESC");
  res.json(result.rows.map(c => ({ ...c, lignes: JSON.parse(c.lignes || '[]') })));
}));

// Assign an orphan commande to a client
router.post('/commandes/:id/assign', authMiddleware, asyncHandler(async (req, res) => {
  const { client_id } = req.body;
  if (!client_id) return res.status(400).json({ error: 'client_id requis' });

  const cmd = await db.query('SELECT * FROM commandes WHERE id = $1', [req.params.id]);
  if (cmd.rows.length === 0) return res.status(404).json({ error: 'Commande non trouvee' });

  const clientResult = await db.query('SELECT id, nom, commercial_id FROM clients WHERE id = $1', [client_id]);
  if (clientResult.rows.length === 0) return res.status(404).json({ error: 'Client non trouve' });

  const commande = cmd.rows[0];
  const clientNom = clientResult.rows[0].nom;

  // Transaction: assign commande + link easybeer atomically
  const dbClient = await db.connect();
  try {
    await dbClient.query('BEGIN');

    await dbClient.query('UPDATE commandes SET client_id = $1 WHERE id = $2', [client_id, req.params.id]);

    // If this commande has an easybeer client ID, link it too for future orders
    const rawData = JSON.parse(commande.raw_data || '{}');
    const ebClientId = String(rawData.clientId || rawData.client_id || rawData.tiersId || rawData.tiers_id
      || rawData.idClient || rawData.id_client || '');
    if (ebClientId) {
      await dbClient.query(
        `INSERT INTO easybeer_clients (easybeer_id, name, status, imported_client_id, synced_at, updated_at)
        VALUES ($1,$2,'imported',$3,$4,$4)
        ON CONFLICT (easybeer_id) DO UPDATE SET status = 'imported', imported_client_id = $3, updated_at = $4`,
        [ebClientId, commande.client_name || clientNom, client_id, new Date().toISOString()]
      );
      console.log(`[Commandes] Lien EasyBeer cree: easybeer_id=${ebClientId} -> client ${client_id}`);
    }

    await dbClient.query('COMMIT');
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }

  console.log(`[Commandes] Orpheline #${commande.numero} assignee a ${clientNom} (${client_id})`);
  res.json({ ok: true, client_nom: clientNom });
}));

// Fetch orders from EasyBeer for a specific client and sync them
router.post('/easybeer/sync-commandes/:clientId', authMiddleware, asyncHandler(async (req, res) => {
  const clientId = req.params.clientId;

  // Find client and its easybeer link
  const clientResult = await db.query('SELECT c.*, ec.easybeer_id FROM clients c LEFT JOIN easybeer_clients ec ON ec.imported_client_id = c.id WHERE c.id = $1', [clientId]);
  if (clientResult.rows.length === 0) return res.status(404).json({ error: 'Client non trouve' });

  const client = clientResult.rows[0];
  let finalEbId = client.easybeer_id;
  if (!finalEbId) {
    const ebMatch = await db.query("SELECT easybeer_id FROM easybeer_clients WHERE status = 'imported' AND imported_client_id = $1", [clientId]);
    finalEbId = ebMatch.rows[0]?.easybeer_id;
  }
  if (!finalEbId) return res.json({ ok: false, message: 'Pas de lien EasyBeer', commandes: [] });

  const configResult = await db.query('SELECT * FROM easybeer_config WHERE id = 1');
  const config = configResult.rows[0];
  if (!config?.username || !config?.api_url) {
    return res.json({ ok: false, message: 'Configuration EasyBeer incomplete', commandes: [] });
  }

  const authHeader = 'Basic ' + Buffer.from(`${config.username}:${decrypt(config.password)}`).toString('base64');
  const apiBase = (config.api_url || 'https://api.easybeer.fr').replace(/\/$/, '');
  const hdrs = { 'Authorization': authHeader, 'Accept': 'application/json', 'Content-Type': 'application/json' };
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  // Toutes les commandes du client via la liste filtrée (endpoint vérifié :
  // POST /commande/liste/tous + ModeleCommandeFiltre { idClient }, pages >= 1)
  let orderIds = [];
  const debugInfo = [];
  try {
    const cmds = await eb.listeCommandes(apiBase, hdrs, { filtre: { idClient: Number(finalEbId) } });
    orderIds = cmds.map(c => c.idCommande).filter(Boolean);
    debugInfo.push({ endpoint: '/commande/liste/tous (idClient)', count: orderIds.length });
  } catch (err) {
    debugInfo.push({ endpoint: '/commande/liste/tous (idClient)', error: err.message });
  }

  if (orderIds.length === 0) {
    const allCommandes = await db.query('SELECT * FROM commandes WHERE client_id = $1 ORDER BY date_commande DESC', [clientId]);
    return res.json({
      ok: true,
      message: 'Aucune commande trouvee via l\'API. Les commandes existantes sont affichees.',
      commandes: allCommandes.rows.map(c => ({ ...c, lignes: JSON.parse(c.lignes || '[]') })),
      debug: debugInfo,
    });
  }

  // Step 3: Get full details for each order via /commande/detail/{id}
  const now = new Date().toISOString();
  const imported = [];
  let skipped = 0;

  for (const orderId of orderIds) {
    await delay(500);

    // Anti-doublon: check if already exists
    const existing = await db.query(
      'SELECT id FROM commandes WHERE client_id = $1 AND easybeer_id = $2',
      [clientId, String(orderId)]
    );
    if (existing.rows.length > 0) { skipped++; continue; }

    try {
      const det = await eb.detailCommande(apiBase, hdrs, orderId);
      if (!det) continue;
      const parsed = eb.parseCommandeDetail(det);

      const cmdId = `cmd-${crypto.randomUUID()}`;
      await db.query(
        `INSERT INTO commandes (id, client_id, easybeer_id, numero, date_commande, date_livraison, statut, montant_ht, montant_ttc, lignes, notes, source, client_name, raw_data, date_creation)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [cmdId, clientId, String(orderId), parsed.numero, parsed.dateCommande, parsed.dateLivraison, parsed.statut, parsed.montantHt, parsed.montantTtc,
         JSON.stringify(parsed.lignes), '', 'easybeer', client.nom || '', JSON.stringify(det), now]
      );
      imported.push({ id: cmdId, numero: parsed.numero, statut: parsed.statut, montant_ttc: parsed.montantTtc });
    } catch (err) {
      debugInfo.push({ endpoint: `commande/detail/${orderId}`, error: err.message });
    }
  }

  console.log(`[EasyBeer] Synced ${imported.length} commandes for client ${clientId} (${skipped} skipped)`);

  const allCommandes = await db.query('SELECT * FROM commandes WHERE client_id = $1 ORDER BY date_commande DESC', [clientId]);
  res.json({
    ok: true,
    message: `${imported.length} nouvelles commandes importees, ${skipped} deja existantes`,
    commandes: allCommandes.rows.map(c => ({ ...c, lignes: JSON.parse(c.lignes || '[]') })),
    total_found: orderIds.length,
    imported: imported.length,
    skipped,
    debug: debugInfo,
  });
}));

// Bulk sync: fetch ALL orders from EasyBeer for all known clients
// Uses working endpoints: historique-commande, commandes-en-cours, commande/detail
// Pass { force: true } to delete existing EasyBeer commandes and re-import (useful for updating product names)
// Easybeer refuse une periode > 1 an sur /commande/liste (HTTP 400 "La periode ne peut
// pas etre superieure a 1 an"). On decoupe la plage demandee en fenetres consecutives
// de 364 jours max (bornes incluses, format yyyy-MM-dd).
function fenetresMax1An(debutStr, finStr) {
  const JOUR = 86400000;
  const fin = new Date(`${finStr}T00:00:00Z`);
  let debut = new Date(`${debutStr}T00:00:00Z`);
  if (isNaN(debut.getTime()) || isNaN(fin.getTime()) || debut > fin) {
    return [{ debut: debutStr, fin: finStr }];
  }
  const fenetres = [];
  while (debut <= fin) {
    const borne = new Date(debut.getTime() + 364 * JOUR);
    const finFenetre = borne < fin ? borne : fin;
    fenetres.push({ debut: dateLocale(debut), fin: dateLocale(finFenetre) });
    debut = new Date(finFenetre.getTime() + JOUR);
  }
  return fenetres;
}

// La synchro complete peut durer plusieurs minutes : des milliers de commandes, chacune
// detaillee via l'API EasyBeer bridee (~3 req/s). Une reponse HTTP ne peut pas attendre
// aussi longtemps — la requete etait coupee en route et l'admin affichait « Erreur de
// synchronisation des commandes » alors que l'import tournait toujours. Le travail se fait
// donc en arriere-plan (runCommandesSync) et l'ecran admin suit l'avancement par polling.
let commandesSyncRunning = false;

let derniereSyncCommandes = null;

async function executerSyncCommandes({ force = false, dateDebut: dateDebutParam } = {}, onProgress = async () => {}) {
  if (force) {
    const deleted = await db.query("DELETE FROM commandes WHERE source = 'easybeer'");
    console.log(`[EasyBeer Bulk Sync] Force mode: deleted ${deleted.rowCount} existing commandes`);
  }

  const configResult = await db.query('SELECT * FROM easybeer_config WHERE id = 1');
  const config = configResult.rows[0];
  if (!config?.username || !config?.api_url) {
    return { ok: false, message: 'Configuration EasyBeer incomplete' };
  }

  const decryptedPassword = decrypt(config.password);
  const authHeader = 'Basic ' + Buffer.from(`${config.username}:${decryptedPassword}`).toString('base64');
  const apiBase = (config.api_url || 'https://api.easybeer.fr').replace(/\/$/, '');
  const hdrs = { 'Authorization': authHeader, 'Accept': 'application/json', 'Content-Type': 'application/json' };
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  console.log(`[EasyBeer Bulk Sync] Config: username=${config.username}, api_url=${apiBase}, password_length=${decryptedPassword?.length || 0}`);

  // Step 1: Fetch ALL clients from EasyBeer API to get their real numeric idClient
  console.log(`[EasyBeer Bulk Sync] Fetching client list from EasyBeer API...`);
  let apiClients = [];
  const debugInfo = [];

  // Liste complète des clients via l'endpoint vérifié :
  // POST /parametres/client/liste?colonneTri=nom&numeroPage=N (N >= 1).
  // (colonneTri=libelle ou numeroPage=0 -> 500, verifie en reel.)
  try {
    apiClients = await eb.listeClients(apiBase, hdrs);
    debugInfo.push({ endpoint: '/parametres/client/liste', count: apiClients.length });
  } catch (err) {
    console.log(`[EasyBeer Bulk Sync] client/liste indisponible (${err.message}), utilisation des liens existants`);
    debugInfo.push({ endpoint: '/parametres/client/liste', error: err.message });
    const knownIds = await db.query("SELECT easybeer_id, name FROM easybeer_clients WHERE easybeer_id IS NOT NULL");
    debugInfo.push({ endpoint: 'known-ids', count: knownIds.rows.length });
  }

  console.log(`[EasyBeer Bulk Sync] ${apiClients.length} clients recuperes depuis l'API EasyBeer`);

  // Step 2: Match API clients to our local clients (by SIRET, email, phone, name)
  const localClients = await db.query(
    `SELECT c.id, c.nom, c.email, c.telephone, c.telephone_mobile, c.siret, c.contact,
            ec.easybeer_id as stored_eb_id, ec.name as eb_name
     FROM clients c
     LEFT JOIN easybeer_clients ec ON ec.imported_client_id = c.id`
  );

  const normalize = normaliserIdentifiant;

  // Build matched list: { apiId (numeric), localClientId, clientNom }
  const matchedClients = [];
  const unmatchedApiClients = [];

  if (apiClients.length > 0) {
    // Normal mode: match API clients to local clients
    for (const apiClient of apiClients) {
      const apiId = apiClient.idClient || apiClient.id;
      if (!apiId) continue;

      const apiNom = apiClient.nom || apiClient.libelle || apiClient.raisonSociale || '';
      const apiEmail = apiClient.email || apiClient.emailPrincipal || apiClient.mail || '';
      const apiTel = chiffresTelephone(apiClient.telephone || apiClient.tel || apiClient.phone || '');
      const apiSiret = normalize(apiClient.siret || apiClient.siren || '');
      const apiNomNorm = normalize(apiNom);

      let bestMatch = null;

      for (const local of localClients.rows) {
        if (local.stored_eb_id && String(local.stored_eb_id) === String(apiId)) { bestMatch = local; break; }
        if (apiSiret && apiSiret.length >= 9 && normalize(local.siret).includes(apiSiret)) { bestMatch = local; break; }
        if (apiEmail && local.email && normalize(apiEmail) === normalize(local.email)) { bestMatch = local; break; }
        if (apiTel && apiTel.length >= 8 && (chiffresTelephone(local.telephone).includes(apiTel) || chiffresTelephone(local.telephone_mobile).includes(apiTel))) { bestMatch = local; break; }
        // Nom Easybeer déjà vu via webhook pour CE client local : même entité, sûr.
        if (apiNomNorm && local.eb_name && normalize(local.eb_name) === apiNomNorm) { bestMatch = local; break; }
        // ⚠️ plus AUCUN rapprochement flou par nom : c'était la source des mauvaises
        // affectations mémorisées. Un client non lié reste non lié (à lier dans l'admin).
      }

      if (bestMatch) {
        matchedClients.push({ apiId, localClientId: bestMatch.id, clientNom: bestMatch.nom, apiNom });
        if (bestMatch.stored_eb_id !== String(apiId)) {
          await db.query(`UPDATE easybeer_clients SET easybeer_id = $1 WHERE imported_client_id = $2`, [String(apiId), bestMatch.id]).catch(() => {});
        }
      } else {
        unmatchedApiClients.push({ apiId, apiNom });
      }
    }
  } else {
    // Fallback mode: use existing easybeer_clients links from DB
    const existingLinks = await db.query(
      `SELECT ec.easybeer_id, ec.name, ec.imported_client_id, c.nom as client_nom
       FROM easybeer_clients ec
       JOIN clients c ON ec.imported_client_id = c.id
       WHERE ec.status = 'imported' AND ec.easybeer_id IS NOT NULL AND ec.imported_client_id IS NOT NULL`
    );
    for (const link of existingLinks.rows) {
      matchedClients.push({
        apiId: link.easybeer_id,
        localClientId: link.imported_client_id,
        clientNom: link.client_nom || link.name,
        apiNom: link.name || link.client_nom
      });
    }
    console.log(`[EasyBeer Bulk Sync] Fallback: ${matchedClients.length} clients depuis easybeer_clients DB`);
  }

  console.log(`[EasyBeer Bulk Sync] ${matchedClients.length} clients matches, ${unmatchedApiClients.length} non matches`);
  debugInfo.push({
    endpoint: 'matching',
    api_clients: apiClients.length,
    matched: matchedClients.length,
    unmatched: unmatchedApiClients.length,
    fallback: apiClients.length === 0,
    unmatched_names: unmatchedApiClients.slice(0, 10).map(c => c.apiNom),
  });

  if (matchedClients.length === 0 && unmatchedApiClients.length === 0) {
    return { ok: false, message: apiClients.length === 0
      ? 'API client/liste indisponible et aucun client lie dans la base. Importez d\'abord des clients via les webhooks ou manuellement.'
      : 'Aucun client a synchroniser', debug: debugInfo, apiBase };
  }

  // Step 3: For each matched client, fetch commandes-en-cours + historique-commande using REAL API ID
  const now = new Date().toISOString();
  let totalImported = 0;
  let totalSkipped = 0;
  let totalFound = 0;
  let totalOrphans = 0;
  const clientStats = {};

  // Process matched clients (linked to local clients)
  const allClientsToProcess = [
    ...matchedClients.map(c => ({ apiId: c.apiId, clientId: c.localClientId, clientNom: c.clientNom })),
    ...unmatchedApiClients.map(c => ({ apiId: c.apiId, clientId: null, clientNom: c.apiNom })),
  ];

  // Une SEULE liste globale paginée des commandes (au lieu de 2 appels par client,
  // qui déclenchaient le ban 10 req/s). Chaque commande porte son client.idClient :
  // le rattachement se fait par identifiant, jamais par nom.
  const idToLocal = new Map(allClientsToProcess.filter(c => c.clientId).map(c => [String(c.apiId), c]));

  // Lien direct et fiable : les clients portent leur easybeer_id natif (pose par la sync
  // clients). On s'en sert en priorite pour rattacher les commandes — sans dependre de la
  // liste API ni du matching flou, qui laissaient des commandes en orphelines.
  const liensDirects = await db.query(
    "SELECT id, nom, easybeer_id FROM clients WHERE easybeer_id IS NOT NULL AND easybeer_id <> ''"
  );
  for (const row of liensDirects.rows) {
    idToLocal.set(String(row.easybeer_id), { apiId: String(row.easybeer_id), clientId: row.id, clientNom: row.nom });
  }
  console.log(`[EasyBeer Bulk Sync] ${idToLocal.size} liens client disponibles (dont ${liensDirects.rows.length} par easybeer_id direct)`);
  const dateDebut = dateDebutParam || '2024-01-01';
  const dateFin = dateLocale();
  const fenetres = fenetresMax1An(dateDebut, dateFin);
  let toutesCommandes = [];
  for (const fenetre of fenetres) {
    try {
      const lot = await eb.listeCommandes(apiBase, hdrs, {
        filtre: { dateDebutCreation: fenetre.debut, dateFinCreation: fenetre.fin },
        maxPages: 60,
      });
      toutesCommandes.push(...lot);
      debugInfo.push({ endpoint: '/commande/liste/tous', periode: `${fenetre.debut} -> ${fenetre.fin}`, count: lot.length });
    } catch (err) {
      debugInfo.push({ endpoint: '/commande/liste/tous', periode: `${fenetre.debut} -> ${fenetre.fin}`, error: err.message });
    }
  }
  console.log(`[EasyBeer Bulk Sync] ${toutesCommandes.length} commandes recuperees sur ${fenetres.length} fenetre(s) (${dateDebut} -> ${dateFin})`);
  totalFound = toutesCommandes.length;

  // Progression toutes les 5 commandes : chaque commande nouvelle coute un appel detail,
  // et l'API peut imposer des attentes de ~30 s. Un rafraichissement rare donnait
  // l'impression que la synchro tournait dans le vide.
  let traitees = 0;
  let clientsImportes = 0;
  const cacheImportClients = new Map();
  const debutBoucle = Date.now();
  const messageProgression = () => {
    const st = eb.statsEasybeer ? eb.statsEasybeer() : null;
    const minutes = Math.round((Date.now() - debutBoucle) / 60000);
    const attente = st && st.bans > 0
      ? ` - API EasyBeer ralentie: ${st.bans} attente(s), ~${Math.round(st.attenteBanMs / 1000)}s perdues`
      : '';
    return `${traitees}/${totalFound} commandes traitees - ${totalImported} importees, ${totalSkipped} deja connues`
      + `${attente} (depuis ${minutes} min)`;
  };
  await onProgress(`0/${totalFound} commandes traitees`, { imported: 0, skipped: 0 });
  for (const cmd of toutesCommandes) {
    traitees++;
    if (traitees % 5 === 0) {
      await onProgress(messageProgression(), { imported: totalImported, skipped: totalSkipped });
    }
    const orderId = cmd.idCommande;
    if (!orderId) continue;
    const ebCliId = cmd.client && cmd.client.idClient ? String(cmd.client.idClient) : '';
    const lien = ebCliId ? idToLocal.get(ebCliId) : null;
    let clientId = lien ? lien.clientId : null;
    let clientNom = (lien && lien.clientNom) || (cmd.client && cmd.client.nom) || '';
    // Commande du site internet non liée -> groupe « Site internet »
    if (!clientId && estCommandeWeb(cmd)) {
      clientId = await ensureSiteInternetGroup();
      clientNom = clientNom || 'Site internet';
    }
    // Client inconnu : on importe sa fiche EasyBeer plutot que de laisser une orpheline.
    if (!clientId && ebCliId) {
      clientId = await importerClientDepuisCommande(apiBase, hdrs, ebCliId, cacheImportClients);
      if (clientId) {
        idToLocal.set(ebCliId, { apiId: ebCliId, clientId, clientNom });
        clientsImportes++;
      }
    }

    // Anti-doublon global par easybeer_id ; au passage, on raccroche les orphelines
    // dont on connaît désormais le client.
    const existing = await db.query('SELECT id, client_id FROM commandes WHERE easybeer_id = $1', [String(orderId)]);
    if (existing.rows.length > 0) {
      if (clientId && !existing.rows[0].client_id) {
        await db.query('UPDATE commandes SET client_id = $1, client_name = $2 WHERE id = $3', [clientId, clientNom, existing.rows[0].id]);
        console.log(`[EasyBeer Bulk Sync] Orpheline #${orderId} rattachée au client ${clientNom}`);
      }
      totalSkipped++;
      continue;
    }

    try {
      const det = await eb.detailCommande(apiBase, hdrs, orderId);
      if (!det) continue;
      const parsed = eb.parseCommandeDetail(det);

      const cmdId = `cmd-${crypto.randomUUID()}`;
      await db.query(
        `INSERT INTO commandes (id, client_id, easybeer_id, numero, date_commande, date_livraison, statut, montant_ht, montant_ttc, lignes, notes, source, client_name, raw_data, date_creation)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [cmdId, clientId || null, String(orderId), parsed.numero, parsed.dateCommande, parsed.dateLivraison, parsed.statut, parsed.montantHt, parsed.montantTtc,
         JSON.stringify(parsed.lignes), '', 'easybeer', clientNom, JSON.stringify(det), now]
      );

      totalImported++;
      if (clientId) {
        if (!clientStats[clientId]) clientStats[clientId] = { nom: clientNom, count: 0, total_ttc: 0 };
        clientStats[clientId].count++;
        clientStats[clientId].total_ttc += parsed.montantTtc;
      } else {
        totalOrphans++;
        const orphanKey = `orphan_${ebCliId || orderId}`;
        if (!clientStats[orphanKey]) clientStats[orphanKey] = { nom: `${clientNom} (non lié)`, count: 0, total_ttc: 0 };
        clientStats[orphanKey].count++;
        clientStats[orphanKey].total_ttc += parsed.montantTtc;
      }
    } catch (err) {
      debugInfo.push({ endpoint: `commande/detail/${orderId}`, error: err.message });
    }
  }

  const statsArray = Object.entries(clientStats).map(([id, s]) => ({
    client_id: id, nom: s.nom, commandes_importees: s.count, total_ttc: Math.round(s.total_ttc * 100) / 100
  }));

  console.log(`[EasyBeer Bulk Sync] Termine: ${totalImported} importees, ${totalSkipped} existantes, ${totalOrphans} orphelines, ${totalFound} trouvees`);

  // Genere les "visites" a partir des commandes importees (arriere-plan, idempotent).
  createVisitesFromCommandes({ sinceDays: 365 }).catch((e) => console.error('[EasyBeer Visites] fatal:', e.message));

  // Pas de renvoi de toutes les commandes ici : la charge utile (raw_data de chaque
  // commande) faisait plusieurs Mo et n'etait de toute facon pas utilisee par l'admin.
  const statsApi = eb.statsEasybeer ? eb.statsEasybeer() : null;
  if (statsApi && statsApi.bans > 0) {
    debugInfo.push({ endpoint: 'regulation-api', bans: statsApi.bans, attente_s: Math.round(statsApi.attenteBanMs / 1000), cadence_ms: statsApi.intervalle });
  }
  // Commandes dont le detail n'a pas pu etre recupere : elles ne sont pas en base, donc
  // une relance de la synchro les reprendra. On le dit explicitement.
  const totalEchecs = debugInfo.filter(d => d && d.error && String(d.endpoint || '').startsWith('commande/detail/')).length;
  return {
    ok: true,
    message: `${totalImported} commandes importees pour ${Object.keys(clientStats).length} clients`
      + (clientsImportes > 0 ? ` — ${clientsImportes} client(s) cree(s) depuis leurs commandes` : '')
      + (totalEchecs > 0 ? ` — ${totalEchecs} non recuperees (relancez la synchro)` : '')
      + (statsApi && statsApi.bans > 0 ? ` (API EasyBeer ralentie: ${statsApi.bans} attente(s))` : ''),
    total_echecs: totalEchecs,
    clients_importes_commande: clientsImportes,
    total_orders_found: totalFound,
    total_imported: totalImported,
    total_skipped: totalSkipped,
    total_orphans: totalOrphans,
    api_clients: apiClients.length,
    clients_matched: matchedClients.length,
    clients_unmatched: unmatchedApiClients.length,
    details: statsArray,
    debug: debugInfo,
  };
}

// Enveloppe de fond : verrou anti-doublon, journal de sync et suivi de progression.
async function runCommandesSync(options = {}) {
  if (commandesSyncRunning) return { ok: false, running: true, message: 'Synchronisation des commandes deja en cours' };
  commandesSyncRunning = true;
  derniereSyncCommandes = null;
  const debut = new Date().toISOString();
  const logId = (await db.query(
    "INSERT INTO easybeer_sync_logs (kind,status,started_at,message) VALUES ('commandes','running',$1,$2) RETURNING id",
    [debut, 'Demarrage...']
  )).rows[0].id;
  const onProgress = async (message, stats = {}) => {
    try {
      await db.query("UPDATE easybeer_sync_logs SET message=$2, created=$3, skipped=$4 WHERE id=$1",
        [logId, message, stats.imported || 0, stats.skipped || 0]);
    } catch { /* le suivi ne doit jamais casser la sync */ }
  };
  try {
    const resultat = await executerSyncCommandes(options, onProgress);
    derniereSyncCommandes = { ...resultat, finished_at: new Date().toISOString() };
    await db.query(
      "UPDATE easybeer_sync_logs SET status=$2, created=$3, skipped=$4, errors=$5, message=$6, finished_at=$7 WHERE id=$1",
      [logId, resultat.ok ? 'done' : 'error', resultat.total_imported || 0, resultat.total_skipped || 0,
       (resultat.debug || []).filter(d => d && d.error).length, resultat.message, new Date().toISOString()]
    );
    return resultat;
  } catch (err) {
    console.error('[EasyBeer Bulk Sync] fatal:', err.message);
    derniereSyncCommandes = { ok: false, message: err.message, finished_at: new Date().toISOString() };
    await db.query("UPDATE easybeer_sync_logs SET status='error', message=$2, finished_at=$3 WHERE id=$1",
      [logId, err.message, new Date().toISOString()]).catch(() => {});
    await notifyAdmins('sync_erreur', 'Synchronisation des commandes en erreur', err.message, { kind: 'commandes' }).catch(() => {});
    return { ok: false, message: err.message };
  } finally {
    commandesSyncRunning = false;
  }
}

// Lance la synchro complete des commandes (arriere-plan). Reponse immediate : l'admin
// suit l'etat via GET /easybeer/sync-commandes-status.
router.post('/easybeer/sync-all-commandes', authMiddleware, asyncHandler(async (req, res) => {
  if (commandesSyncRunning) {
    return res.json({ ok: true, running: true, message: 'Synchronisation des commandes deja en cours' });
  }
  const { force, dateDebut } = req.body || {};
  runCommandesSync({ force: !!force, dateDebut }).catch((e) => console.error('[EasyBeer Bulk Sync] fatal:', e.message));
  res.json({ ok: true, running: true, message: 'Synchronisation des commandes lancee (elle continue meme si vous quittez cette page)' });
}));

// Etat de la synchro des commandes : en cours + dernier resultat complet.
router.get('/easybeer/sync-commandes-status', authMiddleware, asyncHandler(async (req, res) => {
  const log = await db.query("SELECT * FROM easybeer_sync_logs WHERE kind = 'commandes' ORDER BY id DESC LIMIT 1");
  let ligne = log.rows[0] || null;
  // Un redemarrage du serveur (deploiement) tue une sync en cours : la ligne resterait
  // « running » indefiniment. On la marque interrompue des qu'on constate l'incoherence.
  if (ligne && ligne.status === 'running' && !commandesSyncRunning) {
    const message = `${ligne.message || ''} (interrompue par un redemarrage du serveur)`.trim();
    await db.query("UPDATE easybeer_sync_logs SET status='error', message=$2, finished_at=$3 WHERE id=$1",
      [ligne.id, message, new Date().toISOString()]).catch(() => {});
    ligne = { ...ligne, status: 'error', message };
  }
  res.json({ ok: true, running: commandesSyncRunning, log: ligne, resultat: derniereSyncCommandes });
}));

export default router;
