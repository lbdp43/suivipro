import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Calendar, CheckCircle2, Clock, MapPin,
  ListTodo, RefreshCw, ChevronDown, ChevronRight, Phone, Eye,
} from 'lucide-react';

interface AppointmentInfo {
  id: string;
  titre: string;
  heure_debut: string;
  heure_fin: string;
  lieu: string;
  event_type: string;
  prospect_id: string;
  client_id: string;
  prospect_nom: string;
  client_nom: string;
  statut: string;
}

interface WeekDay {
  date: string;
  day_name: string;
  tournees: string[];
  clients: ClientInfo[];
  appointments?: AppointmentInfo[];
  count: number;
}

interface ClientInfo {
  id: string;
  nom: string;
  ville: string;
  type_client: string;
  next_visit: string;
  tournee: string;
  telephone: string;
  telephone_mobile: string;
  email: string;
  adresse: string;
}

interface TaskInfo {
  id: string;
  titre: string;
  description: string;
  statut: string;
  priorite: string;
  date_echeance: string;
  client_nom: string;
}

interface InteractionInfo {
  id: string;
  type: string;
  date: string;
  comment: string;
  client_nom: string;
}

interface DashboardData {
  week_days: Record<string, WeekDay>;
  tournee_config: Record<string, string[]>;
  tournee_notes: string;
  late_clients: ClientInfo[];
  today_clients: ClientInfo[];
  recent_interactions: InteractionInfo[];
  pending_tasks: TaskInfo[];
  total_clients: number;
  interactions_semaine_par_type?: Record<string, number>;
  interactions_mois_par_type?: Record<string, number>;
}

function formatDateShort(dateStr: string) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch { return dateStr; }
}

const PRIORITY_COLORS: Record<string, string> = {
  HAUTE: 'bg-red-100 text-red-700',
  MOYENNE: 'bg-amber-100 text-amber-700',
  BASSE: 'bg-gray-100 text-gray-600',
};

const DAY_ORDER = ['1', '2', '3', '4', '5', '6', '0'];

