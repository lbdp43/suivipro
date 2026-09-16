// « Est-ce que je passe déjà dans le coin ? »
//
// Regarder une fiche ne dit pas s'il y a une raison d'aller là-bas cette semaine. Or il y en
// a deux, et une seule suffit : un rendez-vous déjà calé à quelques centaines de mètres, ou
// un client qu'on aurait dû revoir depuis longtemps. Dans les deux cas, le déplacement
// existe déjà — autant y greffer la fiche qu'on a sous les yeux.
//
// Les rendez-vous de TOUTE l'équipe comptent, pas seulement les siens : les secteurs se
// chevauchent, et savoir qu'Alban monte à Riom jeudi est utile même quand ce n'est pas soi
// qui y va.
import { statutVisite } from '../../shared/regles';
import type { Appointment, Client, Prospect, Commercial } from '../types';

/**
 * Deux rayons, parce que ce sont deux questions differentes.
 *
 * « Qu'est-ce qu'il y a autour de cette fiche ? » : 3 km. Au-dela ce n'est plus un detour
 * qu'on greffe sur un trajet, c'est un autre trajet.
 *
 * « Qui puis-je appeler pour remplir cette journee-la ? » : 10 km. Quand on monte a Riom
 * pour la journee, on accepte de rouler dans tout le secteur — la question n'est pas le
 * detour, c'est la tournee.
 */
export const RAYON_KM = 3;
export const RAYON_APPELS_KM = 10;

/** Au-delà, la liste sous la carte devient illisible ; le total réel reste annoncé. */
export const VOISINS_MAX = 8;

const TERRE_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

/** Distance à vol d'oiseau entre deux points, en kilomètres. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * TERRE_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** « 400 m » se lit mieux que « 0,4 km », et « 2,4 km » mieux que « 2400 m ». */
export function distanceLisible(km: number): string {
  if (km < 1) return `${Math.round(km * 100) * 10} m`;
  return `${km.toFixed(1).replace('.', ',')} km`;
}

const localise = (e: { latitude?: number | null; longitude?: number | null } | undefined) =>
  !!e && Number(e.latitude) !== 0 && Number(e.longitude) !== 0
  && Number.isFinite(Number(e.latitude)) && Number.isFinite(Number(e.longitude));

export interface Voisin {
  cle: string;
  genre: 'rdv' | 'retard';
  nom: string;
  latitude: number;
  longitude: number;
  km: number;
  /** Pour un rendez-vous : quand, et avec qui. */
  date?: string;
  heure?: string;
  qui?: string;
  /** Depuis combien de jours la visite est due, pour un client en retard. */
  jours?: number;
}

export interface SourcesVoisinage {
  prospects: Prospect[];
  clients: Client[];
  appointments: Appointment[];
  commerciaux: Commercial[];
  aujourdhui: string;
}

/**
 * Ce qu'il y a autour d'un point, et qui justifie déjà un déplacement.
 *
 * L'établissement dont on regarde la fiche est exclu : il n'est pas son propre voisin, et
 * son propre rendez-vous est déjà écrit plus haut dans la fiche.
 *
 * Un même lieu n'apparaît qu'une fois : un client en retard chez qui un rendez-vous est déjà
 * posé est un rendez-vous, pas un retard — sinon on croirait à deux déplacements.
 */
