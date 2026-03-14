import { useState, useEffect, useCallback } from 'react';
import {
  Users, AlertTriangle, Calendar, CheckCircle2, Clock, ChevronDown, ChevronRight,
  ListTodo, MapPin, TrendingUp, RefreshCw, Filter,
} from 'lucide-react';

interface CommercialStats {
  commercial: { id: string; prenom: string; nom: string; role: string };
  clients_total: number;
  clients_actifs: number;
  clients_en_retard: number;
  clients_aujourd_hui: number;
  visites_semaine: number;
  visites_mois: number;
  visites_semaine_par_type?: Record<string, number>;
  visites_mois_par_type?: Record<string, number>;
  taches_en_cours: number;
  taches_en_retard: number;
  taches_terminees_mois: number;
}

interface GlobalStats {
  clients_en_retard: number;
  clients_aujourd_hui: number;
  visites_semaine: number;
  visites_mois: number;
  visites_semaine_par_type?: Record<string, number>;
  visites_mois_par_type?: Record<string, number>;
}

interface Activity {
  id: string;
  type: string;
  date: string;
  commercial: string;
  commercial_id: string;
  description: string;
  comment?: string;
}

interface WeekPlanning {
  week_number: number;
  start: string;
  end: string;
  clients: Array<{
    id: string;
    nom: string;
    ville: string;
    type_client: string;
    next_visit: string;
    tournee: string;
    commercial_prenom: string;
    commercial_nom: string;
    commercial_id: string;
  }>;
  count: number;
}

const ACTIVITY_ICONS: Record<string, string> = {
  visite: '📍',
  appel: '📞',
  VISITE: '📍',
  APPEL: '📞',
  RDV_PLANIFIE: '📅',
  tache: '✅',
  nouveau_client: '🆕',
};

const ACTIVITY_COLORS: Record<string, string> = {
  visite: 'bg-green-100 text-green-700',
  appel: 'bg-blue-100 text-blue-700',
  VISITE: 'bg-green-100 text-green-700',
  APPEL: 'bg-blue-100 text-blue-700',
  RDV_PLANIFIE: 'bg-purple-100 text-purple-700',
  tache: 'bg-amber-100 text-amber-700',
  nouveau_client: 'bg-indigo-100 text-indigo-700',
};

function formatDateShort(dateStr: string) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  } catch { return dateStr; }
}

function formatDateLong(dateStr: string) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch { return dateStr; }
}

