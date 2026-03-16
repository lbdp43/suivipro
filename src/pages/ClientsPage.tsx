import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search, Plus, Phone, Mail, MapPin, ChevronRight, ChevronLeft, X,
  Edit2, Trash2, Save, ArrowUpDown, Filter, User, Eye, EyeOff,
  Calendar, CheckCircle2, Clock, AlertTriangle, PhoneCall, Navigation,
  Download, FileSpreadsheet, ListTodo, Check, CheckSquare, Square, XCircle,
  Users, CalendarPlus, StickyNote, LayoutList, CalendarDays, Map, ClipboardCheck,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import {
  CLIENT_TYPE_LABELS, CLIENT_TYPE_FAMILIES, CLIENT_VISIT_FREQUENCIES,
  ClientType, ClientStatus, Client, InteractionType,
  INTERACTION_TYPE_LABELS, TaskClient, TASK_CLIENT_STATUS_LABELS,
  Appointment, AppointmentResult, APPOINTMENT_RESULT_LABELS,
} from '../types';
import { generateId, formatDate, detectConflicts, downloadICSClient, geocodeAddress, toLocalDateStr } from '../utils/helpers';
import { getGoogleCalendarEvents, apiPost, apiPut, apiDelete, type GoogleCalendarEvent } from '../api/client';
import EmailTemplateModal from '../components/EmailTemplateModal';
import { usePersistedState } from '../hooks/usePersistedState';

type VisitFilter = 'all' | 'late' | 'today' | 'upcoming' | 'no_recurrence';

function getVisitStatus(client: Client): 'LATE' | 'TODAY' | 'UPCOMING' | 'NO_RECURRENCE' | 'INACTIF' {
  if (client.statut === 'INACTIF') return 'INACTIF';
  if (!client.next_visit) return 'NO_RECURRENCE';
  const today = toLocalDateStr(new Date());
  if (client.next_visit < today) return 'LATE';
  if (client.next_visit === today) return 'TODAY';
  return 'UPCOMING';
}

