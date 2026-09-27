// Noter une visite, un appel ou un RDV planifié chez un client. Le serveur applique la règle
// (lib/visitesClient.js) et renvoie le client à jour : c'est lui qui dit si le calendrier
// des visites avance — l'écran ne le recalcule jamais de son côté.
import type React from 'react';
import { apiPost } from '../api/client';
import type { Action } from '../store/AppContext';
import type { Client, Interaction, TaskClient } from '../types';

export interface SaisieInteraction {
  id?: string;
  client_id: string;
  type: Interaction['type'];
  comment: string;
  date?: string;
  commercial_id?: string;
  /** Issue d'un appel (shared/visites.js) ; le serveur l'écrit en tête du commentaire. */
  issue?: string;
  /** Appel sans personne au bout : ne compte pas comme visite. */
  sans_reponse?: boolean;
  taches_faites?: string[];
  nouvelle_tache?: { titre: string; date?: string | null } | null;
}

export interface RetourInteraction {
  interaction: Interaction;
  client: Client | null;
  taches_faites: TaskClient[];
  nouvelle_tache: TaskClient | null;
}

export async function noterInteraction(saisie: SaisieInteraction, dispatchLocal: React.Dispatch<Action>): Promise<RetourInteraction> {
  const r = await apiPost('/interactions', saisie) as RetourInteraction;
  dispatchLocal({ type: 'ADD_INTERACTION', payload: r.interaction });
  if (r.client) dispatchLocal({ type: 'UPDATE_CLIENT', payload: r.client });
  for (const t of r.taches_faites || []) dispatchLocal({ type: 'UPDATE_TASK_CLIENT', payload: t });
  if (r.nouvelle_tache) dispatchLocal({ type: 'ADD_TASK_CLIENT', payload: r.nouvelle_tache });
  return r;
}
