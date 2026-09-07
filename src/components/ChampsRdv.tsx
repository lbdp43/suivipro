import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Users } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { getGoogleCalendarEvents, type GoogleCalendarEvent } from '../api/client';
import { detectConflicts } from '../utils/helpers';
import { Appointment } from '../types';

// LES champs d'un rendez-vous, les mêmes partout (appel, fiche client, page Rendez-vous) :
// commercial, date, heures, lieu, notes, et les deux alertes de conflit — les rendez-vous
// déjà pris dans SuiviPro, et l'agenda Google du commercial s'il est connecté.

export interface ValeurRdv {
  commercial_id: string;
  date: string;
  heure_debut: string;
  heure_fin: string;
  lieu: string;
  notes: string;
}

/** Conflits pour un créneau : rendez-vous internes du commercial, et événements Google. */
export function useConflitsRdv(actif: boolean, commercialId: string, date: string, heureDebut: string, heureFin: string, exclureId?: string) {
  const { state } = useApp();
  const [evenementsGoogle, setEvenementsGoogle] = useState<GoogleCalendarEvent[]>([]);

  useEffect(() => {
    if (!actif || !commercialId || !date) { setEvenementsGoogle([]); return; }
    let annule = false;
    const debut = new Date(date + 'T00:00:00').toISOString();
    const fin = new Date(date + 'T23:59:59').toISOString();
    getGoogleCalendarEvents(commercialId, debut, fin)
      .then(res => { if (!annule) setEvenementsGoogle(res.connected ? res.events : []); })
      .catch(() => { if (!annule) setEvenementsGoogle([]); });
    return () => { annule = true; };
  }, [actif, commercialId, date]);

  const conflits = useMemo<Appointment[]>(() => {
    if (!actif || !commercialId || !date || !heureDebut || !heureFin) return [];
    return detectConflicts(state.appointments, commercialId, date, heureDebut, heureFin, exclureId);
  }, [actif, state.appointments, commercialId, date, heureDebut, heureFin, exclureId]);

  const conflitsGoogle = useMemo(() => {
    if (!actif || !heureDebut || !heureFin) return [];
    return evenementsGoogle.filter(evt => {
      if (evt.allDay) return true;
      const debut = evt.start.includes('T') ? evt.start.substring(11, 16) : '';
      const fin = evt.end.includes('T') ? evt.end.substring(11, 16) : '';
      return !!debut && !!fin && heureDebut < fin && debut < heureFin;
    });
  }, [actif, evenementsGoogle, heureDebut, heureFin]);

  return { conflits, conflitsGoogle };
}

/** Les deux alertes, telles quelles, à poser sous les heures. */
export function ConflitsRdv({ conflits, conflitsGoogle }: { conflits: Appointment[]; conflitsGoogle: GoogleCalendarEvent[] }) {
  const { state } = useApp();
  if (conflits.length === 0 && conflitsGoogle.length === 0) return null;
  const nomDe = (a: Appointment) => {
    const client = a.client_id ? state.clients.find(c => c.id === a.client_id) : undefined;
    const prospect = a.prospect_id ? state.prospects.find(p => p.id === a.prospect_id) : undefined;
    return client?.nom || prospect?.nom_etablissement || a.titre || 'Rendez-vous';
  };
  return (
    <>
      {conflits.length > 0 && (
        <div className="p-2 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-[11px] text-red-700 font-medium flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Conflit horaire : ce commercial a déjà un rendez-vous sur ce créneau</p>
          {conflits.map(c => (
            <p key={c.id} className="text-[10px] text-red-600 mt-0.5">{c.heure_debut}-{c.heure_fin} : {nomDe(c)}</p>
          ))}
        </div>
      )}
      {conflitsGoogle.length > 0 && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-[11px] text-amber-700 font-medium flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Attention : événement(s) Google Agenda sur ce créneau</p>
          {conflitsGoogle.map(evt => {
            const debut = evt.start.includes('T') ? evt.start.substring(11, 16) : '';
            const fin = evt.end.includes('T') ? evt.end.substring(11, 16) : '';
            return <p key={evt.id} className="text-[10px] text-amber-600 mt-0.5">{evt.allDay ? 'Journée entière' : `${debut}-${fin}`} : {evt.summary}</p>;
          })}
        </div>
      )}
    </>
  );
}

const TEINTES = {
  blue: { label: 'text-blue-600', champ: 'border-blue-200' },
  purple: { label: 'text-purple-600', champ: 'border-purple-200' },
};

export default function ChampsRdv({ valeur, onChange, teinte = 'blue', exclureId }: {
  valeur: ValeurRdv;
  onChange: (patch: Partial<ValeurRdv>) => void;
  teinte?: keyof typeof TEINTES;
  exclureId?: string;
}) {
  const { state } = useApp();
  const t = TEINTES[teinte];
  const { conflits, conflitsGoogle } = useConflitsRdv(true, valeur.commercial_id, valeur.date, valeur.heure_debut, valeur.heure_fin, exclureId);
  return (
    <>
      <div>
        <label className={`block text-[10px] ${t.label} mb-0.5 flex items-center gap-1`}><Users className="w-3 h-3" /> Commercial assigné au rendez-vous</label>
        <select className={`w-full px-2 py-1.5 border ${t.champ} rounded-lg text-xs bg-white`} value={valeur.commercial_id} onChange={e => onChange({ commercial_id: e.target.value })}>
          {state.commerciaux.map(c => <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>)}
        </select>
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className={`block text-[10px] ${t.label} mb-0.5`}>Date *</label>
          <input type="date" className={`w-full px-2 py-1.5 border ${t.champ} rounded-lg text-xs bg-white`} value={valeur.date} onChange={e => onChange({ date: e.target.value })} />
        </div>
        <div className="w-20">
          <label className={`block text-[10px] ${t.label} mb-0.5`}>Début</label>
          <input type="time" className={`w-full px-2 py-1.5 border ${t.champ} rounded-lg text-xs bg-white`} value={valeur.heure_debut} onChange={e => onChange({ heure_debut: e.target.value })} />
        </div>
        <div className="w-20">
          <label className={`block text-[10px] ${t.label} mb-0.5`}>Fin</label>
          <input type="time" className={`w-full px-2 py-1.5 border ${t.champ} rounded-lg text-xs bg-white`} value={valeur.heure_fin} onChange={e => onChange({ heure_fin: e.target.value })} />
        </div>
      </div>
      <ConflitsRdv conflits={conflits} conflitsGoogle={conflitsGoogle} />
      <input type="text" className={`w-full px-3 py-2 border ${t.champ} rounded-lg text-sm bg-white`} placeholder="Lieu du rendez-vous…" value={valeur.lieu} onChange={e => onChange({ lieu: e.target.value })} />
      <input type="text" className={`w-full px-3 py-2 border ${t.champ} rounded-lg text-sm bg-white`} placeholder="Notes (facultatif)…" value={valeur.notes} onChange={e => onChange({ notes: e.target.value })} />
    </>
  );
}
