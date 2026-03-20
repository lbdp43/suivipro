import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  ChevronRight, ChevronLeft, ChevronDown, ChevronUp,
  Calendar, CheckCircle2, Clock, AlertTriangle, Phone, MapPin, Map,
  ClipboardCheck, X, Mail, FileText, Filter, Users, CalendarPlus, Download, GripVertical, Settings2, UserX, MessageSquarePlus, UserCheck, Bell,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import {
  Client, Appointment, AppointmentResult, APPOINTMENT_RESULT_LABELS, Interaction, PipelineStage,
} from '../types';
import { toLocalDateStr, downloadICSClientBatch, generateId } from '../utils/helpers';
import { apiPut, apiPost, apiPatch } from '../api/client';
import { usePersistedState } from '../hooks/usePersistedState';
import ClientDetailModal from '../components/ClientDetailModal';

export default function ClientsPlanningPage() {
  const { state, dispatchLocal, getCommercial } = useApp();
  const toast = useToast();
  const isAdmin = state.currentUser?.role === 'admin';
  const scrollRef = useRef<HTMLDivElement>(null);

  // Client detail modal state
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const [planningWeekOffset, setPlanningWeekOffset] = useState(0);
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const [lateCollapsed, setLateCollapsed] = useState(true);

  // Planning-specific commercial filter (defaults to current user)
  const [planningCommercialId, setPlanningCommercialId] = usePersistedState<string>(
    'planning_commercial',
    state.currentUser?.id || ''
  );

  // Tournee configs
  const [tourneeConfigs, setTourneeConfigs] = useState<Record<string, { config: Record<string, string[]>; week_pattern: string }>>({});

  // Load tournee configs
  useEffect(() => {
    const token = localStorage.getItem('suivipro_token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    fetch('/api/tournee-config', { headers })
      .then(r => r.ok ? r.json() : [])
      .then((rows: any[]) => {
        const map: Record<string, { config: Record<string, string[]>; week_pattern: string }> = {};
        rows.forEach(r => {
          const cfg = typeof r.config === 'string' ? JSON.parse(r.config) : r.config;
          map[r.commercial_id] = { config: cfg, week_pattern: r.week_pattern || 'every' };
        });
        setTourneeConfigs(map);
      })
      .catch(err => console.error('Failed to load tournee configs:', err));
  }, []);

  // CR modal state
  const [crModalRdv, setCrModalRdv] = useState<Appointment | null>(null);
  const [crForms, setCrForms] = useState<Record<string, { compte_rendu: AppointmentResult; notes: string }>>({});
  const [crSaving, setCrSaving] = useState<string | null>(null);
  const [showRappelSection, setShowRappelSection] = useState(false);
  const [rappelDate, setRappelDate] = useState('');
  const [rappelMessage, setRappelMessage] = useState('');

  // Scheduling mode state
  const [schedulingDay, setSchedulingDay] = useState<string | null>(null);
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [showSchedulingModal, setShowSchedulingModal] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<string>('');
  const [scheduleStartTime, setScheduleStartTime] = useState('09:00');
  const [scheduleSlotDuration, setScheduleSlotDuration] = useState(30);
  const [scheduleEntries, setScheduleEntries] = useState<Array<{
    clientId: string;
    startTime: string;
    endTime: string;
  }>>([]);

  // Mass action mode state
  const [massActionDay, setMassActionDay] = useState<string | null>(null);
  const [massSelectedClients, setMassSelectedClients] = useState<Set<string>>(new Set());
  const [showMassActionModal, setShowMassActionModal] = useState(false);
  const [massAction, setMassAction] = useState<'inactif' | 'note' | 'visite' | 'commercial' | null>(null);
  const [massNote, setMassNote] = useState('');
  const [massCommercialId, setMassCommercialId] = useState('');
  const [massSaving, setMassSaving] = useState(false);

  // Results card state
  const [resultsPeriod, setResultsPeriod] = usePersistedState<'semaine' | 'mois' | 'trimestre' | 'tout'>('planning_results_period', 'semaine');
  const [expandedResult, setExpandedResult] = useState<string | null>(null);

  const openCrModal = (rdv: Appointment) => {
    setCrModalRdv(rdv);
    if (!crForms[rdv.id]) {
      setCrForms(prev => ({ ...prev, [rdv.id]: { compte_rendu: (rdv.compte_rendu || '') as AppointmentResult, notes: rdv.notes_compte_rendu || '' } }));
    }
    setShowRappelSection(false);
    setRappelDate('');
    setRappelMessage('');
  };

  const saveCrModal = async () => {
    if (!crModalRdv) return;
    const form = crForms[crModalRdv.id];
    if (!form?.compte_rendu) { toast.error('Selectionnez un resultat'); return; }
    if (!form.notes?.trim()) { toast.error('Les notes sont obligatoires'); return; }
    setCrSaving(crModalRdv.id);
    try {
      const updated = { ...crModalRdv, statut: 'termine' as const, compte_rendu: form.compte_rendu, notes_compte_rendu: form.notes };
      await apiPut(`/appointments/${crModalRdv.id}`, updated);
      dispatchLocal({ type: 'UPDATE_APPOINTMENT', payload: updated });

      // Update prospect pipeline stage based on result (same logic as ProspectsPage)
      const prospect = state.prospects.find((p: any) => p.id === crModalRdv.prospect_id);
      if (prospect) {
        const terminal = ['client_gagne', 'perdu', 'ne_pas_contacter'];
        let newStage: PipelineStage | null = null;
        if (form.compte_rendu === 'client') {
          newStage = 'client_gagne';
        } else if (form.compte_rendu === 'pas_interesse') {
          newStage = 'perdu';
        } else if (form.compte_rendu === 'mail_envoye') {
          if (!terminal.includes(prospect.etape_pipeline)) newStage = 'negociation';
        } else if (form.compte_rendu === 'commande_plus_tard' || form.compte_rendu === 'a_relancer') {
          if (!terminal.includes(prospect.etape_pipeline)) newStage = 'proposition';
        }
        if (newStage) {
          try {
            await apiPatch(`/prospects/${prospect.id}/stage`, { etape_pipeline: newStage, date_modification: new Date().toISOString() });
            dispatchLocal({ type: 'MOVE_PROSPECT', payload: { id: prospect.id, stage: newStage } });
          } catch (err) {
            toast.error(`Erreur deplacement prospect: ${(err as Error).message}`);
          }
        }
      }

      // Create reminder if rappel section is filled
      if (showRappelSection && rappelDate) {
        const autoMessage = rappelMessage.trim() || `Relance suite RDV ${prospect?.nom_etablissement || ''} - ${APPOINTMENT_RESULT_LABELS[form.compte_rendu] || 'RDV termine'}`;
        const reminderPayload = {
          id: generateId('rem'),
          prospect_id: crModalRdv.prospect_id,
          commercial_id: crModalRdv.commercial_id,
          date: rappelDate,
          heure: '09:00',
          message: autoMessage,
          statut: 'actif' as const,
        };
        try {
          await apiPost('/reminders', reminderPayload);
          dispatchLocal({ type: 'ADD_REMINDER', payload: reminderPayload });
        } catch (err) {
          toast.error(`Erreur creation rappel: ${(err as Error).message}`);
        }
      }

      toast.success('Compte rendu enregistre');
      setCrModalRdv(null);
    } catch { toast.error('Erreur lors de la sauvegarde'); }
    finally { setCrSaving(null); }
  };

  // --- Scheduling helpers ---
  const parseTimeToMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const minutesToTime = (mins: number) => {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const computeScheduleEntries = useCallback((clientIds: string[], startTime: string, duration: number) => {
    let current = parseTimeToMinutes(startTime);
    return clientIds.map(id => {
      const start = minutesToTime(current);
      const end = minutesToTime(current + duration);
      current += duration;
      return { clientId: id, startTime: start, endTime: end };
    });
  }, []);

  const toggleSchedulingDay = useCallback((dateStr: string) => {
    // Exit mass action mode if active
    if (massActionDay) { setMassActionDay(null); setMassSelectedClients(new Set()); }
    if (schedulingDay === dateStr) {
      setSchedulingDay(null);
      setSelectedClients(new Set());
    } else {
      setSchedulingDay(dateStr);
      setSelectedClients(new Set());
      setCollapsedDays(prev => {
        const next = new Set(prev);
        next.delete(dateStr);
        return next;
      });
    }
  }, [schedulingDay, massActionDay]);

  const toggleClientSelection = useCallback((clientId: string) => {
    setSelectedClients(prev => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId); else next.add(clientId);
      return next;
    });
  }, []);

  const openSchedulingModal = useCallback(() => {
    const dayStr = schedulingDay || '';
    setScheduleDate(dayStr);
    const entries = computeScheduleEntries(Array.from(selectedClients), scheduleStartTime, scheduleSlotDuration);
    setScheduleEntries(entries);
    setShowSchedulingModal(true);
  }, [schedulingDay, selectedClients, scheduleStartTime, scheduleSlotDuration, computeScheduleEntries]);

  const recalculateSchedule = useCallback(() => {
    const ids = scheduleEntries.map(e => e.clientId);
    setScheduleEntries(computeScheduleEntries(ids, scheduleStartTime, scheduleSlotDuration));
  }, [scheduleEntries, scheduleStartTime, scheduleSlotDuration, computeScheduleEntries]);

  const removeFromSchedule = useCallback((clientId: string) => {
    setScheduleEntries(prev => prev.filter(e => e.clientId !== clientId));
    setSelectedClients(prev => {
      const next = new Set(prev);
      next.delete(clientId);
      return next;
    });
  }, []);

  const [scheduleSaving, setScheduleSaving] = useState(false);

  const getScheduleICSEntries = useCallback(() => {
    const dateToUse = scheduleDate || schedulingDay || '';
    return scheduleEntries.map(e => {
      const client = state.clients.find(c => c.id === e.clientId);
      return client ? { client, date: dateToUse, startTime: e.startTime, endTime: e.endTime } : null;
    }).filter(Boolean) as Array<{ client: Client; date: string; startTime: string; endTime: string }>;
  }, [scheduleEntries, scheduleDate, schedulingDay, state.clients]);

  const [showConfirmExport, setShowConfirmExport] = useState(false);

  const handleExportICS = useCallback(() => {
    if (scheduleEntries.length === 0) return;
    setShowConfirmExport(true);
  }, [scheduleEntries]);

  const confirmExportAndSave = useCallback(async () => {
    const entries = getScheduleICSEntries();
    if (entries.length === 0) return;
    const userId = state.currentUser?.id;
    if (!userId) return;

    setScheduleSaving(true);
    try {
      const now = new Date().toISOString();
      for (const entry of entries) {
        const interaction: Interaction = {
          id: generateId('int'),
          client_id: entry.client.id,
          commercial_id: userId,
          type: 'VISITE',
          date: `${entry.date}T${entry.startTime}:00`,
          comment: `Visite planifiee (${entry.startTime} - ${entry.endTime})`,
          date_creation: now,
        };
        await apiPost('/interactions', interaction);
        dispatchLocal({ type: 'ADD_INTERACTION', payload: interaction });
      }

      downloadICSClientBatch(entries, `visites-${entries[0].date}.ics`);
      toast.success(`${entries.length} visite${entries.length > 1 ? 's' : ''} enregistree${entries.length > 1 ? 's' : ''} et exportee${entries.length > 1 ? 's' : ''}`);
      setShowConfirmExport(false);
      setShowSchedulingModal(false);
      setSelectedClients(new Set());
      setSchedulingDay(null);
    } catch {
      toast.error('Erreur lors de l\'enregistrement des visites');
    } finally {
      setScheduleSaving(false);
    }
  }, [getScheduleICSEntries, state.currentUser, dispatchLocal, toast]);

  // --- Mass action helpers ---
  const toggleMassActionDay = useCallback((dateStr: string) => {
    if (massActionDay === dateStr) {
      setMassActionDay(null);
      setMassSelectedClients(new Set());
    } else {
      setMassActionDay(dateStr);
      setMassSelectedClients(new Set());
      setCollapsedDays(prev => { const next = new Set(prev); next.delete(dateStr); return next; });
    }
    // Exit scheduling mode if active
    if (schedulingDay) { setSchedulingDay(null); setSelectedClients(new Set()); }
  }, [massActionDay, schedulingDay]);

  const toggleMassClientSelection = useCallback((clientId: string) => {
    setMassSelectedClients(prev => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId); else next.add(clientId);
      return next;
    });
  }, []);

  const openMassActionModal = useCallback(() => {
    setMassAction(null);
    setMassNote('');
    setMassCommercialId('');
    setShowMassActionModal(true);
  }, []);

  const executeMassAction = useCallback(async () => {
    if (!massAction || massSelectedClients.size === 0) return;
    const userId = state.currentUser?.id;
    if (!userId) return;
    setMassSaving(true);
    const now = new Date().toISOString();
    const clientIds = Array.from(massSelectedClients);

    try {
      if (massAction === 'inactif') {
        for (const clientId of clientIds) {
          const client = state.clients.find(c => c.id === clientId);
          if (!client) continue;
          const updated = { ...client, statut: 'INACTIF' as const, date_modification: now };
          await apiPut(`/clients/${clientId}`, updated);
          dispatchLocal({ type: 'UPDATE_CLIENT', payload: updated });
        }
        toast.success(`${clientIds.length} client${clientIds.length > 1 ? 's' : ''} passe${clientIds.length > 1 ? 's' : ''} en inactif`);
      } else if (massAction === 'note') {
        if (!massNote.trim()) { toast.error('La note est obligatoire'); setMassSaving(false); return; }
        for (const clientId of clientIds) {
          const client = state.clients.find(c => c.id === clientId);
          if (!client) continue;
          const existingNotes = client.notes ? `${client.notes}\n` : '';
          const updated = { ...client, notes: `${existingNotes}[${new Date().toLocaleDateString('fr-FR')}] ${massNote.trim()}`, date_modification: now };
          await apiPut(`/clients/${clientId}`, updated);
          dispatchLocal({ type: 'UPDATE_CLIENT', payload: updated });
        }
        toast.success(`Note ajoutee a ${clientIds.length} client${clientIds.length > 1 ? 's' : ''}`);
      } else if (massAction === 'visite') {
        for (const clientId of clientIds) {
          const interaction: Interaction = {
            id: generateId('int'),
            client_id: clientId,
            commercial_id: userId,
            type: 'VISITE',
            date: now,
            comment: massNote.trim() || 'Visite enregistree',
            date_creation: now,
          };
          await apiPost('/interactions', interaction);
          dispatchLocal({ type: 'ADD_INTERACTION', payload: interaction });
        }
        toast.success(`Visite enregistree pour ${clientIds.length} client${clientIds.length > 1 ? 's' : ''}`);
      } else if (massAction === 'commercial') {
        if (!massCommercialId) { toast.error('Selectionnez un commercial'); setMassSaving(false); return; }
        for (const clientId of clientIds) {
          const client = state.clients.find(c => c.id === clientId);
          if (!client) continue;
          const updated = { ...client, commercial_id: massCommercialId, date_modification: now };
          await apiPut(`/clients/${clientId}`, updated);
          dispatchLocal({ type: 'UPDATE_CLIENT', payload: updated });
        }
        const comm = getCommercial(massCommercialId);
        toast.success(`${clientIds.length} client${clientIds.length > 1 ? 's' : ''} reassigne${clientIds.length > 1 ? 's' : ''} a ${comm?.prenom || 'commercial'}`);
      }

      setShowMassActionModal(false);
      setMassSelectedClients(new Set());
      setMassActionDay(null);
    } catch {
      toast.error('Erreur lors de l\'action de masse');
    } finally {
      setMassSaving(false);
    }
  }, [massAction, massSelectedClients, massNote, massCommercialId, state.clients, state.currentUser, dispatchLocal, toast, getCommercial]);

  const getRdvEntityName = (rdv: Appointment) => {
    if (rdv.client_id) {
      const c = state.clients.find(cl => cl.id === rdv.client_id);
      return c?.nom || 'Client inconnu';
    }
    const p = state.prospects.find(pr => pr.id === rdv.prospect_id);
    return p?.nom_etablissement || 'Prospect inconnu';
  };

  const getRdvEntityPhone = (rdv: Appointment) => {
    if (rdv.client_id) {
      const c = state.clients.find(cl => cl.id === rdv.client_id);
      return c?.telephone_mobile || c?.telephone || '';
    }
    const p = state.prospects.find(pr => pr.id === rdv.prospect_id);
    return p?.telephone || '';
  };

  const toggleDay = useCallback((dateStr: string) => {
    setCollapsedDays(prev => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr);
      else next.add(dateStr);
      return next;
    });
  }, []);

  // Planning data computation
  const planningData = useMemo(() => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + (planningWeekOffset * 7));
    monday.setHours(0, 0, 0, 0);

    const startOfYear = new Date(monday.getFullYear(), 0, 1);
    const weekNumber = Math.ceil(((monday.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);

    const days: { date: Date; dateStr: string; label: string; dayKey: string }[] = [];
    const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    for (let i = 0; i < 6; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push({
        date: d,
        dateStr: toLocalDateStr(d),
        label: `${dayNames[i]} ${d.getDate()}/${d.getMonth() + 1}`,
        dayKey: String(i + 1),
      });
    }

    const weekStart = days[0].dateStr;

    const targetCommercialId = planningCommercialId || (state.currentUser ? state.currentUser.id : '');

    let clientsBase = state.clients.filter(c => c.statut === 'ACTIF');
    if (targetCommercialId) {
      clientsBase = clientsBase.filter(c => c.commercial_id === targetCommercialId);
    }

    // Late clients
    const lateClients = clientsBase.filter(c => c.next_visit && c.next_visit < weekStart);
    const groupByTournee = (clients: Client[]) => {
      const groups: Record<string, Client[]> = {};
      clients.forEach(c => {
        const key = c.tournee || 'Sans secteur';
        if (!groups[key]) groups[key] = [];
        groups[key].push(c);
      });
      return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
    };
    const lateGroups = groupByTournee(lateClients);

    type DayData = {
      date: Date;
      dateStr: string;
      label: string;
      dayKey: string;
      sectors: { zone: string; clients: Client[]; visitDueClients: Client[] }[];
      totalClients: number;
      visitDueCount: number;
    };

    const byDay: DayData[] = days.map(day => {
      const zonesToShow = new Set<string>();
      const commercialIds = targetCommercialId ? [targetCommercialId] : Object.keys(tourneeConfigs);

      for (const commId of commercialIds) {
        const tc = tourneeConfigs[commId];
        if (!tc) continue;
        if (tc.week_pattern === 'even' && weekNumber % 2 !== 0) continue;
        if (tc.week_pattern === 'odd' && weekNumber % 2 !== 1) continue;
        const dayZones = tc.config[day.dayKey];
        if (Array.isArray(dayZones)) {
          dayZones.forEach(z => { if (typeof z === 'string') zonesToShow.add(z); });
        }
      }

      const sectors = Array.from(zonesToShow).sort().map(zone => {
        const zoneClients = clientsBase.filter(c =>
          c.tournee && c.tournee.toLowerCase() === zone.toLowerCase()
        );
        const visitDueClients = zoneClients.filter(c =>
          c.next_visit && c.next_visit <= day.dateStr
        );
        return { zone, clients: zoneClients, visitDueClients };
      });

      const totalClients = sectors.reduce((sum, s) => sum + s.clients.length, 0);
      const visitDueCount = sectors.reduce((sum, s) => sum + s.visitDueClients.length, 0);

      return { ...day, sectors, totalClients, visitDueCount };
    });

    // Appointments for the week
    const weekEnd = days[days.length - 1].dateStr;
    const weekAppointments = state.appointments.filter(rdv => {
      if (rdv.statut === 'annule') return false;
      if (rdv.date < weekStart || rdv.date > weekEnd) return false;
      if (targetCommercialId && rdv.commercial_id !== targetCommercialId) return false;
      return true;
    });

    const rdvByDate: Record<string, Appointment[]> = {};
    weekAppointments.forEach(rdv => {
      const d = rdv.date.split('T')[0];
      if (!rdvByDate[d]) rdvByDate[d] = [];
      rdvByDate[d].push(rdv);
    });
    Object.values(rdvByDate).forEach(arr => arr.sort((a, b) => (a.heure_debut || '').localeCompare(b.heure_debut || '')));

    const weekLabel = `${days[0].date.getDate()}/${days[0].date.getMonth() + 1} - ${days[days.length - 1].date.getDate()}/${days[days.length - 1].date.getMonth() + 1}/${days[days.length - 1].date.getFullYear()}`;
    const weekTotal = byDay.reduce((sum, d) => sum + d.totalClients, 0);

    return { days: byDay, lateGroups, lateCount: lateClients.length, weekLabel, weekTotal, rdvByDate };
  }, [state.clients, state.appointments, planningWeekOffset, state.currentUser, planningCommercialId, tourneeConfigs]);

  // Results card data - filtered by period
  const resultsData = useMemo(() => {
    const now = new Date();
    const todayStr = toLocalDateStr(now);
    let startDate = '';
    let endDate = todayStr;
    let periodLabel = '';

    if (resultsPeriod === 'semaine') {
      // Use same week as planningData
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + (planningWeekOffset * 7));
      monday.setHours(0, 0, 0, 0);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      startDate = toLocalDateStr(monday);
      endDate = toLocalDateStr(sunday);
      periodLabel = `Sem. ${monday.getDate()}/${monday.getMonth() + 1} - ${sunday.getDate()}/${sunday.getMonth() + 1}`;
    } else if (resultsPeriod === 'mois') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      startDate = toLocalDateStr(firstDay);
      endDate = toLocalDateStr(lastDay);
      const monthNames = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
      periodLabel = monthNames[now.getMonth()] + ' ' + now.getFullYear();
    } else if (resultsPeriod === 'trimestre') {
      const quarter = Math.floor(now.getMonth() / 3);
      const firstDay = new Date(now.getFullYear(), quarter * 3, 1);
      const lastDay = new Date(now.getFullYear(), quarter * 3 + 3, 0);
      startDate = toLocalDateStr(firstDay);
      endDate = toLocalDateStr(lastDay);
      periodLabel = `T${quarter + 1} ${now.getFullYear()}`;
    } else {
      // tout
      startDate = '2000-01-01';
      endDate = '2099-12-31';
      periodLabel = 'Totalite';
    }

    const targetCommercialId = planningCommercialId || (state.currentUser ? state.currentUser.id : '');

    const filteredAppointments = state.appointments.filter(rdv => {
      if (rdv.statut === 'annule') return false;
      const rdvDate = rdv.date.split('T')[0];
      if (rdvDate < startDate || rdvDate > endDate) return false;
      if (targetCommercialId && rdv.commercial_id !== targetCommercialId) return false;
      return true;
    });

    const resultCounts: Record<string, number> = {};
    let rdvWithCR = 0;
    filteredAppointments.forEach(a => {
      if (a.compte_rendu) {
        resultCounts[a.compte_rendu] = (resultCounts[a.compte_rendu] || 0) + 1;
        rdvWithCR++;
      }
    });
    // Add "sans_cr" for past appointments without CR
    const sansCr = filteredAppointments.filter(a => !a.compte_rendu && a.date.split('T')[0] <= todayStr).length;
    if (sansCr > 0) {
      resultCounts.sans_cr = sansCr;
    }

    // Add "cr_a_venir" for upcoming appointments without CR
    const crAVenir = filteredAppointments.filter(a => !a.compte_rendu && a.date.split('T')[0] > todayStr).length;
    if (crAVenir > 0) {
      resultCounts.cr_a_venir = crAVenir;
    }

    return { resultCounts, filteredAppointments, totalRdv: filteredAppointments.length, rdvWithCR, periodLabel, startDate, endDate };
  }, [state.appointments, resultsPeriod, planningWeekOffset, planningCommercialId, state.currentUser]);

  const getResultEntityName = (rdv: Appointment) => {
    if (rdv.client_id) {
      const c = state.clients.find((cl: Client) => cl.id === rdv.client_id);
      return c?.nom || 'Client inconnu';
    }
    const p = state.prospects.find((pr: any) => pr.id === rdv.prospect_id);
    return p?.nom_etablissement || 'Prospect inconnu';
  };

  const getResultEntityInfo = (rdv: Appointment) => {
    if (rdv.client_id) {
      const c = state.clients.find((cl: Client) => cl.id === rdv.client_id);
      return { phone: c?.telephone_mobile || c?.telephone || '', email: c?.email || '', ville: c?.ville || '', link: `/clients?id=${rdv.client_id}`, isClient: true };
    }
    const p = state.prospects.find((pr: any) => pr.id === rdv.prospect_id);
    return { phone: p?.telephone || '', email: p?.email || '', ville: p?.ville || '', link: `/prospects?id=${rdv.prospect_id}`, isClient: false };
  };

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Resultats des RDV - interactive card with period selector */}
      {resultsData.totalRdv > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          {/* Header with period selector */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-indigo-500" />
              <p className="text-sm font-semibold text-gray-700">Resultats des RDV</p>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">{resultsData.totalRdv} RDV</span>
            </div>
            <p className="text-[10px] text-gray-400 italic hidden sm:block">Cliquez pour voir le detail</p>
          </div>

          {/* Period selector */}
          <div className="flex items-center gap-1.5 mb-3 flex-wrap">
            <Filter className="w-3.5 h-3.5 text-gray-400" />
            {([
              { key: 'semaine' as const, label: 'Cette semaine' },
              { key: 'mois' as const, label: 'Ce mois' },
              { key: 'trimestre' as const, label: 'Trimestre' },
              { key: 'tout' as const, label: 'Totalite' },
            ]).map(p => (
              <button
                key={p.key}
                onClick={() => { setResultsPeriod(p.key); setExpandedResult(null); }}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${
                  resultsPeriod === p.key
                    ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300'
                    : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                }`}
              >
                {p.label}
              </button>
            ))}
            <span className="text-[10px] text-gray-400 ml-1">({resultsData.periodLabel})</span>
          </div>

          {/* Stats summary */}
          <div className="flex items-center gap-3 mb-3 text-[11px]">
            <span className="text-gray-500"><strong className="text-green-600">{resultsData.rdvWithCR}</strong> CR saisis</span>
            <span className="text-gray-300">|</span>
            <span className="text-gray-500">Taux CR: <strong className={resultsData.totalRdv > 0 && resultsData.rdvWithCR / resultsData.totalRdv >= 0.8 ? 'text-green-600' : 'text-orange-600'}>{resultsData.totalRdv > 0 ? Math.round((resultsData.rdvWithCR / resultsData.totalRdv) * 100) : 0}%</strong></span>
          </div>

          {/* Result badges */}
          {Object.keys(resultsData.resultCounts).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(resultsData.resultCounts).map(([key, count]) => {
                const colors: Record<string, string> = {
                  client: 'bg-green-100 text-green-700 hover:bg-green-200 border-green-200',
                  mail_envoye: 'bg-blue-100 text-blue-700 hover:bg-blue-200 border-blue-200',
                  commande_plus_tard: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200 border-yellow-200',
                  a_relancer: 'bg-orange-100 text-orange-700 hover:bg-orange-200 border-orange-200',
                  pas_interesse: 'bg-red-100 text-red-700 hover:bg-red-200 border-red-200',
                  decale: 'bg-violet-100 text-violet-700 hover:bg-violet-200 border-violet-200',
                  sans_cr: 'bg-gray-100 text-gray-700 hover:bg-gray-200 border-gray-300',
                  cr_a_venir: 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 border-indigo-200',
                };
                const isActive = expandedResult === key;
                return (
                  <button key={key} onClick={() => setExpandedResult(isActive ? null : key)}
                    className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer transition-all ${colors[key] || 'bg-gray-100 text-gray-600 hover:bg-gray-200 border-gray-200'} ${isActive ? 'ring-2 ring-offset-1 ring-gray-400 scale-105 shadow-sm' : 'hover:scale-105 hover:shadow-sm'}`}>
                    {key === 'sans_cr' ? 'Sans CR' : key === 'cr_a_venir' ? 'CR a venir' : (APPOINTMENT_RESULT_LABELS[key] || key)}: {count}
                    <ChevronDown className={`w-3 h-3 transition-transform ${isActive ? 'rotate-180' : 'group-hover:translate-y-0.5'}`} />
                  </button>
                );
              })}
            </div>
          )}

          {/* Expanded result detail */}
          {expandedResult && (() => {
            const todayDate = toLocalDateStr(new Date());
            const rdvsForResult = expandedResult === 'sans_cr'
              ? resultsData.filteredAppointments.filter(a => !a.compte_rendu && a.date.split('T')[0] <= todayDate)
              : expandedResult === 'cr_a_venir'
              ? resultsData.filteredAppointments.filter(a => !a.compte_rendu && a.date.split('T')[0] > todayDate)
              : resultsData.filteredAppointments.filter(a => a.compte_rendu === expandedResult);
            const resultColors: Record<string, string> = {
              client: 'border-green-200', mail_envoye: 'border-blue-200',
              commande_plus_tard: 'border-yellow-200', a_relancer: 'border-orange-200',
              pas_interesse: 'border-red-200', decale: 'border-violet-200',
              sans_cr: 'border-gray-300', cr_a_venir: 'border-indigo-200',
            };

            return (
              <div className="mt-3 border-t pt-3 space-y-2">
                <p className="text-xs text-gray-500 font-medium">
                  {expandedResult === 'sans_cr' ? 'Sans compte-rendu' : expandedResult === 'cr_a_venir' ? 'CR a venir' : (APPOINTMENT_RESULT_LABELS[expandedResult] || expandedResult)} ({rdvsForResult.length})
                </p>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {rdvsForResult.map(rdv => {
                    const name = getResultEntityName(rdv);
                    const info = getResultEntityInfo(rdv);
                    return (
                      <div key={rdv.id} className={`bg-white rounded-lg border ${resultColors[expandedResult] || 'border-gray-200'} p-3`}>
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <button onClick={() => { if (rdv.client_id) setSelectedClientId(rdv.client_id); }} className="text-sm font-medium text-brewery-700 hover:text-brewery-900 hover:underline text-left">{name}</button>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${info.isClient ? 'bg-green-100 text-green-700' : 'bg-indigo-100 text-indigo-700'}`}>
                                {info.isClient ? 'Client' : 'Prospect'}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-gray-500 mt-1 flex-wrap">
                              <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{(() => { const d = new Date(rdv.date.split('T')[0] + 'T12:00:00'); const jours = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']; return `${jours[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`; })()}</span>
                              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{rdv.heure_debut}{rdv.heure_fin ? ` - ${rdv.heure_fin}` : ''}</span>
                              {info.ville && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{info.ville}</span>}
                            </div>
                            {rdv.notes_compte_rendu && <p className="text-xs text-gray-500 italic mt-1 truncate">{rdv.notes_compte_rendu}</p>}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                            {info.phone && (
                              <a href={`tel:${info.phone.replace(/\s/g, '')}`} onClick={e => e.stopPropagation()}
                                className="p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100" title="Appeler">
                                <Phone className="w-3.5 h-3.5" />
                              </a>
                            )}
                            {info.email && (
                              <a href={`mailto:${info.email}`} onClick={e => e.stopPropagation()}
                                className="p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100" title="Email">
                                <Mail className="w-3.5 h-3.5" />
                              </a>
                            )}
                            <button onClick={() => openCrModal(rdv)}
                              className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100" title="Modifier le CR">
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Commercial selector */}
      {state.commerciaux.length > 1 && (
        <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 px-4 py-2">
          <Users className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <div className="flex flex-wrap gap-1.5">
            {state.commerciaux.map(c => {
              const active = planningCommercialId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setPlanningCommercialId(active ? '' : c.id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    active ? 'bg-brewery-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {c.prenom}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Week navigation */}
      <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-4 py-2.5">
        <button onClick={() => setPlanningWeekOffset(o => o - 1)} className="p-1.5 rounded-lg hover:bg-gray-100">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="text-center">
          <span className="font-semibold text-sm text-gray-900">Semaine du {planningData.weekLabel}</span>
          <span className="text-xs text-gray-500 ml-2">({planningData.weekTotal} client{planningData.weekTotal > 1 ? 's' : ''})</span>
        </div>
        <div className="flex items-center gap-1">
          {planningWeekOffset !== 0 && (
            <button onClick={() => setPlanningWeekOffset(0)} className="px-2 py-1 text-[10px] text-brewery-600 hover:bg-brewery-50 rounded">
              Aujourd'hui
            </button>
          )}
          <button onClick={() => setPlanningWeekOffset(o => o + 1)} className="p-1.5 rounded-lg hover:bg-gray-100">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Late clients - collapsible */}
      {planningData.lateCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg">
          <button
            onClick={() => setLateCollapsed(prev => !prev)}
            className="w-full flex items-center justify-between p-3 text-left"
          >
            <h3 className="text-sm font-semibold text-red-700 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" />
              En retard ({planningData.lateCount})
            </h3>
            {lateCollapsed ? <ChevronDown className="w-4 h-4 text-red-400" /> : <ChevronUp className="w-4 h-4 text-red-400" />}
          </button>
          {!lateCollapsed && (
            <div className="px-3 pb-3 space-y-2">
              {planningData.lateGroups.map(([tournee, clients]) => (
                <div key={tournee}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Map className="w-3 h-3 text-red-500" />
                    <span className="text-xs font-medium text-red-600">{tournee}</span>
                    <span className="text-[10px] text-red-400">({clients.length})</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 ml-4">
                    {clients.map(c => (
                      <button
                        key={c.id}
                        onClick={() => setSelectedClientId(c.id)}
                        className="px-2 py-1 bg-white border border-red-200 rounded text-xs text-red-700 hover:bg-red-100 transition-colors flex items-center gap-1"
                      >
                        <span className="font-medium">{c.nom}</span>
                        <span className="text-[10px] text-red-400">{c.ville}</span>
                        {c.next_visit && <span className="text-[9px] text-red-300">({c.next_visit.substring(5).replace('-', '/')})</span>}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Days of the week - collapsible */}
      <div className="space-y-3">
        {planningData.days.map(day => {
          const isToday = day.dateStr === toLocalDateStr(new Date());
          const isPast = day.dateStr < toLocalDateStr(new Date());
          const isCollapsed = collapsedDays.has(day.dateStr);
          return (
            <div
              key={day.dateStr}
              className={`rounded-lg border ${
                isToday ? 'bg-brewery-50 border-brewery-300' : isPast ? 'bg-gray-50 border-gray-200 opacity-70' : 'bg-white border-gray-200'
              }`}
            >
              {/* Day header */}
              <div className="flex items-center justify-between p-3">
                <button
                  onClick={() => toggleDay(day.dateStr)}
                  className="flex-1 flex items-center justify-between text-left"
                >
                  <h3 className={`text-sm font-semibold ${isToday ? 'text-brewery-700' : 'text-gray-700'}`}>
                    {day.label}
                    {isToday && <span className="ml-2 px-1.5 py-0.5 bg-brewery-600 text-white rounded text-[10px]">Aujourd'hui</span>}
                  </h3>
                  <div className="flex items-center gap-2">
                    {day.visitDueCount > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded font-medium">
                        {day.visitDueCount} a visiter
                      </span>
                    )}
                    <span className="text-xs text-gray-400">{day.totalClients} client{day.totalClients > 1 ? 's' : ''}</span>
                    {(planningData.rdvByDate[day.dateStr] || []).length > 0 && (
                      <span className="text-xs font-medium text-blue-600">
                        {planningData.rdvByDate[day.dateStr].length} rendez-vous
                      </span>
                    )}
                    {isCollapsed ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronUp className="w-4 h-4 text-gray-400" />}
                  </div>
                </button>
                {day.totalClients > 0 && (
                  <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSchedulingDay(day.dateStr); }}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all ${
                        schedulingDay === day.dateStr
                          ? 'bg-brewery-600 text-white ring-2 ring-brewery-300'
                          : 'bg-gray-100 text-gray-500 hover:bg-brewery-50 hover:text-brewery-600'
                      }`}
                      title="Selectionner des clients pour planifier les visites"
                    >
                      <CalendarPlus className="w-3.5 h-3.5" />
                      {schedulingDay === day.dateStr ? 'Annuler' : 'Planifier'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleMassActionDay(day.dateStr); }}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all ${
                        massActionDay === day.dateStr
                          ? 'bg-indigo-600 text-white ring-2 ring-indigo-300'
                          : 'bg-gray-100 text-gray-500 hover:bg-indigo-50 hover:text-indigo-600'
                      }`}
                      title="Selectionner des clients pour actions de masse"
                    >
                      <Settings2 className="w-3.5 h-3.5" />
                      {massActionDay === day.dateStr ? 'Annuler' : 'Actions'}
                    </button>
                  </div>
                )}
              </div>

              {/* Day content - collapsible */}
              {!isCollapsed && (
                <div className="px-3 pb-3">
                  {/* RDV section */}
                  {(planningData.rdvByDate[day.dateStr] || []).length > 0 && (
                    <div className="mb-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                        <span className="text-xs font-semibold text-indigo-600">Rendez-vous ({planningData.rdvByDate[day.dateStr].length})</span>
                      </div>
                      <div className="space-y-2 ml-1">
                        {planningData.rdvByDate[day.dateStr].map(rdv => {
                          const hasCR = !!rdv.compte_rendu;
                          const entityName = getRdvEntityName(rdv);
                          const entityPhone = getRdvEntityPhone(rdv);
                          const comm = getCommercial(rdv.commercial_id);
                          return (
                            <div key={rdv.id} className={`rounded-lg border p-2.5 ${hasCR ? 'border-green-200 bg-green-50/50' : 'border-indigo-200 bg-indigo-50/30'}`}>
                              <div className="flex items-start gap-2">
                                {hasCR
                                  ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                  : <AlertTriangle className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
                                }
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-xs text-gray-800">{entityName}</span>
                                    {isAdmin && comm && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{comm.prenom}</span>}
                                    {hasCR && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">{APPOINTMENT_RESULT_LABELS[rdv.compte_rendu!] || rdv.compte_rendu}</span>}
                                  </div>
                                  <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
                                    {rdv.heure_debut && <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" />{rdv.heure_debut}{rdv.heure_fin ? ` - ${rdv.heure_fin}` : ''}</span>}
                                    {rdv.lieu && <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{rdv.lieu}</span>}
                                  </div>
                                  {rdv.notes && <p className="text-[10px] text-gray-400 mt-0.5 italic line-clamp-1">{rdv.notes}</p>}
                                  {hasCR && rdv.notes_compte_rendu && <p className="text-[10px] text-green-600 mt-0.5 italic line-clamp-1">{rdv.notes_compte_rendu}</p>}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-gray-100">
                                <button
                                  onClick={() => openCrModal(rdv)}
                                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                    hasCR ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-indigo-600 text-white hover:bg-indigo-700'
                                  }`}
                                >
                                  <ClipboardCheck className="w-3.5 h-3.5" /> {hasCR ? 'Modifier le CR' : 'Compte-rendu'}
                                </button>
                                {entityPhone && (
                                  <a href={`tel:${entityPhone.replace(/\s/g, '')}`} onClick={e => e.stopPropagation()}
                                    className="p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 transition-colors">
                                    <Phone className="w-3.5 h-3.5" />
                                  </a>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {day.sectors.length === 0 && !(planningData.rdvByDate[day.dateStr] || []).length ? (
                    <p className="text-xs text-gray-400 italic">Aucun secteur prevu ce jour</p>
                  ) : day.sectors.length > 0 ? (
                    <div className="space-y-3">
                      {day.sectors.map(sector => (
                        <div key={sector.zone}>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Map className="w-3.5 h-3.5 text-indigo-400" />
                            <span className="text-xs font-semibold text-indigo-600">{sector.zone}</span>
                            <span className="text-[10px] text-gray-400">{sector.clients.length} client{sector.clients.length > 1 ? 's' : ''}</span>
                            {sector.visitDueClients.length > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-600 rounded">
                                {sector.visitDueClients.length} en attente
                              </span>
                            )}
                          </div>
                          {sector.clients.length === 0 ? (
                            <p className="text-[10px] text-gray-300 italic ml-5">Aucun client dans ce secteur</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5 ml-5">
                              {sector.clients.map(c => {
                                const comm = getCommercial(c.commercial_id);
                                const isDue = c.next_visit && c.next_visit <= day.dateStr;
                                const isLate = c.next_visit && c.next_visit < toLocalDateStr(new Date());
                                const isInSchedulingMode = schedulingDay === day.dateStr;
                                const isInMassMode = massActionDay === day.dateStr;
                                const isSelected = isInSchedulingMode && selectedClients.has(c.id);
                                const isMassSelected = isInMassMode && massSelectedClients.has(c.id);
                                return (
                                  <button
                                    key={c.id}
                                    onClick={() =>
                                      isInSchedulingMode ? toggleClientSelection(c.id)
                                      : isInMassMode ? toggleMassClientSelection(c.id)
                                      : setSelectedClientId(c.id)
                                    }
                                    className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors hover:shadow-sm text-left flex items-center gap-1 ${
                                      isSelected ? 'ring-2 ring-brewery-500 bg-brewery-50 border-brewery-400 text-brewery-800'
                                      : isMassSelected ? 'ring-2 ring-indigo-500 bg-indigo-50 border-indigo-400 text-indigo-800'
                                      : isLate ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                                      : isDue ? 'bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100'
                                      : isToday ? 'bg-white border-brewery-200 text-brewery-700 hover:bg-brewery-100'
                                      : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                                    }`}
                                  >
                                    {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-brewery-600 flex-shrink-0" />}
                                    {isMassSelected && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 flex-shrink-0" />}
                                    <span className="font-medium">{c.nom}</span>
                                    <span className="text-gray-400 ml-1">{c.ville}</span>
                                    {isDue && c.next_visit && (
                                      <span className="text-[9px] ml-1 opacity-60">
                                        ({c.next_visit.substring(5).replace('-', '/')})
                                      </span>
                                    )}
                                    {isAdmin && comm && <span className="text-[10px] text-gray-300 ml-1">• {comm.prenom}</span>}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Client Detail Modal */}
      {selectedClientId && (
        <ClientDetailModal
          clientId={selectedClientId}
          onClose={() => setSelectedClientId(null)}
        />
      )}

      {/* CR Modal */}
      {crModalRdv && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setCrModalRdv(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
                  <ClipboardCheck className="w-5 h-5 text-indigo-600" />
                  Compte-rendu du RDV
                </h3>
                <p className="text-sm text-gray-500 mt-0.5">{getRdvEntityName(crModalRdv)} - {crModalRdv.date}</p>
              </div>
              <button onClick={() => setCrModalRdv(null)} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-4">
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
                disabled={crSaving === crModalRdv.id || !crForms[crModalRdv.id]?.compte_rendu || !crForms[crModalRdv.id]?.notes?.trim()}
              >
                <ClipboardCheck className="w-4 h-4" /> {crSaving === crModalRdv.id ? 'Enregistrement...' : 'Valider le compte-rendu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating selection bar */}
      {schedulingDay && selectedClients.size > 0 && !showSchedulingModal && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-white border border-brewery-300 rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 max-w-lg">
          <CalendarPlus className="w-5 h-5 text-brewery-600 flex-shrink-0" />
          <span className="text-sm font-semibold text-brewery-700 whitespace-nowrap">
            {selectedClients.size} client{selectedClients.size > 1 ? 's' : ''}
          </span>
          <button
            onClick={() => setSelectedClients(new Set())}
            className="text-[11px] text-gray-400 hover:text-gray-600 whitespace-nowrap"
          >
            Tout deselectionner
          </button>
          <button
            onClick={openSchedulingModal}
            className="px-4 py-2 bg-brewery-600 text-white rounded-lg text-sm font-semibold hover:bg-brewery-700 flex items-center gap-2 whitespace-nowrap"
          >
            <Calendar className="w-4 h-4" /> Planifier les visites
          </button>
        </div>
      )}

      {/* Scheduling Modal */}
      {showSchedulingModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowSchedulingModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
                  <CalendarPlus className="w-5 h-5 text-brewery-600" />
                  Planifier les visites
                </h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  {scheduleEntries.length} client{scheduleEntries.length > 1 ? 's' : ''} - {planningData.days.find(d => d.dateStr === scheduleDate)?.label || scheduleDate}
                </p>
              </div>
              <button onClick={() => setShowSchedulingModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Settings */}
            <div className="p-4 border-b border-gray-100 space-y-3">
              {/* Day selector */}
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium text-gray-600 w-12">Jour</label>
                <select
                  value={scheduleDate}
                  onChange={e => setScheduleDate(e.target.value)}
                  className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-brewery-300"
                >
                  {planningData.days.map(d => (
                    <option key={d.dateStr} value={d.dateStr}>{d.label}</option>
                  ))}
                </select>
              </div>

              {/* Start time */}
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium text-gray-600 w-12">Debut</label>
                <input
                  type="time"
                  value={scheduleStartTime}
                  onChange={e => setScheduleStartTime(e.target.value)}
                  className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-brewery-300"
                />
              </div>

              {/* Duration selector */}
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium text-gray-600 w-12">Duree</label>
                <div className="flex gap-1.5 flex-wrap">
                  {[15, 30, 45, 60, 90].map(d => (
                    <button
                      key={d}
                      onClick={() => setScheduleSlotDuration(d)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${
                        scheduleSlotDuration === d
                          ? 'bg-brewery-100 text-brewery-700 ring-1 ring-brewery-300'
                          : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      {d < 60 ? `${d}min` : d === 60 ? '1h' : '1h30'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Recalculate button */}
              <button
                onClick={recalculateSchedule}
                className="text-xs text-brewery-600 hover:text-brewery-800 font-medium flex items-center gap-1"
              >
                <Clock className="w-3.5 h-3.5" /> Recalculer les horaires
              </button>
            </div>

            {/* Client list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {scheduleEntries.length === 0 ? (
                <p className="text-sm text-gray-400 italic text-center py-4">Aucun client selectionne</p>
              ) : (
                scheduleEntries.map((entry, idx) => {
                  const client = state.clients.find(c => c.id === entry.clientId);
                  if (!client) return null;
                  return (
                    <div key={entry.clientId} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2.5 border border-gray-200">
                      <span className="text-[10px] text-gray-400 font-mono w-5 text-center">{idx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{client.nom}</p>
                        <p className="text-[11px] text-gray-400 truncate">{client.ville}{client.adresse ? ` - ${client.adresse}` : ''}</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <input
                          type="time"
                          value={entry.startTime}
                          onChange={e => {
                            const newEntries = [...scheduleEntries];
                            newEntries[idx] = { ...newEntries[idx], startTime: e.target.value };
                            setScheduleEntries(newEntries);
                          }}
                          className="text-xs border border-gray-300 rounded px-1.5 py-1 w-20 focus:ring-2 focus:ring-brewery-300"
                        />
                        <span className="text-gray-300 text-xs">-</span>
                        <input
                          type="time"
                          value={entry.endTime}
                          onChange={e => {
                            const newEntries = [...scheduleEntries];
                            newEntries[idx] = { ...newEntries[idx], endTime: e.target.value };
                            setScheduleEntries(newEntries);
                          }}
                          className="text-xs border border-gray-300 rounded px-1.5 py-1 w-20 focus:ring-2 focus:ring-brewery-300"
                        />
                        <button
                          onClick={() => removeFromSchedule(entry.clientId)}
                          className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                          title="Retirer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-200 flex justify-between items-center">
              <button
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                onClick={() => setShowSchedulingModal(false)}
              >
                Annuler
              </button>
              <button
                className="px-5 py-2.5 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2 disabled:opacity-50 font-medium"
                onClick={handleExportICS}
                disabled={scheduleEntries.length === 0}
              >
                <Download className="w-4 h-4" /> Exporter .ICS
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation modal before export */}
      {showConfirmExport && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={() => setShowConfirmExport(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-brewery-100 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-brewery-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-800">Confirmer les visites</h3>
                  <p className="text-sm text-gray-500">
                    {planningData.days.find(d => d.dateStr === scheduleDate)?.label || scheduleDate}
                  </p>
                </div>
              </div>

              <div className="bg-brewery-50 border border-brewery-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-brewery-800">
                  <strong>{scheduleEntries.length}</strong> visite{scheduleEntries.length > 1 ? 's' : ''} {scheduleEntries.length > 1 ? 'vont' : 'va'} etre enregistree{scheduleEntries.length > 1 ? 's' : ''} :
                </p>
                <ul className="mt-2 space-y-1">
                  {scheduleEntries.map(entry => {
                    const client = state.clients.find(c => c.id === entry.clientId);
                    return client ? (
                      <li key={entry.clientId} className="text-sm text-brewery-700 flex items-center gap-2">
                        <Clock className="w-3 h-3 flex-shrink-0" />
                        <span className="font-medium">{entry.startTime} - {entry.endTime}</span>
                        <span>{client.nom}</span>
                        <span className="text-brewery-500 text-xs">{client.ville}</span>
                      </li>
                    ) : null;
                  })}
                </ul>
              </div>

              <p className="text-xs text-gray-500 italic mb-4">
                Les visites seront enregistrees sur la fiche de chaque client et la prochaine visite sera recalculee automatiquement. Le fichier .ICS sera telecharge pour import dans Google Agenda.
              </p>
            </div>

            <div className="px-5 pb-5 flex justify-end gap-3">
              <button
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                onClick={() => setShowConfirmExport(false)}
                disabled={scheduleSaving}
              >
                Annuler
              </button>
              <button
                className="px-5 py-2.5 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2 disabled:opacity-50 font-medium"
                onClick={confirmExportAndSave}
                disabled={scheduleSaving}
              >
                <CheckCircle2 className="w-4 h-4" />
                {scheduleSaving ? 'Enregistrement...' : 'Valider et exporter'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mass action floating bar */}
      {massActionDay && massSelectedClients.size > 0 && !showMassActionModal && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-white border border-indigo-300 rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 max-w-lg">
          <Settings2 className="w-5 h-5 text-indigo-600 flex-shrink-0" />
          <span className="text-sm font-semibold text-indigo-700 whitespace-nowrap">
            {massSelectedClients.size} client{massSelectedClients.size > 1 ? 's' : ''}
          </span>
          <button
            onClick={() => setMassSelectedClients(new Set())}
            className="text-[11px] text-gray-400 hover:text-gray-600 whitespace-nowrap"
          >
            Tout deselectionner
          </button>
          <button
            onClick={openMassActionModal}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 flex items-center gap-2 whitespace-nowrap"
          >
            <Settings2 className="w-4 h-4" /> Actions
          </button>
        </div>
      )}

      {/* Mass Action Modal */}
      {showMassActionModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowMassActionModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-indigo-600" />
                  Actions de masse
                </h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  {massSelectedClients.size} client{massSelectedClients.size > 1 ? 's' : ''} selectionne{massSelectedClients.size > 1 ? 's' : ''}
                </p>
              </div>
              <button onClick={() => setShowMassActionModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Action selection */}
            <div className="p-4 space-y-4">
              <label className="text-sm font-medium text-gray-700 block">Choisir une action</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { key: 'inactif' as const, icon: UserX, label: 'Rendre inactif', color: 'text-red-600', bg: 'border-red-200 hover:bg-red-50', activeBg: 'border-red-400 bg-red-50 ring-2 ring-red-200' },
                  { key: 'note' as const, icon: MessageSquarePlus, label: 'Ajouter une note', color: 'text-blue-600', bg: 'border-blue-200 hover:bg-blue-50', activeBg: 'border-blue-400 bg-blue-50 ring-2 ring-blue-200' },
                  { key: 'visite' as const, icon: CheckCircle2, label: 'Enregistrer visite', color: 'text-green-600', bg: 'border-green-200 hover:bg-green-50', activeBg: 'border-green-400 bg-green-50 ring-2 ring-green-200' },
                  { key: 'commercial' as const, icon: UserCheck, label: 'Changer commercial', color: 'text-purple-600', bg: 'border-purple-200 hover:bg-purple-50', activeBg: 'border-purple-400 bg-purple-50 ring-2 ring-purple-200' },
                ] as const).map(a => {
                  const Icon = a.icon;
                  const isActive = massAction === a.key;
                  return (
                    <button
                      key={a.key}
                      onClick={() => setMassAction(a.key)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border transition-all ${isActive ? a.activeBg : `${a.bg} border-gray-200`}`}
                    >
                      <Icon className={`w-4 h-4 ${a.color}`} />
                      {a.label}
                    </button>
                  );
                })}
              </div>

              {/* Action-specific fields */}
              {massAction === 'inactif' && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm text-red-700">
                    <strong>{massSelectedClients.size}</strong> client{massSelectedClients.size > 1 ? 's' : ''} seront passes en <strong>INACTIF</strong>.
                    Ils ne seront plus affiches dans le planning.
                  </p>
                </div>
              )}

              {massAction === 'note' && (
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Note a ajouter *</label>
                  <textarea
                    value={massNote}
                    onChange={e => setMassNote(e.target.value)}
                    placeholder="Cette note sera ajoutee a chaque client selectionne..."
                    className={`w-full text-sm border rounded-lg px-3 py-2 resize-none h-20 focus:ring-2 focus:ring-indigo-300 ${!massNote.trim() ? 'border-red-300' : 'border-gray-300'}`}
                    autoFocus
                  />
                </div>
              )}

              {massAction === 'visite' && (
                <div>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-2">
                    <p className="text-sm text-green-700">
                      Une visite sera enregistree pour chaque client. La date de prochaine visite sera automatiquement recalculee.
                    </p>
                  </div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Commentaire (optionnel)</label>
                  <textarea
                    value={massNote}
                    onChange={e => setMassNote(e.target.value)}
                    placeholder="Commentaire pour la visite..."
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 resize-none h-16 focus:ring-2 focus:ring-indigo-300"
                  />
                </div>
              )}

              {massAction === 'commercial' && (
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Nouveau commercial *</label>
                  <select
                    value={massCommercialId}
                    onChange={e => setMassCommercialId(e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-300"
                  >
                    <option value="">Selectionner...</option>
                    {state.commerciaux.map(c => (
                      <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Selected clients preview */}
              {massAction && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">Clients concernes :</p>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {Array.from(massSelectedClients).map(id => {
                      const client = state.clients.find(c => c.id === id);
                      return client ? (
                        <span key={id} className="text-[11px] px-2 py-0.5 bg-gray-100 rounded-full text-gray-600">
                          {client.nom}
                        </span>
                      ) : null;
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-200 flex justify-between items-center">
              <button
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                onClick={() => setShowMassActionModal(false)}
              >
                Annuler
              </button>
              <button
                className={`px-5 py-2.5 text-sm text-white rounded-lg flex items-center gap-2 disabled:opacity-50 font-medium ${
                  massAction === 'inactif' ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
                onClick={executeMassAction}
                disabled={!massAction || massSaving || (massAction === 'note' && !massNote.trim()) || (massAction === 'commercial' && !massCommercialId)}
              >
                {massSaving ? 'En cours...' : massAction === 'inactif' ? 'Confirmer la desactivation' : 'Valider'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
