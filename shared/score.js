// ============================================================================
// Score d'un prospect calculé d'après ses tags. Chaque tag vaut un nombre de points, positifs
// ou négatifs (réglé dans Administration → Tags). Score = 50 + somme des points, borné 0–100 :
// un prospect sans tag vaut 50, les tags le font monter ou descendre.
// Tant qu'aucun tag n'a de points, le barème est « inactif » : le score manuel reste.
// Utilisé par le serveur (source de vérité) et par les écrans (affichage immédiat).
// ============================================================================

export function baremeActif(tousLesTags) {
  return (tousLesTags || []).some(t => Number(t.points) > 0 || Number(t.points) < 0);
}

export const SCORE_DE_BASE = 50;

export function scoreDepuisTags(tagsDuProspect, tousLesTags, scoreActuel) {
  if (!baremeActif(tousLesTags)) return scoreActuel;
  const bareme = new Map((tousLesTags || []).map(t => [t.id, Number(t.points) || 0]));
  const total = (tagsDuProspect || []).reduce((s, id) => s + (bareme.get(id) || 0), 0);
  return Math.max(0, Math.min(100, Math.round(SCORE_DE_BASE + total)));
}
