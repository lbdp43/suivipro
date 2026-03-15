import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ClipboardCheck, RefreshCw, AlertTriangle, MapPin, Phone, Building2,
  ChevronDown, ChevronRight, Calendar, CheckCircle2,
  Navigation, ChevronLeft, ArrowLeft, ArrowRight, User, Users,
  Edit2, X, PhoneCall, CalendarPlus, StickyNote,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import { CLIENT_TYPE_LABELS, INTERACTION_TYPE_LABELS } from '../types';
import type { InteractionType, Client } from '../types';
import { generateId, formatDate, detectConflicts, downloadICSClient } from '../utils/helpers';
import { getGoogleCalendarEvents, type GoogleCalendarEvent } from '../api/client';

interface VisitClient {
  id: string;
  nom: string;
  ville: string;
  adresse: string;
  telephone: string;
  telephone_mobile: string;
  email: string;
  type_client: string;
  tournee: string;
  next_visit: string;
  last_visit: string;
  latitude: number | null;
  longitude: number | null;
  contact: string;
}

interface WeekDay {
  day_key: string;
  date: string;
  day_name: string;
  tournees: string[];
  clients: VisitClient[];
  is_today: boolean;
  is_past: boolean;
}

interface CommercialVisites {
  commercial: { id: string; prenom: string; nom: string; role: string };
  week_days: WeekDay[];
  late_clients: VisitClient[];
  week_pattern: string;
  tournee_active: boolean;
  total_active_clients: number;
}

interface VisitesDataSingle {
  view: 'single';
  week_days: WeekDay[];
  late_clients: VisitClient[];
  week_number: number;
  is_even_week: boolean;
  week_pattern: string;
  week_offset: number;
  week_start: string;
  tournee_active: boolean;
  total_active_clients: number;
}

interface VisitesDataAll {
  view: 'all';
  commerciaux: CommercialVisites[];
  week_number: number;
  is_even_week: boolean;
  week_offset: number;
  week_start: string;
  total_late: number;
}

type VisitesData = VisitesDataSingle | VisitesDataAll;

