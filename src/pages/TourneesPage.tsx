import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  MapPin, Save, Edit2, RefreshCw, ChevronDown, ChevronRight,
  User, Loader2, Info, Calendar, ArrowLeft, ArrowRight, ChevronLeft,
  X, Plus, AlertTriangle, Users2, CheckSquare, Building2,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import { Client } from '../types';
import { apiPut } from '../api/client';

interface TourneeConfig {
  commercial_id: string;
  config: Record<string, string[]>;
  notes: string;
  tournee_info: string;
  week_pattern: string; // 'every' | 'even' | 'odd'
  updated_at: string;
}

interface CommercialInfo {
  id: string;
  prenom: string;
  nom: string;
  role: string;
}

const DAY_LABELS: Record<string, string> = {
  '1': 'Lundi', '2': 'Mardi', '3': 'Mercredi',
  '4': 'Jeudi', '5': 'Vendredi', '6': 'Samedi', '0': 'Dimanche',
};
const DAY_KEYS = ['1', '2', '3', '4', '5', '6', '0'];
const DAY_SHORT: Record<string, string> = {
  '1': 'Lun', '2': 'Mar', '3': 'Mer',
  '4': 'Jeu', '5': 'Ven', '6': 'Sam', '0': 'Dim',
};

const WEEK_PATTERN_LABELS: Record<string, string> = {
  every: 'Chaque semaine',
  even: 'Semaines paires',
  odd: 'Semaines impaires',
};

