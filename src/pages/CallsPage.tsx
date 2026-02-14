import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Phone, PhoneCall, PhoneOff, Clock, Search, Plus, X, Save,
  MessageSquare, PhoneMissed, VoicemailIcon, CheckCircle,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { CallResult, CALL_RESULT_LABELS } from '../types';
import { generateId, formatDateTime, formatDuration, formatDurationTimer, formatTimeAgo, getCallsThisWeek, getCallsToday, getResponseRate } from '../utils/helpers';

export default function CallsPage() {
  const { state, dispatch } = useApp();
  const [showCallModal, setShowCallModal] = useState(false);
  const [selectedProspectId, setSelectedProspectId] = useState('');
  const [callActive, setCallActive] = useState(false);
  const [callTimer, setCallTimer] = useState(0);
  const [callResult, setCallResult] = useState<CallResult>('repondu');
  const [callNotes, setCallNotes] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Start/stop timer
  useEffect(() => {
    if (callActive) {
      timerRef.current = setInterval(() => setCallTimer(prev => prev + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [callActive]);

  const startCall = (prospectId: string) => {
    const prospect = state.prospects.find(p => p.id === prospectId);
    if (!prospect) return;
    setSelectedProspectId(prospectId);
    setCallActive(true);
    setCallTimer(0);
    setCallResult('repondu');
    setCallNotes('');
    setShowCallModal(true);

    // Trigger native phone on mobile
    window.location.href = `tel:${prospect.telephone.replace(/\s/g, '')}`;
  };

  const endCall = () => {
    setCallActive(false);
  };

  const saveCall = () => {
    dispatch({
      type: 'ADD_CALL',
      payload: {
        id: generateId('call'),
        prospect_id: selectedProspectId,
        commercial_id: state.currentUser?.id || 'com-1',
        date: new Date().toISOString(),
        duree: callTimer,
        resultat: callResult,
        notes: callNotes,
      },
    });
    setShowCallModal(false);
    setCallActive(false);
    setCallTimer(0);
  };

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
        <button
          className="bg-brewery-600 text-white px-4 py-2 rounded-lg hover:bg-brewery-700 flex items-center gap-2 text-sm font-medium"
          onClick={() => { setSelectedProspectId(''); setShowCallModal(true); setCallActive(false); setCallTimer(0); }}
        >
          <Plus className="w-4 h-4" /> Nouvel appel
        </button>
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
            .filter(p => !['gagne', 'perdu'].includes(p.etape_pipeline))
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

      {/* Call Modal */}
      {showCallModal && (
        <div className="modal-backdrop" onClick={() => { if (!callActive) setShowCallModal(false); }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">
                {callActive ? 'Appel en cours' : 'Enregistrer un appel'}
              </h3>
              {!callActive && (
                <button className="p-1 rounded hover:bg-gray-100" onClick={() => setShowCallModal(false)}>
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              )}
            </div>
            <div className="p-5 space-y-4">
              {/* Timer */}
              {callActive && (
                <div className="text-center py-4">
                  <div className="text-4xl font-mono font-bold text-brewery-600">
                    {formatDurationTimer(callTimer)}
                  </div>
                  <p className="text-sm text-gray-500 mt-2">
                    {state.prospects.find(p => p.id === selectedProspectId)?.nom_etablissement}
                  </p>
                  <button
                    className="mt-4 bg-red-500 text-white px-6 py-2 rounded-full hover:bg-red-600 flex items-center gap-2 mx-auto"
                    onClick={endCall}
                  >
                    <PhoneOff className="w-4 h-4" /> Raccrocher
                  </button>
                </div>
              )}

              {!callActive && !selectedProspectId && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Prospect</label>
                  <select
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    value={selectedProspectId}
                    onChange={e => setSelectedProspectId(e.target.value)}
                  >
                    <option value="">Selectionnez un prospect</option>
                    {state.prospects.map(p => (
                      <option key={p.id} value={p.id}>{p.nom_etablissement} - {p.telephone}</option>
                    ))}
                  </select>
                </div>
              )}

              {!callActive && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Resultat</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(Object.keys(CALL_RESULT_LABELS) as CallResult[]).map(result => (
                        <button
                          key={result}
                          className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                            callResult === result
                              ? 'border-brewery-500 bg-brewery-50 text-brewery-700'
                              : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                          }`}
                          onClick={() => setCallResult(result)}
                        >
                          {CALL_RESULT_LABELS[result]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                    <textarea
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm h-24 resize-none"
                      placeholder="Notes de l'appel..."
                      value={callNotes}
                      onChange={e => setCallNotes(e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>
            {!callActive && (
              <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
                <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setShowCallModal(false)}>Annuler</button>
                {selectedProspectId && (
                  <button
                    className="px-4 py-2 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center gap-2"
                    onClick={() => startCall(selectedProspectId)}
                  >
                    <Phone className="w-4 h-4" /> Appeler
                  </button>
                )}
                <button
                  className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2"
                  onClick={saveCall}
                  disabled={!selectedProspectId}
                >
                  <Save className="w-4 h-4" /> Enregistrer
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
