// Le suivi des rendez-vous et des relances, par Claude : écrire un compte rendu, terminer
// une action du tunnel, clore une tâche client, préparer un mail.
//
// Mêmes règles que l'application — elles vivent dans lib/compteRendu.js et lib/tunnel.js,
// pas ici. Chaque outil qui écrit fonctionne en deux temps : sans « confirmer », il dit ce
// qui VA se passer et n'écrit rien ; Claude le montre, et ne rappelle avec « confirmer: true »
// qu'après l'accord de la personne. Chacun n'écrit que sur ses propres rendez-vous, rappels
// et tâches ; l'administrateur peut le faire pour un collègue (le journal garde les deux noms).
import { z } from 'zod';
import db from '../../db.js';
import { dateLocale, rdvAnnule, rdvPasse } from '../../../shared/regles.js';
import { LIBELLES_RESULTAT_RDV, LIBELLES_ETAPE } from '../../../shared/libelles.js';
import { RAISONS_PERTE, TYPES_ACTION, issuesPourAction, appliquerIssue, issueEstUnePerte } from '../../../shared/tunnel.js';
import { planDuCompteRendu, enregistrerCompteRendu, decrirePlan, RESULTATS_CR, CompteRenduRefuse } from '../../lib/compteRendu.js';
import { terminerAction } from '../../lib/tunnel.js';
import { logActivity } from '../../lib/journal.js';
import { estAdmin, trouverCommercial, HorsPerimetre } from '../perimetre.js';
import { LIMITE_DEFAUT, LIMITE_MAX, borner, dateFr, ligne, bloc, entete, extrait, nommer } from '../format.js';

export const CONFIRMER = z.boolean().optional().describe('Laisser vide (ou false) pour voir ce qui va se passer sans rien enregistrer. Mettre true SEULEMENT après l\'accord explicite de la personne sur ce résumé.');

/** À qui s'appliquent les listes : soi, ou — pour l'administrateur — le collègue nommé, ou toute l'équipe. */
async function pourQui(utilisateur, commercial) {
  if (!commercial) return estAdmin(utilisateur) ? null : utilisateur.id;
  if (!estAdmin(utilisateur)) {
    throw new HorsPerimetre('Vous ne pouvez consulter et écrire que vos propres rendez-vous, rappels et tâches.');
  }
  return (await trouverCommercial(commercial)).id;
}

/** On n'écrit que sur ce qui est à soi (l'administrateur, pour tout le monde). */
function verifierProprietaire(utilisateur, commercialId, quoi) {
  if (!estAdmin(utilisateur) && commercialId !== utilisateur.id) {
    throw new HorsPerimetre(`${quoi} n'est pas à vous : seul son titulaire (ou un administrateur) peut le traiter.`);
  }
}

export const deuxTemps = (lignes) => bloc(
  'À CONFIRMER — rien n\'est encore enregistré :',
  ...lignes.map(l => `- ${l}`),
  '',
  'Montrez ce résumé à la personne. Si elle est d\'accord, rappelez le même outil avec les mêmes valeurs et confirmer: true.',
);