export function voisinsAutour(
  centre: { latitude?: number | null; longitude?: number | null; id: string },
  sources: SourcesVoisinage,
  rayonKm: number = RAYON_KM,
): Voisin[] {
  if (!localise(centre)) return [];
  const laC = Number(centre.latitude);
  const loC = Number(centre.longitude);
  const { prospects, clients, appointments, commerciaux, aujourdhui } = sources;

  const prenom = (id: string) => commerciaux.find(c => c.id === id)?.prenom || '';
  const parId = <T extends { id: string }>(liste: T[]) => new Map(liste.map(x => [x.id, x]));
  const pProspects = parId(prospects);
  const pClients = parId(clients);

  const voisins: Voisin[] = [];
  const dejaVus = new Set<string>([centre.id]);

  // 1. Les rendez-vous a venir, de toute l'equipe.
  const rdvTries = appointments
    .filter(a => a.statut !== 'annule' && a.date >= aujourdhui)
    .sort((a, b) => (a.date + a.heure_debut).localeCompare(b.date + b.heure_debut));
  for (const rdv of rdvTries) {
    const lieuId = rdv.client_id || rdv.prospect_id;
    if (!lieuId || dejaVus.has(lieuId)) continue;
    const etab = pClients.get(lieuId) || pProspects.get(lieuId);
    if (!localise(etab)) continue;
    const km = distanceKm(laC, loC, Number(etab!.latitude), Number(etab!.longitude));
    if (km > rayonKm) continue;
    dejaVus.add(lieuId);
    voisins.push({
      cle: `rdv-${rdv.id}`,
      genre: 'rdv',
      nom: (etab as Client).nom || (etab as Prospect).nom_etablissement || 'Établissement',
      latitude: Number(etab!.latitude),
      longitude: Number(etab!.longitude),
      km,
      date: rdv.date,
      heure: rdv.heure_debut,
      qui: prenom(rdv.commercial_id),
    });
  }

  // 2. Les clients dont la visite est en retard.
  for (const client of clients) {
    if (dejaVus.has(client.id) || !localise(client)) continue;
    if (statutVisite({ statut: client.statut, next_visit: client.next_visit }, aujourdhui) !== 'RETARD') continue;
    const km = distanceKm(laC, loC, Number(client.latitude), Number(client.longitude));
    if (km > rayonKm) continue;
    dejaVus.add(client.id);
    const prevue = (client.next_visit || '').slice(0, 10);
    const jours = prevue
      ? Math.round((Date.parse(`${aujourdhui}T00:00:00`) - Date.parse(`${prevue}T00:00:00`)) / 86400000)
      : undefined;
    voisins.push({
      cle: `retard-${client.id}`,
      genre: 'retard',
      nom: client.nom,
      latitude: Number(client.latitude),
      longitude: Number(client.longitude),
      km,
      jours: jours && jours > 0 ? jours : undefined,
    });
  }

  // Le plus proche d'abord : c'est la seule question qu'on se pose vraiment.
  return voisins.sort((a, b) => a.km - b.km);
}


/**
 * Les prospects a appeler autour d'un point. LA definition, utilisee partout : le bouton
 * « Appeler autour » d'un rendez-vous, celui de la carte, et le bloc des tournees a garnir.
 *
 * Qui sort de la liste :
 * — les mauvaises etapes, au sens de ETAPES_A_APPELER : perdu, gagne, « ne pas contacter »,
 *   et tout ce qui est deja engage (proposition, negociation, rendez-vous pris) ;
 * — ceux qui n'ont pas de numero — on ne peut rien en faire au telephone ;
 * — ceux qui ont deja un rendez-vous a venir : il est deja pris, le rappeler serait au mieux
 *   inutile, au pire genant ;
 * — ceux deja appeles aujourd'hui, pour ne pas les appeler deux fois dans la journee.
 *
 * Qui RESTE dans la liste, volontairement : ceux qui ont un rappel en cours. C'est de la
 * prospection — un rappel note « rappeler en septembre » n'est pas une raison de sauter
 * quelqu'un quand on a justement une voiture qui monte dans son secteur.
 */
export function prospectsAAppelerAutourDe(
  points: { lat: number; lon: number }[],
  sources: { prospects: Prospect[]; appointments: Appointment[]; aujourdhui: string; etapesAAppeler: string[] },
  appelesAujourdhui: Set<string> = new Set(),
  rayonKm: number = RAYON_APPELS_KM,
): Prospect[] {
  const { prospects, appointments, aujourdhui, etapesAAppeler } = sources;
  if (points.length === 0) return [];

  const dejaUnRdv = new Set(
    appointments
      .filter(a => a.statut !== 'annule' && a.date >= aujourdhui && a.prospect_id)
      .map(a => a.prospect_id),
  );

  return prospects
    .filter(p => p.telephone
      && etapesAAppeler.includes(p.etape_pipeline)
      && !dejaUnRdv.has(p.id)
      && !appelesAujourdhui.has(p.id)
      && localise(p)
      && points.some(pt => distanceKm(pt.lat, pt.lon, Number(p.latitude), Number(p.longitude)) <= rayonKm))
    // Le meilleur score d'abord : c'est l'ordre dans lequel la session les enchainera.
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}

