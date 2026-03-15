import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createWorker } from 'tesseract.js';
import db from './db.js';
import { encrypt, decrypt } from './crypto.js';
import hubBridgeRouter from './hub-bridge.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;

// Helper to log user activity
async function logActivity(userId, action, details = '', entityType = '', entityId = '') {
  try {
    await db.query(
      "INSERT INTO activity_log (user_id, action, details, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)",
      [userId, action, details, entityType, entityId]
    );
  } catch (err) {
    console.error('Activity log error:', err.message);
  }
}

// Geocoding helper using api-adresse.data.gouv.fr
async function geocodeServer(adresse) {
  if (!adresse || adresse.trim().length < 3) return null;
  try {
    const params = new URLSearchParams({ q: adresse, limit: '1' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://api-adresse.data.gouv.fr/search/?${params}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.features && data.features.length > 0) {
      const [lng, lat] = data.features[0].geometry.coordinates;
      return { latitude: lat, longitude: lng };
    }
    return null;
  } catch {
    return null;
  }
}
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
  if (!body.prospect_id && !body.client_id) errors.push('prospect_id ou client_id est requis');
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

  // Log connexion
  await db.query("UPDATE commerciaux SET last_seen = NOW() WHERE id = $1", [user.id]);
  await logActivity(user.id, 'connexion', 'Connexion à l\'application');

  res.json({ token, user: userWithoutPwd });
}));

router.get('/auth/me', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM commerciaux WHERE id = $1', [req.user.id]);
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: 'Utilisateur non trouve' });
  // Update last_seen on each app access
  await db.query("UPDATE commerciaux SET last_seen = NOW() WHERE id = $1", [req.user.id]);
  const { password: _, ...u } = user;
  u.objectifs = JSON.parse(u.objectifs || '{}');
  res.json(u);
}));

// ============================================
// Full state load (with RLS filtering)
// ============================================

router.get('/state', authMiddleware, asyncHandler(async (req, res) => {
  // All users see all data
  const [prospects, calls, appointments, reminders, commerciaux, tags, emailTemplates, pipelineColumns, documents, clients, interactions, tasksClient, tourneeConfigs, commandes] = await Promise.all([
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
    db.query('SELECT * FROM commandes ORDER BY date_commande DESC'),
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
    commandes: commandes.rows.map(c => ({ ...c, lignes: JSON.parse(c.lignes || '[]') })),
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
  logActivity(req.user.id, 'creation_prospect', p.nom_etablissement, 'prospect', p.id);
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
  logActivity(req.user.id, 'modification_prospect', `${p.nom_etablissement} → ${p.etape_pipeline}`, 'prospect', req.params.id);
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
  logActivity(req.user.id, 'appel', `Résultat: ${c.resultat}`, 'call', c.id);
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
    'INSERT INTO appointments (id, prospect_id, commercial_id, prospecteur_id, date, heure_debut, heure_fin, lieu, notes, statut, compte_rendu, notes_compte_rendu, created_at, client_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
    [a.id, a.prospect_id || null, a.commercial_id || req.user.id, a.prospecteur_id || null, a.date, a.heure_debut || '', a.heure_fin || '', a.lieu || '', a.notes || '', a.statut || 'planifie', a.compte_rendu || '', a.notes_compte_rendu || '', a.created_at || new Date().toISOString(), a.client_id || null]
  );
  logActivity(req.user.id, 'creation_rdv', `RDV le ${a.date} à ${a.lieu || 'N/A'}`, 'appointment', a.id);
  res.json({ ok: true });
}));

router.put('/appointments/:id', authMiddleware, asyncHandler(async (req, res) => {
  const a = req.body;
  const errors = validateAppointment(a);
  if (errors.length > 0) return validationError(res, errors);

  await db.query(
    'UPDATE appointments SET prospect_id=$1, commercial_id=$2, prospecteur_id=$3, date=$4, heure_debut=$5, heure_fin=$6, lieu=$7, notes=$8, statut=$9, compte_rendu=$10, notes_compte_rendu=$11, client_id=$13 WHERE id=$12',
    [a.prospect_id || null, a.commercial_id, a.prospecteur_id || null, a.date, a.heure_debut || '', a.heure_fin || '', a.lieu || '', a.notes || '', a.statut, a.compte_rendu || '', a.notes_compte_rendu || '', req.params.id, a.client_id || null]
  );
  if (a.compte_rendu) {
    logActivity(req.user.id, 'compte_rendu_rdv', `Compte rendu: ${a.compte_rendu}`, 'appointment', req.params.id);
  } else {
    logActivity(req.user.id, 'modification_rdv', `RDV le ${a.date}`, 'appointment', req.params.id);
  }
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

async function calculateNextVisit(typeClient, customRecurrence, lastVisitStr) {
  let frequency = customRecurrence;
  if (!frequency) {
    // Check DB config first, then fallback to hardcoded
    try {
      const dbConfig = await db.query('SELECT frequency_days FROM visit_frequency_config WHERE type_client = $1', [typeClient]);
      if (dbConfig.rows.length > 0 && dbConfig.rows[0].frequency_days != null) {
        frequency = dbConfig.rows[0].frequency_days;
      } else {
        frequency = CLIENT_VISIT_FREQUENCIES[typeClient];
      }
    } catch {
      frequency = CLIENT_VISIT_FREQUENCIES[typeClient];
    }
  }
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
  const nextVisit = c.next_visit || await calculateNextVisit(c.type_client, c.custom_recurrence, null);
  const clientId = c.id || `cli-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  await db.query(
    `INSERT INTO clients (id, nom, ville, adresse, code_postal, telephone, telephone_mobile, email, contact,
     type_client, statut, commercial_id, next_visit, last_visit, notes, custom_recurrence,
     latitude, longitude, siret, tournee, prospect_id, date_creation, date_modification)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
    [clientId, c.nom, c.ville || '', c.adresse || '', c.code_postal || '', c.telephone || '',
     c.telephone_mobile || '', c.email || '', c.contact || '', c.type_client || 'BAR_RESTAURANT_GENERAL',
     c.statut || 'ACTIF', commercialId, nextVisit || null, c.last_visit || null,
     c.notes || '', c.custom_recurrence || null, c.latitude || 0, c.longitude || 0,
     c.siret || '', c.tournee || '', c.prospect_id || null, c.date_creation || now, c.date_modification || now]
  );
  const created = await db.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  logActivity(req.user.id, 'creation_client', c.nom, 'client', clientId);
  res.json(created.rows[0]);
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
      nextVisit = await calculateNextVisit(client.type_client, client.custom_recurrence, visitDate);
    }
    await db.query(
      'UPDATE clients SET last_visit = $1, next_visit = $2, date_modification = $3 WHERE id = $4',
      [visitDate.split('T')[0], nextVisit, now, i.client_id]
    );
  }

  logActivity(req.user.id, 'visite_client', `${i.type}${i.comment ? ': ' + i.comment.substring(0, 100) : ''}`, 'client', i.client_id);
  res.json({ ok: true });
}));

router.delete('/interactions/:id', authMiddleware, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM interactions WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ============================================
// Commandes (linked to clients)
// ============================================

router.get('/commandes', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM commandes ORDER BY date_commande DESC');
  res.json(result.rows.map(c => ({ ...c, lignes: JSON.parse(c.lignes || '[]') })));
}));

