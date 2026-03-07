// ============================================
// Hub Bridge — Server-side HTTP API
// Allows Hub backend to read/write SuiviPro data
// Auth: Bearer SUIVIPRO_HUB_API_KEY (shared secret)
// ============================================

import { Router } from 'express';
import crypto from 'crypto';
import db from './db.js';

const router = Router();

const SUIVIPRO_HUB_API_KEY = process.env.SUIVIPRO_HUB_API_KEY || '';

// ============================================
// API Key middleware
// ============================================

function hubApiKeyAuth(req, res, next) {
  if (!SUIVIPRO_HUB_API_KEY) {
    return res.status(503).json({ error: 'SUIVIPRO_HUB_API_KEY non configure' });
  }

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token manquant' });

  // Constant-time comparison to prevent timing attacks
  const expected = Buffer.from(SUIVIPRO_HUB_API_KEY);
  const received = Buffer.from(token);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return res.status(401).json({ error: 'Cle API invalide' });
  }

  next();
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ============================================
// Helper: resolve commercial by email or name
// Returns { id, nom, email } or null
// ============================================

async function resolveCommercial(identifier) {
  if (!identifier) return null;

  // Try by email first
  let result = await db.query(
    'SELECT id, nom, email FROM commerciaux WHERE email = $1',
    [identifier]
  );
  if (result.rows.length > 0) return result.rows[0];

  // Try fuzzy email match (local part only)
  const localPart = identifier.split('@')[0];
  if (localPart && identifier.includes('@')) {
    result = await db.query(
      'SELECT id, nom, email FROM commerciaux WHERE email LIKE $1',
      [localPart + '@%']
    );
    if (result.rows.length > 0) return result.rows[0];
  }

  // Try by name (case-insensitive, partial match)
  result = await db.query(
    'SELECT id, nom, email FROM commerciaux WHERE LOWER(nom) LIKE $1',
    ['%' + identifier.toLowerCase() + '%']
  );
  if (result.rows.length > 0) return result.rows[0];

  return null;
}

// ============================================
// Read action handlers (from DB)
// ============================================

async function handleGetCommerciaux() {
  const result = await db.query('SELECT id, nom, email, role FROM commerciaux ORDER BY nom');
  return {
    success: true,
    commerciaux: result.rows.map(c => ({ id: c.id, nom: c.nom, email: c.email, role: c.role })),
  };
}

async function handleGetProspects(payload, userId) {
  let query = 'SELECT p.*, c.nom AS commercial_nom FROM prospects p LEFT JOIN commerciaux c ON p.commercial_id = c.id';
  const params = [];
  const conditions = [];

  // If commercial_email specified, use that commercial's ID instead
  if (payload.commercial_email) {
    const commercial = await resolveCommercial(payload.commercial_email);
    if (!commercial) return { success: false, error: `Commercial "${payload.commercial_email}" introuvable` };
    conditions.push(`p.commercial_id = $${params.length + 1}`);
    params.push(commercial.id);
  } else if (payload.all_commerciaux) {
    // No filter — show all prospects across all commerciaux
  } else if (userId) {
    conditions.push(`p.commercial_id = $${params.length + 1}`);
    params.push(userId);
  }

  if (payload.etape_pipeline) {
    conditions.push(`p.etape_pipeline = $${params.length + 1}`);
    params.push(payload.etape_pipeline);
  }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');

  const result = await db.query(query, params);
  let prospects = result.rows.map(p => ({ ...p, tags: JSON.parse(p.tags || '[]') }));

  if (payload.search) {
    const q = payload.search.toLowerCase();
    prospects = prospects.filter(p =>
      p.nom_etablissement?.toLowerCase().includes(q) ||
      p.nom_contact?.toLowerCase().includes(q) ||
      p.email?.toLowerCase().includes(q) ||
      p.telephone?.includes(q) ||
      p.ville?.toLowerCase().includes(q)
    );
  }

  return { success: true, prospects: prospects.map(sanitizeProspect) };
}

