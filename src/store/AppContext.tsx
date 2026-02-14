import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import {
  AppState, Prospect, Call, Appointment, Reminder, Commercial, Tag, EmailTemplate,
  PipelineStage, PipelineColumn, PIPELINE_LABELS, PIPELINE_COLORS,
} from '../types';
import { getSeedData } from '../data/seedData';

// ============================================
// Actions
// ============================================

type Action =
  | { type: 'SET_STATE'; payload: AppState }
  | { type: 'ADD_PROSPECT'; payload: Prospect }
  | { type: 'UPDATE_PROSPECT'; payload: Prospect }
  | { type: 'DELETE_PROSPECT'; payload: string }
  | { type: 'MOVE_PROSPECT'; payload: { id: string; stage: PipelineStage } }
  | { type: 'ADD_CALL'; payload: Call }
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
  | { type: 'SET_CURRENT_USER'; payload: Commercial }
  | { type: 'IMPORT_PROSPECTS'; payload: Prospect[] };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_STATE':
      return action.payload;
    case 'ADD_PROSPECT':
      return { ...state, prospects: [...state.prospects, action.payload] };
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
    case 'SET_CURRENT_USER':
      return { ...state, currentUser: action.payload };
    case 'IMPORT_PROSPECTS':
      return { ...state, prospects: [...state.prospects, ...action.payload] };
    default:
      return state;
  }
}

// ============================================
// Default pipeline columns
// ============================================

const defaultPipelineColumns: PipelineColumn[] = (
  Object.keys(PIPELINE_LABELS) as PipelineStage[]
).map(key => ({
  id: key,
  label: PIPELINE_LABELS[key],
  color: PIPELINE_COLORS[key],
}));

// ============================================
// Context
// ============================================

interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<Action>;
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
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const STORAGE_KEY = 'suivipro_state';

function loadState(): AppState | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // ignore
  }
  return null;
}

function saveState(state: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const savedState = loadState();
  const seedData = getSeedData();

  const initialState: AppState = savedState || {
    ...seedData,
    pipelineColumns: defaultPipelineColumns,
    currentUser: seedData.commerciaux[0], // Guillaume as default admin
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const getProspect = (id: string) => state.prospects.find(p => p.id === id);
  const getCallsForProspect = (pid: string) => state.calls.filter(c => c.prospect_id === pid);
  const getAppointmentsForProspect = (pid: string) => state.appointments.filter(a => a.prospect_id === pid);
  const getRemindersForProspect = (pid: string) => state.reminders.filter(r => r.prospect_id === pid);
  const getCallsForCommercial = (cid: string) => state.calls.filter(c => c.commercial_id === cid);
  const getAppointmentsForCommercial = (cid: string) => state.appointments.filter(a => a.commercial_id === cid);
  const getRemindersForCommercial = (cid: string) => state.reminders.filter(r => r.commercial_id === cid);
  const getProspectsForCommercial = (cid: string) => state.prospects.filter(p => p.commercial_id === cid);
  const getCommercial = (id: string) => state.commerciaux.find(c => c.id === id);
  const getTag = (id: string) => state.tags.find(t => t.id === id);

  return (
    <AppContext.Provider
      value={{
        state,
        dispatch,
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
      }}
    >
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
