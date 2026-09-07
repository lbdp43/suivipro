// Tâches nocturnes : synchro EasyBeer de secours, purge des journaux — routes déplacées telles quelles depuis routes.js.
import { Router } from 'express';
import crypto from 'crypto';
import * as eb from '../easybeer-client.js';
import db from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { ensureSiteInternetGroup, estCommandeWeb } from '../lib/easybeer-sync.js';

const router = Router();

// Rattrape silencieusement ce qu'un webhook aurait manqué : commandes des 7
// derniers jours (nouvelles + statuts qui ont changé + orphelines rattachables).
export async function syncNocturneEasybeer(fenetreJours = 7) {
  const debutTs = Date.now();
  try {
    const configResult = await db.query('SELECT * FROM easybeer_config WHERE id = 1');
    const config = configResult.rows[0];
    if (!config?.username || !config?.api_url) return { ok: false, raison: 'Configuration Easybeer incomplète' };

    const headers = { Authorization: 'Basic ' + Buffer.from(`${config.username}:${decrypt(config.password)}`).toString('base64') };
    const apiBase = (config.api_url || 'https://api.easybeer.fr').replace(/\/$/, '');
    const now = new Date().toISOString();
    const fmt = (d) => d.toISOString().slice(0, 10);
    const filtre = {
      dateDebutCreation: fmt(new Date(Date.now() - fenetreJours * 86400000)),
      dateFinCreation: fmt(new Date()),
    };

    const liens = await db.query("SELECT easybeer_id, imported_client_id FROM easybeer_clients WHERE status = 'imported' AND imported_client_id IS NOT NULL");
    const lienMap = new Map(liens.rows.map(r => [String(r.easybeer_id), r.imported_client_id]));

    const cmds = await eb.listeCommandes(apiBase, headers, { filtre, maxPages: 10 });
    let inserees = 0, majStatut = 0, rattachees = 0;

    for (const cmd of cmds) {
      const orderId = cmd.idCommande;
      if (!orderId) continue;
      const ebCli = cmd.client && cmd.client.idClient ? String(cmd.client.idClient) : '';
      let clientId = ebCli ? (lienMap.get(ebCli) || null) : null;
      let clientNom = (cmd.client && cmd.client.nom) || '';

      // Les objets de la liste portent etat/totaux : assez pour rafraîchir un statut.
      const apercu = eb.parseCommandeDetail(cmd);

      const existing = await db.query('SELECT id, client_id, statut FROM commandes WHERE easybeer_id = $1', [String(orderId)]);
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (apercu.statut && row.statut !== apercu.statut) {
          await db.query('UPDATE commandes SET statut = $1 WHERE id = $2', [apercu.statut, row.id]);
          majStatut++;
        }
        if (clientId && !row.client_id) {
          await db.query('UPDATE commandes SET client_id = $1, client_name = $2 WHERE id = $3', [clientId, clientNom, row.id]);
          rattachees++;
        }
        continue;
      }

      // Nouvelle commande jamais vue (webhook manqué)
      if (!clientId && estCommandeWeb(cmd)) {
        clientId = await ensureSiteInternetGroup();
        clientNom = clientNom || 'Site internet';
      }
      const det = await eb.detailCommande(apiBase, headers, orderId);
      if (!det) continue;
      const parsed = eb.parseCommandeDetail(det);
      const cmdId = `cmd-${crypto.randomUUID()}`;
      await db.query(
        `INSERT INTO commandes (id, client_id, easybeer_id, numero, date_commande, date_livraison, statut, montant_ht, montant_ttc, lignes, notes, source, client_name, raw_data, date_creation)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [cmdId, clientId || null, String(orderId), parsed.numero, parsed.dateCommande, parsed.dateLivraison, parsed.statut, parsed.montantHt, parsed.montantTtc,
         JSON.stringify(parsed.lignes), '', 'easybeer', clientNom, JSON.stringify(det), now]
      );
      inserees++;
    }

    const resume = { ok: true, fenetreJours, vues: cmds.length, nouvelles: inserees, statuts_mis_a_jour: majStatut, orphelines_rattachees: rattachees, duree_s: Math.round((Date.now() - debutTs) / 1000) };
    console.log(`[Sync nocturne] ${JSON.stringify(resume)}`);
    return resume;
  } catch (err) {
    console.error('[Sync nocturne] Échec:', err.message);
    return { ok: false, erreur: err.message };
  }
}

export async function purgerJournaux() {
  const j = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const r1 = await db.query('DELETE FROM notifications WHERE read = true AND created_at < $1', [j(90)]);
  const r2 = await db.query('DELETE FROM activity_log WHERE created_at < $1', [j(180)]);
  const r3 = await db.query('DELETE FROM easybeer_sync_logs WHERE id NOT IN (SELECT id FROM easybeer_sync_logs ORDER BY id DESC LIMIT 200)');
  const r4 = await db.query('DELETE FROM sirene_sync_logs WHERE id NOT IN (SELECT id FROM sirene_sync_logs ORDER BY id DESC LIMIT 200)').catch(() => ({ rowCount: 0 }));
  const bilan = { notifications: r1.rowCount || 0, activity_log: r2.rowCount || 0, easybeer_sync_logs: r3.rowCount || 0, sirene_sync_logs: r4.rowCount || 0 };
  console.log('[CRON] Purge des journaux :', JSON.stringify(bilan));
  return bilan;
}

export default router;
