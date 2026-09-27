// LE compte rendu d'un rendez-vous, côté serveur : une seule règle pour l'application et
// pour Claude (MCP).
//
// Avant, la fenêtre de compte rendu faisait le travail dans le téléphone, en trois envois
// séparés (le rendez-vous, puis l'étape du prospect, puis le rappel) : une coupure réseau au
// milieu laissait un compte rendu sans suite. Et pour un rendez-vous chez un CLIENT, le
// rappel échouait toujours (un rappel appartient à un prospect). Ici, tout se fait d'un
// bloc, et la suite d'un rendez-vous client devient une tâche client.
//
// Les règles viennent de shared/tunnel.js — les mêmes que partout :
//   Client → Gagné · Mail envoyé → Négociation + « attendre une réponse »
//   Commande plus tard / À relancer → Proposition + « appeler »
//   Pas intéressé → Perdu (avec une raison) · RDV décalé → un nouveau rendez-vous.
// Les notes sont obligatoires ; la suite l'est pour Mail envoyé, Commande plus tard et
// À relancer. Un prospect déjà Gagné, Perdu ou « ne pas contacter » ne bouge plus.
import crypto from 'crypto';
import db from '../db.js';
import { changerEtape } from './tunnel.js';
import { logActivity } from './journal.js';
import { poserRendezVous } from './agendaGoogle.js';
import { etapeApresCompteRendu, typeActionApresCompteRendu, RAISONS_PERTE, TYPES_ACTION } from '../../shared/tunnel.js';
import { LIBELLES_RESULTAT_RDV, LIBELLES_ETAPE } from '../../shared/libelles.js';
import { rdvAnnule, rdvPasse } from '../../shared/regles.js';

export const RESULTATS_CR = ['client', 'mail_envoye', 'commande_plus_tard', 'a_relancer', 'pas_interesse', 'decale'];
export const SUITE_OBLIGATOIRE = ['a_relancer', 'commande_plus_tard', 'mail_envoye'];

/** Un compte rendu qu'on ne peut pas enregistrer tel quel : le message dit quoi corriger. */
export class CompteRenduRefuse extends Error {}
/** Un compte rendu que cette personne n'a pas le droit d'écrire (le rendez-vous d'un autre). */
export class CompteRenduInterdit extends CompteRenduRefuse {}

const dateValide = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(d));
const heureValide = (h) => !h || /^\d{2}:\d{2}$/.test(String(h));

function dateFr(iso) {
  const [a, m, j] = String(iso || '').slice(0, 10).split('-');
  return a && m && j ? `${j}/${m}/${a}` : String(iso || '');
}

/**
 * Lit le rendez-vous et ce qu'il concerne, vérifie la saisie, et dit ce qui va se passer —
 * sans rien écrire. Lève CompteRenduRefuse si quelque chose manque ou n'est pas permis.
 *
 * saisie = { resultat, notes, suite?: { date, heure?, message? }, raison_perte?,
 *            nouveau_rdv?: { date, heure_debut?, heure_fin?, notes? } }
 * auteur = { id, role, prenom }
 * options.dejaEcrit : 'autoriser' (l'appli : on corrige un compte rendu) ou 'refuser' (Claude).
 * options.avantLeRdv : 'autoriser' ou 'refuser' (on ne raconte pas un rendez-vous qui n'a pas eu lieu).
 */
