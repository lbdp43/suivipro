// Normalisation des noms, identifiants et téléphones : LA même partout (serveur, écran,
// import, partage). Un seul endroit décide ce que « même nom » ou « même numéro » veut dire.

/** Minuscules, sans accents, sans espaces autour. */
export function sansAccents(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Pour comparer des libellés : sans accents, sans ponctuation, espaces simples. */
export function normaliserPourComparaison(s) {
  return sansAccents(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Raison sociale comparable : sans accents, sans forme juridique, sans article de tête,
 * sans ponctuation. « L'Atelier du Coin SARL » et « atelier du coin » donnent la même chaîne.
 */
export function normaliserNomEtablissement(nom) {
  return sansAccents(nom)
    // Ponctuation d'abord : « l'atelier » devient « l atelier », donc l'article de tête
    // se retire ensuite comme un mot ordinaire.
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(sarl|sas|sasu|eurl|eirl|sa|snc|scop|sci|ets|etablissements)\b/g, ' ')
    .replace(/^\s*(l|le|la|les|au|aux|chez|the)\s+/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Les mots d'un nom qui portent du sens (plus de deux lettres). */
export function motsSignificatifs(nom) {
  return normaliserNomEtablissement(nom).split(' ').filter(m => m.length > 2);
}

/** Identifiant (SIRET, mail, numéro) réduit à ses lettres et chiffres. */
export function normaliserIdentifiant(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Chiffres d'un numéro de téléphone, indicatif international ramené au 0 : +33 6… → 06… */
export function chiffresTelephone(tel) {
  const chiffres = String(tel || '').replace(/\D/g, '');
  return chiffres.replace(/^0033/, '0').replace(/^33(?=\d{9}$)/, '0');
}

/** Deux numéros désignent la même ligne : mêmes neuf derniers chiffres. */
export function memeTelephone(a, b) {
  const x = chiffresTelephone(a).slice(-9), y = chiffresTelephone(b).slice(-9);
  return x.length === 9 && x === y;
}
