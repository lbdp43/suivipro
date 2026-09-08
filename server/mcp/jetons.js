// Les accès Claude : un jeton par personne, portant son rôle.
//
// Un jeton partagé entre plusieurs commerciaux ne saurait pas répondre à « mes clients »,
// et le journal ne dirait plus qui a lu quoi. Chaque jeton appartient donc à quelqu'un.
// Le jeton en clair n'existe qu'une fois, à sa création : la base n'en garde que l'empreinte.
import crypto from 'crypto';
import db from '../db.js';

const PREFIXE = 'sp_';
export const DUREE_JOURS = 365;

function empreinteDe(valeur) {
  return crypto.createHash('sha256').update(String(valeur)).digest('hex');
}

/** Un jeton neuf : `sp_` suivi de 40 caractères tirés au hasard. */
function tirerJeton() {
  return PREFIXE + crypto.randomBytes(20).toString('hex');
}

export async function creerJeton({ commercialId, nom, creePar }) {
  const valeur = tirerJeton();
  const id = `mcp-${crypto.randomUUID()}`;
  const maintenant = new Date();
  const expire = new Date(maintenant);
  expire.setDate(expire.getDate() + DUREE_JOURS);
  await db.query(
    `INSERT INTO mcp_jetons (id, commercial_id, nom, empreinte, indice, cree_le, cree_par, expire_le)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, commercialId, nom || 'Accès Claude', empreinteDe(valeur), valeur.slice(-4), maintenant.toISOString(), creePar || '', expire.toISOString()]
  );
  // La seule fois où la valeur complète sort d'ici.
  return { id, valeur, expire_le: expire.toISOString() };
}

/** Le porteur du jeton, ou null : révoqué, expiré et inconnu se répondent pareil. */
export async function porteurDuJeton(valeur) {
  if (!valeur || !String(valeur).startsWith(PREFIXE)) return null;
  const r = await db.query(
    `SELECT j.id, j.commercial_id, j.expire_le, j.revoque_le,
            c.prenom, c.nom, c.role, c.prospection
       FROM mcp_jetons j JOIN commerciaux c ON c.id = j.commercial_id
      WHERE j.empreinte = $1`,
    [empreinteDe(valeur)]
  );
  const j = r.rows[0];
  if (!j || j.revoque_le) return null;
  if (j.expire_le && new Date(j.expire_le) < new Date()) return null;
  return {
    jetonId: j.id,
    id: j.commercial_id,
    prenom: j.prenom,
    nom: j.nom,
    role: j.role,
    faitDeLaProspection: j.role === 'prospection' || !!j.prospection,
  };
}

/** Trace de vie du jeton : ce que l'écran d'administration affiche. */
export async function marquerUtilisation(jetonId) {
  try {
    await db.query('UPDATE mcp_jetons SET derniere_utilisation = $1, appels = appels + 1 WHERE id = $2', [new Date().toISOString(), jetonId]);
  } catch (err) {
    console.error('[MCP] Trace du jeton impossible :', err.message);
  }
}

/** La liste pour l'écran d'administration — jamais la valeur, seulement les quatre derniers. */
export async function listerJetons() {
  const r = await db.query(
    `SELECT j.id, j.commercial_id, j.nom, j.indice, j.cree_le, j.cree_par, j.expire_le,
            j.revoque_le, j.derniere_utilisation, j.appels,
            c.prenom, c.nom AS nom_commercial, c.role
       FROM mcp_jetons j JOIN commerciaux c ON c.id = j.commercial_id
      ORDER BY j.revoque_le NULLS FIRST, j.cree_le DESC`
  );
  return r.rows.map(j => ({ ...j, actif: !j.revoque_le && new Date(j.expire_le) > new Date() }));
}

export async function revoquerJeton(id) {
  const r = await db.query('UPDATE mcp_jetons SET revoque_le = $1 WHERE id = $2 AND revoque_le IS NULL RETURNING id', [new Date().toISOString(), id]);
  return r.rows.length > 0;
}

/** Les jetons qui arrivent à échéance dans moins de 30 jours (pour prévenir l'admin). */
export async function jetonsBientotExpires() {
  const limite = new Date();
  limite.setDate(limite.getDate() + 30);
  const r = await db.query(
    `SELECT j.id, j.nom, j.expire_le, c.prenom, c.nom AS nom_commercial
       FROM mcp_jetons j JOIN commerciaux c ON c.id = j.commercial_id
      WHERE j.revoque_le IS NULL AND j.expire_le <= $1 AND j.expire_le > $2`,
    [limite.toISOString(), new Date().toISOString()]
  );
  return r.rows;
}
