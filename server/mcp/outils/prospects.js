// Prospects, pipeline et boîte de prospection. Les étapes et les délais viennent de
// shared/tunnel.js : ce que dit le MCP est ce que fait le logiciel.
import { z } from 'zod';
import db from '../../db.js';
import { dateLocale } from '../../../shared/regles.js';
import { normaliserPourComparaison } from '../../../shared/normalisation.js';
import {
  LIBELLES_ETAPE, LIBELLES_RESULTAT_APPEL, LIBELLES_STATUT_RDV, LIBELLES_RESULTAT_RDV,
  LIBELLES_SOURCE_SIGNALEMENT, LIBELLES_STATUT_SIGNALEMENT,
} from '../../../shared/libelles.js';
import {
  ETAPES_TERMINALES, RAISONS_PERTE, TYPES_ACTION, SEUIL_STAGNATION_JOURS,
  prochaineActionDe, joursDansEtape,
} from '../../../shared/tunnel.js';
import { perimetre, clause, HorsPerimetre, equipe } from '../perimetre.js';
import { clauseTexte, sansAccentsSql } from '../sql.js';
import { journaliserContact } from '../journal.js';
import {
  LIMITE_DEFAUT, LIMITE_MAX, MOIS_DEFAUT, MOIS_MAX, borner, dateFr, ilYaDesMois,
  ligne, bloc, entete, extrait, lib, nommer, nombreDeJours, identiteLegale,
} from '../format.js';

async function prenomsEquipe() {
  return new Map((await equipe()).map(g => [g.id, g.prenom]));
}

/** Les étapes réelles : celles du tunnel plus celles que l'administration a ajoutées. */
async function libellesEtapes() {
  const table = { ...LIBELLES_ETAPE };
  try {
    const r = await db.query('SELECT id, label FROM pipeline_columns');
    for (const c of r.rows) if (c.label) table[c.id] = c.label;
  } catch { /* les étapes du tunnel suffisent */ }
  return table;
}

// Les colonnes qu'une liste affiche. Les notes et l'adresse ne servent qu'à la fiche :
// à quatre mille prospects, les transporter à chaque recherche coûte cher pour rien.
const CHAMPS_LISTE = `id, nom_etablissement, ville, code_postal, secteur, etape_pipeline, score,
  commercial_id, telephone, email, date_etape, date_modification, date_creation`;


/**
 * Les prospects du périmètre, filtrés par la base. Tout ce qui peut se dire en SQL s'y dit :
 * ce qui ne remonte pas ne traverse pas le réseau.
 */
async function chargerProspects(utilisateur, demandeCommercial, outil, f = {}) {
  const { ids } = await perimetre(utilisateur, demandeCommercial, 'prospects', outil);
  const params = [];
  let sql = `SELECT ${f.colonnes || CHAMPS_LISTE} FROM prospects WHERE 1=1${clause('commercial_id', ids, params)}`;
  sql += clauseTexte(['nom_etablissement', 'ville'], f.texte, params);
  sql += clauseTexte(['ville', 'code_postal'], f.ville, params);
  sql += clauseTexte(['secteur'], f.secteur, params);
  if (f.etape) {
    const codes = codesDEtape(f.etape, f.etapes || LIBELLES_ETAPE);
    params.push(codes);
    sql += ` AND etape_pipeline = ANY($${params.length})`;
  }
  if (f.scoreMin != null) { params.push(f.scoreMin); sql += ` AND COALESCE(score, 50) >= $${params.length}`; }
  if (f.actifs) { params.push(ETAPES_TERMINALES); sql += ` AND NOT (etape_pipeline = ANY($${params.length}))`; }
  const r = await db.query(`${sql} ORDER BY nom_etablissement`, params);
  return r.rows;
}

