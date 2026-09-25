// Documents à lire et signer : une seule règle, lue par le serveur et par l'écran.
//
// Un document « à signer » concerne soit toute l'équipe (signataires vide), soit une liste
// de personnes. « Toute l'équipe » se lit au moment où l'on regarde : quelqu'un qui arrive
// après la publication doit le signer aussi — c'est le cas d'un règlement intérieur.
// Celui qui a publié le document n'a pas à le signer, sauf s'il s'est nommé lui-même.
//
// Une signature vaut pour une version du fichier. Remplacer le fichier crée une nouvelle
// version : les signatures précédentes restent dans l'historique, mais ne comptent plus.

/** Liste des personnes nommées, ou null pour « toute l'équipe ». */
export function lireSignataires(valeur) {
  if (Array.isArray(valeur)) return valeur.length ? valeur.map(String) : null;
  if (typeof valeur !== 'string' || !valeur.trim()) return null;
  try {
    const liste = JSON.parse(valeur);
    return Array.isArray(liste) && liste.length ? liste.map(String) : null;
  } catch { return null; }
}

/** Cette personne doit-elle signer ce document ? */
export function doitSigner(doc, personneId) {
  if (!doc || !doc.a_signer || !personneId) return false;
  const nommes = lireSignataires(doc.signataires);
  if (nommes) return nommes.includes(personneId);
  return personneId !== doc.uploaded_by;
}

/** A-t-elle signé la version en cours ? */
export function aSigne(doc, personneId, signatures) {
  const version = Number(doc?.version) || 1;
  return (signatures || []).some(s => s.doc_id === doc.id && s.user_id === personneId && Number(s.version) === version);
}

/** Les personnes concernées parmi l'équipe active. */
export function concernes(doc, equipe) {
  return (equipe || []).filter(p => p.actif !== false && doitSigner(doc, p.id));
}
