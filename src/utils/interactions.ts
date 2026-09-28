// Noter une visite, un appel ou un RDV planifié chez un client. Le serveur applique la règle
// (lib/visitesClient.js) et renvoie le client à jour : c'est lui qui dit si le calendrier
// des visites avance — l'écran ne le recalcule jamais de son côté.
//
// Sans réseau, la visite n'est pas perdue : elle part dans la file du téléphone
// (fileHorsLigne.ts) et sera envoyée au retour du réseau. Le calendrier du client, lui,
// n'avance qu'une fois le serveur d'accord.
import type React from 'react';
import { toast } from 'sonner';
import { apiPost, getToken } from '../api/client';
import type { Action } from '../store/AppContext';
import type { Client, Interaction, TaskClient } from '../types';
import { idDuJeton } from './cacheEtat';
import { mettreEnFile, lireLaFile, retirerDeLaFile, marquerARevoir, estUneErreurReseau } from './fileHorsLigne';

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

// Même forme que helpers.generateId, sans en tirer les dates (date-fns) dans le démarrage.
const nouvelId = () => `int-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

function appliquer(r: RetourInteraction, dispatchLocal: React.Dispatch<Action>) {
  dispatchLocal({ type: 'ADD_INTERACTION', payload: r.interaction });
  if (r.client) dispatchLocal({ type: 'UPDATE_CLIENT', payload: r.client });
  for (const t of r.taches_faites || []) dispatchLocal({ type: 'UPDATE_TASK_CLIENT', payload: t });
  if (r.nouvelle_tache) dispatchLocal({ type: 'ADD_TASK_CLIENT', payload: r.nouvelle_tache });
}

/**
 * Note la visite. Sans réseau (ou si la requête ne part pas), elle est gardée sur le
 * téléphone et un message le dit ; `enAttente` vaut alors true et rien n'a encore changé
 * à l'écran. Un refus du serveur (règle non respectée) remonte comme avant.
 */
export async function noterInteraction(
  saisie: SaisieInteraction, dispatchLocal: React.Dispatch<Action>, { clientNom }: { clientNom?: string } = {},
): Promise<RetourInteraction & { enAttente?: boolean }> {
  // Identifiant et heure fixés ici : ce sont eux que le serveur recevra, même plus tard.
  const complete = { ...saisie, id: saisie.id || nouvelId(), date: saisie.date || new Date().toISOString() };
  const garder = async () => {
    const utilisateur = idDuJeton(getToken());
    if (!utilisateur) throw new Error('Session expirée : reconnectez-vous.');
    await mettreEnFile({ id: complete.id, utilisateur, saisie: complete, client_nom: clientNom });
    // Un seul message, mis à jour, même pour une série de visites notées d'affilée.
    toast.info('Pas de réseau : la visite est gardée sur le téléphone', { id: 'visite-hors-ligne', description: 'Elle partira toute seule au retour du réseau.' });
    const provisoire = { ...complete, commercial_id: complete.commercial_id || utilisateur, date_creation: complete.date } as unknown as Interaction;
    return { interaction: provisoire, client: null, taches_faites: [], nouvelle_tache: null, enAttente: true };
  };
  // Un rendez-vous planifié se prend avec le réseau ; une visite ou un appel, eux, se gardent.
  const gardable = complete.type !== 'RDV_PLANIFIE';
  if (gardable && typeof navigator !== 'undefined' && navigator.onLine === false) return garder();
  try {
    const r = await apiPost('/interactions', complete) as RetourInteraction;
    appliquer(r, dispatchLocal);
    return r;
  } catch (err) {
    if (gardable && estUneErreurReseau(err)) return garder();
    throw err;
  }
}

let envoiEnCours: Promise<number> | null = null;

/**
 * Envoie la file, dans l'ordre. S'arrête au premier souci de réseau (on réessaiera) ; un
 * refus du serveur passe la visite « à revoir » et on continue. Renvoie le nombre envoyé.
 */
export function envoyerLaFile(dispatchLocal: React.Dispatch<Action>): Promise<number> {
  if (envoiEnCours) return envoiEnCours;
  envoiEnCours = (async () => {
    const utilisateur = idDuJeton(getToken());
    if (!utilisateur) return 0;
    let envoyes = 0;
    for (const e of await lireLaFile(utilisateur)) {
      if (e.etat !== 'attente') continue;
      try {
        const r = await apiPost('/interactions', e.saisie) as RetourInteraction;
        appliquer(r, dispatchLocal);
        await retirerDeLaFile(e.id, utilisateur);
        envoyes++;
      } catch (err) {
        if (estUneErreurReseau(err)) break;
        const status = (err as { status?: number }).status || 0;
        if (status >= 400 && status < 500) { await marquerARevoir(e.id, utilisateur, (err as Error).message); continue; }
        break; // le serveur a un souci passager : on réessaiera
      }
    }
    if (envoyes) toast.success(envoyes > 1 ? `${envoyes} visites envoyées` : 'Visite envoyée', { description: 'Notées sans réseau, elles sont maintenant dans SuiviPro.' });
    return envoyes;
  })().finally(() => { envoiEnCours = null; });
  return envoiEnCours;
}
