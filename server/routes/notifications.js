// Notifications — routes déplacées telles quelles depuis routes.js.
import { Router } from 'express';
import db from '../db.js';
import { asyncHandler, authMiddleware } from '../lib/auth.js';

const router = Router();

// Chacun ne voit que ses propres notifications : l'identifiant de l'URL doit être celui du jeton.
function verifierProprietaire(req, res) {
  if (req.params.userId === req.user.id) return true;
  res.status(403).json({ error: 'Accès réservé au destinataire des notifications' });
  return false;
}

// Liste des 50 dernières + compteur de non lues, en une seule réponse (l'en-tête interrogeait
// deux routes toutes les 60 s). Le compteur voyage dans l'en-tête X-Non-Lues pour ne pas
// changer la forme de la liste.
router.get('/notifications/:userId', authMiddleware, asyncHandler(async (req, res) => {
  if (!verifierProprietaire(req, res)) return;
  const [liste, nonLues] = await Promise.all([
    db.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.params.userId]),
    db.query('SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read = false', [req.params.userId]),
  ]);
  res.set('X-Non-Lues', String(parseInt(nonLues.rows[0].count) || 0));
  res.json(liste.rows);
}));

router.get('/notifications/:userId/unread-count', authMiddleware, asyncHandler(async (req, res) => {
  if (!verifierProprietaire(req, res)) return;
  const result = await db.query(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read = false',
    [req.params.userId]
  );
  res.json({ count: parseInt(result.rows[0].count) });
}));

router.put('/notifications/:notificationId/read', authMiddleware, asyncHandler(async (req, res) => {
  await db.query('UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2', [req.params.notificationId, req.user.id]);
  res.json({ ok: true });
}));

router.put('/notifications/:userId/read-all', authMiddleware, asyncHandler(async (req, res) => {
  if (!verifierProprietaire(req, res)) return;
  await db.query('UPDATE notifications SET read = true WHERE user_id = $1', [req.params.userId]);
  res.json({ ok: true });
}));


export default router;
