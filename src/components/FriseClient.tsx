// La frise d'un client : tout ce qui s'est passé chez lui, groupé par jour — visites et
// appels, commandes EasyBeer, rendez-vous, tâches faites, et les changements de la fiche
// (activée ou non, rythme des visites, commercial). Avant une visite, on voit d'un coup
// d'œil l'histoire du client, pas seulement ses 20 derniers passages.
//
// Les rendez-vous à venir restent en haut, à part : ce n'est pas du passé.
// Inspiré de l'« Activity Timeline » de olewandowski1 (21st.dev) : un rail, des pastilles,
// une journée par groupe.
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { Navigation, PhoneCall, PhoneMissed, Calendar, CalendarClock, ShoppingCart, CheckCircle2, Settings2, ChevronDown } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { apiGet } from '../api/client';
import { dateLocale } from '../../shared/regles';
import { APPOINTMENT_RESULT_LABELS, COMMANDE_STATUT_LABELS, INTERACTION_TYPE_LABELS, type Client } from '../types';

type Genre = 'visite' | 'appel' | 'commande' | 'rdv' | 'tache' | 'fiche';

interface Evenement {
  id: string;
  /** ISO ou AAAA-MM-JJ[THH:MM] : sert au tri et au groupement par jour. */
  date: string;
  genre: Genre;
  titre: string;
  detail?: string;
  qui?: string;
  heure?: string;
  attenue?: boolean;
}

interface LigneJournal {
  id: number;
  action: string;
  details: string;
  created_at: string;
  prenom: string | null;
  nom: string | null;
}

const PASTILLES: Record<Genre, { icone: ComponentType<{ className?: string }>; fond: string; texte: string }> = {
  visite: { icone: Navigation, fond: 'bg-green-100', texte: 'text-green-700' },
  appel: { icone: PhoneCall, fond: 'bg-blue-100', texte: 'text-blue-700' },
  commande: { icone: ShoppingCart, fond: 'bg-amber-100', texte: 'text-amber-700' },
  rdv: { icone: Calendar, fond: 'bg-purple-100', texte: 'text-purple-700' },
  tache: { icone: CheckCircle2, fond: 'bg-emerald-100', texte: 'text-emerald-700' },
  fiche: { icone: Settings2, fond: 'bg-gray-100', texte: 'text-gray-600' },
};

const FILTRES: { cle: 'tout' | Genre | 'passages'; libelle: string }[] = [
  { cle: 'tout', libelle: 'Tout' },
  { cle: 'passages', libelle: 'Visites et appels' },
  { cle: 'commande', libelle: 'Commandes' },
  { cle: 'rdv', libelle: 'RDV' },
  { cle: 'tache', libelle: 'Tâches' },
  { cle: 'fiche', libelle: 'Fiche' },
];

const LIBELLES_JOURNAL: Record<string, string> = {
  creation_client: 'Fiche créée',
  client_reactive: 'Client réactivé',
  client_desactive: 'Client désactivé',
  recurrence_client: 'Rythme des visites',
  client_reattribue: 'Commercial changé',
  client_fusionne: 'Doublon fusionné',
  signalement_rattache: 'Signalement rattaché',
};

const PAR_PAGE = 30;

const euros = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

function titreDuJour(jour: string, aujourdhui: string) {
  const hier = new Date(`${aujourdhui}T12:00:00`); hier.setDate(hier.getDate() - 1);
  if (jour === aujourdhui) return "Aujourd'hui";
  if (jour === dateLocale(hier)) return 'Hier';
  const d = new Date(`${jour}T12:00:00`);
  const memeAnnee = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', ...(memeAnnee ? {} : { year: 'numeric' }) });
}

/** Le jour (AAAA-MM-JJ, heure locale) d'une date ISO ou déjà au format jour. */
function jourDe(date: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(date)) return date.slice(0, 10);
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? date.slice(0, 10) : dateLocale(d);
}

function heureDe(date: string) {
  if (!/T\d{2}:\d{2}/.test(date)) return undefined;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date.slice(11, 16);
  const h = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return h === '00:00' ? undefined : h;
}

