interface DocLike { id: string; a_signer?: boolean; signataires?: string[] | string | null; uploaded_by: string; version?: number }
interface SignatureLike { doc_id: string; user_id: string; version: number }

export function lireSignataires(valeur: unknown): string[] | null;
export function doitSigner(doc: DocLike | null | undefined, personneId: string | null | undefined): boolean;
export function aSigne(doc: DocLike, personneId: string, signatures: SignatureLike[] | null | undefined): boolean;
export function concernes<P extends { id: string; actif?: boolean }>(doc: DocLike, equipe: P[] | null | undefined): P[];
