import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';
import {
  ListTodo, Plus, Edit2, Trash2, Save, X, RefreshCw, Filter,
  AlertTriangle, CheckCircle2, Clock, ChevronDown, ChevronRight,
  User, Building2, Calendar, Flag, Search, Loader2,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import { toLocalDateStr } from '../utils/helpers';

interface Task {
  id: string;
  titre: string;
  description: string;
  statut: string;
  priorite: string;
  categorie: string;
  date_echeance: string | null;
  commercial_id: string | null;
  client_id: string | null;
  created_by: string;
  date_creation: string;
  completed_at: string | null;
  client_nom?: string;
  commercial_prenom?: string;
  commercial_nom?: string;
  creator_prenom?: string;
}

const STATUT_CONFIG: Record<string, { label: string; color: string; bg: string; icon: typeof Clock }> = {
  A_FAIRE: { label: 'A faire', color: 'text-amber-700', bg: 'bg-amber-100', icon: Clock },
  EN_COURS: { label: 'En cours', color: 'text-blue-700', bg: 'bg-blue-100', icon: RefreshCw },
  TERMINEE: { label: 'Terminee', color: 'text-green-700', bg: 'bg-green-100', icon: CheckCircle2 },
};

const PRIORITE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  HAUTE: { label: 'Haute', color: 'text-red-700', bg: 'bg-red-100' },
  MOYENNE: { label: 'Moyenne', color: 'text-amber-700', bg: 'bg-amber-100' },
  BASSE: { label: 'Basse', color: 'text-gray-600', bg: 'bg-gray-100' },
};

const CATEGORIES: Record<string, string> = {
  general: 'General',
  tournee: 'Tournee / Visite',
  prospection: 'Prospection',
  administratif: 'Administratif',
  livraison: 'Livraison',
  evenement: 'Evenement',
  autre: 'Autre',
};

interface ClientOption {
  id: string;
  nom: string;
}

const emptyForm = {
  titre: '',
  description: '',
  statut: 'A_FAIRE',
  priorite: 'MOYENNE',
  categorie: 'general',
  date_echeance: '',
  commercial_id: '',
  client_id: '',
};

