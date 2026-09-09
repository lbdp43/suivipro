// Boîte de prospection : ce que l'équipe partage (WhatsApp, Google Maps, Instagram, Facebook,
// TikTok, un article, un simple texte) attend ici d'être qualifié. Un signalement devient un
// prospect, se rattache à une fiche existante, ou est ignoré.
import { Router } from 'express';
import db from '../db.js';
import { asyncHandler, authMiddleware, adminOnly } from '../lib/auth.js';
import { dateLocale } from '../../shared/regles.js';
import { creerProspectDepuisFiche, nomComplet } from '../lib/fichePartagee.js';
import { deposer, DepotRefuse } from '../lib/boiteProspection.js';
import { noter, oublier } from '../lib/ecartes.js';
import { logActivity } from '../lib/journal.js';
import { validationError } from '../lib/validation.js';
import { parseProspect } from '../lib/parse.js';

const router = Router();

/** Au-delà, c'est probablement une fausse manœuvre : on refuse plutôt que de l'exécuter. */
const MASSE_MAX = 200;

export function parseSignalement(s) {
  let fiche = {};
  try { fiche = JSON.parse(s.fiche || '{}'); } catch { fiche = {}; }
  let photos = s.photos;
  if (typeof photos === 'string') { try { photos = JSON.parse(photos); } catch { photos = []; } }
  return { ...s, fiche, photos: Array.isArray(photos) ? photos.filter(p => p && p.id) : [] };
}

// Les signalements avec la liste de leurs photos (sans le contenu, qui se lit à part).
export const SELECT_SIGNALEMENTS = `SELECT s.*, COALESCE((
    SELECT json_agg(json_build_object('id', p.id, 'type_mime', p.type_mime, 'taille', p.taille) ORDER BY p.created_at)
    FROM signalement_photos p WHERE p.signalement_id = s.id), '[]'::json) AS photos
  FROM signalements s`;

// Le dépôt lui-même vit dans lib/boiteProspection.js : l'application et Claude y passent
// tous les deux, pour qu'un seul code lise le partage, cherche les doublons et prévienne.
router.post('/signalements', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const { id } = await deposer({
      texte: req.body.texte,
      photos: req.body.photos,
      commentaire: req.body.commentaire,
      commercialId: req.body.commercial_id,
      parQui: req.user.id,
    });
    const cree = await db.query(`${SELECT_SIGNALEMENTS} WHERE s.id = $1`, [id]);
    res.json(parseSignalement(cree.rows[0]));
  } catch (err) {
    if (err instanceof DepotRefuse) {
      return err.status === 400 ? validationError(res, [err.message]) : res.status(err.status).json({ error: err.message });
    }
    throw err;
  }
}));

router.get('/signalements', authMiddleware, asyncHandler(async (_req, res) => {
  const r = await db.query(`${SELECT_SIGNALEMENTS} ORDER BY s.created_at DESC`);
  res.json(r.rows.map(parseSignalement));
}));

// Une photo : l'image elle-même, mise en cache par le navigateur (elle ne change jamais).
router.get('/signalements/:id/photos/:photoId', authMiddleware, asyncHandler(async (req, res) => {
  const r = await db.query('SELECT type_mime, contenu FROM signalement_photos WHERE id = $1 AND signalement_id = $2', [req.params.photoId, req.params.id]);
  if (r.rows.length === 0) return res.status(404).json({ error: 'Photo introuvable' });
  const buffer = Buffer.from(r.rows[0].contenu, 'base64');
  res.setHeader('Content-Type', r.rows[0].type_mime || 'image/jpeg');
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(buffer);
}));

