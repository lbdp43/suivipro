import { useState, useMemo } from 'react';
import {
  Calendar, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, MapPin, Clock,
  CheckCircle2, AlertCircle, Save, Building2, Phone, PhoneCall, AlertTriangle,
  StickyNote, X,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import {
  Appointment, Client, Interaction, InteractionType,
  APPOINTMENT_RESULT_LABELS, INTERACTION_TYPE_LABELS,
  AppointmentResult,
} from '../types';
import { generateId, detectConflicts } from '../utils/helpers';

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
  const { state, dispatch, getClient } = useApp();
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
  const [visitTypes, setVisitTypes] = useState<Record<string, InteractionType>>({});
  const [visitRdvDate, setVisitRdvDate] = useState<Record<string, string>>({});
  const [visitRdvHeureDebut, setVisitRdvHeureDebut] = useState<Record<string, string>>({});
  const [visitRdvHeureFin, setVisitRdvHeureFin] = useState<Record<string, string>>({});
  const [visitRdvLieu, setVisitRdvLieu] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [selectedCommercialId, setSelectedCommercialId] = useState<string>('');

  const [showRdvSection, setShowRdvSection] = useState(true);
  const [showVisitesSection, setShowVisitesSection] = useState(true);
  const [expandedResult, setExpandedResult] = useState<string | null>(null);

  // Quick note
  const [noteClientId, setNoteClientId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  const isAdmin = state.currentUser?.role === 'admin';
  const userId = state.currentUser?.id;

  // For admin: determine which commercial(s) to show
  // '' = current user, 'all' = everyone, otherwise specific user id
  const effectiveUserIds = useMemo(() => {
    if (!isAdmin || selectedCommercialId === '') return userId ? [userId] : [];
    if (selectedCommercialId === 'all') return state.commerciaux.map((c: any) => c.id);
    return [selectedCommercialId];
  }, [isAdmin, selectedCommercialId, userId, state.commerciaux]);

  // Week navigation
  const currentMonday = useMemo(() => {
    const m = getMonday(new Date());
    m.setDate(m.getDate() + weekOffset * 7);
    return m;
  }, [weekOffset]);
  const weekDays = useMemo(() => getWeekDaysFrom(currentMonday), [currentMonday]);

  // Tournee config - merge configs for all effective users
  const parsedConfig = useMemo(() => {
    const merged: Record<string, string[]> = {};
    for (const uid of effectiveUserIds) {
      const tc = state.tourneeConfigs?.find((t: any) => t.commercial_id === uid);
      if (!tc?.config) continue;
      const cfg = typeof tc.config === 'string' ? (() => { try { return JSON.parse(tc.config); } catch { return {}; } })() : tc.config;
      for (const [dow, zones] of Object.entries(cfg)) {
        if (!Array.isArray(zones)) continue;
        if (!merged[dow]) merged[dow] = [];
        for (const z of zones as string[]) {
          if (!merged[dow].includes(z)) merged[dow].push(z);
        }
      }
    }
    return merged;
  }, [effectiveUserIds, state.tourneeConfigs]);

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
    const uids = new Set(effectiveUserIds);
    return state.appointments.filter((a: Appointment) =>
      a.date >= dateRange.start && a.date <= dateRange.end &&
      (uids.has(a.commercial_id) || uids.has(a.prospecteur_id || ''))
    ).sort((a: Appointment, b: Appointment) => a.date.localeCompare(b.date) || (a.heure_debut || '').localeCompare(b.heure_debut || ''));
  }, [state.appointments, dateRange, effectiveUserIds]);

  // Interactions in range
  const rangeInteractions = useMemo(() => {
    const uids = new Set(effectiveUserIds);
    return state.interactions.filter((i: Interaction) =>
      i.date.substring(0, 10) >= dateRange.start && i.date.substring(0, 10) <= dateRange.end &&
      uids.has(i.commercial_id)
    );
  }, [state.interactions, dateRange, effectiveUserIds]);

  // Stats
  const stats = useMemo(() => {
    const totalRdv = rangeAppointments.length;
    const rdvWithCR = rangeAppointments.filter(a => !!a.compte_rendu).length;
    const totalVisites = rangeInteractions.length;
    const visitesParType = {
      VISITE: rangeInteractions.filter(i => i.type === 'VISITE').length,
      APPEL: rangeInteractions.filter(i => i.type === 'APPEL').length,
      RDV_PLANIFIE: rangeInteractions.filter(i => i.type === 'RDV_PLANIFIE').length,
    };
    const resultCounts: Record<string, number> = {};
    rangeAppointments.forEach(a => {
      if (a.compte_rendu) resultCounts[a.compte_rendu] = (resultCounts[a.compte_rendu] || 0) + 1;
    });
    const rdvFromProspection = rangeAppointments.filter(a => a.prospect_id && !a.client_id).length;
    const rdvClients = rangeAppointments.filter(a => !!a.client_id).length;
    return { totalRdv, rdvWithCR, totalVisites, visitesParType, resultCounts, rdvFromProspection, rdvClients };
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
    const uids = new Set(effectiveUserIds);
    return state.appointments.filter((a: Appointment) =>
      a.date === selectedDate &&
      (uids.has(a.commercial_id) || uids.has(a.prospecteur_id || ''))
    ).sort((a: Appointment, b: Appointment) => (a.heure_debut || '').localeCompare(b.heure_debut || ''));
  }, [state.appointments, selectedDate, effectiveUserIds]);

  const clientsToVisit = useMemo(() => {
    if (dayZones.length === 0) return [];
    const uids = new Set(effectiveUserIds);
    return state.clients.filter((c: Client) =>
      uids.has(c.commercial_id) && c.statut === 'ACTIF' && dayZones.includes(c.tournee)
    ).sort((a: Client, b: Client) => a.nom.localeCompare(b.nom));
  }, [state.clients, dayZones, effectiveUserIds]);

  const todayInteractions = useMemo(() => {
    const uids = new Set(effectiveUserIds);
    return state.interactions.filter((i: Interaction) =>
      i.date.startsWith(selectedDate) && uids.has(i.commercial_id)
    );
  }, [state.interactions, selectedDate, effectiveUserIds]);

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

  const logVisit = async (client: Client) => {
    const type = visitTypes[client.id] || 'VISITE';
    const comment = visitComments[client.id] || '';
    if (!comment.trim()) { toast.error('Ajoutez un commentaire'); return; }
    setSaving(client.id);
    try {
      const now = new Date().toISOString();
      const token = localStorage.getItem('suivipro_token');

      // Create interaction
      const interaction = {
        id: generateId(), client_id: client.id, commercial_id: userId!,
        type, date: type === 'RDV_PLANIFIE' && visitRdvDate[client.id] ? new Date(visitRdvDate[client.id]).toISOString() : now,
        comment: comment.trim(), date_creation: now,
      };
      const res = await fetch('/api/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(interaction),
      });
      if (!res.ok) throw new Error();
      dispatch({ type: 'ADD_INTERACTION', payload: interaction });

      // If RDV_PLANIFIE, also create an appointment
      if (type === 'RDV_PLANIFIE' && visitRdvDate[client.id]) {
        const rdvId = generateId();
        const addr = [client.adresse, client.ville].filter(Boolean).join(', ');
        const rdv = {
          id: rdvId, prospect_id: '', client_id: client.id,
          commercial_id: userId!, prospecteur_id: userId!,
          date: visitRdvDate[client.id],
          heure_debut: visitRdvHeureDebut[client.id] || '10:00',
          heure_fin: visitRdvHeureFin[client.id] || '11:00',
          lieu: visitRdvLieu[client.id] || addr,
          notes: comment.trim(), statut: 'planifie' as const,
          created_at: now,
        };
        const rdvRes = await fetch('/api/appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(rdv),
        });
        if (rdvRes.ok) dispatch({ type: 'ADD_APPOINTMENT', payload: rdv });
        toast.success(`RDV planifie pour ${client.nom}`);
      } else {
        toast.success(type === 'VISITE' ? `Visite enregistree pour ${client.nom}` : `Appel enregistre pour ${client.nom}`);
      }
      setExpandedVisit(null);
      setVisitComments(prev => ({ ...prev, [client.id]: '' }));
      setVisitTypes(prev => ({ ...prev, [client.id]: 'VISITE' }));
    } catch { toast.error('Erreur lors de la sauvegarde'); }
    finally { setSaving(null); }
  };

  const getProspectName = (id: string) => state.prospects.find((p: any) => p.id === id)?.nom_etablissement || '';
  const getClientName = (id: string) => state.clients.find((c: Client) => c.id === id)?.nom || '';
  const getEntityName = (rdv: Appointment) => (rdv.client_id ? getClientName(rdv.client_id) : '') || (rdv.prospect_id ? getProspectName(rdv.prospect_id) : '') || 'N/A';
  const getCommercialName = (id: string) => {
    const c = state.commerciaux.find((c: any) => c.id === id);
    return c ? c.prenom : '';
  };
  const isTeamView = selectedCommercialId === 'all' || (isAdmin && selectedCommercialId !== '' && selectedCommercialId !== userId);

  const openQuickNote = (clientId: string) => {
    const full = getClient(clientId);
    setNoteClientId(clientId);
    setNoteText(full?.notes || '');
  };
  const saveQuickNote = async () => {
    if (!noteClientId) return;
    const full = getClient(noteClientId);
    if (!full) return;
    setNoteSaving(true);
    try {
      const updated: Client = { ...full, notes: noteText, date_modification: new Date().toISOString() };
      const token = localStorage.getItem('suivipro_token');
      await fetch(`/api/clients/${noteClientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(updated),
      });
      dispatch({ type: 'UPDATE_CLIENT', payload: updated });
      toast.success('Note enregistree');
      setNoteClientId(null);
    } catch { toast.error('Erreur lors de la sauvegarde'); }
    finally { setNoteSaving(false); }
  };

  // RDV card (reusable for day and expanded day views)
  const renderRdvCard = (rdv: Appointment) => {
    const isExpanded = expandedRdv === rdv.id;
    const hasCR = !!rdv.compte_rendu;
    const entityName = getEntityName(rdv);
    const rdvOwner = isTeamView ? getCommercialName(rdv.commercial_id) : '';
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
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm text-gray-800 truncate">{entityName}</span>
              {rdvOwner && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{rdvOwner}</span>
              )}
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
    const currentType = visitTypes[client.id] || 'VISITE';
    const addr = [client.adresse, client.ville].filter(Boolean).join(', ');
    const clientOwner = isTeamView ? getCommercialName(client.commercial_id) : '';
    return (
      <div key={client.id} className={`bg-white rounded-xl border ${visited ? 'border-green-200 bg-green-50/30' : 'border-gray-200'} overflow-hidden`}>
        <button onClick={() => {
          if (!visited) {
            setExpandedVisit(isExpanded ? null : client.id);
            if (!isExpanded) {
              // Init RDV fields with defaults
              if (!visitRdvDate[client.id]) setVisitRdvDate(prev => ({ ...prev, [client.id]: todayStr }));
              if (!visitRdvLieu[client.id]) setVisitRdvLieu(prev => ({ ...prev, [client.id]: addr }));
              if (!visitRdvHeureDebut[client.id]) setVisitRdvHeureDebut(prev => ({ ...prev, [client.id]: '10:00' }));
              if (!visitRdvHeureFin[client.id]) setVisitRdvHeureFin(prev => ({ ...prev, [client.id]: '11:00' }));
            }
          }
        }}
          className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50">
          {visited ? <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" /> : <div className="w-5 h-5 rounded-full border-2 border-gray-300 flex-shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm text-gray-800">{client.nom}</span>
              {clientOwner && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{clientOwner}</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
              {client.tournee && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{client.tournee}</span>}
              {client.ville && <span>{client.ville}</span>}
            </div>
            {visited && interaction && (
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  interaction.type === 'VISITE' ? 'bg-green-100 text-green-700'
                  : interaction.type === 'APPEL' ? 'bg-blue-100 text-blue-700'
                  : 'bg-purple-100 text-purple-700'
                }`}>{INTERACTION_TYPE_LABELS[interaction.type]}</span>
                {interaction.comment && <p className="text-xs text-gray-500 italic truncate">{interaction.comment}</p>}
              </div>
            )}
            {client.notes && (
              <div className="flex items-start gap-1 mt-1 px-2 py-0.5 bg-yellow-50 border border-yellow-200 rounded text-[10px] text-yellow-800">
                <StickyNote className="w-3 h-3 mt-0.5 flex-shrink-0 text-yellow-500" />
                <span className="line-clamp-1">{client.notes}</span>
              </div>
            )}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); openQuickNote(client.id); }}
            className="p-1.5 rounded-lg bg-yellow-50 text-yellow-600 hover:bg-yellow-100 transition-colors flex-shrink-0"
            title="Note rapide"
          >
            <StickyNote className="w-4 h-4" />
          </button>
          {!visited && <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />}
        </button>
        {isExpanded && !visited && (
          <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
            {/* Type selector */}
            <div className="grid grid-cols-3 gap-2">
              {(['VISITE', 'APPEL', 'RDV_PLANIFIE'] as InteractionType[]).map(type => {
                const sel = currentType === type;
                const typeConfig = {
                  VISITE: { color: sel ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200', icon: CheckCircle2 },
                  APPEL: { color: sel ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200', icon: PhoneCall },
                  RDV_PLANIFIE: { color: sel ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200', icon: Calendar },
                };
                const cfg = typeConfig[type];
                const Icon = cfg.icon;
                return (
                  <button key={type} onClick={() => setVisitTypes(prev => ({ ...prev, [client.id]: type }))}
                    className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-semibold transition-colors ${cfg.color}`}>
                    <Icon className="w-4 h-4" />
                    {INTERACTION_TYPE_LABELS[type]}
                  </button>
                );
              })}
            </div>

            {/* RDV fields */}
            {currentType === 'RDV_PLANIFIE' && (
              <div className="space-y-2 p-3 bg-purple-50 rounded-lg border border-purple-100">
                {/* RDV existants ce jour */}
                {(() => {
                  const rdvDate = visitRdvDate[client.id] || todayStr;
                  const existingRdvs = state.appointments.filter((a: Appointment) =>
                    a.date === rdvDate && (a.commercial_id === userId || a.prospecteur_id === userId) && a.statut !== 'annule'
                  ).sort((a: Appointment, b: Appointment) => (a.heure_debut || '').localeCompare(b.heure_debut || ''));
                  if (existingRdvs.length === 0) return null;
                  return (
                    <div className="p-2 bg-white/60 border border-purple-200 rounded-lg mb-1">
                      <p className="text-[10px] font-medium text-purple-700 mb-1">RDV deja prevus ce jour :</p>
                      {existingRdvs.map((r: Appointment) => {
                        const name = (r.client_id ? getClientName(r.client_id) : '') || (r.prospect_id ? getProspectName(r.prospect_id) : '') || 'RDV';
                        return (
                          <p key={r.id} className="text-[10px] text-purple-600">
                            {r.heure_debut || '?'}-{r.heure_fin || '?'} : {name} {r.lieu ? `(${r.lieu})` : ''}
                          </p>
                        );
                      })}
                    </div>
                  );
                })()}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-medium text-purple-700 mb-0.5 block">Date du RDV</label>
                    <input type="date" value={visitRdvDate[client.id] || todayStr}
                      onChange={e => setVisitRdvDate(prev => ({ ...prev, [client.id]: e.target.value }))}
                      className="w-full text-sm border border-purple-200 rounded-lg px-2 py-1.5" />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-purple-700 mb-0.5 block">Lieu</label>
                    <input type="text" value={visitRdvLieu[client.id] || ''} placeholder="Adresse..."
                      onChange={e => setVisitRdvLieu(prev => ({ ...prev, [client.id]: e.target.value }))}
                      className="w-full text-sm border border-purple-200 rounded-lg px-2 py-1.5" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-medium text-purple-700 mb-0.5 block">Debut</label>
                    <input type="time" value={visitRdvHeureDebut[client.id] || '10:00'}
                      onChange={e => setVisitRdvHeureDebut(prev => ({ ...prev, [client.id]: e.target.value }))}
                      className="w-full text-sm border border-purple-200 rounded-lg px-2 py-1.5" />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-purple-700 mb-0.5 block">Fin</label>
                    <input type="time" value={visitRdvHeureFin[client.id] || '11:00'}
                      onChange={e => setVisitRdvHeureFin(prev => ({ ...prev, [client.id]: e.target.value }))}
                      className="w-full text-sm border border-purple-200 rounded-lg px-2 py-1.5" />
                  </div>
                </div>

                {/* Conflits horaires */}
                {(() => {
                  const conflicts = detectConflicts(
                    state.appointments,
                    userId || '',
                    visitRdvDate[client.id] || todayStr,
                    visitRdvHeureDebut[client.id] || '10:00',
                    visitRdvHeureFin[client.id] || '11:00'
                  );
                  if (conflicts.length === 0) return null;
                  return (
                    <div className="p-2 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-[11px] text-red-700 font-medium flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> Conflit horaire !
                      </p>
                      {conflicts.map(c => {
                        const cp = c.prospect_id ? state.prospects.find((p: any) => p.id === c.prospect_id) : null;
                        const cc = c.client_id ? state.clients.find((cl: Client) => cl.id === c.client_id) : null;
                        return (
                          <p key={c.id} className="text-[10px] text-red-600 mt-0.5">
                            {c.heure_debut}-{c.heure_fin} : {cc?.nom || cp?.nom_etablissement || 'RDV'}
                          </p>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Comment */}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">
                {currentType === 'VISITE' ? 'Commentaire de visite' : currentType === 'APPEL' ? 'Notes de l\'appel' : 'Notes du RDV'}
              </label>
              <textarea value={visitComments[client.id] || ''} onChange={e => setVisitComments(prev => ({ ...prev, [client.id]: e.target.value }))}
                placeholder={currentType === 'VISITE' ? 'Comment s\'est passee la visite...' : currentType === 'APPEL' ? 'Resume de l\'appel...' : 'Objet du rendez-vous...'}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 resize-none h-20" />
            </div>

            {/* Submit */}
            <button onClick={() => logVisit(client)} disabled={saving === client.id || !visitComments[client.id]?.trim()}
              className={`w-full py-2.5 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2 transition-colors ${
                currentType === 'VISITE' ? 'bg-green-600 hover:bg-green-700'
                : currentType === 'APPEL' ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-purple-600 hover:bg-purple-700'
              }`}>
              {currentType === 'VISITE' && <CheckCircle2 className="w-4 h-4" />}
              {currentType === 'APPEL' && <PhoneCall className="w-4 h-4" />}
              {currentType === 'RDV_PLANIFIE' && <Calendar className="w-4 h-4" />}
              {saving === client.id ? 'Enregistrement...'
                : currentType === 'VISITE' ? 'Enregistrer la visite'
                : currentType === 'APPEL' ? 'Enregistrer l\'appel'
                : 'Planifier le RDV'}
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
            Rapport Journalier
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {isAdmin && selectedCommercialId === 'all'
              ? 'Vue globale de toute l\'equipe'
              : isAdmin && selectedCommercialId && selectedCommercialId !== ''
              ? `Rapport de ${state.commerciaux.find((c: any) => c.id === selectedCommercialId)?.prenom || ''} ${state.commerciaux.find((c: any) => c.id === selectedCommercialId)?.nom || ''}`
              : 'Faites le bilan de votre activite'}
          </p>
        </div>
        {isAdmin && (
          <select
            value={selectedCommercialId}
            onChange={e => setSelectedCommercialId(e.target.value)}
            className="rounded-lg border border-gray-200 text-sm px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brewery-500"
          >
            <option value="">Mon activite</option>
            <option value="all">Toute l'equipe</option>
            {state.commerciaux.map((c: any) => (
              <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
            ))}
          </select>
        )}
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
            {stats.totalRdv > 0 && (
              <div className="flex items-center justify-center gap-2 mt-1">
                {stats.rdvFromProspection > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600">Prospection: {stats.rdvFromProspection}</span>}
                {stats.rdvClients > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-600">Clients: {stats.rdvClients}</span>}
              </div>
            )}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <p className="text-2xl font-bold text-green-600">{stats.rdvWithCR}</p>
            <p className="text-[10px] text-gray-500">Comptes rendus</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <p className="text-2xl font-bold text-orange-600">
              {stats.totalRdv > 0 ? Math.round((stats.rdvWithCR / stats.totalRdv) * 100) : 0}%
            </p>
            <p className="text-[10px] text-gray-500">Taux CR</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <p className="text-2xl font-bold text-cyan-600">{stats.totalVisites}</p>
            <p className="text-[10px] text-gray-500">Interactions clients</p>
          </div>

          {/* Breakdown by interaction type */}
          <div className="col-span-2 sm:col-span-4 bg-white rounded-xl border border-gray-200 p-3">
            <p className="text-xs font-medium text-gray-600 mb-2">Detail des interactions clients</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-green-50">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <div>
                  <p className="text-lg font-bold text-green-700">{stats.visitesParType.VISITE}</p>
                  <p className="text-[10px] text-green-600">Visites</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-50">
                <PhoneCall className="w-4 h-4 text-blue-600" />
                <div>
                  <p className="text-lg font-bold text-blue-700">{stats.visitesParType.APPEL}</p>
                  <p className="text-[10px] text-blue-600">Appels</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-purple-50">
                <Calendar className="w-4 h-4 text-purple-600" />
                <div>
                  <p className="text-lg font-bold text-purple-700">{stats.visitesParType.RDV_PLANIFIE}</p>
                  <p className="text-[10px] text-purple-600">RDV planifies</p>
                </div>
              </div>
            </div>
          </div>

          {/* Result breakdown - interactive */}
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
                  const isActive = expandedResult === key;
                  return (
                    <button key={key} onClick={() => setExpandedResult(isActive ? null : key)}
                      className={`px-2 py-1 rounded-full text-xs font-medium transition-all ${colors[key] || 'bg-gray-100 text-gray-600'} ${isActive ? 'ring-2 ring-offset-1 ring-gray-400 scale-105' : 'hover:scale-105'}`}>
                      {APPOINTMENT_RESULT_LABELS[key] || key}: {count}
                    </button>
                  );
                })}
              </div>
              {/* Expanded result detail */}
              {expandedResult && (() => {
                const rdvsForResult = rangeAppointments.filter(a => a.compte_rendu === expandedResult);
                const resultColors: Record<string, string> = {
                  client: 'border-green-200', mail_envoye: 'border-blue-200',
                  commande_plus_tard: 'border-yellow-200', a_relancer: 'border-orange-200',
                  pas_interesse: 'border-red-200',
                };
                return (
                  <div className={`mt-3 border-t pt-3 space-y-2`}>
                    <p className="text-xs text-gray-500 font-medium">{APPOINTMENT_RESULT_LABELS[expandedResult] || expandedResult} ({rdvsForResult.length})</p>
                    {rdvsForResult.map(rdv => {
                      const name = getEntityName(rdv);
                      const entityId = rdv.client_id || rdv.prospect_id;
                      const isClient = !!rdv.client_id;
                      const entity = isClient
                        ? state.clients.find((c: Client) => c.id === rdv.client_id)
                        : state.prospects.find((p: any) => p.id === rdv.prospect_id);
                      const phone = entity?.telephone || (isClient && (entity as Client)?.telephone_mobile) || '';
                      const ville = entity?.ville || '';
                      return (
                        <div key={rdv.id} className={`bg-white rounded-lg border ${resultColors[expandedResult] || 'border-gray-200'} p-3`}>
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-gray-800">{name}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${isClient ? 'bg-green-100 text-green-700' : 'bg-indigo-100 text-indigo-700'}`}>
                                  {isClient ? 'Client' : 'Prospect'}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 text-[11px] text-gray-500 mt-1 flex-wrap">
                                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{rdv.date}</span>
                                <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{rdv.heure_debut} - {rdv.heure_fin}</span>
                                {ville && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{ville}</span>}
                              </div>
                              {rdv.notes_compte_rendu && <p className="text-xs text-gray-500 italic mt-1 truncate">{rdv.notes_compte_rendu}</p>}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                              {phone && (
                                <a href={`tel:${phone}`} onClick={e => e.stopPropagation()}
                                  className="p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100">
                                  <Phone className="w-3.5 h-3.5" />
                                </a>
                              )}
                              {isClient && rdv.client_id && (
                                <button onClick={() => openQuickNote(rdv.client_id!)}
                                  className="p-1.5 rounded-lg bg-yellow-50 text-yellow-600 hover:bg-yellow-100">
                                  <StickyNote className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Day view content */}
      {viewMode === 'jour' && (
        <>
          {/* RDV Section - collapsible */}
          <div className="mb-8">
            <button onClick={() => setShowRdvSection(v => !v)} className="w-full flex items-center gap-2 text-left mb-3 group">
              <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${showRdvSection ? '' : '-rotate-90'}`} />
              <Calendar className="w-5 h-5 text-indigo-500" />
              <h2 className="text-lg font-semibold text-gray-800">Rendez-vous ({dayAppointments.length})</h2>
            </button>
            {showRdvSection && (
              dayAppointments.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
                  <p className="text-sm text-gray-400">Aucun RDV ce jour</p>
                </div>
              ) : (
                <div className="space-y-3">{dayAppointments.map(renderRdvCard)}</div>
              )
            )}
          </div>

          {/* Visites Section - collapsible */}
          <div>
            <button onClick={() => setShowVisitesSection(v => !v)} className="w-full flex items-center gap-2 text-left mb-3 group">
              <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${showVisitesSection ? '' : '-rotate-90'}`} />
              <Building2 className="w-5 h-5 text-green-600" />
              <h2 className="text-lg font-semibold text-gray-800">
                Visites Clients ({clientsToVisit.length})
                {clientsToVisit.length > 0 && (
                  <span className="text-sm font-normal text-gray-500 ml-2">— {visitedClientIds.size}/{clientsToVisit.length} faites</span>
                )}
              </h2>
            </button>
            {showVisitesSection && (
              clientsToVisit.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
                  <p className="text-sm text-gray-400">{dayZones.length === 0 ? 'Aucune tournee configuree ce jour' : 'Aucun client dans les secteurs du jour'}</p>
                </div>
              ) : (
                <div className="space-y-2">{clientsToVisit.map(renderClientCard)}</div>
              )
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
                            const commercialName = selectedCommercialId === 'all' ? state.commerciaux.find((c: any) => c.id === v.commercial_id) : null;
                            const typeColor = v.type === 'VISITE' ? 'bg-green-50' : v.type === 'APPEL' ? 'bg-blue-50' : 'bg-purple-50';
                            const typeTextColor = v.type === 'VISITE' ? 'text-green-600' : v.type === 'APPEL' ? 'text-blue-600' : 'text-purple-600';
                            const typeIconColor = v.type === 'VISITE' ? 'text-green-500' : v.type === 'APPEL' ? 'text-blue-500' : 'text-purple-500';
                            return (
                              <div key={v.id} className={`flex items-center gap-2 px-3 py-2 ${typeColor} rounded-lg`}>
                                {v.type === 'VISITE' ? <CheckCircle2 className={`w-4 h-4 ${typeIconColor} flex-shrink-0`} />
                                  : v.type === 'APPEL' ? <PhoneCall className={`w-4 h-4 ${typeIconColor} flex-shrink-0`} />
                                  : <Calendar className={`w-4 h-4 ${typeIconColor} flex-shrink-0`} />}
                                <div className="flex-1 min-w-0">
                                  <span className="text-sm font-medium text-gray-800">{clientName || v.client_id}</span>
                                  {commercialName && <span className="text-xs text-gray-500 ml-1">({commercialName.prenom})</span>}
                                  {v.comment && <p className="text-xs text-gray-500 truncate">{v.comment}</p>}
                                </div>
                                <span className={`text-[10px] font-medium ${typeTextColor}`}>{INTERACTION_TYPE_LABELS[v.type as InteractionType] || v.type}</span>
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
      {/* Quick note modal */}
      {noteClientId && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setNoteClientId(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                <StickyNote className="w-4 h-4 text-yellow-500" />
                Note - {getClient(noteClientId)?.nom || ''}
              </h3>
              <button onClick={() => setNoteClientId(null)} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4">
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-yellow-300 focus:border-yellow-400"
                rows={5}
                placeholder="Ajouter une note..."
                autoFocus
              />
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-2">
              <button className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setNoteClientId(null)}>Annuler</button>
              <button
                className="px-4 py-2 text-sm bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 flex items-center gap-1.5 disabled:opacity-50"
                onClick={saveQuickNote}
                disabled={noteSaving}
              >
                <Save className="w-3.5 h-3.5" /> {noteSaving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
