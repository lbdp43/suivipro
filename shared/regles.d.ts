export interface ClientPourRegles { statut?: string | null; next_visit?: string | null }
export interface RdvPourRegles { date?: string | null; heure_debut?: string | null; statut?: string | null; compte_rendu?: string | null }
export type StatutVisite = 'RETARD' | 'AUJOURDHUI' | 'A_VENIR' | 'SANS_RECURRENCE' | 'INACTIF';

export function dateLocale(d?: Date): string;
export function jourDe(valeur: string | Date | null | undefined): string;
export function heureLocale(d?: Date): string;
export function estEnRetard(client: ClientPourRegles | null | undefined, aujourdhui?: string): boolean;
export function joursDeRetard(client: ClientPourRegles | null | undefined, aujourdhui?: string): number;
export function statutVisite(client: ClientPourRegles | null | undefined, aujourdhui?: string): StatutVisite;
export function lundiDeLaSemaine(date?: Date, decalage?: number): Date;
export function dimancheDeLaSemaine(date?: Date, decalage?: number): Date;
export function semaineIso(date?: Date): { annee: number; semaine: number };
export function semainePaire(date?: Date): boolean;
export function tourneeActive(motif: string | null | undefined, date?: Date): boolean;
export function rdvAnnule(rdv: RdvPourRegles | null | undefined): boolean;
export function rdvPasse(rdv: RdvPourRegles | null | undefined, maintenant?: Date): boolean;
export function rdvSansCompteRendu(rdv: RdvPourRegles | null | undefined, maintenant?: Date): boolean;
export function rdvAVenir(rdv: RdvPourRegles | null | undefined, maintenant?: Date): boolean;
export const REGLES: { id: string; titre: string; regle: string; detail: string }[];