// ----------------------------------------------------------------------------
// L'AUTRE SENS : partir d'une tournée pour trouver qui appeler
//
// Un rendez-vous cale jeudi a Riom, c'est une voiture qui monte la-bas de toute
// facon. C'est le moment d'appeler les prospects du coin pour remplir la journee —
// mais personne ne le sait, parce que le rendez-vous est dans l'agenda d'Alban et
// que c'est Eva qui telephone. Ce calcul apporte l'information a la prospection.
// ----------------------------------------------------------------------------

/** Au-dela, c'est trop tot pour appeler « pour jeudi » : la personne n'a pas encore son planning en tete. */
export const HORIZON_JOURS = 14;

export interface TourneeAGarnir {
  cle: string;
  /** Le jour de la tournee, au format d'un jour SuiviPro. */
  date: string;
  /** Qui y va. */
  commercialId: string;
  prenom: string;
  /** Les villes ou il a deja des rendez-vous ce jour-la. */
  villes: string[];
  /** Combien de rendez-vous sont deja poses ce jour-la. */
  rdvPoses: number;
  /** Les prospects a appeler autour, les plus prometteurs d'abord. */
  aAppeler: Prospect[];
}

/**
 * Les journees ou quelqu'un se deplace deja, et les prospects a appeler autour.
 *
 * Groupees par PERSONNE et par JOUR, et non par rendez-vous : trois rendez-vous
 * d'Alban le meme jour a Riom, c'est une seule tournee a remplir, pas trois lignes
 * identiques. Les prospects des environs de chacun de ces rendez-vous sont reunis,
 * sans doublon.
 *
 * Qui est appelable : exactement la meme regle que pour les zones prioritaires —
 * la bonne etape, un telephone, pas deja appele aujourd'hui. Il n'y a qu'une seule
 * definition de « a appeler » dans le logiciel, et ce n'est pas ici qu'elle change.
 */
export function tourneesAGarnir(
  sources: SourcesVoisinage & { etapesAAppeler: string[] },
  appelesAujourdhui: Set<string> = new Set(),
  rayonKm: number = RAYON_APPELS_KM,
  horizonJours: number = HORIZON_JOURS,
): TourneeAGarnir[] {
  const { prospects, clients, appointments, commerciaux, aujourdhui, etapesAAppeler } = sources;
  const limite = new Date(`${aujourdhui}T00:00:00`);
  limite.setDate(limite.getDate() + horizonJours);
  const finHorizon = limite.toISOString().slice(0, 10);

  const pClients = new Map(clients.map(c => [c.id, c]));
  const pProspects = new Map(prospects.map(p => [p.id, p]));

  // Un point de passage par rendez-vous localise, range par personne et par jour.
  const groupes = new Map<string, { date: string; commercialId: string; points: { lat: number; lon: number }[]; villes: Set<string>; rdvPoses: number }>();
  for (const rdv of appointments) {
    if (rdv.statut === 'annule' || rdv.date < aujourdhui || rdv.date > finHorizon) continue;
    const lieuId = rdv.client_id || rdv.prospect_id;
    const etab = lieuId ? (pClients.get(lieuId) || pProspects.get(lieuId)) : undefined;
    if (!localise(etab)) continue;
    const cle = `${rdv.date}|${rdv.commercial_id}`;
    const g = groupes.get(cle) || { date: rdv.date, commercialId: rdv.commercial_id, points: [], villes: new Set<string>(), rdvPoses: 0 };
    g.points.push({ lat: Number(etab!.latitude), lon: Number(etab!.longitude) });
    if (etab!.ville) g.villes.add(etab!.ville);
    g.rdvPoses += 1;
    groupes.set(cle, g);
  }

  const tournees: TourneeAGarnir[] = [];
  for (const [cle, g] of groupes) {
    // La meme regle que le bouton « Appeler autour » : il n'y en a qu'une.
    const autour = prospectsAAppelerAutourDe(
      g.points, { prospects, appointments, aujourdhui, etapesAAppeler }, appelesAujourdhui, rayonKm);
    if (autour.length === 0) continue;
    tournees.push({
      cle,
      date: g.date,
      commercialId: g.commercialId,
      prenom: commerciaux.find(c => c.id === g.commercialId)?.prenom || '',
      villes: [...g.villes],
      rdvPoses: g.rdvPoses,
      aAppeler: autour,
    });
  }
  // La tournee la plus proche dans le temps d'abord : c'est celle qu'il faut remplir maintenant.
  return tournees.sort((a, b) => a.date.localeCompare(b.date) || a.prenom.localeCompare(b.prenom));
}
