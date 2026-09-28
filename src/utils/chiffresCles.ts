// Les chiffres clés : un nombre, sa courbe sur 8 semaines et l'écart avec la période d'avant.
//
// Tout se calcule sur l'état déjà chargé (visites, rendez-vous, clients, commandes) : pas
// d'appel au serveur. « pour » est l'identifiant d'une personne, ou null pour l'équipe.
//
// Les comparaisons sont à date égale : mercredi midi, cette semaine se compare à lundi →
// mercredi de la semaine d'avant, pas à une semaine entière — sinon chaque lundi serait
// une chute.
import { dateLocale, jourDe } from '../../shared/regles';
import type { Appointment, Call, Client, Commande, Interaction } from '../types';

export const NB_SEMAINES = 8;

export interface ChiffreCle {
  /** La valeur affichée en grand. */
  valeur: number;
  /** La même chose pour la période d'avant, à date égale (null : rien à comparer). */
  avant: number | null;
  /** Une valeur par semaine, la plus ancienne d'abord ; la dernière est la semaine en cours. */
  courbe: number[];
}

/** Le lundi (AAAA-MM-JJ) de la semaine d'une date. */
export function lundiDe(d: Date): Date {
  const l = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  l.setDate(l.getDate() - ((l.getDay() + 6) % 7));
  return l;
}

function decaler(d: Date, jours: number): Date {
  const x = new Date(d); x.setDate(x.getDate() + jours); return x;
}

/** Les bornes [début, fin[ des 8 dernières semaines, en jours AAAA-MM-JJ ; la dernière est la semaine en cours. */
export function semaines(aujourdhui = new Date()): { debut: string; fin: string }[] {
  const lundi = lundiDe(aujourdhui);
  return Array.from({ length: NB_SEMAINES }, (_, i) => {
    const d = decaler(lundi, -7 * (NB_SEMAINES - 1 - i));
    return { debut: dateLocale(d), fin: dateLocale(decaler(d, 7)) };
  });
}

/** Compte par semaine, et cette semaine contre la précédente au même jour. */
function parSemaine(jours: string[], aujourdhui: Date, poids?: number[]): ChiffreCle {
  const s = semaines(aujourdhui);
  const courbe = s.map(() => 0);
  const lundi = lundiDe(aujourdhui);
  const demain = dateLocale(decaler(aujourdhui, 1));
  const debutAvant = dateLocale(decaler(lundi, -7));
  const finAvant = dateLocale(decaler(aujourdhui, -6)); // même jour de la semaine d'avant, inclus
  let avant = 0;
  jours.forEach((j, n) => {
    const p = poids ? poids[n] : 1;
    const i = s.findIndex(x => j >= x.debut && j < x.fin);
    if (i >= 0) courbe[i] += p;
    if (j >= debutAvant && j < finAvant) avant += p;
  });
  const valeur = jours.reduce((t, j, n) => t + (j >= dateLocale(lundi) && j < demain ? (poids ? poids[n] : 1) : 0), 0);
  return { valeur, avant, courbe };
}

/** Visites et appels notés (le « sans réponse » compte : c'est du travail). */
export function visitesEtAppels(interactions: Interaction[], pour: string | null, aujourdhui = new Date()): ChiffreCle {
  const jours = interactions
    .filter(i => (i.type === 'VISITE' || i.type === 'APPEL') && (!pour || i.commercial_id === pour))
    .map(i => jourDe(i.date));
  return parSemaine(jours, aujourdhui);
}

/** Appels passés aux prospects (pour la prospection, à la place des visites). */
export function appelsProspects(calls: Call[], pour: string | null, aujourdhui = new Date()): ChiffreCle {
  const jours = calls.filter(c => !pour || c.commercial_id === pour).map(c => jourDe(c.date));
  return parSemaine(jours, aujourdhui);
}

/** Rendez-vous prospects pris, datés du jour où ils ont été pris (pas du jour du RDV). */
export function rdvPris(appointments: Appointment[], pour: string | null, aujourdhui = new Date()): ChiffreCle {
  const jours = appointments
    .filter(a => a.prospect_id && a.created_at && a.statut !== 'annule')
    .filter(a => !pour || (a.prospecteur_id ? a.prospecteur_id === pour : a.commercial_id === pour))
    .map(a => { const d = new Date(a.created_at as string); return Number.isNaN(d.getTime()) ? jourDe(a.created_at) : dateLocale(d); });
  return parSemaine(jours, aujourdhui);
}

