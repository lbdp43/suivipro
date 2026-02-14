import { useMemo } from 'react';
import {
  Users, Phone, Calendar, TrendingUp, Target, BarChart3,
  ArrowUpRight, ArrowDownRight, Clock,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import {
  getCallsToday, getCallsThisWeek, getCallsThisMonth,
  getAppointmentsThisWeek, getAppointmentsThisMonth,
  getConversionRate, getResponseRate, getAverageCallDuration,
  formatDuration,
} from '../utils/helpers';
import { PIPELINE_LABELS, PIPELINE_COLORS, PipelineStage } from '../types';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement } from 'chart.js';
import { Doughnut, Bar } from 'react-chartjs-2';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

export default function DashboardPage() {
  const { state } = useApp();

  const stats = useMemo(() => {
    const callsToday = getCallsToday(state.calls);
    const callsWeek = getCallsThisWeek(state.calls);
    const callsMonth = getCallsThisMonth(state.calls);
    const rdvWeek = getAppointmentsThisWeek(state.appointments);
    const rdvMonth = getAppointmentsThisMonth(state.appointments);
    const conversionRate = getConversionRate(state.prospects);
    const responseRate = getResponseRate(state.calls);
    const avgDuration = getAverageCallDuration(state.calls);

    const prospectsByStage = (Object.keys(PIPELINE_LABELS) as PipelineStage[]).map(stage => ({
      stage,
      label: PIPELINE_LABELS[stage],
      color: PIPELINE_COLORS[stage],
      count: state.prospects.filter(p => p.etape_pipeline === stage).length,
    }));

    const activeProspects = state.prospects.filter(p => !['gagne', 'perdu'].includes(p.etape_pipeline)).length;
    const wonProspects = state.prospects.filter(p => p.etape_pipeline === 'gagne').length;
    const lostProspects = state.prospects.filter(p => p.etape_pipeline === 'perdu').length;

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
      lostProspects,
    };
  }, [state]);

  // Chart: Prospects by pipeline stage
  const pipelineChartData = {
    labels: stats.prospectsByStage.map(s => s.label),
    datasets: [{
      data: stats.prospectsByStage.map(s => s.count),
      backgroundColor: stats.prospectsByStage.map(s => s.color),
      borderWidth: 0,
    }],
  };

  // Chart: Calls by commercial
  const commercialCallsData = {
    labels: state.commerciaux.map(c => c.prenom),
    datasets: [{
      label: 'Appels cette semaine',
      data: state.commerciaux.map(c => getCallsThisWeek(state.calls.filter(cl => cl.commercial_id === c.id)).length),
      backgroundColor: '#22c55e',
      borderRadius: 6,
    }, {
      label: 'RDV ce mois',
      data: state.commerciaux.map(c => getAppointmentsThisMonth(state.appointments.filter(a => a.commercial_id === c.id)).length),
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

        {/* Activity by commercial */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Activite par commercial</h3>
          <div className="h-64">
            <Bar
              data={commercialCallsData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
                plugins: { legend: { position: 'top', labels: { boxWidth: 12, padding: 12, font: { size: 11 } } } },
              }}
            />
          </div>
        </div>
      </div>

      {/* Pipeline breakdown table */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Prospects par etape</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {stats.prospectsByStage.map(s => (
            <div key={s.stage} className="text-center p-3 rounded-lg bg-gray-50">
              <div className="pipeline-dot mx-auto mb-2" style={{ backgroundColor: s.color }} />
              <p className="text-2xl font-bold text-gray-900">{s.count}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Commercial performance table */}
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
              {state.commerciaux.map(commercial => {
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
                          <p className="text-[10px] text-gray-500">{commercial.role === 'admin' ? 'Admin' : 'Commercial'}</p>
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
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
