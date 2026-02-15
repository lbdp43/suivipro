import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import db from './db.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'suivipro-secret-key-change-in-production';

// ============================================
// Auth middleware
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

// ============================================
// Auth routes
// ============================================

router.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  const user = db.prepare('SELECT * FROM commerciaux WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Identifiants incorrects' });

  // Support both hashed and legacy plaintext passwords
  let valid = false;
  if (user.password.startsWith('$2')) {
    valid = bcrypt.compareSync(password, user.password);
  } else {
    valid = user.password === password;
    // Upgrade to hash
    if (valid) {
      db.prepare('UPDATE commerciaux SET password = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), user.id);
    }
  }
  if (!valid) return res.status(401).json({ error: 'Identifiants incorrects' });

  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  const { password: _, ...userWithoutPwd } = user;
  userWithoutPwd.objectifs = JSON.parse(userWithoutPwd.objectifs || '{}');
  res.json({ token, user: userWithoutPwd });
});

router.get('/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM commerciaux WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur non trouve' });
  const { password: _, ...u } = user;
  u.objectifs = JSON.parse(u.objectifs || '{}');
  res.json(u);
});

// ============================================
// Helper: parse JSON fields for prospects
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
// Full state load (for initial sync)
// ============================================

router.get('/state', authMiddleware, (req, res) => {
  const prospects = db.prepare('SELECT * FROM prospects').all().map(parseProspect);
  const calls = db.prepare('SELECT * FROM calls').all();
  const appointments = db.prepare('SELECT * FROM appointments').all();
  const reminders = db.prepare('SELECT * FROM reminders').all();
  const commerciaux = db.prepare('SELECT * FROM commerciaux').all().map(parseCommercial);
  const tags = db.prepare('SELECT * FROM tags').all();
  const emailTemplates = db.prepare('SELECT * FROM email_templates').all();
  const pipelineColumns = db.prepare('SELECT * FROM pipeline_columns ORDER BY sort_order').all();

  res.json({ prospects, calls, appointments, reminders, commerciaux, tags, emailTemplates, pipelineColumns });
});

// ============================================
// Prospects CRUD
// ============================================

router.get('/prospects', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM prospects').all().map(parseProspect));
});

router.post('/prospects', authMiddleware, (req, res) => {
  const p = req.body;
  db.prepare(`INSERT INTO prospects (id, nom_etablissement, type_etablissement, nom_contact, telephone, email, adresse, ville, code_postal, departement, secteur, latitude, longitude, etape_pipeline, tags, commercial_id, notes, date_creation, date_modification, score)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(p.id, p.nom_etablissement, p.type_etablissement, p.nom_contact || '', p.telephone || '', p.email || '', p.adresse || '', p.ville || '', p.code_postal || '', p.departement || '', p.secteur || '', p.latitude || 0, p.longitude || 0, p.etape_pipeline || 'nouveau', JSON.stringify(p.tags || []), p.commercial_id, p.notes || '', p.date_creation, p.date_modification, p.score || 50);
  res.json({ ok: true });
});

router.put('/prospects/:id', authMiddleware, (req, res) => {
  const p = req.body;
  db.prepare(`UPDATE prospects SET nom_etablissement=?, type_etablissement=?, nom_contact=?, telephone=?, email=?, adresse=?, ville=?, code_postal=?, departement=?, secteur=?, latitude=?, longitude=?, etape_pipeline=?, tags=?, commercial_id=?, notes=?, date_modification=?, score=? WHERE id=?`)
    .run(p.nom_etablissement, p.type_etablissement, p.nom_contact || '', p.telephone || '', p.email || '', p.adresse || '', p.ville || '', p.code_postal || '', p.departement || '', p.secteur || '', p.latitude || 0, p.longitude || 0, p.etape_pipeline, JSON.stringify(p.tags || []), p.commercial_id, p.notes || '', p.date_modification, p.score || 50, req.params.id);
  res.json({ ok: true });
});

router.delete('/prospects/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM prospects WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Bulk import
router.post('/prospects/import', authMiddleware, (req, res) => {
  const prospects = req.body;
  const insert = db.prepare(`INSERT OR REPLACE INTO prospects (id, nom_etablissement, type_etablissement, nom_contact, telephone, email, adresse, ville, code_postal, departement, secteur, latitude, longitude, etape_pipeline, tags, commercial_id, notes, date_creation, date_modification, score)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const tx = db.transaction(() => {
    for (const p of prospects) {
      insert.run(p.id, p.nom_etablissement, p.type_etablissement, p.nom_contact || '', p.telephone || '', p.email || '', p.adresse || '', p.ville || '', p.code_postal || '', p.departement || '', p.secteur || '', p.latitude || 0, p.longitude || 0, p.etape_pipeline || 'nouveau', JSON.stringify(p.tags || []), p.commercial_id, p.notes || '', p.date_creation, p.date_modification, p.score || 50);
    }
  });
  tx();
  res.json({ ok: true, count: prospects.length });
});

// ============================================
// Calls CRUD
// ============================================

router.get('/calls', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM calls').all());
});