router.get('/commandes/client/:clientId', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM commandes WHERE client_id = $1 ORDER BY date_commande DESC', [req.params.clientId]);
  res.json(result.rows.map(c => ({ ...c, lignes: JSON.parse(c.lignes || '[]') })));
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

// Fetch orders from EasyBeer for a specific client and sync them
router.post('/easybeer/sync-commandes/:clientId', authMiddleware, asyncHandler(async (req, res) => {
  const clientId = req.params.clientId;

  // Find client and its easybeer link
  const clientResult = await db.query('SELECT c.*, ec.easybeer_id FROM clients c LEFT JOIN easybeer_clients ec ON ec.imported_client_id = c.id WHERE c.id = $1', [clientId]);
  if (clientResult.rows.length === 0) return res.status(404).json({ error: 'Client non trouve' });

  const client = clientResult.rows[0];
  const ebId = client.easybeer_id;

  if (!ebId) {
    // Try matching by name in easybeer_clients
    const ebMatch = await db.query("SELECT easybeer_id FROM easybeer_clients WHERE status = 'imported' AND imported_client_id = $1", [clientId]);
    if (ebMatch.rows.length === 0) {
      return res.json({ ok: false, message: 'Client non lie a EasyBeer', commandes: [] });
    }
  }

  const finalEbId = ebId || (await db.query("SELECT easybeer_id FROM easybeer_clients WHERE status = 'imported' AND imported_client_id = $1", [clientId])).rows[0]?.easybeer_id;
  if (!finalEbId) return res.json({ ok: false, message: 'Pas de lien EasyBeer', commandes: [] });

  const configResult = await db.query('SELECT * FROM easybeer_config WHERE id = 1');
  const config = configResult.rows[0];
  if (!config?.username || !config?.api_url) {
    return res.json({ ok: false, message: 'Configuration EasyBeer incomplete', commandes: [] });
  }

  const authHeader = 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');
  const apiBase = (config.api_url || 'https://api.easybeer.fr').replace(/\/$/, '');
  const headers = { 'Authorization': authHeader, 'Accept': 'application/json' };

  // Try fetching orders from EasyBeer API
  const orderPaths = [
    `/parametres/client/${finalEbId}/commandes`,
    `/param%C3%A8tres/client/${finalEbId}/commandes`,
    `/commandes/client/${finalEbId}`,
    `/ventes/client/${finalEbId}`,
    `/factures/client/${finalEbId}`,
  ];

  let orders = [];
  let fetchedFrom = '';

  for (const path of orderPaths) {
    try {
      const resp = await fetch(`${apiBase}${path}`, { headers, signal: AbortSignal.timeout(15000) });
      if (resp.ok) {
        let data = await resp.json();
        if (!Array.isArray(data)) {
          data = data.liste || data.results || data.data || data.items || data.commandes || data.factures || [];
        }
        if (Array.isArray(data) && data.length > 0) {
          orders = data;
          fetchedFrom = path;
          break;
        }
      }
    } catch { /* try next */ }
  }

  // Also try the document/facture endpoints
  if (orders.length === 0) {
    for (const docType of ['facture', 'bl', 'commande']) {
      try {
        const resp = await fetch(`${apiBase}/documents/${docType}/client/${finalEbId}`, { headers, signal: AbortSignal.timeout(15000) });
        if (resp.ok) {
          let data = await resp.json();
          if (!Array.isArray(data)) data = data.liste || data.results || data.data || [];
          if (Array.isArray(data) && data.length > 0) {
            orders = data;
            fetchedFrom = `/documents/${docType}/client/${finalEbId}`;
            break;
          }
        }
      } catch { /* try next */ }
    }
  }

  if (orders.length === 0) {
    return res.json({ ok: true, message: 'Aucune commande trouvee sur EasyBeer', commandes: [], tried: orderPaths });
  }

  // Parse and save orders
  const now = new Date().toISOString();
  const imported = [];

  for (const order of orders) {
    const orderId = String(order.id || order.idCommande || order.idFacture || order.numero || '');
    if (!orderId) continue;

    // Check if already imported
    const existing = await db.query('SELECT id FROM commandes WHERE easybeer_id = $1 AND client_id = $2', [orderId, clientId]);
    if (existing.rows.length > 0) continue;

    // Extract order data
    const numero = order.numero || order.reference || order.ref || orderId;
    const dateCmd = order.date || order.dateCommande || order.dateCreation || order.datePiece || '';
    const dateLiv = order.dateLivraison || order.dateExpedition || order.dateBL || '';
    const statut = (order.statut || order.etat || order.status || '').toLowerCase();
    const montantHt = parseFloat(order.montantHT || order.totalHT || order.montant_ht || 0) || 0;
    const montantTtc = parseFloat(order.montantTTC || order.totalTTC || order.montant_ttc || 0) || 0;

    // Extract line items
    let lignes = [];
    const rawLignes = order.lignes || order.details || order.articles || order.items || [];
    if (Array.isArray(rawLignes)) {
      lignes = rawLignes.map(l => ({
        produit: l.libelle || l.designation || l.nom || l.produit || '',
        quantite: parseFloat(l.quantite || l.qte || l.qty || 0) || 0,
        prix_unitaire: parseFloat(l.prixUnitaire || l.pu || l.prix || 0) || 0,
        montant: parseFloat(l.montant || l.total || l.montantHT || 0) || 0,
      }));
    }

    // Determine status
    let finalStatut = 'en_cours';
    if (['livree', 'livré', 'delivered', 'facturee', 'facturée', 'invoiced', 'terminee', 'terminée'].some(s => statut.includes(s))) {
      finalStatut = 'livree';
    } else if (['annulee', 'annulée', 'cancelled', 'canceled'].some(s => statut.includes(s))) {
      finalStatut = 'annulee';
    }

    const cmdId = `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    await db.query(
      `INSERT INTO commandes (id, client_id, easybeer_id, numero, date_commande, date_livraison, statut, montant_ht, montant_ttc, lignes, notes, source, date_creation)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [cmdId, clientId, orderId, numero, dateCmd, dateLiv, finalStatut, montantHt, montantTtc,
       JSON.stringify(lignes), '', 'easybeer', now]
    );
    imported.push({ id: cmdId, numero, statut: finalStatut, montant_ttc: montantTtc });
  }

  console.log(`[EasyBeer] Synced ${imported.length} commandes for client ${clientId} from ${fetchedFrom}`);

  // Return all commandes for this client
  const allCommandes = await db.query('SELECT * FROM commandes WHERE client_id = $1 ORDER BY date_commande DESC', [clientId]);
  res.json({
    ok: true,
    message: `${imported.length} nouvelles commandes importees`,
    commandes: allCommandes.rows.map(c => ({ ...c, lignes: JSON.parse(c.lignes || '[]') })),
    fetched_from: fetchedFrom,
  });
}));

// ============================================
// Tasks (Client tasks)
// ============================================

router.get('/tasks-client', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT t.*, c.nom as client_nom, com.prenom as commercial_prenom, com.nom as commercial_nom,
     cr.prenom as creator_prenom
     FROM tasks_client t
     LEFT JOIN clients c ON t.client_id = c.id
     LEFT JOIN commerciaux com ON t.commercial_id = com.id
     LEFT JOIN commerciaux cr ON t.created_by = cr.id
     ORDER BY
       CASE t.statut WHEN 'A_FAIRE' THEN 0 WHEN 'EN_COURS' THEN 1 ELSE 2 END,
       CASE t.priorite WHEN 'HAUTE' THEN 0 WHEN 'MOYENNE' THEN 1 ELSE 2 END,
       t.date_echeance ASC NULLS LAST`
  );
  res.json(result.rows);
}));

router.post('/tasks-client', authMiddleware, asyncHandler(async (req, res) => {
  const t = req.body;
  if (!t.titre) return validationError(res, ['titre est requis']);

  const now = new Date().toISOString();
  const id = t.id || `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  await db.query(
    `INSERT INTO tasks_client (id, titre, description, statut, priorite, date_echeance, commercial_id, client_id, date_creation, completed_at, categorie, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, t.titre, t.description || '', t.statut || 'A_FAIRE', t.priorite || 'MOYENNE',
     t.date_echeance || null, t.commercial_id || req.user.id, t.client_id || null,
     now, null, t.categorie || 'general', req.user.id]
  );

  // Notify the assigned commercial (if different from creator)
  const assignedId = t.commercial_id || req.user.id;
  if (assignedId !== req.user.id) {
    const creator = await db.query('SELECT prenom FROM commerciaux WHERE id = $1', [req.user.id]);
    const creatorName = creator.rows[0]?.prenom || 'Un administrateur';
    createNotification(assignedId, 'TASK_ASSIGNED', 'Nouvelle tache assignee',
      `${creatorName}: ${t.titre}${t.date_echeance ? ` — Echeance: ${t.date_echeance}` : ''}`,
      { task_id: id, client_id: t.client_id }
    ).catch(() => {});
  }

  // Return the full task with joins
  const result = await db.query(
    `SELECT t.*, c.nom as client_nom, com.prenom as commercial_prenom, com.nom as commercial_nom
     FROM tasks_client t
     LEFT JOIN clients c ON t.client_id = c.id
     LEFT JOIN commerciaux com ON t.commercial_id = com.id
     WHERE t.id = $1`, [id]
  );
  res.json(result.rows[0] || { ok: true });
}));

router.put('/tasks-client/:id', authMiddleware, asyncHandler(async (req, res) => {
  const t = req.body;
  if (!t.titre) return validationError(res, ['titre est requis']);

  // Check if task is being completed
  const oldTask = await db.query('SELECT statut, commercial_id, created_by FROM tasks_client WHERE id = $1', [req.params.id]);
  const wasNotDone = oldTask.rows[0] && oldTask.rows[0].statut !== 'TERMINEE';
  const isNowDone = t.statut === 'TERMINEE';

  const completedAt = isNowDone ? (t.completed_at || new Date().toISOString()) : null;

  await db.query(
    `UPDATE tasks_client SET titre=$1, description=$2, statut=$3, priorite=$4, date_echeance=$5,
     commercial_id=$6, client_id=$7, completed_at=$8, categorie=$9 WHERE id=$10`,
    [t.titre, t.description || '', t.statut || 'A_FAIRE', t.priorite || 'MOYENNE',
     t.date_echeance || null, t.commercial_id || null, t.client_id || null,
     completedAt, t.categorie || 'general', req.params.id]
  );

  // Notify creator when task is completed by assignee
  if (wasNotDone && isNowDone && oldTask.rows[0].created_by && oldTask.rows[0].created_by !== req.user.id) {
    const completer = await db.query('SELECT prenom FROM commerciaux WHERE id = $1', [req.user.id]);
    const completerName = completer.rows[0]?.prenom || 'Un commercial';
    createNotification(oldTask.rows[0].created_by, 'TASK_COMPLETED', 'Tache terminee',
      `${completerName} a termine: ${t.titre}`,
      { task_id: req.params.id }
    ).catch(() => {});
  }

  // Notify new assignee if reassigned
  if (t.commercial_id && oldTask.rows[0] && t.commercial_id !== oldTask.rows[0].commercial_id && t.commercial_id !== req.user.id) {
    const reassigner = await db.query('SELECT prenom FROM commerciaux WHERE id = $1', [req.user.id]);
    const reassignerName = reassigner.rows[0]?.prenom || 'Un administrateur';
    createNotification(t.commercial_id, 'TASK_ASSIGNED', 'Tache reassignee',
      `${reassignerName}: ${t.titre}${t.date_echeance ? ` — Echeance: ${t.date_echeance}` : ''}`,
      { task_id: req.params.id }
    ).catch(() => {});
  }

  const result = await db.query(
    `SELECT t.*, c.nom as client_nom, com.prenom as commercial_prenom, com.nom as commercial_nom
     FROM tasks_client t
     LEFT JOIN clients c ON t.client_id = c.id
     LEFT JOIN commerciaux com ON t.commercial_id = com.id
     WHERE t.id = $1`, [req.params.id]
  );
  res.json(result.rows[0] || { ok: true });
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
  const { config, notes, tournee_info, week_pattern } = req.body;
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO tournee_config (commercial_id, config, notes, tournee_info, week_pattern, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (commercial_id) DO UPDATE SET config = $2, notes = $3, tournee_info = $4, week_pattern = $5, updated_at = $6`,
    [req.params.commercialId, JSON.stringify(config || {}), notes || '', tournee_info || '', week_pattern || 'every', now]
  );
  res.json({ ok: true });
}));

