import { AppState, Prospect, Tag } from '../types';
import { sansAccents } from '../../shared/normalisation';
import { apiPost, apiPut } from '../api/client';
import { generateId } from './helpers';
import { scoreDepuisTags } from '../../shared/score';

// Un clic sur « envoyer un e-mail » ouvre la messagerie du poste : on ne saura jamais si le
// mail est vraiment parti. Règle décidée : le clic vaut envoi. On pose le tag « Mail envoyé »
// sur le prospect et on trace l'envoi dans son historique (comme un appel, résultat
// « Email envoyé »), pour que tout le monde le voie sur la fiche et dans les appels.
export const NOM_TAG_MAIL = 'Mail envoyé';

type Dispatch = (action: { type: 'ADD_TAG'; payload: Tag } | { type: 'UPDATE_PROSPECT'; payload: Prospect } | { type: 'ADD_CALL'; payload: AppState['calls'][number] }) => void;

export async function marquerMailEnvoye(
  state: AppState,
  dispatchLocal: Dispatch,
  prospect: Prospect,
  sujet: string,
): Promise<void> {
  const moi = state.currentUser?.id || 'com-1';
  const normaliser = sansAccents;
  let tag = state.tags.find(t => normaliser(t.nom) === normaliser(NOM_TAG_MAIL));
  // Le tag existe d'office (créé au démarrage du serveur) ; s'il manque, seul un administrateur
  // peut le créer. Dans tous les cas, la trace de l'envoi est posée : le tag n'est qu'un plus.
  if (!tag) {
    const nouveau = { id: generateId('tag'), nom: NOM_TAG_MAIL, couleur: '#3b82f6', points: 0 };
    try { await apiPost('/tags', nouveau); dispatchLocal({ type: 'ADD_TAG', payload: nouveau }); tag = nouveau; } catch { tag = undefined; }
  }
  if (tag) {
    const leTag = tag;
    const tags = prospect.tags.includes(leTag.id) ? prospect.tags : [...prospect.tags, leTag.id];
    const tousLesTags = state.tags.some(t => t.id === leTag.id) ? state.tags : [...state.tags, leTag];
    const maj: Prospect = { ...prospect, tags, score: scoreDepuisTags(tags, tousLesTags, prospect.score), date_modification: new Date().toISOString() };
    await apiPut(`/prospects/${prospect.id}`, maj);
    dispatchLocal({ type: 'UPDATE_PROSPECT', payload: maj });
  }

  const trace = {
    id: generateId('call'),
    prospect_id: prospect.id,
    commercial_id: moi,
    date: new Date().toISOString(),
    duree: 0,
    resultat: 'email_envoye' as const,
    notes: sujet ? `Email envoyé : ${sujet}` : 'Email envoyé',
  };
  await apiPost('/calls', trace);
  dispatchLocal({ type: 'ADD_CALL', payload: trace });
}
