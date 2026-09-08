// La configuration de tournée d'un commercial est stockée en JSON texte
// ({ "1": ["Zone A"], "2": ["Zone B"], prospection: [...] }). Une seule façon de la lire,
// côté serveur comme à l'écran : texte, objet ou rien, on obtient toujours un objet.
export function lireConfigTournee(valeur) {
  if (!valeur) return {};
  if (typeof valeur === 'object') return Array.isArray(valeur) ? {} : valeur;
  try {
    const c = JSON.parse(valeur);
    return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
  } catch {
    return {};
  }
}
