// « Ma session d'appel du jour » : la liste de prospects (ou de clients) qu'une personne
// s'est choisie dans Prospects, Pipeline, Rappels et tâches, Clients ou Planning. Les fiches
// déjà appelées se déduisent des appels du jour (calls pour les prospects, interactions
// « APPEL » pour les clients), sans état à part : rappeler quelqu'un le remet à jour tout seul.
import { AppState, Client, Prospect, SessionAppel } from '../types';
import { dateLocale, jourDe } from '../../shared/regles';

export interface EtatSessionDuJour {
  session: SessionAppel | null;
  jour: string;
  /** Les prospects de la liste, dans l'ordre choisi, encore existants. */
  prospects: Prospect[];
  appeles: Set<string>;
  restants: Prospect[];
  /** Les clients de la liste, dans l'ordre choisi, encore existants. */
  clients: Client[];
  clientsAppeles: Set<string>;
  clientsRestants: Client[];
}

export function sessionDuJour(state: AppState, commercialId: string | undefined, quand: Date = new Date()): EtatSessionDuJour {
  const jour = dateLocale(quand);
  const session = commercialId ? state.sessionsAppel.find(s => s.commercial_id === commercialId && s.jour === jour) || null : null;
  const parId = new Map(state.prospects.map(p => [p.id, p]));
  const prospects = session ? session.prospect_ids.map(id => parId.get(id)).filter((p): p is Prospect => !!p) : [];
  const clientsParId = new Map(state.clients.map(c => [c.id, c]));
  const clients = session ? (session.client_ids || []).map(id => clientsParId.get(id)).filter((c): c is Client => !!c) : [];
  const appeles = new Set<string>();
  const clientsAppeles = new Set<string>();
  if (commercialId) {
    for (const c of state.calls) {
      if (c.commercial_id === commercialId && jourDe(c.date) === jour) appeles.add(c.prospect_id);
    }
    for (const i of state.interactions) {
      if (i.commercial_id === commercialId && i.type === 'APPEL' && jourDe(i.date) === jour) clientsAppeles.add(i.client_id);
    }
  }
  return { session, jour, prospects, appeles, restants: prospects.filter(p => !appeles.has(p.id)), clients, clientsAppeles, clientsRestants: clients.filter(c => !clientsAppeles.has(c.id)) };
}

/** Numéro à composer pour un client : le mobile d'abord. */
export function telephoneDuClient(c: { telephone?: string | null; telephone_mobile?: string | null }): string {
  return c.telephone_mobile || c.telephone || '';
}
