import { useState, useMemo, DragEvent } from 'react';
import {
  GripVertical, MapPin, Calendar, X, Eye, ChevronDown,
  UserCheck, Mail, Clock, PhoneOff, Trophy,
  FileText,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import MultiSelectDropdown from '../components/MultiSelectDropdown';
import {
  Appointment, AppointmentResult, APPOINTMENT_RESULT_LABELS,
  ESTABLISHMENT_LABELS, Prospect, Client,
} from '../types';
import { Link } from 'react-router-dom';
import { format, parseISO, startOfMonth, endOfMonth } from 'date-fns';
import { fr } from 'date-fns/locale';

// Pipeline columns for CR results
interface CRColumn {
  id: string;
  label: string;
  color: string;
  icon: React.ReactNode;
  description: string;
}

const CR_COLUMNS: CRColumn[] = [
  { id: 'en_attente', label: 'RDV en attente', color: '#6b7280', icon: <Calendar className="w-3.5 h-3.5" />, description: 'RDV termines sans CR' },
  { id: 'mail_envoye', label: 'Mail envoye', color: '#3b82f6', icon: <Mail className="w-3.5 h-3.5" />, description: 'Mail/devis envoye' },
  { id: 'commande_plus_tard', label: 'Commande plus tard', color: '#f59e0b', icon: <Clock className="w-3.5 h-3.5" />, description: 'Interesse, a recontacter' },
  { id: 'a_relancer', label: 'A relancer', color: '#f97316', icon: <PhoneOff className="w-3.5 h-3.5" />, description: 'Relance necessaire' },
  { id: 'client', label: 'Client gagne', color: '#22c55e', icon: <Trophy className="w-3.5 h-3.5" />, description: 'Devenu client !' },
  { id: 'pas_interesse', label: 'Pas interesse', color: '#ef4444', icon: <X className="w-3.5 h-3.5" />, description: 'Pas interesse / Perdu' },
];

function getColumnId(apt: Appointment): string {
  const cr = apt.compte_rendu as string | undefined;
  if (!cr || cr === '') return 'en_attente';
  return cr;
}

export default function PipelineCRPage() {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [maxPerColumn, setMaxPerColumn] = useState(50);
  const [expandedColumns, setExpandedColumns] = useState<Set<string>>(new Set());
  const [filterCommercial, setFilterCommercial] = useState<string>('');
  const [filterSecteurs, setFilterSecteurs] = useState<Set<string>>(new Set());
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set());
  const [filterDateStart, setFilterDateStart] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [filterDateEnd, setFilterDateEnd] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [detailApt, setDetailApt] = useState<Appointment | null>(null);

  const isAdmin = state.currentUser?.role === 'admin';
  const currentUserId = state.currentUser?.id;

  // Helper maps
  const prospectMap = useMemo(() => {
    const m = new Map<string, Prospect>();
    state.prospects.forEach(p => m.set(p.id, p));
    return m;
  }, [state.prospects]);

  const clientMap = useMemo(() => {
    const m = new Map<string, Client>();
    state.clients.forEach(c => m.set(c.id, c));
    return m;
  }, [state.clients]);

  const commercialMap = useMemo(() => {
    const m = new Map<string, string>();
    state.commerciaux.forEach(c => m.set(c.id, `${c.prenom} ${c.nom}`));
    return m;
  }, [state.commerciaux]);

  // Only RDV-type appointments (not events like reunions, boutique, etc.)
  const rdvAppointments = useMemo(() => {
    return state.appointments.filter(a => {
      // Only RDVs (no event_type or event_type = 'rdv')
      if (a.event_type && a.event_type !== 'rdv') return false;
      // Must be termine or have a CR
      if (a.statut !== 'termine' && !a.compte_rendu) return false;
      // Must have a prospect_id or client_id
      if (!a.prospect_id && !a.client_id) return false;
      return true;
    });
  }, [state.appointments]);

  // All secteurs from prospects linked to RDVs
  const allSecteurs = useMemo(() => {
    const set = new Set<string>();
    rdvAppointments.forEach(a => {
      const p = prospectMap.get(a.prospect_id);
      if (p?.secteur) set.add(p.secteur);
    });
    return [...set].sort();
  }, [rdvAppointments, prospectMap]);

  // All establishment types from prospects linked to RDVs
  const allTypes = useMemo(() => {
    const set = new Set<string>();
    rdvAppointments.forEach(a => {
      const p = prospectMap.get(a.prospect_id);
      if (p?.type_etablissement) set.add(p.type_etablissement);
    });
    return [...set].sort();
  }, [rdvAppointments, prospectMap]);

  const toggleFilter = <T,>(set: Set<T>, value: T, setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    setter(next);
  };

  const hasActiveFilters = filterCommercial !== '' || filterSecteurs.size > 0 || filterTypes.size > 0;

  // Filter appointments
  const filteredApts = useMemo(() => {
    return rdvAppointments.filter(a => {
      // Date filter
      if (filterDateStart && a.date < filterDateStart) return false;
      if (filterDateEnd && a.date > filterDateEnd) return false;
      // Commercial filter
      if (filterCommercial && a.commercial_id !== filterCommercial && a.prospecteur_id !== filterCommercial) return false;
      // Non-admin: only own appointments
      if (!isAdmin && a.commercial_id !== currentUserId && a.prospecteur_id !== currentUserId) return false;
      // Secteur filter
      if (filterSecteurs.size > 0) {
        const p = prospectMap.get(a.prospect_id);
        if (!p || !filterSecteurs.has(p.secteur)) return false;
      }
      // Type filter
      if (filterTypes.size > 0) {
        const p = prospectMap.get(a.prospect_id);
        if (!p || !filterTypes.has(p.type_etablissement)) return false;
      }
      return true;
    });
  }, [rdvAppointments, filterDateStart, filterDateEnd, filterCommercial, isAdmin, currentUserId, filterSecteurs, filterTypes, prospectMap]);

  // Group by column
  const aptsByColumn = useMemo(() => {
    const map: Record<string, Appointment[]> = {};
    for (const col of CR_COLUMNS) {
      map[col.id] = [];
    }
    for (const apt of filteredApts) {
      const colId = getColumnId(apt);
      if (map[colId]) {
        map[colId].push(apt);
      } else {
        map['en_attente'].push(apt);
      }
    }
    // Sort each column by date descending
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => b.date.localeCompare(a.date));
    }
    return map;
  }, [filteredApts]);

  // Stats
  const stats = useMemo(() => {
    const total = filteredApts.length;
    const withCR = filteredApts.filter(a => { const cr = a.compte_rendu as string | undefined; return cr && cr !== ''; }).length;
    const clients = (aptsByColumn['client'] || []).length;
    const taux = total > 0 ? Math.round((clients / total) * 100) : 0;
    return { total, withCR, clients, taux };
  }, [filteredApts, aptsByColumn]);

  // Drag and drop
  const handleDragStart = (e: DragEvent, aptId: string) => {
    setDraggedId(aptId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', aptId);
  };

  const handleDragOver = (e: DragEvent, colId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(colId);
  };

  const handleDragLeave = () => setDragOverColumn(null);

  const handleDrop = (e: DragEvent, colId: string) => {
    e.preventDefault();
    const aptId = e.dataTransfer.getData('text/plain');
    if (!aptId) return;

    const apt = state.appointments.find(a => a.id === aptId);
    if (!apt) return;

    const newCR = colId === 'en_attente' ? '' : colId;
    if (getColumnId(apt) === colId) {
      setDraggedId(null);
      setDragOverColumn(null);
      return;
    }

    dispatch({
      type: 'UPDATE_APPOINTMENT',
      payload: {
        ...apt,
        compte_rendu: newCR as AppointmentResult,
        statut: 'termine',
      },
    });

    toast.success(
      colId === 'client'
        ? 'Client gagne ! Le prospect a ete converti.'
        : `Compte-rendu mis a jour: ${CR_COLUMNS.find(c => c.id === colId)?.label || colId}`
    );

    setDraggedId(null);
    setDragOverColumn(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverColumn(null);
  };

  const getEntityName = (apt: Appointment): string => {
    if (apt.client_id) {
      const client = clientMap.get(apt.client_id);
      if (client) return client.nom;
    }
    const prospect = prospectMap.get(apt.prospect_id);
    return prospect?.nom_etablissement || 'Inconnu';
  };

  const getEntityInfo = (apt: Appointment) => {
    if (apt.client_id) {
      const client = clientMap.get(apt.client_id);
      return {
        type: 'client' as const,
        typeName: client?.type_client || '',
        secteur: '',
        ville: client?.ville || '',
        link: `/clients?id=${client?.id}`,
      };
    }
    const prospect = prospectMap.get(apt.prospect_id);
    return {
      type: 'prospect' as const,
      typeName: prospect ? ESTABLISHMENT_LABELS[prospect.type_etablissement] : '',
      secteur: prospect?.secteur || '',
      ville: prospect?.ville || prospect?.adresse || '',
      link: `/prospects?id=${prospect?.id}`,
    };
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 sm:p-4 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <h1 className="text-base sm:text-xl font-bold text-gray-900">Pipeline Comptes Rendus</h1>
            <p className="text-[10px] sm:text-sm text-gray-500 mt-0.5 hidden sm:block">
              Suivez la progression des RDV vers la conversion client
            </p>
          </div>

          {/* Stats badges */}
          <div className="hidden lg:flex items-center gap-2">
            <div className="px-2.5 py-1 bg-gray-100 rounded-lg text-xs">
              <span className="text-gray-500">RDV:</span> <span className="font-bold text-gray-900">{stats.total}</span>
            </div>
            <div className="px-2.5 py-1 bg-blue-50 rounded-lg text-xs">
              <span className="text-blue-500">CR:</span> <span className="font-bold text-blue-700">{stats.withCR}/{stats.total}</span>
            </div>
            <div className="px-2.5 py-1 bg-green-50 rounded-lg text-xs">
              <span className="text-green-500">Gagnes:</span> <span className="font-bold text-green-700">{stats.clients}</span>
            </div>
            <div className={`px-2.5 py-1 rounded-lg text-xs ${stats.taux >= 20 ? 'bg-green-50' : stats.taux >= 10 ? 'bg-amber-50' : 'bg-red-50'}`}>
              <span className="text-gray-500">Taux:</span>{' '}
              <span className={`font-bold ${stats.taux >= 20 ? 'text-green-700' : stats.taux >= 10 ? 'text-amber-700' : 'text-red-700'}`}>
                {stats.taux}%
              </span>
            </div>
          </div>
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {/* Date range */}
          <div className="flex items-center gap-1 text-xs">
            <span className="text-gray-500 text-[10px]">Du</span>
            <input
              type="date"
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] bg-white"
              value={filterDateStart}
              onChange={e => setFilterDateStart(e.target.value)}
            />
            <span className="text-gray-500 text-[10px]">au</span>
            <input
              type="date"
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] bg-white"
              value={filterDateEnd}
              onChange={e => setFilterDateEnd(e.target.value)}
            />
          </div>

          {/* Commercial filter */}
          {isAdmin && (
            <select
              className={`text-[10px] sm:text-xs border rounded-lg px-2 py-1.5 bg-white flex-shrink-0 ${
                filterCommercial ? 'border-brewery-500 text-brewery-700' : 'border-gray-200 text-gray-500'
              }`}
              value={filterCommercial}
              onChange={e => setFilterCommercial(e.target.value)}
            >
              <option value="">Tous les commerciaux</option>
              {state.commerciaux.map(c => (
                <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
              ))}
            </select>
          )}

          {/* Secteur filter */}
          {allSecteurs.length > 0 && (
            <MultiSelectDropdown
              label="Secteur"
              options={allSecteurs.map(s => ({ value: s, label: s }))}
              selected={filterSecteurs}
              onToggle={v => toggleFilter(filterSecteurs, v, setFilterSecteurs)}
              color="amber"
            />
          )}

          {/* Type filter */}
          {allTypes.length > 0 && (
            <MultiSelectDropdown
              label="Type"
              options={allTypes.map(t => ({ value: t, label: ESTABLISHMENT_LABELS[t as keyof typeof ESTABLISHMENT_LABELS] || t }))}
              selected={filterTypes}
              onToggle={v => toggleFilter(filterTypes, v, setFilterTypes)}
              color="teal"
            />
          )}

          {hasActiveFilters && (
            <button
              className="px-2 py-1.5 text-[10px] text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg font-medium flex items-center gap-1"
              onClick={() => { setFilterCommercial(''); setFilterSecteurs(new Set()); setFilterTypes(new Set()); }}
            >
              <X className="w-3 h-3" /> Reset
            </button>
          )}

          <div className="flex-1" />

          <select
            className="text-[10px] sm:text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-500 bg-white flex-shrink-0"
            value={maxPerColumn}
            onChange={e => { setMaxPerColumn(Number(e.target.value)); setExpandedColumns(new Set()); }}
          >
            <option value={50}>50 / col.</option>
            <option value={100}>100 / col.</option>
            <option value={200}>200 / col.</option>
          </select>
        </div>
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-x-auto p-2 sm:p-4">
        <div className="flex gap-2 sm:gap-3 h-full min-w-max">
          {CR_COLUMNS.map(col => {
            const apts = aptsByColumn[col.id] || [];
            const displayApts = expandedColumns.has(col.id) ? apts : apts.slice(0, maxPerColumn);

            return (
              <div
                key={col.id}
                className={`w-60 sm:w-72 flex-shrink-0 flex flex-col rounded-xl border-2 transition-colors ${
                  dragOverColumn === col.id ? 'border-brewery-500 bg-brewery-50' : 'border-gray-200 bg-gray-50'
                }`}
                onDragOver={e => handleDragOver(e, col.id)}
                onDragLeave={handleDragLeave}
                onDrop={e => handleDrop(e, col.id)}
              >
                {/* Column header */}
                <div className="p-3 border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-white"
                      style={{ backgroundColor: col.color }}
                    >
                      {col.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm text-gray-900 truncate">{col.label}</h3>
                      <p className="text-[9px] text-gray-400">{col.description}</p>
                    </div>
                    <span className="text-xs text-gray-400 bg-white px-2 py-0.5 rounded-full border border-gray-200 font-bold">
                      {apts.length}
                    </span>
                  </div>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {displayApts.map(apt => {
                    const name = getEntityName(apt);
                    const info = getEntityInfo(apt);
                    const comName = commercialMap.get(apt.commercial_id) || '';
                    const prospName = apt.prospecteur_id ? commercialMap.get(apt.prospecteur_id) : null;

                    return (
                      <div
                        key={apt.id}
                        draggable
                        onDragStart={e => handleDragStart(e, apt.id)}
                        onDragEnd={handleDragEnd}
                        className={`bg-white rounded-lg border border-gray-200 p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow ${
                          draggedId === apt.id ? 'opacity-50' : ''
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <GripVertical className="w-4 h-4 text-gray-300 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            {/* Name */}
                            <h4 className="font-medium text-sm text-gray-900 truncate">{name}</h4>

                            {/* Type + Secteur */}
                            <p className="text-[10px] text-gray-500 mt-0.5 truncate">
                              {info.typeName}
                              {info.secteur && <span> - {info.secteur}</span>}
                            </p>

                            {/* Ville */}
                            {info.ville && (
                              <div className="flex items-center gap-1 mt-1 text-[10px] text-gray-400">
                                <MapPin className="w-3 h-3" />
                                <span className="truncate">{info.ville}</span>
                              </div>
                            )}

                            {/* Date RDV */}
                            <div className="flex items-center gap-1 mt-1 text-[10px] text-gray-400">
                              <Calendar className="w-3 h-3" />
                              {format(parseISO(apt.date), 'dd MMM yyyy', { locale: fr })}
                              {apt.heure_debut && <span className="ml-1">{apt.heure_debut}</span>}
                            </div>

                            {/* Commercial */}
                            <div className="flex items-center gap-1 mt-1 text-[10px]">
                              <UserCheck className="w-3 h-3 text-brewery-400" />
                              <span className="text-brewery-600 truncate">{comName}</span>
                              {prospName && (
                                <span className="text-gray-400 truncate">(par {prospName})</span>
                              )}
                            </div>

                            {/* Notes CR */}
                            {apt.notes_compte_rendu && (
                              <p className="mt-1.5 text-[10px] text-gray-500 bg-gray-50 rounded px-2 py-1 line-clamp-2 italic">
                                {apt.notes_compte_rendu}
                              </p>
                            )}

                            {/* Entity badge + View link */}
                            <div className="flex items-center gap-1.5 mt-2">
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                                info.type === 'client' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                              }`}>
                                {info.type === 'client' ? 'Client' : 'Prospect'}
                              </span>
                              <div className="flex-1" />
                              <Link
                                to={info.link}
                                className="p-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100"
                                onClick={e => e.stopPropagation()}
                                title="Voir la fiche"
                              >
                                <Eye className="w-3 h-3" />
                              </Link>
                              <button
                                className="p-1 rounded bg-gray-50 text-gray-500 hover:bg-gray-100"
                                onClick={e => { e.stopPropagation(); setDetailApt(apt); }}
                                title="Details du RDV"
                              >
                                <FileText className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {!expandedColumns.has(col.id) && apts.length > maxPerColumn && (
                    <button
                      className="w-full py-2 text-[11px] font-medium text-brewery-600 hover:bg-brewery-50 rounded-lg flex items-center justify-center gap-1"
                      onClick={() => setExpandedColumns(prev => { const s = new Set(prev); s.add(col.id); return s; })}
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                      Voir les {apts.length - maxPerColumn} restants
                    </button>
                  )}

                  {apts.length === 0 && (
                    <div className="text-center py-8 text-xs text-gray-400">
                      Aucun RDV
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail modal */}
      {detailApt && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setDetailApt(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <FileText className="w-4 h-4 text-brewery-500" />
                Details du RDV
              </h3>
              <button className="p-1 rounded hover:bg-gray-100" onClick={() => setDetailApt(null)}>
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] text-gray-400 uppercase tracking-wider">Etablissement</label>
                <p className="font-semibold text-gray-900">{getEntityName(detailApt)}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-gray-400 uppercase tracking-wider">Date</label>
                  <p className="text-sm text-gray-700">{format(parseISO(detailApt.date), 'EEEE dd MMMM yyyy', { locale: fr })}</p>
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase tracking-wider">Horaire</label>
                  <p className="text-sm text-gray-700">{detailApt.heure_debut} - {detailApt.heure_fin}</p>
                </div>
              </div>
              {detailApt.lieu && (
                <div>
                  <label className="text-[10px] text-gray-400 uppercase tracking-wider">Lieu</label>
                  <p className="text-sm text-gray-700">{detailApt.lieu}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-gray-400 uppercase tracking-wider">Commercial</label>
                  <p className="text-sm text-gray-700">{commercialMap.get(detailApt.commercial_id) || '-'}</p>
                </div>
                {detailApt.prospecteur_id && (
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase tracking-wider">Pris par</label>
                    <p className="text-sm text-gray-700">{commercialMap.get(detailApt.prospecteur_id) || '-'}</p>
                  </div>
                )}
              </div>
              <div>
                <label className="text-[10px] text-gray-400 uppercase tracking-wider">Compte-rendu</label>
                <p className="text-sm">
                  {detailApt.compte_rendu ? (
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                      style={{ backgroundColor: CR_COLUMNS.find(c => c.id === detailApt.compte_rendu)?.color || '#6b7280' }}
                    >
                      {APPOINTMENT_RESULT_LABELS[detailApt.compte_rendu] || detailApt.compte_rendu}
                    </span>
                  ) : (
                    <span className="text-gray-400 italic">En attente</span>
                  )}
                </p>
              </div>
              {detailApt.notes && (
                <div>
                  <label className="text-[10px] text-gray-400 uppercase tracking-wider">Notes RDV</label>
                  <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-2">{detailApt.notes}</p>
                </div>
              )}
              {detailApt.notes_compte_rendu && (
                <div>
                  <label className="text-[10px] text-gray-400 uppercase tracking-wider">Notes compte-rendu</label>
                  <p className="text-sm text-gray-700 bg-amber-50 rounded-lg p-2">{detailApt.notes_compte_rendu}</p>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-between">
              <Link
                to={getEntityInfo(detailApt).link}
                className="flex items-center gap-1.5 px-3 py-2 bg-brewery-600 text-white rounded-lg text-xs font-medium hover:bg-brewery-700"
              >
                <Eye className="w-3.5 h-3.5" /> Voir la fiche
              </Link>
              <button
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                onClick={() => setDetailApt(null)}
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
