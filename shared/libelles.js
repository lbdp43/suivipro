// ============================================================================
// Les libellés lisibles des codes du logiciel — UNE seule définition, partagée par
// les écrans, le serveur et le MCP. « BAR_RESTAURANT_2024 » ne veut rien dire pour
// personne : ici, et ici seulement, il devient « Bar Restaurant 2024 ».
// ============================================================================

/** Libellé d'un code, ou le code lui-même quand il n'est pas connu (étape sur mesure, type importé). */
export function libelle(table, code) {
  if (!code) return '';
  return table[code] || String(code);
}

export const LIBELLES_TYPE_ETABLISSEMENT = {
  bar_restaurant: 'Bar / Restaurant',
  cave: 'Cave',
  epicerie: 'Epicerie',
  supermarche: 'Supermarche / GMS',
  marche: 'Marche',
  distributeur: 'Distributeur',
  hotel: 'Hotel',
  camping: 'Camping',
  traiteur: 'Traiteur',
  association: 'Association',
  comite_entreprise: 'Comite d\'entreprise',
  collectivite: 'Collectivite',
  autre: 'Autre',
};

export const LIBELLES_TYPE_CLIENT = {
  BAR_RESTAURANT_GENERAL: 'Bar Restaurant',
  BAR_RESTAURANT_2024: 'Bar Restaurant 2024',
  CAVE_EPICERIE: 'Cave Epicerie',
  CAVE_EPICERIE_2024: 'Cave Epicerie 2024',
  SOUCHON: 'Souchon',
  SOUCHON_HORS_DROIT: 'Hors Droit Souchon',
  CLIENT_SOUCHON: 'Client Souchon',
  GRAND_PUBLIC: 'Grand Public',
  GRAND_PUBLIC_2024: 'Grand Public 2024',
  COMITE_ENTREPRISE: 'Comite Entreprise',
  DISTRIBUTEUR: 'Distributeur',
  EXPORT: 'Export',
  MARIAGE: 'Mariage',
  PICOLOGIE: 'Picologie',
};

/** Jours entre deux visites, par type de client. `null` = pas de récurrence (jamais « en retard »). */
export const FREQUENCES_VISITE = {
  BAR_RESTAURANT_GENERAL: 15,
  BAR_RESTAURANT_2024: 15,
  CAVE_EPICERIE: 30,
  CAVE_EPICERIE_2024: 30,
  SOUCHON: 30,
  SOUCHON_HORS_DROIT: 30,
  CLIENT_SOUCHON: 30,
  GRAND_PUBLIC: null,
  GRAND_PUBLIC_2024: null,
  COMITE_ENTREPRISE: 60,
  DISTRIBUTEUR: 45,
  EXPORT: 90,
  MARIAGE: null,
  PICOLOGIE: 30,
};

export const LIBELLES_ETAPE = {
  partage: 'Nouveau partagé',
  nouveau_datagouv: 'Importé Datagouv',
  nouveau: 'Nouveau',
  a_contacter: 'À contacter',
  contacte: 'Contacte',
  proposition: 'Proposition',
  negociation: 'Negociation',
  gagne: 'RDV',
  client_gagne: 'Gagne',
  perdu: 'Perdu',
  ne_pas_contacter: 'Ne pas contacter',
};

export const LIBELLES_RESULTAT_APPEL = {
  repondu: 'Répondu',
  pas_de_reponse: 'Pas de réponse',
  messagerie: 'Messagerie',
  injoignable: 'Injoignable',
  email_envoye: 'Email envoyé',
};

export const LIBELLES_STATUT_RDV = {
  planifie: 'Planifié',
  confirme: 'Confirmé',
  termine: 'Terminé',
  annule: 'Annulé',
};

export const LIBELLES_RESULTAT_RDV = {
  client: 'Client',
  mail_envoye: 'Mail envoyé',
  commande_plus_tard: 'Commande plus tard',
  a_relancer: 'À relancer',
  pas_interesse: 'Pas intéressé',
  decale: 'RDV décalé',
};

export const LIBELLES_INTERACTION = {
  VISITE: 'Visite',
  APPEL: 'Appel',
  RDV_PLANIFIE: 'RDV planifié',
};

/** Les quatre couleurs d'un client, en toutes lettres (voir shared/regles.js → statutVisite). */
export const LIBELLES_STATUT_VISITE = {
  RETARD: 'En retard',
  AUJOURDHUI: 'À visiter aujourd\'hui',
  A_VENIR: 'À venir',
  SANS_RECURRENCE: 'Sans récurrence',
  INACTIF: 'Inactif',
};

export const LIBELLES_STATUT_TACHE = {
  A_FAIRE: 'À faire',
  EN_COURS: 'En cours',
  TERMINEE: 'Terminée',
};

export const LIBELLES_PRIORITE_TACHE = {
  BASSE: 'Basse',
  MOYENNE: 'Moyenne',
  HAUTE: 'Haute',
};

export const LIBELLES_ROLE = {
  admin: 'Administrateur',
  commercial: 'Commercial',
  prospection: 'Prospection',
};

export const LIBELLES_SOURCE_SIGNALEMENT = {
  claude: 'Claude',
  google_maps: 'Google Maps',
  instagram: 'Instagram',
  facebook: 'Facebook',
  site: 'Site internet',
  article: 'Article',
  photo: 'Photo',
  texte: 'Texte',
};

export const LIBELLES_STATUT_SIGNALEMENT = {
  a_qualifier: 'À qualifier',
  qualifie: 'Qualifié',
  ecarte: 'Écarté',
};
