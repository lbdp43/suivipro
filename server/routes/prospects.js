// Prospects, fiches partagées, sessions d'appel — routes déplacées telles quelles depuis routes.js.
import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.js';
import { ficheDepuisPartage } from '../partage.js';
import { asyncHandler, authMiddleware, isAdmin } from '../lib/auth.js';
import { dateLocale } from '../../shared/regles.js';
import { logActivity } from '../lib/journal.js';
import { rattacherEntite, rattacherTout } from '../lib/zones.js';
import { changerEtape, terminerAction } from '../lib/tunnel.js';
import { sansAccents } from '../../shared/normalisation.js';
import { preparerFiche, comparerFiches } from '../../shared/rapprochement.js';
import { parseProspect, parseSessionAppel } from '../lib/parse.js';
import { scoreProspect } from '../lib/scores.js';
import { validateProspect, validationError } from '../lib/validation.js';

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
    `INSERT INTO prospects (id, nom_etablissement, type_etablissement, nom_contact, telephone, email, adresse, ville, code_postal, departement, secteur, latitude, longitude, etape_pipeline, tags, commercial_id, notes, date_creation, date_modification, score)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [p.id, p.nom_etablissement, p.type_etablissement, p.nom_contact || '', p.telephone || '', p.email || '', p.adresse || '', p.ville || '', p.code_postal || '', p.departement || '', p.secteur || '', p.latitude || 0, p.longitude || 0, p.etape_pipeline || 'nouveau', JSON.stringify(p.tags || []), commercialId, p.notes || '', p.date_creation, p.date_modification, scoreCreation]
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
    `UPDATE prospects SET nom_etablissement=$1, type_etablissement=$2, nom_contact=$3, telephone=$4, email=$5, adresse=$6, ville=$7, code_postal=$8, departement=$9, secteur=$10, latitude=$11, longitude=$12, tags=$13, commercial_id=$14, notes=$15, date_modification=$16, score=$17 WHERE id=$18`,
    [p.nom_etablissement, p.type_etablissement, p.nom_contact || '', p.telephone || '', p.email || '', p.adresse || '', p.ville || '', p.code_postal || '', p.departement || '', p.secteur || '', p.latitude || 0, p.longitude || 0, JSON.stringify(p.tags || []), p.commercial_id || req.user.id, p.notes || '', p.date_modification, scoreMaj, req.params.id]
  );
  if (p.etape_pipeline) await changerEtape(req.params.id, p.etape_pipeline, req.user.id, { raison: p.raison_perte || '' });
  await rattacherEntite('prospects', req.params.id);
  await logActivity(req.user.id, 'modification_prospect', `${p.nom_etablissement} → ${p.etape_pipeline}`, 'prospect', req.params.id);
  res.json({ ok: true });
}));

router.delete('/prospects/:id', authMiddleware, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM prospects WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// Corps : { texte, forcer }. `texte` est le message WhatsApp tel quel (nom, adresse, lien)
// ou le lien seul. Sans `forcer`, un doublon probable bloque la création et est renvoyé
// pour que la personne choisisse : ouvrir l'existant, ou créer quand même.
// Fiches existantes qui ressemblent à la fiche partagée : même règle que partout
// (rapprochement partagé), avec une tolérance sur « un nom contient l'autre » dans la même commune.
async function doublonsDeFiche(fiche) {
  const partagee = preparerFiche({ nom: fiche.nom_etablissement, telephone: fiche.telephone, ville: fiche.ville });
  const [p, c] = await Promise.all([
    db.query('SELECT id, nom_etablissement AS nom, ville, telephone, etape_pipeline FROM prospects'),
    db.query('SELECT id, nom, ville, telephone FROM clients'),
  ]);
  const ressemble = (r) => {
    const cmp = comparerFiches(partagee, r);
    if (!cmp) return false;
    if (cmp.score >= 80) return true;
    if (cmp.score === 60) { const v = sansAccents(r.ville); return !partagee._ville || !v || v === partagee._ville; }
    return false;
  };
  const out = [];
  for (const r of p.rows) if (ressemble(r)) out.push({ genre: 'prospect', id: r.id, nom: r.nom, ville: r.ville || '', etape: r.etape_pipeline });
  for (const r of c.rows) if (ressemble(r)) out.push({ genre: 'client', id: r.id, nom: r.nom, ville: r.ville || '' });
  return out.slice(0, 6);
}

router.post('/prospects/partage', authMiddleware, asyncHandler(async (req, res) => {
  const texte = String(req.body.texte || '').trim().slice(0, 4000);
  if (!texte) return validationError(res, ['Collez le message WhatsApp ou le lien Google Maps']);
  const { fiche, sources } = await ficheDepuisPartage(texte);
  // Lien seul et fiche Google illisible : on crée quand même, avec le lien, et la personne renomme.
  const sansNom = !fiche.nom_etablissement;
  if (sansNom) {
    if (!fiche.source_url) return res.status(422).json({ error: "Rien à lire : collez le lien Google de l'établissement, ou son nom sur la première ligne." });
    fiche.nom_etablissement = 'Établissement partagé (à renommer)';
    sources.push('nom : inconnu, à renommer');
  }
  const doublons = sansNom ? [] : await doublonsDeFiche(fiche);
  if (doublons.length > 0 && !req.body.forcer) return res.json({ ok: false, doublons, fiche, sources });

  const now = new Date().toISOString();
  const id = `prospect-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const auteur = await db.query('SELECT prenom, nom FROM commerciaux WHERE id = $1', [req.user.id]);
  const qui = auteur.rows[0] ? `${auteur.rows[0].prenom} ${auteur.rows[0].nom}`.trim() : req.user.id;
  const notes = [`Fiche partagée par ${qui} le ${dateLocale(new Date())}.`, fiche.categorie_google ? `Catégorie Google : ${fiche.categorie_google}.` : '']
    .filter(Boolean).join('\n');
  await db.query(
    `INSERT INTO prospects (id, nom_etablissement, type_etablissement, nom_contact, telephone, email, adresse, ville, code_postal, departement, secteur, latitude, longitude, etape_pipeline, tags, commercial_id, notes, date_creation, date_modification, score, source_url)
     VALUES ($1,$2,$3,'',$4,'',$5,$6,$7,$8,'',$9,$10,'partage','[]',$11,$12,$13,$13,$14,$15)`,
    [id, fiche.nom_etablissement.slice(0, 200), fiche.type_etablissement, fiche.telephone || '', fiche.adresse || '', fiche.ville || '', fiche.code_postal || '', fiche.departement || '',
      fiche.latitude || 0, fiche.longitude || 0, req.user.id, notes, now, await scoreProspect([], 50), fiche.source_url || '']
  );
  await rattacherEntite('prospects', id);
  await logActivity(req.user.id, 'creation_prospect', `${fiche.nom_etablissement} (fiche partagée)`, 'prospect', id);
  const cree = await db.query('SELECT * FROM prospects WHERE id = $1', [id]);
  res.json({ ok: true, prospect: parseProspect(cree.rows[0]), sources, doublons, provenance: fiche.provenance });
}));

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
    const COLS = 20;
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
          forcedCommercialId || p.commercial_id, p.notes || '', p.date_creation, p.date_modification, p.score || 50
        );
      });
      await client.query(
        `INSERT INTO prospects (id, nom_etablissement, type_etablissement, nom_contact, telephone, email, adresse, ville, code_postal, departement, secteur, latitude, longitude, etape_pipeline, tags, commercial_id, notes, date_creation, date_modification, score)
        VALUES ${values.join(',')}
        ON CONFLICT (id) DO UPDATE SET
          nom_etablissement=EXCLUDED.nom_etablissement, type_etablissement=EXCLUDED.type_etablissement,
          nom_contact=EXCLUDED.nom_contact, telephone=EXCLUDED.telephone, email=EXCLUDED.email,
          adresse=EXCLUDED.adresse, ville=EXCLUDED.ville, code_postal=EXCLUDED.code_postal,
          departement=EXCLUDED.departement, secteur=EXCLUDED.secteur, latitude=EXCLUDED.latitude,
          longitude=EXCLUDED.longitude, etape_pipeline=EXCLUDED.etape_pipeline, tags=EXCLUDED.tags,
          commercial_id=EXCLUDED.commercial_id, notes=EXCLUDED.notes, date_creation=EXCLUDED.date_creation,
          date_modification=EXCLUDED.date_modification, score=EXCLUDED.score`,
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
