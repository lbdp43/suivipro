// Helpers partagés (journal) — déplacés tels quels depuis routes.js.
import crypto from 'crypto';
import db from '../db.js';

// Helper to log user activity
export async function logActivity(userId, action, details = '', entityType = '', entityId = '') {
  try {
    await db.query(
      "INSERT INTO activity_log (user_id, action, details, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)",
      [userId, action, details, entityType, entityId]
    );
  } catch (err) {
    console.error('Activity log error:', err.message);
  }
}

// Helper: send a notification to all admins
export async function notifyAdmins(type, title, message, data = {}) {
  try {
    const admins = await db.query("SELECT id FROM commerciaux WHERE actif AND role = 'admin'");
    const now = new Date().toISOString();
    for (const admin of admins.rows) {
      const notifId = `notif-${crypto.randomUUID()}`;
      await db.query(
        'INSERT INTO notifications (id, user_id, type, title, message, data, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [notifId, admin.id, type, title, message, JSON.stringify(data), now]
      );
    }
  } catch (err) { console.error('[notifyAdmins] Erreur:', err.message); }
}
