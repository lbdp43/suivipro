import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ChevronDown, ChevronUp, Clock, MapPin, Phone, UserCheck } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { Appointment } from '../types';
import { rdvAVenir } from '../../shared/regles';

// Les rendez-vous pris et pas encore passés : ceux qu'un commercial « va avoir ». Chaque
// ligne dit qui l'a pris (le prospecteur) et, en vue d'équipe, pour qui.

/** « pris par Louis » : la personne qui a décroché le rendez-vous, quand ce n'est pas celle qui l'a. */
export function PrisPar({ rdv, className = '' }: { rdv: Appointment; className?: string }) {
  const { getCommercial } = useApp();
  if (!rdv.prospecteur_id) return null;
  const p = getCommercial(rdv.prospecteur_id);
  if (!p) return null;
  const luiMeme = rdv.prospecteur_id === rdv.commercial_id;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-100 whitespace-nowrap ${className}`} title={luiMeme ? 'Rendez-vous pris par le commercial lui-même' : `Rendez-vous pris par ${p.prenom} ${p.nom}`}>
      <UserCheck className="w-3 h-3" /> pris par {luiMeme ? 'lui-même' : p.prenom}
    </span>
  );
}

const JOURS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
function libelleJour(date: string): string {
  const d = new Date(date.slice(0, 10) + 'T12:00:00');
  return `${JOURS[d.getDay()]} ${d.getDate()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Les rendez-vous à venir d'une ou plusieurs personnes (null = toute l'équipe). */
export function rdvAVenirDe(appointments: Appointment[], commercialIds: string[] | null, maintenant = new Date()): Appointment[] {
  const ids = commercialIds ? new Set(commercialIds) : null;
  return appointments
    .filter(a => (!a.event_type || a.event_type === 'rdv') && (a.prospect_id || a.client_id) && rdvAVenir(a, maintenant) && (!ids || ids.has(a.commercial_id)))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.heure_debut || '').localeCompare(b.heure_debut || ''));
}

export default function RdvAVenir({ commercialIds, titre = 'Rendez-vous à venir', replie = false }: { commercialIds: string[] | null; titre?: string; replie?: boolean }) {
  const { state, getCommercial, getProspect, getClient } = useApp();
  const [ouvert, setOuvert] = useState(!replie);
  const rdvs = useMemo(() => rdvAVenirDe(state.appointments, commercialIds), [state.appointments, commercialIds]);
  const plusieurs = !commercialIds || commercialIds.length > 1;
  if (rdvs.length === 0) return null;
  const semaineProchaine = new Date(); semaineProchaine.setDate(semaineProchaine.getDate() + 7);
  const limite = semaineProchaine.toISOString().slice(0, 10);
  const proches = rdvs.filter(r => r.date.slice(0, 10) <= limite).length;

  return (
    <div className="bg-white rounded-xl border border-sky-200">
      <button type="button" onClick={() => setOuvert(o => !o)} className="w-full flex items-center justify-between p-3 text-left">
        <h3 className="text-sm font-semibold text-sky-800 flex items-center gap-1.5">
          <CalendarClock className="w-4 h-4" /> {titre} ({rdvs.length})
          {proches > 0 && proches < rdvs.length && <span className="text-[10px] font-normal text-sky-600">dont {proches} sous 7 jours</span>}
        </h3>
        {ouvert ? <ChevronUp className="w-4 h-4 text-sky-400" /> : <ChevronDown className="w-4 h-4 text-sky-400" />}
      </button>
      {ouvert && (
        <div className="px-3 pb-3 space-y-1.5">
          {rdvs.map(rdv => {
            const client = rdv.client_id ? getClient(rdv.client_id) : undefined;
            const prospect = !client && rdv.prospect_id ? getProspect(rdv.prospect_id) : undefined;
            const nom = client?.nom || prospect?.nom_etablissement || 'Rendez-vous';
            const ville = client?.ville || prospect?.ville || '';
            const tel = client?.telephone_mobile || client?.telephone || prospect?.telephone || '';
            const lien = client ? `/clients?id=${client.id}` : prospect ? `/prospects?id=${prospect.id}` : '/rdv';
            const pour = plusieurs ? getCommercial(rdv.commercial_id) : undefined;
            return (
              <div key={rdv.id} className="flex items-center gap-3 rounded-lg border border-sky-100 bg-sky-50/40 px-3 py-2">
                <div className="w-14 flex-shrink-0 text-center">
                  <p className="text-xs font-semibold text-sky-800 tabular-nums">{libelleJour(rdv.date)}</p>
                  <p className="text-[11px] text-gray-500 tabular-nums flex items-center justify-center gap-0.5"><Clock className="w-3 h-3" />{rdv.heure_debut || '—'}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link to={lien} className="text-sm font-medium text-gray-800 hover:text-brewery-700 hover:underline truncate">{nom}</Link>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${client ? 'bg-green-100 text-green-700' : 'bg-indigo-100 text-indigo-700'}`}>{client ? 'Client' : 'Prospect'}</span>
                    <PrisPar rdv={rdv} />
                    {pour && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">pour {pour.prenom}</span>}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-gray-500 mt-0.5 flex-wrap">
                    {ville && <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{ville}</span>}
                    {rdv.lieu && rdv.lieu !== ville && <span className="truncate">{rdv.lieu}</span>}
                    {rdv.notes && <span className="italic truncate">{rdv.notes}</span>}
                  </div>
                </div>
                {tel && <a href={`tel:${tel.replace(/\s/g, '')}`} className="p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 flex-shrink-0" title="Appeler"><Phone className="w-3.5 h-3.5" /></a>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
