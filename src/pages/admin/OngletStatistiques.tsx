// Statistiques par commercial — onglet de la page Administration, extrait tel quel.
import {  useMemo } from 'react';
import { TrendingUp, Phone, Calendar, Award } from 'lucide-react';
import { objectifAppels } from '../../utils/objectifs';
import { getCallsThisWeek, getCallsThisMonth, getCallsToday, getAppointmentsThisWeek, getAppointmentsThisMonth, getResponseRate, getAverageCallDuration, getConversionRate, formatDuration } from '../../utils/helpers';
import { useApp } from '../../store/AppContext';

export default function OngletStatistiques() {
  const { state } = useApp();

  const commercialStats = useMemo(() => {
    return state.commerciaux.map(commercial => {
      const comCalls = state.calls.filter(c => c.commercial_id === commercial.id);
      const comRdv = state.appointments.filter(a => a.commercial_id === commercial.id);
      const comProspects = state.prospects.filter(p => p.commercial_id === commercial.id);

      const weekCalls = getCallsThisWeek(comCalls).length;
      const monthCalls = getCallsThisMonth(comCalls).length;
      const todayCalls = getCallsToday(comCalls).length;
      const weekRdv = getAppointmentsThisWeek(comRdv).length;
      const monthRdv = getAppointmentsThisMonth(comRdv).length;
      const responseRate = getResponseRate(comCalls);
      const avgDuration = getAverageCallDuration(comCalls);
      const conversionRate = getConversionRate(comProspects);

      const objAppelsSemaine = objectifAppels(commercial, 'semaine');
      const objRdvMois = Number(commercial.objectifs?.rdv_realises_mois ?? commercial.objectifs?.rdv_pris_mois ?? commercial.objectifs?.rdv_mois ?? 0);
      const callsProgress = objAppelsSemaine > 0 ? Math.round((weekCalls / objAppelsSemaine) * 100) : 0;
      const rdvProgress = objRdvMois > 0 ? Math.round((monthRdv / objRdvMois) * 100) : 0;

      return {
        commercial,
        weekCalls,
        monthCalls,
        todayCalls,
        weekRdv,
        monthRdv,
        responseRate,
        avgDuration,
        conversionRate,
        callsProgress,
        rdvProgress,
        totalProspects: comProspects.length,
      };
    });
  }, [state]);

  return (
    <>
        <div className="space-y-6">
          {commercialStats.map(stats => (
            <div key={stats.commercial.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold ${
                  stats.commercial.role === 'admin' ? 'bg-amber-100 text-amber-700' : stats.commercial.role === 'prospection' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                }`}>
                  {stats.commercial.prenom[0]}
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-lg">{stats.commercial.prenom} {stats.commercial.nom}</h3>
                  <p className="text-xs text-gray-500">{stats.commercial.email} - {stats.commercial.telephone}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 mb-4">
                <div className="bg-gray-50 p-3 rounded-lg text-center">
                  <Phone className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-xl font-bold text-gray-900">{stats.todayCalls}</p>
                  <p className="text-[10px] text-gray-500">Appels aujourd'hui</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg text-center">
                  <Phone className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-xl font-bold text-gray-900">{stats.weekCalls}</p>
                  <p className="text-[10px] text-gray-500">Appels semaine</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg text-center">
                  <Phone className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-xl font-bold text-gray-900">{stats.monthCalls}</p>
                  <p className="text-[10px] text-gray-500">Appels mois</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg text-center">
                  <Calendar className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-xl font-bold text-gray-900">{stats.monthRdv}</p>
                  <p className="text-[10px] text-gray-500">RDV mois</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg text-center">
                  <TrendingUp className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-xl font-bold text-gray-900">{stats.responseRate}%</p>
                  <p className="text-[10px] text-gray-500">Taux réponse</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg text-center">
                  <Award className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-xl font-bold text-gray-900">{stats.conversionRate}%</p>
                  <p className="text-[10px] text-gray-500">Taux conversion</p>
                </div>
              </div>

              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-xs font-medium text-gray-600 mb-2">Durée moyenne des appels : {formatDuration(stats.avgDuration)}</p>
                <p className="text-xs font-medium text-gray-600">Prospects geres: {stats.totalProspects}</p>
              </div>
            </div>
          ))}
        </div>
    </>
  );
}
