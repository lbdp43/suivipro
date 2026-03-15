// ============================================
// Hub Bridge — Bidirectional postMessage protocol
// Allows Claude AI (in Hub iframe) to read/write SuiviPro data
// ============================================

import type { AppState, Prospect, Appointment, Call, Reminder, PipelineStage, Client, Interaction, TaskClient, Commande } from '../types';

// ============================================
// Protocol types
// ============================================

export interface SuiviProRequest {
  type: 'SUIVIPRO_REQUEST';
  requestId: string;
  action: string;
  payload: Record<string, unknown>;
}

export interface SuiviProResponse {
  type: 'SUIVIPRO_RESPONSE';
  requestId: string;
  success?: boolean;
  needs_confirmation?: boolean;
  description?: string;
  error?: string;
  [key: string]: unknown;
}

type ActionResult = { success?: boolean; error?: string; needs_confirmation?: boolean; description?: string; [key: string]: unknown };
type Dispatch = React.Dispatch<any>;

// ============================================
// Action whitelist
// ============================================

const READ_ACTIONS = new Set([
  'GET_PROSPECTS',
  'GET_PROSPECT',
  'GET_APPOINTMENTS',
  'GET_UPCOMING_APPOINTMENTS',
  'GET_REMINDERS',
  'GET_PIPELINE_STAGES',
  'GET_STATS',
  'SEARCH_PROSPECTS',
  'GET_CURRENT_USER',
  // Clients
  'GET_CLIENTS',
  'GET_CLIENT',
  'SEARCH_CLIENTS',
  'GET_CLIENTS_LATE_VISITS',
  // Interactions / Visites
  'GET_INTERACTIONS',
  'GET_CLIENT_INTERACTIONS',
  // Tasks
  'GET_TASKS',
  'GET_CLIENT_TASKS',
  // Commandes
  'GET_COMMANDES',
  'GET_CLIENT_COMMANDES',
  // Tournees
  'GET_TOURNEE_CONFIGS',
  // Annuaire
  'GET_ANNUAIRE',
  // Commerciaux
  'GET_COMMERCIAUX',
]);

const WRITE_ACTIONS = new Set([
  'CREATE_PROSPECT',
  'CREATE_APPOINTMENT',
]);

// ============================================
// Read action handlers
// ============================================

function handleGetProspects(payload: Record<string, unknown>, state: AppState): ActionResult {
  let prospects = state.prospects;

  if (payload.etape_pipeline) {
    prospects = prospects.filter(p => p.etape_pipeline === payload.etape_pipeline);
  }
  if (payload.search && typeof payload.search === 'string') {
    const q = payload.search.toLowerCase();
    prospects = prospects.filter(p =>
      p.nom_etablissement.toLowerCase().includes(q) ||
      p.nom_contact.toLowerCase().includes(q) ||
      p.email.toLowerCase().includes(q) ||
      p.telephone.includes(q) ||
      p.ville.toLowerCase().includes(q)
    );
  }

  return { success: true, prospects: prospects.map(sanitizeProspect) };
}

function handleGetProspect(payload: Record<string, unknown>, state: AppState): ActionResult {
  const id = payload.prospect_id as string;
  if (!id) return { success: false, error: 'prospect_id requis' };

  const prospect = state.prospects.find(p => p.id === id);
  if (!prospect) return { success: false, error: 'Prospect introuvable' };

  return {
    success: true,
    prospect: sanitizeProspect(prospect),
    calls: state.calls.filter(c => c.prospect_id === id),
    appointments: state.appointments.filter(a => a.prospect_id === id),
    reminders: state.reminders.filter(r => r.prospect_id === id),
  };
}

function handleGetAppointments(payload: Record<string, unknown>, state: AppState): ActionResult {
  let appointments = state.appointments;

  if (payload.prospect_id) {
    appointments = appointments.filter(a => a.prospect_id === payload.prospect_id);
  }
  if (payload.date_from && typeof payload.date_from === 'string') {
    appointments = appointments.filter(a => a.date >= (payload.date_from as string));
  }
  if (payload.date_to && typeof payload.date_to === 'string') {
    appointments = appointments.filter(a => a.date <= (payload.date_to as string));
  }

  return { success: true, appointments };
}

