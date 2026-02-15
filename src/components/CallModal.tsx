import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { Phone, PhoneOff, X, Save, CheckCircle, MessageSquare, PhoneMissed, Tag, Bell, Clock, Plus, Calendar, AlertTriangle, Users, CalendarPlus, MapPin, ThumbsDown, Ban } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { CallResult, CALL_RESULT_LABELS } from '../types';
import { generateId, formatDurationTimer, detectConflicts, formatDate, downloadICS } from '../utils/helpers';

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
  // Negative outcome: pas_interesse → perdu, ne_pas_contacter → ne_pas_contacter
  const [negativeOutcome, setNegativeOutcome] = useState<'none' | 'pas_interesse' | 'ne_pas_contacter'>('none');
  // RDV state
  const [showRdv, setShowRdv] = useState(false);
  const [rdvDate, setRdvDate] = useState('');
  const [rdvHeureDebut, setRdvHeureDebut] = useState('10:00');
  const [rdvHeureFin, setRdvHeureFin] = useState('11:00');
  const [rdvLieu, setRdvLieu] = useState('');
  const [rdvNotes, setRdvNotes] = useState('');
  const [rdvCommercialId, setRdvCommercialId] = useState('');
  // Post-RDV confirmation
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [createdRdvId, setCreatedRdvId] = useState('');

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
    // Reset negative outcome + RDV
    setNegativeOutcome('none');
    setShowRdv(false);
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 3);
    setRdvDate(nextWeek.toISOString().split('T')[0]);
    setRdvHeureDebut('10:00');
    setRdvHeureFin('11:00');
    setRdvLieu(prospect.adresse ? `${prospect.adresse}, ${prospect.ville}` : '');
    setRdvNotes('');
    setRdvCommercialId(state.currentUser?.id || 'com-1');
    setShowConfirmation(false);
    setCreatedRdvId('');
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

  const removeTag = (tagId: string) => {
    setSelectedTags(prev => prev.filter(t => t !== tagId));
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
      const hasRdv = showRdv && rdvDate;

      let newStage = prospect.etape_pipeline;

      // Regle : Negative outcome → perdu ou ne_pas_contacter (priorite max)
      if (negativeOutcome === 'pas_interesse') {
        newStage = 'perdu';
      } else if (negativeOutcome === 'ne_pas_contacter') {
        newStage = 'ne_pas_contacter';
      }
      // Regle : RDV pris → "Gagne" (prioritaire)
      else if (hasRdv && !['gagne', 'perdu', 'ne_pas_contacter'].includes(prospect.etape_pipeline)) {
        newStage = 'gagne';
      }
      // Regle : memo → "Contacte" si encore en "A contacter" ou "Nouveau"
      else if (hasMemo && ['a_contacter', 'nouveau'].includes(prospect.etape_pipeline)) {
        newStage = 'contacte';
      }

      dispatch({
        type: 'UPDATE_PROSPECT',
        payload: {
          ...prospect,
          tags: selectedTags,
          etape_pipeline: newStage,
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

    // 4. Create RDV if filled
    if (showRdv && rdvDate) {
      const rdvId = generateId('rdv');
      dispatch({
        type: 'ADD_APPOINTMENT',
        payload: {
          id: rdvId,
          prospect_id: prospectId,
          commercial_id: rdvCommercialId || state.currentUser?.id || 'com-1',
          prospecteur_id: state.currentUser?.id || 'com-1',
          date: rdvDate,
          heure_debut: rdvHeureDebut,
          heure_fin: rdvHeureFin,
          lieu: rdvLieu,
          notes: rdvNotes,
          statut: 'planifie',
        },
      });
      // Show confirmation screen with agenda + export
      setCreatedRdvId(rdvId);
      setShowConfirmation(true);
      setCallActive(false);
      setCallTimer(0);
      return;
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

  // Tags non-selectionnes (pour le menu d'ajout)
  const availableTags = state.tags.filter(t => !selectedTags.includes(t.id));

  // Detection conflits RDV
  const rdvConflicts = showRdv && rdvCommercialId && rdvDate && rdvHeureDebut && rdvHeureFin
    ? detectConflicts(state.appointments, rdvCommercialId, rdvDate, rdvHeureDebut, rdvHeureFin)
    : [];

  return (
    <CallModalContext.Provider value={{ startCall }}>
      {children}

      {/* Global Call Modal */}
      {showModal && prospect && (
        <div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center" onClick={() => { if (!callActive) cancelCall(); }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {/* Header */}
            {!showConfirmation && (
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
            )}

            {!showConfirmation && <div className="p-5 space-y-4">
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

              {/* After call: result + tags + notes + rdv + memo */}
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

                  {/* Negative outcomes: pas interesse / ne pas contacter */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-2">Issue negative</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium border-2 transition-colors ${
                          negativeOutcome === 'pas_interesse'
                            ? 'border-red-500 bg-red-50 text-red-700'
                            : 'border-gray-200 text-gray-600 hover:bg-red-50 hover:border-red-300 hover:text-red-600'
                        }`}
                        onClick={() => setNegativeOutcome(prev => prev === 'pas_interesse' ? 'none' : 'pas_interesse')}
                      >
                        <ThumbsDown className="w-4 h-4" />
                        Pas interesse
                      </button>
                      <button
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium border-2 transition-colors ${
                          negativeOutcome === 'ne_pas_contacter'
                            ? 'border-red-700 bg-red-100 text-red-800'
                            : 'border-gray-200 text-gray-600 hover:bg-red-50 hover:border-red-300 hover:text-red-600'
                        }`}
                        onClick={() => setNegativeOutcome(prev => prev === 'ne_pas_contacter' ? 'none' : 'ne_pas_contacter')}
                      >
                        <Ban className="w-4 h-4" />
                        Ne pas contacter
                      </button>
                    </div>
                    {negativeOutcome === 'pas_interesse' && (
                      <p className="text-[10px] text-red-500 mt-1 italic">Le prospect sera deplace dans "Perdu"</p>
                    )}
                    {negativeOutcome === 'ne_pas_contacter' && (
                      <p className="text-[10px] text-red-600 mt-1 italic">Le prospect sera deplace dans "Ne pas contacter"</p>
                    )}
                  </div>

                  {/* Tags - tags actifs avec X + tags disponibles a ajouter */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-2 flex items-center gap-1">
                      <Tag className="w-3 h-3" /> Tags du prospect
                    </label>
                    {/* Tags actuellement selectionnes (avec bouton X) */}
                    {selectedTags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {selectedTags.map(tagId => {
                          const tag = state.tags.find(t => t.id === tagId);
                          if (!tag) return null;
                          return (
                            <span
                              key={tag.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium text-white shadow-sm"
                              style={{ backgroundColor: tag.couleur }}
                            >
                              {tag.nom}
                              <button
                                className="ml-0.5 hover:bg-white/30 rounded-full p-0.5"
                                onClick={() => removeTag(tag.id)}
                                title="Retirer ce tag"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {/* Tags disponibles a ajouter */}
                    <div className="flex flex-wrap gap-1.5">
                      {availableTags.map(tag => (
                        <button
                          key={tag.id}
                          className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center gap-1"
                          onClick={() => toggleTag(tag.id)}
                        >
                          <Plus className="w-3 h-3" /> {tag.nom}
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

                  {/* RDV */}
                  {!showRdv ? (
                    <button
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-blue-300 text-blue-500 hover:border-blue-500 hover:text-blue-700 hover:bg-blue-50 text-sm font-medium transition-colors"
                      onClick={() => setShowRdv(true)}
                    >
                      <Calendar className="w-4 h-4" /> Prendre un rendez-vous
                    </button>
                  ) : (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-blue-700 flex items-center gap-1">
                          <Calendar className="w-3 h-3" /> Rendez-vous
                        </label>
                        <button className="text-gray-400 hover:text-gray-600" onClick={() => setShowRdv(false)}>
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      {/* Prospecteur (celui qui prend le RDV) */}
                      <div className="bg-white/60 rounded-lg px-2 py-1.5">
                        <p className="text-[10px] text-blue-500 mb-0.5">Pris par (prospecteur)</p>
                        <p className="text-xs font-medium text-blue-800">
                          {state.currentUser?.prenom} {state.currentUser?.nom}
                        </p>
                      </div>
                      {/* Selecteur commercial assigne */}
                      <div>
                        <label className="block text-[10px] text-blue-600 mb-0.5 flex items-center gap-1">
                          <Users className="w-3 h-3" /> Commercial assigne au RDV
                        </label>
                        <select
                          className="w-full px-2 py-1.5 border border-blue-200 rounded-lg text-xs bg-white"
                          value={rdvCommercialId}
                          onChange={e => setRdvCommercialId(e.target.value)}
                        >
                          {state.commerciaux.map(c => (
                            <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="block text-[10px] text-blue-600 mb-0.5">Date *</label>
                          <input
                            type="date"
                            className="w-full px-2 py-1.5 border border-blue-200 rounded-lg text-xs bg-white"
                            value={rdvDate}
                            onChange={e => setRdvDate(e.target.value)}
                          />
                        </div>
                        <div className="w-20">
                          <label className="block text-[10px] text-blue-600 mb-0.5">Debut</label>
                          <input
                            type="time"
                            className="w-full px-2 py-1.5 border border-blue-200 rounded-lg text-xs bg-white"
                            value={rdvHeureDebut}
                            onChange={e => setRdvHeureDebut(e.target.value)}
                          />
                        </div>
                        <div className="w-20">
                          <label className="block text-[10px] text-blue-600 mb-0.5">Fin</label>
                          <input
                            type="time"
                            className="w-full px-2 py-1.5 border border-blue-200 rounded-lg text-xs bg-white"
                            value={rdvHeureFin}
                            onChange={e => setRdvHeureFin(e.target.value)}
                          />
                        </div>
                      </div>
                      {/* Alerte conflit horaire */}
                      {rdvConflicts.length > 0 && (
                        <div className="p-2 bg-red-50 border border-red-200 rounded-lg">
                          <p className="text-[11px] text-red-700 font-medium flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" /> Conflit horaire !
                          </p>
                          {rdvConflicts.map(c => {
                            const cp = state.prospects.find(p => p.id === c.prospect_id);
                            return (
                              <p key={c.id} className="text-[10px] text-red-600 mt-0.5">
                                {c.heure_debut}-{c.heure_fin} : {cp?.nom_etablissement || 'RDV'}
                              </p>
                            );
                          })}
                        </div>
                      )}
                      <input
                        type="text"
                        className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm bg-white"
                        placeholder="Lieu du RDV..."
                        value={rdvLieu}
                        onChange={e => setRdvLieu(e.target.value)}
                      />
                      <input
                        type="text"
                        className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm bg-white"
                        placeholder="Notes (optionnel)..."
                        value={rdvNotes}
                        onChange={e => setRdvNotes(e.target.value)}
                      />
                      <p className="text-[10px] text-blue-500 italic">
                        Le prospect sera automatiquement deplace dans "RDV / Gagne"
                      </p>
                    </div>
                  )}

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
            </div>}

            {/* Footer */}
            {!callActive && !showConfirmation && (
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

            {/* ========== CONFIRMATION POST-RDV ========== */}
            {showConfirmation && (() => {
              const createdRdv = state.appointments.find(a => a.id === createdRdvId);
              const rdvProspect = prospect;
              const rdvCommercial = state.commerciaux.find(c => c.id === (createdRdv?.commercial_id || rdvCommercialId));
              // Agenda du commercial pour la journee du RDV
              const dayRdvs = createdRdv ? state.appointments
                .filter(a => a.commercial_id === createdRdv.commercial_id && a.date === createdRdv.date && a.statut !== 'annule')
                .sort((a, b) => a.heure_debut.localeCompare(b.heure_debut)) : [];

              return (
                <div className="p-5 space-y-4">
                  {/* Success header */}
                  <div className="text-center">
                    <div className="w-14 h-14 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-3">
                      <CheckCircle className="w-7 h-7 text-green-600" />
                    </div>
                    <h3 className="font-bold text-gray-900">RDV cree avec succes !</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      {rdvProspect?.nom_etablissement} - {formatDate(createdRdv?.date || '')}
                    </p>
                  </div>

                  {/* RDV summary */}
                  {createdRdv && (
                    <div className="bg-blue-50 rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center gap-2 text-xs text-blue-700">
                        <Calendar className="w-3.5 h-3.5" />
                        <span className="font-medium">{formatDate(createdRdv.date)} de {createdRdv.heure_debut} a {createdRdv.heure_fin}</span>
                      </div>
                      {createdRdv.lieu && (
                        <div className="flex items-center gap-2 text-xs text-blue-600">
                          <MapPin className="w-3.5 h-3.5" />
                          {createdRdv.lieu}
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-xs text-blue-600">
                        <Users className="w-3.5 h-3.5" />
                        Commercial : {rdvCommercial?.prenom} {rdvCommercial?.nom}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-blue-500">
                        <Phone className="w-3.5 h-3.5" />
                        Pris par : {state.currentUser?.prenom} {state.currentUser?.nom}
                      </div>
                    </div>
                  )}

                  {/* Agenda du jour pour ce commercial */}
                  {dayRdvs.length > 1 && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-[10px] font-semibold text-gray-500 uppercase mb-2">
                        Agenda de {rdvCommercial?.prenom} le {formatDate(createdRdv?.date || '')}
                      </p>
                      <div className="space-y-1">
                        {dayRdvs.map(rdv => {
                          const p = state.prospects.find(pr => pr.id === rdv.prospect_id);
                          const isCurrent = rdv.id === createdRdvId;
                          return (
                            <div
                              key={rdv.id}
                              className={`flex items-center gap-2 text-xs py-1 px-2 rounded ${isCurrent ? 'bg-green-100 font-medium text-green-800' : 'text-gray-600'}`}
                            >
                              <span className="font-mono w-20 flex-shrink-0">{rdv.heure_debut}-{rdv.heure_fin}</span>
                              <span className="truncate">{p?.nom_etablissement || 'RDV'}</span>
                              {isCurrent && <span className="text-[9px] text-green-600 ml-auto">Nouveau</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    {createdRdv && rdvProspect && (
                      <button
                        className="flex-1 px-4 py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 font-medium"
                        onClick={() => downloadICS(createdRdv, rdvProspect)}
                      >
                        <CalendarPlus className="w-4 h-4" /> Ajouter a l'agenda
                      </button>
                    )}
                    <button
                      className="flex-1 px-4 py-2.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"
                      onClick={() => { setShowConfirmation(false); setShowModal(false); }}
                    >
                      Fermer
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </CallModalContext.Provider>
  );
}
