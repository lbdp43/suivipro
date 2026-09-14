export interface FondDeCarte {
  nom: string;
  url: string;
  attribution: string;
  sousDomaines?: string;
  zoomMax?: number;
}
export const FONDS_DE_CARTE: FondDeCarte[];
export function hoteDuFond(url: string): string;
export function hotesDesFonds(enPlus?: string[]): string[];
