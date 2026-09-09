// ============================================
// SuiviPro - Types & Data Models
// La Brasserie des Plantes
// ============================================

// Les libellés lisibles vivent dans shared/libelles.js : une seule définition pour les
// écrans, le serveur et le MCP. Ici on ne fait que les typer.
import {
  LIBELLES_TYPE_ETABLISSEMENT, LIBELLES_TYPE_CLIENT, FREQUENCES_VISITE, LIBELLES_ETAPE,
  LIBELLES_RESULTAT_APPEL, LIBELLES_STATUT_RDV, LIBELLES_RESULTAT_RDV, LIBELLES_INTERACTION,
  LIBELLES_STATUT_TACHE, LIBELLES_PRIORITE_TACHE,
} from '../../shared/libelles';

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

export const ESTABLISHMENT_LABELS = LIBELLES_TYPE_ETABLISSEMENT as Record<EstablishmentType, string>;

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
  | 'partage'
  | 'nouveau_datagouv'
  | 'nouveau'
  | 'a_contacter'
  | 'contacte'
  | 'proposition'
  | 'negociation'
  | 'gagne'
  | 'client_gagne'
  | 'perdu'
  | 'ne_pas_contacter';

export const PIPELINE_LABELS = LIBELLES_ETAPE as Record<PipelineStage, string>;

export const PIPELINE_COLORS: Record<PipelineStage, string> = {
  partage: '#a855f7',
  nouveau_datagouv: '#0ea5e9',
  nouveau: '#6b7280',
  a_contacter: '#3b82f6',
  contacte: '#8b5cf6',
  proposition: '#f97316',
  negociation: '#ef4444',
  gagne: '#22c55e',
  client_gagne: '#16a34a',
  perdu: '#dc2626',
  ne_pas_contacter: '#991b1b',
};

// Short explanation of how a prospect typically lands in each stage.
// Only the original built-in stages have a known rule - custom
// admin-created stages have no entry here (nothing to show).
export const PIPELINE_DESCRIPTIONS: Partial<Record<PipelineStage, string>> = {
  partage: 'fiche Google partagée depuis le téléphone, à compléter',
  nouveau_datagouv: 'importé automatiquement depuis data.gouv',
  nouveau: 'créé manuellement, pas encore contacte',
  a_contacter: 'en attente du premier appel/visite',
  contacte: 'après appel + rappel programme, ou email envoyé',
  proposition: 'RDV : commande plus tard / à relancer',
  negociation: 'RDV : mail envoyé, ou email envoyé depuis la fiche',
  gagne: 'RDV pris (planifié ou lors d\'un appel)',
  client_gagne: 'RDV : Client, ou converti manuellement en client',
  perdu: 'RDV ou appel : pas intéressé',
  ne_pas_contacter: 'appel : ne pas contacter, ou import liste noire',
};

export type CallResult = 'repondu' | 'pas_de_reponse' | 'messagerie' | 'injoignable' | 'email_envoye';

export const CALL_RESULT_LABELS = LIBELLES_RESULTAT_APPEL as Record<CallResult, string>;
/** Comment s'est passé un appel avec un CLIENT (enregistré comme interaction « APPEL »). */
export type IssueAppelClient = 'commande' | 'interesse' | 'courtoisie' | 'probleme' | 'pas_de_reponse' | 'a_rappeler';
export const ISSUES_APPEL_CLIENT: { value: IssueAppelClient; label: string; suite?: { titre: string; jours: number } }[] = [
  { value: 'commande', label: 'Commande passée ou à venir' },
  { value: 'interesse', label: 'Intéressé, à relancer', suite: { titre: 'Relancer après l\'appel', jours: 7 } },
  { value: 'courtoisie', label: 'Appel de courtoisie, besoin de rien' },
  { value: 'probleme', label: 'Problème ou mécontentement', suite: { titre: 'Suivre le problème signalé', jours: 2 } },
  { value: 'pas_de_reponse', label: 'Pas de réponse', suite: { titre: 'Rappeler (pas de réponse)', jours: 2 } },
  { value: 'a_rappeler', label: 'À rappeler plus tard', suite: { titre: 'Rappeler', jours: 7 } },
];
export const ISSUE_APPEL_CLIENT_LABELS: Record<IssueAppelClient, string> = Object.fromEntries(ISSUES_APPEL_CLIENT.map(i => [i.value, i.label])) as Record<IssueAppelClient, string>;

/** Résultats qu'on peut choisir à la main pour un appel (« Email envoyé » est posé automatiquement). */
export const RESULTATS_APPEL_SAISISSABLES: CallResult[] = ['repondu', 'pas_de_reponse', 'messagerie', 'injoignable'];

