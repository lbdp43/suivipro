// Enregistrer une visite ou un appel chez un client : une seule règle, pour tous les écrans
// de l'appli et pour Claude.
//
// Une visite ou un appel abouti fait avancer le calendrier du client (dernière visite,
// prochaine visite selon sa fréquence) ; un rendez-vous planifié ou un appel sans réponse,
// non (shared/visites.js). Une visite ne se note pas à l'avance : ce qui est à venir est un
// rendez-vous planifié. Une date plus ancienne que la dernière visite connue ne la fait pas
// reculer. On écrit toujours en son nom — seul un administrateur note pour un collègue. La
// prospection note chez les clients qu'on lui confie par une tâche.
import crypto from 'node:crypto';
import db from '../db.js';
import { calculateNextVisit } from './visites.js';
import { logActivity } from './journal.js';
import { dateLocale } from '../../shared/regles.js';
import { ISSUES_APPEL_CLIENT, compteCommeVisite } from '../../shared/visites.js';
import { LIBELLES_INTERACTION } from '../../shared/libelles.js';

export const TYPES_INTERACTION = ['VISITE', 'APPEL', 'RDV_PLANIFIE'];

/** Une visite ou un appel qu'on ne peut pas enregistrer tel quel : le message dit quoi corriger. */
export class InteractionRefusee extends Error {}
/** Hors du périmètre de la personne (client d'un autre, rôle sans clients). */
export class InteractionInterdite extends InteractionRefusee {}

const estAdmin = (u) => u.role === 'admin';
const dateValide = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(d));

function dateFr(iso) {
  const [a, m, j] = String(iso || '').slice(0, 10).split('-');
  return a && m && j ? `${j}/${m}/${a}` : String(iso || '');
}

/** Une tâche ouverte sur ce client, assignée à cette personne : le client lui est confié. */
export async function tacheConfiee(clientId, personneId, executeur = db) {
  const r = await executeur.query(
    "SELECT 1 FROM tasks_client WHERE client_id = $1 AND commercial_id = $2 AND statut <> 'TERMINEE' LIMIT 1", [clientId, personneId]
  );
  return r.rows.length > 0;
}

/** La dernière visite connue, sauf si elle est dans le futur (donnée abîmée) : on l'ignore alors. */
function derniereVisiteFiable(client, aujourdhui) {
  const d = String(client.last_visit || '').slice(0, 10);
  return d && d <= aujourdhui ? d : '';
}

/**
 * Vérifie la saisie et dit ce qui va se passer, sans rien écrire.
 *
 * saisie = { id?, client_id, type, date?, comment, commercial_id?, issue?, sans_reponse?,
 *            taches_faites?: [id], nouvelle_tache?: { titre, date? } }
 * options.commentaireObligatoire : Claude l'exige ; certains écrans de l'appli s'en passent.
 * options.perimetre : 'equipe' (l'appli : un collègue peut passer chez le client d'un autre)
 *                     ou 'siens' (Claude : ses propres clients, tous pour l'administrateur).
 */
