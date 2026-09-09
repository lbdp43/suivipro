// Appels, rendez-vous, rappels — routes déplacées telles quelles depuis routes.js.
import { Router } from 'express';
import db from '../db.js';
import { asyncHandler, authMiddleware, isAdmin } from '../lib/auth.js';
import { logActivity } from '../lib/journal.js';
import { cloreActionsAppel } from '../lib/tunnel.js';
import { dateLocale } from '../../shared/regles.js';
import { validateAppointment, validateCall, validateReminder, validationError } from '../lib/validation.js';
import { poserRendezVous, retirerRendezVous } from '../lib/agendaGoogle.js';

const router = Router();

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
  await logActivity(req.user.id, 'appel', `Résultat: ${c.resultat}`, 'call', c.id);
  // L'appel passé clôt les actions « appeler » échues de ce prospect.
  const rappelsTermines = c.resultat === 'email_envoye' ? [] : await cloreActionsAppel(c.prospect_id, dateLocale(new Date()));
  res.json({ ok: true, rappels_termines: rappelsTermines });
}));

router.put('/calls/:id', authMiddleware, asyncHandler(async (req, res) => {
  const c = req.body;
  const errors = validateCall(c);
  if (errors.length > 0) return validationError(res, errors);

  // Même règle qu'à la création : seul un admin peut attribuer l'appel à quelqu'un d'autre.
  const existant = await db.query('SELECT commercial_id FROM calls WHERE id = $1', [req.params.id]);
  if (existant.rows.length === 0) return res.status(404).json({ error: 'Appel introuvable' });
  const commercialId = isAdmin(req) ? (c.commercial_id || existant.rows[0].commercial_id) : existant.rows[0].commercial_id;
  await db.query(
    'UPDATE calls SET prospect_id=$1, commercial_id=$2, date=$3, duree=$4, resultat=$5, notes=$6 WHERE id=$7',
    [c.prospect_id, commercialId, c.date, c.duree || 0, c.resultat, c.notes || '', req.params.id]
  );
  res.json({ ok: true });
}));

router.delete('/calls/:id', authMiddleware, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM calls WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

router.get('/appointments', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM appointments');
  res.json(result.rows);
}));

router.post('/appointments', authMiddleware, asyncHandler(async (req, res) => {
  const a = req.body;
  const errors = validateAppointment(a);
  if (errors.length > 0) return validationError(res, errors);

  const rdvCommercialId = a.commercial_id || req.user.id;
  await db.query(
    'INSERT INTO appointments (id, prospect_id, commercial_id, prospecteur_id, date, heure_debut, heure_fin, lieu, notes, statut, compte_rendu, notes_compte_rendu, created_at, client_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
    [a.id, a.prospect_id || null, rdvCommercialId, a.prospecteur_id || null, a.date, a.heure_debut || '', a.heure_fin || '', a.lieu || '', a.notes || '', a.statut || 'planifie', a.compte_rendu || '', a.notes_compte_rendu || '', a.created_at || new Date().toISOString(), a.client_id || null]
  );

  // Auto-assign prospect to commercial when RDV is created (if not already assigned)
  if (a.prospect_id) {
    const prospect = await db.query("SELECT commercial_id FROM prospects WHERE id = $1", [a.prospect_id]);
    if (prospect.rows.length > 0 && (!prospect.rows[0].commercial_id || prospect.rows[0].commercial_id === '')) {
      await db.query("UPDATE prospects SET commercial_id = $1, date_modification = $2 WHERE id = $3", [rdvCommercialId, new Date().toISOString(), a.prospect_id]);
    }
  }

  await logActivity(req.user.id, 'creation_rdv', `RDV le ${a.date} à ${a.lieu || 'N/A'}`, 'appointment', a.id);
  // L'agenda du commercial reçoit le rendez-vous. Le résultat est renvoyé pour que l'écran
  // sache quoi dire, mais un échec n'empêche jamais l'enregistrement.
  const agenda = await poserRendezVous(a.id);
  res.json({ ok: true, agenda });
}));

router.put('/appointments/:id', authMiddleware, asyncHandler(async (req, res) => {
  const a = req.body;
  const errors = validateAppointment(a);
  if (errors.length > 0) return validationError(res, errors);

  await db.query(
    'UPDATE appointments SET prospect_id=$1, commercial_id=$2, prospecteur_id=$3, date=$4, heure_debut=$5, heure_fin=$6, lieu=$7, notes=$8, statut=$9, compte_rendu=$10, notes_compte_rendu=$11, client_id=$12 WHERE id=$13',
    [a.prospect_id || null, a.commercial_id, a.prospecteur_id || null, a.date, a.heure_debut || '', a.heure_fin || '', a.lieu || '', a.notes || '', a.statut, a.compte_rendu || '', a.notes_compte_rendu || '', a.client_id || null, req.params.id]
  );
  if (a.compte_rendu) {
    await logActivity(req.user.id, 'compte_rendu_rdv', `Compte rendu: ${a.compte_rendu}`, 'appointment', req.params.id);
  } else {
    await logActivity(req.user.id, 'modification_rdv', `RDV le ${a.date}`, 'appointment', req.params.id);
  }
  // L'événement suit : déplacé, complété, retiré de l'agenda si le rendez-vous est annulé
  // ou passé à un autre commercial.
  const agenda = await poserRendezVous(req.params.id);
  res.json({ ok: true, agenda });
}));

// Renvoyer un rendez-vous dans l'agenda : pour ceux d'avant cette bascule, et pour
// réessayer après une reconnexion.
router.post('/appointments/:id/agenda', authMiddleware, asyncHandler(async (req, res) => {
  const r = await db.query('SELECT id FROM appointments WHERE id = $1', [req.params.id]);
  if (r.rows.length === 0) return res.status(404).json({ error: 'Rendez-vous introuvable' });
  return res.json(await poserRendezVous(req.params.id));
}));

router.delete('/appointments/:id', authMiddleware, asyncHandler(async (req, res) => {
  // L'identifiant de l'événement disparaît avec la ligne : on le lit avant de supprimer.
  const avant = await db.query('SELECT * FROM appointments WHERE id = $1', [req.params.id]);
  await db.query('DELETE FROM appointments WHERE id = $1', [req.params.id]);
  if (avant.rows[0]) await retirerRendezVous(avant.rows[0]);
  res.json({ ok: true });
}));

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
    'INSERT INTO reminders (id, prospect_id, commercial_id, date, heure, message, statut, type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [r.id, r.prospect_id, commercialId, r.date, r.heure || '', r.message || '', r.statut || 'actif', r.type || 'appeler']
  );
  res.json({ ok: true });
}));

router.put('/reminders/:id', authMiddleware, asyncHandler(async (req, res) => {
  const r = req.body;
  const errors = validateReminder(r);
  if (errors.length > 0) return validationError(res, errors);

  await db.query(
    'UPDATE reminders SET prospect_id=$1, commercial_id=$2, date=$3, heure=$4, message=$5, statut=$6, type=COALESCE($8, type) WHERE id=$7',
    [r.prospect_id, r.commercial_id, r.date, r.heure || '', r.message || '', r.statut, req.params.id, r.type || null]
  );
  res.json({ ok: true });
}));

router.delete('/reminders/:id', authMiddleware, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM reminders WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

export default router;
