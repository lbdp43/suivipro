// Chercher un nom sans se soucier des accents, mais côté base.
//
// « epicerie » doit trouver « Épicerie » sans rapatrier toute la table pour la filtrer
// ici — à quatre mille prospects, la différence se voit. Le repli se fait donc en SQL.
//
// Pas avec translate() : sur une base en locale C, il travaille octet par octet et
// confond tous les caractères qui commencent pareil (« É » devenait « a », parce que
// « À » partage son premier octet). replace() compare des chaînes entières : il est juste
// dans tous les cas, quelle que soit la locale de la base.
import { normaliserPourComparaison } from '../../shared/normalisation.js';

const ACCENTS = [
  ['à', 'a'], ['â', 'a'], ['ä', 'a'], ['ã', 'a'], ['á', 'a'],
  ['é', 'e'], ['è', 'e'], ['ê', 'e'], ['ë', 'e'],
  ['î', 'i'], ['ï', 'i'], ['í', 'i'], ['ì', 'i'],
  ['ô', 'o'], ['ö', 'o'], ['ó', 'o'], ['ò', 'o'], ['õ', 'o'],
  ['ù', 'u'], ['û', 'u'], ['ü', 'u'], ['ú', 'u'],
  ['ç', 'c'], ['ñ', 'n'], ['œ', 'oe'], ['æ', 'ae'],
];

// Les majuscules aussi : lower() ne touche pas aux caractères accentués en locale C.
const REPLIS = ACCENTS.flatMap(([de, vers]) => [[de, vers], [de.toUpperCase(), vers]]);

/** L'expression SQL qui rend un champ comparable : accents dépliés, puis minuscules. */
export function sansAccentsSql(champ) {
  return `lower(${REPLIS.reduce((expr, [de, vers]) => `replace(${expr}, '${de}', '${vers}')`, champ)})`;
}

/**
 * Un « AND (champ LIKE … OR champ LIKE …) » qui ignore accents et casse, ou rien du tout
 * quand il n'y a rien à chercher. Le motif est passé en paramètre : jamais concaténé.
 */
export function clauseTexte(champs, recherche, params) {
  const q = normaliserPourComparaison(recherche);
  if (!q) return '';
  params.push(`%${q}%`);
  const n = params.length;
  return ` AND (${champs.map(c => `${sansAccentsSql(c)} LIKE $${n}`).join(' OR ')})`;
}
