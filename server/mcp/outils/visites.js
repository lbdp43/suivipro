// Les visites et les appels chez les clients : les retrouver, et en noter un.
//
// La lecture suit le périmètre des clients (les siens ; un collègue s'il est nommé, et
// c'est journalisé). L'écriture passe par la même règle que l'appli (lib/visitesClient.js) :
// un appel compte comme une visite sauf s'il est resté sans réponse, rien ne se note à
// l'avance, et elle se fait en deux temps — un aperçu, puis la confirmation.
import { z } from 'zod';
import db from '../../db.js';
import { dateLocale } from '../../../shared/regles.js';
import { normaliserPourComparaison } from '../../../shared/normalisation.js';
import { LIBELLES_INTERACTION } from '../../../shared/libelles.js';
import { ISSUES_APPEL_CLIENT } from '../../../shared/visites.js';
import { planInteraction, enregistrerInteraction, decrireInteraction, InteractionRefusee } from '../../lib/visitesClient.js';
import { perimetre, clause, HorsPerimetre, estAdmin, trouverCommercial } from '../perimetre.js';
import { clauseTexte, sansAccentsSql } from '../sql.js';
import { LIMITE_DEFAUT, LIMITE_MAX, borner, dateFr, ligne, bloc, entete, extrait, nommer } from '../format.js';
import { chargerClients } from './clients.js';
import { CONFIRMER, deuxTemps } from './suivi.js';

const TYPES = { visite: 'VISITE', appel: 'APPEL', rdv_planifie: 'RDV_PLANIFIE' };
const dateValide = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(d));

function ilYaDesJours(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return dateLocale(d);
}

// ---------------------------------------------------------------------------------------
const lire = {
  nom: 'visites_et_appels',
  titre: 'Retrouver les visites et les appels',
  description: 'Les visites, appels et rendez-vous planifiés notés chez les clients sur une période, avec leur commentaire, qui les a faits, et les totaux par type et par personne. Filtres : client, commercial, période, type, tournée, mot dans le commentaire (« problème », « commande »…). Un appel sans réponse est signalé : il ne compte pas comme visite.',
  schema: {
    client: z.string().optional().describe('Le nom (ou un morceau du nom) d\'un client, ou sa référence.'),
    commercial: z.string().optional().describe('Le prénom d\'un collègue : ses clients à lui. Sinon, vos clients (toute l\'équipe pour un administrateur).'),
    du: z.string().optional().describe('Date de début AAAA-MM-JJ ; par défaut il y a 30 jours.'),
    au: z.string().optional().describe('Date de fin AAAA-MM-JJ ; par défaut aujourd\'hui.'),
    type: z.enum(['tout', 'visite', 'appel', 'rdv_planifie']).optional().describe('« tout » par défaut.'),
    tournee: z.string().optional().describe('Le nom d\'une tournée.'),
    contient: z.string().optional().describe('Un mot à chercher dans le commentaire.'),
    limite: z.number().optional().describe(`Nombre de lignes, ${LIMITE_DEFAUT} par défaut, ${LIMITE_MAX} au maximum.`),
  },
  executer: async (a, { utilisateur }) => {
    const du = a.du || ilYaDesJours(30);
    const au = a.au || dateLocale();
    if (!dateValide(du) || !dateValide(au)) throw new HorsPerimetre('Dates au format AAAA-MM-JJ, s\'il vous plaît.');
    const { ids } = await perimetre(utilisateur, a.commercial, 'clients', 'visites_et_appels');

    const params = [du, au];
    let where = `WHERE left(i.date, 10) >= $1 AND left(i.date, 10) <= $2${clause('c.commercial_id', ids, params)}`;
    if (a.client) {
      params.push(a.client);
      const n = params.length;
      params.push(`%${normaliserPourComparaison(a.client)}%`);
      where += ` AND (c.id = $${n} OR ${sansAccentsSql('c.nom')} LIKE $${params.length})`;
    }
    where += clauseTexte(['c.tournee'], a.tournee, params);
    where += clauseTexte(['i.comment'], a.contient, params);
    if (a.type && a.type !== 'tout') { params.push(TYPES[a.type]); where += ` AND i.type = $${params.length}`; }

    const [totaux, lignes] = await Promise.all([
      db.query(
        `SELECT i.type, i.compte_visite, com.prenom, COUNT(*)::int AS n
           FROM interactions i JOIN clients c ON c.id = i.client_id LEFT JOIN commerciaux com ON com.id = i.commercial_id
           ${where} GROUP BY i.type, i.compte_visite, com.prenom`, params),
      db.query(
        `SELECT i.*, c.nom, c.ville, com.prenom
           FROM interactions i JOIN clients c ON c.id = i.client_id LEFT JOIN commerciaux com ON com.id = i.commercial_id
           ${where} ORDER BY i.date DESC LIMIT ${borner(a.limite, LIMITE_DEFAUT, LIMITE_MAX)}`, params),
    ]);

    let total = 0, visites = 0, appels = 0, sansReponse = 0, rdv = 0;
    const parPersonne = new Map();
    for (const t of totaux.rows) {
      total += t.n;
      if (t.type === 'VISITE') visites += t.n;
      if (t.type === 'APPEL') { appels += t.n; if (!t.compte_visite) sansReponse += t.n; }
      if (t.type === 'RDV_PLANIFIE') rdv += t.n;
      const p = parPersonne.get(t.prenom || '?') || { v: 0, a: 0 };
      if (t.type === 'VISITE') p.v += t.n;
      if (t.type === 'APPEL') p.a += t.n;
      parPersonne.set(t.prenom || '?', p);
    }
    return {
      resultats: total,
      texte: bloc(
        entete(`Visites et appels du ${dateFr(du, { relatif: false })} au ${dateFr(au, { relatif: false })}`, lignes.rows.length, total),
        total ? ligne(`${visites} visite(s)`, `${appels} appel(s)${sansReponse ? ` dont ${sansReponse} sans réponse` : ''}`, rdv ? `${rdv} RDV planifié(s)` : '') : '',
        parPersonne.size > 1 ? `Par personne : ${[...parPersonne].map(([p, x]) => `${p} ${x.v} visite(s), ${x.a} appel(s)`).join(' ; ')}` : '',
        '',
        ...lignes.rows.map(i => ligne(
          `réf. ${i.id}`, dateFr(i.date), LIBELLES_INTERACTION[i.type] || i.type,
          i.type === 'APPEL' && !i.compte_visite ? 'sans réponse, ne compte pas' : '',
          nommer(i.nom, i.ville), i.prenom ? `par ${i.prenom}` : '', extrait(i.comment, 200),
        )),
      ),
    };
  },
};

