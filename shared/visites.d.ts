export type IssueAppelClient = 'commande' | 'interesse' | 'courtoisie' | 'probleme' | 'pas_de_reponse' | 'messagerie' | 'a_rappeler';
export const ISSUES_APPEL_CLIENT: { value: IssueAppelClient; label: string; suite?: { titre: string; jours: number } }[];
export const ISSUES_SANS_REPONSE: IssueAppelClient[];
export function estSansReponse(issue: string | null | undefined): boolean;
export function compteCommeVisite(type: string, sansReponse?: boolean): boolean;