async function handleGetProspect(payload) {
  const id = payload.prospect_id;
  if (!id) return { success: false, error: 'prospect_id requis' };

  const [pRes, cRes, aRes, rRes] = await Promise.all([
    db.query('SELECT p.*, c.nom AS commercial_nom FROM prospects p LEFT JOIN commerciaux c ON p.commercial_id = c.id WHERE p.id = $1', [id]),
    db.query('SELECT cl.*, c.nom AS commercial_nom FROM calls cl LEFT JOIN commerciaux c ON cl.commercial_id = c.id WHERE cl.prospect_id = $1 ORDER BY cl.date DESC', [id]),
    db.query('SELECT a.*, c.nom AS commercial_nom FROM appointments a LEFT JOIN commerciaux c ON a.commercial_id = c.id WHERE a.prospect_id = $1 ORDER BY a.date DESC', [id]),
    db.query('SELECT r.*, c.nom AS commercial_nom FROM reminders r LEFT JOIN commerciaux c ON r.commercial_id = c.id WHERE r.prospect_id = $1 ORDER BY r.date DESC', [id]),
  ]);

  const prospect = pRes.rows[0];
  if (!prospect) return { success: false, error: 'Prospect introuvable' };

  return {
    success: true,
    prospect: sanitizeProspect({ ...prospect, tags: JSON.parse(prospect.tags || '[]') }),
    calls: cRes.rows,
    appointments: aRes.rows,
    reminders: rRes.rows,
  };
}

async function handleGetAppointments(payload) {
  let query = 'SELECT a.*, p.nom_etablissement AS prospect_nom, p.ville AS prospect_ville, c.nom AS commercial_nom FROM appointments a LEFT JOIN prospects p ON a.prospect_id = p.id LEFT JOIN commerciaux c ON a.commercial_id = c.id';
  const params = [];
  const conditions = [];

  // Filter by commercial
  if (payload.commercial_email) {
    const commercial = await resolveCommercial(payload.commercial_email);
    if (!commercial) return { success: false, error: `Commercial "${payload.commercial_email}" introuvable` };
    conditions.push(`a.commercial_id = $${params.length + 1}`);
    params.push(commercial.id);
  }

  if (payload.prospect_id) {
    conditions.push(`a.prospect_id = $${params.length + 1}`);
    params.push(payload.prospect_id);
  }
  if (payload.date_from) {
    conditions.push(`a.date >= $${params.length + 1}`);
    params.push(payload.date_from);
  }
  if (payload.date_to) {
    conditions.push(`a.date <= $${params.length + 1}`);
    params.push(payload.date_to);
  }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY a.date, a.heure_debut';

  const result = await db.query(query, params);
  return { success: true, appointments: result.rows };
}

