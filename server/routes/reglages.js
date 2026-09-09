// Réglages d'équipe : tags, modèles de mail, pipeline, commerciaux, fréquence de visite — routes déplacées telles quelles depuis routes.js.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { scoreDepuisTags, baremeActif } from '../../shared/score.js';
import { adminOnly, asyncHandler, authMiddleware, isAdmin } from '../lib/auth.js';
import { parseCommercial, parseProspect } from '../lib/parse.js';
import { EMAIL_RE } from '../lib/validation.js';
import { calculateNextVisit } from '../lib/visites.js';
import { archiver, EncoreRattache, Introuvable } from '../lib/corbeille.js';

const router = Router();

router.get('/tags', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM tags');
  res.json(result.rows);
}));

// Score par tags : quand le barème change, on recalcule le score de tous les prospects.
async function recalculerScores() {
  const tags = (await db.query('SELECT id, points FROM tags')).rows;
  if (!baremeActif(tags)) return 0;
  const prospects = (await db.query('SELECT id, tags, score FROM prospects')).rows;
  let modifies = 0;
  for (const p of prospects) {
    const liste = parseProspect(p).tags;
    const score = scoreDepuisTags(liste, tags, p.score);
    if (score !== p.score) {
      await db.query('UPDATE prospects SET score = $1 WHERE id = $2', [score, p.id]);
      modifies++;
    }
  }
  return modifies;
}

/** Score d'un prospect d'après ses tags si le barème est actif, sinon celui fourni. */

router.post('/tags', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const t = req.body;
  if (!t.nom || !t.couleur) return res.status(400).json({ error: 'nom et couleur sont requis' });
  await db.query('INSERT INTO tags (id, nom, couleur, points) VALUES ($1,$2,$3,$4)', [t.id, t.nom, t.couleur, Number(t.points) || 0]);
  const scores_recalcules = await recalculerScores();
  res.json({ ok: true, scores_recalcules });
}));

router.put('/tags/:id', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const t = req.body;
  if (!t.nom || !t.couleur) return res.status(400).json({ error: 'nom et couleur sont requis' });
  await db.query('UPDATE tags SET nom=$1, couleur=$2, points=$3 WHERE id=$4', [t.nom, t.couleur, Number(t.points) || 0, req.params.id]);
  const scores_recalcules = await recalculerScores();
  res.json({ ok: true, scores_recalcules });
}));

router.delete('/tags/:id', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM tags WHERE id = $1', [req.params.id]);
  await recalculerScores();
  res.json({ ok: true });
}));

router.get('/email-templates', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM email_templates');
  res.json(result.rows);
}));

router.post('/email-templates', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const e = req.body;
  if (!e.nom) return res.status(400).json({ error: 'nom est requis' });
  await db.query(
    'INSERT INTO email_templates (id, nom, sujet, corps, type) VALUES ($1,$2,$3,$4,$5)',
    [e.id, e.nom, e.sujet || '', e.corps || '', e.type || '']
  );
  res.json({ ok: true });
}));

router.put('/email-templates/:id', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const e = req.body;
  if (!e.nom) return res.status(400).json({ error: 'nom est requis' });
  await db.query(
    'UPDATE email_templates SET nom=$1, sujet=$2, corps=$3, type=$4 WHERE id=$5',
    [e.nom, e.sujet || '', e.corps || '', e.type || '', req.params.id]
  );
  res.json({ ok: true });
}));

router.delete('/email-templates/:id', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM email_templates WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

router.get('/pipeline-columns', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM pipeline_columns ORDER BY sort_order');
  res.json(result.rows);
}));

router.post('/pipeline-columns', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const c = req.body;
  if (!c.label) return res.status(400).json({ error: 'label est requis' });
  const maxOrder = await db.query('SELECT MAX(sort_order) as m FROM pipeline_columns');
  await db.query(
    'INSERT INTO pipeline_columns (id, label, color, sort_order) VALUES ($1,$2,$3,$4)',
    [c.id, c.label, c.color, (maxOrder.rows[0]?.m || 0) + 1]
  );
  res.json({ ok: true });
}));

router.put('/pipeline-columns/:id', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const c = req.body;
  if (!c.label) return res.status(400).json({ error: 'label est requis' });
  await db.query('UPDATE pipeline_columns SET label=$1, color=$2 WHERE id=$3', [c.label, c.color, req.params.id]);
  res.json({ ok: true });
}));

router.delete('/pipeline-columns/:id', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM pipeline_columns WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

router.put('/pipeline-columns-reorder', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { order } = req.body; // array of { id, sort_order }
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array is required' });

  // Transaction: reorder all columns atomically
  const dbClient = await db.connect();
  try {
    await dbClient.query('BEGIN');
    for (const item of order) {
      await dbClient.query('UPDATE pipeline_columns SET sort_order=$1 WHERE id=$2', [item.sort_order, item.id]);
    }
    await dbClient.query('COMMIT');
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }

  res.json({ ok: true });
}));