function ZoneDayPicker({ label, selected, allZones, onAdd, onRemove }: {
  label: string;
  selected: string[];
  allZones: string[];
  onAdd: (zone: string) => void;
  onRemove: (zone: string) => void;
}) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = allZones.filter(z =>
    !selected.includes(z) && z.toLowerCase().includes(input.toLowerCase())
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleAdd = (zone: string) => {
    onAdd(zone);
    setInput('');
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && input.trim()) {
      handleAdd(input.trim());
    }
  };

  return (
    <div ref={ref}>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {/* Selected zones as chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {selected.map(z => (
            <span key={z} className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs font-medium">
              {z}
              <button
                type="button"
                onClick={() => onRemove(z)}
                className="hover:text-indigo-900 ml-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {/* Input + dropdown */}
      <div className="relative">
        <input
          type="text"
          className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
          placeholder="Ajouter une zone..."
          value={input}
          onChange={e => { setInput(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
        {open && (filtered.length > 0 || input.trim()) && (
          <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {filtered.map(zone => (
              <button
                key={zone}
                type="button"
                onMouseDown={() => handleAdd(zone)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-50 text-gray-700 flex items-center gap-1.5"
              >
                <Plus className="w-3 h-3 text-indigo-500 flex-shrink-0" />
                {zone}
              </button>
            ))}
            {input.trim() && !allZones.includes(input.trim()) && !selected.includes(input.trim()) && (
              <button
                type="button"
                onMouseDown={() => handleAdd(input.trim())}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-green-50 text-green-700 flex items-center gap-1.5 border-t border-gray-100"
              >
                <Plus className="w-3 h-3 flex-shrink-0" />
                Créer "{input.trim()}"
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProspectionZonePicker({ entries, allZones, onAdd, onRemove, onSlotsChange }: {
  entries: { zone: string; slots: number }[];
  allZones: string[];
  onAdd: (zone: string) => void;
  onRemove: (zone: string) => void;
  onSlotsChange: (zone: string, slots: number) => void;
}) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selectedZones = entries.map(e => e.zone);
  const filtered = allZones.filter(z =>
    !selectedZones.includes(z) && z.toLowerCase().includes(input.toLowerCase())
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleAdd = (zone: string) => {
    onAdd(zone);
    setInput('');
    setOpen(false);
  };

  return (
    <div ref={ref} className="space-y-2">
      {/* Chips with slot counter */}
      {entries.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {entries.map(({ zone, slots }) => (
            <div key={zone} className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 border border-green-300 rounded-lg text-xs font-medium text-green-800">
              <span className="mr-1">{zone}</span>
              <button
                type="button"
                onClick={() => onSlotsChange(zone, Math.max(1, slots - 1))}
                className="w-4 h-4 flex items-center justify-center rounded hover:bg-green-200 text-green-700 font-bold"
              >
                −
              </button>
              <span className="min-w-[1.5rem] text-center font-bold text-green-900">
                {slots}
              </span>
              <button
                type="button"
                onClick={() => onSlotsChange(zone, slots + 1)}
                className="w-4 h-4 flex items-center justify-center rounded hover:bg-green-200 text-green-700 font-bold"
              >
                +
              </button>
              <span className="text-green-600 text-[10px] ml-0.5">RDV</span>
              <button
                type="button"
                onClick={() => onRemove(zone)}
                className="ml-1 hover:text-red-600 text-green-600"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {/* Input + dropdown */}
      <div className="relative">
        <input
          type="text"
          className="w-full px-2.5 py-1.5 border border-green-200 bg-white rounded-lg text-xs focus:ring-2 focus:ring-green-400 focus:border-green-400"
          placeholder="Ajouter un secteur..."
          value={input}
          onChange={e => { setInput(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => { if (e.key === 'Enter' && input.trim()) handleAdd(input.trim()); }}
        />
        {open && (filtered.length > 0 || input.trim()) && (
          <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {filtered.map(zone => (
              <button
                key={zone}
                type="button"
                onMouseDown={() => handleAdd(zone)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-green-50 text-gray-700 flex items-center gap-1.5"
              >
                <Plus className="w-3 h-3 text-green-500 flex-shrink-0" />
                {zone}
              </button>
            ))}
            {input.trim() && !allZones.includes(input.trim()) && !selectedZones.includes(input.trim()) && (
              <button
                type="button"
                onMouseDown={() => handleAdd(input.trim())}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-green-50 text-green-700 flex items-center gap-1.5 border-t border-gray-100"
              >
                <Plus className="w-3 h-3 flex-shrink-0" />
                Créer "{input.trim()}"
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TourneesPage() {
  const { state, dispatch, dispatchLocal } = useApp();
  const toast = useToast();
  const [configs, setConfigs] = useState<TourneeConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editConfig, setEditConfig] = useState<Record<string, string[]>>({});
  const [editNotes, setEditNotes] = useState('');
  const [editInfo, setEditInfo] = useState('');
  const [editWeekPattern, setEditWeekPattern] = useState('every');
  const [saving, setSaving] = useState(false);
  const [expandedCommercials, setExpandedCommercials] = useState<Set<string>>(new Set());
  const [weekOffset, setWeekOffset] = useState(0);
  const [editProspectionZones, setEditProspectionZones] = useState<{ zone: string; slots: number }[]>([]);

  // Unique zones from clients + tournee configs
  const allZones = useMemo(() => {
    const set = new Set<string>();
    state.clients.forEach(c => { if (c.tournee) set.add(c.tournee); });
    // Include zones from all tournee configs
    configs.forEach(tc => {
      const cfg = typeof tc.config === 'string' ? JSON.parse(tc.config) : tc.config;
      if (cfg) Object.values(cfg).forEach((zones: any) => {
        if (Array.isArray(zones)) zones.forEach((z: string) => { if (z && typeof z === 'string') set.add(z); });
      });
    });
    state.tourneeConfigs?.forEach((tc: any) => {
      const cfg = typeof tc.config === 'string' ? JSON.parse(tc.config) : tc.config;
      if (cfg) Object.values(cfg).forEach((zones: any) => {
        if (Array.isArray(zones)) zones.forEach((z: string) => { if (z && typeof z === 'string') set.add(z); });
      });
    });
    return Array.from(set).sort();
  }, [state.clients, configs, state.tourneeConfigs]);

  const token = localStorage.getItem('suivipro_token');
  const isAdmin = state.currentUser?.role === 'admin';
  const currentUserId = state.currentUser?.id;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tournee-config', { headers });
      if (res.ok) {
        const rows = await res.json();
        const parsed = rows.map((r: any) => ({
          ...r,
          config: typeof r.config === 'string' ? JSON.parse(r.config) : r.config,
        }));
        setConfigs(parsed);
        setExpandedCommercials(new Set());
      }
    } catch (err) {
      console.error('Erreur chargement tournees:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const startEdit = () => {
    const myConfig = configs.find(c => c.commercial_id === currentUserId);
    const fullConfig = myConfig?.config || {};
    // Extract prospection zones separately, keep day config clean
    const { prospection: prospZones, ...dayConfig } = fullConfig as any;
    setEditConfig(dayConfig);
    // Support both old string[] format and new { zone, slots }[] format
    const parsed: { zone: string; slots: number }[] = Array.isArray(prospZones)
      ? prospZones.map((p: any) => typeof p === 'string' ? { zone: p, slots: 1 } : p)
      : [];
    setEditProspectionZones(parsed);
    setEditNotes(myConfig?.notes || '');
    setEditInfo(myConfig?.tournee_info || '');
    setEditWeekPattern(myConfig?.week_pattern || 'every');
    setEditing(true);
  };

  const saveMyConfig = async () => {
    if (!currentUserId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tournee-config/${currentUserId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          config: { ...editConfig, ...(editProspectionZones.length > 0 ? { prospection: editProspectionZones } : {}) },
          notes: editNotes,
          tournee_info: editInfo,
          week_pattern: editWeekPattern,
        }),
      });
      if (res.ok) {
        toast.success('Tournees sauvegardees');
        setEditing(false);
        loadData();
      }
    } catch {
      toast.error('Erreur sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const updateDayTournees = (day: string, value: string) => {
    const tournees = value.split(',').map(s => s.trim()).filter(Boolean);
    setEditConfig(prev => ({ ...prev, [day]: tournees }));
  };

  const addZoneToDay = (day: string, zone: string) => {
    const trimmed = zone.trim();
    if (!trimmed) return;
    setEditConfig(prev => {
      const current = prev[day] || [];
      if (current.includes(trimmed)) return prev;
      return { ...prev, [day]: [...current, trimmed] };
    });
  };

  const removeZoneFromDay = (day: string, zone: string) => {
    setEditConfig(prev => ({
      ...prev,
      [day]: (prev[day] || []).filter(z => z !== zone),
    }));
  };

  const toggleCommercial = (id: string) => {
    setExpandedCommercials(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Get week number for target week (current + offset)
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + weekOffset * 7);
  const dayOfWeekT = targetDate.getDay() || 7;
  const targetMonday = new Date(targetDate);
  targetMonday.setDate(targetDate.getDate() - dayOfWeekT + 1);
  const currentWeekNum = Math.ceil(
    (Math.floor((targetMonday.getTime() - new Date(targetMonday.getFullYear(), 0, 1).getTime()) / 86400000) + 1) / 7
  );
  const isEvenWeek = currentWeekNum % 2 === 0;
  const isCurrentWeek = weekOffset === 0;

  // Compute dates for each day of the week (DAY_KEYS: '1'=Mon ... '0'=Sun)
  const weekDates = useMemo(() => {
    const dates: Record<string, string> = {};
    DAY_KEYS.forEach((dayKey) => {
      const offset = dayKey === '0' ? 6 : parseInt(dayKey) - 1;
      const d = new Date(targetMonday);
      d.setDate(targetMonday.getDate() + offset);
      dates[dayKey] = d.toISOString().slice(0, 10);
    });
    return dates;
  }, [targetMonday.getTime()]);

  // Count RDVs per commercial per day of week
  const rdvCountsByCommercialDay = useMemo(() => {
    const counts: Record<string, Record<string, number>> = {};
    const dateToDay: Record<string, string> = {};
    for (const [dayKey, dateStr] of Object.entries(weekDates)) {
      dateToDay[dateStr] = dayKey;
    }
    for (const rdv of state.appointments) {
      if (rdv.statut === 'annule') continue;
      const dayKey = dateToDay[rdv.date];
      if (!dayKey) continue;
      const commId = rdv.commercial_id;
      if (!counts[commId]) counts[commId] = {};
      counts[commId][dayKey] = (counts[commId][dayKey] || 0) + 1;
    }
    return counts;
  }, [state.appointments, weekDates]);

  // Count clients in sectors and visits done per commercial per day
  const sectorStatsByCommercialDay = useMemo(() => {
    const stats: Record<string, Record<string, { totalClients: number; visitsDone: number }>> = {};

    for (const config of configs) {
      const commId = config.commercial_id;
      stats[commId] = {};

      for (const dayKey of DAY_KEYS) {
        const zones = config.config[dayKey] || [];
        if (zones.length === 0) continue;

        const zonesLower = zones.map(z => z.toLowerCase());
        // Count active clients in these sectors assigned to this commercial
        const clientsInSectors = state.clients.filter(
          c => c.commercial_id === commId &&
               c.statut === 'ACTIF' &&
               c.tournee &&
               zonesLower.includes(c.tournee.toLowerCase())
        );
        const totalClients = clientsInSectors.length;

        // Count visits done on this day's date for clients in these sectors
        const dateStr = weekDates[dayKey];
        const clientIds = new Set(clientsInSectors.map(c => c.id));
        const visitsDone = state.interactions.filter(
          i => i.type === 'VISITE' &&
               i.commercial_id === commId &&
               i.date.startsWith(dateStr) &&
               clientIds.has(i.client_id)
        ).length;

        stats[commId][dayKey] = { totalClients, visitsDone };
      }
    }
    return stats;
  }, [configs, state.clients, state.interactions, weekDates]);

  // Zones assigned in at least one commercial's config
  const assignedZones = useMemo(() => {
    const set = new Set<string>();
    for (const config of configs) {
      for (const dayKey of DAY_KEYS) {
        for (const zone of (config.config[dayKey] || [])) {
          set.add(zone.toLowerCase());
        }
      }
    }
    return set;
  }, [configs]);

  // Zones from clients that aren't in any commercial config (filtered by user for non-admins)
  const myClients = useMemo(() => {
    if (isAdmin) return state.clients;
    return state.clients.filter((c: Client) => c.commercial_id === currentUserId);
  }, [state.clients, isAdmin, currentUserId]);

  const unassignedZones = useMemo(() => {
    const myZones = new Set<string>();
    myClients.forEach((c: Client) => { if (c.tournee && c.statut === 'ACTIF') myZones.add(c.tournee); });
    return Array.from(myZones).filter(z => !assignedZones.has(z.toLowerCase())).sort();
  }, [myClients, assignedZones]);

  // Count clients per unassigned zone
  const clientsPerUnassignedZone = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const zone of unassignedZones) {
      counts[zone] = myClients.filter((c: Client) => c.statut === 'ACTIF' && c.tournee === zone).length;
    }
    return counts;
  }, [unassignedZones, myClients]);

  // Clients without any tour (filtered by user for non-admins)
  const clientsWithoutTour = useMemo(() => {
    return myClients.filter((c: Client) => c.statut === 'ACTIF' && (!c.tournee || c.tournee.trim() === ''));
  }, [myClients]);

  // Inactive tours this week that have clients
  const inactiveToursWithClients = useMemo(() => {
    const results: { commercialId: string; commercialName: string; weekPattern: string; zones: string[]; clientCount: number }[] = [];
    for (const config of configs) {
      const weekPattern = config.week_pattern || 'every';
      const isActiveThisWeek = weekPattern === 'every' ||
        (weekPattern === 'even' && isEvenWeek) ||
        (weekPattern === 'odd' && !isEvenWeek);
      if (isActiveThisWeek) continue;

      const zonesSet = new Set<string>();
      for (const dayKey of DAY_KEYS) {
        for (const zone of (config.config[dayKey] || [])) {
          zonesSet.add(zone);
        }
      }
      if (zonesSet.size === 0) continue;

      const zones = Array.from(zonesSet);
      const zonesLower = zones.map(z => z.toLowerCase());
      const clientCount = state.clients.filter(
        (c: Client) => c.statut === 'ACTIF' && c.commercial_id === config.commercial_id &&
          c.tournee && zonesLower.includes(c.tournee.toLowerCase())
      ).length;

      if (clientCount === 0) continue;

      const commercial = state.commerciaux.find((c: any) => c.id === config.commercial_id);
      results.push({
        commercialId: config.commercial_id,
        commercialName: commercial ? `${commercial.prenom} ${commercial.nom}` : 'Inconnu',
        weekPattern,
        zones,
        clientCount,
      });
    }
    return results;
  }, [configs, state.clients, state.commerciaux, isEvenWeek]);

  // Multi-select state for clients without tour
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [assignTournee, setAssignTournee] = useState('');
  const [assigningSaving, setAssigningSaving] = useState(false);
  const [showClientsWithoutTour, setShowClientsWithoutTour] = useState(false);
  const [showUnassignedZones, setShowUnassignedZones] = useState(false);

  const toggleClientSelection = (id: string) => {
    setSelectedClientIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllClientsWithoutTour = () => {
    if (selectedClientIds.size === clientsWithoutTour.length) {
      setSelectedClientIds(new Set());
    } else {
      setSelectedClientIds(new Set(clientsWithoutTour.map(c => c.id)));
    }
  };

  const assignTourneeToSelected = async () => {
    if (!assignTournee.trim() || selectedClientIds.size === 0) return;
    setAssigningSaving(true);
    try {
      const now = new Date().toISOString();
      for (const clientId of selectedClientIds) {
        const client = state.clients.find((c: Client) => c.id === clientId);
        if (!client) continue;
        const updated = { ...client, tournee: assignTournee.trim(), date_modification: now };
        await apiPut(`/clients/${clientId}`, updated);
        dispatchLocal({ type: 'UPDATE_CLIENT', payload: updated });
      }
      toast.success(`${selectedClientIds.size} client(s) affecte(s) a "${assignTournee.trim()}"`);
      setSelectedClientIds(new Set());
      setAssignTournee('');
    } catch {
      toast.error('Erreur lors de l\'affectation');
    } finally {
      setAssigningSaving(false);
    }
  };

  const formatWeekRange = () => {
    const end = new Date(targetMonday);
    end.setDate(targetMonday.getDate() + 6);
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    return `${targetMonday.toLocaleDateString('fr-FR', opts)} - ${end.toLocaleDateString('fr-FR', opts)}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Chargement...</span>
      </div>
    );
  }

  const commercials = state.commerciaux.filter(c => c.role === 'commercial' || c.role === 'admin');
  const prospecteurs = state.commerciaux.filter(c => c.role === 'prospection');
  const isProspection = state.currentUser?.role === 'prospection';

  const renderCommercialCard = (commercial: CommercialInfo, readOnly = false) => {
    const config = configs.find(c => c.commercial_id === commercial.id);
    const hasConfig = config && Object.keys(config.config).some(k => (config.config[k] || []).length > 0);
    const isExpanded = expandedCommercials.has(commercial.id);
    const isMe = commercial.id === currentUserId;
    const weekPattern = config?.week_pattern || 'every';
    const isActiveThisWeek = weekPattern === 'every' ||
      (weekPattern === 'even' && isEvenWeek) ||
      (weekPattern === 'odd' && !isEvenWeek);

    return (
      <div key={commercial.id} className={`bg-white rounded-xl border transition-shadow ${
        isMe ? 'border-brewery-300 shadow-sm' : 'border-gray-200'
      } ${!isActiveThisWeek ? 'opacity-60' : ''}`}>
        <button
          onClick={() => toggleCommercial(commercial.id)}
          className="w-full flex items-center justify-between px-3 sm:px-4 py-3 text-left hover:bg-gray-50 rounded-xl"
        >
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
              commercial.role === 'prospection' ? 'bg-emerald-100' : 'bg-indigo-100'
            }`}>
              <User className={`w-4 h-4 ${commercial.role === 'prospection' ? 'text-emerald-700' : 'text-indigo-700'}`} />
            </div>
            <div className="min-w-0">
              <p className="font-medium text-gray-900 text-sm truncate">
                {commercial.prenom} {commercial.nom}
                {isMe && <span className="text-brewery-600 ml-1">(moi)</span>}
                {readOnly && !isMe && <span className="text-gray-400 ml-1 text-xs">(lecture seule)</span>}
              </p>
              <p className="text-[10px] text-gray-500">
                {WEEK_PATTERN_LABELS[weekPattern]}
                {!isActiveThisWeek && ' — pas cette semaine'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {hasConfig ? (
              <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-medium hidden sm:inline">
                Configure
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full font-medium hidden sm:inline">
                Non configure
              </span>
            )}
          </div>
        </button>

        {isExpanded && (
          <div className="px-3 sm:px-4 pb-3 sm:pb-4">
            {config?.tournee_info && (
              <div className="flex items-start gap-2 p-2 sm:p-3 bg-blue-50 border border-blue-100 rounded-lg mb-3 text-xs sm:text-sm text-blue-800">
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <p>{config.tournee_info}</p>
              </div>
            )}

            {(() => {
              // Build prospection lookup: zone -> slots
              const rawProsp = (config?.config as any)?.prospection;
              const prospMap = new Map<string, number>();
              if (Array.isArray(rawProsp)) {
                rawProsp.forEach((p: any) => {
                  if (typeof p === 'string') prospMap.set(p, 1);
                  else if (p?.zone) prospMap.set(p.zone, p.slots ?? 1);
                });
              }

              const commercialRdvs = rdvCountsByCommercialDay[commercial.id] || {};
              const hasAnyRdv = Object.values(commercialRdvs).some(c => c > 0);

              if (!hasConfig && !hasAnyRdv) return <p className="text-sm text-gray-400 italic py-2">Aucune tournee configuree</p>;

              return (
                <>
                  {/* Mobile: vertical list */}
                  <div className="sm:hidden space-y-1.5">
                    {DAY_KEYS.map(day => {
                      const zones = config?.config[day] || [];
                      const dayRdvCount = rdvCountsByCommercialDay[commercial.id]?.[day] || 0;
                      const daySectorStats = sectorStatsByCommercialDay[commercial.id]?.[day];
                      if (zones.length === 0 && dayRdvCount === 0) return null;
                      const hasProsp = zones.some(z => prospMap.has(z));
                      // Sum prospection slots for zones on this day
                      const totalSlotsForDay = zones.reduce((sum, z) => sum + (prospMap.get(z) || 0), 0);
                      return (
                        <div key={day} className={`flex items-center gap-2 py-1.5 px-2 rounded-lg ${hasProsp ? 'bg-green-50' : zones.length > 0 ? 'bg-indigo-50' : 'bg-blue-50'}`}>
                          <span className="text-xs font-semibold text-gray-600 w-8">{DAY_SHORT[day]}</span>
                          <div className="flex flex-wrap gap-1 flex-1">
                            {zones.map((z, i) => {
                              const slots = prospMap.get(z);
                              return (
                                <span key={i} className={`text-xs px-2 py-0.5 rounded font-medium ${slots ? 'bg-green-100 text-green-800' : 'bg-indigo-100 text-indigo-700'}`}>
                                  {z}{slots ? ` · ${slots} RDV` : ''}
                                </span>
                              );
                            })}
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            {daySectorStats && daySectorStats.totalClients > 0 && (
                              <span className="text-[10px] font-semibold text-orange-700 bg-orange-100 rounded-full px-2 py-0.5">
                                {daySectorStats.visitsDone}/{daySectorStats.totalClients} visites
                              </span>
                            )}
                            {totalSlotsForDay > 0 && (
                              <span className="text-[10px] font-semibold text-green-700 bg-green-100 rounded-full px-2 py-0.5">
                                {totalSlotsForDay} RDV à prendre
                              </span>
                            )}
                            {dayRdvCount > 0 && (
                              <span className="text-[10px] font-semibold text-blue-700 bg-blue-100 rounded-full px-2 py-0.5">
                                {dayRdvCount} RDV pris
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop: grid */}
                  <div className="hidden sm:grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2">
                    {DAY_KEYS.map(day => {
                      const zones = config?.config[day] || [];
                      const hasProsp = zones.some(z => prospMap.has(z));
                      const dayRdvCount = rdvCountsByCommercialDay[commercial.id]?.[day] || 0;
                      const daySectorStats = sectorStatsByCommercialDay[commercial.id]?.[day];
                      // Sum prospection slots for zones on this day
                      const totalSlotsForDay = zones.reduce((sum, z) => sum + (prospMap.get(z) || 0), 0);
                      const cellClass = hasProsp
                        ? 'bg-green-50 border border-green-200'
                        : zones.length > 0
                          ? 'bg-indigo-50 border border-indigo-100'
                          : dayRdvCount > 0
                            ? 'bg-blue-50 border border-blue-100'
                            : 'bg-gray-50 border border-gray-100';
                      return (
                        <div key={day} className={`p-2 rounded-lg text-center ${cellClass}`}>
                          <p className="text-[10px] font-medium text-gray-500 mb-1">{DAY_LABELS[day]}</p>
                          {zones.length > 0 ? (
                            <div className="space-y-0.5">
                              {zones.map((z, i) => {
                                const slots = prospMap.get(z);
                                return (
                                  <div key={i}>
                                    <span className={`block text-xs font-medium ${slots ? 'text-green-700' : 'text-indigo-700'}`}>{z}</span>
                                    {slots && (
                                      <span className="inline-block text-[10px] font-bold text-white bg-green-500 rounded-full px-1.5 leading-4 mt-0.5">
                                        {slots} RDV
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : dayRdvCount === 0 ? (
                            <span className="text-xs text-gray-400">-</span>
                          ) : null}
                          {daySectorStats && daySectorStats.totalClients > 0 && (
                            <div className={`mt-1 ${zones.length > 0 ? 'pt-1 border-t border-gray-200' : ''}`}>
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-orange-700 bg-orange-100 rounded-full px-2 py-0.5">
                                <User className="w-2.5 h-2.5" />
                                {daySectorStats.visitsDone}/{daySectorStats.totalClients} visites
                              </span>
                            </div>
                          )}
                          {totalSlotsForDay > 0 && (
                            <div className="mt-0.5">
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-green-700 bg-green-100 rounded-full px-2 py-0.5">
                                <Calendar className="w-2.5 h-2.5" />
                                {totalSlotsForDay} à prendre
                              </span>
                            </div>
                          )}
                          {dayRdvCount > 0 && (
                            <div className="mt-0.5">
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-700 bg-blue-100 rounded-full px-2 py-0.5">
                                <Calendar className="w-2.5 h-2.5" />
                                {dayRdvCount} pris
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 fade-in max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <MapPin className="w-5 h-5 sm:w-6 sm:h-6" />
            Tournees
          </h1>
        </div>
        <div className="flex gap-2">
          <button onClick={loadData} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            <RefreshCw className="w-4 h-4" />
          </button>
          {!editing && (
            <button
              onClick={startEdit}
              className="px-3 py-2 sm:px-4 bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2 text-sm font-medium"
            >
              <Edit2 className="w-4 h-4" /> Mes tournees
            </button>
          )}
        </div>
      </div>

      {/* Week navigator */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 flex items-center justify-between gap-2">
        <button
          onClick={() => setWeekOffset(prev => prev - 1)}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
          title="Semaine precedente"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex-1 text-center">
          <div className="flex items-center justify-center gap-2">
            <p className="font-semibold text-gray-900 text-sm sm:text-base">
              Semaine {currentWeekNum}
            </p>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
              {isEvenWeek ? 'paire' : 'impaire'}
            </span>
            {isCurrentWeek && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brewery-100 text-brewery-700 font-medium">
                Cette semaine
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {formatWeekRange()}
          </p>
        </div>

        <button
          onClick={() => setWeekOffset(prev => prev + 1)}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
          title="Semaine suivante"
        >
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>

      {!isCurrentWeek && (
        <button
          onClick={() => setWeekOffset(0)}
          className="w-full py-2 text-sm font-medium text-brewery-600 bg-brewery-50 hover:bg-brewery-100 rounded-lg border border-brewery-200 transition-colors flex items-center justify-center gap-2"
        >
          <ChevronLeft className="w-4 h-4" />
          Revenir a la semaine en cours
        </button>
      )}

      {/* My tournée edit form */}
      {editing && (
        <div className="bg-white rounded-xl border-2 border-brewery-300 p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Configurer mes tournees</h3>
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">
                Annuler
              </button>
              <button
                onClick={saveMyConfig}
                disabled={saving}
                className="px-3 py-1.5 text-sm font-medium text-white bg-brewery-600 hover:bg-brewery-700 rounded-lg flex items-center gap-1 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Sauvegarder
              </button>
            </div>
          </div>

          {/* Week pattern */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Frequence</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(WEEK_PATTERN_LABELS).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setEditWeekPattern(key)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    editWeekPattern === key
                      ? 'bg-brewery-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Day config */}
          {allZones.length > 0 && (
            <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
              <p className="text-xs font-medium text-blue-700 mb-2">Zones existantes dans vos clients :</p>
              <div className="flex flex-wrap gap-1.5">
                {allZones.map(zone => (
                  <span key={zone} className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full border border-blue-200 font-medium">
                    {zone}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {DAY_KEYS.map(day => (
              <ZoneDayPicker
                key={day}
                label={DAY_LABELS[day]}
                selected={editConfig[day] || []}
                allZones={allZones}
                onAdd={zone => addZoneToDay(day, zone)}
                onRemove={zone => removeZoneFromDay(day, zone)}
              />
            ))}
          </div>

          {/* Zones prioritaires pour la prospection */}
          <div className="border border-green-200 rounded-xl p-3 bg-green-50">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <label className="text-xs font-semibold text-green-800">
                Zones prioritaires pour la prospection
              </label>
              <span className="text-[10px] text-green-600 font-normal">(visibles par les prospecteurs)</span>
            </div>
            <p className="text-[11px] text-green-700 mb-2.5">
              Indiquez les secteurs ou vous souhaitez que la prospection vous cale des rendez-vous.
            </p>
            <ProspectionZonePicker
              entries={editProspectionZones}
              allZones={allZones}
              onAdd={zone => setEditProspectionZones(prev =>
                prev.find(p => p.zone === zone) ? prev : [...prev, { zone, slots: 1 }]
              )}
              onRemove={zone => setEditProspectionZones(prev => prev.filter(p => p.zone !== zone))}
              onSlotsChange={(zone, slots) => setEditProspectionZones(prev =>
                prev.map(p => p.zone === zone ? { ...p, slots } : p)
              )}
            />
          </div>

          {/* Info tournée (visible par les prospecteurs) */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Info tournee <span className="text-gray-400 font-normal">(visible par toute l'equipe)</span>
            </label>
            <textarea
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              rows={2}
              value={editInfo}
              onChange={e => setEditInfo(e.target.value)}
              placeholder="Ex: Je passe en priorite sur Lyon centre le mardi matin..."
            />
          </div>

          {/* Notes privées */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Notes personnelles <span className="text-gray-400 font-normal">(privees)</span>
            </label>
            <textarea
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              rows={2}
              value={editNotes}
              onChange={e => setEditNotes(e.target.value)}
              placeholder="Notes personnelles..."
            />
          </div>
        </div>
      )}

      {/* Commerciaux section */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-indigo-500" />
          Commerciaux
        </h2>
        {commercials.map(c => renderCommercialCard(c, isProspection))}
        {commercials.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
            <p className="text-sm text-gray-500">Aucun commercial</p>
          </div>
        )}
      </div>

      {/* Prospection section */}
      {prospecteurs.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            Prospection
          </h2>
          {prospecteurs.map(c => renderCommercialCard(c, !isProspection && !isAdmin))}
        </div>
      )}

      {/* Inactive tours warning */}
      {inactiveToursWithClients.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            Tournees inactives cette semaine
          </h2>
          {inactiveToursWithClients.map(item => (
            <div key={item.commercialId} className="bg-amber-50 rounded-xl border border-amber-200 p-3 sm:p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-gray-800">{item.commercialName}</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    {WEEK_PATTERN_LABELS[item.weekPattern]} — pas active cette semaine
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {item.zones.map(z => (
                      <span key={z} className="text-xs px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full font-medium">{z}</span>
                    ))}
                  </div>
                  <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                    <Users2 className="w-3.5 h-3.5" />
                    {item.clientCount} client{item.clientCount > 1 ? 's' : ''} actif{item.clientCount > 1 ? 's' : ''} sur ces tournees
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Unassigned zones */}
      {unassignedZones.length > 0 && (
        <div className="space-y-3">
          <button
            onClick={() => setShowUnassignedZones(v => !v)}
            className="w-full flex items-center gap-2 text-left"
          >
            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showUnassignedZones ? '' : '-rotate-90'}`} />
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              Tournees non affectees
              <span className="text-xs font-normal normal-case text-red-600 bg-red-100 px-2 py-0.5 rounded-full">{unassignedZones.length}</span>
            </h2>
          </button>
          {showUnassignedZones && (
            <div className="bg-red-50 rounded-xl border border-red-200 p-3 sm:p-4">
              <p className="text-xs text-red-700 mb-3">Ces zones existent sur des clients mais ne sont configurees dans aucune tournee de commercial.</p>
              <div className="flex flex-wrap gap-2">
                {unassignedZones.map(zone => (
                  <div key={zone} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-red-200 rounded-lg">
                    <MapPin className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-sm font-medium text-gray-800">{zone}</span>
                    <span className="text-xs text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full font-medium">
                      {clientsPerUnassignedZone[zone] || 0} client{(clientsPerUnassignedZone[zone] || 0) > 1 ? 's' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Clients without tour */}
      {clientsWithoutTour.length > 0 && (
        <div className="space-y-3">
          <button
            onClick={() => setShowClientsWithoutTour(v => !v)}
            className="w-full flex items-center gap-2 text-left"
          >
            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showClientsWithoutTour ? '' : '-rotate-90'}`} />
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-orange-500" />
              Clients sans tournee
              <span className="text-xs font-normal normal-case text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full">{clientsWithoutTour.length}</span>
            </h2>
          </button>
          {showClientsWithoutTour && (
            <div className="bg-white rounded-xl border border-orange-200 p-3 sm:p-4 space-y-3">
              {/* Batch assign bar */}
              <div className="flex flex-wrap items-center gap-2 p-3 bg-orange-50 rounded-lg border border-orange-100">
                <button
                  onClick={selectAllClientsWithoutTour}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    selectedClientIds.size === clientsWithoutTour.length
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                  {selectedClientIds.size === clientsWithoutTour.length ? 'Tout deselectionner' : 'Tout selectionner'}
                </button>
                {selectedClientIds.size > 0 && (
                  <>
                    <span className="text-xs text-gray-500">{selectedClientIds.size} selectionne{selectedClientIds.size > 1 ? 's' : ''}</span>
                    <div className="flex items-center gap-2 ml-auto">
                      <select
                        value={assignTournee}
                        onChange={e => setAssignTournee(e.target.value)}
                        className="text-sm border border-gray-300 rounded-lg px-2 py-1.5"
                      >
                        <option value="">Choisir une tournee...</option>
                        {allZones.map(z => (
                          <option key={z} value={z}>{z}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={assignTournee}
                        onChange={e => setAssignTournee(e.target.value)}
                        placeholder="Ou saisir..."
                        className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 w-32"
                      />
                      <button
                        onClick={assignTourneeToSelected}
                        disabled={!assignTournee.trim() || assigningSaving}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-brewery-600 text-white rounded-lg text-xs font-medium hover:bg-brewery-700 disabled:opacity-50 transition-colors"
                      >
                        {assigningSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
                        Affecter
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Client list */}
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {clientsWithoutTour.map(client => {
                  const isSelected = selectedClientIds.has(client.id);
                  const commercial = state.commerciaux.find((c: any) => c.id === client.commercial_id);
                  return (
                    <button
                      key={client.id}
                      onClick={() => toggleClientSelection(client.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                        isSelected ? 'bg-indigo-50 border border-indigo-200' : 'hover:bg-gray-50 border border-transparent'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                        isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'
                      }`}>
                        {isSelected && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                      </div>
                      <Building2 className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{client.nom}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {client.ville || 'Pas de ville'}
                          {commercial && <span className="ml-2 text-indigo-600">({commercial.prenom})</span>}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
