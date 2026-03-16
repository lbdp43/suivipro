import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePersistedState } from '../hooks/usePersistedState';
import {
  Phone, PhoneCall, PhoneOff, Search,
  MessageSquare, PhoneMissed, CheckCircle,
  Edit2, X, Save, Trash2, Filter,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import { apiPut, apiDelete } from '../api/client';
import { Call, CallResult, CALL_RESULT_LABELS } from '../types';
import { formatDuration, formatTimeAgo, getCallsThisWeek, getCallsToday, getResponseRate } from '../utils/helpers';

export default function CallsPage() {
  const { state, dispatch, dispatchLocal } = useApp();
  const toast = useToast();
  const [searchTerm, setSearchTerm] = usePersistedState('calls_searchTerm', '');
  const [filterResult, setFilterResult] = usePersistedState<CallResult | ''>('calls_filterResult', '');
  const [editingCall, setEditingCall] = useState<Call | null>(null);
  const [editForm, setEditForm] = useState({ resultat: '' as CallResult, notes: '', duree: 0 });
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 25;

  const allCalls = useMemo(() => {
    return [...state.calls].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [state.calls]);

  const filteredCalls = useMemo(() => {
    let list = allCalls;
    if (filterResult) list = list.filter(c => c.resultat === filterResult);
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      list = list.filter(c => {
        const prospect = state.prospects.find(p => p.id === c.prospect_id);
        return prospect?.nom_etablissement.toLowerCase().includes(term) ||
               prospect?.nom_contact.toLowerCase().includes(term) ||
               c.notes.toLowerCase().includes(term);
      });
    }
    return list;
  }, [allCalls, searchTerm, filterResult, state.prospects]);

  // Reset page quand les filtres changent
  const totalPages = Math.max(1, Math.ceil(filteredCalls.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedCalls = filteredCalls.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const weekCalls = getCallsThisWeek(state.calls);
  const todayCalls = getCallsToday(state.calls).length;
  const weekCallsCount = weekCalls.length;
  const responseRate = getResponseRate(state.calls);
  const weekResponseRate = getResponseRate(weekCalls);

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

  const openEdit = (call: Call) => {
    setEditingCall(call);
    setEditForm({ resultat: call.resultat, notes: call.notes, duree: call.duree });
  };

  const saveEdit = async () => {
    if (!editingCall) return;
    const payload = { ...editingCall, resultat: editForm.resultat, notes: editForm.notes, duree: editForm.duree };
    try {
      await apiPut(`/calls/${editingCall.id}`, payload);
      dispatchLocal({ type: 'UPDATE_CALL', payload });
      toast.success('Appel mis a jour');
      setEditingCall(null);
    } catch (err: unknown) {
      toast.error(`Erreur mise a jour appel: ${err instanceof Error ? err.message : 'Erreur inconnue'}`);
    }
  };

  const deleteCall = async (id: string) => {
    if (confirm('Supprimer cet appel ?')) {
      try {
        await apiDelete(`/calls/${id}`);
        dispatchLocal({ type: 'DELETE_CALL', payload: id });
        toast.success('Appel supprime');
      } catch (err: unknown) {
        toast.error(`Erreur suppression appel: ${err instanceof Error ? err.message : 'Erreur inconnue'}`);
      }
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Appels</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">Gestion des appels telephoniques</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 flex items-center gap-3">
          <div className="bg-green-50 p-2 sm:p-3 rounded-lg"><Phone className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" /></div>
          <div>
            <p className="text-[10px] sm:text-sm text-gray-500">Aujourd'hui</p>
            <p className="text-lg sm:text-2xl font-bold text-gray-900">{todayCalls}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 flex items-center gap-3">
          <div className="bg-blue-50 p-2 sm:p-3 rounded-lg"><Phone className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" /></div>
          <div>
            <p className="text-[10px] sm:text-sm text-gray-500">Cette semaine</p>
            <p className="text-lg sm:text-2xl font-bold text-gray-900">{weekCallsCount}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 flex items-center gap-3">
          <div className="bg-purple-50 p-2 sm:p-3 rounded-lg"><PhoneCall className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600" /></div>
          <div>
            <p className="text-[10px] sm:text-sm text-gray-500">Taux reponse</p>
            <p className="text-lg sm:text-2xl font-bold text-gray-900">{responseRate}%</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 flex items-center gap-3">
          <div className="bg-amber-50 p-2 sm:p-3 rounded-lg"><PhoneCall className="w-4 h-4 sm:w-5 sm:h-5 text-amber-600" /></div>
          <div>
            <p className="text-[10px] sm:text-sm text-gray-500">Taux semaine</p>
            <p className="text-lg sm:text-2xl font-bold text-gray-900">{weekResponseRate}%</p>
          </div>
        </div>
      </div>

      {/* Call history */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-3 sm:p-4 border-b border-gray-200 space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
            <h3 className="font-semibold text-gray-900 text-sm sm:text-base flex-1">
              Historique ({filteredCalls.length})
            </h3>
            <div className="relative w-full sm:w-60">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher..."
                className="w-full pl-9 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm"
                value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              />
            </div>
          </div>
          {/* Filter by result */}
          <div className="flex gap-1.5 flex-wrap">
            <button
              className={`px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-medium transition-colors ${!filterResult ? 'bg-brewery-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              onClick={() => { setFilterResult(''); setCurrentPage(1); }}
            >
              Tous
            </button>
            {(Object.keys(CALL_RESULT_LABELS) as CallResult[]).map(r => (
              <button
                key={r}
                className={`px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-medium transition-colors ${filterResult === r ? 'bg-brewery-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                onClick={() => { setFilterResult(filterResult === r ? '' : r); setCurrentPage(1); }}
              >
                {CALL_RESULT_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
        <div className="divide-y divide-gray-100">
          {paginatedCalls.map(call => {
            const prospect = state.prospects.find(p => p.id === call.prospect_id);
            const commercial = state.commerciaux.find(c => c.id === call.commercial_id);
            const Icon = resultIcons[call.resultat];
            return (
              <div key={call.id} className="p-3 sm:p-4 flex items-center gap-3 sm:gap-4 hover:bg-gray-50 group">
                <div className={`p-1.5 sm:p-2 rounded-lg flex-shrink-0 ${resultColors[call.resultat]}`}>
                  <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  {prospect ? (
                    <Link
                      to={`/prospects?id=${prospect.id}`}
                      className="text-xs sm:text-sm font-medium text-indigo-600 hover:text-indigo-800 hover:underline truncate block"
                    >
                      {prospect.nom_etablissement}
                    </Link>
                  ) : (
                    <p className="text-xs sm:text-sm font-medium text-gray-900 truncate">Inconnu</p>
                  )}
                  <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5 truncate">{call.notes || 'Aucune note'}</p>
                </div>
                <div className="text-right flex-shrink-0 hidden sm:block">
                  <p className="text-xs font-medium text-gray-600">{CALL_RESULT_LABELS[call.resultat]}</p>
                  <p className="text-[10px] text-gray-400">{formatDuration(call.duree)} - {commercial?.prenom}</p>
                  <p className="text-[10px] text-gray-400">{formatTimeAgo(call.date)}</p>
                </div>
                <div className="sm:hidden text-right flex-shrink-0">
                  <p className="text-[10px] text-gray-500">{formatTimeAgo(call.date)}</p>
                </div>
                {/* Edit/Delete buttons */}
                <div className="flex gap-1 flex-shrink-0 opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                  <button
                    className="p-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600"
                    onClick={() => openEdit(call)}
                    title="Modifier"
                  >
                    <Edit2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  </button>
                  <button
                    className="p-1.5 rounded bg-red-50 hover:bg-red-100 text-red-500"
                    onClick={() => deleteCall(call.id)}
                    title="Supprimer"
                  >
                    <Trash2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
          {filteredCalls.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-400">Aucun appel enregistre</div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-3 sm:p-4 border-t border-gray-200 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {(safePage - 1) * PAGE_SIZE + 1}-{Math.min(safePage * PAGE_SIZE, filteredCalls.length)} sur {filteredCalls.length} appels
            </p>
            <div className="flex items-center gap-1">
              <button
                className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={safePage <= 1}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                .reduce<(number | 'dots')[]>((acc, p, idx, arr) => {
                  if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('dots');
                  acc.push(p);
                  return acc;
                }, [])
                .map((item, idx) =>
                  item === 'dots' ? (
                    <span key={`dots-${idx}`} className="px-1 text-xs text-gray-400">...</span>
                  ) : (
                    <button
                      key={item}
                      className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                        safePage === item
                          ? 'bg-brewery-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                      onClick={() => setCurrentPage(item)}
                    >
                      {item}
                    </button>
                  )
                )}
              <button
                className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Edit call modal */}
      {editingCall && (
        <div className="modal-backdrop">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-4 sm:p-5 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 text-sm sm:text-base">Modifier l'appel</h3>
              <button className="p-1 rounded hover:bg-gray-100" onClick={() => setEditingCall(null)}>
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-4 sm:p-5 space-y-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Prospect</p>
                <p className="text-sm font-medium text-gray-900">
                  {state.prospects.find(p => p.id === editingCall.prospect_id)?.nom_etablissement || 'Inconnu'}
                </p>
                <p className="text-[10px] text-gray-400">{formatTimeAgo(editingCall.date)}</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Resultat</label>
                <select
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={editForm.resultat}
                  onChange={e => setEditForm(prev => ({ ...prev, resultat: e.target.value as CallResult }))}
                >
                  {(Object.keys(CALL_RESULT_LABELS) as CallResult[]).map(r => (
                    <option key={r} value={r}>{CALL_RESULT_LABELS[r]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Duree (secondes)</label>
                <input
                  type="number"
                  min="0"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={editForm.duree}
                  onChange={e => setEditForm(prev => ({ ...prev, duree: parseInt(e.target.value) || 0 }))}
                />
                <p className="text-[10px] text-gray-400 mt-0.5">{formatDuration(editForm.duree)}</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm h-24 resize-none"
                  value={editForm.notes}
                  onChange={e => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Notes sur l'appel..."
                />
              </div>
            </div>
            <div className="p-4 sm:p-5 border-t border-gray-200 flex justify-end gap-3">
              <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setEditingCall(null)}>
                Annuler
              </button>
              <button
                className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2"
                onClick={saveEdit}
              >
                <Save className="w-4 h-4" /> Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
