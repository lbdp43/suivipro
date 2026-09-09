// SIREN, SIRET et numéro de TVA intracommunautaire.
//
// Ces numéros portent leur propre contrôle : un SIREN à neuf chiffres et un SIRET à
// quatorze vérifient la clé de Luhn. On s'en sert pour refuser un numéro inventé plutôt que
// de l'écrire dans une fiche — un SIRET faux est pire qu'un SIRET absent, parce qu'il a
// l'air vrai.
//
// Le numéro de TVA intracommunautaire français, lui, ne se stocke pas : c'est une fonction
// du SIREN. Le calculer, c'est ne jamais l'avoir faux. On ne garde un numéro saisi que
// lorsqu'il ne se calcule pas — celui d'une société étrangère.

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

/** Un numéro de TVA écrit sans espaces ni points, en majuscules : « fr 03 552 081 317 » → « FR03552081317 ». */
export function normaliserTva(valeur) {
  return String(valeur ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** La forme d'un numéro intracommunautaire : deux lettres de pays, puis 2 à 13 caractères. */
export function tvaPlausible(valeur) {
  return /^[A-Z]{2}[A-Z0-9]{2,13}$/.test(normaliserTva(valeur));
}

/**
 * Le SIREN caché dans un numéro de TVA français — utile quand on tient le numéro de TVA
 * mais pas le SIREN. On ne le rend que si la clé se recalcule : un numéro qui ne retombe
 * pas sur lui-même est faux, et en tirer un SIREN reviendrait à l'inventer.
 * (Les vieux numéros dont la clé porte des lettres ne sont pas reconnus : on préfère ne
 * rien rendre à rendre un SIREN douteux.)
 */
export function sirenDeTva(valeur) {
  const t = normaliserTva(valeur);
  if (!/^FR\d{11}$/.test(t)) return '';
  const siren = t.slice(4);
  return tvaIntracom(siren) === t ? siren : '';
}