export async function planDuCompteRendu(rdvId, saisie, auteur, { dejaEcrit = 'autoriser', avantLeRdv = 'autoriser', executeur = db } = {}) {
  const r = await executeur.query(
    `SELECT a.*, p.nom_etablissement, p.ville AS ville_prospect, p.etape_pipeline, c.nom AS nom_client, c.ville AS ville_client,
            com.prenom AS commercial_prenom
       FROM appointments a
       LEFT JOIN prospects p ON p.id = a.prospect_id
       LEFT JOIN clients c ON c.id = a.client_id
       LEFT JOIN commerciaux com ON com.id = a.commercial_id
      WHERE a.id = $1`,
    [rdvId]
  );
  const rdv = r.rows[0];
  if (!rdv) throw new CompteRenduRefuse('Rendez-vous introuvable.');
  if (auteur.role !== 'admin' && rdv.commercial_id !== auteur.id) {
    throw new CompteRenduInterdit('Ce rendez-vous n\'est pas le vôtre : le compte rendu revient à celui qui y est allé.');
  }
  if (rdvAnnule(rdv)) throw new CompteRenduRefuse('Ce rendez-vous est annulé : il n\'a pas de compte rendu.');
  if (avantLeRdv === 'refuser' && !rdvPasse(rdv)) {
    throw new CompteRenduRefuse(`Ce rendez-vous n'a pas encore eu lieu (${dateFr(rdv.date)}${rdv.heure_debut ? ` à ${rdv.heure_debut}` : ''}).`);
  }
  if (dejaEcrit === 'refuser' && rdv.compte_rendu) {
    throw new CompteRenduRefuse(`Le compte rendu est déjà écrit (« ${LIBELLES_RESULTAT_RDV[rdv.compte_rendu] || rdv.compte_rendu} »). Pour le corriger, passez par SuiviPro.`);
  }

  const resultat = String(saisie.resultat || '');
  if (!RESULTATS_CR.includes(resultat)) {
    throw new CompteRenduRefuse(`Résultat inconnu. Choisissez parmi : ${RESULTATS_CR.map(x => `${x} (${LIBELLES_RESULTAT_RDV[x]})`).join(', ')}.`);
  }
  const notes = String(saisie.notes || '').trim();
  if (!notes) throw new CompteRenduRefuse('Les notes sont obligatoires : comment s\'est passé le rendez-vous ?');

  const cible = rdv.prospect_id
    ? { genre: 'prospect', id: rdv.prospect_id, nom: rdv.nom_etablissement, ville: rdv.ville_prospect || '', etape: rdv.etape_pipeline }
    : rdv.client_id
      ? { genre: 'client', id: rdv.client_id, nom: rdv.nom_client, ville: rdv.ville_client || '', etape: null }
      : { genre: 'aucun', id: null, nom: 'Rendez-vous', ville: '', etape: null };

  // L'étape du prospect, par la règle du tunnel.
  const etapeVers = cible.genre === 'prospect' ? etapeApresCompteRendu(resultat, cible.etape) : null;
  let raisonPerte = '';
  if (etapeVers === 'perdu') {
    raisonPerte = String(saisie.raison_perte || 'pas_interesse');
    if (!RAISONS_PERTE[raisonPerte]) {
      throw new CompteRenduRefuse(`Raison de perte inconnue. Choisissez parmi : ${Object.entries(RAISONS_PERTE).map(([k, v]) => `${k} (${v})`).join(', ')}.`);
    }
  }

  // La suite : obligatoire pour trois résultats, possible pour les autres (sauf décalé).
  let suite = null;
  const s = saisie.suite;
  if (SUITE_OBLIGATOIRE.includes(resultat) && !(s && s.date)) {
    throw new CompteRenduRefuse(`Pour « ${LIBELLES_RESULTAT_RDV[resultat]} », il faut une date de relance.`);
  }
  if (s && s.date && resultat !== 'decale') {
    if (!dateValide(s.date)) throw new CompteRenduRefuse('Date de relance invalide (format AAAA-MM-JJ).');
    if (!heureValide(s.heure)) throw new CompteRenduRefuse('Heure de relance invalide (format HH:MM).');
    const libelle = LIBELLES_RESULTAT_RDV[resultat];
    const message = String(s.message || '').trim() || `Relance suite RDV ${cible.nom} - ${libelle}`;
    if (cible.genre === 'prospect') {
      suite = { genre: 'rappel', date: s.date, heure: s.heure || '09:00', message, type: typeActionApresCompteRendu(resultat) };
    } else if (cible.genre === 'client') {
      suite = { genre: 'tache', date: s.date, heure: s.heure || '', message, type: null };
    }
  }

  // Le décalage : un nouveau rendez-vous à la date dite.
  let nouveauRdv = null;
  if (resultat === 'decale') {
    const n = saisie.nouveau_rdv || {};
    if (!dateValide(n.date)) throw new CompteRenduRefuse('Pour un rendez-vous décalé, donnez la nouvelle date (AAAA-MM-JJ).');
    if (!heureValide(n.heure_debut) || !heureValide(n.heure_fin)) throw new CompteRenduRefuse('Heures du nouveau rendez-vous invalides (format HH:MM).');
    nouveauRdv = {
      date: n.date,
      heure_debut: n.heure_debut || rdv.heure_debut || '09:00',
      heure_fin: n.heure_fin || rdv.heure_fin || '10:00',
      notes: String(n.notes || '').trim(),
    };
  }

  return { rdv, cible, plan: { resultat, notes, etapeVers, raisonPerte, suite, nouveauRdv } };
}

