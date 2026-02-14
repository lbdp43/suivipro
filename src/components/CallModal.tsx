import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { Phone, PhoneOff, X, Save, CheckCircle, MessageSquare, PhoneMissed, Tag, Bell, Clock, Plus } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { CallResult, CALL_RESULT_LABELS } from '../types';
import { generateId, formatDurationTimer } from '../utils/helpers';

// ============================================
// Context for triggering calls from anywhere
// ============================================

interface CallModalContextType {
  startCall: (prospectId: string) => void;
}

const CallModalContext = createContext<CallModalContextType | undefined>(undefined);

export function useCallModal() {
  const context = useContext(CallModalContext);
  if (!context) {
    throw new Error('useCallModal must be used within a CallModalProvider');
  }
  return context;
}

// ============================================
// Provider + Modal component
// ============================================

export function CallModalProvider({ children }: { children: ReactNode }) {
  const { state, dispatch } = useApp();

  const [showModal, setShowModal] = useState(false);
  const [prospectId, setProspectId] = useState('');
  const [callActive, setCallActive] = useState(false);
  const [callTimer, setCallTimer] = useState(0);
  const [callResult, setCallResult] = useState<CallResult>('repondu');
  const [callNotes, setCallNotes] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showMemo, setShowMemo] = useState(false);
  const [memoMessage, setMemoMessage] = useState('');
  const [memoDate, setMemoDate] = useState('');
  const [memoHeure, setMemoHeure] = useState('09:00');
  const [newTagName, setNewTagName] = useState('');
  const [showNewTag, setShowNewTag] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Timer logic
  useEffect(() => {
    if (callActive) {
      timerRef.current = setInterval(() => setCallTimer(prev => prev + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [callActive]);

  const startCall = (pid: string) => {
    const prospect = state.prospects.find(p => p.id === pid);
    if (!prospect) return;

    setProspectId(pid);
    setCallActive(true);
    setCallTimer(0);
    setCallResult('repondu');
    setCallNotes('');
    setSelectedTags([...prospect.tags]);
    setShowMemo(false);
    setMemoMessage('');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setMemoDate(tomorrow.toISOString().split('T')[0]);
    setMemoHeure('09:00');
    setShowNewTag(false);
    setNewTagName('');
    setShowModal(true);

    // Trigger native phone dialer
    if (prospect.telephone) {
      window.location.href = `tel:${prospect.telephone.replace(/\s/g, '')}`;
    }
  };

  const endCall = () => {
    setCallActive(false);
  };

  const toggleTag = (tagId: string) => {
    setSelectedTags(prev =>
      prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]
    );
  };

  const createAndAddTag = () => {
    if (!newTagName.trim()) return;
    const colors = ['#ef4444', '#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const newTag = { id: generateId('tag'), nom: newTagName.trim(), couleur: color };
    dispatch({ type: 'ADD_TAG', payload: newTag });
    setSelectedTags(prev => [...prev, newTag.id]);
    setNewTagName('');
    setShowNewTag(false);
  };

  const saveCall = () => {
    if (!prospectId) return;

    // 1. Save the call
    dispatch({
      type: 'ADD_CALL',
      payload: {
        id: generateId('call'),
        prospect_id: prospectId,
        commercial_id: state.currentUser?.id || 'com-1',
        date: new Date().toISOString(),
        duree: callTimer,
        resultat: callResult,
        notes: callNotes,
      },
    });

    // 2. Update prospect tags + auto-transition pipeline
    const prospect = state.prospects.find(p => p.id === prospectId);
    if (prospect) {
      const hasMemo = showMemo && memoMessage.trim() && memoDate;
      // Rule: "A contacter" → "Contacte" if call answered with memo
      const shouldAdvance = hasMemo && ['a_contacter', 'nouveau'].includes(prospect.etape_pipeline);
      dispatch({
        type: 'UPDATE_PROSPECT',
        payload: {
          ...prospect,
          tags: selectedTags,
          etape_pipeline: shouldAdvance ? 'contacte' : prospect.etape_pipeline,
          date_modification: new Date().toISOString(),
        },
      });
    }

    // 3. Create memo/reminder if filled
    if (showMemo && memoMessage.trim() && memoDate) {
      dispatch({
        type: 'ADD_REMINDER',
        payload: {
          id: generateId('rem'),
          prospect_id: prospectId,
          commercial_id: state.currentUser?.id || 'com-1',
          date: memoDate,
          heure: memoHeure,
          message: memoMessage.trim(),
          statut: 'actif',
        },
      });
    }

    setShowModal(false);
    setCallActive(false);
    setCallTimer(0);
  };

  const cancelCall = () => {
    if (callActive) {
      setCallActive(false);
    }
    setShowModal(false);
    setCallTimer(0);
  };

  const prospect = state.prospects.find(p => p.id === prospectId);

  const resultIcons: Record<CallResult, typeof CheckCircle> = {
    repondu: CheckCircle,
    pas_de_reponse: PhoneMissed,
    messagerie: MessageSquare,
    injoignable: PhoneOff,
  };

  const resultColors: Record<CallResult, string> = {
    repondu: 'border-green-500 bg-green-50 text-green-700',
    pas_de_reponse: 'border-red-500 bg-red-50 text-red-700',
    messagerie: 'border-amber-500 bg-amber-50 text-amber-700',
    injoignable: 'border-gray-500 bg-gray-100 text-gray-700',
  };

  return (
    <CallModalContext.Provider value={{ startCall }}>
      {children}

      {/* Global Call Modal */}
      {showModal && prospect && (
        <div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center" onClick={() => { if (!callActive) cancelCall(); }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900">
                  {callActive ? 'Appel en cours' : 'Enregistrer l\'appel'}
                </h3>
                <p className="text-sm text-gray-500 mt-0.5">{prospect.nom_etablissement}</p>
              </div>
              {!callActive && (
                <button className="p-1 rounded hover:bg-gray-100" onClick={cancelCall}>
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              )}
            </div>

            <div className="p-5 space-y-4">
              {/* Active call: timer */}
              {callActive && (
                <div className="text-center py-6">
                  <div className="w-20 h-20 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-4 animate-pulse">
                    <Phone className="w-8 h-8 text-green-600" />
                  </div>
                  <div className="text-4xl font-mono font-bold text-brewery-600">
                    {formatDurationTimer(callTimer)}
                  </div>
                  <p className="text-sm text-gray-500 mt-2">
                    {prospect.nom_contact && <span>{prospect.nom_contact} - </span>}
                    {prospect.telephone}
                  </p>
                  <button
                    className="mt-6 bg-red-500 text-white px-8 py-3 rounded-full hover:bg-red-600 flex items-center gap-2 mx-auto font-medium"
                    onClick={endCall}
                  >
                    <PhoneOff className="w-5 h-5" /> Raccrocher
                  </button>
                </div>
              )}

              {/* After call: result + tags + notes + memo */}
              {!callActive && (
                <>
                  {callTimer > 0 && (
                    <div className="text-center text-sm text-gray-500">
                      Duree de l'appel : <span className="font-mono font-bold text-gray-900">{formatDurationTimer(callTimer)}</span>
                    </div>
                  )}

                  {/* Call result */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-2">Resultat de l'appel</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(Object.keys(CALL_RESULT_LABELS) as CallResult[]).map(result => {
                        const Icon = resultIcons[result];
                        return (
                          <button
                            key={result}
                            className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium border-2 transition-colors ${
                              callResult === result
                                ? resultColors[result]
                                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                            }`}
                            onClick={() => setCallResult(result)}
                          >
                            <Icon className="w-4 h-4" />
                            {CALL_RESULT_LABELS[result]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Tags */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-2 flex items-center gap-1">
                      <Tag className="w-3 h-3" /> Tags du prospect
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {state.tags.map(tag => (
                        <button
                          key={tag.id}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${
                            selectedTags.includes(tag.id)
                              ? 'text-white shadow-sm'
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}
                          style={selectedTags.includes(tag.id) ? { backgroundColor: tag.couleur } : {}}
                          onClick={() => toggleTag(tag.id)}
                        >
                          {tag.nom}
                        </button>
                      ))}
                      {!showNewTag ? (
                        <button
                          className="px-2.5 py-1 rounded-full text-[11px] font-medium border border-dashed border-gray-300 text-gray-400 hover:border-brewery-400 hover:text-brewery-600 flex items-center gap-1"
                          onClick={() => setShowNewTag(true)}
                        >
                          <Plus className="w-3 h-3" /> Nouveau
                        </button>
                      ) : (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            className="px-2 py-0.5 border border-gray-300 rounded-full text-[11px] w-24 focus:ring-1 focus:ring-brewery-500"
                            placeholder="Nom du tag..."
                            value={newTagName}
                            onChange={e => setNewTagName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') createAndAddTag(); if (e.key === 'Escape') setShowNewTag(false); }}
                            autoFocus
                          />
                          <button
                            className="p-0.5 text-green-600 hover:text-green-700"
                            onClick={createAndAddTag}
                          >
                            <CheckCircle className="w-4 h-4" />
                          </button>
                          <button
                            className="p-0.5 text-gray-400 hover:text-gray-600"
                            onClick={() => setShowNewTag(false)}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Notes de l'appel</label>
                    <textarea
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm h-20 resize-none focus:ring-2 focus:ring-brewery-500"
                      placeholder="Qu'est-ce qui s'est passe pendant l'appel ?"
                      value={callNotes}
                      onChange={e => setCallNotes(e.target.value)}
                    />
                  </div>

                  {/* Memo / Rappel */}
                  {!showMemo ? (
                    <button
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-gray-300 text-gray-500 hover:border-brewery-400 hover:text-brewery-600 text-sm font-medium transition-colors"
                      onClick={() => setShowMemo(true)}
                    >
                      <Bell className="w-4 h-4" /> Ajouter un memo / rappel
                    </button>
                  ) : (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-amber-700 flex items-center gap-1">
                          <Bell className="w-3 h-3" /> Memo / Rappel
                        </label>
                        <button className="text-gray-400 hover:text-gray-600" onClick={() => setShowMemo(false)}>
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <input
                        type="text"
                        className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-amber-400"
                        placeholder="Ex: Rappeler pour confirmer le RDV..."
                        value={memoMessage}
                        onChange={e => setMemoMessage(e.target.value)}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="block text-[10px] text-amber-600 mb-0.5">Date</label>
                          <input
                            type="date"
                            className="w-full px-2 py-1.5 border border-amber-200 rounded-lg text-xs bg-white"
                            value={memoDate}
                            onChange={e => setMemoDate(e.target.value)}
                          />
                        </div>
                        <div className="w-24">
                          <label className="block text-[10px] text-amber-600 mb-0.5">Heure</label>
                          <input
                            type="time"
                            className="w-full px-2 py-1.5 border border-amber-200 rounded-lg text-xs bg-white"
                            value={memoHeure}
                            onChange={e => setMemoHeure(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            {!callActive && (
              <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
                <button
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                  onClick={cancelCall}
                >
                  Annuler
                </button>
                <button
                  className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2 font-medium"
                  onClick={saveCall}
                >
                  <Save className="w-4 h-4" /> Enregistrer
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </CallModalContext.Provider>
  );
}