function handleGetUpcomingAppointments(payload: Record<string, unknown>, state: AppState): ActionResult {
  const limit = typeof payload.limit === 'number' ? payload.limit : 10;
  const today = new Date().toISOString().slice(0, 10);

  const upcoming = state.appointments
    .filter(a => a.date >= today && a.statut !== 'annule')
    .sort((a, b) => a.date.localeCompare(b.date) || a.heure_debut.localeCompare(b.heure_debut))
    .slice(0, limit)
    .map(a => {
      const prospect = state.prospects.find(p => p.id === a.prospect_id);
      return {
        ...a,
        prospect_nom: prospect?.nom_etablissement || 'Inconnu',
        prospect_ville: prospect?.ville || '',
      };
    });

  return { success: true, appointments: upcoming };
}

function handleGetReminders(payload: Record<string, unknown>, state: AppState): ActionResult {
  let reminders = state.reminders;

  if (payload.prospect_id) {
    reminders = reminders.filter(r => r.prospect_id === payload.prospect_id);
  }
  if (payload.statut) {
    reminders = reminders.filter(r => r.statut === payload.statut);
  }

  return { success: true, reminders };
}

function handleGetPipelineStages(state: AppState): ActionResult {
  return { success: true, stages: state.pipelineColumns };
}

function handleGetStats(state: AppState): ActionResult {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  return {
    success: true,
    stats: {
      total_prospects: state.prospects.length,
      prospects_par_etape: state.pipelineColumns.map(col => ({
        etape: col.id,
        label: col.label,
        count: state.prospects.filter(p => p.etape_pipeline === col.id).length,
      })),
      rdv_ce_mois: state.appointments.filter(a => a.date.startsWith(thisMonth)).length,
      rappels_actifs: state.reminders.filter(r => r.statut === 'actif').length,
      appels_ce_mois: state.calls.filter(c => c.date.startsWith(thisMonth)).length,
    },
  };
}

function handleSearchProspects(payload: Record<string, unknown>, state: AppState): ActionResult {
  const query = payload.query as string;
  if (!query) return { success: false, error: 'query requis' };

  const q = query.toLowerCase();
  const results = state.prospects.filter(p =>
    p.nom_etablissement.toLowerCase().includes(q) ||
    p.nom_contact.toLowerCase().includes(q) ||
    p.email.toLowerCase().includes(q) ||
    p.telephone.includes(q) ||
    p.ville.toLowerCase().includes(q) ||
    p.adresse.toLowerCase().includes(q)
  );

  return { success: true, prospects: results.map(sanitizeProspect) };
}

function handleGetCurrentUser(state: AppState): ActionResult {
  if (!state.currentUser) return { success: false, error: 'Non connecte' };
  const { password, ...safe } = state.currentUser;
  return { success: true, user: safe };
}

// ============================================
// Client read handlers
// ============================================

function sanitizeClient(c: Client) {
  return {
    id: c.id, nom: c.nom, ville: c.ville, adresse: c.adresse, code_postal: c.code_postal,
    telephone: c.telephone, telephone_mobile: c.telephone_mobile, email: c.email, contact: c.contact,
    type_client: c.type_client, statut: c.statut, commercial_id: c.commercial_id,
    next_visit: c.next_visit, last_visit: c.last_visit, tournee: c.tournee,
    notes: c.notes, siret: c.siret, date_creation: c.date_creation, date_modification: c.date_modification,
  };
}