router.post('/calls', authMiddleware, (req, res) => {
  const c = req.body;
  db.prepare('INSERT INTO calls (id, prospect_id, commercial_id, date, duree, resultat, notes) VALUES (?,?,?,?,?,?,?)')
    .run(c.id, c.prospect_id, c.commercial_id, c.date, c.duree || 0, c.resultat, c.notes || '');
  res.json({ ok: true });
});

router.put('/calls/:id', authMiddleware, (req, res) => {
  const c = req.body;
  db.prepare('UPDATE calls SET prospect_id=?, commercial_id=?, date=?, duree=?, resultat=?, notes=? WHERE id=?')
    .run(c.prospect_id, c.commercial_id, c.date, c.duree || 0, c.resultat, c.notes || '', req.params.id);
  res.json({ ok: true });
});

router.delete('/calls/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM calls WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============================================
// Appointments CRUD
// ============================================

router.get('/appointments', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM appointments').all());
});

router.post('/appointments', authMiddleware, (req, res) => {
  const a = req.body;
  db.prepare('INSERT INTO appointments (id, prospect_id, commercial_id, prospecteur_id, date, heure_debut, heure_fin, lieu, notes, statut) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(a.id, a.prospect_id, a.commercial_id, a.prospecteur_id || null, a.date, a.heure_debut || '', a.heure_fin || '', a.lieu || '', a.notes || '', a.statut || 'planifie');
  res.json({ ok: true });
});

router.put('/appointments/:id', authMiddleware, (req, res) => {
  const a = req.body;
  db.prepare('UPDATE appointments SET prospect_id=?, commercial_id=?, prospecteur_id=?, date=?, heure_debut=?, heure_fin=?, lieu=?, notes=?, statut=? WHERE id=?')
    .run(a.prospect_id, a.commercial_id, a.prospecteur_id || null, a.date, a.heure_debut || '', a.heure_fin || '', a.lieu || '', a.notes || '', a.statut, req.params.id);
  res.json({ ok: true });
});

router.delete('/appointments/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM appointments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============================================
// Reminders CRUD
// ============================================

router.get('/reminders', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM reminders').all());
});

router.post('/reminders', authMiddleware, (req, res) => {
  const r = req.body;
  db.prepare('INSERT INTO reminders (id, prospect_id, commercial_id, date, heure, message, statut) VALUES (?,?,?,?,?,?,?)')
    .run(r.id, r.prospect_id, r.commercial_id, r.date, r.heure || '', r.message || '', r.statut || 'actif');
  res.json({ ok: true });
});

router.put('/reminders/:id', authMiddleware, (req, res) => {
  const r = req.body;
  db.prepare('UPDATE reminders SET prospect_id=?, commercial_id=?, date=?, heure=?, message=?, statut=? WHERE id=?')
    .run(r.prospect_id, r.commercial_id, r.date, r.heure || '', r.message || '', r.statut, req.params.id);
  res.json({ ok: true });
});

router.delete('/reminders/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM reminders WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============================================
// Tags CRUD
// ============================================

router.get('/tags', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM tags').all());
});

router.post('/tags', authMiddleware, (req, res) => {
  const t = req.body;
  db.prepare('INSERT INTO tags (id, nom, couleur) VALUES (?,?,?)').run(t.id, t.nom, t.couleur);
  res.json({ ok: true });
});

router.put('/tags/:id', authMiddleware, (req, res) => {
  const t = req.body;
  db.prepare('UPDATE tags SET nom=?, couleur=? WHERE id=?').run(t.nom, t.couleur, req.params.id);
  res.json({ ok: true });
});

router.delete('/tags/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM tags WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============================================
// Email templates CRUD
// ============================================

router.get('/email-templates', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM email_templates').all());
});

router.post('/email-templates', authMiddleware, (req, res) => {
  const e = req.body;
  db.prepare('INSERT INTO email_templates (id, nom, sujet, corps, type) VALUES (?,?,?,?,?)').run(e.id, e.nom, e.sujet || '', e.corps || '', e.type || '');
  res.json({ ok: true });
});

router.put('/email-templates/:id', authMiddleware, (req, res) => {
  const e = req.body;
  db.prepare('UPDATE email_templates SET nom=?, sujet=?, corps=?, type=? WHERE id=?').run(e.nom, e.sujet || '', e.corps || '', e.type || '', req.params.id);
  res.json({ ok: true });
});

router.delete('/email-templates/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM email_templates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============================================
// Pipeline columns CRUD
// ============================================

router.get('/pipeline-columns', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM pipeline_columns ORDER BY sort_order').all());
});

router.post('/pipeline-columns', authMiddleware, (req, res) => {
  const c = req.body;
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM pipeline_columns').get();
  db.prepare('INSERT INTO pipeline_columns (id, label, color, sort_order) VALUES (?,?,?,?)')
    .run(c.id, c.label, c.color, (maxOrder?.m || 0) + 1);
  res.json({ ok: true });
});

router.put('/pipeline-columns/:id', authMiddleware, (req, res) => {
  const c = req.body;
  db.prepare('UPDATE pipeline_columns SET label=?, color=? WHERE id=?').run(c.label, c.color, req.params.id);
  res.json({ ok: true });
});

router.delete('/pipeline-columns/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM pipeline_columns WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============================================
// Commerciaux CRUD
// ============================================

router.get('/commerciaux', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM commerciaux').all().map(parseCommercial));
});

router.post('/commerciaux', authMiddleware, (req, res) => {
  const c = req.body;
  const hashedPwd = bcrypt.hashSync(c.password, 10);
  db.prepare('INSERT INTO commerciaux (id, prenom, nom, email, telephone, role, password, objectifs) VALUES (?,?,?,?,?,?,?,?)')
    .run(c.id, c.prenom, c.nom, c.email, c.telephone || '', c.role || 'commercial', hashedPwd, JSON.stringify(c.objectifs || {}));
  res.json({ ok: true });
});

router.put('/commerciaux/:id', authMiddleware, (req, res) => {
  const c = req.body;
  // Only update password if provided and non-empty
  if (c.password && c.password.length > 0) {
    const hashedPwd = bcrypt.hashSync(c.password, 10);
    db.prepare('UPDATE commerciaux SET prenom=?, nom=?, email=?, telephone=?, role=?, password=?, objectifs=? WHERE id=?')
      .run(c.prenom, c.nom, c.email, c.telephone || '', c.role, hashedPwd, JSON.stringify(c.objectifs || {}), req.params.id);
  } else {
    db.prepare('UPDATE commerciaux SET prenom=?, nom=?, email=?, telephone=?, role=?, objectifs=? WHERE id=?')
      .run(c.prenom, c.nom, c.email, c.telephone || '', c.role, JSON.stringify(c.objectifs || {}), req.params.id);
  }
  res.json({ ok: true });
});

router.delete('/commerciaux/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM commerciaux WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
