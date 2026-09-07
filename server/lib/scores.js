// Helpers partagés (scores) — déplacés tels quels depuis routes.js.
import db from '../db.js';
import { scoreDepuisTags, baremeActif } from '../../shared/score.js';

export async function scoreProspect(tagsDuProspect, scoreFourni) {
  const tags = (await db.query('SELECT id, points FROM tags')).rows;
  return scoreDepuisTags(tagsDuProspect || [], tags, Number(scoreFourni) || 50);
}
