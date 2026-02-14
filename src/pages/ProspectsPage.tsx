import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search, Plus, Phone, Mail, MapPin, Tag, ChevronRight, X,
  Edit2, Trash2, Save, Clock, Calendar, MessageSquare, ArrowUpDown,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useCallModal } from '../components/CallModal';
import {
  ESTABLISHMENT_LABELS, PIPELINE_LABELS, PIPELINE_COLORS,
  EstablishmentType, PipelineStage, Prospect,
} from '../types';
import { generateId, formatDate, formatTimeAgo, formatDuration } from '../utils/helpers';

export default function ProspectsPage() {
  const { state, dispatch, getCallsForProspect, getAppointmentsForProspect, getRemindersForProspect } = useApp();
  const { startCall } = useCallModal();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');

  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<EstablishmentType | ''>('');
  const [filterStage, setFilterStage] = useState<PipelineStage | ''>('');
  const [showForm, setShowForm] = useState(false);
  const [editingProspect, setEditingProspect] = useState<Prospect | null>(null);
  const [filterSecteur, setFilterSecteur] = useState('');
  const [sortScore, setSortScore] = useState<'none' | 'asc' | 'desc'>('none');
  const [quickNoteId, setQuickNoteId] = useState<string | null>(null);
  const [quickNoteText, setQuickNoteText] = useState('');

  const openQuickNote = (prospect: Prospect, e: React.MouseEvent) => {
    e.stopPropagation();
    setQuickNoteId(prospect.id);
    setQuickNoteText(prospect.notes);
  };

  const saveQuickNote = () => {
    if (!quickNoteId) return;
    const prospect = state.prospects.find(p => p.id === quickNoteId);
    if (prospect) {
      dispatch({
        type: 'UPDATE_PROSPECT',
        payload: { ...prospect, notes: quickNoteText, date_modification: new Date().toISOString() },
      });
    }
    setQuickNoteId(null);
  };

  // Get unique sectors for filter
  const allSecteurs = [...new Set(state.prospects.map(p => p.secteur).filter(Boolean))].sort();

  const filteredProspects = useMemo(() => {
    const list = state.prospects.filter(p => {
      if (filterType && p.type_etablissement !== filterType) return false;
      if (filterStage && p.etape_pipeline !== filterStage) return false;
      if (filterSecteur && p.secteur !== filterSecteur) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return (
          p.nom_etablissement.toLowerCase().includes(term) ||
          p.nom_contact.toLowerCase().includes(term) ||
          p.ville.toLowerCase().includes(term) ||
          p.telephone.includes(term) ||
          (p.secteur || '').toLowerCase().includes(term)
        );
      }
      return true;
    });
    if (sortScore === 'desc') return list.sort((a, b) => b.score - a.score);
    if (sortScore === 'asc') return list.sort((a, b) => a.score - b.score);
    return list.sort((a, b) => new Date(b.date_modification).getTime() - new Date(a.date_modification).getTime());
  }, [state.prospects, filterType, filterStage, filterSecteur, searchTerm, sortScore]);

  const selectedProspect = selectedId ? state.prospects.find(p => p.id === selectedId) : null;
  const prospectCalls = selectedProspect ? getCallsForProspect(selectedProspect.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) : [];
  const prospectRdv = selectedProspect ? getAppointmentsForProspect(selectedProspect.id) : [];
  const prospectReminders = selectedProspect ? getRemindersForProspect(selectedProspect.id) : [];

  const [formData, setFormData] = useState<Partial<Prospect>>({});

  const openNewForm = () => {
    setFormData({
      nom_etablissement: '', type_etablissement: 'bar_restaurant', nom_contact: '',
      telephone: '', email: '', adresse: '', ville: '', code_postal: '', departement: '',
      secteur: '', latitude: 45.3, longitude: 4.27, etape_pipeline: 'nouveau', tags: [],
      commercial_id: state.currentUser?.id || 'com-1', notes: '', score: 50,
    });
    setEditingProspect(null);
    setShowForm(true);
  };

  const openEditForm = (prospect: Prospect) => {
    setFormData({ ...prospect });
    setEditingProspect(prospect);
    setShowForm(true);
  };

  const saveProspect = () => {
    if (!formData.nom_etablissement) return;
    const now = new Date().toISOString();
    if (editingProspect) {
      dispatch({
        type: 'UPDATE_PROSPECT',
        payload: { ...editingProspect, ...formData, date_modification: now } as Prospect,
      });
    } else {
      dispatch({
        type: 'ADD_PROSPECT',
        payload: {
          ...formData,
          id: generateId('p'),
          date_creation: now,
          date_modification: now,
        } as Prospect,
      });
    }
    setShowForm(false);
  };

  const deleteProspect = (id: string) => {
    if (confirm('Supprimer ce prospect ?')) {
      dispatch({ type: 'DELETE_PROSPECT', payload: id });
      setSearchParams({});
    }
  };

  return (
    <div className="h-full flex">
      {/* List panel */}
      <div className={`${selectedProspect ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-96 border-r border-gray-200 bg-white`}>
        {/* Search & filters */}
        <div className="p-4 space-y-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher..."
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brewery-500"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            <button
              className="bg-brewery-600 text-white p-2 rounded-lg hover:bg-brewery-700"
              onClick={openNewForm}
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
          <div className="flex gap-2 flex-wrap">
            <select
              className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2 py-1.5"
              value={filterType}
              onChange={e => setFilterType(e.target.value as EstablishmentType | '')}
            >
              <option value="">Tous types</option>
              {(Object.keys(ESTABLISHMENT_LABELS) as EstablishmentType[]).map(t => (
                <option key={t} value={t}>{ESTABLISHMENT_LABELS[t]}</option>
              ))}
            </select>
            <select
              className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2 py-1.5"
              value={filterStage}
              onChange={e => setFilterStage(e.target.value as PipelineStage | '')}
            >
              <option value="">Toutes etapes</option>
              {(Object.keys(PIPELINE_LABELS) as PipelineStage[]).map(s => (
                <option key={s} value={s}>{PIPELINE_LABELS[s]}</option>
              ))}
            </select>
            {allSecteurs.length > 0 && (
              <select
                className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2 py-1.5"
                value={filterSecteur}
                onChange={e => setFilterSecteur(e.target.value)}
              >
                <option value="">Tous secteurs</option>
                {allSecteurs.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-gray-400">{filteredProspects.length} prospect(s)</p>
            <button
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                sortScore !== 'none' ? 'bg-brewery-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              onClick={() => setSortScore(prev => prev === 'none' ? 'desc' : prev === 'desc' ? 'asc' : 'none')}
              title={sortScore === 'none' ? 'Trier par score' : sortScore === 'desc' ? 'Score decroissant' : 'Score croissant'}
            >
              <ArrowUpDown className="w-3 h-3" />
              Score {sortScore === 'desc' ? '↓' : sortScore === 'asc' ? '↑' : ''}
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {filteredProspects.map(p => (
            <div
              key={p.id}
              className={`w-full text-left p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer ${
                selectedId === p.id ? 'bg-brewery-50 border-l-4 border-l-brewery-500' : ''
              }`}
              onClick={() => setSearchParams({ id: p.id })}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm text-gray-900 truncate">{p.nom_etablissement}</h3>
                  <p className="text-[10px] text-gray-500">{p.nom_contact} - {ESTABLISHMENT_LABELS[p.type_etablissement]}</p>
                  <div className="flex items-center gap-1 mt-1 text-[10px] text-gray-400">
                    <MapPin className="w-3 h-3" /> {p.ville || p.adresse}{p.secteur ? ` - ${p.secteur}` : ''}
                  </div>
                  {p.notes && (
                    <p className="text-[10px] text-gray-500 mt-1 line-clamp-2 italic">{p.notes}</p>
                  )}
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span
                      className="text-[9px] text-white px-1.5 py-0.5 rounded-full font-medium"
                      style={{ backgroundColor: PIPELINE_COLORS[p.etape_pipeline] }}
                    >
                      {PIPELINE_LABELS[p.etape_pipeline]}
                    </span>
                    <span className="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full font-medium">
                      {p.score}pts
                    </span>
                    {p.tags.slice(0, 2).map(tagId => {
                      const tag = state.tags.find(t => t.id === tagId);
                      return tag ? (
                        <span key={tagId} className="text-[9px] text-white px-1.5 py-0.5 rounded-full" style={{ backgroundColor: tag.couleur }}>
                          {tag.nom}
                        </span>
                      ) : null;
                    })}
                  </div>
                </div>
                {/* Quick action buttons */}
                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  {p.telephone && (
                    <button
                      className="p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
                      onClick={e => { e.stopPropagation(); startCall(p.id); }}
                      title="Appeler"
                    >
                      <Phone className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    className="p-1.5 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors"
                    onClick={e => openQuickNote(p, e)}
                    title="Notes rapides"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail panel */}
      {selectedProspect ? (
        <div className="flex-1 overflow-y-auto bg-gray-50">
          <div className="p-6 space-y-6 fade-in">
            {/* Back button (mobile) */}
            <button
              className="lg:hidden flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
              onClick={() => setSearchParams({})}
            >
              <ChevronRight className="w-4 h-4 rotate-180" /> Retour
            </button>

            {/* Header */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{selectedProspect.nom_etablissement}</h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {ESTABLISHMENT_LABELS[selectedProspect.type_etablissement]} - {selectedProspect.ville}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200" onClick={() => openEditForm(selectedProspect)}>
                    <Edit2 className="w-4 h-4 text-gray-600" />
                  </button>
                  <button className="p-2 rounded-lg bg-red-50 hover:bg-red-100" onClick={() => deleteProspect(selectedProspect.id)}>
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-3">
                <span className="badge text-white" style={{ backgroundColor: PIPELINE_COLORS[selectedProspect.etape_pipeline] }}>
                  {PIPELINE_LABELS[selectedProspect.etape_pipeline]}
                </span>
                <span className="badge bg-gray-100 text-gray-600">Score: {selectedProspect.score}</span>
                {selectedProspect.tags.map(tagId => {
                  const tag = state.tags.find(t => t.id === tagId);
                  return tag ? (
                    <span key={tagId} className="badge text-white" style={{ backgroundColor: tag.couleur }}>
                      {tag.nom}
                    </span>
                  ) : null;
                })}
              </div>

              {/* Contact info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="w-4 h-4 text-gray-400" />
                  <button onClick={() => startCall(selectedProspect.id)} className="text-brewery-600 font-medium hover:underline">
                    {selectedProspect.telephone}
                  </button>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="w-4 h-4 text-gray-400" />
                  <a href={`mailto:${selectedProspect.email}`} className="text-brewery-600 hover:underline">
                    {selectedProspect.email}
                  </a>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-600">{selectedProspect.adresse}, {selectedProspect.code_postal} {selectedProspect.ville}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Tag className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-600">
                    {selectedProspect.secteur ? `Secteur: ${selectedProspect.secteur}` : selectedProspect.departement}
                  </span>
                </div>
              </div>

              {selectedProspect.notes && (
                <div className="mt-4 p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
                  {selectedProspect.notes}
                </div>
              )}

              <div className="mt-3 text-[10px] text-gray-400">
                Cree le {formatDate(selectedProspect.date_creation)} - Modifie {formatTimeAgo(selectedProspect.date_modification)}
              </div>
            </div>

            {/* Call history */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Phone className="w-4 h-4" /> Historique des appels ({prospectCalls.length})
              </h3>
              {prospectCalls.length > 0 ? (
                <div className="space-y-2">
                  {prospectCalls.map(call => {
                    const commercial = state.commerciaux.find(c => c.id === call.commercial_id);
                    return (
                      <div key={call.id} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 text-sm">
                        <div className={`w-2 h-2 rounded-full ${call.resultat === 'repondu' ? 'bg-green-500' : call.resultat === 'messagerie' ? 'bg-amber-500' : 'bg-red-500'}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-600">{call.notes || 'Aucune note'}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {formatTimeAgo(call.date)} par {commercial?.prenom} - {formatDuration(call.duree)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-400">Aucun appel enregistre</p>
              )}
            </div>

            {/* Appointments */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Rendez-vous ({prospectRdv.length})
              </h3>
              {prospectRdv.length > 0 ? (
                <div className="space-y-2">
                  {prospectRdv.map(rdv => (
                    <div key={rdv.id} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 text-sm">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      <div className="flex-1">
                        <p className="text-xs font-medium text-gray-700">{formatDate(rdv.date)} {rdv.heure_debut}-{rdv.heure_fin}</p>
                        <p className="text-[10px] text-gray-500">{rdv.lieu}</p>
                      </div>
                      <span className={`badge text-[10px] ${rdv.statut === 'confirme' ? 'bg-green-100 text-green-700' : rdv.statut === 'termine' ? 'bg-gray-100 text-gray-600' : 'bg-amber-100 text-amber-700'}`}>
                        {rdv.statut}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">Aucun RDV</p>
              )}
            </div>

            {/* Reminders */}
            {prospectReminders.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Rappels ({prospectReminders.length})
                </h3>
                <div className="space-y-2">
                  {prospectReminders.map(rem => (
                    <div key={rem.id} className="flex items-center gap-3 p-2 rounded-lg bg-amber-50 text-sm">
                      <Clock className="w-4 h-4 text-amber-500" />
                      <div className="flex-1">
                        <p className="text-xs text-gray-700">{rem.message}</p>
                        <p className="text-[10px] text-gray-500">{formatDate(rem.date)} a {rem.heure}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="hidden lg:flex flex-1 items-center justify-center bg-gray-50">
          <div className="text-center text-gray-400">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Selectionnez un prospect pour voir ses details</p>
          </div>
        </div>
      )}

      {/* Quick notes modal */}
      {quickNoteId && (
        <div className="modal-backdrop" onClick={() => setQuickNoteId(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-amber-500" />
                Notes rapides - {state.prospects.find(p => p.id === quickNoteId)?.nom_etablissement}
              </h3>
              <button className="p-1 rounded hover:bg-gray-100" onClick={() => setQuickNoteId(null)}>
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-4">
              <textarea
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm h-32 resize-none focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
                placeholder="Ajoutez vos notes ici..."
                value={quickNoteText}
                onChange={e => setQuickNoteText(e.target.value)}
                autoFocus
              />
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
              <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setQuickNoteId(null)}>
                Annuler
              </button>
              <button
                className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2"
                onClick={saveQuickNote}
              >
                <Save className="w-4 h-4" /> Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prospect form modal */}
      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">{editingProspect ? 'Modifier le prospect' : 'Nouveau prospect'}</h3>
              <button className="p-1 rounded hover:bg-gray-100" onClick={() => setShowForm(false)}>
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nom de l'etablissement *</label>
                <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.nom_etablissement || ''} onChange={e => setFormData(prev => ({ ...prev, nom_etablissement: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                  <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.type_etablissement || 'bar_restaurant'} onChange={e => setFormData(prev => ({ ...prev, type_etablissement: e.target.value as EstablishmentType }))}>
                    {(Object.keys(ESTABLISHMENT_LABELS) as EstablishmentType[]).map(t => (
                      <option key={t} value={t}>{ESTABLISHMENT_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Etape</label>
                  <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.etape_pipeline || 'nouveau'} onChange={e => setFormData(prev => ({ ...prev, etape_pipeline: e.target.value as PipelineStage }))}>
                    {(Object.keys(PIPELINE_LABELS) as PipelineStage[]).map(s => (
                      <option key={s} value={s}>{PIPELINE_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nom du contact</label>
                <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.nom_contact || ''} onChange={e => setFormData(prev => ({ ...prev, nom_contact: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Telephone</label>
                  <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.telephone || ''} onChange={e => setFormData(prev => ({ ...prev, telephone: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                  <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.email || ''} onChange={e => setFormData(prev => ({ ...prev, email: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Adresse</label>
                <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.adresse || ''} onChange={e => setFormData(prev => ({ ...prev, adresse: e.target.value }))} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Code postal</label>
                  <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.code_postal || ''} onChange={e => setFormData(prev => ({ ...prev, code_postal: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Ville</label>
                  <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.ville || ''} onChange={e => setFormData(prev => ({ ...prev, ville: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Departement</label>
                  <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.departement || ''} onChange={e => setFormData(prev => ({ ...prev, departement: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Secteur</label>
                <input
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={formData.secteur || ''}
                  onChange={e => setFormData(prev => ({ ...prev, secteur: e.target.value }))}
                  placeholder="Ex: Loire, Haute-Loire..."
                  list="form-secteurs-list"
                />
                {allSecteurs.length > 0 && (
                  <datalist id="form-secteurs-list">
                    {allSecteurs.map(s => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tags</label>
                <div className="flex flex-wrap gap-1.5">
                  {state.tags.map(tag => (
                    <button
                      key={tag.id}
                      className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors ${
                        (formData.tags || []).includes(tag.id) ? 'text-white' : 'bg-gray-100 text-gray-600'
                      }`}
                      style={(formData.tags || []).includes(tag.id) ? { backgroundColor: tag.couleur } : {}}
                      onClick={() => {
                        const tags = formData.tags || [];
                        setFormData(prev => ({
                          ...prev,
                          tags: tags.includes(tag.id) ? tags.filter(t => t !== tag.id) : [...tags, tag.id],
                        }));
                      }}
                    >
                      {tag.nom}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm h-20 resize-none" value={formData.notes || ''} onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Score (0-100)</label>
                <input type="number" min="0" max="100" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.score || 50} onChange={e => setFormData(prev => ({ ...prev, score: parseInt(e.target.value) || 0 }))} />
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
              <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setShowForm(false)}>Annuler</button>
              <button className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2" onClick={saveProspect}>
                <Save className="w-4 h-4" /> {editingProspect ? 'Modifier' : 'Creer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Users(props: any) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}
