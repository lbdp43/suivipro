// Helpers partagés (auth) — déplacés tels quels depuis routes.js.
import jwt from 'jsonwebtoken';

export const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required. Set it before starting the server.');
  process.exit(1);
}

export function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide' });
  }
}

export function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acces reserve aux administrateurs' });
  }
  next();
}

export function isAdmin(req) {
  return req.user.role === 'admin';
}

// Wrap async route handlers to catch unhandled errors
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
