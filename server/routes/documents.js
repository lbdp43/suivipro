// Documents et lecture de cartes (OCR) — routes déplacées telles quelles depuis routes.js.
import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createWorker } from 'tesseract.js';
import db from '../db.js';
import { adminOnly, asyncHandler, authMiddleware, isAdmin, JWT_SECRET } from '../lib/auth.js';
import { doitSigner, lireSignataires } from '../../shared/documents.js';

const router = Router();

// Les colonnes montrées à l'écran : tout sauf le contenu, qui ne voyage qu'à l'ouverture.
export const COLONNES_DOCUMENT = 'id, nom, categorie, description, nom_fichier, type_mime, taille, uploaded_by, date_creation, a_signer, signataires, version, empreinte, consultation_seule';

export function documentPourEcran(row) {
  return { ...row, signataires: lireSignataires(row.signataires), version: Number(row.version) || 1, a_signer: !!row.a_signer, consultation_seule: !!row.consultation_seule };
}

router.get('/documents', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query(`SELECT ${COLONNES_DOCUMENT} FROM documents ORDER BY date_creation DESC`);
  res.json(result.rows.map(documentPourEcran));
}));

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'text/plain', 'text/csv',
]);

const MAX_DOCUMENT_SIZE = 5 * 1024 * 1024; // 5MB

/** Ce que la visionneuse de SuiviPro sait afficher : seuls ceux-là peuvent être « consultation seule ». */
function affichable(typeMime) {
  return typeMime === 'application/pdf' || /^image\/(png|jpeg|gif|webp)$/.test(typeMime || '');
}

function empreinteDe(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Nom du fichier enregistré, sans accents : « catalogue-été.pdf » → « catalogue-ete.pdf ».
 * La forme accentuée (filename*) n'est pas lue partout : un navigateur qui ne la décode pas
 * jette tout l'en-tête et appelle le fichier « download ». Sans accents, chacun le lit.
 */
function disposition(mode, nom) {
  const ascii = String(nom || 'document').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${mode}; filename="${ascii}"`;
}

function lireFichier(body) {
  const { nom_fichier, type_mime, contenu } = body || {};
  if (!nom_fichier || !contenu) return { erreur: 'nom_fichier et contenu sont requis' };
  const type = type_mime || 'application/pdf';
  if (!ALLOWED_MIME_TYPES.has(type)) return { erreur: `Type de fichier non autorise: ${type}` };
  const buffer = Buffer.from(String(contenu), 'base64');
  if (buffer.length === 0) return { erreur: 'Fichier vide' };
  if (buffer.length > MAX_DOCUMENT_SIZE) return { erreur: 'Fichier trop volumineux (max 5 Mo)' };
  return { nom_fichier: String(nom_fichier), type, buffer, contenu: String(contenu) };
}

function signatairesDe(valeur) {
  if (!Array.isArray(valeur)) return '';
  const ids = [...new Set(valeur.filter(v => typeof v === 'string' && v))];
  return ids.length ? JSON.stringify(ids) : '';
}

router.post('/documents', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { id, nom, categorie, description, a_signer, signataires, consultation_seule } = req.body;
  if (!nom) return res.status(400).json({ error: 'nom, nom_fichier et contenu sont requis' });
  const f = lireFichier(req.body);
  if (f.erreur) return res.status(400).json({ error: f.erreur });
  if (consultation_seule && !affichable(f.type)) {
    return res.status(400).json({ error: 'La consultation seule est reservee aux PDF et aux images' });
  }
  const docId = id || `doc-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const result = await db.query(
    `INSERT INTO documents (id, nom, categorie, description, nom_fichier, type_mime, taille, contenu, uploaded_by, date_creation,
                            a_signer, signataires, version, empreinte, consultation_seule)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$14)
     RETURNING ${COLONNES_DOCUMENT}`,
    [docId, nom, categorie || 'autre', description || '', f.nom_fichier, f.type, f.buffer.length, f.contenu, req.user.id, new Date().toISOString(),
      !!a_signer, a_signer ? signatairesDe(signataires) : '', empreinteDe(f.buffer), !!consultation_seule]
  );
  res.json(documentPourEcran(result.rows[0]));
}));

