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
  claude: 'Claude',
};

/**
 * Une fiche Google se dit par son nom : le lien mérite mieux qu'un « Ouvrir » anonyme.
 * Les hôtes sont les mêmes que côté serveur (server/partage.js) — « share.google » compris,
 * c'est ce que donne le bouton Partager de Google Maps sur Android.
 */
const HOTES_GOOGLE = /(^|\.)(google\.[a-z.]+|share\.google|goo\.gl|g\.co|g\.page)$/i;

export function estLienGoogle(lien: string): boolean {
  try { return HOTES_GOOGLE.test(new URL(lien).hostname); } catch { return false; }
}

/**
 * L'adresse d'un établissement, ouverte dans Google Maps.
 * On cherche par le nom ET l'adresse : c'est ce qui tombe sur la bonne fiche, là où un
 * identifiant de lieu recopié à la main ne donne « aucun résultat ».
 */
export function lienMapsDepuisAdresse(nom: string, ...morceaux: (string | undefined)[]): string {
  const requete = [nom, ...morceaux].map(m => (m || '').trim()).filter(Boolean).join(' ');
  return requete ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(requete)}` : '';
}

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

/** Ce qui, dans l'adresse d'un lien, désigne le lieu lui-même. */
const PARAMS_DU_LIEU = ['query', 'q', 'cid', 'place_id', 'ftid'];

/**
 * La clé d'un lien.
 *
 * L'hôte et le chemin ne suffisent pas : une adresse « google.com/maps/search/?query=… »
 * porte le lieu dans sa requête, pas dans son chemin. Sans ce détail, tous les
 * établissements cherchés de cette façon partageaient une seule et même clé et se
 * retrouvaient dans une seule fiche.
 */
function cleDuLien(lien: string): string {
  try {
    const u = new URL(lien);
    const chemin = `${u.hostname}${u.pathname}`.toLowerCase().replace(/\/+$/, '');
    const cle = PARAMS_DU_LIEU.map(p => u.searchParams.get(p)).find(v => v);
    return `lien:${chemin}${cle ? `?${sansAccents(cle)}` : ''}`;
  } catch {
    return `lien:${lien}`;
  }
}

/**
 * Clé de regroupement : le même lieu, sinon le même nom normalisé.
 *
 * Deux fiches qui ne portent pas le même nom ne sont pas le même établissement, quel que
 * soit leur lien — le nom entre donc aussi dans la clé. Trop regrouper est bien pire que
 * pas assez : une fiche de groupe cache les autres, et « Créer le prospect » n'en crée
 * qu'un seul en rattachant tout le reste à lui.
 */
export function cleDeGroupe(s: Signalement): string {
  const nom = sansAccents(titreDuSignalement(s));
  if (s.lien) return `${cleDuLien(s.lien)}${nom ? `|${nom}` : ''}`;
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
