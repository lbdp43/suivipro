// Boîte de prospection : ce que l'équipe partage (WhatsApp, Google Maps, Instagram, Facebook,
// TikTok, un article, un simple texte) attend ici d'être qualifié. Un signalement devient un
// prospect, se rattache à une fiche existante, ou est ignoré.
import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.js';
import { asyncHandler, authMiddleware } from '../lib/auth.js';
import { dateLocale } from '../../shared/regles.js';
import { ficheDepuisPartage, extraireLien, estLienGoogle, lireLienQuelconque, analyserTexte } from '../partage.js';
import { doublonsDeFiche, creerProspectDepuisFiche, nomComplet } from '../lib/fichePartagee.js';
import { logActivity } from '../lib/journal.js';
import { validationError } from '../lib/validation.js';
import { parseProspect } from '../lib/parse.js';

const router = Router();

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

const PHOTOS_MAX = 6;
const PHOTO_OCTETS_MAX = 2 * 1024 * 1024; // après redimensionnement à l'écran, une photo pèse 100 à 400 Ko

async function enregistrerPhotos(signalementId, photos) {
  const now = new Date().toISOString();
  for (const photo of (Array.isArray(photos) ? photos : []).slice(0, PHOTOS_MAX)) {
    const contenu = String(photo?.contenu || '').replace(/^data:[^;]+;base64,/, '');
    if (!contenu) continue;
    const taille = Math.floor(contenu.length * 3 / 4);
    if (taille > PHOTO_OCTETS_MAX) throw Object.assign(new Error('Une photo dépasse 2 Mo'), { status: 413 });
    const typeMime = /^image\/(jpeg|png|webp|gif)$/.test(photo.type_mime) ? photo.type_mime : 'image/jpeg';
    await db.query('INSERT INTO signalement_photos (id, signalement_id, type_mime, taille, contenu, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [`photo-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, signalementId, typeMime, taille, contenu, now]);
  }
}

async function notifier(userIds, title, message, data) {
  const now = new Date().toISOString();
  for (const userId of new Set(userIds.filter(Boolean))) {
    await db.query('INSERT INTO notifications (id, user_id, type, title, message, data, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [`notif-${crypto.randomUUID()}`, userId, 'signalement', title, message, JSON.stringify(data), now]);
  }
}

// Lecture d'un partage : lien Google → fiche complète ; autre lien → titre de page et compte ;
// texte seul → nom sur la première ligne, téléphone, adresse.
async function lirePartage(texte) {
  if (!texte) return { lien: '', source: 'photo', titre: '', fiche: { nom_etablissement: '', type_etablissement: 'autre' } };
  const lien = extraireLien(texte);
  if (lien && estLienGoogle(lien)) {
    const { fiche } = await ficheDepuisPartage(texte);
    return { lien, source: 'google', titre: fiche.nom_etablissement || '', fiche };
  }
  const t = analyserTexte(texte);
  const fiche = { nom_etablissement: t.nom, adresse: t.adresse, telephone: t.telephone, ville: '', code_postal: '', departement: '', latitude: 0, longitude: 0, type_etablissement: 'autre', source_url: lien, categorie_google: '' };
  if (!lien) return { lien: '', source: 'texte', titre: t.nom, fiche };
  const lu = await lireLienQuelconque(lien);
  // Le nom du compte vaut mieux qu'un titre de page générique ; le texte du message prime.
  const titre = t.nom || lu.titre || lu.compte || '';
  if (!fiche.nom_etablissement) fiche.nom_etablissement = lu.titre || lu.compte || '';
  return { lien, source: lu.source, titre, fiche, compte: lu.compte };
}

router.post('/signalements', authMiddleware, asyncHandler(async (req, res) => {
  const texte = String(req.body.texte || '').trim().slice(0, 4000);
  const photos = Array.isArray(req.body.photos) ? req.body.photos.filter(p => p && p.contenu) : [];
  if (!texte && photos.length === 0) return validationError(res, ['Collez le message, le lien ou le nom de l\'établissement, ou ajoutez une photo']);
  if (photos.length > PHOTOS_MAX) return validationError(res, [`${PHOTOS_MAX} photos au plus par signalement`]);
  const commentaire = String(req.body.commentaire || '').trim().slice(0, 1000);
  const commercialId = String(req.body.commercial_id || '').trim();
  if (commercialId) {
    const c = await db.query('SELECT id FROM commerciaux WHERE id = $1', [commercialId]);
    if (c.rows.length === 0) return validationError(res, ['Commercial inconnu']);
  }
  const lu = await lirePartage(texte);
  if (photos.length > 0 && lu.source === 'texte' && !lu.lien && !lu.titre) lu.source = 'photo';
  const doublons = await doublonsDeFiche(lu.fiche);
  const fiche = { ...lu.fiche, doublons, compte: lu.compte || '' };
  const id = `sig-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO signalements (id, texte, lien, source, titre, fiche, commentaire, partage_par, commercial_id, statut, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'a_qualifier',$10)`,
    [id, texte, lu.lien, lu.source, lu.titre, JSON.stringify(fiche), commentaire, req.user.id, commercialId, now]
  );
  try { await enregistrerPhotos(id, photos); } catch (err) {
    await db.query('DELETE FROM signalements WHERE id = $1', [id]);
    return res.status(err.status || 400).json({ error: err.message });
  }
  await logActivity(req.user.id, 'signalement', lu.titre || lu.lien || texte.slice(0, 80) || `${photos.length} photo(s)`, 'signalement', id);
  // Le destinataire est prévenu ; sans destinataire, la prospection l'est.
  const qui = await nomComplet(req.user.id);
  let destinataires = [];
  if (commercialId) destinataires = [commercialId];
  else {
    const p = await db.query("SELECT id FROM commerciaux WHERE role = 'prospection' OR prospection = TRUE");
    destinataires = p.rows.map(r => r.id);
  }
  await notifier(destinataires.filter(u => u !== req.user.id), `Nouveau signalement de ${qui}`, lu.titre || lu.lien || texte.slice(0, 80) || `${photos.length} photo(s)`, { signalement_id: id });
  const cree = await db.query(`${SELECT_SIGNALEMENTS} WHERE s.id = $1`, [id]);
  res.json(parseSignalement(cree.rows[0]));
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

// Qualifier : créer le prospect (fiche corrigée à l'écran), rattacher à une fiche existante,
// ignorer, ou rouvrir.
router.patch('/signalements/:id', authMiddleware, asyncHandler(async (req, res) => {
  const existant = await db.query('SELECT * FROM signalements WHERE id = $1', [req.params.id]);
  if (existant.rows.length === 0) return res.status(404).json({ error: 'Signalement introuvable' });
  const s = parseSignalement(existant.rows[0]);
  const action = String(req.body.action || '');
  const now = new Date().toISOString();
  const auteur = await nomComplet(s.partage_par);
  const origine = [`Signalé par ${auteur} le ${dateLocale(new Date(s.created_at))}${s.lien ? ` : ${s.lien}` : ''}.`, s.commentaire ? `Commentaire : ${s.commentaire}` : ''].filter(Boolean).join('\n');

  if (action === 'creer') {
    if (s.statut === 'traite' && s.prospect_id) return res.status(409).json({ error: 'Ce signalement a déjà donné un prospect' });
    const corrections = req.body.prospect || {};
    const fiche = { ...s.fiche, ...corrections, source_url: s.lien || s.fiche.source_url || '' };
    if (!String(fiche.nom_etablissement || '').trim()) return validationError(res, ['Le nom de l\'établissement est requis']);
    const commercialId = String(corrections.commercial_id || s.commercial_id || req.user.id);
    const prospect = await creerProspectDepuisFiche(fiche, { auteurId: req.user.id, commercialId, notes: [origine] });
    await db.query("UPDATE signalements SET statut = 'traite', prospect_id = $1, client_id = '', traite_par = $2, traite_le = $3 WHERE id = $4", [prospect.id, req.user.id, now, s.id]);
    const maj = await db.query(`${SELECT_SIGNALEMENTS} WHERE s.id = $1`, [s.id]);
    return res.json({ signalement: parseSignalement(maj.rows[0]), prospect });
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

router.delete('/signalements/:id', authMiddleware, asyncHandler(async (req, res) => {
  const s = await db.query('SELECT partage_par FROM signalements WHERE id = $1', [req.params.id]);
  if (s.rows.length === 0) return res.status(404).json({ error: 'Signalement introuvable' });
  if (s.rows[0].partage_par !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Seul l\'auteur ou un administrateur peut supprimer un signalement' });
  await db.query('DELETE FROM signalements WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

export default router;
