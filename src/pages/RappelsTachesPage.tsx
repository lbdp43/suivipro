import { useMemo } from 'react';
import { dateLocale } from '../../shared/regles';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, ListTodo, Users } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { usePersistedState } from '../hooks/usePersistedState';
import RemindersPage from './RemindersPage';
import TasksPage from './TasksPage';
import { faitDeLaProspection, estCommercial } from '../utils/roles';

// Rappels (prospection) et tâches (clients) sont deux listes pour la même journée : une
// seule page, deux onglets, et une même « vue » qui vaut pour les deux :
//  - Les miens : mes rappels et mes tâches ;
//  - Toute la prospection : ceux de tous les prospecteurs ;
//  - Tous les commerciaux : ceux de tous les commerciaux ;
//  - Tout le monde.
export type VueEquipe = 'moi' | 'prospection' | 'commerciaux' | 'tous';

const VUES: { id: VueEquipe; label: string }[] = [
  { id: 'moi', label: 'Les miens' },
  { id: 'prospection', label: 'Toute la prospection' },
  { id: 'commerciaux', label: 'Tous les commerciaux' },
  { id: 'tous', label: 'Tout le monde' },
];

export default function RappelsTachesPage() {
  const { state } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const onglet: 'rappels' | 'taches' = location.pathname.startsWith('/taches') ? 'taches' : 'rappels';
  const [vue, setVue] = usePersistedState<VueEquipe>('rappels_taches_vue', 'moi');

  // Identifiants visibles selon la vue ; null = pas de restriction.
  const idsVisibles = useMemo<Set<string> | null>(() => {
    const moi = state.currentUser?.id || '';
    if (vue === 'moi') return new Set([moi]);
    if (vue === 'prospection') return new Set(state.commerciaux.filter(faitDeLaProspection).map(c => c.id));
    if (vue === 'commerciaux') return new Set(state.commerciaux.filter(estCommercial).map(c => c.id));
    return null;
  }, [vue, state.currentUser, state.commerciaux]);

  const aujourdhui = dateLocale();
  const rappelsDus = state.reminders.filter(r => r.statut === 'actif' && r.date <= aujourdhui && (!idsVisibles || idsVisibles.has(r.commercial_id))).length;
  const tachesOuvertes = state.tasksClient.filter(t => t.statut !== 'TERMINEE' && (!idsVisibles || (t.commercial_id ? idsVisibles.has(t.commercial_id) : vue === 'tous' || vue === 'moi'))).length;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 sm:px-6 sm:pt-6 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Rappels et tâches</h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">Ce qu'il y a à faire : rappels de prospection et tâches clients.</p>
          </div>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-full sm:w-auto" role="tablist">
            <button
              role="tab"
              aria-selected={onglet === 'rappels'}
              onClick={() => navigate('/rappels')}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all ${onglet === 'rappels' ? 'bg-white text-brewery-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Bell className="w-4 h-4" /> Rappels
              {rappelsDus > 0 && <span className="ml-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">{rappelsDus}</span>}
            </button>
            <button
              role="tab"
              aria-selected={onglet === 'taches'}
              onClick={() => navigate('/taches')}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all ${onglet === 'taches' ? 'bg-white text-brewery-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <ListTodo className="w-4 h-4" /> Tâches
              {tachesOuvertes > 0 && <span className="ml-1 bg-gray-200 text-gray-700 text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">{tachesOuvertes}</span>}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap bg-white rounded-lg border border-gray-200 px-3 py-2">
          <Users className="w-4 h-4 text-gray-400" />
          {VUES.map(v => (
            <button
              key={v.id}
              onClick={() => setVue(v.id)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${vue === v.id ? 'bg-brewery-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      {onglet === 'rappels' ? <RemindersPage embarque idsVisibles={idsVisibles} /> : <TasksPage embarque idsVisibles={idsVisibles} />}
    </div>
  );
}
