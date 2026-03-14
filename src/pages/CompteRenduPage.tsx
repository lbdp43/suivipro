import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, MapPin, Clock,
  CheckCircle2, AlertCircle, Save, Building2, Phone, PhoneCall, AlertTriangle,
  StickyNote, X, FileText, Bell, Users2, Navigation, Edit2,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import {
  Appointment, Client, Interaction, InteractionType,
  APPOINTMENT_RESULT_LABELS, INTERACTION_TYPE_LABELS,
  AppointmentResult, CLIENT_TYPE_LABELS,
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
  const [crForms, setCrForms] = useState<Record<string, { compte_rendu: AppointmentResult; notes: string }>>({});
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

  // Modal states
  const [crModalRdv, setCrModalRdv] = useState<Appointment | null>(null); // Compte-rendu modal
  const [visitModalClient, setVisitModalClient] = useState<Client | null>(null); // Visite/Appel modal
  const [visitModalType, setVisitModalType] = useState<InteractionType>('VISITE'); // Type for visit modal
  const [rdvModalClient, setRdvModalClient] = useState<Client | null>(null); // Planifier RDV modal
  const [rdvModalComment, setRdvModalComment] = useState('');
  const [rdvModalCommercialId, setRdvModalCommercialId] = useState('');
  const [crModalNotes, setCrModalNotes] = useState('');
  const [visitModalComment, setVisitModalComment] = useState('');
  const [visitModalNotes, setVisitModalNotes] = useState('');

  // Reminder state for CR modal
  const [showRappelSection, setShowRappelSection] = useState(false);
  const [rappelDate, setRappelDate] = useState('');
  const [rappelMessage, setRappelMessage] = useState('');

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

  // Helper: get Monday of a given date
  const getMondayOf = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d.toISOString().split('T')[0];
  };

  // Helper: get Sunday of a week starting from Monday
  const getSundayOf = (mondayStr: string) => {
    const d = new Date(mondayStr + 'T12:00:00');
    d.setDate(d.getDate() + 6);
    return d.toISOString().split('T')[0];
  };

  // Find which day of the week a zone is configured for (to assign weekly clients to correct day)
  const getDateForZone = (zone: string, weekMondayStr: string): string | null => {
    for (const [dow, zones] of Object.entries(parsedConfig)) {
      if (Array.isArray(zones) && zones.includes(zone)) {
        const monday = new Date(weekMondayStr + 'T12:00:00');
        // dow: 0=Sun, 1=Mon, ..., 6=Sat
        const dowNum = parseInt(dow);
        const offset = dowNum === 0 ? 6 : dowNum - 1; // Convert to Monday-based offset
        const date = new Date(monday);
        date.setDate(monday.getDate() + offset);
        return date.toISOString().split('T')[0];
      }
    }
    return null;
  };

  // Helper: get clients to visit for a specific date (used in week view)
  const getClientsToVisitForDate = (dateStr: string): Client[] => {
    const uids = new Set(effectiveUserIds);
    const zones = getZonesForDate(dateStr);
    const weekMonday = getMondayOf(dateStr);
    const weekSunday = getSundayOf(weekMonday);

    // Get interactions already done on that date
    const doneClientIds = new Set(
      state.interactions
        .filter((i: Interaction) => i.date.substring(0, 10) === dateStr && uids.has(i.commercial_id))
        .map((i: Interaction) => i.client_id)
    );

    return state.clients.filter((c: Client) => {
      if (!uids.has(c.commercial_id) || c.statut !== 'ACTIF') return false;
      if (!c.tournee || !zones.includes(c.tournee)) return false;

      // Case 1: Client is late (next_visit < dateStr)
      if (c.next_visit && c.next_visit < dateStr) return true;

      // Case 2: Client's next_visit falls this week AND zone matches this day
      if (c.next_visit && c.next_visit >= weekMonday && c.next_visit <= weekSunday) {
        const assignedDate = getDateForZone(c.tournee, weekMonday);
        if (assignedDate === dateStr) return true;
      }

      return false;
    }).sort((a: Client, b: Client) => {
      const aLate = a.next_visit && a.next_visit < dateStr;
      const bLate = b.next_visit && b.next_visit < dateStr;
      if (aLate && !bLate) return -1;
      if (!aLate && bLate) return 1;
      if (aLate && bLate) return (a.next_visit || '').localeCompare(b.next_visit || '');
      return a.nom.localeCompare(b.nom);
    }).map(c => ({ ...c, _visited: doneClientIds.has(c.id) }));
  };

  // Group by day for week/month/period views - now includes clients to visit
  const dayGroups = useMemo(() => {
    if (viewMode === 'jour') return [];
    const groups: { date: string; label: string; rdvs: Appointment[]; visites: Interaction[]; zones: string[]; clientsToVisit: Client[] }[] = [];
    for (const dateStr of dateRange.dates) {
      const d = new Date(dateStr + 'T12:00:00');
      const rdvs = rangeAppointments.filter(a => a.date === dateStr);
      const visites = rangeInteractions.filter(i => i.date.substring(0, 10) === dateStr);
      const zones = getZonesForDate(dateStr);
      const clients = viewMode === 'semaine' ? getClientsToVisitForDate(dateStr) : [];
      if (rdvs.length === 0 && visites.length === 0 && clients.length === 0) continue;
      groups.push({
        date: dateStr,
        label: `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_LABELS[d.getMonth()].substring(0, 3)}`,
        rdvs,
        visites,
        zones,
        clientsToVisit: clients,
      });
    }
    return groups;
  }, [viewMode, dateRange, rangeAppointments, rangeInteractions, state.clients, effectiveUserIds, parsedConfig, state.interactions]);

  const clientsToVisit = useMemo(() => {
    const uids = new Set(effectiveUserIds);
    const today = selectedDate;
    const weekMonday = getMondayOf(today);
    const weekSunday = getSundayOf(weekMonday);

    return state.clients.filter((c: Client) => {
      if (!uids.has(c.commercial_id) || c.statut !== 'ACTIF') return false;

      // Case 1: Client is late (next_visit < today)
      if (c.next_visit && c.next_visit < today && dayZones.includes(c.tournee)) {
        return true;
      }

      // Case 2: Client's next_visit falls this week AND their sector matches today's sector
      if (c.next_visit && c.next_visit >= weekMonday && c.next_visit <= weekSunday) {
        // Assign client to the day when their zone is scheduled
        if (c.tournee && dayZones.includes(c.tournee)) {
          // Client's zone is today's zone
          const assignedDate = getDateForZone(c.tournee, weekMonday);
          if (assignedDate === today) return true;
        }
      }

      return false;
    }).sort((a: Client, b: Client) => {
      // Sort: late clients first (by how many days late), then due clients by name
      const aLate = a.next_visit && a.next_visit < today;
      const bLate = b.next_visit && b.next_visit < today;
      if (aLate && !bLate) return -1;
      if (!aLate && bLate) return 1;
      if (aLate && bLate) return (a.next_visit || '').localeCompare(b.next_visit || '');
      return a.nom.localeCompare(b.nom);
    });
  }, [state.clients, dayZones, effectiveUserIds, selectedDate, parsedConfig]);

  const todayInteractions = useMemo(() => {
    const uids = new Set(effectiveUserIds);
    return state.interactions.filter((i: Interaction) =>
      i.date.startsWith(selectedDate) && uids.has(i.commercial_id)
    );
  }, [state.interactions, selectedDate, effectiveUserIds]);

  const visitedClientIds = new Set(todayInteractions.map((i: Interaction) => i.client_id));

  // Actions (moved to modal handlers above)

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

  // Open CR modal for an RDV
  const openCrModal = (rdv: Appointment) => {
    setCrModalRdv(rdv);
    if (!crForms[rdv.id]) {
      setCrForms(prev => ({ ...prev, [rdv.id]: { compte_rendu: (rdv.compte_rendu || '') as AppointmentResult, notes: rdv.notes_compte_rendu || '' } }));
    }
    setCrModalNotes(rdv.notes_compte_rendu || '');
    setShowRappelSection(false);
    setRappelDate('');
    setRappelMessage('');
  };

  // Open visit modal
  const openVisitModal = (client: Client, type: InteractionType = 'VISITE') => {
    setVisitModalClient(client);
    setVisitModalType(type);
    setVisitModalComment('');
    const full = getClient(client.id);
    setVisitModalNotes(full?.notes || '');
    // Trigger phone call when opening as APPEL
    if (type === 'APPEL') {
      const phone = client.telephone_mobile || client.telephone;
      if (phone) window.open(`tel:${phone.replace(/\s/g, '')}`, '_self');
    }
  };

  // Open RDV planification modal
  const openRdvModal = (client: Client) => {
    const addr = [client.adresse, client.ville].filter(Boolean).join(', ');
    setRdvModalClient(client);
    setRdvModalComment('');
    setRdvModalCommercialId(userId || '');
    setVisitRdvDate(prev => ({ ...prev, [client.id]: todayStr }));
    setVisitRdvLieu(prev => ({ ...prev, [client.id]: addr }));
    setVisitRdvHeureDebut(prev => ({ ...prev, [client.id]: '10:00' }));
    setVisitRdvHeureFin(prev => ({ ...prev, [client.id]: '11:00' }));
  };

  // Save from visit modal
  const saveVisitModal = async () => {
    if (!visitModalClient || !visitModalComment.trim()) { toast.error('Le commentaire est obligatoire'); return; }
    setSaving(visitModalClient.id);
    try {
      const now = new Date().toISOString();
      const token = localStorage.getItem('suivipro_token');
      const interaction = {
        id: generateId(), client_id: visitModalClient.id, commercial_id: userId!,
        type: visitModalType, date: now, comment: visitModalComment.trim(), date_creation: now,
      };
      const res = await fetch('/api/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(interaction),
      });
      if (!res.ok) throw new Error();
      dispatch({ type: 'ADD_INTERACTION', payload: interaction });

      // Save client notes if changed
      const full = getClient(visitModalClient.id);
      if (full && visitModalNotes !== (full.notes || '')) {
        const updated: Client = { ...full, notes: visitModalNotes, date_modification: now };
        await fetch(`/api/clients/${visitModalClient.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(updated),
        });
        dispatch({ type: 'UPDATE_CLIENT', payload: updated });
      }

      toast.success(visitModalType === 'VISITE' ? `Visite enregistree pour ${visitModalClient.nom}` : `Appel enregistre pour ${visitModalClient.nom}`);
      setVisitModalClient(null);
    } catch { toast.error('Erreur lors de la sauvegarde'); }
    finally { setSaving(null); }
  };

  // Save from RDV modal
  const saveRdvModal = async () => {
    if (!rdvModalClient || !rdvModalComment.trim()) { toast.error('Le commentaire est obligatoire'); return; }
    if (!visitRdvDate[rdvModalClient.id]) { toast.error('La date est obligatoire'); return; }
    setSaving(rdvModalClient.id);
    try {
      const now = new Date().toISOString();
      const token = localStorage.getItem('suivipro_token');
      const addr = [rdvModalClient.adresse, rdvModalClient.ville].filter(Boolean).join(', ');

      // Create interaction
      const interaction = {
        id: generateId(), client_id: rdvModalClient.id, commercial_id: userId!,
        type: 'RDV_PLANIFIE' as InteractionType,
        date: new Date(visitRdvDate[rdvModalClient.id]).toISOString(),
        comment: rdvModalComment.trim(), date_creation: now,
      };
      const res = await fetch('/api/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(interaction),
      });
      if (!res.ok) throw new Error();
      dispatch({ type: 'ADD_INTERACTION', payload: interaction });

      // Create appointment
      const rdvId = generateId();
      const assignCommercialId = rdvModalCommercialId || userId!;
      const rdv = {
        id: rdvId, prospect_id: '', client_id: rdvModalClient.id,
        commercial_id: assignCommercialId, prospecteur_id: assignCommercialId,
        date: visitRdvDate[rdvModalClient.id],
        heure_debut: visitRdvHeureDebut[rdvModalClient.id] || '10:00',
        heure_fin: visitRdvHeureFin[rdvModalClient.id] || '11:00',
        lieu: visitRdvLieu[rdvModalClient.id] || addr,
        notes: rdvModalComment.trim(), statut: 'planifie' as const,
        created_at: now,
      };
      const rdvRes = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(rdv),
      });
      if (rdvRes.ok) dispatch({ type: 'ADD_APPOINTMENT', payload: rdv });
      toast.success(`RDV planifie pour ${rdvModalClient.nom}`);
      setRdvModalClient(null);
    } catch { toast.error('Erreur lors de la sauvegarde'); }
    finally { setSaving(null); }
  };

  // Save CR from modal
  const saveCrModal = async () => {
    if (!crModalRdv) return;
    const form = crForms[crModalRdv.id];
    if (!form?.compte_rendu) { toast.error('Selectionnez un resultat'); return; }
    if (!form.notes?.trim()) { toast.error('Les notes sont obligatoires'); return; }
    setSaving(crModalRdv.id);
    try {
      const updated = { ...crModalRdv, statut: 'termine' as const, compte_rendu: form.compte_rendu, notes_compte_rendu: form.notes };
      const token = localStorage.getItem('suivipro_token');
      const res = await fetch(`/api/appointments/${crModalRdv.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(updated),
      });
      if (res.ok) {
        dispatch({ type: 'UPDATE_APPOINTMENT', payload: updated });
        toast.success('Compte rendu enregistre');
        setCrModalRdv(null);
      }
    } catch { toast.error('Erreur lors de la sauvegarde'); }
    finally { setSaving(null); }
  };

  // RDV card - compact fiche with action buttons
  const renderRdvCard = (rdv: Appointment) => {
    const hasCR = !!rdv.compte_rendu;
    const entityName = getEntityName(rdv);
    const rdvOwner = isTeamView ? getCommercialName(rdv.commercial_id) : '';
    return (
      <div key={rdv.id} className={`bg-white rounded-xl border ${hasCR ? 'border-green-200 bg-green-50/30' : 'border-gray-200'} p-3`}>
        <div className="flex items-start gap-3">
          {hasCR ? <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" /> : <AlertCircle className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-gray-800">{entityName}</span>
              {rdvOwner && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{rdvOwner}</span>
              )}
              {hasCR && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">{APPOINTMENT_RESULT_LABELS[rdv.compte_rendu!] || rdv.compte_rendu}</span>}
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
              {rdv.heure_debut && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{rdv.heure_debut}{rdv.heure_fin ? ` - ${rdv.heure_fin}` : ''}</span>}
              {rdv.lieu && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{rdv.lieu}</span>}
            </div>
            {rdv.notes && <p className="text-[10px] text-gray-400 mt-1 italic line-clamp-1">{rdv.notes}</p>}
            {hasCR && rdv.notes_compte_rendu && <p className="text-[10px] text-green-600 mt-1 italic line-clamp-1">{rdv.notes_compte_rendu}</p>}
          </div>
        </div>
        {/* Quick action buttons */}
        <div className="flex items-center gap-2 mt-2.5 pt-2 border-t border-gray-100">
          {!hasCR ? (
            <button
              onClick={() => openCrModal(rdv)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              <FileText className="w-3.5 h-3.5" /> Compte-rendu
            </button>
          ) : (
            <button
              onClick={() => openCrModal(rdv)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            >
              <FileText className="w-3.5 h-3.5" /> Modifier le CR
            </button>
          )}
          {rdv.client_id && (() => {
            const c = getClient(rdv.client_id);
            return c && (c.telephone_mobile || c.telephone) ? (
              <button
                onClick={e => { e.stopPropagation(); openVisitModal(c, 'APPEL'); }}
                className="p-2 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
                title="Appeler et enregistrer"
              >
                <Phone className="w-4 h-4" />
              </button>
            ) : null;
          })()}
        </div>
      </div>
    );
  };

  // Render RDVs grouped by commercial (for team view)
  const commercialGroupColors = ['bg-blue-50 border-blue-200', 'bg-purple-50 border-purple-200', 'bg-teal-50 border-teal-200', 'bg-pink-50 border-pink-200', 'bg-amber-50 border-amber-200'];
  const renderRdvListGrouped = (rdvs: Appointment[]) => {
    if (!isTeamView) {
      return <div className="space-y-3">{rdvs.map(renderRdvCard)}</div>;
    }
    // Group by commercial
    const grouped = rdvs.reduce<Record<string, Appointment[]>>((acc, rdv) => {
      const cId = rdv.commercial_id || 'unknown';
      if (!acc[cId]) acc[cId] = [];
      acc[cId].push(rdv);
      return acc;
    }, {});
    return (
      <div className="space-y-3">
        {Object.entries(grouped).map(([commercialId, cRdvs], idx) => {
          const commercial = state.commerciaux.find((c: any) => c.id === commercialId);
          const commercialName = commercial ? `${commercial.prenom} ${commercial.nom}` : 'Inconnu';
          const colorClass = commercialGroupColors[idx % commercialGroupColors.length];
          return (
            <div key={commercialId} className={`rounded-xl border p-3 ${colorClass}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-xs font-bold text-gray-600 border">
                  {commercial?.prenom?.charAt(0) || '?'}
                </div>
                <span className="text-xs font-semibold text-gray-700">{commercialName}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white text-gray-500 font-medium">{cRdvs.length}</span>
              </div>
              <div className="space-y-3">
                {cRdvs.map(renderRdvCard)}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Client visit card - compact fiche with action buttons
  const renderClientCard = (client: Client) => {
    const visited = visitedClientIds.has(client.id);
    const interaction = todayInteractions.find((i: Interaction) => i.client_id === client.id);
    const clientOwner = isTeamView ? getCommercialName(client.commercial_id) : '';
    const isLate = client.next_visit && client.next_visit < selectedDate;
    const daysLate = isLate ? Math.floor((new Date(selectedDate + 'T12:00:00').getTime() - new Date(client.next_visit + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24)) : 0;
    const gmapsUrl = client.latitude && client.longitude
      ? `https://www.google.com/maps/dir/?api=1&destination=${client.latitude},${client.longitude}`
      : client.adresse
        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(client.adresse + (client.ville ? ', ' + client.ville : ''))}`
        : null;
    return (
      <div key={client.id} className={`p-3 rounded-lg border transition-colors ${
        visited ? 'bg-green-50/30 border-green-200' : isLate ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200 hover:border-gray-300'
      }`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {visited ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-green-500" /> : isLate ? <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-500" /> : <Building2 className="w-4 h-4 flex-shrink-0 text-gray-400" />}
              <Link
                to={`/clients?id=${client.id}`}
                className="font-semibold text-sm truncate text-gray-800 hover:text-indigo-700 hover:underline"
              >
                {client.nom}
              </Link>
              {clientOwner && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{clientOwner}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
              <span>{CLIENT_TYPE_LABELS[client.type_client] || client.type_client}</span>
              {client.tournee && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded font-medium">
                  <MapPin className="w-3 h-3" />{client.tournee}
                </span>
              )}
              {client.ville && <span className="text-gray-400">{client.ville}</span>}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs">
              {(client.telephone_mobile || client.telephone) && (
                <span className="inline-flex items-center gap-1 text-green-600">
                  <Phone className="w-3 h-3" />{client.telephone_mobile || client.telephone}
                </span>
              )}
              {client.contact && <span className="text-gray-500">{client.contact}</span>}
            </div>
            {client.next_visit && (
              <div className="mt-1 text-[10px] text-gray-400">
                Visite prevue: {client.next_visit}
                {client.last_visit && ` — Derniere: ${client.last_visit}`}
              </div>
            )}
            {isLate && (
              <div className="mt-1 flex items-center gap-1 text-xs">
                <span className="text-red-600 font-medium flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  En retard de {daysLate}j
                </span>
              </div>
            )}
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
              <div className="mt-1.5 px-2 py-1.5 bg-yellow-50 rounded border border-yellow-100">
                <p className="text-[10px] text-yellow-700 truncate">{client.notes}</p>
              </div>
            )}
          </div>
        </div>
        {/* Quick actions - same style as VisitesPage */}
        <div className="flex items-center gap-3 sm:gap-1.5 mt-2">
          {!visited ? (
            <>
              <button
                onClick={() => openVisitModal(client, 'VISITE')}
                className="px-3 py-1.5 sm:p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                title="Marquer une visite"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => openRdvModal(client)}
                className="px-3 py-1.5 sm:p-1.5 rounded-lg bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors"
                title="Planifier un RDV"
              >
                <Calendar className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <span className="text-xs text-green-600 font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Fait
            </span>
          )}
          <button
            onClick={() => openQuickNote(client.id)}
            className="px-3 py-1.5 sm:p-1.5 rounded-lg bg-yellow-50 text-yellow-600 hover:bg-yellow-100 transition-colors"
            title="Note rapide"
          >
            <StickyNote className="w-3.5 h-3.5" />
          </button>
          {gmapsUrl && (
            <a href={gmapsUrl} target="_blank" rel="noopener noreferrer"
              className="px-3 py-1.5 sm:p-1.5 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors"
              title="Itineraire Google Maps">
              <Navigation className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
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
                const commercialColors = ['bg-blue-50 border-blue-200', 'bg-purple-50 border-purple-200', 'bg-teal-50 border-teal-200', 'bg-pink-50 border-pink-200', 'bg-amber-50 border-amber-200'];

                // Group by commercial when in team view
                const grouped = isTeamView
                  ? Object.entries(rdvsForResult.reduce<Record<string, Appointment[]>>((acc, rdv) => {
                      const cId = rdv.commercial_id || 'unknown';
                      if (!acc[cId]) acc[cId] = [];
                      acc[cId].push(rdv);
                      return acc;
                    }, {}))
                  : [['single', rdvsForResult] as [string, Appointment[]]];

                const renderRdvCard = (rdv: Appointment) => {
                  const name = getEntityName(rdv);
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
                };

                return (
                  <div className="mt-3 border-t pt-3 space-y-2">
                    <p className="text-xs text-gray-500 font-medium">{APPOINTMENT_RESULT_LABELS[expandedResult] || expandedResult} ({rdvsForResult.length})</p>
                    {isTeamView ? (
                      <div className="space-y-3">
                        {grouped.map(([commercialId, rdvs], idx) => {
                          const commercial = state.commerciaux.find((c: any) => c.id === commercialId);
                          const commercialName = commercial ? `${commercial.prenom} ${commercial.nom}` : 'Inconnu';
                          const colorClass = commercialColors[idx % commercialColors.length];
                          return (
                            <div key={commercialId} className={`rounded-lg border p-3 ${colorClass}`}>
                              <div className="flex items-center gap-2 mb-2">
                                <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-xs font-bold text-gray-600 border">
                                  {commercial?.prenom?.charAt(0) || '?'}
                                </div>
                                <span className="text-xs font-semibold text-gray-700">{commercialName}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white text-gray-500 font-medium">{rdvs.length}</span>
                              </div>
                              <div className="space-y-2">
                                {rdvs.map(renderRdvCard)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      rdvsForResult.map(renderRdvCard)
                    )}
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
                renderRdvListGrouped(dayAppointments)
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
              {(() => {
                const lateCount = clientsToVisit.filter((c: Client) => c.next_visit && c.next_visit < selectedDate).length;
                const dueCount = clientsToVisit.length - lateCount;
                return (lateCount > 0 || dueCount > 0) ? (
                  <div className="flex items-center gap-2 ml-auto">
                    {lateCount > 0 && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">{lateCount} en retard</span>}
                    {dueCount > 0 && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{dueCount} prevus</span>}
                  </div>
                ) : null;
              })()}
            </button>
            {showVisitesSection && (
              clientsToVisit.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
                  <p className="text-sm text-gray-400">{dayZones.length === 0 ? 'Aucune tournee configuree ce jour' : 'Aucun client a visiter (en retard ou prevu cette semaine)'}</p>
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
            const visitedCount = group.clientsToVisit.filter((c: any) => c._visited).length;
            const lateCount = group.clientsToVisit.filter((c: Client) => c.next_visit && c.next_visit < group.date).length;
            return (
              <div key={group.date} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <button onClick={() => setExpandedDay(isOpen ? null : group.date)}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-gray-800">{group.label}</span>
                      {group.zones.length > 0 && <span className="text-[10px] text-brewery-600 font-medium">{group.zones.join(', ')}</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {group.rdvs.length > 0 && (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${rdvDone === group.rdvs.length ? 'bg-green-100 text-green-700' : 'bg-indigo-100 text-indigo-700'}`}>
                          {group.rdvs.length} RDV {rdvDone > 0 && `(${rdvDone} CR)`}
                        </span>
                      )}
                      {group.clientsToVisit.length > 0 && (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${visitedCount === group.clientsToVisit.length ? 'bg-green-100 text-green-700' : 'bg-cyan-100 text-cyan-700'}`}>
                          {visitedCount}/{group.clientsToVisit.length} clients visites
                        </span>
                      )}
                      {lateCount > 0 && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                          {lateCount} en retard
                        </span>
                      )}
                      {group.visites.length > 0 && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">
                          {group.visites.length} interaction{group.visites.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-4">
                    {/* RDVs du jour */}
                    {group.rdvs.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5" /> Rendez-vous ({group.rdvs.length})
                        </p>
                        {renderRdvListGrouped(group.rdvs)}
                      </div>
                    )}

                    {/* Clients a visiter ce jour */}
                    {group.clientsToVisit.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5" /> Clients a visiter ({group.clientsToVisit.length})
                          <span className="text-[10px] font-normal text-gray-400 ml-1">— {visitedCount}/{group.clientsToVisit.length} faits</span>
                        </p>
                        <div className="space-y-2">
                          {group.clientsToVisit.map(renderClientCard)}
                        </div>
                      </div>
                    )}

                    {/* Interactions deja faites (hors clients a visiter) */}
                    {group.visites.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> Interactions enregistrees ({group.visites.length})
                        </p>
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
      {/* Compte-rendu RDV modal */}
      {crModalRdv && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setCrModalRdv(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
                  <ClipboardCheck className="w-5 h-5 text-indigo-600" />
                  Compte-rendu du RDV
                </h3>
                <p className="text-sm text-gray-500 mt-0.5">{getEntityName(crModalRdv)} - {crModalRdv.date}</p>
              </div>
              <button onClick={() => setCrModalRdv(null)} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-4">
              {/* Resultat */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">Resultat du rendez-vous</label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(APPOINTMENT_RESULT_LABELS).map(([key, label]) => {
                    const sel = crForms[crModalRdv.id]?.compte_rendu === key;
                    const icons: Record<string, string> = {
                      client: 'text-green-600', mail_envoye: 'text-blue-600',
                      commande_plus_tard: 'text-yellow-600', a_relancer: 'text-orange-600',
                      pas_interesse: 'text-red-600',
                    };
                    return (
                      <button key={key}
                        onClick={() => setCrForms(prev => ({ ...prev, [crModalRdv.id]: { ...prev[crModalRdv.id], compte_rendu: key as AppointmentResult } }))}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border transition-all ${sel ? 'border-indigo-300 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-200' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                      >
                        <span className={icons[key] || ''}>{key === 'client' ? '👥' : key === 'mail_envoye' ? '📧' : key === 'commande_plus_tard' ? '🛒' : key === 'a_relancer' ? '🔄' : '🚫'}</span>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Notes du compte-rendu *</label>
                <textarea
                  value={crForms[crModalRdv.id]?.notes || ''}
                  onChange={e => setCrForms(prev => ({ ...prev, [crModalRdv.id]: { ...prev[crModalRdv.id], notes: e.target.value } }))}
                  placeholder="Comment s'est passe le rendez-vous ? (obligatoire)"
                  className={`w-full text-sm border rounded-lg px-3 py-2 resize-none h-24 focus:ring-2 focus:ring-indigo-300 ${!crForms[crModalRdv.id]?.notes?.trim() ? 'border-red-300' : 'border-gray-300'}`}
                  autoFocus
                />
                {!crForms[crModalRdv.id]?.notes?.trim() && (
                  <p className="text-xs text-red-500 mt-1">Les notes sont obligatoires pour valider le compte-rendu</p>
                )}
              </div>

              {/* Programmer un rappel */}
              <button
                onClick={() => setShowRappelSection(!showRappelSection)}
                className="w-full py-2.5 border-2 border-dashed border-yellow-300 rounded-lg text-sm font-medium text-yellow-600 hover:bg-yellow-50 transition-colors flex items-center justify-center gap-2"
              >
                <Bell className="w-4 h-4" /> Programmer un rappel
              </button>
              {showRappelSection && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg space-y-2">
                  <div>
                    <label className="text-xs font-medium text-yellow-700 block mb-0.5">Date du rappel</label>
                    <input type="date" value={rappelDate} onChange={e => setRappelDate(e.target.value)}
                      className="w-full text-sm border border-yellow-200 rounded-lg px-2 py-1.5" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-yellow-700 block mb-0.5">Message</label>
                    <input type="text" value={rappelMessage} onChange={e => setRappelMessage(e.target.value)}
                      placeholder="Rappel pour..." className="w-full text-sm border border-yellow-200 rounded-lg px-2 py-1.5" />
                  </div>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
              <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setCrModalRdv(null)}>Annuler</button>
              <button
                className="px-5 py-2.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2 disabled:opacity-50 font-medium"
                onClick={saveCrModal}
                disabled={saving === crModalRdv.id || !crForms[crModalRdv.id]?.compte_rendu || !crForms[crModalRdv.id]?.notes?.trim()}
              >
                <ClipboardCheck className="w-4 h-4" /> {saving === crModalRdv.id ? 'Enregistrement...' : 'Valider le compte-rendu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Marquer visite/Appel modal */}
      {visitModalClient && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setVisitModalClient(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h3 className="text-base font-bold text-gray-800">
                  {visitModalType === 'VISITE' ? 'Marquer une visite' : 'Marquer un appel'}
                </h3>
                <p className="text-sm text-gray-500 mt-0.5">{visitModalClient.nom}</p>
              </div>
              <button onClick={() => setVisitModalClient(null)} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            {/* Editable notes client */}
            <div className="mx-4 mt-4 p-2.5 bg-yellow-50 rounded-lg border border-yellow-200">
              <label className="text-[10px] font-semibold text-yellow-800 mb-1 block">Notes client</label>
              <textarea
                value={visitModalNotes}
                onChange={e => setVisitModalNotes(e.target.value)}
                placeholder="Notes sur le client..."
                className="w-full text-xs bg-white border border-yellow-300 rounded-lg px-2.5 py-1.5 resize-none h-16 focus:ring-2 focus:ring-yellow-300 focus:border-yellow-400"
              />
            </div>
            <div className="p-4 space-y-4">
              {/* Type */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['VISITE', 'APPEL'] as const).map(type => {
                    const sel = visitModalType === type;
                    const cfg = {
                      VISITE: { color: sel ? 'bg-green-100 border-green-300 text-green-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50', icon: CheckCircle2 },
                      APPEL: { color: sel ? 'bg-blue-100 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50', icon: PhoneCall },
                    };
                    const c = cfg[type];
                    const Icon = c.icon;
                    return (
                      <button key={type} onClick={() => setVisitModalType(type)}
                        className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium border transition-all ${c.color}`}>
                        <Icon className="w-4 h-4" /> {INTERACTION_TYPE_LABELS[type]}
                      </button>
                    );
                  })}
                  <button onClick={() => { setVisitModalClient(null); openRdvModal(visitModalClient); }}
                    className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition-all">
                    <Calendar className="w-4 h-4" /> {INTERACTION_TYPE_LABELS['RDV_PLANIFIE']}
                  </button>
                </div>
              </div>

              {/* Commentaire */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Commentaire *</label>
                <textarea
                  value={visitModalComment}
                  onChange={e => setVisitModalComment(e.target.value)}
                  placeholder="Comment s'est passe l'echange ?... (obligatoire)"
                  className={`w-full text-sm border rounded-lg px-3 py-2 resize-none h-28 focus:ring-2 ${visitModalType === 'VISITE' ? 'focus:ring-green-300' : 'focus:ring-blue-300'} ${!visitModalComment.trim() ? 'border-red-300' : 'border-gray-300'}`}
                  autoFocus
                />
                {!visitModalComment.trim() && (
                  <p className="text-xs text-red-500 mt-1">Le commentaire est obligatoire</p>
                )}
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
              <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setVisitModalClient(null)}>Annuler</button>
              <button
                className={`px-5 py-2.5 text-sm text-white rounded-lg flex items-center gap-2 disabled:opacity-50 font-medium ${
                  visitModalType === 'VISITE' ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
                onClick={saveVisitModal}
                disabled={saving === visitModalClient.id || !visitModalComment.trim()}
              >
                <CheckCircle2 className="w-4 h-4" /> {saving === visitModalClient.id ? 'Enregistrement...' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Planifier RDV modal */}
      {rdvModalClient && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setRdvModalClient(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h3 className="text-base font-bold text-gray-800">Planifier un RDV</h3>
                <p className="text-sm text-gray-500 mt-0.5">{rdvModalClient.nom}</p>
              </div>
              <button onClick={() => setRdvModalClient(null)} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-4">
              {/* Type header */}
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => { setRdvModalClient(null); openVisitModal(rdvModalClient, 'VISITE'); }}
                  className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50">
                  <CheckCircle2 className="w-4 h-4" /> Visite
                </button>
                <button onClick={() => { setRdvModalClient(null); openVisitModal(rdvModalClient, 'APPEL'); }}
                  className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50">
                  <PhoneCall className="w-4 h-4" /> Appel
                </button>
                <button className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium bg-purple-100 border border-purple-300 text-purple-700">
                  <Calendar className="w-4 h-4" /> RDV planifie
                </button>
              </div>

              {/* RDV details */}
              <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-purple-700">
                  <Calendar className="w-4 h-4" /> Rendez-vous
                </div>

                {/* Commercial assign */}
                {isAdmin && (
                  <div>
                    <label className="text-xs font-medium text-purple-600 mb-0.5 flex items-center gap-1 block">
                      <Users2 className="w-3 h-3" /> Commercial assigne au RDV
                    </label>
                    <select
                      value={rdvModalCommercialId}
                      onChange={e => setRdvModalCommercialId(e.target.value)}
                      className="w-full text-sm border border-purple-200 rounded-lg px-2 py-1.5 bg-white"
                    >
                      {state.commerciaux.map((c: any) => (
                        <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Date + hours */}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs font-medium text-purple-600 mb-0.5 block">Date *</label>
                    <input type="date" value={visitRdvDate[rdvModalClient.id] || todayStr}
                      onChange={e => setVisitRdvDate(prev => ({ ...prev, [rdvModalClient.id]: e.target.value }))}
                      className="w-full text-sm border border-purple-200 rounded-lg px-2 py-1.5" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-purple-600 mb-0.5 block">Debut</label>
                    <input type="time" value={visitRdvHeureDebut[rdvModalClient.id] || '10:00'}
                      onChange={e => setVisitRdvHeureDebut(prev => ({ ...prev, [rdvModalClient.id]: e.target.value }))}
                      className="w-full text-sm border border-purple-200 rounded-lg px-2 py-1.5" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-purple-600 mb-0.5 block">Fin</label>
                    <input type="time" value={visitRdvHeureFin[rdvModalClient.id] || '11:00'}
                      onChange={e => setVisitRdvHeureFin(prev => ({ ...prev, [rdvModalClient.id]: e.target.value }))}
                      className="w-full text-sm border border-purple-200 rounded-lg px-2 py-1.5" />
                  </div>
                </div>

                {/* Lieu */}
                <div>
                  <input type="text" value={visitRdvLieu[rdvModalClient.id] || ''} placeholder="Adresse..."
                    onChange={e => setVisitRdvLieu(prev => ({ ...prev, [rdvModalClient.id]: e.target.value }))}
                    className="w-full text-sm border border-purple-200 rounded-lg px-3 py-2" />
                </div>

                {/* Notes RDV */}
                <div>
                  <input type="text" placeholder="Notes du RDV (optionnel)..."
                    className="w-full text-sm border border-purple-200 rounded-lg px-3 py-2 text-gray-500" />
                </div>

                {/* Conflits horaires */}
                {(() => {
                  const conflicts = detectConflicts(
                    state.appointments,
                    rdvModalCommercialId || userId || '',
                    visitRdvDate[rdvModalClient.id] || todayStr,
                    visitRdvHeureDebut[rdvModalClient.id] || '10:00',
                    visitRdvHeureFin[rdvModalClient.id] || '11:00'
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

              {/* Commentaire */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Commentaire *</label>
                <textarea
                  value={rdvModalComment}
                  onChange={e => setRdvModalComment(e.target.value)}
                  placeholder="Notes sur cette interaction... (obligatoire)"
                  className={`w-full text-sm border rounded-lg px-3 py-2 resize-none h-24 focus:ring-2 focus:ring-purple-300 ${!rdvModalComment.trim() ? 'border-red-300' : 'border-gray-300'}`}
                />
                {!rdvModalComment.trim() && (
                  <p className="text-xs text-red-500 mt-1">Le commentaire est obligatoire</p>
                )}
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
              <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setRdvModalClient(null)}>Annuler</button>
              <button
                className="px-5 py-2.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 disabled:opacity-50 font-medium"
                onClick={saveRdvModal}
                disabled={saving === rdvModalClient.id || !rdvModalComment.trim()}
              >
                <CheckCircle2 className="w-4 h-4" /> {saving === rdvModalClient.id ? 'Enregistrement...' : 'Confirmer'}
              </button>
            </div>
          </div>
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
