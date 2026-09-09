// « Ajouter à l'agenda » : ouvrir Google Agenda avec l'événement déjà rempli.
//
// C'est le chemin le plus court, et le seul qui marche pour tout le monde sans rien
// connecter : Google affiche sa propre fenêtre de création, où l'on choisit l'agenda de
// destination — le sien ou celui d'un collègue partagé — avant d'enregistrer.
//
// Le contenu (titre, lieu, contact, notes, qui a pris le rendez-vous, dernier appel) est
// préparé par le serveur, avec la même définition que celle écrite par l'API.
import { apiGet } from '../api/client';

export interface LienAgenda { lien: string; deja_pose: boolean; agenda: string }

/**
 * Ouvre Google Agenda pour ce rendez-vous.
 *
 * La fenêtre est ouverte tout de suite, avant l'appel au serveur : un navigateur bloque
 * une ouverture qui arrive après coup, la prenant pour une publicité.
 */
export async function ouvrirDansGoogleAgenda(rdvId: string): Promise<{ texte: string; bon: boolean }> {
  const fenetre = window.open('', '_blank');
  try {
    const r = await apiGet<LienAgenda>(`/appointments/${rdvId}/lien-agenda`);
    if (!r?.lien) throw new Error('lien vide');
    if (fenetre) fenetre.location.href = r.lien;
    else window.location.href = r.lien;
    return r.deja_pose
      ? { texte: 'Google Agenda ouvert — attention, ce rendez-vous y a déjà été posé une fois', bon: false }
      : { texte: 'Google Agenda ouvert : choisissez l\'agenda, puis Enregistrer', bon: true };
  } catch {
    fenetre?.close();
    return { texte: 'Impossible de préparer l\'événement', bon: false };
  }
}
