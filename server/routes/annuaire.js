// Annuaire, types d'entités, règles d'import, data.gouv — routes déplacées telles quelles depuis routes.js.
import { Router } from 'express';
import db from '../db.js';
import { adminOnly, asyncHandler, authMiddleware } from '../lib/auth.js';

const router = Router();

// GET /api/entity-types
router.get('/entity-types', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM entity_types ORDER BY sort_order, label');
  res.json(result.rows);
}));

// POST /api/entity-types
router.post('/entity-types', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { id, label, icon, color, show_in_pipeline } = req.body;
  if (!id || !label) return res.status(400).json({ error: 'ID et label requis' });
  const cleanId = id.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
  // Check if exists
  const existing = await db.query('SELECT id FROM entity_types WHERE id = $1', [cleanId]);
  if (existing.rows.length > 0) return res.status(400).json({ error: 'Ce type existe deja' });
  const maxOrder = await db.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM entity_types');
  await db.query(
    'INSERT INTO entity_types (id, label, icon, color, show_in_pipeline, sort_order, is_default, created_at) VALUES ($1,$2,$3,$4,$5,$6,FALSE,$7)',
    [cleanId, label, icon || 'Tag', color || 'text-gray-600 bg-gray-50 border-gray-200', show_in_pipeline || false, maxOrder.rows[0].next, new Date().toISOString()]
  );
  const created = await db.query('SELECT * FROM entity_types WHERE id = $1', [cleanId]);
  res.json({ ok: true, entity_type: created.rows[0] });
}));

// PUT /api/entity-types/:id
router.put('/entity-types/:id', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { label, icon, color, show_in_pipeline } = req.body;
  await db.query(
    'UPDATE entity_types SET label = COALESCE(NULLIF($1, \'\'), label), icon = COALESCE(NULLIF($2, \'\'), icon), color = COALESCE(NULLIF($3, \'\'), color), show_in_pipeline = COALESCE($4, show_in_pipeline) WHERE id = $5',
    [label || '', icon || '', color || '', show_in_pipeline ?? null, req.params.id]
  );
  const updated = await db.query('SELECT * FROM entity_types WHERE id = $1', [req.params.id]);
  res.json({ ok: true, entity_type: updated.rows[0] });
}));

// DELETE /api/entity-types/:id
router.delete('/entity-types/:id', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  // Don't allow deleting defaults that are in use
  const inUse = await db.query('SELECT COUNT(*) as c FROM prospects WHERE COALESCE(entity_type, \'prospect\') = $1', [req.params.id]);
  if (parseInt(inUse.rows[0].c) > 0) {
    return res.status(400).json({ error: `Ce type est utilise par ${inUse.rows[0].c} fiche(s). Reassignez-les d'abord.` });
  }
  await db.query('DELETE FROM entity_types WHERE id = $1 AND is_default = FALSE', [req.params.id]);
  res.json({ ok: true });
}));

// GET /api/import-rules
router.get('/import-rules', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM sirene_import_rules ORDER BY sort_order ASC, id ASC');
  res.json(result.rows);
}));

// POST /api/import-rules
router.post('/import-rules', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { naf_code, naf_label, entity_type, pipeline_stage, auto_import, commercial_id } = req.body;
  if (!naf_code || !entity_type) return res.status(400).json({ error: 'naf_code et entity_type requis' });

  const now = new Date().toISOString();
  const maxOrder = await db.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM sirene_import_rules');
  const result = await db.query(
    `INSERT INTO sirene_import_rules (naf_code, naf_label, entity_type, pipeline_stage, auto_import, commercial_id, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING *`,
    [naf_code, naf_label || '', entity_type, pipeline_stage || 'nouveau_datagouv', auto_import ?? true, commercial_id || '', maxOrder.rows[0].next, now]
  );
  res.json(result.rows[0]);
}));

// PUT /api/import-rules/:id
router.put('/import-rules/:id', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { naf_code, naf_label, entity_type, pipeline_stage, auto_import, commercial_id } = req.body;
  const now = new Date().toISOString();
  const result = await db.query(
    `UPDATE sirene_import_rules SET naf_code = $2, naf_label = $3, entity_type = $4, pipeline_stage = $5,
     auto_import = $6, commercial_id = $7, updated_at = $8 WHERE id = $1 RETURNING *`,
    [req.params.id, naf_code, naf_label || '', entity_type, pipeline_stage || 'nouveau_datagouv', auto_import ?? true, commercial_id || '', now]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Regle non trouvee' });
  res.json(result.rows[0]);
}));

