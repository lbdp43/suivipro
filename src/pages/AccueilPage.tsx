import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar, MapPin, Phone, Bell, AlertTriangle, ClipboardCheck, ListTodo, Building2,
  ChevronRight, Target, ShoppingCart, RefreshCw, Users, BarChart3, Link2, CheckCircle2, Clock, ListChecks, Trash2, Star,
} from 'lucide-react';
import { sessionDuJour } from '../utils/sessionAppel';
import { apiGet, apiPut } from '../api/client';
import { zonesPrioritaires, prospectsAAppelerDansLaZone, estEnZonePrioritaire } from '../utils/zones';
import { useToast } from '../components/Toast';
import { useApp } from '../store/AppContext';
import { Appointment, Client, Commercial, Prospect, APPOINTMENT_RESULT_LABELS } from '../types';
import { formatDate } from '../utils/helpers';
import { dateLocale, estEnRetard, joursDeRetard, rdvSansCompteRendu, rdvAnnule, semaineIso, semainePaire, tourneeActive, jourDe, lundiDeLaSemaine } from '../../shared/regles';
import { mesurerObjectifs, mesurerLeMois, COULEUR_ETAT } from '../utils/objectifs';
import BlocErreur from '../components/BlocErreur';
import BilanDuSoir from '../components/BilanDuSoir';
import { useCallModal } from '../components/CallModal';
import { faitDeLaProspection, estCommercial, libelleRole } from '../utils/roles';

// ============================================================================
// Accueil « Ma journée » : une porte d'entrée par rôle. Pas d'itinéraire, pas de graphiques :
// ce qu'il y a à faire aujourd'hui, ce qu'il faut rattraper, où on en est du mois.
// Les statistiques détaillées restent dans la page Statistiques.
// ============================================================================

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function Bonjour({ personne, sousTitre }: { personne: Commercial; sousTitre: string }) {
  const now = new Date();
  const iso = semaineIso(now);
  const heure = now.getHours();
  const salut = heure < 12 ? 'Bonjour' : heure < 18 ? 'Bon après-midi' : 'Bonsoir';
  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{salut} {personne.prenom}</h1>
      <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
        {JOURS[now.getDay()]} {now.getDate()} {MOIS[now.getMonth()]} · semaine {iso.semaine} ({semainePaire(now) ? 'paire' : 'impaire'}) · {sousTitre}
      </p>
    </div>
  );
}

