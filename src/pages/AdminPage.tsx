import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Settings, Users, Target, TrendingUp, Tag, Plus, X, Save, Edit2,
  Trash2, BarChart3, Phone, Calendar, Award, Shield, User, Eye, EyeOff, Key,
  Building2, Link2, RefreshCw, Check, AlertCircle, Loader2, MapPin, Activity, Clock,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
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
  const { state, dispatch } = useApp();
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

  const loadEasyBeerData = async () => {
    try {
      const token = localStorage.getItem('suivipro_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const [configRes, pendingRes, rulesRes, logsRes] = await Promise.all([
        fetch('/api/easybeer/config', { headers }),
        fetch('/api/easybeer/pending-clients', { headers }),
        fetch('/api/assignment-rules', { headers }),
        fetch('/api/easybeer/webhook-logs', { headers }),
      ]);
      if (configRes.ok) {
        const config = await configRes.json();
        setEbConfig({ username: config.username || '', password: config.password || '', api_url: config.api_url || 'https://api.easybeer.fr', webhook_secret: config.webhook_secret || '' });
      }
      if (pendingRes.ok) setEbPending(await pendingRes.json());
      if (rulesRes.ok) setAssignmentRules(await rulesRes.json());
      if (logsRes.ok) setWebhookLogs(await logsRes.json());
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

  const saveUser = () => {
    if (!userForm.prenom || !userForm.email) return;

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
      dispatch({ type: 'UPDATE_COMMERCIAL', payload: updated });
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
      dispatch({ type: 'ADD_COMMERCIAL', payload: newUser });
    }
    setShowUserForm(false);
  };

  const deleteUser = (user: Commercial) => {
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
      dispatch({ type: 'DELETE_COMMERCIAL', payload: user.id });
    }
  };

  // ============================================
  // Objectives
  // ============================================

  const startEditObjectives = (commercial: Commercial) => {
    setEditingObjectives(commercial.id);
    setObjectivesForm({ ...commercial.objectifs });
  };

  const saveObjectives = () => {
    if (!editingObjectives) return;
    const commercial = state.commerciaux.find(c => c.id === editingObjectives);
    if (commercial) {
      dispatch({
        type: 'UPDATE_COMMERCIAL',
        payload: { ...commercial, objectifs: objectivesForm },
      });
    }
    setEditingObjectives(null);
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

  const saveTag = () => {
    if (!tagForm.nom) return;
    if (editingTag) {
      dispatch({ type: 'UPDATE_TAG', payload: { ...editingTag, ...tagForm } });
    } else {
      dispatch({ type: 'ADD_TAG', payload: { id: generateId('tag'), ...tagForm } });
    }
    setShowTagForm(false);
  };

  const deleteTag = (id: string) => {
    if (confirm('Supprimer ce tag ?')) {
      dispatch({ type: 'DELETE_TAG', payload: id });
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
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {client.commercial_email && (
                          <p className="text-[10px] text-gray-400">Commercial: {client.commercial_email}</p>
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

          {/* Journal des webhooks */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> Journal des webhooks ({webhookLogs.length})
              </h3>
              <button
                className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg flex items-center gap-1"
                onClick={loadEasyBeerData}
              >
                <RefreshCw className="w-3.5 h-3.5" /> Rafraichir
              </button>
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
                      <div className="flex items-start gap-2 p-2 bg-blue-50 border border-blue-100 rounded-lg mb-3 text-xs text-blue-800">
                        <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        <p>{config.tournee_info}</p>
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
