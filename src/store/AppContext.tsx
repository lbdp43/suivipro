import React, { createContext, useContext, useReducer, useEffect, ReactNode, useCallback, useState, useMemo, useRef } from 'react';
import {
  AppState, Prospect, Call, Appointment, Reminder, Commercial, Tag, EmailTemplate, SessionAppel,
  PipelineStage, PipelineColumn, PIPELINE_LABELS, PIPELINE_COLORS, Document,
  Client, Interaction, TaskClient, TourneeConfig, Commande,
} from '../types';
import { syncAction, loadFullState, getMe, getToken, setToken, login as apiLogin } from '../api/client';
import { toLocalDateStr } from '../utils/helpers';

// Périmètre d'affichage des clients. « moi » = mes clients + les fiches libres ; « equipe » =
// toute l'équipe (remplacement d'un collègue). Appliqué ICI, une seule fois, il vaut pour
// toutes les pages : accueil, retards, liste, semaine… Défaut : un commercial voit ses
// clients, un admin ou un prospecteur voit l'équipe. Le choix est gardé pour la session.
export type Perimetre = 'moi' | 'equipe';
const CLE_PERIMETRE = 'suivipro_perimetre';
function lirePerimetreChoisi(): Perimetre | null {
  try {
    const v = sessionStorage.getItem(CLE_PERIMETRE);
    return v === 'moi' || v === 'equipe' ? v : null;
  } catch { return null; }
}
export function perimetreParDefaut(role: string | undefined): Perimetre {
  return role === 'commercial' ? 'moi' : 'equipe';
}
function sansCommercial(c: Client): boolean {
  return !c.commercial_id;
}
/** Restreint l'état au périmètre : clients, et tout ce qui s'y rattache. La prospection reste commune. */
export function appliquerPerimetre(state: AppState, perimetre: Perimetre): AppState {
  const moi = state.currentUser?.id;
  if (perimetre === 'equipe' || !moi) return state;
  const clients = state.clients.filter(c => c.commercial_id === moi || sansCommercial(c));
  const ids = new Set(clients.map(c => c.id));
  return {
    ...state,
    clients,
    interactions: state.interactions.filter(i => ids.has(i.client_id)),
    commandes: state.commandes.filter(c => !c.client_id || ids.has(c.client_id)),
    tasksClient: state.tasksClient.filter(t => t.commercial_id === moi || (!!t.client_id && ids.has(t.client_id))),
  };
}


// ============================================
// Actions
// ============================================

