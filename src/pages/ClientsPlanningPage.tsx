import { useState, useMemo, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ChevronRight, ChevronLeft, ChevronDown, ChevronUp,
  Calendar, CheckCircle2, Clock, AlertTriangle, Phone, MapPin, Map,
  ClipboardCheck, X,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import {
  Client, Appointment, AppointmentResult, APPOINTMENT_RESULT_LABELS,
} from '../types';
import { toLocalDateStr } from '../utils/helpers';
import { apiPut } from '../api/client';
import { usePersistedState } from '../hooks/usePersistedState';

export default function ClientsPlanningPage() {
  const { state, dispatchLocal, getCommercial } = useApp();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const isAdmin = state.currentUser?.role === 'admin';

  const [planningWeekOffset, setPlanningWeekOffset] = useState(0);
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const [lateCollapsed, setLateCollapsed] = useState(true);

  // Filter state (persisted, shared with ClientsPage)
  const [filterCommercialsArr] = usePersistedState<string[]>('clients_commercials', []);
  const filterCommercials = useMemo(() => new Set(filterCommercialsArr), [filterCommercialsArr]);

  // Tournee configs
  const [tourneeConfigs, setTourneeConfigs] = useState<Record<string, { config: Record<string, string[]>; week_pattern: string }>>({});

  // Load tournee configs
  useEffect(() => {
    const token = localStorage.getItem('suivipro_token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    fetch('/api/tournee-config', { headers })
      .then(r => r.ok ? r.json() : [])
      .then((rows: any[]) => {
        const map: Record<string, { config: Record<string, string[]>; week_pattern: string }> = {};
        rows.forEach(r => {
          const cfg = typeof r.config === 'string' ? JSON.parse(r.config) : r.config;
          map[r.commercial_id] = { config: cfg, week_pattern: r.week_pattern || 'every' };
        });
        setTourneeConfigs(map);
      })
      .catch(() => {});
  }, []);

  // CR modal state
  const [crModalRdv, setCrModalRdv] = useState<Appointment | null>(null);
  const [crForms, setCrForms] = useState<Record<string, { compte_rendu: AppointmentResult; notes: string }>>({});
  const [crSaving, setCrSaving] = useState<string | null>(null);

  const openCrModal = (rdv: Appointment) => {
    setCrModalRdv(rdv);
    if (!crForms[rdv.id]) {
      setCrForms(prev => ({ ...prev, [rdv.id]: { compte_rendu: (rdv.compte_rendu || '') as AppointmentResult, notes: rdv.notes_compte_rendu || '' } }));
    }
  };

  const saveCrModal = async () => {
    if (!crModalRdv) return;
    const form = crForms[crModalRdv.id];
    if (!form?.compte_rendu) { toast.error('Selectionnez un resultat'); return; }
    if (!form.notes?.trim()) { toast.error('Les notes sont obligatoires'); return; }
    setCrSaving(crModalRdv.id);
    try {
      const updated = { ...crModalRdv, statut: 'termine' as const, compte_rendu: form.compte_rendu, notes_compte_rendu: form.notes };
      await apiPut(`/appointments/${crModalRdv.id}`, updated);
      dispatchLocal({ type: 'UPDATE_APPOINTMENT', payload: updated });
      toast.success('Compte rendu enregistre');
      setCrModalRdv(null);
    } catch { toast.error('Erreur lors de la sauvegarde'); }
    finally { setCrSaving(null); }
  };

  const getRdvEntityName = (rdv: Appointment) => {
    if (rdv.client_id) {
      const c = state.clients.find(cl => cl.id === rdv.client_id);
      return c?.nom || 'Client inconnu';
    }
    const p = state.prospects.find(pr => pr.id === rdv.prospect_id);
    return p?.nom_etablissement || 'Prospect inconnu';
  };

  const getRdvEntityPhone = (rdv: Appointment) => {
    if (rdv.client_id) {
      const c = state.clients.find(cl => cl.id === rdv.client_id);
      return c?.telephone_mobile || c?.telephone || '';
    }
    const p = state.prospects.find(pr => pr.id === rdv.prospect_id);
    return p?.telephone || '';
  };

  const toggleDay = useCallback((dateStr: string) => {
    setCollapsedDays(prev => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr);
      else next.add(dateStr);
      return next;
    });
  }, []);

  // Planning data computation
  const planningData = useMemo(() => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + (planningWeekOffset * 7));
    monday.setHours(0, 0, 0, 0);

    const startOfYear = new Date(monday.getFullYear(), 0, 1);
    const weekNumber = Math.ceil(((monday.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);

    const days: { date: Date; dateStr: string; label: string; dayKey: string }[] = [];
    const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    for (let i = 0; i < 6; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push({
        date: d,
        dateStr: toLocalDateStr(d),
        label: `${dayNames[i]} ${d.getDate()}/${d.getMonth() + 1}`,
        dayKey: String(i + 1),
      });
    }

    const weekStart = days[0].dateStr;

    const targetCommercialId = filterCommercials.size === 1 ? Array.from(filterCommercials)[0] : (!isAdmin && state.currentUser ? state.currentUser.id : '');

    let clientsBase = state.clients.filter(c => c.statut === 'ACTIF');
    if (targetCommercialId) {
      clientsBase = clientsBase.filter(c => c.commercial_id === targetCommercialId);
    } else if (!isAdmin && state.currentUser) {
      clientsBase = clientsBase.filter(c => c.commercial_id === state.currentUser!.id);
    }

    // Late clients
    const lateClients = clientsBase.filter(c => c.next_visit && c.next_visit < weekStart);
    const groupByTournee = (clients: Client[]) => {
      const groups: Record<string, Client[]> = {};
      clients.forEach(c => {
        const key = c.tournee || 'Sans secteur';
        if (!groups[key]) groups[key] = [];
        groups[key].push(c);
      });
      return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
    };
    const lateGroups = groupByTournee(lateClients);

    type DayData = {
      date: Date;
      dateStr: string;
      label: string;
      dayKey: string;
      sectors: { zone: string; clients: Client[]; visitDueClients: Client[] }[];
      totalClients: number;
      visitDueCount: number;
    };

    const byDay: DayData[] = days.map(day => {
      const zonesToShow = new Set<string>();
      const commercialIds = targetCommercialId ? [targetCommercialId] : Object.keys(tourneeConfigs);

      for (const commId of commercialIds) {
        const tc = tourneeConfigs[commId];
        if (!tc) continue;
        if (tc.week_pattern === 'even' && weekNumber % 2 !== 0) continue;
        if (tc.week_pattern === 'odd' && weekNumber % 2 !== 1) continue;
        const dayZones = tc.config[day.dayKey];
        if (Array.isArray(dayZones)) {
          dayZones.forEach(z => { if (typeof z === 'string') zonesToShow.add(z); });
        }
      }

      const sectors = Array.from(zonesToShow).sort().map(zone => {
        const zoneClients = clientsBase.filter(c =>
          c.tournee && c.tournee.toLowerCase() === zone.toLowerCase()
        );
        const visitDueClients = zoneClients.filter(c =>
          c.next_visit && c.next_visit <= day.dateStr
        );
        return { zone, clients: zoneClients, visitDueClients };
      });

      const totalClients = sectors.reduce((sum, s) => sum + s.clients.length, 0);
      const visitDueCount = sectors.reduce((sum, s) => sum + s.visitDueClients.length, 0);

      return { ...day, sectors, totalClients, visitDueCount };
    });

    // Appointments for the week
    const weekEnd = days[days.length - 1].dateStr;
    const weekAppointments = state.appointments.filter(rdv => {
      if (rdv.statut === 'annule') return false;
      if (rdv.date < weekStart || rdv.date > weekEnd) return false;
      if (targetCommercialId && rdv.commercial_id !== targetCommercialId) return false;
      if (!targetCommercialId && !isAdmin && state.currentUser && rdv.commercial_id !== state.currentUser.id) return false;
      return true;
    });

    const rdvByDate: Record<string, Appointment[]> = {};
    weekAppointments.forEach(rdv => {
      const d = rdv.date.split('T')[0];
      if (!rdvByDate[d]) rdvByDate[d] = [];
      rdvByDate[d].push(rdv);
    });
    Object.values(rdvByDate).forEach(arr => arr.sort((a, b) => (a.heure_debut || '').localeCompare(b.heure_debut || '')));

    const weekLabel = `${days[0].date.getDate()}/${days[0].date.getMonth() + 1} - ${days[days.length - 1].date.getDate()}/${days[days.length - 1].date.getMonth() + 1}/${days[days.length - 1].date.getFullYear()}`;
    const weekTotal = byDay.reduce((sum, d) => sum + d.totalClients, 0);

    return { days: byDay, lateGroups, lateCount: lateClients.length, weekLabel, weekTotal, rdvByDate };
  }, [state.clients, state.appointments, planningWeekOffset, isAdmin, state.currentUser, filterCommercials, tourneeConfigs]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Week navigation */}
      <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-4 py-2.5">
        <button onClick={() => setPlanningWeekOffset(o => o - 1)} className="p-1.5 rounded-lg hover:bg-gray-100">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="text-center">
          <span className="font-semibold text-sm text-gray-900">Semaine du {planningData.weekLabel}</span>
          <span className="text-xs text-gray-500 ml-2">({planningData.weekTotal} client{planningData.weekTotal > 1 ? 's' : ''})</span>
        </div>
        <div className="flex items-center gap-1">
          {planningWeekOffset !== 0 && (
            <button onClick={() => setPlanningWeekOffset(0)} className="px-2 py-1 text-[10px] text-brewery-600 hover:bg-brewery-50 rounded">
              Aujourd'hui
            </button>
          )}
          <button onClick={() => setPlanningWeekOffset(o => o + 1)} className="p-1.5 rounded-lg hover:bg-gray-100">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Late clients - collapsible */}
      {planningData.lateCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg">
          <button
            onClick={() => setLateCollapsed(prev => !prev)}
            className="w-full flex items-center justify-between p-3 text-left"
          >
            <h3 className="text-sm font-semibold text-red-700 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" />
              En retard ({planningData.lateCount})
            </h3>
            {lateCollapsed ? <ChevronDown className="w-4 h-4 text-red-400" /> : <ChevronUp className="w-4 h-4 text-red-400" />}
          </button>
          {!lateCollapsed && (
            <div className="px-3 pb-3 space-y-2">
              {planningData.lateGroups.map(([tournee, clients]) => (
                <div key={tournee}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Map className="w-3 h-3 text-red-500" />
                    <span className="text-xs font-medium text-red-600">{tournee}</span>
                    <span className="text-[10px] text-red-400">({clients.length})</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 ml-4">
                    {clients.map(c => (
                      <button
                        key={c.id}
                        onClick={() => setSearchParams({ id: c.id })}
                        className="px-2 py-1 bg-white border border-red-200 rounded text-xs text-red-700 hover:bg-red-100 transition-colors flex items-center gap-1"
                      >
                        <span className="font-medium">{c.nom}</span>
                        <span className="text-[10px] text-red-400">{c.ville}</span>
                        {c.next_visit && <span className="text-[9px] text-red-300">({c.next_visit.substring(5).replace('-', '/')})</span>}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Days of the week - collapsible */}
      <div className="space-y-3">
        {planningData.days.map(day => {
          const isToday = day.dateStr === toLocalDateStr(new Date());
          const isPast = day.dateStr < toLocalDateStr(new Date());
          const isCollapsed = collapsedDays.has(day.dateStr);
          return (
            <div
              key={day.dateStr}
              className={`rounded-lg border ${
                isToday ? 'bg-brewery-50 border-brewery-300' : isPast ? 'bg-gray-50 border-gray-200 opacity-70' : 'bg-white border-gray-200'
              }`}
            >
              {/* Day header - clickable to toggle */}
              <button
                onClick={() => toggleDay(day.dateStr)}
                className="w-full flex items-center justify-between p-3 text-left"
              >
                <h3 className={`text-sm font-semibold ${isToday ? 'text-brewery-700' : 'text-gray-700'}`}>
                  {day.label}
                  {isToday && <span className="ml-2 px-1.5 py-0.5 bg-brewery-600 text-white rounded text-[10px]">Aujourd'hui</span>}
                </h3>
                <div className="flex items-center gap-2">
                  {day.visitDueCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded font-medium">
                      {day.visitDueCount} a visiter
                    </span>
                  )}
                  <span className="text-xs text-gray-400">{day.totalClients} client{day.totalClients > 1 ? 's' : ''}</span>
                  {isCollapsed ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronUp className="w-4 h-4 text-gray-400" />}
                </div>
              </button>

              {/* Day content - collapsible */}
              {!isCollapsed && (
                <div className="px-3 pb-3">
                  {/* RDV section */}
                  {(planningData.rdvByDate[day.dateStr] || []).length > 0 && (
                    <div className="mb-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                        <span className="text-xs font-semibold text-indigo-600">Rendez-vous ({planningData.rdvByDate[day.dateStr].length})</span>
                      </div>
                      <div className="space-y-2 ml-1">
                        {planningData.rdvByDate[day.dateStr].map(rdv => {
                          const hasCR = !!rdv.compte_rendu;
                          const entityName = getRdvEntityName(rdv);
                          const entityPhone = getRdvEntityPhone(rdv);
                          const comm = getCommercial(rdv.commercial_id);
                          return (
                            <div key={rdv.id} className={`rounded-lg border p-2.5 ${hasCR ? 'border-green-200 bg-green-50/50' : 'border-indigo-200 bg-indigo-50/30'}`}>
                              <div className="flex items-start gap-2">
                                {hasCR
                                  ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                  : <AlertTriangle className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
                                }
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-xs text-gray-800">{entityName}</span>
                                    {isAdmin && comm && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{comm.prenom}</span>}
                                    {hasCR && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">{APPOINTMENT_RESULT_LABELS[rdv.compte_rendu!] || rdv.compte_rendu}</span>}
                                  </div>
                                  <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
                                    {rdv.heure_debut && <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" />{rdv.heure_debut}{rdv.heure_fin ? ` - ${rdv.heure_fin}` : ''}</span>}
                                    {rdv.lieu && <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{rdv.lieu}</span>}
                                  </div>
                                  {rdv.notes && <p className="text-[10px] text-gray-400 mt-0.5 italic line-clamp-1">{rdv.notes}</p>}
                                  {hasCR && rdv.notes_compte_rendu && <p className="text-[10px] text-green-600 mt-0.5 italic line-clamp-1">{rdv.notes_compte_rendu}</p>}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-gray-100">
                                <button
                                  onClick={() => openCrModal(rdv)}
                                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                    hasCR ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-indigo-600 text-white hover:bg-indigo-700'
                                  }`}
                                >
                                  <ClipboardCheck className="w-3.5 h-3.5" /> {hasCR ? 'Modifier le CR' : 'Compte-rendu'}
                                </button>
                                {entityPhone && (
                                  <a href={`tel:${entityPhone.replace(/\s/g, '')}`} onClick={e => e.stopPropagation()}
                                    className="p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 transition-colors">
                                    <Phone className="w-3.5 h-3.5" />
                                  </a>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {day.sectors.length === 0 && !(planningData.rdvByDate[day.dateStr] || []).length ? (
                    <p className="text-xs text-gray-400 italic">Aucun secteur prevu ce jour</p>
                  ) : day.sectors.length > 0 ? (
                    <div className="space-y-3">
                      {day.sectors.map(sector => (
                        <div key={sector.zone}>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Map className="w-3.5 h-3.5 text-indigo-400" />
                            <span className="text-xs font-semibold text-indigo-600">{sector.zone}</span>
                            <span className="text-[10px] text-gray-400">{sector.clients.length} client{sector.clients.length > 1 ? 's' : ''}</span>
                            {sector.visitDueClients.length > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-600 rounded">
                                {sector.visitDueClients.length} en attente
                              </span>
                            )}
                          </div>
                          {sector.clients.length === 0 ? (
                            <p className="text-[10px] text-gray-300 italic ml-5">Aucun client dans ce secteur</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5 ml-5">
                              {sector.clients.map(c => {
                                const comm = getCommercial(c.commercial_id);
                                const isDue = c.next_visit && c.next_visit <= day.dateStr;
                                const isLate = c.next_visit && c.next_visit < toLocalDateStr(new Date());
                                return (
                                  <button
                                    key={c.id}
                                    onClick={() => setSearchParams({ id: c.id })}
                                    className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors hover:shadow-sm ${
                                      isLate ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                                      : isDue ? 'bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100'
                                      : isToday ? 'bg-white border-brewery-200 text-brewery-700 hover:bg-brewery-100'
                                      : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                                    }`}
                                  >
                                    <span className="font-medium">{c.nom}</span>
                                    <span className="text-gray-400 ml-1">{c.ville}</span>
                                    {isDue && c.next_visit && (
                                      <span className="text-[9px] ml-1 opacity-60">
                                        ({c.next_visit.substring(5).replace('-', '/')})
                                      </span>
                                    )}
                                    {isAdmin && comm && <span className="text-[10px] text-gray-300 ml-1">• {comm.prenom}</span>}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* CR Modal */}
      {crModalRdv && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setCrModalRdv(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
                  <ClipboardCheck className="w-5 h-5 text-indigo-600" />
                  Compte-rendu du RDV
                </h3>
                <p className="text-sm text-gray-500 mt-0.5">{getRdvEntityName(crModalRdv)} - {crModalRdv.date}</p>
              </div>
              <button onClick={() => setCrModalRdv(null)} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">Resultat du rendez-vous</label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(APPOINTMENT_RESULT_LABELS).map(([key, label]) => {
                    const sel = crForms[crModalRdv.id]?.compte_rendu === key;
                    const icons: Record<string, string> = {
                      client: 'text-green-600', mail_envoye: 'text-blue-600',
                      commande_plus_tard: 'text-yellow-600', a_relancer: 'text-orange-600',
                      pas_interesse: 'text-red-600',
                    };
                    return (
                      <button key={key}
                        onClick={() => setCrForms(prev => ({ ...prev, [crModalRdv.id]: { ...prev[crModalRdv.id], compte_rendu: key as AppointmentResult } }))}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border transition-all ${sel ? 'border-indigo-300 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-200' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                      >
                        <span className={icons[key] || ''}>{key === 'client' ? '👥' : key === 'mail_envoye' ? '📧' : key === 'commande_plus_tard' ? '🛒' : key === 'a_relancer' ? '🔄' : '🚫'}</span>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Notes du compte-rendu *</label>
                <textarea
                  value={crForms[crModalRdv.id]?.notes || ''}
                  onChange={e => setCrForms(prev => ({ ...prev, [crModalRdv.id]: { ...prev[crModalRdv.id], notes: e.target.value } }))}
                  placeholder="Comment s'est passe le rendez-vous ? (obligatoire)"
                  className={`w-full text-sm border rounded-lg px-3 py-2 resize-none h-24 focus:ring-2 focus:ring-indigo-300 ${!crForms[crModalRdv.id]?.notes?.trim() ? 'border-red-300' : 'border-gray-300'}`}
                  autoFocus
                />
                {!crForms[crModalRdv.id]?.notes?.trim() && (
                  <p className="text-xs text-red-500 mt-1">Les notes sont obligatoires pour valider le compte-rendu</p>
                )}
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
              <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setCrModalRdv(null)}>Annuler</button>
              <button
                className="px-5 py-2.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2 disabled:opacity-50 font-medium"
                onClick={saveCrModal}
                disabled={crSaving === crModalRdv.id || !crForms[crModalRdv.id]?.compte_rendu || !crForms[crModalRdv.id]?.notes?.trim()}
              >
                <ClipboardCheck className="w-4 h-4" /> {crSaving === crModalRdv.id ? 'Enregistrement...' : 'Valider le compte-rendu'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
