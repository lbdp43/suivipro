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
  | 'autre';

export const ESTABLISHMENT_LABELS: Record<EstablishmentType, string> = {
  bar_restaurant: 'Bar / Restaurant',
  cave: 'Cave',
  epicerie: 'Epicerie',
  supermarche: 'Supermarche / GMS',
  marche: 'Marche',
  distributeur: 'Distributeur',
  hotel: 'Hotel',
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
  autre: 'MapPin',
};

export type PipelineStage =
  | 'nouveau'
  | 'a_contacter'
  | 'contacte'
  | 'rdv_pris'
  | 'proposition'
  | 'negociation'
  | 'gagne'
  | 'perdu';

export const PIPELINE_LABELS: Record<PipelineStage, string> = {
  nouveau: 'Nouveau',
  a_contacter: 'A contacter',
  contacte: 'Contacte',
  rdv_pris: 'RDV pris',
  proposition: 'Proposition',
  negociation: 'Negociation',
  gagne: 'Gagne',
  perdu: 'Perdu',
};

export const PIPELINE_COLORS: Record<PipelineStage, string> = {
  nouveau: '#6b7280',
  a_contacter: '#3b82f6',
  contacte: '#8b5cf6',
  rdv_pris: '#f59e0b',
  proposition: '#f97316',
  negociation: '#ef4444',
  gagne: '#22c55e',
  perdu: '#dc2626',
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
}