export type AppointmentStatus = 'planifie' | 'confirme' | 'termine' | 'annule';

export const APPOINTMENT_STATUS_LABELS = LIBELLES_STATUT_RDV as Record<AppointmentStatus, string>;

export type EventType = 'rdv' | 'reunion' | 'boutique' | 'depot' | 'marche' | 'autre';

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  rdv: 'RDV Client/Prospect',
  reunion: 'Réunion',
  boutique: 'Boutique',
  depot: 'Dépôt',
  marche: 'Marche',
  autre: 'Autre',
};

export const EVENT_TYPE_COLORS: Record<EventType, string> = {
  rdv: 'bg-blue-100 text-blue-800',
  reunion: 'bg-purple-100 text-purple-800',
  boutique: 'bg-amber-100 text-amber-800',
  depot: 'bg-orange-100 text-orange-800',
  marche: 'bg-green-100 text-green-800',
  autre: 'bg-gray-100 text-gray-800',
};

export type RecurrenceType = 'none' | 'weekly';

export const DAYS_OF_WEEK_LABELS: Record<number, string> = {
  1: 'Lundi',
  2: 'Mardi',
  3: 'Mercredi',
  4: 'Jeudi',
  5: 'Vendredi',
  6: 'Samedi',
  0: 'Dimanche',
};

export type AppointmentResult = 'client' | 'mail_envoye' | 'commande_plus_tard' | 'a_relancer' | 'pas_interesse' | 'decale' | '';

export const APPOINTMENT_RESULT_LABELS = LIBELLES_RESULTAT_RDV as Record<string, string>;

export type ReminderStatus = 'actif' | 'termine' | 'reporte';

export type UserRole = 'admin' | 'commercial' | 'prospection';

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
  'La Réunion': 'DOM-TOM',
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
  /** Identité légale. Le numéro de TVA reste vide quand il se calcule depuis le SIREN. */
  raison_sociale?: string;
  siren?: string;
  tva_intracom?: string;
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
  /** Zone dessinée qui contient la fiche (calculé par le serveur), null si hors zone. */
  zone_id?: string | null;
  etape_pipeline: PipelineStage;
  tags: string[];
  commercial_id: string;
  siret?: string;
  entity_type?: string;
  /** Lien de la fiche Google Maps d'où vient le prospect (étape « Partagé »). */
  source_url?: string;
  notes: string;
  date_creation: string;
  date_modification: string;
  score: number;
  /** Pourquoi le prospect est perdu (rempli quand il passe en « Perdu »). */
  raison_perte?: string;
  /** Quand le prospect est entré dans son étape actuelle. */
  date_etape?: string | null;
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
  client_id?: string;
  commercial_id: string;
  prospecteur_id?: string; // celui qui a pris le RDV (l'appelant)
  date: string;
  heure_debut: string;
  heure_fin: string;
  lieu: string;
  notes: string;
  statut: AppointmentStatus;
  compte_rendu?: AppointmentResult;
  notes_compte_rendu?: string;
  created_at?: string;
  // Champs evenement
  event_type?: EventType;
  titre?: string; // titre pour les evenements (reunion, boutique, etc.)
  participants?: string[]; // IDs des commerciaux assignes (multi-select)
  recurrence?: RecurrenceType;
  recurrence_days?: number[]; // jours de la semaine (0=dim, 1=lun, ..., 6=sam)
  recurrence_end_date?: string; // date de fin de recurrence
}

export type TypeAction = 'appeler' | 'relancer_mail' | 'attendre_reponse' | 'autre';

/** Un rappel est la PROCHAINE ACTION d'un prospect : typée, datée, à quelqu'un. */
export interface Reminder {
  id: string;
  prospect_id: string;
  commercial_id: string;
  date: string;
  heure: string;
  message: string;
  statut: ReminderStatus;
  type?: TypeAction;
}

/** Un changement d'étape dans le tunnel (historique, pour la frise). */
export interface ProspectEtape {
  id: string;
  prospect_id: string;
  de: string;
  vers: string;
  commercial_id: string | null;
  date: string;
  raison: string;
}

export interface Commercial {
  id: string;
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  role: UserRole;
  /** Un commercial (ou admin) qui fait AUSSI de la prospection : deux accueils, deux jeux d'objectifs. */
  prospection?: boolean;
  password: string;
  objectifs: Objectifs;
}

// Objectifs MENSUELS, adaptés au rôle (voir utils/objectifs.ts pour la liste par rôle).
// Prospection : appels, RDV pris. Commercial : RDV réalisés, clients vus, commandes.
// Les anciennes clés (appels_semaine, rdv_mois…) restent lisibles mais ne sont plus proposées.
export interface Objectifs {
  appels_mois?: number;
  rdv_pris_mois?: number;
  rdv_realises_mois?: number;
  clients_vus_mois?: number;
  commandes_mois?: number;
  /** @deprecated anciens objectifs, conservés pour les fiches existantes */
  appels_semaine?: number;
  rdv_mois?: number;
  prospects_mois?: number;
  taux_conversion?: number;
}

