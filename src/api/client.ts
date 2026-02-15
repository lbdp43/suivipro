// ============================================
// API Client - Connects frontend to Express backend
// ============================================

const API_BASE = '/api';

let authToken: string | null = localStorage.getItem('suivipro_token');

export function setToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem('suivipro_token', token);
  } else {
    localStorage.removeItem('suivipro_token');
  }
}

export function getToken(): string | null {
  return authToken;
}

async function request(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    // Token expired or invalid
    setToken(null);
    window.location.reload();
    throw new Error('Session expiree');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Erreur ${res.status}`);
  }

  return res.json();
}

// ============================================
// Auth
// ============================================

export async function login(email: string, password: string) {
  const data = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setToken(data.token);
  return data.user;
}

export async function getMe() {
  return request('/auth/me');
}

// ============================================
// Full state load
// ============================================

export async function loadFullState() {
  return request('/state');
}

// ============================================
// CRUD helpers (fire-and-forget for optimistic updates)
// ============================================

function post(path: string, body: any) {
  return request(path, { method: 'POST', body: JSON.stringify(body) }).catch(err => console.error('API POST error:', err));
}

function put(path: string, body: any) {
  return request(path, { method: 'PUT', body: JSON.stringify(body) }).catch(err => console.error('API PUT error:', err));
}

function del(path: string) {
  return request(path, { method: 'DELETE' }).catch(err => console.error('API DELETE error:', err));
}

// ============================================
// Google Calendar
// ============================================

export async function getGoogleCalendarConfigStatus(): Promise<{ configured: boolean }> {
  return request('/google-calendar/config-status');
}

export async function getGoogleCalendarStatus(): Promise<Record<string, { connected: boolean; calendar_email: string; connected_at: string }>> {
  return request('/google-calendar/status');
}

export async function getGoogleCalendarAuthUrl(): Promise<{ url: string }> {
  return request('/google-calendar/authorize');
}

export async function disconnectGoogleCalendar(commercialId: string): Promise<{ ok: boolean }> {
  return request('/google-calendar/disconnect', {
    method: 'POST',
    body: JSON.stringify({ commercial_id: commercialId }),
  });
}

export async function getGoogleCalendarEvents(
  commercialId: string,
  timeMin: string,
  timeMax: string,
): Promise<{ connected: boolean; events: GoogleCalendarEvent[]; calendar_email?: string; error?: string }> {
  return request(`/google-calendar/events/${commercialId}?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`);
}

export async function getAllGoogleCalendarEvents(
  timeMin: string,
  timeMax: string,
): Promise<Record<string, { connected: boolean; calendar_email?: string; events: GoogleCalendarEvent[] }>> {
  return request(`/google-calendar/events-all?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`);
}

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  location: string;
  allDay: boolean;
}

// ============================================
// Sync actions to API (called after dispatch)
// ============================================

export function syncAction(type: string, payload: any) {
  switch (type) {
    // Prospects
    case 'ADD_PROSPECT':
      return post('/prospects', payload);
    case 'UPDATE_PROSPECT':
      return put(`/prospects/${payload.id}`, payload);
    case 'DELETE_PROSPECT':
      return del(`/prospects/${payload}`);
    case 'MOVE_PROSPECT':
      return put(`/prospects/${payload.id}`, {
        ...payload,
        etape_pipeline: payload.stage,
        date_modification: new Date().toISOString(),
      });
    case 'IMPORT_PROSPECTS':
      return post('/prospects/import', payload);

    // Calls
    case 'ADD_CALL':
      return post('/calls', payload);
    case 'UPDATE_CALL':
      return put(`/calls/${payload.id}`, payload);
    case 'DELETE_CALL':
      return del(`/calls/${payload}`);

    // Appointments
    case 'ADD_APPOINTMENT':
      return post('/appointments', payload);
    case 'UPDATE_APPOINTMENT':
      return put(`/appointments/${payload.id}`, payload);
    case 'DELETE_APPOINTMENT':
      return del(`/appointments/${payload}`);

    // Reminders
    case 'ADD_REMINDER':
      return post('/reminders', payload);
    case 'UPDATE_REMINDER':
      return put(`/reminders/${payload.id}`, payload);
    case 'DELETE_REMINDER':
      return del(`/reminders/${payload}`);

    // Tags
    case 'ADD_TAG':
      return post('/tags', payload);
    case 'UPDATE_TAG':
      return put(`/tags/${payload.id}`, payload);
    case 'DELETE_TAG':
      return del(`/tags/${payload}`);

    // Email templates
    case 'ADD_EMAIL_TEMPLATE':
      return post('/email-templates', payload);
    case 'UPDATE_EMAIL_TEMPLATE':
      return put(`/email-templates/${payload.id}`, payload);
    case 'DELETE_EMAIL_TEMPLATE':
      return del(`/email-templates/${payload}`);

    // Commerciaux
    case 'UPDATE_COMMERCIAL':
      return put(`/commerciaux/${payload.id}`, payload);
    case 'ADD_COMMERCIAL':
      return post('/commerciaux', payload);
    case 'DELETE_COMMERCIAL':
      return del(`/commerciaux/${payload}`);

    // Pipeline columns
    case 'UPDATE_PIPELINE_COLUMN':
      return put(`/pipeline-columns/${payload.id}`, payload);
    case 'DELETE_PIPELINE_COLUMN':
      return del(`/pipeline-columns/${payload}`);
    case 'ADD_PIPELINE_COLUMN':
      return post('/pipeline-columns', payload);

    // MOVE_PROSPECT needs special handling - we need to fetch the full prospect
    default:
      // SET_STATE, SET_CURRENT_USER: no API sync needed
      break;
  }
}
