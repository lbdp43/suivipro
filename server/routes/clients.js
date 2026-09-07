// Clients, interactions, tâches, conversion prospect → client — routes déplacées telles quelles depuis routes.js.
import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.js';
import { asyncHandler, authMiddleware, isAdmin } from '../lib/auth.js';
import { logActivity } from '../lib/journal.js';
import { EMAIL_RE, PHONE_RE, validationError } from '../lib/validation.js';
import { calculateNextVisit } from '../lib/visites.js';

const router = Router();

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
  const clientId = c.id || `cli-${crypto.randomUUID()}`;

  await db.query(
    `INSERT INTO clients (id, nom, ville, adresse, code_postal, telephone, telephone_mobile, email, contact,
     type_client, statut, commercial_id, next_visit, last_visit, notes, custom_recurrence,
     latitude, longitude, siret, tournee, prospect_id, date_creation, date_modification)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
    [clientId, c.nom, c.ville || '', c.adresse || '', c.code_postal || '', c.telephone || '',
     c.telephone_mobile || '', c.email || '', c.contact || '', c.type_client || 'BAR_RESTAURANT_GENERAL',
     c.statut || 'ACTIF', commercialId, nextVisit || null, c.last_visit || null,
     c.notes || '', c.custom_recurrence !== undefined && c.custom_recurrence !== null ? c.custom_recurrence : null, c.latitude || 0, c.longitude || 0,
     c.siret || '', c.tournee || '', c.prospect_id || null, c.date_creation || now, c.date_modification || now]
  );
  const created = await db.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  await logActivity(req.user.id, 'creation_client', c.nom, 'client', clientId);
  res.json(created.rows[0]);
}));

router.put('/clients/:id', authMiddleware, asyncHandler(async (req, res) => {
  const c = req.body;
  // Only validate required fields for updates (don't block updates due to legacy data)
  if (!c.nom || typeof c.nom !== 'string' || c.nom.trim().length === 0) {
    return validationError(res, ['nom est requis']);
  }

  const actuel = (await db.query('SELECT commercial_id FROM clients WHERE id = $1', [req.params.id])).rows[0];
  if (!actuel) return res.status(404).json({ error: 'Client introuvable' });

  // Toute l'équipe peut corriger n'importe quelle fiche (remplacements, dépannage) : le
  // client reste rattaché à son commercial tant qu'on ne change pas explicitement ce champ.

  // commercial_id absent du corps -> on garde celui en place. Sans ce garde-fou, une
  // simple modification de fiche transferait silencieusement le client a celui qui edite.
  const commercialFinal = c.commercial_id !== undefined
    ? (c.commercial_id || null)
    : (actuel.commercial_id || null);

  const now = new Date().toISOString();
  await db.query(
    `UPDATE clients SET nom=$1, ville=$2, adresse=$3, code_postal=$4, telephone=$5, telephone_mobile=$6,
     email=$7, contact=$8, type_client=$9, statut=$10, commercial_id=$11, next_visit=$12, last_visit=$13,
     notes=$14, custom_recurrence=$15, latitude=$16, longitude=$17, siret=$18, tournee=$19,
     date_modification=$20 WHERE id=$21`,
    [c.nom, c.ville || '', c.adresse || '', c.code_postal || '', c.telephone || '',
     c.telephone_mobile || '', c.email || '', c.contact || '', c.type_client || 'BAR_RESTAURANT_GENERAL',
     c.statut || 'ACTIF', commercialFinal, c.next_visit || null, c.last_visit || null,
     c.notes || '', c.custom_recurrence !== undefined && c.custom_recurrence !== null ? c.custom_recurrence : null, c.latitude || 0, c.longitude || 0,
     c.siret || '', c.tournee || '', c.date_modification || now, req.params.id]
  );
  res.json({ ok: true });
}));

router.delete('/clients/:id', authMiddleware, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

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

  // Transaction: insert interaction + update client's visit dates atomically
  const dbClient = await db.connect();
  try {
    await dbClient.query('BEGIN');

    await dbClient.query(
      `INSERT INTO interactions (id, client_id, commercial_id, type, date, comment, date_creation)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [i.id, i.client_id, commercialId, i.type, i.date || now, i.comment || '', i.date_creation || now]
    );

    // Update client's last_visit and calculate next_visit
    const clientResult = await dbClient.query('SELECT type_client, custom_recurrence, statut FROM clients WHERE id = $1', [i.client_id]);
    if (clientResult.rows.length > 0) {
      const client = clientResult.rows[0];
      const visitDate = i.date || now;
      let nextVisit = null;
      if (client.statut === 'ACTIF') {
        nextVisit = await calculateNextVisit(client.type_client, client.custom_recurrence, visitDate);
      }
      await dbClient.query(
        'UPDATE clients SET last_visit = $1, next_visit = $2, date_modification = $3 WHERE id = $4',
        [visitDate.split('T')[0], nextVisit, now, i.client_id]
      );
    }

    await dbClient.query('COMMIT');
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }

  await logActivity(req.user.id, 'visite_client', `${i.type}${i.comment ? ': ' + i.comment.substring(0, 100) : ''}`, 'client', i.client_id);
  res.json({ ok: true });
}));

