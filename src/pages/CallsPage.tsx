import { useMemo, useState } from 'react';
import {
  Phone, PhoneCall, PhoneOff, Search,
  MessageSquare, PhoneMissed, CheckCircle,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useCallModal } from '../components/CallModal';
import { CallResult, CALL_RESULT_LABELS } from '../types';
import { formatDuration, formatTimeAgo, getCallsThisWeek, getCallsToday, getResponseRate } from '../utils/helpers';

export default function CallsPage() {
  const { state } = useApp();
  const { startCall } = useCallModal();
  const [searchTerm, setSearchTerm] = useState('');

  const allCalls = useMemo(() => {
    return [...state.calls].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [state.calls]);

  const filteredCalls = useMemo(() => {
    if (!searchTerm) return allCalls;
    const term = searchTerm.toLowerCase();
    return allCalls.filter(c => {
      const prospect = state.prospects.find(p => p.id === c.prospect_id);
      return prospect?.nom_etablissement.toLowerCase().includes(term) ||
             prospect?.nom_contact.toLowerCase().includes(term) ||
             c.notes.toLowerCase().includes(term);
    });
  }, [allCalls, searchTerm, state.prospects]);

  const todayCalls = getCallsToday(state.calls).length;
  const weekCalls = getCallsThisWeek(state.calls).length;
  const responseRate = getResponseRate(state.calls);

  const resultIcons: Record<CallResult, typeof CheckCircle> = {
    repondu: CheckCircle,
    pas_de_reponse: PhoneMissed,
    messagerie: MessageSquare,
    injoignable: PhoneOff,
  };

  const resultColors: Record<CallResult, string> = {
    repondu: 'text-green-600 bg-green-50',
    pas_de_reponse: 'text-red-600 bg-red-50',
    messagerie: 'text-amber-600 bg-amber-50',
    injoignable: 'text-gray-600 bg-gray-100',
  };

  return (
    <div className="p-6 space-y-6 fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Appels</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gestion des appels telephoniques</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
          <div className="bg-green-50 p-3 rounded-lg"><Phone className="w-5 h-5 text-green-600" /></div>
          <div>
            <p className="text-sm text-gray-500">Aujourd'hui</p>
            <p className="text-2xl font-bold text-gray-900">{todayCalls}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
          <div className="bg-blue-50 p-3 rounded-lg"><Phone className="w-5 h-5 text-blue-600" /></div>
          <div>
            <p className="text-sm text-gray-500">Cette semaine</p>
            <p className="text-2xl font-bold text-gray-900">{weekCalls}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
          <div className="bg-purple-50 p-3 rounded-lg"><PhoneCall className="w-5 h-5 text-purple-600" /></div>
          <div>
            <p className="text-sm text-gray-500">Taux de reponse</p>
            <p className="text-2xl font-bold text-gray-900">{responseRate}%</p>
          </div>
        </div>
      </div>

      {/* Quick call buttons */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Appel rapide (Click-to-Call)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {state.prospects
            .filter(p => !['gagne', 'perdu'].includes(p.etape_pipeline) && p.telephone)
            .slice(0, 6)
            .map(prospect => (
              <button
                key={prospect.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:bg-green-50 hover:border-green-300 transition-colors text-left"
                onClick={() => startCall(prospect.id)}
              >
                <div className="bg-green-500 p-2 rounded-full">
                  <Phone className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{prospect.nom_etablissement}</p>
                  <p className="text-[10px] text-gray-500">{prospect.telephone}</p>
                </div>
              </button>
            ))}
        </div>
      </div>

      {/* Call history */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-200 flex items-center gap-3">
          <h3 className="font-semibold text-gray-900 flex-1">Historique des appels</h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Rechercher..."
              className="pl-9 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm w-60"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        <div className="divide-y divide-gray-100">
          {filteredCalls.map(call => {
            const prospect = state.prospects.find(p => p.id === call.prospect_id);
            const commercial = state.commerciaux.find(c => c.id === call.commercial_id);
            const Icon = resultIcons[call.resultat];
            return (
              <div key={call.id} className="p-4 flex items-center gap-4 hover:bg-gray-50">
                <div className={`p-2 rounded-lg ${resultColors[call.resultat]}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{prospect?.nom_etablissement || 'Inconnu'}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{call.notes || 'Aucune note'}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-medium text-gray-600">{CALL_RESULT_LABELS[call.resultat]}</p>
                  <p className="text-[10px] text-gray-400">{formatDuration(call.duree)} - {commercial?.prenom}</p>
                  <p className="text-[10px] text-gray-400">{formatTimeAgo(call.date)}</p>
                </div>
              </div>
            );
          })}
          {filteredCalls.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-400">Aucun appel enregistre</div>
          )}
        </div>
      </div>
    </div>
  );
}
