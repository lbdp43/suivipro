// Une fiche lue depuis un partage (lien Google, message WhatsApp…) : les fiches existantes
// qui lui ressemblent, et sa création en prospect. Utilisé par la boîte de prospection.
import crypto from 'crypto';
import db from '../db.js';
import { dateLocale } from '../../shared/regles.js';
import { sansAccents } from '../../shared/normalisation.js';
import { preparerFiche, comparerFiches } from '../../shared/rapprochement.js';
import { logActivity } from './journal.js';
import { rattacherEntite } from './zones.js';
import { scoreProspect } from './scores.js';
import { parseProspect } from './parse.js';

// Même règle que partout (rapprochement partagé), avec une tolérance sur « un nom contient
// l'autre » dans la même commune.
export async function doublonsDeFiche(fiche) {
  if (!fiche?.nom_etablissement) return [];
  const partagee = preparerFiche({ nom: fiche.nom_etablissement, telephone: fiche.telephone, ville: fiche.ville });
  const [p, c] = await Promise.all([
    db.query('SELECT id, nom_etablissement AS nom, ville, telephone, etape_pipeline FROM prospects'),
    db.query('SELECT id, nom, ville, telephone FROM clients'),
  ]);
  const ressemble = (r) => {
    const cmp = comparerFiches(partagee, r);
    if (!cmp) return false;
    if (cmp.score >= 80) return true;
    if (cmp.score === 60) { const v = sansAccents(r.ville); return !partagee._ville || !v || v === partagee._ville; }
    return false;
  };
  const out = [];
  for (const r of p.rows) if (ressemble(r)) out.push({ genre: 'prospect', id: r.id, nom: r.nom, ville: r.ville || '', etape: r.etape_pipeline });
  for (const r of c.rows) if (ressemble(r)) out.push({ genre: 'client', id: r.id, nom: r.nom, ville: r.ville || '' });
  return out.slice(0, 6);
}

export async function nomComplet(userId) {
  const r = await db.query('SELECT prenom, nom FROM commerciaux WHERE id = $1', [userId]);
  return r.rows[0] ? `${r.rows[0].prenom} ${r.rows[0].nom}`.trim() : String(userId || '');
}

/**
 * Crée un prospect dans l'étape « Nouveau partagé » à partir d'une fiche lue.
 * `auteurId` est celui qui crée ; `commercialId` celui à qui la fiche est confiée.
 */
export async function creerProspectDepuisFiche(fiche, { auteurId, commercialId, notes = [] }) {
  const now = new Date().toISOString();
  const id = `prospect-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const texteNotes = [...notes, fiche.categorie_google ? `Catégorie Google : ${fiche.categorie_google}.` : ''].filter(Boolean).join('\n');
  await db.query(
    // L'email suit la fiche comme le reste : il était perdu ici, ce qui obligeait à le
    // ressaisir alors qu'il venait d'être partagé.
    `INSERT INTO prospects (id, nom_etablissement, type_etablissement, nom_contact, telephone, email, adresse, ville, code_postal, departement, secteur, latitude, longitude, etape_pipeline, tags, commercial_id, notes, date_creation, date_modification, score, source_url)
     VALUES ($1,$2,$3,$4,$5,$17,$6,$7,$8,$9,'',$10,$11,'partage','[]',$12,$13,$14,$14,$15,$16)`,
    [id, String(fiche.nom_etablissement || 'Établissement partagé (à renommer)').slice(0, 200), fiche.type_etablissement || 'autre', fiche.nom_contact || '', fiche.telephone || '',
      fiche.adresse || '', fiche.ville || '', fiche.code_postal || '', fiche.departement || '',
      fiche.latitude || 0, fiche.longitude || 0, commercialId || auteurId, texteNotes, now, await scoreProspect([], 50), fiche.source_url || '',
      fiche.email || '']
  );
  await rattacherEntite('prospects', id);
  await logActivity(auteurId, 'creation_prospect', `${fiche.nom_etablissement} (fiche partagée)`, 'prospect', id);
  const cree = await db.query('SELECT * FROM prospects WHERE id = $1', [id]);
  return parseProspect(cree.rows[0]);
}

export { dateLocale };
