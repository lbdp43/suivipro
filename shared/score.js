// ============================================================================
// Score d'un prospect calculé d'après ses tags. Chaque tag vaut un nombre de points
// (réglé dans Administration → Tags). Le score est la somme, bornée de 0 à 100.
// Tant qu'aucun tag n'a de points, le barème est « inactif » : le score manuel reste.
// Utilisé par le serveur (source de vérité) et par les écrans (affichage immédiat).
// ============================================================================

export function baremeActif(tousLesTags) {
  return (tousLesTags || []).some(t => Number(t.points) > 0 || Number(t.points) < 0);
}

export function scoreDepuisTags(tagsDuProspect, tousLesTags, scoreActuel) {
  if (!baremeActif(tousLesTags)) return scoreActuel;
  const bareme = new Map((tousLesTags || []).map(t => [t.id, Number(t.points) || 0]));
  const total = (tagsDuProspect || []).reduce((s, id) => s + (bareme.get(id) || 0), 0);
  return Math.max(0, Math.min(100, Math.round(total)));
}
