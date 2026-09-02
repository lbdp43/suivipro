import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Settings, Users, Target, TrendingUp, Tag, Plus, X, Save, Edit2,
  Trash2, BarChart3, Phone, Calendar, Award, Shield, User, Eye, EyeOff, Key,
  Building2, Link2, RefreshCw, Check, AlertCircle, Loader2, MapPin, Activity, Clock, Search,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import { apiPost, apiPut, apiDelete } from '../api/client';
import { Commercial, Tag as TagType, UserRole, CLIENT_TYPE_LABELS, CLIENT_TYPE_FAMILIES, ClientType, CLIENT_VISIT_FREQUENCIES } from '../types';
import {
  generateId, getCallsThisWeek, getCallsThisMonth, getCallsToday,
  getAppointmentsThisWeek, getAppointmentsThisMonth,
  getResponseRate, getAverageCallDuration, getConversionRate,
  formatDuration,
} from '../utils/helpers';
import { PIPELINE_LABELS, PipelineStage } from '../types';

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'A l\'instant';
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Hier';
  if (days < 7) return `Il y a ${days} jours`;
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function AdminZonePicker({ label, selected, allZones, onAdd, onRemove }: {
  label: string;
  selected: string[];
  allZones: string[];
  onAdd: (zone: string) => void;
  onRemove: (zone: string) => void;
}) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const filtered = allZones.filter(z => !selected.includes(z) && z.toLowerCase().includes(input.toLowerCase()));

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleAdd = (zone: string) => { onAdd(zone); setInput(''); setOpen(false); };

  return (
    <div ref={ref}>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {selected.map(z => (
            <span key={z} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-[10px] font-medium">
              {z}
              <button type="button" onClick={() => onRemove(z)} className="hover:text-indigo-900"><X className="w-2.5 h-2.5" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          type="text"
          className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-brewery-500"
          placeholder="Ajouter une zone..."
          value={input}
          onChange={e => { setInput(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => { if (e.key === 'Enter' && input.trim()) handleAdd(input.trim()); }}
        />
        {open && (filtered.length > 0 || input.trim()) && (
          <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
            {filtered.map(zone => (
              <button key={zone} type="button" onMouseDown={() => handleAdd(zone)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-50 text-gray-700 flex items-center gap-1.5">
                <Plus className="w-3 h-3 text-indigo-500 flex-shrink-0" />{zone}
              </button>
            ))}
            {input.trim() && !allZones.includes(input.trim()) && !selected.includes(input.trim()) && (
              <button type="button" onMouseDown={() => handleAdd(input.trim())}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-green-50 text-green-700 flex items-center gap-1.5 border-t border-gray-100">
                <Plus className="w-3 h-3 flex-shrink-0" />Créer "{input.trim()}"
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { state, dispatch, dispatchLocal } = useApp();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'team' | 'objectives' | 'tags' | 'commercials' | 'easybeer' | 'tournees' | 'activity'>('team');

  // Tag state
  const [showTagForm, setShowTagForm] = useState(false);
  const [editingTag, setEditingTag] = useState<TagType | null>(null);
  const [tagForm, setTagForm] = useState({ nom: '', couleur: '#22c55e' });

  // Objectives state
  const [editingObjectives, setEditingObjectives] = useState<string | null>(null);
  const [objectivesForm, setObjectivesForm] = useState({ appels_semaine: 50, rdv_mois: 10, prospects_mois: 30, taux_conversion: 20 });

  // Team management state
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<Commercial | null>(null);
  const [userForm, setUserForm] = useState({
    prenom: '', nom: '', email: '', telephone: '', role: 'commercial' as UserRole, password: '',
  });
  const [showPassword, setShowPassword] = useState(false);

  // EasyBeer state
  const [ebConfig, setEbConfig] = useState({ username: '', password: '', api_url: 'https://api.easybeer.fr', webhook_secret: '' });
  const [ebAudit, setEbAudit] = useState<{ total: number; suspects: number; a_verifier: number; liens: any[] } | null>(null);
  const [ebAuditLoading, setEbAuditLoading] = useState(false);
  const [ebRelierChoix, setEbRelierChoix] = useState<Record<string, string>>({});
  const [ebConfigLoaded, setEbConfigLoaded] = useState(false);
  const [ebSaving, setEbSaving] = useState(false);
  const [ebTesting, setEbTesting] = useState(false);
  const [ebTestResult, setEbTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [ebPending, setEbPending] = useState<any[]>([]);
  const [ebLoadingPending, setEbLoadingPending] = useState(false);
  const [assignmentRules, setAssignmentRules] = useState<{ id: string; email: string; commercial_id: string }[]>([]);
  const [newRuleEmail, setNewRuleEmail] = useState('');
  const [newRuleCommercial, setNewRuleCommercial] = useState('');
  const [ebImportType, setEbImportType] = useState<ClientType>('BAR_RESTAURANT_GENERAL');
  const [ebImportCommercial, setEbImportCommercial] = useState('');
  const [webhookLogs, setWebhookLogs] = useState<any[]>([]);
  const [orphanCommandes, setOrphanCommandes] = useState<any[]>([]);
  const [assigningCmd, setAssigningCmd] = useState<string | null>(null);
  const [assignCmdClientSearch, setAssignCmdClientSearch] = useState('');
  const [syncingAllCommandes, setSyncingAllCommandes] = useState(false);
  const [syncAllResult, setSyncAllResult] = useState<any>(null);
  const [exploringApi, setExploringApi] = useState(false);
  const [exploreResult, setExploreResult] = useState<any>(null);

  // Tournee config state
  const [tourneeConfigs, setTourneeConfigs] = useState<Record<string, { config: Record<string, string[]>; notes: string; tournee_info: string; week_pattern: string }>>({});
  const [tourneeEditing, setTourneeEditing] = useState<string | null>(null);
  const [tourneeEditConfig, setTourneeEditConfig] = useState<Record<string, string[]>>({});
  const [tourneeEditNotes, setTourneeEditNotes] = useState('');
  const [tourneeEditInfo, setTourneeEditInfo] = useState('');
  const [tourneeEditWeekPattern, setTourneeEditWeekPattern] = useState('every');
  const [tourneeSaving, setTourneeSaving] = useState(false);

  // Recurrence config state
  const [frequencyConfig, setFrequencyConfig] = useState<Record<string, number | null>>({});
  const [frequencyEditing, setFrequencyEditing] = useState(false);
  const [frequencyEditValues, setFrequencyEditValues] = useState<Record<string, string>>({});
  const [frequencySaving, setFrequencySaving] = useState(false);

  // Activity log state
  interface ActivityEntry {
    id: number;
    user_id: string;
    action: string;
    details: string;
    entity_type: string;
    entity_id: string;
    created_at: string;
    prenom: string;
    nom: string;
  }
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityFilter, setActivityFilter] = useState('all');
  const [lastSeenData, setLastSeenData] = useState<{ id: string; prenom: string; nom: string; last_seen: string | null }[]>([]);

  const loadActivityLog = useCallback(async (userId?: string) => {
    setActivityLoading(true);
    try {
      const token = localStorage.getItem('suivipro_token');
      const params = new URLSearchParams({ limit: '200' });
      if (userId && userId !== 'all') params.set('user_id', userId);
      const res = await fetch(`/api/activity-log?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setActivityLog(await res.json());
    } catch (err) {
      console.error('Erreur chargement activite:', err);
    } finally {
      setActivityLoading(false);
    }
  }, []);

  const loadLastSeen = useCallback(async () => {
    try {
      const token = localStorage.getItem('suivipro_token');
      const res = await fetch('/api/commerciaux/last-seen', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setLastSeenData(await res.json());
    } catch (err) {
      console.error('Erreur chargement last-seen:', err);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'activity') {
      loadActivityLog(activityFilter);
      loadLastSeen();
    }
  }, [activeTab, activityFilter, loadActivityLog, loadLastSeen]);

  const DAY_LABELS: Record<string, string> = { '1': 'Lundi', '2': 'Mardi', '3': 'Mercredi', '4': 'Jeudi', '5': 'Vendredi', '6': 'Samedi', '0': 'Dimanche' };
  const DAY_KEYS = ['1', '2', '3', '4', '5', '6', '0'];
  const WEEK_PATTERN_LABELS: Record<string, string> = { every: 'Chaque semaine', even: 'Semaines paires', odd: 'Semaines impaires' };

  const loadTourneeConfigs = useCallback(async () => {
    try {
      const token = localStorage.getItem('suivipro_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/tournee-config', { headers });
      if (res.ok) {
        const rows = await res.json();
        const configs: Record<string, { config: Record<string, string[]>; notes: string; tournee_info: string; week_pattern: string }> = {};
        for (const row of rows) {
          let parsed = {};
          try { parsed = typeof row.config === 'string' ? JSON.parse(row.config) : row.config; } catch { /* ignore */ }
          configs[row.commercial_id] = {
            config: parsed as Record<string, string[]>,
            notes: row.notes || '',
            tournee_info: row.tournee_info || '',
            week_pattern: row.week_pattern || 'every',
          };
        }
        setTourneeConfigs(configs);
      }
    } catch (err) {
      console.error('Erreur chargement tournees:', err);
    }
  }, []);

  const loadFrequencyConfig = useCallback(async () => {
    try {
      const token = localStorage.getItem('suivipro_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/visit-frequency-config', { headers });
      if (res.ok) {
        const rows = await res.json();
        const config: Record<string, number | null> = {};
        for (const row of rows) {
          config[row.type_client] = row.frequency_days;
        }
        setFrequencyConfig(config);
      }
    } catch (err) {
      console.error('Erreur chargement frequences:', err);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'tournees') {
      loadTourneeConfigs();
      loadFrequencyConfig();
    }
  }, [activeTab, loadTourneeConfigs, loadFrequencyConfig]);

  const startEditTournee = (commercialId: string) => {
    const existing = tourneeConfigs[commercialId];
    setTourneeEditing(commercialId);
    setTourneeEditConfig(existing?.config ? { ...existing.config } : {});
    setTourneeEditNotes(existing?.notes || '');
    setTourneeEditInfo(existing?.tournee_info || '');
    setTourneeEditWeekPattern(existing?.week_pattern || 'every');
  };

  const saveTourneeConfig = async (commercialId: string) => {
    setTourneeSaving(true);
    try {
      const token = localStorage.getItem('suivipro_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(`/api/tournee-config/${commercialId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          config: tourneeEditConfig,
          notes: tourneeEditNotes,
          tournee_info: tourneeEditInfo,
          week_pattern: tourneeEditWeekPattern,
        }),
      });
      setTourneeConfigs(prev => ({
        ...prev,
        [commercialId]: {
          config: { ...tourneeEditConfig },
          notes: tourneeEditNotes,
          tournee_info: tourneeEditInfo,
          week_pattern: tourneeEditWeekPattern,
        },
      }));
      setTourneeEditing(null);
      toast.success('Tournees sauvegardees');
    } catch (err) {
      toast.error('Erreur sauvegarde tournees');
    } finally {
      setTourneeSaving(false);
    }
  };

  const updateDayTournees = (day: string, value: string) => {
    const tournees = value.split(',').map(s => s.trim()).filter(Boolean);
    setTourneeEditConfig(prev => ({ ...prev, [day]: tournees }));
  };

  const addZoneToDay = (day: string, zone: string) => {
    const trimmed = zone.trim();
    if (!trimmed) return;
    setTourneeEditConfig(prev => {
      const current = prev[day] || [];
      if (current.includes(trimmed)) return prev;
      return { ...prev, [day]: [...current, trimmed] };
    });
  };

  const removeZoneFromDay = (day: string, zone: string) => {
    setTourneeEditConfig(prev => ({
      ...prev,
      [day]: (prev[day] || []).filter(z => z !== zone),
    }));
  };

  const allZones = useMemo(() => {
    const set = new Set<string>();
    state.clients.forEach(c => { if (c.tournee) set.add(c.tournee); });
    return Array.from(set).sort();
  }, [state.clients]);

  const startEditFrequency = () => {
    const values: Record<string, string> = {};
    for (const type of Object.keys(CLIENT_TYPE_LABELS)) {
      const dbVal = frequencyConfig[type];
      const defaultVal = (CLIENT_VISIT_FREQUENCIES as Record<string, number | null>)[type];
      values[type] = String(dbVal ?? defaultVal ?? '');
    }
    setFrequencyEditValues(values);
    setFrequencyEditing(true);
  };

  const saveFrequencyConfig = async (applyToExisting = false) => {
    setFrequencySaving(true);
    try {
      const token = localStorage.getItem('suivipro_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const frequencies: Record<string, number | null> = {};
      for (const [type, val] of Object.entries(frequencyEditValues)) {
        frequencies[type] = val === '' ? null : parseInt(val, 10);
      }
      await fetch('/api/visit-frequency-config', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ frequencies, apply_to_existing: applyToExisting }),
      });
      setFrequencyConfig(frequencies);
      setFrequencyEditing(false);
      toast.success(applyToExisting ? 'Recurrences sauvegardees et appliquees aux clients existants' : 'Recurrences sauvegardees');
    } catch {
      toast.error('Erreur sauvegarde recurrences');
    } finally {
      setFrequencySaving(false);
    }
  };

  const chargerAuditLiens = async () => {
    setEbAuditLoading(true);
    try {
      const headers = { Authorization: `Bearer ${localStorage.getItem('suivipro_token')}` };
      const res = await fetch('/api/easybeer/audit-liens', { headers });
      if (res.ok) setEbAudit(await res.json());
    } catch { /* silencieux */ }
    setEbAuditLoading(false);
  };

  const delierLienEasybeer = async (easybeerId: string, nom: string) => {
    if (!confirm(`Délier « ${nom} » ? Ses futures commandes partiront en orphelines jusqu'à re-liaison.`)) return;
    const headers = { Authorization: `Bearer ${localStorage.getItem('suivipro_token')}`, 'Content-Type': 'application/json' };
    const res = await fetch(`/api/easybeer/liens/${easybeerId}/delier`, { method: 'POST', headers });
    if (res.ok) { toast.success('Lien supprimé'); chargerAuditLiens(); }
    else toast.error('Échec de la suppression du lien');
  };

  const relierLienEasybeer = async (easybeerId: string) => {
    const clientId = ebRelierChoix[easybeerId];
    if (!clientId) { toast.error('Choisis d\'abord le bon client'); return; }
    const headers = { Authorization: `Bearer ${localStorage.getItem('suivipro_token')}`, 'Content-Type': 'application/json' };
    const res = await fetch(`/api/easybeer/liens/${easybeerId}/relier`, {
      method: 'POST', headers, body: JSON.stringify({ client_id: clientId }),
    });
    if (res.ok) {
      const data = await res.json();
      toast.success(`Relié — ${data.commandes_rattachees} commande(s) orpheline(s) rattachée(s)`);
      chargerAuditLiens();
    } else toast.error('Échec de la liaison');
  };

  const loadEasyBeerData = async () => {
    try {
      const token = localStorage.getItem('suivipro_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const [configRes, pendingRes, rulesRes, logsRes, orphanRes] = await Promise.all([
        fetch('/api/easybeer/config', { headers }),
        fetch('/api/easybeer/pending-clients', { headers }),
        fetch('/api/assignment-rules', { headers }),
        fetch('/api/easybeer/webhook-logs', { headers }),
        fetch('/api/commandes/orphelines', { headers }),
      ]);
      if (configRes.ok) {
        const config = await configRes.json();
        setEbConfig({ username: config.username || '', password: config.password || '', api_url: config.api_url || 'https://api.easybeer.fr', webhook_secret: config.webhook_secret || '' });
      }
      if (pendingRes.ok) setEbPending(await pendingRes.json());
      if (rulesRes.ok) setAssignmentRules(await rulesRes.json());
      if (logsRes.ok) setWebhookLogs(await logsRes.json());
      if (orphanRes.ok) setOrphanCommandes(await orphanRes.json());
      setEbConfigLoaded(true);
    } catch { /* ignore */ }
  };

  const saveEbConfig = async () => {
    setEbSaving(true);
    try {
      const token = localStorage.getItem('suivipro_token');
      await fetch('/api/easybeer/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(ebConfig),
      });
      toast.success('Configuration EasyBeer sauvegardee');
    } catch { toast.error('Erreur de sauvegarde'); }
    setEbSaving(false);
  };

  const testEbConnection = async () => {
    setEbTesting(true);
    setEbTestResult(null);
    try {
      const token = localStorage.getItem('suivipro_token');
      const res = await fetch('/api/easybeer/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(ebConfig),
      });
      const result = await res.json();
      setEbTestResult(result);
    } catch { setEbTestResult({ ok: false, message: 'Erreur reseau' }); }
    setEbTesting(false);
  };

  const importEbClient = async (ebId: number) => {
    try {
      const token = localStorage.getItem('suivipro_token');
      const res = await fetch(`/api/easybeer/pending-clients/${ebId}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ commercial_id: ebImportCommercial || state.currentUser?.id, type_client: ebImportType }),
      });
      if (res.ok) {
        setEbPending(prev => prev.filter(c => c.id !== ebId));
        toast.success('Client importe avec succes');
        // Reload to get new client in state
        window.location.reload();
      }
    } catch { toast.error('Erreur lors de l\'import'); }
  };

  const syncEbClient = async (ebId: number) => {
    try {
      const token = localStorage.getItem('suivipro_token');
      const res = await fetch(`/api/easybeer/pending-clients/${ebId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`Synchronise: ${data.name || 'OK'}`);
        loadEasyBeerData();
      } else {
        toast.error(data.message || 'Echec de la synchronisation');
      }
    } catch { toast.error('Erreur de synchronisation'); }
  };

  const syncAllCommandes = async (force = false) => {
    setSyncingAllCommandes(true);
    setSyncAllResult(null);
    try {
      const token = localStorage.getItem('suivipro_token');
      const res = await fetch('/api/easybeer/sync-all-commandes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      setSyncAllResult(data);
      if (data.ok && data.total_imported > 0) {
        toast.success(`${data.total_imported} commandes importees pour ${data.details?.length || 0} clients`);
        loadEasyBeerData(); // Refresh orphan list
      } else if (data.ok && data.total_imported === 0) {
        toast.success(data.message || 'Aucune nouvelle commande');
      } else {
        toast.error(data.message || 'Erreur');
      }
    } catch { toast.error('Erreur de synchronisation des commandes'); }
    setSyncingAllCommandes(false);
  };

  const exploreEasyBeerApi = async (round = 2) => {
    setExploringApi(true);
    try {
      const token = localStorage.getItem('suivipro_token');
      const res = await fetch('/api/easybeer/explore-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ round }),
      });
      const data = await res.json();
      setExploreResult((prev: any) => {
        if (!prev) return data;
        return { ...data, results: [...(prev.results || []), ...(data.results || [])] };
      });
    } catch { toast.error('Erreur exploration API'); }
    setExploringApi(false);
  };

  const dismissEbClient = async (ebId: number) => {
    try {
      const token = localStorage.getItem('suivipro_token');
      await fetch(`/api/easybeer/pending-clients/${ebId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      setEbPending(prev => prev.filter(c => c.id !== ebId));
    } catch { /* ignore */ }
  };

  const addAssignmentRule = async () => {
    if (!newRuleEmail || !newRuleCommercial) return;
    try {
      const token = localStorage.getItem('suivipro_token');
      const res = await fetch('/api/assignment-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ email: newRuleEmail, commercial_id: newRuleCommercial }),
      });
      if (res.ok) {
        const data = await res.json();
        setAssignmentRules(prev => [...prev, { id: data.id, email: newRuleEmail.toLowerCase(), commercial_id: newRuleCommercial }]);
        setNewRuleEmail('');
        setNewRuleCommercial('');
      }
    } catch { toast.error('Erreur'); }
  };

  const deleteAssignmentRule = async (ruleId: string) => {
    try {
      const token = localStorage.getItem('suivipro_token');
      await fetch(`/api/assignment-rules/${ruleId}`, {
        method: 'DELETE',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      setAssignmentRules(prev => prev.filter(r => r.id !== ruleId));
    } catch { /* ignore */ }
  };

  const tabs = [
    { id: 'team' as const, label: 'Equipe', icon: Users },
    { id: 'objectives' as const, label: 'Objectifs', icon: Target },
    { id: 'tags' as const, label: 'Tags', icon: Tag },
    { id: 'commercials' as const, label: 'Statistiques', icon: BarChart3 },
    { id: 'easybeer' as const, label: 'EasyBeer', icon: Link2 },
    { id: 'tournees' as const, label: 'Tournees', icon: MapPin },
    { id: 'activity' as const, label: 'Activite', icon: Activity },
  ];

  // ============================================
  // Team management
  // ============================================

  const openNewUser = () => {
    setUserForm({ prenom: '', nom: '', email: '', telephone: '', role: 'commercial', password: '' });
    setEditingUser(null);
    setShowUserForm(true);
    setShowPassword(false);
  };

  const openEditUser = (user: Commercial) => {
    setUserForm({
      prenom: user.prenom,
      nom: user.nom,
      email: user.email,
      telephone: user.telephone,
      role: user.role,
      password: '',
    });
    setEditingUser(user);
    setShowUserForm(true);
    setShowPassword(false);
  };

  const saveUser = async () => {
    if (!userForm.prenom || !userForm.email) return;

    try {
      if (editingUser) {
        const updated: Commercial = {
          ...editingUser,
          prenom: userForm.prenom,
          nom: userForm.nom,
          email: userForm.email,
          telephone: userForm.telephone,
          role: userForm.role,
          password: userForm.password || editingUser.password,
        };
        await apiPut(`/commerciaux/${editingUser.id}`, updated);
        dispatchLocal({ type: 'UPDATE_COMMERCIAL', payload: updated });
      } else {
        if (!userForm.password) return;
        const newUser: Commercial = {
          id: generateId('com'),
          prenom: userForm.prenom,
          nom: userForm.nom,
          email: userForm.email,
          telephone: userForm.telephone,
          role: userForm.role,
          password: userForm.password,
          objectifs: { appels_semaine: 50, rdv_mois: 10, prospects_mois: 30, taux_conversion: 20 },
        };
        await apiPost('/commerciaux', newUser);
        dispatchLocal({ type: 'ADD_COMMERCIAL', payload: newUser });
      }
      setShowUserForm(false);
    } catch (error) {
      toast.error('Erreur lors de la sauvegarde de l\'utilisateur.');
    }
  };

  const deleteUser = async (user: Commercial) => {
    if (user.id === state.currentUser?.id) {
      toast.warning('Vous ne pouvez pas supprimer votre propre compte.');
      return;
    }
    const adminCount = state.commerciaux.filter(c => c.role === 'admin').length;
    if (user.role === 'admin' && adminCount <= 1) {
      toast.warning('Impossible de supprimer le dernier administrateur.');
      return;
    }
    if (confirm(`Supprimer ${user.prenom} ${user.nom} ? Cette action est irreversible.`)) {
      try {
        await apiDelete(`/commerciaux/${user.id}`);
        dispatchLocal({ type: 'DELETE_COMMERCIAL', payload: user.id });
      } catch (error) {
        toast.error('Erreur lors de la suppression de l\'utilisateur.');
      }
    }
  };

  // ============================================
  // Objectives
  // ============================================

  const startEditObjectives = (commercial: Commercial) => {
    setEditingObjectives(commercial.id);
    setObjectivesForm({ ...commercial.objectifs });
  };

  const saveObjectives = async () => {
    if (!editingObjectives) return;
    const commercial = state.commerciaux.find(c => c.id === editingObjectives);
    if (commercial) {
      const updated = { ...commercial, objectifs: objectivesForm };
      try {
        await apiPut(`/commerciaux/${commercial.id}`, updated);
        dispatchLocal({
          type: 'UPDATE_COMMERCIAL',
          payload: updated,
        });
        setEditingObjectives(null);
      } catch (error) {
        toast.error('Erreur lors de la sauvegarde des objectifs.');
      }
    }
  };

  // ============================================
  // Tags management
  // ============================================

  const openNewTag = () => {
    setTagForm({ nom: '', couleur: '#22c55e' });
    setEditingTag(null);
    setShowTagForm(true);
  };

  const openEditTag = (tag: TagType) => {
    setTagForm({ nom: tag.nom, couleur: tag.couleur });
    setEditingTag(tag);
    setShowTagForm(true);
  };

  const saveTag = async () => {
    if (!tagForm.nom) return;
    try {
      if (editingTag) {
        const updated = { ...editingTag, ...tagForm };
        await apiPut(`/tags/${editingTag.id}`, updated);
        dispatchLocal({ type: 'UPDATE_TAG', payload: updated });
      } else {
        const newTag = { id: generateId('tag'), ...tagForm };
        await apiPost('/tags', newTag);
        dispatchLocal({ type: 'ADD_TAG', payload: newTag });
      }
      setShowTagForm(false);
    } catch (error) {
      toast.error('Erreur lors de la sauvegarde du tag.');
    }
  };

  const deleteTag = async (id: string) => {
    if (confirm('Supprimer ce tag ?')) {
      try {
        await apiDelete(`/tags/${id}`);
        dispatchLocal({ type: 'DELETE_TAG', payload: id });
      } catch (error) {
        toast.error('Erreur lors de la suppression du tag.');
      }
    }
  };

  // ============================================
  // Commercial statistics
  // ============================================

  const commercialStats = useMemo(() => {
    return state.commerciaux.map(commercial => {
      const comCalls = state.calls.filter(c => c.commercial_id === commercial.id);
      const comRdv = state.appointments.filter(a => a.commercial_id === commercial.id);
      const comProspects = state.prospects.filter(p => p.commercial_id === commercial.id);

      const weekCalls = getCallsThisWeek(comCalls).length;
      const monthCalls = getCallsThisMonth(comCalls).length;
      const todayCalls = getCallsToday(comCalls).length;
      const weekRdv = getAppointmentsThisWeek(comRdv).length;
      const monthRdv = getAppointmentsThisMonth(comRdv).length;
      const responseRate = getResponseRate(comCalls);
      const avgDuration = getAverageCallDuration(comCalls);
      const conversionRate = getConversionRate(comProspects);

      const callsProgress = commercial.objectifs.appels_semaine > 0 ? Math.round((weekCalls / commercial.objectifs.appels_semaine) * 100) : 0;
      const rdvProgress = commercial.objectifs.rdv_mois > 0 ? Math.round((monthRdv / commercial.objectifs.rdv_mois) * 100) : 0;

      return {
        commercial,
        weekCalls,
        monthCalls,
        todayCalls,
        weekRdv,
        monthRdv,
        responseRate,
        avgDuration,
        conversionRate,
        callsProgress,
        rdvProgress,
        totalProspects: comProspects.length,
      };
    });
  }, [state]);

  const progressColor = (pct: number) =>
    pct >= 100 ? 'bg-green-500' : pct >= 70 ? 'bg-amber-500' : 'bg-red-500';

  const progressLabel = (pct: number) =>
    pct >= 100 ? 'Atteint' : pct >= 70 ? 'En cours' : 'En retard';

  const progressDot = (pct: number) =>
    pct >= 100 ? 'bg-green-500' : pct >= 70 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Administration</h1>
        <p className="text-xs sm:text-sm text-gray-500 mt-0.5">Gestion de l'equipe, objectifs, tags et statistiques</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-full sm:w-fit flex-wrap overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      {/* ============================================ */}
      {/* TEAM TAB */}
      {/* ============================================ */}
      {activeTab === 'team' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-gray-900">Membres de l'equipe</h3>
              <p className="text-xs text-gray-500">{state.commerciaux.length} utilisateur(s)</p>
            </div>
            <button
              className="bg-brewery-600 text-white px-4 py-2 rounded-lg hover:bg-brewery-700 flex items-center gap-2 text-sm font-medium"
              onClick={openNewUser}
            >
              <Plus className="w-4 h-4" /> Ajouter un membre
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {state.commerciaux.map(user => (
              <div key={user.id} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-start gap-3">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${
                    user.role === 'admin' ? 'bg-amber-100 text-amber-700' : user.role === 'prospection' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {user.prenom[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-gray-900">{user.prenom} {user.nom}</h4>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {user.role === 'admin' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700">
                          <Shield className="w-3 h-3" /> Administrateur
                        </span>
                      ) : user.role === 'prospection' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-700">
                          <Users className="w-3 h-3" /> Prospection
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700">
                          <User className="w-3 h-3" /> Commercial
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">{user.email}</p>
                    <p className="text-xs text-gray-500">{user.telephone}</p>
                  </div>
                </div>

                <div className="flex gap-2 mt-4 pt-3 border-t border-gray-100">
                  <button
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
                    onClick={() => openEditUser(user)}
                  >
                    <Edit2 className="w-3 h-3" /> Modifier
                  </button>
                  <button
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100"
                    onClick={() => deleteUser(user)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* User form modal */}
          {showUserForm && (
            <div className="modal-backdrop">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-gray-200 flex items-center justify-between">
                  <h3 className="font-bold text-gray-900">
                    {editingUser ? `Modifier ${editingUser.prenom}` : 'Nouveau membre'}
                  </h3>
                  <button className="p-1 rounded hover:bg-gray-100" onClick={() => setShowUserForm(false)}>
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Prenom *</label>
                      <input
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                        value={userForm.prenom}
                        onChange={e => setUserForm(prev => ({ ...prev, prenom: e.target.value }))}
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Nom</label>
                      <input
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                        value={userForm.nom}
                        onChange={e => setUserForm(prev => ({ ...prev, nom: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
                    <input
                      type="email"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      placeholder="prenom@labrasseriedesplantes.fr"
                      value={userForm.email}
                      onChange={e => setUserForm(prev => ({ ...prev, email: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Telephone</label>
                    <input
                      type="tel"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      placeholder="06 00 00 00 00"
                      value={userForm.telephone}
                      onChange={e => setUserForm(prev => ({ ...prev, telephone: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium border transition-colors ${
                          userForm.role === 'admin'
                            ? 'border-amber-500 bg-amber-50 text-amber-700'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                        onClick={() => setUserForm(prev => ({ ...prev, role: 'admin' }))}
                      >
                        <Shield className="w-4 h-4" /> Admin
                      </button>
                      <button
                        className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium border transition-colors ${
                          userForm.role === 'commercial'
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                        onClick={() => setUserForm(prev => ({ ...prev, role: 'commercial' }))}
                      >
                        <User className="w-4 h-4" /> Commercial
                      </button>
                      <button
                        className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium border transition-colors ${
                          userForm.role === 'prospection'
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                        onClick={() => setUserForm(prev => ({ ...prev, role: 'prospection' }))}
                      >
                        <Users className="w-4 h-4" /> Prospection
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                      <Key className="w-3 h-3" />
                      {editingUser ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe *'}
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm pr-10"
                        placeholder={editingUser ? 'Nouveau mot de passe...' : 'Mot de passe...'}
                        value={userForm.password}
                        onChange={e => setUserForm(prev => ({ ...prev, password: e.target.value }))}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
                  <button
                    className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                    onClick={() => setShowUserForm(false)}
                  >
                    Annuler
                  </button>
                  <button
                    className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2"
                    onClick={saveUser}
                  >
                    <Save className="w-4 h-4" /> {editingUser ? 'Modifier' : 'Creer'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================ */}
      {/* OBJECTIVES TAB */}
      {/* ============================================ */}
      {activeTab === 'objectives' && (
        <div className="space-y-4">
          {state.commerciaux.map(commercial => {
            const stats = commercialStats.find(s => s.commercial.id === commercial.id)!;
            const isEditing = editingObjectives === commercial.id;
            return (
              <div key={commercial.id} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${
                      commercial.role === 'admin' ? 'bg-amber-100 text-amber-700' : commercial.role === 'prospection' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {commercial.prenom[0]}
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{commercial.prenom} {commercial.nom}</h3>
                      <p className="text-xs text-gray-500">{commercial.role === 'admin' ? 'Administrateur' : commercial.role === 'prospection' ? 'Prospection' : 'Commercial'}</p>
                    </div>
                  </div>
                  {isEditing ? (
                    <div className="flex gap-2">
                      <button className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setEditingObjectives(null)}>Annuler</button>
                      <button className="px-3 py-1.5 text-xs bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-1" onClick={saveObjectives}>
                        <Save className="w-3 h-3" /> Sauver
                      </button>
                    </div>
                  ) : (
                    <button className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200" onClick={() => startEditObjectives(commercial)}>
                      <Edit2 className="w-4 h-4 text-gray-600" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Appels / semaine</span>
                      <div className={`w-2 h-2 rounded-full ${progressDot(stats.callsProgress)}`} />
                    </div>
                    {isEditing ? (
                      <input type="number" className="w-full px-2 py-1 border border-gray-200 rounded text-sm" value={objectivesForm.appels_semaine} onChange={e => setObjectivesForm(prev => ({ ...prev, appels_semaine: parseInt(e.target.value) || 0 }))} />
                    ) : (
                      <>
                        <p className="text-lg font-bold text-gray-900">{stats.weekCalls} / {commercial.objectifs.appels_semaine}</p>
                        <div className="bg-gray-200 rounded-full h-2">
                          <div className={`h-2 rounded-full progress-bar ${progressColor(stats.callsProgress)}`} style={{ width: `${Math.min(stats.callsProgress, 100)}%` }} />
                        </div>
                        <p className="text-[10px] text-gray-400">{stats.callsProgress}% - {progressLabel(stats.callsProgress)}</p>
                      </>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">RDV / mois</span>
                      <div className={`w-2 h-2 rounded-full ${progressDot(stats.rdvProgress)}`} />
                    </div>
                    {isEditing ? (
                      <input type="number" className="w-full px-2 py-1 border border-gray-200 rounded text-sm" value={objectivesForm.rdv_mois} onChange={e => setObjectivesForm(prev => ({ ...prev, rdv_mois: parseInt(e.target.value) || 0 }))} />
                    ) : (
                      <>
                        <p className="text-lg font-bold text-gray-900">{stats.monthRdv} / {commercial.objectifs.rdv_mois}</p>
                        <div className="bg-gray-200 rounded-full h-2">
                          <div className={`h-2 rounded-full progress-bar ${progressColor(stats.rdvProgress)}`} style={{ width: `${Math.min(stats.rdvProgress, 100)}%` }} />
                        </div>
                        <p className="text-[10px] text-gray-400">{stats.rdvProgress}% - {progressLabel(stats.rdvProgress)}</p>
                      </>
                    )}
                  </div>

                  <div className="space-y-2">
                    <span className="text-xs text-gray-500">Prospects</span>
                    {isEditing ? (
                      <input type="number" className="w-full px-2 py-1 border border-gray-200 rounded text-sm" value={objectivesForm.prospects_mois} onChange={e => setObjectivesForm(prev => ({ ...prev, prospects_mois: parseInt(e.target.value) || 0 }))} />
                    ) : (
                      <p className="text-lg font-bold text-gray-900">{stats.totalProspects}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <span className="text-xs text-gray-500">Objectif conversion</span>
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <input type="number" className="w-full px-2 py-1 border border-gray-200 rounded text-sm" value={objectivesForm.taux_conversion} onChange={e => setObjectivesForm(prev => ({ ...prev, taux_conversion: parseInt(e.target.value) || 0 }))} />
                        <span className="text-sm text-gray-500">%</span>
                      </div>
                    ) : (
                      <p className="text-lg font-bold text-gray-900">{stats.conversionRate}% / {commercial.objectifs.taux_conversion}%</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ============================================ */}
      {/* TAGS TAB */}
      {/* ============================================ */}
      {activeTab === 'tags' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button className="bg-brewery-600 text-white px-4 py-2 rounded-lg hover:bg-brewery-700 flex items-center gap-2 text-sm font-medium" onClick={openNewTag}>
              <Plus className="w-4 h-4" /> Nouveau tag
            </button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200">
            <div className="divide-y divide-gray-100">
              {state.tags.map(tag => {
                const prospectCount = state.prospects.filter(p => p.tags.includes(tag.id)).length;
                const convertedCount = state.prospects.filter(p => p.tags.includes(tag.id) && p.etape_pipeline === 'client_gagne').length;
                return (
                  <div key={tag.id} className="p-4 flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: tag.couleur }} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-gray-900">{tag.nom}</p>
                      <p className="text-xs text-gray-500">{prospectCount} prospect(s) - {convertedCount} converti(s)</p>
                    </div>
                    <div className="flex gap-2">
                      <button className="p-1.5 rounded bg-gray-100 hover:bg-gray-200" onClick={() => openEditTag(tag)}>
                        <Edit2 className="w-3.5 h-3.5 text-gray-600" />
                      </button>
                      <button className="p-1.5 rounded bg-red-50 hover:bg-red-100" onClick={() => deleteTag(tag.id)}>
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {showTagForm && (
            <div className="modal-backdrop">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-gray-200 flex items-center justify-between">
                  <h3 className="font-bold text-gray-900">{editingTag ? 'Modifier le tag' : 'Nouveau tag'}</h3>
                  <button className="p-1 rounded hover:bg-gray-100" onClick={() => setShowTagForm(false)}>
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Nom du tag</label>
                    <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={tagForm.nom} onChange={e => setTagForm(prev => ({ ...prev, nom: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Couleur</label>
                    <div className="flex items-center gap-3">
                      <input type="color" className="w-10 h-10 rounded cursor-pointer" value={tagForm.couleur} onChange={e => setTagForm(prev => ({ ...prev, couleur: e.target.value }))} />
                      <input className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono" value={tagForm.couleur} onChange={e => setTagForm(prev => ({ ...prev, couleur: e.target.value }))} />
                    </div>
                    <div className="flex gap-2 mt-2">
                      {['#ef4444', '#22c55e', '#eab308', '#3b82f6', '#a855f7', '#f97316', '#6b7280', '#ec4899'].map(c => (
                        <button key={c} className="w-6 h-6 rounded-full border-2 border-white shadow" style={{ backgroundColor: c }} onClick={() => setTagForm(prev => ({ ...prev, couleur: c }))} />
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                    <span className="badge text-white text-xs" style={{ backgroundColor: tagForm.couleur }}>
                      {tagForm.nom || 'Apercu'}
                    </span>
                    <span className="text-xs text-gray-500">Apercu du tag</span>
                  </div>
                </div>
                <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
                  <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setShowTagForm(false)}>Annuler</button>
                  <button className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2" onClick={saveTag}>
                    <Save className="w-4 h-4" /> {editingTag ? 'Modifier' : 'Creer'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================ */}
      {/* STATISTICS TAB */}
      {/* ============================================ */}
      {activeTab === 'commercials' && (
        <div className="space-y-6">
          {commercialStats.map(stats => (
            <div key={stats.commercial.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold ${
                  stats.commercial.role === 'admin' ? 'bg-amber-100 text-amber-700' : stats.commercial.role === 'prospection' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                }`}>
                  {stats.commercial.prenom[0]}
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-lg">{stats.commercial.prenom} {stats.commercial.nom}</h3>
                  <p className="text-xs text-gray-500">{stats.commercial.email} - {stats.commercial.telephone}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 mb-4">
                <div className="bg-gray-50 p-3 rounded-lg text-center">
                  <Phone className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-xl font-bold text-gray-900">{stats.todayCalls}</p>
                  <p className="text-[10px] text-gray-500">Appels aujourd'hui</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg text-center">
                  <Phone className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-xl font-bold text-gray-900">{stats.weekCalls}</p>
                  <p className="text-[10px] text-gray-500">Appels semaine</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg text-center">
                  <Phone className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-xl font-bold text-gray-900">{stats.monthCalls}</p>
                  <p className="text-[10px] text-gray-500">Appels mois</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg text-center">
                  <Calendar className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-xl font-bold text-gray-900">{stats.monthRdv}</p>
                  <p className="text-[10px] text-gray-500">RDV mois</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg text-center">
                  <TrendingUp className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-xl font-bold text-gray-900">{stats.responseRate}%</p>
                  <p className="text-[10px] text-gray-500">Taux reponse</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg text-center">
                  <Award className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-xl font-bold text-gray-900">{stats.conversionRate}%</p>
                  <p className="text-[10px] text-gray-500">Taux conversion</p>
                </div>
              </div>

              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-xs font-medium text-gray-600 mb-2">Duree moyenne des appels: {formatDuration(stats.avgDuration)}</p>
                <p className="text-xs font-medium text-gray-600">Prospects geres: {stats.totalProspects}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {/* EasyBeer tab */}
      {activeTab === 'easybeer' && (
        <div className="space-y-6">
          {/* Auto-load data when tab opens */}
          {!ebConfigLoaded && (() => { loadEasyBeerData(); return null; })()}

          {/* Configuration */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Settings className="w-4 h-4" /> Configuration EasyBeer
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nom d'utilisateur API</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={ebConfig.username}
                  onChange={e => setEbConfig(prev => ({ ...prev, username: e.target.value }))}
                  placeholder="votre_username"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Mot de passe API</label>
                <input
                  type="password"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={ebConfig.password}
                  onChange={e => setEbConfig(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">URL API</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={ebConfig.api_url}
                  onChange={e => setEbConfig(prev => ({ ...prev, api_url: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Webhook Secret</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={ebConfig.webhook_secret}
                  onChange={e => setEbConfig(prev => ({ ...prev, webhook_secret: e.target.value }))}
                  placeholder="secret-pour-verifier-les-webhooks"
                />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              <button
                className="px-4 py-2 bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                onClick={saveEbConfig}
                disabled={ebSaving}
              >
                {ebSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Sauvegarder
              </button>
              <button
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                onClick={testEbConnection}
                disabled={ebTesting || !ebConfig.username}
              >
                {ebTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Tester la connexion
              </button>
              {ebTestResult && (
                <span className={`text-sm flex items-center gap-1 ${ebTestResult.ok ? 'text-green-600' : 'text-red-600'}`}>
                  {ebTestResult.ok ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  {ebTestResult.message}
                </span>
              )}
            </div>
            <div className="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-600">
              <p className="font-medium text-gray-700 mb-1">URL du webhook a configurer dans EasyBeer :</p>
              <code className="bg-gray-200 px-2 py-1 rounded text-gray-800 break-all">
                {window.location.origin}/api/webhook/easybeer/{ebConfig.webhook_secret || 'VOTRE_SECRET'}
              </code>
              <p className="mt-2 text-gray-500">EasyBeer envoie le secret dans l'URL. Le format supporte aussi le header <code className="bg-gray-200 px-1 rounded">X-Webhook-Secret</code>.</p>
            </div>
          </div>

          {/* Audit des liens Easybeer <-> clients */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
              <Link2 className="w-4 h-4" /> Audit des liens Easybeer → clients
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              Vérifie que chaque client Easybeer est relié au bon client SuiviPro. Les liens « suspects »
              viennent de l'ancien rapprochement par nom — délie puis relie au bon client (ses commandes
              orphelines suivront automatiquement).
            </p>
            <button
              className="px-3 py-2 bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 text-sm disabled:opacity-50 mb-3"
              onClick={chargerAuditLiens}
              disabled={ebAuditLoading}
            >
              {ebAuditLoading ? 'Analyse…' : ebAudit ? 'Relancer l\'audit' : 'Lancer l\'audit'}
            </button>

            {ebAudit && (
              <div>
                <div className="flex gap-3 mb-3 text-sm">
                  <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">{ebAudit.total} lien(s)</span>
                  <span className={`px-2 py-1 rounded ${ebAudit.suspects ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{ebAudit.suspects} suspect(s)</span>
                  <span className={`px-2 py-1 rounded ${ebAudit.a_verifier ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{ebAudit.a_verifier} à vérifier</span>
                </div>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {ebAudit.liens.filter(l => l.verdict !== 'ok').map(l => (
                    <div key={l.easybeer_id} className={`p-3 rounded-lg border text-sm ${l.verdict === 'suspect' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900">{l.eb_name || `Easybeer #${l.easybeer_id}`}</span>
                        <span className="text-gray-400">→</span>
                        <span className="text-gray-800">{l.client_nom}</span>
                        <span className="text-xs text-gray-500">({l.nb_commandes} commande(s) · preuves : {l.preuves.join(', ') || 'aucune'})</span>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <select
                          className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs"
                          value={ebRelierChoix[l.easybeer_id] || ''}
                          onChange={e => setEbRelierChoix(prev => ({ ...prev, [l.easybeer_id]: e.target.value }))}
                        >
                          <option value="">Relier au bon client…</option>
                          {[...state.clients].sort((a, b) => a.nom.localeCompare(b.nom)).map(c => (
                            <option key={c.id} value={c.id}>{c.nom}{c.ville ? ` (${c.ville})` : ''}</option>
                          ))}
                        </select>
                        <button
                          className="px-2 py-1.5 bg-brewery-600 text-white rounded-lg text-xs hover:bg-brewery-700"
                          onClick={() => relierLienEasybeer(l.easybeer_id)}
                        >Relier</button>
                        <button
                          className="px-2 py-1.5 bg-white border border-red-300 text-red-600 rounded-lg text-xs hover:bg-red-50"
                          onClick={() => delierLienEasybeer(l.easybeer_id, l.eb_name || l.client_nom)}
                        >Délier</button>
                      </div>
                    </div>
                  ))}
                  {ebAudit.liens.filter(l => l.verdict !== 'ok').length === 0 && (
                    <p className="text-sm text-green-700">Tous les liens sont cohérents ✓</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Regles d'affectation */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Users className="w-4 h-4" /> Regles d'affectation automatique
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Quand un client arrive d'EasyBeer avec un email commercial, il est automatiquement assigne au bon commercial.
            </p>

            {assignmentRules.length > 0 && (
              <div className="space-y-2 mb-4">
                {assignmentRules.map(rule => {
                  const com = state.commerciaux.find(c => c.id === rule.commercial_id);
                  return (
                    <div key={rule.id} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg text-sm">
                      <span className="text-gray-600 flex-1">{rule.email}</span>
                      <span className="text-gray-400">→</span>
                      <span className="font-medium text-gray-900">{com ? `${com.prenom} ${com.nom}` : rule.commercial_id}</span>
                      <button className="p-1 rounded hover:bg-red-50" onClick={() => deleteAssignmentRule(rule.id)}>
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">Email commercial EasyBeer</label>
                <input
                  type="email"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={newRuleEmail}
                  onChange={e => setNewRuleEmail(e.target.value)}
                  placeholder="commercial@easybeer.fr"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">Commercial SuiviPro</label>
                <select
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={newRuleCommercial}
                  onChange={e => setNewRuleCommercial(e.target.value)}
                >
                  <option value="">Choisir...</option>
                  {state.commerciaux.map(c => (
                    <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
                  ))}
                </select>
              </div>
              <button
                className="px-3 py-2 bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 text-sm disabled:opacity-50"
                onClick={addAssignmentRule}
                disabled={!newRuleEmail || !newRuleCommercial}
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Clients en attente */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Building2 className="w-4 h-4" /> Clients en attente d'import ({ebPending.length})
              </h3>
              <button
                className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg flex items-center gap-1"
                onClick={loadEasyBeerData}
              >
                <RefreshCw className="w-3.5 h-3.5" /> Rafraichir
              </button>
            </div>

            {ebPending.length > 0 && (
              <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type client pour l'import</label>
                  <select
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    value={ebImportType}
                    onChange={e => setEbImportType(e.target.value as ClientType)}
                  >
                    {Object.entries(CLIENT_TYPE_FAMILIES).map(([key, family]) => (
                      <optgroup key={key} label={family.label}>
                        {family.types.map(t => (
                          <option key={t} value={t}>{CLIENT_TYPE_LABELS[t]}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Commercial assigne</label>
                  <select
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    value={ebImportCommercial}
                    onChange={e => setEbImportCommercial(e.target.value)}
                  >
                    <option value="">Par defaut</option>
                    {state.commerciaux.map(c => (
                      <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {ebPending.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">Aucun client en attente</p>
            ) : (
              <div className="space-y-2">
                {ebPending.map(client => (
                  <div key={client.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {client.name || `Client EasyBeer #${client.easybeer_id}`}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {[client.city, client.phone, client.email].filter(Boolean).join(' - ') || `ID: ${client.easybeer_id} — En attente de synchronisation`}
                      </p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        {client.type && (
                          <p className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded-full font-medium">
                            Type: {client.type}
                          </p>
                        )}
                        {client.commercial_email && (() => {
                          const matchedRule = assignmentRules.find(r => r.email.toLowerCase() === client.commercial_email?.toLowerCase());
                          const matchedCom = matchedRule ? state.commerciaux.find(c => c.id === matchedRule.commercial_id) : null;
                          return (
                            <p className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium">
                              Commercial: {matchedCom ? `${matchedCom.prenom} ${matchedCom.nom}` : client.commercial_email}
                              {matchedCom && <span className="text-green-600 ml-1">(auto)</span>}
                            </p>
                          );
                        })()}
                        {client.contact_name && (
                          <p className="text-[10px] text-gray-400">Contact: {client.contact_name}</p>
                        )}
                        {client.tournee && (
                          <p className="text-[10px] text-indigo-500">Tournee: {client.tournee}</p>
                        )}
                        {client.phone_mobile && (
                          <p className="text-[10px] text-gray-400">Mobile: {client.phone_mobile}</p>
                        )}
                        {(client.latitude > 0 || client.longitude > 0) && (
                          <p className="text-[10px] text-green-500">GPS OK</p>
                        )}
                        {client.siret && (
                          <p className="text-[10px] text-gray-400">SIRET: {client.siret}</p>
                        )}
                      </div>
                    </div>
                    {!client.name && (
                      <button
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-xs font-medium"
                        onClick={() => syncEbClient(client.id)}
                        title="Recuperer les infos depuis EasyBeer"
                      >
                        Sync
                      </button>
                    )}
                    <button
                      className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-xs font-medium"
                      onClick={() => importEbClient(client.id)}
                    >
                      Importer
                    </button>
                    <button
                      className="p-1.5 rounded-lg hover:bg-red-50"
                      onClick={() => dismissEbClient(client.id)}
                      title="Ignorer"
                    >
                      <X className="w-4 h-4 text-red-500" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Synchronisation des commandes EasyBeer */}
          <div className="bg-white rounded-xl border border-blue-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-blue-800 flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> Synchroniser les commandes EasyBeer
              </h3>
              <div className="flex gap-2">
                <button
                  className={`px-4 py-2 text-sm font-medium text-white rounded-lg flex items-center gap-2 ${syncingAllCommandes ? 'bg-blue-400 cursor-wait' : 'bg-blue-600 hover:bg-blue-700'}`}
                  onClick={() => syncAllCommandes(false)}
                  disabled={syncingAllCommandes}
                >
                  <RefreshCw className={`w-4 h-4 ${syncingAllCommandes ? 'animate-spin' : ''}`} />
                  {syncingAllCommandes ? 'Sync...' : 'Synchroniser'}
                </button>
                <button
                  className={`px-3 py-2 text-xs font-medium text-white rounded-lg ${syncingAllCommandes ? 'bg-orange-300 cursor-wait' : 'bg-orange-500 hover:bg-orange-600'}`}
                  onClick={() => { if (confirm('Supprimer et re-importer toutes les commandes EasyBeer ?')) syncAllCommandes(true); }}
                  disabled={syncingAllCommandes}
                >
                  Re-sync total
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Recupere la liste des clients depuis l'API EasyBeer, les matche par SIRET/nom/email, puis recupere toutes leurs commandes (en cours + livrees).
            </p>
            {syncAllResult && (
              <div className={`p-3 rounded-lg text-sm ${syncAllResult.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                <p className="font-medium">{syncAllResult.message}</p>
                {syncAllResult.ok && (
                  <div className="mt-2 text-xs space-y-1">
                    <p>Clients API EasyBeer: <strong>{syncAllResult.api_clients || 0}</strong> — matches: <strong>{syncAllResult.clients_matched || 0}</strong>, non matches: {syncAllResult.clients_unmatched || 0}</p>
                    <p>Commandes trouvees: <strong>{syncAllResult.total_orders_found || 0}</strong></p>
                    <p>Nouvelles importees: <strong>{syncAllResult.total_imported || 0}</strong></p>
                    <p>Deja existantes (ignorees): <strong>{syncAllResult.total_skipped || 0}</strong></p>
                    {(syncAllResult.total_orphans || 0) > 0 && <p>Orphelines (client non importe): <strong>{syncAllResult.total_orphans}</strong></p>}
                    {syncAllResult.details && syncAllResult.details.length > 0 && (
                      <div className="mt-2 border-t pt-2">
                        <p className="font-medium mb-1">Detail par client:</p>
                        {syncAllResult.details.map((d: any, i: number) => (
                          <p key={i}>{d.nom}: {d.commandes_importees} commande{d.commandes_importees > 1 ? 's' : ''} ({d.total_ttc}€ TTC)</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {syncAllResult.debug && syncAllResult.debug.length > 0 && (
                  <div className="mt-2 border-t pt-2 text-xs">
                    <p className="font-medium mb-1">Debug API EasyBeer:</p>
                    {syncAllResult.debug.map((d: any, i: number) => (
                      <div key={i} className="mb-1">
                        <p><strong>{d.endpoint}</strong>: HTTP {d.status}{d.error ? ` - ${d.error}` : ''}{d.succes === false ? ` (succes: false)` : ''}</p>
                        {d.message && <p className="text-red-500 text-sm">{d.message}</p>}
                        {d.params && <p className="text-gray-500 text-sm">Params: {typeof d.params === 'string' ? d.params : JSON.stringify(d.params)}</p>}
                        {d.response_keys && d.response_keys.length > 0 && <p className="text-gray-500">Cles: {d.response_keys.join(', ')}</p>}
                        {d.keys && d.keys.length > 0 && <p className="text-gray-500">Cles: {d.keys.join(', ')}</p>}
                        {d.sample && <p className="text-gray-400 text-xs truncate max-w-full">{d.sample.substring(0, 300)}</p>}
                        {d.body && <p className="text-gray-400 text-xs truncate max-w-full">{d.body.substring(0, 300)}</p>}
                        {d.shape && <p className="text-gray-500">Shape: {d.shape}</p>}
                      </div>
                    ))}
                    {(syncAllResult.api_url || syncAllResult.apiBase) && <p className="mt-1">URL API: {syncAllResult.api_url || syncAllResult.apiBase}</p>}
                    {syncAllResult.discovery && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <p className="font-medium mb-1 text-blue-700">Decouverte API (tous les endpoints testes):</p>
                        {syncAllResult.discovery.filter((d: any) => d.status !== 404).map((d: any, i: number) => (
                          <div key={i} className="mb-1">
                            <p><strong>{d.method} {d.path}</strong>: HTTP {d.status}{d.error ? ` - ${d.error}` : ''}{d.hasListe !== null ? ` (liste: ${d.hasListe})` : ''}</p>
                            {d.keys && d.keys.length > 0 && <p className="text-gray-500 text-xs">Cles: {d.keys.join(', ')}</p>}
                            {d.sample && <p className="text-gray-400 text-xs truncate max-w-full">{d.sample.substring(0, 300)}</p>}
                          </div>
                        ))}
                        <p className="text-gray-400 text-xs mt-1">
                          (Endpoints 404 masques. {syncAllResult.discovery.filter((d: any) => d.status === 404).length} endpoints retournent 404.)
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Explorer API EasyBeer */}
          <div className="bg-white rounded-xl border border-purple-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-purple-800 flex items-center gap-2">
                <Search className="w-4 h-4" /> Explorer l'API EasyBeer
              </h3>
              <div className="flex flex-wrap gap-1">
                {[
                  { round: 7, label: 'document + commande detail' },
                  { round: 6, label: 'Swagger (documents/commandes)' },
                  { round: 4, label: 'commande/document/facture' },
                  { round: 5, label: 'bl/tournee/commercial' },
                  { round: 3, label: 'parametres POST' },
                ].map(({ round, label }) => (
                  <button
                    key={round}
                    className={`px-2 py-1.5 text-xs font-medium text-white rounded-lg flex items-center gap-1 ${exploringApi ? 'bg-purple-400 cursor-wait' : 'bg-purple-600 hover:bg-purple-700'}`}
                    onClick={() => exploreEasyBeerApi(round)}
                    disabled={exploringApi}
                  >
                    <Search className={`w-3 h-3 ${exploringApi ? 'animate-pulse' : ''}`} />
                    {exploringApi ? '...' : label}
                  </button>
                ))}
                <button
                  className="px-2 py-1.5 text-xs text-purple-600 hover:bg-purple-50 rounded-lg"
                  onClick={() => setExploreResult(null)}
                >
                  Reset
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Teste differentes approches pour trouver les commandes: detail client, formats alternatifs, endpoints racine. Maximum 5 appels API avec delai de 500ms.
            </p>
            {exploreResult && (
              <div className="p-3 rounded-lg text-sm bg-purple-50 text-purple-900">
                <p className="font-medium mb-2">Resultats de l'exploration ({exploreResult.results?.length || 0} endpoints testes):</p>
                {exploreResult.api_url && <p className="text-xs text-gray-500 mb-2">API: {exploreResult.api_url} | Client teste: {exploreResult.client_id_tested}</p>}
                {exploreResult.results?.map((r: any, i: number) => (
                  <div key={i} className="mb-2 p-2 bg-white rounded border">
                    <p className="font-medium">
                      <span className={r.status === 200 ? 'text-green-600' : r.status === 404 ? 'text-gray-400' : 'text-red-500'}>
                        {r.method} {r.path} → HTTP {r.status}
                      </span>
                      {r.succes === false && <span className="text-red-500 ml-2">(succes: false)</span>}
                      {r.hasData && <span className="text-green-600 ml-2 font-bold">✓ CONTIENT DES DONNEES!</span>}
                    </p>
                    {r.label && <p className="text-xs text-gray-500">Test: {r.label}</p>}
                    {r.message && <p className="text-xs text-red-500">{r.message}</p>}
                    {r.keys && r.keys.length > 0 && <p className="text-xs text-gray-500">Cles: {r.keys.join(', ')}</p>}
                    {r.sample && <p className="text-xs text-gray-400 break-all">{r.sample.substring(0, 400)}</p>}
                    {r.error && <p className="text-xs text-red-400">{r.error}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Commandes orphelines (sans client) */}
          {orphanCommandes.length > 0 && (
          <div className="bg-white rounded-xl border border-orange-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-orange-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> Commandes a assigner ({orphanCommandes.length})
              </h3>
              <button
                className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg flex items-center gap-1"
                onClick={loadEasyBeerData}
              >
                <RefreshCw className="w-3.5 h-3.5" /> Rafraichir
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">Ces commandes ont ete recues par webhook EasyBeer mais n'ont pas pu etre associees automatiquement a un client.</p>
            <div className="space-y-3">
              {orphanCommandes.map(cmd => {
                const lignes = cmd.lignes || [];
                const isAssigning = assigningCmd === cmd.id;

                // Filter clients for search
                const searchResults = assignCmdClientSearch.length >= 2 && isAssigning
                  ? state.clients.filter(c =>
                      c.nom.toLowerCase().includes(assignCmdClientSearch.toLowerCase()) ||
                      c.ville?.toLowerCase().includes(assignCmdClientSearch.toLowerCase()) ||
                      c.email?.toLowerCase().includes(assignCmdClientSearch.toLowerCase())
                    ).slice(0, 8)
                  : [];

                return (
                  <div key={cmd.id} className="p-4 bg-orange-50 rounded-lg border border-orange-100">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold text-gray-900">#{cmd.numero || cmd.easybeer_id}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                            cmd.statut === 'livree' ? 'bg-green-100 text-green-700' :
                            cmd.statut === 'annulee' ? 'bg-red-100 text-red-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                            {cmd.statut === 'livree' ? 'Livree' : cmd.statut === 'annulee' ? 'Annulee' : 'En cours'}
                          </span>
                        </div>
                        {cmd.client_name && (
                          <p className="text-xs text-gray-600 mb-1">Client EasyBeer : <strong>{cmd.client_name}</strong></p>
                        )}
                      </div>
                      <button
                        onClick={async () => {
                          const token = localStorage.getItem('suivipro_token');
                          await fetch(`/api/commandes/${cmd.id}`, {
                            method: 'DELETE',
                            headers: { Authorization: `Bearer ${token}` },
                          });
                          setOrphanCommandes(prev => prev.filter(c => c.id !== cmd.id));
                          toast.success('Commande supprimee');
                        }}
                        className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-500"
                        title="Supprimer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Details de la commande */}
                    <div className="mb-3 p-3 bg-white rounded-lg border border-orange-100 space-y-2">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3 h-3 text-gray-400" />
                          <span className="text-gray-500">Commande :</span>
                          <span className="font-medium text-gray-800">{cmd.date_commande ? new Date(cmd.date_commande).toLocaleDateString('fr-FR') : '—'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3 h-3 text-gray-400" />
                          <span className="text-gray-500">Livraison :</span>
                          <span className="font-medium text-gray-800">{cmd.date_livraison ? new Date(cmd.date_livraison).toLocaleDateString('fr-FR') : '—'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <TrendingUp className="w-3 h-3 text-gray-400" />
                          <span className="text-gray-500">Montant HT :</span>
                          <span className="font-medium text-gray-800">{cmd.montant_ht > 0 ? `${cmd.montant_ht.toFixed(2)} €` : '—'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <TrendingUp className="w-3 h-3 text-blue-500" />
                          <span className="text-gray-500">Montant TTC :</span>
                          <span className="font-semibold text-gray-900">{cmd.montant_ttc > 0 ? `${cmd.montant_ttc.toFixed(2)} €` : '—'}</span>
                        </div>
                        {cmd.notes && (
                          <div className="col-span-2 flex items-start gap-1.5">
                            <span className="text-gray-500">Notes :</span>
                            <span className="text-gray-700">{cmd.notes}</span>
                          </div>
                        )}
                      </div>

                      {/* Lignes produits */}
                      {lignes.length > 0 && (
                        <div className="pt-2 border-t border-gray-100">
                          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1.5">Produits ({lignes.length})</p>
                          <div className="space-y-1">
                            {lignes.map((l: any, i: number) => (
                              <div key={i} className="flex items-center justify-between text-xs py-1 px-2 bg-gray-50 rounded">
                                <span className="truncate flex-1 text-gray-700">{l.produit || '—'}</span>
                                <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                                  <span className="text-gray-500">x{l.quantite}</span>
                                  {l.prix_unitaire > 0 && <span className="text-gray-400">{l.prix_unitaire.toFixed(2)} €/u</span>}
                                  {l.montant > 0 && <span className="font-medium text-gray-700">{l.montant.toFixed(2)} €</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Raw data toggle */}
                      {cmd.raw_data && cmd.raw_data !== '{}' && (() => {
                        let rawObj: Record<string, unknown> = {};
                        try { rawObj = JSON.parse(cmd.raw_data); } catch { /* */ }
                        if (Object.keys(rawObj).length === 0) return null;
                        return (
                          <details className="pt-2 border-t border-gray-100">
                            <summary className="cursor-pointer text-[10px] text-gray-400 hover:text-gray-600 font-medium">
                              Voir les donnees brutes EasyBeer
                            </summary>
                            <pre className="mt-1.5 p-2 bg-gray-100 rounded text-[10px] overflow-x-auto whitespace-pre-wrap text-gray-600 max-h-60 overflow-y-auto">
                              {JSON.stringify(rawObj, null, 2)}
                            </pre>
                          </details>
                        );
                      })()}
                    </div>

                    {/* Assignment UI */}
                    {isAssigning ? (
                      <div className="mt-2">
                        <input
                          type="text"
                          value={assignCmdClientSearch}
                          onChange={e => setAssignCmdClientSearch(e.target.value)}
                          placeholder="Rechercher un client par nom, ville, email..."
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
                          autoFocus
                        />
                        {searchResults.length > 0 && (
                          <div className="mt-1 border border-gray-200 rounded-lg max-h-48 overflow-y-auto bg-white shadow-lg">
                            {searchResults.map(client => (
                              <button
                                key={client.id}
                                onClick={async () => {
                                  try {
                                    const token = localStorage.getItem('suivipro_token');
                                    const resp = await fetch(`/api/commandes/${cmd.id}/assign`, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                      body: JSON.stringify({ client_id: client.id }),
                                    });
                                    const data = await resp.json();
                                    if (data.ok) {
                                      setOrphanCommandes(prev => prev.filter(c => c.id !== cmd.id));
                                      toast.success(`Commande #${cmd.numero || ''} assignee a ${client.nom}`);
                                    } else {
                                      toast.error(data.error || 'Erreur');
                                    }
                                  } catch { toast.error('Erreur reseau'); }
                                  setAssigningCmd(null);
                                  setAssignCmdClientSearch('');
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-brewery-50 border-b border-gray-100 last:border-0"
                              >
                                <span className="text-sm font-medium text-gray-900">{client.nom}</span>
                                <span className="text-xs text-gray-500 ml-2">
                                  {[client.ville, client.email].filter(Boolean).join(' - ')}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        {assignCmdClientSearch.length >= 2 && searchResults.length === 0 && (
                          <p className="text-xs text-gray-400 text-center py-2">Aucun client trouve</p>
                        )}
                        <button
                          onClick={() => { setAssigningCmd(null); setAssignCmdClientSearch(''); }}
                          className="mt-2 text-xs text-gray-500 hover:text-gray-700"
                        >
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setAssigningCmd(cmd.id); setAssignCmdClientSearch(cmd.client_name || ''); }}
                        className="mt-2 px-3 py-1.5 text-xs font-medium text-white bg-brewery-600 hover:bg-brewery-700 rounded-lg flex items-center gap-1"
                      >
                        <Link2 className="w-3 h-3" /> Assigner a un client
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          )}

          {/* Journal des webhooks */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> Journal des webhooks ({webhookLogs.length})
              </h3>
              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-1.5 text-xs text-green-700 bg-green-50 hover:bg-green-100 rounded-lg flex items-center gap-1 border border-green-200"
                  onClick={async () => {
                    try {
                      const token = localStorage.getItem('suivipro_token');
                      const resp = await fetch('/api/easybeer/test-webhook', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ type: 'commande' })
                      });
                      if (!resp.ok) { alert(`Erreur serveur ${resp.status}: ${resp.statusText}`); return; }
                      const result = await resp.json();
                      alert(result.ok ? result.message : `Erreur: ${result.message || 'inconnue'}`);
                      setTimeout(() => loadEasyBeerData(), 6000);
                    } catch (err: unknown) { alert('Erreur réseau: ' + (err instanceof Error ? err.message : String(err))); }
                  }}
                >
                  Test Commande
                </button>
                <button
                  className="px-3 py-1.5 text-xs text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg flex items-center gap-1 border border-purple-200"
                  onClick={async () => {
                    try {
                      const token = localStorage.getItem('suivipro_token');
                      const resp = await fetch('/api/easybeer/test-webhook', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ type: 'client' })
                      });
                      if (!resp.ok) { alert(`Erreur serveur ${resp.status}: ${resp.statusText}`); return; }
                      const result = await resp.json();
                      alert(result.ok ? result.message : `Erreur: ${result.message || 'inconnue'}`);
                      setTimeout(() => loadEasyBeerData(), 6000);
                    } catch (err: unknown) { alert('Erreur réseau: ' + (err instanceof Error ? err.message : String(err))); }
                  }}
                >
                  Test Client
                </button>
                <button
                  className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg flex items-center gap-1"
                  onClick={loadEasyBeerData}
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Rafraichir
                </button>
              </div>
            </div>
            {webhookLogs.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">Aucun webhook recu</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {webhookLogs.map(log => {
                  let payload: Record<string, unknown> = {};
                  try { payload = JSON.parse(log.payload || '{}'); } catch { /* ignore */ }
                  const date = log.received_at ? new Date(log.received_at) : null;
                  return (
                    <div key={log.id} className="p-3 bg-gray-50 rounded-lg text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded font-mono">{log.type || 'N/A'}</span>
                          {log.external_id && <span className="text-gray-500">ID: {log.external_id}</span>}
                        </div>
                        <span className="text-gray-400">
                          {date ? date.toLocaleDateString('fr-FR') + ' ' + date.toLocaleTimeString('fr-FR') : ''}
                        </span>
                      </div>
                      {log.processing_result && (
                        <div className={`mt-1 px-2 py-1 rounded text-[11px] ${
                          log.processing_result.startsWith('OK') ? 'bg-green-50 text-green-700' :
                          log.processing_result.startsWith('ERREUR') ? 'bg-red-50 text-red-700' :
                          log.processing_result.startsWith('ORPHELINE') ? 'bg-orange-50 text-orange-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {log.processing_result}
                        </div>
                      )}
                      <details className="mt-1">
                        <summary className="cursor-pointer text-gray-500 hover:text-gray-700">Voir le payload</summary>
                        <pre className="mt-1 p-2 bg-gray-100 rounded text-[10px] overflow-x-auto whitespace-pre-wrap text-gray-600">
                          {JSON.stringify(payload, null, 2)}
                        </pre>
                      </details>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================ */}
      {/* TOURNEES TAB */}
      {/* ============================================ */}
      {activeTab === 'tournees' && (
        <div className="space-y-4 sm:space-y-6">
          {/* Recurrence config */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
              <div>
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4" /> Recurrence des visites par type de client
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">Nombre de jours entre chaque visite (vide = pas de recurrence)</p>
              </div>
              {!frequencyEditing ? (
                <button
                  onClick={startEditFrequency}
                  className="px-3 py-1.5 text-xs font-medium text-brewery-600 hover:bg-brewery-50 rounded-lg flex items-center gap-1 self-start"
                >
                  <Edit2 className="w-3.5 h-3.5" /> Modifier
                </button>
              ) : (
                <div className="flex gap-2 self-start">
                  <button onClick={() => setFrequencyEditing(false)} className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 rounded-lg">
                    Annuler
                  </button>
                  <button
                    onClick={() => saveFrequencyConfig(false)}
                    disabled={frequencySaving}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-brewery-600 hover:bg-brewery-700 rounded-lg flex items-center gap-1 disabled:opacity-50"
                  >
                    {frequencySaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Sauvegarder
                  </button>
                  <button
                    onClick={() => saveFrequencyConfig(true)}
                    disabled={frequencySaving}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg flex items-center gap-1 disabled:opacity-50"
                    title="Recalculer next_visit pour tous les clients existants"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Appliquer aux clients
                  </button>
                </div>
              )}
            </div>

            {frequencyEditing ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {Object.entries(CLIENT_TYPE_FAMILIES).map(([key, family]) => (
                  <div key={key} className="space-y-2">
                    <p className="text-xs font-semibold text-gray-700">{family.label}</p>
                    {family.types.map(type => (
                      <div key={type} className="flex items-center gap-2">
                        <label className="text-xs text-gray-600 flex-1 truncate">{CLIENT_TYPE_LABELS[type]}</label>
                        <input
                          type="number"
                          min="0"
                          className="w-16 px-2 py-1 border border-gray-200 rounded text-sm text-center"
                          value={frequencyEditValues[type] ?? ''}
                          onChange={e => setFrequencyEditValues(prev => ({ ...prev, [type]: e.target.value }))}
                          placeholder="-"
                        />
                        <span className="text-[10px] text-gray-400">jours</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                {Object.entries(CLIENT_TYPE_FAMILIES).map(([key, family]) => (
                  <div key={key} className="space-y-1">
                    <p className="text-xs font-semibold text-gray-700">{family.label}</p>
                    {family.types.map(type => {
                      const dbVal = frequencyConfig[type];
                      const defaultVal = (CLIENT_VISIT_FREQUENCIES as Record<string, number | null>)[type];
                      const val = dbVal ?? defaultVal;
                      const isCustom = dbVal != null && dbVal !== defaultVal;
                      return (
                        <div key={type} className="flex items-center justify-between text-xs py-0.5">
                          <span className="text-gray-600 truncate">{CLIENT_TYPE_LABELS[type]}</span>
                          <span className={`font-medium ${isCustom ? 'text-brewery-600' : val == null ? 'text-gray-400' : 'text-gray-700'}`}>
                            {val != null ? `${val}j` : '-'}
                            {isCustom && <span className="text-[10px] ml-0.5">*</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tournées par commercial */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">Tournees par commercial</h3>
          </div>

          {state.commerciaux.filter(c => c.role !== 'prospection').map(commercial => {
            const isEditing = tourneeEditing === commercial.id;
            const config = tourneeConfigs[commercial.id];
            const hasConfig = config && Object.keys(config.config).some(k => (config.config[k] || []).length > 0);

            return (
              <div key={commercial.id} className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="w-8 h-8 bg-brewery-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-brewery-700" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-medium text-gray-900 text-sm">{commercial.prenom} {commercial.nom}</h4>
                      <p className="text-[10px] text-gray-500 truncate">{commercial.email}</p>
                      {config && (
                        <p className="text-[10px] text-gray-400">{WEEK_PATTERN_LABELS[config.week_pattern || 'every']}</p>
                      )}
                    </div>
                  </div>
                  {!isEditing ? (
                    <button
                      onClick={() => startEditTournee(commercial.id)}
                      className="px-3 py-1.5 text-xs font-medium text-brewery-600 hover:bg-brewery-50 rounded-lg flex items-center gap-1 self-start"
                    >
                      <Edit2 className="w-3.5 h-3.5" /> Modifier
                    </button>
                  ) : (
                    <div className="flex gap-2 self-start">
                      <button onClick={() => setTourneeEditing(null)} className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 rounded-lg">
                        Annuler
                      </button>
                      <button
                        onClick={() => saveTourneeConfig(commercial.id)}
                        disabled={tourneeSaving}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-brewery-600 hover:bg-brewery-700 rounded-lg flex items-center gap-1 disabled:opacity-50"
                      >
                        {tourneeSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        Sauvegarder
                      </button>
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="space-y-3">
                    {/* Week pattern */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Frequence</label>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(WEEK_PATTERN_LABELS).map(([key, label]) => (
                          <button
                            key={key}
                            onClick={() => setTourneeEditWeekPattern(key)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              tourneeEditWeekPattern === key
                                ? 'bg-brewery-600 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {allZones.length > 0 && (
                      <div className="p-2.5 bg-blue-50 border border-blue-100 rounded-lg">
                        <p className="text-[10px] font-medium text-blue-700 mb-1.5">Zones existantes :</p>
                        <div className="flex flex-wrap gap-1">
                          {allZones.map(zone => (
                            <span key={zone} className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full border border-blue-200 font-medium">{zone}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {DAY_KEYS.map(day => (
                        <AdminZonePicker
                          key={day}
                          label={DAY_LABELS[day]}
                          selected={tourneeEditConfig[day] || []}
                          allZones={allZones}
                          onAdd={zone => addZoneToDay(day, zone)}
                          onRemove={zone => removeZoneFromDay(day, zone)}
                        />
                      ))}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Info tournee (visible par l'equipe)</label>
                      <textarea
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                        rows={2}
                        value={tourneeEditInfo}
                        onChange={e => setTourneeEditInfo(e.target.value)}
                        placeholder="Infos visibles par les prospecteurs..."
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Notes (privees)</label>
                      <textarea
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                        rows={2}
                        value={tourneeEditNotes}
                        onChange={e => setTourneeEditNotes(e.target.value)}
                        placeholder="Notes personnelles..."
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    {config?.tournee_info && (
                      <div className="flex items-start gap-2 p-2 bg-blue-50 border border-blue-100 rounded-lg mb-3 text-xs text-blue-800 leading-relaxed">
                        <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        <p className="whitespace-pre-wrap break-words">{config.tournee_info}</p>
                      </div>
                    )}
                    {hasConfig ? (
                      <>
                        {/* Mobile */}
                        <div className="sm:hidden space-y-1.5">
                          {DAY_KEYS.map(day => {
                            const zones = config?.config[day] || [];
                            if (zones.length === 0) return null;
                            return (
                              <div key={day} className="flex items-center gap-2 py-1.5 px-2 bg-indigo-50 rounded-lg">
                                <span className="text-xs font-semibold text-gray-600 w-8">{DAY_LABELS[day].substring(0, 3)}</span>
                                <div className="flex flex-wrap gap-1">
                                  {zones.map((z, i) => (
                                    <span key={i} className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded font-medium">{z}</span>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {/* Desktop */}
                        <div className="hidden sm:grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2">
                          {DAY_KEYS.map(day => {
                            const zones = config?.config[day] || [];
                            return (
                              <div key={day} className={`p-2 rounded-lg text-center ${zones.length > 0 ? 'bg-indigo-50 border border-indigo-100' : 'bg-gray-50 border border-gray-100'}`}>
                                <p className="text-[10px] font-medium text-gray-500 mb-1">{DAY_LABELS[day]}</p>
                                {zones.length > 0 ? (
                                  <div className="space-y-0.5">
                                    {zones.map((z, i) => (
                                      <span key={i} className="block text-xs font-medium text-indigo-700">{z}</span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-xs text-gray-400">-</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-gray-400 italic">Aucune tournee configuree</p>
                    )}
                    {config?.notes && (
                      <p className="mt-2 text-xs text-gray-500 italic">{config.notes}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {state.commerciaux.filter(c => c.role !== 'prospection').length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-sm text-gray-500">Aucun commercial dans l'equipe</p>
              <p className="text-xs text-gray-400 mt-1">Ajoutez des membres dans l'onglet Equipe</p>
            </div>
          )}
        </div>
      )}

      {/* ============================================ */}
      {/* Activity Tab */}
      {/* ============================================ */}
      {activeTab === 'activity' && (
        <div className="space-y-6">
          {/* Last seen cards */}
          <div>
            <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <Clock className="w-5 h-5 text-gray-500" />
              Derniere connexion
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {lastSeenData.map(u => {
                const isOnline = u.last_seen && (Date.now() - new Date(u.last_seen).getTime()) < 5 * 60 * 1000;
                const timeAgo = u.last_seen ? formatTimeAgo(new Date(u.last_seen)) : 'Jamais';
                return (
                  <div key={u.id} className="bg-white rounded-xl border border-gray-200 p-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <span className="font-medium text-sm text-gray-800">{u.prenom} {u.nom}</span>
                    </div>
                    <p className={`text-xs mt-1 ${isOnline ? 'text-green-600 font-medium' : 'text-gray-500'}`}>
                      {isOnline ? 'En ligne' : timeAgo}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Activity log */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <Activity className="w-5 h-5 text-gray-500" />
                Historique d'activite
              </h3>
              <select
                value={activityFilter}
                onChange={e => setActivityFilter(e.target.value)}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
              >
                <option value="all">Tous les utilisateurs</option>
                {state.commerciaux.map(c => (
                  <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
                ))}
              </select>
            </div>

            {activityLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : activityLog.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                <p className="text-sm text-gray-500">Aucune activite enregistree</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
                {activityLog.map(entry => {
                  const actionLabels: Record<string, { label: string; color: string; icon: string }> = {
                    connexion: { label: 'Connexion', color: 'text-blue-700 bg-blue-100', icon: '🔑' },
                    creation_prospect: { label: 'Nouveau prospect', color: 'text-purple-700 bg-purple-100', icon: '🆕' },
                    modification_prospect: { label: 'Modif. prospect', color: 'text-orange-700 bg-orange-100', icon: '✏️' },
                    appel: { label: 'Appel', color: 'text-green-700 bg-green-100', icon: '📞' },
                    creation_rdv: { label: 'Nouveau RDV', color: 'text-indigo-700 bg-indigo-100', icon: '📅' },
                    modification_rdv: { label: 'Modif. RDV', color: 'text-yellow-700 bg-yellow-100', icon: '📝' },
                    compte_rendu_rdv: { label: 'Compte rendu', color: 'text-teal-700 bg-teal-100', icon: '📋' },
                    creation_client: { label: 'Nouveau client', color: 'text-emerald-700 bg-emerald-100', icon: '🏢' },
                    visite_client: { label: 'Visite client', color: 'text-cyan-700 bg-cyan-100', icon: '🚗' },
                  };
                  const info = actionLabels[entry.action] || { label: entry.action, color: 'text-gray-700 bg-gray-100', icon: '•' };
                  const date = new Date(entry.created_at);
                  return (
                    <div key={entry.id} className="px-4 py-3 flex items-start gap-3 hover:bg-gray-50">
                      <span className="text-lg flex-shrink-0 mt-0.5">{info.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-gray-800">{entry.prenom} {entry.nom}</span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${info.color}`}>{info.label}</span>
                        </div>
                        {entry.details && (
                          <p className="text-xs text-gray-600 mt-0.5 truncate">{entry.details}</p>
                        )}
                      </div>
                      <span className="text-[10px] text-gray-400 flex-shrink-0 whitespace-nowrap">
                        {date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} {date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