// ============================================
// Visit Frequency Config (admin)
// ============================================

router.get('/visit-frequency-config', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM visit_frequency_config');
  res.json(result.rows);
}));

router.put('/visit-frequency-config', authMiddleware, asyncHandler(async (req, res) => {
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
  const nextVisit = await calculateNextVisit(clientType, custom_recurrence || null, null);
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

// Shared function to extract fields from EasyBeer API data
// Handles nested structures: adresses[], contacts[], GPS, tournee, siret, etc.
function extractEbFieldsSync(data) {
  // ========== ADRESSE ==========
  let adresse = '', ville = '', codePostal = '';
  let adresseObj = null;
  if (data.adresses && Array.isArray(data.adresses) && data.adresses.length > 0) {
    adresseObj = data.adresses.find(a => a.type === 'Facturation' || a.type === 'facturation' || a.principale) || data.adresses[0];
  } else if (data.adresse && typeof data.adresse === 'object') {
    adresseObj = data.adresse;
  } else if (data.adresseFacturation && typeof data.adresseFacturation === 'object') {
    adresseObj = data.adresseFacturation;
  }
  if (adresseObj) {
    if (adresseObj.numero && adresseObj.rue) adresse = `${adresseObj.numero} ${adresseObj.rue}`.trim();
    else if (adresseObj.rue) adresse = adresseObj.rue;
    else {
      const lignes = [
        adresseObj.ligne1 || adresseObj.adresse1 || adresseObj.adresse,
        adresseObj.ligne2 || adresseObj.adresse2 || adresseObj.complement,
        adresseObj.ligne3, adresseObj.ligne4
      ].filter(l => l && String(l).trim());
      adresse = lignes.join(', ');
      if (!adresse && (adresseObj.complete || adresseObj.libelle || adresseObj.adresseComplete)) {
        adresse = adresseObj.complete || adresseObj.libelle || adresseObj.adresseComplete;
      }
    }
    ville = adresseObj.ville || adresseObj.commune || adresseObj.city || '';
    codePostal = adresseObj.codePostal || adresseObj.cp || adresseObj.zipCode || adresseObj.code_postal || '';
  }
  // ========== CONTACTS ==========
  let contactName = '', contactEmail = '', contactTel = '', contactMobile = '';
  let contactObj = null;
  if (data.contacts && Array.isArray(data.contacts) && data.contacts.length > 0) {
    contactObj = data.contacts.find(c => c.type === 'Principal' || c.type === 'principal' || c.principal) || data.contacts[0];
  } else if (data.listeContacts && Array.isArray(data.listeContacts) && data.listeContacts.length > 0) {
    contactObj = data.listeContacts.find(c => c.type === 'Principal' || c.principal) || data.listeContacts[0];
  } else if (data.contactPrincipal && typeof data.contactPrincipal === 'object') {
    contactObj = data.contactPrincipal;
  }
  if (contactObj && typeof contactObj === 'object') {
    contactName = contactObj.denomination || contactObj.libelle || `${contactObj.prenom || ''} ${contactObj.nom || ''}`.trim();
    contactEmail = contactObj.email || contactObj.emailPrincipal || contactObj.mail || '';
    contactTel = contactObj.telephone || contactObj.telephonePrincipal || contactObj.tel || contactObj.phone || '';
    contactMobile = contactObj.mobile || contactObj.portable || contactObj.gsm || contactObj.telephoneMobile || '';
  }
  // ========== TELEPHONE ==========
  const phoneFix = data.telephonePrincipal || data.telephone || contactTel || data.tel || '';
  const phoneMobile = contactMobile || data.mobile || data.portable || '';
  const phone = phoneMobile || phoneFix;
  // ========== GPS ==========
  let latitude = 0, longitude = 0;
  if (adresseObj) {
    if (adresseObj.latitude != null && adresseObj.longitude != null) {
      latitude = parseFloat(adresseObj.latitude) || 0;
      longitude = parseFloat(adresseObj.longitude) || 0;
    } else if (adresseObj.lat != null && adresseObj.lng != null) {
      latitude = parseFloat(adresseObj.lat) || 0;
      longitude = parseFloat(adresseObj.lng) || 0;
    } else if (adresseObj.coordonnees) {
      latitude = parseFloat(adresseObj.coordonnees.latitude || adresseObj.coordonnees.lat) || 0;
      longitude = parseFloat(adresseObj.coordonnees.longitude || adresseObj.coordonnees.lng) || 0;
    }
  }
  if (!latitude && !longitude) {
    if (data.latitude != null && data.longitude != null) {
      latitude = parseFloat(data.latitude) || 0;
      longitude = parseFloat(data.longitude) || 0;
    } else if (data.coordonnees) {
      latitude = parseFloat(data.coordonnees.latitude || data.coordonnees.lat) || 0;
      longitude = parseFloat(data.coordonnees.longitude || data.coordonnees.lng) || 0;
    } else if (data.geoloc) {
      latitude = parseFloat(data.geoloc.latitude || data.geoloc.lat) || 0;
      longitude = parseFloat(data.geoloc.longitude || data.geoloc.lng) || 0;
    }
  }
  // ========== TOURNEE ==========
  let tournee = '';
  if (data.tournee) {
    if (typeof data.tournee === 'string') tournee = data.tournee;
    else tournee = data.tournee.libelle || data.tournee.nom || data.tournee.code || '';
  }
  // ========== TYPE ==========
  let typeStr = data.type || '';
  if (typeof typeStr === 'object' && typeStr) typeStr = typeStr.libelle || typeStr.code || '';

  return {
    name: data.nom || data.libelle || data.raisonSociale || data.name || '',
    type: typeStr,
    contact_name: contactName || data.contact_name || data.contact || '',
    phone,
    phone_mobile: phoneMobile,
    email: data.emailPrincipal || data.email || contactEmail || data.mail || '',
    city: ville || data.ville || data.city || '',
    address: adresse || data.address || '',
    postal_code: codePostal || data.postal_code || data.cp || '',
    notes: data.notes || data.commentaire || data.observation || '',
    commercial_email: data.commercial?.email || data.commercial?.emailPrincipal || data.commercial_email || data.commercialEmail || '',
    siret: data.siret || data.siren || '',
    tournee,
    latitude,
    longitude,
  };
}

// Helper: find matching prospect by name, email, or phone
async function findMatchingProspect(name, email, phone) {
  if (!name && !email && !phone) return null;
  // Try exact email match first
  if (email) {
    const r = await db.query('SELECT * FROM prospects WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
    if (r.rows.length > 0) return r.rows[0];
  }
  // Try phone match (strip spaces/dashes)
  if (phone) {
    const cleanPhone = phone.replace(/[\s\-\.]/g, '');
    const r = await db.query("SELECT * FROM prospects WHERE REPLACE(REPLACE(REPLACE(telephone, ' ', ''), '-', ''), '.', '') = $1 LIMIT 1", [cleanPhone]);
    if (r.rows.length > 0) return r.rows[0];
  }
  // Try exact name match
  if (name) {
    const r = await db.query('SELECT * FROM prospects WHERE LOWER(nom_etablissement) = LOWER($1) LIMIT 1', [name]);
    if (r.rows.length > 0) return r.rows[0];
  }
  return null;
}

// Helper: link a newly created client to a matching prospect
async function linkClientToProspect(clientId, prospect, now) {
  // Update client to reference the prospect
  await db.query('UPDATE clients SET prospect_id = $1 WHERE id = $2', [prospect.id, clientId]);
  // Move prospect to client_gagne
  await db.query(
    'UPDATE prospects SET etape_pipeline = $1, date_modification = $2 WHERE id = $3',
    ['client_gagne', now, prospect.id]
  );
  console.log(`[EasyBeer] Client ${clientId} linked to prospect ${prospect.id} (${prospect.nom_etablissement})`);
}

// Helper: fetch from EasyBeer API with retries and backoff
async function fetchFromEasyBeerWithRetry(apiBase, headers, id, maxRetries = 4) {
  const delays = [5000, 10000, 20000, 40000]; // 5s, 10s, 20s, 40s

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Strategy 1: Direct lookup
    for (const path of [`/parametres/client/detail/${id}`, `/param%C3%A8tres/client/detail/${id}`]) {
      try {
        const resp = await fetch(`${apiBase}${path}`, { headers, signal: AbortSignal.timeout(15000) });
        if (resp.ok) {
          let found = await resp.json();
          if (Array.isArray(found)) found = found.find(d => String(d.id || d.idClient) === String(id)) || found[0];
          if (found && (found.nom || found.libelle || found.raisonSociale || found.name)) {
            console.log(`[EasyBeer] Fetch reussi via ${path} (attempt ${attempt + 1})`);
            return found;
          }
        }
      } catch { /* next */ }
    }

    // Strategy 2: List search
    for (const path of ['/parametres/client/liste', '/param%C3%A8tres/client/liste']) {
      try {
        const resp = await fetch(`${apiBase}${path}`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ colonneTri: 'libelle', mode: 'ASC', nombreParPage: 1000 }),
          signal: AbortSignal.timeout(20000)
        });
        if (resp.ok) {
          let data = await resp.json();
          let list = Array.isArray(data) ? data : (data.liste || data.results || data.data || data.items || []);
          if (Array.isArray(list)) {
            const found = list.find(d => String(d.id || d.idClient) === String(id));
            if (found) {
              console.log(`[EasyBeer] Trouve dans liste ${path} (attempt ${attempt + 1})`);
              return found;
            }
          }
        }
      } catch { /* next */ }
    }

    // Wait before retrying (except on last attempt)
    if (attempt < maxRetries) {
      const delay = delays[attempt] || 40000;
      console.log(`[EasyBeer] Attempt ${attempt + 1} failed for id=${id}, retrying in ${delay / 1000}s...`);
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
  const type = body.type || body.event || body.eventType || body.action || '';
  const id = String(body.id || body.clientId || body.client_id || body.tiersId || body.tiers_id || body.externalId || '');

  console.log(`[EasyBeer Webhook] Recu: type=${type}, id=${id}, body keys=${Object.keys(body).join(',')}`);

  // Log webhook
  await db.query(
    'INSERT INTO webhooks (source, type, external_id, payload, received_at) VALUES ($1,$2,$3,$4,$5)',
    ['easybeer', type, id, JSON.stringify(body), now]
  );

  // Keep only last 100 webhooks
  await db.query(`DELETE FROM webhooks WHERE id NOT IN (SELECT id FROM webhooks ORDER BY received_at DESC LIMIT 100)`);

  // Handle EasyBeer event types
  const typeLower = type.toLowerCase().replace(/[_.-]/g, '');
  const isClientCreation = ['clientcreation', 'clientcreated', 'newclient', 'tiercreation', 'tiercreated', 'newtier'].includes(typeLower)
    || type.includes('CLIENT') || type.includes('client') || type.includes('TIER') || type.includes('tier');
  const isCommande = ['commandefacturation', 'commandecreation', 'facturecreation', 'facturecreated', 'commandecreated',
    'nouvellecommande', 'nouvellefacture', 'blcreation', 'blcreated'].includes(typeLower)
    || type.includes('COMMANDE') || type.includes('FACTUR') || type.includes('commande') || type.includes('factur');

  // ============================================
  // Handle COMMANDE / FACTURATION webhooks
  // ============================================
  if (isCommande && id && config?.username && config?.api_url) {
    setTimeout(async () => {
      try {
        const authHeader = 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');
        const apiBase = (config.api_url || 'https://api.easybeer.fr').replace(/\/$/, '');
        const headers = { 'Authorization': authHeader, 'Accept': 'application/json' };

        console.log(`[EasyBeer Webhook] Traitement commande/facture id=${id}...`);

        // Try to fetch the order/invoice details from EasyBeer
        let orderData = null;
        let fetchedFrom = '';

        // Try various possible endpoints
        const orderPaths = [
          `/ventes/facture/detail/${id}`,
          `/ventes/facture/${id}`,
          `/commandes/detail/${id}`,
          `/commandes/${id}`,
          `/documents/facture/${id}`,
          `/documents/commande/${id}`,
          `/parametres/facture/detail/${id}`,
          `/param%C3%A8tres/facture/detail/${id}`,
          `/ventes/bl/detail/${id}`,
        ];

        for (let attempt = 0; attempt <= 3; attempt++) {
          for (const path of orderPaths) {
            try {
              const resp = await fetch(`${apiBase}${path}`, { headers, signal: AbortSignal.timeout(15000) });
              if (resp.ok) {
                let data = await resp.json();
                if (Array.isArray(data)) data = data[0];
                if (data && (data.id || data.numero || data.reference || data.montantTTC || data.montantHT || data.totalTTC)) {
                  orderData = data;
                  fetchedFrom = path;
                  break;
                }
              }
            } catch { /* next */ }
          }
          if (orderData) break;
          if (attempt < 3) {
            const delay = [5000, 10000, 20000][attempt];
            console.log(`[EasyBeer Webhook] Commande id=${id} attempt ${attempt + 1} echoue, retry dans ${delay / 1000}s...`);
            await new Promise(r => setTimeout(r, delay));
          }
        }

        if (!orderData) {
          console.log(`[EasyBeer Webhook] Impossible de recuperer la commande/facture id=${id}, stockage payload brut`);
          // Store what we have from the webhook payload itself
          orderData = body;
        }

        console.log(`[EasyBeer Webhook] Commande recue: keys=${Object.keys(orderData).join(',')}${fetchedFrom ? ` from ${fetchedFrom}` : ' (payload brut)'}`);

        // Extract order details
        const numero = String(orderData.numero || orderData.reference || orderData.ref || orderData.numPiece || orderData.num_piece || id);
        const dateCmd = orderData.date || orderData.dateCommande || orderData.dateCreation || orderData.datePiece || orderData.date_commande || now;
        const dateLiv = orderData.dateLivraison || orderData.dateExpedition || orderData.dateBL || orderData.date_livraison || '';
        const montantHt = parseFloat(orderData.montantHT || orderData.totalHT || orderData.montant_ht || orderData.ht || 0) || 0;
        const montantTtc = parseFloat(orderData.montantTTC || orderData.totalTTC || orderData.montant_ttc || orderData.ttc || 0) || 0;
        const statutRaw = (orderData.statut || orderData.etat || orderData.status || '').toLowerCase();

        let statut = 'en_cours';
        if (['livree', 'livré', 'delivered', 'facturee', 'facturée', 'invoiced', 'terminee', 'terminée', 'validee', 'validée'].some(s => statutRaw.includes(s))) {
          statut = 'livree';
        } else if (['annulee', 'annulée', 'cancelled', 'canceled'].some(s => statutRaw.includes(s))) {
          statut = 'annulee';
        }

        // Extract line items (produits)
        let lignes = [];
        const rawLignes = orderData.lignes || orderData.details || orderData.articles || orderData.items
          || orderData.lignesFacture || orderData.lignesCommande || orderData.produits || [];
        if (Array.isArray(rawLignes)) {
          lignes = rawLignes.map(l => ({
            produit: l.libelle || l.designation || l.nom || l.produit || l.article || l.description || '',
            quantite: parseFloat(l.quantite || l.qte || l.qty || l.nombre || 0) || 0,
            prix_unitaire: parseFloat(l.prixUnitaire || l.pu || l.prixUnitaireHT || l.prix || l.pv || 0) || 0,
            montant: parseFloat(l.montant || l.total || l.montantHT || l.totalLigne || 0) || 0,
            tva: parseFloat(l.tauxTVA || l.tva || 0) || 0,
            reference: l.reference || l.ref || l.code || '',
          }));
        }

        // Find which client this order belongs to
        // Try client id from the order data
        const ebClientId = String(orderData.clientId || orderData.client_id || orderData.tiersId || orderData.tiers_id
          || orderData.idClient || orderData.id_client || orderData.acheteurId || '');

        let clientId = null;

        if (ebClientId) {
          // Look for imported client by easybeer_id
          const ebMatch = await db.query(
            "SELECT imported_client_id FROM easybeer_clients WHERE easybeer_id = $1 AND status = 'imported' AND imported_client_id IS NOT NULL",
            [ebClientId]
          );
          if (ebMatch.rows.length > 0) {
            clientId = ebMatch.rows[0].imported_client_id;
          }
        }

        // Also try matching by client name from the order
        if (!clientId) {
          const clientName = orderData.clientNom || orderData.client_nom || orderData.nomClient || orderData.raisonSociale
            || orderData.raison_sociale || orderData.nomTiers || '';
          if (clientName) {
            const clientMatch = await db.query('SELECT id FROM clients WHERE LOWER(nom) = LOWER($1) LIMIT 1', [clientName]);
            if (clientMatch.rows.length > 0) {
              clientId = clientMatch.rows[0].id;
            }
          }
        }

        if (!clientId) {
          console.log(`[EasyBeer Webhook] Commande ${numero}: pas de client associe (ebClientId=${ebClientId}), stockage en attente`);
          // Store in webhooks for manual processing later
          return;
        }

        // Check if already imported
        const existing = await db.query('SELECT id FROM commandes WHERE easybeer_id = $1 AND client_id = $2', [String(id), clientId]);
        if (existing.rows.length > 0) {
          console.log(`[EasyBeer Webhook] Commande ${numero} deja importee, mise a jour...`);
          await db.query(
            `UPDATE commandes SET statut = $1, montant_ht = $2, montant_ttc = $3, lignes = $4, date_livraison = $5 WHERE easybeer_id = $6 AND client_id = $7`,
            [statut, montantHt, montantTtc, JSON.stringify(lignes), dateLiv, String(id), clientId]
          );
          return;
        }

        // Create the commande
        const cmdId = `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        await db.query(
          `INSERT INTO commandes (id, client_id, easybeer_id, numero, date_commande, date_livraison, statut, montant_ht, montant_ttc, lignes, notes, source, date_creation)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [cmdId, clientId, String(id), numero, dateCmd, dateLiv, statut, montantHt, montantTtc,
           JSON.stringify(lignes), '', 'easybeer', now]
        );

        const lignesStr = lignes.length > 0
          ? lignes.map(l => `${l.produit} x${l.quantite}`).join(', ')
          : 'aucun detail produit';
        console.log(`[EasyBeer Webhook] Commande importee: #${numero} -> client ${clientId}, ${montantHt.toFixed(2)}€ HT / ${montantTtc.toFixed(2)}€ TTC, ${lignes.length} lignes (${lignesStr})`);

        // Create notification for the commercial
        try {
          const clientData = await db.query('SELECT nom, commercial_id FROM clients WHERE id = $1', [clientId]);
          if (clientData.rows.length > 0) {
            const notifId = `notif-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            await db.query(
              `INSERT INTO notifications (id, user_id, type, title, message, data, created_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [notifId, clientData.rows[0].commercial_id, 'commande',
               `Nouvelle commande #${numero}`,
               `${clientData.rows[0].nom} - ${montantTtc.toFixed(2)}€ TTC${lignes.length > 0 ? ` (${lignes.length} produits)` : ''}`,
               JSON.stringify({ client_id: clientId, commande_id: cmdId, montant_ttc: montantTtc }),
               now]
            );
          }
        } catch (err) { console.error('[EasyBeer Webhook] Notification error:', err.message); }

      } catch (err) {
        console.error(`[EasyBeer Webhook] Erreur traitement commande id=${id}:`, err.message);
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
    const directName = body.nom || body.name || body.libelle || body.raisonSociale || body.raison_sociale || '';
    const directEmail = body.email || '';
    const directPhone = body.phone || body.telephone || body.mobile || '';
    const directCity = body.ville || body.city || '';
    const directAddress = body.adresse || body.address || body.rue || '';
    const directPostalCode = body.codePostal || body.code_postal || body.cp || body.postal_code || '';
    const directContact = body.contact || body.contactName || body.contact_name || '';

    // Insert/update pending client with whatever info we have from the payload
    await db.query(
      `INSERT INTO easybeer_clients (easybeer_id, name, type, contact_name, phone, email, city, address, postal_code, notes, commercial_email, raw_data, status, synced_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (easybeer_id) DO UPDATE SET
        name = CASE WHEN $2 != '' THEN $2 ELSE easybeer_clients.name END,
        type = CASE WHEN $3 != '' THEN $3 ELSE easybeer_clients.type END,
        contact_name = CASE WHEN $4 != '' THEN $4 ELSE easybeer_clients.contact_name END,
        phone = CASE WHEN $5 != '' THEN $5 ELSE easybeer_clients.phone END,
        email = CASE WHEN $6 != '' THEN $6 ELSE easybeer_clients.email END,
        city = CASE WHEN $7 != '' THEN $7 ELSE easybeer_clients.city END,
        address = CASE WHEN $8 != '' THEN $8 ELSE easybeer_clients.address END,
        postal_code = CASE WHEN $9 != '' THEN $9 ELSE easybeer_clients.postal_code END,
        raw_data = $12, updated_at = $15`,
      [id, directName, body.type || '', directContact, directPhone, directEmail,
       directCity, directAddress, directPostalCode, body.notes || '',
       body.commercialEmail || body.commercial_email || '', JSON.stringify(body), 'pending', now, now]
    );
    console.log(`[EasyBeer Webhook] Client en attente cree/maj: easybeer_id=${id}, name=${directName || '(depuis webhook)'}`);
  }

  // Use shared extractEbFieldsSync function (defined above)
  const extractEbFields = extractEbFieldsSync;

  // Try to enrich with EasyBeer API data in background (with retries and backoff)
  if (id && config?.username && config?.api_url) {
    setTimeout(async () => {
      try {
        const authHeader = 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');
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

          // Auto-import if assignment rule exists
          if (f.commercial_email) {
            const ruleResult = await db.query('SELECT * FROM assignment_rules WHERE email = $1', [f.commercial_email.toLowerCase()]);
            if (ruleResult.rows.length > 0) {
              const rule = ruleResult.rows[0];
              const clientType = 'BAR_RESTAURANT_GENERAL';
              const nextVisit = await calculateNextVisit(clientType, null, null);
              const clientId = `cli-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

              // Check if a matching prospect exists
              const prospect = await findMatchingProspect(f.name, f.email, f.phone);

              await db.query(
                `INSERT INTO clients (id, nom, ville, adresse, code_postal, telephone, telephone_mobile, email, contact,
                 type_client, statut, commercial_id, next_visit, notes, siret, tournee, latitude, longitude, prospect_id, date_creation, date_modification)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
                [clientId, f.name, f.city, f.address, f.postal_code,
                 f.phone, f.phone_mobile, f.email, f.contact_name, clientType, 'ACTIF',
                 prospect?.commercial_id || rule.commercial_id, nextVisit || null,
                 [prospect?.notes, f.notes].filter(Boolean).join('\n') || '',
                 f.siret, prospect?.tournee || f.tournee,
                 f.latitude || prospect?.latitude || 0, f.longitude || prospect?.longitude || 0,
                 prospect?.id || null, clientNow, clientNow]
              );
              await db.query("UPDATE easybeer_clients SET status = 'imported', imported_client_id = $1 WHERE easybeer_id = $2", [clientId, id]);

              // Link prospect if found
              if (prospect) {
                await linkClientToProspect(clientId, prospect, clientNow);
              }

              console.log(`[EasyBeer Webhook] Auto-import: ${f.name} -> commercial ${prospect?.commercial_id || rule.commercial_id}${prospect ? ' (linked to prospect)' : ''}`);
            }
          }
        } else {
          console.log(`[EasyBeer Webhook] Impossible de recuperer les details pour id=${id} apres 5 tentatives`);
        }
      } catch (err) {
        console.error(`[EasyBeer Webhook] Enrichissement echoue:`, err.message);
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
  }
  await db.query(
    `INSERT INTO easybeer_config (id, username, password, api_url, webhook_secret, updated_at)
    VALUES (1, $1, $2, $3, $4, $5)
    ON CONFLICT (id) DO UPDATE SET username=$1, password=$2, api_url=$3, webhook_secret=$4, updated_at=$5`,
    [username || '', finalPassword, api_url || 'https://api.easybeer.fr', webhook_secret || '', now]
  );
  res.json({ ok: true });
}));

router.post('/easybeer/test-connection', authMiddleware, asyncHandler(async (req, res) => {
  let { username, password, api_url } = req.body;
  // If password is masked, retrieve the real one from DB
  if (password === '***') {
    const existing = await db.query('SELECT password FROM easybeer_config WHERE id = 1');
    password = existing.rows.length > 0 ? existing.rows[0].password : '';
  }
  const baseUrl = (api_url || 'https://api.easybeer.fr').replace(/\/$/, '');
  const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const headers = { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' };

  // Try EasyBeer endpoint paths (correct path: POST /parametres/client/liste)
  const pathsToTry = ['/parametres/client/liste', '/param%C3%A8tres/client/liste'];

  for (const path of pathsToTry) {
    try {
      const resp = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ colonneTri: 'libelle', mode: 'ASC', nombreParPage: 10 }),
        signal: AbortSignal.timeout(8000)
      });
      if (resp.status === 200 || resp.status === 206) {
        const data = await resp.json().catch(() => null);
        const count = data?.liste?.length || 0;
        return res.json({ ok: true, message: `Connexion reussie (${count} clients)` });
      }
      if (resp.status === 401 || resp.status === 403) {
        return res.json({ ok: false, message: `Serveur accessible mais identifiants refuses (${resp.status})` });
      }
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

// Webhook logs
router.get('/easybeer/webhook-logs', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM webhooks ORDER BY received_at DESC LIMIT 20');
  res.json(result.rows);
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
  const nextVisit = await calculateNextVisit(clientType, null, null);
  const clientId = `cli-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  // Check if a matching prospect exists
  const prospect = await findMatchingProspect(eb.name, eb.email, eb.phone);

  // Geocode if no coordinates
  let lat = eb.latitude || prospect?.latitude || 0;
  let lng = eb.longitude || prospect?.longitude || 0;
  if ((!lat || !lng) && (eb.address || eb.city)) {
    const geo = await geocodeServer([eb.address, eb.postal_code, eb.city].filter(Boolean).join(' '));
    if (geo) { lat = geo.latitude; lng = geo.longitude; }
  }

  await db.query(
    `INSERT INTO clients (id, nom, ville, adresse, code_postal, telephone, telephone_mobile, email, contact,
     type_client, statut, commercial_id, next_visit, notes, siret, tournee, latitude, longitude, prospect_id, date_creation, date_modification)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    [clientId, eb.name, eb.city || '', eb.address || '', eb.postal_code || '',
     eb.phone || '', eb.phone_mobile || '', eb.email || '', eb.contact_name || '', clientType, 'ACTIF',
     commercial_id || prospect?.commercial_id || req.user.id, nextVisit || null,
     [prospect?.notes, eb.notes].filter(Boolean).join('\n') || '',
     eb.siret || '', tournee || prospect?.tournee || eb.tournee || '', lat, lng,
     prospect?.id || null, now, now]
  );

  // Link prospect if found
  if (prospect) {
    await linkClientToProspect(clientId, prospect, now);
  }

  await db.query("UPDATE easybeer_clients SET status = 'imported', imported_client_id = $1 WHERE id = $2", [clientId, req.params.id]);
  res.json({ ok: true, client_id: clientId, linked_prospect: prospect?.id || null });
}));

router.delete('/easybeer/pending-clients/:id', authMiddleware, asyncHandler(async (req, res) => {
  await db.query("UPDATE easybeer_clients SET status = 'dismissed' WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));

// Re-sync a pending client from EasyBeer API
router.post('/easybeer/pending-clients/:id/sync', authMiddleware, asyncHandler(async (req, res) => {
  const ebClient = await db.query('SELECT * FROM easybeer_clients WHERE id = $1', [req.params.id]);
  if (ebClient.rows.length === 0) return res.status(404).json({ error: 'Client non trouve' });
  const eb = ebClient.rows[0];
  const ebId = eb.easybeer_id;

  const configResult = await db.query('SELECT * FROM easybeer_config WHERE id = 1');
  const config = configResult.rows[0];
  if (!config?.username || !config?.api_url) {
    return res.json({ ok: false, message: 'Configuration EasyBeer incomplete' });
  }

  const authHeader = 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');
  const apiBase = (config.api_url || 'https://api.easybeer.fr').replace(/\/$/, '');
  const headers = { 'Authorization': authHeader, 'Accept': 'application/json' };

  // Helper to update client from data (uses shared extractEbFields from webhook handler)
  const updateFromData = async (data, path) => {
    const f = extractEbFieldsSync(data);
    const now = new Date().toISOString();
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
      WHERE id = $1`,
      [req.params.id, f.name, f.type, f.contact_name, f.phone, f.phone_mobile, f.email,
       f.city, f.address, f.postal_code, f.notes, f.commercial_email,
       f.siret, f.tournee, f.latitude, f.longitude, JSON.stringify(data), now]
    );
    return res.json({ ok: true, message: `Synchronise via ${path}`, name: f.name });
  };

  // Strategy 1: Try direct ID lookup via EasyBeer /parametres/client/detail/{id}
  const directPaths = [`/parametres/client/detail/${ebId}`, `/param%C3%A8tres/client/detail/${ebId}`, `/parametres/client/${ebId}`, `/client/${ebId}`];
  const errors = [];
  let firstErrorBody = '';

  for (const path of directPaths) {
    try {
      const resp = await fetch(`${apiBase}${path}`, { headers, signal: AbortSignal.timeout(15000) });
      if (resp.ok) {
        let data = await resp.json();
        if (Array.isArray(data)) data = data.find(d => String(d.id || d.idClient) === String(ebId)) || data[0] || {};
        return await updateFromData(data, path);
      } else {
        const body = await resp.text().catch(() => '');
        errors.push(`${path}: HTTP ${resp.status}`);
        if (!firstErrorBody && body) firstErrorBody = body.substring(0, 200);
      }
    } catch (err) {
      errors.push(`${path}: ${err.message}`);
    }
  }

  // Strategy 2: Fetch the full list via POST /parametres/client/liste and search by ID
  const listPaths = ['/parametres/client/liste', '/param%C3%A8tres/client/liste'];
  for (const path of listPaths) {
    try {
      const resp = await fetch(`${apiBase}${path}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ colonneTri: 'libelle', mode: 'ASC', nombreParPage: 1000 }),
        signal: AbortSignal.timeout(20000)
      });
      if (resp.ok) {
        const data = await resp.json();
        const items = Array.isArray(data) ? data : (data.liste || data.results || data.data || data.items || []);
        if (Array.isArray(items)) {
          const match = items.find(d => String(d.id || d.idClient) === String(ebId));
          if (match) {
            return await updateFromData(match, `${path} (liste)`);
          }
          errors.push(`${path}: liste OK (${items.length} items) mais ID ${ebId} non trouve`);
        }
      }
    } catch { /* ignore list errors */ }
  }

  const detail = firstErrorBody ? ` | Reponse API: ${firstErrorBody}` : '';
  return res.json({ ok: false, message: `Impossible de recuperer le client ${ebId}. ${errors.slice(0, 4).join(' | ')}${detail}` });
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

// Geocode all clients missing coordinates
router.post('/clients/geocode-missing', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query(
    "SELECT id, adresse, code_postal, ville FROM clients WHERE (latitude IS NULL OR longitude IS NULL OR (latitude = 0 AND longitude = 0)) AND (adresse != '' OR ville != '')"
  );
  let geocoded = 0;
  for (const client of result.rows) {
    const fullAddress = [client.adresse, client.code_postal, client.ville].filter(Boolean).join(' ');
    const geo = await geocodeServer(fullAddress);
    if (geo) {
      await db.query('UPDATE clients SET latitude = $1, longitude = $2 WHERE id = $3', [geo.latitude, geo.longitude, client.id]);
      geocoded++;
    }
    // Rate limit: 50ms between requests
    await new Promise(r => setTimeout(r, 50));
  }
  res.json({ ok: true, total: result.rows.length, geocoded });
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
    const nextVisit = await calculateNextVisit(clientType, c.custom_recurrence || null, null);
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

// ============================================
// Notifications
// ============================================

router.get('/notifications/:userId', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query(
    'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
    [req.params.userId]
  );
  res.json(result.rows);
}));

router.get('/notifications/:userId/unread-count', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read = false',
    [req.params.userId]
  );
  res.json({ count: parseInt(result.rows[0].count) });
}));