router.delete('/interactions/:id', authMiddleware, asyncHandler(async (req, res) => {
  // Get the interaction before deleting to know which client to update
  const interaction = await db.query('SELECT client_id FROM interactions WHERE id = $1', [req.params.id]);

  await db.query('DELETE FROM interactions WHERE id = $1', [req.params.id]);

  // Recalculate last_visit and next_visit for the client
  if (interaction.rows.length > 0) {
    const clientId = interaction.rows[0].client_id;
    const lastInteraction = await db.query(
      "SELECT date FROM interactions WHERE client_id = $1 AND type IN ('VISITE','APPEL') ORDER BY date DESC LIMIT 1",
      [clientId]
    );
    const clientResult = await db.query('SELECT type_client, custom_recurrence, statut FROM clients WHERE id = $1', [clientId]);
    if (clientResult.rows.length > 0) {
      const client = clientResult.rows[0];
      const lastVisit = lastInteraction.rows.length > 0 ? lastInteraction.rows[0].date : null;
      let nextVisit = null;
      if (lastVisit && client.statut === 'ACTIF') {
        nextVisit = await calculateNextVisit(client.type_client, client.custom_recurrence, lastVisit);
      }
      await db.query(
        'UPDATE clients SET last_visit = $1, next_visit = $2, date_modification = $3 WHERE id = $4',
        [lastVisit ? String(lastVisit).split('T')[0] : null, nextVisit, new Date().toISOString(), clientId]
      );
    }
  }

  res.json({ ok: true });
}));

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
  const id = t.id || `task-${crypto.randomUUID()}`;
  await db.query(
    `INSERT INTO tasks_client (id, titre, description, statut, priorite, date_echeance, commercial_id, client_id, date_creation, completed_at, categorie, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, t.titre, t.description || '', t.statut || 'A_FAIRE', t.priorite || 'MOYENNE',
     t.date_echeance || null, t.commercial_id || req.user.id, t.client_id || null,
     now, null, t.categorie || 'general', req.user.id]
  );

  // Pas de notification d'affectation : la tâche apparaît dans « Rappels et tâches » et sur l'accueil.

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

  // Ni « tâche terminée » ni « tâche réaffectée » : rien à régler, donc pas de notification.

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

router.post('/convert-prospect-to-client', authMiddleware, asyncHandler(async (req, res) => {
  const { prospect_id, type_client, tournee, custom_recurrence } = req.body;
  if (!prospect_id) return validationError(res, ['prospect_id est requis']);

  const pResult = await db.query('SELECT * FROM prospects WHERE id = $1', [prospect_id]);
  if (pResult.rows.length === 0) return res.status(404).json({ error: 'Prospect non trouve' });

  const p = pResult.rows[0];
  const now = new Date().toISOString();
  const clientType = type_client || 'BAR_RESTAURANT_GENERAL';
  const nextVisit = await calculateNextVisit(clientType, custom_recurrence || null, null);
  const clientId = `cli-${crypto.randomUUID()}`;

  // Transaction: create client + update prospect atomically
  const dbClient = await db.connect();
  try {
    await dbClient.query('BEGIN');

    await dbClient.query(
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
    await dbClient.query(
      'UPDATE prospects SET etape_pipeline = $1, date_modification = $2 WHERE id = $3',
      ['client_gagne', now, prospect_id]
    );

    await dbClient.query('COMMIT');
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }

  res.json({ ok: true, client_id: clientId });
}));

export default router;