async function handleGetUpcomingAppointments(payload) {
  const limit = typeof payload.limit === 'number' ? payload.limit : 10;
  const today = new Date().toISOString().slice(0, 10);

  let query = `SELECT a.*, p.nom_etablissement AS prospect_nom, p.ville AS prospect_ville, c.nom AS commercial_nom
     FROM appointments a
     LEFT JOIN prospects p ON a.prospect_id = p.id
     LEFT JOIN commerciaux c ON a.commercial_id = c.id
     WHERE a.date >= $1 AND a.statut != 'annule'`;
  const params = [today];

  // Filter by commercial
  if (payload.commercial_email) {
    const commercial = await resolveCommercial(payload.commercial_email);
    if (!commercial) return { success: false, error: `Commercial "${payload.commercial_email}" introuvable` };
    query += ` AND a.commercial_id = $${params.length + 1}`;
    params.push(commercial.id);
  }

  query += ' ORDER BY a.date, a.heure_debut';
  query += ` LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await db.query(query, params);
  return { success: true, appointments: result.rows };
}

async function handleGetReminders(payload) {
  let query = 'SELECT r.*, p.nom_etablissement AS prospect_nom, c.nom AS commercial_nom FROM reminders r LEFT JOIN prospects p ON r.prospect_id = p.id LEFT JOIN commerciaux c ON r.commercial_id = c.id';
  const params = [];
  const conditions = [];

  // Filter by commercial
  if (payload.commercial_email) {
    const commercial = await resolveCommercial(payload.commercial_email);
    if (!commercial) return { success: false, error: `Commercial "${payload.commercial_email}" introuvable` };
    conditions.push(`r.commercial_id = $${params.length + 1}`);
    params.push(commercial.id);
  }

  if (payload.prospect_id) {
    conditions.push(`r.prospect_id = $${params.length + 1}`);
    params.push(payload.prospect_id);
  }
  if (payload.statut) {
    conditions.push(`r.statut = $${params.length + 1}`);
    params.push(payload.statut);
  }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');

  const result = await db.query(query, params);
  return { success: true, reminders: result.rows };
}

async function handleGetPipelineStages() {
  const result = await db.query('SELECT * FROM pipeline_columns ORDER BY sort_order');
  return { success: true, stages: result.rows };
}

async function handleGetStats(payload) {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Optional: filter by commercial
  let commercialFilter = '';
  const commercialParams = [];
  if (payload.commercial_email) {
    const commercial = await resolveCommercial(payload.commercial_email);
    if (!commercial) return { success: false, error: `Commercial "${payload.commercial_email}" introuvable` };
    commercialFilter = commercial.id;
  }

  const prospectsQuery = commercialFilter
    ? db.query('SELECT id, etape_pipeline FROM prospects WHERE commercial_id = $1', [commercialFilter])
    : db.query('SELECT id, etape_pipeline FROM prospects');

  const appointmentsQuery = commercialFilter
    ? db.query("SELECT id, date FROM appointments WHERE commercial_id = $1 AND date LIKE $2 || '%'", [commercialFilter, thisMonth])
    : db.query("SELECT id, date FROM appointments WHERE date LIKE $1 || '%'", [thisMonth]);

  const remindersQuery = commercialFilter
    ? db.query("SELECT id FROM reminders WHERE commercial_id = $1 AND statut = 'actif'", [commercialFilter])
    : db.query("SELECT id FROM reminders WHERE statut = 'actif'");

  const callsQuery = commercialFilter
    ? db.query("SELECT id, date, resultat FROM calls WHERE commercial_id = $1 AND date LIKE $2 || '%'", [commercialFilter, thisMonth])
    : db.query("SELECT id, date, resultat FROM calls WHERE date LIKE $1 || '%'", [thisMonth]);

  const [prospects, appointments, reminders, calls, columns] = await Promise.all([
    prospectsQuery, appointmentsQuery, remindersQuery, callsQuery,
    db.query('SELECT * FROM pipeline_columns ORDER BY sort_order'),
  ]);

  return {
    success: true,
    stats: {
      commercial: payload.commercial_email || 'tous',
      total_prospects: prospects.rows.length,
      prospects_par_etape: columns.rows.map(col => ({
        etape: col.id,
        label: col.label,
        count: prospects.rows.filter(p => p.etape_pipeline === col.id).length,
      })),
      rdv_ce_mois: appointments.rows.length,
      rappels_actifs: reminders.rows.length,
      appels_ce_mois: calls.rows.length,
    },
  };
}

async function handleSearchProspects(payload) {
  const query = payload.query;
  if (!query) return { success: false, error: 'query requis' };

  const q = `%${query.toLowerCase()}%`;
  const result = await db.query(
    `SELECT p.*, c.nom AS commercial_nom FROM prospects p
     LEFT JOIN commerciaux c ON p.commercial_id = c.id
     WHERE LOWER(p.nom_etablissement) LIKE $1
        OR LOWER(p.nom_contact) LIKE $1
        OR LOWER(p.email) LIKE $1
        OR p.telephone LIKE $1
        OR LOWER(p.ville) LIKE $1
        OR LOWER(p.adresse) LIKE $1`,
    [q]
  );

  return { success: true, prospects: result.rows.map(p => sanitizeProspect({ ...p, tags: JSON.parse(p.tags || '[]') })) };
}

async function handleGetCurrentUser(userEmail) {
  const result = await db.query('SELECT * FROM commerciaux WHERE email = $1', [userEmail]);
  if (result.rows.length === 0) return { success: false, error: 'Utilisateur introuvable' };
  const { password, hub_password, ...safe } = result.rows[0];
  safe.objectifs = JSON.parse(safe.objectifs || '{}');
  return { success: true, user: safe };
}

async function handleGetProspectTimeline(payload) {
  const id = payload.prospect_id;
  if (!id) return { success: false, error: 'prospect_id requis' };

  const pRes = await db.query('SELECT id, nom_etablissement FROM prospects WHERE id = $1', [id]);
  if (pRes.rows.length === 0) return { success: false, error: 'Prospect introuvable' };

  const [calls, appointments, reminders] = await Promise.all([
    db.query(
      `SELECT cl.id, cl.date, cl.duree, cl.resultat, cl.notes, c.nom AS commercial_nom
       FROM calls cl LEFT JOIN commerciaux c ON cl.commercial_id = c.id
       WHERE cl.prospect_id = $1 ORDER BY cl.date DESC`,
      [id]
    ),
    db.query(
      `SELECT a.id, a.date, a.heure_debut, a.heure_fin, a.lieu, a.statut, a.compte_rendu, a.notes, c.nom AS commercial_nom
       FROM appointments a LEFT JOIN commerciaux c ON a.commercial_id = c.id
       WHERE a.prospect_id = $1 ORDER BY a.date DESC`,
      [id]
    ),
    db.query(
      `SELECT r.id, r.date, r.heure, r.message, r.statut, c.nom AS commercial_nom
       FROM reminders r LEFT JOIN commerciaux c ON r.commercial_id = c.id
       WHERE r.prospect_id = $1 ORDER BY r.date DESC`,
      [id]
    ),
  ]);

  // Build unified timeline sorted by date (most recent first)
  const timeline = [];

  for (const c of calls.rows) {
    timeline.push({ type: 'appel', date: c.date, commercial: c.commercial_nom, resultat: c.resultat, notes: c.notes, duree: c.duree });
  }
  for (const a of appointments.rows) {
    timeline.push({ type: 'rdv', date: a.date, heure: a.heure_debut, commercial: a.commercial_nom, statut: a.statut, lieu: a.lieu, compte_rendu: a.compte_rendu, notes: a.notes });
  }
  for (const r of reminders.rows) {
    timeline.push({ type: 'rappel', date: r.date, heure: r.heure, commercial: r.commercial_nom, message: r.message, statut: r.statut });
  }

  timeline.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return {
    success: true,
    prospect: pRes.rows[0].nom_etablissement,
    timeline,
  };
}

// ============================================
// Write action handlers (to DB)
// ============================================

async function handleCreateAppointment(payload, userId, confirmed) {
  const { prospect_id, date, heure_debut, heure_fin, lieu, notes } = payload;
  if (!prospect_id || !date || !heure_debut || !heure_fin) {
    return { success: false, error: 'Champs requis: prospect_id, date, heure_debut, heure_fin' };
  }

  // Allow creating for another commercial
  let targetUserId = userId;
  let targetName = '';
  if (payload.for_commercial_email) {
    const commercial = await resolveCommercial(payload.for_commercial_email);
    if (!commercial) return { success: false, error: `Commercial "${payload.for_commercial_email}" introuvable` };
    targetUserId = commercial.id;
    targetName = commercial.nom;
  }

  const pRes = await db.query('SELECT nom_etablissement FROM prospects WHERE id = $1', [prospect_id]);
  if (pRes.rows.length === 0) return { success: false, error: 'Prospect introuvable' };

  const forText = targetName ? ` (pour ${targetName})` : '';
  const description = `Creer un RDV le ${date} de ${heure_debut} a ${heure_fin} pour "${pRes.rows[0].nom_etablissement}"${forText}`;
  if (!confirmed) return { success: true, needs_confirmation: true, description };

  const id = crypto.randomUUID();
  await db.query(
    'INSERT INTO appointments (id, prospect_id, commercial_id, date, heure_debut, heure_fin, lieu, notes, statut, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [id, prospect_id, targetUserId, date, heure_debut, heure_fin, lieu || '', notes || '', 'planifie', new Date().toISOString()]
  );

  return { success: true, appointment: { id, prospect_id, commercial_id: targetUserId, commercial_nom: targetName, date, heure_debut, heure_fin, lieu: lieu || '', notes: notes || '', statut: 'planifie' } };
}

async function handleUpdateAppointment(payload, confirmed) {
  const { id, ...updates } = payload;
  if (!id) return { success: false, error: 'id requis' };

  const aRes = await db.query('SELECT * FROM appointments WHERE id = $1', [id]);
  if (aRes.rows.length === 0) return { success: false, error: 'RDV introuvable' };
  const existing = aRes.rows[0];

  const pRes = await db.query('SELECT nom_etablissement FROM prospects WHERE id = $1', [existing.prospect_id]);
  const parts = [];
  if (updates.compte_rendu) parts.push(`compte-rendu: ${updates.compte_rendu}`);
  if (updates.notes_compte_rendu) parts.push('notes de compte-rendu');
  if (updates.statut) parts.push(`statut: ${updates.statut}`);

  const description = `Modifier le RDV du ${existing.date} pour "${pRes.rows[0]?.nom_etablissement || 'inconnu'}" — ${parts.join(', ') || 'mise a jour'}`;
  if (!confirmed) return { success: true, needs_confirmation: true, description };

  // Only allow updating specific fields
  const allowedFields = ['compte_rendu', 'notes_compte_rendu', 'statut', 'notes', 'lieu', 'date', 'heure_debut', 'heure_fin'];
  const setClauses = [];
  const params = [];
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      params.push(updates[field]);
      setClauses.push(`${field} = $${params.length}`);
    }
  }
  if (setClauses.length === 0) return { success: false, error: 'Aucun champ a modifier' };

  params.push(id);
  await db.query(`UPDATE appointments SET ${setClauses.join(', ')} WHERE id = $${params.length}`, params);

  return { success: true, appointment: { id, ...updates } };
}

async function handleCreateReminder(payload, userId, confirmed) {
  const { prospect_id, date, heure, message } = payload;
  if (!prospect_id || !date || !heure || !message) {
    return { success: false, error: 'Champs requis: prospect_id, date, heure, message' };
  }

  // Allow creating for another commercial
  let targetUserId = userId;
  let targetName = '';
  if (payload.for_commercial_email) {
    const commercial = await resolveCommercial(payload.for_commercial_email);
    if (!commercial) return { success: false, error: `Commercial "${payload.for_commercial_email}" introuvable` };
    targetUserId = commercial.id;
    targetName = commercial.nom;
  }

  const pRes = await db.query('SELECT nom_etablissement FROM prospects WHERE id = $1', [prospect_id]);
  if (pRes.rows.length === 0) return { success: false, error: 'Prospect introuvable' };

  const forText = targetName ? ` (pour ${targetName})` : '';
  const description = `Creer un rappel le ${date} a ${heure} pour "${pRes.rows[0].nom_etablissement}"${forText} : "${message}"`;
  if (!confirmed) return { success: true, needs_confirmation: true, description };

  const id = crypto.randomUUID();
  await db.query(
    'INSERT INTO reminders (id, prospect_id, commercial_id, date, heure, message, statut) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, prospect_id, targetUserId, date, heure, message, 'actif']
  );

  return { success: true, reminder: { id, prospect_id, commercial_id: targetUserId, commercial_nom: targetName, date, heure, message, statut: 'actif' } };
}

async function handleUpdateProspect(payload, confirmed) {
  const { id, ...updates } = payload;
  if (!id) return { success: false, error: 'id requis' };

  const pRes = await db.query('SELECT * FROM prospects WHERE id = $1', [id]);
  if (pRes.rows.length === 0) return { success: false, error: 'Prospect introuvable' };
  const existing = pRes.rows[0];

  // Don't allow changing id
  delete updates.id;

  // Handle assigning to a different commercial
  let assignDescription = '';
  if (updates.assign_to) {
    const commercial = await resolveCommercial(updates.assign_to);
    if (!commercial) return { success: false, error: `Commercial "${updates.assign_to}" introuvable` };
    updates.commercial_id = commercial.id;
    assignDescription = `, assigner a ${commercial.nom}`;
    delete updates.assign_to;
  }

  const changedFields = Object.keys(updates).filter(k => k !== 'commercial_id' && k !== 'confirmed').join(', ');
  const description = `Modifier "${existing.nom_etablissement}" — ${changedFields ? 'champs: ' + changedFields : ''}${assignDescription}`;
  if (!confirmed) return { success: true, needs_confirmation: true, description };

  const allowedFields = ['nom_etablissement', 'type_etablissement', 'nom_contact', 'telephone', 'email', 'adresse', 'ville', 'code_postal', 'departement', 'etape_pipeline', 'notes', 'score', 'commercial_id'];
  const setClauses = ['date_modification = $1'];
  const params = [new Date().toISOString()];

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      params.push(field === 'tags' ? JSON.stringify(updates[field]) : updates[field]);
      setClauses.push(`${field} = $${params.length}`);
    }
  }

  params.push(id);
  await db.query(`UPDATE prospects SET ${setClauses.join(', ')} WHERE id = $${params.length}`, params);

  return { success: true, prospect: { id, ...updates } };
}

async function handleAssignProspect(payload, confirmed) {
  const { prospect_id, assign_to } = payload;
  if (!prospect_id || !assign_to) return { success: false, error: 'prospect_id et assign_to requis' };

  const pRes = await db.query('SELECT nom_etablissement FROM prospects WHERE id = $1', [prospect_id]);
  if (pRes.rows.length === 0) return { success: false, error: 'Prospect introuvable' };

  const commercial = await resolveCommercial(assign_to);
  if (!commercial) return { success: false, error: `Commercial "${assign_to}" introuvable` };

  const description = `Assigner "${pRes.rows[0].nom_etablissement}" a ${commercial.nom}`;
  if (!confirmed) return { success: true, needs_confirmation: true, description };

  await db.query(
    'UPDATE prospects SET commercial_id = $1, date_modification = $2 WHERE id = $3',
    [commercial.id, new Date().toISOString(), prospect_id]
  );

  return { success: true, prospect: { id: prospect_id, commercial_id: commercial.id, commercial_nom: commercial.nom } };
}

async function handleMoveProspectStage(payload, confirmed) {
  const { prospect_id, stage } = payload;
  if (!prospect_id || !stage) return { success: false, error: 'prospect_id et stage requis' };

  const pRes = await db.query('SELECT nom_etablissement FROM prospects WHERE id = $1', [prospect_id]);
  if (pRes.rows.length === 0) return { success: false, error: 'Prospect introuvable' };

  const colRes = await db.query('SELECT label FROM pipeline_columns WHERE id = $1', [stage]);
  if (colRes.rows.length === 0) return { success: false, error: `Etape "${stage}" invalide` };

  const description = `Deplacer "${pRes.rows[0].nom_etablissement}" vers l'etape "${colRes.rows[0].label}"`;
  if (!confirmed) return { success: true, needs_confirmation: true, description };

  await db.query('UPDATE prospects SET etape_pipeline = $1, date_modification = $2 WHERE id = $3', [stage, new Date().toISOString(), prospect_id]);

  return { success: true, prospect: { id: prospect_id, etape_pipeline: stage } };
}