/** « négociation », « Negociation », « negociation » : les codes d'étape qui répondent. */
function codesDEtape(recherche, etapes) {
  const q = normaliserPourComparaison(recherche);
  const codes = Object.keys(etapes).filter(c => normaliserPourComparaison(c) === q || normaliserPourComparaison(etapes[c]).includes(q));
  return codes.length ? codes : [recherche];
}

/**
 * Ce qui est en attente : rappels actifs et rendez-vous à venir. Deux ensembles petits par
 * nature — inutile de les demander prospect par prospect.
 */
async function actionsEnCours() {
  const aujourdhui = dateLocale();
  const [rappels, rdvs] = await Promise.all([
    db.query("SELECT * FROM reminders WHERE statut = 'actif'"),
    db.query('SELECT * FROM appointments WHERE date >= $1', [aujourdhui]),
  ]);
  return { rappels: rappels.rows, rdvs: rdvs.rows };
}


/** La dernière activité de chaque fiche affichée, en une requête groupée. */
async function dernieresActivites(ids) {
  if (ids.length === 0) return new Map();
  const r = await db.query(
    `SELECT prospect_id, MAX(jour) AS jour FROM (
       SELECT prospect_id, left(date, 10) AS jour FROM calls WHERE prospect_id = ANY($1)
       UNION ALL
       SELECT prospect_id, left(date, 10) AS jour FROM appointments
        WHERE prospect_id = ANY($1) AND statut <> 'annule' AND left(date, 10) <= $2
     ) t GROUP BY prospect_id`,
    [ids, dateLocale()]
  );
  return new Map(r.rows.map(x => [x.prospect_id, x.jour]));
}

function lireTags(valeur) {
  if (Array.isArray(valeur)) return valeur;
  try { const t = JSON.parse(valeur || '[]'); return Array.isArray(t) ? t : []; } catch { return []; }
}

/** Ce qui attend sur la fiche : le rappel le plus proche, ou le prochain rendez-vous. */
function texteProchaineAction(prospect, rappels, rdvs) {
  const p = prochaineActionDe(prospect, rappels, rdvs, dateLocale());
  if (!p) return 'aucune action prévue';
  const quoi = p.genre === 'rdv' ? 'rendez-vous' : (TYPES_ACTION[p.type] || 'à faire').toLowerCase();
  return `${quoi} ${dateFr(p.date)}${p.enRetard ? ' — EN RETARD' : ''}`;
}


function resumeProspect(p, { etapes, prenoms, rappels, rdvs, activites }) {
  const derniere = activites ? activites.get(p.id) : null;
  const sans = derniere ? nombreDeJours(derniere) : null;
  return ligne(
    nommer(p.nom_etablissement, p.ville),
    lib(etapes, p.etape_pipeline),
    p.secteur ? `secteur ${p.secteur}` : '',
    `score ${p.score ?? 50}`,
    texteProchaineAction(p, rappels, rdvs),
    sans === null ? 'jamais contacté' : `dernière activité il y a ${sans} j`,
    prenoms.get(p.commercial_id) || '',
  );
}

/** Le contexte des seules lignes affichées : rappels, rendez-vous et dernière activité. */
async function contexteDeLaPage(page, etapes, prenoms, enCours) {
  const actions = enCours || (await actionsEnCours());
  const activites = await dernieresActivites(page.map(p => p.id));
  return { etapes, prenoms, rappels: actions.rappels, rdvs: actions.rdvs, activites };
}

