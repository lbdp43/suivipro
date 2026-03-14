import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createWorker } from 'tesseract.js';
import db from './db.js';
import { encrypt, decrypt } from './crypto.js';
import hubBridgeRouter from './hub-bridge.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required. Set it before starting the server.');
  process.exit(1);
}

// ============================================
// Middlewares
// ============================================

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acces reserve aux administrateurs' });
  }
  next();
}

function isAdmin(req) {
  return req.user.role === 'admin';
}

// Wrap async route handlers to catch unhandled errors
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ============================================
// Input validation helpers
// ============================================

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s+().-]{0,30}$/;

function validateProspect(body) {
  const errors = [];
  if (!body.nom_etablissement || typeof body.nom_etablissement !== 'string' || body.nom_etablissement.trim().length === 0) {
    errors.push('nom_etablissement est requis');
  }
  if (body.email && !EMAIL_RE.test(body.email)) {
    errors.push('Format email invalide');
  }
  if (body.telephone && !PHONE_RE.test(body.telephone)) {
    errors.push('Format telephone invalide');
  }
  if (body.score !== undefined && body.score !== null) {
    const score = Number(body.score);
    if (isNaN(score) || score < 0 || score > 100) {
      errors.push('Le score doit etre entre 0 et 100');
    }
  }
  return errors;
}

function validateCall(body) {
  const errors = [];
  if (!body.prospect_id) errors.push('prospect_id est requis');
  if (!body.commercial_id) errors.push('commercial_id est requis');
  if (!body.date) errors.push('date est requise');
  if (!body.resultat) errors.push('resultat est requis');
  return errors;
}

function validateAppointment(body) {
  const errors = [];
  if (!body.prospect_id) errors.push('prospect_id est requis');
  if (!body.commercial_id) errors.push('commercial_id est requis');
  if (!body.date) errors.push('date est requise');
  return errors;
}

function validateReminder(body) {
  const errors = [];
  if (!body.prospect_id) errors.push('prospect_id est requis');
  if (!body.commercial_id) errors.push('commercial_id est requis');
  if (!body.date) errors.push('date est requise');
  return errors;
}

function validationError(res, errors) {
  return res.status(400).json({ error: errors.join(', ') });
}

// ============================================
// Helper: parse JSON fields
// ============================================

function parseProspect(p) {
  if (!p) return p;
  let tags = p.tags;
  if (typeof tags === 'string') {
    try { tags = JSON.parse(tags); } catch { tags = []; }
  }
  if (!Array.isArray(tags)) tags = [];
  return { ...p, tags };
}

function parseCommercial(c) {
  if (!c) return c;
  const { password: _, ...u } = c;
  return { ...u, objectifs: JSON.parse(u.objectifs || '{}') };
}

// ============================================
// Auth routes
// ============================================

router.post('/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  const result = await db.query('SELECT * FROM commerciaux WHERE email = $1', [email]);
  const user = result.rows[0];
  if (!user) return res.status(401).json({ error: 'Identifiants incorrects' });

  // bcrypt only — no plaintext fallback
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Identifiants incorrects' });

  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  const { password: _, ...userWithoutPwd } = user;
  userWithoutPwd.objectifs = JSON.parse(userWithoutPwd.objectifs || '{}');
  res.json({ token, user: userWithoutPwd });
}));

router.get('/auth/me', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM commerciaux WHERE id = $1', [req.user.id]);
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: 'Utilisateur non trouve' });
  const { password: _, ...u } = user;
  u.objectifs = JSON.parse(u.objectifs || '{}');
  res.json(u);
}));

// ============================================
// Full state load (with RLS filtering)
// ============================================

router.get('/state', authMiddleware, asyncHandler(async (req, res) => {
  // All users see all data
  const [prospects, calls, appointments, reminders, commerciaux, tags, emailTemplates, pipelineColumns, documents, clients, interactions, tasksClient, tourneeConfigs] = await Promise.all([
    db.query('SELECT * FROM prospects'),
    db.query('SELECT * FROM calls'),
    db.query('SELECT * FROM appointments'),
    db.query('SELECT * FROM reminders'),
    db.query('SELECT * FROM commerciaux'),
    db.query('SELECT * FROM tags'),
    db.query('SELECT * FROM email_templates'),
    db.query('SELECT * FROM pipeline_columns ORDER BY sort_order'),
    db.query('SELECT id, nom, categorie, description, nom_fichier, type_mime, taille, uploaded_by, date_creation FROM documents ORDER BY date_creation DESC'),
    db.query('SELECT * FROM clients ORDER BY date_modification DESC'),
    db.query('SELECT * FROM interactions ORDER BY date DESC'),
    db.query('SELECT * FROM tasks_client ORDER BY date_echeance ASC'),
    db.query('SELECT * FROM tournee_config'),
  ]);

  res.json({
    prospects: prospects.rows.map(parseProspect),
    calls: calls.rows,
    appointments: appointments.rows,
    reminders: reminders.rows,
    commerciaux: commerciaux.rows.map(parseCommercial),
    tags: tags.rows,
    emailTemplates: emailTemplates.rows,
    pipelineColumns: pipelineColumns.rows,
    documents: documents.rows,
    clients: clients.rows,
    interactions: interactions.rows,
    tasksClient: tasksClient.rows,
    tourneeConfigs: tourneeConfigs.rows,
  });
}));

