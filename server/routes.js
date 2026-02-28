import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import db from './db.js';

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
  return { ...p, tags: JSON.parse(p.tags || '[]') };
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
  const [prospects, calls, appointments, reminders, commerciaux, tags, emailTemplates, pipelineColumns, documents] = await Promise.all([
    db.query('SELECT * FROM prospects'),
    db.query('SELECT * FROM calls'),
    db.query('SELECT * FROM appointments'),
    db.query('SELECT * FROM reminders'),
    db.query('SELECT * FROM commerciaux'),
    db.query('SELECT * FROM tags'),
    db.query('SELECT * FROM email_templates'),
    db.query('SELECT * FROM pipeline_columns ORDER BY sort_order'),
    db.query('SELECT id, nom, categorie, description, nom_fichier, type_mime, taille, uploaded_by, date_creation FROM documents ORDER BY date_creation DESC'),
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

export default router;
