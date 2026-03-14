import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardCheck, RefreshCw, AlertTriangle, MapPin, Phone, Building2,
  ChevronDown, ChevronRight, Calendar, CheckCircle2,
  Navigation, ChevronLeft, ArrowLeft, ArrowRight,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import { CLIENT_TYPE_LABELS } from '../types';

interface VisitClient {
  id: string;
  nom: string;
  ville: string;
  adresse: string;
  telephone: string;
  telephone_mobile: string;
  email: string;
  type_client: string;
  tournee: string;
  next_visit: string;
  last_visit: string;
  latitude: number | null;
  longitude: number | null;
  contact: string;
}

interface WeekDay {
  day_key: string;
  date: string;
  day_name: string;
  tournees: string[];
  clients: VisitClient[];
  is_today: boolean;
  is_past: boolean;
}

interface VisitesData {
  week_days: WeekDay[];
  late_clients: VisitClient[];
  week_number: number;
  is_even_week: boolean;
  week_pattern: string;
  week_offset: number;
  week_start: string;
  tournee_active: boolean;
  total_active_clients: number;
}

export default function VisitesPage() {
  const { state } = useApp();
  const toast = useToast();
  const [data, setData] = useState<VisitesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [showLate, setShowLate] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);

  const token = localStorage.getItem('suivipro_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const loadData = useCallback(async (offset: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/commercial/visites?week_offset=${offset}`, { headers });
      if (res.ok) {
        const d: VisitesData = await res.json();
        setData(d);
        const expanded = new Set<string>();
        d.week_days.forEach(wd => {
          if (wd.is_today || wd.clients.length > 0) expanded.add(wd.day_key);
        });
        setExpandedDays(expanded);
      } else {
        toast.error('Erreur chargement des visites');
      }
    } catch {
      toast.error('Erreur reseau');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(weekOffset); }, [weekOffset, loadData]);

  const goToPreviousWeek = () => setWeekOffset(prev => prev - 1);
  const goToNextWeek = () => setWeekOffset(prev => prev + 1);
  const goToCurrentWeek = () => setWeekOffset(0);

  const toggleDay = (key: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const daysUntil = (dateStr: string) => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const d = new Date(dateStr);
    return Math.ceil((d.getTime() - now.getTime()) / 86400000);
  };

  const formatShortDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };

  const formatWeekRange = (weekStart: string) => {
    const start = new Date(weekStart);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    return `${start.toLocaleDateString('fr-FR', opts)} - ${end.toLocaleDateString('fr-FR', opts)}`;
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Chargement...</span>
      </div>
    );
  }

  if (!data) return null;

  const totalWeekClients = data.week_days.reduce((sum, d) => sum + d.clients.length, 0);
  const todayDay = data.week_days.find(d => d.is_today);
  const isCurrentWeek = weekOffset === 0;

  const renderClient = (client: VisitClient, showVisitInfo = false) => {
    const isLate = client.next_visit && client.next_visit < new Date().toISOString().split('T')[0];
    const daysLate = isLate ? Math.abs(daysUntil(client.next_visit)) : 0;
    const gmapsUrl = client.latitude && client.longitude
      ? `https://www.google.com/maps/dir/?api=1&destination=${client.latitude},${client.longitude}`
      : client.adresse
        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(client.adresse + (client.ville ? ', ' + client.ville : ''))}`
        : null;

    return (
      <div
        key={client.id}
        className={`p-3 rounded-lg border transition-colors ${
          isLate ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200 hover:border-gray-300'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className={`w-4 h-4 flex-shrink-0 ${isLate ? 'text-red-500' : 'text-brewery-600'}`} />
              <h4 className="font-semibold text-gray-900 text-sm truncate">{client.nom}</h4>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1">
                {CLIENT_TYPE_LABELS[client.type_client as keyof typeof CLIENT_TYPE_LABELS] || client.type_client}
              </span>
              {client.tournee && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded font-medium">
                  <MapPin className="w-3 h-3" />{client.tournee}
                </span>
              )}
              {client.ville && (
                <span className="inline-flex items-center gap-1 text-gray-400">
                  {client.ville}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs">
              {(client.telephone_mobile || client.telephone) && (
                <a
                  href={`tel:${client.telephone_mobile || client.telephone}`}
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                >
                  <Phone className="w-3 h-3" />
                  {client.telephone_mobile || client.telephone}
                </a>
              )}
              {client.contact && (
                <span className="text-gray-500">{client.contact}</span>
              )}
            </div>
            {showVisitInfo && client.next_visit && (
              <div className="mt-1.5 flex items-center gap-1 text-xs">
                {isLate ? (
                  <span className="text-red-600 font-medium flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    En retard de {daysLate}j (prevu le {formatShortDate(client.next_visit)})
                  </span>
                ) : (
                  <span className="text-gray-500 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Prochaine: {formatShortDate(client.next_visit)}
                  </span>
                )}
              </div>
            )}
            {client.last_visit && (
              <div className="mt-0.5 text-[10px] text-gray-400">
                Derniere visite: {formatShortDate(client.last_visit)}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            {gmapsUrl && (
              <a
                href={gmapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                title="Itineraire Google Maps"
              >
                <Navigation className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 fade-in max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 sm:w-6 sm:h-6" />
            Visites Clients
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            {!data.tournee_active && (
              <span className="text-amber-600 font-medium">
                Tournee inactive cette semaine ({data.week_pattern === 'even' ? 'semaines paires' : 'semaines impaires'})
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => loadData(weekOffset)} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Week navigator */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 flex items-center justify-between gap-2">
        <button
          onClick={goToPreviousWeek}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
          title="Semaine precedente"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex-1 text-center">
          <div className="flex items-center justify-center gap-2">
            <p className="font-semibold text-gray-900 text-sm sm:text-base">
              Semaine {data.week_number}
            </p>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
              {data.is_even_week ? 'paire' : 'impaire'}
            </span>
            {isCurrentWeek && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brewery-100 text-brewery-700 font-medium">
                Cette semaine
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {formatWeekRange(data.week_start)}
          </p>
        </div>

        <button
          onClick={goToNextWeek}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
          title="Semaine suivante"
        >
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>

      {/* Back to current week button */}
      {!isCurrentWeek && (
        <button
          onClick={goToCurrentWeek}
          className="w-full py-2 text-sm font-medium text-brewery-600 bg-brewery-50 hover:bg-brewery-100 rounded-lg border border-brewery-200 transition-colors flex items-center justify-center gap-2"
        >
          <ChevronLeft className="w-4 h-4" />
          Revenir a la semaine en cours
        </button>
      )}

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-2xl font-bold text-brewery-600">{data.total_active_clients}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">Clients actifs</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-2xl font-bold text-indigo-600">{totalWeekClients}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">Visites cette semaine</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{todayDay?.clients.length || 0}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">Visites aujourd'hui</p>
        </div>
        <div className={`rounded-xl border p-3 text-center ${
          data.late_clients.length > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'
        }`}>
          <p className={`text-2xl font-bold ${data.late_clients.length > 0 ? 'text-red-600' : 'text-gray-400'}`}>
            {data.late_clients.length}
          </p>
          <p className="text-[10px] text-gray-500 mt-0.5">En retard</p>
        </div>
      </div>

      {/* Late clients section */}
      {data.late_clients.length > 0 && (
        <div className="bg-red-50 rounded-xl border border-red-200 overflow-hidden">
          <button
            onClick={() => setShowLate(!showLate)}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-red-100/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <h2 className="font-semibold text-red-800 text-sm">
                Clients en retard ({data.late_clients.length})
              </h2>
            </div>
            {showLate ? <ChevronDown className="w-4 h-4 text-red-400" /> : <ChevronRight className="w-4 h-4 text-red-400" />}
          </button>
          {showLate && (
            <div className="px-3 sm:px-4 pb-3 sm:pb-4 space-y-2">
              {data.late_clients
                .sort((a, b) => (a.next_visit || '').localeCompare(b.next_visit || ''))
                .map(client => renderClient(client, true))}
            </div>
          )}
        </div>
      )}

      {/* Week days */}
      <div className="space-y-3">
        {data.week_days.map(day => {
          const isExpanded = expandedDays.has(day.day_key);
          const isPast = day.is_past && !day.is_today;

          return (
            <div
              key={day.day_key}
              className={`rounded-xl border overflow-hidden transition-shadow ${
                day.is_today
                  ? 'border-brewery-300 bg-brewery-50/30 shadow-sm'
                  : isPast
                    ? 'border-gray-200 bg-gray-50/50 opacity-60'
                    : 'border-gray-200 bg-white'
              }`}
            >
              <button
                onClick={() => toggleDay(day.day_key)}
                className="w-full flex items-center justify-between px-3 sm:px-4 py-3 text-left hover:bg-gray-50/50 transition-colors"
              >
                <div className="flex items-center gap-2 sm:gap-3">
                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  }
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold text-sm ${day.is_today ? 'text-brewery-700' : 'text-gray-900'}`}>
                        {day.day_name}
                      </span>
                      <span className="text-xs text-gray-400">{formatShortDate(day.date)}</span>
                      {day.is_today && (
                        <span className="px-1.5 py-0.5 bg-brewery-600 text-white text-[10px] rounded-full font-medium">
                          Aujourd'hui
                        </span>
                      )}
                    </div>
                    {day.tournees.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {day.tournees.map((t, i) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded font-medium">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {day.clients.length > 0 ? (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      day.is_today ? 'bg-brewery-100 text-brewery-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {day.clients.length} visite{day.clients.length > 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">Aucune visite</span>
                  )}
                  {isPast && day.clients.length > 0 && (
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                  )}
                </div>
              </button>

              {isExpanded && day.clients.length > 0 && (
                <div className="px-3 sm:px-4 pb-3 sm:pb-4 space-y-2">
                  {day.clients.map(client => renderClient(client))}
                </div>
              )}

              {isExpanded && day.clients.length === 0 && (
                <div className="px-4 pb-4">
                  <p className="text-sm text-gray-400 italic">
                    {day.tournees.length > 0
                      ? 'Aucun client sur ces tournees'
                      : 'Pas de tournee configuree pour ce jour'}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