/**
 * Clients en retard : le nombre d'aujourd'hui (la règle de l'appli), et une courbe
 * reconstituée — il n'existe pas de relevé passé. Pour chaque fin de semaine, un client
 * est compté en retard si sa dernière visite connue à cette date, plus son rythme actuel
 * (écart entre sa dernière et sa prochaine visite), tombait avant. C'est une estimation.
 */
export function clientsEnRetard(clients: Client[], interactions: Interaction[], pour: string | null, aujourdhui = new Date()): ChiffreCle {
  const lesMiens = clients.filter(c => c.statut !== 'INACTIF' && (!pour || c.commercial_id === pour));
  const auj = dateLocale(aujourdhui);
  const valeur = lesMiens.filter(c => c.next_visit && jourDe(c.next_visit) < auj).length;

  const passages = new Map<string, string[]>();
  for (const i of interactions) {
    if (i.compte_visite === false || (i.type !== 'VISITE' && i.type !== 'APPEL')) continue;
    const l = passages.get(i.client_id) || [];
    l.push(jourDe(i.date));
    passages.set(i.client_id, l);
  }
  const rythmes = lesMiens.map(c => {
    const der = c.last_visit ? jourDe(c.last_visit) : '';
    const pro = c.next_visit ? jourDe(c.next_visit) : '';
    const jours = der && pro ? Math.round((new Date(`${pro}T12:00:00`).getTime() - new Date(`${der}T12:00:00`).getTime()) / 86400000) : 0;
    return { c, jours, visites: (passages.get(c.id) || []).sort() };
  }).filter(r => r.jours > 0);

  const enRetardLe = (jour: string) => rythmes.filter(({ c, jours, visites }) => {
    if (c.date_creation && jourDe(c.date_creation) > jour) return false;
    const avant = visites.filter(v => v <= jour);
    const derniere = avant.length ? avant[avant.length - 1] : (c.last_visit && jourDe(c.last_visit) <= jour ? jourDe(c.last_visit) : '');
    if (!derniere) return false;
    const prevue = dateLocale(decaler(new Date(`${derniere}T12:00:00`), jours));
    return prevue < jour;
  }).length;

  const s = semaines(aujourdhui);
  const courbe = s.map((x, i) => (i === s.length - 1 ? valeur : enRetardLe(dateLocale(decaler(new Date(`${x.fin}T12:00:00`), -1)))));
  const avant = enRetardLe(dateLocale(decaler(aujourdhui, -7)));
  return { valeur, avant, courbe };
}

/** Chiffre d'affaires HT des commandes EasyBeer : le mois en cours contre le mois d'avant au même jour ; courbe par semaine. */
export function chiffreAffaires(commandes: Commande[], clients: Client[], pour: string | null, aujourdhui = new Date()): ChiffreCle {
  const aQui = new Map(clients.map(c => [c.id, c.commercial_id]));
  const valides = commandes.filter(c => c.statut !== 'annulee' && c.date_commande && (!pour || aQui.get(c.client_id) === pour));
  const jours = valides.map(c => jourDe(c.date_commande));
  const montants = valides.map(c => Number(c.montant_ht) || 0);
  const { courbe } = parSemaine(jours, aujourdhui, montants);

  const auj = dateLocale(aujourdhui);
  const debutMois = auj.slice(0, 8) + '01';
  const moisAvant = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth() - 1, 1, 12);
  const dernierJourAvant = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), 0, 12).getDate();
  const memeJour = new Date(moisAvant.getFullYear(), moisAvant.getMonth(), Math.min(aujourdhui.getDate(), dernierJourAvant), 12);
  const debutAvant = dateLocale(moisAvant);
  const finAvant = dateLocale(memeJour);
  let valeur = 0; let avant = 0;
  jours.forEach((j, n) => {
    if (j >= debutMois && j <= auj) valeur += montants[n];
    if (j >= debutAvant && j <= finAvant) avant += montants[n];
  });
  return { valeur: Math.round(valeur), avant: Math.round(avant), courbe: courbe.map(Math.round) };
}

/** L'écart en pourcentage, ou null quand il n'y a rien à comparer. */
export function ecart(c: ChiffreCle): number | null {
  if (c.avant === null) return null;
  if (c.avant === 0) return c.valeur === 0 ? 0 : null;
  return Math.round(((c.valeur - c.avant) / c.avant) * 100);
}