function handleGetClients(payload: Record<string, unknown>, state: AppState): ActionResult {
  let clients = state.clients;
  if (payload.statut) clients = clients.filter(c => c.statut === payload.statut);
  if (payload.type_client) clients = clients.filter(c => c.type_client === payload.type_client);
  if (payload.commercial_id) clients = clients.filter(c => c.commercial_id === payload.commercial_id);
  if (payload.tournee) clients = clients.filter(c => c.tournee === payload.tournee);
  if (payload.search && typeof payload.search === 'string') {
    const q = payload.search.toLowerCase();
    clients = clients.filter(c =>
      c.nom.toLowerCase().includes(q) || c.ville.toLowerCase().includes(q) ||
      c.contact.toLowerCase().includes(q) || c.telephone.includes(q) || c.email.toLowerCase().includes(q)
    );
  }
  return { success: true, clients: clients.map(sanitizeClient) };
}

function handleGetClient(payload: Record<string, unknown>, state: AppState): ActionResult {
  const id = payload.client_id as string;
  if (!id) return { success: false, error: 'client_id requis' };
  const client = state.clients.find(c => c.id === id);
  if (!client) return { success: false, error: 'Client introuvable' };
  return {
    success: true,
    client: sanitizeClient(client),
    interactions: state.interactions.filter(i => i.client_id === id),
    tasks: state.tasksClient.filter(t => t.client_id === id),
    commandes: state.commandes.filter(co => co.client_id === id),
  };
}

function handleSearchClients(payload: Record<string, unknown>, state: AppState): ActionResult {
  const query = payload.query as string;
  if (!query) return { success: false, error: 'query requis' };
  const q = query.toLowerCase();
  const results = state.clients.filter(c =>
    c.nom.toLowerCase().includes(q) || c.ville.toLowerCase().includes(q) ||
    c.contact.toLowerCase().includes(q) || c.telephone.includes(q) ||
    c.email.toLowerCase().includes(q) || c.tournee.toLowerCase().includes(q)
  );
  return { success: true, clients: results.map(sanitizeClient) };
}

function handleGetClientsLateVisits(payload: Record<string, unknown>, state: AppState): ActionResult {
  const today = new Date().toISOString().split('T')[0];
  let clients = state.clients.filter(c => c.statut === 'ACTIF' && c.next_visit && c.next_visit < today);
  if (payload.commercial_id) clients = clients.filter(c => c.commercial_id === payload.commercial_id);
  if (payload.tournee) clients = clients.filter(c => c.tournee === payload.tournee);
  clients.sort((a, b) => (a.next_visit || '').localeCompare(b.next_visit || ''));
  return { success: true, clients: clients.map(sanitizeClient) };
}