/** Le client visé : un des siens (tous pour l'administrateur), par référence ou par nom. */
async function trouverLeClient(utilisateur, recherche) {
  // La prospection cherche parmi les clients qu'on lui a confiés (une tâche ouverte à son nom).
  if (utilisateur.role === 'prospection') {
    const q = normaliserPourComparaison(recherche);
    const confies = (await db.query(
      `SELECT DISTINCT c.* FROM clients c JOIN tasks_client t ON t.client_id = c.id
        WHERE t.commercial_id = $1 AND t.statut <> 'TERMINEE' ORDER BY c.nom`, [utilisateur.id]
    )).rows;
    const parId = confies.filter(c => c.id === recherche);
    if (parId.length) return parId;
    const exacts = confies.filter(c => normaliserPourComparaison(c.nom) === q);
    if (exacts.length) return exacts;
    const proches = confies.filter(c => normaliserPourComparaison(c.nom).includes(q));
    if (proches.length) return proches;
    throw new HorsPerimetre(`« ${recherche} » ne fait pas partie des clients qui vous sont confiés. Ce sont ceux pour lesquels une tâche ouverte vous est assignée (voir « mes_actions »).`);
  }
  const parId = (await db.query('SELECT * FROM clients WHERE id = $1', [recherche])).rows[0];
  if (parId) {
    if (!estAdmin(utilisateur) && parId.commercial_id !== utilisateur.id) {
      throw new HorsPerimetre(`${parId.nom} n'est pas l'un de vos clients : seul son commercial (ou un administrateur) y note une visite.`);
    }
    return [parId];
  }
  const tous = await chargerClients(utilisateur, null, 'noter_visite_ou_appel', { texte: recherche });
  const q = normaliserPourComparaison(recherche);
  const exacts = tous.filter(c => normaliserPourComparaison(c.nom) === q);
  if (exacts.length) return exacts;
  if (tous.length) return tous;
  const ailleurs = await db.query(`SELECT COUNT(*)::int AS n FROM clients WHERE ${sansAccentsSql('nom')} LIKE $1`, [`%${q}%`]);
  if (ailleurs.rows[0]?.n > 0) throw new HorsPerimetre(`« ${recherche} » existe, mais n'est pas l'un de vos clients : seul son commercial (ou un administrateur) y note une visite.`);
  throw new InteractionRefusee(`Aucun client ne correspond à « ${recherche} ».`);
}

