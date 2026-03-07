// ============================================
// Hub Bridge — Bidirectional postMessage protocol
// Allows Claude AI (in Hub iframe) to read/write SuiviPro data
// ============================================

import type { AppState, Prospect, Appointment, Call, Reminder, PipelineStage } from '../types';

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
]);

const WRITE_ACTIONS = new Set([
  'CREATE_APPOINTMENT',
  'UPDATE_APPOINTMENT',
  'CREATE_REMINDER',
  'UPDATE_PROSPECT',
  'MOVE_PROSPECT_STAGE',
  'CREATE_CALL',
  'ADD_PROSPECT_NOTE',
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
// Write action handlers
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

function handleUpdateAppointment(
  payload: Record<string, unknown>,
  state: AppState,
  dispatch: Dispatch,
  confirmed: boolean,
): ActionResult {
  const { id, ...updates } = payload as any;
  if (!id) return { success: false, error: 'id requis' };

  const existing = state.appointments.find(a => a.id === id);
  if (!existing) return { success: false, error: 'RDV introuvable' };

  const prospect = state.prospects.find(p => p.id === existing.prospect_id);
  const parts: string[] = [];
  if (updates.compte_rendu) parts.push(`compte-rendu: ${updates.compte_rendu}`);
  if (updates.notes_compte_rendu) parts.push(`notes de compte-rendu`);
  if (updates.statut) parts.push(`statut: ${updates.statut}`);

  const description = `Modifier le RDV du ${existing.date} pour "${prospect?.nom_etablissement || 'inconnu'}" — ${parts.join(', ') || 'mise a jour'}`;

  if (!confirmed) {
    return { success: true, needs_confirmation: true, description };
  }

  const updated: Appointment = { ...existing, ...updates };
  dispatch({ type: 'UPDATE_APPOINTMENT', payload: updated });
  return { success: true, appointment: updated };
}

function handleCreateReminder(
  payload: Record<string, unknown>,
  state: AppState,
  dispatch: Dispatch,
  confirmed: boolean,
): ActionResult {
  const { prospect_id, date, heure, message } = payload as any;
  if (!prospect_id || !date || !heure || !message) {
    return { success: false, error: 'Champs requis: prospect_id, date, heure, message' };
  }

  const prospect = state.prospects.find(p => p.id === prospect_id);
  if (!prospect) return { success: false, error: 'Prospect introuvable' };

  const description = `Creer un rappel le ${date} a ${heure} pour "${prospect.nom_etablissement}" : "${message}"`;

  if (!confirmed) {
    return { success: true, needs_confirmation: true, description };
  }

  const id = crypto.randomUUID();
  const reminder: Reminder = {
    id,
    prospect_id: prospect_id as string,
    commercial_id: state.currentUser!.id,
    date: date as string,
    heure: heure as string,
    message: message as string,
    statut: 'actif',
  };

  dispatch({ type: 'ADD_REMINDER', payload: reminder });
  return { success: true, reminder };
}

function handleUpdateProspect(
  payload: Record<string, unknown>,
  state: AppState,
  dispatch: Dispatch,
  confirmed: boolean,
): ActionResult {
  const { id, ...updates } = payload as any;
  if (!id) return { success: false, error: 'id requis' };

  const existing = state.prospects.find(p => p.id === id);
  if (!existing) return { success: false, error: 'Prospect introuvable' };

  // Don't allow changing id or commercial_id
  delete updates.id;
  delete updates.commercial_id;

  const changedFields = Object.keys(updates).join(', ');
  const description = `Modifier "${existing.nom_etablissement}" — champs: ${changedFields}`;

  if (!confirmed) {
    return { success: true, needs_confirmation: true, description };
  }

  const updated: Prospect = {
    ...existing,
    ...updates,
    date_modification: new Date().toISOString(),
  };

  dispatch({ type: 'UPDATE_PROSPECT', payload: updated });
  return { success: true, prospect: sanitizeProspect(updated) };
}

function handleMoveProspectStage(
  payload: Record<string, unknown>,
  state: AppState,
  dispatch: Dispatch,
  confirmed: boolean,
): ActionResult {
  const { prospect_id, stage } = payload as any;
  if (!prospect_id || !stage) return { success: false, error: 'prospect_id et stage requis' };

  const prospect = state.prospects.find(p => p.id === prospect_id);
  if (!prospect) return { success: false, error: 'Prospect introuvable' };

  const stageColumn = state.pipelineColumns.find(c => c.id === stage);
  if (!stageColumn) return { success: false, error: `Etape "${stage}" invalide` };

  const description = `Deplacer "${prospect.nom_etablissement}" vers l'etape "${stageColumn.label}"`;

  if (!confirmed) {
    return { success: true, needs_confirmation: true, description };
  }

  dispatch({ type: 'MOVE_PROSPECT', payload: { id: prospect_id, stage: stage as PipelineStage } });
  return { success: true, prospect: { id: prospect_id, etape_pipeline: stage } };
}

function handleCreateCall(
  payload: Record<string, unknown>,
  state: AppState,
  dispatch: Dispatch,
  confirmed: boolean,
): ActionResult {
  const { prospect_id, resultat, notes, duree } = payload as any;
  if (!prospect_id || !resultat) {
    return { success: false, error: 'Champs requis: prospect_id, resultat' };
  }

  const prospect = state.prospects.find(p => p.id === prospect_id);
  if (!prospect) return { success: false, error: 'Prospect introuvable' };

  const description = `Enregistrer un appel "${resultat}" pour "${prospect.nom_etablissement}"`;

  if (!confirmed) {
    return { success: true, needs_confirmation: true, description };
  }

  const id = crypto.randomUUID();
  const call: Call = {
    id,
    prospect_id: prospect_id as string,
    commercial_id: state.currentUser!.id,
    date: new Date().toISOString(),
    duree: (duree as number) || 0,
    resultat: resultat as Call['resultat'],
    notes: (notes as string) || '',
  };

  dispatch({ type: 'ADD_CALL', payload: call });
  return { success: true, call };
}

function handleAddProspectNote(
  payload: Record<string, unknown>,
  state: AppState,
  dispatch: Dispatch,
  confirmed: boolean,
): ActionResult {
  const { prospect_id, note } = payload as any;
  if (!prospect_id || !note) return { success: false, error: 'prospect_id et note requis' };

  const prospect = state.prospects.find(p => p.id === prospect_id);
  if (!prospect) return { success: false, error: 'Prospect introuvable' };

  const description = `Ajouter une note a "${prospect.nom_etablissement}" : "${(note as string).substring(0, 60)}${(note as string).length > 60 ? '...' : ''}"`;

  if (!confirmed) {
    return { success: true, needs_confirmation: true, description };
  }

  const newNotes = prospect.notes
    ? `${prospect.notes}\n\n[${new Date().toLocaleDateString('fr-FR')}] ${note}`
    : `[${new Date().toLocaleDateString('fr-FR')}] ${note}`;

  const updated: Prospect = {
    ...prospect,
    notes: newNotes,
    date_modification: new Date().toISOString(),
  };

  dispatch({ type: 'UPDATE_PROSPECT', payload: updated });
  return { success: true, prospect: sanitizeProspect(updated) };
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
      default: return { success: false, error: 'Action inconnue' };
    }
  }

  // Write actions — need confirmed: true in payload to execute
  if (WRITE_ACTIONS.has(action)) {
    const confirmed = payload.confirmed === true;

    switch (action) {
      case 'CREATE_APPOINTMENT': return handleCreateAppointment(payload, state, dispatch, confirmed);
      case 'UPDATE_APPOINTMENT': return handleUpdateAppointment(payload, state, dispatch, confirmed);
      case 'CREATE_REMINDER': return handleCreateReminder(payload, state, dispatch, confirmed);
      case 'UPDATE_PROSPECT': return handleUpdateProspect(payload, state, dispatch, confirmed);
      case 'MOVE_PROSPECT_STAGE': return handleMoveProspectStage(payload, state, dispatch, confirmed);
      case 'CREATE_CALL': return handleCreateCall(payload, state, dispatch, confirmed);
      case 'ADD_PROSPECT_NOTE': return handleAddProspectNote(payload, state, dispatch, confirmed);
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
