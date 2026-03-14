import { useState, useMemo } from 'react';
import {
  Calendar, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, MapPin, Clock,
  CheckCircle2, AlertCircle, Save, Building2,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import {
  Appointment, Client, Interaction,
  APPOINTMENT_RESULT_LABELS,
  AppointmentResult,
} from '../types';
import { generateId } from '../utils/helpers';

const DAY_LABELS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const DAY_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MONTH_LABELS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];

type ViewMode = 'jour' | 'semaine' | 'mois' | 'periode';

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function getMonday(d: Date): Date {
  const result = new Date(d);
  const day = result.getDay();
  result.setDate(result.getDate() - ((day + 6) % 7));
  return result;
}

function getWeekDaysFrom(monday: Date): { label: string; short: string; date: string; isToday: boolean }[] {
  const todayStr = toDateStr(new Date());
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = toDateStr(d);
    days.push({
      label: DAY_LABELS[d.getDay()],
      short: DAY_SHORT[d.getDay()],
      date: dateStr,
      isToday: dateStr === todayStr,
    });
  }
  return days;
}

function getDaysInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const d = new Date(start + 'T12:00:00');
  const endD = new Date(end + 'T12:00:00');
  while (d <= endD) {
    dates.push(toDateStr(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

export default function CompteRenduPage() {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const todayStr = toDateStr(new Date());

  const [viewMode, setViewMode] = useState<ViewMode>('jour');
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [periodeStart, setPeriodeStart] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-01-01`;
  });
  const [periodeEnd, setPeriodeEnd] = useState(todayStr);
  const [expandedRdv, setExpandedRdv] = useState<string | null>(null);
  const [expandedVisit, setExpandedVisit] = useState<string | null>(null);
  const [crForms, setCrForms] = useState<Record<string, { compte_rendu: AppointmentResult; notes: string }>>({});
  const [visitComments, setVisitComments] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const userId = state.currentUser?.id;

  // Week navigation
  const currentMonday = useMemo(() => {
    const m = getMonday(new Date());
    m.setDate(m.getDate() + weekOffset * 7);
    return m;
  }, [weekOffset]);
  const weekDays = useMemo(() => getWeekDaysFrom(currentMonday), [currentMonday]);

  // Tournee config
  const myTourneeConfig = state.tourneeConfigs?.find((tc: any) => tc.commercial_id === userId);
  const parsedConfig = useMemo(() => {
    if (!myTourneeConfig?.config) return {};
    if (typeof myTourneeConfig.config === 'string') {
      try { return JSON.parse(myTourneeConfig.config); } catch { return {}; }
    }
    return myTourneeConfig.config;
  }, [myTourneeConfig?.config]);

  const getZonesForDate = (dateStr: string): string[] => {
    const dow = new Date(dateStr + 'T12:00:00').getDay().toString();
    return Array.isArray(parsedConfig[dow]) ? parsedConfig[dow] : [];
  };

  // Date range for current view
  const dateRange = useMemo((): { start: string; end: string; dates: string[] } => {
    if (viewMode === 'jour') {
      return { start: selectedDate, end: selectedDate, dates: [selectedDate] };
    }
    if (viewMode === 'semaine') {
      const start = weekDays[0].date;
      const end = weekDays[6].date;
      return { start, end, dates: weekDays.map(d => d.date) };
    }
    if (viewMode === 'mois') {
      const [y, m] = selectedMonth.split('-').map(Number);
      const start = `${y}-${String(m).padStart(2, '0')}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return { start, end, dates: getDaysInRange(start, end) };
    }
    // periode
    return { start: periodeStart, end: periodeEnd, dates: getDaysInRange(periodeStart, periodeEnd) };
  }, [viewMode, selectedDate, weekDays, selectedMonth, periodeStart, periodeEnd]);

  // RDVs in range
  const rangeAppointments = useMemo(() => {
    return state.appointments.filter((a: Appointment) =>
      a.date >= dateRange.start && a.date <= dateRange.end &&
      (a.commercial_id === userId || a.prospecteur_id === userId)
    ).sort((a: Appointment, b: Appointment) => a.date.localeCompare(b.date) || (a.heure_debut || '').localeCompare(b.heure_debut || ''));
  }, [state.appointments, dateRange, userId]);

  // Interactions in range
  const rangeInteractions = useMemo(() => {
    return state.interactions.filter((i: Interaction) =>
      i.date.substring(0, 10) >= dateRange.start && i.date.substring(0, 10) <= dateRange.end &&
      i.commercial_id === userId
    );
  }, [state.interactions, dateRange, userId]);

  // Stats
  const stats = useMemo(() => {
    const totalRdv = rangeAppointments.length;
    const rdvWithCR = rangeAppointments.filter(a => !!a.compte_rendu).length;
    const totalVisites = rangeInteractions.length;
    const resultCounts: Record<string, number> = {};
    rangeAppointments.forEach(a => {
      if (a.compte_rendu) resultCounts[a.compte_rendu] = (resultCounts[a.compte_rendu] || 0) + 1;
    });
    return { totalRdv, rdvWithCR, totalVisites, resultCounts };
  }, [rangeAppointments, rangeInteractions]);

  // Group by day for week/month/period views
  const dayGroups = useMemo(() => {
    if (viewMode === 'jour') return [];
    const groups: { date: string; label: string; rdvs: Appointment[]; visites: Interaction[]; zones: string[] }[] = [];
    for (const dateStr of dateRange.dates) {
      const d = new Date(dateStr + 'T12:00:00');
      const rdvs = rangeAppointments.filter(a => a.date === dateStr);
      const visites = rangeInteractions.filter(i => i.date.substring(0, 10) === dateStr);
      if (rdvs.length === 0 && visites.length === 0) continue;
      groups.push({
        date: dateStr,
        label: `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_LABELS[d.getMonth()].substring(0, 3)}`,
        rdvs,
        visites,
        zones: getZonesForDate(dateStr),
      });
    }
    return groups;
  }, [viewMode, dateRange, rangeAppointments, rangeInteractions]);

  // Day view data
  const selectedDow = new Date(selectedDate + 'T12:00:00').getDay().toString();
  const dayZones = getZonesForDate(selectedDate);

  const dayAppointments = useMemo(() => {
    return state.appointments.filter((a: Appointment) =>
      a.date === selectedDate &&
      (a.commercial_id === userId || a.prospecteur_id === userId)
    ).sort((a: Appointment, b: Appointment) => (a.heure_debut || '').localeCompare(b.heure_debut || ''));
  }, [state.appointments, selectedDate, userId]);

  const clientsToVisit = useMemo(() => {
    if (dayZones.length === 0) return [];
    return state.clients.filter((c: Client) =>
      c.commercial_id === userId && c.statut === 'ACTIF' && dayZones.includes(c.tournee)
    ).sort((a: Client, b: Client) => a.nom.localeCompare(b.nom));
  }, [state.clients, dayZones, userId]);

  const todayInteractions = useMemo(() => {
    return state.interactions.filter((i: Interaction) =>
      i.date.startsWith(selectedDate) && i.commercial_id === userId
    );
  }, [state.interactions, selectedDate, userId]);

  const visitedClientIds = new Set(todayInteractions.map((i: Interaction) => i.client_id));

  // Actions
  const saveCompteRendu = async (rdv: Appointment) => {
    const form = crForms[rdv.id];
    if (!form) return;
    setSaving(rdv.id);
    try {
      const updated = { ...rdv, statut: 'termine' as const, compte_rendu: form.compte_rendu, notes_compte_rendu: form.notes };
      const token = localStorage.getItem('suivipro_token');
      const res = await fetch(`/api/appointments/${rdv.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(updated),
      });
      if (res.ok) {
        dispatch({ type: 'UPDATE_APPOINTMENT', payload: updated });
        toast.success('Compte rendu enregistre');
        setExpandedRdv(null);
      }
    } catch { toast.error('Erreur lors de la sauvegarde'); }
    finally { setSaving(null); }
  };

  const logVisit = async (client: Client, comment: string) => {
    setSaving(client.id);
    try {
      const interaction = {
        id: generateId(), client_id: client.id, commercial_id: userId!,
        type: 'VISITE' as const, date: new Date().toISOString(),
        comment: comment || '', date_creation: new Date().toISOString(),
      };
      const token = localStorage.getItem('suivipro_token');
      const res = await fetch('/api/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(interaction),
      });
      if (res.ok) {
        dispatch({ type: 'ADD_INTERACTION', payload: interaction });
        toast.success(`Visite enregistree pour ${client.nom}`);
        setExpandedVisit(null);
        setVisitComments(prev => ({ ...prev, [client.id]: '' }));
      }
    } catch { toast.error('Erreur lors de la sauvegarde'); }
    finally { setSaving(null); }
  };

  const getProspectName = (id: string) => state.prospects.find((p: any) => p.id === id)?.nom_etablissement || '';
  const getClientName = (id: string) => state.clients.find((c: Client) => c.id === id)?.nom || '';
  const getEntityName = (rdv: Appointment) => (rdv.client_id ? getClientName(rdv.client_id) : '') || (rdv.prospect_id ? getProspectName(rdv.prospect_id) : '') || 'N/A';

  // RDV card (reusable for day and expanded day views)
  const renderRdvCard = (rdv: Appointment) => {
    const isExpanded = expandedRdv === rdv.id;
    const hasCR = !!rdv.compte_rendu;
    const entityName = getEntityName(rdv);
    return (
      <div key={rdv.id} className={`bg-white rounded-xl border ${hasCR ? 'border-green-200 bg-green-50/30' : 'border-gray-200'} overflow-hidden`}>
        <button
          onClick={() => {
            setExpandedRdv(isExpanded ? null : rdv.id);
            if (!isExpanded && !crForms[rdv.id]) {
              setCrForms(prev => ({ ...prev, [rdv.id]: { compte_rendu: (rdv.compte_rendu || '') as AppointmentResult, notes: rdv.notes_compte_rendu || '' } }));
            }
          }}
          className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50"
        >
          {hasCR ? <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 text-orange-400 flex-shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm text-gray-800 truncate">{entityName}</span>
              {hasCR && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">{APPOINTMENT_RESULT_LABELS[rdv.compte_rendu!] || rdv.compte_rendu}</span>}
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
              {rdv.heure_debut && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{rdv.heure_debut}{rdv.heure_fin ? ` - ${rdv.heure_fin}` : ''}</span>}
              {rdv.lieu && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{rdv.lieu}</span>}
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </button>
        {isExpanded && (
          <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
            {rdv.notes && <p className="text-xs text-gray-500 italic bg-gray-50 rounded-lg p-2">{rdv.notes}</p>}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Resultat du RDV</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {Object.entries(APPOINTMENT_RESULT_LABELS).map(([key, label]) => {
                  const sel = crForms[rdv.id]?.compte_rendu === key;
                  const colors: Record<string, string> = {
                    client: 'border-green-300 bg-green-50 text-green-700', mail_envoye: 'border-blue-300 bg-blue-50 text-blue-700',
                    commande_plus_tard: 'border-yellow-300 bg-yellow-50 text-yellow-700', a_relancer: 'border-orange-300 bg-orange-50 text-orange-700',
                    pas_interesse: 'border-red-300 bg-red-50 text-red-700',
                  };
                  return (
                    <button key={key}
                      onClick={() => setCrForms(prev => ({ ...prev, [rdv.id]: { ...prev[rdv.id], compte_rendu: key as AppointmentResult } }))}
                      className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-all ${sel ? colors[key] || 'border-gray-300 bg-gray-50' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                    >{label}</button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Notes</label>
              <textarea value={crForms[rdv.id]?.notes || ''} onChange={e => setCrForms(prev => ({ ...prev, [rdv.id]: { ...prev[rdv.id], notes: e.target.value } }))}
                placeholder="Notes sur le RDV..." className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 resize-none h-20" />
            </div>
            <button onClick={() => saveCompteRendu(rdv)} disabled={saving === rdv.id || !crForms[rdv.id]?.compte_rendu}
              className="w-full py-2 bg-brewery-600 text-white rounded-lg text-sm font-medium hover:bg-brewery-700 disabled:opacity-50 flex items-center justify-center gap-2">
              <Save className="w-4 h-4" />{saving === rdv.id ? 'Enregistrement...' : 'Enregistrer le compte rendu'}
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderClientCard = (client: Client) => {
    const visited = visitedClientIds.has(client.id);
    const isExpanded = expandedVisit === client.id;
    const interaction = todayInteractions.find((i: Interaction) => i.client_id === client.id);
    return (
      <div key={client.id} className={`bg-white rounded-xl border ${visited ? 'border-green-200 bg-green-50/30' : 'border-gray-200'} overflow-hidden`}>
        <button onClick={() => { if (!visited) setExpandedVisit(isExpanded ? null : client.id); }}
          className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50">
          {visited ? <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" /> : <div className="w-5 h-5 rounded-full border-2 border-gray-300 flex-shrink-0" />}
          <div className="flex-1 min-w-0">
            <span className="font-medium text-sm text-gray-800">{client.nom}</span>
            <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
              {client.tournee && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{client.tournee}</span>}
              {client.ville && <span>{client.ville}</span>}
            </div>
            {visited && interaction?.comment && <p className="text-xs text-green-600 mt-1 italic">{interaction.comment}</p>}
          </div>
          {!visited && <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />}
        </button>
        {isExpanded && !visited && (
          <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Commentaire de visite</label>
              <textarea value={visitComments[client.id] || ''} onChange={e => setVisitComments(prev => ({ ...prev, [client.id]: e.target.value }))}
                placeholder="Comment s'est passee la visite..." className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 resize-none h-20" />
            </div>
            <button onClick={() => logVisit(client, visitComments[client.id] || '')} disabled={saving === client.id}
              className="w-full py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
              <CheckCircle2 className="w-4 h-4" />{saving === client.id ? 'Enregistrement...' : 'Marquer comme visitee'}
            </button>
          </div>
        )}
      </div>
    );
  };

  // Preset periods
  const currentYear = new Date().getFullYear();
  const presetPeriods = [
    { label: `Annee ${currentYear}`, start: `${currentYear}-01-01`, end: `${currentYear}-12-31` },
    { label: `Annee ${currentYear - 1}`, start: `${currentYear - 1}-01-01`, end: `${currentYear - 1}-12-31` },
    { label: 'Trimestre en cours', start: (() => { const q = Math.floor(new Date().getMonth() / 3); return `${currentYear}-${String(q * 3 + 1).padStart(2, '0')}-01`; })(), end: (() => { const q = Math.floor(new Date().getMonth() / 3); const m = q * 3 + 3; return `${currentYear}-${String(m).padStart(2, '0')}-${new Date(currentYear, m, 0).getDate()}`; })() },
    { label: 'Exercice comptable', start: `${new Date().getMonth() >= 8 ? currentYear : currentYear - 1}-09-01`, end: `${new Date().getMonth() >= 8 ? currentYear + 1 : currentYear}-08-31` },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <ClipboardCheck className="w-7 h-7 text-brewery-600" />
            Compte Rendu
          </h1>
          <p className="text-sm text-gray-500 mt-1">Faites le bilan de votre activite</p>
        </div>
      </div>

      {/* View mode tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1">
        {([['jour', 'Jour'], ['semaine', 'Semaine'], ['mois', 'Mois'], ['periode', 'Periode']] as [ViewMode, string][]).map(([mode, label]) => (
          <button key={mode} onClick={() => setViewMode(mode)}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${viewMode === mode ? 'bg-white text-brewery-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Navigation by view mode */}
      {viewMode === 'jour' && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => setWeekOffset(w => w - 1)} className="p-1 rounded hover:bg-gray-100"><ChevronLeft className="w-4 h-4 text-gray-500" /></button>
            <div className="flex gap-1.5 overflow-x-auto flex-1">
              {weekDays.map(day => (
                <button key={day.date} onClick={() => setSelectedDate(day.date)}
                  className={`flex-1 min-w-[40px] py-1.5 rounded-lg text-center transition-all ${
                    day.date === selectedDate ? 'bg-brewery-600 text-white shadow-sm'
                    : day.isToday ? 'bg-brewery-50 text-brewery-700 border border-brewery-200'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                  }`}>
                  <div className="text-[10px]">{day.short}</div>
                  <div className="text-sm font-bold">{new Date(day.date + 'T12:00:00').getDate()}</div>
                </button>
              ))}
            </div>
            <button onClick={() => setWeekOffset(w => w + 1)} className="p-1 rounded hover:bg-gray-100"><ChevronRight className="w-4 h-4 text-gray-500" /></button>
          </div>
          {weekOffset !== 0 && (
            <button onClick={() => { setWeekOffset(0); setSelectedDate(todayStr); }} className="text-[10px] text-brewery-600 hover:underline">Revenir a aujourd'hui</button>
          )}
          <p className="text-sm text-gray-500 mt-1">
            {DAY_LABELS[new Date(selectedDate + 'T12:00:00').getDay()]} {new Date(selectedDate + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
            {dayZones.length > 0 && <span className="ml-2 text-brewery-600">— {dayZones.join(', ')}</span>}
          </p>
        </div>
      )}

      {viewMode === 'semaine' && (
        <div className="mb-6 flex items-center gap-3">
          <button onClick={() => setWeekOffset(w => w - 1)} className="p-1.5 rounded-lg hover:bg-gray-100 border border-gray-200"><ChevronLeft className="w-4 h-4" /></button>
          <div className="flex-1 text-center">
            <p className="text-sm font-semibold text-gray-800">
              Semaine du {new Date(weekDays[0].date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} au {new Date(weekDays[6].date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            {weekOffset !== 0 && <button onClick={() => setWeekOffset(0)} className="text-[10px] text-brewery-600 hover:underline mt-0.5">Semaine actuelle</button>}
          </div>
          <button onClick={() => setWeekOffset(w => w + 1)} className="p-1.5 rounded-lg hover:bg-gray-100 border border-gray-200"><ChevronRight className="w-4 h-4" /></button>
        </div>
      )}

      {viewMode === 'mois' && (
        <div className="mb-6 flex items-center gap-3">
          <button onClick={() => {
            const [y, m] = selectedMonth.split('-').map(Number);
            const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
            setSelectedMonth(prev);
          }} className="p-1.5 rounded-lg hover:bg-gray-100 border border-gray-200"><ChevronLeft className="w-4 h-4" /></button>
          <div className="flex-1 text-center">
            <p className="text-sm font-semibold text-gray-800">
              {MONTH_LABELS[parseInt(selectedMonth.split('-')[1]) - 1]} {selectedMonth.split('-')[0]}
            </p>
          </div>
          <button onClick={() => {
            const [y, m] = selectedMonth.split('-').map(Number);
            const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
            setSelectedMonth(next);
          }} className="p-1.5 rounded-lg hover:bg-gray-100 border border-gray-200"><ChevronRight className="w-4 h-4" /></button>
        </div>
      )}

      {viewMode === 'periode' && (
        <div className="mb-6 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {presetPeriods.map(p => (
              <button key={p.label} onClick={() => { setPeriodeStart(p.start); setPeriodeEnd(p.end); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  periodeStart === p.start && periodeEnd === p.end
                    ? 'bg-brewery-600 text-white border-brewery-600'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}>{p.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Du</label>
            <input type="date" value={periodeStart} onChange={e => setPeriodeStart(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1" />
            <label className="text-xs text-gray-500">au</label>
            <input type="date" value={periodeEnd} onChange={e => setPeriodeEnd(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1" />
          </div>
        </div>
      )}

      {/* Stats summary (for non-day views) */}
      {viewMode !== 'jour' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <p className="text-2xl font-bold text-indigo-600">{stats.totalRdv}</p>
            <p className="text-[10px] text-gray-500">RDV total</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <p className="text-2xl font-bold text-green-600">{stats.rdvWithCR}</p>
            <p className="text-[10px] text-gray-500">Comptes rendus</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <p className="text-2xl font-bold text-cyan-600">{stats.totalVisites}</p>
            <p className="text-[10px] text-gray-500">Visites clients</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <p className="text-2xl font-bold text-orange-600">
              {stats.totalRdv > 0 ? Math.round((stats.rdvWithCR / stats.totalRdv) * 100) : 0}%
            </p>
            <p className="text-[10px] text-gray-500">Taux CR</p>
          </div>
          {/* Result breakdown */}
          {Object.keys(stats.resultCounts).length > 0 && (
            <div className="col-span-2 sm:col-span-4 bg-white rounded-xl border border-gray-200 p-3">
              <p className="text-xs font-medium text-gray-600 mb-2">Resultats des RDV</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(stats.resultCounts).map(([key, count]) => {
                  const colors: Record<string, string> = {
                    client: 'bg-green-100 text-green-700', mail_envoye: 'bg-blue-100 text-blue-700',
                    commande_plus_tard: 'bg-yellow-100 text-yellow-700', a_relancer: 'bg-orange-100 text-orange-700',
                    pas_interesse: 'bg-red-100 text-red-700',
                  };
                  return (
                    <span key={key} className={`px-2 py-1 rounded-full text-xs font-medium ${colors[key] || 'bg-gray-100 text-gray-600'}`}>
                      {APPOINTMENT_RESULT_LABELS[key] || key}: {count}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Day view content */}
      {viewMode === 'jour' && (
        <>
          {/* RDV Section */}
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-indigo-500" />
              Rendez-vous ({dayAppointments.length})
            </h2>
            {dayAppointments.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
                <p className="text-sm text-gray-400">Aucun RDV ce jour</p>
              </div>
            ) : (
              <div className="space-y-3">{dayAppointments.map(renderRdvCard)}</div>
            )}
          </div>

          {/* Visites Section */}
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-green-600" />
              Visites Clients ({clientsToVisit.length})
              {clientsToVisit.length > 0 && (
                <span className="text-sm font-normal text-gray-500">— {visitedClientIds.size}/{clientsToVisit.length} faites</span>
              )}
            </h2>
            {clientsToVisit.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
                <p className="text-sm text-gray-400">{dayZones.length === 0 ? 'Aucune tournee configuree ce jour' : 'Aucun client dans les secteurs du jour'}</p>
              </div>
            ) : (
              <div className="space-y-2">{clientsToVisit.map(renderClientCard)}</div>
            )}
          </div>
        </>
      )}

      {/* Week / Month / Period grouped view */}
      {viewMode !== 'jour' && (
        <div className="space-y-2">
          {dayGroups.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-sm text-gray-400">Aucune activite sur cette periode</p>
            </div>
          ) : dayGroups.map(group => {
            const isOpen = expandedDay === group.date;
            const rdvDone = group.rdvs.filter(r => !!r.compte_rendu).length;
            return (
              <div key={group.date} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <button onClick={() => setExpandedDay(isOpen ? null : group.date)}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-gray-800">{group.label}</span>
                      {group.zones.length > 0 && <span className="text-[10px] text-brewery-600">{group.zones.join(', ')}</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      {group.rdvs.length > 0 && (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${rdvDone === group.rdvs.length ? 'bg-green-100 text-green-700' : 'bg-indigo-100 text-indigo-700'}`}>
                          {group.rdvs.length} RDV {rdvDone > 0 && `(${rdvDone} CR)`}
                        </span>
                      )}
                      {group.visites.length > 0 && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-700">
                          {group.visites.length} visite{group.visites.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
                    {group.rdvs.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1"><Calendar className="w-3 h-3" />RDV</p>
                        <div className="space-y-2">{group.rdvs.map(renderRdvCard)}</div>
                      </div>
                    )}
                    {group.visites.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1"><Building2 className="w-3 h-3" />Visites</p>
                        <div className="space-y-1.5">
                          {group.visites.map(v => {
                            const clientName = getClientName(v.client_id);
                            return (
                              <div key={v.id} className="flex items-center gap-2 px-3 py-2 bg-green-50 rounded-lg">
                                <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <span className="text-sm font-medium text-gray-800">{clientName || v.client_id}</span>
                                  {v.comment && <p className="text-xs text-gray-500 truncate">{v.comment}</p>}
                                </div>
                                <span className="text-[10px] text-gray-400">{v.type}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
