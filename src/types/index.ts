// ============================================
// SuiviPro - Types & Data Models
// La Brasserie des Plantes
// ============================================

export type EstablishmentType =
  | 'bar_restaurant'
  | 'cave'
  | 'epicerie'
  | 'supermarche'
  | 'marche'
  | 'distributeur'
  | 'hotel'
  | 'camping'
  | 'traiteur'
  | 'association'
  | 'comite_entreprise'
  | 'collectivite'
  | 'autre';

export const ESTABLISHMENT_LABELS: Record<EstablishmentType, string> = {
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

export const ESTABLISHMENT_ICONS: Record<EstablishmentType, string> = {
  bar_restaurant: 'UtensilsCrossed',
  cave: 'Wine',
  epicerie: 'ShoppingCart',
  supermarche: 'Store',
  marche: 'Tent',
  distributeur: 'Package',
  hotel: 'Hotel',
  camping: 'Tent',
  traiteur: 'UtensilsCrossed',
  association: 'Users',
  comite_entreprise: 'Building',
  collectivite: 'Building',
  autre: 'MapPin',
};

export type PipelineStage =
  | 'nouveau'
  | 'a_contacter'
  | 'contacte'
  | 'proposition'
  | 'negociation'
  | 'gagne'
  | 'perdu'
  | 'ne_pas_contacter';

export const PIPELINE_LABELS: Record<PipelineStage, string> = {
  nouveau: 'Nouveau',
  a_contacter: 'A contacter',
  contacte: 'Contacte',
  proposition: 'Proposition',
  negociation: 'Negociation',
  gagne: 'RDV / Gagne',
  perdu: 'Perdu',
  ne_pas_contacter: 'Ne pas contacter',
};

export const PIPELINE_COLORS: Record<PipelineStage, string> = {
  nouveau: '#6b7280',
  a_contacter: '#3b82f6',
  contacte: '#8b5cf6',
  proposition: '#f97316',
  negociation: '#ef4444',
  gagne: '#22c55e',
  perdu: '#dc2626',
  ne_pas_contacter: '#991b1b',
};

export type CallResult = 'repondu' | 'pas_de_reponse' | 'messagerie' | 'injoignable';

export const CALL_RESULT_LABELS: Record<CallResult, string> = {
  repondu: 'Repondu',
  pas_de_reponse: 'Pas de reponse',
  messagerie: 'Messagerie',
  injoignable: 'Injoignable',
};

export type AppointmentStatus = 'planifie' | 'confirme' | 'termine' | 'annule';

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  planifie: 'Planifie',
  confirme: 'Confirme',
  termine: 'Termine',
  annule: 'Annule',
};

export type ReminderStatus = 'actif' | 'termine' | 'reporte';

export type UserRole = 'admin' | 'commercial';

// ============================================
// Regions de France (mapping departement → region)
// ============================================

