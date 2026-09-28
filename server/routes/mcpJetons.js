// Les accès Claude, vus depuis l'écran d'administration : créer, lister, révoquer.
// La valeur d'un jeton ne sort d'ici qu'une seule fois, à sa création.
import { Router } from 'express';
import db from '../db.js';
import { adminOnly, asyncHandler, authMiddleware } from '../lib/auth.js';
import { logActivity } from '../lib/journal.js';
import { creerJeton, listerJetons, revoquerJeton, DUREE_JOURS } from '../mcp/jetons.js';
import { FAMILLES, lireRefus } from '../mcp/familles.js';

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
  await logActivity(req.user.id, 'mcp_jeton_cree', `Accès IA créé pour ${personne.rows[0].prenom} ${personne.rows[0].nom}`, 'mcp', jeton.id);
  // La seule réponse qui contient la valeur complète : elle ne repassera plus.
  return res.status(201).json(jeton);
}));

router.delete('/mcp/jetons/:id', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const fait = await revoquerJeton(req.params.id);
  if (!fait) return res.status(404).json({ error: 'Accès introuvable ou déjà révoqué' });
  await logActivity(req.user.id, 'mcp_jeton_revoque', 'Accès IA révoqué', 'mcp', req.params.id);
  return res.json({ ok: true });
}));

// Ce que l'IA peut faire pour chacun : les familles d'outils, et celles coupées par personne.
router.get('/mcp/droits', authMiddleware, adminOnly, asyncHandler(async (_req, res) => {
  const r = await db.query("SELECT id, prenom, nom, role, prospection, ia_refus FROM commerciaux WHERE actif ORDER BY prenom, nom");
  res.json({
    familles: FAMILLES.map(({ cle, libelle, description, ecrit }) => ({ cle, libelle, description, ecrit })),
    // Ce que chaque rôle n'a jamais, quoi qu'on coche (la prospection ne lit pas les clients).
    horsRole: { prospection: ['lire_clients', 'modifier_clients'] },
    personnes: r.rows.map(p => ({ id: p.id, prenom: p.prenom, nom: p.nom, role: p.role, prospection: !!p.prospection, refus: lireRefus(p.ia_refus) })),
  });
}));

router.put('/mcp/droits/:commercialId', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const refus = lireRefus(req.body?.refus);
  const r = await db.query('UPDATE commerciaux SET ia_refus = $1 WHERE id = $2 RETURNING prenom, nom', [JSON.stringify(refus), req.params.commercialId]);
  if (r.rows.length === 0) return res.status(404).json({ error: 'Personne introuvable' });
  const coupees = FAMILLES.filter(f => refus.includes(f.cle)).map(f => f.libelle.toLowerCase());
  await logActivity(req.user.id, 'mcp_droits', `Accès IA de ${r.rows[0].prenom} ${r.rows[0].nom} : ${coupees.length ? `coupé — ${coupees.join(', ')}` : 'tout ouvert'}`, 'commercial', req.params.commercialId);
  return res.json({ ok: true, refus });
}));

export default router;
