import { format, formatDistanceToNow, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Prospect, Call, Appointment, EmailTemplate } from '../types';

// ============================================
// ID Generation
// ============================================

export function generateId(prefix: string = 'id'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================
// Date Helpers
// ============================================

export function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'dd/MM/yyyy', { locale: fr });
  } catch {
    return dateStr;
  }
}

export function formatDateTime(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'dd/MM/yyyy HH:mm', { locale: fr });
  } catch {
    return dateStr;
  }
}

export function formatTimeAgo(dateStr: string): string {
  try {
    return formatDistanceToNow(parseISO(dateStr), { addSuffix: true, locale: fr });
  } catch {
    return dateStr;
  }
}

export function isThisWeek(dateStr: string): boolean {
  try {
    const date = parseISO(dateStr);
    const now = new Date();
    return isWithinInterval(date, { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) });
  } catch {
    return false;
  }
}

export function isThisMonth(dateStr: string): boolean {
  try {
    const date = parseISO(dateStr);
    const now = new Date();
    return isWithinInterval(date, { start: startOfMonth(now), end: endOfMonth(now) });
  } catch {
    return false;
  }
}

export function isToday(dateStr: string): boolean {
  try {
    const date = parseISO(dateStr);
    const now = new Date();
    return date.toDateString() === now.toDateString();
  } catch {
    return false;
  }
}

// ============================================
// Duration Helpers
// ============================================

export function formatDuration(seconds: number): string {
  if (seconds === 0) return '0s';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  if (secs === 0) return `${mins}min`;
  return `${mins}min ${secs}s`;
}

export function formatDurationTimer(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hrs > 0) return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  return `${pad(mins)}:${pad(secs)}`;
}

// ============================================
// ICS Export
// ============================================

export function generateICS(appointment: Appointment, prospect: Prospect): string {
  const dtStart = `${appointment.date.replace(/-/g, '')}T${appointment.heure_debut.replace(':', '')}00`;
  const dtEnd = `${appointment.date.replace(/-/g, '')}T${appointment.heure_fin.replace(':', '')}00`;

  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//SuiviPro//La Brasserie des Plantes//FR
BEGIN:VEVENT
DTSTART:${dtStart}
DTEND:${dtEnd}
SUMMARY:RDV ${prospect.nom_etablissement}
DESCRIPTION:${appointment.notes}\\nContact: ${prospect.nom_contact}\\nTel: ${prospect.telephone}
LOCATION:${appointment.lieu}
END:VEVENT
END:VCALENDAR`;
}

export function downloadICS(appointment: Appointment, prospect: Prospect) {
  const ics = generateICS(appointment, prospect);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `rdv-${prospect.nom_etablissement.replace(/\s+/g, '-').toLowerCase()}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}

// ============================================
// Email Template Processing
// ============================================

export function processEmailTemplate(
  template: EmailTemplate,
  prospect: Prospect,
  commercial: { prenom: string; telephone: string },
  extraVars: Record<string, string> = {}
): { sujet: string; corps: string } {
  const vars: Record<string, string> = {
    '{{nom_etablissement}}': prospect.nom_etablissement,
    '{{nom_contact}}': prospect.nom_contact,
    '{{commercial}}': commercial.prenom,
    '{{telephone_commercial}}': commercial.telephone,
    ...Object.fromEntries(
      Object.entries(extraVars).map(([k, v]) => [`{{${k}}}`, v])
    ),
  };

  let sujet = template.sujet;
  let corps = template.corps;

  for (const [key, value] of Object.entries(vars)) {
    sujet = sujet.replaceAll(key, value);
    corps = corps.replaceAll(key, value);
  }

  return { sujet, corps };
}

// ============================================
// Excel Export (CSV format)
// ============================================

export function exportProspectsCSV(prospects: Prospect[]): void {
  const headers = [
    'Etablissement', 'Type', 'Contact', 'Telephone', 'Email',
    'Adresse', 'Ville', 'Code Postal', 'Departement',
    'Etape Pipeline', 'Score', 'Notes', 'Date Creation',
  ];

  const rows = prospects.map(p => [
    p.nom_etablissement, p.type_etablissement, p.nom_contact,
    p.telephone, p.email, p.adresse, p.ville, p.code_postal,
    p.departement, p.etape_pipeline, p.score.toString(), p.notes,
    formatDate(p.date_creation),
  ]);

  const csv = [headers, ...rows].map(row =>
    row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  const bom = '\uFEFF';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `prospects-${format(new Date(), 'yyyy-MM-dd')}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ============================================
// Stats Helpers
// ============================================

export function getConversionRate(prospects: Prospect[]): number {
  if (prospects.length === 0) return 0;
  const converted = prospects.filter(p => p.etape_pipeline === 'gagne').length;
  return Math.round((converted / prospects.length) * 100);
}

export function getCallsThisWeek(calls: Call[]): Call[] {
  return calls.filter(c => isThisWeek(c.date));
}

export function getCallsThisMonth(calls: Call[]): Call[] {
  return calls.filter(c => isThisMonth(c.date));
}

export function getCallsToday(calls: Call[]): Call[] {
  return calls.filter(c => isToday(c.date));
}

export function getAppointmentsThisWeek(appointments: Appointment[]): Appointment[] {
  return appointments.filter(a => isThisWeek(a.date));
}

export function getAppointmentsThisMonth(appointments: Appointment[]): Appointment[] {
  return appointments.filter(a => isThisMonth(a.date));
}

export function getAverageCallDuration(calls: Call[]): number {
  const answeredCalls = calls.filter(c => c.duree > 0);
  if (answeredCalls.length === 0) return 0;
  return Math.round(answeredCalls.reduce((sum, c) => sum + c.duree, 0) / answeredCalls.length);
}

export function getResponseRate(calls: Call[]): number {
  if (calls.length === 0) return 0;
  const answered = calls.filter(c => c.resultat === 'repondu').length;
  return Math.round((answered / calls.length) * 100);
}
