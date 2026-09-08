// Le résumé de tournée d'un commercial pour une semaine donnée : ses secteurs jour par jour,
// combien de rendez-vous il demande (créneaux de prospection), combien sont pris, et les
// visites de ses clients. Ce que la page Tournées affiche, réutilisé dans Rendez-vous pour
// que la prospection sache où et combien prendre.
import { AppState, Commercial, TourneeConfig } from '../types';
import { dateLocale, tourneeActive } from '../../shared/regles';
import { lireConfigTournee } from '../../shared/tournee';
import { estCommercial } from './roles';

/** Lundi → dimanche, dans l'ordre des colonnes ; les clés suivent Date.getDay(). */
export const JOURS_SEMAINE = ['1', '2', '3', '4', '5', '6', '0'];
export const LIBELLES_JOURS: Record<string, string> = { '1': 'Lundi', '2': 'Mardi', '3': 'Mercredi', '4': 'Jeudi', '5': 'Vendredi', '6': 'Samedi', '0': 'Dimanche' };
export const MOTIFS_SEMAINE: Record<string, string> = { every: 'Chaque semaine', even: 'Semaines paires', odd: 'Semaines impaires' };

export interface JourTournee {
  jour: string;
  date: string;
  zones: string[];
  /** Créneaux de prospection demandés sur ces zones (« RDV à prendre »). */
  aPrendre: number;
  /** Rendez-vous non annulés ce jour-là pour ce commercial. */
  pris: number;
  visitesTotal: number;
  visitesFaites: number;
}

export interface ResumeTournee {
  commercial: Commercial;
  config: (TourneeConfig & { tournee_info?: string; week_pattern?: string }) | undefined;
  /** La tournée s'applique-t-elle cette semaine (semaines paires/impaires) ? */
  active: boolean;
  motif: string;
  info: string;
  nbZonesDessinees: number;
  jours: JourTournee[];
  totalAPrendre: number;
  totalPris: number;
}

export function lundiDe(offset = 0, maintenant = new Date()): Date {
  const d = new Date(maintenant);
  const j = d.getDay();
  d.setDate(d.getDate() - (j === 0 ? 6 : j - 1) + offset * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function resumeTournees(state: AppState, lundi: Date): ResumeTournee[] {
  const dates: Record<string, string> = {};
  JOURS_SEMAINE.forEach((jour, i) => { const d = new Date(lundi); d.setDate(lundi.getDate() + i); dates[jour] = dateLocale(d); });
  const debut = dates['1'], fin = dates['0'];
  const rdvSemaine = state.appointments.filter(a => a.statut !== 'annule' && a.date >= debut && a.date <= fin && (!a.event_type || a.event_type === 'rdv'));

  return state.commerciaux.filter(estCommercial).map(commercial => {
    const config = state.tourneeConfigs.find(t => t.commercial_id === commercial.id) as ResumeTournee['config'];
    const brute = lireConfigTournee(config?.config) as Record<string, unknown>;
    const { prospection, ...parJour } = brute;
    const creneaux = new Map<string, number>();
    if (Array.isArray(prospection)) {
      for (const p of prospection) {
        if (typeof p === 'string') creneaux.set(p, 1);
        else if (p && typeof p === 'object' && typeof (p as { zone?: unknown }).zone === 'string') creneaux.set((p as { zone: string }).zone, Number((p as { slots?: number }).slots ?? 1) || 1);
      }
    }
    const active = tourneeActive(config?.week_pattern, lundi);
    const jours: JourTournee[] = JOURS_SEMAINE.map(jour => {
      const zones = active && Array.isArray(parJour[jour]) ? (parJour[jour] as unknown[]).filter((z): z is string => typeof z === 'string' && !!z) : [];
      const bas = zones.map(z => z.trim().toLowerCase());
      const clients = state.clients.filter(c => c.commercial_id === commercial.id && c.statut === 'ACTIF' && c.tournee && bas.includes(c.tournee.trim().toLowerCase()));
      const ids = new Set(clients.map(c => c.id));
      const date = dates[jour];
      return {
        jour, date, zones,
        aPrendre: zones.reduce((n, z) => n + (creneaux.get(z) || 0), 0),
        pris: rdvSemaine.filter(a => a.commercial_id === commercial.id && a.date === date).length,
        visitesTotal: clients.length,
        visitesFaites: state.interactions.filter(i => i.type === 'VISITE' && i.commercial_id === commercial.id && i.date.startsWith(date) && ids.has(i.client_id)).length,
      };
    });
    return {
      commercial, config, active,
      motif: MOTIFS_SEMAINE[config?.week_pattern || 'every'] || 'Chaque semaine',
      info: config?.tournee_info || '',
      nbZonesDessinees: state.commercialZones.filter(z => z.commercial_id === commercial.id).length,
      jours,
      totalAPrendre: jours.reduce((n, j) => n + j.aPrendre, 0),
      totalPris: jours.reduce((n, j) => n + j.pris, 0),
    };
  }).filter(r => r.config || r.totalPris > 0);
}