// ---------------------------------------------------------------------------------------
const aFaire = {
  nom: 'comptes_rendus_a_faire',
  titre: 'Comptes rendus à faire',
  description: 'Les rendez-vous passés dont le compte rendu n\'est pas encore écrit, les plus anciens d\'abord, avec leur référence (réf.) à donner à « ecrire_compte_rendu ».',
  schema: {
    commercial: z.string().optional().describe('Administrateur seulement : le prénom d\'un collègue. Sinon, vos propres rendez-vous.'),
    limite: z.number().optional().describe(`Nombre de résultats, ${LIMITE_DEFAUT} par défaut, ${LIMITE_MAX} au maximum.`),
  },
  executer: async (a, { utilisateur }) => {
    const qui = await pourQui(utilisateur, a.commercial);
    const r = await db.query(
      `SELECT r.*, p.nom_etablissement, p.ville AS ville_prospect, p.etape_pipeline, c.nom AS nom_client, c.ville AS ville_client, com.prenom
         FROM appointments r
         LEFT JOIN prospects p ON p.id = r.prospect_id
         LEFT JOIN clients c ON c.id = r.client_id
         LEFT JOIN commerciaux com ON com.id = r.commercial_id
        WHERE COALESCE(r.compte_rendu, '') = '' ${qui ? 'AND r.commercial_id = $1' : ''}
        ORDER BY r.date, r.heure_debut`,
      qui ? [qui] : []
    );
    const lignes = r.rows.filter(x => !rdvAnnule(x) && rdvPasse(x));
    const limite = borner(a.limite, LIMITE_DEFAUT, LIMITE_MAX);
    return {
      resultats: lignes.length,
      texte: bloc(
        entete('Comptes rendus à faire', Math.min(limite, lignes.length), lignes.length),
        '',
        lignes.slice(0, limite).map(x => ligne(
          `réf. ${x.id}`,
          dateFr(x.date),
          x.heure_debut || '',
          nommer(x.nom_client || x.nom_etablissement || 'Rendez-vous', x.ville_client || x.ville_prospect),
          x.client_id ? 'client' : `prospect en « ${LIBELLES_ETAPE[x.etape_pipeline] || x.etape_pipeline} »`,
          qui === utilisateur.id ? '' : `pour ${x.prenom || '?'}`,
          extrait(x.notes, 120),
        )).join('\n') || 'Aucun compte rendu en retard.',
        '',
        `Résultats possibles : ${RESULTATS_CR.map(k => `${k} (${LIBELLES_RESULTAT_RDV[k]})`).join(', ')}.`,
      ),
    };
  },
};

// ---------------------------------------------------------------------------------------
const ecrire = {
  nom: 'ecrire_compte_rendu',
  titre: 'Écrire le compte rendu d\'un rendez-vous',
  ecrit: true,
  description: [
    'Enregistre le compte rendu d\'un rendez-vous passé, selon les règles de SuiviPro (voir « contexte », sujet comptes_rendus) :',
    'client → prospect Gagné ; mail_envoye → Négociation + action « attendre une réponse » ; commande_plus_tard ou a_relancer → Proposition + action « appeler » ;',
    'pas_interesse → Perdu (raison_perte) ; decale → nouveau rendez-vous (nouvelle_date). Les notes sont obligatoires ;',
    'la date de relance (relance_le) l\'est pour mail_envoye, commande_plus_tard et a_relancer. Pour un rendez-vous client, la relance devient une tâche client.',
    'Demandez à la personne ce qui manque plutôt que de l\'inventer. Toujours en deux temps : d\'abord sans « confirmer » pour montrer le résumé, puis confirmer: true après son accord.',
  ].join(' '),
  schema: {
    rendez_vous: z.string().describe('La référence du rendez-vous (réf. …) donnée par « comptes_rendus_a_faire » ou « rendez_vous ».'),
    resultat: z.enum(RESULTATS_CR).describe('Ce que le rendez-vous a donné.'),
    notes: z.string().describe('Le compte rendu lui-même, dans les mots de la personne : ce qui s\'est dit, ce qui est convenu.'),
    relance_le: z.string().optional().describe('Date de la prochaine action, AAAA-MM-JJ. Obligatoire pour mail_envoye, commande_plus_tard, a_relancer.'),
    relance_heure: z.string().optional().describe('Heure de la relance, HH:MM (09:00 par défaut).'),
    relance_message: z.string().optional().describe('Ce qu\'il faudra faire, en une phrase.'),
    raison_perte: z.enum(Object.keys(RAISONS_PERTE)).optional().describe('Pour pas_interesse : la raison (pas_interesse par défaut).'),
    nouvelle_date: z.string().optional().describe('Pour decale : la nouvelle date, AAAA-MM-JJ.'),
    nouvelle_heure_debut: z.string().optional().describe('Pour decale : HH:MM.'),
    nouvelle_heure_fin: z.string().optional().describe('Pour decale : HH:MM.'),
    notes_decalage: z.string().optional().describe('Pour decale : pourquoi, ou ce qui change.'),
    confirmer: CONFIRMER,
  },
  executer: async (a, { utilisateur }) => {
    const saisie = {
      resultat: a.resultat,
      notes: a.notes,
      suite: a.relance_le ? { date: a.relance_le, heure: a.relance_heure, message: a.relance_message } : undefined,
      raison_perte: a.raison_perte,
      nouveau_rdv: a.resultat === 'decale' ? { date: a.nouvelle_date, heure_debut: a.nouvelle_heure_debut, heure_fin: a.nouvelle_heure_fin, notes: a.notes_decalage } : undefined,
    };
    const options = { dejaEcrit: 'refuser', avantLeRdv: 'refuser' };
    if (!a.confirmer) {
      const lu = await planDuCompteRendu(a.rendez_vous, saisie, utilisateur, options);
      return { resultats: 0, texte: deuxTemps(decrirePlan(lu)) };
    }
    const r = await enregistrerCompteRendu(a.rendez_vous, saisie, utilisateur, { via: 'claude', ...options });
    return {
      resultats: 1,
      texte: bloc('Compte rendu enregistré dans SuiviPro :', ...r.resume.map(l => `- ${l}`),
        a.resultat === 'mail_envoye' && r.prospect ? '\nLe mail peut être préparé avec « proposer_mail ».' : ''),
    };
  },
};