export async function planInteraction(saisie, auteur, { commentaireObligatoire = false, perimetre = 'equipe', executeur = db } = {}) {
  const s = saisie || {};

  const client = (await executeur.query(
    `SELECT c.*, cm.prenom AS commercial_prenom FROM clients c LEFT JOIN commerciaux cm ON cm.id = c.commercial_id WHERE c.id = $1`,
    [s.client_id]
  )).rows[0];
  if (!client) throw new InteractionRefusee('Client introuvable.');
  // La prospection n'a pas de clients à elle : elle appelle ceux qu'un commercial lui confie,
  // par une tâche qui lui est assignée. Tant que la tâche est ouverte, elle y note son appel.
  if (auteur.role === 'prospection') {
    if (!(await tacheConfiee(client.id, auteur.id, executeur))) {
      throw new InteractionInterdite(`${client.nom} ne vous est pas confié : la prospection note un appel chez un client quand une tâche ouverte sur ce client lui est assignée.`);
    }
  } else if (perimetre === 'siens' && !estAdmin(auteur) && client.commercial_id !== auteur.id) {
    throw new InteractionInterdite(`${client.nom} n'est pas l'un de vos clients : seul son commercial (ou un administrateur) y note une visite par ce chemin.`);
  }

  if (!TYPES_INTERACTION.includes(s.type)) throw new InteractionRefusee(`Type inconnu. Choisissez parmi : ${TYPES_INTERACTION.join(', ')}.`);

  let issue = null;
  if (s.issue) {
    issue = ISSUES_APPEL_CLIENT.find(i => i.value === s.issue);
    if (!issue) throw new InteractionRefusee(`Issue d'appel inconnue. Possibles : ${ISSUES_APPEL_CLIENT.map(i => `${i.value} (${i.label})`).join(', ')}.`);
    if (s.type !== 'APPEL') throw new InteractionRefusee('Une issue ne se donne que pour un appel.');
  }
  const sansReponse = !!s.sans_reponse || issue?.value === 'pas_de_reponse';

  const notes = String(s.comment || '').trim();
  if (commentaireObligatoire && !notes) throw new InteractionRefusee('Le commentaire est obligatoire : qu\'est-ce qui s\'est dit ou passé ?');
  const comment = issue ? (notes ? `${issue.label} · ${notes}` : issue.label) : notes;

  const maintenant = new Date().toISOString();
  const aujourdhui = dateLocale();
  const date = s.date ? String(s.date) : maintenant;
  const jour = date.slice(0, 10);
  if (!dateValide(jour)) throw new InteractionRefusee('Date invalide (AAAA-MM-JJ).');
  if (s.type !== 'RDV_PLANIFIE' && jour > aujourdhui) {
    throw new InteractionRefusee('Une visite ou un appel ne se note pas à l\'avance : ce qui est à venir est un rendez-vous planifié.');
  }

  let commercialId = auteur.id;
  let commercialPrenom = auteur.prenom || '';
  if (estAdmin(auteur) && s.commercial_id && s.commercial_id !== auteur.id) {
    const c = (await executeur.query('SELECT id, prenom FROM commerciaux WHERE id = $1', [s.commercial_id])).rows[0];
    if (!c) throw new InteractionRefusee('Commercial introuvable.');
    commercialId = c.id; commercialPrenom = c.prenom;
  }

  const compte = compteCommeVisite(s.type, sansReponse);
  let calendrier = null;
  const derniere = derniereVisiteFiable(client, aujourdhui);
  if (compte && (!derniere || jour >= derniere)) {
    const prochaine = client.statut === 'ACTIF' ? await calculateNextVisit(client.type_client, client.custom_recurrence, jour) : null;
    calendrier = { last_visit: jour, next_visit: prochaine };
  }

  const ids = Array.isArray(s.taches_faites) ? [...new Set(s.taches_faites.filter(Boolean))] : [];
  let tachesFaites = [];
  if (ids.length) {
    tachesFaites = (await executeur.query(
      "SELECT id, titre FROM tasks_client WHERE id = ANY($1) AND client_id = $2 AND statut <> 'TERMINEE'", [ids, client.id]
    )).rows;
    if (tachesFaites.length !== ids.length) throw new InteractionRefusee('Une des tâches à terminer est introuvable, déjà faite, ou n\'est pas sur ce client.');
  }

  let nouvelleTache = null;
  if (s.nouvelle_tache && String(s.nouvelle_tache.titre || '').trim()) {
    const d = s.nouvelle_tache.date || null;
    if (d && !dateValide(d)) throw new InteractionRefusee('Date de la tâche invalide (AAAA-MM-JJ).');
    // La suite d'un appel de la prospection revient au commercial du client : c'est lui qui
    // livre ou rappelle, et le client n'a pas à rester confié à la prospection pour autant.
    const pourCommercial = auteur.role === 'prospection' && client.commercial_id;
    nouvelleTache = {
      titre: String(s.nouvelle_tache.titre).trim().slice(0, 300), date: d,
      commercial_id: pourCommercial ? client.commercial_id : commercialId,
      commercial_prenom: pourCommercial ? client.commercial_prenom : '',
    };
  }
  // L'issue propose une suite ; on la signale sans l'imposer.
  let suggestion = null;
  if (!nouvelleTache && issue?.suite) {
    const d = new Date(); d.setDate(d.getDate() + issue.suite.jours);
    suggestion = { titre: issue.suite.titre, date: dateLocale(d) };
  }

  return {
    client, calendrier, tachesFaites, nouvelleTache, suggestion, sansReponse, compte,
    commercialPrenom,
    interaction: {
      id: s.id || `int-${crypto.randomUUID()}`, client_id: client.id, commercial_id: commercialId,
      type: s.type, date, comment, date_creation: maintenant, compte_visite: compte,
    },
  };
}

