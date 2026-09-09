// Helpers partagés (auth) — déplacés tels quels depuis routes.js.
import jwt from 'jsonwebtoken';
import db from '../db.js';

export const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required. Set it before starting the server.');
  process.exit(1);
}

// Retirer quelqu'un de l'équipe lui refuse la connexion, mais son jeton déjà émis vaut sept
// jours : sans ce contrôle, il garderait l'accès complet une semaine durant. On tient donc la
// liste des comptes retirés, rafraîchie une fois par demi-minute — une requête par minute,
// et une simple appartenance à un ensemble à chaque appel.
const RAFRAICHISSEMENT_MS = 30000;
let retires = { le: 0, ids: null };

async function comptesRetires() {
  if (retires.ids && Date.now() - retires.le < RAFRAICHISSEMENT_MS) return retires.ids;
  try {
    const r = await db.query('SELECT id FROM commerciaux WHERE actif = FALSE');
    retires = { le: Date.now(), ids: new Set(r.rows.map(x => x.id)) };
  } catch {
    // Base injoignable : on garde la liste précédente plutôt que de bloquer toute l'équipe.
    // Au tout premier appel il n'y en a pas — personne n'est alors retiré, ce qui est le
    // cas de figure de très loin le plus fréquent.
    if (!retires.ids) retires = { le: 0, ids: new Set() };
  }
  return retires.ids;
}

/** À appeler quand un compte est retiré ou remis : le contrôle ne doit pas attendre. */
export function oublierLesComptesRetires() {
  retires = { le: 0, ids: retires.ids };
}

export async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token invalide' });
  }
  if ((await comptesRetires()).has(decoded.id)) {
    return res.status(401).json({ error: "Ce compte a ete retire de l'equipe" });
  }
  req.user = decoded;
  next();
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
