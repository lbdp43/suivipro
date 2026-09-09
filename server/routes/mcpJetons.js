// Les accès Claude, vus depuis l'écran d'administration : créer, lister, révoquer.
// La valeur d'un jeton ne sort d'ici qu'une seule fois, à sa création.
import { Router } from 'express';
import db from '../db.js';
import { adminOnly, asyncHandler, authMiddleware } from '../lib/auth.js';
import { logActivity } from '../lib/journal.js';
import { creerJeton, listerJetons, revoquerJeton, DUREE_JOURS } from '../mcp/jetons.js';

const router = Router();

router.get('/mcp/jetons', authMiddleware, adminOnly, asyncHandler(async (_req, res) => {
  res.json({ jetons: await listerJetons(), duree_jours: DUREE_JOURS });
}));

router.post('/mcp/jetons', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { commercial_id: commercialId, nom } = req.body || {};
  if (!commercialId) return res.status(400).json({ error: 'Choisissez la personne à qui cet accès appartient' });
  // Un accès Claude est une autorisation vivante : retiré de l'équipe, on n'en redonne pas.
  const personne = await db.query('SELECT prenom, nom FROM commerciaux WHERE id = $1 AND actif', [commercialId]);
  if (personne.rows.length === 0) return res.status(404).json({ error: 'Personne introuvable' });

  const jeton = await creerJeton({ commercialId, nom, creePar: req.user.id });
  await logActivity(req.user.id, 'mcp_jeton_cree', `Accès Claude créé pour ${personne.rows[0].prenom} ${personne.rows[0].nom}`, 'mcp', jeton.id);
  // La seule réponse qui contient la valeur complète : elle ne repassera plus.
  return res.status(201).json(jeton);
}));

router.delete('/mcp/jetons/:id', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const fait = await revoquerJeton(req.params.id);
  if (!fait) return res.status(404).json({ error: 'Accès introuvable ou déjà révoqué' });
  await logActivity(req.user.id, 'mcp_jeton_revoque', 'Accès Claude révoqué', 'mcp', req.params.id);
  return res.json({ ok: true });
}));

export default router;