// ---------------------------------------------------------------------------------------
const actions = {
  nom: 'mes_actions',
  titre: 'Mes actions et tâches',
  description: 'Les prochaines actions du tunnel sur les prospects (appeler, relancer par mail, attendre une réponse, à faire) et les tâches clients, en retard, du jour et des jours qui viennent, avec leur référence (réf.) et les issues possibles.',
  schema: {
    commercial: z.string().optional().describe('Administrateur seulement : le prénom d\'un collègue.'),
    jours: z.number().optional().describe('Horizon en jours à partir d\'aujourd\'hui (7 par défaut, 60 au maximum).'),
  },
  executer: async (a, { utilisateur }) => {
    const qui = await pourQui(utilisateur, a.commercial);
    const horizon = borner(a.jours, 7, 60);
    const d = new Date(); d.setDate(d.getDate() + horizon);
    const jusqua = dateLocale(d);
    const aujourdhui = dateLocale();
    const params = [jusqua];
    if (qui) params.push(qui);
    const rappels = (await db.query(
      `SELECT r.*, p.nom_etablissement, p.ville, p.etape_pipeline, com.prenom
         FROM reminders r JOIN prospects p ON p.id = r.prospect_id LEFT JOIN commerciaux com ON com.id = r.commercial_id
        WHERE r.statut = 'actif' AND r.date <= $1 ${qui ? 'AND r.commercial_id = $2' : ''}
        ORDER BY r.date, r.heure`, params)).rows;
    const taches = (await db.query(
      `SELECT t.*, c.nom AS nom_client, c.ville, com.prenom
         FROM tasks_client t LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN commerciaux com ON com.id = t.commercial_id
        WHERE t.statut <> 'TERMINEE' AND (t.date_echeance IS NULL OR t.date_echeance <= $1) ${qui ? 'AND t.commercial_id = $2' : ''}
        ORDER BY t.date_echeance NULLS LAST`, params)).rows;
    const quand = (date) => (date < aujourdhui ? `en retard (${dateFr(date)})` : dateFr(date));
    return {
      resultats: rappels.length + taches.length,
      texte: bloc(
        `# Actions sur les prospects — ${rappels.length}`,
        rappels.map(x => {
          const type = x.type || 'appeler';
          return ligne(`réf. ${x.id}`, TYPES_ACTION[type] || type, quand(x.date), x.heure || '',
            nommer(x.nom_etablissement, x.ville), `en « ${LIBELLES_ETAPE[x.etape_pipeline] || x.etape_pipeline} »`,
            qui === utilisateur.id ? '' : `pour ${x.prenom || '?'}`, extrait(x.message, 120),
            `issues : ${issuesPourAction(type).map(i => i.value).join(', ')}`);
        }).join('\n') || 'Aucune action.',
        '',
        `# Tâches clients — ${taches.length}`,
        taches.map(x => ligne(`réf. ${x.id}`, x.titre, x.date_echeance ? quand(x.date_echeance) : 'sans échéance',
          x.nom_client ? nommer(x.nom_client, x.ville) : '', qui === utilisateur.id ? '' : `pour ${x.prenom || '?'}`, extrait(x.description, 120)))
          .join('\n') || 'Aucune tâche.',
        '',
        '« Appeler » se termine d\'ordinaire en enregistrant l\'appel dans SuiviPro ; ici, « fait » ou « pas_interesse ».',
      ),
    };
  },
};