function Carte({ titre, icone: Icone, lien, compte, enfants, vide, teinte = 'gray' }: {
  titre: string; icone: typeof Calendar; lien?: string; compte?: number; enfants: React.ReactNode; vide?: string; teinte?: 'gray' | 'red' | 'amber' | 'brewery';
}) {
  const bord = { gray: 'border-gray-200', red: 'border-red-200', amber: 'border-amber-200', brewery: 'border-brewery-200' }[teinte];
  const txt = { gray: 'text-gray-500', red: 'text-red-600', amber: 'text-amber-600', brewery: 'text-brewery-600' }[teinte];
  return (
    <div className={`bg-white rounded-xl border ${bord} p-4`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2 text-sm">
          <Icone className={`w-4 h-4 ${txt}`} /> {titre}
          {compte !== undefined && <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${teinte === 'red' ? 'bg-red-100 text-red-700' : teinte === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{compte}</span>}
        </h3>
        {lien && <Link to={lien} className="text-xs text-brewery-600 hover:underline flex items-center gap-0.5">Voir <ChevronRight className="w-3 h-3" /></Link>}
      </div>
      {compte === 0 && vide ? <p className="text-xs text-gray-400 italic">{vide}</p> : enfants}
    </div>
  );
}

function Jauges({ personne }: { personne: Commercial }) {
  const { stateComplet } = useApp();
  const mesures = useMemo(() => mesurerObjectifs(stateComplet, personne), [stateComplet, personne]);
  const mois = useMemo(() => mesurerLeMois(stateComplet, personne), [stateComplet, personne]);
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2 text-sm"><Target className="w-4 h-4 text-brewery-600" /> Mes objectifs du mois</h3>
        <span className="text-[11px] text-gray-400">{MOIS[new Date().getMonth()]}</span>
      </div>
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${mesures.length + (personne.role !== 'prospection' ? 1 : 0) > 4 ? 'lg:grid-cols-3 xl:grid-cols-6' : mesures.length + (personne.role !== 'prospection' ? 1 : 0) > 2 ? 'lg:grid-cols-4' : ''} gap-4`}>
        {mesures.map(m => {
          const c = COULEUR_ETAT[m.etat];
          return (
            <div key={m.cle} title={m.aide}>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-gray-500">{m.label}</span>
                <span className={`text-[10px] font-medium ${c.texte}`}>{c.label}</span>
              </div>
              <p className="text-2xl font-bold text-gray-900 tabular-nums">{m.valeur} <span className="text-sm font-normal text-gray-400">/ {m.objectif || '—'}</span></p>
              <div className="bg-gray-200 rounded-full h-2 mt-1">
                <div className={`h-2 rounded-full ${c.barre}`} style={{ width: `${Math.min(m.pct, 100)}%` }} />
              </div>
              {m.objectif > 0 && <p className="text-[10px] text-gray-400 mt-0.5">attendu à ce jour : {m.attendu}</p>}
            </div>
          );
        })}
        {personne.role !== 'prospection' && (
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-gray-500">Comptes rendus</span>
              <span className={`text-[10px] font-medium ${mois.rdvSansCr === 0 ? 'text-green-700' : 'text-amber-700'}`}>{mois.rdvSansCr === 0 ? 'À jour' : 'À rattraper'}</span>
            </div>
            <p className="text-2xl font-bold text-gray-900 tabular-nums">{mois.rdvSansCr === 0 ? <CheckCircle2 className="w-7 h-7 text-green-500 inline" /> : mois.rdvSansCr} <span className="text-sm font-normal text-gray-400">{mois.rdvSansCr === 0 ? '' : 'manquant(s)'}</span></p>
            <div className="bg-gray-200 rounded-full h-2 mt-1"><div className={`h-2 rounded-full ${mois.rdvSansCr === 0 ? 'bg-green-500' : 'bg-amber-500'}`} style={{ width: mois.rdvSansCr === 0 ? '100%' : '40%' }} /></div>
            {mois.rdvSansCr > 0 && <Link to="/semaine/bilan" className="text-[10px] text-brewery-600 hover:underline">Saisir les comptes rendus</Link>}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- outils communs ----------
function nomDuRdv(rdv: Appointment, getProspect: (id: string) => Prospect | undefined, getClient: (id: string) => Client | undefined) {
  if (rdv.titre) return rdv.titre;
  if (rdv.client_id) return getClient(rdv.client_id)?.nom || 'Client';
  return getProspect(rdv.prospect_id)?.nom_etablissement || 'Prospect';
}
function telDuRdv(rdv: Appointment, getProspect: (id: string) => Prospect | undefined, getClient: (id: string) => Client | undefined) {
  if (rdv.client_id) { const c = getClient(rdv.client_id); return c?.telephone_mobile || c?.telephone || ''; }
  return getProspect(rdv.prospect_id)?.telephone || '';
}
function LigneRdv({ rdv, nom, tel, aQui }: { rdv: Appointment; nom: string; tel: string; aQui?: string }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs font-semibold text-gray-700 tabular-nums w-12">{rdv.heure_debut || '—'}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800 truncate">{nom}{aQui && <span className="text-xs text-gray-400"> · {aQui}</span>}</p>
        {rdv.lieu && <p className="text-[11px] text-gray-400 truncate flex items-center gap-1"><MapPin className="w-3 h-3" />{rdv.lieu}</p>}
      </div>
      {rdv.compte_rendu && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">{APPOINTMENT_RESULT_LABELS[rdv.compte_rendu] || rdv.compte_rendu}</span>}
      {tel && <a href={`tel:${tel.replace(/\s/g, '')}`} className="p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100"><Phone className="w-3.5 h-3.5" /></a>}
    </div>
  );
}

function lireConfig(texte: string | undefined): Record<string, unknown> {
  try { const c = JSON.parse(texte || '{}'); return c && typeof c === 'object' && !Array.isArray(c) ? c : {}; } catch { return {}; }
}
function zonesDuJour(config: Record<string, unknown>, dayKey: string): string[] {
  const z = config[dayKey];
  return Array.isArray(z) ? z.filter((x): x is string => typeof x === 'string') : [];
}
function zoneConfiguree(config: Record<string, unknown>, tournee: string): boolean {
  const t = tournee.trim().toLowerCase();
  return Object.entries(config).some(([k, zones]) => k !== 'prospection' && Array.isArray(zones) && zones.some(z => typeof z === 'string' && z.trim().toLowerCase() === t));
}

// ============================================================================
// COMMERCIAL
// ============================================================================
function AccueilCommercial({ moi }: { moi: Commercial }) {
  const { state, getProspect, getClient, perimetre } = useApp();
  const now = new Date();
  const today = dateLocale(now);
  const dayKey = String(now.getDay());

  const tournee = useMemo(() => {
    const tc = state.tourneeConfigs.find(t => t.commercial_id === moi.id) as (typeof state.tourneeConfigs[number] & { week_pattern?: string }) | undefined;
    const config = lireConfig(tc?.config);
    const active = tourneeActive(tc?.week_pattern, now);
    const zones = active ? zonesDuJour(config, dayKey) : [];
    const actifs = state.clients.filter(c => c.statut === 'ACTIF');
    const parAnciennete = (a: Client, b: Client) => (!a.last_visit ? -1 : !b.last_visit ? 1 : a.last_visit.localeCompare(b.last_visit));
    const dansZones = actifs.filter(c => c.tournee && zones.some(z => z.trim().toLowerCase() === c.tournee.trim().toLowerCase())).sort(parAnciennete);
    const prevusAujourdhui = actifs.filter(c => c.next_visit === today && !dansZones.includes(c) && !(c.tournee && zoneConfiguree(config, c.tournee)));
    // Semaine : nombre de clients par jour (lundi → samedi)
    const semaine = ['1', '2', '3', '4', '5', '6'].map(k => {
      const zs = active ? zonesDuJour(config, k) : [];
      const n = actifs.filter(c => c.tournee && zs.some(z => z.trim().toLowerCase() === c.tournee.trim().toLowerCase())).length;
      return { k, zones: zs, n };
    });
    return { zones, clients: [...dansZones, ...prevusAujourdhui], semaine, notes: tc?.notes || '' };
  }, [state.tourneeConfigs, state.clients, moi.id, today, dayKey]);

  const rdvDuJour = useMemo(() => state.appointments
    .filter(a => !rdvAnnule(a) && jourDe(a.date) === today && (a.commercial_id === moi.id || (a.participants || []).includes(moi.id)))
    .sort((a, b) => (a.heure_debut || '').localeCompare(b.heure_debut || '')), [state.appointments, moi.id, today]);
  const rdvSemaine = useMemo(() => {
    const lundi = new Date(now); const j = lundi.getDay() || 7; lundi.setDate(lundi.getDate() - j + 1);
    return ['1', '2', '3', '4', '5', '6'].map((k, i) => { const d = new Date(lundi); d.setDate(lundi.getDate() + i); const ds = dateLocale(d);
      return state.appointments.filter(a => !rdvAnnule(a) && jourDe(a.date) === ds && a.commercial_id === moi.id).length; });
  }, [state.appointments, moi.id]);
  const retards = useMemo(() => state.clients.filter(c => estEnRetard(c, today)).sort((a, b) => joursDeRetard(b, today) - joursDeRetard(a, today)), [state.clients, today]);
  const sansCr = useMemo(() => state.appointments.filter(a => a.commercial_id === moi.id && rdvSansCompteRendu(a, now)).sort((a, b) => b.date.localeCompare(a.date)), [state.appointments, moi.id]);
  const taches = useMemo(() => state.tasksClient.filter(t => t.commercial_id === moi.id && t.statut !== 'TERMINEE' && t.date_echeance && t.date_echeance <= today).sort((a, b) => (a.date_echeance || '').localeCompare(b.date_echeance || '')), [state.tasksClient, moi.id, today]);
  const rappels = useMemo(() => state.reminders.filter(r => r.commercial_id === moi.id && r.statut === 'actif' && r.date <= today), [state.reminders, moi.id, today]);

  const aRattraper = retards.length + sansCr.length + taches.length + rappels.length;

  return (
    <div className="p-4 sm:p-6 space-y-4 fade-in">
      <Bonjour personne={moi} sousTitre={(perimetre === 'equipe' ? 'vue de toute l\'équipe' : 'mes clients') + (faitDeLaProspection(moi) ? ' · prospection' : '')} />

      <BlocErreur titre="Mes objectifs"><Jauges personne={moi} /></BlocErreur>

      {!faitDeLaProspection(moi) && <BlocErreur titre="Ma session d'appel du jour"><SessionProspectsDuJour moi={moi} /></BlocErreur>}

      <BlocErreur titre="Ma session d'appel clients"><SessionClientsDuJour moi={moi} /></BlocErreur>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BlocErreur titre="Rendez-vous du jour">
          <Carte titre="Rendez-vous aujourd'hui" icone={Calendar} lien="/rdv" compte={rdvDuJour.length} vide="Aucun rendez-vous aujourd'hui." teinte="brewery"
            enfants={<div>{rdvDuJour.map(r => <LigneRdv key={r.id} rdv={r} nom={nomDuRdv(r, getProspect, getClient)} tel={telDuRdv(r, getProspect, getClient)} />)}</div>} />
        </BlocErreur>
        <BlocErreur titre="Tournée du jour">
          <Carte titre={tournee.zones.length ? `Tournée du jour · ${tournee.zones.join(', ')}` : 'Clients à visiter aujourd\'hui'} icone={MapPin} lien="/semaine" compte={tournee.clients.length}
            vide={tournee.zones.length ? 'Aucun client actif dans ce secteur.' : 'Pas de secteur prévu aujourd\'hui, et aucune visite due.'} teinte="brewery"
            enfants={<div className="space-y-1 max-h-72 overflow-y-auto">
              {tournee.notes && <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded p-1.5 mb-1">{tournee.notes}</p>}
              {tournee.clients.map(c => (
                <Link key={c.id} to={`/clients?id=${c.id}`} className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0 hover:bg-gray-50 rounded px-1">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${estEnRetard(c, today) ? 'bg-red-500' : c.next_visit === today ? 'bg-amber-500' : 'bg-gray-300'}`} />
                  <span className="text-sm text-gray-800 truncate flex-1">{c.nom}</span>
                  <span className="text-[11px] text-gray-400 truncate">{c.ville}</span>
                  <span className="text-[10px] text-gray-400 w-20 text-right">{c.last_visit ? `vu le ${formatDate(c.last_visit)}` : 'jamais vu'}</span>
                </Link>
              ))}
            </div>} />
        </BlocErreur>
      </div>

      <BlocErreur titre="À rattraper">
        <div className={`bg-white rounded-xl border ${aRattraper ? 'border-amber-200' : 'border-gray-200'} p-4`}>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 text-sm mb-3">
            <AlertTriangle className={`w-4 h-4 ${aRattraper ? 'text-amber-600' : 'text-gray-400'}`} /> À rattraper
            {aRattraper === 0 && <span className="text-xs font-normal text-green-700 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> rien en attente</span>}
          </h3>
          {aRattraper > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {retards.length > 0 && (
                <div>
                  <Link to="/semaine" className="text-xs font-semibold text-red-700 hover:underline">{retards.length} client{retards.length > 1 ? 's' : ''} en retard de visite</Link>
                  <div className="mt-1 space-y-0.5">
                    {retards.slice(0, 5).map(c => (
                      <Link key={c.id} to={`/clients?id=${c.id}`} className="flex items-center justify-between text-xs py-1 hover:bg-gray-50 rounded px-1">
                        <span className="text-gray-800 truncate">{c.nom} <span className="text-gray-400">· {c.ville}</span></span>
                        <span className="text-red-600 font-medium tabular-nums">{joursDeRetard(c, today)} j</span>
                      </Link>
                    ))}
                    {retards.length > 5 && <Link to="/clients" className="text-[11px] text-gray-400 hover:underline px-1">et {retards.length - 5} autre(s)…</Link>}
                  </div>
                </div>
              )}
              {sansCr.length > 0 && (
                <div>
                  <Link to="/semaine/bilan" className="text-xs font-semibold text-amber-700 hover:underline">{sansCr.length} rendez-vous sans compte rendu</Link>
                  <div className="mt-1 space-y-0.5">
                    {sansCr.slice(0, 5).map(r => (
                      <Link key={r.id} to="/semaine/bilan" className="flex items-center justify-between text-xs py-1 hover:bg-gray-50 rounded px-1">
                        <span className="text-gray-800 truncate">{nomDuRdv(r, getProspect, getClient)}</span>
                        <span className="text-gray-400 tabular-nums">{formatDate(r.date)} {r.heure_debut}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {taches.length > 0 && (
                <div>
                  <Link to="/taches" className="text-xs font-semibold text-purple-700 hover:underline">{taches.length} tâche{taches.length > 1 ? 's' : ''} à faire</Link>
                  <div className="mt-1 space-y-0.5">
                    {taches.slice(0, 5).map(t => (
                      <Link key={t.id} to="/taches" className="flex items-center justify-between text-xs py-1 hover:bg-gray-50 rounded px-1">
                        <span className="text-gray-800 truncate">{t.titre}</span>
                        <span className={`tabular-nums ${t.date_echeance && t.date_echeance < today ? 'text-red-600' : 'text-gray-400'}`}>{t.date_echeance ? formatDate(t.date_echeance) : ''}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {rappels.length > 0 && (
                <div>
                  <Link to="/rappels" className="text-xs font-semibold text-indigo-700 hover:underline">{rappels.length} rappel{rappels.length > 1 ? 's' : ''} à traiter</Link>
                  <div className="mt-1 space-y-0.5">
                    {rappels.slice(0, 5).map(r => (
                      <Link key={r.id} to="/rappels" className="flex items-center justify-between text-xs py-1 hover:bg-gray-50 rounded px-1">
                        <span className="text-gray-800 truncate">{getProspect(r.prospect_id)?.nom_etablissement || r.message}</span>
                        <span className="text-gray-400 tabular-nums">{formatDate(r.date)} {r.heure}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </BlocErreur>

      <BlocErreur titre="Ma semaine">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 text-sm"><Clock className="w-4 h-4 text-gray-500" /> Ma semaine</h3>
            <Link to="/semaine" className="text-xs text-brewery-600 hover:underline flex items-center gap-0.5">Préparer <ChevronRight className="w-3 h-3" /></Link>
          </div>
          <div className="grid grid-cols-6 gap-2">
            {tournee.semaine.map((j, i) => (
              <Link key={j.k} to="/semaine" className={`rounded-lg border p-2 text-center ${j.k === dayKey ? 'border-brewery-300 bg-brewery-50' : 'border-gray-100 hover:bg-gray-50'}`}>
                <p className="text-[11px] font-semibold text-gray-700 capitalize">{['lun', 'mar', 'mer', 'jeu', 'ven', 'sam'][i]}</p>
                <p className="text-lg font-bold text-gray-900 tabular-nums">{j.n}</p>
                <p className="text-[10px] text-gray-400 truncate" title={j.zones.join(', ')}>{j.zones.length ? j.zones.join(', ') : '—'}</p>
                {rdvSemaine[i] > 0 && <p className="text-[10px] text-indigo-600">{rdvSemaine[i]} RDV</p>}
              </Link>
            ))}
          </div>
        </div>
      </BlocErreur>

      {faitDeLaProspection(moi) && (
        <>
          <div className="pt-2 flex items-center gap-2">
            <Phone className="w-4 h-4 text-emerald-600" />
            <h2 className="font-semibold text-gray-900">Ma prospection</h2>
          </div>
          <BlocsProspection moi={moi} />
        </>
      )}
    </div>
  );
}

// ============================================================================
// PROSPECTION
// ============================================================================
// Les blocs de prospection : rappels, file d'appels, appels du jour, RDV pris, bilan du soir.
// Utilisés par l'accueil « prospection » et, en plus de ses blocs, par un commercial qui fait
// aussi de la prospection.

// « Ma session d'appel clients du jour » (commerciaux et admin) : choisie dans Tâches,
// Clients ou Planning ; les appelés viennent des appels du jour.
function SessionClientsDuJour({ moi }: { moi: Commercial }) {
  const { state, dispatchLocal } = useApp();
  const { startSessionClients } = useCallModal();
  const toast = useToast();
  const now = new Date();
  const maSessionClients = useMemo(() => sessionDuJour(state, moi.id, now), [state, moi.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const viderLaSessionClients = async () => {
    if (!confirm('Vider votre session d\'appel clients du jour ?')) return;
    try {
      await apiPut('/sessions-appel/jour', { jour: maSessionClients.jour, client_ids: [], mode: 'remplacer' });
      dispatchLocal({ type: 'SET_SESSION_APPEL', payload: { ...(maSessionClients.session as import('../types').SessionAppel), client_ids: [] } });
    } catch { toast.error('Impossible de vider la session'); }
  };
  if (!maSessionClients.session || maSessionClients.clients.length === 0) return null;
  return (
          <div className="bg-white rounded-xl border border-purple-200 p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2 text-sm">
                <ListChecks className="w-4 h-4 text-purple-600" /> Ma session d'appel clients du jour
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">{maSessionClients.clients.length - maSessionClients.clientsRestants.length} / {maSessionClients.clients.length} appelés</span>
              </h3>
              <button onClick={viderLaSessionClients} className="text-xs text-gray-400 hover:text-red-600 flex items-center gap-1" title="Vider la session du jour"><Trash2 className="w-3.5 h-3.5" /> Vider</button>
            </div>
            <div className="h-1.5 rounded-full bg-gray-100 mb-3 overflow-hidden">
              <div className="h-full bg-purple-500 progress-bar" style={{ width: `${Math.round(100 * (maSessionClients.clients.length - maSessionClients.clientsRestants.length) / maSessionClients.clients.length)}%` }} />
            </div>
            {maSessionClients.clientsRestants.length > 0 ? (
              <button onClick={() => startSessionClients(maSessionClients.clientsRestants.map(c => c.id))} className="w-full mb-2 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700">
                <Phone className="w-4 h-4" /> {maSessionClients.clientsRestants.length === maSessionClients.clients.length ? 'Commencer' : 'Reprendre'} la session ({maSessionClients.clientsRestants.length} restant{maSessionClients.clientsRestants.length > 1 ? 's' : ''})
              </button>
            ) : (
              <p className="text-sm text-green-700 flex items-center gap-1.5 mb-2"><CheckCircle2 className="w-4 h-4" /> Session terminée, tout le monde a été appelé.</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 max-h-56 overflow-y-auto">
              {maSessionClients.clients.map(c => { const fait = maSessionClients.clientsAppeles.has(c.id); return (
                <div key={c.id} className="flex items-center gap-2 py-1 border-b border-gray-50 last:border-0">
                  {fait ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" /> : <Phone className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />}
                  <Link to={`/clients?id=${c.id}`} className={`flex-1 min-w-0 text-sm truncate ${fait ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{c.nom}</Link>
                  <span className="text-[11px] text-gray-400 truncate max-w-[40%]">{c.ville}</span>
                </div>); })}
            </div>
          </div>
  );
}

// « Ma session d'appel du jour » (prospects) : visible pour tout le monde dès qu'une session
// existe, qu'elle vienne de Prospects, du Pipeline, des Rappels ou d'une zone de la carte.
function SessionProspectsDuJour({ moi }: { moi: Commercial }) {
  const { state, dispatchLocal } = useApp();
  const { startSession } = useCallModal();
  const toast = useToast();
  const now = new Date();
  const maSession = useMemo(() => sessionDuJour(state, moi.id, now), [state, moi.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const viderLaSession = async () => {
    if (!confirm('Vider votre session d\'appel du jour ?')) return;
    try {
      await apiPut('/sessions-appel/jour', { jour: maSession.jour, prospect_ids: [], mode: 'remplacer' });
      dispatchLocal({ type: 'SET_SESSION_APPEL', payload: { ...(maSession.session as import('../types').SessionAppel), prospect_ids: [] } });
    } catch { toast.error('Impossible de vider la session'); }
  };
  if (!maSession.session || maSession.prospects.length === 0) return null;
  return (
        <BlocErreur titre="Ma session d'appel du jour">
          <div className="bg-white rounded-xl border border-purple-200 p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2 text-sm">
                <ListChecks className="w-4 h-4 text-purple-600" /> Ma session d'appel du jour
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">{maSession.prospects.length - maSession.restants.length} / {maSession.prospects.length} appelés</span>
              </h3>
              <button onClick={viderLaSession} className="text-xs text-gray-400 hover:text-red-600 flex items-center gap-1" title="Vider la session du jour"><Trash2 className="w-3.5 h-3.5" /> Vider</button>
            </div>
            <div className="h-1.5 rounded-full bg-gray-100 mb-3 overflow-hidden">
              <div className="h-full bg-purple-500 progress-bar" style={{ width: `${Math.round(100 * (maSession.prospects.length - maSession.restants.length) / maSession.prospects.length)}%` }} />
            </div>
            {maSession.restants.length > 0 ? (
              <button onClick={() => startSession(maSession.restants.map(p => p.id))} className="w-full mb-2 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700">
                <Phone className="w-4 h-4" /> {maSession.restants.length === maSession.prospects.length ? 'Commencer' : 'Reprendre'} la session ({maSession.restants.length} restant{maSession.restants.length > 1 ? 's' : ''})
              </button>
            ) : (
              <p className="text-sm text-green-700 flex items-center gap-1.5 mb-2"><CheckCircle2 className="w-4 h-4" /> Session terminée, tout le monde a été appelé.</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 max-h-56 overflow-y-auto">
              {maSession.prospects.map(p => { const fait = maSession.appeles.has(p.id); return (
                <div key={p.id} className="flex items-center gap-2 py-1 border-b border-gray-50 last:border-0">
                  {fait ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" /> : <Phone className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />}
                  <Link to={`/prospects?id=${p.id}`} className={`flex-1 min-w-0 text-sm truncate ${fait ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{p.nom_etablissement}</Link>
                  <span className="text-[11px] text-gray-400 truncate max-w-[40%]">{p.ville}</span>
                </div>); })}
            </div>
          </div>
        </BlocErreur>
  );
}

function BlocsProspection({ moi }: { moi: Commercial }) {
  const { state, getProspect, getCommercial, dispatchLocal } = useApp();
  const { startSession } = useCallModal();
  const toast = useToast();
  const now = new Date();
  const today = dateLocale(now);
  // « Ma session d'appel du jour » : choisie dans Prospects ou Pipeline ; les appelés viennent des appels du jour.
  const maSession = useMemo(() => sessionDuJour(state, moi.id, now), [state, moi.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rappels = useMemo(() => state.reminders
    .filter(r => r.commercial_id === moi.id && r.statut === 'actif' && r.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.heure.localeCompare(b.heure)), [state.reminders, moi.id, today]);
  const appelsDuJour = useMemo(() => state.calls.filter(c => c.commercial_id === moi.id && jourDe(c.date) === today), [state.calls, moi.id, today]);
  const rdvPrisDuJour = useMemo(() => state.appointments
    .filter(a => a.prospecteur_id === moi.id && jourDe(a.created_at) === today && !rdvAnnule(a))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.heure_debut || '').localeCompare(b.heure_debut || '')), [state.appointments, moi.id, today]);
  const parCommercial = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const r of rdvPrisDuJour) { const l = m.get(r.commercial_id) || []; l.push(r); m.set(r.commercial_id, l); }
    return [...m.entries()];
  }, [rdvPrisDuJour]);
  // Les zones prioritaires passent devant, puis mes prospects, puis le score.
  const aAppeler = useMemo(() => state.prospects
    .filter(p => ['a_contacter', 'nouveau', 'contacte'].includes(p.etape_pipeline) && p.telephone)
    .sort((a, b) => (estEnZonePrioritaire(state, b) ? 1 : 0) - (estEnZonePrioritaire(state, a) ? 1 : 0)
      || (b.commercial_id === moi.id ? 1 : 0) - (a.commercial_id === moi.id ? 1 : 0) || (b.score || 0) - (a.score || 0))
    .slice(0, 8), [state, moi.id]);
  // Zones prioritaires : ce qu'il reste à y appeler, et une session d'appel par zone.
  const zonesPrio = useMemo(() => zonesPrioritaires(state).map(z => ({ zone: z, aAppeler: prospectsAAppelerDansLaZone(state, z.id, maSession.appeles) })), [state, maSession.appeles]);
  const sessionZone = async (ids: string[]) => {
    if (ids.length === 0) { toast.info('Tout le monde a déjà été appelé dans cette zone'); return; }
    try {
      const r = await apiPut('/sessions-appel/jour', { jour: today, prospect_ids: ids, mode: 'ajouter' }) as { session: import('../types').SessionAppel };
      dispatchLocal({ type: 'SET_SESSION_APPEL', payload: r.session });
    } catch { /* la session en mémoire suffit */ }
    startSession(ids);
  };

  return (
    <>
      <SessionProspectsDuJour moi={moi} />
      {zonesPrio.length > 0 && (
        <BlocErreur titre="Zones prioritaires">
          <div className="bg-white rounded-xl border border-red-200 p-4">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2 text-sm">
                <Star className="w-4 h-4 text-red-600 fill-current" /> Zones prioritaires pour la prospection
              </h3>
              <div className="flex items-center gap-2">
                <Link to="/carte" className="text-xs text-brewery-600 hover:underline flex items-center gap-0.5">Carte <ChevronRight className="w-3 h-3" /></Link>
                {zonesPrio.length > 1 && (
                  <button onClick={() => sessionZone(zonesPrio.flatMap(z => z.aAppeler.map(p => p.id)))} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700">
                    <Phone className="w-3.5 h-3.5" /> Toutes les zones ({zonesPrio.reduce((n, z) => n + z.aAppeler.length, 0)})
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-2">
              {zonesPrio.map(({ zone, aAppeler: liste }) => { const c = getCommercial(zone.commercial_id); return (
                <div key={zone.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-red-50/60 border border-red-100">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{zone.nom || 'Zone'} <span className="text-[11px] text-gray-500 font-normal">· {c ? `${c.prenom} ${c.nom}` : ''}</span></p>
                    {zone.consigne ? <p className="text-xs text-red-800">{zone.consigne}</p> : <p className="text-[11px] text-gray-400">Sans consigne</p>}
                  </div>
                  <button onClick={() => sessionZone(liste.map(p => p.id))} disabled={liste.length === 0} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700 disabled:opacity-50 whitespace-nowrap">
                    <Phone className="w-3.5 h-3.5" /> Session d'appel ({liste.length})
                  </button>
                </div>); })}
            </div>
          </div>
        </BlocErreur>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BlocErreur titre="Rappels">
          <Carte titre="À rappeler aujourd'hui" icone={Bell} lien="/rappels" compte={rappels.length} vide="Aucun rappel en attente." teinte={rappels.length ? 'amber' : 'gray'}
            enfants={<div className="space-y-0.5 max-h-80 overflow-y-auto">
              {rappels.map(r => { const p = getProspect(r.prospect_id); const enRetard = r.date < today; return (
                <div key={r.id} className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0">
                  <span className={`text-[11px] tabular-nums w-16 ${enRetard ? 'text-red-600 font-medium' : 'text-gray-500'}`}>{enRetard ? formatDate(r.date) : r.heure}</span>
                  <Link to={`/prospects?id=${r.prospect_id}`} className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{p?.nom_etablissement || 'Prospect'}</p>
                    <p className="text-[11px] text-gray-400 truncate">{r.message}</p>
                  </Link>
                  {p?.telephone && <a href={`tel:${p.telephone.replace(/\s/g, '')}`} className="p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100"><Phone className="w-3.5 h-3.5" /></a>}
                </div>); })}
            </div>} />
        </BlocErreur>
        <BlocErreur titre="À appeler ensuite">
          <Carte titre="À appeler ensuite" icone={Phone} lien="/prospects" compte={aAppeler.length} vide="Rien dans la file : ajoutez des prospects « à contacter »."
            enfants={<div className="space-y-0.5 max-h-80 overflow-y-auto">
              <button onClick={() => startSession(aAppeler.map(p => p.id))} className="w-full mb-2 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-brewery-600 text-white text-xs font-semibold hover:bg-brewery-700">
                <Phone className="w-3.5 h-3.5" /> Lancer la session d'appels ({aAppeler.length})
              </button>
              {!maSession.session && <p className="text-[11px] text-gray-400 mb-2">Suggestions par score. Pour choisir vous-même : cochez des prospects dans <Link to="/prospects" className="underline">Prospects</Link> ou <Link to="/pipeline" className="underline">Pipeline</Link>, puis « Ma session du jour ».</p>}
              {aAppeler.map(p => (
                <div key={p.id} className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0">
                  <Link to={`/prospects?id=${p.id}`} className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{p.nom_etablissement}</p>
                    <p className="text-[11px] text-gray-400 truncate">{p.ville}{p.score ? ` · ${p.score} pts` : ''}</p>
                  </Link>
                  <a href={`tel:${p.telephone.replace(/\s/g, '')}`} className="p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100"><Phone className="w-3.5 h-3.5" /></a>
                </div>
              ))}
            </div>} />
        </BlocErreur>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BlocErreur titre="Appels du jour">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 text-sm mb-3"><Phone className="w-4 h-4 text-green-600" /> Mes appels aujourd'hui</h3>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><p className="text-2xl font-bold text-gray-900 tabular-nums">{appelsDuJour.length}</p><p className="text-[11px] text-gray-500">appels</p></div>
              <div><p className="text-2xl font-bold text-green-600 tabular-nums">{appelsDuJour.filter(c => c.resultat === 'repondu').length}</p><p className="text-[11px] text-gray-500">répondus</p></div>
              <div><p className="text-2xl font-bold text-indigo-600 tabular-nums">{rdvPrisDuJour.length}</p><p className="text-[11px] text-gray-500">RDV pris</p></div>
            </div>
          </div>
        </BlocErreur>
        <BlocErreur titre="RDV pris aujourd'hui">
          <Carte titre="RDV pris aujourd'hui, par commercial" icone={Calendar} lien="/rdv" compte={rdvPrisDuJour.length} vide="Aucun rendez-vous pris aujourd'hui pour l'instant." teinte="brewery"
            enfants={<div className="space-y-2">
              {parCommercial.map(([cid, liste]) => { const c = getCommercial(cid); return (
                <div key={cid}>
                  <p className="text-xs font-semibold text-gray-700 flex items-center gap-1"><Users className="w-3 h-3" /> {c ? `${c.prenom} ${c.nom}` : 'Commercial'} <span className="text-gray-400 font-normal">· {liste.length}</span></p>
                  {liste.map(r => <LigneRdv key={r.id} rdv={r} nom={nomDuRdv(r, getProspect, () => undefined)} tel="" aQui={formatDate(r.date)} />)}
                </div>); })}
            </div>} />
        </BlocErreur>
      </div>

      <BlocErreur titre="Bilan du soir"><BilanDuSoir moi={moi} /></BlocErreur>
    </>
  );
}

function AccueilProspection({ moi }: { moi: Commercial }) {
  return (
    <div className="p-4 sm:p-6 space-y-4 fade-in">
      <Bonjour personne={moi} sousTitre="prospection" />
      <BlocErreur titre="Mes objectifs"><Jauges personne={moi} /></BlocErreur>
      <BlocsProspection moi={moi} />
    </div>
  );
}

// ============================================================================
// ADMIN — centre de contrôle
// ============================================================================
interface LogSync { id: number; kind: string; status: string; message: string; started_at: string; finished_at: string | null }

function AccueilAdmin({ moi }: { moi: Commercial }) {
  const { stateComplet: state, getProspect, getClient } = useApp();
  const now = new Date();
  const today = dateLocale(now);
  const [logs, setLogs] = useState<LogSync[] | null>(null);
  useEffect(() => {
    apiGet<LogSync[]>('/easybeer/sync-logs')
      .then(l => setLogs(Array.isArray(l) ? l : []))
      .catch(() => setLogs([]));
  }, []);

  const syncEnErreur = useMemo(() => {
    if (!logs) return [];
    const derniers = new Map<string, LogSync>();
    for (const l of logs) if (!derniers.has(l.kind)) derniers.set(l.kind, l); // triés id DESC
    return [...derniers.values()].filter(l => l.status === 'error' || l.status === 'interrupted');
  }, [logs]);

  const alertes = useMemo(() => {
    const orphelines = state.commandes.filter(c => !c.client_id).length;
    const sansCommercial = state.clients.filter(c => !c.commercial_id && c.statut === 'ACTIF').length;
    const retards = state.clients.filter(c => estEnRetard(c, today)).length;
    const sansCr = state.appointments.filter(a => rdvSansCompteRendu(a, now)).length;
    const taches = state.tasksClient.filter(t => t.statut !== 'TERMINEE' && t.date_echeance && t.date_echeance < today).length;
    const rappels = state.reminders.filter(r => r.statut === 'actif' && r.date < today).length;
    return { orphelines, sansCommercial, retards, sansCr, taches, rappels };
  }, [state, today]);

  // Vue semaine : cette semaine (lundi → aujourd'hui) ou la semaine dernière (complète).
  const [decalageSemaine, setDecalageSemaine] = useState<0 | -1>(0);
  const semaine = useMemo(() => {
    const lundi = lundiDeLaSemaine(now, decalageSemaine);
    const dimanche = new Date(lundi); dimanche.setDate(lundi.getDate() + 6);
    const debut = dateLocale(lundi);
    const fin = decalageSemaine === 0 ? today : dateLocale(dimanche);
    const jours = Math.min(6, Math.round((new Date(fin).getTime() - lundi.getTime()) / 86400000)) + 1;
    return { debut, fin, jours, libelle: `du ${formatDate(debut)} au ${formatDate(fin)}` };
  }, [decalageSemaine, today]);

  const equipe = useMemo(() => state.commerciaux.filter(c => c.role !== 'admin' || c.id === moi.id).map(p => {
    const prosp = faitDeLaProspection(p);
    const comm = estCommercial(p);
    // Une même mesure pour un jour ou pour la semaine.
    const mesurer = (dedans: (d: string) => boolean) => ({
      appels: state.calls.filter(c => c.commercial_id === p.id && dedans(jourDe(c.date))).length,
      rdvPris: state.appointments.filter(a => a.prospecteur_id === p.id && dedans(jourDe(a.created_at))).length,
      rdv: state.appointments.filter(a => a.commercial_id === p.id && dedans(jourDe(a.date)) && !rdvAnnule(a)).length,
      visites: state.interactions.filter(i => i.commercial_id === p.id && i.type === 'VISITE' && dedans(jourDe(i.date))).length,
      appelsClients: state.interactions.filter(i => i.commercial_id === p.id && i.type === 'APPEL' && dedans(jourDe(i.date))).length,
    });
    const jour = mesurer(d => d === today);
    const sem = mesurer(d => d >= semaine.debut && d <= semaine.fin);
    const { appels, rdvPris, rdv: rdvJour, visites } = jour;
    const retards = state.clients.filter(c => c.commercial_id === p.id && estEnRetard(c, today)).length;
    const sansCr = state.appointments.filter(a => a.commercial_id === p.id && rdvSansCompteRendu(a, now)).length;
    const rappels = state.reminders.filter(r => r.commercial_id === p.id && r.statut === 'actif' && r.date <= today).length;
    const objectifs = mesurerObjectifs(state, p, now);
    const derive = objectifs.filter(o => o.etat === 'en_retard').length;
    return { p, prosp, comm, appels, rdvPris, rdvJour, visites, appelsClients: jour.appelsClients, sem, retards, sansCr, rappels, objectifs, derive };
  }), [state, moi.id, today, semaine]);

  const cartes: { label: string; n: number; lien: string; icone: typeof Calendar; grave?: boolean }[] = [
    { label: 'commandes sans client', n: alertes.orphelines, lien: '/easybeer', icone: ShoppingCart, grave: true },
    { label: 'synchronisations en erreur', n: syncEnErreur.length, lien: '/easybeer', icone: RefreshCw, grave: true },
    { label: 'fiches sans commercial', n: alertes.sansCommercial, lien: '/clients', icone: Building2 },
    { label: 'clients en retard (équipe)', n: alertes.retards, lien: '/semaine', icone: AlertTriangle },
    { label: 'RDV sans compte rendu', n: alertes.sansCr, lien: '/semaine/bilan', icone: ClipboardCheck },
    { label: 'tâches en retard', n: alertes.taches, lien: '/taches', icone: ListTodo },
    { label: 'rappels en retard', n: alertes.rappels, lien: '/rappels', icone: Bell },
  ];
  const nbProblemes = cartes.filter(c => c.n > 0).length;

  return (
    <div className="p-4 sm:p-6 space-y-4 fade-in">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <Bonjour personne={moi} sousTitre="centre de contrôle" />

      <BlocErreur titre="Ma session d'appel du jour"><SessionProspectsDuJour moi={moi} /></BlocErreur>
      <BlocErreur titre="Ma session d'appel clients"><SessionClientsDuJour moi={moi} /></BlocErreur>
        <div className="flex gap-2">
          <Link to="/statistiques" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50"><BarChart3 className="w-4 h-4" /> Statistiques</Link>
          <Link to="/easybeer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50"><Link2 className="w-4 h-4" /> EasyBeer</Link>
          <Link to="/admin" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50"><Users className="w-4 h-4" /> Équipe</Link>
        </div>
      </div>

      <BlocErreur titre="Problèmes à régler">
        <div className={`bg-white rounded-xl border ${nbProblemes ? 'border-amber-200' : 'border-gray-200'} p-4`}>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 text-sm mb-3">
            <AlertTriangle className={`w-4 h-4 ${nbProblemes ? 'text-amber-600' : 'text-gray-400'}`} /> Problèmes à régler
            {nbProblemes === 0 && <span className="text-xs font-normal text-green-700 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> tout est en ordre</span>}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {cartes.map(c => (
              <Link key={c.label} to={c.lien} className={`rounded-lg border p-2.5 ${c.n === 0 ? 'border-gray-100 text-gray-400' : c.grave ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'} hover:opacity-90`}>
                <c.icone className="w-4 h-4 mb-1" />
                <p className="text-xl font-bold tabular-nums leading-none">{c.n}</p>
                <p className="text-[10px] mt-1 leading-tight">{c.label}</p>
              </Link>
            ))}
          </div>
          {syncEnErreur.length > 0 && (
            <div className="mt-3 text-xs text-red-700 space-y-0.5">
              {syncEnErreur.map(l => <p key={l.id}>Sync {l.kind} du {formatDate(l.started_at)} : {l.status === 'interrupted' ? 'interrompue' : 'en erreur'}{l.message ? ` — ${l.message}` : ''}</p>)}
            </div>
          )}
        </div>
      </BlocErreur>

      <BlocErreur titre="L'équipe">
        <div className="bg-white rounded-xl border border-gray-200 p-4 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 text-sm"><Users className="w-4 h-4 text-brewery-600" /> L'équipe</h3>
            <div className="flex items-center gap-2 text-xs">
              <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5 font-medium" role="group" aria-label="Semaine affichée">
                <button type="button" onClick={() => setDecalageSemaine(0)} className={`px-2 py-0.5 rounded-md ${decalageSemaine === 0 ? 'bg-white text-brewery-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Cette semaine</button>
                <button type="button" onClick={() => setDecalageSemaine(-1)} className={`px-2 py-0.5 rounded-md ${decalageSemaine === -1 ? 'bg-white text-brewery-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Semaine dernière</button>
              </div>
              <span className="text-gray-400 hidden sm:inline">{semaine.libelle}</span>
            </div>
          </div>
          <table className="w-full text-xs min-w-[860px]">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="py-2 pr-2 font-medium">Membre</th>
                <th className="py-2 px-2 font-medium text-center">Aujourd'hui</th>
                <th className="py-2 px-2 font-medium text-center">{decalageSemaine === 0 ? 'Cette semaine' : 'Semaine dernière'} <span className="font-normal text-gray-400">({semaine.jours} j)</span></th>
                <th className="py-2 px-2 font-medium text-center">À rattraper</th>
                <th className="py-2 px-2 font-medium">Objectifs du mois</th>
              </tr>
            </thead>
            <tbody>
              {equipe.map(({ p, prosp, comm, appels, rdvPris, rdvJour, visites, appelsClients, sem, retards, sansCr, rappels, objectifs, derive }) => (
                <tr key={p.id} className="border-b border-gray-50 last:border-0 align-top">
                  <td className="py-2 pr-2">
                    <p className="font-semibold text-gray-800">{p.prenom} {p.nom}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.role === 'prospection' ? 'bg-emerald-100 text-emerald-700' : p.role === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{libelleRole(p)}</span>
                  </td>
                  <td className="py-2 px-2 text-center text-gray-700 whitespace-nowrap">
                    {comm && <span><b className="tabular-nums">{rdvJour}</b> RDV · <b className="tabular-nums">{visites}</b> visites · <b className="tabular-nums">{appelsClients}</b> appels clients</span>}
                    {comm && prosp && <br />}
                    {prosp && <span><b className="tabular-nums">{appels}</b> appels · <b className="tabular-nums">{rdvPris}</b> RDV pris</span>}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-700 whitespace-nowrap bg-gray-50/60">
                    {comm && <span><b className="tabular-nums">{sem.rdv}</b> RDV · <b className="tabular-nums">{sem.visites}</b> visites · <b className="tabular-nums">{sem.appelsClients}</b> appels clients</span>}
                    {comm && prosp && <br />}
                    {prosp && <span><b className="tabular-nums">{sem.appels}</b> appels · <b className="tabular-nums">{sem.rdvPris}</b> RDV pris</span>}
                  </td>
                  <td className="py-2 px-2 text-center whitespace-nowrap">
                    {comm && (
                      <span className="space-x-2">
                        <span className={retards ? 'text-red-700' : 'text-gray-400'}><b className="tabular-nums">{retards}</b> retards</span>
                        <span className={sansCr ? 'text-amber-700' : 'text-gray-400'}><b className="tabular-nums">{sansCr}</b> sans CR</span>
                      </span>
                    )}
                    {comm && prosp && <br />}
                    {prosp && (rappels ? <span className="text-amber-700"><b className="tabular-nums">{rappels}</b> rappels</span> : <span className="text-gray-400">0 rappels</span>)}
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex flex-wrap gap-1.5">
                      {objectifs.map(o => { const c = COULEUR_ETAT[o.etat]; return (
                        <span key={o.cle} title={`${o.label} : ${o.valeur} / ${o.objectif || '—'} (${c.label})`} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] ${o.etat === 'atteint' ? 'border-green-200 bg-green-50 text-green-700' : o.etat === 'dans_le_rythme' ? 'border-brewery-200 bg-brewery-50 text-brewery-700' : o.etat === 'en_retard' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-gray-200 text-gray-400'}`}>
                          {o.label} <b className="tabular-nums">{o.valeur}</b>/{o.objectif || '—'}
                        </span>); })}
                      {derive > 0 && <span className="text-[10px] text-amber-700 self-center">{derive} en dérive</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </BlocErreur>

      <BlocErreur titre="Rendez-vous du jour (équipe)">
        <Carte titre="Rendez-vous de l'équipe aujourd'hui" icone={Calendar} lien="/rdv"
          compte={state.appointments.filter(a => !rdvAnnule(a) && jourDe(a.date) === today).length} vide="Aucun rendez-vous aujourd'hui."
          enfants={<div>
            {state.appointments.filter(a => !rdvAnnule(a) && jourDe(a.date) === today).sort((a, b) => (a.heure_debut || '').localeCompare(b.heure_debut || '')).map(r => {
              const c = state.commerciaux.find(x => x.id === r.commercial_id);
              return <LigneRdv key={r.id} rdv={r} nom={nomDuRdv(r, getProspect, getClient)} tel="" aQui={c ? c.prenom : undefined} />;
            })}
          </div>} />
      </BlocErreur>
    </div>
  );
}

export default function AccueilPage() {
  const { state } = useApp();
  const moi = state.currentUser;
  if (!moi) return null;
  if (moi.role === 'admin') return <AccueilAdmin moi={moi} />;
  if (moi.role === 'prospection') return <AccueilProspection moi={moi} />;
  return <AccueilCommercial moi={moi} />;
}
