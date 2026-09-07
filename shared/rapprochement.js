// LE moteur de rapprochement : dit si deux fiches (clients, prospects, fiches EasyBeer,
// lignes d'import) désignent le même établissement. Utilisé par les doublons clients,
// les doublons prospects ↔ clients, l'audit des liens EasyBeer, les contrôles à la saisie
// et l'import. Une seule règle, donc un seul résultat, où qu'on regarde.
import { normaliserNomEtablissement, motsSignificatifs, normaliserIdentifiant, chiffresTelephone, sansAccents } from './normalisation.js';

/** Formes normalisées d'une fiche, calculées une fois (comparer 1 000 fiches = 500 000 paires). */
export function preparerFiche(f) {
  if (f && f._nom !== undefined) return f;
  const nom = f.nom ?? f.nom_etablissement ?? f.name ?? '';
  return {
    ...f,
    _nom: normaliserNomEtablissement(nom),
    _mots: motsSignificatifs(nom),
    _siret: normaliserIdentifiant(f.siret),
    _email: normaliserIdentifiant(f.email),
    _tel: chiffresTelephone(f.telephone ?? f.phone).slice(-9),
    _tel2: chiffresTelephone(f.telephone_mobile).slice(-9),
    _ville: sansAccents(f.ville ?? f.city ?? ''),
  };
}

/**
 * Compare deux fiches. Renvoie { score, motif } ou null si elles n'ont rien à voir.
 * 100 = certain (SIRET, mail ou téléphone partagé), 80 = nom identique,
 * 60 = un nom contient l'autre, 40 = mêmes mots significatifs.
 * `_emailPartage` / `_telPartage` : identifiant porté par trois fiches ou plus (boîte mail
 * de la société, standard) ; il ne prouve plus rien, on compare alors sur le nom.
 */
export function comparerFiches(a, b) {
  a = preparerFiche(a); b = preparerFiche(b);
  if (a._siret && a._siret.length >= 9 && a._siret === b._siret) return { score: 100, motif: 'SIRET identique' };
  if (a._email && a._email === b._email && !a._emailPartage && !b._emailPartage) return { score: 100, motif: 'Email identique' };
  const tels = [a._tel, a._tel2].filter(t => t && t.length === 9);
  const telsB = [b._tel, b._tel2].filter(t => t && t.length === 9);
  if (!a._telPartage && !b._telPartage && tels.some(t => telsB.includes(t))) return { score: 100, motif: 'Téléphone identique' };

  const nA = a._nom, nB = b._nom;
  if (!nA || !nB || nA.length < 4 || nB.length < 4) return null;
  if (nA === nB) return { score: 80, motif: 'Nom identique' };
  if (nA.includes(nB) || nB.includes(nA)) return { score: 60, motif: "Un nom contient l'autre" };

  const mA = a._mots, mB = b._mots;
  if (mA.length === 0 || mB.length === 0) return null;
  const communs = mA.filter(m => mB.includes(m));
  // Un seul mot commun ne prouve rien (« Bar A » / « Bar B ») : il en faut au moins deux,
  // et qu'ils couvrent l'essentiel des DEUX noms (sinon « Bar de la Poste » et « Bar du
  // Marché » seraient appariés par le seul mot « bar »).
  if (communs.length < 2) return null;
  const couverture = Math.min(communs.length / mA.length, communs.length / mB.length);
  if (couverture >= 0.75) return { score: 40, motif: `Mots communs : ${communs.join(', ')}` };
  return null;
}

/**
 * Les preuves qu'un lien entre deux fiches (ex. fiche EasyBeer ↔ client) est le bon :
 * 'siret', 'email', 'telephone', 'nom_exact', 'nom_partiel'. Et le verdict qui en découle.
 */
export function preuvesDeLien(a, b) {
  a = preparerFiche(a); b = preparerFiche(b);
  const preuves = [];
  if (a._siret && b._siret && a._siret === b._siret) preuves.push('siret');
  if (a._email && b._email && a._email === b._email) preuves.push('email');
  const tels = [a._tel, a._tel2].filter(t => t && t.length >= 8);
  const telsB = [b._tel, b._tel2].filter(Boolean);
  if (tels.some(t => telsB.some(u => u.includes(t) || t.includes(u)))) preuves.push('telephone');
  if (a._nom && a._nom === b._nom) preuves.push('nom_exact');
  else if (a._mots.some(m => b._mots.includes(m))) preuves.push('nom_partiel');
  return preuves;
}

export function verdictDeLien(preuves) {
  if (preuves.length === 0) return 'suspect';
  if (!preuves.some(p => ['siret', 'email', 'telephone', 'nom_exact'].includes(p))) return 'a_verifier';
  return 'ok';
}

/**
 * Contrôle à la saisie : les fiches d'une liste qui ressemblent à ce qu'on est en train de
 * taper (nom qui se contient, numéro ou mail qui se contient). Volontairement large :
 * c'est un avertissement, pas une décision.
 */
export function candidatsDoublons(saisie, liste) {
  const nom = normaliserNomEtablissement(saisie.nom ?? saisie.nom_etablissement ?? '');
  const tel = chiffresTelephone(saisie.telephone);
  const email = sansAccents(saisie.email);
  if (nom.length < 3 && tel.length < 4 && email.length < 5) return [];
  return liste.filter(f => {
    const n = normaliserNomEtablissement(f.nom ?? f.nom_etablissement ?? '');
    if (nom.length >= 3 && n && (n.includes(nom) || nom.includes(n))) return true;
    if (tel.length >= 4 && (chiffresTelephone(f.telephone).includes(tel) || chiffresTelephone(f.telephone_mobile).includes(tel))) return true;
    if (email.length >= 5 && f.email && sansAccents(f.email).includes(email)) return true;
    return false;
  });
}
