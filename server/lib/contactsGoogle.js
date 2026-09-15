// La traduction entre une fiche client de SuiviPro et un contact Google, dans les deux sens.
//
// Tout ce fichier est du calcul : aucune requête, aucune base. C'est voulu — c'est la seule
// partie de la synchronisation qui puisse être vérifiée sans compte Google, et c'est aussi
// celle où une erreur ferait le plus de dégâts (écraser un numéro, renommer un client).
//
// Deux règles posées par la maison, et qui ne se discutent pas ici :
// — le nom de l'établissement appartient à SuiviPro. Il part vers Google, il n'en revient
//   jamais. Il sert à détecter les doublons : une correction faite à la va-vite sur un
//   téléphone se propagerait partout.
// — un contact créé dans Google ne crée rien dans SuiviPro. On ne regarde que les contacts
//   que nous avons nous-mêmes déposés.

/** Les champs qu'on demande à Google. Tout le reste de la fiche ne nous regarde pas. */
export const CHAMPS_PERSONNE = 'metadata,names,phoneNumbers,emailAddresses,addresses,biographies,userDefined,memberships';

/** Le libellé sous lequel les contacts sont rangés dans Google, pour pouvoir tout retirer d'un coup. */
export const NOM_DU_GROUPE = 'SuiviPro';

const texte = (v) => String(v ?? '').trim();

/**
 * Les valeurs qui circulent entre les deux côtés, sous une forme unique et comparable.
 * C'est la référence : ce qu'on pousse, ce qu'on relit, ce qu'on compare.
 * @param {object} client
 */
export function valeursDuClient(client) {
  return {
    nom: texte(client.nom),
    contact: texte(client.contact),
    telephone: texte(client.telephone),
    telephone_mobile: texte(client.telephone_mobile),
    email: texte(client.email),
    adresse: texte(client.adresse),
    code_postal: texte(client.code_postal),
    ville: texte(client.ville),
    notes: texte(client.notes),
  };
}

/**
 * Les mêmes valeurs, relues depuis un contact Google.
 *
 * Les numéros : Google rend le numéro tel qu'il a été saisi et, à côté, une version
 * normalisée. On garde la saisie — sinon chaque synchronisation réécrirait « 04 77 12 34 56 »
 * en « +33 4 77 12 34 56 » et la fiche changerait sans que personne n'y touche.
 * @param {object} personne
 */
export function valeursDeLaPersonne(personne) {
  const p = personne || {};
  const numeros = Array.isArray(p.phoneNumbers) ? p.phoneNumbers : [];
  const mobile = numeros.find(n => texte(n.type).toLowerCase() === 'mobile');
  const fixe = numeros.find(n => n !== mobile);
  const adresse = (Array.isArray(p.addresses) ? p.addresses : [])[0] || {};
  const perso = Array.isArray(p.userDefined) ? p.userDefined : [];
  const champ = (cle) => texte((perso.find(u => texte(u.key) === cle) || {}).value);
  return {
    nom: texte((Array.isArray(p.names) ? p.names : [])[0]?.displayName
      || (Array.isArray(p.names) ? p.names : [])[0]?.givenName),
    contact: champ('Contact'),
    telephone: texte(fixe && fixe.value),
    telephone_mobile: texte(mobile && mobile.value),
    email: texte((Array.isArray(p.emailAddresses) ? p.emailAddresses : [])[0]?.value),
    adresse: texte(adresse.streetAddress),
    code_postal: texte(adresse.postalCode),
    ville: texte(adresse.city),
    notes: texte((Array.isArray(p.biographies) ? p.biographies : [])[0]?.value),
  };
}

/** L'empreinte de ce qui a été déposé la dernière fois, pour reconnaître nos propres écritures. */
export function empreinte(valeurs) {
  return JSON.stringify(valeurs);
}

/** L'identifiant SuiviPro inscrit dans le contact, qui survit même si le lien est perdu. */
export function identifiantInscrit(personne) {
  const perso = Array.isArray(personne?.userDefined) ? personne.userDefined : [];
  return texte((perso.find(u => texte(u.key) === 'SuiviPro') || {}).value);
}

/** Les champs que Google a le droit de modifier lors d'une mise à jour. */
export const CHAMPS_MODIFIABLES = 'names,phoneNumbers,emailAddresses,addresses,biographies,userDefined';

/**
 * Le contact Google correspondant à une fiche client.
 * Les champs vides ne sont pas envoyés : un tableau vide efface la valeur chez Google, ce
 * qui est exactement ce qu'on veut quand SuiviPro a effacé un numéro.
 * @param {object} client
 * @param {string} [groupe] Le libellé où ranger le contact, à la création seulement.
 */
export function contactDepuisClient(client, groupe) {
  const v = valeursDuClient(client);
  const personne = { names: [{ givenName: v.nom || 'Sans nom' }] };

  const numeros = [];
  if (v.telephone) numeros.push({ value: v.telephone, type: 'work' });
  if (v.telephone_mobile) numeros.push({ value: v.telephone_mobile, type: 'mobile' });
  personne.phoneNumbers = numeros;

  personne.emailAddresses = v.email ? [{ value: v.email, type: 'work' }] : [];

  personne.addresses = (v.adresse || v.code_postal || v.ville)
    ? [{ streetAddress: v.adresse, postalCode: v.code_postal, city: v.ville, country: 'France', type: 'work' }]
    : [];

  personne.biographies = v.notes ? [{ value: v.notes, contentType: 'TEXT_PLAIN' }] : [];

  // Deux champs personnalisés : la personne à qui l'on parle, et l'identifiant de la fiche.
  // Google n'a pas de case « interlocuteur » pour un établissement, et un champ personnalisé
  // se relit tel quel — contrairement à une ligne glissée dans les notes, qu'il faudrait
  // analyser pour la retrouver.
  const perso = [{ key: 'SuiviPro', value: texte(client.id) }];
  if (v.contact) perso.push({ key: 'Contact', value: v.contact });
  personne.userDefined = perso;

  if (groupe) personne.memberships = [{ contactGroupMembership: { contactGroupResourceName: groupe } }];
  return personne;
}

/**
 * Ce qu'il faut écrire dans SuiviPro après une modification faite dans Google.
 *
 * On ne se contente pas de comparer Google à la fiche : on compare Google à ce que NOUS
 * avions déposé. Sans ça, une valeur jamais touchée dans Google écraserait une correction
 * qui vient d'être faite dans SuiviPro. Un champ ne remonte que s'il a vraiment bougé côté
 * Google depuis notre dernier dépôt.
 *
 * @param {object} personne Le contact tel que Google le rend aujourd'hui.
 * @param {string} empreinteDeposee L'empreinte de ce qu'on avait déposé.
 * @returns {object} Les colonnes à mettre à jour, vide s'il n'y a rien à faire.
 */
export function changementsDepuisContact(personne, empreinteDeposee) {
  let avant;
  try { avant = JSON.parse(empreinteDeposee || '{}'); } catch { avant = {}; }
  const apres = valeursDeLaPersonne(personne);
  const changements = {};
  for (const cle of Object.keys(apres)) {
    // Le nom appartient à SuiviPro : il repartira tel quel au prochain dépôt.
    if (cle === 'nom') continue;
    if (!(cle in avant)) continue;
    if (apres[cle] !== avant[cle]) changements[cle] = apres[cle];
  }
  return changements;
}
