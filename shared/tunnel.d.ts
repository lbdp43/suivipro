export type TypeAction = 'appeler' | 'relancer_mail' | 'attendre_reponse' | 'autre';
export type RaisonPerte = 'pas_interesse' | 'deja_fournisseur' | 'trop_cher' | 'ferme' | 'injoignable' | 'autre';

export const ETAPES_TERMINALES: string[];
export const ETAPES_ENTREE: string[];
export const TYPES_ACTION: Record<TypeAction, string>;
export const RAISONS_PERTE: Record<RaisonPerte, string>;
export const SEUIL_STAGNATION_JOURS: number;

export function estTerminale(etape: string): boolean;

export interface Issue { value: string; label: string; effet: string }
export function issuesPourAction(type: string): Issue[];
export function issueEstUnePerte(issue: string): boolean;

export interface ProchaineActionACreer { type: TypeAction; delaiJours: number; message: string }
export interface EffetIssue { etape: string | null; prochaine: ProchaineActionACreer | null; perdu: boolean }
export function appliquerIssue(type: string, issue: string, etapeActuelle: string): EffetIssue;

export function etapeApresAppel(
  ctx: { issueNegative?: 'none' | 'pas_interesse' | 'ne_pas_contacter' | null; rdvPris?: boolean; memo?: boolean },
  etapeActuelle: string
): string | null;
export function etapeApresCompteRendu(resultat: string, etapeActuelle: string): string | null;
export function typeActionApresCompteRendu(resultat: string): TypeAction;
export function etapeApresMail(etapeActuelle: string): string | null;
export function etapeApresRdvCree(etapeActuelle: string): string | null;

export interface RappelMin { id: string; prospect_id: string; statut: string; date: string; heure?: string; type?: string; message?: string }
export interface RdvMin { id: string; prospect_id: string; statut: string; date: string; heure_debut?: string; compte_rendu?: string; commercial_id: string }
export interface AppelMin { prospect_id: string; date: string; resultat: string; commercial_id: string }

export interface ProchaineAction<R = RappelMin, A = RdvMin> {
  genre: 'rappel' | 'rdv';
  type: string;
  date: string;
  heure: string;
  libelle: string;
  enRetard: boolean;
  rappel: R | null;
  rdv: A | null;
}
export function prochaineActionDe<R extends RappelMin, A extends RdvMin>(
  prospect: { id: string }, rappels: R[], rendezVous: A[], aujourdhui: string
): ProchaineAction<R, A> | null;

export interface DerniereActivite { genre: 'appel' | 'mail' | 'rdv'; date: string; resultat: string; commercial_id: string }
export function derniereActiviteDe(prospect: { id: string }, appels: AppelMin[], rendezVous: RdvMin[], aujourdhui: string): DerniereActivite | null;

export function joursDansEtape(prospect: { date_etape?: string | null; date_modification?: string; date_creation?: string }, maintenant?: Date): number;
export function joursSansActivite(derniere: DerniereActivite | null, maintenant?: Date): number | null;