/** Ce que le plan va faire, en phrases — pour la confirmation avant d'enregistrer. */
export function decrirePlan({ rdv, cible, plan }) {
  const lignes = [
    `Rendez-vous du ${dateFr(rdv.date)}${rdv.heure_debut ? ` à ${rdv.heure_debut}` : ''} — ${cible.nom}${cible.ville ? ` (${cible.ville})` : ''}${rdv.commercial_prenom ? `, pour ${rdv.commercial_prenom}` : ''}`,
    `Résultat : ${LIBELLES_RESULTAT_RDV[plan.resultat]}`,
    `Notes : ${plan.notes}`,
  ];
  if (plan.etapeVers && plan.etapeVers === cible.etape) {
    lignes.push(`Le prospect reste en « ${LIBELLES_ETAPE[cible.etape] || cible.etape} »${plan.raisonPerte ? `, raison : ${RAISONS_PERTE[plan.raisonPerte]}` : ''}.`);
  } else if (plan.etapeVers) {
    lignes.push(`Le prospect passe de « ${LIBELLES_ETAPE[cible.etape] || cible.etape} » à « ${LIBELLES_ETAPE[plan.etapeVers] || plan.etapeVers} »${plan.raisonPerte ? `, raison : ${RAISONS_PERTE[plan.raisonPerte]}` : ''}.`);
  } else if (cible.genre === 'prospect') {
    lignes.push(`Le prospect reste en « ${LIBELLES_ETAPE[cible.etape] || cible.etape} ».`);
  }
  if (plan.suite?.genre === 'rappel') lignes.push(`Prochaine action : « ${TYPES_ACTION[plan.suite.type] || plan.suite.type} » le ${dateFr(plan.suite.date)} à ${plan.suite.heure} — ${plan.suite.message}`);
  if (plan.suite?.genre === 'tache') lignes.push(`Tâche client : « ${plan.suite.message} », pour le ${dateFr(plan.suite.date)}`);
  if (plan.nouveauRdv) lignes.push(`Nouveau rendez-vous : ${dateFr(plan.nouveauRdv.date)} de ${plan.nouveauRdv.heure_debut} à ${plan.nouveauRdv.heure_fin}`);
  if (rdv.compte_rendu) lignes.push(`Remplace le compte rendu précédent (« ${LIBELLES_RESULTAT_RDV[rdv.compte_rendu] || rdv.compte_rendu} »).`);
  return lignes;
}

/**
 * Enregistre le compte rendu d'un bloc : le rendez-vous, l'étape du prospect, la suite
 * (rappel pour un prospect, tâche pour un client), le nouveau rendez-vous si c'est décalé.
 * Soit tout passe, soit rien. `via` : 'app' ou 'claude' (écrit au journal).
 */
