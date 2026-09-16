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

/** Rayon par défaut : de quoi couvrir une ville et ses abords, pas un département. */
export const RAYON_KM = 3;

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
