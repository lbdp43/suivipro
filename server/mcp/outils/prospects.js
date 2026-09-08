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
  prochaineActionDe, derniereActiviteDe, joursDansEtape, joursSansActivite,
} from '../../../shared/tunnel.js';
import { perimetre, clause, HorsPerimetre, equipe } from '../perimetre.js';
import { journaliserContact } from '../journal.js';
import {
  LIMITE_DEFAUT, LIMITE_MAX, MOIS_DEFAUT, MOIS_MAX, borner, dateFr, ilYaDesMois,
  ligne, bloc, entete, extrait, lib, nommer, nombreDeJours,
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

async function chargerProspects(utilisateur, demandeCommercial, outil) {
  const { ids } = await perimetre(utilisateur, demandeCommercial, 'prospects', outil);
  const params = [];
  const r = await db.query(`SELECT * FROM prospects WHERE 1=1${clause('commercial_id', ids, params)} ORDER BY nom_etablissement`, params);
  return r.rows;
}

function filtreTexte(lignes, recherche, champs) {
  const q = normaliserPourComparaison(recherche);
  if (!q) return lignes;
  return lignes.filter(l => champs.some(ch => normaliserPourComparaison(l[ch] || '').includes(q)));
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

async function contexteDesProspects(prospects) {
  if (prospects.length === 0) return { rappels: [], rdvs: [], appels: [] };
  const ids = prospects.map(p => p.id);
  const [rappels, rdvs, appels] = await Promise.all([
    db.query("SELECT * FROM reminders WHERE prospect_id = ANY($1) AND statut = 'actif'", [ids]),
    db.query('SELECT * FROM appointments WHERE prospect_id = ANY($1)', [ids]),
    db.query('SELECT * FROM calls WHERE prospect_id = ANY($1)', [ids]),
  ]);
  return { rappels: rappels.rows, rdvs: rdvs.rows, appels: appels.rows };
}

function resumeProspect(p, { etapes, prenoms, rappels, rdvs, appels }) {
  const derniere = derniereActiviteDe(p, appels, rdvs, dateLocale());
  const sans = joursSansActivite(derniere);
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
    let lignes = await chargerProspects(utilisateur, a.commercial, 'chercher_prospect');
    lignes = filtreTexte(lignes, a.nom, ['nom_etablissement', 'ville']);
    lignes = filtreTexte(lignes, a.ville, ['ville', 'code_postal']);
    lignes = filtreTexte(lignes, a.secteur, ['secteur']);
    const etapes = await libellesEtapes();
    if (a.etape) {
      const q = normaliserPourComparaison(a.etape);
      lignes = lignes.filter(p => normaliserPourComparaison(p.etape_pipeline) === q || normaliserPourComparaison(lib(etapes, p.etape_pipeline)).includes(q));
    }
    if (a.score_min != null) lignes = lignes.filter(p => (p.score ?? 50) >= a.score_min);

    const ctx = { etapes, prenoms: await prenomsEquipe(), ...(await contexteDesProspects(lignes)) };
    if (a.a_faire) {
      const aujourdhui = dateLocale();
      lignes = lignes.filter(p => {
        const pa = prochaineActionDe(p, ctx.rappels, ctx.rdvs, aujourdhui);
        return pa && pa.date <= aujourdhui;
      });
    }
    const limite = borner(a.limite, LIMITE_DEFAUT, LIMITE_MAX);
    const titre = ligne('Prospects', a.nom, a.ville, a.secteur, a.etape, a.a_faire ? 'à faire' : '', a.commercial);
    return {
      resultats: lignes.length,
      texte: bloc(entete(titre, Math.min(limite, lignes.length), lignes.length), '', lignes.slice(0, limite).map(p => resumeProspect(p, ctx)).join('\n')),
    };
  },
};

const ficheProspect = {
  nom: 'fiche_prospect',
  titre: 'La fiche et l\'histoire d\'un prospect',
  description: 'Tout ce qui s\'est passé avec un prospect : étape actuelle et depuis quand, score, étiquettes, prochaine action, puis la frise — appels et leur résultat, mails envoyés, rendez-vous et comptes rendus, raison de perte.',
  schema: {
    prospect: z.string().describe('Le nom du prospect (ou son identifiant).'),
    commercial: z.string().optional().describe('Le prénom du commercial qui suit ce prospect, quand ce n\'est pas vous.'),
    historique_mois: z.number().optional().describe(`Profondeur d'historique en mois, ${MOIS_DEFAUT} par défaut, ${MOIS_MAX} au maximum.`),
  },
  executer: async (a, { utilisateur }) => {
    const tous = await chargerProspects(utilisateur, a.commercial, 'fiche_prospect');
    const q = normaliserPourComparaison(a.prospect);
    let candidats = tous.filter(p => p.id === a.prospect || normaliserPourComparaison(p.nom_etablissement) === q);
    if (candidats.length === 0) candidats = tous.filter(p => normaliserPourComparaison(p.nom_etablissement).includes(q));
    const etapes = await libellesEtapes();
    if (candidats.length === 0) {
      const ailleurs = await db.query('SELECT COUNT(*)::int AS n FROM prospects WHERE lower(nom_etablissement) LIKE $1', [`%${String(a.prospect).toLowerCase()}%`]);
      if (ailleurs.rows[0]?.n > 0) throw new HorsPerimetre(`« ${a.prospect} » existe mais n'est pas dans votre périmètre. Nommez le commercial qui le suit pour y accéder.`);
      throw new HorsPerimetre(`Aucun prospect ne correspond à « ${a.prospect} ».`);
    }
    if (candidats.length > 1) {
      const ctx = { etapes, prenoms: await prenomsEquipe(), ...(await contexteDesProspects(candidats)) };
      return { resultats: candidats.length, texte: bloc(`Plusieurs prospects correspondent à « ${a.prospect} » — précisez :`, '', candidats.slice(0, 10).map(p => resumeProspect(p, ctx)).join('\n')) };
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
  description: 'Combien de prospects à chaque étape, leur ancienneté moyenne, les plus anciens nommés, et le nombre d\'actions en retard. Aucun montant.',
  schema: {
    commercial: z.string().optional().describe('Le prénom d\'un collègue ; sinon, les vôtres (toute l\'équipe pour un administrateur).'),
    secteur: z.string().optional().describe('Pour lire une zone en particulier.'),
    etape: z.string().optional().describe('Pour détailler une seule étape.'),
  },
  executer: async (a, { utilisateur }) => {
    let lignes = await chargerProspects(utilisateur, a.commercial, 'pipeline');
    lignes = filtreTexte(lignes, a.secteur, ['secteur']);
    const etapes = await libellesEtapes();
    if (a.etape) {
      const q = normaliserPourComparaison(a.etape);
      lignes = lignes.filter(p => normaliserPourComparaison(p.etape_pipeline) === q || normaliserPourComparaison(lib(etapes, p.etape_pipeline)).includes(q));
    }
    const ctx = { etapes, prenoms: await prenomsEquipe(), ...(await contexteDesProspects(lignes)) };
    const aujourdhui = dateLocale();
    const parEtape = new Map();
    let enRetard = 0;
    for (const p of lignes) {
      const cle = p.etape_pipeline || 'nouveau';
      if (!parEtape.has(cle)) parEtape.set(cle, []);
      parEtape.get(cle).push(p);
      const pa = prochaineActionDe(p, ctx.rappels, ctx.rdvs, aujourdhui);
      if (pa && pa.enRetard) enRetard++;
    }
    const ordre = Object.keys(etapes);
    const blocs = [...parEtape.entries()]
      .sort((x, y) => ordre.indexOf(x[0]) - ordre.indexOf(y[0]))
      .map(([cle, gens]) => {
        const moyenne = Math.round(gens.reduce((s, p) => s + joursDansEtape(p), 0) / gens.length);
        const anciens = [...gens].sort((x, y) => joursDansEtape(y) - joursDansEtape(x)).slice(0, 5);
        return bloc(
          `**${lib(etapes, cle)}** — ${gens.length} prospect(s), ${moyenne} j en moyenne dans l'étape`,
          anciens.map(p => `  ${ligne(nommer(p.nom_etablissement, p.ville), `${joursDansEtape(p)} j`, ctx.prenoms.get(p.commercial_id) || '')}`).join('\n'),
        );
      });
    const actifs = lignes.filter(p => !ETAPES_TERMINALES.includes(p.etape_pipeline)).length;
    return {
      resultats: lignes.length,
      texte: bloc(
        entete(ligne('Pipeline', a.commercial, a.secteur, a.etape), lignes.length, lignes.length),
        '',
        blocs.join('\n\n'),
        '',
        ligne(`${lignes.length} prospect(s) au total`, `${actifs} encore en course`, `${enRetard} action(s) en retard`),
      ),
    };
  },
};

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
    let lignes = (await chargerProspects(utilisateur, a.commercial, 'prospects_qui_stagnent'))
      .filter(p => !ETAPES_TERMINALES.includes(p.etape_pipeline));
    lignes = filtreTexte(lignes, a.secteur, ['secteur']);
    const etapes = await libellesEtapes();
    if (a.etape) {
      const q = normaliserPourComparaison(a.etape);
      lignes = lignes.filter(p => normaliserPourComparaison(p.etape_pipeline) === q || normaliserPourComparaison(lib(etapes, p.etape_pipeline)).includes(q));
    }
    const ctx = { etapes, prenoms: await prenomsEquipe(), ...(await contexteDesProspects(lignes)) };
    const seuil = borner(a.jours, SEUIL_STAGNATION_JOURS, 3650);
    const aujourdhui = dateLocale();
    const dormants = lignes.map(p => {
      const derniere = derniereActiviteDe(p, ctx.appels, ctx.rdvs, aujourdhui);
      const sans = joursSansActivite(derniere);
      const depuisCreation = nombreDeJours(p.date_creation, aujourdhui);
      return { p, derniere, sans: sans === null ? depuisCreation : sans };
    }).filter(d => d.sans !== null && d.sans >= seuil)
      .sort((x, y) => y.sans - x.sans);

    const limite = borner(a.limite, LIMITE_DEFAUT, LIMITE_MAX);
    return {
      resultats: dormants.length,
      texte: bloc(
        entete(ligne(`Prospects sans activité depuis ${seuil} j ou plus`, a.etape, a.secteur, a.commercial), Math.min(limite, dormants.length), dormants.length),
        '',
        dormants.slice(0, limite).map(({ p, derniere, sans }) => ligne(
          nommer(p.nom_etablissement, p.ville),
          lib(ctx.etapes, p.etape_pipeline),
          `${sans} j sans activité`,
          `${joursDansEtape(p)} j dans l'étape`,
          derniere ? `dernier(e) ${derniere.genre} le ${dateFr(derniere.date)}` : 'jamais contacté',
          texteProchaineAction(p, ctx.rappels, ctx.rdvs),
          ctx.prenoms.get(p.commercial_id) || '',
        )).join('\n'),
      ),
    };
  },
};

const boiteProspection = {
  nom: 'boite_prospection',
  titre: 'La boîte de prospection',
  description: 'Ce que l\'équipe a partagé depuis son téléphone et qui attend d\'être qualifié : lien Google Maps, Instagram, article, photo. Les photos ne sont pas transmises — seul leur nombre est indiqué.',
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
