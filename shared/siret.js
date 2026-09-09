// SIREN, SIRET et numéro de TVA intracommunautaire.
//
// Ces numéros portent leur propre contrôle : un SIREN à neuf chiffres et un SIRET à
// quatorze vérifient la clé de Luhn. On s'en sert pour refuser un numéro inventé plutôt que
// de l'écrire dans une fiche — un SIRET faux est pire qu'un SIRET absent, parce qu'il a
// l'air vrai.
//
// Le numéro de TVA intracommunautaire, lui, ne se stocke pas : c'est une fonction du SIREN.
// Le calculer, c'est ne jamais l'avoir faux.

/** Les chiffres seuls : on accepte « 123 456 789 » ou « 123-456-789 ». */
export function chiffres(valeur) {
  return String(valeur ?? '').replace(/\D/g, '');
}

function luhnValide(numero) {
  let somme = 0;
  for (let i = 0; i < numero.length; i++) {
    // On double un chiffre sur deux en partant de la droite.
    const rangDepuisLaDroite = numero.length - 1 - i;
    let n = Number(numero[i]);
    if (rangDepuisLaDroite % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    somme += n;
  }
  return somme % 10 === 0;
}

export function sirenValide(valeur) {
  const n = chiffres(valeur);
  return n.length === 9 && luhnValide(n);
}

/**
 * La Poste fait exception : ses SIRET (SIREN 356 000 000) ne vérifient pas Luhn, mais la
 * somme de leurs chiffres est un multiple de 5. Sans ce cas, on refuserait des numéros vrais.
 */
export function siretValide(valeur) {
  const n = chiffres(valeur);
  if (n.length !== 14) return false;
  if (n.startsWith('356000000')) {
    return [...n].reduce((s, c) => s + Number(c), 0) % 5 === 0;
  }
  return luhnValide(n);
}

/** Les neuf premiers chiffres d'un SIRET : l'entreprise derrière l'établissement. */
export function sirenDeSiret(valeur) {
  const n = chiffres(valeur);
  return n.length === 14 ? n.slice(0, 9) : '';
}

/**
 * Le numéro de TVA intracommunautaire français : FR, une clé sur deux chiffres, puis le
 * SIREN. La clé vaut (12 + 3 × (SIREN mod 97)) mod 97.
 */
export function tvaIntracom(valeur) {
  const n = chiffres(valeur);
  const siren = n.length === 14 ? n.slice(0, 9) : n;
  if (!sirenValide(siren)) return '';
  const cle = (12 + 3 * (Number(siren) % 97)) % 97;
  return `FR${String(cle).padStart(2, '0')}${siren}`;
}

/** « 123 456 789 » et « 123 456 789 00012 » — la façon dont l'INSEE les écrit. */
export function formaterSiren(valeur) {
  const n = chiffres(valeur);
  return n.length === 9 ? `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}` : n;
}

export function formaterSiret(valeur) {
  const n = chiffres(valeur);
  return n.length === 14 ? `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6, 9)} ${n.slice(9)}` : n;
}