const chercherProspect = {
  nom: 'chercher_prospect',
  titre: 'Chercher un prospect',
  description: 'Retrouver des prospects par nom, ville, secteur, étape du tunnel, score ou étiquettes. Renvoie l\'étape, la prochaine action prévue et la dernière activité.',
  schema: {
    nom: z.string().optional().describe('Recherche partielle sur le nom ou la ville.'),
    ville: z.string().optional(),
    secteur: z.string().optional().describe('Le nom de la zone qui contient la fiche.'),
    etape: z.string().optional().describe('Une étape du tunnel : nouveau, a_contacter, contacte, proposition, negociation, gagne, client_gagne, perdu…'),
    score_min: z.number().optional().describe('Score minimum, de 0 à 100.'),
    a_faire: z.boolean().optional().describe('Ne garder que ceux dont l\'action est due aujourd\'hui ou en retard.'),
    commercial: z.string().optional().describe('Le prénom d\'un collègue ; sinon, les vôtres.'),
    limite: z.number().optional().describe(`Nombre de résultats, ${LIMITE_DEFAUT} par défaut, ${LIMITE_MAX} au maximum.`),
  },
  executer: async (a, { utilisateur }) => {
    const etapes = await libellesEtapes();
    let lignes = await chargerProspects(utilisateur, a.commercial, 'chercher_prospect', {
      texte: a.nom, ville: a.ville, secteur: a.secteur, etape: a.etape, etapes, scoreMin: a.score_min,
    });
    let enCours = null;
    if (a.a_faire) {
      enCours = await actionsEnCours();
      const aujourdhui = dateLocale();
      lignes = lignes.filter(p => {
        const pa = prochaineActionDe(p, enCours.rappels, enCours.rdvs, aujourdhui);
        return pa && pa.date <= aujourdhui;
      });
    }
    const limite = borner(a.limite, LIMITE_DEFAUT, LIMITE_MAX);
    const page = lignes.slice(0, limite);
    const ctx = await contexteDeLaPage(page, etapes, await prenomsEquipe(), enCours);
    const titre = ligne('Prospects', a.nom, a.ville, a.secteur, a.etape, a.a_faire ? 'à faire' : '', a.commercial);
    return {
      resultats: lignes.length,
      texte: bloc(entete(titre, page.length, lignes.length), '', page.map(p => resumeProspect(p, ctx)).join('\n')),
    };
  },
};