router.put('/notifications/:notificationId/read', authMiddleware, asyncHandler(async (req, res) => {
  await db.query('UPDATE notifications SET read = true WHERE id = $1', [req.params.notificationId]);
  res.json({ ok: true });
}));

router.put('/notifications/:userId/read-all', authMiddleware, asyncHandler(async (req, res) => {
  await db.query('UPDATE notifications SET read = true WHERE user_id = $1', [req.params.userId]);
  res.json({ ok: true });
}));

// Helper to create a notification
async function createNotification(userId, type, title, message, data = {}) {
  const id = `notif-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();
  await db.query(
    'INSERT INTO notifications (id, user_id, type, title, message, data, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, userId, type, title, message, JSON.stringify(data), now]
  );
  return id;
}

// ============================================
// Admin Stats (per-commercial analytics)
// ============================================

router.get('/admin/stats', authMiddleware, asyncHandler(async (req, res) => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // Get Monday of current week
  const dayOfWeek = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek + 1);
  const weekStart = monday.toISOString().split('T')[0];

  // Start of month
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  // All commerciaux
  const commerciaux = await db.query('SELECT id, prenom, nom, role FROM commerciaux');

  // Per-commercial stats
  const stats = [];
  for (const com of commerciaux.rows) {
    // Clients count
    const clientsResult = await db.query(
      "SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE statut = 'ACTIF') as actifs FROM clients WHERE commercial_id = $1",
      [com.id]
    );
    // Late clients (next_visit < today AND statut = ACTIF)
    const lateResult = await db.query(
      "SELECT COUNT(*) as count FROM clients WHERE commercial_id = $1 AND statut = 'ACTIF' AND next_visit IS NOT NULL AND next_visit < $2",
      [com.id, today]
    );
    // Today's clients
    const todayResult = await db.query(
      "SELECT COUNT(*) as count FROM clients WHERE commercial_id = $1 AND statut = 'ACTIF' AND next_visit = $2",
      [com.id, today]
    );
    // Visits this week (with type breakdown)
    const visitsWeek = await db.query(
      "SELECT COUNT(*) as count FROM interactions WHERE commercial_id = $1 AND date >= $2",
      [com.id, weekStart]
    );
    const visitsWeekByType = await db.query(
      "SELECT type, COUNT(*) as count FROM interactions WHERE commercial_id = $1 AND date >= $2 GROUP BY type",
      [com.id, weekStart]
    );
    // Visits this month (with type breakdown)
    const visitsMonth = await db.query(
      "SELECT COUNT(*) as count FROM interactions WHERE commercial_id = $1 AND date >= $2",
      [com.id, monthStart]
    );
    const visitsMonthByType = await db.query(
      "SELECT type, COUNT(*) as count FROM interactions WHERE commercial_id = $1 AND date >= $2 GROUP BY type",
      [com.id, monthStart]
    );
    // Tasks pending
    const tasksPending = await db.query(
      "SELECT COUNT(*) as count FROM tasks_client WHERE commercial_id = $1 AND statut != 'TERMINEE'",
      [com.id]
    );
    // Tasks overdue
    const tasksOverdue = await db.query(
      "SELECT COUNT(*) as count FROM tasks_client WHERE commercial_id = $1 AND statut != 'TERMINEE' AND date_echeance IS NOT NULL AND date_echeance < $2",
      [com.id, today]
    );
    // Tasks completed this month
    const tasksCompleted = await db.query(
      "SELECT COUNT(*) as count FROM tasks_client WHERE commercial_id = $1 AND statut = 'TERMINEE' AND completed_at >= $2",
      [com.id, monthStart]
    );

    const weekByType = {};
    visitsWeekByType.rows.forEach(r => { weekByType[r.type] = parseInt(r.count); });
    const monthByType = {};
    visitsMonthByType.rows.forEach(r => { monthByType[r.type] = parseInt(r.count); });

    stats.push({
      commercial: { id: com.id, prenom: com.prenom, nom: com.nom, role: com.role },
      clients_total: parseInt(clientsResult.rows[0].total),
      clients_actifs: parseInt(clientsResult.rows[0].actifs),
      clients_en_retard: parseInt(lateResult.rows[0].count),
      clients_aujourd_hui: parseInt(todayResult.rows[0].count),
      visites_semaine: parseInt(visitsWeek.rows[0].count),
      visites_mois: parseInt(visitsMonth.rows[0].count),
      visites_semaine_par_type: weekByType,
      visites_mois_par_type: monthByType,
      taches_en_cours: parseInt(tasksPending.rows[0].count),
      taches_en_retard: parseInt(tasksOverdue.rows[0].count),
      taches_terminees_mois: parseInt(tasksCompleted.rows[0].count),
    });
  }

  // Global stats
  const totalLate = await db.query(
    "SELECT COUNT(*) as count FROM clients WHERE statut = 'ACTIF' AND next_visit IS NOT NULL AND next_visit < $1",
    [today]
  );
  const totalToday = await db.query(
    "SELECT COUNT(*) as count FROM clients WHERE statut = 'ACTIF' AND next_visit = $1",
    [today]
  );
  const totalVisitsWeek = await db.query(
    "SELECT COUNT(*) as count FROM interactions WHERE date >= $1",
    [weekStart]
  );
  const totalVisitsMonth = await db.query(
    "SELECT COUNT(*) as count FROM interactions WHERE date >= $1",
    [monthStart]
  );
  const totalVisitsWeekByType = await db.query(
    "SELECT type, COUNT(*) as count FROM interactions WHERE date >= $1 GROUP BY type",
    [weekStart]
  );
  const totalVisitsMonthByType = await db.query(
    "SELECT type, COUNT(*) as count FROM interactions WHERE date >= $1 GROUP BY type",
    [monthStart]
  );
  const globalWeekByType = {};
  totalVisitsWeekByType.rows.forEach(r => { globalWeekByType[r.type] = parseInt(r.count); });
  const globalMonthByType = {};
  totalVisitsMonthByType.rows.forEach(r => { globalMonthByType[r.type] = parseInt(r.count); });

  res.json({
    global: {
      clients_en_retard: parseInt(totalLate.rows[0].count),
      clients_aujourd_hui: parseInt(totalToday.rows[0].count),
      visites_semaine: parseInt(totalVisitsWeek.rows[0].count),
      visites_mois: parseInt(totalVisitsMonth.rows[0].count),
      visites_semaine_par_type: globalWeekByType,
      visites_mois_par_type: globalMonthByType,
    },
    par_commercial: stats,
  });
}));

// ============================================
// Activity Feed (recent activity across all commercials)
// ============================================

router.get('/admin/activity-feed', authMiddleware, asyncHandler(async (req, res) => {
  const { month, commercial_id, type } = req.query;
  const now = new Date();
  let startDate, endDate;

  if (month) {
    // month format: "2026-03"
    startDate = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    endDate = `${month}-${lastDay}`;
  } else {
    startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    endDate = now.toISOString().split('T')[0];
  }

  const activities = [];

  // Interactions (visits, calls)
  if (!type || type === 'visite' || type === 'appel') {
    let query = `SELECT i.*, c.nom as client_nom, co.prenom as commercial_prenom, co.nom as commercial_nom
      FROM interactions i
      LEFT JOIN clients c ON i.client_id = c.id
      LEFT JOIN commerciaux co ON i.commercial_id = co.id
      WHERE i.date >= $1 AND i.date <= $2`;
    const params = [startDate, endDate];
    if (commercial_id) {
      query += ` AND i.commercial_id = $3`;
      params.push(commercial_id);
    }
    if (type) {
      query += ` AND LOWER(i.type) = $${params.length + 1}`;
      params.push(type.toUpperCase());
    }
    const result = await db.query(query, params);
    for (const r of result.rows) {
      activities.push({
        id: r.id,
        type: r.type.toLowerCase(),
        date: r.date,
        commercial: `${r.commercial_prenom} ${r.commercial_nom}`,
        commercial_id: r.commercial_id,
        description: `${r.type === 'VISITE' ? 'Visite' : r.type === 'APPEL' ? 'Appel' : 'RDV'} - ${r.client_nom || 'Client inconnu'}`,
        comment: r.comment,
      });
    }
  }

  // Tasks completed
  if (!type || type === 'tache') {
    let query = `SELECT t.*, co.prenom as commercial_prenom, co.nom as commercial_nom, c.nom as client_nom
      FROM tasks_client t
      LEFT JOIN commerciaux co ON t.commercial_id = co.id
      LEFT JOIN clients c ON t.client_id = c.id
      WHERE t.statut = 'TERMINEE' AND t.completed_at >= $1 AND t.completed_at <= $2`;
    const params = [startDate, endDate + 'T23:59:59'];
    if (commercial_id) {
      query += ` AND t.commercial_id = $3`;
      params.push(commercial_id);
    }
    const result = await db.query(query, params);
    for (const r of result.rows) {
      activities.push({
        id: r.id,
        type: 'tache',
        date: r.completed_at,
        commercial: `${r.commercial_prenom} ${r.commercial_nom}`,
        commercial_id: r.commercial_id,
        description: `Tache terminee: ${r.titre}${r.client_nom ? ` (${r.client_nom})` : ''}`,
      });
    }
  }

  // New clients this month
  if (!type || type === 'nouveau_client') {
    let query = `SELECT cl.*, co.prenom as commercial_prenom, co.nom as commercial_nom
      FROM clients cl
      LEFT JOIN commerciaux co ON cl.commercial_id = co.id
      WHERE cl.date_creation >= $1 AND cl.date_creation <= $2`;
    const params = [startDate, endDate + 'T23:59:59'];
    if (commercial_id) {
      query += ` AND cl.commercial_id = $3`;
      params.push(commercial_id);
    }
    const result = await db.query(query, params);
    for (const r of result.rows) {
      activities.push({
        id: r.id,
        type: 'nouveau_client',
        date: r.date_creation,
        commercial: `${r.commercial_prenom} ${r.commercial_nom}`,
        commercial_id: r.commercial_id,
        description: `Nouveau client: ${r.nom}${r.ville ? ` (${r.ville})` : ''}`,
      });
    }
  }

  // Sort by date descending
  activities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  res.json(activities.slice(0, 100));
}));

// ============================================
// 6-Week Planning
// ============================================

router.get('/admin/planning', authMiddleware, asyncHandler(async (req, res) => {
  const { commercial_id } = req.query;
  const now = new Date();

  // Get Monday of current week
  const dayOfWeek = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek + 1);

  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const weekStart = new Date(monday);
    weekStart.setDate(monday.getDate() + w * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const startStr = weekStart.toISOString().split('T')[0];
    const endStr = weekEnd.toISOString().split('T')[0];

    let query = `SELECT c.id, c.nom, c.ville, c.type_client, c.next_visit, c.tournee,
      co.prenom as commercial_prenom, co.nom as commercial_nom, c.commercial_id
      FROM clients c
      LEFT JOIN commerciaux co ON c.commercial_id = co.id
      WHERE c.statut = 'ACTIF' AND c.next_visit >= $1 AND c.next_visit <= $2`;
    const params = [startStr, endStr];
    if (commercial_id) {
      query += ` AND c.commercial_id = $3`;
      params.push(commercial_id);
    }
    query += ` ORDER BY c.next_visit ASC`;
    const result = await db.query(query, params);

    weeks.push({
      week_number: w + 1,
      start: startStr,
      end: endStr,
      clients: result.rows,
      count: result.rows.length,
    });
  }

  res.json(weeks);
}));

// ============================================
// Visites Clients - weekly visit planning based on tournées
// ============================================

router.get('/commercial/visites', authMiddleware, asyncHandler(async (req, res) => {
  const weekOffset = parseInt(req.query.week_offset) || 0;
  // Allow viewing another commercial's visites (for admins/prospection)
  const targetId = req.query.commercial_id || req.user.id;
  const viewAll = req.query.view === 'all';
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // Get Monday of target week (current + offset)
  const dayOfWeek = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek + 1 + (weekOffset * 7));
  monday.setHours(0, 0, 0, 0);
  const mondayStr = monday.toISOString().split('T')[0];

  // Week number for target week
  const startOfYear = new Date(monday.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((monday - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
  const isEvenWeek = weekNum % 2 === 0;

  if (viewAll) {
    // --- VIEW ALL commercials ---
    const allCommerciaux = await db.query("SELECT id, prenom, nom, role FROM commerciaux WHERE role != 'prospection' ORDER BY prenom");
    const allClients = await db.query("SELECT * FROM clients WHERE statut = 'ACTIF' ORDER BY next_visit ASC NULLS LAST");
    const allConfigs = await db.query('SELECT * FROM tournee_config');

    const commerciauxData = [];
    let totalLate = 0;

    for (const com of allCommerciaux.rows) {
      const comClients = allClients.rows.filter(c => c.commercial_id === com.id);
      const tcRow = allConfigs.rows.find(tc => tc.commercial_id === com.id);
      const config = tcRow ? JSON.parse(tcRow.config || '{}') : {};
      const wp = tcRow?.week_pattern || 'every';
      const active = wp === 'every' || (wp === 'even' && isEvenWeek) || (wp === 'odd' && !isEvenWeek);

      const sundayStr = new Date(new Date(monday).setDate(monday.getDate() + 6)).toISOString().split('T')[0];
      const weekDays = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(monday);
        date.setDate(monday.getDate() + d);
        const dateStr = date.toISOString().split('T')[0];
        const dayKey = String(d === 6 ? 0 : d + 1);
        const tourneesForDay = active ? (config[dayKey] || []) : [];

        // Only show clients who are late OR whose next_visit falls this week
        const tourneeClients = comClients.filter(c => {
          if (!tourneesForDay.length || !c.tournee || !tourneesForDay.some(t => t.toLowerCase() === c.tournee.toLowerCase())) return false;
          // Late client: next_visit before today, show on the day their zone is configured
          if (c.next_visit && c.next_visit < today) return true;
          // Due this week: next_visit is within this week — show on the day their zone is scheduled
          if (c.next_visit && c.next_visit >= mondayStr && c.next_visit <= sundayStr) return true;
          return false;
        });
        // Only add clients without a configured zone, whose next_visit matches this exact date
        const visitClients = comClients.filter(c => {
          if (c.next_visit !== dateStr) return false;
          if (tourneeClients.find(tc2 => tc2.id === c.id)) return false;
          if (c.tournee) {
            for (const [, zones] of Object.entries(config)) {
              if (Array.isArray(zones) && zones.some(z => z.toLowerCase() === c.tournee.toLowerCase())) {
                return false;
              }
            }
          }
          return true;
        });

        weekDays.push({
          day_key: dayKey, date: dateStr,
          day_name: ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'][date.getDay()],
          tournees: tourneesForDay,
          clients: [...tourneeClients, ...visitClients],
          is_today: dateStr === today, is_past: dateStr < today,
        });
      }

      const lateClients = comClients.filter(c => c.next_visit && c.next_visit < mondayStr);
      totalLate += lateClients.length;

      commerciauxData.push({
        commercial: { id: com.id, prenom: com.prenom, nom: com.nom, role: com.role },
        week_days: weekDays,
        late_clients: lateClients,
        week_pattern: wp,
        tournee_active: active,
        total_active_clients: comClients.length,
      });
    }

    return res.json({
      view: 'all',
      commerciaux: commerciauxData,
      week_number: weekNum,
      is_even_week: isEvenWeek,
      week_offset: weekOffset,
      week_start: mondayStr,
      total_late: totalLate,
    });
  }

  // --- SINGLE commercial view ---
  const clients = await db.query(
    "SELECT * FROM clients WHERE commercial_id = $1 AND statut = 'ACTIF' ORDER BY next_visit ASC NULLS LAST",
    [targetId]
  );

  const tourneeConfig = await db.query(
    'SELECT * FROM tournee_config WHERE commercial_id = $1',
    [targetId]
  );
  const tc = tourneeConfig.rows[0] || null;
  const config = tc ? JSON.parse(tc.config || '{}') : {};
  const weekPattern = tc?.week_pattern || 'every';

  const isTourneeActive = weekPattern === 'every' ||
    (weekPattern === 'even' && isEvenWeek) ||
    (weekPattern === 'odd' && !isEvenWeek);

  const sundayStr = new Date(new Date(monday).setDate(monday.getDate() + 6)).toISOString().split('T')[0];
  const weekDays = [];
  for (let d = 0; d < 7; d++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + d);
    const dateStr = date.toISOString().split('T')[0];
    const dayKey = String(d === 6 ? 0 : d + 1);
    const tourneesForDay = isTourneeActive ? (config[dayKey] || []) : [];

    // Only show clients who are late OR whose next_visit falls this week
    const tourneeClients = clients.rows.filter(c => {
      if (!tourneesForDay.length || !c.tournee || !tourneesForDay.some(t => t.toLowerCase() === c.tournee.toLowerCase())) return false;
      // Late client: next_visit before today, show on the day their zone is configured
      if (c.next_visit && c.next_visit < today) return true;
      // Due this week: next_visit is within this week — show on the day their zone is scheduled
      if (c.next_visit && c.next_visit >= mondayStr && c.next_visit <= sundayStr) return true;
      return false;
    });
    // Only add clients without a configured zone/tournee, whose next_visit matches this exact date
    // Clients WITH a zone should only appear on their zone's day (handled by tourneeClients above)
    const visitClients = clients.rows.filter(c => {
      if (c.next_visit !== dateStr) return false;
      if (tourneeClients.find(tc2 => tc2.id === c.id)) return false;
      // If client has a zone that exists in ANY day of the week config, skip — they'll be shown on that day
      if (c.tournee) {
        for (const [, zones] of Object.entries(config)) {
          if (Array.isArray(zones) && zones.some(z => z.toLowerCase() === c.tournee.toLowerCase())) {
            return false; // Zone is configured, client will appear on the correct day
          }
        }
      }
      return true;
    });

    weekDays.push({
      day_key: dayKey, date: dateStr,
      day_name: ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'][date.getDay()],
      tournees: tourneesForDay,
      clients: [...tourneeClients, ...visitClients],
      is_today: dateStr === today, is_past: dateStr < today,
    });
  }

  const lateClients = clients.rows.filter(c =>
    c.next_visit && c.next_visit < mondayStr
  );

  res.json({
    view: 'single',
    week_days: weekDays,
    late_clients: lateClients,
    week_number: weekNum,
    is_even_week: isEvenWeek,
    week_pattern: weekPattern,
    week_offset: weekOffset,
    week_start: mondayStr,
    tournee_active: isTourneeActive,
    total_active_clients: clients.rows.length,
  });
}));

// ============================================
// Commercial Dashboard Data (tournée-based weekly view)
// ============================================

router.get('/commercial/dashboard', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // Get Monday of current week
  const dayOfWeek = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek + 1);
  const weekStart = monday.toISOString().split('T')[0];
  const weekEnd = new Date(monday);
  weekEnd.setDate(monday.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().split('T')[0];

  // My clients
  const clients = await db.query(
    "SELECT * FROM clients WHERE commercial_id = $1 AND statut = 'ACTIF' ORDER BY next_visit ASC NULLS LAST",
    [userId]
  );

  // My tournée config
  const tourneeConfig = await db.query(
    'SELECT * FROM tournee_config WHERE commercial_id = $1',
    [userId]
  );
  const config = tourneeConfig.rows.length > 0
    ? JSON.parse(tourneeConfig.rows[0].config || '{}')
    : {};
  const tourneeNotes = tourneeConfig.rows.length > 0 ? tourneeConfig.rows[0].notes : '';

  // Organize clients by day of week based on tournée rules
  const weekDays = {};
  for (let d = 0; d < 7; d++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + d);
    const dayKey = String(d === 6 ? 0 : d + 1); // 0=dimanche, 1=lundi, ...
    const tourneesForDay = config[dayKey] || [];

    const dateStr = date.toISOString().split('T')[0];
    const dayClients = clients.rows.filter(c => {
      // Client is in one of the tournées for this day
      if (tourneesForDay.length > 0 && c.tournee && tourneesForDay.includes(c.tournee)) return true;
      // Client has next_visit on this date BUT only if their zone isn't configured on another day
      if (c.next_visit === dateStr) {
        if (c.tournee) {
          for (const [, zones] of Object.entries(config)) {
            if (Array.isArray(zones) && zones.some(z => z.toLowerCase() === c.tournee.toLowerCase())) {
              return false; // Zone is configured, client will appear on the correct day
            }
          }
        }
        return true;
      }
      return false;
    });

    weekDays[dayKey] = {
      date: date.toISOString().split('T')[0],
      day_name: ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'][d === 6 ? 0 : d + 1],
      tournees: tourneesForDay,
      clients: dayClients,
      count: dayClients.length,
    };
  }

  // Late clients
  const lateClients = clients.rows.filter(c => c.next_visit && c.next_visit < today);

  // Today's clients
  const todayClients = clients.rows.filter(c => c.next_visit === today);

  // Recent interactions
  const recentInteractions = await db.query(
    `SELECT i.*, c.nom as client_nom FROM interactions i
     LEFT JOIN clients c ON i.client_id = c.id
     WHERE i.commercial_id = $1 ORDER BY i.date DESC LIMIT 20`,
    [userId]
  );

  // Interaction type stats
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const interactionsWeekByType = await db.query(
    "SELECT type, COUNT(*) as count FROM interactions WHERE commercial_id = $1 AND date >= $2 GROUP BY type",
    [userId, weekStart]
  );
  const interactionsMonthByType = await db.query(
    "SELECT type, COUNT(*) as count FROM interactions WHERE commercial_id = $1 AND date >= $2 GROUP BY type",
    [userId, monthStart]
  );
  const weekByType = {};
  interactionsWeekByType.rows.forEach(r => { weekByType[r.type] = parseInt(r.count); });
  const monthByType = {};
  interactionsMonthByType.rows.forEach(r => { monthByType[r.type] = parseInt(r.count); });

  // Pending tasks
  const tasks = await db.query(
    "SELECT t.*, c.nom as client_nom FROM tasks_client t LEFT JOIN clients c ON t.client_id = c.id WHERE t.commercial_id = $1 AND t.statut != 'TERMINEE' ORDER BY t.date_echeance ASC NULLS LAST LIMIT 10",
    [userId]
  );

  res.json({
    week_days: weekDays,
    tournee_config: config,
    tournee_notes: tourneeNotes,
    late_clients: lateClients,
    today_clients: todayClients,
    recent_interactions: recentInteractions.rows,
    pending_tasks: tasks.rows,
    total_clients: clients.rows.length,
    interactions_semaine_par_type: weekByType,
    interactions_mois_par_type: monthByType,
  });
}));

// ============================================
// Activity Log (admin only)
// ============================================

router.get('/activity-log', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);
  const userId = req.query.user_id || null;
  const since = req.query.since || null;

  let query = 'SELECT al.*, c.prenom, c.nom FROM activity_log al JOIN commerciaux c ON al.user_id = c.id';
  const params = [];
  const conditions = [];

  if (userId) {
    conditions.push(`al.user_id = $${params.length + 1}`);
    params.push(userId);
  }
  if (since) {
    conditions.push(`al.created_at >= $${params.length + 1}`);
    params.push(since);
  }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
  query += ` ORDER BY al.created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await db.query(query, params);
  res.json(result.rows);
}));

router.get('/commerciaux/last-seen', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT id, prenom, nom, last_seen FROM commerciaux ORDER BY last_seen DESC NULLS LAST');
  res.json(result.rows);
}));

// Mount Hub Bridge (HTTP API for Hub backend → SuiviPro data)
router.use(hubBridgeRouter);

export default router;
