import { useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import {
  Filter, MapPin, Phone, Mail, ExternalLink, Route, Calendar, CalendarPlus,
  ChevronLeft, ChevronRight, Users, X, Check,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useCallModal } from '../components/CallModal';
import { ESTABLISHMENT_LABELS, PIPELINE_LABELS, PIPELINE_COLORS, EstablishmentType, PipelineStage, APPOINTMENT_STATUS_LABELS } from '../types';
import { Link } from 'react-router-dom';
import { usePersistedState } from '../hooks/usePersistedState';
import { formatDate, downloadICS } from '../utils/helpers';
import FilterPresets from '../components/FilterPresets';

// Custom marker icon factory
function createMarkerIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

function getWeekRange(offset: number): { start: string; end: string; label: string } {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`;
  let label: string;
  if (offset === 0) label = `Cette semaine`;
  else if (offset === 1) label = `Sem. prochaine`;
  else if (offset === -1) label = `Sem. derniere`;
  else if (offset > 0) label = `+${offset} sem.`;
  else label = `${offset} sem.`;
  label += ` (${fmt(monday)} - ${fmt(sunday)})`;
  const toDateStr = (d: Date) => d.toISOString().split('T')[0];
  return { start: toDateStr(monday), end: toDateStr(sunday), label };
}

const DAY_NAMES_SHORT: Record<number, string> = { 1: 'Lun', 2: 'Mar', 3: 'Mer', 4: 'Jeu', 5: 'Ven', 6: 'Sam', 0: 'Dim' };

export default function MapPage() {
  const { state, dispatch, getProspect } = useApp();
  const { startCall } = useCallModal();
  const [selectedTypes, setSelectedTypes] = usePersistedState<EstablishmentType[]>('map_types', []);
  const [selectedStages, setSelectedStages] = usePersistedState<PipelineStage[]>('map_stages', []);
  const [selectedTags, setSelectedTags] = usePersistedState<string[]>('map_tags', []);
  const [selectedSecteurs, setSelectedSecteurs] = usePersistedState<string[]>('map_secteurs', []);
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showRdvPanel, setShowRdvPanel] = useState(false);
  const [rdvWeekOffset, setRdvWeekOffset] = usePersistedState<number>('map_rdv_week', 0);
  const [rdvFilterCommercial, setRdvFilterCommercial] = usePersistedState<string>('map_rdv_commercial', '');
  const [maxMarkers, setMaxMarkers] = usePersistedState<number>('map_max_markers', 200);

  // RDV de la semaine selectionnee (filtre par commercial si actif)
  const weekRange = useMemo(() => getWeekRange(rdvWeekOffset), [rdvWeekOffset]);
  const weekRdvs = useMemo(() => {
    return state.appointments
      .filter(a => a.date >= weekRange.start && a.date <= weekRange.end && a.statut !== 'annule')
      .filter(a => !rdvFilterCommercial || a.commercial_id === rdvFilterCommercial)
      .sort((a, b) => a.date === b.date ? a.heure_debut.localeCompare(b.heure_debut) : a.date.localeCompare(b.date));
  }, [state.appointments, weekRange, rdvFilterCommercial]);

  // Set de prospect_ids qui ont un RDV cette semaine (pour filtrer la carte)
  const rdvProspectIds = useMemo(() => {
    return new Set(weekRdvs.map(a => a.prospect_id));
  }, [weekRdvs]);

  // Compter les RDV a venir toutes semaines confondues (pour le badge)
  const totalUpcomingRdv = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return state.appointments.filter(a => a.date >= today && a.statut !== 'annule' && a.statut !== 'termine').length;
  }, [state.appointments]);

  // Grouper par jour
  const rdvByDay = useMemo(() => {
    const map: Record<string, typeof weekRdvs> = {};
    for (const rdv of weekRdvs) {
      if (!map[rdv.date]) map[rdv.date] = [];
      map[rdv.date].push(rdv);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [weekRdvs]);

  // Extract unique sectors with prospect counts
  const allSecteurs = useMemo(() => {
    return [...new Set(state.prospects.map(p => p.secteur).filter(Boolean))].sort();
  }, [state.prospects]);

  // Tournees = secteurs qui ont des prospects avec coordonnees
  const tournees = useMemo(() => {
    const map = new Map<string, number>();
    state.prospects.forEach(p => {
      if (p.secteur && p.latitude && p.longitude) {
        map.set(p.secteur, (map.get(p.secteur) || 0) + 1);
      }
    });
    return [...map.entries()]
      .map(([nom, count]) => ({ nom, count }))
      .sort((a, b) => a.nom.localeCompare(b.nom));
  }, [state.prospects]);

  const selectTournee = (secteur: string) => {
    if (selectedSecteurs.length === 1 && selectedSecteurs[0] === secteur) {
      setSelectedSecteurs([]);
    } else {
      setSelectedSecteurs([secteur]);
    }
  };

  const filteredProspects = useMemo(() => {
    return state.prospects.filter(p => {
      if (!p.latitude || !p.longitude) return false;
      // Quand le panneau RDV est actif : n'afficher que les prospects avec RDV cette semaine
      if (showRdvPanel) {
        return rdvProspectIds.has(p.id);
      }
      if (selectedTypes.length > 0 && !selectedTypes.includes(p.type_etablissement)) return false;
      if (selectedStages.length > 0 && !selectedStages.includes(p.etape_pipeline)) return false;
      if (selectedTags.length > 0 && !selectedTags.some(t => p.tags.includes(t))) return false;
      if (selectedSecteurs.length > 0 && !selectedSecteurs.includes(p.secteur)) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return (
          p.nom_etablissement.toLowerCase().includes(term) ||
          p.ville.toLowerCase().includes(term) ||
          p.departement.toLowerCase().includes(term) ||
          p.nom_contact.toLowerCase().includes(term) ||
          (p.secteur || '').toLowerCase().includes(term)
        );
      }
      return true;
    });
  }, [state.prospects, selectedTypes, selectedStages, selectedTags, selectedSecteurs, searchTerm, showRdvPanel, rdvProspectIds]);

  const toggleType = (type: EstablishmentType) => {
    setSelectedTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const toggleStage = (stage: PipelineStage) => {
    setSelectedStages(prev =>
      prev.includes(stage) ? prev.filter(s => s !== stage) : [...prev, stage]
    );
  };

  const toggleTag = (tagId: string) => {
    setSelectedTags(prev =>
      prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]
    );
  };

  const toggleSecteur = (secteur: string) => {
    setSelectedSecteurs(prev =>
      prev.includes(secteur) ? prev.filter(s => s !== secteur) : [...prev, secteur]
    );
  };

  const activeFilterCount = selectedTypes.length + selectedStages.length + selectedTags.length + selectedSecteurs.length;

  // Center map on Saint-Didier-en-Velay area
  const center: [number, number] = [45.37, 4.27];
  const today = new Date().toISOString().split('T')[0];

  const statusColors: Record<string, string> = {
    planifie: 'bg-blue-100 text-blue-700',
    confirme: 'bg-green-100 text-green-700',
    termine: 'bg-gray-100 text-gray-600',
    annule: 'bg-red-100 text-red-400',
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header bar */}
      <div className="p-3 sm:p-4 bg-white border-b border-gray-200 space-y-2 sm:space-y-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex-1 min-w-0">
            <input
              type="text"
              placeholder="Rechercher..."
              className="w-full px-3 sm:px-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <button
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors flex-shrink-0 ${
              showFilters ? 'bg-brewery-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            onClick={() => { setShowFilters(!showFilters); if (!showFilters) setShowRdvPanel(false); }}
          >
            <Filter className="w-4 h-4" />
            <span className="hidden sm:inline">Filtres</span>
            {activeFilterCount > 0 && (
              <span className="bg-white text-brewery-600 text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
          {/* Bouton RDV */}
          <button
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors flex-shrink-0 ${
              showRdvPanel ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
            }`}
            onClick={() => { setShowRdvPanel(!showRdvPanel); if (!showRdvPanel) setShowFilters(false); }}
          >
            <Calendar className="w-4 h-4" />
            RDV
            {totalUpcomingRdv > 0 && (
              <span className={`text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center ${
                showRdvPanel ? 'bg-white/20' : 'bg-blue-600 text-white'
              }`}>
                {totalUpcomingRdv}
              </span>
            )}
          </button>
          <select
            className="text-[10px] border border-gray-200 rounded px-1 py-0.5 text-gray-500 bg-white flex-shrink-0"
            value={maxMarkers}
            onChange={e => setMaxMarkers(Number(e.target.value))}
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={1000}>1 000</option>
            <option value={2000}>2 000</option>
            <option value={3000}>3 000</option>
            <option value={4000}>4 000</option>
            <option value={5000}>5 000</option>
            <option value={6000}>6 000</option>
            <option value={7000}>7 000</option>
            <option value={8000}>8 000</option>
            <option value={9000}>9 000</option>
            <option value={10000}>10 000</option>
            <option value={15000}>15 000</option>
            <option value={0}>Tout voir</option>
          </select>
          <div className="text-xs sm:text-sm text-gray-500 flex-shrink-0">
            {showRdvPanel ? (
              <span className="text-blue-600 font-medium">{filteredProspects.length} RDV</span>
            ) : (
              <>
                {maxMarkers === 0 ? filteredProspects.length : Math.min(filteredProspects.length, maxMarkers)}{maxMarkers > 0 && filteredProspects.length > maxMarkers && `/${filteredProspects.length}`}
                <span className="hidden sm:inline"> prospect{filteredProspects.length > 1 ? 's' : ''}</span>
              </>
            )}
          </div>
        </div>

        {/* Raccourcis tournees */}
        {tournees.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
            <span className="text-xs font-medium text-gray-500 flex items-center gap-1">
              <Route className="w-3.5 h-3.5" /> Tournees :
            </span>
            {tournees.map(t => (
              <button
                key={t.nom}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                  selectedSecteurs.length === 1 && selectedSecteurs[0] === t.nom
                    ? 'bg-brewery-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-700 hover:bg-brewery-50 hover:text-brewery-700'
                }`}
                onClick={() => selectTournee(t.nom)}
              >
                <MapPin className="w-3 h-3" />
                {t.nom}
                <span className={`text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center ${
                  selectedSecteurs.length === 1 && selectedSecteurs[0] === t.nom
                    ? 'bg-white/20 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {t.count}
                </span>
              </button>
            ))}
            {selectedSecteurs.length > 0 && (
              <button
                className="text-[10px] text-red-500 hover:text-red-700 font-medium ml-1"
                onClick={() => setSelectedSecteurs([])}
              >
                Tout afficher
              </button>
            )}
          </div>
        )}

        {/* Legende couleurs pipeline - cachee sur mobile */}
        <div className="hidden sm:flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-gray-400">Legende :</span>
          {(Object.keys(PIPELINE_LABELS) as PipelineStage[]).map(stage => (
            <span key={stage} className="flex items-center gap-1 text-[10px] text-gray-500">
              <span
                className="w-3 h-3 rounded-full inline-block border border-white shadow-sm"
                style={{ backgroundColor: PIPELINE_COLORS[stage] }}
              />
              {PIPELINE_LABELS[stage]}
            </span>
          ))}
        </div>

        {/* Filter panels */}
        {showFilters && (
          <div className="space-y-3 pt-2 border-t border-gray-100 fade-in">
            {/* Sector filters */}
            {allSecteurs.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1.5">Secteur</p>
                <div className="flex flex-wrap gap-1.5">
                  {allSecteurs.map(secteur => (
                    <button
                      key={secteur}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        selectedSecteurs.includes(secteur)
                          ? 'bg-brewery-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                      onClick={() => toggleSecteur(secteur)}
                    >
                      {secteur}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Type filters */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1.5">Type d'etablissement</p>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(ESTABLISHMENT_LABELS) as EstablishmentType[]).map(type => (
                  <button
                    key={type}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      selectedTypes.includes(type)
                        ? 'bg-brewery-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    onClick={() => toggleType(type)}
                  >
                    {ESTABLISHMENT_LABELS[type]}
                  </button>
                ))}
              </div>
            </div>

            {/* Pipeline stage filters */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1.5">Etape pipeline</p>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(PIPELINE_LABELS) as PipelineStage[]).map(stage => (
                  <button
                    key={stage}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      selectedStages.includes(stage)
                        ? 'text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    style={selectedStages.includes(stage) ? { backgroundColor: PIPELINE_COLORS[stage] } : {}}
                    onClick={() => toggleStage(stage)}
                  >
                    {PIPELINE_LABELS[stage]}
                  </button>
                ))}
              </div>
            </div>

            {/* Tag filters */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1.5">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {state.tags.map(tag => (
                  <button
                    key={tag.id}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      selectedTags.includes(tag.id)
                        ? 'text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    style={selectedTags.includes(tag.id) ? { backgroundColor: tag.couleur } : {}}
                    onClick={() => toggleTag(tag.id)}
                  >
                    {tag.nom}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between flex-wrap gap-2">
              {activeFilterCount > 0 && (
                <button
                  className="text-xs text-red-500 hover:text-red-700 font-medium"
                  onClick={() => { setSelectedTypes([]); setSelectedStages([]); setSelectedTags([]); setSelectedSecteurs([]); }}
                >
                  Reinitialiser les filtres
                </button>
              )}
              <FilterPresets
                page="map"
                getCurrentFilters={() => ({
                  types: selectedTypes,
                  stages: selectedStages,
                  tags: selectedTags,
                  secteurs: selectedSecteurs,
                })}
                applyFilters={(f) => {
                  setSelectedTypes((f.types as EstablishmentType[]) || []);
                  setSelectedStages((f.stages as PipelineStage[]) || []);
                  setSelectedTags((f.tags as string[]) || []);
                  setSelectedSecteurs((f.secteurs as string[]) || []);
                }}
              />
            </div>
          </div>
        )}

        {/* ========== PANNEAU RDV PAR SEMAINE ========== */}
        {showRdvPanel && (
          <div className="pt-3 border-t border-gray-100 fade-in">
            {/* Navigation semaine */}
            <div className="flex items-center justify-between mb-3">
              <button
                className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600"
                onClick={() => setRdvWeekOffset(w => w - 1)}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="text-center">
                <p className="text-xs font-semibold text-gray-900">{weekRange.label}</p>
                {rdvWeekOffset !== 0 && (
                  <button
                    className="text-[9px] text-brewery-600 hover:underline"
                    onClick={() => setRdvWeekOffset(0)}
                  >
                    Revenir a cette semaine
                  </button>
                )}
              </div>
              <button
                className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600"
                onClick={() => setRdvWeekOffset(w => w + 1)}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Filtre par commercial */}
            <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-1 sm:overflow-visible sm:flex-wrap sm:pb-0 mb-3">
              <span className="text-[10px] font-medium text-gray-500 flex items-center gap-1 flex-shrink-0">
                <Users className="w-3 h-3" /> Commercial :
              </span>
              <button
                className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors flex-shrink-0 ${!rdvFilterCommercial ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                onClick={() => setRdvFilterCommercial('')}
              >
                Tous
              </button>
              {state.commerciaux.map(c => {
                const count = state.appointments.filter(a => a.commercial_id === c.id && a.date >= weekRange.start && a.date <= weekRange.end && a.statut !== 'annule').length;
                return (
                  <button
                    key={c.id}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors flex items-center gap-1 flex-shrink-0 whitespace-nowrap ${
                      rdvFilterCommercial === c.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    onClick={() => setRdvFilterCommercial(rdvFilterCommercial === c.id ? '' : c.id)}
                  >
                    {c.prenom}
                    <span className={`text-[9px] rounded-full w-4 h-4 flex items-center justify-center ${
                      rdvFilterCommercial === c.id ? 'bg-white/20' : 'bg-gray-200'
                    }`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Liste des RDV groupes par jour */}
            {weekRdvs.length === 0 ? (
              <div className="text-center py-4 text-gray-400 text-xs">
                <Calendar className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Aucun RDV cette semaine
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {rdvByDay.map(([dateStr, rdvs]) => {
                  const d = new Date(dateStr + 'T00:00:00');
                  const dayName = DAY_NAMES_SHORT[d.getDay()] || '';
                  const isToday = dateStr === today;
                  return (
                    <div key={dateStr}>
                      <div className={`flex items-center gap-2 mb-1 ${isToday ? 'text-brewery-700' : 'text-gray-500'}`}>
                        <span className={`text-[10px] font-bold uppercase ${isToday ? 'bg-brewery-100 text-brewery-700 px-1.5 py-0.5 rounded' : ''}`}>
                          {dayName} {d.getDate()}/{d.getMonth() + 1}
                          {isToday && ' - AUJOURD\'HUI'}
                        </span>
                        <div className="flex-1 h-px bg-gray-200" />
                        <span className="text-[10px] text-gray-400">{rdvs.length} RDV</span>
                      </div>
                      <div className="space-y-1.5">
                        {rdvs.map(rdv => {
                          const prospect = getProspect(rdv.prospect_id);
                          const commercial = state.commerciaux.find(c => c.id === rdv.commercial_id);
                          return (
                            <div key={rdv.id} className={`px-2 sm:px-3 py-2 rounded-lg ${isToday ? 'bg-brewery-50/50' : 'bg-gray-50'} hover:bg-gray-100 transition-colors`}>
                              <div className="flex items-start sm:items-center gap-2 sm:gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                                    <span className="text-[10px] sm:text-[11px] font-mono text-gray-500 flex-shrink-0">
                                      {rdv.heure_debut}-{rdv.heure_fin}
                                    </span>
                                    <span className="text-[11px] sm:text-xs font-semibold text-gray-900 truncate">
                                      {prospect?.nom_etablissement || 'Inconnu'}
                                    </span>
                                    <span className={`badge text-[8px] flex-shrink-0 ${statusColors[rdv.statut] || 'bg-gray-100 text-gray-600'}`}>
                                      {APPOINTMENT_STATUS_LABELS[rdv.statut]}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 sm:gap-3 mt-0.5">
                                    <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                                      <Users className="w-2.5 h-2.5" /> {commercial?.prenom}
                                    </span>
                                    {rdv.lieu && (
                                      <span className="text-[10px] text-gray-400 flex items-center gap-0.5 truncate">
                                        <MapPin className="w-2.5 h-2.5 flex-shrink-0" /> {rdv.lieu}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {/* Actions rapides */}
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  {prospect?.telephone && (
                                    <button
                                      className="p-1.5 rounded bg-green-50 text-green-600 hover:bg-green-100"
                                      onClick={() => startCall(prospect.id)}
                                      title="Appeler"
                                    >
                                      <Phone className="w-3 h-3" />
                                    </button>
                                  )}
                                  {rdv.statut === 'planifie' && (
                                    <button
                                      className="p-1.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100"
                                      onClick={() => dispatch({ type: 'UPDATE_APPOINTMENT', payload: { ...rdv, statut: 'confirme' } })}
                                      title="Confirmer"
                                    >
                                      <Check className="w-3 h-3" />
                                    </button>
                                  )}
                                  {prospect && (
                                    <button
                                      className="p-1.5 rounded bg-gray-100 text-gray-500 hover:bg-gray-200"
                                      onClick={() => downloadICS(rdv, prospect)}
                                      title="Ajouter a l'agenda"
                                    >
                                      <CalendarPlus className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Map */}
      <div className="flex-1">
        <MapContainer center={center} zoom={9} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {(maxMarkers === 0 ? filteredProspects : filteredProspects.slice(0, maxMarkers)).map(prospect => {
            const markerColor = showRdvPanel ? '#2563eb' : PIPELINE_COLORS[prospect.etape_pipeline];
            return (
              <Marker
                key={prospect.id}
                position={[prospect.latitude, prospect.longitude]}
                icon={createMarkerIcon(markerColor)}
              >
                <Popup>
                  <div className="min-w-[200px]">
                    <h3 className="font-bold text-gray-900 text-sm">{prospect.nom_etablissement}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {ESTABLISHMENT_LABELS[prospect.type_etablissement]}
                      {prospect.secteur && <span> - Secteur: {prospect.secteur}</span>}
                    </p>
                    <div className="mt-2 space-y-1 text-xs text-gray-600">
                      <p className="flex items-center gap-1"><MapPin className="w-3 h-3" />{prospect.adresse}{prospect.ville ? `, ${prospect.ville}` : ''}</p>
                      {prospect.telephone && <p className="flex items-center gap-1"><Phone className="w-3 h-3" />{prospect.telephone}</p>}
                      {prospect.email && <p className="flex items-center gap-1"><Mail className="w-3 h-3" />{prospect.email}</p>}
                    </div>
                    {prospect.nom_contact && (
                      <p className="mt-1 text-xs text-gray-500">Contact: {prospect.nom_contact}</p>
                    )}
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <span
                        className="badge text-white text-[10px]"
                        style={{ backgroundColor: PIPELINE_COLORS[prospect.etape_pipeline] }}
                      >
                        {PIPELINE_LABELS[prospect.etape_pipeline]}
                      </span>
                      {prospect.tags.map(tagId => {
                        const tag = state.tags.find(t => t.id === tagId);
                        return tag ? (
                          <span key={tagId} className="badge text-white text-[10px]" style={{ backgroundColor: tag.couleur }}>
                            {tag.nom}
                          </span>
                        ) : null;
                      })}
                    </div>
                    {/* RDV info si mode RDV actif */}
                    {showRdvPanel && (() => {
                      const prospectRdvs = weekRdvs.filter(a => a.prospect_id === prospect.id);
                      if (prospectRdvs.length === 0) return null;
                      return (
                        <div className="mt-2 p-1.5 bg-blue-50 rounded border border-blue-200">
                          {prospectRdvs.map(rdv => {
                            const com = state.commerciaux.find(c => c.id === rdv.commercial_id);
                            return (
                              <div key={rdv.id} className="text-[10px] text-blue-700 flex items-center gap-1">
                                <Calendar className="w-3 h-3 flex-shrink-0" />
                                <span className="font-medium">{formatDate(rdv.date)} {rdv.heure_debut}-{rdv.heure_fin}</span>
                                <span className="text-blue-500">({com?.prenom})</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                    <div className="mt-2 flex gap-2">
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${prospect.adresse} ${prospect.code_postal} ${prospect.ville}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2 py-1 bg-indigo-500 text-white rounded text-[10px] font-medium hover:bg-indigo-600"
                        onClick={e => e.stopPropagation()}
                      >
                        <MapPin className="w-3 h-3" /> Maps
                      </a>
                      {prospect.telephone && (
                        <button
                          onClick={() => startCall(prospect.id)}
                          className="flex items-center gap-1 px-2 py-1 bg-green-500 text-white rounded text-[10px] font-medium hover:bg-green-600"
                        >
                          <Phone className="w-3 h-3" /> Appeler
                        </button>
                      )}
                      <Link
                        to={`/prospects?id=${prospect.id}`}
                        className="flex items-center gap-1 px-2 py-1 bg-blue-500 text-white rounded text-[10px] font-medium hover:bg-blue-600"
                      >
                        <ExternalLink className="w-3 h-3" /> Voir
                      </Link>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}