const ficheProspect = {
  nom: 'fiche_prospect',
  titre: 'La fiche et l\'histoire d\'un prospect',
  description: 'Tout ce qui s\'est passé avec un prospect : étape actuelle et depuis quand, score, étiquettes, identité légale (raison sociale, SIRET, numéro de TVA) quand elle est connue, prochaine action, puis la frise — appels et leur résultat, mails envoyés, rendez-vous et comptes rendus, raison de perte.',
  schema: {
    prospect: z.string().describe('Le nom du prospect (ou son identifiant).'),
    commercial: z.string().optional().describe('Le prénom du commercial qui suit ce prospect, quand ce n\'est pas vous.'),
    historique_mois: z.number().optional().describe(`Profondeur d'historique en mois, ${MOIS_DEFAUT} par défaut, ${MOIS_MAX} au maximum.`),
  },
  executer: async (a, { utilisateur }) => {
    // La fiche a besoin de tout (notes, adresse, étiquettes) — mais d'une seule fiche :
    // la recherche du nom se fait en base, pas en parcourant quatre mille lignes ici.
    const tous = await chargerProspects(utilisateur, a.commercial, 'fiche_prospect', { colonnes: '*', texte: a.prospect });
    const q = normaliserPourComparaison(a.prospect);
    let candidats = tous.filter(p => p.id === a.prospect || normaliserPourComparaison(p.nom_etablissement) === q);
    if (candidats.length === 0) candidats = tous.filter(p => normaliserPourComparaison(p.nom_etablissement).includes(q));
    const etapes = await libellesEtapes();
    if (candidats.length === 0) {
      const ailleurs = await db.query(`SELECT COUNT(*)::int AS n FROM prospects WHERE ${sansAccentsSql('nom_etablissement')} LIKE $1`, [`%${normaliserPourComparaison(a.prospect)}%`]);
      if (ailleurs.rows[0]?.n > 0) throw new HorsPerimetre(`« ${a.prospect} » existe mais n'est pas dans votre périmètre. Nommez le commercial qui le suit pour y accéder.`);
      throw new HorsPerimetre(`Aucun prospect ne correspond à « ${a.prospect} ».`);
    }
    if (candidats.length > 1) {
      const page = candidats.slice(0, 10);
      const ctx = await contexteDeLaPage(page, etapes, await prenomsEquipe());
      return { resultats: candidats.length, texte: bloc(`Plusieurs prospects correspondent à « ${a.prospect} » — précisez :`, '', page.map(p => resumeProspect(p, ctx)).join('\n')) };
    }

    const p = candidats[0];
    const mois = borner(a.historique_mois, MOIS_DEFAUT, MOIS_MAX);
    const depuis = ilYaDesMois(mois);
    const [appels, rdvs, rappels, tags, prenoms] = await Promise.all([
      db.query('SELECT * FROM calls WHERE prospect_id = $1 AND date >= $2 ORDER BY date DESC', [p.id, depuis]),
      db.query('SELECT * FROM appointments WHERE prospect_id = $1 ORDER BY date DESC', [p.id]),
      db.query("SELECT * FROM reminders WHERE prospect_id = $1 AND statut = 'actif' ORDER BY date", [p.id]),
      db.query('SELECT id, nom FROM tags'),
      prenomsEquipe(),
    ]);
    if (p.telephone || p.email) await journaliserContact(utilisateur, nommer(p.nom_etablissement, p.ville), 'fiche_prospect');

    const nomsTags = new Map(tags.rows.map(t => [t.id, t.nom]));
    const mesTags = lireTags(p.tags).map(id => nomsTags.get(id) || id);
    const frise = [
      ...appels.rows.map(c => ({ date: c.date, texte: ligne(dateFr(c.date), c.resultat === 'email_envoye' ? 'Mail envoyé' : `Appel — ${lib(LIBELLES_RESULTAT_APPEL, c.resultat)}`, prenoms.get(c.commercial_id) || '', extrait(c.notes)) })),
      ...rdvs.rows.filter(r => r.date >= depuis).map(r => ({
        date: r.date,
        texte: ligne(dateFr(r.date), `Rendez-vous ${lib(LIBELLES_STATUT_RDV, r.statut).toLowerCase()}`, r.heure_debut, prenoms.get(r.commercial_id) || '',
          r.prospecteur_id && r.prospecteur_id !== r.commercial_id ? `pris par ${prenoms.get(r.prospecteur_id) || '?'}` : '',
          r.compte_rendu ? `compte rendu : ${lib(LIBELLES_RESULTAT_RDV, r.compte_rendu)}` : (new Date(`${r.date}T23:59`) < new Date() && r.statut !== 'annule' ? 'SANS compte rendu' : ''),
          extrait(r.notes_compte_rendu || r.notes, 200)),
      })),
    ].sort((x, y) => String(y.date).localeCompare(String(x.date)));

    return {
      resultats: 1,
      texte: bloc(
        `# ${nommer(p.nom_etablissement, p.ville)}`,
        ligne(
          lib(etapes, p.etape_pipeline),
          `depuis ${joursDansEtape(p)} j`,
          `score ${p.score ?? 50}`,
          mesTags.length ? `étiquettes : ${mesTags.join(', ')}` : '',
          prenoms.get(p.commercial_id) || 'sans commercial',
        ),
        ligne(p.adresse, p.code_postal, p.ville, p.secteur ? `secteur ${p.secteur}` : ''),
        ligne(p.nom_contact && `contact ${p.nom_contact}`, p.telephone, p.email),
        ligne('Identité légale', identiteLegale(p) || 'non renseignée'),
        p.raison_perte ? `Raison de perte : ${lib(RAISONS_PERTE, p.raison_perte)}` : '',
        p.source_url ? `Origine : ${extrait(p.source_url, 120)}` : '',
        ligne('Prochaine action', texteProchaineAction(p, rappels.rows, rdvs.rows)),
        rappels.rows.length > 1 ? `Autres rappels : ${rappels.rows.slice(1).map(r => `${TYPES_ACTION[r.type] || 'à faire'} ${dateFr(r.date)}`).join(', ')}` : '',
        p.notes ? `Notes : ${extrait(p.notes, 400)}` : '',
        '',
        `## Ce qui s'est passé, et ce qui vient (${mois} mois) — ${frise.length} événement(s)`,
        frise.length ? frise.map(e => e.texte).join('\n') : 'Rien sur la période.',
      ),
    };
  },
};