const VISIT_STATUS_CONFIG = {
  LATE: { label: 'En retard', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  TODAY: { label: 'Aujourd\'hui', color: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' },
  UPCOMING: { label: 'A venir', color: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  NO_RECURRENCE: { label: 'Sans recurrence', color: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
  INACTIF: { label: 'Inactif', color: 'bg-gray-100 text-gray-500', dot: 'bg-gray-400' },
};

export default function ClientsPage() {
  const { state, dispatch, dispatchLocal, getCommercial, getInteractionsForClient, getTasksForClient, getClient, getCommandesForClient, pausePolling } = useApp();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');

  const [searchTerm, setSearchTerm] = usePersistedState('clients_search', '');
  const [filterTypesArr, setFilterTypesArr] = usePersistedState<string[]>('clients_types', []);
  const filterTypes = useMemo(() => new Set(filterTypesArr as ClientType[]), [filterTypesArr]);
  const setFilterTypes = useCallback((update: Set<ClientType> | ((prev: Set<ClientType>) => Set<ClientType>)) => {
    if (typeof update === 'function') {
      setFilterTypesArr(prev => Array.from(update(new Set(prev as ClientType[]))));
    } else {
      setFilterTypesArr(Array.from(update));
    }
  }, [setFilterTypesArr]);

  const [filterStatus, setFilterStatus] = usePersistedState<ClientStatus | ''>('clients_status', '');
  const [filterVisit, setFilterVisit] = usePersistedState<VisitFilter>('clients_visit', 'all');

  const [filterCommercialsArr, setFilterCommercialsArr] = usePersistedState<string[]>('clients_commercials', []);
  const filterCommercials = useMemo(() => new Set(filterCommercialsArr), [filterCommercialsArr]);
  const setFilterCommercials = useCallback((update: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    if (typeof update === 'function') {
      setFilterCommercialsArr(prev => Array.from(update(new Set(prev))));
    } else {
      setFilterCommercialsArr(Array.from(update));
    }
  }, [setFilterCommercialsArr]);

  const [filterTourneesArr, setFilterTourneesArr] = usePersistedState<string[]>('clients_tournees', []);
  const filterTournees = useMemo(() => new Set(filterTourneesArr), [filterTourneesArr]);
  const setFilterTournees = useCallback((update: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    if (typeof update === 'function') {
      setFilterTourneesArr(prev => Array.from(update(new Set(prev))));
    } else {
      setFilterTourneesArr(Array.from(update));
    }
  }, [setFilterTourneesArr]);

  const [filterNoTournee, setFilterNoTournee] = usePersistedState('clients_no_tournee', false);
  const [filterNoType, setFilterNoType] = usePersistedState('clients_no_type', false);

  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [forceCreate, setForceCreate] = useState(false);
  const [sortDate, setSortDate] = usePersistedState<'none' | 'recent' | 'ancien' | 'creation_recent' | 'creation_ancien'>('clients_sort', 'none');
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  // Email modal
  const [emailClient, setEmailClient] = useState<Client | null>(null);

  // Interaction modal
  const [interactionClient, setInteractionClient] = useState<Client | null>(null);
  const [interactionType, setInteractionType] = useState<InteractionType>('VISITE');
  const [interactionComment, setInteractionComment] = useState('');
  const [interactionDate, setInteractionDate] = useState('');
  // RDV fields
  const [rdvHeureDebut, setRdvHeureDebut] = useState('10:00');
  const [rdvHeureFin, setRdvHeureFin] = useState('11:00');
  const [rdvLieu, setRdvLieu] = useState('');
  const [rdvCommercialId, setRdvCommercialId] = useState('');
  const [rdvNotes, setRdvNotes] = useState('');
  const [googleEvents, setGoogleEvents] = useState<GoogleCalendarEvent[]>([]);
  const [showRdvConfirmation, setShowRdvConfirmation] = useState(false);
  const [createdRdvId, setCreatedRdvId] = useState('');

  // Task modal
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDate, setTaskDate] = useState('');
  const [taskClientId, setTaskClientId] = useState('');

  // Multi-select
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'none' | 'commercial' | 'tournee' | 'type' | 'statut' | 'next_visit' | 'recurrence' | 'visite'>('none');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkNextVisit, setBulkNextVisit] = useState('');
  const [bulkVisiteComment, setBulkVisiteComment] = useState('');
  const [bulkVisiteType, setBulkVisiteType] = useState<InteractionType>('VISITE');


  // Quick note
  const [noteClientId, setNoteClientId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  // Frequency config from DB
  const [frequencyConfig, setFrequencyConfig] = useState<Record<string, number | null>>({});

  // Tournee configs
  const [tourneeConfigs, setTourneeConfigs] = useState<Record<string, { config: Record<string, string[]>; week_pattern: string }>>({});

  const isAdmin = state.currentUser?.role === 'admin';

  // Tournée editing state
  const [editingTournee, setEditingTournee] = useState<string | null>(null);
  const [editTourneeName, setEditTourneeName] = useState('');

  // Load frequency config from DB
  useEffect(() => {
    const token = localStorage.getItem('suivipro_token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    fetch('/api/visit-frequency-config', { headers })
      .then(r => r.ok ? r.json() : [])
      .then((rows: { type_client: string; frequency_days: number }[]) => {
        const config: Record<string, number | null> = {};
        rows.forEach(r => { config[r.type_client] = r.frequency_days; });
        setFrequencyConfig(config);
      })
      .catch(() => {});
  }, []);

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
      .catch(() => {});
  }, []);

  // Initialize RDV fields when modal opens
  useEffect(() => {
    if (interactionClient && interactionType === 'RDV_PLANIFIE') {
      if (!rdvCommercialId) setRdvCommercialId(state.currentUser?.id || '');
      if (!rdvLieu) {
        const addr = [interactionClient.adresse, interactionClient.ville].filter(Boolean).join(', ');
        if (addr) setRdvLieu(addr);
      }
    }
  }, [interactionClient, interactionType]);

  // Google Calendar conflict detection for RDV
  useEffect(() => {
    if (interactionType !== 'RDV_PLANIFIE' || !rdvCommercialId || !interactionDate) {
      setGoogleEvents([]);
      return;
    }
    const dayStart = new Date(interactionDate + 'T00:00:00').toISOString();
    const dayEnd = new Date(interactionDate + 'T23:59:59').toISOString();
    getGoogleCalendarEvents(rdvCommercialId, dayStart, dayEnd)
      .then(res => setGoogleEvents(res.connected ? res.events : []))
      .catch(() => setGoogleEvents([]));
  }, [interactionType, rdvCommercialId, interactionDate]);

  // Internal RDV conflicts
  const rdvConflicts = interactionType === 'RDV_PLANIFIE' && rdvCommercialId && interactionDate && rdvHeureDebut && rdvHeureFin
    ? detectConflicts(state.appointments, rdvCommercialId, interactionDate, rdvHeureDebut, rdvHeureFin)
    : [];

  // Google Calendar conflicts for the chosen time slot
  const googleConflicts = interactionType === 'RDV_PLANIFIE' && interactionDate && rdvHeureDebut && rdvHeureFin
    ? googleEvents.filter(evt => {
        if (evt.allDay) return true;
        const evtStart = evt.start.includes('T') ? evt.start.substring(11, 16) : '';
        const evtEnd = evt.end.includes('T') ? evt.end.substring(11, 16) : '';
        if (!evtStart || !evtEnd) return false;
        return rdvHeureDebut < evtEnd && evtStart < rdvHeureFin;
      })
    : [];

  const getEffectiveFrequency = (typeClient: string, customRecurrence: number | null): number | null => {
    if (customRecurrence) return customRecurrence;
    return frequencyConfig[typeClient] ?? (CLIENT_VISIT_FREQUENCIES as Record<string, number | null>)[typeClient] ?? null;
  };

  // Multi-select helpers
  const toggleSelection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setBulkAction('none');
    setBulkValue('');
  };

  const applyBulkAction = async () => {
    // Visite action uses bulkVisiteComment, others use bulkValue
    if (bulkAction === 'visite') {
      if (!bulkVisiteComment.trim()) { toast.error('Le commentaire est obligatoire'); return; }
    } else if (!bulkValue.trim() && bulkAction !== 'recurrence') {
      return;
    }
    const now = new Date().toISOString();

    // Pause polling to prevent server state from overwriting during bulk operations
    pausePolling(30000);

    let count = 0;
    let errors = 0;

    if (bulkAction === 'visite') {
      for (const id of selectedIds) {
        const client = state.clients.find(c => c.id === id);
        if (!client) continue;
        const interaction = {
          id: generateId('int'),
          client_id: id,
          commercial_id: state.currentUser?.id || '',
          type: bulkVisiteType,
          date: now,
          comment: bulkVisiteComment.trim(),
          date_creation: now,
        };
        try {
          await apiPost('/interactions', interaction);
          dispatchLocal({ type: 'ADD_INTERACTION', payload: interaction });
          count++;
        } catch {
          errors++;
        }
      }
      if (errors > 0) toast.error(`${errors} visite(s) non enregistree(s)`);
      if (count > 0) toast.success(`${count} visite(s) enregistree(s)`);
      setBulkVisiteComment('');
      setBulkVisiteType('VISITE');
      exitSelectionMode();
      return;
    }

    for (const id of selectedIds) {
      const client = state.clients.find(c => c.id === id);
      if (!client) continue;
      let updated: Client = { ...client, date_modification: now };
      if (bulkAction === 'commercial') updated.commercial_id = bulkValue;
      if (bulkAction === 'tournee') updated.tournee = bulkValue;
      if (bulkAction === 'type') updated.type_client = bulkValue as ClientType;
      if (bulkAction === 'statut') updated.statut = bulkValue as ClientStatus;
      if (bulkAction === 'next_visit') updated.next_visit = bulkValue;
      if (bulkAction === 'recurrence') {
        updated.custom_recurrence = bulkValue ? parseInt(bulkValue) : null;
        if (bulkNextVisit) updated.next_visit = bulkNextVisit;
      }
      try {
        await apiPut(`/clients/${id}`, updated);
        dispatchLocal({ type: 'UPDATE_CLIENT', payload: updated });
        count++;
      } catch (err) {
        console.error(`Erreur PUT client ${id}:`, err);
        errors++;
      }
    }
    if (errors > 0) toast.error(`${errors} client(s) non mis a jour`);
    if (count > 0) toast.success(`${count} client(s) mis a jour`);
    exitSelectionMode();
  };

  const bulkDelete = async () => {
    if (!confirm(`Supprimer ${selectedIds.size} client(s) ? Cette action est irreversible.`)) return;
    let errors = 0;
    for (const id of selectedIds) {
      try {
        await apiDelete(`/clients/${id}`);
        dispatchLocal({ type: 'DELETE_CLIENT', payload: id });
      } catch { errors++; }
    }
    if (errors > 0) toast.error(`${errors} client(s) non supprimes`);
    exitSelectionMode();
  };

  // Get unique tournees (from clients + tournee configs)
  const allTournees = useMemo(() => {
    const set = new Set<string>();
    state.clients.forEach(c => { if (c.tournee) set.add(c.tournee); });
    // Include zones from locally loaded tournee configs
    Object.values(tourneeConfigs).forEach(tc => {
      Object.values(tc.config).forEach(zones => {
        if (Array.isArray(zones)) zones.forEach(z => { if (z && typeof z === 'string') set.add(z); });
      });
    });
    // Include zones from state tournee configs (loaded at login)
    state.tourneeConfigs?.forEach((tc: any) => {
      const cfg = typeof tc.config === 'string' ? JSON.parse(tc.config) : tc.config;
      if (cfg) Object.values(cfg).forEach((zones: any) => {
        if (Array.isArray(zones)) zones.forEach((z: string) => { if (z && typeof z === 'string') set.add(z); });
      });
    });
    return Array.from(set).sort();
  }, [state.clients, tourneeConfigs, state.tourneeConfigs]);

  // Tournée rename/delete
  const renameTournee = async (oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) { setEditingTournee(null); return; }
    try {
      const clientsToUpdate = state.clients.filter(c => c.tournee === oldName);
      for (const client of clientsToUpdate) {
        const updated = { ...client, tournee: newName.trim(), date_modification: new Date().toISOString() };
        await apiPut(`/clients/${client.id}`, updated);
        dispatchLocal({ type: 'UPDATE_CLIENT', payload: updated });
      }
      // Update tournee configs too
      for (const tc of state.tourneeConfigs || []) {
        const cfg = typeof tc.config === 'string' ? JSON.parse(tc.config) : tc.config;
        let modified = false;
        const newCfg = { ...cfg };
        for (const day of Object.keys(newCfg)) {
          if (Array.isArray(newCfg[day]) && newCfg[day].includes(oldName)) {
            newCfg[day] = newCfg[day].map((z: string) => z === oldName ? newName.trim() : z);
            modified = true;
          }
        }
        if (modified) {
          await apiPost(`/tournee-config/${tc.commercial_id}`, { config: newCfg, notes: tc.notes || '' });
        }
      }
      toast.success(`Tournée "${oldName}" renommée en "${newName.trim()}"`);
      setEditingTournee(null);
      // Update filter if the renamed tournee was selected
      if (filterTournees.has(oldName)) {
        setFilterTournees(prev => {
          const next = new Set(prev);
          next.delete(oldName);
          next.add(newName.trim());
          return next;
        });
      }
    } catch { toast.error('Erreur lors du renommage'); }
  };

  const deleteTournee = async (name: string) => {
    if (!confirm(`Retirer la tournée "${name}" de tous les clients ?`)) return;
    try {
      const clientsToUpdate = state.clients.filter(c => c.tournee === name);
      for (const client of clientsToUpdate) {
        const updated = { ...client, tournee: '', date_modification: new Date().toISOString() };
        await apiPut(`/clients/${client.id}`, updated);
        dispatchLocal({ type: 'UPDATE_CLIENT', payload: updated });
      }
      toast.success(`Tournée "${name}" supprimée de ${clientsToUpdate.length} client(s)`);
      setFilterTournees(prev => { const next = new Set(prev); next.delete(name); return next; });
    } catch { toast.error('Erreur lors de la suppression'); }
  };

  // Form state
  const emptyForm = (): Partial<Client> => ({
    nom: '', ville: '', adresse: '', code_postal: '', telephone: '', telephone_mobile: '',
    email: '', contact: '', type_client: 'BAR_RESTAURANT_GENERAL', statut: 'ACTIF',
    commercial_id: state.currentUser?.id || '', notes: '', custom_recurrence: null,
    latitude: 0, longitude: 0, siret: '', tournee: '',
  });

  const [formData, setFormData] = useState<Partial<Client>>(emptyForm());

  const openNewForm = () => {
    setEditingClient(null);
    setFormData(emptyForm());
    setForceCreate(false);
    setShowForm(true);
  };

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
      await apiPut(`/clients/${noteClientId}`, updated);
      dispatchLocal({ type: 'UPDATE_CLIENT', payload: updated });
      toast.success('Note enregistree');
      setNoteClientId(null);
    } catch { toast.error('Erreur lors de la sauvegarde'); }
    finally { setNoteSaving(false); }
  };

  const openEditForm = (client: Client) => {
    setEditingClient(client);
    setFormData({ ...client });
    setShowForm(true);
  };

  const saveClient = async () => {
    if (!formData.nom?.trim()) return;
    if (!editingClient && !forceCreate && (duplicateClients.length > 0 || duplicateProspects.length > 0)) return;
    const now = new Date().toISOString();

    // Geocode si pas de coordonnees
    let lat = formData.latitude || 0;
    let lng = formData.longitude || 0;
    if ((!lat || !lng) && (formData.adresse || formData.ville)) {
      const fullAddress = [formData.adresse, formData.code_postal, formData.ville].filter(Boolean).join(' ');
      const geo = await geocodeAddress(fullAddress);
      if (geo) {
        lat = geo.latitude;
        lng = geo.longitude;
      }
    }

    if (editingClient) {
      const updated: Client = {
        ...editingClient,
        ...formData,
        latitude: lat,
        longitude: lng,
        date_modification: now,
      } as Client;
      try {
        await apiPut(`/clients/${editingClient.id}`, updated);
        dispatchLocal({ type: 'UPDATE_CLIENT', payload: updated });
        toast.success('Client mis a jour');
      } catch {
        toast.error('Erreur lors de la mise a jour du client');
        return;
      }
    } else {
      try {
        const newClient: Client = await apiPost('/clients', {
          nom: formData.nom || '',
          ville: formData.ville || '',
          adresse: formData.adresse || '',
          code_postal: formData.code_postal || '',
          telephone: formData.telephone || '',
          telephone_mobile: formData.telephone_mobile || '',
          email: formData.email || '',
          contact: formData.contact || '',
          type_client: formData.type_client || 'BAR_RESTAURANT_GENERAL',
          statut: formData.statut || 'ACTIF',
          commercial_id: formData.commercial_id || state.currentUser?.id || '',
          notes: formData.notes || '',
          custom_recurrence: formData.custom_recurrence || null,
          latitude: lat,
          longitude: lng,
          siret: formData.siret || '',
          tournee: formData.tournee || '',
        }) as Client;
        dispatchLocal({ type: 'ADD_CLIENT', payload: newClient });
      } catch {
        toast.error('Erreur lors de la creation du client');
        return;
      }
    }
    setShowForm(false);
  };

  const deleteClient = async (id: string) => {
    if (!confirm('Supprimer ce client ? Cette action est irreversible.')) return;
    try {
      await apiDelete(`/clients/${id}`);
      dispatchLocal({ type: 'DELETE_CLIENT', payload: id });
      if (selectedId === id) setSearchParams({});
    } catch {
      toast.error('Erreur lors de la suppression du client');
    }
  };

  const toggleStatus = async (client: Client) => {
    const updated = {
      ...client,
      statut: client.statut === 'ACTIF' ? 'INACTIF' as ClientStatus : 'ACTIF' as ClientStatus,
      date_modification: new Date().toISOString(),
    };
    if (updated.statut === 'INACTIF') {
      updated.next_visit = null;
    }
    try {
      await apiPut(`/clients/${client.id}`, updated);
      dispatchLocal({ type: 'UPDATE_CLIENT', payload: updated });
    } catch {
      toast.error('Erreur lors du changement de statut');
    }
  };

  // Mark visit
  const submitInteraction = async () => {
    if (!interactionClient || !interactionComment.trim()) return;
    const now = new Date().toISOString();
    const interaction = {
      id: generateId('int'),
      client_id: interactionClient.id,
      commercial_id: state.currentUser?.id || '',
      type: interactionType,
      date: interactionType === 'RDV_PLANIFIE' && interactionDate ? new Date(interactionDate).toISOString() : now,
      comment: interactionComment.trim(),
      date_creation: now,
    };
    try {
      await apiPost('/interactions', interaction);
      dispatchLocal({ type: 'ADD_INTERACTION', payload: interaction });
    } catch {
      toast.error('Erreur lors de l\'enregistrement');
      return;
    }

    // For RDV_PLANIFIE, also create an appointment in the appointments table
    if (interactionType === 'RDV_PLANIFIE' && interactionDate) {
      const rdvId = generateId('rdv');
      const rdvPayload = {
        id: rdvId,
        prospect_id: '',
        client_id: interactionClient.id,
        commercial_id: rdvCommercialId || state.currentUser?.id || '',
        prospecteur_id: state.currentUser?.id || '',
        date: interactionDate,
        heure_debut: rdvHeureDebut,
        heure_fin: rdvHeureFin,
        lieu: rdvLieu,
        notes: [rdvNotes, interactionComment.trim()].filter(Boolean).join('\n'),
        statut: 'planifie' as const,
        created_at: now,
      };
      try {
        await apiPost('/appointments', rdvPayload);
        dispatchLocal({ type: 'ADD_APPOINTMENT', payload: rdvPayload });
      } catch { /* appointment creation is secondary */ }
      // Show confirmation screen
      setCreatedRdvId(rdvId);
      setShowRdvConfirmation(true);
      return;
    }

    resetInteractionModal();
  };

  const resetInteractionModal = () => {
    setInteractionClient(null);
    setInteractionComment('');
    setInteractionDate('');
    setInteractionType('VISITE');
    setRdvHeureDebut('10:00');
    setRdvHeureFin('11:00');
    setRdvLieu('');
    setRdvCommercialId('');
    setRdvNotes('');
    setShowRdvConfirmation(false);
    setCreatedRdvId('');
  };


  // Export clients
  const handleExportClients = async () => {
    try {
      const XLSX = await import('xlsx');
      const data = filtered.map(c => ({
        'Nom': c.nom,
        'Type': CLIENT_TYPE_LABELS[c.type_client],
        'Statut': c.statut,
        'Contact': c.contact,
        'Telephone': c.telephone,
        'Mobile': c.telephone_mobile || '',
        'Email': c.email,
        'Adresse': c.adresse,
        'Ville': c.ville,
        'Code postal': c.code_postal,
        'Tournee': c.tournee,
        'Commercial': getCommercial(c.commercial_id)?.prenom || '',
        'Derniere visite': c.last_visit || '',
        'Prochaine visite': c.next_visit || '',
        'Notes': c.notes,
        'SIRET': c.siret || '',
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Clients');
      XLSX.writeFile(wb, `clients-${toLocalDateStr(new Date())}.xlsx`);
    } catch { /* ignore */ }
  };

  // Task helpers
  const addTask = async () => {
    if (!taskTitle.trim() || !taskClientId) return;
    const payload = {
      id: generateId('task'),
      titre: taskTitle.trim(),
      description: '',
      statut: 'A_FAIRE' as const,
      priorite: 'MOYENNE' as const,
      date_echeance: taskDate || null,
      commercial_id: state.currentUser?.id || '',
      client_id: taskClientId,
      date_creation: new Date().toISOString(),
      completed_at: null,
    };
    try {
      await apiPost('/tasks-client', payload);
      dispatchLocal({ type: 'ADD_TASK_CLIENT', payload });
      setShowTaskForm(false);
      setTaskTitle('');
      setTaskDate('');
    } catch {
      toast.error('Erreur lors de l\'ajout de la tâche');
    }
  };

  const toggleTask = async (task: TaskClient) => {
    const isComplete = task.statut === 'TERMINEE';
    const payload = {
      ...task,
      statut: (isComplete ? 'A_FAIRE' : 'TERMINEE') as TaskClient['statut'],
      completed_at: isComplete ? null : new Date().toISOString(),
    };
    try {
      await apiPut(`/tasks-client/${task.id}`, payload);
      dispatchLocal({ type: 'UPDATE_TASK_CLIENT', payload });
    } catch {
      toast.error('Erreur lors de la mise à jour de la tâche');
    }
  };

  // Filter & sort
  const filtered = useMemo(() => {
    let list = state.clients;

    // Non-admin: only own clients (unless commercial filter is active)
    if (!isAdmin && state.currentUser && filterCommercials.size === 0) {
      list = list.filter(c => c.commercial_id === state.currentUser!.id);
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      list = list.filter(c =>
        c.nom.toLowerCase().includes(term) ||
        c.ville.toLowerCase().includes(term) ||
        c.contact.toLowerCase().includes(term) ||
        c.telephone.includes(term) ||
        c.email.toLowerCase().includes(term)
      );
    }
    if (filterNoType) {
      list = list.filter(c => !c.type_client || c.type_client.trim() === '');
    } else if (filterTypes.size > 0) {
      list = list.filter(c => filterTypes.has(c.type_client));
    }
    if (filterStatus) {
      list = list.filter(c => c.statut === filterStatus);
    }
    if (filterVisit !== 'all') {
      list = list.filter(c => {
        const status = getVisitStatus(c);
        if (filterVisit === 'late') return status === 'LATE';
        if (filterVisit === 'today') return status === 'TODAY';
        if (filterVisit === 'upcoming') return status === 'UPCOMING';
        if (filterVisit === 'no_recurrence') return status === 'NO_RECURRENCE';
        return true;
      });
    }
    if (filterCommercials.size > 0) {
      list = list.filter(c => filterCommercials.has(c.commercial_id));
    }
    if (filterNoTournee) {
      list = list.filter(c => !c.tournee || c.tournee.trim() === '');
    } else if (filterTournees.size > 0) {
      list = list.filter(c => filterTournees.has(c.tournee));
    }

    if (sortDate === 'recent') {
      list = [...list].sort((a, b) => b.date_modification.localeCompare(a.date_modification));
    } else if (sortDate === 'ancien') {
      list = [...list].sort((a, b) => a.date_modification.localeCompare(b.date_modification));
    } else if (sortDate === 'creation_recent') {
      list = [...list].sort((a, b) => b.date_creation.localeCompare(a.date_creation));
    } else if (sortDate === 'creation_ancien') {
      list = [...list].sort((a, b) => a.date_creation.localeCompare(b.date_creation));
    }

    return list;
  }, [state.clients, searchTerm, filterTypes, filterStatus, filterVisit, filterCommercials, filterTournees, sortDate, isAdmin, state.currentUser, filterNoTournee, filterNoType]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const lateCount = state.clients.filter(c => getVisitStatus(c) === 'LATE').length;


  // Duplicate detection
  const normalize = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').trim();

  const duplicateClients = useMemo(() => {
    if (!showForm || editingClient) return [];
    const q = normalize(formData.nom || '');
    if (q.length < 3) return [];
    return state.clients.filter(c => {
      const n = normalize(c.nom);
      return n.includes(q) || q.includes(n);
    });
  }, [formData.nom, showForm, editingClient, state.clients]);

  const duplicateProspects = useMemo(() => {
    if (!showForm || editingClient) return [];
    const q = normalize(formData.nom || '');
    if (q.length < 3) return [];
    return state.prospects.filter(p => {
      const n = normalize(p.nom_etablissement);
      return n.includes(q) || q.includes(n);
    });
  }, [formData.nom, showForm, editingClient, state.prospects]);

  // Selected client detail
  const selectedClient = selectedId ? state.clients.find(c => c.id === selectedId) : null;
  const selectedInteractions = selectedClient ? getInteractionsForClient(selectedClient.id) : [];
  const selectedTasks = selectedClient ? getTasksForClient(selectedClient.id) : [];
  const selectedCommandes = selectedClient ? getCommandesForClient(selectedClient.id) : [];

  return (
    <div className="flex h-full">
      {/* List */}
      <div className={`flex-1 flex flex-col min-w-0 ${selectedClient ? 'hidden md:flex' : ''}`}>
        {/* Header */}
        <div className="p-4 border-b border-gray-200 bg-white">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-lg font-bold text-gray-900">Clients</h1>
              <p className="text-xs text-gray-500">
                {filtered.length} client{filtered.length > 1 ? 's' : ''}
                {lateCount > 0 && <span className="text-red-600 font-medium ml-2">{lateCount} en retard</span>}
              </p>
            </div>
            <div className="flex gap-2">
              {/* Link to planning page */}
              <a
                href="/clients/planning"
                className="p-2 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                title="Planning semaine"
              >
                <CalendarDays className="w-4 h-4" />
              </a>
              <button
                onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}
                className={`p-2 rounded-lg transition-colors ${selectionMode ? 'bg-brewery-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                title={selectionMode ? 'Quitter la sélection' : 'Sélection multiple'}
              >
                <CheckSquare className="w-4 h-4" />
              </button>
              <button onClick={handleExportClients} className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors" title="Exporter">
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Export</span>
              </button>
              <button onClick={openNewForm} className="flex items-center gap-1.5 px-3 py-2 bg-brewery-600 text-white rounded-lg text-sm font-medium hover:bg-brewery-700 transition-colors">
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Nouveau client</span>
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="flex gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher un client..."
                value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setCurrentPage(0); }}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              )}
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm ${showFilters ? 'bg-brewery-50 border-brewery-300 text-brewery-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              <Filter className="w-4 h-4" />
              <span className="hidden sm:inline">Filtres</span>
            </button>
          </div>

          {/* Filters */}
          {showFilters && (
            <div className="space-y-3 mb-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <select
                  value={filterStatus}
                  onChange={e => { setFilterStatus(e.target.value as ClientStatus | ''); setCurrentPage(0); }}
                  className="border border-gray-200 rounded-lg text-sm px-2 py-1.5"
                >
                  <option value="">Tous statuts</option>
                  <option value="ACTIF">Actif</option>
                  <option value="INACTIF">Inactif</option>
                </select>

                <select
                  value={filterVisit}
                  onChange={e => { setFilterVisit(e.target.value as VisitFilter); setCurrentPage(0); }}
                  className="border border-gray-200 rounded-lg text-sm px-2 py-1.5"
                >
                  <option value="all">Toutes visites</option>
                  <option value="late">En retard</option>
                  <option value="today">Aujourd'hui</option>
                  <option value="upcoming">A venir</option>
                  <option value="no_recurrence">Sans recurrence</option>
                </select>

                <select
                  value={sortDate}
                  onChange={e => { setSortDate(e.target.value as typeof sortDate); setCurrentPage(0); }}
                  className="border border-gray-200 rounded-lg text-sm px-2 py-1.5"
                >
                  <option value="none">Tri par defaut</option>
                  <option value="recent">Modification recente</option>
                  <option value="ancien">Modification ancienne</option>
                  <option value="creation_recent">Creation recente</option>
                  <option value="creation_ancien">Creation ancienne</option>
                </select>
              </div>

              {/* Multi-select commerciaux (tags) */}
              {state.commerciaux.length > 1 && (
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-medium text-gray-600">Commerciaux</span>
                    {filterCommercials.size > 0 && (
                      <button onClick={() => { setFilterCommercials(new Set()); setCurrentPage(0); }} className="text-xs text-red-500 hover:text-red-700">Effacer</button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {state.commerciaux.map(c => {
                      const active = filterCommercials.has(c.id);
                      return (
                        <button
                          key={c.id}
                          onClick={() => {
                            setFilterCommercials(prev => {
                              const next = new Set(prev);
                              if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                              return next;
                            });
                            setCurrentPage(0);
                          }}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                            active
                              ? 'bg-brewery-600 text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {c.prenom} {c.nom}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Multi-select tournees (tags) */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-medium text-gray-600">Tournees</span>
                  {(filterTournees.size > 0 || filterNoTournee) && (
                    <button onClick={() => { setFilterTournees(new Set()); setFilterNoTournee(false); setCurrentPage(0); }} className="text-xs text-red-500 hover:text-red-700">Effacer</button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => { setFilterNoTournee(!filterNoTournee); setFilterTournees(new Set()); setCurrentPage(0); }}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      filterNoTournee ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    Sans tournée
                  </button>
                  {allTournees.map(t => {
                    const active = filterTournees.has(t);
                    if (editingTournee === t) {
                      return (
                        <div key={t} className="flex items-center gap-1">
                          <input
                            value={editTourneeName}
                            onChange={e => setEditTourneeName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') renameTournee(t, editTourneeName); if (e.key === 'Escape') setEditingTournee(null); }}
                            className="text-xs border rounded px-1.5 py-0.5 w-28"
                            autoFocus
                          />
                          <button onClick={() => renameTournee(t, editTourneeName)} className="text-green-600 hover:text-green-800"><Save className="w-3 h-3" /></button>
                          <button onClick={() => setEditingTournee(null)} className="text-gray-400 hover:text-gray-600"><X className="w-3 h-3" /></button>
                        </div>
                      );
                    }
                    return (
                      <div key={t} className="group relative inline-flex items-center">
                        <button
                          onClick={() => { setFilterTournees(prev => { const next = new Set(prev); if (next.has(t)) next.delete(t); else next.add(t); return next; }); setFilterNoTournee(false); setCurrentPage(0); }}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${active ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        >
                          {t}
                        </button>
                        <span className="hidden group-hover:inline-flex items-center gap-0.5 ml-0.5">
                          <button onClick={e => { e.stopPropagation(); setEditingTournee(t); setEditTourneeName(t); }} className="p-0.5 text-gray-400 hover:text-blue-600"><Edit2 className="w-3 h-3" /></button>
                          <button onClick={e => { e.stopPropagation(); deleteTournee(t); }} className="p-0.5 text-gray-400 hover:text-red-600"><Trash2 className="w-3 h-3" /></button>
                        </span>
                      </div>
                    );
                  })}
                  {allTournees.length === 0 && (
                    <span className="text-xs text-gray-400">Aucune tournee configuree</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Visit filter quick buttons */}
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => { setFilterNoType(!filterNoType); setFilterTypes(new Set()); setCurrentPage(0); }}
              className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                filterNoType ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 border border-transparent hover:bg-gray-200'
              }`}
            >
              Sans type
            </button>
            {Object.entries(CLIENT_TYPE_FAMILIES).map(([key, fam]) => (
              <button
                key={key}
                onClick={() => {
                  setFilterTypes(prev => {
                    const next = new Set(prev);
                    const allSelected = fam.types.every(t => next.has(t));
                    if (allSelected) {
                      fam.types.forEach(t => next.delete(t));
                    } else {
                      fam.types.forEach(t => next.add(t));
                    }
                    return next;
                  });
                  setFilterNoType(false);
                  setCurrentPage(0);
                }}
                className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                  fam.types.some(t => filterTypes.has(t))
                    ? 'bg-brewery-100 text-brewery-700 border border-brewery-300'
                    : 'bg-gray-100 text-gray-600 border border-transparent hover:bg-gray-200'
                }`}
              >
                {fam.label}
              </button>
            ))}
            {(filterTypes.size > 0 || filterNoType) && (
              <button onClick={() => { setFilterTypes(new Set()); setFilterNoType(false); setCurrentPage(0); }} className="px-2 py-1 rounded-full text-xs text-red-600 hover:bg-red-50">
                Effacer
              </button>
            )}
          </div>
        </div>

        {/* Selection mode toolbar */}
        {selectionMode && (
          <div className="px-4 py-2 bg-brewery-50 border-b border-brewery-200 flex items-center gap-2 flex-wrap">
            <button
              className="text-xs font-medium text-brewery-700 hover:text-brewery-900 underline"
              onClick={() => selectedIds.size === paginated.length
                ? setSelectedIds(new Set())
                : setSelectedIds(new Set(filtered.map(c => c.id)))}
            >
              {selectedIds.size === filtered.length ? 'Tout désélectionner' : 'Tout sélectionner'}
            </button>
            <span className="text-xs text-brewery-600 ml-auto font-medium">{selectedIds.size} sélectionné(s)</span>
            <button onClick={() => setSelectionMode(false)} className="p-1 text-gray-400 hover:text-gray-600"><XCircle className="w-4 h-4" /></button>
          </div>
        )}

        {/* Bulk action bar */}
        {selectionMode && selectedIds.size > 0 && (
          <div className="px-4 py-2.5 bg-indigo-50 border-b border-indigo-200 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-indigo-700 mr-1">Actions en masse :</span>
            <select
              className="text-xs border border-indigo-200 rounded-lg px-2 py-1 bg-white text-gray-700"
              value={bulkAction}
              onChange={e => { setBulkAction(e.target.value as typeof bulkAction); setBulkValue(''); setBulkNextVisit(''); setBulkVisiteComment(''); setBulkVisiteType('VISITE'); }}
            >
              <option value="none">Choisir une action…</option>
              <option value="visite">Enregistrer une visite</option>
              {isAdmin && <option value="commercial">Changer le commercial</option>}
              <option value="tournee">Changer la tournée</option>
              <option value="type">Changer le type</option>
              <option value="statut">Changer le statut</option>
              <option value="next_visit">Definir date de visite</option>
              <option value="recurrence">Recurrence + prochaine visite</option>
            </select>

            {bulkAction === 'visite' && (
              <div className="flex items-center gap-2 flex-1">
                <select
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"
                  value={bulkVisiteType}
                  onChange={e => setBulkVisiteType(e.target.value as InteractionType)}
                >
                  <option value="VISITE">Visite</option>
                  <option value="APPEL">Appel</option>
                </select>
                <input
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white flex-1 min-w-[200px]"
                  placeholder="Commentaire (obligatoire)…"
                  value={bulkVisiteComment}
                  onChange={e => setBulkVisiteComment(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && bulkVisiteComment.trim()) applyBulkAction(); }}
                />
              </div>
            )}
            {bulkAction === 'commercial' && (
              <select className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white" value={bulkValue} onChange={e => setBulkValue(e.target.value)}>
                <option value="">Choisir…</option>
                {state.commerciaux.map(c => <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>)}
              </select>
            )}
            {bulkAction === 'tournee' && (
              <input
                list="bulk-tournee-list"
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white w-36"
                placeholder="Zone / Tournée"
                value={bulkValue}
                onChange={e => setBulkValue(e.target.value)}
              />
            )}
            {bulkAction === 'type' && (
              <select className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white" value={bulkValue} onChange={e => setBulkValue(e.target.value)}>
                <option value="">Choisir…</option>
                {Object.entries(CLIENT_TYPE_FAMILIES).map(([, fam]) =>
                  fam.types.map(t => <option key={t} value={t}>{CLIENT_TYPE_LABELS[t]}</option>)
                )}
              </select>
            )}
            {bulkAction === 'statut' && (
              <select className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white" value={bulkValue} onChange={e => setBulkValue(e.target.value)}>
                <option value="">Choisir…</option>
                <option value="ACTIF">Actif</option>
                <option value="INACTIF">Inactif</option>
              </select>
            )}
            {bulkAction === 'next_visit' && (
              <input
                type="date"
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"
                value={bulkValue}
                onChange={e => setBulkValue(e.target.value)}
              />
            )}
            {bulkAction === 'recurrence' && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white w-20"
                  placeholder="Jours"
                  value={bulkValue}
                  onChange={e => setBulkValue(e.target.value)}
                />
                <span className="text-xs text-gray-500">jours</span>
                <input
                  type="date"
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"
                  value={bulkNextVisit}
                  onChange={e => setBulkNextVisit(e.target.value)}
                  placeholder="Prochaine visite"
                />
                <span className="text-xs text-gray-400">(opt.)</span>
              </div>
            )}

            {bulkAction !== 'none' && (
              <button
                onClick={applyBulkAction}
                disabled={bulkAction === 'visite' ? !bulkVisiteComment.trim() : (!bulkValue && bulkAction !== 'statut' && bulkAction !== 'recurrence')}
                className="px-3 py-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-40"
              >
                {bulkAction === 'visite' ? `Enregistrer (${selectedIds.size})` : 'Appliquer'}
              </button>
            )}
            <button
              onClick={bulkDelete}
              className="px-3 py-1 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg ml-auto"
            >
              <Trash2 className="w-3 h-3 inline mr-1" />Supprimer
            </button>
          </div>
        )}
        <datalist id="bulk-tournee-list">
          {allTournees.map(t => <option key={t} value={t} />)}
        </datalist>

        {/* Client list */}
        {(
        <div className="flex-1 overflow-y-auto">
          {paginated.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <User className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium">Aucun client trouve</p>
              <p className="text-xs mt-1">Modifiez vos filtres ou ajoutez un nouveau client</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {paginated.map(client => {
                const visitStatus = getVisitStatus(client);
                const statusConfig = VISIT_STATUS_CONFIG[visitStatus];
                const commercial = getCommercial(client.commercial_id);
                const isSelected = selectedId === client.id;

                return (
                  <div
                    key={client.id}
                    onClick={selectionMode ? (e) => toggleSelection(client.id, e) : () => setSearchParams({ id: client.id })}
                    className={`px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                      isSelected && !selectionMode ? 'bg-brewery-50 border-l-3 border-brewery-600' : ''
                    } ${selectionMode && selectedIds.has(client.id) ? 'bg-indigo-50' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      {selectionMode ? (
                        <div className="flex-shrink-0 mt-0.5" onClick={e => toggleSelection(client.id, e)}>
                          {selectedIds.has(client.id)
                            ? <CheckSquare className="w-4 h-4 text-indigo-600" />
                            : <Square className="w-4 h-4 text-gray-300" />}
                        </div>
                      ) : (
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 ${statusConfig.dot}`} title={statusConfig.label} />
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className={`text-sm font-medium truncate ${client.statut === 'INACTIF' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                            {client.nom}
                          </h3>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusConfig.color}`}>
                            {statusConfig.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 flex-wrap">
                          {client.contact && <span className="text-gray-500">{client.contact}</span>}
                          {client.contact && (client.ville || CLIENT_TYPE_LABELS[client.type_client]) && <span>-</span>}
                          <span>{CLIENT_TYPE_LABELS[client.type_client]}</span>
                          {client.ville && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              {client.ville}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-[10px] text-gray-400 flex-wrap">
                          {client.tournee && <span className="text-brewery-600 font-medium">{client.tournee}</span>}
                          {isAdmin && commercial && (
                            <span className="flex items-center gap-1">
                              <User className="w-3 h-3" />
                              {commercial.prenom}
                            </span>
                          )}
                          {(client.telephone || client.telephone_mobile) && (
                            <span className="flex items-center gap-1">
                              <Phone className="w-3 h-3" />
                              {client.telephone_mobile || client.telephone}
                            </span>
                          )}
                        </div>
                        {client.next_visit && (
                          <div className="flex items-center gap-1 mt-0.5 text-[10px] text-gray-400">
                            <Calendar className="w-3 h-3" />
                            Prochaine visite : {formatDate(client.next_visit)}
                          </div>
                        )}
                        {client.notes && (
                          <div className="flex items-start gap-1 mt-1 px-2 py-1 bg-yellow-50 border border-yellow-200 rounded text-[11px] text-yellow-800">
                            <StickyNote className="w-3 h-3 mt-0.5 flex-shrink-0 text-yellow-500" />
                            <span className="line-clamp-2">{client.notes}</span>
                          </div>
                        )}
                      </div>

                    </div>
                    {/* Quick actions - horizontal */}
                    <div className="flex items-center gap-3 sm:gap-1.5 mt-2 pl-5">
                      {(client.telephone || client.telephone_mobile) && (
                        <a
                          href={`tel:${client.telephone_mobile || client.telephone}`}
                          onClick={e => e.stopPropagation()}
                          className="px-3 py-1.5 sm:p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
                          title={`Appeler${client.telephone_mobile ? ` (mobile: ${client.telephone_mobile})` : ` (${client.telephone})`}`}
                        >
                          <Phone className="w-3.5 h-3.5" />
                        </a>
                      )}
                      {client.email && (
                        <button
                          onClick={e => { e.stopPropagation(); setEmailClient(client); }}
                          className="px-3 py-1.5 sm:p-1.5 rounded-lg bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors"
                          title={`Envoyer un email a ${client.email}`}
                        >
                          <Mail className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); setInteractionClient(client); setInteractionType('VISITE'); }}
                        className="px-3 py-1.5 sm:p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                        title="Enregistrer une visite"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setInteractionClient(client); setInteractionType('RDV_PLANIFIE'); }}
                        className="px-3 py-1.5 sm:p-1.5 rounded-lg bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors"
                        title="Planifier un RDV"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditForm(client); }}
                        className="px-3 py-1.5 sm:p-1.5 rounded-lg bg-gray-50 text-gray-500 hover:bg-gray-100 transition-colors"
                        title="Modifier le client"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); openQuickNote(client.id); }}
                        className="px-3 py-1.5 sm:p-1.5 rounded-lg bg-yellow-50 text-yellow-600 hover:bg-yellow-100 transition-colors"
                        title="Note rapide"
                      >
                        <StickyNote className="w-3.5 h-3.5" />
                      </button>
                      {(client.latitude && client.longitude) ? (
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${client.latitude},${client.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="px-3 py-1.5 sm:p-1.5 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors"
                          title="Naviguer vers ce client"
                        >
                          <Navigation className="w-3.5 h-3.5" />
                        </a>
                      ) : client.adresse ? (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([client.adresse, client.ville].filter(Boolean).join(' '))}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="px-3 py-1.5 sm:p-1.5 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors"
                          title="Voir sur la carte"
                        >
                          <Navigation className="w-3.5 h-3.5" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-3 border-t border-gray-200 bg-white flex items-center justify-between text-xs">
            <span className="text-gray-500">Page {currentPage + 1} / {totalPages}</span>
            <div className="flex gap-1">
              <button onClick={() => setCurrentPage(p => Math.max(0, p - 1))} disabled={currentPage === 0} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))} disabled={currentPage >= totalPages - 1} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selectedClient && (
        <div className="w-full md:w-[420px] border-l border-gray-200 bg-white flex flex-col h-full overflow-hidden">
          {/* Detail header */}
          <div className="p-4 border-b border-gray-200 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <button onClick={() => setSearchParams({})} className="md:hidden p-1 rounded hover:bg-gray-100">
                <ChevronLeft className="w-5 h-5 text-gray-600" />
              </button>
              <h2 className="text-lg font-bold text-gray-900 flex-1 truncate">{selectedClient.nom}</h2>
              <div className="flex gap-1">
                <button onClick={() => openEditForm(selectedClient)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100" title="Modifier">
                  <Edit2 className="w-4 h-4" />
                </button>
                <button onClick={() => toggleStatus(selectedClient)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100" title={selectedClient.statut === 'ACTIF' ? 'Desactiver' : 'Reactiver'}>
                  {selectedClient.statut === 'ACTIF' ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button onClick={() => deleteClient(selectedClient.id)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50" title="Supprimer">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Status badges */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${selectedClient.statut === 'ACTIF' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {selectedClient.statut}
              </span>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                {CLIENT_TYPE_LABELS[selectedClient.type_client]}
              </span>
              {selectedClient.tournee && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-brewery-50 text-brewery-700">
                  {selectedClient.tournee}
                </span>
              )}
            </div>

            {/* Contact info */}
            <div className="space-y-1.5 text-sm">
              {selectedClient.contact && (
                <div className="flex items-center gap-2 text-gray-600">
                  <User className="w-3.5 h-3.5 text-gray-400" />
                  <span>{selectedClient.contact}</span>
                </div>
              )}
              {selectedClient.telephone && (
                <a href={`tel:${selectedClient.telephone}`} className="flex items-center gap-2 text-blue-600 hover:text-blue-700">
                  <Phone className="w-3.5 h-3.5" />
                  <span>{selectedClient.telephone}</span>
                </a>
              )}
              {selectedClient.telephone_mobile && (
                <a href={`tel:${selectedClient.telephone_mobile}`} className="flex items-center gap-2 text-blue-600 hover:text-blue-700">
                  <Phone className="w-3.5 h-3.5" />
                  <span>{selectedClient.telephone_mobile} (mobile)</span>
                </a>
              )}
              {selectedClient.email && (
                <button onClick={() => setEmailClient(selectedClient)} className="flex items-center gap-2 text-blue-600 hover:text-blue-700">
                  <Mail className="w-3.5 h-3.5" />
                  <span className="truncate">{selectedClient.email}</span>
                </button>
              )}
              {(selectedClient.adresse || selectedClient.ville) && (
                <div className="flex items-center gap-2 text-gray-600">
                  <MapPin className="w-3.5 h-3.5 text-gray-400" />
                  <span>{[selectedClient.adresse, selectedClient.code_postal, selectedClient.ville].filter(Boolean).join(', ')}</span>
                </div>
              )}
            </div>

            {/* Visit info */}
            <div className="mt-3 p-3 bg-gray-50 rounded-lg">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-gray-500">Derniere visite</span>
                  <p className="font-medium text-gray-900">{selectedClient.last_visit ? formatDate(selectedClient.last_visit) : 'Jamais'}</p>
                </div>
                <div>
                  <span className="text-gray-500">Prochaine visite</span>
                  <p className={`font-medium ${getVisitStatus(selectedClient) === 'LATE' ? 'text-red-600' : 'text-gray-900'}`}>
                    {selectedClient.next_visit ? formatDate(selectedClient.next_visit) : 'Non planifiee'}
                  </p>
                </div>
                <div>
                  <span className="text-gray-500">Frequence</span>
                  <p className="font-medium text-gray-900">
                    {selectedClient.custom_recurrence
                      ? `${selectedClient.custom_recurrence}j (perso)`
                      : getEffectiveFrequency(selectedClient.type_client, null) != null
                        ? `${getEffectiveFrequency(selectedClient.type_client, null)}j`
                        : 'Aucune'}
                  </p>
                </div>
                <div>
                  <span className="text-gray-500">Commercial</span>
                  <p className="font-medium text-gray-900">{getCommercial(selectedClient.commercial_id)?.prenom || '-'}</p>
                </div>
              </div>
            </div>

            {/* Quick action buttons */}
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => { setInteractionClient(selectedClient); setInteractionType('VISITE'); }}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Visite
              </button>
              <button
                onClick={() => { setInteractionClient(selectedClient); setInteractionType('APPEL'); }}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
              >
                <PhoneCall className="w-3.5 h-3.5" />
                Appel
              </button>
              <button
                onClick={() => { setInteractionClient(selectedClient); setInteractionType('RDV_PLANIFIE'); setInteractionDate(toLocalDateStr(new Date())); }}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 transition-colors"
              >
                <Calendar className="w-3.5 h-3.5" />
                RDV
              </button>
            </div>

            {/* Notes */}
            {selectedClient.notes && (
              <div className="mt-3 p-3 bg-yellow-50 rounded-lg text-xs text-gray-700 border border-yellow-200">
                <p className="font-medium text-yellow-800 mb-1">Notes</p>
                <p className="whitespace-pre-wrap">{selectedClient.notes}</p>
              </div>
            )}
          </div>

          {/* Scrollable content: Tasks, Commandes, Historique */}
          <div className="flex-1 overflow-y-auto">

          {/* Tasks */}
          <div className="px-4 pt-3 pb-1">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                <ListTodo className="w-4 h-4" /> Taches ({selectedTasks.filter(t => t.statut !== 'TERMINEE').length})
              </h3>
              <button
                onClick={() => { setTaskClientId(selectedClient!.id); setTaskTitle(''); setTaskDate(''); setShowTaskForm(true); }}
                className="text-xs text-brewery-600 hover:text-brewery-700 font-medium flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Ajouter
              </button>
            </div>
            {selectedTasks.length > 0 && (
              <div className="space-y-1 mb-2">
                {selectedTasks
                  .sort((a, b) => (a.statut === 'TERMINEE' ? 1 : 0) - (b.statut === 'TERMINEE' ? 1 : 0))
                  .slice(0, 5)
                  .map(task => (
                    <div key={task.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg text-xs">
                      <button onClick={() => toggleTask(task)} className="flex-shrink-0">
                        {task.statut === 'TERMINEE'
                          ? <Check className="w-4 h-4 text-green-500" />
                          : <div className="w-4 h-4 border-2 border-gray-300 rounded" />}
                      </button>
                      <span className={`flex-1 truncate ${task.statut === 'TERMINEE' ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                        {task.titre}
                      </span>
                      {task.date_echeance && (
                        <span className={`text-[10px] flex-shrink-0 ${task.date_echeance < toLocalDateStr(new Date()) && task.statut !== 'TERMINEE' ? 'text-red-500' : 'text-gray-400'}`}>
                          {formatDate(task.date_echeance)}
                        </span>
                      )}
                      <button onClick={async () => { try { await apiDelete(`/tasks-client/${task.id}`); dispatchLocal({ type: 'DELETE_TASK_CLIENT', payload: task.id }); } catch { toast.error('Erreur lors de la suppression de la tâche'); } }} className="flex-shrink-0 p-0.5 rounded hover:bg-red-50">
                        <X className="w-3 h-3 text-gray-400 hover:text-red-500" />
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Commandes */}
          {selectedCommandes.length > 0 && (
          <div className="p-4 border-t border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Commandes ({selectedCommandes.length})</h3>
            <div className="space-y-2">
              {selectedCommandes.slice(0, 10).map(cmd => (
                <div key={cmd.id} className="p-2.5 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-900">
                      {cmd.numero ? `#${cmd.numero}` : 'Commande'}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      cmd.statut === 'livree' ? 'bg-green-100 text-green-700' :
                      cmd.statut === 'annulee' ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {cmd.statut === 'livree' ? 'Livree' : cmd.statut === 'annulee' ? 'Annulee' : 'En cours'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-gray-500">
                    <span>{cmd.date_commande ? formatDate(cmd.date_commande) : ''}</span>
                    {cmd.montant_ttc > 0 && <span className="font-semibold text-gray-700">{cmd.montant_ttc.toFixed(2)} € TTC</span>}
                  </div>
                  {cmd.lignes && cmd.lignes.length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      {cmd.lignes.slice(0, 5).map((l, i) => (
                        <div key={i} className="flex justify-between text-[10px] text-gray-500">
                          <span className="truncate flex-1">{l.produit}</span>
                          <span className="flex-shrink-0 ml-2">x{l.quantite}</span>
                        </div>
                      ))}
                      {cmd.lignes.length > 5 && <p className="text-[10px] text-gray-400">+{cmd.lignes.length - 5} autres</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          )}

          {/* Interaction history */}
          <div className="p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Historique ({selectedInteractions.length})</h3>
            {selectedInteractions.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">Aucune interaction enregistree</p>
            ) : (
              <div className="space-y-2">
                {selectedInteractions.slice(0, 20).map(interaction => {
                  const comm = getCommercial(interaction.commercial_id);
                  return (
                    <div key={interaction.id} className="flex gap-3 p-2.5 bg-gray-50 rounded-lg">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        interaction.type === 'VISITE' ? 'bg-green-100' : interaction.type === 'APPEL' ? 'bg-blue-100' : 'bg-purple-100'
                      }`}>
                        {interaction.type === 'VISITE' ? <Navigation className="w-4 h-4 text-green-600" /> :
                         interaction.type === 'APPEL' ? <PhoneCall className="w-4 h-4 text-blue-600" /> :
                         <Calendar className="w-4 h-4 text-purple-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-gray-900">
                            {INTERACTION_TYPE_LABELS[interaction.type]}
                          </span>
                          <span className="text-[10px] text-gray-400">{formatDate(interaction.date)}</span>
                        </div>
                        {comm && <p className="text-[10px] text-gray-500">{comm.prenom} {comm.nom}</p>}
                        {interaction.comment && <p className="text-xs text-gray-600 mt-1">{interaction.comment}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          </div>{/* end scrollable content */}
        </div>
      )}

      {/* New/Edit Client Modal */}
      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl z-10">
              <h2 className="text-lg font-bold text-gray-900">
                {editingClient ? 'Modifier le client' : 'Nouveau client'}
              </h2>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Nom de l'etablissement *</label>
                <input
                  type="text"
                  value={formData.nom || ''}
                  onChange={e => { setFormData(prev => ({ ...prev, nom: e.target.value })); setForceCreate(false); }}
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500 ${
                    !forceCreate && (duplicateClients.length > 0 || duplicateProspects.length > 0) ? 'border-orange-300' : 'border-gray-200'
                  }`}
                  placeholder="Nom du client"
                  autoFocus
                />
                {!forceCreate && (duplicateClients.length > 0 || duplicateProspects.length > 0) && (
                  <div className="mt-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                    <p className="text-xs font-semibold text-orange-700 mb-1.5 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Doublons potentiels detectes
                    </p>
                    <div className="space-y-1 mb-2 max-h-32 overflow-y-auto">
                      {duplicateClients.map(c => (
                        <div key={c.id} className="flex items-center justify-between bg-white rounded px-2 py-1.5 border border-orange-200 text-xs">
                          <span className="font-medium text-gray-800">{c.nom}</span>
                          <span className="text-orange-500 ml-2">{c.ville && `${c.ville} · `}Client</span>
                        </div>
                      ))}
                      {duplicateProspects.map(p => (
                        <div key={p.id} className="flex items-center justify-between bg-white rounded px-2 py-1.5 border border-amber-200 text-xs">
                          <span className="font-medium text-gray-800">{p.nom_etablissement}</span>
                          <span className="text-amber-600 ml-2">{p.ville && `${p.ville} · `}Prospect</span>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="px-3 py-1.5 text-xs bg-orange-600 text-white rounded-lg hover:bg-orange-700"
                      onClick={() => setForceCreate(true)}
                    >
                      Creer quand meme
                    </button>
                  </div>
                )}
              </div>

              {/* Type & Status */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Type de client</label>
                  <select
                    value={formData.type_client || 'BAR_RESTAURANT_GENERAL'}
                    onChange={e => setFormData(prev => ({ ...prev, type_client: e.target.value as ClientType }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  >
                    {Object.entries(CLIENT_TYPE_FAMILIES).map(([key, fam]) => (
                      <optgroup key={key} label={fam.label}>
                        {fam.types.map(t => (
                          <option key={t} value={t}>{CLIENT_TYPE_LABELS[t]}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Statut</label>
                  <select
                    value={formData.statut || 'ACTIF'}
                    onChange={e => setFormData(prev => ({ ...prev, statut: e.target.value as ClientStatus }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="ACTIF">Actif</option>
                    <option value="INACTIF">Inactif</option>
                  </select>
                </div>
              </div>

              {/* Contact */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Nom du contact</label>
                <input
                  type="text"
                  value={formData.contact || ''}
                  onChange={e => setFormData(prev => ({ ...prev, contact: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="Nom de la personne contact"
                />
              </div>

              {/* Phone & Email */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Telephone</label>
                  <input
                    type="tel"
                    value={formData.telephone || ''}
                    onChange={e => setFormData(prev => ({ ...prev, telephone: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Mobile</label>
                  <input
                    type="tel"
                    value={formData.telephone_mobile || ''}
                    onChange={e => setFormData(prev => ({ ...prev, telephone_mobile: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={formData.email || ''}
                  onChange={e => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              {/* Address */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Adresse</label>
                <input
                  type="text"
                  value={formData.adresse || ''}
                  onChange={e => setFormData(prev => ({ ...prev, adresse: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Code postal</label>
                  <input
                    type="text"
                    value={formData.code_postal || ''}
                    onChange={e => setFormData(prev => ({ ...prev, code_postal: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Ville</label>
                  <input
                    type="text"
                    value={formData.ville || ''}
                    onChange={e => setFormData(prev => ({ ...prev, ville: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {/* Commercial & Tournee */}
              <div className="grid grid-cols-2 gap-3">
                {isAdmin && (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Commercial</label>
                    <select
                      value={formData.commercial_id || ''}
                      onChange={e => setFormData(prev => ({ ...prev, commercial_id: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    >
                      {state.commerciaux.map(c => (
                        <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Tournee</label>
                  <input
                    type="text"
                    value={formData.tournee || ''}
                    onChange={e => setFormData(prev => ({ ...prev, tournee: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    placeholder="Zone / Tournee"
                    list="tournee-list"
                  />
                  <datalist id="tournee-list">
                    {allTournees.map(t => <option key={t} value={t} />)}
                  </datalist>
                </div>
              </div>

              {/* Custom recurrence */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Frequence de visite personnalisee (jours)
                  <span className="text-gray-400 font-normal ml-1">
                    (defaut: {CLIENT_VISIT_FREQUENCIES[(formData.type_client || 'BAR_RESTAURANT_GENERAL') as ClientType] ?? 'aucune'}j)
                  </span>
                </label>
                <input
                  type="number"
                  value={formData.custom_recurrence ?? ''}
                  onChange={e => setFormData(prev => ({ ...prev, custom_recurrence: e.target.value ? parseInt(e.target.value) : null }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="Laisser vide pour utiliser la valeur par defaut"
                  min="1"
                />
              </div>

              {/* SIRET */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">SIRET</label>
                <input
                  type="text"
                  value={formData.siret || ''}
                  onChange={e => setFormData(prev => ({ ...prev, siret: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={formData.notes || ''}
                  onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  rows={3}
                  placeholder="Notes internes..."
                />
              </div>

              {/* Save button */}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                  Annuler
                </button>
                <button
                  onClick={saveClient}
                  disabled={!formData.nom?.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-brewery-600 text-white rounded-lg text-sm font-medium hover:bg-brewery-700 disabled:opacity-50 transition-colors"
                >
                  <Save className="w-4 h-4" />
                  {editingClient ? 'Enregistrer' : 'Creer le client'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Interaction Modal */}
      {interactionClient && (
        <div className="modal-backdrop" onClick={() => resetInteractionModal()}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {/* RDV Confirmation Screen */}
            {showRdvConfirmation ? (() => {
              const createdRdv = state.appointments.find(a => a.id === createdRdvId);
              const rdvCommercial = state.commerciaux.find(c => c.id === (createdRdv?.commercial_id || rdvCommercialId));
              const dayRdvs = createdRdv ? state.appointments
                .filter(a => a.commercial_id === createdRdv.commercial_id && a.date === createdRdv.date && a.statut !== 'annule')
                .sort((a, b) => a.heure_debut.localeCompare(b.heure_debut)) : [];

              return (
                <div className="p-5 space-y-4">
                  <div className="text-center">
                    <div className="w-14 h-14 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-3">
                      <CheckCircle2 className="w-7 h-7 text-green-600" />
                    </div>
                    <h3 className="font-bold text-gray-900">RDV cree avec succes !</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      {interactionClient.nom} - {formatDate(createdRdv?.date || '')}
                    </p>
                  </div>

                  {createdRdv && (
                    <div className="bg-blue-50 rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center gap-2 text-xs text-blue-700">
                        <Calendar className="w-3.5 h-3.5" />
                        <span className="font-medium">{formatDate(createdRdv.date)} de {createdRdv.heure_debut} a {createdRdv.heure_fin}</span>
                      </div>
                      {createdRdv.lieu && (
                        <div className="flex items-center gap-2 text-xs text-blue-600">
                          <MapPin className="w-3.5 h-3.5" />
                          {createdRdv.lieu}
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-xs text-blue-600">
                        <Users className="w-3.5 h-3.5" />
                        Commercial : {rdvCommercial?.prenom} {rdvCommercial?.nom}
                      </div>
                    </div>
                  )}

                  {dayRdvs.length > 1 && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-[10px] font-semibold text-gray-500 uppercase mb-2">
                        Agenda de {rdvCommercial?.prenom} le {formatDate(createdRdv?.date || '')}
                      </p>
                      <div className="space-y-1">
                        {dayRdvs.map(rdv => {
                          const isCurrent = rdv.id === createdRdvId;
                          const p = rdv.prospect_id ? state.prospects.find(pr => pr.id === rdv.prospect_id) : null;
                          const cl = rdv.client_id ? state.clients.find(c => c.id === rdv.client_id) : null;
                          return (
                            <div
                              key={rdv.id}
                              className={`flex items-center gap-2 text-xs py-1 px-2 rounded ${isCurrent ? 'bg-green-100 font-medium text-green-800' : 'text-gray-600'}`}
                            >
                              <span className="font-mono w-20 flex-shrink-0">{rdv.heure_debut}-{rdv.heure_fin}</span>
                              <span className="truncate">{cl?.nom || p?.nom_etablissement || 'RDV'}</span>
                              {isCurrent && <span className="text-[9px] text-green-600 ml-auto">Nouveau</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    {createdRdv && interactionClient && (
                      <button
                        className="flex-1 px-4 py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 font-medium"
                        onClick={() => downloadICSClient(createdRdv, interactionClient)}
                      >
                        <CalendarPlus className="w-4 h-4" /> Ajouter a l'agenda
                      </button>
                    )}
                    <button
                      className="flex-1 px-4 py-2.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"
                      onClick={() => resetInteractionModal()}
                    >
                      Fermer
                    </button>
                  </div>
                </div>
              );
            })() : (
              <>
                <div className="p-5 border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">
                      {interactionType === 'VISITE' ? 'Marquer une visite' : interactionType === 'APPEL' ? 'Marquer un appel' : 'Planifier un RDV'}
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">{interactionClient.nom}</p>
                  </div>
                  <button className="p-1 rounded hover:bg-gray-100" onClick={() => resetInteractionModal()}>
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
                    <div className="flex gap-2">
                      {(['VISITE', 'APPEL', 'RDV_PLANIFIE'] as InteractionType[]).map(type => (
                        <button
                          key={type}
                          onClick={() => setInteractionType(type)}
                          className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${
                            interactionType === type
                              ? type === 'VISITE' ? 'bg-green-100 text-green-700 border border-green-300'
                                : type === 'APPEL' ? 'bg-blue-100 text-blue-700 border border-blue-300'
                                : 'bg-purple-100 text-purple-700 border border-purple-300'
                              : 'bg-gray-100 text-gray-600 border border-transparent hover:bg-gray-200'
                          }`}
                        >
                          {INTERACTION_TYPE_LABELS[type]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* RDV fields */}
                  {interactionType === 'RDV_PLANIFIE' && (
                    <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-purple-700 flex items-center gap-1">
                          <Calendar className="w-3 h-3" /> Rendez-vous
                        </label>
                      </div>

                      {/* Commercial assigne */}
                      <div>
                        <label className="block text-[10px] text-purple-600 mb-0.5 flex items-center gap-1">
                          <Users className="w-3 h-3" /> Commercial assigne au RDV
                        </label>
                        <select
                          className="w-full px-2 py-1.5 border border-purple-200 rounded-lg text-xs bg-white"
                          value={rdvCommercialId}
                          onChange={e => setRdvCommercialId(e.target.value)}
                        >
                          {state.commerciaux.map(c => (
                            <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
                          ))}
                        </select>
                      </div>

                      {/* Date + heures */}
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="block text-[10px] text-purple-600 mb-0.5">Date *</label>
                          <input
                            type="date"
                            className="w-full px-2 py-1.5 border border-purple-200 rounded-lg text-xs bg-white"
                            value={interactionDate}
                            onChange={e => setInteractionDate(e.target.value)}
                          />
                        </div>
                        <div className="w-20">
                          <label className="block text-[10px] text-purple-600 mb-0.5">Debut</label>
                          <input
                            type="time"
                            className="w-full px-2 py-1.5 border border-purple-200 rounded-lg text-xs bg-white"
                            value={rdvHeureDebut}
                            onChange={e => setRdvHeureDebut(e.target.value)}
                          />
                        </div>
                        <div className="w-20">
                          <label className="block text-[10px] text-purple-600 mb-0.5">Fin</label>
                          <input
                            type="time"
                            className="w-full px-2 py-1.5 border border-purple-200 rounded-lg text-xs bg-white"
                            value={rdvHeureFin}
                            onChange={e => setRdvHeureFin(e.target.value)}
                          />
                        </div>
                      </div>

                      {/* Internal RDV conflicts */}
                      {rdvConflicts.length > 0 && (
                        <div className="p-2 bg-red-50 border border-red-200 rounded-lg">
                          <p className="text-[11px] text-red-700 font-medium flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" /> Conflit horaire !
                          </p>
                          {rdvConflicts.map(c => {
                            const cp = c.prospect_id ? state.prospects.find(p => p.id === c.prospect_id) : null;
                            const cc = c.client_id ? state.clients.find(cl => cl.id === c.client_id) : null;
                            return (
                              <p key={c.id} className="text-[10px] text-red-600 mt-0.5">
                                {c.heure_debut}-{c.heure_fin} : {cc?.nom || cp?.nom_etablissement || 'RDV'}
                              </p>
                            );
                          })}
                        </div>
                      )}

                      {/* Google Calendar conflicts */}
                      {googleConflicts.length > 0 && (
                        <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg">
                          <p className="text-[11px] text-amber-700 font-medium flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" /> Attention — evenement(s) Google Agenda sur ce creneau
                          </p>
                          {googleConflicts.map(evt => {
                            const start = evt.start.includes('T') ? evt.start.substring(11, 16) : '';
                            const end = evt.end.includes('T') ? evt.end.substring(11, 16) : '';
                            return (
                              <p key={evt.id} className="text-[10px] text-amber-600 mt-0.5">
                                {evt.allDay ? 'Journee entiere' : `${start}-${end}`} : {evt.summary}
                              </p>
                            );
                          })}
                        </div>
                      )}

                      {/* Lieu */}
                      <input
                        type="text"
                        className="w-full px-3 py-2 border border-purple-200 rounded-lg text-sm bg-white"
                        placeholder="Lieu du RDV..."
                        value={rdvLieu}
                        onChange={e => setRdvLieu(e.target.value)}
                      />

                      {/* Notes RDV */}
                      <input
                        type="text"
                        className="w-full px-3 py-2 border border-purple-200 rounded-lg text-sm bg-white"
                        placeholder="Notes du RDV (optionnel)..."
                        value={rdvNotes}
                        onChange={e => setRdvNotes(e.target.value)}
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Commentaire <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={interactionComment}
                      onChange={e => setInteractionComment(e.target.value)}
                      className={`w-full border rounded-lg px-3 py-2 text-sm ${!interactionComment.trim() ? 'border-red-300' : 'border-gray-200'}`}
                      rows={3}
                      placeholder="Notes sur cette interaction... (obligatoire)"
                    />
                    {!interactionComment.trim() && (
                      <p className="text-[10px] text-red-500 mt-1">Le commentaire est obligatoire</p>
                    )}
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => resetInteractionModal()} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                      Annuler
                    </button>
                    <button
                      onClick={submitInteraction}
                      disabled={!interactionComment.trim() || (interactionType === 'RDV_PLANIFIE' && !interactionDate)}
                      className={`flex items-center gap-1.5 px-4 py-2 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        interactionType === 'VISITE' ? 'bg-green-600 hover:bg-green-700'
                          : interactionType === 'APPEL' ? 'bg-blue-600 hover:bg-blue-700'
                          : 'bg-purple-600 hover:bg-purple-700'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Confirmer
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* New Task Modal */}
      {showTaskForm && (
        <div className="modal-backdrop" onClick={() => setShowTaskForm(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 flex items-center gap-2 text-sm">
                <ListTodo className="w-4 h-4 text-brewery-600" /> Nouvelle tache
              </h3>
              <button className="p-1 rounded hover:bg-gray-100" onClick={() => setShowTaskForm(false)}>
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Titre *</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brewery-500"
                  value={taskTitle}
                  onChange={e => setTaskTitle(e.target.value)}
                  placeholder="Ex: Envoyer le catalogue, Relancer..."
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Echeance (optionnel)</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={taskDate}
                  onChange={e => setTaskDate(e.target.value)}
                />
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-2">
              <button className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setShowTaskForm(false)}>
                Annuler
              </button>
              <button
                className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-1.5 disabled:opacity-50"
                disabled={!taskTitle.trim()}
                onClick={addTask}
              >
                <Plus className="w-3.5 h-3.5" /> Creer
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


      {/* Email template modal */}
      {emailClient && (
        <EmailTemplateModal client={emailClient} onClose={() => setEmailClient(null)} />
      )}
    </div>
  );
}
