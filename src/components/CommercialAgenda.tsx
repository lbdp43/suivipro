import { useMemo } from 'react';
import { Calendar, MapPin, AlertTriangle, CalendarPlus } from 'lucide-react';
import { Appointment, AppointmentStatus, APPOINTMENT_STATUS_LABELS, Prospect, Commercial, Client, EVENT_TYPE_LABELS } from '../types';
import { formatDate, downloadICS, toLocalDateStr } from '../utils/helpers';

interface Props {
  appointments: Appointment[];
  commerciaux: Commercial[];
  clients?: Client[];
  getProspect: (id: string) => Prospect | undefined;
  filterCommercial: string;
  weekOffset: number;
  onEditRdv?: (rdv: Appointment) => void;
}

const HOUR_START = 8;
const HOUR_END = 19;
const SLOT_HEIGHT = 48; // px per hour

const STATUS_COLORS: Record<AppointmentStatus, { bg: string; border: string; text: string }> = {
  planifie: { bg: 'bg-blue-100', border: 'border-blue-300', text: 'text-blue-800' },
  confirme: { bg: 'bg-green-100', border: 'border-green-300', text: 'text-green-800' },
  termine: { bg: 'bg-gray-100', border: 'border-gray-300', text: 'text-gray-600' },
  annule: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-400 line-through' },
};

const COMMERCIAL_COLORS = [
  'border-l-blue-500',
  'border-l-emerald-500',
  'border-l-purple-500',
  'border-l-amber-500',
  'border-l-rose-500',
  'border-l-cyan-500',
];

