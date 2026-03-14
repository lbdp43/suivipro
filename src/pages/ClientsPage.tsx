import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search, Plus, Phone, Mail, MapPin, ChevronRight, ChevronLeft, X,
  Edit2, Trash2, Save, ArrowUpDown, Filter, User, Eye, EyeOff,
  Calendar, CheckCircle2, Clock, AlertTriangle, PhoneCall, Navigation,
  Download, FileSpreadsheet, ListTodo, Check,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import {
  CLIENT_TYPE_LABELS, CLIENT_TYPE_FAMILIES, CLIENT_VISIT_FREQUENCIES,
  ClientType, ClientStatus, Client, InteractionType,
  INTERACTION_TYPE_LABELS, TaskClient, TASK_CLIENT_STATUS_LABELS,
} from '../types';
import { generateId, formatDate } from '../utils/helpers';

type VisitFilter = 'all' | 'late' | 'today' | 'upcoming' | 'no_recurrence';

function getVisitStatus(client: Client): 'LATE' | 'TODAY' | 'UPCOMING' | 'NO_RECURRENCE' | 'INACTIF' {
  if (client.statut === 'INACTIF') return 'INACTIF';
  if (!client.next_visit) return 'NO_RECURRENCE';
  const today = new Date().toISOString().split('T')[0];
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
  const { state, dispatch, getCommercial, getInteractionsForClient, getTasksForClient } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');

  const [searchTerm, setSearchTerm] = useState('');
  const [filterTypes, setFilterTypes] = useState<Set<ClientType>>(new Set());
  const [filterStatus, setFilterStatus] = useState<ClientStatus | ''>('');
  const [filterVisit, setFilterVisit] = useState<VisitFilter>('all');
  const [filterCommercial, setFilterCommercial] = useState<string>('');
  const [filterTournee, setFilterTournee] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [forceCreate, setForceCreate] = useState(false);
  const [sortDate, setSortDate] = useState<'none' | 'recent' | 'ancien'>('none');
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  // Interaction modal
  const [interactionClient, setInteractionClient] = useState<Client | null>(null);
  const [interactionType, setInteractionType] = useState<InteractionType>('VISITE');
  const [interactionComment, setInteractionComment] = useState('');

  // Task modal
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDate, setTaskDate] = useState('');
  const [taskClientId, setTaskClientId] = useState('');

  const isAdmin = state.currentUser?.role === 'admin';

  // Get unique tournees
  const allTournees = useMemo(() => {
    const set = new Set<string>();
    state.clients.forEach(c => { if (c.tournee) set.add(c.tournee); });
    return Array.from(set).sort();
  }, [state.clients]);

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

  const openEditForm = (client: Client) => {
    setEditingClient(client);
    setFormData({ ...client });
    setShowForm(true);
  };

  const saveClient = () => {
    if (!formData.nom?.trim()) return;
    if (!editingClient && !forceCreate && (duplicateClients.length > 0 || duplicateProspects.length > 0)) return;
    const now = new Date().toISOString();

    if (editingClient) {
      const updated: Client = {
        ...editingClient,
        ...formData,
        date_modification: now,
      } as Client;
      dispatch({ type: 'UPDATE_CLIENT', payload: updated });
    } else {
      const freq = formData.custom_recurrence || CLIENT_VISIT_FREQUENCIES[formData.type_client as ClientType];
      let nextVisit: string | null = null;
      if (freq) {
        const d = new Date();
        d.setDate(d.getDate() + freq);
        nextVisit = d.toISOString().split('T')[0];
      }
      const newClient: Client = {
        id: generateId('cli'),
        nom: formData.nom || '',
        ville: formData.ville || '',
        adresse: formData.adresse || '',
        code_postal: formData.code_postal || '',
        telephone: formData.telephone || '',
        telephone_mobile: formData.telephone_mobile || '',
        email: formData.email || '',
        contact: formData.contact || '',
        type_client: (formData.type_client || 'BAR_RESTAURANT_GENERAL') as ClientType,
        statut: (formData.statut || 'ACTIF') as ClientStatus,
        commercial_id: formData.commercial_id || state.currentUser?.id || '',
        next_visit: nextVisit,
        last_visit: null,
        notes: formData.notes || '',
        custom_recurrence: formData.custom_recurrence || null,
        latitude: formData.latitude || 0,
        longitude: formData.longitude || 0,
        siret: formData.siret || '',
        tournee: formData.tournee || '',
        prospect_id: null,
        date_creation: now,
        date_modification: now,
      };
      dispatch({ type: 'ADD_CLIENT', payload: newClient });
    }
    setShowForm(false);
  };

  const deleteClient = (id: string) => {
    if (!confirm('Supprimer ce client ? Cette action est irreversible.')) return;
    dispatch({ type: 'DELETE_CLIENT', payload: id });
    if (selectedId === id) setSearchParams({});
  };

  const toggleStatus = (client: Client) => {
    const updated = {
      ...client,
      statut: client.statut === 'ACTIF' ? 'INACTIF' as ClientStatus : 'ACTIF' as ClientStatus,
      date_modification: new Date().toISOString(),
    };
    if (updated.statut === 'INACTIF') {
      updated.next_visit = null;
    }
    dispatch({ type: 'UPDATE_CLIENT', payload: updated });
  };

  // Mark visit
  const markVisit = (client: Client, type: InteractionType, comment: string) => {
    const now = new Date().toISOString();
    const interaction = {
      id: generateId('int'),
      client_id: client.id,
      commercial_id: state.currentUser?.id || '',
      type,
      date: now,
      comment,
      date_creation: now,
    };
    dispatch({ type: 'ADD_INTERACTION', payload: interaction });
  };

  const submitInteraction = () => {
    if (!interactionClient) return;
    markVisit(interactionClient, interactionType, interactionComment);
    setInteractionClient(null);
    setInteractionComment('');
    setInteractionType('VISITE');
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
      XLSX.writeFile(wb, `clients-${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch { /* ignore */ }
  };

  // Task helpers
  const addTask = () => {
    if (!taskTitle.trim() || !taskClientId) return;
    dispatch({
      type: 'ADD_TASK_CLIENT',
      payload: {
        id: generateId('task'),
        titre: taskTitle.trim(),
        description: '',
        statut: 'A_FAIRE',
        priorite: 'MOYENNE',
        date_echeance: taskDate || null,
        commercial_id: state.currentUser?.id || '',
        client_id: taskClientId,
        date_creation: new Date().toISOString(),
        completed_at: null,
      },
    });
    setShowTaskForm(false);
    setTaskTitle('');
    setTaskDate('');
  };

  const toggleTask = (task: TaskClient) => {
    const isComplete = task.statut === 'TERMINEE';
    dispatch({
      type: 'UPDATE_TASK_CLIENT',
      payload: {
        ...task,
        statut: isComplete ? 'A_FAIRE' : 'TERMINEE',
        completed_at: isComplete ? null : new Date().toISOString(),
      },
    });
  };

  // Filter & sort
  const filtered = useMemo(() => {
    let list = state.clients;

    // Non-admin: only own clients
    if (!isAdmin && state.currentUser) {
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
    if (filterTypes.size > 0) {
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
    if (filterCommercial) {
      list = list.filter(c => c.commercial_id === filterCommercial);
    }
    if (filterTournee) {
      list = list.filter(c => c.tournee === filterTournee);
    }

    if (sortDate === 'recent') {
      list = [...list].sort((a, b) => b.date_modification.localeCompare(a.date_modification));
    } else if (sortDate === 'ancien') {
      list = [...list].sort((a, b) => a.date_modification.localeCompare(b.date_modification));
    }

    return list;
  }, [state.clients, searchTerm, filterTypes, filterStatus, filterVisit, filterCommercial, filterTournee, sortDate, isAdmin, state.currentUser]);

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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
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

              {isAdmin && (
                <select
                  value={filterCommercial}
                  onChange={e => { setFilterCommercial(e.target.value); setCurrentPage(0); }}
                  className="border border-gray-200 rounded-lg text-sm px-2 py-1.5"
                >
                  <option value="">Tous commerciaux</option>
                  {state.commerciaux.map(c => (
                    <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
                  ))}
                </select>
              )}

              <select
                value={filterTournee}
                onChange={e => { setFilterTournee(e.target.value); setCurrentPage(0); }}
                className="border border-gray-200 rounded-lg text-sm px-2 py-1.5"
              >
                <option value="">Toutes tournees</option>
                {allTournees.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          )}

          {/* Visit filter quick buttons */}
          <div className="flex gap-1.5 flex-wrap">
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
            {filterTypes.size > 0 && (
              <button onClick={() => { setFilterTypes(new Set()); setCurrentPage(0); }} className="px-2 py-1 rounded-full text-xs text-red-600 hover:bg-red-50">
                Effacer
              </button>
            )}
          </div>
        </div>

        {/* Client list */}
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
                    onClick={() => setSearchParams({ id: client.id })}
                    className={`px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                      isSelected ? 'bg-brewery-50 border-l-3 border-brewery-600' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Visit status dot */}
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 ${statusConfig.dot}`} title={statusConfig.label} />

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
                      </div>

                      {/* Quick actions */}
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        {(client.telephone || client.telephone_mobile) && (
                          <a
                            href={`tel:${client.telephone_mobile || client.telephone}`}
                            onClick={e => e.stopPropagation()}
                            className="p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
                            title={`Appeler${client.telephone_mobile ? ` (mobile: ${client.telephone_mobile})` : ` (${client.telephone})`}`}
                          >
                            <Phone className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {client.email && (
                          <a
                            href={`mailto:${client.email}`}
                            onClick={e => e.stopPropagation()}
                            className="p-1.5 rounded-lg bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors"
                            title={`Envoyer un email à ${client.email}`}
                          >
                            <Mail className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); setInteractionClient(client); setInteractionType('VISITE'); }}
                          className="p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                          title="Enregistrer une visite"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </button>
                        {(client.latitude && client.longitude) ? (
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${client.latitude},${client.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="p-1.5 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors"
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
                            className="p-1.5 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors"
                            title="Voir sur la carte"
                          >
                            <Navigation className="w-3.5 h-3.5" />
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

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
                <a href={`mailto:${selectedClient.email}`} className="flex items-center gap-2 text-blue-600 hover:text-blue-700">
                  <Mail className="w-3.5 h-3.5" />
                  <span className="truncate">{selectedClient.email}</span>
                </a>
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
                      : CLIENT_VISIT_FREQUENCIES[selectedClient.type_client]
                        ? `${CLIENT_VISIT_FREQUENCIES[selectedClient.type_client]}j`
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
            </div>

            {/* Notes */}
            {selectedClient.notes && (
              <div className="mt-3 p-3 bg-yellow-50 rounded-lg text-xs text-gray-700 border border-yellow-200">
                <p className="font-medium text-yellow-800 mb-1">Notes</p>
                <p className="whitespace-pre-wrap">{selectedClient.notes}</p>
              </div>
            )}
          </div>

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
                        <span className={`text-[10px] flex-shrink-0 ${task.date_echeance < new Date().toISOString().split('T')[0] && task.statut !== 'TERMINEE' ? 'text-red-500' : 'text-gray-400'}`}>
                          {formatDate(task.date_echeance)}
                        </span>
                      )}
                      <button onClick={() => dispatch({ type: 'DELETE_TASK_CLIENT', payload: task.id })} className="flex-shrink-0 p-0.5 rounded hover:bg-red-50">
                        <X className="w-3 h-3 text-gray-400 hover:text-red-500" />
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Interaction history */}
          <div className="flex-1 overflow-y-auto p-4">
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
        <div className="modal-backdrop" onClick={() => setInteractionClient(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">
                {interactionType === 'VISITE' ? 'Marquer une visite' : interactionType === 'APPEL' ? 'Marquer un appel' : 'Planifier un RDV'}
              </h2>
              <p className="text-sm text-gray-500 mt-1">{interactionClient.nom}</p>
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
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Commentaire (optionnel)</label>
                <textarea
                  value={interactionComment}
                  onChange={e => setInteractionComment(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  rows={3}
                  placeholder="Notes sur cette interaction..."
                />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setInteractionClient(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                  Annuler
                </button>
                <button
                  onClick={submitInteraction}
                  className={`flex items-center gap-1.5 px-4 py-2 text-white rounded-lg text-sm font-medium transition-colors ${
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
    </div>
  );
}
