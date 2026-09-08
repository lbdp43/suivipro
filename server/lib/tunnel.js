// Le tunnel de vente côté serveur : UN seul endroit change l'étape d'un prospect.
// Il horodate l'entrée dans l'étape (date_etape), garde la raison de perte, écrit
// l'historique (prospect_etapes) et le journal. Tous les chemins passent ici : glisser
// dans le pipeline, appel, compte rendu, mail, conversion en client, rapprochement EasyBeer.
import crypto from 'crypto';
import db from '../db.js';
import { logActivity } from './journal.js';
import { appliquerIssue, estTerminale } from '../../shared/tunnel.js';
import { dateLocale } from '../../shared/regles.js';

/**
 * Change l'étape d'un prospect si elle diffère. `executeur` = db ou un client de transaction.
 * Renvoie true si l'étape a changé.
 */
export async function changerEtape(prospectId, vers, userId, { raison = '', executeur = db } = {}) {
  if (!vers) return false;
  const actuel = await executeur.query('SELECT etape_pipeline, nom_etablissement FROM prospects WHERE id = $1', [prospectId]);
  if (actuel.rows.length === 0) return false;
  const de = actuel.rows[0].etape_pipeline;
  const now = new Date().toISOString();
  if (de === vers) {
    // Même étape : on garde quand même une raison de perte précisée après coup.
    if (vers === 'perdu' && raison) await executeur.query('UPDATE prospects SET raison_perte = $1 WHERE id = $2', [raison, prospectId]);
    return false;
  }
  const raisonPerte = vers === 'perdu' ? (raison || '') : '';
  await executeur.query(
    'UPDATE prospects SET etape_pipeline = $1, date_etape = $2, date_modification = $2, raison_perte = $3 WHERE id = $4',
    [vers, now, raisonPerte, prospectId]
  );
  await executeur.query(
    'INSERT INTO prospect_etapes (id, prospect_id, de, vers, commercial_id, date, raison) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [`etp-${crypto.randomUUID()}`, prospectId, de, vers, userId || null, now, raisonPerte]
  );
  if (userId) {
    await logActivity(userId, 'etape_prospect', `${actuel.rows[0].nom_etablissement} : ${de} → ${vers}${raisonPerte ? ` (${raisonPerte})` : ''}`, 'prospect', prospectId);
  }
  return true;
}

/**
 * Termine une action (rappel typé) en disant ce qui s'est passé : clôt le rappel, déplace
 * l'étape, crée la prochaine action. Renvoie ce qui a changé pour que l'écran se mette à jour.
 */
export async function terminerAction(prospectId, { rappelId, type, issue, raison, note, commercialId }, userId) {
  const prospect = await db.query('SELECT * FROM prospects WHERE id = $1', [prospectId]);
  if (prospect.rows.length === 0) return null;
  const p = prospect.rows[0];
  let rappel = null;
  if (rappelId) {
    const r = await db.query('SELECT * FROM reminders WHERE id = $1 AND prospect_id = $2', [rappelId, prospectId]);
    rappel = r.rows[0] || null;
  }
  const typeAction = type || rappel?.type || 'autre';
  const effet = appliquerIssue(typeAction, issue, p.etape_pipeline);
  if (effet.perdu && !raison) return { erreur: 'La raison de la perte est requise' };

  if (rappel && rappel.statut === 'actif') {
    const message = note ? `${rappel.message}\n[Fait] ${note}` : rappel.message;
    await db.query('UPDATE reminders SET statut = $1, message = $2 WHERE id = $3', ['termine', message, rappel.id]);
    rappel = { ...rappel, statut: 'termine', message };
  }
  if (effet.etape) await changerEtape(prospectId, effet.etape, userId, { raison });

  let prochaine = null;
  const etapeFinale = effet.etape || p.etape_pipeline;
  if (effet.prochaine && !estTerminale(etapeFinale)) {
    const d = new Date(); d.setDate(d.getDate() + effet.prochaine.delaiJours);
    prochaine = {
      id: `rem-${crypto.randomUUID()}`,
      prospect_id: prospectId,
      commercial_id: commercialId || rappel?.commercial_id || userId,
      date: dateLocale(d),
      heure: '09:00',
      message: effet.prochaine.message,
      statut: 'actif',
      type: effet.prochaine.type,
    };
    await db.query(
      'INSERT INTO reminders (id, prospect_id, commercial_id, date, heure, message, statut, type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [prochaine.id, prochaine.prospect_id, prochaine.commercial_id, prochaine.date, prochaine.heure, prochaine.message, prochaine.statut, prochaine.type]
    );
  }
  const apres = await db.query('SELECT * FROM prospects WHERE id = $1', [prospectId]);
  return { prospect: apres.rows[0], rappel, prochaine, etape: effet.etape };
}

/** Un appel enregistré clôt les actions « appeler » échues de ce prospect. Renvoie les identifiants clos. */
export async function cloreActionsAppel(prospectId, aujourdhui) {
  const r = await db.query(
    "UPDATE reminders SET statut = 'termine' WHERE prospect_id = $1 AND statut = 'actif' AND COALESCE(type, 'appeler') = 'appeler' AND date <= $2 RETURNING id",
    [prospectId, aujourdhui]
  );
  return r.rows.map(x => x.id);
}
