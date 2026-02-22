import { useMemo, useState } from 'react';
import {
  Users, Phone, Calendar, TrendingUp, BarChart3, Clock, ChevronLeft, ChevronRight,
  UserCheck, Star, ClipboardCheck,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { APPOINTMENT_RESULT_LABELS } from '../types';
import {
  getCallsToday, getCallsThisWeek, getCallsThisMonth,
  getAppointmentsThisWeek, getAppointmentsThisMonth,
  getConversionRate, getResponseRate, getAverageCallDuration,
  formatDuration, formatDate,
} from '../utils/helpers';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement } from 'chart.js';
import { Doughnut, Bar } from 'react-chartjs-2';
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval, parseISO, startOfWeek, endOfWeek, addWeeks } from 'date-fns';
import { fr } from 'date-fns/locale';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

// Helpers for month navigation
function getCallsInRange<T extends { date: string }>(calls: T[], start: Date, end: Date): T[] {
  return calls.filter(c => {
    try {
      const d = parseISO(c.date);
      return isWithinInterval(d, { start, end });
    } catch { return false; }
  });
}

function getWeeksInMonth(date: Date) {
  const start = startOfMonth(date);
  const end = endOfMonth(date);
  const weeks: { start: Date; end: Date; label: string }[] = [];
  let weekStart = startOfWeek(start, { weekStartsOn: 1 });
  let weekNum = 1;
  while (weekStart <= end) {
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
    const clampedStart = weekStart < start ? start : weekStart;
    const clampedEnd = weekEnd > end ? end : weekEnd;
    weeks.push({
      start: clampedStart,
      end: clampedEnd,
      label: `S${weekNum} (${format(clampedStart, 'dd/MM')}-${format(clampedEnd, 'dd/MM')})`,
    });
    weekStart = addWeeks(weekStart, 1);
    weekNum++;
  }
  return weeks;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin / Prospecteur',
  commercial: 'Commercial / Prospecteur',
};