// ---------------------------------------------------------------------------------------
const noter = {
  nom: 'noter_visite_ou_appel',
  titre: 'Noter une visite ou un appel chez un client',
  ecrit: true,
  description: 'Enregistre dans SuiviPro une visite ou un appel chez un de vos clients, avec les règles de l\'appli : un appel compte comme une visite (dernière visite, prochaine visite recalculée), sauf s\'il est resté sans réponse ; rien ne se note à l\'avance. Peut aussi terminer des tâches ouvertes du client et créer une tâche de suivi. Pour la prospection : seulement chez les clients qu\'on lui a confiés par une tâche ouverte (« mes_actions » les liste). En deux temps : sans « confirmer », montre ce qui va se passer (et les tâches ouvertes du client) sans rien écrire ; « confirmer: true » seulement après l\'accord de la personne.',
  schema: {
    client: z.string().describe('Le nom du client (ou sa référence). En cas d\'homonymes, les candidats sont renvoyés avec leur référence.'),
    type: z.enum(['visite', 'appel']).describe('Visite sur place, ou appel.'),
    commentaire: z.string().describe('Ce qui s\'est dit ou passé. Obligatoire — ne l\'inventez pas, demandez-le.'),
    issue: z.enum(ISSUES_APPEL_CLIENT.map(i => i.value)).optional()
      .describe(`Pour un appel : ${ISSUES_APPEL_CLIENT.map(i => `${i.value} (${i.label})`).join(', ')}. « pas_de_reponse » ne compte pas comme visite.`),
    date: z.string().optional().describe('AAAA-MM-JJ, aujourd\'hui par défaut. Jamais dans le futur.'),
    taches_faites: z.array(z.string()).optional().describe('Les références des tâches ouvertes du client que ce passage a réglées (l\'aperçu les liste).'),
    tache_de_suivi: z.string().optional().describe('Le titre d\'une tâche de suivi à créer.'),
    tache_de_suivi_le: z.string().optional().describe('Son échéance, AAAA-MM-JJ.'),
    pour: z.string().optional().describe('Administrateur seulement : le prénom du collègue qui a fait la visite ou l\'appel.'),
    confirmer: CONFIRMER,
  },
  executer: async (a, { utilisateur }) => {
    let pourQui = null;
    if (a.pour) {
      if (!estAdmin(utilisateur)) throw new HorsPerimetre('Vous notez vos propres visites et appels ; seul un administrateur note pour un collègue.');
      pourQui = await trouverCommercial(a.pour);
    }
    const candidats = await trouverLeClient(utilisateur, a.client);
    if (candidats.length > 1) {
      return { resultats: candidats.length, texte: bloc(`Plusieurs clients correspondent à « ${a.client} » — précisez avec la référence :`, ...candidats.slice(0, 10).map(c => ligne(`réf. ${c.id}`, nommer(c.nom, c.ville), c.tournee ? `tournée ${c.tournee}` : ''))) };
    }
    const client = candidats[0];
    if (a.date && !dateValide(a.date)) throw new InteractionRefusee('Date au format AAAA-MM-JJ.');
    // Une date passée se note à midi (le jour ne glisse pas d'un fuseau à l'autre) ; aujourd'hui, à l'heure qu'il est.
    const date = a.date && a.date !== dateLocale() ? `${a.date}T12:00:00` : undefined;
    const saisie = {
      client_id: client.id, type: a.type === 'appel' ? 'APPEL' : 'VISITE', comment: a.commentaire, issue: a.issue, date,
      commercial_id: pourQui?.id, taches_faites: a.taches_faites,
      nouvelle_tache: a.tache_de_suivi ? { titre: a.tache_de_suivi, date: a.tache_de_suivi_le || null } : null,
    };
    const auteur = { id: utilisateur.id, role: utilisateur.role, prenom: utilisateur.prenom };
    const options = { commentaireObligatoire: true, perimetre: 'siens' };

    if (!a.confirmer) {
      const plan = await planInteraction(saisie, auteur, options);
      const ouvertes = (await db.query(
        "SELECT id, titre, date_echeance FROM tasks_client WHERE client_id = $1 AND statut <> 'TERMINEE' ORDER BY date_echeance NULLS LAST LIMIT 10", [client.id]
      )).rows.filter(t => !(a.taches_faites || []).includes(t.id));
      const lignes = decrireInteraction(plan);
      if (ouvertes.length) {
        lignes.push(`Tâches encore ouvertes sur ce client (à terminer avec « taches_faites » si ce passage les règle) : ${ouvertes.map(t => `réf. ${t.id} « ${t.titre} »${t.date_echeance ? ` (${dateFr(t.date_echeance, { relatif: false })})` : ''}`).join(' ; ')}`);
      }
      return { resultats: 0, texte: deuxTemps(lignes) };
    }
    const r = await enregistrerInteraction(saisie, auteur, { ...options, via: 'claude' });
    return { resultats: 1, texte: bloc('Enregistré dans SuiviPro :', ...r.resume.map(l => `- ${l}`)) };
  },
};

export default [lire, noter];