export default function AdminClientsDashboard() {
  const [stats, setStats] = useState<{ global: GlobalStats; par_commercial: CommercialStats[] } | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [planning, setPlanning] = useState<WeekPlanning[]>([]);
  const [loading, setLoading] = useState(true);
  const [activityFilter, setActivityFilter] = useState('');
  const [activityCommercial, setActivityCommercial] = useState('');
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set([1]));
  const [planningCommercial, setPlanningCommercial] = useState('');

  const token = localStorage.getItem('suivipro_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, activitiesRes, planningRes] = await Promise.all([
        fetch('/api/admin/stats', { headers }).then(r => r.json()),
        fetch(`/api/admin/activity-feed?${activityFilter ? `type=${activityFilter}` : ''}${activityCommercial ? `&commercial_id=${activityCommercial}` : ''}`, { headers }).then(r => r.json()),
        fetch(`/api/admin/planning?${planningCommercial ? `commercial_id=${planningCommercial}` : ''}`, { headers }).then(r => r.json()),
      ]);
      setStats(statsRes);
      setActivities(activitiesRes);
      setPlanning(planningRes);
    } catch (err) {
      console.error('Erreur chargement dashboard admin:', err);
    } finally {
      setLoading(false);
    }
  }, [activityFilter, activityCommercial, planningCommercial]);

  useEffect(() => { loadData(); }, [loadData]);

  const toggleWeek = (weekNum: number) => {
    setExpandedWeeks(prev => {
      const next = new Set(prev);
      if (next.has(weekNum)) next.delete(weekNum);
      else next.add(weekNum);
      return next;
    });
  };

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Chargement...</span>
      </div>
    );
  }

  if (!stats) return null;

  const commercials = stats.par_commercial.filter(s => s.commercial.role !== 'admin' || s.clients_total > 0);

  return (
    <div className="space-y-6">
      {/* Global KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2">
            <div className="bg-red-100 p-2 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-red-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Clients en retard</p>
              <p className="text-2xl font-bold text-red-600">{stats.global.clients_en_retard}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2">
            <div className="bg-amber-100 p-2 rounded-lg">
              <Calendar className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Visites aujourd'hui</p>
              <p className="text-2xl font-bold text-amber-600">{stats.global.clients_aujourd_hui}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2">
            <div className="bg-green-100 p-2 rounded-lg">
              <TrendingUp className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Interactions semaine</p>
              <p className="text-2xl font-bold text-green-600">{stats.global.visites_semaine}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2">
            <div className="bg-blue-100 p-2 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Interactions ce mois</p>
              <p className="text-2xl font-bold text-blue-600">{stats.global.visites_mois}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Interaction type breakdown */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Detail par type d'interaction</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-500 mb-2">Cette semaine</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center p-2 bg-green-50 rounded-lg">
                <p className="text-lg font-bold text-green-700">{stats.global.visites_semaine_par_type?.VISITE || 0}</p>
                <p className="text-[10px] text-green-600">Visites</p>
              </div>
              <div className="text-center p-2 bg-blue-50 rounded-lg">
                <p className="text-lg font-bold text-blue-700">{stats.global.visites_semaine_par_type?.APPEL || 0}</p>
                <p className="text-[10px] text-blue-600">Appels</p>
              </div>
              <div className="text-center p-2 bg-purple-50 rounded-lg">
                <p className="text-lg font-bold text-purple-700">{stats.global.visites_semaine_par_type?.RDV_PLANIFIE || 0}</p>
                <p className="text-[10px] text-purple-600">RDV</p>
              </div>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-2">Ce mois</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center p-2 bg-green-50 rounded-lg">
                <p className="text-lg font-bold text-green-700">{stats.global.visites_mois_par_type?.VISITE || 0}</p>
                <p className="text-[10px] text-green-600">Visites</p>
              </div>
              <div className="text-center p-2 bg-blue-50 rounded-lg">
                <p className="text-lg font-bold text-blue-700">{stats.global.visites_mois_par_type?.APPEL || 0}</p>
                <p className="text-[10px] text-blue-600">Appels</p>
              </div>
              <div className="text-center p-2 bg-purple-50 rounded-lg">
                <p className="text-lg font-bold text-purple-700">{stats.global.visites_mois_par_type?.RDV_PLANIFIE || 0}</p>
                <p className="text-[10px] text-purple-600">RDV</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Per-commercial cards */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Users className="w-5 h-5" />
          Performance par commercial
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {commercials.map(s => (
            <div key={s.commercial.id} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-sm font-bold text-indigo-700">
                    {s.commercial.prenom[0]}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{s.commercial.prenom} {s.commercial.nom}</p>
                    <p className="text-xs text-gray-500">{s.clients_actifs} clients actifs</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-2">
                <div className="text-center p-2 bg-gray-50 rounded-lg">
                  <p className="text-lg font-bold text-gray-900">{s.visites_semaine}</p>
                  <p className="text-[10px] text-gray-500">Interactions sem.</p>
                </div>
                <div className="text-center p-2 bg-gray-50 rounded-lg">
                  <p className="text-lg font-bold text-gray-900">{s.visites_mois}</p>
                  <p className="text-[10px] text-gray-500">Interactions mois</p>
                </div>
                <div className="text-center p-2 bg-gray-50 rounded-lg">
                  <p className="text-lg font-bold text-gray-900">{s.taches_terminees_mois}</p>
                  <p className="text-[10px] text-gray-500">Taches term.</p>
                </div>
              </div>

              {/* Type breakdown for this month */}
              <div className="flex gap-1.5 mb-3">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-700 rounded-full text-[10px] font-medium">
                  {s.visites_mois_par_type?.VISITE || 0} visites
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-[10px] font-medium">
                  {s.visites_mois_par_type?.APPEL || 0} appels
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full text-[10px] font-medium">
                  {s.visites_mois_par_type?.RDV_PLANIFIE || 0} RDV
                </span>
              </div>

              {/* Alerts */}
              <div className="flex flex-wrap gap-1.5">
                {s.clients_en_retard > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                    <AlertTriangle className="w-3 h-3" />
                    {s.clients_en_retard} en retard
                  </span>
                )}
                {s.clients_aujourd_hui > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
                    <MapPin className="w-3 h-3" />
                    {s.clients_aujourd_hui} aujourd'hui
                  </span>
                )}
                {s.taches_en_retard > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs font-medium">
                    <Clock className="w-3 h-3" />
                    {s.taches_en_retard} taches retard
                  </span>
                )}
                {s.taches_en_cours > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                    <ListTodo className="w-3 h-3" />
                    {s.taches_en_cours} en cours
                  </span>
                )}
                {s.clients_en_retard === 0 && s.taches_en_retard === 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                    <CheckCircle2 className="w-3 h-3" />
                    A jour
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Activity Feed + 6-week Planning side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Activity Feed */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Activite recente
            </h3>
            <button onClick={loadData} className="p-1 text-gray-400 hover:text-gray-600">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {/* Filters */}
          <div className="flex gap-2 mb-3">
            <select
              value={activityFilter}
              onChange={e => setActivityFilter(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1"
            >
              <option value="">Toutes activites</option>
              <option value="visite">Visites</option>
              <option value="appel">Appels</option>
              <option value="tache">Taches</option>
              <option value="nouveau_client">Nouveaux clients</option>
            </select>
            <select
              value={activityCommercial}
              onChange={e => setActivityCommercial(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1"
            >
              <option value="">Tous les commerciaux</option>
              {stats.par_commercial.map(s => (
                <option key={s.commercial.id} value={s.commercial.id}>
                  {s.commercial.prenom} {s.commercial.nom}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {activities.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Aucune activite pour cette periode</p>
            ) : activities.slice(0, 30).map(a => (
              <div key={a.id} className="flex items-start gap-2 py-2 border-b border-gray-50 last:border-0">
                <span className={`text-xs px-1.5 py-0.5 rounded ${ACTIVITY_COLORS[a.type] || 'bg-gray-100 text-gray-600'}`}>
                  {ACTIVITY_ICONS[a.type] || '?'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">{a.description}</p>
                  <p className="text-[10px] text-gray-400">
                    {a.commercial} - {formatDateLong(a.date)}
                  </p>
                  {a.comment && (
                    <p className="text-xs text-gray-500 mt-0.5 italic truncate">{a.comment}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 6-Week Planning */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Planning 6 semaines
            </h3>
            <select
              value={planningCommercial}
              onChange={e => setPlanningCommercial(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1"
            >
              <option value="">Tous les commerciaux</option>
              {stats.par_commercial.map(s => (
                <option key={s.commercial.id} value={s.commercial.id}>
                  {s.commercial.prenom}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {planning.map(week => (
              <div key={week.week_number} className="border border-gray-100 rounded-lg">
                <button
                  onClick={() => toggleWeek(week.week_number)}
                  className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center gap-2">
                    {expandedWeeks.has(week.week_number) ? (
                      <ChevronDown className="w-4 h-4 text-gray-400" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    )}
                    <span className="text-sm font-medium text-gray-700">
                      {week.week_number === 1 ? 'Cette semaine' : `Semaine ${week.week_number}`}
                    </span>
                    <span className="text-xs text-gray-400">
                      {formatDateShort(week.start)} - {formatDateShort(week.end)}
                    </span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    week.count === 0 ? 'bg-gray-100 text-gray-500' :
                    week.count > 10 ? 'bg-green-100 text-green-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {week.count} visite{week.count !== 1 ? 's' : ''}
                  </span>
                </button>

                {expandedWeeks.has(week.week_number) && week.clients.length > 0 && (
                  <div className="px-3 pb-2 space-y-1">
                    {week.clients.map(c => (
                      <div key={c.id} className="flex items-center justify-between text-xs py-1 px-2 bg-gray-50 rounded">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-800">{c.nom}</span>
                          {c.ville && <span className="text-gray-400">({c.ville})</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          {c.tournee && (
                            <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[10px]">
                              {c.tournee}
                            </span>
                          )}
                          <span className="text-gray-400">{formatDateShort(c.next_visit)}</span>
                          <span className="text-gray-500">{c.commercial_prenom}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {expandedWeeks.has(week.week_number) && week.clients.length === 0 && (
                  <p className="px-3 pb-2 text-xs text-gray-400 italic">Aucune visite planifiee</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