// Remplacer le fichier : c'est une nouvelle version. Les signatures de l'ancienne restent
// en base (l'historique), mais la nouvelle doit être signée à nouveau.
router.put('/documents/:id/fichier', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const actuel = (await db.query('SELECT consultation_seule FROM documents WHERE id = $1', [req.params.id])).rows[0];
  if (!actuel) return res.status(404).json({ error: 'Document non trouve' });
  const f = lireFichier(req.body);
  if (f.erreur) return res.status(400).json({ error: f.erreur });
  if (actuel.consultation_seule && !affichable(f.type)) {
    return res.status(400).json({ error: 'Ce document est en consultation seule : il doit rester un PDF ou une image' });
  }
  const result = await db.query(
    `UPDATE documents SET nom_fichier = $2, type_mime = $3, taille = $4, contenu = $5, empreinte = $6, version = version + 1
     WHERE id = $1 RETURNING ${COLONNES_DOCUMENT}`,
    [req.params.id, f.nom_fichier, f.type, f.buffer.length, f.contenu, empreinteDe(f.buffer)]
  );
  res.json(documentPourEcran(result.rows[0]));
}));

async function noterOuverture(doc, userId) {
  await db.query(
    `INSERT INTO document_ouvertures (doc_id, user_id, version, ouvert_le) VALUES ($1,$2,$3,$4)
     ON CONFLICT (doc_id, user_id, version) DO NOTHING`,
    [doc.id, userId, Number(doc.version) || 1, new Date().toISOString()]
  );
}

function envoyer(res, doc, mode) {
  const buffer = Buffer.from(doc.contenu, 'base64');
  res.setHeader('Content-Type', doc.type_mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', disposition(mode, doc.nom_fichier));
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buffer);
}

// ---------------------------------------------------------------------------------------
// Ouvrir un document depuis le téléphone.
//
// L'ancien téléchargement passait par un fichier fabriqué dans la page puis « cliqué ».
// Dans l'application installée, sur iPhone comme sur Android, ce faux clic ne mène nulle
// part : rien ne s'ouvrait, et l'erreur n'était pas affichée. Un vrai lien, suivi par le
// téléphone lui-même, marche partout — il ouvre la visionneuse du système, avec son
// bouton Partager pour enregistrer, envoyer ou imprimer.
//
// Un lien ne peut pas porter l'en-tête d'authentification : il porte donc un jeton à lui,
// signé avec une clé DÉRIVÉE (jamais accepté comme jeton de session), limité à un
// document et à une personne, valable deux heures.
// ---------------------------------------------------------------------------------------
const CLE_LIENS = `${JWT_SECRET}:documents`;
const DUREE_LIEN = '2h';

router.get('/documents/liens', authMiddleware, asyncHandler(async (req, res) => {
  const docs = (await db.query('SELECT id, consultation_seule FROM documents')).rows;
  const liens = {};
  for (const d of docs) {
    if (d.consultation_seule && !isAdmin(req)) continue;
    const jeton = jwt.sign({ doc: d.id, u: req.user.id }, CLE_LIENS, { expiresIn: DUREE_LIEN });
    liens[d.id] = `/api/documents/${encodeURIComponent(d.id)}/fichier?jeton=${encodeURIComponent(jeton)}`;
  }
  res.json(liens);
}));

router.get('/documents/:id/fichier', asyncHandler(async (req, res) => {
  let jeton;
  try { jeton = jwt.verify(String(req.query.jeton || ''), CLE_LIENS); } catch { jeton = null; }
  if (!jeton || jeton.doc !== req.params.id) {
    return res.status(401).type('text/plain; charset=utf-8').send('Ce lien a expiré. Revenez dans SuiviPro et rouvrez le document.');
  }
  const personne = (await db.query('SELECT id, role, actif FROM commerciaux WHERE id = $1', [jeton.u])).rows[0];
  if (!personne || !personne.actif) return res.status(401).type('text/plain; charset=utf-8').send('Compte inactif.');
  const doc = (await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id])).rows[0];
  if (!doc) return res.status(404).type('text/plain; charset=utf-8').send('Document introuvable.');
  if (doc.consultation_seule && personne.role !== 'admin') {
    return res.status(403).type('text/plain; charset=utf-8').send('Ce document se consulte seulement dans SuiviPro.');
  }
  await noterOuverture(doc, personne.id);
  // « telecharger=1 » : le téléphone enregistre le fichier (dossier Téléchargements, app
  // Fichiers). Sans lui, un PDF ou une image s'ouvre pour être lu.
  const telecharger = req.query.telecharger === '1';
  envoyer(res, doc, !telecharger && (affichable(doc.type_mime) || doc.type_mime === 'text/plain') ? 'inline' : 'attachment');
}));

