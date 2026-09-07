// Notifications — routes déplacées telles quelles depuis routes.js.
import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.js';
import { asyncHandler, authMiddleware } from '../lib/auth.js';

const router = Router();

// Liste des 50 dernières + compteur de non lues, en une seule réponse (l'en-tête interrogeait
// deux routes toutes les 60 s). Le compteur voyage dans l'en-tête X-Non-Lues pour ne pas
// changer la forme de la liste.
router.get('/notifications/:userId', authMiddleware, asyncHandler(async (req, res) => {
  const [liste, nonLues] = await Promise.all([
    db.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.params.userId]),
    db.query('SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read = false', [req.params.userId]),
  ]);
  res.set('X-Non-Lues', String(parseInt(nonLues.rows[0].count) || 0));
  res.json(liste.rows);
}));

router.get('/notifications/:userId/unread-count', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read = false',
    [req.params.userId]
  );
  res.json({ count: parseInt(result.rows[0].count) });
}));

router.put('/notifications/:notificationId/read', authMiddleware, asyncHandler(async (req, res) => {
  await db.query('UPDATE notifications SET read = true WHERE id = $1', [req.params.notificationId]);
  res.json({ ok: true });
}));

router.put('/notifications/:userId/read-all', authMiddleware, asyncHandler(async (req, res) => {
  await db.query('UPDATE notifications SET read = true WHERE user_id = $1', [req.params.userId]);
  res.json({ ok: true });
}));

// Helper to create a notification
async function createNotification(userId, type, title, message, data = {}) {
  const id = `notif-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.query(
    'INSERT INTO notifications (id, user_id, type, title, message, data, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, userId, type, title, message, JSON.stringify(data), now]
  );
  return id;
}

export default router;