export async function enregistrerCompteRendu(rdvId, saisie, auteur, { via = 'app', ...options } = {}) {
  const cx = await db.connect();
  let lu, rappel = null, tache = null, nouveau = null;
  try {
    await cx.query('BEGIN');
    await cx.query('SELECT 1 FROM appointments WHERE id = $1 FOR UPDATE', [rdvId]);
    lu = await planDuCompteRendu(rdvId, saisie, auteur, { ...options, executeur: cx });
    const { rdv, cible, plan } = lu;

    const notesFinales = plan.nouveauRdv?.notes ? `${plan.notes}\nDécalé : ${plan.nouveauRdv.notes}` : plan.notes;
    await cx.query(
      "UPDATE appointments SET statut = 'termine', compte_rendu = $1, notes_compte_rendu = $2 WHERE id = $3",
      [plan.resultat, notesFinales, rdvId]
    );

    if (plan.etapeVers) await changerEtape(cible.id, plan.etapeVers, auteur.id, { raison: plan.raisonPerte, executeur: cx });

    if (plan.suite?.genre === 'rappel') {
      rappel = { id: `rem-${crypto.randomUUID()}`, prospect_id: cible.id, commercial_id: rdv.commercial_id, date: plan.suite.date, heure: plan.suite.heure, message: plan.suite.message, statut: 'actif', type: plan.suite.type };
      await cx.query(
        'INSERT INTO reminders (id, prospect_id, commercial_id, date, heure, message, statut, type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [rappel.id, rappel.prospect_id, rappel.commercial_id, rappel.date, rappel.heure, rappel.message, rappel.statut, rappel.type]
      );
    }
    if (plan.suite?.genre === 'tache') {
      tache = {
        id: `task-${crypto.randomUUID()}`, titre: plan.suite.message, description: `Suite du rendez-vous du ${dateFr(rdv.date)} : ${plan.notes}`.slice(0, 2000),
        statut: 'A_FAIRE', priorite: 'MOYENNE', date_echeance: plan.suite.date, commercial_id: rdv.commercial_id, client_id: cible.id,
        date_creation: new Date().toISOString(), completed_at: null, categorie: 'suivi', created_by: auteur.id,
      };
      await cx.query(
        `INSERT INTO tasks_client (id, titre, description, statut, priorite, date_echeance, commercial_id, client_id, date_creation, completed_at, categorie, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [tache.id, tache.titre, tache.description, tache.statut, tache.priorite, tache.date_echeance, tache.commercial_id, tache.client_id, tache.date_creation, null, tache.categorie, tache.created_by]
      );
    }
    if (plan.nouveauRdv) {
      nouveau = {
        id: `apt-${crypto.randomUUID()}`, prospect_id: rdv.prospect_id, client_id: rdv.client_id, commercial_id: rdv.commercial_id,
        prospecteur_id: rdv.prospecteur_id, date: plan.nouveauRdv.date, heure_debut: plan.nouveauRdv.heure_debut, heure_fin: plan.nouveauRdv.heure_fin,
        lieu: rdv.lieu || '', notes: plan.nouveauRdv.notes || rdv.notes || '', statut: 'planifie', compte_rendu: '', notes_compte_rendu: '',
        created_at: new Date().toISOString(),
      };
      await cx.query(
        'INSERT INTO appointments (id, prospect_id, commercial_id, prospecteur_id, date, heure_debut, heure_fin, lieu, notes, statut, compte_rendu, notes_compte_rendu, created_at, client_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
        [nouveau.id, nouveau.prospect_id, nouveau.commercial_id, nouveau.prospecteur_id, nouveau.date, nouveau.heure_debut, nouveau.heure_fin, nouveau.lieu, nouveau.notes, 'planifie', '', '', nouveau.created_at, nouveau.client_id]
      );
    }
    await cx.query('COMMIT');
  } catch (err) {
    try { await cx.query('ROLLBACK'); } catch { /* déjà perdue */ }
    throw err;
  } finally {
    cx.release();
  }

  const { rdv, cible, plan } = lu;
  const pour = auteur.id !== rdv.commercial_id && rdv.commercial_prenom ? ` pour ${rdv.commercial_prenom}` : '';
  await logActivity(auteur.id, 'compte_rendu_rdv',
    `${cible.nom} : ${LIBELLES_RESULTAT_RDV[plan.resultat]}${pour}${via === 'claude' ? ' (via Claude)' : ''}`, 'appointment', rdvId);
  if (nouveau) await logActivity(auteur.id, 'creation_rdv', `RDV décalé au ${nouveau.date}${via === 'claude' ? ' (via Claude)' : ''}`, 'appointment', nouveau.id);

  // L'agenda Google suit (événement complété, nouveau rendez-vous posé). Un échec n'annule rien.
  try { await poserRendezVous(rdvId); } catch { /* l'agenda n'est qu'un reflet */ }
  if (nouveau) { try { await poserRendezVous(nouveau.id); } catch { /* idem */ } }

  const [rdvApres, prospectApres] = await Promise.all([
    db.query('SELECT * FROM appointments WHERE id = $1', [rdvId]).then(x => x.rows[0]),
    cible.genre === 'prospect' ? db.query('SELECT * FROM prospects WHERE id = $1', [cible.id]).then(x => x.rows[0]) : null,
  ]);
  return { rdv: rdvApres, prospect: prospectApres, rappel, tache, nouveau_rdv: nouveau, resume: decrirePlan(lu) };
}