export default function FriseClient({ client }: { client: Client }) {
  const { state, getInteractionsForClient, getTasksForClient, getCommandesForClient } = useApp();
  const [journal, setJournal] = useState<LigneJournal[]>([]);
  const [filtre, setFiltre] = useState<(typeof FILTRES)[number]['cle']>('tout');
  const [combien, setCombien] = useState(PAR_PAGE);
  const aujourdhui = dateLocale(new Date());

  useEffect(() => {
    let vivant = true;
    apiGet<LigneJournal[]>(`/clients/${client.id}/journal`).then(l => { if (vivant) setJournal(l); }).catch(() => { /* frise sans le journal */ });
    return () => { vivant = false; };
  }, [client.id]);
  useEffect(() => { setCombien(PAR_PAGE); }, [client.id, filtre]);

  const qui = (id?: string | null) => {
    if (!id) return undefined;
    const c = state.commerciaux.find(p => p.id === id);
    return c ? `${c.prenom} ${c.nom}`.trim() : undefined;
  };

  const interactions = getInteractionsForClient(client.id);
  const taches = getTasksForClient(client.id);
  const commandes = getCommandesForClient(client.id);
  const rdvs = useMemo(() => state.appointments.filter(a => a.client_id === client.id), [state.appointments, client.id]);

  const { aVenir, passes } = useMemo(() => {
    const l: Evenement[] = [];
    for (const i of interactions) {
      if (i.type === 'RDV_PLANIFIE') continue; // le RDV lui-même est dans la frise
      const sansReponse = i.type === 'APPEL' && i.compte_visite === false;
      l.push({ id: `i-${i.id}`, date: i.date, genre: i.type === 'VISITE' ? 'visite' : 'appel',
        titre: sansReponse ? 'Appel sans réponse' : INTERACTION_TYPE_LABELS[i.type] || i.type,
        detail: i.comment || undefined, qui: qui(i.commercial_id), attenue: sansReponse });
    }
    for (const c of commandes) {
      if (!c.date_commande) continue;
      const annulee = c.statut === 'annulee';
      l.push({ id: `c-${c.id}`, date: c.date_commande, genre: 'commande',
        titre: `Commande${c.numero ? ` n° ${c.numero}` : ''} · ${euros(c.montant_ht || 0)} HT`,
        detail: [COMMANDE_STATUT_LABELS[c.statut] || c.statut, c.lignes?.length ? `${c.lignes.length} ligne(s)` : ''].filter(Boolean).join(' · '),
        attenue: annulee });
    }
    for (const t of taches) {
      if (t.statut !== 'TERMINEE') continue;
      l.push({ id: `t-${t.id}`, date: t.completed_at || t.date_creation, genre: 'tache', titre: `Tâche faite · ${t.titre}`, detail: t.description || undefined, qui: qui(t.commercial_id) });
    }
    for (const j of journal) {
      const viaIA = /\(via (Claude|IA)\)/.test(j.details);
      // Le journal répète le nom du client et parle en dates brutes : on garde l'essentiel.
      let detail = j.details.replace(/\s*\(via (Claude|IA)\)/g, '');
      if (detail.startsWith(client.nom)) detail = detail.slice(client.nom.length).replace(/^\s*:?\s*/, '');
      detail = detail.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_m, a, m, d) => `${d}/${m}/${a}`);
      if (/^(réactivé|désactivé)$/.test(detail)) detail = '';
      const auteur = j.prenom ? `${j.prenom} ${j.nom || ''}`.trim() : undefined;
      l.push({ id: `j-${j.id}`, date: j.created_at, genre: 'fiche', titre: LIBELLES_JOURNAL[j.action] || j.action,
        detail: detail || undefined, qui: viaIA ? [auteur, 'via IA'].filter(Boolean).join(' · ') : auteur });
    }
    const futurs: Evenement[] = [];
    for (const a of rdvs) {
      const quand = `${a.date}T${a.heure_debut || '00:00'}`;
      const annule = a.statut === 'annule';
      const cr = a.compte_rendu ? APPOINTMENT_RESULT_LABELS[a.compte_rendu] || a.compte_rendu : '';
      const e: Evenement = { id: `r-${a.id}`, date: quand, genre: 'rdv', heure: a.heure_debut || undefined,
        titre: `${annule ? 'RDV annulé' : a.titre || 'Rendez-vous'}${a.lieu ? ` · ${a.lieu}` : ''}${cr ? ` → ${cr}` : ''}`,
        detail: a.notes_compte_rendu || a.notes || undefined, qui: qui(a.commercial_id), attenue: annule };
      if (a.date >= aujourdhui && !annule && a.statut !== 'termine') futurs.push(e); else l.push(e);
    }
    return {
      aVenir: futurs.sort((a, b) => a.date.localeCompare(b.date)),
      passes: l.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || b.date.localeCompare(a.date)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactions, commandes, taches, journal, rdvs, state.commerciaux, aujourdhui, client.nom]);

  const garde = (e: Evenement) => filtre === 'tout' || (filtre === 'passages' ? e.genre === 'visite' || e.genre === 'appel' : e.genre === filtre);
  const filtres = passes.filter(garde);
  const visibles = filtres.slice(0, combien);

  const parJour = useMemo(() => {
    const groupes: { jour: string; evenements: Evenement[] }[] = [];
    for (const e of visibles) {
      const jour = jourDe(e.date);
      const dernier = groupes[groupes.length - 1];
      if (dernier && dernier.jour === jour) dernier.evenements.push(e);
      else groupes.push({ jour, evenements: [e] });
    }
    return groupes;
  }, [visibles]);

  const compte = (cle: (typeof FILTRES)[number]['cle']) => cle === 'tout' ? passes.length : passes.filter(e => (cle === 'passages' ? e.genre === 'visite' || e.genre === 'appel' : e.genre === cle)).length;

  return (
    <div>
      {aVenir.length > 0 && (
        <div className="mb-3 rounded-lg border border-purple-200 bg-purple-50 p-2.5">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-purple-800"><CalendarClock className="h-3.5 w-3.5" /> À venir</p>
          <ul className="space-y-1">
            {aVenir.map(e => (
              <li key={e.id} className="text-xs text-purple-900">
                <span className="font-medium tabular-nums">{titreDuJour(jourDe(e.date), aujourdhui)}{e.heure ? ` · ${e.heure}` : ''}</span> — {e.titre}{e.qui ? <span className="text-purple-700/70"> · {e.qui}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Filtrer la frise">
        {FILTRES.map(f => {
          const n = compte(f.cle);
          if (f.cle !== 'tout' && n === 0) return null;
          const actif = filtre === f.cle;
          return (
            <button key={f.cle} type="button" aria-pressed={actif} onClick={() => setFiltre(f.cle)}
              className={`flex-shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${actif ? 'border-brewery-600 bg-brewery-600 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {f.libelle} <span className={actif ? 'text-white/80' : 'text-gray-400'}>{n}</span>
            </button>
          );
        })}
      </div>

      {filtres.length === 0 ? (
        <p className="py-4 text-center text-xs text-gray-400">Rien encore : ni visite, ni commande, ni rendez-vous.</p>
      ) : (
        <ol className="space-y-4">
          {parJour.map(g => (
            <li key={g.jour}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{titreDuJour(g.jour, aujourdhui)}</p>
              <ol className="relative space-y-3 pl-9">
                <span aria-hidden className="absolute bottom-2 left-[13px] top-2 w-px bg-gray-200" />
                {g.evenements.map(e => {
                  const p = PASTILLES[e.genre];
                  const Icone = e.genre === 'appel' && e.attenue ? PhoneMissed : p.icone;
                  const heure = e.heure || heureDe(e.date);
                  return (
                    <li key={e.id} className="relative">
                      <span className={`absolute -left-9 top-0 flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-white ${p.fond}`}>
                        <Icone className={`h-3.5 w-3.5 ${p.texte}`} />
                      </span>
                      <div className="min-w-0">
                        <p className={`text-sm leading-snug ${e.attenue ? 'text-gray-500' : 'text-gray-900'}`}>
                          <span className="font-medium">{e.titre}</span>
                        </p>
                        <p className="text-xs text-gray-500">{[heure, e.qui].filter(Boolean).join(' · ')}</p>
                        {e.detail && <p className="mt-0.5 whitespace-pre-line text-xs text-gray-600">{e.detail}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
        </ol>
      )}

      {filtres.length > combien && (
        <button type="button" onClick={() => setCombien(n => n + PAR_PAGE)}
          className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg border border-gray-200 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">
          <ChevronDown className="h-3.5 w-3.5" /> Voir plus ({filtres.length - combien} de plus)
        </button>
      )}
    </div>
  );
}