// DELETE /api/import-rules/:id
router.delete('/import-rules/:id', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM sirene_import_rules WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// GET /api/annuaire - unified view of prospects + clients
router.get('/annuaire', authMiddleware, asyncHandler(async (req, res) => {
  const { entity_type, search, departement, ville, type_etablissement, commercial_id, activity, limit = 200 } = req.query;

  // Query prospects
  let prospectQuery = `SELECT id, nom_etablissement as nom, type_etablissement, ville, code_postal, departement,
    telephone, email, adresse, latitude, longitude, etape_pipeline, commercial_id, notes, siret,
    COALESCE(entity_type, 'prospect') as entity_type, date_creation, date_modification, 'prospect' as source
    FROM prospects WHERE 1=1`;
  const prospectParams = [];

  if (entity_type && entity_type !== 'client') {
    prospectParams.push(entity_type);
    prospectQuery += ` AND COALESCE(entity_type, 'prospect') = $${prospectParams.length}`;
  }
  if (search) {
    prospectParams.push(`%${search}%`);
    prospectQuery += ` AND (nom_etablissement ILIKE $${prospectParams.length} OR ville ILIKE $${prospectParams.length} OR siret ILIKE $${prospectParams.length})`;
  }
  if (departement) {
    prospectParams.push(departement);
    prospectQuery += ` AND departement = $${prospectParams.length}`;
  }
  if (ville) {
    prospectParams.push(`%${ville}%`);
    prospectQuery += ` AND ville ILIKE $${prospectParams.length}`;
  }
  if (type_etablissement) {
    prospectParams.push(type_etablissement);
    prospectQuery += ` AND type_etablissement = $${prospectParams.length}`;
  }
  if (commercial_id) {
    prospectParams.push(commercial_id);
    prospectQuery += ` AND commercial_id = $${prospectParams.length}`;
  }
  if (activity === 'visite') {
    prospectQuery += ` AND id IN (SELECT DISTINCT prospect_id FROM interactions WHERE type = 'VISITE' AND prospect_id IS NOT NULL)`;
  } else if (activity === 'rdv') {
    prospectQuery += ` AND id IN (SELECT DISTINCT prospect_id FROM rdvs WHERE prospect_id IS NOT NULL)`;
  } else if (activity === 'appel') {
    prospectQuery += ` AND id IN (SELECT DISTINCT prospect_id FROM interactions WHERE type = 'APPEL' AND prospect_id IS NOT NULL)`;
  } else if (activity === 'aucune') {
    prospectQuery += ` AND id NOT IN (SELECT DISTINCT prospect_id FROM interactions WHERE prospect_id IS NOT NULL)
      AND id NOT IN (SELECT DISTINCT prospect_id FROM rdvs WHERE prospect_id IS NOT NULL)`;
  }

  // Query clients
  let clientQuery = `SELECT id, nom, type_client as type_etablissement, ville, code_postal,
    CASE WHEN code_postal != '' THEN LEFT(code_postal, 2) ELSE '' END as departement,
    telephone, email, adresse, latitude, longitude, '' as etape_pipeline, commercial_id, notes, siret,
    'client' as entity_type, date_creation, date_modification, 'client' as source
    FROM clients WHERE 1=1`;
  const clientParams = [];

  if (entity_type && entity_type !== 'client') {
    // If filtering by non-client type, skip clients entirely
    clientQuery = null;
  }
  if (clientQuery && entity_type === 'client') {
    // Keep all clients
  }
  if (clientQuery && search) {
    clientParams.push(`%${search}%`);
    clientQuery += ` AND (nom ILIKE $${clientParams.length} OR ville ILIKE $${clientParams.length} OR siret ILIKE $${clientParams.length})`;
  }
  if (clientQuery && departement) {
    clientParams.push(departement);
    clientQuery += ` AND LEFT(code_postal, 2) = $${clientParams.length}`;
  }
  if (clientQuery && ville) {
    clientParams.push(`%${ville}%`);
    clientQuery += ` AND ville ILIKE $${clientParams.length}`;
  }
  if (clientQuery && commercial_id) {
    clientParams.push(commercial_id);
    clientQuery += ` AND commercial_id = $${clientParams.length}`;
  }
  if (clientQuery && activity === 'visite') {
    clientQuery += ` AND id IN (SELECT DISTINCT client_id FROM interactions WHERE type = 'VISITE' AND client_id IS NOT NULL)`;
  } else if (clientQuery && activity === 'rdv') {
    clientQuery += ` AND id IN (SELECT DISTINCT client_id FROM rdvs WHERE client_id IS NOT NULL)`;
  } else if (clientQuery && activity === 'appel') {
    clientQuery += ` AND id IN (SELECT DISTINCT client_id FROM interactions WHERE type = 'APPEL' AND client_id IS NOT NULL)`;
  } else if (clientQuery && activity === 'aucune') {
    clientQuery += ` AND id NOT IN (SELECT DISTINCT client_id FROM interactions WHERE client_id IS NOT NULL)
      AND id NOT IN (SELECT DISTINCT client_id FROM rdvs WHERE client_id IS NOT NULL)`;
  }

  const prospects = await db.query(prospectQuery, prospectParams);
  const clients = clientQuery ? await db.query(clientQuery, clientParams) : { rows: [] };

  // Merge and sort by date_modification DESC
  let allEntries = [...prospects.rows, ...clients.rows];
  allEntries.sort((a, b) => (b.date_modification || '').localeCompare(a.date_modification || ''));
  allEntries = allEntries.slice(0, parseInt(limit) || 200);

  // Stats
  const statsResult = await db.query(`
    SELECT COALESCE(entity_type, 'prospect') as entity_type, COUNT(*) as count FROM prospects GROUP BY COALESCE(entity_type, 'prospect')
  `);
  const clientCount = await db.query('SELECT COUNT(*) as count FROM clients');
  const entityStats = {};
  for (const row of statsResult.rows) {
    entityStats[row.entity_type] = parseInt(row.count);
  }
  entityStats['client'] = parseInt(clientCount.rows[0].count);

  res.json({ entries: allEntries, stats: entityStats });
}));

export default router;