const pipeline = {
  nom: 'pipeline',
  titre: 'L\'état du tunnel de vente',
  description: 'Combien de prospects à chaque étape et leur ancienneté moyenne. Précisez une étape pour voir les fiches qui y dorment le plus. Aucun montant.',
  schema: {
    commercial: z.string().optional().describe('Le prénom d\'un collègue ; sinon, les vôtres (toute l\'équipe pour un administrateur).'),
    secteur: z.string().optional().describe('Pour lire une zone en particulier.'),
    etape: z.string().optional().describe('Pour détailler une seule étape : les plus anciennes fiches y sont nommées.'),
  },
  executer: async (a, { utilisateur }) => {
    const etapes = await libellesEtapes();
    // Seulement de quoi compter et dater : à quatre mille prospects, le reste ne sert à rien.
    const lignes = await chargerProspects(utilisateur, a.commercial, 'pipeline', {
      colonnes: 'id, nom_etablissement, ville, commercial_id, etape_pipeline, date_etape, date_modification, date_creation',
      secteur: a.secteur, etape: a.etape, etapes,
    });
    const prenoms = await prenomsEquipe();
    const parEtape = new Map();
    for (const p of lignes) {
      const cle = p.etape_pipeline || 'nouveau';
      if (!parEtape.has(cle)) parEtape.set(cle, []);
      parEtape.get(cle).push(p);
    }
    const ordre = Object.keys(etapes);
    const rangs = [...parEtape.entries()].sort((x, y) => ordre.indexOf(x[0]) - ordre.indexOf(y[0]));

    // Une ligne par étape suffit pour voir le tunnel. Les fiches ne sont nommées que
    // lorsqu'une étape est demandée : sinon la réponse fait trois écrans pour rien.
    const detail = !!a.etape;
    const corps = rangs.map(([cle, gens]) => {
      const moyenne = Math.round(gens.reduce((t, p) => t + joursDansEtape(p), 0) / gens.length);
      const tete = `${lib(etapes, cle)} — ${gens.length} · ${moyenne} j en moyenne dans l'étape`;
      if (!detail) return tete;
      const anciens = [...gens].sort((x, y) => joursDansEtape(y) - joursDansEtape(x)).slice(0, 10);
      return bloc(`**${tete}**`, anciens.map(p => `  ${ligne(nommer(p.nom_etablissement, p.ville), `${joursDansEtape(p)} j`, prenoms.get(p.commercial_id) || '')}`).join('\n'));
    });

    // Le total et les actions en retard portent sur tout le tunnel : les afficher sous une
    // étape isolée laisserait croire qu'ils la concernent.
    const resume = detail ? '' : ligne(
      `${lignes.length} prospect(s)`,
      `${lignes.filter(p => !ETAPES_TERMINALES.includes(p.etape_pipeline)).length} encore en course`,
      `${await actionsEnRetard(utilisateur, a.commercial)} action(s) en retard`,
    );
    return {
      resultats: lignes.length,
      texte: bloc(
        entete(ligne('Pipeline', a.commercial, a.secteur, a.etape), lignes.length, lignes.length),
        '',
        corps.join(detail ? '\n\n' : '\n'),
        '',
        resume,
        detail ? '' : 'Pour voir les fiches d\'une étape, rappelez cet outil avec « etape ».',
      ),
    };
  },
};

