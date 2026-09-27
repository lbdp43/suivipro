export type IssueAppelClient = 'commande' | 'interesse' | 'courtoisie' | 'probleme' | 'pas_de_reponse' | 'a_rappeler';
export const ISSUES_APPEL_CLIENT: { value: IssueAppelClient; label: string; suite?: { titre: string; jours: number } }[];
export function compteCommeVisite(type: string, sansReponse?: boolean): boolean;