function getWeekDays(offset: number): Date[] {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + offset * 7);
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function toDateStr(d: Date): string {
  return toLocalDateStr(d);
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

const DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export default function CommercialAgenda({
  appointments,
  commerciaux,
  clients = [],
  getProspect,
  filterCommercial,
  weekOffset,
  onEditRdv,
}: Props) {
  const weekDays = useMemo(() => getWeekDays(weekOffset), [weekOffset]);
  const hours = useMemo(() => Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i), []);

  // Group appointments by day
  const rdvByDay = useMemo(() => {
    const map: Record<string, Appointment[]> = {};
    for (const day of weekDays) {
      const dateStr = toDateStr(day);
      map[dateStr] = appointments
        .filter(a => a.date === dateStr && a.statut !== 'annule')
        .filter(a => !filterCommercial || a.commercial_id === filterCommercial)
        .sort((a, b) => a.heure_debut.localeCompare(b.heure_debut));
    }
    return map;
  }, [appointments, weekDays, filterCommercial]);

  // Detect conflicts: same commercial, same day, overlapping times
  const conflictIds = useMemo(() => {
    const ids = new Set<string>();
    for (const dateStr of Object.keys(rdvByDay)) {
      const dayRdvs = rdvByDay[dateStr];
      // Group by commercial
      const byCommercial: Record<string, Appointment[]> = {};
      for (const rdv of dayRdvs) {
        if (!byCommercial[rdv.commercial_id]) byCommercial[rdv.commercial_id] = [];
        byCommercial[rdv.commercial_id].push(rdv);
      }
      for (const comRdvs of Object.values(byCommercial)) {
        for (let i = 0; i < comRdvs.length; i++) {
          for (let j = i + 1; j < comRdvs.length; j++) {
            const a = comRdvs[i];
            const b = comRdvs[j];
            if (a.heure_debut < b.heure_fin && b.heure_debut < a.heure_fin) {
              ids.add(a.id);
              ids.add(b.id);
            }
          }
        }
      }
    }
    return ids;
  }, [rdvByDay]);

  const today = toDateStr(new Date());
  const totalHeight = (HOUR_END - HOUR_START) * SLOT_HEIGHT;

  const commercialColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    commerciaux.forEach((c, i) => {
      map[c.id] = COMMERCIAL_COLORS[i % COMMERCIAL_COLORS.length];
    });
    return map;
  }, [commerciaux]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Grid header */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-gray-200">
        <div className="p-2 bg-gray-50" />
        {weekDays.map((day, i) => {
          const dateStr = toDateStr(day);
          const isToday = dateStr === today;
          const rdvCount = rdvByDay[dateStr]?.length || 0;
          return (
            <div
              key={i}
              className={`p-2 text-center border-l border-gray-200 ${isToday ? 'bg-brewery-50' : 'bg-gray-50'}`}
            >
              <div className={`text-[10px] font-medium ${isToday ? 'text-brewery-600' : 'text-gray-500'}`}>
                {DAY_NAMES[i]}
              </div>
              <div className={`text-sm font-bold ${isToday ? 'text-brewery-700' : 'text-gray-900'}`}>
                {day.getDate()}
              </div>
              {rdvCount > 0 && (
                <div className={`text-[9px] mt-0.5 ${isToday ? 'text-brewery-500' : 'text-gray-400'}`}>
                  {rdvCount} RDV
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] overflow-x-auto">
        {/* Hour labels */}
        <div className="relative" style={{ height: totalHeight }}>
          {hours.map(h => (
            <div
              key={h}
              className="absolute left-0 right-0 text-[10px] text-gray-400 text-right pr-2 -translate-y-1/2"
              style={{ top: (h - HOUR_START) * SLOT_HEIGHT }}
            >
              {h}:00
            </div>
          ))}
        </div>

        {/* Day columns */}
        {weekDays.map((day, dayIdx) => {
          const dateStr = toDateStr(day);
          const dayRdvs = rdvByDay[dateStr] || [];
          const isToday = dateStr === today;

          return (
            <div
              key={dayIdx}
              className={`relative border-l border-gray-200 ${isToday ? 'bg-brewery-50/30' : ''}`}
              style={{ height: totalHeight }}
            >
              {/* Hour lines */}
              {hours.map(h => (
                <div
                  key={h}
                  className="absolute left-0 right-0 border-t border-gray-100"
                  style={{ top: (h - HOUR_START) * SLOT_HEIGHT }}
                />
              ))}
              {/* Half-hour lines */}
              {hours.map(h => (
                <div
                  key={`${h}-30`}
                  className="absolute left-0 right-0 border-t border-gray-50"
                  style={{ top: (h - HOUR_START) * SLOT_HEIGHT + SLOT_HEIGHT / 2 }}
                />
              ))}

              {/* Current time indicator */}
              {isToday && (() => {
                const now = new Date();
                const currentMinutes = now.getHours() * 60 + now.getMinutes();
                const top = ((currentMinutes / 60) - HOUR_START) * SLOT_HEIGHT;
                if (top >= 0 && top <= totalHeight) {
                  return (
                    <div
                      className="absolute left-0 right-0 h-0.5 bg-red-500 z-20"
                      style={{ top }}
                    >
                      <div className="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full bg-red-500" />
                    </div>
                  );
                }
                return null;
              })()}

              {/* Appointment blocks */}
              {dayRdvs.map(rdv => {
                const startMin = timeToMinutes(rdv.heure_debut);
                const endMin = timeToMinutes(rdv.heure_fin);
                const top = ((startMin / 60) - HOUR_START) * SLOT_HEIGHT;
                const height = Math.max(((endMin - startMin) / 60) * SLOT_HEIGHT, 20);
                const agendaIsEvent = rdv.event_type && rdv.event_type !== 'rdv';
                const prospect = rdv.prospect_id ? getProspect(rdv.prospect_id) : undefined;
                const agendaClient = rdv.client_id ? clients.find(c => c.id === rdv.client_id) : undefined;
                const agendaName = agendaIsEvent ? (rdv.titre || EVENT_TYPE_LABELS[rdv.event_type!]) : (agendaClient?.nom || prospect?.nom_etablissement || 'RDV');
                const commercial = commerciaux.find(c => c.id === rdv.commercial_id);
                const isConflict = conflictIds.has(rdv.id);
                const sc = STATUS_COLORS[rdv.statut];
                const comColor = commercialColorMap[rdv.commercial_id] || 'border-l-gray-400';
                const eventStyle = agendaIsEvent ? {
                  backgroundColor: rdv.event_type === 'reunion' ? '#f3e8ff' : rdv.event_type === 'boutique' ? '#fef3c7' : rdv.event_type === 'depot' ? '#ffedd5' : rdv.event_type === 'marche' ? '#dcfce7' : '#f3f4f6',
                  borderColor: rdv.event_type === 'reunion' ? '#c084fc' : rdv.event_type === 'boutique' ? '#fbbf24' : rdv.event_type === 'depot' ? '#fb923c' : rdv.event_type === 'marche' ? '#4ade80' : '#9ca3af',
                } : {};

                return (
                  <div
                    key={rdv.id}
                    className={`absolute left-0.5 right-0.5 rounded border-l-[3px] ${comColor} ${
                      isConflict ? 'bg-red-50 border border-red-300 ring-1 ring-red-300' : agendaIsEvent ? 'border' : `${sc.bg} border ${sc.border}`
                    } cursor-pointer hover:shadow-md transition-shadow overflow-hidden z-10 group`}
                    style={{ top: Math.max(top, 0), height, ...eventStyle }}
                    onClick={() => onEditRdv?.(rdv)}
                    title={`${agendaName} (${commercial?.prenom || '?'}) - ${rdv.heure_debut}-${rdv.heure_fin}`}
                  >
                    <div className="px-1.5 py-0.5">
                      {isConflict && (
                        <AlertTriangle className="w-3 h-3 text-red-500 float-right mt-0.5" />
                      )}
                      <p className={`text-[10px] font-semibold truncate ${isConflict ? 'text-red-700' : agendaIsEvent ? 'text-gray-800' : sc.text}`}>
                        {agendaIsEvent && <span className="text-[8px] opacity-70">{EVENT_TYPE_LABELS[rdv.event_type!]} - </span>}
                        {agendaName}
                      </p>
                      {height >= 36 && (
                        <p className="text-[9px] text-gray-500 truncate">
                          {rdv.heure_debut}-{rdv.heure_fin}
                        </p>
                      )}
                      {height >= 52 && !filterCommercial && (
                        <p className="text-[9px] text-gray-400 truncate">
                          {commercial?.prenom}
                          {(rdv.participants || []).length > 0 && ` +${rdv.participants!.length}`}
                        </p>
                      )}
                      {height >= 68 && rdv.lieu && (
                        <p className="text-[8px] text-gray-400 truncate flex items-center gap-0.5">
                          <MapPin className="w-2.5 h-2.5 inline flex-shrink-0" /> {rdv.lieu}
                        </p>
                      )}
                    </div>
                    {/* Export button on hover */}
                    {prospect && (
                      <button
                        className="absolute top-0.5 right-0.5 p-0.5 rounded bg-white/80 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={e => { e.stopPropagation(); downloadICS(rdv, prospect); }}
                        title="Ajouter a l'agenda"
                      >
                        <CalendarPlus className="w-3 h-3 text-blue-600" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      {!filterCommercial && (
        <div className="p-3 border-t border-gray-200 bg-gray-50 flex flex-wrap gap-3 items-center">
          <span className="text-[10px] text-gray-500 font-medium">Commerciaux :</span>
          {commerciaux.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1.5 text-[10px] text-gray-600">
              <span className={`w-3 h-3 rounded-sm border-l-[3px] ${COMMERCIAL_COLORS[i % COMMERCIAL_COLORS.length]} bg-white border border-gray-200`} />
              {c.prenom} {c.nom}
            </span>
          ))}
          {conflictIds.size > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-red-600 font-medium ml-2">
              <AlertTriangle className="w-3 h-3" /> {conflictIds.size} conflit{conflictIds.size > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