/**
 * Les prospects dont l'action est dépassée. Un rappel actif en retard l'emporte toujours
 * sur un rendez-vous à venir (il est forcément plus ancien) : le compte se fait donc en
 * base, sans parcourir les fiches.
 */
async function actionsEnRetard(utilisateur, demandeCommercial) {
  // Le périmètre est déjà résolu par le chargement des fiches : pas de seconde trace.
  const { ids } = await perimetre(utilisateur, demandeCommercial, 'prospects', 'pipeline', { journaliser: false });
  const params = [dateLocale()];
  const sql = `SELECT COUNT(DISTINCT r.prospect_id)::int AS n
                 FROM reminders r JOIN prospects p ON p.id = r.prospect_id
                WHERE r.statut = 'actif' AND r.date < $1${clause('p.commercial_id', ids, params)}`;
  const r = await db.query(sql, params);
  return r.rows[0]?.n || 0;
}

const prospectsQuiStagnent = {
  nom: 'prospects_qui_stagnent',
  titre: 'Les prospects qui dorment',
  description: `Les fiches sur lesquelles il ne s'est rien passé depuis trop longtemps (${SEUIL_STAGNATION_JOURS} jours par défaut). Les étapes terminales (gagné, perdu, ne pas contacter) sont exclues.`,
  schema: {
    jours: z.number().optional().describe(`Seuil en jours sans activité, ${SEUIL_STAGNATION_JOURS} par défaut.`),
    etape: z.string().optional(),
    secteur: z.string().optional(),
    commercial: z.string().optional().describe('Le prénom d\'un collègue ; sinon, les vôtres.'),
    limite: z.number().optional().describe(`Nombre de résultats, ${LIMITE_DEFAUT} par défaut, ${LIMITE_MAX} au maximum.`),
  },
  executer: async (a, { utilisateur }) => {
    const etapes = await libellesEtapes();
    const lignes = await chargerProspects(utilisateur, a.commercial, 'prospects_qui_stagnent', {
      secteur: a.secteur, etape: a.etape, etapes, actifs: true,
    });
    // La dernière activité de tout le monde en une requête groupée : la calculer fiche par
    // fiche demanderait de rapatrier tous les appels et tous les rendez-vous.
    const activites = await dernieresActivites(lignes.map(p => p.id));
    const seuil = borner(a.jours, SEUIL_STAGNATION_JOURS, 3650);
    const aujourdhui = dateLocale();
    const dormants = lignes.map(p => {
      const derniere = activites.get(p.id) || null;
      const sans = derniere ? nombreDeJours(derniere, aujourdhui) : nombreDeJours(p.date_creation, aujourdhui);
      return { p, derniere, sans };
    }).filter(d => d.sans !== null && d.sans >= seuil)
      .sort((x, y) => y.sans - x.sans);

    const limite = borner(a.limite, LIMITE_DEFAUT, LIMITE_MAX);
    const page = dormants.slice(0, limite);
    const [prenoms, enCours] = await Promise.all([prenomsEquipe(), actionsEnCours()]);
    return {
      resultats: dormants.length,
      texte: bloc(
        entete(ligne(`Prospects sans activité depuis ${seuil} j ou plus`, a.etape, a.secteur, a.commercial), page.length, dormants.length),
        '',
        page.map(({ p, derniere, sans }) => ligne(
          nommer(p.nom_etablissement, p.ville),
          lib(etapes, p.etape_pipeline),
          `${sans} j sans activité`,
          `${joursDansEtape(p)} j dans l'étape`,
          derniere ? `dernière fois le ${dateFr(derniere)}` : 'jamais contacté',
          texteProchaineAction(p, enCours.rappels, enCours.rdvs),
          prenoms.get(p.commercial_id) || '',
        )).join('\n'),
      ),
    };
  },
};

