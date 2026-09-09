// Prospects et sessions d'appel — routes déplacées telles quelles depuis routes.js.
// Les fiches partagées passent par la boîte de prospection (routes/signalements.js).
import { Router } from 'express';
import db from '../db.js';
import { asyncHandler, authMiddleware, isAdmin } from '../lib/auth.js';
import { dateLocale } from '../../shared/regles.js';
import { logActivity } from '../lib/journal.js';
import { rattacherEntite, rattacherTout } from '../lib/zones.js';
import { changerEtape, terminerAction } from '../lib/tunnel.js';
import { parseProspect, parseSessionAppel } from '../lib/parse.js';
import { scoreProspect } from '../lib/scores.js';
import { validateProspect, validationError } from '../lib/validation.js';
import { archiver, Introuvable } from '../lib/corbeille.js';

const router = Router();

router.get('/prospects', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM prospects');
  res.json(result.rows.map(parseProspect));
}));

router.post('/prospects', authMiddleware, asyncHandler(async (req, res) => {
  const p = req.body;
  const errors = validateProspect(p);
  if (errors.length > 0) return validationError(res, errors);

  // Force commercial_id to current user if not admin
  const commercialId = isAdmin(req) ? (p.commercial_id || req.user.id) : req.user.id;

  const scoreCreation = await scoreProspect(p.tags, p.score || 50);
  await db.query(
    `INSERT INTO prospects (id, nom_etablissement, type_etablissement, nom_contact, telephone, email, adresse, ville, code_postal, departement, secteur, latitude, longitude, etape_pipeline, tags, commercial_id, notes, date_creation, date_modification, score, raison_sociale, siren, siret, tva_intracom)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
    [p.id, p.nom_etablissement, p.type_etablissement, p.nom_contact || '', p.telephone || '', p.email || '', p.adresse || '', p.ville || '', p.code_postal || '', p.departement || '', p.secteur || '', p.latitude || 0, p.longitude || 0, p.etape_pipeline || 'nouveau', JSON.stringify(p.tags || []), commercialId, p.notes || '', p.date_creation, p.date_modification, scoreCreation,
     p.raison_sociale || '', p.siren || '', p.siret || '', p.tva_intracom || '']
  );
  await rattacherEntite('prospects', p.id);
  await logActivity(req.user.id, 'creation_prospect', p.nom_etablissement, 'prospect', p.id);
  res.json({ ok: true });
}));

router.put('/prospects/:id', authMiddleware, asyncHandler(async (req, res) => {
  const p = req.body;
  const errors = validateProspect(p);
  if (errors.length > 0) return validationError(res, errors);

  const scoreMaj = await scoreProspect(p.tags, p.score || 50);
  // L'étape ne se change que par changerEtape (historique, date d'entrée, raison de perte).
  await db.query(
    `UPDATE prospects SET nom_etablissement=$1, type_etablissement=$2, nom_contact=$3, telephone=$4, email=$5, adresse=$6, ville=$7, code_postal=$8, departement=$9, secteur=$10, latitude=$11, longitude=$12, tags=$13, commercial_id=$14, notes=$15, date_modification=$16, score=$17, raison_sociale=$19, siren=$20, siret=$21, tva_intracom=$22 WHERE id=$18`,
    [p.nom_etablissement, p.type_etablissement, p.nom_contact || '', p.telephone || '', p.email || '', p.adresse || '', p.ville || '', p.code_postal || '', p.departement || '', p.secteur || '', p.latitude || 0, p.longitude || 0, JSON.stringify(p.tags || []), p.commercial_id || req.user.id, p.notes || '', p.date_modification, scoreMaj, req.params.id,
     p.raison_sociale || '', p.siren || '', p.siret || '', p.tva_intracom || '']
  );
  if (p.etape_pipeline) await changerEtape(req.params.id, p.etape_pipeline, req.user.id, { raison: p.raison_perte || '' });
  await rattacherEntite('prospects', req.params.id);
  await logActivity(req.user.id, 'modification_prospect', `${p.nom_etablissement} → ${p.etape_pipeline}`, 'prospect', req.params.id);
  res.json({ ok: true });
}));

// Supprimer ne détruit plus : la fiche part dans la corbeille avec ses appels, ses
// rendez-vous, ses rappels et son historique d'étapes, et l'administrateur peut la
// remettre en place. Le journal retient qui a fait le geste.
router.delete('/prospects/:id', authMiddleware, asyncHandler(async (req, res) => {
  try {
    await archiver('prospect', req.params.id, req.user.id);
  } catch (err) {
    if (err instanceof Introuvable) return res.status(404).json({ error: 'Prospect introuvable' });
    throw err;
  }
  res.json({ ok: true });
}));

// Corps : { texte, forcer }. `texte` est le message WhatsApp tel quel (nom, adresse, lien)
// ou le lien seul. Sans `forcer`, un doublon probable bloque la création et est renvoyé
// pour que la personne choisisse : ouvrir l'existant, ou créer quand même.

// La liste que chacun se choisit dans Prospects ou dans le Pipeline. Le jour vient de
// l'écran (heure de Paris) ; les prospects appelés se déduisent des appels du jour.
function jourValide(j) { return /^\d{4}-\d{2}-\d{2}$/.test(String(j || '')) ? j : dateLocale(new Date()); }

router.put('/sessions-appel/jour', authMiddleware, asyncHandler(async (req, res) => {
  const jour = jourValide(req.body.jour);
  const mode = req.body.mode === 'remplacer' ? 'remplacer' : 'ajouter';
  const lireIds = (v) => [...new Set((Array.isArray(v) ? v : []).filter(x => typeof x === 'string' && x))];
  const prospectsDemandes = lireIds(req.body.prospect_ids);
  const clientsDemandes = lireIds(req.body.client_ids);
  if (prospectsDemandes.length === 0 && clientsDemandes.length === 0 && mode === 'ajouter') return validationError(res, ['Aucune fiche sélectionnée']);
  // Seules les fiches existantes, avec un numéro, valent la peine d'être dans une session.
  // On garde l'ordre choisi à l'écran (la base renvoie les lignes dans n'importe quel ordre).
  const prospectsOk = new Set(prospectsDemandes.length
    ? (await db.query(`SELECT id FROM prospects WHERE id = ANY($1) AND telephone <> ''`, [prospectsDemandes])).rows.map(r => r.id)
    : []);
  const clientsOk = new Set(clientsDemandes.length
    ? (await db.query(`SELECT id FROM clients WHERE id = ANY($1) AND (COALESCE(telephone, '') <> '' OR COALESCE(telephone_mobile, '') <> '')`, [clientsDemandes])).rows.map(r => r.id)
    : []);
  const prospectsValides = prospectsDemandes.filter(d => prospectsOk.has(d));
  const clientsValides = clientsDemandes.filter(d => clientsOk.has(d));
  const existante = await db.query('SELECT * FROM sessions_appel WHERE commercial_id = $1 AND jour = $2', [req.user.id, jour]);
  const avant = existante.rows[0] ? parseSessionAppel(existante.rows[0]) : { prospect_ids: [], client_ids: [] };
  // En mode « remplacer », seule la liste envoyée est remplacée ; l'autre reste telle quelle.
  const prospects = mode === 'ajouter' ? [...new Set([...avant.prospect_ids, ...prospectsValides])]
    : (req.body.prospect_ids !== undefined ? prospectsDemandes.filter(d => prospectsValides.includes(d)) : avant.prospect_ids);
  const clients = mode === 'ajouter' ? [...new Set([...avant.client_ids, ...clientsValides])]
    : (req.body.client_ids !== undefined ? clientsDemandes.filter(d => clientsValides.includes(d)) : avant.client_ids);
  const now = new Date().toISOString();
  const row = await db.query(
    `INSERT INTO sessions_appel (id, commercial_id, jour, prospect_ids, client_ids, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT (commercial_id, jour) DO UPDATE SET prospect_ids = EXCLUDED.prospect_ids, client_ids = EXCLUDED.client_ids, updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [`session-${req.user.id}-${jour}`, req.user.id, jour, JSON.stringify(prospects), JSON.stringify(clients), now]
  );
  res.json({
    ok: true,
    session: parseSessionAppel(row.rows[0]),
    ajoutes: (prospects.length - avant.prospect_ids.length) + (clients.length - avant.client_ids.length),
    sans_telephone: (prospectsDemandes.length - prospectsValides.length) + (clientsDemandes.length - clientsValides.length),
  });
}));

router.delete('/sessions-appel/jour', authMiddleware, asyncHandler(async (req, res) => {
  const jour = jourValide(req.query.jour);
  await db.query('DELETE FROM sessions_appel WHERE commercial_id = $1 AND jour = $2', [req.user.id, jour]);
  res.json({ ok: true });
}));

router.delete('/sessions-appel/jour/:prospectId', authMiddleware, asyncHandler(async (req, res) => {
  const jour = jourValide(req.query.jour);
  const existante = await db.query('SELECT * FROM sessions_appel WHERE commercial_id = $1 AND jour = $2', [req.user.id, jour]);
  if (!existante.rows[0]) return res.json({ ok: true, session: null });
  // L'identifiant peut être un prospect ou un client : on le retire de la liste où il est.
  const session = parseSessionAppel(existante.rows[0]);
  const prospects = session.prospect_ids.filter(id => id !== req.params.prospectId);
  const clients = session.client_ids.filter(id => id !== req.params.prospectId);
  const row = await db.query('UPDATE sessions_appel SET prospect_ids = $1, client_ids = $2, updated_at = $3 WHERE id = $4 RETURNING *', [JSON.stringify(prospects), JSON.stringify(clients), new Date().toISOString(), existante.rows[0].id]);
  res.json({ ok: true, session: parseSessionAppel(row.rows[0]) });
}));

// Move prospect to a different pipeline stage (partial update)
router.patch('/prospects/:id/stage', authMiddleware, asyncHandler(async (req, res) => {
  const { etape_pipeline, raison_perte } = req.body;
  if (!etape_pipeline) return validationError(res, ['etape_pipeline est requis']);
  const change = await changerEtape(req.params.id, etape_pipeline, req.user.id, { raison: raison_perte || '' });
  const p = await db.query('SELECT etape_pipeline, date_etape, raison_perte, date_modification FROM prospects WHERE id = $1', [req.params.id]);
  if (p.rows.length === 0) return res.status(404).json({ error: 'Prospect introuvable' });
  res.json({ ok: true, change, ...p.rows[0] });
}));

// « Que s'est-il passé ? » : on termine une action en disant son issue ; le serveur clôt le
// rappel, déplace l'étape, crée la prochaine action, et renvoie tout ce qui a changé.
router.post('/prospects/:id/action', authMiddleware, asyncHandler(async (req, res) => {
  const { rappel_id, type, issue, raison_perte, note } = req.body;
  if (!issue) return validationError(res, ['issue est requise']);
  const r = await terminerAction(req.params.id, { rappelId: rappel_id, type, issue, raison: raison_perte || '', note: note || '', commercialId: req.user.id }, req.user.id);
  if (!r) return res.status(404).json({ error: 'Prospect introuvable' });
  if (r.erreur) return validationError(res, [r.erreur]);
  res.json({ ok: true, prospect: parseProspect(r.prospect), rappel: r.rappel, prochaine: r.prochaine, etape: r.etape });
}));

// Historique des étapes d'un prospect, pour la frise de sa fiche.
router.get('/prospects/:id/etapes', authMiddleware, asyncHandler(async (req, res) => {
  const r = await db.query('SELECT * FROM prospect_etapes WHERE prospect_id = $1 ORDER BY date DESC', [req.params.id]);
  res.json(r.rows);
}));

// Bulk import (with RLS)
router.post('/prospects/import', authMiddleware, asyncHandler(async (req, res) => {
  const prospects = req.body;
  if (!prospects || prospects.length === 0) return res.json({ ok: true, count: 0 });

  // Force commercial_id for non-admins
  const forcedCommercialId = isAdmin(req) ? null : req.user.id;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const CHUNK_SIZE = 50;
    const COLS = 24;
    for (let i = 0; i < prospects.length; i += CHUNK_SIZE) {
      const chunk = prospects.slice(i, i + CHUNK_SIZE);
      const values = [];
      const params = [];
      chunk.forEach((p, idx) => {
        const offset = idx * COLS;
        values.push(`(${Array.from({ length: COLS }, (_, j) => `$${offset + j + 1}`).join(',')})`);
        params.push(
          p.id, p.nom_etablissement, p.type_etablissement, p.nom_contact || '', p.telephone || '', p.email || '',
          p.adresse || '', p.ville || '', p.code_postal || '', p.departement || '', p.secteur || '',
          p.latitude || 0, p.longitude || 0, p.etape_pipeline || 'nouveau', JSON.stringify(p.tags || []),
          forcedCommercialId || p.commercial_id, p.notes || '', p.date_creation, p.date_modification, p.score || 50,
          p.raison_sociale || '', p.siren || '', p.siret || '', p.tva_intracom || ''
        );
      });
      await client.query(
        `INSERT INTO prospects (id, nom_etablissement, type_etablissement, nom_contact, telephone, email, adresse, ville, code_postal, departement, secteur, latitude, longitude, etape_pipeline, tags, commercial_id, notes, date_creation, date_modification, score, raison_sociale, siren, siret, tva_intracom)
        VALUES ${values.join(',')}
        ON CONFLICT (id) DO UPDATE SET
          nom_etablissement=EXCLUDED.nom_etablissement, type_etablissement=EXCLUDED.type_etablissement,
          nom_contact=EXCLUDED.nom_contact, telephone=EXCLUDED.telephone, email=EXCLUDED.email,
          adresse=EXCLUDED.adresse, ville=EXCLUDED.ville, code_postal=EXCLUDED.code_postal,
          departement=EXCLUDED.departement, secteur=EXCLUDED.secteur, latitude=EXCLUDED.latitude,
          longitude=EXCLUDED.longitude, etape_pipeline=EXCLUDED.etape_pipeline, tags=EXCLUDED.tags,
          commercial_id=EXCLUDED.commercial_id, notes=EXCLUDED.notes, date_creation=EXCLUDED.date_creation,
          date_modification=EXCLUDED.date_modification, score=EXCLUDED.score,
          raison_sociale=EXCLUDED.raison_sociale, siren=EXCLUDED.siren, siret=EXCLUDED.siret,
          tva_intracom=EXCLUDED.tva_intracom`,
        params
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await rattacherTout();
  res.json({ ok: true, count: prospects.length });
}));

export default router;