// ============================================
// Prospects CRUD (with RLS)
// ============================================

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

  await db.query(
    `INSERT INTO prospects (id, nom_etablissement, type_etablissement, nom_contact, telephone, email, adresse, ville, code_postal, departement, secteur, latitude, longitude, etape_pipeline, tags, commercial_id, notes, date_creation, date_modification, score)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [p.id, p.nom_etablissement, p.type_etablissement, p.nom_contact || '', p.telephone || '', p.email || '', p.adresse || '', p.ville || '', p.code_postal || '', p.departement || '', p.secteur || '', p.latitude || 0, p.longitude || 0, p.etape_pipeline || 'nouveau', JSON.stringify(p.tags || []), commercialId, p.notes || '', p.date_creation, p.date_modification, p.score || 50]
  );
  res.json({ ok: true });
}));

router.put('/prospects/:id', authMiddleware, asyncHandler(async (req, res) => {
  const p = req.body;
  const errors = validateProspect(p);
  if (errors.length > 0) return validationError(res, errors);

  await db.query(
    `UPDATE prospects SET nom_etablissement=$1, type_etablissement=$2, nom_contact=$3, telephone=$4, email=$5, adresse=$6, ville=$7, code_postal=$8, departement=$9, secteur=$10, latitude=$11, longitude=$12, etape_pipeline=$13, tags=$14, commercial_id=$15, notes=$16, date_modification=$17, score=$18 WHERE id=$19`,
    [p.nom_etablissement, p.type_etablissement, p.nom_contact || '', p.telephone || '', p.email || '', p.adresse || '', p.ville || '', p.code_postal || '', p.departement || '', p.secteur || '', p.latitude || 0, p.longitude || 0, p.etape_pipeline, JSON.stringify(p.tags || []), p.commercial_id || req.user.id, p.notes || '', p.date_modification, p.score || 50, req.params.id]
  );
  res.json({ ok: true });
}));

router.delete('/prospects/:id', authMiddleware, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM prospects WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// Move prospect to a different pipeline stage (partial update)
router.patch('/prospects/:id/stage', authMiddleware, asyncHandler(async (req, res) => {
  const { etape_pipeline, date_modification } = req.body;
  if (!etape_pipeline) return validationError(res, ['etape_pipeline est requis']);
  await db.query(
    'UPDATE prospects SET etape_pipeline=$1, date_modification=$2 WHERE id=$3',
    [etape_pipeline, date_modification || new Date().toISOString(), req.params.id]
  );
  res.json({ ok: true });
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
  res.json({ ok: true, count: prospects.length });
}));

// ============================================
// Calls CRUD (with RLS)
// ============================================

router.get('/calls', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM calls');
  res.json(result.rows);
}));

router.post('/calls', authMiddleware, asyncHandler(async (req, res) => {
  const c = req.body;
  const errors = validateCall(c);
  if (errors.length > 0) return validationError(res, errors);

  const commercialId = isAdmin(req) ? (c.commercial_id || req.user.id) : req.user.id;
  await db.query(
    'INSERT INTO calls (id, prospect_id, commercial_id, date, duree, resultat, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [c.id, c.prospect_id, commercialId, c.date, c.duree || 0, c.resultat, c.notes || '']
  );
  res.json({ ok: true });
}));

router.put('/calls/:id', authMiddleware, asyncHandler(async (req, res) => {
  const c = req.body;
  const errors = validateCall(c);
  if (errors.length > 0) return validationError(res, errors);

  await db.query(
    'UPDATE calls SET prospect_id=$1, commercial_id=$2, date=$3, duree=$4, resultat=$5, notes=$6 WHERE id=$7',
    [c.prospect_id, c.commercial_id, c.date, c.duree || 0, c.resultat, c.notes || '', req.params.id]
  );
  res.json({ ok: true });
}));

router.delete('/calls/:id', authMiddleware, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM calls WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ============================================
// Appointments CRUD (with RLS)
// ============================================

router.get('/appointments', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM appointments');
  res.json(result.rows);
}));

router.post('/appointments', authMiddleware, asyncHandler(async (req, res) => {
  const a = req.body;
  const errors = validateAppointment(a);
  if (errors.length > 0) return validationError(res, errors);

  await db.query(
    'INSERT INTO appointments (id, prospect_id, commercial_id, prospecteur_id, date, heure_debut, heure_fin, lieu, notes, statut, compte_rendu, notes_compte_rendu, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
    [a.id, a.prospect_id, a.commercial_id || req.user.id, a.prospecteur_id || null, a.date, a.heure_debut || '', a.heure_fin || '', a.lieu || '', a.notes || '', a.statut || 'planifie', a.compte_rendu || '', a.notes_compte_rendu || '', a.created_at || new Date().toISOString()]
  );
  res.json({ ok: true });
}));

router.put('/appointments/:id', authMiddleware, asyncHandler(async (req, res) => {
  const a = req.body;
  const errors = validateAppointment(a);
  if (errors.length > 0) return validationError(res, errors);

  await db.query(
    'UPDATE appointments SET prospect_id=$1, commercial_id=$2, prospecteur_id=$3, date=$4, heure_debut=$5, heure_fin=$6, lieu=$7, notes=$8, statut=$9, compte_rendu=$10, notes_compte_rendu=$11 WHERE id=$12',
    [a.prospect_id, a.commercial_id, a.prospecteur_id || null, a.date, a.heure_debut || '', a.heure_fin || '', a.lieu || '', a.notes || '', a.statut, a.compte_rendu || '', a.notes_compte_rendu || '', req.params.id]
  );
  res.json({ ok: true });
}));

router.delete('/appointments/:id', authMiddleware, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM appointments WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ============================================
// Reminders CRUD (with RLS)
// ============================================

router.get('/reminders', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM reminders');
  res.json(result.rows);
}));

router.post('/reminders', authMiddleware, asyncHandler(async (req, res) => {
  const r = req.body;
  const errors = validateReminder(r);
  if (errors.length > 0) return validationError(res, errors);

  const commercialId = isAdmin(req) ? (r.commercial_id || req.user.id) : req.user.id;
  await db.query(
    'INSERT INTO reminders (id, prospect_id, commercial_id, date, heure, message, statut) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [r.id, r.prospect_id, commercialId, r.date, r.heure || '', r.message || '', r.statut || 'actif']
  );
  res.json({ ok: true });
}));

router.put('/reminders/:id', authMiddleware, asyncHandler(async (req, res) => {
  const r = req.body;
  const errors = validateReminder(r);
  if (errors.length > 0) return validationError(res, errors);

  await db.query(
    'UPDATE reminders SET prospect_id=$1, commercial_id=$2, date=$3, heure=$4, message=$5, statut=$6 WHERE id=$7',
    [r.prospect_id, r.commercial_id, r.date, r.heure || '', r.message || '', r.statut, req.params.id]
  );
  res.json({ ok: true });
}));

router.delete('/reminders/:id', authMiddleware, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM reminders WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ============================================
// Tags CRUD
// ============================================

router.get('/tags', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM tags');
  res.json(result.rows);
}));

router.post('/tags', authMiddleware, asyncHandler(async (req, res) => {
  const t = req.body;
  if (!t.nom || !t.couleur) return res.status(400).json({ error: 'nom et couleur sont requis' });
  await db.query('INSERT INTO tags (id, nom, couleur) VALUES ($1,$2,$3)', [t.id, t.nom, t.couleur]);
  res.json({ ok: true });
}));

router.put('/tags/:id', authMiddleware, asyncHandler(async (req, res) => {
  const t = req.body;
  if (!t.nom || !t.couleur) return res.status(400).json({ error: 'nom et couleur sont requis' });
  await db.query('UPDATE tags SET nom=$1, couleur=$2 WHERE id=$3', [t.nom, t.couleur, req.params.id]);
  res.json({ ok: true });
}));

router.delete('/tags/:id', authMiddleware, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM tags WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ============================================
// Email templates CRUD
// ============================================

router.get('/email-templates', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM email_templates');
  res.json(result.rows);
}));

router.post('/email-templates', authMiddleware, asyncHandler(async (req, res) => {
  const e = req.body;
  if (!e.nom) return res.status(400).json({ error: 'nom est requis' });
  await db.query(
    'INSERT INTO email_templates (id, nom, sujet, corps, type) VALUES ($1,$2,$3,$4,$5)',
    [e.id, e.nom, e.sujet || '', e.corps || '', e.type || '']
  );
  res.json({ ok: true });
}));

router.put('/email-templates/:id', authMiddleware, asyncHandler(async (req, res) => {
  const e = req.body;
  if (!e.nom) return res.status(400).json({ error: 'nom est requis' });
  await db.query(
    'UPDATE email_templates SET nom=$1, sujet=$2, corps=$3, type=$4 WHERE id=$5',
    [e.nom, e.sujet || '', e.corps || '', e.type || '', req.params.id]
  );
  res.json({ ok: true });
}));

router.delete('/email-templates/:id', authMiddleware, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM email_templates WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ============================================
// Pipeline columns CRUD
// ============================================

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
  for (const item of order) {
    await db.query('UPDATE pipeline_columns SET sort_order=$1 WHERE id=$2', [item.sort_order, item.id]);
  }
  res.json({ ok: true });
}));

// ============================================
// Commerciaux CRUD (admin-restricted for create/delete)
// ============================================

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
    'INSERT INTO commerciaux (id, prenom, nom, email, telephone, role, password, objectifs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [c.id, c.prenom, c.nom, c.email, c.telephone || '', c.role || 'commercial', hashedPwd, JSON.stringify(c.objectifs || {})]
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
    // Prevent role escalation
    delete c.role;
  }

  // Password policy
  if (c.password && c.password.length > 0) {
    if (c.password.length < 8) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caracteres' });
    }
    const hashedPwd = bcrypt.hashSync(c.password, 10);
    await db.query(
      'UPDATE commerciaux SET prenom=$1, nom=$2, email=$3, telephone=$4, role=$5, password=$6, objectifs=$7 WHERE id=$8',
      [c.prenom, c.nom, c.email, c.telephone || '', c.role || 'commercial', hashedPwd, JSON.stringify(c.objectifs || {}), targetId]
    );
  } else {
    await db.query(
      'UPDATE commerciaux SET prenom=$1, nom=$2, email=$3, telephone=$4, role=$5, objectifs=$6 WHERE id=$7',
      [c.prenom, c.nom, c.email, c.telephone || '', c.role || 'commercial', JSON.stringify(c.objectifs || {}), targetId]
    );
  }
  res.json({ ok: true });
}));

router.delete('/commerciaux/:id', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
  }
  await db.query('DELETE FROM commerciaux WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ============================================
// Documents CRUD
// ============================================

router.get('/documents', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT id, nom, categorie, description, nom_fichier, type_mime, taille, uploaded_by, date_creation FROM documents ORDER BY date_creation DESC');
  res.json(result.rows);
}));

router.post('/documents', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { id, nom, categorie, description, nom_fichier, type_mime, taille, contenu } = req.body;
  if (!nom || !nom_fichier || !contenu) {
    return res.status(400).json({ error: 'nom, nom_fichier et contenu sont requis' });
  }
  await db.query(
    `INSERT INTO documents (id, nom, categorie, description, nom_fichier, type_mime, taille, contenu, uploaded_by, date_creation)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, nom, categorie || 'autre', description || '', nom_fichier, type_mime || 'application/octet-stream', taille || 0, contenu, req.user.id, new Date().toISOString()]
  );
  res.json({ ok: true });
}));

