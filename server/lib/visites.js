// Helpers partagés (visites) — déplacés tels quels depuis routes.js.
import db from '../db.js';
import { toLocalDateStr } from './dates.js';

export const CLIENT_VISIT_FREQUENCIES = {
  BAR_RESTAURANT_GENERAL: 15,
  BAR_RESTAURANT_2024: 15,
  CAVE_EPICERIE: 30,
  CAVE_EPICERIE_2024: 30,
  SOUCHON: 30,
  SOUCHON_HORS_DROIT: 30,
  CLIENT_SOUCHON: 30,
  GRAND_PUBLIC: null,
  GRAND_PUBLIC_2024: null,
  COMITE_ENTREPRISE: 60,
  DISTRIBUTEUR: 45,
  EXPORT: 90,
  MARIAGE: null,
  PICOLOGIE: 30,
};

export async function calculateNextVisit(typeClient, customRecurrence, lastVisitStr) {
  // customRecurrence === 0 means "no recurrence" explicitly
  if (customRecurrence === 0) return null;
  let frequency = customRecurrence;
  if (!frequency) {
    // Check DB config first, then fallback to hardcoded
    try {
      const dbConfig = await db.query('SELECT frequency_days FROM visit_frequency_config WHERE type_client = $1', [typeClient]);
      if (dbConfig.rows.length > 0 && dbConfig.rows[0].frequency_days != null) {
        frequency = dbConfig.rows[0].frequency_days;
      } else {
        frequency = CLIENT_VISIT_FREQUENCIES[typeClient];
      }
    } catch {
      frequency = CLIENT_VISIT_FREQUENCIES[typeClient];
    }
  }
  if (!frequency) return null;
  const base = lastVisitStr ? new Date(lastVisitStr) : new Date();
  base.setDate(base.getDate() + frequency);
  return toLocalDateStr(base);
}
