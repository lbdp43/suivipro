// Les fonds de carte, déclarés à un seul endroit — pour le navigateur ET pour le serveur.
//
// Pourquoi les deux : le navigateur va chercher les tuiles, mais c'est le serveur qui
// décide, par son en-tête Content-Security-Policy, quels domaines d'images il autorise.
// Les deux listes doivent dire exactement la même chose. Quand elles ont divergé — le code
// demandait Carto, IGN et Esri pendant que la politique n'autorisait qu'OpenStreetMap — le
// navigateur a refusé chaque tuile sans que l'application le voie : carte entièrement
// blanche, aucune erreur réseau, aucune trace côté serveur. D'où ce fichier unique.

/**
 * @typedef {object} FondDeCarte
 * @property {string} nom
 * @property {string} url
 * @property {string} attribution
 * @property {string} [sousDomaines] Sous-domaines pour répartir les requêtes.
 * @property {number} [zoomMax]
 */

/**
 * Les fonds, dans l'ordre où on les essaie.
 *
 * L'IGN d'abord : c'est un service public français, ouvert, sans clé et sans restriction
 * d'usage commercial. C'est le seul de la liste dont rien ne peut nous couper l'accès du
 * jour au lendemain. Son seul défaut : il s'arrête aux frontières, donc la Suisse et
 * l'Italie apparaissent vides sur une vue large — sans conséquence, la prospection est en
 * France.
 *
 * Esri ensuite, qui couvre le monde entier, au cas où la Géoplateforme serait indisponible.
 *
 * Deux fournisseurs écartés, et pourquoi — pour ne pas y revenir :
 * — OpenStreetMap : leur politique d'usage réserve leurs serveurs, tenus par des bénévoles,
 *   aux essais et aux petits projets. Ils ont fini par bloquer l'application, et le blocage
 *   s'affichait à la place de chaque tuile : « Access blocked ».
 * — Carto : demande désormais une clé d'API. Sans clé, il répond quand même — mais chaque
 *   tuile porte « API KEY REQUIRED » en travers. C'est le pire cas pour la bascule
 *   automatique plus bas : le serveur répond correctement, l'image s'affiche, rien ne
 *   ressemble à une panne. Aucun code ne peut rattraper ça ; seul un œil le voit.
 *
 * @type {FondDeCarte[]}
 */
export const FONDS_DE_CARTE = [
  {
    nom: 'IGN',
    url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
      + '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM'
      + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png',
    attribution: '&copy; <a href="https://www.ign.fr/">IGN</a> — Géoplateforme',
    zoomMax: 19,
  },
  {
    nom: 'Esri',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
    zoomMax: 19,
  },
];

/**
 * Le domaine d'un fond, sous la forme attendue par une politique de sécurité : le modèle
 * « {s} » des sous-domaines devient le joker « * ».
 * @param {string} url
 * @returns {string}
 */
export function hoteDuFond(url) {
  const propre = String(url || '').replace('{s}.', '*.');
  const m = /^https:\/\/[^/?#]+/.exec(propre);
  return m ? m[0] : '';
}

/**
 * Tous les domaines à autoriser pour les images de fond de carte.
 * @param {string[]} [enPlus] Domaines supplémentaires (fond imposé par la configuration).
 * @returns {string[]}
 */
export function hotesDesFonds(enPlus = []) {
  const tous = FONDS_DE_CARTE.map(f => hoteDuFond(f.url)).concat(enPlus.map(hoteDuFond));
  return [...new Set(tous.filter(Boolean))];
}
