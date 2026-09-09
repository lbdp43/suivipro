// « Ajouter à mon agenda » : un seul geste, qui fait la bonne chose.
//
// Avant, le bouton fabriquait un fichier .ics que le navigateur téléchargeait. Sur un
// téléphone, il proposait souvent de l'ajouter ; sur un ordinateur, il finissait dans les
// téléchargements et rien ne se passait — d'où les rendez-vous qui n'arrivaient jamais.
//
// Maintenant on demande au serveur de l'écrire dans le Google Agenda du commercial
// concerné. Le fichier reste le filet : si l'agenda n'est pas connecté, on le télécharge
// en disant pourquoi.
import { apiPost } from '../api/client';
import { downloadICS } from './helpers';
import { Appointment, Prospect } from '../types';

export interface ResultatAgenda {
  pose: boolean;
  raison?: 'non_configure' | 'non_connecte' | 'acces_revoque' | 'annule' | 'introuvable' | 'erreur';
  mis_a_jour?: boolean;
}

/** Ce qu'on dit à l'écran, selon ce que le serveur a pu faire. */
export function messageAgenda(r: ResultatAgenda | undefined, prenom?: string): { texte: string; bon: boolean } {
  if (r?.pose) {
    return { texte: prenom ? `Ajouté à l'agenda Google de ${prenom}` : 'Ajouté à votre agenda Google', bon: true };
  }
  switch (r?.raison) {
    case 'non_connecte':
      return { texte: prenom ? `${prenom} n'a pas connecté son Google Agenda — fichier téléchargé à la place` : 'Votre Google Agenda n\'est pas connecté — fichier téléchargé à la place', bon: false };
    case 'acces_revoque':
      return { texte: 'L\'accès à Google Agenda a expiré : reconnectez-le dans Administration', bon: false };
    case 'non_configure':
      return { texte: 'Google Agenda n\'est pas configuré sur ce serveur — fichier téléchargé à la place', bon: false };
    case 'annule':
      return { texte: 'Rendez-vous annulé : retiré de l\'agenda', bon: true };
    default:
      return { texte: 'Google Agenda n\'a pas répondu — fichier téléchargé à la place', bon: false };
  }
}

/**
 * Envoie le rendez-vous dans l'agenda du commercial ; télécharge le fichier si ça n'a pas
 * pu se faire. Renvoie de quoi afficher un message.
 */
export async function envoyerDansAgenda(rdv: Appointment, prospect: Prospect | undefined, prenom?: string) {
  let resultat: ResultatAgenda = { pose: false, raison: 'erreur' };
  try {
    resultat = await apiPost(`/appointments/${rdv.id}/agenda`, {}) as ResultatAgenda;
  } catch {
    // Le serveur n'a pas répondu : le fichier reste la solution de repli.
  }
  if (!resultat.pose && prospect) downloadICS(rdv, prospect);
  return messageAgenda(resultat, prenom);
}