async function handleCreateCall(payload, userId, confirmed) {
  const { prospect_id, resultat, notes, duree } = payload;
  if (!prospect_id || !resultat) {
    return { success: false, error: 'Champs requis: prospect_id, resultat' };
  }

  // Allow creating for another commercial
  let targetUserId = userId;
  let targetName = '';
  if (payload.for_commercial_email) {
    const commercial = await resolveCommercial(payload.for_commercial_email);
    if (!commercial) return { success: false, error: `Commercial "${payload.for_commercial_email}" introuvable` };
    targetUserId = commercial.id;
    targetName = commercial.nom;
  }

  const pRes = await db.query('SELECT nom_etablissement FROM prospects WHERE id = $1', [prospect_id]);
  if (pRes.rows.length === 0) return { success: false, error: 'Prospect introuvable' };

  const forText = targetName ? ` (par ${targetName})` : '';
  const description = `Enregistrer un appel "${resultat}" pour "${pRes.rows[0].nom_etablissement}"${forText}`;
  if (!confirmed) return { success: true, needs_confirmation: true, description };

  const id = crypto.randomUUID();
  const date = new Date().toISOString();
  await db.query(
    'INSERT INTO calls (id, prospect_id, commercial_id, date, duree, resultat, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, prospect_id, targetUserId, date, duree || 0, resultat, notes || '']
  );

  return { success: true, call: { id, prospect_id, commercial_id: targetUserId, commercial_nom: targetName, date, duree: duree || 0, resultat, notes: notes || '' } };
}

