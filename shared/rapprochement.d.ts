export interface FichePreparee { _nom: string; _mots: string[]; _siret: string; _email: string; _tel: string; _tel2: string; _ville: string; _emailPartage?: boolean; _telPartage?: boolean; [k: string]: any }
export interface Rapprochement { score: number; motif: string }
export type Preuve = 'siret' | 'email' | 'telephone' | 'nom_exact' | 'nom_partiel';
export function preparerFiche<T extends object>(f: T): T & FichePreparee;
export function comparerFiches(a: object, b: object): Rapprochement | null;
export function preuvesDeLien(a: object, b: object): Preuve[];
export function verdictDeLien(preuves: Preuve[]): 'ok' | 'a_verifier' | 'suspect';
export function candidatsDoublons<T extends object>(saisie: { nom?: string; nom_etablissement?: string; telephone?: string; email?: string }, liste: T[]): T[];