/** Ce que le plan va faire, en français, une ligne par geste. */
export function decrireInteraction(plan) {
  const { client, interaction, calendrier, tachesFaites, nouvelleTache, suggestion, compte, commercialPrenom } = plan;
  const lignes = [
    `${LIBELLES_INTERACTION[interaction.type] || interaction.type} chez ${client.nom}${client.ville ? ` (${client.ville})` : ''}, le ${dateFr(interaction.date)}${commercialPrenom ? `, par ${commercialPrenom}` : ''}`,
  ];
  if (interaction.comment) lignes.push(`Commentaire : ${interaction.comment}`);
  if (calendrier) {
    lignes.push(`Compte comme visite : dernière visite le ${dateFr(calendrier.last_visit)}, ${calendrier.next_visit ? `prochaine le ${dateFr(calendrier.next_visit)}` : 'pas de prochaine visite (client inactif ou sans fréquence)'}.`);
  } else if (compte) {
    lignes.push(`Compte comme visite, mais une visite plus récente est déjà notée (${dateFr(client.last_visit)}) : le calendrier ne bouge pas.`);
  } else {
    lignes.push(interaction.type === 'RDV_PLANIFIE' ? 'Rendez-vous planifié : le calendrier des visites ne bouge pas.' : 'Appel sans réponse : ne compte pas comme visite, le calendrier ne bouge pas.');
  }
  for (const t of tachesFaites) lignes.push(`Tâche terminée : « ${t.titre} »`);
  if (nouvelleTache) lignes.push(`Nouvelle tâche : « ${nouvelleTache.titre} »${nouvelleTache.date ? `, pour le ${dateFr(nouvelleTache.date)}` : ''}${nouvelleTache.commercial_prenom ? `, assignée à ${nouvelleTache.commercial_prenom}` : ''}`);
  if (suggestion) lignes.push(`Suite conseillée (non créée) : « ${suggestion.titre} » pour le ${dateFr(suggestion.date)}`);
  return lignes;
}

/**
 * Enregistre d'un bloc : l'interaction, le calendrier du client, les tâches terminées, la
 * nouvelle tâche. Soit tout passe, soit rien. `via` : 'app' ou 'claude' (écrit au journal).
 */
