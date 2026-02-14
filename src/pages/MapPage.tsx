import { useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { Filter, MapPin, Phone, Mail, ExternalLink, Route, Calendar, Clock, Download, ChevronDown, ChevronUp, Users } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useCallModal } from '../components/CallModal';
import { ESTABLISHMENT_LABELS, PIPELINE_LABELS, PIPELINE_COLORS, EstablishmentType, PipelineStage, APPOINTMENT_STATUS_LABELS } from '../types';
import { Link } from 'react-router-dom';
import { usePersistedState } from '../hooks/usePersistedState';
import { formatDate, downloadICS, isThisWeek } from '../utils/helpers';

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

export default function MapPage() {
  const { state, dispatch, getProspect } = useApp();
  const { startCall } = useCallModal();
  const [selectedTypes, setSelectedTypes] = usePersistedState<EstablishmentType[]>('map_types', []);
  const [selectedStages, setSelectedStages] = usePersistedState<PipelineStage[]>('map_stages', []);
  const [selectedTags, setSelectedTags] = usePersistedState<string[]>('map_tags', []);
  const [selectedSecteurs, setSelectedSecteurs] = usePersistedState<string[]>('map_secteurs', []);
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showWeekRdv, setShowWeekRdv] = usePersistedState<boolean>('map_show_week_rdv', true);

  // RDV de la semaine en cours
  const weekRdvs = useMemo(() => {
    return state.appointments
      .filter(a => isThisWeek(a.date) && a.statut !== 'annule' && a.statut !== 'termine')
      .sort((a, b) => a.date === b.date ? a.heure_debut.localeCompare(b.heure_debut) : a.date.localeCompare(b.date));
  }, [state.appointments]);

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
    // Toggle : si deja selectionne seul, on deselectionne
    if (selectedSecteurs.length === 1 && selectedSecteurs[0] === secteur) {
      setSelectedSecteurs([]);
    } else {
      setSelectedSecteurs([secteur]);
    }
  };

  const filteredProspects = useMemo(() => {
    return state.prospects.filter(p => {
      // Only show prospects with valid coordinates
      if (!p.latitude || !p.longitude) return false;
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
  }, [state.prospects, selectedTypes, selectedStages, selectedTags, selectedSecteurs, searchTerm]);

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

  return (
    <div className="h-full flex flex-col">
      {/* Header bar */}
      <div className="p-4 bg-white border-b border-gray-200 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Rechercher un prospect, une ville, un secteur..."
              className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <button
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              showFilters ? 'bg-brewery-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="w-4 h-4" />
            Filtres
            {activeFilterCount > 0 && (
              <span className="bg-white text-brewery-600 text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
          <div className="text-sm text-gray-500">
            {filteredProspects.length} prospect{filteredProspects.length > 1 ? 's' : ''}
          </div>
        </div>

        {/* Raccourcis tournees */}
        {tournees.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
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

        {/* Legende couleurs pipeline */}
        <div className="flex items-center gap-2 flex-wrap">
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

            {activeFilterCount > 0 && (
              <button
                className="text-xs text-red-500 hover:text-red-700 font-medium"
                onClick={() => { setSelectedTypes([]); setSelectedStages([]); setSelectedTags([]); setSelectedSecteurs([]); }}
              >
                Reinitialiser les filtres
              </button>
            )}
          </div>
        )}
      </div>

      {/* Map + RDV panel */}
      <div className="flex-1 relative">
        <MapContainer center={center} zoom={9} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {filteredProspects.map(prospect => {
            // Couleur du marqueur = couleur de l'etape pipeline
            const markerColor = PIPELINE_COLORS[prospect.etape_pipeline];

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
                    <div className="mt-2 flex gap-2">
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

        {/* RDV de la semaine - panneau flottant */}
        {weekRdvs.length > 0 && (
          <div className="absolute top-3 right-3 z-[1000] w-80 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
            {/* Header */}
            <button
              className="w-full flex items-center justify-between px-4 py-2.5 bg-brewery-50 hover:bg-brewery-100 transition-colors"
              onClick={() => setShowWeekRdv(!showWeekRdv)}
            >
              <span className="text-xs font-semibold text-brewery-700 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                RDV cette semaine ({weekRdvs.length})
              </span>
              {showWeekRdv ? <ChevronUp className="w-4 h-4 text-brewery-500" /> : <ChevronDown className="w-4 h-4 text-brewery-500" />}
            </button>

            {showWeekRdv && (
              <div className="max-h-72 overflow-y-auto divide-y divide-gray-100">
                {weekRdvs.map(rdv => {
                  const prospect = getProspect(rdv.prospect_id);
                  const commercial = state.commerciaux.find(c => c.id === rdv.commercial_id);
                  const isToday = rdv.date === new Date().toISOString().split('T')[0];
                  const statusColors: Record<string, string> = {
                    planifie: 'bg-blue-100 text-blue-700',
                    confirme: 'bg-green-100 text-green-700',
                  };

                  return (
                    <div key={rdv.id} className={`px-4 py-2.5 hover:bg-gray-50 ${isToday ? 'bg-amber-50/50' : ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-900 truncate">
                            {prospect?.nom_etablissement || 'Inconnu'}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] font-mono text-gray-500">
                              {formatDate(rdv.date)} {rdv.heure_debut}-{rdv.heure_fin}
                            </span>
                            {isToday && (
                              <span className="text-[9px] font-bold text-amber-600 bg-amber-100 px-1.5 rounded">AUJOURD'HUI</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
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
                        <span className={`badge text-[9px] flex-shrink-0 ${statusColors[rdv.statut] || 'bg-gray-100 text-gray-600'}`}>
                          {APPOINTMENT_STATUS_LABELS[rdv.statut]}
                        </span>
                      </div>
                      {/* Actions rapides */}
                      <div className="flex items-center gap-1.5 mt-2">
                        {prospect?.telephone && (
                          <button
                            className="flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded text-[10px] font-medium hover:bg-green-100"
                            onClick={() => startCall(prospect.id)}
                          >
                            <Phone className="w-3 h-3" /> Appeler
                          </button>
                        )}
                        {rdv.statut === 'planifie' && (
                          <button
                            className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded text-[10px] font-medium hover:bg-blue-100"
                            onClick={() => dispatch({ type: 'UPDATE_APPOINTMENT', payload: { ...rdv, statut: 'confirme' } })}
                          >
                            Confirmer
                          </button>
                        )}
                        {prospect && (
                          <button
                            className="flex items-center gap-1 px-2 py-1 bg-gray-50 text-gray-600 rounded text-[10px] font-medium hover:bg-gray-100"
                            onClick={() => downloadICS(rdv, prospect)}
                          >
                            <Download className="w-3 h-3" /> .ics
                          </button>
                        )}
                        <Link
                          to="/rdv"
                          className="flex items-center gap-1 px-2 py-1 bg-gray-50 text-gray-600 rounded text-[10px] font-medium hover:bg-gray-100 ml-auto"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
