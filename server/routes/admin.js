// Administration : statistiques, fil d'activité, planning, visites, journal — routes déplacées telles quelles depuis routes.js.
import { Router } from 'express';
import db from '../db.js';
import { adminOnly, asyncHandler, authMiddleware } from '../lib/auth.js';
import { toLocalDateStr } from '../lib/dates.js';
import { nomZone } from '../lib/geo.js';

const router = Router();

router.get('/admin/stats', authMiddleware, asyncHandler(async (req, res) => {
  const now = new Date();
  const today = toLocalDateStr(now);

  // Get Monday of current week
  const dayOfWeek = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek + 1);
  const weekStart = toLocalDateStr(monday);

  // Start of month
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  // Quatre requêtes groupées par commercial, au lieu d'une dizaine par commercial :
  // clients, visites de la semaine et du mois par type, tâches. Le total de l'équipe est
  // la somme des groupes (les fiches sans commercial comptent dans le total, pas par personne).
  const [commerciaux, clientsAgg, visitesSemaine, visitesMois, tachesAgg] = await Promise.all([
    db.query('SELECT id, prenom, nom, role FROM commerciaux'),
    db.query(
      `SELECT commercial_id, COUNT(*) AS total,
              COUNT(*) FILTER (WHERE statut = 'ACTIF') AS actifs,
              COUNT(*) FILTER (WHERE statut = 'ACTIF' AND next_visit IS NOT NULL AND next_visit < $1) AS en_retard,
              COUNT(*) FILTER (WHERE statut = 'ACTIF' AND next_visit = $1) AS aujourd_hui
       FROM clients GROUP BY commercial_id`, [today]),
    db.query('SELECT commercial_id, type, COUNT(*) AS count FROM interactions WHERE date >= $1 GROUP BY commercial_id, type', [weekStart]),
    db.query('SELECT commercial_id, type, COUNT(*) AS count FROM interactions WHERE date >= $1 GROUP BY commercial_id, type', [monthStart]),
    db.query(
      `SELECT commercial_id,
              COUNT(*) FILTER (WHERE statut <> 'TERMINEE') AS en_cours,
              COUNT(*) FILTER (WHERE statut <> 'TERMINEE' AND date_echeance IS NOT NULL AND date_echeance < $1) AS en_retard,
              COUNT(*) FILTER (WHERE statut = 'TERMINEE' AND completed_at >= $2) AS terminees_mois
       FROM tasks_client GROUP BY commercial_id`, [today, monthStart]),
  ]);
  const n = (v) => parseInt(v || 0, 10) || 0;
  const parType = (rows, commercialId) => {
    const out = {};
    for (const r of rows) if (commercialId === undefined || r.commercial_id === commercialId) out[r.type] = (out[r.type] || 0) + n(r.count);
    return out;
  };
  const somme = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);
  const clientsPar = new Map(clientsAgg.rows.map(r => [r.commercial_id, r]));
  const tachesPar = new Map(tachesAgg.rows.map(r => [r.commercial_id, r]));

  const stats = commerciaux.rows.map(com => {
    const c = clientsPar.get(com.id) || {};
    const t = tachesPar.get(com.id) || {};
    const semaine = parType(visitesSemaine.rows, com.id);
    const mois = parType(visitesMois.rows, com.id);
    return {
      commercial: { id: com.id, prenom: com.prenom, nom: com.nom, role: com.role },
      clients_total: n(c.total),
      clients_actifs: n(c.actifs),
      clients_en_retard: n(c.en_retard),
      clients_aujourd_hui: n(c.aujourd_hui),
      visites_semaine: somme(semaine),
      visites_mois: somme(mois),
      visites_semaine_par_type: semaine,
      visites_mois_par_type: mois,
      taches_en_cours: n(t.en_cours),
      taches_en_retard: n(t.en_retard),
      taches_terminees_mois: n(t.terminees_mois),
    };
  });

  const globalSemaine = parType(visitesSemaine.rows);
  const globalMois = parType(visitesMois.rows);
  res.json({
    global: {
      clients_en_retard: clientsAgg.rows.reduce((a, r) => a + n(r.en_retard), 0),
      clients_aujourd_hui: clientsAgg.rows.reduce((a, r) => a + n(r.aujourd_hui), 0),
      visites_semaine: somme(globalSemaine),
      visites_mois: somme(globalMois),
      visites_semaine_par_type: globalSemaine,
      visites_mois_par_type: globalMois,
    },
    par_commercial: stats,
  });
}));

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
    endDate = toLocalDateStr(now);
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

    const startStr = toLocalDateStr(weekStart);
    const endStr = toLocalDateStr(weekEnd);

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

function memeZone(a, b) {
  const x = nomZone(a).trim().toLowerCase();
  const y = nomZone(b).trim().toLowerCase();
  return x !== '' && x === y;
}

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

export default router;
