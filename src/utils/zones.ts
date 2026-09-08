// Zones dessinées sur la carte, côté écran : lesquelles sont prioritaires pour la
// prospection, et quels prospects il reste à y appeler.
import { AppState, CommercialZone, Prospect } from '../types';

/** Étapes où un prospect attend encore un appel de prospection. */
export const ETAPES_A_APPELER = ['partage', 'nouveau_datagouv', 'nouveau', 'a_contacter', 'contacte'];

export function zonesPrioritaires(state: AppState): CommercialZone[] {
  return state.commercialZones.filter(z => z.prioritaire);
}

export function nomDeZone(state: AppState, zoneId: string | null | undefined): string {
  if (!zoneId) return '';
  const z = state.commercialZones.find(z => z.id === zoneId);
  return z ? (z.nom || 'Zone') : '';
}

export function estEnZonePrioritaire(state: AppState, p: Pick<Prospect, 'zone_id'>): boolean {
  if (!p.zone_id) return false;
  const z = state.commercialZones.find(z => z.id === p.zone_id);
  return !!z?.prioritaire;
}

/** Prospects d'une zone à appeler : bonne étape, un téléphone, pas encore appelés aujourd'hui. */
export function prospectsAAppelerDansLaZone(state: AppState, zoneId: string, appelesAujourdhui: Set<string> = new Set()): Prospect[] {
  return state.prospects
    .filter(p => p.zone_id === zoneId && p.telephone && ETAPES_A_APPELER.includes(p.etape_pipeline) && !appelesAujourdhui.has(p.id))
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}
