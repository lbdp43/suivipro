// Lancer une session d'appel depuis n'importe quelle page : les fiches rejoignent
// « Ma session du jour » (pour la reprendre depuis l'accueil), puis on enchaîne les appels.
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import { useCallModal } from '../components/CallModal';
import { apiPut } from '../api/client';
import { dateLocale } from '../../shared/regles';
import { SessionAppel } from '../types';

export function useLancerSession() {
  const { dispatchLocal } = useApp();
  const toast = useToast();
  const { startSession, startSessionClients } = useCallModal();

  const enregistrer = async (corps: { prospect_ids?: string[]; client_ids?: string[] }) => {
    try {
      const r = await apiPut('/sessions-appel/jour', { jour: dateLocale(new Date()), mode: 'ajouter', ...corps }) as { session: SessionAppel; sans_telephone: number };
      dispatchLocal({ type: 'SET_SESSION_APPEL', payload: r.session });
      if (r.sans_telephone) toast.info(`${r.sans_telephone} fiche(s) sans téléphone ignorée(s)`);
    } catch { /* la session en mémoire suffit */ }
  };

  return {
    /** Prospects : ajoutés à ma session du jour, puis appelés dans l'ordre. */
    prospects: async (ids: string[]) => {
      if (ids.length === 0) { toast.info('Rien à appeler'); return; }
      await enregistrer({ prospect_ids: ids });
      startSession(ids);
    },
    /** Clients : idem ; `taches` = les tâches qui motivent la session, précochées dans la fenêtre d'appel. */
    clients: async (ids: string[], taches: string[] = []) => {
      if (ids.length === 0) { toast.info('Rien à appeler'); return; }
      await enregistrer({ client_ids: ids });
      startSessionClients(ids, taches);
    },
  };
}
