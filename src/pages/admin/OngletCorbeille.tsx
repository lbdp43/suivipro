// La corbeille : ce qui a été supprimé, par qui, et le bouton pour le remettre en place.
//
// Une suppression ne détruit plus rien. La fiche est rangée ici avec tout ce qui serait
// parti avec elle — appels, rendez-vous, rappels pour un prospect ; visites, tâches,
// commandes pour un client — et l'administrateur décide de ce qui revient.
import { useEffect, useMemo, useState } from 'react';
import { Trash2, Undo2, Search, Building2, Users, Loader2, CheckCircle2 } from 'lucide-react';
import { apiGet, apiPost } from '../../api/client';
import { useToast } from '../../components/Toast';

interface Entree {
  id: number;
  type: 'prospect' | 'client';
  entite_id: string;
  nom: string;
  ville: string;
  commercial_id: string;
  resume: string;
  supprime_par: string;
  supprime_le: string;
  restaure_par: string | null;
  restaure_le: string | null;
  supprime_par_prenom: string | null;
  supprime_par_nom: string | null;
  restaure_par_prenom: string | null;
  restaure_par_nom: string | null;
}

const dateEtHeure = (v?: string | null) =>
  (v ? new Date(v).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

const qui = (prenom: string | null, nom: string | null, id: string | null) =>
  (prenom || nom ? `${prenom || ''} ${nom || ''}`.trim() : id || 'quelqu\'un');

/** « 12 appels · 3 rendez-vous » — ce qui a été rangé avec la fiche. */
const LIBELLES: Record<string, [string, string]> = {
  calls: ['appel', 'appels'],
  appointments: ['rendez-vous', 'rendez-vous'],
  reminders: ['rappel', 'rappels'],
  prospect_etapes: ['étape', 'étapes'],
  interactions: ['visite', 'visites'],
  tasks_client: ['tâche', 'tâches'],
  commandes: ['commande', 'commandes'],
};

function detailDuResume(resume: string): string {
  let compte: Record<string, number>;
  try { compte = JSON.parse(resume || '{}'); } catch { return ''; }
  return Object.entries(compte)
    .filter(([table, n]) => LIBELLES[table] && Number(n) > 0)
    .map(([table, n]) => `${n} ${LIBELLES[table][Number(n) > 1 ? 1 : 0]}`)
    .join(' · ');
}

export default function OngletCorbeille() {
  const toast = useToast();
  const [entrees, setEntrees] = useState<Entree[]>([]);
  const [chargement, setChargement] = useState(true);
  const [recherche, setRecherche] = useState('');
  const [enCours, setEnCours] = useState<number | null>(null);
  const [voirRestaurees, setVoirRestaurees] = useState(false);

  const charger = async () => {
    try {
      setEntrees(await apiGet<Entree[]>('/corbeille'));
    } catch (err) {
      toast.error(`Corbeille illisible : ${(err as Error).message}`);
    } finally {
      setChargement(false);
    }
  };

  useEffect(() => { charger(); }, []);

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return entrees
      .filter(e => voirRestaurees || !e.restaure_le)
      .filter(e => !q || `${e.nom} ${e.ville}`.toLowerCase().includes(q));
  }, [entrees, recherche, voirRestaurees]);

  const restaurer = async (e: Entree) => {
    if (!window.confirm(`Remettre « ${e.nom} » en place, avec tout ce qui a été rangé avec ?`)) return;
    setEnCours(e.id);
    try {
      await apiPost(`/corbeille/${e.id}/restaurer`, {});
      toast.success(`${e.nom} est de retour`);
      await charger();
    } catch (err) {
      toast.error(`Restauration impossible : ${(err as Error).message}`);
    } finally {
      setEnCours(null);
    }
  };

  if (chargement) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  const dansLaCorbeille = entrees.filter(e => !e.restaure_le).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-gray-400" /> Corbeille
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Rien n'est détruit. Une fiche supprimée est rangée ici avec son histoire, et vous pouvez la remettre en place.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={recherche}
              onChange={e => setRecherche(e.target.value)}
              placeholder="Chercher un nom, une ville"
              className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg w-56"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap">
            <input type="checkbox" checked={voirRestaurees} onChange={e => setVoirRestaurees(e.target.checked)} />
            Voir les fiches déjà remises
          </label>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        {dansLaCorbeille === 0 ? 'La corbeille est vide.' : `${dansLaCorbeille} fiche${dansLaCorbeille > 1 ? 's' : ''} dans la corbeille.`}
      </p>

      {visibles.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Fiche</th>
                  <th className="text-left font-medium px-3 py-2">Rangé avec</th>
                  <th className="text-left font-medium px-3 py-2">Supprimé par</th>
                  <th className="text-left font-medium px-3 py-2">Quand</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {visibles.map(e => {
                  const detail = detailDuResume(e.resume);
                  return (
                    <tr key={e.id} className="border-t border-gray-100">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {e.type === 'client'
                            ? <Building2 className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                            : <Users className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
                          <span className="font-medium text-gray-800 truncate">{e.nom || '(sans nom)'}</span>
                          {e.ville && <span className="text-xs text-gray-400 truncate">{e.ville}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">{detail || '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        {qui(e.supprime_par_prenom, e.supprime_par_nom, e.supprime_par)}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{dateEtHeure(e.supprime_le)}</td>
                      <td className="px-3 py-2 text-right">
                        {e.restaure_le ? (
                          <span className="text-[11px] text-green-700 flex items-center gap-1 justify-end whitespace-nowrap">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Remis par {qui(e.restaure_par_prenom, e.restaure_par_nom, e.restaure_par)}
                          </span>
                        ) : (
                          <button
                            onClick={() => restaurer(e)}
                            disabled={enCours === e.id}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-brewery-50 text-brewery-700 hover:bg-brewery-100 disabled:opacity-50"
                          >
                            {enCours === e.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
                            Remettre
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {visibles.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <Trash2 className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">
            {recherche ? 'Aucune fiche ne correspond.' : 'Aucune fiche supprimée.'}
          </p>
        </div>
      )}
    </div>
  );
}