router.get('/documents/:id/download', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
  const doc = result.rows[0];
  if (!doc) return res.status(404).json({ error: 'Document non trouve' });

  const buffer = Buffer.from(doc.contenu, 'base64');
  res.setHeader('Content-Type', doc.type_mime);
  res.setHeader('Content-Disposition', `attachment; filename="${doc.nom_fichier}"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}));

router.delete('/documents/:id', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM documents WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ============================================
// OCR - Scan image/PDF pour extraire infos prospect
// ============================================

// Mapping mots-cles → type d'etablissement
const TYPE_KEYWORDS = {
  bar_restaurant: ['restaurant', 'bar', 'brasserie', 'bistro', 'bistrot', 'pizzeria', 'creperie', 'pub', 'taverne', 'snack'],
  cave: ['cave', 'caviste', 'vins', 'spiritueux', 'oenologie', 'vin', 'wine'],
  epicerie: ['epicerie', 'fine', 'traiteur', 'alimentation', 'gourmet', 'delicatessen'],
  supermarche: ['supermarche', 'hypermarche', 'magasin', 'carrefour', 'leclerc', 'auchan', 'lidl', 'intermarche'],
  hotel: ['hotel', 'chambre', 'hotes', 'auberge', 'gite', 'hebergement', 'residence'],
  camping: ['camping', 'camp'],
  distributeur: ['distributeur', 'grossiste', 'distribution'],
  marche: ['marche', 'foire', 'salon'],
  association: ['association', 'club'],
  comite_entreprise: ['comite', 'entreprise', 'cse'],
  collectivite: ['collectivite', 'mairie', 'commune'],
};

function parseProspectFromText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const result = {};

  // Telephone : formats francais
  const phoneRegex = /(?:\+33|0033|0)\s*[1-9](?:[\s.-]*\d{2}){4}/g;
  const phones = text.match(phoneRegex);
  if (phones && phones.length > 0) {
    result.telephone = phones[0].replace(/[\s.-]/g, '').replace(/^(\+33|0033)/, '0');
  }

  // Email
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = text.match(emailRegex);
  if (emails && emails.length > 0) {
    result.email = emails[0].toLowerCase();
  }

  // Code postal + ville
  const cpRegex = /\b(\d{5})\s+([A-ZÀ-Ü][a-zà-ÿ]+(?:[\s-][A-ZÀ-Ü]?[a-zà-ÿ]+)*)/;
  const cpMatch = text.match(cpRegex);
  if (cpMatch) {
    result.code_postal = cpMatch[1];
    result.ville = cpMatch[2].trim();
    result.departement = cpMatch[1].substring(0, 2);
  }

  // Adresse : chercher un pattern "numero + rue" avant le code postal
  const adresseRegex = /(\d+[\s,]*(?:rue|avenue|boulevard|place|chemin|route|impasse|allee|cours|quai|passage|lot|zone|za|zi|rd|rn|av|bd|pl|ch|rte|imp|all)[^,\n]*)/i;
  const adresseMatch = text.match(adresseRegex);
  if (adresseMatch) {
    result.adresse = adresseMatch[1].replace(/,\s*$/, '').trim();
  }

  // Type d'etablissement
  const textLower = text.toLowerCase();
  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    if (keywords.some(kw => textLower.includes(kw))) {
      result.type_etablissement = type;
      break;
    }
  }

  // Nom de l'etablissement : premiere ligne significative (pas un numero, pas une adresse)
  for (const line of lines) {
    const clean = line.trim();
    if (clean.length < 2) continue;
    if (/^\d+$/.test(clean)) continue;
    if (/^[\d+\s()+.-]+$/.test(clean)) continue;  // juste un tel
    if (emailRegex.test(clean)) continue;
    if (/^\d{5}\s/.test(clean)) continue;  // code postal
    if (/^(lun|mar|mer|jeu|ven|sam|dim|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(clean)) continue;
    if (/^(ouvert|ferme|open|closed|horaire)/i.test(clean)) continue;
    if (/^https?:\/\//i.test(clean)) continue;
    if (/^(avis|review|note|etoile|\d+[.,]\d+\s)/i.test(clean)) continue;
    if (/google/i.test(clean)) continue;
    result.nom_etablissement = clean;
    break;
  }

  // Nom du contact : chercher un pattern "prenom nom" dans le texte
  const nomContactRegex = /(?:contact|gerant|responsable|proprietaire|dirigeant|mr|mme|m\.)\s*:?\s*([A-ZÀ-Ü][a-zà-ÿ]+\s+[A-ZÀ-Ü][a-zà-ÿ]+)/i;
  const nomContactMatch = text.match(nomContactRegex);
  if (nomContactMatch) {
    result.nom_contact = nomContactMatch[1].trim();
  }

  return result;
}

router.post('/ocr-prospect', authMiddleware, asyncHandler(async (req, res) => {
  const { image } = req.body; // base64 encoded image
  if (!image) return res.status(400).json({ error: 'Image requise (base64)' });

  try {
    // Decode base64 (strip data:image/...;base64, prefix if present)
    const base64Data = image.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const worker = await createWorker('fra+eng');
    const { data: { text } } = await worker.recognize(buffer);
    await worker.terminate();

    const parsed = parseProspectFromText(text);
    res.json({ text, parsed });
  } catch (err) {
    console.error('OCR error:', err);
    res.status(500).json({ error: 'Erreur OCR: ' + err.message });
  }
}));

// ============================================
// Hub LBDP proxy — per-user credentials
// ============================================

// Per-user Hub token cache: { [userId]: { token, expiry } }
const hubTokenCacheByUser = {};

// Login to Hub with given credentials, return token
async function hubLogin(email, password) {
  const HUB_API_URL = process.env.HUB_API_URL;
  if (!HUB_API_URL) throw new Error('HUB_API_URL non configure');

  const hubRes = await fetch(`${HUB_API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!hubRes.ok) {
    const msg = hubRes.status === 401 ? 'Identifiants Hub incorrects' : `Hub login failed (${hubRes.status})`;
    throw new Error(msg);
  }

  const data = await hubRes.json();
  return data.token;
}

// Get a Hub token for the current user (with cache)
async function getHubTokenForUser(userId) {
  const cached = hubTokenCacheByUser[userId];
  if (cached && Date.now() < cached.expiry - 60_000) {
    return cached.token;
  }

  // Fetch user's Hub credentials from DB
  const result = await db.query('SELECT hub_email, hub_password FROM commerciaux WHERE id = $1', [userId]);
  if (result.rows.length === 0) throw new Error('Utilisateur introuvable');

  const { hub_email, hub_password } = result.rows[0];
  if (!hub_email || !hub_password) {
    throw new Error('HUB_NOT_CONFIGURED');
  }

  const decryptedPassword = decrypt(hub_password);
  const token = await hubLogin(hub_email, decryptedPassword);

  hubTokenCacheByUser[userId] = {
    token,
    expiry: Date.now() + 23 * 60 * 60 * 1000,
  };

  return token;
}

// Get Hub token for the authenticated user
router.get('/hub/token', authMiddleware, async (req, res) => {
  if (!process.env.HUB_API_URL) {
    return res.status(503).json({ error: 'HUB_API_URL non configure' });
  }

  try {
    const token = await getHubTokenForUser(req.user.id);
    res.json({ token });
  } catch (err) {
    if (err.message === 'HUB_NOT_CONFIGURED') {
      return res.status(404).json({ error: 'hub_not_configured', message: 'Identifiants Hub non configures' });
    }
    console.error('Hub token proxy error:', err.message);
    res.status(502).json({ error: err.message || 'Impossible de contacter le Hub' });
  }
});

// Check if user has Hub credentials configured
router.get('/hub/status', authMiddleware, async (req, res) => {
  try {
    const result = await db.query('SELECT hub_email FROM commerciaux WHERE id = $1', [req.user.id]);
    const configured = !!(result.rows[0]?.hub_email);
    res.json({ configured, hub_email: result.rows[0]?.hub_email || '' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Save Hub credentials for the authenticated user
router.post('/hub/credentials', authMiddleware, async (req, res) => {
  const { hub_email, hub_password } = req.body;

  if (!hub_email || !hub_password) {
    return res.status(400).json({ error: 'Email et mot de passe Hub requis' });
  }

  if (!process.env.HUB_API_URL) {
    return res.status(503).json({ error: 'HUB_API_URL non configure' });
  }

  try {
    // Verify credentials work before saving
    await hubLogin(hub_email, hub_password);

    // Encrypt password and save
    const encryptedPassword = encrypt(hub_password);
    await db.query(
      'UPDATE commerciaux SET hub_email = $1, hub_password = $2 WHERE id = $3',
      [hub_email, encryptedPassword, req.user.id]
    );

    // Clear cache to use new credentials
    delete hubTokenCacheByUser[req.user.id];

    res.json({ success: true, message: 'Identifiants Hub enregistres' });
  } catch (err) {
    console.error('Hub credentials save error:', err.message);
    res.status(400).json({ error: err.message || 'Identifiants Hub invalides' });
  }
});

// List Hub channels for the authenticated user
router.get('/hub/channels', authMiddleware, async (req, res) => {
  if (!process.env.HUB_API_URL) {
    return res.status(503).json({ error: 'HUB_API_URL non configure' });
  }

  try {
    const token = await getHubTokenForUser(req.user.id);
    const HUB_API_URL = process.env.HUB_API_URL;

    const hubRes = await fetch(`${HUB_API_URL}/channels`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!hubRes.ok) {
      const text = await hubRes.text();
      console.error('Hub channels error:', hubRes.status, text);
      return res.status(hubRes.status).json({ error: 'Impossible de recuperer les canaux' });
    }

    const data = await hubRes.json();
    // Normalize: accept both array and { channels: [] }
    const channels = Array.isArray(data) ? data : (data.channels || data.data || []);
    res.json({ channels });
  } catch (err) {
    if (err.message === 'HUB_NOT_CONFIGURED') {
      return res.status(404).json({ error: 'hub_not_configured' });
    }
    console.error('Hub channels proxy error:', err.message);
    res.status(502).json({ error: 'Impossible de contacter le Hub' });
  }
});

// ============================================
// Clients (CRM) CRUD
// ============================================

const CLIENT_VISIT_FREQUENCIES = {
  BAR_RESTAURANT_GENERAL: 15,
  BAR_RESTAURANT_2024: 15,
  CAVE_EPICERIE: 30,
  CAVE_EPICERIE_2024: 30,
  SOUCHON: 30,
  SOUCHON_HORS_DROIT: 30,
  CLIENT_SOUCHON: 30,
  GRAND_PUBLIC: null,
  GRAND_PUBLIC_2024: null,
  COMITE_ENTREPRISE: 60,
  DISTRIBUTEUR: 45,
  EXPORT: 90,
  MARIAGE: null,
  PICOLOGIE: 30,
};

function calculateNextVisit(typeClient, customRecurrence, lastVisitStr) {
  const frequency = customRecurrence || CLIENT_VISIT_FREQUENCIES[typeClient];
  if (!frequency) return null;
  const base = lastVisitStr ? new Date(lastVisitStr) : new Date();
  base.setDate(base.getDate() + frequency);
  return base.toISOString().split('T')[0];
}

function validateClient(body) {
  const errors = [];
  if (!body.nom || typeof body.nom !== 'string' || body.nom.trim().length === 0) {
    errors.push('nom est requis');
  }
  if (body.email && !EMAIL_RE.test(body.email)) {
    errors.push('Format email invalide');
  }
  if (body.telephone && !PHONE_RE.test(body.telephone)) {
    errors.push('Format telephone invalide');
  }
  return errors;
}

router.get('/clients', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM clients ORDER BY date_modification DESC');
  res.json(result.rows);
}));

router.post('/clients', authMiddleware, asyncHandler(async (req, res) => {
  const c = req.body;
  const errors = validateClient(c);
  if (errors.length > 0) return validationError(res, errors);

  const commercialId = isAdmin(req) ? (c.commercial_id || req.user.id) : req.user.id;
  const now = new Date().toISOString();
  const nextVisit = c.next_visit || calculateNextVisit(c.type_client, c.custom_recurrence, null);

  await db.query(
    `INSERT INTO clients (id, nom, ville, adresse, code_postal, telephone, telephone_mobile, email, contact,
     type_client, statut, commercial_id, next_visit, last_visit, notes, custom_recurrence,
     latitude, longitude, siret, tournee, prospect_id, date_creation, date_modification)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
    [c.id, c.nom, c.ville || '', c.adresse || '', c.code_postal || '', c.telephone || '',
     c.telephone_mobile || '', c.email || '', c.contact || '', c.type_client || 'BAR_RESTAURANT_GENERAL',
     c.statut || 'ACTIF', commercialId, nextVisit || null, c.last_visit || null,
     c.notes || '', c.custom_recurrence || null, c.latitude || 0, c.longitude || 0,
     c.siret || '', c.tournee || '', c.prospect_id || null, c.date_creation || now, c.date_modification || now]
  );
  res.json({ ok: true });
}));

router.put('/clients/:id', authMiddleware, asyncHandler(async (req, res) => {
  const c = req.body;
  const errors = validateClient(c);
  if (errors.length > 0) return validationError(res, errors);

  const now = new Date().toISOString();
  await db.query(
    `UPDATE clients SET nom=$1, ville=$2, adresse=$3, code_postal=$4, telephone=$5, telephone_mobile=$6,
     email=$7, contact=$8, type_client=$9, statut=$10, commercial_id=$11, next_visit=$12, last_visit=$13,
     notes=$14, custom_recurrence=$15, latitude=$16, longitude=$17, siret=$18, tournee=$19,
     date_modification=$20 WHERE id=$21`,
    [c.nom, c.ville || '', c.adresse || '', c.code_postal || '', c.telephone || '',
     c.telephone_mobile || '', c.email || '', c.contact || '', c.type_client || 'BAR_RESTAURANT_GENERAL',
     c.statut || 'ACTIF', c.commercial_id || req.user.id, c.next_visit || null, c.last_visit || null,
     c.notes || '', c.custom_recurrence || null, c.latitude || 0, c.longitude || 0,
     c.siret || '', c.tournee || '', c.date_modification || now, req.params.id]
  );
  res.json({ ok: true });
}));

router.delete('/clients/:id', authMiddleware, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ============================================
// Interactions (Client visits/calls)
// ============================================

router.get('/interactions', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM interactions ORDER BY date DESC');
  res.json(result.rows);
}));

router.post('/interactions', authMiddleware, asyncHandler(async (req, res) => {
  const i = req.body;
  if (!i.client_id) return validationError(res, ['client_id est requis']);
  if (!i.type) return validationError(res, ['type est requis']);

  const now = new Date().toISOString();
  const commercialId = i.commercial_id || req.user.id;

  await db.query(
    `INSERT INTO interactions (id, client_id, commercial_id, type, date, comment, date_creation)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [i.id, i.client_id, commercialId, i.type, i.date || now, i.comment || '', i.date_creation || now]
  );

  // Update client's last_visit and calculate next_visit
  const clientResult = await db.query('SELECT type_client, custom_recurrence, statut FROM clients WHERE id = $1', [i.client_id]);
  if (clientResult.rows.length > 0) {
    const client = clientResult.rows[0];
    const visitDate = i.date || now;
    let nextVisit = null;
    if (client.statut === 'ACTIF') {
      nextVisit = calculateNextVisit(client.type_client, client.custom_recurrence, visitDate);
    }
    await db.query(
      'UPDATE clients SET last_visit = $1, next_visit = $2, date_modification = $3 WHERE id = $4',
      [visitDate.split('T')[0], nextVisit, now, i.client_id]
    );
  }

  res.json({ ok: true });
}));

router.delete('/interactions/:id', authMiddleware, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM interactions WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ============================================
// Tasks (Client tasks)
// ============================================

router.get('/tasks-client', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM tasks_client ORDER BY date_echeance ASC');
  res.json(result.rows);
}));

router.post('/tasks-client', authMiddleware, asyncHandler(async (req, res) => {
  const t = req.body;
  if (!t.titre) return validationError(res, ['titre est requis']);

  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO tasks_client (id, titre, description, statut, priorite, date_echeance, commercial_id, client_id, date_creation, completed_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [t.id, t.titre, t.description || '', t.statut || 'A_FAIRE', t.priorite || 'MOYENNE',
     t.date_echeance || null, t.commercial_id || req.user.id, t.client_id || null,
     t.date_creation || now, t.completed_at || null]
  );
  res.json({ ok: true });
}));

router.put('/tasks-client/:id', authMiddleware, asyncHandler(async (req, res) => {
  const t = req.body;
  if (!t.titre) return validationError(res, ['titre est requis']);

  await db.query(
    `UPDATE tasks_client SET titre=$1, description=$2, statut=$3, priorite=$4, date_echeance=$5,
     commercial_id=$6, client_id=$7, completed_at=$8 WHERE id=$9`,
    [t.titre, t.description || '', t.statut || 'A_FAIRE', t.priorite || 'MOYENNE',
     t.date_echeance || null, t.commercial_id || null, t.client_id || null,
     t.completed_at || null, req.params.id]
  );
  res.json({ ok: true });
}));

router.delete('/tasks-client/:id', authMiddleware, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM tasks_client WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ============================================
// Tournee Config
// ============================================

router.get('/tournee-config', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM tournee_config');
  res.json(result.rows);
}));

router.get('/tournee-config/:commercialId', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM tournee_config WHERE commercial_id = $1', [req.params.commercialId]);
  if (result.rows.length === 0) {
    return res.json({ commercial_id: req.params.commercialId, config: '{}', notes: '', updated_at: new Date().toISOString() });
  }
  res.json(result.rows[0]);
}));