async function handleAddProspectNote(payload, confirmed) {
  const { prospect_id, note, author } = payload;
  if (!prospect_id || !note) return { success: false, error: 'prospect_id et note requis' };

  const pRes = await db.query('SELECT * FROM prospects WHERE id = $1', [prospect_id]);
  if (pRes.rows.length === 0) return { success: false, error: 'Prospect introuvable' };
  const prospect = pRes.rows[0];

  const authorLabel = author || '';
  const description = `Ajouter une note a "${prospect.nom_etablissement}" : "${note.substring(0, 60)}${note.length > 60 ? '...' : ''}"`;
  if (!confirmed) return { success: true, needs_confirmation: true, description };

  const prefix = authorLabel
    ? `[${new Date().toLocaleDateString('fr-FR')} — ${authorLabel}]`
    : `[${new Date().toLocaleDateString('fr-FR')}]`;

  const newNotes = prospect.notes
    ? `${prospect.notes}\n\n${prefix} ${note}`
    : `${prefix} ${note}`;

  await db.query('UPDATE prospects SET notes = $1, date_modification = $2 WHERE id = $3', [newNotes, new Date().toISOString(), prospect_id]);

  return { success: true, prospect: { id: prospect_id, notes: newNotes } };
}

// ============================================
// Helpers
// ============================================