export default function VisitesPage() {
  const { state, dispatch, getClient } = useApp();
  const toast = useToast();
  const [data, setData] = useState<VisitesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [expandedCommercials, setExpandedCommercials] = useState<Set<string>>(new Set());
  const [weekOffset, setWeekOffset] = useState(0);
  // viewMode: 'me' = my visites, 'all' = all commercials, or a specific commercial_id
  const [viewMode, setViewMode] = useState<string>('me');
  const restoredRef = useRef(false);
  const pendingScrollRef = useRef<number | null>(null);

  // Restore state from sessionStorage on mount
  useEffect(() => {
    const saved = sessionStorage.getItem('visites_state');
    if (saved) {
      try {
        const s = JSON.parse(saved);
        if (s.weekOffset !== undefined) setWeekOffset(s.weekOffset);
        if (s.viewMode) setViewMode(s.viewMode);
        if (s.expandedDays) setExpandedDays(new Set(s.expandedDays));
        if (s.expandedCommercials) setExpandedCommercials(new Set(s.expandedCommercials));
        if (s.scrollTop) pendingScrollRef.current = s.scrollTop;
        restoredRef.current = true;
      } catch { /* ignore */ }
      sessionStorage.removeItem('visites_state');
    }
  }, []);

  // Save state to sessionStorage before navigating away
  const saveState = useCallback(() => {
    sessionStorage.setItem('visites_state', JSON.stringify({
      weekOffset,
      viewMode,
      expandedDays: Array.from(expandedDays),
      expandedCommercials: Array.from(expandedCommercials),
      scrollTop: window.scrollY,
    }));
  }, [weekOffset, viewMode, expandedDays, expandedCommercials]);

  // Interaction modal state
  const [modalClient, setModalClient] = useState<VisitClient | null>(null);
  const [modalType, setModalType] = useState<InteractionType>('VISITE');
  const [modalComment, setModalComment] = useState('');
  const [modalDate, setModalDate] = useState('');
  const [modalSubmitting, setModalSubmitting] = useState(false);
  // RDV fields
  const [modalRdvHeureDebut, setModalRdvHeureDebut] = useState('10:00');
  const [modalRdvHeureFin, setModalRdvHeureFin] = useState('11:00');
  const [modalRdvLieu, setModalRdvLieu] = useState('');
  const [modalRdvCommercialId, setModalRdvCommercialId] = useState('');
  const [modalRdvNotes, setModalRdvNotes] = useState('');
  const [modalGoogleEvents, setModalGoogleEvents] = useState<GoogleCalendarEvent[]>([]);
  const [modalShowConfirmation, setModalShowConfirmation] = useState(false);
  const [modalCreatedRdvId, setModalCreatedRdvId] = useState('');

  // Edit client modal state
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [editForm, setEditForm] = useState({ nom: '', contact: '', telephone: '', telephone_mobile: '', email: '', ville: '', adresse: '', notes: '' });

  // Quick note state
  const [noteClientId, setNoteClientId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [modalClientNotes, setModalClientNotes] = useState('');

  const openInteractionModal = (client: VisitClient, type: InteractionType) => {
    setModalClient(client);
    setModalType(type);
    setModalComment('');
    const now = new Date();
    setModalDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
    setModalRdvHeureDebut('10:00');
    setModalRdvHeureFin('11:00');
    const addr = [client.adresse, client.ville].filter(Boolean).join(', ');
    setModalRdvLieu(addr || '');
    setModalRdvCommercialId(state.currentUser?.id || '');
    setModalRdvNotes('');
    setModalShowConfirmation(false);
    setModalCreatedRdvId('');
    const full = getClient(client.id);
    setModalClientNotes(full?.notes || '');
    // Trigger phone call when opening as APPEL
    if (type === 'APPEL') {
      const phone = client.telephone_mobile || client.telephone;
      if (phone) window.open(`tel:${phone.replace(/\s/g, '')}`, '_self');
    }
  };

  const resetModal = () => {
    setModalClient(null);
    setModalComment('');
    setModalDate('');
    setModalRdvHeureDebut('10:00');
    setModalRdvHeureFin('11:00');
    setModalRdvLieu('');
    setModalRdvCommercialId('');
    setModalRdvNotes('');
    setModalShowConfirmation(false);
    setModalCreatedRdvId('');
  };

  // Google Calendar conflict detection for RDV in Visites modal
  useEffect(() => {
    if (modalType !== 'RDV_PLANIFIE' || !modalRdvCommercialId || !modalDate) {
      setModalGoogleEvents([]);
      return;
    }
    const dayStart = new Date(modalDate + 'T00:00:00').toISOString();
    const dayEnd = new Date(modalDate + 'T23:59:59').toISOString();
    getGoogleCalendarEvents(modalRdvCommercialId, dayStart, dayEnd)
      .then(res => setModalGoogleEvents(res.connected ? res.events : []))
      .catch(() => setModalGoogleEvents([]));
  }, [modalType, modalRdvCommercialId, modalDate]);

  // Internal RDV conflicts
  const modalRdvConflicts = modalType === 'RDV_PLANIFIE' && modalRdvCommercialId && modalDate && modalRdvHeureDebut && modalRdvHeureFin
    ? detectConflicts(state.appointments, modalRdvCommercialId, modalDate, modalRdvHeureDebut, modalRdvHeureFin)
    : [];

  // Google Calendar conflicts
  const modalGoogleConflicts = modalType === 'RDV_PLANIFIE' && modalDate && modalRdvHeureDebut && modalRdvHeureFin
    ? modalGoogleEvents.filter(evt => {
        if (evt.allDay) return true;
        const evtStart = evt.start.includes('T') ? evt.start.substring(11, 16) : '';
        const evtEnd = evt.end.includes('T') ? evt.end.substring(11, 16) : '';
        if (!evtStart || !evtEnd) return false;
        return modalRdvHeureDebut < evtEnd && evtStart < modalRdvHeureFin;
      })
    : [];

  const submitInteraction = async () => {
    if (!modalClient || !modalComment.trim()) return;
    setModalSubmitting(true);
    try {
      const now = new Date().toISOString();
      const token = localStorage.getItem('suivipro_token');
      const interaction = {
        id: generateId('int'),
        client_id: modalClient.id,
        commercial_id: state.currentUser?.id || '',
        type: modalType,
        date: modalType === 'RDV_PLANIFIE' && modalDate ? new Date(modalDate).toISOString() : now,
        comment: modalComment.trim(),
        date_creation: now,
      };
      dispatch({ type: 'ADD_INTERACTION', payload: interaction });

      // Save client notes if changed
      const full = getClient(modalClient.id);
      if (full && modalClientNotes !== (full.notes || '')) {
        const updated: Client = { ...full, notes: modalClientNotes, date_modification: now };
        await fetch(`/api/clients/${modalClient.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(updated),
        });
        dispatch({ type: 'UPDATE_CLIENT', payload: updated });
      }

      // For RDV_PLANIFIE, also create an appointment
      if (modalType === 'RDV_PLANIFIE' && modalDate) {
        const rdvId = generateId('rdv');
        dispatch({
          type: 'ADD_APPOINTMENT',
          payload: {
            id: rdvId,
            prospect_id: '',
            client_id: modalClient.id,
            commercial_id: modalRdvCommercialId || state.currentUser?.id || '',
            prospecteur_id: state.currentUser?.id || '',
            date: modalDate,
            heure_debut: modalRdvHeureDebut,
            heure_fin: modalRdvHeureFin,
            lieu: modalRdvLieu,
            notes: [modalRdvNotes, modalComment.trim()].filter(Boolean).join('\n'),
            statut: 'planifie',
            created_at: now,
          },
        });
        toast.success('RDV planifie');
        setModalCreatedRdvId(rdvId);
        setModalShowConfirmation(true);
        loadData(weekOffset, viewMode);
        return;
      }

      toast.success(modalType === 'VISITE' ? 'Visite enregistree' : 'Appel enregistre');
      resetModal();
      loadData(weekOffset, viewMode);
    } catch {
      toast.error('Erreur');
    } finally {
      setModalSubmitting(false);
    }
  };

  const openEditClient = (vc: VisitClient) => {
    const full = getClient(vc.id);
    if (full) {
      setEditClient(full);
      setEditForm({
        nom: full.nom || '', contact: full.contact || '', telephone: full.telephone || '',
        telephone_mobile: full.telephone_mobile || '', email: full.email || '',
        ville: full.ville || '', adresse: full.adresse || '', notes: full.notes || '',
      });
    }
  };

  const saveEditClient = () => {
    if (!editClient) return;
    const updated: Client = {
      ...editClient,
      ...editForm,
      date_modification: new Date().toISOString(),
    };
    dispatch({ type: 'UPDATE_CLIENT', payload: updated });
    toast.success('Client mis a jour');
    setEditClient(null);
    loadData(weekOffset, viewMode);
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

  const isAdmin = state.currentUser?.role === 'admin';
  const isProspection = state.currentUser?.role === 'prospection';
  const token = localStorage.getItem('suivipro_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const loadData = useCallback(async (offset: number, mode: string) => {
    setLoading(true);
    try {
      let url = `/api/commercial/visites?week_offset=${offset}`;
      if (mode === 'all') {
        url += '&view=all';
      } else if (mode !== 'me') {
        url += `&commercial_id=${mode}`;
      }
      const res = await fetch(url, { headers });
      if (res.ok) {
        const d: VisitesData = await res.json();
        setData(d);

        // Skip overwriting expanded state when restoring from saved state
        if (restoredRef.current) {
          restoredRef.current = false;
          // Restore scroll position after render
          if (pendingScrollRef.current) {
            const scrollTop = pendingScrollRef.current;
            pendingScrollRef.current = null;
            requestAnimationFrame(() => {
              setTimeout(() => window.scrollTo(0, scrollTop), 50);
            });
          }
        } else if (d.view === 'single') {
          const expanded = new Set<string>();
          d.week_days.forEach(wd => {
            if (wd.is_today) expanded.add(wd.day_key);
          });
          setExpandedDays(expanded);
        } else {
          // Expand all commercials by default
          setExpandedCommercials(new Set(d.commerciaux.map(c => c.commercial.id)));
        }
      } else {
        toast.error('Erreur chargement des visites');
      }
    } catch {
      toast.error('Erreur reseau');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(weekOffset, viewMode); }, [weekOffset, viewMode, loadData]);

  const toggleDay = (key: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleCommercial = (id: string) => {
    setExpandedCommercials(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const daysUntil = (dateStr: string) => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const d = new Date(dateStr);
    return Math.ceil((d.getTime() - now.getTime()) / 86400000);
  };

  // Distribute late clients into week days based on their zone/tournee
  const getWeekDaysWithLate = (weekDays: WeekDay[], lateClients: VisitClient[]): (WeekDay & { lateClients: VisitClient[] })[] => {
    // Build a map: zone -> day index (first day that has this zone)
    const zoneToDayIdx = new Map<string, number>();
    weekDays.forEach((day, idx) => {
      day.tournees.forEach(t => {
        if (!zoneToDayIdx.has(t)) zoneToDayIdx.set(t, idx);
      });
    });

    // Initialize enriched days
    const enriched = weekDays.map(day => ({ ...day, lateClients: [] as VisitClient[] }));

    // Distribute late clients
    const unassigned: VisitClient[] = [];
    lateClients.forEach(client => {
      const dayIdx = zoneToDayIdx.get(client.tournee);
      if (dayIdx !== undefined) {
        enriched[dayIdx].lateClients.push(client);
      } else {
        unassigned.push(client);
      }
    });

    // If some clients have no matching zone day, put them on the first day with clients or first day
    if (unassigned.length > 0) {
      const targetIdx = enriched.findIndex(d => d.is_today) >= 0 ? enriched.findIndex(d => d.is_today) : 0;
      if (enriched[targetIdx]) {
        enriched[targetIdx].lateClients.push(...unassigned);
      }
    }

    return enriched;
  };

  const formatShortDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };

  const formatWeekRange = (weekStart: string) => {
    const start = new Date(weekStart);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    return `${start.toLocaleDateString('fr-FR', opts)} - ${end.toLocaleDateString('fr-FR', opts)}`;
  };

  const isCurrentWeek = weekOffset === 0;

  const renderClient = (client: VisitClient, showVisitInfo = false) => {
    const now = new Date();
    const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const isLate = client.next_visit && client.next_visit < todayLocal;
    const daysLate = isLate ? Math.abs(daysUntil(client.next_visit)) : 0;
    const gmapsUrl = client.latitude && client.longitude
      ? `https://www.google.com/maps/dir/?api=1&destination=${client.latitude},${client.longitude}`
      : client.adresse
        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(client.adresse + (client.ville ? ', ' + client.ville : ''))}`
        : null;

    return (
      <div
        key={client.id}
        className={`p-3 rounded-lg border transition-colors ${
          isLate ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200 hover:border-gray-300'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className={`w-4 h-4 flex-shrink-0 ${isLate ? 'text-red-500' : 'text-brewery-600'}`} />
              <Link
                to={`/clients?id=${client.id}`}
                onClick={saveState}
                className="font-semibold text-sm truncate text-brewery-700 hover:text-brewery-900 hover:underline"
              >
                {client.nom}
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
              <span>{CLIENT_TYPE_LABELS[client.type_client as keyof typeof CLIENT_TYPE_LABELS] || client.type_client}</span>
              {client.tournee && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded font-medium">
                  <MapPin className="w-3 h-3" />{client.tournee}
                </span>
              )}
              {client.ville && <span className="text-gray-400">{client.ville}</span>}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs">
              {(client.telephone_mobile || client.telephone) && (
                <a href={`tel:${client.telephone_mobile || client.telephone}`} className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                  <Phone className="w-3 h-3" />{client.telephone_mobile || client.telephone}
                </a>
              )}
              {client.contact && <span className="text-gray-500">{client.contact}</span>}
            </div>
            {showVisitInfo && client.next_visit && (
              <div className="mt-1.5 flex items-center gap-1 text-xs">
                {isLate ? (
                  <span className="text-red-600 font-medium flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    En retard de {daysLate}j (prevu le {formatShortDate(client.next_visit)})
                  </span>
                ) : (
                  <span className="text-gray-500 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />Prochaine: {formatShortDate(client.next_visit)}
                  </span>
                )}
              </div>
            )}
            {client.last_visit && (
              <div className="mt-0.5 text-[10px] text-gray-400">Derniere visite: {formatShortDate(client.last_visit)}</div>
            )}
            {/* Client notes snippet */}
            {(() => {
              const fullC = getClient(client.id);
              return fullC?.notes ? (
                <div className="mt-1.5 px-2 py-1.5 bg-yellow-50 rounded border border-yellow-100">
                  <p className="text-[10px] text-yellow-700 truncate">{fullC.notes}</p>
                </div>
              ) : null;
            })()}
          </div>
        </div>
        {/* Quick actions - horizontal */}
        <div className="flex items-center gap-3 sm:gap-1.5 mt-2">
          {(client.telephone_mobile || client.telephone) && (
            <button
              onClick={e => { e.stopPropagation(); openInteractionModal(client, 'APPEL'); }}
              className="px-3 py-1.5 sm:p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
              title="Appeler et enregistrer"
            >
              <Phone className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => openInteractionModal(client, 'VISITE')}
            className="px-3 py-1.5 sm:p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
            title="Marquer une visite"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => openInteractionModal(client, 'RDV_PLANIFIE')}
            className="px-3 py-1.5 sm:p-1.5 rounded-lg bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors"
            title="Planifier un RDV"
          >
            <Calendar className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => openQuickNote(client.id)}
            className="px-3 py-1.5 sm:p-1.5 rounded-lg bg-yellow-50 text-yellow-600 hover:bg-yellow-100 transition-colors"
            title="Ajouter une note"
          >
            <StickyNote className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => openEditClient(client)}
            className="px-3 py-1.5 sm:p-1.5 rounded-lg bg-gray-50 text-gray-500 hover:bg-gray-100 transition-colors"
            title="Modifier le client"
          >
            <Edit2 className="w-3.5 h-3.5" />
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

  const renderWeekDays = (weekDays: WeekDay[], lateClients: VisitClient[], keyPrefix = '') => {
    const enrichedDays = getWeekDaysWithLate(weekDays, lateClients);
    return (
      <div className="space-y-2">
        {enrichedDays.map(day => {
          const expandKey = keyPrefix + day.day_key;
          const isExpanded = expandedDays.has(expandKey);
          const isPast = day.is_past && !day.is_today;
          const totalClients = day.clients.length + day.lateClients.length;
          const lateCount = day.lateClients.length;
          return (
            <div key={expandKey} className={`rounded-xl border overflow-hidden transition-shadow ${
              day.is_today ? 'border-brewery-300 bg-brewery-50/30 shadow-sm' : 'border-gray-200 bg-white'
            }`}>
              <button
                onClick={() => {
                  setExpandedDays(prev => {
                    const next = new Set(prev);
                    if (next.has(expandKey)) next.delete(expandKey); else next.add(expandKey);
                    return next;
                  });
                }}
                className="w-full flex items-center justify-between px-3 sm:px-4 py-2.5 text-left hover:bg-gray-50/50 transition-colors"
              >
                <div className="flex items-center gap-2 sm:gap-3">
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold text-sm ${day.is_today ? 'text-brewery-700' : 'text-gray-900'}`}>{day.day_name}</span>
                      <span className="text-xs text-gray-400">{formatShortDate(day.date)}</span>
                      {day.is_today && <span className="px-1.5 py-0.5 bg-brewery-600 text-white text-[10px] rounded-full font-medium">Aujourd'hui</span>}
                    </div>
                    {day.tournees.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {day.tournees.map((t, i) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded font-medium">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {lateCount > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">
                      {lateCount} en retard
                    </span>
                  )}
                  {totalClients > 0 ? (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${day.is_today ? 'bg-brewery-100 text-brewery-700' : 'bg-gray-100 text-gray-600'}`}>
                      {day.clients.length} visite{day.clients.length > 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">Aucune visite</span>
                  )}
                  {isPast && day.clients.length > 0 && <CheckCircle2 className="w-4 h-4 text-green-400" />}
                </div>
              </button>
              {isExpanded && totalClients > 0 && (
                <div className="px-3 sm:px-4 pb-3 sm:pb-4 space-y-2">
                  {day.lateClients.length > 0 && (
                    <>
                      {day.lateClients.sort((a, b) => (a.next_visit || '').localeCompare(b.next_visit || '')).map(client => renderClient(client, true))}
                      {day.clients.length > 0 && <hr className="border-gray-200 my-1" />}
                    </>
                  )}
                  {day.clients.map(client => renderClient(client))}
                </div>
              )}
              {isExpanded && totalClients === 0 && (
                <div className="px-4 pb-3">
                  <p className="text-sm text-gray-400 italic">
                    {day.tournees.length > 0 ? 'Aucun client sur ces tournees' : 'Pas de tournee configuree'}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };


  // Compute stats from data
  const getStats = () => {
    if (!data) return { totalClients: 0, weekVisits: 0, todayVisits: 0, lateCount: 0 };
    if (data.view === 'single') {
      const todayDay = data.week_days.find(d => d.is_today);
      return {
        totalClients: data.total_active_clients,
        weekVisits: data.week_days.reduce((s, d) => s + d.clients.length, 0),
        todayVisits: todayDay?.clients.length || 0,
        lateCount: data.late_clients.length,
      };
    }
    // all view
    let weekVisits = 0, todayVisits = 0, totalClients = 0;
    data.commerciaux.forEach(c => {
      totalClients += c.total_active_clients;
      c.week_days.forEach(d => {
        weekVisits += d.clients.length;
        if (d.is_today) todayVisits += d.clients.length;
      });
    });
    return { totalClients, weekVisits, todayVisits, lateCount: data.total_late };
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Chargement...</span>
      </div>
    );
  }

  if (!data) return null;

  const stats = getStats();

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 fade-in max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 sm:w-6 sm:h-6" />
            Visites Clients
          </h1>
          {data.view === 'single' && !(data as VisitesDataSingle).tournee_active && (
            <p className="text-xs text-amber-600 font-medium mt-0.5">
              Tournee inactive cette semaine ({(data as VisitesDataSingle).week_pattern === 'even' ? 'semaines paires' : 'semaines impaires'})
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => loadData(weekOffset, viewMode)} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* View selector (admin / prospection can see all) */}
      {(isAdmin || isProspection) && (
        <div className="bg-white rounded-xl border border-gray-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-500 mr-1">
              <User className="w-3.5 h-3.5 inline mr-1" />Vue:
            </span>
            <button
              onClick={() => setViewMode('me')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                viewMode === 'me' ? 'bg-brewery-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Mes visites
            </button>
            <button
              onClick={() => setViewMode('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${
                viewMode === 'all' ? 'bg-brewery-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Users className="w-3.5 h-3.5" /> Toute l'equipe
            </button>
            <div className="h-4 w-px bg-gray-200 mx-1 hidden sm:block" />
            {state.commerciaux
              .filter(c => c.role !== 'prospection')
              .map(c => (
                <button
                  key={c.id}
                  onClick={() => setViewMode(c.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    viewMode === c.id ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {c.prenom}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Week navigator */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 flex items-center justify-between gap-2">
        <button onClick={() => setWeekOffset(prev => prev - 1)}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors" title="Semaine precedente">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 text-center">
          <div className="flex items-center justify-center gap-2">
            <p className="font-semibold text-gray-900 text-sm sm:text-base">Semaine {data.week_number}</p>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
              {data.is_even_week ? 'paire' : 'impaire'}
            </span>
            {isCurrentWeek && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brewery-100 text-brewery-700 font-medium">Cette semaine</span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{formatWeekRange(data.week_start)}</p>
        </div>
        <button onClick={() => setWeekOffset(prev => prev + 1)}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors" title="Semaine suivante">
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>

      {!isCurrentWeek && (
        <button onClick={() => setWeekOffset(0)}
          className="w-full py-2 text-sm font-medium text-brewery-600 bg-brewery-50 hover:bg-brewery-100 rounded-lg border border-brewery-200 transition-colors flex items-center justify-center gap-2">
          <ChevronLeft className="w-4 h-4" /> Revenir a la semaine en cours
        </button>
      )}

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-2xl font-bold text-brewery-600">{stats.totalClients}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">Clients actifs</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-2xl font-bold text-indigo-600">{stats.weekVisits}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">Visites cette semaine</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{stats.todayVisits}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">Visites aujourd'hui</p>
        </div>
        <div className={`rounded-xl border p-3 text-center ${stats.lateCount > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
          <p className={`text-2xl font-bold ${stats.lateCount > 0 ? 'text-red-600' : 'text-gray-400'}`}>{stats.lateCount}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">En retard</p>
        </div>
      </div>

      {/* Single commercial view */}
      {data.view === 'single' && (
        <>
          {renderWeekDays((data as VisitesDataSingle).week_days, (data as VisitesDataSingle).late_clients)}
        </>
      )}

      {/* All commercials view */}
      {data.view === 'all' && (
        <div className="space-y-4">
          {(data as VisitesDataAll).commerciaux.map(comData => {
            const isExpanded = expandedCommercials.has(comData.commercial.id);
            const weekVisits = comData.week_days.reduce((s, d) => s + d.clients.length, 0);

            return (
              <div key={comData.commercial.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <button
                  onClick={() => toggleCommercial(comData.commercial.id)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center ${
                      comData.commercial.role === 'admin' ? 'bg-amber-100' : 'bg-indigo-100'
                    }`}>
                      <User className={`w-4 h-4 ${comData.commercial.role === 'admin' ? 'text-amber-700' : 'text-indigo-700'}`} />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">
                        {comData.commercial.prenom} {comData.commercial.nom}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {comData.total_active_clients} clients actifs
                        {!comData.tournee_active && ' — Tournee inactive cette semaine'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {comData.late_clients.length > 0 && (
                      <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-medium">
                        {comData.late_clients.length} en retard
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      weekVisits > 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {weekVisits} visite{weekVisits > 1 ? 's' : ''}
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3">
                    {renderWeekDays(comData.week_days, comData.late_clients, comData.commercial.id + '-')}
                  </div>
                )}
              </div>
            );
          })}

          {(data as VisitesDataAll).commerciaux.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-sm text-gray-500">Aucun commercial</p>
            </div>
          )}
        </div>
      )}
      {/* Interaction Modal (Visite / Appel / RDV) */}
      {modalClient && (
        <div className="modal-backdrop" onClick={() => resetModal()}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {/* RDV Confirmation Screen */}
            {modalShowConfirmation ? (() => {
              const createdRdv = state.appointments.find(a => a.id === modalCreatedRdvId);
              const rdvCommercial = state.commerciaux.find(c => c.id === (createdRdv?.commercial_id || modalRdvCommercialId));
              const fullClient = getClient(modalClient.id);
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
                      {modalClient.nom} - {formatDate(createdRdv?.date || '')}
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
                          const isCurrent = rdv.id === modalCreatedRdvId;
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
                    {createdRdv && fullClient && (
                      <button
                        className="flex-1 px-4 py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 font-medium"
                        onClick={() => downloadICSClient(createdRdv, fullClient)}
                      >
                        <CalendarPlus className="w-4 h-4" /> Ajouter a l'agenda
                      </button>
                    )}
                    <button
                      className="flex-1 px-4 py-2.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"
                      onClick={() => resetModal()}
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
                      {modalType === 'VISITE' ? 'Marquer une visite' : modalType === 'APPEL' ? 'Marquer un appel' : 'Planifier un RDV'}
                    </h2>
                    <p className="text-sm text-gray-500 mt-0.5">{modalClient.nom}</p>
                  </div>
                  <button onClick={() => resetModal()} className="p-1.5 hover:bg-gray-100 rounded-lg">
                    <X className="w-4 h-4 text-gray-400" />
                  </button>
                </div>
                {/* Editable client notes */}
                <div className="mx-5 mt-3 p-2.5 bg-yellow-50 rounded-lg border border-yellow-200">
                  <label className="text-[10px] font-semibold text-yellow-800 mb-1 block">Notes client</label>
                  <textarea
                    value={modalClientNotes}
                    onChange={e => setModalClientNotes(e.target.value)}
                    placeholder="Notes sur le client..."
                    className="w-full text-xs bg-white border border-yellow-300 rounded-lg px-2.5 py-1.5 resize-none h-16 focus:ring-2 focus:ring-yellow-300 focus:border-yellow-400"
                  />
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
                    <div className="flex gap-2">
                      {(['VISITE', 'APPEL', 'RDV_PLANIFIE'] as InteractionType[]).map(type => (
                        <button
                          key={type}
                          onClick={() => setModalType(type)}
                          className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${
                            modalType === type
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
                  {modalType === 'RDV_PLANIFIE' && (
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
                          value={modalRdvCommercialId}
                          onChange={e => setModalRdvCommercialId(e.target.value)}
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
                            value={modalDate}
                            onChange={e => setModalDate(e.target.value)}
                          />
                        </div>
                        <div className="w-20">
                          <label className="block text-[10px] text-purple-600 mb-0.5">Debut</label>
                          <input
                            type="time"
                            className="w-full px-2 py-1.5 border border-purple-200 rounded-lg text-xs bg-white"
                            value={modalRdvHeureDebut}
                            onChange={e => setModalRdvHeureDebut(e.target.value)}
                          />
                        </div>
                        <div className="w-20">
                          <label className="block text-[10px] text-purple-600 mb-0.5">Fin</label>
                          <input
                            type="time"
                            className="w-full px-2 py-1.5 border border-purple-200 rounded-lg text-xs bg-white"
                            value={modalRdvHeureFin}
                            onChange={e => setModalRdvHeureFin(e.target.value)}
                          />
                        </div>
                      </div>

                      {/* Internal RDV conflicts */}
                      {modalRdvConflicts.length > 0 && (
                        <div className="p-2 bg-red-50 border border-red-200 rounded-lg">
                          <p className="text-[11px] text-red-700 font-medium flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" /> Conflit horaire !
                          </p>
                          {modalRdvConflicts.map(c => {
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
                      {modalGoogleConflicts.length > 0 && (
                        <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg">
                          <p className="text-[11px] text-amber-700 font-medium flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" /> Attention — evenement(s) Google Agenda sur ce creneau
                          </p>
                          {modalGoogleConflicts.map(evt => {
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
                        value={modalRdvLieu}
                        onChange={e => setModalRdvLieu(e.target.value)}
                      />

                      {/* Notes RDV */}
                      <input
                        type="text"
                        className="w-full px-3 py-2 border border-purple-200 rounded-lg text-sm bg-white"
                        placeholder="Notes du RDV (optionnel)..."
                        value={modalRdvNotes}
                        onChange={e => setModalRdvNotes(e.target.value)}
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Commentaire <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={modalComment}
                      onChange={e => setModalComment(e.target.value)}
                      className={`w-full border rounded-lg px-3 py-2 text-sm ${!modalComment.trim() ? 'border-red-300 focus:ring-red-200' : 'border-gray-200'}`}
                      rows={3}
                      placeholder="Notes sur cette interaction... (obligatoire)"
                    />
                    {!modalComment.trim() && (
                      <p className="text-[10px] text-red-500 mt-1">Le commentaire est obligatoire</p>
                    )}
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button onClick={() => resetModal()} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                      Annuler
                    </button>
                    <button
                      onClick={submitInteraction}
                      disabled={!modalComment.trim() || modalSubmitting || (modalType === 'RDV_PLANIFIE' && !modalDate)}
                      className={`flex items-center gap-1.5 px-4 py-2 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        modalType === 'VISITE' ? 'bg-green-600 hover:bg-green-700'
                          : modalType === 'APPEL' ? 'bg-blue-600 hover:bg-blue-700'
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

      {/* Edit Client Modal */}
      {editClient && (
        <div className="modal-backdrop" onClick={() => setEditClient(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl z-10">
              <h2 className="text-lg font-bold text-gray-900">Modifier le client</h2>
              <button onClick={() => setEditClient(null)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {[
                { key: 'nom', label: 'Nom', type: 'text' },
                { key: 'contact', label: 'Contact (prenom nom)', type: 'text' },
                { key: 'telephone', label: 'Telephone fixe', type: 'tel' },
                { key: 'telephone_mobile', label: 'Telephone mobile', type: 'tel' },
                { key: 'email', label: 'Email', type: 'email' },
                { key: 'ville', label: 'Ville', type: 'text' },
                { key: 'adresse', label: 'Adresse', type: 'text' },
              ].map(({ key, label, type }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
                  <input
                    type={type}
                    value={(editForm as Record<string, string>)[key] || ''}
                    onChange={e => setEditForm(prev => ({ ...prev, [key]: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={editForm.notes}
                  onChange={e => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setEditClient(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                  Annuler
                </button>
                <button
                  onClick={saveEditClient}
                  className="flex items-center gap-1.5 px-4 py-2 bg-brewery-600 text-white rounded-lg text-sm font-medium hover:bg-brewery-700"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick note modal */}
      {noteClientId && (
        <div className="modal-backdrop" onClick={() => setNoteClientId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <StickyNote className="w-4 h-4 text-yellow-500" />
                Note - {getClient(noteClientId)?.nom || ''}
              </h3>
              <button onClick={() => setNoteClientId(null)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-yellow-300 focus:border-yellow-300"
                rows={4}
                placeholder="Ajouter une note sur ce client..."
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setNoteClientId(null)} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                  Annuler
                </button>
                <button
                  onClick={saveQuickNote}
                  disabled={noteSaving}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500 text-white rounded-lg text-sm font-medium hover:bg-yellow-600 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {noteSaving ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
