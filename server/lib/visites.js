// Helpers partagés (visites) — déplacés tels quels depuis routes.js.
import db from '../db.js';
import { dateLocale } from '../../shared/regles.js';
import { FREQUENCES_VISITE } from '../../shared/libelles.js';

// Les fréquences vivent dans shared/libelles.js, avec les libellés : une seule définition.
export const CLIENT_VISIT_FREQUENCIES = FREQUENCES_VISITE;

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
  return dateLocale(base);
}
