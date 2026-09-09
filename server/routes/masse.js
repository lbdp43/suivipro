// Les actions en masse : ce qu'on lance depuis une sélection sur la carte.
//
// Trois gestes, et trois droits différents. Attribuer et activer/désactiver appartiennent
// aux commerciaux et à l'administrateur — c'est du travail courant. Mettre à la corbeille
// est réservé à l'administrateur : même si rien n'est détruit (voir lib/corbeille.js),
// faire disparaître cinquante fiches d'un clic n'est pas un geste de tous les jours.
import { Router } from 'express';
import db from '../db.js';
import { asyncHandler, authMiddleware, adminOnly } from '../lib/auth.js';
import { logActivity } from '../lib/journal.js';
import { archiver, Introuvable } from '../lib/corbeille.js';
import { validationError } from '../lib/validation.js';

const router = Router();

/** Au-delà, c'est probablement une fausse manœuvre : on refuse plutôt que de l'exécuter. */
const MAX = 500;

/** La prospection ne réattribue pas les fiches et n'en désactive pas : ce n'est pas son rôle. */
function commercialOuAdmin(req, res, next) {
  if (req.user.role === 'prospection') {
    return res.status(403).json({ error: 'Action reservee aux commerciaux et aux administrateurs' });
  }
  next();
}

/** Des identifiants uniques, non vides, en nombre raisonnable. */
function lireIds(valeur) {
  return [...new Set((Array.isArray(valeur) ? valeur : []).filter(v => typeof v === 'string' && v))];
}

router.post('/masse/attribuer', authMiddleware, commercialOuAdmin, asyncHandler(async (req, res) => {
  const prospects = lireIds(req.body.prospects);
  const clients = lireIds(req.body.clients);
  const commercialId = typeof req.body.commercial_id === 'string' ? req.body.commercial_id : '';
  if (prospects.length + clients.length === 0) return validationError(res, ['aucune fiche selectionnee']);
  if (prospects.length + clients.length > MAX) return validationError(res, [`${MAX} fiches au maximum`]);
  if (!commercialId) return validationError(res, ['commercial_id est requis']);

  const cible = await db.query('SELECT id, prenom, nom FROM commerciaux WHERE id = $1', [commercialId]);
  if (cible.rows.length === 0) return res.status(404).json({ error: 'Commercial introuvable' });

  const maintenant = new Date().toISOString();
  let touches = 0;
  if (prospects.length > 0) {
    const r = await db.query(
      'UPDATE prospects SET commercial_id = $1, date_modification = $2 WHERE id = ANY($3::text[])',
      [commercialId, maintenant, prospects]
    );
    touches += r.rowCount;
  }
  if (clients.length > 0) {
    const r = await db.query(
      'UPDATE clients SET commercial_id = $1, date_modification = $2 WHERE id = ANY($3::text[])',
      [commercialId, maintenant, clients]
    );
    touches += r.rowCount;
  }

  const nom = `${cible.rows[0].prenom} ${cible.rows[0].nom}`.trim();
  await logActivity(req.user.id, 'masse_attribuer', `${touches} fiche(s) attribuee(s) a ${nom}`, 'masse', commercialId);
  res.json({ ok: true, touches });
}));

router.post('/masse/statut-client', authMiddleware, commercialOuAdmin, asyncHandler(async (req, res) => {
  const clients = lireIds(req.body.clients);
  const actif = req.body.actif === true;
  if (clients.length === 0) return validationError(res, ['aucun client selectionne']);
  if (clients.length > MAX) return validationError(res, [`${MAX} fiches au maximum`]);

  const r = await db.query(
    'UPDATE clients SET statut = $1, date_modification = $2 WHERE id = ANY($3::text[])',
    [actif ? 'ACTIF' : 'INACTIF', new Date().toISOString(), clients]
  );
  await logActivity(req.user.id, actif ? 'masse_activer' : 'masse_desactiver',
    `${r.rowCount} client(s) ${actif ? 'reactive(s)' : 'desactive(s)'}`, 'masse', '');
  res.json({ ok: true, touches: r.rowCount });
}));

// Réservé à l'administrateur. Les fiches partent dans la corbeille avec leur histoire :
// une fiche introuvable (déjà supprimée entre-temps) est ignorée, elle n'arrête pas le lot.
router.post('/masse/supprimer', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const prospects = lireIds(req.body.prospects);
  const clients = lireIds(req.body.clients);
  if (prospects.length + clients.length === 0) return validationError(res, ['aucune fiche selectionnee']);
  if (prospects.length + clients.length > MAX) return validationError(res, [`${MAX} fiches au maximum`]);

  let rangees = 0;
  const ignorees = [];
  for (const [type, ids] of [['prospect', prospects], ['client', clients]]) {
    for (const id of ids) {
      try {
        await archiver(type, id, req.user.id);
        rangees += 1;
      } catch (err) {
        if (err instanceof Introuvable) { ignorees.push(id); continue; }
        throw err;
      }
    }
  }
  await logActivity(req.user.id, 'masse_supprimer', `${rangees} fiche(s) rangee(s) dans la corbeille`, 'masse', '');
  res.json({ ok: true, rangees, ignorees });
}));

export default router;