export default function CommercialClientsDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [showLateClients, setShowLateClients] = useState(false);

  const token = localStorage.getItem('suivipro_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/commercial/dashboard', { headers });
      const result = await res.json();
      setData(result);

      // Auto-expand today's day
      const today = new Date();
      const todayDay = String(today.getDay());
      setExpandedDays(new Set([todayDay]));
    } catch (err) {
      console.error('Erreur chargement dashboard commercial:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const toggleDay = (dayKey: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Chargement...</span>
      </div>
    );
  }

  if (!data) return null;

  const todayStr = new Date().toISOString().split('T')[0];
  const todayDayKey = String(new Date().getDay());

  return (
    <div className="space-y-6">
      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-100 p-2 rounded-lg">
              <MapPin className="w-4 h-4 text-indigo-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Mes clients</p>
              <p className="text-2xl font-bold text-indigo-600">{data.total_clients}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2">
            <div className="bg-amber-100 p-2 rounded-lg">
              <Calendar className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Aujourd'hui</p>
              <p className="text-2xl font-bold text-amber-600">{data.today_clients.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 cursor-pointer" onClick={() => setShowLateClients(!showLateClients)}>
          <div className="flex items-center gap-2">
            <div className="bg-red-100 p-2 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-red-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">En retard</p>
              <p className="text-2xl font-bold text-red-600">{data.late_clients.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2">
            <div className="bg-blue-100 p-2 rounded-lg">
              <ListTodo className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Taches en cours</p>
              <p className="text-2xl font-bold text-blue-600">{data.pending_tasks.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Interaction type breakdown */}
      {(data.interactions_semaine_par_type || data.interactions_mois_par_type) && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Mes interactions par type</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-500 mb-2">Cette semaine</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-2 bg-green-50 rounded-lg">
                  <p className="text-lg font-bold text-green-700">{data.interactions_semaine_par_type?.VISITE || 0}</p>
                  <p className="text-[10px] text-green-600">Visites</p>
                </div>
                <div className="text-center p-2 bg-blue-50 rounded-lg">
                  <p className="text-lg font-bold text-blue-700">{data.interactions_semaine_par_type?.APPEL || 0}</p>
                  <p className="text-[10px] text-blue-600">Appels</p>
                </div>
                <div className="text-center p-2 bg-purple-50 rounded-lg">
                  <p className="text-lg font-bold text-purple-700">{data.interactions_semaine_par_type?.RDV_PLANIFIE || 0}</p>
                  <p className="text-[10px] text-purple-600">RDV</p>
                </div>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-2">Ce mois</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-2 bg-green-50 rounded-lg">
                  <p className="text-lg font-bold text-green-700">{data.interactions_mois_par_type?.VISITE || 0}</p>
                  <p className="text-[10px] text-green-600">Visites</p>
                </div>
                <div className="text-center p-2 bg-blue-50 rounded-lg">
                  <p className="text-lg font-bold text-blue-700">{data.interactions_mois_par_type?.APPEL || 0}</p>
                  <p className="text-[10px] text-blue-600">Appels</p>
                </div>
                <div className="text-center p-2 bg-purple-50 rounded-lg">
                  <p className="text-lg font-bold text-purple-700">{data.interactions_mois_par_type?.RDV_PLANIFIE || 0}</p>
                  <p className="text-[10px] text-purple-600">RDV</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Late clients alert (expandable) */}
      {showLateClients && data.late_clients.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <h3 className="font-semibold text-red-800 flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4" />
            Clients en retard de visite ({data.late_clients.length})
          </h3>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {data.late_clients.map(c => {
              const daysLate = Math.floor((new Date().getTime() - new Date(c.next_visit).getTime()) / (1000 * 60 * 60 * 24));
              return (
                <div key={c.id} className="flex items-center justify-between text-sm py-1.5 px-2 bg-white rounded">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-800">{c.nom}</span>
                    {c.ville && <span className="text-gray-400 text-xs">({c.ville})</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {c.tournee && (
                      <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[10px]">{c.tournee}</span>
                    )}
                    <span className="text-red-600 text-xs font-medium">{daysLate}j retard</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Weekly Planning by Tournee */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Planning de la semaine
          </h3>
          <button onClick={loadData} className="p-1 text-gray-400 hover:text-gray-600">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {data.tournee_notes && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3 text-xs text-amber-800">
            {data.tournee_notes}
          </div>
        )}

        <div className="space-y-2">
          {DAY_ORDER.map(dayKey => {
            const day = data.week_days[dayKey];
            if (!day) return null;
            const isToday = dayKey === todayDayKey;

            return (
              <div key={dayKey} className={`border rounded-lg ${isToday ? 'border-indigo-300 bg-indigo-50/30' : 'border-gray-100'}`}>
                <button
                  onClick={() => toggleDay(dayKey)}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center gap-2">
                    {expandedDays.has(dayKey) ? (
                      <ChevronDown className="w-4 h-4 text-gray-400" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    )}
                    <span className={`text-sm font-medium ${isToday ? 'text-indigo-700' : 'text-gray-700'}`}>
                      {day.day_name}
                      {isToday && <span className="ml-1 text-xs text-indigo-500">(aujourd'hui)</span>}
                    </span>
                    {day.tournees.length > 0 && (
                      <div className="flex gap-1">
                        {day.tournees.map((t, i) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {(day.appointments?.length || 0) > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700">
                        {day.appointments!.length} RDV
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      day.count === 0 ? 'bg-gray-100 text-gray-500' :
                      'bg-green-100 text-green-700'
                    }`}>
                      {day.count} client{day.count !== 1 ? 's' : ''}
                    </span>
                  </div>
                </button>

                {expandedDays.has(dayKey) && (day.appointments?.length || 0) > 0 && (
                  <div className="px-3 pb-1 space-y-1">
                    {day.appointments!.map(apt => (
                      <Link
                        key={apt.id}
                        to={apt.prospect_id ? `/prospects?id=${apt.prospect_id}` : `/rdv`}
                        className="flex items-center justify-between text-xs py-1.5 px-2 bg-purple-50 rounded hover:bg-purple-100 border border-purple-100"
                      >
                        <div className="flex items-center gap-2">
                          <Calendar className="w-3 h-3 text-purple-500 flex-shrink-0" />
                          <span className="font-medium text-purple-800">{apt.titre}</span>
                          {apt.lieu && <span className="text-purple-500 text-[10px]">- {apt.lieu}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          {apt.heure_debut && (
                            <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-medium">
                              {apt.heure_debut}{apt.heure_fin ? ` - ${apt.heure_fin}` : ''}
                            </span>
                          )}
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            apt.event_type === 'rdv' ? 'bg-blue-100 text-blue-600' :
                            apt.event_type === 'reunion' ? 'bg-amber-100 text-amber-600' :
                            apt.event_type === 'marche' ? 'bg-green-100 text-green-600' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {apt.event_type === 'rdv' ? 'RDV' : apt.event_type === 'reunion' ? 'Reunion' :
                             apt.event_type === 'boutique' ? 'Boutique' : apt.event_type === 'depot' ? 'Depot' :
                             apt.event_type === 'marche' ? 'Marche' : apt.event_type}
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
                {expandedDays.has(dayKey) && day.clients.length > 0 && (
                  <div className="px-3 pb-2 space-y-1">
                    {day.clients.map(c => (
                      <Link
                        key={c.id}
                        to={`/clients`}
                        className="flex items-center justify-between text-xs py-1.5 px-2 bg-white rounded hover:bg-gray-50 border border-gray-50"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-800">{c.nom}</span>
                          {c.ville && <span className="text-gray-400">({c.ville})</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          {c.tournee && (
                            <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[10px]">{c.tournee}</span>
                          )}
                          {c.telephone && (
                            <a href={`tel:${c.telephone}`} onClick={e => e.stopPropagation()} className="text-blue-500 hover:text-blue-700">
                              <Phone className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
                {expandedDays.has(dayKey) && day.clients.length === 0 && (day.appointments?.length || 0) === 0 && (
                  <p className="px-3 pb-2 text-xs text-gray-400 italic">Aucun client ou RDV prevu</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom: Tasks + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Tasks */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
            <ListTodo className="w-4 h-4" />
            Taches en cours ({data.pending_tasks.length})
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {data.pending_tasks.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-4 justify-center">
                <CheckCircle2 className="w-4 h-4" />
                Toutes les taches sont terminees
              </div>
            ) : data.pending_tasks.map(t => {
              const isOverdue = t.date_echeance && t.date_echeance < todayStr;
              return (
                <div key={t.id} className={`p-2 rounded-lg border ${isOverdue ? 'border-red-200 bg-red-50' : 'border-gray-100'}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{t.titre}</p>
                      {t.client_nom && <p className="text-[10px] text-gray-500">Client: {t.client_nom}</p>}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${PRIORITY_COLORS[t.priorite] || PRIORITY_COLORS.MOYENNE}`}>
                        {t.priorite}
                      </span>
                      {t.date_echeance && (
                        <span className={`text-[10px] ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                          {formatDateShort(t.date_echeance)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4" />
            Activite recente
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {data.recent_interactions.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Aucune activite recente</p>
            ) : data.recent_interactions.map(i => (
              <div key={i.id} className="flex items-start gap-2 py-1.5 border-b border-gray-50 last:border-0">
                <span className="text-xs mt-0.5">
                  {i.type === 'VISITE' ? '📍' : i.type === 'APPEL' ? '📞' : '📅'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800">
                    <span className="font-medium">{i.type === 'VISITE' ? 'Visite' : i.type === 'APPEL' ? 'Appel' : 'RDV'}</span>
                    {i.client_nom && ` - ${i.client_nom}`}
                  </p>
                  <p className="text-[10px] text-gray-400">{formatDateShort(i.date)}</p>
                  {i.comment && <p className="text-xs text-gray-500 italic truncate">{i.comment}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