export default function DashboardPage() {
  const { state } = useApp();
  const [monthOffset, setMonthOffset] = useState(0);
  const [crFilterResult, setCrFilterResult] = useState<string>('');
  const [crFilterUser, setCrFilterUser] = useState<string>('');

  const selectedMonth = subMonths(new Date(), -monthOffset);
  const monthStart = startOfMonth(selectedMonth);
  const monthEnd = endOfMonth(selectedMonth);
  const monthLabel = format(selectedMonth, 'MMMM yyyy', { locale: fr });

  // ALL users - everyone does prospecting and can be commercial
  const allUsers = state.commerciaux;

  const activeColumns = state.pipelineColumns;

  const stats = useMemo(() => {
    const callsToday = getCallsToday(state.calls);
    const callsWeek = getCallsThisWeek(state.calls);
    const callsMonth = getCallsThisMonth(state.calls);
    const rdvWeek = getAppointmentsThisWeek(state.appointments);
    const rdvMonth = getAppointmentsThisMonth(state.appointments);
    const conversionRate = getConversionRate(state.prospects);
    const responseRate = getResponseRate(state.calls);
    const avgDuration = getAverageCallDuration(state.calls);

    const prospectsByStage = activeColumns.map(col => ({
      stage: col.id,
      label: col.label,
      color: col.color,
      count: state.prospects.filter(p => p.etape_pipeline === col.id).length,
    }));

    const activeProspects = state.prospects.filter(p => !['client_gagne', 'perdu', 'ne_pas_contacter'].includes(p.etape_pipeline)).length;
    const wonProspects = state.prospects.filter(p => p.etape_pipeline === 'client_gagne').length;

    return {
      callsToday: callsToday.length,
      callsWeek: callsWeek.length,
      callsMonth: callsMonth.length,
      rdvWeek: rdvWeek.length,
      rdvMonth: rdvMonth.length,
      conversionRate,
      responseRate,
      avgDuration,
      prospectsByStage,
      totalProspects: state.prospects.length,
      activeProspects,
      wonProspects,
    };
  }, [state, activeColumns]);

  // Monthly history data for the selected month
  const monthlyHistory = useMemo(() => {
    const monthCalls = getCallsInRange(state.calls, monthStart, monthEnd);
    const monthRdv = getCallsInRange(state.appointments, monthStart, monthEnd);
    const monthProspects = state.prospects.filter(p => {
      try {
        const d = parseISO(p.date_creation);
        return isWithinInterval(d, { start: monthStart, end: monthEnd });
      } catch { return false; }
    });
    const weeks = getWeeksInMonth(selectedMonth);

    const weeklyBreakdown = weeks.map(week => {
      const weekCalls = getCallsInRange(state.calls, week.start, week.end);
      const weekRdv = getCallsInRange(state.appointments, week.start, week.end);
      const weekProspects = state.prospects.filter(p => {
        try {
          const d = parseISO(p.date_creation);
          return isWithinInterval(d, { start: week.start, end: week.end });
        } catch { return false; }
      });
      const weekAnswered = weekCalls.filter(c => c.resultat === 'repondu').length;
      return {
        label: week.label,
        calls: weekCalls.length,
        rdv: weekRdv.length,
        prospects: weekProspects.length,
        answered: weekAnswered,
        responseRate: weekCalls.length > 0 ? Math.round((weekAnswered / weekCalls.length) * 100) : 0,
      };
    });

    return {
      totalCalls: monthCalls.length,
      totalRdv: monthRdv.length,
      totalProspects: monthProspects.length,
      answered: monthCalls.filter(c => c.resultat === 'repondu').length,
      responseRate: monthCalls.length > 0
        ? Math.round((monthCalls.filter(c => c.resultat === 'repondu').length / monthCalls.length) * 100)
        : 0,
      weeklyBreakdown,
    };
  }, [state.calls, state.appointments, state.prospects, monthStart, monthEnd, selectedMonth]);

  // Per-user activity stats (ALL users)
  const userActivities = useMemo(() => {
    return allUsers.map(user => {
      const userCalls = state.calls.filter(c => c.commercial_id === user.id);
      const userAppointments = state.appointments.filter(a => a.commercial_id === user.id);
      const userProspects = state.prospects.filter(p => p.commercial_id === user.id);

      // RDV taken as prospector (prospecteur_id)
      const rdvTakenAsProspector = state.appointments.filter(a => a.prospecteur_id === user.id);

      const weekCalls = getCallsThisWeek(userCalls);
      const monthCalls = getCallsThisMonth(userCalls);
      const todayCalls = getCallsToday(userCalls);
      const weekRdv = getAppointmentsThisWeek(userAppointments);
      const monthRdv = getAppointmentsThisMonth(userAppointments);
      const monthRdvTaken = getAppointmentsThisMonth(rdvTakenAsProspector);
      const responseRate = getResponseRate(userCalls);
      const avgDuration = getAverageCallDuration(userCalls);
      const wonProspects = userProspects.filter(p => p.etape_pipeline === 'client_gagne').length;

      // Prospects created this month by this user
      const now = new Date();
      const mStart = startOfMonth(now);
      const mEnd = endOfMonth(now);
      const monthProspectsCreated = userProspects.filter(p => {
        try {
          const d = parseISO(p.date_creation);
          return isWithinInterval(d, { start: mStart, end: mEnd });
        } catch { return false; }
      }).length;

      const objective = user.objectifs.appels_semaine;
      const progress = objective > 0 ? Math.round((weekCalls.length / objective) * 100) : 0;

      return {
        user,
        todayCalls: todayCalls.length,
        weekCalls: weekCalls.length,
        monthCalls: monthCalls.length,
        weekRdv: weekRdv.length,
        monthRdv: monthRdv.length,
        monthRdvTaken: monthRdvTaken.length,
        monthProspectsCreated,
        responseRate,
        avgDuration,
        totalProspects: userProspects.length,
        activeProspects: userProspects.filter(p => !['client_gagne', 'perdu', 'ne_pas_contacter'].includes(p.etape_pipeline)).length,
        wonProspects,
        objective,
        progress,
      };
    }).sort((a, b) => b.weekCalls - a.weekCalls); // Sort by most active
  }, [allUsers, state.calls, state.appointments, state.prospects]);

  // Recent RDV compte-rendus (with filters)
  const recentCompteRendus = useMemo(() => {
    let list = state.appointments.filter(a => a.compte_rendu && a.statut === 'termine');
    if (crFilterResult) list = list.filter(a => a.compte_rendu === crFilterResult);
    if (crFilterUser) list = list.filter(a => a.commercial_id === crFilterUser);
    return list
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 50)
      .map(apt => {
        const prospect = state.prospects.find(p => p.id === apt.prospect_id);
        const commercial = allUsers.find(u => u.id === apt.commercial_id);
        return { ...apt, prospectName: prospect?.nom_etablissement || 'Inconnu', commercialName: commercial ? `${commercial.prenom} ${commercial.nom}` : 'Inconnu' };
      });
  }, [state.appointments, state.prospects, allUsers, crFilterResult, crFilterUser]);

  // Compte-rendu stats (filtered by user)
  const compteRenduStats = useMemo(() => {
    let rdvsWithCR = state.appointments.filter(a => a.compte_rendu);
    if (crFilterUser) rdvsWithCR = rdvsWithCR.filter(a => a.commercial_id === crFilterUser);
    const total = rdvsWithCR.length;
    const byResult: Record<string, number> = {};
    rdvsWithCR.forEach(a => {
      const cr = a.compte_rendu || '';
      byResult[cr] = (byResult[cr] || 0) + 1;
    });
    return { total, byResult };
  }, [state.appointments, crFilterUser]);

  // Chart: Prospects by pipeline stage (only active columns)
  const pipelineChartData = {
    labels: stats.prospectsByStage.map(s => s.label),
    datasets: [{
      data: stats.prospectsByStage.map(s => s.count),
      backgroundColor: stats.prospectsByStage.map(s => s.color),
      borderWidth: 0,
    }],
  };

  // Chart: Activity by user (ALL users)
  const userActivityChartData = {
    labels: allUsers.map(c => c.prenom),
    datasets: [{
      label: 'Appels cette semaine',
      data: allUsers.map(c => getCallsThisWeek(state.calls.filter(cl => cl.commercial_id === c.id)).length),
      backgroundColor: '#22c55e',
      borderRadius: 6,
    }, {
      label: 'Prospects ce mois',
      data: allUsers.map(c => {
        const now = new Date();
        const mS = startOfMonth(now), mE = endOfMonth(now);
        return state.prospects.filter(p => p.commercial_id === c.id && (() => {
          try { return isWithinInterval(parseISO(p.date_creation), { start: mS, end: mE }); } catch { return false; }
        })()).length;
      }),
      backgroundColor: '#f59e0b',
      borderRadius: 6,
    }, {
      label: 'RDV ce mois',
      data: allUsers.map(c => getAppointmentsThisMonth(state.appointments.filter(a => a.commercial_id === c.id)).length),
      backgroundColor: '#3b82f6',
      borderRadius: 6,
    }, {
      label: 'RDV pris (prospection)',
      data: allUsers.map(c => getAppointmentsThisMonth(state.appointments.filter(a => a.prospecteur_id === c.id)).length),
      backgroundColor: '#a855f7',
      borderRadius: 6,
    }],
  };

  // Chart: weekly breakdown for selected month
  const weeklyChartData = {
    labels: monthlyHistory.weeklyBreakdown.map(w => w.label),
    datasets: [{
      label: 'Appels',
      data: monthlyHistory.weeklyBreakdown.map(w => w.calls),
      backgroundColor: '#22c55e',
      borderRadius: 6,
    }, {
      label: 'Prospects',
      data: monthlyHistory.weeklyBreakdown.map(w => w.prospects),
      backgroundColor: '#f59e0b',
      borderRadius: 6,
    }, {
      label: 'RDV',
      data: monthlyHistory.weeklyBreakdown.map(w => w.rdv),
      backgroundColor: '#3b82f6',
      borderRadius: 6,
    }],
  };

  const kpis = [
    { label: 'Total prospects', value: stats.totalProspects, icon: Users, color: 'bg-blue-500', sub: `${stats.activeProspects} actifs` },
    { label: 'Appels aujourd\'hui', value: stats.callsToday, icon: Phone, color: 'bg-green-500', sub: `${stats.callsWeek} cette semaine` },
    { label: 'RDV ce mois', value: stats.rdvMonth, icon: Calendar, color: 'bg-amber-500', sub: `${stats.rdvWeek} cette semaine` },
    { label: 'Taux de conversion', value: `${stats.conversionRate}%`, icon: TrendingUp, color: 'bg-purple-500', sub: `${stats.wonProspects} gagnes` },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 fade-in">
      {/* Page header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-xs sm:text-sm text-gray-500 mt-1">Vue d'ensemble de l'activite - Prospection & Commercial</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] sm:text-sm text-gray-500">{kpi.label}</p>
                <p className="text-2xl sm:text-3xl font-bold text-gray-900 mt-1">{kpi.value}</p>
                <p className="text-[10px] sm:text-xs text-gray-400 mt-1">{kpi.sub}</p>
              </div>
              <div className={`${kpi.color} p-2 sm:p-2.5 rounded-lg`}>
                <kpi.icon className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
          <div className="bg-green-50 p-2.5 sm:p-3 rounded-lg">
            <Phone className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" />
          </div>
          <div>
            <p className="text-[10px] sm:text-sm text-gray-500">Taux de reponse</p>
            <p className="text-lg sm:text-xl font-bold text-gray-900">{stats.responseRate}%</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
          <div className="bg-blue-50 p-2.5 sm:p-3 rounded-lg">
            <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-[10px] sm:text-sm text-gray-500">Duree moy. appels</p>
            <p className="text-lg sm:text-xl font-bold text-gray-900">{formatDuration(stats.avgDuration)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
          <div className="bg-purple-50 p-2.5 sm:p-3 rounded-lg">
            <Users className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600" />
          </div>
          <div>
            <p className="text-[10px] sm:text-sm text-gray-500">Equipe active</p>
            <p className="text-lg sm:text-xl font-bold text-gray-900">{allUsers.length} <span className="text-sm font-normal text-gray-500">membres</span></p>
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pipeline distribution */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
          <h3 className="font-semibold text-gray-900 text-sm sm:text-base mb-4">Repartition du pipeline</h3>
          <div className="h-52 sm:h-64 flex items-center justify-center">
            <Doughnut
              data={pipelineChartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8, font: { size: 10 } } },
                },
              }}
            />
          </div>
        </div>

        {/* Activity by user (ALL users) */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
          <h3 className="font-semibold text-gray-900 text-sm sm:text-base mb-4">Activite par membre de l'equipe</h3>
          <div className="h-52 sm:h-64">
            {allUsers.length > 0 ? (
              <Bar
                data={userActivityChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
                  plugins: { legend: { position: 'top', labels: { boxWidth: 12, padding: 12, font: { size: 11 } } } },
                }}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-gray-400">Aucun membre</div>
            )}
          </div>
        </div>
      </div>

      {/* Pipeline breakdown - only active columns */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
        <h3 className="font-semibold text-gray-900 text-sm sm:text-base mb-4">Prospects par etape</h3>
        <div className={`grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-${Math.min(activeColumns.length, 8)} gap-2 sm:gap-3`}>
          {stats.prospectsByStage.map(s => (
            <div key={s.stage} className="text-center p-3 rounded-lg bg-gray-50">
              <div className="pipeline-dot mx-auto mb-2" style={{ backgroundColor: s.color }} />
              <p className="text-2xl font-bold text-gray-900">{s.count}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Compte-rendu RDV + Performance side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Compte-rendu RDV */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="font-semibold text-gray-900 text-sm sm:text-base flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-indigo-500" />
              Comptes-rendus des RDV
            </h3>
            <select
              className="rounded-lg border border-gray-200 text-xs px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brewery-500"
              value={crFilterUser}
              onChange={e => setCrFilterUser(e.target.value)}
            >
              <option value="">Tout le monde</option>
              {allUsers.map(u => (
                <option key={u.id} value={u.id}>{u.prenom} {u.nom}</option>
              ))}
            </select>
          </div>
          {/* Stats summary - clickable to filter by result */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
            <button
              onClick={() => setCrFilterResult('')}
              className={`rounded-lg p-2 text-center transition-all cursor-pointer ${
                crFilterResult === '' ? 'bg-indigo-50 text-indigo-700 ring-2 ring-indigo-400' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
            >
              <p className="text-lg font-bold">{compteRenduStats.total}</p>
              <p className="text-[9px] leading-tight">Tous</p>
            </button>
            {Object.entries(APPOINTMENT_RESULT_LABELS).map(([key, label]) => {
              const count = compteRenduStats.byResult[key] || 0;
              const colorMap: Record<string, string> = {
                client: 'bg-green-50 text-green-700',
                mail_envoye: 'bg-blue-50 text-blue-700',
                commande_plus_tard: 'bg-amber-50 text-amber-700',
                a_relancer: 'bg-purple-50 text-purple-700',
                pas_interesse: 'bg-red-50 text-red-700',
              };
              const ringMap: Record<string, string> = {
                client: 'ring-green-400',
                mail_envoye: 'ring-blue-400',
                commande_plus_tard: 'ring-amber-400',
                a_relancer: 'ring-purple-400',
                pas_interesse: 'ring-red-400',
              };
              const isActive = crFilterResult === key;
              return (
                <button
                  key={key}
                  onClick={() => setCrFilterResult(isActive ? '' : key)}
                  className={`${colorMap[key] || 'bg-gray-50 text-gray-700'} rounded-lg p-2 text-center transition-all cursor-pointer hover:opacity-80 ${
                    isActive ? `ring-2 ${ringMap[key] || 'ring-gray-400'}` : ''
                  }`}
                >
                  <p className="text-lg font-bold">{count}</p>
                  <p className="text-[9px] leading-tight">{label}</p>
                </button>
              );
            })}
          </div>
          <div className="space-y-1.5 max-h-[350px] overflow-y-auto">
            {recentCompteRendus.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Aucun compte-rendu enregistre</p>
            ) : (
              recentCompteRendus.map(cr => {
                const colorMap: Record<string, string> = {
                  client: 'text-green-600 bg-green-50',
                  mail_envoye: 'text-blue-600 bg-blue-50',
                  commande_plus_tard: 'text-amber-600 bg-amber-50',
                  a_relancer: 'text-purple-600 bg-purple-50',
                  pas_interesse: 'text-red-600 bg-red-50',
                };
                const crColor = colorMap[cr.compte_rendu || ''] || 'text-gray-600 bg-gray-50';
                return (
                  <div key={cr.id} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors">
                    <div className={`p-1.5 rounded-lg shrink-0 ${crColor}`}>
                      <ClipboardCheck className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-900 truncate">{cr.prospectName}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${crColor}`}>
                          {APPOINTMENT_RESULT_LABELS[cr.compte_rendu || ''] || cr.compte_rendu}
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-500">{formatDate(cr.date)} - {cr.commercialName}</p>
                      {cr.notes_compte_rendu && <p className="text-[10px] text-gray-400 truncate mt-0.5">{cr.notes_compte_rendu}</p>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Top performers this week */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
          <h3 className="font-semibold text-gray-900 text-sm sm:text-base mb-4 flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-400" />
            Classement de la semaine
          </h3>
          <div className="space-y-3">
            {userActivities.map((ua, i) => {
              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
              return (
                <div key={ua.user.id} className={`p-3 rounded-lg ${i < 3 ? 'bg-gradient-to-r from-amber-50/50 to-transparent' : 'bg-gray-50'}`}>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="w-9 h-9 rounded-full bg-brewery-100 flex items-center justify-center text-sm font-bold text-brewery-700">
                        {ua.user.prenom[0]}{ua.user.nom[0]}
                      </div>
                      {medal && <span className="absolute -top-1 -right-1 text-sm">{medal}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm text-gray-900">{ua.user.prenom} {ua.user.nom}</p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600">{ROLE_LABELS[ua.user.role] || ua.user.role}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] text-green-600 flex items-center gap-0.5">
                          <Phone className="w-3 h-3" /> {ua.weekCalls} appels
                        </span>
                        <span className="text-[10px] text-blue-600 flex items-center gap-0.5">
                          <Calendar className="w-3 h-3" /> {ua.monthRdv} RDV
                        </span>
                        <span className="text-[10px] text-purple-600 flex items-center gap-0.5">
                          <UserCheck className="w-3 h-3" /> {ua.totalProspects} prospects
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-bold text-gray-900">{ua.weekCalls}</p>
                      <p className="text-[10px] text-gray-400">appels/sem</p>
                    </div>
                  </div>
                </div>
              );
            })}
            {userActivities.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">Aucun membre dans l'equipe</p>
            )}
          </div>
        </div>
      </div>

      {/* Full team performance table (ALL users) */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
        <h3 className="font-semibold text-gray-900 text-sm sm:text-base mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-gray-400" />
          Performance detaillee de l'equipe
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-2 font-medium text-gray-500">Membre</th>
                <th className="text-center py-3 px-2 font-medium text-gray-500">
                  <span className="hidden sm:inline">Appels</span>
                  <span className="sm:hidden">App.</span> aujourd'hui
                </th>
                <th className="text-center py-3 px-2 font-medium text-gray-500">
                  <span className="hidden sm:inline">Appels</span>
                  <span className="sm:hidden">App.</span> semaine
                </th>
                <th className="text-center py-3 px-2 font-medium text-gray-500">Objectif</th>
                <th className="text-center py-3 px-2 font-medium text-gray-500">Progression</th>
                <th className="text-center py-3 px-2 font-medium text-gray-500">RDV mois</th>
                <th className="text-center py-3 px-2 font-medium text-gray-500">
                  <span className="hidden sm:inline">RDV pris (prospection)</span>
                  <span className="sm:hidden">RDV prosp.</span>
                </th>
                <th className="text-center py-3 px-2 font-medium text-gray-500">Taux rep.</th>
                <th className="text-center py-3 px-2 font-medium text-gray-500">
                  <span className="hidden sm:inline">Duree moy.</span>
                  <span className="sm:hidden">Dur.</span>
                </th>
                <th className="text-center py-3 px-2 font-medium text-gray-500">Prospects</th>
                <th className="text-center py-3 px-2 font-medium text-gray-500">Gagnes</th>
              </tr>
            </thead>
            <tbody>
              {userActivities.map(ua => {
                const progressColor = ua.progress >= 100 ? 'bg-green-500' : ua.progress >= 70 ? 'bg-amber-500' : 'bg-red-500';

                return (
                  <tr key={ua.user.id} className="border-b border-gray-100 last:border-0">
                    <td className="py-3 px-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-brewery-100 flex items-center justify-center text-xs font-bold text-brewery-700">
                          {ua.user.prenom[0]}{ua.user.nom[0]}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 text-sm">{ua.user.prenom} {ua.user.nom}</p>
                          <p className="text-[10px] text-gray-500">{ROLE_LABELS[ua.user.role] || ua.user.role}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-center py-3 px-2">
                      <span className={`font-semibold ${ua.todayCalls > 0 ? 'text-green-600' : 'text-gray-400'}`}>{ua.todayCalls}</span>
                    </td>
                    <td className="text-center py-3 px-2 font-semibold">{ua.weekCalls}</td>
                    <td className="text-center py-3 px-2 text-gray-500">{ua.objective}</td>
                    <td className="py-3 px-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-2 min-w-[60px]">
                          <div
                            className={`h-2 rounded-full progress-bar ${progressColor}`}
                            style={{ width: `${Math.min(ua.progress, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-gray-600 w-10 text-right">{ua.progress}%</span>
                      </div>
                    </td>
                    <td className="text-center py-3 px-2 font-semibold text-blue-600">{ua.monthRdv}</td>
                    <td className="text-center py-3 px-2">
                      <span className={`font-semibold ${ua.monthRdvTaken > 0 ? 'text-purple-600' : 'text-gray-400'}`}>
                        {ua.monthRdvTaken}
                      </span>
                    </td>
                    <td className="text-center py-3 px-2">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        ua.responseRate >= 60 ? 'bg-green-100 text-green-700' :
                        ua.responseRate >= 30 ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {ua.responseRate}%
                      </span>
                    </td>
                    <td className="text-center py-3 px-2 text-gray-600 text-xs">{formatDuration(ua.avgDuration)}</td>
                    <td className="text-center py-3 px-2 font-semibold">
                      {ua.totalProspects}
                      <span className="text-[10px] text-gray-400 ml-0.5">({ua.activeProspects} actifs)</span>
                    </td>
                    <td className="text-center py-3 px-2">
                      <span className={`font-semibold ${ua.wonProspects > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                        {ua.wonProspects}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {userActivities.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-6 text-center text-gray-400 text-sm">Aucun membre dans l'equipe</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monthly History with week-by-week breakdown */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 text-sm sm:text-base">Historique mensuel</h3>
          <div className="flex items-center gap-2">
            <button
              className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600"
              onClick={() => setMonthOffset(prev => prev - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium text-gray-700 min-w-[140px] text-center capitalize">{monthLabel}</span>
            <button
              className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-30"
              onClick={() => setMonthOffset(prev => prev + 1)}
              disabled={monthOffset >= 0}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Month summary */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
          <div className="bg-green-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-green-700">{monthlyHistory.totalCalls}</p>
            <p className="text-[10px] text-green-600 mt-0.5">Appels total</p>
          </div>
          <div className="bg-amber-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-amber-700">{monthlyHistory.totalProspects}</p>
            <p className="text-[10px] text-amber-600 mt-0.5">Prospects crees</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-blue-700">{monthlyHistory.totalRdv}</p>
            <p className="text-[10px] text-blue-600 mt-0.5">RDV total</p>
          </div>
          <div className="bg-purple-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-purple-700">{monthlyHistory.answered}</p>
            <p className="text-[10px] text-purple-600 mt-0.5">Repondus</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-gray-700">{monthlyHistory.responseRate}%</p>
            <p className="text-[10px] text-gray-600 mt-0.5">Taux reponse</p>
          </div>
        </div>

        {/* Weekly breakdown chart */}
        <div className="h-48 mb-4">
          <Bar
            data={weeklyChartData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
              plugins: { legend: { position: 'top', labels: { boxWidth: 12, padding: 8, font: { size: 10 } } } },
            }}
          />
        </div>

        {/* Weekly details table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-2 font-medium text-gray-500">Semaine</th>
                <th className="text-center py-2 px-2 font-medium text-gray-500">Appels</th>
                <th className="text-center py-2 px-2 font-medium text-gray-500">Repondus</th>
                <th className="text-center py-2 px-2 font-medium text-gray-500">Taux</th>
                <th className="text-center py-2 px-2 font-medium text-gray-500">Prospects</th>
                <th className="text-center py-2 px-2 font-medium text-gray-500">RDV</th>
              </tr>
            </thead>
            <tbody>
              {monthlyHistory.weeklyBreakdown.map((week, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-2 px-2 font-medium text-gray-700">{week.label}</td>
                  <td className="text-center py-2 px-2 font-semibold">{week.calls}</td>
                  <td className="text-center py-2 px-2 text-green-600 font-semibold">{week.answered}</td>
                  <td className="text-center py-2 px-2">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      week.responseRate >= 60 ? 'bg-green-100 text-green-700' :
                      week.responseRate >= 30 ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {week.responseRate}%
                    </span>
                  </td>
                  <td className="text-center py-2 px-2 text-amber-600 font-semibold">{week.prospects}</td>
                  <td className="text-center py-2 px-2 text-blue-600 font-semibold">{week.rdv}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
