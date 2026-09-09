// Déposer dans la boîte de prospection — l'unique chemin.
//
// Ce qui arrive dans la boîte vient de l'application (un partage depuis le téléphone) ou de
// Claude (l'outil MCP d'écriture). Les deux passent par ici, pour qu'il n'y ait qu'un seul
// endroit qui lise le partage, cherche les doublons, range le signalement et prévienne les
// bonnes personnes. Deux chemins parallèles finiraient toujours par diverger.
import crypto from 'crypto';
import db from '../db.js';
import { ficheDepuisPartage, extraireLien, estLienGoogle, lireLienQuelconque, analyserTexte } from '../partage.js';
import { doublonsDeFiche, nomComplet } from './fichePartagee.js';
import { logActivity } from './journal.js';

export const TEXTE_MAX = 4000;
export const COMMENTAIRE_MAX = 1000;
export const PHOTOS_MAX = 6;
const PHOTO_OCTETS_MAX = 2 * 1024 * 1024; // après redimensionnement à l'écran, une photo pèse 100 à 400 Ko

/** Une photo trop lourde, un commercial inconnu : ce que l'appelant doit corriger. */
export class DepotRefuse extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

async function enregistrerPhotos(signalementId, photos) {
  const now = new Date().toISOString();
  for (const photo of (Array.isArray(photos) ? photos : []).slice(0, PHOTOS_MAX)) {
    const contenu = String(photo?.contenu || '').replace(/^data:[^;]+;base64,/, '');
    if (!contenu) continue;
    const taille = Math.floor(contenu.length * 3 / 4);
    if (taille > PHOTO_OCTETS_MAX) throw new DepotRefuse('Une photo dépasse 2 Mo', 413);
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
export async function lirePartage(texte) {
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

/**
 * Range un signalement dans la boîte, à qualifier.
 *
 * `ficheImposee` sert au dépôt structuré : quand l'appelant connaît déjà le nom, la ville ou
 * le téléphone, ses valeurs priment sur ce que la lecture du texte a deviné. La recherche de
 * doublons tourne dans tous les cas — c'est elle qui évite les fiches en double.
 *
 * @returns {{ id: string, fiche: object, doublons: Array, destinataires: string[] }}
 */
export async function deposer({ texte = '', photos = [], commentaire = '', commercialId = '', parQui, source, ficheImposee = null }) {
  const t = String(texte || '').trim().slice(0, TEXTE_MAX);
  const lesPhotos = Array.isArray(photos) ? photos.filter(p => p && p.contenu) : [];
  if (!t && lesPhotos.length === 0) {
    throw new DepotRefuse('Collez le message, le lien ou le nom de l\'établissement, ou ajoutez une photo');
  }
  if (lesPhotos.length > PHOTOS_MAX) throw new DepotRefuse(`${PHOTOS_MAX} photos au plus par signalement`);

  const cible = String(commercialId || '').trim();
  if (cible) {
    const c = await db.query('SELECT id FROM commerciaux WHERE id = $1', [cible]);
    if (c.rows.length === 0) throw new DepotRefuse('Commercial inconnu');
  }

  const lu = await lirePartage(t);
  if (lesPhotos.length > 0 && lu.source === 'texte' && !lu.lien && !lu.titre) lu.source = 'photo';
  // Ce que l'appelant affirme l'emporte sur ce qui a été deviné, champ par champ.
  const base = { ...lu.fiche };
  for (const [cle, valeur] of Object.entries(ficheImposee || {})) {
    if (valeur !== undefined && valeur !== null && valeur !== '') base[cle] = valeur;
  }
  const titre = (ficheImposee && ficheImposee.nom_etablissement) || lu.titre;
  const doublons = await doublonsDeFiche(base);
  const fiche = { ...base, doublons, compte: lu.compte || '' };

  const id = `sig-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO signalements (id, texte, lien, source, titre, fiche, commentaire, partage_par, commercial_id, statut, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'a_qualifier',$10)`,
    [id, t, base.source_url || lu.lien, source || lu.source, titre, JSON.stringify(fiche),
     String(commentaire || '').trim().slice(0, COMMENTAIRE_MAX), parQui, cible, now]
  );
  try {
    await enregistrerPhotos(id, lesPhotos);
  } catch (err) {
    await db.query('DELETE FROM signalements WHERE id = $1', [id]);
    throw err instanceof DepotRefuse ? err : new DepotRefuse(err.message);
  }

  const resume = titre || lu.lien || t.slice(0, 80) || `${lesPhotos.length} photo(s)`;
  await logActivity(parQui, 'signalement', resume, 'signalement', id);

  // Le destinataire est prévenu ; sans destinataire, la prospection l'est.
  const qui = await nomComplet(parQui);
  let destinataires = [];
  if (cible) destinataires = [cible];
  else {
    const p = await db.query("SELECT id FROM commerciaux WHERE role = 'prospection' OR prospection = TRUE");
    destinataires = p.rows.map(r => r.id);
  }
  destinataires = destinataires.filter(u => u !== parQui);
  await notifier(destinataires, `Nouveau signalement de ${qui}`, resume, { signalement_id: id });

  return { id, fiche, doublons, destinataires };
}