export default function TasksPage() {
  const { state } = useApp();
  const toast = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [search, setSearch] = usePersistedState('tasks_search', '');
  const [filterStatut, setFilterStatut] = usePersistedState<string>('tasks_filterStatut', 'all');
  const [filterAssignee, setFilterAssignee] = usePersistedState<string>('tasks_filterAssignee', 'all');
  const [filterPriorite, setFilterPriorite] = usePersistedState<string>('tasks_filterPriorite', 'all');
  const [showCompleted, setShowCompleted] = usePersistedState('tasks_showCompleted', false);
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  const isAdmin = state.currentUser?.role === 'admin';
  const currentUserId = state.currentUser?.id;
  const token = localStorage.getItem('suivipro_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const [tasksRes, clientsRes] = await Promise.all([
        fetch('/api/tasks-client', { headers }),
        fetch('/api/clients', { headers }),
      ]);
      if (tasksRes.ok) setTasks(await tasksRes.json());
      if (clientsRes.ok) {
        const all = await clientsRes.json();
        setClients(all.map((c: any) => ({ id: c.id, nom: c.nom })).sort((a: ClientOption, b: ClientOption) => a.nom.localeCompare(b.nom)));
      }
    } catch {
      toast.error('Erreur chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const openNewTask = () => {
    setEditingTask(null);
    setForm({ ...emptyForm, commercial_id: '' });
    setShowForm(true);
  };

  const openEditTask = (task: Task) => {
    setEditingTask(task);
    setForm({
      titre: task.titre,
      description: task.description,
      statut: task.statut,
      priorite: task.priorite,
      categorie: task.categorie || 'general',
      date_echeance: task.date_echeance || '',
      commercial_id: task.commercial_id || '',
      client_id: task.client_id || '',
    });
    setShowForm(true);
  };

  const saveTask = async () => {
    if (!form.titre.trim()) { toast.warning('Le titre est requis'); return; }
    setSaving(true);
    try {
      const url = editingTask ? `/api/tasks-client/${editingTask.id}` : '/api/tasks-client';
      const method = editingTask ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify({
          ...form,
          date_echeance: form.date_echeance || null,
          commercial_id: form.commercial_id || currentUserId,
          client_id: form.client_id || null,
        }),
      });
      if (res.ok) {
        toast.success(editingTask ? 'Tache modifiee' : 'Tache creee');
        setShowForm(false);
        loadTasks();
      }
    } catch {
      toast.error('Erreur sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatut = async (task: Task) => {
    const nextStatut = task.statut === 'A_FAIRE' ? 'EN_COURS' : task.statut === 'EN_COURS' ? 'TERMINEE' : 'A_FAIRE';
    try {
      const res = await fetch(`/api/tasks-client/${task.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ ...task, statut: nextStatut }),
      });
      if (res.ok) {
        const updated = await res.json();
        setTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...updated } : t));
        if (nextStatut === 'TERMINEE') toast.success('Tache terminee !');
      }
    } catch {
      toast.error('Erreur');
    }
  };

  const deleteTask = async (taskId: string) => {
    if (!confirm('Supprimer cette tache ?')) return;
    try {
      await fetch(`/api/tasks-client/${taskId}`, { method: 'DELETE', headers });
      setTasks(prev => prev.filter(t => t.id !== taskId));
      toast.success('Tache supprimee');
    } catch {
      toast.error('Erreur suppression');
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedTasks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Filtered tasks
  const filtered = useMemo(() => {
    let result = tasks;

    // Hide completed by default
    if (!showCompleted) result = result.filter(t => t.statut !== 'TERMINEE');

    if (filterStatut !== 'all') result = result.filter(t => t.statut === filterStatut);
    if (filterPriorite !== 'all') result = result.filter(t => t.priorite === filterPriorite);

    if (filterAssignee === 'me') result = result.filter(t => t.commercial_id === currentUserId);
    else if (filterAssignee === 'unassigned') result = result.filter(t => !t.commercial_id);
    else if (filterAssignee !== 'all') result = result.filter(t => t.commercial_id === filterAssignee);

    if (search) {
      const s = search.toLowerCase();
      result = result.filter(t =>
        t.titre.toLowerCase().includes(s) ||
        t.description.toLowerCase().includes(s) ||
        t.client_nom?.toLowerCase().includes(s) ||
        t.commercial_prenom?.toLowerCase().includes(s)
      );
    }

    return result;
  }, [tasks, filterStatut, filterAssignee, filterPriorite, showCompleted, search, currentUserId]);

  // Stats
  const stats = useMemo(() => {
    const today = toLocalDateStr(new Date());
    const myTasks = tasks.filter(t => t.commercial_id === currentUserId);
    return {
      total: tasks.filter(t => t.statut !== 'TERMINEE').length,
      myPending: myTasks.filter(t => t.statut !== 'TERMINEE').length,
      overdue: tasks.filter(t => t.statut !== 'TERMINEE' && t.date_echeance && t.date_echeance < today).length,
      completedThisMonth: tasks.filter(t => {
        if (t.statut !== 'TERMINEE' || !t.completed_at) return false;
        const month = new Date().toISOString().slice(0, 7);
        return t.completed_at.startsWith(month);
      }).length,
    };
  }, [tasks, currentUserId]);

  const formatDate = (d: string | null) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const isOverdue = (task: Task) => {
    if (!task.date_echeance || task.statut === 'TERMINEE') return false;
    return task.date_echeance < toLocalDateStr(new Date());
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Chargement...</span>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 fade-in max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ListTodo className="w-5 h-5 sm:w-6 sm:h-6" />
            Taches
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            Gestion des taches de l'equipe
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadTasks} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            <RefreshCw className="w-4 h-4" />
          </button>
          {isAdmin && (
            <button
              onClick={openNewTask}
              className="px-3 py-2 sm:px-4 bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2 text-sm font-medium"
            >
              <Plus className="w-4 h-4" /> Nouvelle tache
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-2xl font-bold text-indigo-600">{stats.total}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">En cours / A faire</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-2xl font-bold text-brewery-600">{stats.myPending}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">Mes taches</p>
        </div>
        <div className={`rounded-xl border p-3 text-center ${stats.overdue > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
          <p className={`text-2xl font-bold ${stats.overdue > 0 ? 'text-red-600' : 'text-gray-400'}`}>{stats.overdue}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">En retard</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{stats.completedThisMonth}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">Terminees ce mois</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-3">
        <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
          <Filter className="w-3.5 h-3.5" /> Filtres
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm"
              placeholder="Rechercher..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Statut filter */}
          <select
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            value={filterStatut}
            onChange={e => setFilterStatut(e.target.value)}
          >
            <option value="all">Tout statut</option>
            <option value="A_FAIRE">A faire</option>
            <option value="EN_COURS">En cours</option>
          </select>

          {/* Priority filter */}
          <select
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            value={filterPriorite}
            onChange={e => setFilterPriorite(e.target.value)}
          >
            <option value="all">Toute priorite</option>
            <option value="HAUTE">Haute</option>
            <option value="MOYENNE">Moyenne</option>
            <option value="BASSE">Basse</option>
          </select>

          {/* Assignee filter */}
          <select
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            value={filterAssignee}
            onChange={e => setFilterAssignee(e.target.value)}
          >
            <option value="all">Tout le monde</option>
            <option value="me">Mes taches</option>
            {state.commerciaux.map(c => (
              <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
            ))}
          </select>

          {/* Show completed toggle */}
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
              showCompleted
                ? 'bg-green-50 border-green-300 text-green-700'
                : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 inline mr-1" />
            Terminees
          </button>
        </div>
      </div>

      {/* Task form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-lg">
                {editingTask ? 'Modifier la tache' : 'Nouvelle tache'}
              </h3>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Titre */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Titre *</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={form.titre}
                  onChange={e => setForm(prev => ({ ...prev, titre: e.target.value }))}
                  placeholder="Ex: Relancer client X pour commande..."
                  autoFocus
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  rows={3}
                  value={form.description}
                  onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Details de la tache..."
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Priorite */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Priorite</label>
                  <div className="flex gap-1">
                    {Object.entries(PRIORITE_CONFIG).map(([key, cfg]) => (
                      <button
                        key={key}
                        onClick={() => setForm(prev => ({ ...prev, priorite: key }))}
                        className={`flex-1 px-2 py-2 rounded-lg text-xs font-medium border transition-colors ${
                          form.priorite === key
                            ? `${cfg.bg} ${cfg.color} border-current`
                            : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        {cfg.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Categorie */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Categorie</label>
                  <select
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                    value={form.categorie}
                    onChange={e => setForm(prev => ({ ...prev, categorie: e.target.value }))}
                  >
                    {Object.entries(CATEGORIES).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Echeance */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Echeance</label>
                  <input
                    type="date"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    value={form.date_echeance}
                    onChange={e => setForm(prev => ({ ...prev, date_echeance: e.target.value }))}
                  />
                </div>

                {/* Statut (only when editing) */}
                {editingTask && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Statut</label>
                    <select
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                      value={form.statut}
                      onChange={e => setForm(prev => ({ ...prev, statut: e.target.value }))}
                    >
                      {Object.entries(STATUT_CONFIG).map(([key, cfg]) => (
                        <option key={key} value={key}>{cfg.label}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Assignee */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Assigner a</label>
                <select
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                  value={form.commercial_id}
                  onChange={e => setForm(prev => ({ ...prev, commercial_id: e.target.value }))}
                >
                  <option value="">-- Selectionner --</option>
                  {state.commerciaux.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.prenom} {c.nom} ({c.role === 'admin' ? 'Admin' : c.role === 'prospection' ? 'Prospection' : 'Commercial'})
                    </option>
                  ))}
                </select>
              </div>

              {/* Client (optional) */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Client lie <span className="text-gray-400 font-normal">(optionnel)</span>
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                  value={form.client_id}
                  onChange={e => setForm(prev => ({ ...prev, client_id: e.target.value }))}
                >
                  <option value="">Aucun client</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.nom}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">
                Annuler
              </button>
              <button
                onClick={saveTask}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-brewery-600 hover:bg-brewery-700 rounded-lg flex items-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editingTask ? 'Modifier' : 'Creer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task list */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <ListTodo className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">
              {search || filterStatut !== 'all' || filterAssignee !== 'all'
                ? 'Aucune tache ne correspond aux filtres'
                : 'Aucune tache en cours'}
            </p>
          </div>
        )}

        {filtered.map(task => {
          const statutCfg = STATUT_CONFIG[task.statut] || STATUT_CONFIG.A_FAIRE;
          const prioriteCfg = PRIORITE_CONFIG[task.priorite] || PRIORITE_CONFIG.MOYENNE;
          const overdue = isOverdue(task);
          const isExpanded = expandedTasks.has(task.id);
          const isDone = task.statut === 'TERMINEE';
          const canEdit = isAdmin || task.commercial_id === currentUserId;

          return (
            <div
              key={task.id}
              className={`bg-white rounded-xl border transition-shadow ${
                overdue ? 'border-red-300 bg-red-50/30' : isDone ? 'border-gray-200 opacity-60' : 'border-gray-200 hover:shadow-sm'
              }`}
            >
              <div className="flex items-start gap-3 px-3 sm:px-4 py-3">
                {/* Status toggle button */}
                <button
                  onClick={() => canEdit && toggleStatut(task)}
                  disabled={!canEdit}
                  className={`mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    isDone
                      ? 'bg-green-500 border-green-500 text-white'
                      : task.statut === 'EN_COURS'
                        ? 'bg-blue-500 border-blue-500 text-white'
                        : 'border-gray-300 hover:border-brewery-400'
                  }`}
                  title={`Statut: ${statutCfg.label} — Cliquer pour changer`}
                >
                  {isDone && <CheckCircle2 className="w-3.5 h-3.5" />}
                  {task.statut === 'EN_COURS' && <RefreshCw className="w-3 h-3" />}
                </button>

                {/* Main content */}
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleExpand(task.id)}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className={`font-medium text-sm ${isDone ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                      {task.titre}
                    </h4>
                    {overdue && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full font-medium">
                        <AlertTriangle className="w-3 h-3" /> En retard
                      </span>
                    )}
                  </div>

                  {/* Meta badges */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${prioriteCfg.bg} ${prioriteCfg.color}`}>
                      <Flag className="w-2.5 h-2.5" /> {prioriteCfg.label}
                    </span>
                    <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statutCfg.bg} ${statutCfg.color}`}>
                      {statutCfg.label}
                    </span>
                    {task.categorie && task.categorie !== 'general' && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded-full font-medium">
                        {CATEGORIES[task.categorie] || task.categorie}
                      </span>
                    )}
                    {task.commercial_prenom && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded-full font-medium">
                        <User className="w-2.5 h-2.5" /> {task.commercial_prenom}
                      </span>
                    )}
                    {task.client_nom && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded-full font-medium">
                        <Building2 className="w-2.5 h-2.5" /> {task.client_nom}
                      </span>
                    )}
                    {task.date_echeance && (
                      <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        overdue ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        <Calendar className="w-2.5 h-2.5" /> {formatDate(task.date_echeance)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Expand arrow */}
                <button onClick={() => toggleExpand(task.id)} className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0">
                  {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="px-3 sm:px-4 pb-3 sm:pb-4 pt-0 border-t border-gray-100 mt-0">
                  <div className="pt-3 space-y-2">
                    {task.description && (
                      <p className="text-sm text-gray-600 whitespace-pre-wrap">{task.description}</p>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                      <span>Creee le {formatDate(task.date_creation)}</span>
                      {task.creator_prenom && <span>par {task.creator_prenom}</span>}
                      {task.completed_at && <span>Terminee le {formatDate(task.completed_at)}</span>}
                    </div>
                    {canEdit && (
                      <div className="flex gap-2 pt-2">
                        <button
                          onClick={() => openEditTask(task)}
                          className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-1"
                        >
                          <Edit2 className="w-3 h-3" /> Modifier
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => deleteTask(task.id)}
                            className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg flex items-center gap-1"
                          >
                            <Trash2 className="w-3 h-3" /> Supprimer
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