// La visionneuse de SuiviPro : le seul accès aux documents en consultation seule.
router.get('/documents/:id/apercu', authMiddleware, asyncHandler(async (req, res) => {
  const doc = (await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id])).rows[0];
  if (!doc) return res.status(404).json({ error: 'Document non trouve' });
  if (!affichable(doc.type_mime)) return res.status(415).json({ error: 'Ce type de document ne s\'affiche pas dans SuiviPro' });
  await noterOuverture(doc, req.user.id);
  envoyer(res, doc, 'inline');
}));

router.get('/documents/:id/download', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
  const doc = result.rows[0];
  if (!doc) return res.status(404).json({ error: 'Document non trouve' });
  if (doc.consultation_seule && !isAdmin(req)) return res.status(403).json({ error: 'Ce document se consulte seulement dans SuiviPro' });
  await noterOuverture(doc, req.user.id);
  envoyer(res, doc, 'attachment');
}));

// « J'ai lu et je prends connaissance » : une signature électronique simple. On ne signe
// que la version en cours, et seulement après l'avoir ouverte.
router.post('/documents/:id/signer', authMiddleware, asyncHandler(async (req, res) => {
  const doc = (await db.query(`SELECT ${COLONNES_DOCUMENT} FROM documents WHERE id = $1`, [req.params.id])).rows[0];
  if (!doc) return res.status(404).json({ error: 'Document non trouve' });
  if (!doitSigner(doc, req.user.id)) return res.status(403).json({ error: 'Ce document ne vous est pas demande' });
  const version = Number(doc.version) || 1;
  const ouvert = await db.query('SELECT 1 FROM document_ouvertures WHERE doc_id = $1 AND user_id = $2 AND version = $3', [doc.id, req.user.id, version]);
  if (ouvert.rowCount === 0) return res.status(409).json({ error: 'Ouvrez d\'abord le document pour le lire' });
  await db.query(
    `INSERT INTO document_signatures (doc_id, user_id, version, empreinte, nom_fichier, signe_le, ip, navigateur)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (doc_id, user_id, version) DO NOTHING`,
    [doc.id, req.user.id, version, doc.empreinte || '', doc.nom_fichier, new Date().toISOString(), String(req.ip || ''), String(req.headers['user-agent'] || '').slice(0, 300)]
  );
  const signature = (await db.query(
    'SELECT doc_id, user_id, version, signe_le FROM document_signatures WHERE doc_id = $1 AND user_id = $2 AND version = $3',
    [doc.id, req.user.id, version]
  )).rows[0];
  res.json(signature);
}));

