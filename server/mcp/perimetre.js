// Qui a le droit de voir quoi. Les mêmes règles que dans le logiciel, en plus strictes
// sur deux points : le périmètre est appliqué ICI, avant l'envoi, et non à l'affichage ;
// et un commercial ne voit que ses fiches tant qu'il n'a pas nommé un collègue.
import db from '../db.js';
import { normaliserPourComparaison } from '../../shared/normalisation.js';
import { journaliserCollegue, journaliserRefus } from './journal.js';

/** Levée quand une demande sort du périmètre : le message part tel quel vers Claude. */
export class HorsPerimetre extends Error {}

export function estAdmin(u) {
  return u.role === 'admin';
}

export function faitDeLaProspection(u) {
  return u.role === 'prospection';
}

let cacheEquipe = { le: 0, lignes: [] };

export async function equipe() {
  if (Date.now() - cacheEquipe.le < 30000) return cacheEquipe.lignes;
  const r = await db.query('SELECT id, prenom, nom, role, prospection FROM commerciaux ORDER BY prenom');
  cacheEquipe = { le: Date.now(), lignes: r.rows };
  return r.rows;
}

/** « Alban », « alban dupont », « com-5 » : on retrouve la personne, ou on dit qu'on ne sait pas. */
export async function trouverCommercial(recherche) {
  const gens = await equipe();
  const q = normaliserPourComparaison(recherche);
  if (!q) return null;
  const exact = gens.find(g => g.id === recherche);
  if (exact) return exact;
  const candidats = gens.filter(g => {
    const complet = normaliserPourComparaison(`${g.prenom} ${g.nom}`);
    return normaliserPourComparaison(g.prenom) === q || complet === q || complet.includes(q);
  });
  if (candidats.length === 1) return candidats[0];
  if (candidats.length > 1) {
    throw new HorsPerimetre(`Plusieurs personnes répondent à « ${recherche} » : ${candidats.map(c => `${c.prenom} ${c.nom}`).join(', ')}. Précisez.`);
  }
  throw new HorsPerimetre(`Personne ne s'appelle « ${recherche} » dans l'équipe : ${gens.map(g => g.prenom).join(', ')}.`);
}

/**
 * Les commerciaux dont on a le droit de lire les fiches, pour cet outil et cette demande.
 * Retourne `null` quand il n'y a aucun filtre à poser (toute l'équipe).
 *
 * @param domaine 'clients' | 'prospects' — la prospection n'a pas accès aux clients,
 *   et voit en revanche les prospects de toute l'équipe, comme à l'écran.
 */
export async function perimetre(utilisateur, demande, domaine, outil) {
  if (domaine === 'clients' && faitDeLaProspection(utilisateur)) {
    await journaliserRefus(utilisateur, outil, 'accès clients demandé par la prospection');
    throw new HorsPerimetre("Les clients ne font pas partie de votre périmètre : votre accès couvre les prospects, le pipeline, la boîte de prospection et les rendez-vous que vous avez pris.");
  }

  // La prospection voit déjà les prospects de toute l'équipe : nommer quelqu'un n'est
  // alors pas sortir de son périmètre, et ne mérite pas une ligne de journal.
  const defautLarge = domaine === 'prospects' && faitDeLaProspection(utilisateur);

  // Une personne nommée : l'admin la lit sans façon, un commercial la lit et c'est noté.
  if (demande) {
    const cible = await trouverCommercial(demande);
    if (cible.id !== utilisateur.id && !estAdmin(utilisateur) && !defautLarge) {
      await journaliserCollegue(utilisateur, `${cible.prenom} ${cible.nom}`, outil);
    }
    return { ids: [cible.id], cible, montantsMasques: !estAdmin(utilisateur) && cible.id !== utilisateur.id };
  }

  if (estAdmin(utilisateur)) return { ids: null, cible: null, montantsMasques: false };
  // La prospection voit les prospects de toute l'équipe (c'est son métier) ; le commercial
  // voit les siens tant qu'il n'a nommé personne.
  if (defautLarge) return { ids: null, cible: null, montantsMasques: true };
  return { ids: [utilisateur.id], cible: utilisateur, montantsMasques: false };
}

/** Un fragment SQL « commercial_id = ANY($n) », ou rien du tout. */
export function clause(champ, ids, params) {
  if (!ids) return '';
  params.push(ids);
  return ` AND ${champ} = ANY($${params.length})`;
}