function handleGetInteractions(payload: Record<string, unknown>, state: AppState): ActionResult {
  let interactions = state.interactions;
  if (payload.client_id) interactions = interactions.filter(i => i.client_id === payload.client_id);
  if (payload.type) interactions = interactions.filter(i => i.type === payload.type);
  if (payload.commercial_id) interactions = interactions.filter(i => i.commercial_id === payload.commercial_id);
  if (payload.date_from && typeof payload.date_from === 'string') interactions = interactions.filter(i => i.date >= (payload.date_from as string));
  if (payload.date_to && typeof payload.date_to === 'string') interactions = interactions.filter(i => i.date <= (payload.date_to as string));
  interactions = [...interactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
  return { success: true, interactions };
}

function handleGetClientInteractions(payload: Record<string, unknown>, state: AppState): ActionResult {
  const id = payload.client_id as string;
  if (!id) return { success: false, error: 'client_id requis' };
  const client = state.clients.find(c => c.id === id);
  if (!client) return { success: false, error: 'Client introuvable' };
  const interactions = state.interactions.filter(i => i.client_id === id).sort((a, b) => b.date.localeCompare(a.date));
  return { success: true, client_nom: client.nom, interactions };
}

function handleGetTasks(payload: Record<string, unknown>, state: AppState): ActionResult {
  let tasks = state.tasksClient;
  if (payload.statut) tasks = tasks.filter(t => t.statut === payload.statut);
  if (payload.client_id) tasks = tasks.filter(t => t.client_id === payload.client_id);
  if (payload.commercial_id) tasks = tasks.filter(t => t.commercial_id === payload.commercial_id);
  return { success: true, tasks };
}

function handleGetClientTasks(payload: Record<string, unknown>, state: AppState): ActionResult {
  const id = payload.client_id as string;
  if (!id) return { success: false, error: 'client_id requis' };
  return { success: true, tasks: state.tasksClient.filter(t => t.client_id === id) };
}

function handleGetCommandes(payload: Record<string, unknown>, state: AppState): ActionResult {
  let commandes = state.commandes;
  if (payload.client_id) commandes = commandes.filter(co => co.client_id === payload.client_id);
  if (payload.statut) commandes = commandes.filter(co => co.statut === payload.statut);
  commandes = [...commandes].sort((a, b) => b.date_commande.localeCompare(a.date_commande)).slice(0, 50);
  return { success: true, commandes };
}

function handleGetClientCommandes(payload: Record<string, unknown>, state: AppState): ActionResult {
  const id = payload.client_id as string;
  if (!id) return { success: false, error: 'client_id requis' };
  return { success: true, commandes: state.commandes.filter(co => co.client_id === id) };
}

function handleGetTourneeConfigs(state: AppState): ActionResult {
  // Tournee configs are not in AppState, delegate to server
  return { success: false, error: 'Action disponible uniquement via le bridge HTTP serveur' };
}

function handleGetAnnuaire(payload: Record<string, unknown>, state: AppState): ActionResult {
  // Annuaire combines prospects + clients. Provide a unified search from state.
  const query = payload.search as string;
  let results: any[] = [];
  if (query) {
    const q = query.toLowerCase();
    const matchedProspects = state.prospects.filter(p =>
      p.nom_etablissement.toLowerCase().includes(q) || p.ville.toLowerCase().includes(q) || p.telephone.includes(q)
    ).slice(0, 50).map(p => ({ ...sanitizeProspect(p), source: 'prospect' }));
    const matchedClients = state.clients.filter(c =>
      c.nom.toLowerCase().includes(q) || c.ville.toLowerCase().includes(q) || c.telephone.includes(q)
    ).slice(0, 50).map(c => ({ ...sanitizeClient(c), source: 'client' }));
    results = [...matchedProspects, ...matchedClients];
  } else {
    results = [
      ...state.prospects.slice(0, 100).map(p => ({ ...sanitizeProspect(p), source: 'prospect' })),
      ...state.clients.slice(0, 100).map(c => ({ ...sanitizeClient(c), source: 'client' })),
    ];
  }
  return { success: true, entries: results, total: state.prospects.length + state.clients.length };
}

function handleGetCommerciaux(state: AppState): ActionResult {
  return {
    success: true,
    commerciaux: state.commerciaux.map(c => ({
      id: c.id, nom: c.nom, prenom: c.prenom, email: c.email, role: c.role,
    })),
  };
}

// ============================================
// Write action handlers (restricted: CREATE_PROSPECT + CREATE_APPOINTMENT only)
// ============================================

function handleCreateAppointment(
  payload: Record<string, unknown>,
  state: AppState,
  dispatch: Dispatch,
  confirmed: boolean,
): ActionResult {
  const { prospect_id, date, heure_debut, heure_fin, lieu, notes } = payload as any;
  if (!prospect_id || !date || !heure_debut || !heure_fin) {
    return { success: false, error: 'Champs requis: prospect_id, date, heure_debut, heure_fin' };
  }

  const prospect = state.prospects.find(p => p.id === prospect_id);
  if (!prospect) return { success: false, error: 'Prospect introuvable' };

  const description = `Creer un RDV le ${date} de ${heure_debut} a ${heure_fin} pour "${prospect.nom_etablissement}"`;

  if (!confirmed) {
    return { success: true, needs_confirmation: true, description };
  }

  const id = crypto.randomUUID();
  const appointment: Appointment = {
    id,
    prospect_id: prospect_id as string,
    commercial_id: state.currentUser!.id,
    date: date as string,
    heure_debut: heure_debut as string,
    heure_fin: heure_fin as string,
    lieu: (lieu as string) || '',
    notes: (notes as string) || '',
    statut: 'planifie',
    created_at: new Date().toISOString(),
  };

  dispatch({ type: 'ADD_APPOINTMENT', payload: appointment });
  return { success: true, appointment };
}


// ============================================
// Main handler
// ============================================

export function handleSuiviProAction(
  action: string,
  payload: Record<string, unknown>,
  state: AppState,
  dispatch: Dispatch,
): ActionResult {
  // Check current user for all actions
  if (!state.currentUser) {
    return { success: false, error: 'Non connecte' };
  }

  // Read actions — execute immediately
  if (READ_ACTIONS.has(action)) {
    switch (action) {
      case 'GET_PROSPECTS': return handleGetProspects(payload, state);
      case 'GET_PROSPECT': return handleGetProspect(payload, state);
      case 'GET_APPOINTMENTS': return handleGetAppointments(payload, state);
      case 'GET_UPCOMING_APPOINTMENTS': return handleGetUpcomingAppointments(payload, state);
      case 'GET_REMINDERS': return handleGetReminders(payload, state);
      case 'GET_PIPELINE_STAGES': return handleGetPipelineStages(state);
      case 'GET_STATS': return handleGetStats(state);
      case 'SEARCH_PROSPECTS': return handleSearchProspects(payload, state);
      case 'GET_CURRENT_USER': return handleGetCurrentUser(state);
      // Clients
      case 'GET_CLIENTS': return handleGetClients(payload, state);
      case 'GET_CLIENT': return handleGetClient(payload, state);
      case 'SEARCH_CLIENTS': return handleSearchClients(payload, state);
      case 'GET_CLIENTS_LATE_VISITS': return handleGetClientsLateVisits(payload, state);
      // Interactions / Visites
      case 'GET_INTERACTIONS': return handleGetInteractions(payload, state);
      case 'GET_CLIENT_INTERACTIONS': return handleGetClientInteractions(payload, state);
      // Tasks
      case 'GET_TASKS': return handleGetTasks(payload, state);
      case 'GET_CLIENT_TASKS': return handleGetClientTasks(payload, state);
      // Commandes
      case 'GET_COMMANDES': return handleGetCommandes(payload, state);
      case 'GET_CLIENT_COMMANDES': return handleGetClientCommandes(payload, state);
      // Tournees
      case 'GET_TOURNEE_CONFIGS': return handleGetTourneeConfigs(state);
      // Annuaire
      case 'GET_ANNUAIRE': return handleGetAnnuaire(payload, state);
      // Commerciaux
      case 'GET_COMMERCIAUX': return handleGetCommerciaux(state);
      default: return { success: false, error: 'Action inconnue' };
    }
  }

  // Write actions — only CREATE_PROSPECT and CREATE_APPOINTMENT allowed
  if (WRITE_ACTIONS.has(action)) {
    const confirmed = payload.confirmed === true;

    switch (action) {
      case 'CREATE_APPOINTMENT': return handleCreateAppointment(payload, state, dispatch, confirmed);
      case 'CREATE_PROSPECT':
        return { success: false, error: 'Action disponible uniquement via le bridge HTTP serveur' };
      default: return { success: false, error: 'Action inconnue' };
    }
  }

  return { success: false, error: `Action "${action}" non autorisee` };
}

// ============================================
// Helpers
// ============================================

function sanitizeProspect(p: Prospect) {
  return {
    id: p.id,
    nom_etablissement: p.nom_etablissement,
    type_etablissement: p.type_etablissement,
    nom_contact: p.nom_contact,
    telephone: p.telephone,
    email: p.email,
    adresse: p.adresse,
    ville: p.ville,
    code_postal: p.code_postal,
    departement: p.departement,
    etape_pipeline: p.etape_pipeline,
    notes: p.notes,
    score: p.score,
    date_creation: p.date_creation,
    date_modification: p.date_modification,
  };
}
