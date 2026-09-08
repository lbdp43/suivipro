// Des réponses compactes et lisibles : de vrais libellés, des dates en clair, et le total
// même quand la liste est coupée. « BAR_RESTAURANT_2024 » ou « 2026-05-12 » obligeraient
// le modèle à deviner ; « Bar Restaurant 2024 » et « mar. 12 mai (dans 3 j) » ne
// demandent rien à personne.
import { dateLocale, jourDe } from '../../shared/regles.js';
import { libelle } from '../../shared/libelles.js';

export const LIMITE_DEFAUT = 50;
export const LIMITE_MAX = 200;
export const MOIS_DEFAUT = 12;
export const MOIS_MAX = 36;

export function borner(valeur, defaut, max) {
  const n = Number(valeur);
  if (!Number.isFinite(n) || n <= 0) return defaut;
  return Math.min(Math.round(n), max);
}

const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MOIS = ['janv.', 'févr.', 'mars', 'avril', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** « mar. 12 mai », et le repère utile quand il est proche : « (dans 3 j) », « (hier) ». */
export function dateFr(valeur, { relatif = true } = {}) {
  const jour = jourDe(valeur);
  if (!jour) return '';
  const d = new Date(`${jour}T12:00:00`);
  if (Number.isNaN(d.getTime())) return jour;
  const aujourdhui = new Date(`${dateLocale()}T12:00:00`);
  let texte = `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}`;
  // L'année dès qu'elle n'est pas celle en cours : « jeu. 31 déc. » ne dit pas laquelle.
  if (d.getFullYear() !== aujourdhui.getFullYear()) texte += ` ${d.getFullYear()}`;
  const ecart = Math.round((d - aujourdhui) / 86400000);
  if (!relatif) return texte;
  if (ecart === 0) return `${texte} (aujourd'hui)`;
  if (ecart === 1) return `${texte} (demain)`;
  if (ecart === -1) return `${texte} (hier)`;
  if (ecart > 1 && ecart <= 30) return `${texte} (dans ${ecart} j)`;
  if (ecart < -1 && ecart >= -60) return `${texte} (il y a ${-ecart} j)`;
  return texte;
}

/** Le jour d'il y a N mois, pour la fenêtre d'historique. */
export function ilYaDesMois(mois) {
  const d = new Date();
  d.setMonth(d.getMonth() - mois);
  return dateLocale(d);
}

export function nombreDeJours(depuis, jusqua = dateLocale()) {
  const a = new Date(`${jourDe(depuis)}T12:00:00`);
  const b = new Date(`${jourDe(jusqua)}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b - a) / 86400000);
}

/** Les morceaux non vides d'une ligne, séparés par des points médians. */
export function ligne(...morceaux) {
  return morceaux.filter(m => m !== null && m !== undefined && String(m).trim() !== '').join(' · ');
}

export function bloc(...lignes) {
  return lignes.filter(l => l !== null && l !== undefined && String(l).trim() !== '').join('\n');
}

/** L'en-tête d'une liste : ce qu'on a cherché, combien on en montre, combien il y en a. */
export function entete(titre, montres, total) {
  if (total === 0) return `${titre} — aucun résultat`;
  if (montres >= total) return `${titre} — ${total}`;
  return `${titre} — ${montres} sur ${total} (affinez pour voir les autres)`;
}

/** Un texte libre remis sur une ligne, coupé net s'il est trop long. */
export function extrait(texte, taille = 220) {
  const t = String(texte || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > taille ? `${t.slice(0, taille - 1)}…` : t;
}

export function lib(table, code) {
  return libelle(table, code);
}

/** Une fiche se nomme toujours par son nom et sa ville — jamais par son seul identifiant. */
export function nommer(nom, ville) {
  return ville ? `${nom} (${ville})` : String(nom || '');
}

/** La réponse que le MCP renvoie : du texte, rien d'autre. */
export function reponse(texte) {
  return { content: [{ type: 'text', text: texte || 'Rien à afficher.' }] };
}