export const DEPARTEMENT_TO_REGION: Record<string, string> = {
  // Auvergne-Rhone-Alpes
  'Ain': 'Auvergne-Rhone-Alpes',
  'Allier': 'Auvergne-Rhone-Alpes',
  'Ardeche': 'Auvergne-Rhone-Alpes',
  'Cantal': 'Auvergne-Rhone-Alpes',
  'Drome': 'Auvergne-Rhone-Alpes',
  'Isere': 'Auvergne-Rhone-Alpes',
  'Loire': 'Auvergne-Rhone-Alpes',
  'Haute-Loire': 'Auvergne-Rhone-Alpes',
  'Puy-de-Dome': 'Auvergne-Rhone-Alpes',
  'Rhone': 'Auvergne-Rhone-Alpes',
  'Savoie': 'Auvergne-Rhone-Alpes',
  'Haute-Savoie': 'Auvergne-Rhone-Alpes',
  // Bourgogne-Franche-Comte
  'Cote-d\'Or': 'Bourgogne-Franche-Comte',
  'Doubs': 'Bourgogne-Franche-Comte',
  'Jura': 'Bourgogne-Franche-Comte',
  'Nievre': 'Bourgogne-Franche-Comte',
  'Haute-Saone': 'Bourgogne-Franche-Comte',
  'Saone-et-Loire': 'Bourgogne-Franche-Comte',
  'Yonne': 'Bourgogne-Franche-Comte',
  'Territoire de Belfort': 'Bourgogne-Franche-Comte',
  // Bretagne
  'Cotes-d\'Armor': 'Bretagne',
  'Finistere': 'Bretagne',
  'Ille-et-Vilaine': 'Bretagne',
  'Morbihan': 'Bretagne',
  // Centre-Val de Loire
  'Cher': 'Centre-Val de Loire',
  'Eure-et-Loir': 'Centre-Val de Loire',
  'Indre': 'Centre-Val de Loire',
  'Indre-et-Loire': 'Centre-Val de Loire',
  'Loir-et-Cher': 'Centre-Val de Loire',
  'Loiret': 'Centre-Val de Loire',
  // Corse
  'Corse-du-Sud': 'Corse',
  'Haute-Corse': 'Corse',
  // Grand Est
  'Ardennes': 'Grand Est',
  'Aube': 'Grand Est',
  'Marne': 'Grand Est',
  'Haute-Marne': 'Grand Est',
  'Meurthe-et-Moselle': 'Grand Est',
  'Meuse': 'Grand Est',
  'Moselle': 'Grand Est',
  'Bas-Rhin': 'Grand Est',
  'Haut-Rhin': 'Grand Est',
  'Vosges': 'Grand Est',
  // Hauts-de-France
  'Aisne': 'Hauts-de-France',
  'Nord': 'Hauts-de-France',
  'Oise': 'Hauts-de-France',
  'Pas-de-Calais': 'Hauts-de-France',
  'Somme': 'Hauts-de-France',
  // Ile-de-France
  'Paris': 'Ile-de-France',
  'Seine-et-Marne': 'Ile-de-France',
  'Yvelines': 'Ile-de-France',
  'Essonne': 'Ile-de-France',
  'Hauts-de-Seine': 'Ile-de-France',
  'Seine-Saint-Denis': 'Ile-de-France',
  'Val-de-Marne': 'Ile-de-France',
  'Val-d\'Oise': 'Ile-de-France',
  // Normandie
  'Calvados': 'Normandie',
  'Eure': 'Normandie',
  'Manche': 'Normandie',
  'Orne': 'Normandie',
  'Seine-Maritime': 'Normandie',
  // Nouvelle-Aquitaine
  'Charente': 'Nouvelle-Aquitaine',
  'Charente-Maritime': 'Nouvelle-Aquitaine',
  'Correze': 'Nouvelle-Aquitaine',
  'Creuse': 'Nouvelle-Aquitaine',
  'Dordogne': 'Nouvelle-Aquitaine',
  'Gironde': 'Nouvelle-Aquitaine',
  'Landes': 'Nouvelle-Aquitaine',
  'Lot-et-Garonne': 'Nouvelle-Aquitaine',
  'Pyrenees-Atlantiques': 'Nouvelle-Aquitaine',
  'Deux-Sevres': 'Nouvelle-Aquitaine',
  'Vienne': 'Nouvelle-Aquitaine',
  'Haute-Vienne': 'Nouvelle-Aquitaine',
  // Occitanie
  'Ariege': 'Occitanie',
  'Aude': 'Occitanie',
  'Aveyron': 'Occitanie',
  'Gard': 'Occitanie',
  'Haute-Garonne': 'Occitanie',
  'Gers': 'Occitanie',
  'Herault': 'Occitanie',
  'Lot': 'Occitanie',
  'Lozere': 'Occitanie',
  'Hautes-Pyrenees': 'Occitanie',
  'Pyrenees-Orientales': 'Occitanie',
  'Tarn': 'Occitanie',
  'Tarn-et-Garonne': 'Occitanie',
  // Pays de la Loire
  'Loire-Atlantique': 'Pays de la Loire',
  'Maine-et-Loire': 'Pays de la Loire',
  'Mayenne': 'Pays de la Loire',
  'Sarthe': 'Pays de la Loire',
  'Vendee': 'Pays de la Loire',
  // Provence-Alpes-Cote d'Azur
  'Alpes-de-Haute-Provence': 'Provence-Alpes-Cote d\'Azur',
  'Hautes-Alpes': 'Provence-Alpes-Cote d\'Azur',
  'Alpes-Maritimes': 'Provence-Alpes-Cote d\'Azur',
  'Bouches-du-Rhone': 'Provence-Alpes-Cote d\'Azur',
  'Var': 'Provence-Alpes-Cote d\'Azur',
  'Vaucluse': 'Provence-Alpes-Cote d\'Azur',
  // DOM-TOM
  'Guadeloupe': 'DOM-TOM',
  'Martinique': 'DOM-TOM',
  'Guyane': 'DOM-TOM',
  'La Reunion': 'DOM-TOM',
  'Mayotte': 'DOM-TOM',
};

