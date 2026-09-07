export interface TagPourScore { id: string; points?: number | null }
export function baremeActif(tousLesTags: TagPourScore[] | null | undefined): boolean;
export function scoreDepuisTags(tagsDuProspect: string[] | null | undefined, tousLesTags: TagPourScore[] | null | undefined, scoreActuel: number): number;