type Action =
  | { type: 'SET_STATE'; payload: AppState }
  | { type: 'SET_SESSION_APPEL'; payload: SessionAppel }
  | { type: 'RETIRER_SESSION_APPEL'; payload: { commercial_id: string; jour: string } }
  | { type: 'ADD_PROSPECT'; payload: Prospect }
  | { type: 'UPDATE_PROSPECT'; payload: Prospect }
  | { type: 'DELETE_PROSPECT'; payload: string }
  | { type: 'MOVE_PROSPECT'; payload: { id: string; stage: PipelineStage } }
  | { type: 'ADD_CALL'; payload: Call }
  | { type: 'UPDATE_CALL'; payload: Call }
  | { type: 'DELETE_CALL'; payload: string }
  | { type: 'ADD_APPOINTMENT'; payload: Appointment }
  | { type: 'UPDATE_APPOINTMENT'; payload: Appointment }
  | { type: 'DELETE_APPOINTMENT'; payload: string }
  | { type: 'ADD_REMINDER'; payload: Reminder }
  | { type: 'UPDATE_REMINDER'; payload: Reminder }
  | { type: 'DELETE_REMINDER'; payload: string }
  | { type: 'ADD_TAG'; payload: Tag }
  | { type: 'UPDATE_TAG'; payload: Tag }
  | { type: 'DELETE_TAG'; payload: string }
  | { type: 'ADD_EMAIL_TEMPLATE'; payload: EmailTemplate }
  | { type: 'UPDATE_EMAIL_TEMPLATE'; payload: EmailTemplate }
  | { type: 'DELETE_EMAIL_TEMPLATE'; payload: string }
  | { type: 'UPDATE_COMMERCIAL'; payload: Commercial }
  | { type: 'ADD_COMMERCIAL'; payload: Commercial }
  | { type: 'DELETE_COMMERCIAL'; payload: string }
  | { type: 'SET_CURRENT_USER'; payload: Commercial | null }
  | { type: 'IMPORT_PROSPECTS'; payload: Prospect[] }
  | { type: 'UPDATE_PIPELINE_COLUMN'; payload: PipelineColumn }
  | { type: 'DELETE_PIPELINE_COLUMN'; payload: string }
  | { type: 'ADD_PIPELINE_COLUMN'; payload: PipelineColumn }
  | { type: 'REORDER_PIPELINE_COLUMNS'; payload: PipelineColumn[] }
  | { type: 'ADD_DOCUMENT'; payload: Document }
  | { type: 'DELETE_DOCUMENT'; payload: string }
  | { type: 'ADD_CLIENT'; payload: Client }
  | { type: 'UPDATE_CLIENT'; payload: Client }
  | { type: 'DELETE_CLIENT'; payload: string }
  | { type: 'ADD_INTERACTION'; payload: Interaction }
  | { type: 'DELETE_INTERACTION'; payload: string }
  | { type: 'ADD_TASK_CLIENT'; payload: TaskClient }
  | { type: 'UPDATE_TASK_CLIENT'; payload: TaskClient }
  | { type: 'DELETE_TASK_CLIENT'; payload: string }
  | { type: 'SAVE_TOURNEE_CONFIG'; payload: TourneeConfig }
  | { type: 'SET_COMMANDES'; payload: Commande[] }
  | { type: 'IMPORT_CLIENTS'; payload: Client[] };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_STATE':
      return {
        ...action.payload,
        prospects: (action.payload.prospects || []).map(p => ({
          ...p,
          tags: Array.isArray(p.tags) ? p.tags : [],
        })),
        sessionsAppel: action.payload.sessionsAppel || [],
      };
    case 'SET_SESSION_APPEL':
      return { ...state, sessionsAppel: [...state.sessionsAppel.filter(s => s.id !== action.payload.id), action.payload] };
    case 'RETIRER_SESSION_APPEL':
      return { ...state, sessionsAppel: state.sessionsAppel.filter(s => !(s.commercial_id === action.payload.commercial_id && s.jour === action.payload.jour)) };
    case 'ADD_PROSPECT':
      return { ...state, prospects: [...state.prospects, { ...action.payload, tags: Array.isArray(action.payload.tags) ? action.payload.tags : [] }] };
    case 'UPDATE_PROSPECT':
      return { ...state, prospects: state.prospects.map(p => p.id === action.payload.id ? action.payload : p) };
    case 'DELETE_PROSPECT':
      return { ...state, prospects: state.prospects.filter(p => p.id !== action.payload) };
    case 'MOVE_PROSPECT':
      return {
        ...state,
        prospects: state.prospects.map(p =>
          p.id === action.payload.id
            ? { ...p, etape_pipeline: action.payload.stage, date_modification: new Date().toISOString() }
            : p
        ),
      };
    case 'ADD_CALL':
      return { ...state, calls: [...state.calls, action.payload] };
    case 'UPDATE_CALL':
      return { ...state, calls: state.calls.map(c => c.id === action.payload.id ? action.payload : c) };
    case 'DELETE_CALL':
      return { ...state, calls: state.calls.filter(c => c.id !== action.payload) };
    case 'ADD_APPOINTMENT':
      return { ...state, appointments: [...state.appointments, action.payload] };
    case 'UPDATE_APPOINTMENT':
      return { ...state, appointments: state.appointments.map(a => a.id === action.payload.id ? action.payload : a) };
    case 'DELETE_APPOINTMENT':
      return { ...state, appointments: state.appointments.filter(a => a.id !== action.payload) };
    case 'ADD_REMINDER':
      return { ...state, reminders: [...state.reminders, action.payload] };
    case 'UPDATE_REMINDER':
      return { ...state, reminders: state.reminders.map(r => r.id === action.payload.id ? action.payload : r) };
    case 'DELETE_REMINDER':
      return { ...state, reminders: state.reminders.filter(r => r.id !== action.payload) };
    case 'ADD_TAG':
      return { ...state, tags: [...state.tags, action.payload] };
    case 'UPDATE_TAG':
      return { ...state, tags: state.tags.map(t => t.id === action.payload.id ? action.payload : t) };
    case 'DELETE_TAG':
      return { ...state, tags: state.tags.filter(t => t.id !== action.payload) };
    case 'ADD_EMAIL_TEMPLATE':
      return { ...state, emailTemplates: [...state.emailTemplates, action.payload] };
    case 'UPDATE_EMAIL_TEMPLATE':
      return { ...state, emailTemplates: state.emailTemplates.map(e => e.id === action.payload.id ? action.payload : e) };
    case 'DELETE_EMAIL_TEMPLATE':
      return { ...state, emailTemplates: state.emailTemplates.filter(e => e.id !== action.payload) };
    case 'UPDATE_COMMERCIAL':
      return { ...state, commerciaux: state.commerciaux.map(c => c.id === action.payload.id ? action.payload : c) };
    case 'ADD_COMMERCIAL':
      return { ...state, commerciaux: [...state.commerciaux, action.payload] };
    case 'DELETE_COMMERCIAL':
      return { ...state, commerciaux: state.commerciaux.filter(c => c.id !== action.payload) };
    case 'SET_CURRENT_USER':
      return { ...state, currentUser: action.payload };
    case 'IMPORT_PROSPECTS':
      return { ...state, prospects: [...state.prospects, ...action.payload] };
    case 'UPDATE_PIPELINE_COLUMN':
      return { ...state, pipelineColumns: state.pipelineColumns.map(c => c.id === action.payload.id ? action.payload : c) };
    case 'DELETE_PIPELINE_COLUMN': {
      const remaining = state.pipelineColumns.filter(c => c.id !== action.payload);
      const fallbackStage = remaining.length > 0 ? remaining[0].id : 'nouveau';
      return {
        ...state,
        pipelineColumns: remaining,
        prospects: state.prospects.map(p =>
          p.etape_pipeline === action.payload
            ? { ...p, etape_pipeline: fallbackStage as PipelineStage, date_modification: new Date().toISOString() }
            : p
        ),
      };
    }
    case 'ADD_PIPELINE_COLUMN':
      return { ...state, pipelineColumns: [...state.pipelineColumns, action.payload] };
    case 'REORDER_PIPELINE_COLUMNS':
      return { ...state, pipelineColumns: action.payload };
    case 'ADD_DOCUMENT':
      return { ...state, documents: [action.payload, ...state.documents] };
    case 'DELETE_DOCUMENT':
      return { ...state, documents: state.documents.filter(d => d.id !== action.payload) };
    // Clients
    case 'ADD_CLIENT':
      return { ...state, clients: [action.payload, ...state.clients] };
    case 'UPDATE_CLIENT':
      return { ...state, clients: state.clients.map(c => c.id === action.payload.id ? action.payload : c) };
    case 'DELETE_CLIENT':
      return { ...state, clients: state.clients.filter(c => c.id !== action.payload) };
    case 'IMPORT_CLIENTS':
      return { ...state, clients: [...state.clients, ...action.payload] };
    // Interactions
    case 'ADD_INTERACTION': {
      const newInteractions = [action.payload, ...state.interactions];
      // Also update the client's last_visit and next_visit
      const updatedClients = state.clients.map(c => {
        if (c.id === action.payload.client_id) {
          const visitDate = action.payload.date.split('T')[0];
          const freq = c.custom_recurrence || null;
          let nextVisit: string | null = null;
          if (c.statut === 'ACTIF' && freq) {
            const d = new Date(visitDate);
            d.setDate(d.getDate() + freq);
            nextVisit = toLocalDateStr(d);
          }
          return { ...c, last_visit: visitDate, next_visit: nextVisit, date_modification: new Date().toISOString() };
        }
        return c;
      });
      return { ...state, interactions: newInteractions, clients: updatedClients };
    }
    case 'DELETE_INTERACTION':
      return { ...state, interactions: state.interactions.filter(i => i.id !== action.payload) };
    // Tasks Client
    case 'ADD_TASK_CLIENT':
      return { ...state, tasksClient: [action.payload, ...state.tasksClient] };
    case 'UPDATE_TASK_CLIENT':
      return { ...state, tasksClient: state.tasksClient.map(t => t.id === action.payload.id ? action.payload : t) };
    case 'DELETE_TASK_CLIENT':
      return { ...state, tasksClient: state.tasksClient.filter(t => t.id !== action.payload) };
    // Commandes
    case 'SET_COMMANDES':
      return { ...state, commandes: action.payload };
    // Tournee Config
    case 'SAVE_TOURNEE_CONFIG': {
      const exists = state.tourneeConfigs.some(tc => tc.commercial_id === action.payload.commercial_id);
      if (exists) {
        return { ...state, tourneeConfigs: state.tourneeConfigs.map(tc => tc.commercial_id === action.payload.commercial_id ? action.payload : tc) };
      }
      return { ...state, tourneeConfigs: [...state.tourneeConfigs, action.payload] };
    }
    default:
      return state;
  }
}