export interface Tag {
  id: string;
  nom: string;
  couleur: string;
  /** Points apportés au score du prospect (Administration → Tags). 0 = sans effet. */
  points?: number;
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
// Client Types (CRM Client Management)
// ============================================

export type ClientType =
  | 'BAR_RESTAURANT_GENERAL'
  | 'BAR_RESTAURANT_2024'
  | 'CAVE_EPICERIE'
  | 'CAVE_EPICERIE_2024'
  | 'SOUCHON'
  | 'SOUCHON_HORS_DROIT'
  | 'CLIENT_SOUCHON'
  | 'GRAND_PUBLIC'
  | 'GRAND_PUBLIC_2024'
  | 'COMITE_ENTREPRISE'
  | 'DISTRIBUTEUR'
  | 'EXPORT'
  | 'MARIAGE'
  | 'PICOLOGIE';

export const CLIENT_TYPE_LABELS = LIBELLES_TYPE_CLIENT as Record<ClientType, string>;

export const CLIENT_TYPE_FAMILIES: Record<string, { label: string; icon: string; types: ClientType[] }> = {
  bar_restaurant: { label: 'Bar / Restaurant', icon: 'UtensilsCrossed', types: ['BAR_RESTAURANT_GENERAL', 'BAR_RESTAURANT_2024'] },
  cave_epicerie: { label: 'Cave / Epicerie', icon: 'Wine', types: ['CAVE_EPICERIE', 'CAVE_EPICERIE_2024'] },
  souchon: { label: 'Souchon', icon: 'Handshake', types: ['SOUCHON', 'SOUCHON_HORS_DROIT', 'CLIENT_SOUCHON'] },
  grand_public: { label: 'Grand Public', icon: 'Users', types: ['GRAND_PUBLIC', 'GRAND_PUBLIC_2024'] },
  autres: { label: 'Autres', icon: 'Package', types: ['COMITE_ENTREPRISE', 'DISTRIBUTEUR', 'EXPORT', 'MARIAGE', 'PICOLOGIE'] },
};

export const CLIENT_VISIT_FREQUENCIES = FREQUENCES_VISITE as Record<ClientType, number | null>;

export type ClientStatus = 'ACTIF' | 'INACTIF';

export type InteractionType = 'VISITE' | 'APPEL' | 'RDV_PLANIFIE';

export const INTERACTION_TYPE_LABELS = LIBELLES_INTERACTION as Record<InteractionType, string>;

export type TaskClientStatus = 'A_FAIRE' | 'EN_COURS' | 'TERMINEE';

export const TASK_CLIENT_STATUS_LABELS = LIBELLES_STATUT_TACHE as Record<TaskClientStatus, string>;

export type TaskClientPriority = 'BASSE' | 'MOYENNE' | 'HAUTE';

export const TASK_CLIENT_PRIORITY_LABELS = LIBELLES_PRIORITE_TACHE as Record<TaskClientPriority, string>;

export interface Client {
  /** Identité légale. Le numéro de TVA reste vide quand il se calcule depuis le SIREN. */
  raison_sociale?: string;
  siren?: string;
  tva_intracom?: string;
  id: string;
  nom: string;
  ville: string;
  adresse: string;
  code_postal: string;
  telephone: string;
  telephone_mobile: string;
  email: string;
  contact: string;
  type_client: ClientType;
  statut: ClientStatus;
  commercial_id: string;
  next_visit: string | null;
  last_visit: string | null;
  notes: string;
  custom_recurrence: number | null;
  latitude: number;
  longitude: number;
  zone_id?: string | null;
  siret: string;
  tournee: string;
  prospect_id: string | null;
  date_creation: string;
  date_modification: string;
}

export interface Interaction {
  id: string;
  client_id: string;
  commercial_id: string;
  type: InteractionType;
  date: string;
  comment: string;
  date_creation: string;
}

export interface TaskClient {
  id: string;
  titre: string;
  description: string;
  statut: TaskClientStatus;
  priorite: TaskClientPriority;
  date_echeance: string | null;
  commercial_id: string | null;
  client_id: string | null;
  date_creation: string;
  completed_at: string | null;
}

export interface CommercialZone {
  id: string;
  commercial_id: string;
  nom: string;
  couleur: string;
  coordinates: [number, number][];
  created_at: string;
  updated_at: string;
  /** Zone à travailler en premier, avec la consigne de l'admin ou du commercial. */
  prioritaire: boolean;
  consigne: string;
}

export const ZONE_COLOR_PALETTE = [
  '#6366f1', '#ef4444', '#22c55e', '#f59e0b', '#06b6d4',
  '#a855f7', '#ec4899', '#84cc16', '#3b82f6', '#f97316',
  '#14b8a6', '#8b5cf6',
];

export function colorForCommercial(commercialId: string): string {
  let hash = 0;
  for (let i = 0; i < commercialId.length; i++) {
    hash = (hash * 31 + commercialId.charCodeAt(i)) >>> 0;
  }
  return ZONE_COLOR_PALETTE[hash % ZONE_COLOR_PALETTE.length];
}

export interface TourneeConfig {
  commercial_id: string;
  config: string; // JSON string of { "1": ["Zone A"], "2": ["Zone B"], ... }
  notes: string;
  updated_at: string;
}

export type CommandeStatut = 'en_cours' | 'livree' | 'annulee';

export const COMMANDE_STATUT_LABELS: Record<CommandeStatut, string> = {
  en_cours: 'En cours',
  livree: 'Livree',
  annulee: 'Annulée',
};

export interface CommandeLigne {
  produit: string;
  quantite: number;
  prix_unitaire: number;
  montant: number;
  nom_produit?: string;
  format?: string;
  tva?: number;
  reference?: string;
}

export interface Commande {
  id: string;
  client_id: string;
  easybeer_id: string;
  numero: string;
  date_commande: string;
  date_livraison: string;
  statut: CommandeStatut;
  montant_ht: number;
  montant_ttc: number;
  lignes: CommandeLigne[];
  notes: string;
  source: string;
  date_creation: string;
}

export type VisitStatus = 'LATE' | 'TODAY' | 'UPCOMING' | 'NO_RECURRENCE' | 'INACTIF';

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

/** « Ma session d'appel du jour » : la liste qu'une personne s'est choisie pour un jour. */
export interface SessionAppel {
  id: string;
  commercial_id: string;
  jour: string;
  prospect_ids: string[];
  /** Clients à appeler (commerciaux) ; les appelés se déduisent des interactions « APPEL » du jour. */
  client_ids: string[];
  created_at: string;
  updated_at: string;
}

// ============================================
// App State
// ============================================

/** Ce qu'un partage a permis de lire, avant qualification. */
export interface FicheSignalee {
  nom_etablissement?: string;
  type_etablissement?: EstablishmentType;
  adresse?: string;
  ville?: string;
  code_postal?: string;
  departement?: string;
  telephone?: string;
  /** Renseignés quand la fiche vient d'un dépôt structuré (Claude) plutôt que d'un texte lu. */
  email?: string;
  nom_contact?: string;
  source_url?: string;
  /** Identité légale, quand elle a été trouvée. Le numéro de TVA français se calcule depuis
   *  le SIREN : seul celui d'une société étrangère est déposé tel quel. */
  siret?: string;
  siren?: string;
  raison_sociale?: string;
  tva_intracom?: string;
  latitude?: number;
  longitude?: number;
  categorie_google?: string;
  /** Nom du compte sur un réseau social (« @victor.brasserie »). */
  compte?: string;
  /** Fiches existantes qui ressemblent (calculé à la réception). */
  doublons?: { genre: 'prospect' | 'client'; id: string; nom: string; ville: string; etape?: string }[];
}
export type SourceSignalement = 'google' | 'instagram' | 'facebook' | 'tiktok' | 'linkedin' | 'site' | 'texte' | 'photo' | 'claude';
export interface PhotoSignalement { id: string; type_mime: string; taille: number }
export type StatutSignalement = 'a_qualifier' | 'traite' | 'ignore';
/** Un partage de l'équipe qui attend d'être qualifié dans la boîte de prospection. */
export interface Signalement {
  id: string;
  texte: string;
  lien: string;
  source: SourceSignalement;
  titre: string;
  fiche: FicheSignalee;
  commentaire: string;
  partage_par: string;
  /** Commercial à qui le signalement est destiné ; vide = la prospection. */
  commercial_id: string;
  statut: StatutSignalement;
  prospect_id: string;
  client_id: string;
  traite_par: string;
  traite_le: string | null;
  created_at: string;
  /** Photos jointes (le contenu se lit à part). */
  photos: PhotoSignalement[];
}

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
  clients: Client[];
  interactions: Interaction[];
  tasksClient: TaskClient[];
  tourneeConfigs: TourneeConfig[];
  commandes: Commande[];
  sessionsAppel: SessionAppel[];
  commercialZones: CommercialZone[];
  signalements: Signalement[];
}
