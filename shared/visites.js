// Ce qui compte comme une visite chez un client. Une seule définition, lue par l'appli,
// le serveur et Claude.
//
// La règle de la maison : une visite, c'est un passage sur place OU un appel. Les deux font
// avancer le calendrier (dernière visite, prochaine visite). Ne comptent pas : un rendez-vous
// planifié (il n'a pas encore eu lieu) et un appel resté sans réponse (personne au bout).

/** Les issues d'un appel à un client, et la tâche de suivi que chacune propose. */
export const ISSUES_APPEL_CLIENT = [
  { value: 'commande', label: 'Commande passée ou à venir' },
  { value: 'interesse', label: 'Intéressé, à relancer', suite: { titre: 'Relancer après l\'appel', jours: 7 } },
  { value: 'courtoisie', label: 'Appel de courtoisie, besoin de rien' },
  { value: 'probleme', label: 'Problème ou mécontentement', suite: { titre: 'Suivre le problème signalé', jours: 2 } },
  { value: 'pas_de_reponse', label: 'Pas de réponse', suite: { titre: 'Rappeler (pas de réponse)', jours: 2 } },
  { value: 'a_rappeler', label: 'À rappeler plus tard', suite: { titre: 'Rappeler', jours: 7 } },
];

/** Une visite ou un appel abouti avance le calendrier ; un RDV planifié ou un appel sans réponse, non. */
export function compteCommeVisite(type, sansReponse = false) {
  if (type === 'VISITE') return true;
  if (type === 'APPEL') return !sansReponse;
  return false;
}