function sanitizeProspect(p) {
  return {
    id: p.id,
    nom_etablissement: p.nom_etablissement,
    type_etablissement: p.type_etablissement,
    nom_contact: p.nom_contact,
    telephone: p.telephone,
    email: p.email,
    adresse: p.adresse,
    ville: p.ville,
    code_postal: p.code_postal,
    departement: p.departement,
    etape_pipeline: p.etape_pipeline,
    notes: p.notes,
    score: p.score,
    date_creation: p.date_creation,
    date_modification: p.date_modification,
    commercial_id: p.commercial_id,
    commercial_nom: p.commercial_nom || undefined,
  };
}

// ============================================
// Action sets
// ============================================

const READ_ACTIONS = new Set([
  'GET_COMMERCIAUX', 'GET_PROSPECTS', 'GET_PROSPECT', 'GET_APPOINTMENTS', 'GET_UPCOMING_APPOINTMENTS',
  'GET_REMINDERS', 'GET_PIPELINE_STAGES', 'GET_STATS', 'SEARCH_PROSPECTS', 'GET_CURRENT_USER',
  'GET_PROSPECT_TIMELINE',
]);

const WRITE_ACTIONS = new Set([
  'CREATE_APPOINTMENT', 'UPDATE_APPOINTMENT', 'CREATE_REMINDER',
  'UPDATE_PROSPECT', 'ASSIGN_PROSPECT', 'MOVE_PROSPECT_STAGE', 'CREATE_CALL', 'ADD_PROSPECT_NOTE',
]);