// ---------------------------------------------------------------------------------------
const terminer = {
  nom: 'terminer_action',
  titre: 'Terminer une action du tunnel',
  ecrit: true,
  description: 'Clôt une action sur un prospect (réf. donnée par « mes_actions ») en disant ce qui s\'est passé. L\'étape du prospect et la prochaine action suivent les règles du tunnel (voir « contexte », sujet appels). Toujours en deux temps : d\'abord sans « confirmer », puis confirmer: true après accord.',
  schema: {
    action: z.string().describe('La référence de l\'action (réf. …).'),
    issue: z.string().describe('Ce qui s\'est passé : une des issues listées par « mes_actions » pour cette action.'),
    raison_perte: z.enum(Object.keys(RAISONS_PERTE)).optional().describe('Si l\'issue est une perte (pas_interesse, reponse_negative).'),
    note: z.string().optional().describe('Une précision, gardée sur l\'action.'),
    confirmer: CONFIRMER,
  },
  executer: async (a, { utilisateur }) => {
    const r = (await db.query(
      `SELECT r.*, p.nom_etablissement, p.ville, p.etape_pipeline FROM reminders r JOIN prospects p ON p.id = r.prospect_id WHERE r.id = $1`,
      [a.action])).rows[0];
    if (!r) throw new CompteRenduRefuse('Action introuvable. Les références sont données par « mes_actions ».');
    verifierProprietaire(utilisateur, r.commercial_id, 'Cette action');
    if (r.statut !== 'actif') throw new CompteRenduRefuse('Cette action est déjà close.');
    const type = r.type || 'appeler';
    const possibles = issuesPourAction(type);
    const issue = possibles.find(i => i.value === a.issue);
    if (!issue) throw new CompteRenduRefuse(`Issue inconnue pour « ${TYPES_ACTION[type] || type} ». Possibles : ${possibles.map(i => `${i.value} (${i.label})`).join(', ')}.`);
    const perte = issueEstUnePerte(a.issue);
    const raison = perte ? (a.raison_perte || 'pas_interesse') : '';
    const effet = appliquerIssue(type, a.issue, r.etape_pipeline);
    const resume = [
      `${TYPES_ACTION[type] || type} — ${r.nom_etablissement}${r.ville ? ` (${r.ville})` : ''}, prévue le ${dateFr(r.date, { relatif: false })}`,
      `Issue : ${issue.label} — ${issue.effet}`,
      effet.etape ? `Le prospect passe de « ${LIBELLES_ETAPE[r.etape_pipeline]} » à « ${LIBELLES_ETAPE[effet.etape]} »${raison ? `, raison : ${RAISONS_PERTE[raison]}` : ''}.` : `Le prospect reste en « ${LIBELLES_ETAPE[r.etape_pipeline]} ».`,
      effet.prochaine ? `Prochaine action : « ${TYPES_ACTION[effet.prochaine.type]} » dans ${effet.prochaine.delaiJours} jours — ${effet.prochaine.message}` : 'Pas de nouvelle action.',
      a.note ? `Note : ${a.note}` : '',
    ].filter(Boolean);
    if (!a.confirmer) return { resultats: 0, texte: deuxTemps(resume) };
    const fait = await terminerAction(r.prospect_id, { rappelId: r.id, type, issue: a.issue, raison, note: a.note || '', commercialId: r.commercial_id }, utilisateur.id);
    if (!fait || fait.erreur) throw new CompteRenduRefuse(fait?.erreur || 'Action introuvable.');
    await logActivity(utilisateur.id, 'action_terminee', `${r.nom_etablissement} : ${TYPES_ACTION[type]} → ${issue.label} (via IA)`, 'prospect', r.prospect_id);
    return { resultats: 1, texte: bloc('Action terminée dans SuiviPro :', ...resume.map(l => `- ${l}`)) };
  },
};

