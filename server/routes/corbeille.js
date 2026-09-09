// La corbeille, vue de l'écran d'administration : qui a supprimé quoi, quand, et le
// bouton pour remettre en place. Lecture et restauration sont réservées à
// l'administrateur — c'est lui qui arbitre ce qui revient.
import { Router } from 'express';
import db from '../db.js';
import { asyncHandler, authMiddleware, adminOnly } from '../lib/auth.js';
import { restaurer, Introuvable } from '../lib/corbeille.js';

const router = Router();

const LIMITE_MAX = 500;

router.get('/corbeille', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const limite = Math.min(Number(req.query.limite) || 200, LIMITE_MAX);
  // `contenu` peut peser lourd (toute l'histoire de la fiche) : la liste ne le renvoie
  // pas, seulement de quoi l'afficher et décider.
  const result = await db.query(
    `SELECT c.id, c.type, c.entite_id, c.nom, c.ville, c.commercial_id, c.resume,
            c.supprime_par, c.supprime_le, c.restaure_par, c.restaure_le,
            sup.prenom AS supprime_par_prenom, sup.nom AS supprime_par_nom,
            res.prenom AS restaure_par_prenom, res.nom AS restaure_par_nom
     FROM corbeille c
     LEFT JOIN commerciaux sup ON sup.id = c.supprime_par
     LEFT JOIN commerciaux res ON res.id = c.restaure_par
     ORDER BY c.supprime_le DESC
     LIMIT $1`,
    [limite]
  );
  res.json(result.rows);
}));

router.post('/corbeille/:id/restaurer', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'identifiant invalide' });
  try {
    res.json({ ok: true, ...(await restaurer(id, req.user.id)) });
  } catch (err) {
    if (err instanceof Introuvable) return res.status(404).json({ error: err.message });
    throw err;
  }
}));

export default router;
