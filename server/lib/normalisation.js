// Helpers partagés (normalisation) — déplacés tels quels depuis routes.js.

// Normalisation « raison sociale » : sans accents, sans forme juridique, sans article
// de tete, sans ponctuation. « L'Atelier du Coin SARL » et « atelier du coin » se
// ramenent a la meme chaine.
export function normaliserNomClient(nom) {
  return String(nom || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    // Ponctuation d'abord : « l'atelier » devient « l atelier », donc l'article de tete
    // se retire ensuite comme un mot ordinaire.
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(sarl|sas|sasu|eurl|eirl|sa|snc|scop|sci|ets|etablissements)\b/g, ' ')
    .replace(/^\s*(l|le|la|les|au|aux|chez|the)\s+/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