// ============================================
// Main route: POST /api/hub/bridge
// ============================================

router.post('/hub/bridge', hubApiKeyAuth, asyncHandler(async (req, res) => {
  const { action, payload = {}, user_email } = req.body;

  if (!action) return res.status(400).json({ error: 'action requis' });
  if (!user_email) return res.status(400).json({ error: 'user_email requis' });

  // Resolve user by email (try exact match first, then fuzzy domain match)
  let userResult = await db.query('SELECT id FROM commerciaux WHERE email = $1', [user_email]);
  if (userResult.rows.length === 0) {
    // Try matching by local part (before @) — handles domain differences
    const localPart = user_email.split('@')[0];
    if (localPart) {
      userResult = await db.query('SELECT id FROM commerciaux WHERE email LIKE $1', [localPart + '@%']);
    }
  }
  if (userResult.rows.length === 0) {
    return res.status(404).json({ error: `Utilisateur "${user_email}" introuvable` });
  }
  const userId = userResult.rows[0].id;

  // Read actions
  if (READ_ACTIONS.has(action)) {
    let result;
    switch (action) {
      case 'GET_COMMERCIAUX': result = await handleGetCommerciaux(); break;
      case 'GET_PROSPECTS': result = await handleGetProspects(payload, userId); break;
      case 'GET_PROSPECT': result = await handleGetProspect(payload); break;
      case 'GET_APPOINTMENTS': result = await handleGetAppointments(payload); break;
      case 'GET_UPCOMING_APPOINTMENTS': result = await handleGetUpcomingAppointments(payload); break;
      case 'GET_REMINDERS': result = await handleGetReminders(payload); break;
      case 'GET_PIPELINE_STAGES': result = await handleGetPipelineStages(); break;
      case 'GET_STATS': result = await handleGetStats(payload); break;
      case 'SEARCH_PROSPECTS': result = await handleSearchProspects(payload); break;
      case 'GET_CURRENT_USER': result = await handleGetCurrentUser(user_email); break;
      case 'GET_PROSPECT_TIMELINE': result = await handleGetProspectTimeline(payload); break;
      default: result = { success: false, error: 'Action inconnue' };
    }
    return res.json(result);
  }

  // Write actions
  if (WRITE_ACTIONS.has(action)) {
    const confirmed = payload.confirmed === true;
    let result;

    switch (action) {
      case 'CREATE_APPOINTMENT': result = await handleCreateAppointment(payload, userId, confirmed); break;
      case 'UPDATE_APPOINTMENT': result = await handleUpdateAppointment(payload, confirmed); break;
      case 'CREATE_REMINDER': result = await handleCreateReminder(payload, userId, confirmed); break;
      case 'UPDATE_PROSPECT': result = await handleUpdateProspect(payload, confirmed); break;
      case 'ASSIGN_PROSPECT': result = await handleAssignProspect(payload, confirmed); break;
      case 'MOVE_PROSPECT_STAGE': result = await handleMoveProspectStage(payload, confirmed); break;
      case 'CREATE_CALL': result = await handleCreateCall(payload, userId, confirmed); break;
      case 'ADD_PROSPECT_NOTE': result = await handleAddProspectNote(payload, confirmed); break;
      default: result = { success: false, error: 'Action inconnue' };
    }
    return res.json(result);
  }

  return res.status(400).json({ success: false, error: `Action "${action}" non autorisee` });
}));

export default router;