export async function enregistrerInteraction(saisie, auteur, { via = 'app', ...options } = {}) {
  const cx = await db.connect();
  let plan;
  let tache = null;
  try {
    await cx.query('BEGIN');
    await cx.query('SELECT 1 FROM clients WHERE id = $1 FOR UPDATE', [saisie?.client_id]);
    plan = await planInteraction(saisie, auteur, { ...options, executeur: cx });
    const i = plan.interaction;
    await cx.query(
      `INSERT INTO interactions (id, client_id, commercial_id, type, date, comment, date_creation, compte_visite)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.id, i.client_id, i.commercial_id, i.type, i.date, i.comment, i.date_creation, i.compte_visite]
    );
    if (plan.calendrier) {
      await cx.query('UPDATE clients SET last_visit = $1, next_visit = $2, date_modification = $3 WHERE id = $4',
        [plan.calendrier.last_visit, plan.calendrier.next_visit, i.date_creation, i.client_id]);
    }
    if (plan.tachesFaites.length) {
      await cx.query("UPDATE tasks_client SET statut = 'TERMINEE', completed_at = $1 WHERE id = ANY($2)",
        [i.date_creation, plan.tachesFaites.map(t => t.id)]);
    }
    if (plan.nouvelleTache) {
      tache = {
        id: `task-${crypto.randomUUID()}`, titre: plan.nouvelleTache.titre, description: '', statut: 'A_FAIRE', priorite: 'MOYENNE',
        date_echeance: plan.nouvelleTache.date, commercial_id: plan.nouvelleTache.commercial_id, client_id: i.client_id,
        date_creation: i.date_creation, completed_at: null, categorie: 'suivi', created_by: auteur.id,
      };
      await cx.query(
        `INSERT INTO tasks_client (id, titre, description, statut, priorite, date_echeance, commercial_id, client_id, date_creation, completed_at, categorie, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [tache.id, tache.titre, tache.description, tache.statut, tache.priorite, tache.date_echeance, tache.commercial_id, tache.client_id, tache.date_creation, null, tache.categorie, tache.created_by]
      );
    }
    await cx.query('COMMIT');
  } catch (err) {
    try { await cx.query('ROLLBACK'); } catch { /* déjà perdue */ }
    throw err;
  } finally {
    cx.release();
  }

  const i = plan.interaction;
  const pour = i.commercial_id !== auteur.id && plan.commercialPrenom ? ` pour ${plan.commercialPrenom}` : '';
  await logActivity(auteur.id, 'visite_client',
    `${i.type}${i.comment ? ': ' + i.comment.substring(0, 100) : ''}${pour}${via === 'claude' ? ' (via IA)' : ''}`, 'client', i.client_id);

  const [client, taches] = await Promise.all([
    db.query('SELECT * FROM clients WHERE id = $1', [i.client_id]).then(r => r.rows[0]),
    plan.tachesFaites.length ? db.query('SELECT * FROM tasks_client WHERE id = ANY($1)', [plan.tachesFaites.map(t => t.id)]).then(r => r.rows) : [],
  ]);
  return { interaction: i, client, taches_faites: taches, nouvelle_tache: tache, resume: decrireInteraction(plan) };
}

/** Remet la dernière et la prochaine visite d'un client d'après ses interactions qui comptent. */
export async function recalculerCalendrier(clientId, executeur = db) {
  const c = (await executeur.query('SELECT type_client, custom_recurrence, statut FROM clients WHERE id = $1', [clientId])).rows[0];
  if (!c) return null;
  const r = await executeur.query(
    'SELECT left(date, 10) AS jour FROM interactions WHERE client_id = $1 AND compte_visite AND left(date, 10) <= $2 ORDER BY date DESC LIMIT 1',
    [clientId, dateLocale()]
  );
  const derniere = r.rows[0]?.jour || null;
  const prochaine = derniere && c.statut === 'ACTIF' ? await calculateNextVisit(c.type_client, c.custom_recurrence, derniere) : null;
  await executeur.query('UPDATE clients SET last_visit = $1, next_visit = $2, date_modification = $3 WHERE id = $4',
    [derniere, prochaine, new Date().toISOString(), clientId]);
  return { last_visit: derniere, next_visit: prochaine };
}

/**
 * Le planning des visites notait les visites à venir comme faites : des clients ont gardé
 * une « dernière visite » dans le futur, et paraissaient à jour. On les remet d'aplomb au
 * démarrage — sans effet une fois que plus aucun client n'est dans ce cas.
 */
export async function reparerDernieresVisitesFutures() {
  const r = await db.query('SELECT id FROM clients WHERE left(last_visit, 10) > $1', [dateLocale()]);
  for (const { id } of r.rows) await recalculerCalendrier(id);
  return r.rows.length;
}
