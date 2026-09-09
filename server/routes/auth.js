// Connexion et compte — routes déplacées telles quelles depuis routes.js.
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { JWT_SECRET, asyncHandler, authMiddleware } from '../lib/auth.js';
import { logActivity } from '../lib/journal.js';

const router = Router();

router.post('/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  const result = await db.query('SELECT * FROM commerciaux WHERE email = $1', [email]);
  const user = result.rows[0];
  if (!user) return res.status(401).json({ error: 'Identifiants incorrects' });
  // Un compte retiré de l'équipe ne se connecte plus, même avec le bon mot de passe.
  if (user.actif === false) return res.status(403).json({ error: "Ce compte a ete retire de l'equipe" });

  // bcrypt only — no plaintext fallback
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Identifiants incorrects' });

  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  const { password: _, ...userWithoutPwd } = user;
  userWithoutPwd.objectifs = JSON.parse(userWithoutPwd.objectifs || '{}');

  // Log connexion
  await db.query("UPDATE commerciaux SET last_seen = NOW() WHERE id = $1", [user.id]);
  await logActivity(user.id, 'connexion', 'Connexion à l\'application');

  res.json({ token, user: userWithoutPwd });
}));

router.get('/auth/me', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM commerciaux WHERE id = $1', [req.user.id]);
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: 'Utilisateur non trouve' });
  // Update last_seen on each app access
  await db.query("UPDATE commerciaux SET last_seen = NOW() WHERE id = $1", [req.user.id]);
  const { password: _, ...u } = user;
  u.objectifs = JSON.parse(u.objectifs || '{}');
  res.json(u);
}));

export default router;
