// Journal d'activité et dernières connexions — onglet de la page Administration, extrait tel quel.
import { useState, useEffect, useCallback } from 'react';
import { Loader2, Activity, Clock } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { apiFetch } from '../../api/client';

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'A l\'instant';
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Hier';
  if (days < 7) return `Il y a ${days} jours`;
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function OngletActivite() {
  const { state } = useApp();
  const activeTab = 'activity' as const; // l'onglet n'est monté que lorsqu'il est actif

  // Activity log state
  interface ActivityEntry {
    id: number;
    user_id: string;
    action: string;
    details: string;
    entity_type: string;
    entity_id: string;
    created_at: string;
    prenom: string;
    nom: string;
  }

  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);

  const [activityLoading, setActivityLoading] = useState(false);

  const [activityFilter, setActivityFilter] = useState('all');

  const [lastSeenData, setLastSeenData] = useState<{ id: string; prenom: string; nom: string; last_seen: string | null }[]>([]);

  const loadActivityLog = useCallback(async (userId?: string) => {
    setActivityLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (userId && userId !== 'all') params.set('user_id', userId);
      const res = await apiFetch(`/activity-log?${params}`, {
      });
      if (res.ok) setActivityLog(await res.json());
    } catch (err) {
      console.error('Erreur chargement activité:', err);
    } finally {
      setActivityLoading(false);
    }
  }, []);

  const loadLastSeen = useCallback(async () => {
    try {
      const res = await apiFetch('/commerciaux/last-seen', {
      });
      if (res.ok) setLastSeenData(await res.json());
    } catch (err) {
      console.error('Erreur chargement last-seen:', err);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'activity') {
      loadActivityLog(activityFilter);
      loadLastSeen();
    }
  }, [activeTab, activityFilter, loadActivityLog, loadLastSeen]);

  return (
    <>
        <div className="space-y-6">
          {/* Last seen cards */}
          <div>
            <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <Clock className="w-5 h-5 text-gray-500" />
              Dernière connexion
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {lastSeenData.map(u => {
                const isOnline = u.last_seen && (Date.now() - new Date(u.last_seen).getTime()) < 5 * 60 * 1000;
                const timeAgo = u.last_seen ? formatTimeAgo(new Date(u.last_seen)) : 'Jamais';
                return (
                  <div key={u.id} className="bg-white rounded-xl border border-gray-200 p-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <span className="font-medium text-sm text-gray-800">{u.prenom} {u.nom}</span>
                    </div>
                    <p className={`text-xs mt-1 ${isOnline ? 'text-green-600 font-medium' : 'text-gray-500'}`}>
                      {isOnline ? 'En ligne' : timeAgo}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Activity log */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <Activity className="w-5 h-5 text-gray-500" />
                Historique d'activite
              </h3>
              <select
                value={activityFilter}
                onChange={e => setActivityFilter(e.target.value)}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
              >
                <option value="all">Tous les utilisateurs</option>
                {state.commerciaux.map(c => (
                  <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
                ))}
              </select>
            </div>

            {activityLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : activityLog.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                <p className="text-sm text-gray-500">Aucune activité enregistrée</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
                {activityLog.map(entry => {
                  const actionLabels: Record<string, { label: string; color: string; icon: string }> = {
                    connexion: { label: 'Connexion', color: 'text-blue-700 bg-blue-100', icon: '🔑' },
                    creation_prospect: { label: 'Nouveau prospect', color: 'text-purple-700 bg-purple-100', icon: '🆕' },
                    modification_prospect: { label: 'Modif. prospect', color: 'text-orange-700 bg-orange-100', icon: '✏️' },
                    appel: { label: 'Appel', color: 'text-green-700 bg-green-100', icon: '📞' },
                    creation_rdv: { label: 'Nouveau RDV', color: 'text-indigo-700 bg-indigo-100', icon: '📅' },
                    modification_rdv: { label: 'Modif. RDV', color: 'text-yellow-700 bg-yellow-100', icon: '📝' },
                    compte_rendu_rdv: { label: 'Compte rendu', color: 'text-teal-700 bg-teal-100', icon: '📋' },
                    creation_client: { label: 'Nouveau client', color: 'text-emerald-700 bg-emerald-100', icon: '🏢' },
                    visite_client: { label: 'Visite client', color: 'text-cyan-700 bg-cyan-100', icon: '🚗' },
                  };
                  const info = actionLabels[entry.action] || { label: entry.action, color: 'text-gray-700 bg-gray-100', icon: '•' };
                  const date = new Date(entry.created_at);
                  return (
                    <div key={entry.id} className="px-4 py-3 flex items-start gap-3 hover:bg-gray-50">
                      <span className="text-lg flex-shrink-0 mt-0.5">{info.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-gray-800">{entry.prenom} {entry.nom}</span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${info.color}`}>{info.label}</span>
                        </div>
                        {entry.details && (
                          <p className="text-xs text-gray-600 mt-0.5 truncate">{entry.details}</p>
                        )}
                      </div>
                      <span className="text-[10px] text-gray-400 flex-shrink-0 whitespace-nowrap">
                        {date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} {date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
    </>
  );
}