router.get('/commerciaux', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM commerciaux');
  res.json(result.rows.map(parseCommercial));
}));

router.post('/commerciaux', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const c = req.body;
  if (!c.password || c.password.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caracteres' });
  }
  if (!c.email || !EMAIL_RE.test(c.email)) {
    return res.status(400).json({ error: 'Email invalide' });
  }
  const hashedPwd = bcrypt.hashSync(c.password, 10);
  await db.query(
    'INSERT INTO commerciaux (id, prenom, nom, email, telephone, role, password, objectifs, prospection) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [c.id, c.prenom, c.nom, c.email, c.telephone || '', c.role || 'commercial', hashedPwd, JSON.stringify(c.objectifs || {}), !!c.prospection]
  );
  res.json({ ok: true });
}));

router.put('/commerciaux/:id', authMiddleware, asyncHandler(async (req, res) => {
  const c = req.body;
  const targetId = req.params.id;

  // Non-admins can only update their own profile, and cannot change role
  if (!isAdmin(req)) {
    if (targetId !== req.user.id) {
      return res.status(403).json({ error: 'Vous ne pouvez modifier que votre propre profil' });
    }
    // Prevent role escalation (la casquette prospection se règle aussi par l'admin)
    delete c.role;
    delete c.prospection;
  }
  // Rôle : celui envoyé par un admin, sinon celui en place (un prospecteur qui change son
  // mot de passe ne doit pas devenir « commercial » par défaut).
  if (!c.role) c.role = (await db.query('SELECT role FROM commerciaux WHERE id = $1', [targetId])).rows[0]?.role || 'commercial';
  // Hors admin, on garde la casquette en place ; un admin envoie la valeur voulue.
  const prospection = isAdmin(req) ? !!c.prospection : (await db.query('SELECT prospection FROM commerciaux WHERE id = $1', [targetId])).rows[0]?.prospection === true;

  // Password policy
  if (c.password && c.password.length > 0) {
    if (c.password.length < 8) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caracteres' });
    }
    const hashedPwd = bcrypt.hashSync(c.password, 10);
    await db.query(
      'UPDATE commerciaux SET prenom=$1, nom=$2, email=$3, telephone=$4, role=$5, password=$6, objectifs=$7, prospection=$9 WHERE id=$8',
      [c.prenom, c.nom, c.email, c.telephone || '', c.role || 'commercial', hashedPwd, JSON.stringify(c.objectifs || {}), targetId, prospection]
    );
  } else {
    await db.query(
      'UPDATE commerciaux SET prenom=$1, nom=$2, email=$3, telephone=$4, role=$5, objectifs=$6, prospection=$8 WHERE id=$7',
      [c.prenom, c.nom, c.email, c.telephone || '', c.role || 'commercial', JSON.stringify(c.objectifs || {}), targetId, prospection]
    );
  }
  res.json({ ok: true });
}));

// Retirer quelqu'un de l'équipe le range dans la corbeille avec son secteur, ses réglages
// de tournée, ses sessions d'appel, son journal, ses notifications, son lien Google Agenda
// et son accès Claude — tout ce que la base emportait jusqu'ici en silence. Et si des
// fiches lui appartiennent encore, on le dit au lieu de laisser passer une erreur de clé
// étrangère : elles doivent d'abord revenir à quelqu'un.
router.delete('/commerciaux/:id', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
  }
  try {
    await archiver('membre', req.params.id, req.user.id);
  } catch (err) {
    if (err instanceof EncoreRattache) return res.status(409).json({ error: err.message });
    if (err instanceof Introuvable) return res.status(404).json({ error: 'Membre introuvable' });
    throw err;
  }
  res.json({ ok: true });
}));

router.get('/visit-frequency-config', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM visit_frequency_config');
  res.json(result.rows);
}));

router.put('/visit-frequency-config', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { frequencies, apply_to_existing } = req.body;
  const now = new Date().toISOString();
  for (const [type, days] of Object.entries(frequencies)) {
    await db.query(
      `INSERT INTO visit_frequency_config (type_client, frequency_days, updated_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (type_client) DO UPDATE SET frequency_days = $2, updated_at = $3`,
      [type, days, now]
    );
  }

  if (apply_to_existing) {
    // Recalculate next_visit for all active clients without custom_recurrence
    const clients = await db.query(
      "SELECT id, type_client, last_visit, custom_recurrence FROM clients WHERE statut = 'ACTIF' AND custom_recurrence IS NULL"
    );
    for (const c of clients.rows) {
      const nextVisit = await calculateNextVisit(c.type_client, null, c.last_visit);
      if (nextVisit) {
        await db.query(
          'UPDATE clients SET next_visit = $1, date_modification = $2 WHERE id = $3',
          [nextVisit, now, c.id]
        );
      }
    }
  }

  res.json({ ok: true });
}));

export default router;