router.post('/tournee-config/:commercialId', authMiddleware, asyncHandler(async (req, res) => {
  const { config, notes } = req.body;
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO tournee_config (commercial_id, config, notes, updated_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (commercial_id) DO UPDATE SET config = $2, notes = $3, updated_at = $4`,
    [req.params.commercialId, JSON.stringify(config || {}), notes || '', now]
  );
  res.json({ ok: true });
}));

// ============================================
// Convert Prospect to Client
// ============================================

router.post('/convert-prospect-to-client', authMiddleware, asyncHandler(async (req, res) => {
  const { prospect_id, type_client, tournee, custom_recurrence } = req.body;
  if (!prospect_id) return validationError(res, ['prospect_id est requis']);

  const pResult = await db.query('SELECT * FROM prospects WHERE id = $1', [prospect_id]);
  if (pResult.rows.length === 0) return res.status(404).json({ error: 'Prospect non trouve' });

  const p = pResult.rows[0];
  const now = new Date().toISOString();
  const clientType = type_client || 'BAR_RESTAURANT_GENERAL';
  const nextVisit = calculateNextVisit(clientType, custom_recurrence || null, null);
  const clientId = `cli-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  await db.query(
    `INSERT INTO clients (id, nom, ville, adresse, code_postal, telephone, email, contact,
     type_client, statut, commercial_id, next_visit, notes, custom_recurrence,
     latitude, longitude, tournee, prospect_id, date_creation, date_modification)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [clientId, p.nom_etablissement, p.ville || '', p.adresse || '', p.code_postal || '',
     p.telephone || '', p.email || '', p.nom_contact || '', clientType, 'ACTIF',
     p.commercial_id, nextVisit || null, p.notes || '', custom_recurrence || null,
     p.latitude || 0, p.longitude || 0, tournee || '', prospect_id, now, now]
  );

  // Move prospect to client_gagne stage
  await db.query(
    'UPDATE prospects SET etape_pipeline = $1, date_modification = $2 WHERE id = $3',
    ['client_gagne', now, prospect_id]
  );

  res.json({ ok: true, client_id: clientId });
}));

// ============================================
// EasyBeer Integration
// ============================================

// Webhook endpoint (no auth, uses secret header)
// EasyBeer sends the webhook secret as URL path param: /webhook/easybeer/{secret}
// Also support header-based secret and no-secret path
router.post('/webhook/easybeer/:secret?', asyncHandler(async (req, res) => {
  const webhookSecret = req.params.secret || req.headers['x-webhook-secret'];

  // Check secret from config
  const configResult = await db.query('SELECT * FROM easybeer_config WHERE id = 1');
  const config = configResult.rows[0];
  if (config?.webhook_secret && webhookSecret !== config.webhook_secret) {
    return res.status(403).json({ error: 'Invalid webhook secret' });
  }

  const { type, id } = req.body;
  const now = new Date().toISOString();

  // Log webhook
  await db.query(
    'INSERT INTO webhooks (source, type, external_id, payload, received_at) VALUES ($1,$2,$3,$4,$5)',
    ['easybeer', type || '', String(id || ''), JSON.stringify(req.body), now]
  );

  // Keep only last 100 webhooks
  await db.query(`DELETE FROM webhooks WHERE id NOT IN (SELECT id FROM webhooks ORDER BY received_at DESC LIMIT 100)`);

  // Handle EasyBeer event types: CLIENT_CREATION, client.created, etc.
  const isClientCreation = type === 'CLIENT_CREATION' || type === 'client.created' || type === 'CLIENT_CREATED';
  if (isClientCreation && id && config?.username && config?.api_url) {
    // Background fetch with retry
    setTimeout(async () => {
      const delays = [0, 15000, 30000, 30000, 30000];
      let fetched = false;
      for (let attempt = 0; attempt < delays.length && !fetched; attempt++) {
        if (delays[attempt] > 0) await new Promise(r => setTimeout(r, delays[attempt]));
        try {
          const authHeader = 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');
          const apiBase = (config.api_url || 'https://api.easybeer.fr').replace(/\/$/, '');
          // Try /tiers/:id first (EasyBeer uses "tiers" for clients), fallback to /clients/:id
          let resp = await fetch(`${apiBase}/tiers/${id}`, {
            headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          });
          if (!resp.ok) {
            resp = await fetch(`${apiBase}/clients/${id}`, {
              headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
            });
          }
          if (resp.ok) {
            const data = await resp.json();
            const clientName = data.nom || data.libelle || data.raisonSociale || '';
            const clientNow = new Date().toISOString();
            await db.query(
              `INSERT INTO easybeer_clients (easybeer_id, name, type, contact_name, phone, email, city, address, postal_code, notes, commercial_email, raw_data, status, synced_at, updated_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
              ON CONFLICT (easybeer_id) DO UPDATE SET name=$2, type=$3, contact_name=$4, phone=$5, email=$6, city=$7, address=$8, postal_code=$9, notes=$10, commercial_email=$11, raw_data=$12, updated_at=$15`,
              [id, clientName, data.type || '', data.contact || '', data.phone || data.mobile || '', data.email || '',
               data.ville || '', data.rue || data.adresse || '', data.codePostal || data.cp || '', data.notes || '',
               data.commercialEmail || '', JSON.stringify(data), 'pending', clientNow, clientNow]
            );

            // Auto-import if assignment rule exists
            const commercialEmail = data.commercialEmail || '';
            if (commercialEmail) {
              const ruleResult = await db.query('SELECT * FROM assignment_rules WHERE email = $1', [commercialEmail.toLowerCase()]);
              if (ruleResult.rows.length > 0) {
                const rule = ruleResult.rows[0];
                const clientType = 'BAR_RESTAURANT_GENERAL';
                const nextVisit = calculateNextVisit(clientType, null, null);
                const clientId = `cli-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                await db.query(
                  `INSERT INTO clients (id, nom, ville, adresse, code_postal, telephone, email, contact,
                   type_client, statut, commercial_id, next_visit, notes, latitude, longitude, date_creation, date_modification)
                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
                  [clientId, clientName, data.ville || '', data.rue || data.adresse || '', data.codePostal || data.cp || '',
                   data.phone || data.mobile || '', data.email || '', data.contact || '', clientType, 'ACTIF',
                   rule.commercial_id, nextVisit || null, data.notes || '', data.latitude || 0, data.longitude || 0, clientNow, clientNow]
                );
                await db.query("UPDATE easybeer_clients SET status = 'imported', imported_client_id = $1 WHERE easybeer_id = $2", [clientId, id]);
              }
            }
            fetched = true;
          }
        } catch (err) {
          console.error(`EasyBeer fetch attempt ${attempt + 1} failed:`, err.message);
        }
      }
    }, 10000); // Initial 10s delay
  }

  res.json({ ok: true });
}));

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
  await db.query(
    `INSERT INTO easybeer_config (id, username, password, api_url, webhook_secret, updated_at)
    VALUES (1, $1, $2, $3, $4, $5)
    ON CONFLICT (id) DO UPDATE SET username=$1, password=$2, api_url=$3, webhook_secret=$4, updated_at=$5`,
    [username || '', password || '', api_url || 'https://api.easybeer.fr', webhook_secret || '', now]
  );
  res.json({ ok: true });
}));

router.post('/easybeer/test-connection', authMiddleware, asyncHandler(async (req, res) => {
  const { username, password, api_url } = req.body;
  const baseUrl = (api_url || 'https://api.easybeer.fr').replace(/\/$/, '');
  const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const headers = { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' };

  // Try several common EasyBeer endpoint paths
  const pathsToTry = ['/tiers', '/clients', '/api/tiers', '/api/clients', '/v1/clients', '/'];

  for (const path of pathsToTry) {
    try {
      const resp = await fetch(`${baseUrl}${path}`, { headers, signal: AbortSignal.timeout(8000) });
      if (resp.status === 200 || resp.status === 206) {
        return res.json({ ok: true, message: `Connexion reussie (${path})` });
      }
      if (resp.status === 401 || resp.status === 403) {
        return res.json({ ok: false, message: `Serveur accessible mais identifiants refuses (${resp.status})` });
      }
      // 404 on this path → try next
    } catch {
      // network error on this path → try next
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

// Pending clients from EasyBeer
router.get('/easybeer/pending-clients', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query("SELECT * FROM easybeer_clients WHERE status = 'pending' ORDER BY synced_at DESC");
  res.json(result.rows);
}));

router.post('/easybeer/pending-clients/:id/import', authMiddleware, asyncHandler(async (req, res) => {
  const ebClient = await db.query('SELECT * FROM easybeer_clients WHERE id = $1', [req.params.id]);
  if (ebClient.rows.length === 0) return res.status(404).json({ error: 'Client EasyBeer non trouve' });

  const eb = ebClient.rows[0];
  const { commercial_id, type_client, tournee } = req.body;
  const now = new Date().toISOString();
  const clientType = type_client || 'BAR_RESTAURANT_GENERAL';
  const nextVisit = calculateNextVisit(clientType, null, null);
  const clientId = `cli-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  await db.query(
    `INSERT INTO clients (id, nom, ville, adresse, code_postal, telephone, email, contact,
     type_client, statut, commercial_id, next_visit, notes, tournee, date_creation, date_modification)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [clientId, eb.name, eb.city || '', eb.address || '', eb.postal_code || '',
     eb.phone || '', eb.email || '', eb.contact_name || '', clientType, 'ACTIF',
     commercial_id || req.user.id, nextVisit || null, eb.notes || '', tournee || '', now, now]
  );

  await db.query("UPDATE easybeer_clients SET status = 'imported', imported_client_id = $1 WHERE id = $2", [clientId, req.params.id]);
  res.json({ ok: true, client_id: clientId });
}));

router.delete('/easybeer/pending-clients/:id', authMiddleware, asyncHandler(async (req, res) => {
  await db.query("UPDATE easybeer_clients SET status = 'dismissed' WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));

// Assignment rules
router.get('/assignment-rules', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM assignment_rules ORDER BY created_at');
  res.json(result.rows);
}));

router.post('/assignment-rules', authMiddleware, asyncHandler(async (req, res) => {
  const { email, commercial_id } = req.body;
  if (!email || !commercial_id) return res.status(400).json({ error: 'Email et commercial requis' });
  const id = `rule-${Date.now()}`;
  const now = new Date().toISOString();
  await db.query(
    'INSERT INTO assignment_rules (id, email, commercial_id, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING',
    [id, email.toLowerCase(), commercial_id, now]
  );
  res.json({ ok: true, id });
}));

router.delete('/assignment-rules/:id', authMiddleware, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM assignment_rules WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// Webhooks history
router.get('/webhooks', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM webhooks ORDER BY received_at DESC LIMIT 50');
  res.json(result.rows);
}));

// Import clients from Excel (bulk)
router.post('/clients/import', authMiddleware, asyncHandler(async (req, res) => {
  const { clients } = req.body;
  if (!Array.isArray(clients) || clients.length === 0) {
    return res.status(400).json({ error: 'Liste de clients requise' });
  }

  let imported = 0;
  for (const c of clients) {
    const now = new Date().toISOString();
    const clientType = c.type_client || 'BAR_RESTAURANT_GENERAL';
    const nextVisit = calculateNextVisit(clientType, c.custom_recurrence || null, null);
    await db.query(
      `INSERT INTO clients (id, nom, ville, adresse, code_postal, telephone, telephone_mobile, email, contact,
       type_client, statut, commercial_id, next_visit, notes, custom_recurrence, tournee, siret,
       latitude, longitude, date_creation, date_modification)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [c.id, c.nom, c.ville || '', c.adresse || '', c.code_postal || '',
       c.telephone || '', c.telephone_mobile || '', c.email || '', c.contact || '',
       clientType, 'ACTIF', c.commercial_id, nextVisit || null, c.notes || '',
       c.custom_recurrence || null, c.tournee || '', c.siret || '', c.latitude || 0, c.longitude || 0, now, now]
    );
    imported++;
  }
  res.json({ ok: true, imported });
}));

// Mount Hub Bridge (HTTP API for Hub backend → SuiviPro data)
router.use(hubBridgeRouter);

export default router;
