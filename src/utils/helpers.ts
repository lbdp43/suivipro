import { format, formatDistanceToNow, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval, subMonths } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Prospect, Call, Appointment, EmailTemplate, Client } from '../types';

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

export function isLastMonth(dateStr: string): boolean {
  try {
    const date = parseISO(dateStr);
    const lastMonth = subMonths(new Date(), 1);
    return isWithinInterval(date, { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) });
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

function icsEscape(text: string): string {
  return (text || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function icsUid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}@suivipro`;
}

function icsDtstamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsFormatTime(date: string, time: string): string {
  const d = date.replace(/-/g, '');
  if (!time) return `${d}T090000`;
  return `${d}T${time.replace(':', '')}00`;
}

function buildICSFile(events: string[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SuiviPro//NONSGML v1.0//FR',
    'METHOD:PUBLISH',
    'CALSCALE:GREGORIAN',
    ...events,
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

function triggerICSDownload(icsContent: string, filename: string) {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.ics') ? filename : `${filename}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function generateICS(appointment: Appointment, prospect: Prospect): string {
  const dtStart = icsFormatTime(appointment.date, appointment.heure_debut);
  const dtEnd = icsFormatTime(appointment.date, appointment.heure_fin);
  const descParts = [];
  if (appointment.notes) descParts.push(appointment.notes);
  if (prospect.nom_contact) descParts.push(`Contact: ${prospect.nom_contact}`);
  if (prospect.telephone) descParts.push(`Tel: ${prospect.telephone}`);

  const event = [
    'BEGIN:VEVENT',
    `UID:${icsUid()}`,
    `DTSTAMP:${icsDtstamp()}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${icsEscape(`RDV ${prospect.nom_etablissement}`)}`,
    `DESCRIPTION:${icsEscape(descParts.join('\n'))}`,
    `LOCATION:${icsEscape(appointment.lieu || '')}`,
    'END:VEVENT',
  ].join('\r\n');

  return buildICSFile([event]);
}

export function downloadICS(appointment: Appointment, prospect: Prospect) {
  const ics = generateICS(appointment, prospect);
  triggerICSDownload(ics, `rdv-${prospect.nom_etablissement.replace(/[^a-zA-Z0-9]/g, '_')}.ics`);
}

export function generateICSClient(appointment: Appointment, client: Client): string {
  const dtStart = icsFormatTime(appointment.date, appointment.heure_debut);
  const dtEnd = icsFormatTime(appointment.date, appointment.heure_fin);
  const location = appointment.lieu || [client.adresse, client.ville].filter(Boolean).join(', ') || '';
  const descParts = [];
  if (appointment.notes) descParts.push(appointment.notes);
  if (client.contact) descParts.push(`Contact: ${client.contact}`);
  if (client.telephone) descParts.push(`Tel: ${client.telephone}`);
  if (client.telephone_mobile) descParts.push(`Mobile: ${client.telephone_mobile}`);

  const event = [
    'BEGIN:VEVENT',
    `UID:${icsUid()}`,
    `DTSTAMP:${icsDtstamp()}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${icsEscape(`RDV ${client.nom}`)}`,
    `DESCRIPTION:${icsEscape(descParts.join('\n'))}`,
    `LOCATION:${icsEscape(location)}`,
    'END:VEVENT',
  ].join('\r\n');

  return buildICSFile([event]);
}

export function downloadICSClient(appointment: Appointment, client: Client) {
  const ics = generateICSClient(appointment, client);
  triggerICSDownload(ics, `rdv-${client.nom.replace(/[^a-zA-Z0-9]/g, '_')}.ics`);
}

/**
 * Export ICS avec plusieurs RDV (un seul fichier .ics contenant tous les evenements).
 */
export function downloadICSBatch(
  appointments: Appointment[],
  getProspect: (id: string) => Prospect | undefined,
  commercialName?: string,
) {
  if (appointments.length === 0) return;

  const events = appointments.map(rdv => {
    const prospect = getProspect(rdv.prospect_id);
    const dtStart = icsFormatTime(rdv.date, rdv.heure_debut);
    const dtEnd = icsFormatTime(rdv.date, rdv.heure_fin);
    const descParts = [];
    if (rdv.notes) descParts.push(rdv.notes);
    if (prospect?.nom_contact) descParts.push(`Contact: ${prospect.nom_contact}`);
    if (prospect?.telephone) descParts.push(`Tel: ${prospect.telephone}`);
    return [
      'BEGIN:VEVENT',
      `UID:${icsUid()}`,
      `DTSTAMP:${icsDtstamp()}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${icsEscape(`RDV ${prospect?.nom_etablissement || 'Inconnu'}`)}`,
      `DESCRIPTION:${icsEscape(descParts.join('\n'))}`,
      `LOCATION:${icsEscape(rdv.lieu || '')}`,
      'END:VEVENT',
    ].join('\r\n');
  });

  const ics = buildICSFile(events);
  const filename = commercialName ? `rdv-${commercialName.replace(/[^a-zA-Z0-9]/g, '_')}.ics` : 'rdv-export.ics';
  triggerICSDownload(ics, filename);
}

// ============================================
// Conflict Detection
// ============================================

/**
 * Verifie s'il y a un conflit horaire pour un commercial a une date/heure donnee.
 * Retourne la liste des RDV en conflit.
 */
export function detectConflicts(
  allAppointments: Appointment[],
  commercialId: string,
  date: string,
  heureDebut: string,
  heureFin: string,
  excludeId?: string,
): Appointment[] {
  if (!date || !heureDebut || !heureFin) return [];
  return allAppointments.filter(rdv => {
    if (rdv.commercial_id !== commercialId) return false;
    if (rdv.date !== date) return false;
    if (rdv.statut === 'annule') return false;
    if (excludeId && rdv.id === excludeId) return false;
    // Chevauchement : debut1 < fin2 && debut2 < fin1
    return heureDebut < rdv.heure_fin && rdv.heure_debut < heureFin;
  });
}

// ============================================
// Geocoding (api-adresse.data.gouv.fr)
// ============================================

export interface GeocodingResult {
  latitude: number;
  longitude: number;
  ville: string;
  code_postal: string;
  departement: string;
}

const ADRESSE_API_URL = 'https://api-adresse.data.gouv.fr';

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export async function geocodeAddress(adresse: string): Promise<GeocodingResult | null> {
  if (!adresse || adresse.trim().length < 3) return null;
  try {
    const params = new URLSearchParams({ q: adresse, limit: '1' });
    const res = await fetchWithTimeout(`${ADRESSE_API_URL}/search/?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.features?.length) return null;
    const feature = data.features[0];
    const props = feature.properties || {};
    const [lon, lat] = feature.geometry?.coordinates || [0, 0];
    return {
      latitude: lat,
      longitude: lon,
      ville: props.city || '',
      code_postal: props.postcode || '',
      departement: props.context?.split(',')[0]?.trim() || '',
    };
  } catch {
    return null;
  }
}

/**
 * Geocode par lot via l'API CSV de api-adresse.data.gouv.fr.
 * Envoie les adresses en lots de 2000 via un fichier CSV.
 * Si l'API est injoignable, retourne des resultats vides sans bloquer.
 */
export async function geocodeBatch(
  addresses: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<(GeocodingResult | null)[]> {
  const results: (GeocodingResult | null)[] = new Array(addresses.length).fill(null);
  const BATCH_SIZE = 2000;
  let totalDone = 0;

  // Quick connectivity check before processing thousands of addresses
  try {
    const probe = await fetchWithTimeout(`${ADRESSE_API_URL}/search/?q=test&limit=1`, {}, 8000);
    if (!probe.ok) {
      onProgress?.(addresses.length, addresses.length);
      return results;
    }
  } catch {
    // API unreachable — return empty results immediately
    onProgress?.(addresses.length, addresses.length);
    return results;
  }

  for (let batchStart = 0; batchStart < addresses.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, addresses.length);
    const batchAddresses = addresses.slice(batchStart, batchEnd);

    // Build CSV content: index,adresse
    const csvLines = ['index,adresse'];
    const indexMap: number[] = [];
    batchAddresses.forEach((addr, i) => {
      const globalIndex = batchStart + i;
      if (addr && addr.trim().length >= 3) {
        // Escape CSV: wrap in quotes if contains comma/quote/newline
        const escaped = addr.includes(',') || addr.includes('"') || addr.includes('\n')
          ? `"${addr.replace(/"/g, '""')}"`
          : addr;
        csvLines.push(`${globalIndex},${escaped}`);
        indexMap.push(globalIndex);
      }
    });

    // If no valid addresses in this batch, skip
    if (indexMap.length === 0) {
      totalDone += batchAddresses.length;
      onProgress?.(totalDone, addresses.length);
      continue;
    }

    try {
      const csvContent = csvLines.join('\n');
      const formData = new FormData();
      formData.append('data', new Blob([csvContent], { type: 'text/csv' }), 'addresses.csv');
      formData.append('columns', 'adresse');

      const res = await fetchWithTimeout(
        `${ADRESSE_API_URL}/search/csv/`,
        { method: 'POST', body: formData },
        120000, // 2 min timeout for large batches
      );

      if (res.ok) {
        const responseText = await res.text();
        const lines = responseText.split('\n');
        if (lines.length > 1) {
          // Parse CSV header to find column indices
          const header = lines[0].split(',');
          const colIdx = (name: string) => header.indexOf(name);
          const iIdx = colIdx('index');
          const latIdx = colIdx('latitude');
          const lonIdx = colIdx('longitude');
          const cityIdx = colIdx('result_city');
          const pcIdx = colIdx('result_postcode');
          const ctxIdx = colIdx('result_context');
          const scoreIdx = colIdx('result_score');

          for (let l = 1; l < lines.length; l++) {
            if (!lines[l].trim()) continue;
            const cols = parseCSVLine(lines[l]);
            const score = scoreIdx >= 0 ? parseFloat(cols[scoreIdx]) : 0;
            // Only accept results with a decent confidence score
            if (score < 0.3) continue;
            const globalIndex = iIdx >= 0 ? parseInt(cols[iIdx], 10) : -1;
            if (globalIndex < 0 || globalIndex >= addresses.length) continue;
            const lat = latIdx >= 0 ? parseFloat(cols[latIdx]) : 0;
            const lon = lonIdx >= 0 ? parseFloat(cols[lonIdx]) : 0;
            if (lat === 0 && lon === 0) continue;
            results[globalIndex] = {
              latitude: lat,
              longitude: lon,
              ville: cityIdx >= 0 ? cols[cityIdx] || '' : '',
              code_postal: pcIdx >= 0 ? cols[pcIdx] || '' : '',
              departement: ctxIdx >= 0 ? (cols[ctxIdx]?.split(',')[0]?.trim() || '') : '',
            };
          }
        }
      }
    } catch {
      // Batch API failed (network/CORS/timeout) — skip geocoding for this batch
      // Don't fall back to individual requests for large sets (would take forever)
      totalDone += batchAddresses.length;
      onProgress?.(totalDone, addresses.length);
      continue;
    }

    totalDone += batchAddresses.length;
    onProgress?.(totalDone, addresses.length);
  }

  return results;
}

/** Parse a single CSV line handling quoted fields */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
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
    'Adresse', 'Ville', 'Code Postal', 'Departement', 'Secteur',
    'Etape Pipeline', 'Score', 'Notes', 'Date Creation',
  ];

  const rows = prospects.map(p => [
    p.nom_etablissement, p.type_etablissement, p.nom_contact,
    p.telephone, p.email, p.adresse, p.ville, p.code_postal,
    p.departement, p.secteur || '', p.etape_pipeline, p.score.toString(), p.notes,
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
  const converted = prospects.filter(p => p.etape_pipeline === 'client_gagne').length;
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
