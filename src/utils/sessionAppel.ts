// « Ma session d'appel du jour » : la liste de prospects qu'une personne s'est choisie
// dans Prospects ou dans le Pipeline. Les prospects déjà appelés se déduisent des appels
// du jour, sans état à part : rappeler quelqu'un le remet à jour tout seul.
import { AppState, Prospect, SessionAppel } from '../types';
import { dateLocale, jourDe } from '../../shared/regles';

export interface EtatSessionDuJour {
  session: SessionAppel | null;
  jour: string;
  /** Les prospects de la liste, dans l'ordre choisi, encore existants. */
  prospects: Prospect[];
  appeles: Set<string>;
  restants: Prospect[];
}

export function sessionDuJour(state: AppState, commercialId: string | undefined, quand: Date = new Date()): EtatSessionDuJour {
  const jour = dateLocale(quand);
  const session = commercialId ? state.sessionsAppel.find(s => s.commercial_id === commercialId && s.jour === jour) || null : null;
  const parId = new Map(state.prospects.map(p => [p.id, p]));
  const prospects = session ? session.prospect_ids.map(id => parId.get(id)).filter((p): p is Prospect => !!p) : [];
  const appeles = new Set<string>();
  if (commercialId) {
    for (const c of state.calls) {
      if (c.commercial_id === commercialId && jourDe(c.date) === jour) appeles.add(c.prospect_id);
    }
  }
  return { session, jour, prospects, appeles, restants: prospects.filter(p => !appeles.has(p.id)) };
}
