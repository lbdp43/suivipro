import { AppState, Commercial, Signalement, SourceSignalement } from '../types';
import { sansAccents } from '../../shared/normalisation';

export const LIBELLES_SOURCE: Record<SourceSignalement, string> = {
  google: 'Google Maps',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  site: 'Site ou article',
  texte: 'Texte',
  photo: 'Photo',
};

/** Ce qu'on affiche en titre d'un signalement : le nom lu, sinon le compte, sinon le début du texte. */
export function titreDuSignalement(s: Signalement): string {
  return s.titre || s.fiche.nom_etablissement || s.fiche.compte || s.texte.split('\n')[0].slice(0, 80) || s.lien || ((s.photos || []).length > 1 ? `${s.photos.length} photos` : 'Photo');
}

export function aQualifier(state: Pick<AppState, 'signalements'>): Signalement[] {
  return state.signalements.filter(s => s.statut === 'a_qualifier');
}

/** Les signalements qui concernent une personne : les siens, ceux qui lui sont destinés,
 *  et ceux sans destinataire si elle fait de la prospection. */
export function concerne(s: Signalement, moi: Commercial, prospection: boolean): boolean {
  return s.partage_par === moi.id || s.commercial_id === moi.id || (!s.commercial_id && prospection);
}

/** Clé de regroupement : le même lien, sinon le même nom normalisé. */
export function cleDeGroupe(s: Signalement): string {
  if (s.lien) {
    try { const u = new URL(s.lien); return `lien:${u.hostname}${u.pathname}`.toLowerCase().replace(/\/+$/, ''); } catch { return `lien:${s.lien}`; }
  }
  const nom = sansAccents(titreDuSignalement(s));
  return nom ? `nom:${nom}` : `id:${s.id}`;
}

/** Regroupe les signalements qui parlent du même établissement, le plus récent en tête. */
export function grouper(signalements: Signalement[]): Signalement[][] {
  const groupes = new Map<string, Signalement[]>();
  for (const s of signalements) {
    const cle = cleDeGroupe(s);
    const g = groupes.get(cle);
    if (g) g.push(s); else groupes.set(cle, [s]);
  }
  return [...groupes.values()].sort((a, b) => b[0].created_at.localeCompare(a[0].created_at));
}