/** La phrase d'origine qu'on recopie dans les notes de la fiche créée ou rattachée. */
async function origineDe(s) {
  const auteur = await nomComplet(s.partage_par);
  return [
    `Signalé par ${auteur} le ${dateLocale(new Date(s.created_at))}${s.lien ? ` : ${s.lien}` : ''}.`,
    s.commentaire ? `Commentaire : ${s.commentaire}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Un signalement devient un prospect.
 *
 * `corrections` vient de la fenêtre de création, où la fiche a pu être retouchée ; en lot,
 * il n'y en a pas et la fiche part telle qu'elle a été déposée. Le prospect revient au
 * destinataire du signalement quand il y en a un, sinon à celui qui qualifie.
 */
async function creerDepuisSignalement(s, corrections, utilisateurId) {
  const fiche = { ...s.fiche, ...corrections, source_url: s.lien || s.fiche.source_url || '' };
  const commercialId = String(corrections.commercial_id || s.commercial_id || utilisateurId);
  const prospect = await creerProspectDepuisFiche(fiche, {
    auteurId: utilisateurId, commercialId, notes: [await origineDe(s)],
  });
  await db.query(
    "UPDATE signalements SET statut = 'traite', prospect_id = $1, client_id = '', traite_par = $2, traite_le = $3 WHERE id = $4",
    [prospect.id, utilisateurId, new Date().toISOString(), s.id]
  );
  const maj = await db.query(`${SELECT_SIGNALEMENTS} WHERE s.id = $1`, [s.id]);
  return { prospect, signalement: parseSignalement(maj.rows[0]) };
}

/** L'identité d'un signalement écarté, telle qu'on la retrouvera quand il reviendra. */
function noterEcart(s, motif, parQui) {
  return noter({
    origine: 'signalement',
    origineId: s.id,
    nom: s.titre || s.fiche?.nom_etablissement || '',
    ville: s.fiche?.ville || '',
    telephone: s.fiche?.telephone || '',
    lien: s.lien || '',
    motif,
    parQui,
  });
}

// Qualifier : créer le prospect (fiche corrigée à l'écran), rattacher à une fiche existante,
// ignorer, ou rouvrir.
router.patch('/signalements/:id', authMiddleware, asyncHandler(async (req, res) => {
  const existant = await db.query('SELECT * FROM signalements WHERE id = $1', [req.params.id]);
  if (existant.rows.length === 0) return res.status(404).json({ error: 'Signalement introuvable' });
  const s = parseSignalement(existant.rows[0]);
  const action = String(req.body.action || '');
  const now = new Date().toISOString();
  const origine = await origineDe(s);

  if (action === 'creer') {
    if (s.statut === 'traite' && s.prospect_id) return res.status(409).json({ error: 'Ce signalement a déjà donné un prospect' });
    const corrections = req.body.prospect || {};
    if (!String({ ...s.fiche, ...corrections }.nom_etablissement || '').trim()) {
      return validationError(res, ['Le nom de l\'établissement est requis']);
    }
    const { prospect, signalement } = await creerDepuisSignalement(s, corrections, req.user.id);
    return res.json({ signalement, prospect });
  }

  if (action === 'rattacher') {
    const prospectId = String(req.body.prospect_id || '');
    const clientId = String(req.body.client_id || '');
    if (!prospectId && !clientId) return validationError(res, ['Choisissez une fiche à rattacher']);
    const table = prospectId ? 'prospects' : 'clients';
    const cible = await db.query(`SELECT id, notes FROM ${table} WHERE id = $1`, [prospectId || clientId]);
    if (cible.rows.length === 0) return res.status(404).json({ error: 'Fiche introuvable' });
    const notes = [cible.rows[0].notes || '', origine].filter(Boolean).join('\n');
    await db.query(`UPDATE ${table} SET notes = $1, date_modification = $2 WHERE id = $3`, [notes, now, cible.rows[0].id]);
    await db.query("UPDATE signalements SET statut = 'traite', prospect_id = $1, client_id = $2, traite_par = $3, traite_le = $4 WHERE id = $5", [prospectId, clientId, req.user.id, now, s.id]);
    await logActivity(req.user.id, 'signalement_rattache', s.titre || s.lien, prospectId ? 'prospect' : 'client', prospectId || clientId);
    const maj = await db.query(`${SELECT_SIGNALEMENTS} WHERE s.id = $1`, [s.id]);
    const fiche = await db.query(`SELECT * FROM ${table} WHERE id = $1`, [prospectId || clientId]);
    return res.json({ signalement: parseSignalement(maj.rows[0]), [prospectId ? 'prospect' : 'client']: prospectId ? parseProspect(fiche.rows[0]) : fiche.rows[0] });
  }

  if (action === 'ignorer' || action === 'rouvrir') {
    const statut = action === 'ignorer' ? 'ignore' : 'a_qualifier';
    await db.query('UPDATE signalements SET statut = $1, traite_par = $2, traite_le = $3 WHERE id = $4', [statut, action === 'ignorer' ? req.user.id : '', action === 'ignorer' ? now : null, s.id]);
    // Écarter laisse une trace, rouvrir l'efface : prévenir d'un écart qu'on vient
    // d'annuler soi-même ne rendrait service à personne.
    if (action === 'ignorer') await noterEcart(s, 'signalement_ignore', req.user.id);
    else await oublier('signalement', s.id);
    const maj = await db.query(`${SELECT_SIGNALEMENTS} WHERE s.id = $1`, [s.id]);
    return res.json({ signalement: parseSignalement(maj.rows[0]) });
  }

  // Modifier le commentaire ou le destinataire d'un signalement encore ouvert.
  if (action === 'modifier') {
    const commentaire = req.body.commentaire === undefined ? s.commentaire : String(req.body.commentaire).slice(0, 1000);
    const commercialId = req.body.commercial_id === undefined ? s.commercial_id : String(req.body.commercial_id);
    await db.query('UPDATE signalements SET commentaire = $1, commercial_id = $2 WHERE id = $3', [commentaire, commercialId, s.id]);
    const maj = await db.query(`${SELECT_SIGNALEMENTS} WHERE s.id = $1`, [s.id]);
    return res.json({ signalement: parseSignalement(maj.rows[0]) });
  }

  return validationError(res, ['Action inconnue']);
}));

/**
 * Le même geste sur plusieurs signalements d'un coup.
 *
 * C'est le travail réel de la boîte : on parcourt une série de dépôts, on garde ceux qui
 * tiennent, on écarte les autres. Le faire un par un, à trois clics par fiche, décourage
 * de la vider — et une boîte qu'on ne vide pas ne sert plus à rien.
 *
 * Chaque signalement est traité pour lui-même : un qui échoue (déjà qualifié, disparu
 * entre-temps) est nommé dans la réponse, il n'arrête pas le lot.
 */
router.post('/signalements/masse', authMiddleware, asyncHandler(async (req, res) => {
  const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).filter(v => typeof v === 'string' && v))];
  const action = String(req.body.action || '');
  if (ids.length === 0) return validationError(res, ['aucun signalement selectionne']);
  if (ids.length > MASSE_MAX) return validationError(res, [`${MASSE_MAX} signalements au maximum`]);
  if (!['creer', 'ignorer', 'rouvrir', 'supprimer'].includes(action)) return validationError(res, ['Action inconnue']);
  if (action === 'supprimer' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Seul un administrateur peut supprimer un signalement' });
  }

  const now = new Date().toISOString();
  const signalements = [];
  const prospects = [];
  const supprimes = [];
  const echecs = [];

  for (const id of ids) {
    const existant = await db.query('SELECT * FROM signalements WHERE id = $1', [id]);
    if (existant.rows.length === 0) { echecs.push({ id, raison: 'introuvable' }); continue; }
    const s = parseSignalement(existant.rows[0]);
    const nom = s.titre || s.fiche?.nom_etablissement || id;
    try {
      if (action === 'creer') {
        if (s.statut === 'traite' && s.prospect_id) { echecs.push({ id, nom, raison: 'déjà qualifié' }); continue; }
        if (s.statut === 'ignore') { echecs.push({ id, nom, raison: 'ignoré — rouvrez-le d\'abord' }); continue; }
        if (!String(s.fiche?.nom_etablissement || s.titre || '').trim()) {
          echecs.push({ id, nom, raison: 'sans nom d\'établissement' });
          continue;
        }
        const r = await creerDepuisSignalement(s, {}, req.user.id);
        signalements.push(r.signalement);
        prospects.push(r.prospect);
      } else if (action === 'supprimer') {
        await noterEcart(s, 'signalement_supprime', req.user.id);
        await db.query('DELETE FROM signalements WHERE id = $1', [id]);
        supprimes.push(id);
      } else {
        // Rouvrir ne concerne que ce qui a été ignoré. Un signalement qui a donné un
        // prospect garde son lien : le remettre « à qualifier » le laisserait à la fois
        // rattaché et en attente, et la création suivante se ferait refuser.
        if (action === 'rouvrir' && s.statut !== 'ignore') {
          echecs.push({ id, nom, raison: s.prospect_id || s.client_id ? 'déjà rattaché à une fiche' : 'déjà à qualifier' });
          continue;
        }
        const statut = action === 'ignorer' ? 'ignore' : 'a_qualifier';
        await db.query('UPDATE signalements SET statut = $1, traite_par = $2, traite_le = $3 WHERE id = $4',
          [statut, action === 'ignorer' ? req.user.id : '', action === 'ignorer' ? now : null, id]);
        if (action === 'ignorer') await noterEcart(s, 'signalement_ignore', req.user.id);
        else await oublier('signalement', id);
        const maj = await db.query(`${SELECT_SIGNALEMENTS} WHERE s.id = $1`, [id]);
        signalements.push(parseSignalement(maj.rows[0]));
      }
    } catch (err) {
      echecs.push({ id, nom, raison: err.message });
    }
  }

  const faits = action === 'supprimer' ? supprimes.length : signalements.length;
  await logActivity(req.user.id, `signalements_${action}`, `${faits} signalement(s)`, 'signalement', '');
  res.json({ ok: true, action, signalements, prospects, supprimes, echecs });
}));

// Supprimer efface vraiment la ligne, et c'est pour cela que c'est réservé à
// l'administrateur : « Ignorer » est le geste de tous les jours, il se rouvre. La trace
// d'identité, elle, survit à la suppression — c'est tout son intérêt.
router.delete('/signalements/:id', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const existant = await db.query('SELECT * FROM signalements WHERE id = $1', [req.params.id]);
  if (existant.rows.length === 0) return res.status(404).json({ error: 'Signalement introuvable' });
  await noterEcart(parseSignalement(existant.rows[0]), 'signalement_supprime', req.user.id);
  await db.query('DELETE FROM signalements WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

export default router;
