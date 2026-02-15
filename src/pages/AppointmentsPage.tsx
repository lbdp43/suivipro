import { useState, useMemo } from 'react';
import {
  Calendar, Plus, X, Save, MapPin, Clock, CalendarPlus, Trash2, Edit2, Check, Navigation, Phone,
  AlertTriangle, Users, Filter, ChevronLeft, ChevronRight, List, LayoutGrid, Download, CalendarDays,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { Appointment, AppointmentStatus, APPOINTMENT_STATUS_LABELS } from '../types';
import { generateId, formatDate, downloadICS, downloadICSBatch, detectConflicts } from '../utils/helpers';
import { usePersistedState } from '../hooks/usePersistedState';
import CommercialAgenda from '../components/CommercialAgenda';

export default function AppointmentsPage() {
  const { state, dispatch, getProspect } = useApp();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);

  // Filtres persistants
  const [filterStatus, setFilterStatus] = usePersistedState<AppointmentStatus | ''>('rdv_status', '');
  const [filterCommercial, setFilterCommercial] = usePersistedState<string>('rdv_commercial', '');
  const [filterProspecteur, setFilterProspecteur] = usePersistedState<string>('rdv_prospecteur', '');
  const [viewMode, setViewMode] = usePersistedState<'list' | 'agenda' | 'planning'>('rdv_view', 'planning');
  const [weekOffset, setWeekOffset] = useState(0);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportDateFrom, setExportDateFrom] = useState('');
  const [exportDateTo, setExportDateTo] = useState('');
  const [exportCommercial, setExportCommercial] = useState('');

  const [formData, setFormData] = useState({
    prospect_id: '',
    commercial_id: '',
    prospecteur_id: '',
    date: '',
    heure_debut: '',
    heure_fin: '',
    lieu: '',
    notes: '',
    statut: 'planifie' as AppointmentStatus,
  });

  const appointments = useMemo(() => {
    let list = [...state.appointments];
    if (filterStatus) list = list.filter(a => a.statut === filterStatus);
    if (filterCommercial) list = list.filter(a => a.commercial_id === filterCommercial);
    if (filterProspecteur) list = list.filter(a => a.prospecteur_id === filterProspecteur);
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [state.appointments, filterStatus, filterCommercial, filterProspecteur]);

  const upcoming = appointments.filter(a => a.date >= new Date().toISOString().split('T')[0] && a.statut !== 'annule' && a.statut !== 'termine');
  const past = appointments.filter(a => a.date < new Date().toISOString().split('T')[0] || a.statut === 'termine' || a.statut === 'annule');

  // Detection conflits dans le formulaire
  const formConflicts = useMemo(() => {
    if (!formData.commercial_id || !formData.date || !formData.heure_debut || !formData.heure_fin) return [];
    return detectConflicts(
      state.appointments,
      formData.commercial_id,
      formData.date,
      formData.heure_debut,
      formData.heure_fin,
      editing?.id,
    );
  }, [state.appointments, formData.commercial_id, formData.date, formData.heure_debut, formData.heure_fin, editing]);

  const openNewForm = () => {
    setFormData({
      prospect_id: '',
      commercial_id: state.currentUser?.id || 'com-1',
      prospecteur_id: state.currentUser?.id || 'com-1',
      date: '',
      heure_debut: '',
      heure_fin: '',
      lieu: '',
      notes: '',
      statut: 'planifie',
    });
    setEditing(null);
    setShowForm(true);
  };

  const openEditForm = (rdv: Appointment) => {
    setFormData({
      prospect_id: rdv.prospect_id,
      commercial_id: rdv.commercial_id,
      prospecteur_id: rdv.prospecteur_id || rdv.commercial_id,
      date: rdv.date,
      heure_debut: rdv.heure_debut,
      heure_fin: rdv.heure_fin,
      lieu: rdv.lieu,
      notes: rdv.notes,
      statut: rdv.statut,
    });
    setEditing(rdv);
    setShowForm(true);
  };

  const saveAppointment = () => {
    if (!formData.prospect_id || !formData.date) return;
    if (editing) {
      dispatch({
        type: 'UPDATE_APPOINTMENT',
        payload: { ...editing, ...formData } as Appointment,
      });
    } else {
      dispatch({
        type: 'ADD_APPOINTMENT',
        payload: {
          ...formData,
          id: generateId('rdv'),
          commercial_id: formData.commercial_id || state.currentUser?.id || 'com-1',
          prospecteur_id: formData.prospecteur_id || state.currentUser?.id || 'com-1',
        } as Appointment,
      });

      // Auto-transition: move prospect to "RDV / Gagne" when RDV is created
      const prospect = state.prospects.find(p => p.id === formData.prospect_id);
      if (prospect && !['gagne', 'perdu'].includes(prospect.etape_pipeline)) {
        dispatch({
          type: 'MOVE_PROSPECT',
          payload: { id: prospect.id, stage: 'gagne' },
        });
      }
    }
    setShowForm(false);
  };

  const deleteAppointment = (id: string) => {
    if (confirm('Supprimer ce RDV ?')) {
      dispatch({ type: 'DELETE_APPOINTMENT', payload: id });
    }
  };

  // Ouvrir la modale d'export avec les filtres pre-remplis
  const openExportModal = () => {
    const today = new Date().toISOString().split('T')[0];
    setExportDateFrom(today);
    setExportDateTo('');
    setExportCommercial(filterCommercial || '');
    setShowExportModal(true);
  };

  // RDV correspondant aux criteres d'export
  const exportPreview = useMemo(() => {
    let list = state.appointments.filter(a => a.statut !== 'annule');
    if (exportCommercial) list = list.filter(a => a.commercial_id === exportCommercial);
    if (exportDateFrom) list = list.filter(a => a.date >= exportDateFrom);
    if (exportDateTo) list = list.filter(a => a.date <= exportDateTo);
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [state.appointments, exportCommercial, exportDateFrom, exportDateTo]);

  const executeExportICS = () => {
    if (exportPreview.length === 0) return;
    const commercial = exportCommercial
      ? state.commerciaux.find(c => c.id === exportCommercial)
      : undefined;
    downloadICSBatch(exportPreview, getProspect, commercial ? `${commercial.prenom}-${commercial.nom}` : undefined);
    setShowExportModal(false);
  };

  const statusColors: Record<AppointmentStatus, string> = {
    planifie: 'bg-blue-100 text-blue-700',
    confirme: 'bg-green-100 text-green-700',
    termine: 'bg-gray-100 text-gray-600',
    annule: 'bg-red-100 text-red-700',
  };

  // Week label
  const getWeekLabel = () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + weekOffset * 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`;
    if (weekOffset === 0) return `Cette semaine (${fmt(monday)} - ${fmt(sunday)})`;
    if (weekOffset === 1) return `Semaine prochaine (${fmt(monday)} - ${fmt(sunday)})`;
    if (weekOffset === -1) return `Semaine derniere (${fmt(monday)} - ${fmt(sunday)})`;
    return `${fmt(monday)} - ${fmt(sunday)}`;
  };

  const renderRdvCard = (rdv: Appointment) => {
    const prospect = getProspect(rdv.prospect_id);
    const commercial = state.commerciaux.find(c => c.id === rdv.commercial_id);
    const prospecteurCard = rdv.prospecteur_id ? state.commerciaux.find(c => c.id === rdv.prospecteur_id) : null;
    return (
      <div key={rdv.id} className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition-shadow">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-sm text-gray-900">{prospect?.nom_etablissement || 'Inconnu'}</h4>
            <p className="text-xs text-gray-500 mt-0.5">{prospect?.nom_contact}</p>
          </div>
          <span className={`badge text-[10px] ${statusColors[rdv.statut]}`}>
            {APPOINTMENT_STATUS_LABELS[rdv.statut]}
          </span>
        </div>
        <div className="mt-3 space-y-1.5 text-xs text-gray-600">
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-gray-400" />
            {formatDate(rdv.date)} de {rdv.heure_debut} a {rdv.heure_fin}
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 text-gray-400" />
            {rdv.lieu ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rdv.lieu)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline flex items-center gap-1"
                onClick={e => e.stopPropagation()}
              >
                {rdv.lieu}
                <Navigation className="w-3 h-3" />
              </a>
            ) : 'Non defini'}
          </div>
          {rdv.notes && (
            <p className="text-gray-500 bg-gray-50 p-2 rounded">{rdv.notes}</p>
          )}
          <p className="text-[10px] text-gray-400 flex items-center gap-1">
            <Users className="w-3 h-3" /> {commercial?.prenom} {commercial?.nom}
          </p>
          {prospecteurCard && prospecteurCard.id !== commercial?.id && (
            <p className="text-[10px] text-purple-400 flex items-center gap-1">
              <Phone className="w-3 h-3" /> Pris par {prospecteurCard.prenom} {prospecteurCard.nom}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button
            className="p-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600"
            onClick={() => openEditForm(rdv)}
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          {prospect && (
            <button
              className="p-1.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-600"
              onClick={() => downloadICS(rdv, prospect)}
              title="Ajouter a l'agenda"
            >
              <CalendarPlus className="w-3.5 h-3.5" />
            </button>
          )}
          {rdv.statut !== 'termine' && (
            <button
              className="p-1.5 rounded bg-green-50 hover:bg-green-100 text-green-600"
              onClick={() => dispatch({ type: 'UPDATE_APPOINTMENT', payload: { ...rdv, statut: 'confirme' } })}
              title="Confirmer"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            className="p-1.5 rounded bg-red-50 hover:bg-red-100 text-red-500"
            onClick={() => deleteAppointment(rdv.id)}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  };

  const activeFilterCount = (filterStatus ? 1 : 0) + (filterCommercial ? 1 : 0) + (filterProspecteur ? 1 : 0);

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Rendez-vous</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">Gestion des RDV et export calendrier</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Toggle Liste / Planning / Agenda */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 text-[10px] sm:text-xs font-medium flex items-center gap-1 sm:gap-1.5 ${viewMode === 'list' ? 'bg-brewery-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              onClick={() => setViewMode('list')}
            >
              <List className="w-3.5 h-3.5" /> Liste
            </button>
            <button
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 text-[10px] sm:text-xs font-medium flex items-center gap-1 sm:gap-1.5 ${viewMode === 'planning' ? 'bg-brewery-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              onClick={() => setViewMode('planning')}
            >
              <CalendarDays className="w-3.5 h-3.5" /> Planning
            </button>
            <button
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 text-[10px] sm:text-xs font-medium flex items-center gap-1 sm:gap-1.5 ${viewMode === 'agenda' ? 'bg-brewery-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              onClick={() => setViewMode('agenda')}
            >
              <LayoutGrid className="w-3.5 h-3.5" /> Agenda
            </button>
          </div>
          <button
            className="bg-blue-50 text-blue-700 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg hover:bg-blue-100 flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-sm font-medium"
            onClick={openExportModal}
            title="Exporter vers Google Agenda"
          >
            <CalendarPlus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Export Agenda</span>
          </button>
          <button
            className="bg-brewery-600 text-white px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg hover:bg-brewery-700 flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-sm font-medium"
            onClick={openNewForm}
          >
            <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> RDV
          </button>
        </div>
      </div>

      {/* Filtres */}
      <div className="space-y-3">
        {/* Filtre par statut */}
        <div className="flex gap-2 flex-wrap items-center">
          <button
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${!filterStatus ? 'bg-brewery-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            onClick={() => setFilterStatus('')}
          >
            Tous ({state.appointments.length})
          </button>
          {(Object.keys(APPOINTMENT_STATUS_LABELS) as AppointmentStatus[]).map(status => (
            <button
              key={status}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filterStatus === status ? 'bg-brewery-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              onClick={() => setFilterStatus(filterStatus === status ? '' : status)}
            >
              {APPOINTMENT_STATUS_LABELS[status]}
            </button>
          ))}
        </div>

        {/* Filtre par commercial */}
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-xs font-medium text-gray-500 flex items-center gap-1">
            <Users className="w-3.5 h-3.5" /> Commercial :
          </span>
          <button
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${!filterCommercial ? 'bg-brewery-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            onClick={() => setFilterCommercial('')}
          >
            Tous
          </button>
          {state.commerciaux.map(c => {
            const count = state.appointments.filter(a => a.commercial_id === c.id).length;
            return (
              <button
                key={c.id}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  filterCommercial === c.id ? 'bg-brewery-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                onClick={() => setFilterCommercial(filterCommercial === c.id ? '' : c.id)}
              >
                {c.prenom} {c.nom}
                <span className={`text-[10px] rounded-full w-4 h-4 flex items-center justify-center ${
                  filterCommercial === c.id ? 'bg-white/20' : 'bg-gray-200'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
          {activeFilterCount > 0 && (
            <button
              className="text-[10px] text-red-500 hover:text-red-700 font-medium ml-1"
              onClick={() => { setFilterStatus(''); setFilterCommercial(''); setFilterProspecteur(''); }}
            >
              Reinitialiser
            </button>
          )}
        </div>

        {/* Filtre par prospecteur (celui qui a pris le RDV) */}
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-xs font-medium text-gray-500 flex items-center gap-1">
            <Phone className="w-3.5 h-3.5" /> Pris par :
          </span>
          <button
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${!filterProspecteur ? 'bg-brewery-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            onClick={() => setFilterProspecteur('')}
          >
            Tous
          </button>
          {state.commerciaux.map(c => {
            const count = state.appointments.filter(a => a.prospecteur_id === c.id).length;
            if (count === 0) return null;
            return (
              <button
                key={c.id}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  filterProspecteur === c.id ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                onClick={() => setFilterProspecteur(filterProspecteur === c.id ? '' : c.id)}
              >
                {c.prenom} {c.nom}
                <span className={`text-[10px] rounded-full w-4 h-4 flex items-center justify-center ${
                  filterProspecteur === c.id ? 'bg-white/20' : 'bg-gray-200'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ===================== PLANNING VIEW ===================== */}
      {viewMode === 'planning' && (() => {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const monday = new Date(now);
        monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + weekOffset * 7);

        const days: { label: string; shortLabel: string; date: string; isToday: boolean }[] = [];
        const joursSemaine = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
        const joursShort = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
        for (let i = 0; i < 7; i++) {
          const d = new Date(monday);
          d.setDate(monday.getDate() + i);
          const dateStr = d.toISOString().split('T')[0];
          const todayStr = new Date().toISOString().split('T')[0];
          days.push({
            label: `${joursSemaine[i]} ${d.getDate()}/${d.getMonth() + 1}`,
            shortLabel: `${joursShort[i]} ${d.getDate()}/${d.getMonth() + 1}`,
            date: dateStr,
            isToday: dateStr === todayStr,
          });
        }

        // Filter appointments for this week
        const weekStart = days[0].date;
        const weekEnd = days[6].date;
        let planningRdvs = state.appointments.filter(
          a => a.date >= weekStart && a.date <= weekEnd && a.statut !== 'annule'
        );
        if (filterCommercial) planningRdvs = planningRdvs.filter(a => a.commercial_id === filterCommercial);
        if (filterProspecteur) planningRdvs = planningRdvs.filter(a => a.prospecteur_id === filterProspecteur);
        if (filterStatus) planningRdvs = planningRdvs.filter(a => a.statut === filterStatus);

        return (
          <div className="space-y-3">
            {/* Week navigation */}
            <div className="flex items-center justify-between">
              <button
                className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600"
                onClick={() => setWeekOffset(w => w - 1)}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-900">{getWeekLabel()}</p>
                {weekOffset !== 0 && (
                  <button
                    className="text-[10px] text-brewery-600 hover:underline mt-0.5"
                    onClick={() => setWeekOffset(0)}
                  >
                    Revenir a cette semaine
                  </button>
                )}
              </div>
              <button
                className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600"
                onClick={() => setWeekOffset(w => w + 1)}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Planning par jour */}
            <div className="space-y-2">
              {days.map(day => {
                const dayRdvs = planningRdvs
                  .filter(a => a.date === day.date)
                  .sort((a, b) => a.heure_debut.localeCompare(b.heure_debut));

                return (
                  <div key={day.date} className={`rounded-xl border ${day.isToday ? 'border-brewery-300 bg-brewery-50/50' : 'border-gray-200 bg-white'}`}>
                    {/* En-tete du jour */}
                    <div className={`px-4 py-2.5 border-b flex items-center justify-between ${day.isToday ? 'border-brewery-200 bg-brewery-100/50' : 'border-gray-100 bg-gray-50'}`}>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold ${day.isToday ? 'text-brewery-700' : 'text-gray-900'}`}>
                          <span className="hidden sm:inline">{day.label}</span>
                          <span className="sm:hidden">{day.shortLabel}</span>
                        </span>
                        {day.isToday && (
                          <span className="text-[9px] bg-brewery-600 text-white px-1.5 py-0.5 rounded-full font-medium">Aujourd'hui</span>
                        )}
                      </div>
                      <span className="text-[10px] text-gray-400">{dayRdvs.length} RDV</span>
                    </div>

                    {/* Evenements du jour */}
                    <div className="p-2">
                      {dayRdvs.length > 0 ? (
                        <div className="space-y-2">
                          {dayRdvs.map(rdv => {
                            const prospect = getProspect(rdv.prospect_id);
                            const commercial = state.commerciaux.find(c => c.id === rdv.commercial_id);
                            const prospecteur = rdv.prospecteur_id ? state.commerciaux.find(c => c.id === rdv.prospecteur_id) : null;
                            const statusColor = rdv.statut === 'confirme' ? 'border-l-green-500 bg-green-50/50' : rdv.statut === 'termine' ? 'border-l-gray-400 bg-gray-50' : 'border-l-blue-500 bg-blue-50/30';

                            return (
                              <div key={rdv.id} className={`rounded-lg border border-gray-200 border-l-4 ${statusColor} p-3`}>
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <h4 className="font-semibold text-sm text-gray-900 truncate">{prospect?.nom_etablissement || 'Inconnu'}</h4>
                                      <span className={`badge text-[9px] ${statusColors[rdv.statut]}`}>
                                        {APPOINTMENT_STATUS_LABELS[rdv.statut]}
                                      </span>
                                    </div>
                                    {prospect?.nom_contact && (
                                      <p className="text-[11px] text-gray-500 mt-0.5">{prospect.nom_contact}</p>
                                    )}
                                    <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs text-gray-600">
                                      <span className="flex items-center gap-1 font-medium">
                                        <Clock className="w-3 h-3 text-gray-400" />
                                        {rdv.heure_debut} - {rdv.heure_fin}
                                      </span>
                                      {rdv.lieu && (
                                        <a
                                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rdv.lieu)}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="flex items-center gap-1 text-blue-600 hover:underline"
                                        >
                                          <MapPin className="w-3 h-3" />
                                          <span className="truncate max-w-[150px] sm:max-w-none">{rdv.lieu}</span>
                                          <Navigation className="w-2.5 h-2.5 flex-shrink-0" />
                                        </a>
                                      )}
                                      <span className="flex items-center gap-1 text-gray-400">
                                        <Users className="w-3 h-3" />
                                        {commercial?.prenom}
                                      </span>
                                      {prospecteur && prospecteur.id !== commercial?.id && (
                                        <span className="flex items-center gap-1 text-purple-400">
                                          <Phone className="w-3 h-3" />
                                          Pris par {prospecteur.prenom}
                                        </span>
                                      )}
                                    </div>
                                    {rdv.notes && (
                                      <p className="text-[11px] text-gray-500 mt-1.5 italic bg-white/60 rounded px-2 py-1">{rdv.notes}</p>
                                    )}
                                  </div>

                                  {/* Actions */}
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <button
                                      className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                                      onClick={() => openEditForm(rdv)}
                                      title="Modifier"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    {prospect && (
                                      <button
                                        className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors"
                                        onClick={() => downloadICS(rdv, prospect)}
                                        title="Exporter vers agenda"
                                      >
                                        <CalendarPlus className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    {rdv.lieu && (
                                      <a
                                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rdv.lieu)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-600 transition-colors"
                                        title="Google Maps"
                                      >
                                        <Navigation className="w-3.5 h-3.5" />
                                      </a>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-center text-[11px] text-gray-400 py-2">Aucun rendez-vous</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ===================== AGENDA VIEW ===================== */}
      {viewMode === 'agenda' && (
        <div className="space-y-3">
          {/* Week navigation */}
          <div className="flex items-center justify-between">
            <button
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600"
              onClick={() => setWeekOffset(w => w - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-center">
              <p className="text-sm font-semibold text-gray-900">{getWeekLabel()}</p>
              {weekOffset !== 0 && (
                <button
                  className="text-[10px] text-brewery-600 hover:underline mt-0.5"
                  onClick={() => setWeekOffset(0)}
                >
                  Revenir a cette semaine
                </button>
              )}
            </div>
            <button
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600"
              onClick={() => setWeekOffset(w => w + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Agenda grid */}
          <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
          <div className="min-w-[700px]">
          <CommercialAgenda
            appointments={state.appointments}
            commerciaux={state.commerciaux}
            getProspect={getProspect}
            filterCommercial={filterCommercial}
            weekOffset={weekOffset}
            onEditRdv={openEditForm}
          />
          </div>
          </div>
        </div>
      )}

      {/* ===================== LIST VIEW ===================== */}
      {viewMode === 'list' && (
        <>
          {/* Upcoming */}
          {upcoming.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">A venir ({upcoming.length})</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {upcoming.map(renderRdvCard)}
              </div>
            </div>
          )}

          {/* Past */}
          {past.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-700 mb-3">Passes / Termines ({past.length})</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-75">
                {past.map(renderRdvCard)}
              </div>
            </div>
          )}

          {appointments.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Aucun rendez-vous</p>
            </div>
          )}
        </>
      )}

      {/* Export modal */}
      {showExportModal && (
        <div className="modal-backdrop" onClick={() => setShowExportModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <CalendarPlus className="w-5 h-5 text-blue-600" /> Export Google Agenda
              </h3>
              <button className="p-1 rounded hover:bg-gray-100" onClick={() => setShowExportModal(false)}>
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Periode */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Periode</label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Du</label>
                    <input
                      type="date"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      value={exportDateFrom}
                      onChange={e => setExportDateFrom(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Au</label>
                    <input
                      type="date"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      value={exportDateTo}
                      onChange={e => setExportDateTo(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Commercial */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" /> Commercial
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={exportCommercial}
                  onChange={e => setExportCommercial(e.target.value)}
                >
                  <option value="">Tous les commerciaux</option>
                  {state.commerciaux.map(c => (
                    <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
                  ))}
                </select>
              </div>

              {/* Apercu */}
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs font-medium text-gray-700 mb-2">
                  {exportPreview.length} rendez-vous a exporter
                </p>
                {exportPreview.length > 0 ? (
                  <div className="max-h-40 overflow-y-auto space-y-1.5">
                    {exportPreview.map(rdv => {
                      const prospect = getProspect(rdv.prospect_id);
                      const commercial = state.commerciaux.find(c => c.id === rdv.commercial_id);
                      return (
                        <div key={rdv.id} className="flex items-center justify-between text-[11px] text-gray-600 bg-white rounded px-2 py-1.5">
                          <div className="flex-1 min-w-0">
                            <span className="font-medium">{prospect?.nom_etablissement || 'Inconnu'}</span>
                            <span className="text-gray-400 ml-1.5">{commercial?.prenom}</span>
                          </div>
                          <span className="text-gray-400 whitespace-nowrap ml-2">
                            {formatDate(rdv.date)} {rdv.heure_debut}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400 italic">Aucun RDV sur cette periode</p>
                )}
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
              <button
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                onClick={() => setShowExportModal(false)}
              >
                Annuler
              </button>
              <button
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={executeExportICS}
                disabled={exportPreview.length === 0}
              >
                <Download className="w-4 h-4" /> Exporter ({exportPreview.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">{editing ? 'Modifier le RDV' : 'Nouveau RDV'}</h3>
              <button className="p-1 rounded hover:bg-gray-100" onClick={() => setShowForm(false)}>
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Prospect *</label>
                <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.prospect_id} onChange={e => setFormData(prev => ({ ...prev, prospect_id: e.target.value }))}>
                  <option value="">Selectionnez</option>
                  {state.prospects.map(p => (<option key={p.id} value={p.id}>{p.nom_etablissement}</option>))}
                </select>
              </div>
              {/* Selecteur prospecteur + commercial */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5" /> Pris par
                  </label>
                  <select
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    value={formData.prospecteur_id}
                    onChange={e => setFormData(prev => ({ ...prev, prospecteur_id: e.target.value }))}
                  >
                    {state.commerciaux.map(c => (
                      <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" /> Commercial assigne
                  </label>
                  <select
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    value={formData.commercial_id}
                    onChange={e => setFormData(prev => ({ ...prev, commercial_id: e.target.value }))}
                  >
                    {state.commerciaux.map(c => (
                      <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
                  <input type="date" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.date} onChange={e => setFormData(prev => ({ ...prev, date: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Debut</label>
                  <input type="time" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.heure_debut} onChange={e => setFormData(prev => ({ ...prev, heure_debut: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Fin</label>
                  <input type="time" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.heure_fin} onChange={e => setFormData(prev => ({ ...prev, heure_fin: e.target.value }))} />
                </div>
              </div>
              {/* Alerte conflit */}
              {formConflicts.length > 0 && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-xs text-red-700 font-medium flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4" /> Conflit horaire pour ce commercial !
                  </p>
                  {formConflicts.map(c => {
                    const cp = getProspect(c.prospect_id);
                    return (
                      <p key={c.id} className="text-[11px] text-red-600 mt-1">
                        {formatDate(c.date)} {c.heure_debut}-{c.heure_fin} : {cp?.nom_etablissement || 'RDV'}
                      </p>
                    );
                  })}
                  <p className="text-[10px] text-red-500 mt-1 italic">
                    Ce commercial a deja un RDV sur ce creneau.
                  </p>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Lieu</label>
                <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.lieu} onChange={e => setFormData(prev => ({ ...prev, lieu: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Statut</label>
                <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.statut} onChange={e => setFormData(prev => ({ ...prev, statut: e.target.value as AppointmentStatus }))}>
                  {(Object.keys(APPOINTMENT_STATUS_LABELS) as AppointmentStatus[]).map(s => (
                    <option key={s} value={s}>{APPOINTMENT_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm h-20 resize-none" value={formData.notes} onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))} />
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
              <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setShowForm(false)}>Annuler</button>
              <button className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2" onClick={saveAppointment}>
                <Save className="w-4 h-4" /> {editing ? 'Modifier' : 'Creer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