// ---------------------------------------------------------------------------------------
const terminerTache = {
  nom: 'terminer_tache',
  titre: 'Clore une tâche client',
  ecrit: true,
  description: 'Marque une tâche client comme faite (réf. donnée par « mes_actions »), avec une note si besoin. Toujours en deux temps : d\'abord sans « confirmer », puis confirmer: true après accord.',
  schema: {
    tache: z.string().describe('La référence de la tâche (réf. …).'),
    note: z.string().optional().describe('Ce qui a été fait.'),
    confirmer: CONFIRMER,
  },
  executer: async (a, { utilisateur }) => {
    const t = (await db.query('SELECT t.*, c.nom AS nom_client FROM tasks_client t LEFT JOIN clients c ON c.id = t.client_id WHERE t.id = $1', [a.tache])).rows[0];
    if (!t) throw new CompteRenduRefuse('Tâche introuvable. Les références sont données par « mes_actions ».');
    verifierProprietaire(utilisateur, t.commercial_id, 'Cette tâche');
    if (t.statut === 'TERMINEE') throw new CompteRenduRefuse('Cette tâche est déjà terminée.');
    const resume = [`Tâche « ${t.titre} »${t.nom_client ? ` — ${t.nom_client}` : ''} : terminée`, a.note ? `Note : ${a.note}` : ''].filter(Boolean);
    if (!a.confirmer) return { resultats: 0, texte: deuxTemps(resume) };
    const description = a.note ? `${t.description ? `${t.description}\n` : ''}[Fait] ${a.note}` : t.description;
    await db.query("UPDATE tasks_client SET statut = 'TERMINEE', completed_at = $1, description = $2 WHERE id = $3", [new Date().toISOString(), description, t.id]);
    await logActivity(utilisateur.id, 'tache_terminee', `${t.titre}${t.nom_client ? ` (${t.nom_client})` : ''} (via IA)`, 'task', t.id);
    return { resultats: 1, texte: bloc('Tâche terminée dans SuiviPro :', ...resume.map(l => `- ${l}`)) };
  },
};