// ============================================
// Default pipeline columns
// ============================================

const defaultPipelineColumns: PipelineColumn[] = ([
  'partage', 'nouveau_datagouv', 'nouveau', 'a_contacter', 'contacte', 'proposition', 'negociation', 'gagne', 'client_gagne', 'perdu', 'ne_pas_contacter',
] as PipelineStage[]).map(key => ({
  id: key,
  label: PIPELINE_LABELS[key],
  color: PIPELINE_COLORS[key],
}));

// ============================================
// Context
// ============================================

interface AppContextType {
  /** État restreint au périmètre choisi (Mes clients / Toute l'équipe). */
  state: AppState;
  /** État complet, pour ce qui doit voir au-delà du périmètre (fiche d'un client d'un collègue…). */
  stateComplet: AppState;
  perimetre: Perimetre;
  setPerimetre: (p: Perimetre) => void;
  dispatch: React.Dispatch<Action>;
  dispatchLocal: React.Dispatch<Action>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
  authError: string | null;
  // Helper functions
  getProspect: (id: string) => Prospect | undefined;
  getCallsForProspect: (prospectId: string) => Call[];
  getAppointmentsForProspect: (prospectId: string) => Appointment[];
  getRemindersForProspect: (prospectId: string) => Reminder[];
  getCallsForCommercial: (commercialId: string) => Call[];
  getAppointmentsForCommercial: (commercialId: string) => Appointment[];
  getRemindersForCommercial: (commercialId: string) => Reminder[];
  getProspectsForCommercial: (commercialId: string) => Prospect[];
  getCommercial: (id: string) => Commercial | undefined;
  getTag: (id: string) => Tag | undefined;
  getClient: (id: string) => Client | undefined;
  getInteractionsForClient: (clientId: string) => Interaction[];
  getTasksForClient: (clientId: string) => TaskClient[];
  getClientsForCommercial: (commercialId: string) => Client[];
  getCommandesForClient: (clientId: string) => Commande[];
  pausePolling: (durationMs?: number) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const emptyState: AppState = {
  prospects: [],
  calls: [],
  appointments: [],
  reminders: [],
  commerciaux: [],
  tags: [],
  emailTemplates: [],
  currentUser: null,
  pipelineColumns: defaultPipelineColumns,
  documents: [],
  clients: [],
  interactions: [],
  tasksClient: [],
  tourneeConfigs: [],
  commandes: [],
  sessionsAppel: [],
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [stateComplet, rawDispatch] = useReducer(reducer, emptyState);
  const [loading, setLoading] = useState(true);
  const [perimetreChoisi, setPerimetreChoisi] = useState<Perimetre | null>(lirePerimetreChoisi);
  const perimetre: Perimetre = perimetreChoisi ?? perimetreParDefaut(stateComplet.currentUser?.role);
  const setPerimetre = useCallback((p: Perimetre) => {
    setPerimetreChoisi(p);
    try { sessionStorage.setItem(CLE_PERIMETRE, p); } catch { /* navigation privée */ }
  }, []);
  // L'état vu par les pages est l'état complet restreint au périmètre.
  const state = useMemo(() => appliquerPerimetre(stateComplet, perimetre), [stateComplet, perimetre]);
  const [authError, setAuthError] = useState<string | null>(null);
  const currentUserRef = useRef<Commercial | null>(null);
  const pollPausedUntilRef = useRef<number>(0);

  // Pause polling temporarily (e.g. during bulk operations)
  const pausePolling = useCallback((durationMs: number = 15000) => {
    pollPausedUntilRef.current = Date.now() + durationMs;
  }, []);

  // Wrapped dispatch that also syncs to API
  const dispatch: React.Dispatch<Action> = useCallback((action: Action) => {
    rawDispatch(action);
    // Sync to API (fire-and-forget, optimistic)
    if (action.type !== 'SET_STATE' && action.type !== 'SET_CURRENT_USER' && action.type !== 'SET_COMMANDES') {
      syncAction(action.type, action.payload);
    }
  }, []);

  // Login
  const login = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    try {
      const user = await apiLogin(email, password);
      currentUserRef.current = user;
      // Load full state from API
      const data = await loadFullState();
      rawDispatch({
        type: 'SET_STATE',
        payload: {
          ...data,
          currentUser: user,
          pipelineColumns: data.pipelineColumns.length > 0 ? data.pipelineColumns : defaultPipelineColumns,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur de connexion';
      setAuthError(message);
      throw err;
    }
  }, []);

  // Logout
  const logout = useCallback(() => {
    setToken(null);
    currentUserRef.current = null;
    rawDispatch({ type: 'SET_STATE', payload: emptyState });
  }, []);

  // On mount: check for existing token and restore session
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }

    // Try to restore session
    (async () => {
      try {
        const user = await getMe();
        currentUserRef.current = user;
        const data = await loadFullState();
        rawDispatch({
          type: 'SET_STATE',
          payload: {
            ...data,
            currentUser: user,
            pipelineColumns: data.pipelineColumns.length > 0 ? data.pipelineColumns : defaultPipelineColumns,
          },
        });
      } catch {
        // Token invalid, clear it
        setToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Auto-reload polling every 30s for multi-user sync
  useEffect(() => {
    const token = getToken();
    if (!token || loading) return;

    let consecutiveErrors = 0;
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() < pollPausedUntilRef.current) return;
      try {
        const data = await loadFullState();
        rawDispatch({
          type: 'SET_STATE',
          payload: {
            ...data,
            currentUser: currentUserRef.current,
            pipelineColumns: data.pipelineColumns.length > 0 ? data.pipelineColumns : defaultPipelineColumns,
          },
        });
        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors++;
        console.error(`[Polling] Erreur #${consecutiveErrors}:`, err);
        if (consecutiveErrors === 3) {
          console.warn('[Polling] 3 erreurs consecutives - connexion serveur perdue');
        }
      }
    };

    const interval = setInterval(poll, 30000);
    return () => clearInterval(interval);
  }, [loading]);

  const getProspect = useCallback((id: string) => state.prospects.find(p => p.id === id), [state.prospects]);
  const getCallsForProspect = useCallback((pid: string) => state.calls.filter(c => c.prospect_id === pid), [state.calls]);
  const getAppointmentsForProspect = useCallback((pid: string) => state.appointments.filter(a => a.prospect_id === pid), [state.appointments]);
  const getRemindersForProspect = useCallback((pid: string) => state.reminders.filter(r => r.prospect_id === pid), [state.reminders]);
  const getCallsForCommercial = useCallback((cid: string) => state.calls.filter(c => c.commercial_id === cid), [state.calls]);
  const getAppointmentsForCommercial = useCallback((cid: string) => state.appointments.filter(a => a.commercial_id === cid), [state.appointments]);
  const getRemindersForCommercial = useCallback((cid: string) => state.reminders.filter(r => r.commercial_id === cid), [state.reminders]);
  const getProspectsForCommercial = useCallback((cid: string) => state.prospects.filter(p => p.commercial_id === cid), [state.prospects]);
  const getCommercial = useCallback((id: string) => state.commerciaux.find(c => c.id === id), [state.commerciaux]);
  const getTag = useCallback((id: string) => state.tags.find(t => t.id === id), [state.tags]);
  const getClient = useCallback((id: string) => stateComplet.clients.find(c => c.id === id), [stateComplet.clients]);
  const getInteractionsForClient = useCallback((cid: string) => state.interactions.filter(i => i.client_id === cid), [state.interactions]);
  const getTasksForClient = useCallback((cid: string) => state.tasksClient.filter(t => t.client_id === cid), [state.tasksClient]);
  const getClientsForCommercial = useCallback((cid: string) => stateComplet.clients.filter(c => c.commercial_id === cid), [stateComplet.clients]);
  const getCommandesForClient = useCallback((cid: string) => state.commandes.filter(c => c.client_id === cid), [state.commandes]);

  const contextValue = useMemo(() => ({
    state,
    stateComplet,
    perimetre,
    setPerimetre,
    dispatch,
    dispatchLocal: rawDispatch,
    login,
    logout,
    loading,
    authError,
    getProspect,
    getCallsForProspect,
    getAppointmentsForProspect,
    getRemindersForProspect,
    getCallsForCommercial,
    getAppointmentsForCommercial,
    getRemindersForCommercial,
    getProspectsForCommercial,
    getCommercial,
    getTag,
    getClient,
    getInteractionsForClient,
    getTasksForClient,
    getClientsForCommercial,
    getCommandesForClient,
    pausePolling,
  }), [state, stateComplet, perimetre, setPerimetre, dispatch, rawDispatch, login, logout, loading, authError, getProspect, getCallsForProspect, getAppointmentsForProspect, getRemindersForProspect, getCallsForCommercial, getAppointmentsForCommercial, getRemindersForCommercial, getProspectsForCommercial, getCommercial, getTag, getClient, getInteractionsForClient, getTasksForClient, getClientsForCommercial, getCommandesForClient, pausePolling]);

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
