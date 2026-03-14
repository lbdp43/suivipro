import { useState, useMemo } from 'react';
import {
  Calendar, ChevronDown, ClipboardCheck, MapPin, Clock, User,
  CheckCircle2, XCircle, AlertCircle, FileText, Save, Building2,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import {
  Appointment, Client, Interaction,
  APPOINTMENT_RESULT_LABELS, APPOINTMENT_STATUS_LABELS,
  AppointmentResult,
} from '../types';
import { generateId } from '../utils/helpers';

const DAY_LABELS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

function getDateForDay(dayOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString().split('T')[0];
}

function getWeekDays(): { label: string; date: string; isToday: boolean }[] {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=dim
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    days.push({
      label: DAY_LABELS[d.getDay()],
      date: dateStr,
      isToday: dateStr === today.toISOString().split('T')[0],
    });
  }
  return days;
}

export default function CompteRenduPage() {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const weekDays = useMemo(() => getWeekDays(), []);
  const todayStr = new Date().toISOString().split('T')[0];

  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [expandedRdv, setExpandedRdv] = useState<string | null>(null);
  const [expandedVisit, setExpandedVisit] = useState<string | null>(null);
  const [crForms, setCrForms] = useState<Record<string, { compte_rendu: AppointmentResult; notes: string }>>({});
  const [visitComments, setVisitComments] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const userId = state.currentUser?.id;

  // Get day-of-week for tournee matching
  const selectedDow = new Date(selectedDate + 'T12:00:00').getDay().toString();

  // Find user's tournee config (config is a JSON string)
  const myTourneeConfig = state.tourneeConfigs?.find((tc: any) => tc.commercial_id === userId);
  const parsedConfig = useMemo(() => {
    if (!myTourneeConfig?.config) return {};
    if (typeof myTourneeConfig.config === 'string') {
      try { return JSON.parse(myTourneeConfig.config); } catch { return {}; }
    }
    return myTourneeConfig.config;
  }, [myTourneeConfig?.config]);
  const dayZones: string[] = Array.isArray(parsedConfig[selectedDow]) ? parsedConfig[selectedDow] : [];

  // RDVs for the selected day (my RDVs)
  const dayAppointments = useMemo(() => {
    return state.appointments.filter((a: Appointment) =>
      a.date === selectedDate &&
      (a.commercial_id === userId || a.prospecteur_id === userId)
    ).sort((a: Appointment, b: Appointment) => (a.heure_debut || '').localeCompare(b.heure_debut || ''));
  }, [state.appointments, selectedDate, userId]);

  // Clients to visit for today's zones
  const clientsToVisit = useMemo(() => {
    if (dayZones.length === 0) return [];
    return state.clients.filter((c: Client) =>
      c.commercial_id === userId &&
      c.statut === 'ACTIF' &&
      dayZones.includes(c.tournee)
    ).sort((a: Client, b: Client) => a.nom.localeCompare(b.nom));
  }, [state.clients, dayZones, userId]);

  // Interactions (visits) already done today
  const todayInteractions = useMemo(() => {
    return state.interactions.filter((i: Interaction) =>
      i.date.startsWith(selectedDate) &&
      i.commercial_id === userId
    );
  }, [state.interactions, selectedDate, userId]);

  const visitedClientIds = new Set(todayInteractions.map((i: Interaction) => i.client_id));

  // Save compte rendu for a RDV
  const saveCompteRendu = async (rdv: Appointment) => {
    const form = crForms[rdv.id];
    if (!form) return;
    setSaving(rdv.id);
    try {
      const updated = {
        ...rdv,
        statut: 'termine' as const,
        compte_rendu: form.compte_rendu,
        notes_compte_rendu: form.notes,
      };
      const token = localStorage.getItem('suivipro_token');
      const res = await fetch(`/api/appointments/${rdv.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(updated),
      });
      if (res.ok) {
        dispatch({ type: 'UPDATE_APPOINTMENT', payload: updated });
        toast.success('Compte rendu enregistre');
        setExpandedRdv(null);
      }
    } catch (err) {
      toast.error('Erreur lors de la sauvegarde');
    } finally {
      setSaving(null);
    }
  };

  // Log a visit for a client
  const logVisit = async (client: Client, comment: string) => {
    setSaving(client.id);
    try {
      const interaction = {
        id: generateId(),
        client_id: client.id,
        commercial_id: userId!,
        type: 'VISITE' as const,
        date: new Date().toISOString(),
        comment: comment || '',
        date_creation: new Date().toISOString(),
      };
      const token = localStorage.getItem('suivipro_token');
      const res = await fetch('/api/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(interaction),
      });
      if (res.ok) {
        dispatch({ type: 'ADD_INTERACTION', payload: interaction });
        toast.success(`Visite enregistree pour ${client.nom}`);
        setExpandedVisit(null);
        setVisitComments(prev => ({ ...prev, [client.id]: '' }));
      }
    } catch (err) {
      toast.error('Erreur lors de la sauvegarde');
    } finally {
      setSaving(null);
    }
  };

  const getProspectName = (prospectId: string) => {
    const p = state.prospects.find((p: any) => p.id === prospectId);
    return p?.nom_etablissement || '';
  };

  const getClientName = (clientId: string) => {
    const c = state.clients.find((c: Client) => c.id === clientId);
    return c?.nom || '';
  };

  const selectedDay = weekDays.find(d => d.date === selectedDate);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <ClipboardCheck className="w-7 h-7 text-brewery-600" />
            Compte Rendu
          </h1>
          <p className="text-sm text-gray-500 mt-1">Faites le bilan de votre journee</p>
        </div>
      </div>

      {/* Day selector */}
      <div className="mb-6">
        <div className="flex gap-1.5 overflow-x-auto pb-2">
          {weekDays.map(day => (
            <button
              key={day.date}
              onClick={() => setSelectedDate(day.date)}
              className={`flex-shrink-0 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                day.date === selectedDate
                  ? 'bg-brewery-600 text-white shadow-sm'
                  : day.isToday
                    ? 'bg-brewery-50 text-brewery-700 border border-brewery-200'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div className="text-xs">{day.label.substring(0, 3)}</div>
              <div className="text-lg font-bold">{new Date(day.date + 'T12:00:00').getDate()}</div>
            </button>
          ))}
        </div>
        <p className="text-sm text-gray-500 mt-2">
          {selectedDay?.label} {new Date(selectedDate + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
          {dayZones.length > 0 && (
            <span className="ml-2 text-brewery-600">
              — {dayZones.join(', ')}
            </span>
          )}
        </p>
      </div>

      {/* RDV Section */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <Calendar className="w-5 h-5 text-indigo-500" />
          Rendez-vous ({dayAppointments.length})
        </h2>

        {dayAppointments.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
            <p className="text-sm text-gray-400">Aucun RDV ce jour</p>
          </div>
        ) : (
          <div className="space-y-3">
            {dayAppointments.map((rdv: Appointment) => {
              const isExpanded = expandedRdv === rdv.id;
              const hasCR = !!rdv.compte_rendu;
              const prospectName = rdv.prospect_id ? getProspectName(rdv.prospect_id) : '';
              const clientName = rdv.client_id ? getClientName(rdv.client_id) : '';
              const entityName = clientName || prospectName || 'N/A';

              return (
                <div key={rdv.id} className={`bg-white rounded-xl border ${hasCR ? 'border-green-200 bg-green-50/30' : 'border-gray-200'} overflow-hidden`}>
                  <button
                    onClick={() => {
                      setExpandedRdv(isExpanded ? null : rdv.id);
                      if (!isExpanded && !crForms[rdv.id]) {
                        setCrForms(prev => ({
                          ...prev,
                          [rdv.id]: {
                            compte_rendu: (rdv.compte_rendu || '') as AppointmentResult,
                            notes: rdv.notes_compte_rendu || '',
                          },
                        }));
                      }
                    }}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50"
                  >
                    {hasCR ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-orange-400 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-gray-800 truncate">{entityName}</span>
                        {hasCR && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                            {APPOINTMENT_RESULT_LABELS[rdv.compte_rendu!] || rdv.compte_rendu}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                        {rdv.heure_debut && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{rdv.heure_debut}{rdv.heure_fin ? ` - ${rdv.heure_fin}` : ''}</span>}
                        {rdv.lieu && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{rdv.lieu}</span>}
                      </div>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
                      {rdv.notes && (
                        <p className="text-xs text-gray-500 italic bg-gray-50 rounded-lg p-2">{rdv.notes}</p>
                      )}

                      <div>
                        <label className="text-xs font-medium text-gray-600 mb-1 block">Resultat du RDV</label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                          {Object.entries(APPOINTMENT_RESULT_LABELS).map(([key, label]) => {
                            const selected = crForms[rdv.id]?.compte_rendu === key;
                            const colors: Record<string, string> = {
                              client: 'border-green-300 bg-green-50 text-green-700',
                              mail_envoye: 'border-blue-300 bg-blue-50 text-blue-700',
                              commande_plus_tard: 'border-yellow-300 bg-yellow-50 text-yellow-700',
                              a_relancer: 'border-orange-300 bg-orange-50 text-orange-700',
                              pas_interesse: 'border-red-300 bg-red-50 text-red-700',
                            };
                            return (
                              <button
                                key={key}
                                onClick={() => setCrForms(prev => ({
                                  ...prev,
                                  [rdv.id]: { ...prev[rdv.id], compte_rendu: key as AppointmentResult },
                                }))}
                                className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                                  selected
                                    ? colors[key] || 'border-gray-300 bg-gray-50'
                                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <label className="text-xs font-medium text-gray-600 mb-1 block">Notes</label>
                        <textarea
                          value={crForms[rdv.id]?.notes || ''}
                          onChange={e => setCrForms(prev => ({
                            ...prev,
                            [rdv.id]: { ...prev[rdv.id], notes: e.target.value },
                          }))}
                          placeholder="Notes sur le RDV..."
                          className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 resize-none h-20"
                        />
                      </div>

                      <button
                        onClick={() => saveCompteRendu(rdv)}
                        disabled={saving === rdv.id || !crForms[rdv.id]?.compte_rendu}
                        className="w-full py-2 bg-brewery-600 text-white rounded-lg text-sm font-medium hover:bg-brewery-700 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        <Save className="w-4 h-4" />
                        {saving === rdv.id ? 'Enregistrement...' : 'Enregistrer le compte rendu'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Visites Clients Section */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-green-600" />
          Visites Clients ({clientsToVisit.length})
          {clientsToVisit.length > 0 && (
            <span className="text-sm font-normal text-gray-500">
              — {visitedClientIds.size}/{clientsToVisit.length} faites
            </span>
          )}
        </h2>

        {clientsToVisit.length === 0 && dayAppointments.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
            <p className="text-sm text-gray-400">Aucune visite prevue ce jour</p>
          </div>
        ) : clientsToVisit.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
            <p className="text-sm text-gray-400">Aucun client dans les secteurs du jour</p>
          </div>
        ) : (
          <div className="space-y-2">
            {clientsToVisit.map((client: Client) => {
              const visited = visitedClientIds.has(client.id);
              const isExpanded = expandedVisit === client.id;
              const interaction = todayInteractions.find((i: Interaction) => i.client_id === client.id);

              return (
                <div key={client.id} className={`bg-white rounded-xl border ${visited ? 'border-green-200 bg-green-50/30' : 'border-gray-200'} overflow-hidden`}>
                  <button
                    onClick={() => {
                      if (!visited) setExpandedVisit(isExpanded ? null : client.id);
                    }}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50"
                  >
                    {visited ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 border-gray-300 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm text-gray-800">{client.nom}</span>
                      <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                        {client.tournee && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{client.tournee}</span>}
                        {client.ville && <span>{client.ville}</span>}
                      </div>
                      {visited && interaction?.comment && (
                        <p className="text-xs text-green-600 mt-1 italic">{interaction.comment}</p>
                      )}
                    </div>
                    {!visited && <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />}
                  </button>

                  {isExpanded && !visited && (
                    <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
                      <div>
                        <label className="text-xs font-medium text-gray-600 mb-1 block">Commentaire de visite</label>
                        <textarea
                          value={visitComments[client.id] || ''}
                          onChange={e => setVisitComments(prev => ({ ...prev, [client.id]: e.target.value }))}
                          placeholder="Comment s'est passee la visite..."
                          className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 resize-none h-20"
                        />
                      </div>
                      <button
                        onClick={() => logVisit(client, visitComments[client.id] || '')}
                        disabled={saving === client.id}
                        className="w-full py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        {saving === client.id ? 'Enregistrement...' : 'Marquer comme visitee'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