// ---------------------------------------------------------------------------------------
const mail = {
  nom: 'proposer_mail',
  titre: 'Préparer un mail à partir des modèles',
  description: 'Remplit les modèles de mail de SuiviPro pour le prospect d\'un rendez-vous (ou un prospect donné) : objet et texte prêts à copier. N\'envoie rien — la personne l\'envoie elle-même.',
  schema: {
    rendez_vous: z.string().optional().describe('La référence du rendez-vous (réf. …).'),
    prospect: z.string().optional().describe('Ou la référence du prospect.'),
    modele: z.string().optional().describe('Le nom (ou un morceau du nom) du modèle voulu ; sans lui, la liste des modèles.'),
  },
  executer: async (a, { utilisateur }) => {
    let prospectId = a.prospect;
    let rdv = null;
    if (a.rendez_vous) {
      rdv = (await db.query('SELECT prospect_id, commercial_id, date, heure_debut, statut FROM appointments WHERE id = $1', [a.rendez_vous])).rows[0];
      if (!rdv) throw new CompteRenduRefuse('Rendez-vous introuvable.');
      verifierProprietaire(utilisateur, rdv.commercial_id, 'Ce rendez-vous');
      prospectId = rdv.prospect_id;
    }
    if (!prospectId) throw new CompteRenduRefuse('Donnez un rendez-vous chez un prospect, ou la référence d\'un prospect.');
    const p = (await db.query('SELECT id, nom_etablissement, nom_contact, commercial_id FROM prospects WHERE id = $1', [prospectId])).rows[0];
    if (!p) throw new CompteRenduRefuse('Prospect introuvable.');

    let modeles = (await db.query('SELECT nom, sujet, corps FROM email_templates ORDER BY nom')).rows;
    if (a.modele) modeles = modeles.filter(m => m.nom.toLowerCase().includes(String(a.modele).toLowerCase()));
    if (!modeles.length) return { resultats: 0, texte: 'Aucun modèle ne correspond. Les modèles se gèrent dans SuiviPro (page Emails).' };
    // Sans modèle précis, la liste des noms suffit : dix mails entiers noieraient la réponse.
    if (!a.modele || modeles.length > 3) {
      return {
        resultats: modeles.length,
        texte: bloc(
          `Modèles de mail pour ${p.nom_etablissement} — ${modeles.length}`,
          ...modeles.map(m => `- ${m.nom} — objet : ${m.sujet}`),
          'Rappelez « proposer_mail » avec « modele » (le nom ou un morceau du nom) pour obtenir le texte rempli.',
        ),
      };
    }

    // {{date_rdv}} : le rendez-vous donné s'il est à venir, sinon le prochain rendez-vous prévu du prospect.
    const aujourdhui = dateLocale(new Date());
    if (!rdv || rdvAnnule(rdv) || rdv.date < aujourdhui) {
      rdv = (await db.query(
        `SELECT date, heure_debut, statut FROM appointments
          WHERE prospect_id = $1 AND statut = 'planifie' AND date >= $2 ORDER BY date, heure_debut LIMIT 1`,
        [prospectId, aujourdhui]
      )).rows[0] || null;
    }
    const dateRdv = rdv ? dateEnToutesLettres(rdv.date, rdv.heure_debut) : '';
    const moi = (await db.query('SELECT prenom, nom, telephone FROM commerciaux WHERE id = $1', [utilisateur.id])).rows[0] || {};
    const remplir = (t) => String(t || '')
      .replace(/\{\{nom_contact\}\}/g, p.nom_contact || 'Madame, Monsieur')
      .replace(/\{\{nom_etablissement\}\}/g, p.nom_etablissement || '')
      .replace(/\{\{commercial\}\}/g, `${moi.prenom || ''} ${moi.nom || ''}`.trim())
      .replace(/\{\{telephone_commercial\}\}/g, moi.telephone || '')
      .replace(/\{\{date_rdv\}\}/g, dateRdv);
    return {
      resultats: modeles.length,
      texte: bloc(
        `Mail prêt pour ${p.nom_etablissement} — rien n'est envoyé :`,
        ...modeles.map(m => bloc('', `## ${m.nom}`, `Objet : ${remplir(m.sujet)}`, '', remplir(m.corps))),
        /\{\{date_rdv\}\}/.test(modeles.map(m => m.corps).join('')) && !dateRdv ? '\nAucun rendez-vous à venir : la date du rendez-vous est restée vide, à compléter.' : '',
      ),
    };
  },
};

const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** « Mardi 18 février 2026 a 10h30 », comme l'exemple de la page Emails. */
function dateEnToutesLettres(iso, heure) {
  const [an, mo, jo] = String(iso).slice(0, 10).split('-').map(Number);
  const d = new Date(an, mo - 1, jo);
  const h = heure ? ` a ${String(heure).replace(':', 'h')}` : '';
  return `${JOURS[d.getDay()]} ${jo} ${MOIS[mo - 1]} ${an}${h}`;
}

export default [aFaire, ecrire, actions, terminer, terminerTache, mail];
