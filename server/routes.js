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

router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  const result = await db.query('SELECT * FROM commerciaux WHERE email = $1', [email]);
  const user = result.rows[0];
  if (!user) return res.status(401).json({ error: 'Identifiants incorrects' });

  // Support both hashed and legacy plaintext passwords
  let valid = false;
  if (user.password.startsWith('$2')) {
    valid = bcrypt.compareSync(password, user.password);
  } else {
    valid = user.password === password;
    // Upgrade to hash
    if (valid) {
      await db.query('UPDATE commerciaux SET password = $1 WHERE id = $2', [bcrypt.hashSync(password, 10), user.id]);
    }
  }
  if (!valid) return res.status(401).json({ error: 'Identifiants incorrects' });

  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  const { password: _, ...userWithoutPwd } = user;
  userWithoutPwd.objectifs = JSON.parse(userWithoutPwd.objectifs || '{}');
  res.json({ token, user: userWithoutPwd });
});

router.get('/auth/me', authMiddleware, async (req, res) => {
  const result = await db.query('SELECT * FROM commerciaux WHERE id = $1', [req.user.id]);
  const user = result.rows[0];
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

router.get('/state', authMiddleware, async (req, res) => {
  const [prospects, calls, appointments, reminders, commerciaux, tags, emailTemplates, pipelineColumns] = await Promise.all([
    db.query('SELECT * FROM prospects'),
    db.query('SELECT * FROM calls'),
    db.query('SELECT * FROM appointments'),
    db.query('SELECT * FROM reminders'),
    db.query('SELECT * FROM commerciaux'),
    db.query('SELECT * FROM tags'),
    db.query('SELECT * FROM email_templates'),
    db.query('SELECT * FROM pipeline_columns ORDER BY sort_order'),
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
  });
});

// ============================================
// Prospects CRUD
// ============================================

router.get('/prospects', authMiddleware, async (req, res) => {
  const result = await db.query('SELECT * FROM prospects');
  res.json(result.rows.map(parseProspect));
});

router.post('/prospects', authMiddleware, async (req, res) => {
  const p = req.body;
  await db.query(
    `INSERT INTO prospects (id, nom_etablissement, type_etablissement, nom_contact, telephone, email, adresse, ville, code_postal, departement, secteur, latitude, longitude, etape_pipeline, tags, commercial_id, notes, date_creation, date_modification, score)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [p.id, p.nom_etablissement, p.type_etablissement, p.nom_contact || '', p.telephone || '', p.email || '', p.adresse || '', p.ville || '', p.code_postal || '', p.departement || '', p.secteur || '', p.latitude || 0, p.longitude || 0, p.etape_pipeline || 'nouveau', JSON.stringify(p.tags || []), p.commercial_id, p.notes || '', p.date_creation, p.date_modification, p.score || 50]
  );
  res.json({ ok: true });
});

router.put('/prospects/:id', authMiddleware, async (req, res) => {
  const p = req.body;
  await db.query(
    `UPDATE prospects SET nom_etablissement=$1, type_etablissement=$2, nom_contact=$3, telephone=$4, email=$5, adresse=$6, ville=$7, code_postal=$8, departement=$9, secteur=$10, latitude=$11, longitude=$12, etape_pipeline=$13, tags=$14, commercial_id=$15, notes=$16, date_modification=$17, score=$18 WHERE id=$19`,
    [p.nom_etablissement, p.type_etablissement, p.nom_contact || '', p.telephone || '', p.email || '', p.adresse || '', p.ville || '', p.code_postal || '', p.departement || '', p.secteur || '', p.latitude || 0, p.longitude || 0, p.etape_pipeline, JSON.stringify(p.tags || []), p.commercial_id, p.notes || '', p.date_modification, p.score || 50, req.params.id]
  );
  res.json({ ok: true });
});

router.delete('/prospects/:id', authMiddleware, async (req, res) => {
  await db.query('DELETE FROM prospects WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Bulk import
router.post('/prospects/import', authMiddleware, async (req, res) => {
  const prospects = req.body;
  if (!prospects || prospects.length === 0) return res.json({ ok: true, count: 0 });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Batch insert: build multi-row VALUES for chunks of 50
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
          p.commercial_id, p.notes || '', p.date_creation, p.date_modification, p.score || 50
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
});

// ============================================
// Calls CRUD
// ============================================

router.get('/calls', authMiddleware, async (req, res) => {
  const result = await db.query('SELECT * FROM calls');
  res.json(result.rows);
});

router.post('/calls', authMiddleware, async (req, res) => {
  const c = req.body;
  await db.query(
    'INSERT INTO calls (id, prospect_id, commercial_id, date, duree, resultat, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [c.id, c.prospect_id, c.commercial_id, c.date, c.duree || 0, c.resultat, c.notes || '']
  );
  res.json({ ok: true });
});

router.put('/calls/:id', authMiddleware, async (req, res) => {
  const c = req.body;
  await db.query(
    'UPDATE calls SET prospect_id=$1, commercial_id=$2, date=$3, duree=$4, resultat=$5, notes=$6 WHERE id=$7',
    [c.prospect_id, c.commercial_id, c.date, c.duree || 0, c.resultat, c.notes || '', req.params.id]
  );
  res.json({ ok: true });
});

router.delete('/calls/:id', authMiddleware, async (req, res) => {
  await db.query('DELETE FROM calls WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============================================
// Appointments CRUD
// ============================================

router.get('/appointments', authMiddleware, async (req, res) => {
  const result = await db.query('SELECT * FROM appointments');
  res.json(result.rows);
});

router.post('/appointments', authMiddleware, async (req, res) => {
  const a = req.body;
  await db.query(
    'INSERT INTO appointments (id, prospect_id, commercial_id, prospecteur_id, date, heure_debut, heure_fin, lieu, notes, statut) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [a.id, a.prospect_id, a.commercial_id, a.prospecteur_id || null, a.date, a.heure_debut || '', a.heure_fin || '', a.lieu || '', a.notes || '', a.statut || 'planifie']
  );
  res.json({ ok: true });
});

router.put('/appointments/:id', authMiddleware, async (req, res) => {
  const a = req.body;
  await db.query(
    'UPDATE appointments SET prospect_id=$1, commercial_id=$2, prospecteur_id=$3, date=$4, heure_debut=$5, heure_fin=$6, lieu=$7, notes=$8, statut=$9 WHERE id=$10',
    [a.prospect_id, a.commercial_id, a.prospecteur_id || null, a.date, a.heure_debut || '', a.heure_fin || '', a.lieu || '', a.notes || '', a.statut, req.params.id]
  );
  res.json({ ok: true });
});

router.delete('/appointments/:id', authMiddleware, async (req, res) => {
  await db.query('DELETE FROM appointments WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============================================
// Reminders CRUD
// ============================================

router.get('/reminders', authMiddleware, async (req, res) => {
  const result = await db.query('SELECT * FROM reminders');
  res.json(result.rows);
});

router.post('/reminders', authMiddleware, async (req, res) => {
  const r = req.body;
  await db.query(
    'INSERT INTO reminders (id, prospect_id, commercial_id, date, heure, message, statut) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [r.id, r.prospect_id, r.commercial_id, r.date, r.heure || '', r.message || '', r.statut || 'actif']
  );
  res.json({ ok: true });
});

router.put('/reminders/:id', authMiddleware, async (req, res) => {
  const r = req.body;
  await db.query(
    'UPDATE reminders SET prospect_id=$1, commercial_id=$2, date=$3, heure=$4, message=$5, statut=$6 WHERE id=$7',
    [r.prospect_id, r.commercial_id, r.date, r.heure || '', r.message || '', r.statut, req.params.id]
  );
  res.json({ ok: true });
});

router.delete('/reminders/:id', authMiddleware, async (req, res) => {
  await db.query('DELETE FROM reminders WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============================================
// Tags CRUD
// ============================================

router.get('/tags', authMiddleware, async (req, res) => {
  const result = await db.query('SELECT * FROM tags');
  res.json(result.rows);
});

router.post('/tags', authMiddleware, async (req, res) => {
  const t = req.body;
  await db.query('INSERT INTO tags (id, nom, couleur) VALUES ($1,$2,$3)', [t.id, t.nom, t.couleur]);
  res.json({ ok: true });
});

router.put('/tags/:id', authMiddleware, async (req, res) => {
  const t = req.body;
  await db.query('UPDATE tags SET nom=$1, couleur=$2 WHERE id=$3', [t.nom, t.couleur, req.params.id]);
  res.json({ ok: true });
});

router.delete('/tags/:id', authMiddleware, async (req, res) => {
  await db.query('DELETE FROM tags WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============================================
// Email templates CRUD
// ============================================

router.get('/email-templates', authMiddleware, async (req, res) => {
  const result = await db.query('SELECT * FROM email_templates');
  res.json(result.rows);
});

router.post('/email-templates', authMiddleware, async (req, res) => {
  const e = req.body;
  await db.query(
    'INSERT INTO email_templates (id, nom, sujet, corps, type) VALUES ($1,$2,$3,$4,$5)',
    [e.id, e.nom, e.sujet || '', e.corps || '', e.type || '']
  );
  res.json({ ok: true });
});

router.put('/email-templates/:id', authMiddleware, async (req, res) => {
  const e = req.body;
  await db.query(
    'UPDATE email_templates SET nom=$1, sujet=$2, corps=$3, type=$4 WHERE id=$5',
    [e.nom, e.sujet || '', e.corps || '', e.type || '', req.params.id]
  );
  res.json({ ok: true });
});

router.delete('/email-templates/:id', authMiddleware, async (req, res) => {
  await db.query('DELETE FROM email_templates WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============================================
// Pipeline columns CRUD
// ============================================

router.get('/pipeline-columns', authMiddleware, async (req, res) => {
  const result = await db.query('SELECT * FROM pipeline_columns ORDER BY sort_order');
  res.json(result.rows);
});

router.post('/pipeline-columns', authMiddleware, async (req, res) => {
  const c = req.body;
  const maxOrder = await db.query('SELECT MAX(sort_order) as m FROM pipeline_columns');
  await db.query(
    'INSERT INTO pipeline_columns (id, label, color, sort_order) VALUES ($1,$2,$3,$4)',
    [c.id, c.label, c.color, (maxOrder.rows[0]?.m || 0) + 1]
  );
  res.json({ ok: true });
});

router.put('/pipeline-columns/:id', authMiddleware, async (req, res) => {
  const c = req.body;
  await db.query('UPDATE pipeline_columns SET label=$1, color=$2 WHERE id=$3', [c.label, c.color, req.params.id]);
  res.json({ ok: true });
});

router.delete('/pipeline-columns/:id', authMiddleware, async (req, res) => {
  await db.query('DELETE FROM pipeline_columns WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============================================
// Commerciaux CRUD
// ============================================

router.get('/commerciaux', authMiddleware, async (req, res) => {
  const result = await db.query('SELECT * FROM commerciaux');
  res.json(result.rows.map(parseCommercial));
});

router.post('/commerciaux', authMiddleware, async (req, res) => {
  const c = req.body;
  const hashedPwd = bcrypt.hashSync(c.password, 10);
  await db.query(
    'INSERT INTO commerciaux (id, prenom, nom, email, telephone, role, password, objectifs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [c.id, c.prenom, c.nom, c.email, c.telephone || '', c.role || 'commercial', hashedPwd, JSON.stringify(c.objectifs || {})]
  );
  res.json({ ok: true });
});

router.put('/commerciaux/:id', authMiddleware, async (req, res) => {
  const c = req.body;
  // Only update password if provided and non-empty
  if (c.password && c.password.length > 0) {
    const hashedPwd = bcrypt.hashSync(c.password, 10);
    await db.query(
      'UPDATE commerciaux SET prenom=$1, nom=$2, email=$3, telephone=$4, role=$5, password=$6, objectifs=$7 WHERE id=$8',
      [c.prenom, c.nom, c.email, c.telephone || '', c.role, hashedPwd, JSON.stringify(c.objectifs || {}), req.params.id]
    );
  } else {
    await db.query(
      'UPDATE commerciaux SET prenom=$1, nom=$2, email=$3, telephone=$4, role=$5, objectifs=$6 WHERE id=$7',
      [c.prenom, c.nom, c.email, c.telephone || '', c.role, JSON.stringify(c.objectifs || {}), req.params.id]
    );
  }
  res.json({ ok: true });
});

router.delete('/commerciaux/:id', authMiddleware, async (req, res) => {
  await db.query('DELETE FROM commerciaux WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

export default router;