/** La fiche d'un signalement est rangée en JSON : une fiche illisible ne doit rien casser. */
function lireFiche(valeur) {
  if (valeur && typeof valeur === 'object') return valeur;
  try { return JSON.parse(valeur || '{}') || {}; } catch { return {}; }
}

const boiteProspection = {
  nom: 'boite_prospection',
  titre: 'La boîte de prospection',
  description: 'Ce que l\'équipe a partagé depuis son téléphone, et ce que vous y avez déposé, qui attend d\'être qualifié : lien Google Maps, Instagram, article, photo. L\'identité légale est indiquée quand elle est connue — c\'est ainsi qu\'on voit ce qu\'il reste à chercher. Les photos ne sont pas transmises, seul leur nombre est indiqué.',
  schema: {
    statut: z.enum(['a_qualifier', 'qualifie', 'ecarte']).optional().describe('« a_qualifier » par défaut.'),
    pour: z.string().optional().describe('Le prénom du commercial destinataire.'),
    depuis_jours: z.number().optional().describe('Fenêtre en jours, 30 par défaut.'),
    limite: z.number().optional().describe(`Nombre de résultats, ${LIMITE_DEFAUT} par défaut, ${LIMITE_MAX} au maximum.`),
  },
  executer: async (a, { utilisateur }) => {
    const statut = a.statut || 'a_qualifier';
    const jours = borner(a.depuis_jours, 30, 3650);
    const depuis = dateLocale(new Date(Date.now() - jours * 86400000));
    const params = [statut, depuis];
    let sql = `SELECT s.*, (SELECT COUNT(*)::int FROM signalement_photos p WHERE p.signalement_id = s.id) AS photos
                 FROM signalements s WHERE s.statut = $1 AND s.created_at >= $2`;
    // Un commercial voit ce qui lui est destiné et ce qu'il a partagé ; l'admin et la
    // prospection voient toute la boîte, c'est leur outil de travail commun.
    const large = utilisateur.role === 'admin' || utilisateur.role === 'prospection';
    if (a.pour) {
      const { cible } = await perimetre(utilisateur, a.pour, 'prospects', 'boite_prospection');
      params.push(cible.id);
      sql += ` AND s.commercial_id = $${params.length}`;
    } else if (!large) {
      params.push(utilisateur.id);
      sql += ` AND (s.commercial_id = $${params.length} OR s.partage_par = $${params.length} OR s.commercial_id = '')`;
    }
    const r = await db.query(`${sql} ORDER BY s.created_at DESC`, params);
    const prenoms = await prenomsEquipe();
    const limite = borner(a.limite, LIMITE_DEFAUT, LIMITE_MAX);
    return {
      resultats: r.rows.length,
      texte: bloc(
        entete(ligne('Boîte de prospection', lib(LIBELLES_STATUT_SIGNALEMENT, statut), a.pour, `${jours} derniers jours`), Math.min(limite, r.rows.length), r.rows.length),
        '',
        r.rows.slice(0, limite).map(s => ligne(
          dateFr(s.created_at),
          lib(LIBELLES_SOURCE_SIGNALEMENT, s.source),
          s.titre || extrait(s.texte, 80) || 'sans titre',
          identiteLegale(lireFiche(s.fiche)),
          s.commentaire ? `« ${extrait(s.commentaire, 160)} »` : '',
          `partagé par ${prenoms.get(s.partage_par) || '?'}`,
          s.commercial_id ? `pour ${prenoms.get(s.commercial_id) || s.commercial_id}` : 'sans destinataire',
          s.photos ? `${s.photos} photo(s) — à ouvrir dans SuiviPro` : '',
          s.prospect_id ? 'déjà rattaché à un prospect' : '',
          s.client_id ? 'déjà rattaché à un client' : '',
        )).join('\n') || 'Rien dans la boîte sur cette période.',
      ),
    };
  },
};

export default [chercherProspect, ficheProspect, pipeline, prospectsQuiStagnent, boiteProspection];
