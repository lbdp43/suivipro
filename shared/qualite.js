// La qualité d'une fiche prospect : ce qui lui manque pour qu'un commercial puisse
// l'appeler sans chercher. Une seule règle, pour la page « Qualité des fiches » (écran) et
// pour le serveur qui refuse de dire « qualifiée » une fiche incomplète.
//
// Une fiche est QUALIFIABLE quand elle a un téléphone, une commune et un type. Le contact,
// le SIRET et la place sur la carte sont un plus : ils apparaissent dans ce qui manque, sans
// bloquer.
import { aUnNumero } from './normalisation.js';

/** Étapes qu'on ne remet pas en qualité : c'est tranché. */
export const ETAPES_TRANCHEES = ['client_gagne', 'perdu', 'ne_pas_contacter'];

/** Les fiches à trier une par une : ce que l'équipe a partagé depuis son téléphone. */
export const ETAPES_A_TRIER = ['partage'];

export const LIBELLES_MANQUE = {
  telephone: 'téléphone',
  commune: 'commune',
  type: 'type',
  nom: 'vrai nom',
  carte: 'place sur la carte',
  contact: 'contact',
  siret: 'SIRET',
};

/** Ce qui manque, bloquant d'abord. */
export function manquesDeLaFiche(p) {
  const m = [];
  if (!aUnNumero(p.telephone)) m.push('telephone');
  if (!String(p.ville || '').trim() && !String(p.code_postal || '').trim()) m.push('commune');
  if (!p.type_etablissement || p.type_etablissement === 'autre') m.push('type');
  if (/^Établissement partagé/i.test(String(p.nom_etablissement || '').trim())) m.push('nom');
  if (!Number(p.latitude) || !Number(p.longitude)) m.push('carte');
  if (!String(p.nom_contact || '').trim()) m.push('contact');
  if (!String(p.siret || '').trim()) m.push('siret');
  return m;
}

/** Les manques qui empêchent de dire la fiche qualifiée. */
export const MANQUES_BLOQUANTS = ['telephone', 'commune', 'type', 'nom'];

export function manquesBloquants(p) {
  return manquesDeLaFiche(p).filter(m => MANQUES_BLOQUANTS.includes(m));
}

export function estQualifiable(p) {
  return manquesBloquants(p).length === 0;
}

/** À compléter : fiche encore en course à qui il manque l'essentiel (ou sa place sur la carte). */
export function aCompleter(p) {
  if (ETAPES_TRANCHEES.includes(p.etape_pipeline)) return false;
  const m = manquesDeLaFiche(p);
  return m.some(x => MANQUES_BLOQUANTS.includes(x) || x === 'carte');
}