export const REGION_LABELS: string[] = [
  'Auvergne-Rhone-Alpes',
  'Bourgogne-Franche-Comte',
  'Bretagne',
  'Centre-Val de Loire',
  'Corse',
  'Grand Est',
  'Hauts-de-France',
  'Ile-de-France',
  'Normandie',
  'Nouvelle-Aquitaine',
  'Occitanie',
  'Pays de la Loire',
  'Provence-Alpes-Cote d\'Azur',
  'DOM-TOM',
];

// ============================================
// Core Entities
// ============================================

export interface Prospect {
  id: string;
  nom_etablissement: string;
  type_etablissement: EstablishmentType;
  nom_contact: string;
  telephone: string;
  email: string;
  adresse: string;
  ville: string;
  code_postal: string;
  departement: string;
  secteur: string;
  latitude: number;
  longitude: number;
  etape_pipeline: PipelineStage;
  tags: string[];
  commercial_id: string;
  notes: string;
  date_creation: string;
  date_modification: string;
  score: number;
}

export interface Call {
  id: string;
  prospect_id: string;
  commercial_id: string;
  date: string;
  duree: number; // seconds
  resultat: CallResult;
  notes: string;
}

export interface Appointment {
  id: string;
  prospect_id: string;
  commercial_id: string;
  prospecteur_id?: string; // celui qui a pris le RDV (l'appelant)
  date: string;
  heure_debut: string;
  heure_fin: string;
  lieu: string;
  notes: string;
  statut: AppointmentStatus;
}

export interface Reminder {
  id: string;
  prospect_id: string;
  commercial_id: string;
  date: string;
  heure: string;
  message: string;
  statut: ReminderStatus;
}

export interface Commercial {
  id: string;
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  role: UserRole;
  password: string;
  objectifs: {
    appels_semaine: number;
    rdv_mois: number;
    prospects_mois: number;
    taux_conversion: number;
  };
}

export interface Tag {
  id: string;
  nom: string;
  couleur: string;
}

export interface EmailTemplate {
  id: string;
  nom: string;
  sujet: string;
  corps: string;
  type: string;
}

export interface PipelineColumn {
  id: PipelineStage;
  label: string;
  color: string;
}

export type DocumentCategory = 'bar_restaurant' | 'prix_ce' | 'cave_epicerie' | 'grand_public' | 'autre';

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  bar_restaurant: 'Bar / Restaurant',
  prix_ce: 'Prix C.E.',
  cave_epicerie: 'Cave / Epicerie',
  grand_public: 'Grand Public',
  autre: 'Autre',
};

export interface Document {
  id: string;
  nom: string;
  categorie: DocumentCategory;
  description: string;
  nom_fichier: string;
  type_mime: string;
  taille: number;
  uploaded_by: string;
  date_creation: string;
}

// ============================================
// App State
// ============================================

export interface AppState {
  prospects: Prospect[];
  calls: Call[];
  appointments: Appointment[];
  reminders: Reminder[];
  commerciaux: Commercial[];
  tags: Tag[];
  emailTemplates: EmailTemplate[];
  currentUser: Commercial | null;
  pipelineColumns: PipelineColumn[];
  documents: Document[];
}
