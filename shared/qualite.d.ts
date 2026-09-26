export type Manque = 'telephone' | 'commune' | 'type' | 'nom' | 'carte' | 'contact' | 'siret';
interface FicheQualite { telephone?: string | null; ville?: string | null; code_postal?: string | null; type_etablissement?: string | null; nom_etablissement?: string | null; latitude?: number | string | null; longitude?: number | string | null; nom_contact?: string | null; siret?: string | null; etape_pipeline?: string }
export const ETAPES_TRANCHEES: string[];
export const ETAPES_A_TRIER: string[];
export const LIBELLES_MANQUE: Record<Manque, string>;
export const MANQUES_BLOQUANTS: Manque[];
export function manquesDeLaFiche(p: FicheQualite): Manque[];
export function manquesBloquants(p: FicheQualite): Manque[];
export function estQualifiable(p: FicheQualite): boolean;
export function aCompleter(p: FicheQualite): boolean;
