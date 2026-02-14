import { useMemo, useState } from 'react';
import {
  Users, Phone, Calendar, TrendingUp, BarChart3, Clock, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import {
  getCallsToday, getCallsThisWeek, getCallsThisMonth,
  getAppointmentsThisWeek, getAppointmentsThisMonth,
  getConversionRate, getResponseRate, getAverageCallDuration,
  formatDuration,
} from '../utils/helpers';
import { PipelineStage } from '../types';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement } from 'chart.js';
import { Doughnut, Bar } from 'react-chartjs-2';
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval, parseISO, startOfWeek, endOfWeek, addWeeks } from 'date-fns';
import { fr } from 'date-fns/locale';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

// Helpers for month navigation
function getCallsInRange(calls: { date: string }[], start: Date, end: Date) {
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

export default function DashboardPage() {
  const { state } = useApp();
  const [monthOffset, setMonthOffset] = useState(0); // 0 = current, -1 = last month, etc.

  const selectedMonth = subMonths(new Date(), -monthOffset);
  const monthStart = startOfMonth(selectedMonth);
  const monthEnd = endOfMonth(selectedMonth);
  const monthLabel = format(selectedMonth, 'MMMM yyyy', { locale: fr });

  // Only commercial users (not admin) for performance tracking
  const commerciaux = state.commerciaux.filter(c => c.role === 'commercial');

  // Use only active pipeline columns (the ones visible in the pipeline view)
  const activeColumns = state.pipelineColumns;
  const activeColumnIds = new Set(activeColumns.map(c => c.id));

  const stats = useMemo(() => {
    const callsToday = getCallsToday(state.calls);
    const callsWeek = getCallsThisWeek(state.calls);
    const callsMonth = getCallsThisMonth(state.calls);
    const rdvWeek = getAppointmentsThisWeek(state.appointments);
    const rdvMonth = getAppointmentsThisMonth(state.appointments);
    const conversionRate = getConversionRate(state.prospects);
    const responseRate = getResponseRate(state.calls);
    const avgDuration = getAverageCallDuration(state.calls);

    // Only show stages that exist in the active pipeline columns
    const prospectsByStage = activeColumns.map(col => ({
      stage: col.id,
      label: col.label,
      color: col.color,
      count: state.prospects.filter(p => p.etape_pipeline === col.id).length,
    }));

    const activeProspects = state.prospects.filter(p => !['gagne', 'perdu'].includes(p.etape_pipeline)).length;
    const wonProspects = state.prospects.filter(p => p.etape_pipeline === 'gagne').length;

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
    const weeks = getWeeksInMonth(selectedMonth);

    const weeklyBreakdown = weeks.map(week => {
      const weekCalls = getCallsInRange(state.calls, week.start, week.end);
      const weekRdv = getCallsInRange(state.appointments, week.start, week.end);
      const weekAnswered = weekCalls.filter((c: any) => c.resultat === 'repondu').length;
      return {
        label: week.label,
        calls: weekCalls.length,
        rdv: weekRdv.length,
        answered: weekAnswered,
        responseRate: weekCalls.length > 0 ? Math.round((weekAnswered / weekCalls.length) * 100) : 0,
      };
    });

    return {
      totalCalls: monthCalls.length,
      totalRdv: monthRdv.length,
      answered: monthCalls.filter((c: any) => c.resultat === 'repondu').length,
      responseRate: monthCalls.length > 0
        ? Math.round((monthCalls.filter((c: any) => c.resultat === 'repondu').length / monthCalls.length) * 100)
        : 0,
      weeklyBreakdown,
    };
  }, [state.calls, state.appointments, monthStart, monthEnd, selectedMonth]);

  // Chart: Prospects by pipeline stage (only active columns)
  const pipelineChartData = {
    labels: stats.prospectsByStage.map(s => s.label),
    datasets: [{
      data: stats.prospectsByStage.map(s => s.count),
      backgroundColor: stats.prospectsByStage.map(s => s.color),
      borderWidth: 0,
    }],
  };

  // Chart: Calls by commercial (exclude admins)
  const commercialCallsData = {
    labels: commerciaux.map(c => c.prenom),
    datasets: [{
      label: 'Appels cette semaine',
      data: commerciaux.map(c => getCallsThisWeek(state.calls.filter(cl => cl.commercial_id === c.id)).length),
      backgroundColor: '#22c55e',
      borderRadius: 6,
    }, {
      label: 'RDV ce mois',
      data: commerciaux.map(c => getAppointmentsThisMonth(state.appointments.filter(a => a.commercial_id === c.id)).length),
      backgroundColor: '#3b82f6',
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
    <div className="p-6 space-y-6 fade-in">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Vue d'ensemble de l'activite commerciale</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500">{kpi.label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{kpi.value}</p>
                <p className="text-xs text-gray-400 mt-1">{kpi.sub}</p>
              </div>
              <div className={`${kpi.color} p-2.5 rounded-lg`}>
                <kpi.icon className="w-5 h-5 text-white" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
          <div className="bg-green-50 p-3 rounded-lg">
            <Phone className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Taux de reponse</p>
            <p className="text-xl font-bold text-gray-900">{stats.responseRate}%</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
          <div className="bg-blue-50 p-3 rounded-lg">
            <Clock className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Duree moy. appels</p>
            <p className="text-xl font-bold text-gray-900">{formatDuration(stats.avgDuration)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
          <div className="bg-amber-50 p-3 rounded-lg">
            <BarChart3 className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Appels ce mois</p>
            <p className="text-xl font-bold text-gray-900">{stats.callsMonth}</p>
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pipeline distribution */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Repartition du pipeline</h3>
          <div className="h-64 flex items-center justify-center">
            <Doughnut
              data={pipelineChartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { position: 'right', labels: { boxWidth: 12, padding: 12, font: { size: 11 } } },
                },
              }}
            />
          </div>
        </div>

        {/* Activity by commercial (admins excluded) */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Activite par commercial</h3>
          <div className="h-64">
            {commerciaux.length > 0 ? (
              <Bar
                data={commercialCallsData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
                  plugins: { legend: { position: 'top', labels: { boxWidth: 12, padding: 12, font: { size: 11 } } } },
                }}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-gray-400">Aucun commercial</div>
            )}
          </div>
        </div>
      </div>

      {/* Pipeline breakdown - only active columns */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Prospects par etape</h3>
        <div className={`grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-${Math.min(activeColumns.length, 8)} gap-3`}>
          {stats.prospectsByStage.map(s => (
            <div key={s.stage} className="text-center p-3 rounded-lg bg-gray-50">
              <div className="pipeline-dot mx-auto mb-2" style={{ backgroundColor: s.color }} />
              <p className="text-2xl font-bold text-gray-900">{s.count}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Monthly History with week-by-week breakdown */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Historique mensuel</h3>
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="bg-green-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-green-700">{monthlyHistory.totalCalls}</p>
            <p className="text-[10px] text-green-600 mt-0.5">Appels total</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-blue-700">{monthlyHistory.totalRdv}</p>
            <p className="text-[10px] text-blue-600 mt-0.5">RDV total</p>
          </div>
          <div className="bg-purple-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-purple-700">{monthlyHistory.answered}</p>
            <p className="text-[10px] text-purple-600 mt-0.5">Repondus</p>
          </div>
          <div className="bg-amber-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-amber-700">{monthlyHistory.responseRate}%</p>
            <p className="text-[10px] text-amber-600 mt-0.5">Taux reponse</p>
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
                  <td className="text-center py-2 px-2 text-blue-600 font-semibold">{week.rdv}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Commercial performance table (admins excluded) */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Performance des commerciaux</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-2 font-medium text-gray-500">Commercial</th>
                <th className="text-center py-3 px-2 font-medium text-gray-500">Appels semaine</th>
                <th className="text-center py-3 px-2 font-medium text-gray-500">Objectif</th>
                <th className="text-center py-3 px-2 font-medium text-gray-500">Progression</th>
                <th className="text-center py-3 px-2 font-medium text-gray-500">RDV mois</th>
                <th className="text-center py-3 px-2 font-medium text-gray-500">Taux reponse</th>
              </tr>
            </thead>
            <tbody>
              {commerciaux.map(commercial => {
                const comCalls = state.calls.filter(c => c.commercial_id === commercial.id);
                const weekCalls = getCallsThisWeek(comCalls).length;
                const monthRdv = getAppointmentsThisMonth(
                  state.appointments.filter(a => a.commercial_id === commercial.id)
                ).length;
                const objective = commercial.objectifs.appels_semaine;
                const progress = objective > 0 ? Math.round((weekCalls / objective) * 100) : 0;
                const responseRate = getResponseRate(comCalls);
                const progressColor = progress >= 100 ? 'bg-green-500' : progress >= 70 ? 'bg-amber-500' : 'bg-red-500';

                return (
                  <tr key={commercial.id} className="border-b border-gray-100 last:border-0">
                    <td className="py-3 px-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-brewery-100 flex items-center justify-center text-sm font-bold text-brewery-700">
                          {commercial.prenom[0]}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{commercial.prenom}</p>
                          <p className="text-[10px] text-gray-500">Commercial</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-center py-3 px-2 font-semibold">{weekCalls}</td>
                    <td className="text-center py-3 px-2 text-gray-500">{objective}</td>
                    <td className="py-3 px-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full progress-bar ${progressColor}`}
                            style={{ width: `${Math.min(progress, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-gray-600 w-10 text-right">{progress}%</span>
                      </div>
                    </td>
                    <td className="text-center py-3 px-2 font-semibold">{monthRdv}</td>
                    <td className="text-center py-3 px-2">{responseRate}%</td>
                  </tr>
                );
              })}
              {commerciaux.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-gray-400 text-sm">Aucun commercial (les admins ne sont pas affiches ici)</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
