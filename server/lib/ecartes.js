// Ce qu'on a déjà écarté, et qui revient.
//
// Ignorer un signalement, le supprimer, mettre un prospect ou un client à la corbeille :
// dans les quatre cas, quelqu'un a tranché. Quand le même établissement revient dans la
// boîte — un collègue le repartage, Claude le redépose, un import le ramène — il faut le
// dire, sinon la décision se reprend à zéro chaque fois.
//
// On ne garde qu'une ligne d'identité, pas la fiche : c'est ce qui permet à la trace de
// survivre à une suppression réelle, qui, elle, efface tout le reste.
import db from '../db.js';
import { sansAccents } from '../../shared/normalisation.js';
import { preparerFiche, comparerFiches } from '../../shared/rapprochement.js';

/** Au-delà, la réponse devient un mur de texte : on dit le total, on nomme les premiers. */
const MONTRES_MAX = 4;

/**
 * Note qu'un établissement a été écarté. Sans nom, on ne note rien : une trace anonyme ne
 * se rapprocherait de rien et ne ferait qu'encombrer la table.
 */
export async function noter({ origine, origineId = '', nom, ville = '', telephone = '', lien = '', motif, parQui }) {
  const propre = String(nom || '').trim();
  if (!propre) return;
  await db.query(
    `INSERT INTO etablissements_ecartes (origine, origine_id, nom, nom_compare, ville, telephone, lien, motif, par_qui)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [origine, String(origineId || ''), propre.slice(0, 200), sansAccents(propre).slice(0, 200),
     String(ville || '').slice(0, 100), String(telephone || '').slice(0, 40), String(lien || '').slice(0, 500),
     motif, String(parQui || '')]
  );
}

/**
 * Efface la trace d'une décision revenue en arrière : rouvrir un signalement ignoré,
 * restaurer une fiche depuis la corbeille. La décision n'existe plus, l'avertissement non
 * plus — sinon on préviendrait d'un écart qu'on vient soi-même d'annuler.
 */
export async function oublier(origine, origineId) {
  if (!origineId) return;
  await db.query('DELETE FROM etablissements_ecartes WHERE origine = $1 AND origine_id = $2', [origine, String(origineId)]);
}

/**
 * Ce qui, dans les écartés, ressemble à cette fiche. Même règle de rapprochement que les
 * doublons de prospects et de clients (shared/rapprochement.js) : un seul verdict, où
 * qu'on regarde.
 *
 * @returns {Promise<{ total: number, lignes: Array<{ nom, ville, motif, par_qui, le }> }>}
 */
export async function dejaEcarte(fiche) {
  if (!fiche?.nom_etablissement) return { total: 0, lignes: [] };
  const cherchee = preparerFiche({ nom: fiche.nom_etablissement, telephone: fiche.telephone, ville: fiche.ville });
  const r = await db.query('SELECT nom, ville, telephone, motif, par_qui, le FROM etablissements_ecartes ORDER BY le DESC');
  const trouves = r.rows.filter(e => {
    const cmp = comparerFiches(cherchee, { nom: e.nom, ville: e.ville, telephone: e.telephone });
    if (!cmp) return false;
    if (cmp.score >= 80) return true;
    // « Un nom contient l'autre » ne suffit que dans la même commune, comme pour les
    // doublons : « Le Bistrot » écarté à Aubenas ne dit rien du « Bistrot du Port » à Sète.
    if (cmp.score === 60) { const v = sansAccents(e.ville || ''); return !cherchee._ville || !v || v === cherchee._ville; }
    return false;
  });
  return {
    total: trouves.length,
    lignes: trouves.slice(0, MONTRES_MAX).map(e => ({
      nom: e.nom, ville: e.ville || '', motif: e.motif, par_qui: e.par_qui,
      le: e.le instanceof Date ? e.le.toISOString() : String(e.le || ''),
    })),
  };
}
