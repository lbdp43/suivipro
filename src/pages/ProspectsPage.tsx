import { useState, useMemo, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search, Plus, Phone, Mail, MapPin, Tag, ChevronRight, X, Navigation,
  Edit2, Trash2, Save, Clock, Calendar, MessageSquare, ArrowUpDown,
  CheckSquare, Square, XCircle, Settings, ChevronDown, Check, Filter,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useCallModal } from '../components/CallModal';
import EmailTemplateModal from '../components/EmailTemplateModal';
import {
  ESTABLISHMENT_LABELS, PIPELINE_LABELS, PIPELINE_COLORS,
  EstablishmentType, PipelineStage, Prospect, Tag as TagType,
} from '../types';
import { generateId, formatDate, formatTimeAgo, formatDuration, geocodeAddress } from '../utils/helpers';

// Multi-select dropdown component
function MultiSelectDropdown({ label, options, selected, onToggle, color }: {
  label: string;
  options: { value: string; label: string; color?: string }[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  color: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const count = selected.size;
  const colorMap: Record<string, { btn: string; active: string }> = {
    brewery: { btn: 'border-brewery-300 text-brewery-700 bg-brewery-50', active: 'bg-brewery-600 text-white border-brewery-600' },
    blue: { btn: 'border-blue-300 text-blue-700 bg-blue-50', active: 'bg-blue-600 text-white border-blue-600' },
    amber: { btn: 'border-amber-300 text-amber-700 bg-amber-50', active: 'bg-amber-500 text-white border-amber-500' },
  };
  const c = colorMap[color] || colorMap.brewery;

  return (
    <div className="relative" ref={ref}>
      <button
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
          count > 0 ? c.active : 'border-gray-200 text-gray-600 bg-white hover:bg-gray-50'
        }`}
        onClick={() => setOpen(!open)}
      >
        <Filter className="w-3 h-3" />
        {label}
        {count > 0 && <span className="bg-white/30 rounded-full px-1 text-[10px]">{count}</span>}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[200px] max-h-64 overflow-y-auto">
          {/* Select/Deselect all */}
          <div className="sticky top-0 bg-white border-b border-gray-100 px-3 py-2 flex items-center justify-between">
            <span className="text-[10px] text-gray-400">{count}/{options.length} selectionne(s)</span>
            <button
              className="text-[10px] text-brewery-600 hover:text-brewery-800 font-medium"
              onClick={() => {
                if (count === options.length) {
                  options.forEach(o => { if (selected.has(o.value)) onToggle(o.value); });
                } else {
                  options.forEach(o => { if (!selected.has(o.value)) onToggle(o.value); });
                }
              }}
            >
              {count === options.length ? 'Tout deselect.' : 'Tout select.'}
            </button>
          </div>

          {options.map(option => (
            <button
              key={option.value}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs hover:bg-gray-50 transition-colors ${
                selected.has(option.value) ? 'bg-gray-50 font-medium' : ''
              }`}
              onClick={() => onToggle(option.value)}
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                selected.has(option.value) ? 'bg-brewery-600 border-brewery-600' : 'border-gray-300'
              }`}>
                {selected.has(option.value) && <Check className="w-3 h-3 text-white" />}
              </div>
              {option.color && (
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: option.color }} />
              )}
              <span className="truncate text-gray-700">{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProspectsPage() {
  const { state, dispatch, getCallsForProspect, getAppointmentsForProspect, getRemindersForProspect } = useApp();
  const { startCall } = useCallModal();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');

  const [searchTerm, setSearchTerm] = useState('');
  const [filterTypes, setFilterTypes] = useState<Set<EstablishmentType>>(new Set());
  const [filterStages, setFilterStages] = useState<Set<PipelineStage>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editingProspect, setEditingProspect] = useState<Prospect | null>(null);
  const [filterSecteurs, setFilterSecteurs] = useState<Set<string>>(new Set());
  const [sortScore, setSortScore] = useState<'none' | 'asc' | 'desc'>('none');
  const [sortDate, setSortDate] = useState<'none' | 'recent' | 'ancien'>('none');
  const [quickNoteId, setQuickNoteId] = useState<string | null>(null);
  const [quickNoteText, setQuickNoteText] = useState('');
  const [emailProspect, setEmailProspect] = useState<Prospect | null>(null);

  // Tag management in form
  const [showTagManager, setShowTagManager] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#6366f1');
  const [editingTag, setEditingTag] = useState<TagType | null>(null);

  const TAG_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#64748b'];

  const saveNewTag = () => {
    if (!newTagName.trim()) return;
    if (editingTag) {
      dispatch({ type: 'UPDATE_TAG', payload: { ...editingTag, nom: newTagName.trim(), couleur: newTagColor } });
      setEditingTag(null);
    } else {
      dispatch({ type: 'ADD_TAG', payload: { id: generateId('tag'), nom: newTagName.trim(), couleur: newTagColor } });
    }
    setNewTagName('');
    setNewTagColor('#6366f1');
  };

  const deleteTag = (tagId: string) => {
    if (!confirm('Supprimer ce tag ? Il sera retire de tous les prospects.')) return;
    dispatch({ type: 'DELETE_TAG', payload: tagId });
    // Remove tag from current form data if selected
    setFormData(prev => ({ ...prev, tags: (prev.tags || []).filter(t => t !== tagId) }));
  };

  const startEditTag = (tag: TagType) => {
    setEditingTag(tag);
    setNewTagName(tag.nom);
    setNewTagColor(tag.couleur);
    setShowTagManager(true);
  };

  // Multi-selection mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkAction, setShowBulkAction] = useState<'none' | 'etape' | 'secteur' | 'tags'>('none');
  const [bulkSecteur, setBulkSecteur] = useState('');

  const toggleSelection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(filteredProspects.map(p => p.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setShowBulkAction('none');
  };

  const bulkChangeStage = (stage: PipelineStage) => {
    const now = new Date().toISOString();
    selectedIds.forEach(id => {
      const prospect = state.prospects.find(p => p.id === id);
      if (prospect) {
        dispatch({ type: 'UPDATE_PROSPECT', payload: { ...prospect, etape_pipeline: stage, date_modification: now } });
      }
    });
    setShowBulkAction('none');
    exitSelectionMode();
  };

  const bulkChangeSecteur = () => {
    if (!bulkSecteur.trim()) return;
    const now = new Date().toISOString();
    selectedIds.forEach(id => {
      const prospect = state.prospects.find(p => p.id === id);
      if (prospect) {
        dispatch({ type: 'UPDATE_PROSPECT', payload: { ...prospect, secteur: bulkSecteur.trim(), date_modification: now } });
      }
    });
    setBulkSecteur('');
    setShowBulkAction('none');
    exitSelectionMode();
  };

  const bulkToggleTag = (tagId: string) => {
    const now = new Date().toISOString();
    // If all selected prospects have this tag, remove it. Otherwise, add it.
    const allHaveTag = [...selectedIds].every(id => {
      const p = state.prospects.find(pr => pr.id === id);
      return p?.tags.includes(tagId);
    });
    selectedIds.forEach(id => {
      const prospect = state.prospects.find(p => p.id === id);
      if (prospect) {
        const newTags = allHaveTag
          ? prospect.tags.filter(t => t !== tagId)
          : prospect.tags.includes(tagId) ? prospect.tags : [...prospect.tags, tagId];
        dispatch({ type: 'UPDATE_PROSPECT', payload: { ...prospect, tags: newTags, date_modification: now } });
      }
    });
  };

  const bulkDelete = () => {
    if (!confirm(`Supprimer ${selectedIds.size} prospect(s) ?`)) return;
    selectedIds.forEach(id => {
      dispatch({ type: 'DELETE_PROSPECT', payload: id });
    });
    exitSelectionMode();
  };

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

  const toggleFilter = <T,>(set: Set<T>, value: T, setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    setter(next);
  };

  const hasActiveFilters = filterTypes.size > 0 || filterStages.size > 0 || filterSecteurs.size > 0;
  const clearAllFilters = () => {
    setFilterTypes(new Set());
    setFilterStages(new Set());
    setFilterSecteurs(new Set());
  };

  const filteredProspects = useMemo(() => {
    const list = state.prospects.filter(p => {
      if (filterTypes.size > 0 && !filterTypes.has(p.type_etablissement)) return false;
      if (filterStages.size > 0 && !filterStages.has(p.etape_pipeline)) return false;
      if (filterSecteurs.size > 0 && !filterSecteurs.has(p.secteur)) return false;
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
    if (sortDate === 'recent') return list.sort((a, b) => new Date(b.date_creation).getTime() - new Date(a.date_creation).getTime());
    if (sortDate === 'ancien') return list.sort((a, b) => new Date(a.date_creation).getTime() - new Date(b.date_creation).getTime());
    return list.sort((a, b) => new Date(b.date_modification).getTime() - new Date(a.date_modification).getTime());
  }, [state.prospects, filterTypes, filterStages, filterSecteurs, searchTerm, sortScore, sortDate]);

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

  const [saving, setSaving] = useState(false);

  const saveProspect = async () => {
    if (!formData.nom_etablissement) return;
    setSaving(true);
    const now = new Date().toISOString();

    // Geocode address if provided
    let geoData = {
      latitude: formData.latitude || 0,
      longitude: formData.longitude || 0,
      ville: formData.ville || '',
      code_postal: formData.code_postal || '',
      departement: formData.departement || '',
    };

    const fullAddress = [formData.adresse, formData.code_postal, formData.ville].filter(Boolean).join(' ');
    if (fullAddress.trim()) {
      const geo = await geocodeAddress(fullAddress);
      if (geo) {
        geoData = {
          latitude: geo.latitude,
          longitude: geo.longitude,
          ville: geo.ville || formData.ville || '',
          code_postal: geo.code_postal || formData.code_postal || '',
          departement: geo.departement || formData.departement || '',
        };
      }
    }

    if (editingProspect) {
      dispatch({
        type: 'UPDATE_PROSPECT',
        payload: { ...editingProspect, ...formData, ...geoData, date_modification: now } as Prospect,
      });
    } else {
      dispatch({
        type: 'ADD_PROSPECT',
        payload: {
          ...formData,
          ...geoData,
          id: generateId('p'),
          date_creation: now,
          date_modification: now,
        } as Prospect,
      });
    }
    setSaving(false);
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
              className={`p-2 rounded-lg transition-colors ${
                selectionMode
                  ? 'bg-brewery-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}
              title={selectionMode ? 'Quitter la selection' : 'Selection multiple'}
            >
              <CheckSquare className="w-5 h-5" />
            </button>
            <button
              className="bg-brewery-600 text-white p-2 rounded-lg hover:bg-brewery-700"
              onClick={openNewForm}
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
          {/* Multi-select dropdown filters */}
          <div className="flex gap-2 flex-wrap">
            <MultiSelectDropdown
              label="Type"
              options={(Object.keys(ESTABLISHMENT_LABELS) as EstablishmentType[]).map(t => ({
                value: t, label: ESTABLISHMENT_LABELS[t],
              }))}
              selected={filterTypes}
              onToggle={v => toggleFilter(filterTypes, v as EstablishmentType, setFilterTypes)}
              color="brewery"
            />
            <MultiSelectDropdown
              label="Etape"
              options={state.pipelineColumns.map(col => ({
                value: col.id, label: col.label, color: col.color,
              }))}
              selected={filterStages}
              onToggle={v => toggleFilter(filterStages, v as PipelineStage, setFilterStages)}
              color="blue"
            />
            {allSecteurs.length > 0 && (
              <MultiSelectDropdown
                label="Secteur"
                options={allSecteurs.map(s => ({ value: s, label: s }))}
                selected={filterSecteurs}
                onToggle={v => toggleFilter(filterSecteurs, v, setFilterSecteurs)}
                color="amber"
              />
            )}
            {hasActiveFilters && (
              <button
                className="px-2 py-1.5 text-[10px] text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg font-medium flex items-center gap-1"
                onClick={clearAllFilters}
              >
                <X className="w-3 h-3" /> Effacer filtres
              </button>
            )}
          </div>

          {/* Active filter chips */}
          {hasActiveFilters && (
            <div className="flex gap-1 flex-wrap">
              {[...filterTypes].map(t => (
                <span key={t} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-brewery-100 text-brewery-700">
                  {ESTABLISHMENT_LABELS[t]}
                  <button className="hover:text-brewery-900" onClick={() => toggleFilter(filterTypes, t, setFilterTypes)}><X className="w-2.5 h-2.5" /></button>
                </span>
              ))}
              {[...filterStages].map(s => (
                <span key={s} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium text-white" style={{ backgroundColor: PIPELINE_COLORS[s] || '#6b7280' }}>
                  {state.pipelineColumns.find(c => c.id === s)?.label || PIPELINE_LABELS[s] || s}
                  <button className="hover:text-gray-200" onClick={() => toggleFilter(filterStages, s, setFilterStages)}><X className="w-2.5 h-2.5" /></button>
                </span>
              ))}
              {[...filterSecteurs].map(s => (
                <span key={s} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700">
                  {s}
                  <button className="hover:text-amber-900" onClick={() => toggleFilter(filterSecteurs, s, setFilterSecteurs)}><X className="w-2.5 h-2.5" /></button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-gray-400">{filteredProspects.length} prospect(s)</p>
            <div className="flex items-center gap-1.5">
              <button
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                  sortDate !== 'none' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                onClick={() => {
                  setSortDate(prev => prev === 'none' ? 'recent' : prev === 'recent' ? 'ancien' : 'none');
                  if (sortDate === 'none') setSortScore('none');
                }}
                title={sortDate === 'none' ? 'Trier par date' : sortDate === 'recent' ? 'Plus recent d\'abord' : 'Plus ancien d\'abord'}
              >
                <Calendar className="w-3 h-3" />
                Date {sortDate === 'recent' ? '↓' : sortDate === 'ancien' ? '↑' : ''}
              </button>
              <button
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                  sortScore !== 'none' ? 'bg-brewery-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                onClick={() => {
                  setSortScore(prev => prev === 'none' ? 'desc' : prev === 'desc' ? 'asc' : 'none');
                  if (sortScore === 'none') setSortDate('none');
                }}
                title={sortScore === 'none' ? 'Trier par score' : sortScore === 'desc' ? 'Score decroissant' : 'Score croissant'}
              >
                <ArrowUpDown className="w-3 h-3" />
                Score {sortScore === 'desc' ? '↓' : sortScore === 'asc' ? '↑' : ''}
              </button>
            </div>
          </div>
        </div>

        {/* Selection mode toolbar */}
        {selectionMode && (
          <div className="px-4 py-2 bg-brewery-50 border-b border-brewery-200 flex items-center gap-2">
            <button
              className="text-[10px] font-medium text-brewery-700 hover:text-brewery-900 underline"
              onClick={selectedIds.size === filteredProspects.length ? deselectAll : selectAll}
            >
              {selectedIds.size === filteredProspects.length ? 'Tout deselectionner' : 'Tout selectionner'}
            </button>
            <span className="text-[10px] text-brewery-600 ml-auto">
              {selectedIds.size} selectionne(s)
            </span>
            <button
              className="p-1 text-gray-400 hover:text-gray-600"
              onClick={exitSelectionMode}
              title="Quitter la selection"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {filteredProspects.map(p => (
            <div
              key={p.id}
              className={`w-full text-left p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer ${
                selectedId === p.id && !selectionMode ? 'bg-brewery-50 border-l-4 border-l-brewery-500' : ''
              } ${selectionMode && selectedIds.has(p.id) ? 'bg-brewery-50' : ''}`}
              onClick={selectionMode ? (e) => toggleSelection(p.id, e) : () => setSearchParams({ id: p.id })}
            >
              <div className="flex items-start gap-3">
                {selectionMode && (
                  <div className="flex-shrink-0 mt-0.5">
                    {selectedIds.has(p.id) ? (
                      <CheckSquare className="w-5 h-5 text-brewery-600" />
                    ) : (
                      <Square className="w-5 h-5 text-gray-300" />
                    )}
                  </div>
                )}
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
                  {p.email && (
                    <button
                      className="p-1.5 rounded-lg bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors"
                      onClick={e => { e.stopPropagation(); setEmailProspect(p); }}
                      title="Envoyer un e-mail"
                    >
                      <Mail className="w-3.5 h-3.5" />
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

        {/* Bulk action bar */}
        {selectionMode && selectedIds.size > 0 && (
          <div className="border-t border-gray-200 bg-white p-3 space-y-2">
            {showBulkAction === 'none' && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  className="flex-1 px-3 py-2 text-[11px] font-medium bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors"
                  onClick={() => setShowBulkAction('etape')}
                >
                  Changer etape
                </button>
                <button
                  className="flex-1 px-3 py-2 text-[11px] font-medium bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors"
                  onClick={() => setShowBulkAction('secteur')}
                >
                  Changer secteur
                </button>
                <button
                  className="flex-1 px-3 py-2 text-[11px] font-medium bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 transition-colors"
                  onClick={() => setShowBulkAction('tags')}
                >
                  Gerer tags
                </button>
                <button
                  className="px-3 py-2 text-[11px] font-medium bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
                  onClick={bulkDelete}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Change stage */}
            {showBulkAction === 'etape' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-medium text-gray-700">Changer etape ({selectedIds.size} prospects)</p>
                  <button className="text-gray-400 hover:text-gray-600" onClick={() => setShowBulkAction('none')}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(PIPELINE_LABELS) as PipelineStage[]).map(stage => (
                    <button
                      key={stage}
                      className="px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-white transition-opacity hover:opacity-80"
                      style={{ backgroundColor: PIPELINE_COLORS[stage] }}
                      onClick={() => bulkChangeStage(stage)}
                    >
                      {PIPELINE_LABELS[stage]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Change sector */}
            {showBulkAction === 'secteur' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-medium text-gray-700">Changer secteur ({selectedIds.size} prospects)</p>
                  <button className="text-gray-400 hover:text-gray-600" onClick={() => setShowBulkAction('none')}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-brewery-500"
                    placeholder="Nouveau secteur..."
                    value={bulkSecteur}
                    onChange={e => setBulkSecteur(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') bulkChangeSecteur(); }}
                    list="bulk-secteurs-list"
                    autoFocus
                  />
                  {allSecteurs.length > 0 && (
                    <datalist id="bulk-secteurs-list">
                      {allSecteurs.map(s => <option key={s} value={s} />)}
                    </datalist>
                  )}
                  <button
                    className="px-3 py-1.5 bg-brewery-600 text-white rounded-lg text-xs font-medium hover:bg-brewery-700"
                    onClick={bulkChangeSecteur}
                  >
                    OK
                  </button>
                </div>
              </div>
            )}

            {/* Manage tags */}
            {showBulkAction === 'tags' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-medium text-gray-700">Gerer tags ({selectedIds.size} prospects)</p>
                  <button className="text-gray-400 hover:text-gray-600" onClick={() => setShowBulkAction('none')}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {state.tags.map(tag => {
                    const allHave = [...selectedIds].every(id => {
                      const p = state.prospects.find(pr => pr.id === id);
                      return p?.tags.includes(tag.id);
                    });
                    const someHave = [...selectedIds].some(id => {
                      const p = state.prospects.find(pr => pr.id === id);
                      return p?.tags.includes(tag.id);
                    });
                    return (
                      <button
                        key={tag.id}
                        className={`px-2.5 py-1.5 rounded-full text-[10px] font-medium transition-colors border-2 ${
                          allHave
                            ? 'text-white border-transparent'
                            : someHave
                            ? 'border-current opacity-70'
                            : 'bg-gray-100 text-gray-500 border-transparent hover:bg-gray-200'
                        }`}
                        style={allHave ? { backgroundColor: tag.couleur } : someHave ? { color: tag.couleur } : {}}
                        onClick={() => bulkToggleTag(tag.id)}
                        title={allHave ? `Retirer "${tag.nom}" de tous` : `Ajouter "${tag.nom}" a tous`}
                      >
                        {allHave ? '✓ ' : someHave ? '~ ' : '+ '}{tag.nom}
                      </button>
                    );
                  })}
                </div>
                <button
                  className="w-full px-3 py-1.5 text-[11px] font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
                  onClick={() => setShowBulkAction('none')}
                >
                  Termine
                </button>
              </div>
            )}
          </div>
        )}
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
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selectedProspect.adresse} ${selectedProspect.code_postal} ${selectedProspect.ville}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brewery-600 hover:underline flex items-center gap-1"
                  >
                    {selectedProspect.adresse}, {selectedProspect.code_postal} {selectedProspect.ville}
                    <Navigation className="w-3 h-3" />
                  </a>
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

      {/* Email template modal */}
      {emailProspect && (
        <EmailTemplateModal prospect={emailProspect} onClose={() => setEmailProspect(null)} />
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
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-gray-600">Tags</label>
                  <button
                    type="button"
                    className="text-[10px] text-brewery-600 hover:text-brewery-800 font-medium flex items-center gap-0.5"
                    onClick={() => { setShowTagManager(!showTagManager); setEditingTag(null); setNewTagName(''); }}
                  >
                    <Settings className="w-3 h-3" /> Gerer les tags
                  </button>
                </div>

                {/* Tag selection */}
                <div className="flex flex-wrap gap-1.5">
                  {state.tags.map(tag => (
                    <button
                      key={tag.id}
                      type="button"
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
                  {state.tags.length === 0 && (
                    <p className="text-[10px] text-gray-400">Aucun tag. Cliquez "Gerer les tags" pour en creer.</p>
                  )}
                </div>

                {/* Tag manager panel */}
                {showTagManager && (
                  <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                    <p className="text-[11px] font-semibold text-gray-700">{editingTag ? 'Modifier le tag' : 'Creer un nouveau tag'}</p>

                    {/* New/Edit tag form */}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Nom du tag..."
                        className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs"
                        value={newTagName}
                        onChange={e => setNewTagName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && saveNewTag()}
                      />
                      <button
                        type="button"
                        className="px-3 py-1.5 bg-brewery-600 text-white text-xs rounded-lg hover:bg-brewery-700 disabled:opacity-50"
                        onClick={saveNewTag}
                        disabled={!newTagName.trim()}
                      >
                        {editingTag ? 'Modifier' : 'Creer'}
                      </button>
                      {editingTag && (
                        <button
                          type="button"
                          className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                          onClick={() => { setEditingTag(null); setNewTagName(''); setNewTagColor('#6366f1'); }}
                        >
                          Annuler
                        </button>
                      )}
                    </div>

                    {/* Color picker */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-gray-500">Couleur:</span>
                      {TAG_COLORS.map(color => (
                        <button
                          key={color}
                          type="button"
                          className={`w-5 h-5 rounded-full border-2 transition-transform ${
                            newTagColor === color ? 'border-gray-800 scale-125' : 'border-transparent hover:scale-110'
                          }`}
                          style={{ backgroundColor: color }}
                          onClick={() => setNewTagColor(color)}
                        />
                      ))}
                    </div>

                    {/* Existing tags list with edit/delete */}
                    {state.tags.length > 0 && (
                      <div>
                        <p className="text-[10px] text-gray-500 mb-1.5">Tags existants :</p>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {state.tags.map(tag => (
                            <div key={tag.id} className="flex items-center justify-between py-1 px-2 rounded bg-white">
                              <div className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tag.couleur }} />
                                <span className="text-xs text-gray-700">{tag.nom}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                                  onClick={() => startEditTag(tag)}
                                  title="Modifier"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                                  onClick={() => deleteTag(tag.id)}
                                  title="Supprimer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
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
              <button className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2 disabled:opacity-50" onClick={saveProspect} disabled={saving}>
                {saving ? (
                  <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Geocodage...</>
                ) : (
                  <><Save className="w-4 h-4" /> {editingProspect ? 'Modifier' : 'Creer'}</>
                )}
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