router.delete('/documents/:id', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM documents WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// Mapping mots-cles → type d'etablissement
const TYPE_KEYWORDS = {
  bar_restaurant: ['restaurant', 'bar', 'brasserie', 'bistro', 'bistrot', 'pizzeria', 'creperie', 'pub', 'taverne', 'snack'],
  cave: ['cave', 'caviste', 'vins', 'spiritueux', 'oenologie', 'vin', 'wine'],
  epicerie: ['epicerie', 'fine', 'traiteur', 'alimentation', 'gourmet', 'delicatessen'],
  supermarche: ['supermarche', 'hypermarche', 'magasin', 'carrefour', 'leclerc', 'auchan', 'lidl', 'intermarche'],
  hotel: ['hotel', 'chambre', 'hotes', 'auberge', 'gite', 'hebergement', 'residence'],
  camping: ['camping', 'camp'],
  distributeur: ['distributeur', 'grossiste', 'distribution'],
  marche: ['marche', 'foire', 'salon'],
  association: ['association', 'club'],
  comite_entreprise: ['comite', 'entreprise', 'cse'],
  collectivite: ['collectivite', 'mairie', 'commune'],
};

function parseProspectFromText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const result = {};

  // Telephone : formats francais
  const phoneRegex = /(?:\+33|0033|0)\s*[1-9](?:[\s.-]*\d{2}){4}/g;
  const phones = text.match(phoneRegex);
  if (phones && phones.length > 0) {
    result.telephone = phones[0].replace(/[\s.-]/g, '').replace(/^(\+33|0033)/, '0');
  }

  // Email
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = text.match(emailRegex);
  if (emails && emails.length > 0) {
    result.email = emails[0].toLowerCase();
  }

  // Code postal + ville
  const cpRegex = /\b(\d{5})\s+([A-ZÀ-Ü][a-zà-ÿ]+(?:[\s-][A-ZÀ-Ü]?[a-zà-ÿ]+)*)/;
  const cpMatch = text.match(cpRegex);
  if (cpMatch) {
    result.code_postal = cpMatch[1];
    result.ville = cpMatch[2].trim();
    result.departement = cpMatch[1].substring(0, 2);
  }

  // Adresse : chercher un pattern "numero + rue" avant le code postal
  const adresseRegex = /(\d+[\s,]*(?:rue|avenue|boulevard|place|chemin|route|impasse|allee|cours|quai|passage|lot|zone|za|zi|rd|rn|av|bd|pl|ch|rte|imp|all)[^,\n]*)/i;
  const adresseMatch = text.match(adresseRegex);
  if (adresseMatch) {
    result.adresse = adresseMatch[1].replace(/,\s*$/, '').trim();
  }

  // Type d'etablissement
  const textLower = text.toLowerCase();
  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    if (keywords.some(kw => textLower.includes(kw))) {
      result.type_etablissement = type;
      break;
    }
  }

  // Nom de l'etablissement : premiere ligne significative (pas un numero, pas une adresse)
  for (const line of lines) {
    const clean = line.trim();
    if (clean.length < 2) continue;
    if (/^\d+$/.test(clean)) continue;
    if (/^[\d+\s()+.-]+$/.test(clean)) continue;  // juste un tel
    if (emailRegex.test(clean)) continue;
    if (/^\d{5}\s/.test(clean)) continue;  // code postal
    if (/^(lun|mar|mer|jeu|ven|sam|dim|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(clean)) continue;
    if (/^(ouvert|ferme|open|closed|horaire)/i.test(clean)) continue;
    if (/^https?:\/\//i.test(clean)) continue;
    if (/^(avis|review|note|etoile|\d+[.,]\d+\s)/i.test(clean)) continue;
    if (/google/i.test(clean)) continue;
    result.nom_etablissement = clean;
    break;
  }

  // Nom du contact : chercher un pattern "prenom nom" dans le texte
  const nomContactRegex = /(?:contact|gerant|responsable|proprietaire|dirigeant|mr|mme|m\.)\s*:?\s*([A-ZÀ-Ü][a-zà-ÿ]+\s+[A-ZÀ-Ü][a-zà-ÿ]+)/i;
  const nomContactMatch = text.match(nomContactRegex);
  if (nomContactMatch) {
    result.nom_contact = nomContactMatch[1].trim();
  }

  return result;
}

router.post('/ocr-prospect', authMiddleware, asyncHandler(async (req, res) => {
  const { image } = req.body; // base64 encoded image
  if (!image) return res.status(400).json({ error: 'Image requise (base64)' });

  try {
    // Decode base64 (strip data:image/...;base64, prefix if present)
    const base64Data = image.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const worker = await createWorker('fra+eng');
    const { data: { text } } = await worker.recognize(buffer);
    await worker.terminate();

    const parsed = parseProspectFromText(text);
    res.json({ text, parsed });
  } catch (err) {
    console.error('OCR error:', err);
    res.status(500).json({ error: 'Erreur OCR: ' + err.message });
  }
}));

export default router;
