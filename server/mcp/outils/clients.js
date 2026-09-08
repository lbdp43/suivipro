// Clients, retards et tournées. Le périmètre est appliqué dans la requête SQL, pas à
// l'affichage : ce qui n'est pas dans le périmètre ne sort pas de la base.
import { z } from 'zod';
import db from '../../db.js';
import { statutVisite, joursDeRetard, dateLocale, jourDe } from '../../../shared/regles.js';
import { lireConfigTournee } from '../../../shared/tournee.js';
import { normaliserPourComparaison } from '../../../shared/normalisation.js';
import {
  LIBELLES_TYPE_CLIENT, LIBELLES_STATUT_VISITE, LIBELLES_INTERACTION,
  LIBELLES_STATUT_TACHE, LIBELLES_STATUT_RDV, FREQUENCES_VISITE,
} from '../../../shared/libelles.js';
import { perimetre, clause, HorsPerimetre, equipe } from '../perimetre.js';
import { journaliserContact } from '../journal.js';
import {
  LIMITE_DEFAUT, LIMITE_MAX, MOIS_DEFAUT, MOIS_MAX, borner, dateFr, ilYaDesMois,
  ligne, bloc, entete, extrait, lib, nommer,
} from '../format.js';

const ETATS = { retard: 'RETARD', aujourdhui: 'AUJOURDHUI', a_venir: 'A_VENIR', sans_recurrence: 'SANS_RECURRENCE', inactif: 'INACTIF' };

async function nomsDeLEquipe() {
  const gens = await equipe();
  return new Map(gens.map(g => [g.id, g.prenom]));
}

function frequenceDe(client) {
  if (client.custom_recurrence === 0) return null;
  return client.custom_recurrence || FREQUENCES_VISITE[client.type_client] || null;
}

function resumeClient(c, prenoms) {
  const statut = statutVisite(c);
  const retard = joursDeRetard(c);
  const freq = frequenceDe(c);
  return ligne(
    nommer(c.nom, c.ville),
    lib(LIBELLES_TYPE_CLIENT, c.type_client),
    statut === 'RETARD' ? `en retard de ${retard} j` : lib(LIBELLES_STATUT_VISITE, statut),
    c.last_visit ? `vue le ${dateFr(c.last_visit)}` : 'jamais visitée',
    c.next_visit && statut !== 'RETARD' ? `prochaine ${dateFr(c.next_visit)}` : '',
    freq ? `tous les ${freq} j` : '',
    c.tournee ? `tournée ${c.tournee}` : '',
    prenoms.get(c.commercial_id) || '',
  );
}

/** Le filtre de nom : sans accents, sans casse, en cherchant dans le nom et la ville. */
function filtreTexte(lignes, recherche, champs) {
  const q = normaliserPourComparaison(recherche);
  if (!q) return lignes;
  return lignes.filter(l => champs.some(ch => normaliserPourComparaison(l[ch] || '').includes(q)));
}

async function chargerClients(utilisateur, demandeCommercial, outil) {
  const { ids } = await perimetre(utilisateur, demandeCommercial, 'clients', outil);
  const params = [];
  const sql = `SELECT * FROM clients WHERE 1=1${clause('commercial_id', ids, params)} ORDER BY nom`;
  const r = await db.query(sql, params);
  return r.rows;
}

const chercherClient = {
  nom: 'chercher_client',
  titre: 'Chercher un client',
  description: 'Retrouver des clients par nom, ville, type, tournée ou état de visite. Renvoie pour chacun son état (en retard, à visiter aujourd\'hui, à venir…), sa dernière visite et sa fréquence.',
  schema: {
    nom: z.string().optional().describe('Recherche partielle sur le nom ou la ville, sans tenir compte des accents.'),
    ville: z.string().optional().describe('Ville ou code postal.'),
    type: z.string().optional().describe('Type de client : bar, cave, souchon, distributeur, export…'),
    tournee: z.string().optional().describe('Nom de tournée ou de zone.'),
    etat: z.enum(['retard', 'aujourdhui', 'a_venir', 'sans_recurrence', 'inactif']).optional().describe('N\'garder que les clients dans cet état de visite.'),
    commercial: z.string().optional().describe('Le prénom d\'un collègue pour voir ses clients ; sinon, les vôtres.'),
    limite: z.number().optional().describe(`Nombre de résultats, ${LIMITE_DEFAUT} par défaut, ${LIMITE_MAX} au maximum.`),
  },
  executer: async (a, { utilisateur }) => {
    let lignes = await chargerClients(utilisateur, a.commercial, 'chercher_client');
    lignes = filtreTexte(lignes, a.nom, ['nom', 'ville']);
    lignes = filtreTexte(lignes, a.ville, ['ville', 'code_postal']);
    if (a.type) {
      const q = normaliserPourComparaison(a.type);
      lignes = lignes.filter(c => normaliserPourComparaison(lib(LIBELLES_TYPE_CLIENT, c.type_client)).includes(q) || normaliserPourComparaison(c.type_client).includes(q));
    }
    lignes = filtreTexte(lignes, a.tournee, ['tournee']);
    if (a.etat) lignes = lignes.filter(c => statutVisite(c) === ETATS[a.etat]);

    const limite = borner(a.limite, LIMITE_DEFAUT, LIMITE_MAX);
    const prenoms = await nomsDeLEquipe();
    const titre = ligne('Clients', a.nom, a.ville, a.tournee, a.etat && lib(LIBELLES_STATUT_VISITE, ETATS[a.etat]), a.commercial);
    return {
      resultats: lignes.length,
      texte: bloc(entete(titre, Math.min(limite, lignes.length), lignes.length), '', lignes.slice(0, limite).map(c => resumeClient(c, prenoms)).join('\n')),
    };
  },
};

const ficheClient = {
  nom: 'fiche_client',
  titre: 'La fiche d\'un client',
  description: 'Tout ce qu\'il faut savoir avant d\'entrer chez un client : identité, contact, tournée, fréquence, état de visite, historique des visites et appels, tâches ouvertes, rendez-vous à venir.',
  schema: {
    client: z.string().describe('Le nom du client (ou son identifiant). En cas d\'homonymes, la liste des candidats est renvoyée.'),
    commercial: z.string().optional().describe('Le prénom du commercial qui suit ce client, quand ce n\'est pas vous.'),
    historique_mois: z.number().optional().describe(`Profondeur d'historique en mois, ${MOIS_DEFAUT} par défaut, ${MOIS_MAX} au maximum.`),
  },
  executer: async (a, { utilisateur }) => {
    const tous = await chargerClients(utilisateur, a.commercial, 'fiche_client');
    const q = normaliserPourComparaison(a.client);
    let candidats = tous.filter(c => c.id === a.client || normaliserPourComparaison(c.nom) === q);
    if (candidats.length === 0) candidats = tous.filter(c => normaliserPourComparaison(c.nom).includes(q));
    if (candidats.length === 0) {
      // Peut-être un client de collègue : on le dit, sans rien montrer de sa fiche.
      const ailleurs = await db.query('SELECT COUNT(*)::int AS n FROM clients WHERE lower(nom) LIKE $1', [`%${String(a.client).toLowerCase()}%`]);
      if (ailleurs.rows[0]?.n > 0) throw new HorsPerimetre(`« ${a.client} » existe mais n'est pas dans votre périmètre. Nommez le commercial qui le suit pour y accéder.`);
      throw new HorsPerimetre(`Aucun client ne correspond à « ${a.client} ».`);
    }
    if (candidats.length > 1) {
      const prenoms = await nomsDeLEquipe();
      return { resultats: candidats.length, texte: bloc(`Plusieurs clients correspondent à « ${a.client} » — précisez :`, '', candidats.slice(0, 10).map(c => resumeClient(c, prenoms)).join('\n')) };
    }

    const c = candidats[0];
    const mois = borner(a.historique_mois, MOIS_DEFAUT, MOIS_MAX);
    const depuis = ilYaDesMois(mois);
    const [interactions, taches, rdvs, prenoms] = await Promise.all([
      db.query('SELECT * FROM interactions WHERE client_id = $1 AND date >= $2 ORDER BY date DESC LIMIT 40', [c.id, depuis]),
      db.query("SELECT * FROM tasks_client WHERE client_id = $1 AND statut <> 'TERMINEE' ORDER BY date_echeance NULLS LAST", [c.id]),
      db.query('SELECT * FROM appointments WHERE client_id = $1 AND date >= $2 ORDER BY date', [c.id, dateLocale()]),
      nomsDeLEquipe(),
    ]);
    if (c.telephone || c.telephone_mobile || c.email) await journaliserContact(utilisateur, nommer(c.nom, c.ville), 'fiche_client');

    const statut = statutVisite(c);
    const freq = frequenceDe(c);
    return {
      resultats: 1,
      texte: bloc(
        `# ${nommer(c.nom, c.ville)}`,
        ligne(lib(LIBELLES_TYPE_CLIENT, c.type_client), c.statut === 'INACTIF' ? 'client inactif' : '', prenoms.get(c.commercial_id) || ''),
        ligne(c.adresse, c.code_postal, c.ville),
        ligne(c.contact && `contact ${c.contact}`, c.telephone, c.telephone_mobile, c.email),
        ligne(
          statut === 'RETARD' ? `EN RETARD de ${joursDeRetard(c)} jours` : lib(LIBELLES_STATUT_VISITE, statut),
          freq ? `visite tous les ${freq} jours` : 'sans récurrence',
          c.last_visit ? `dernière visite ${dateFr(c.last_visit)}` : 'jamais visitée',
          c.next_visit ? `prochaine ${dateFr(c.next_visit)}` : '',
          c.tournee ? `tournée ${c.tournee}` : '',
        ),
        c.notes ? `Notes : ${extrait(c.notes, 400)}` : '',
        '',
        `## Historique (${mois} mois) — ${interactions.rows.length} interaction(s)`,
        interactions.rows.length
          ? interactions.rows.map(i => ligne(dateFr(i.date), lib(LIBELLES_INTERACTION, i.type), prenoms.get(i.commercial_id) || '', extrait(i.comment))).join('\n')
          : 'Rien sur la période.',
        rdvs.rows.length ? bloc('', '## Rendez-vous à venir', rdvs.rows.map(r => ligne(dateFr(r.date), r.heure_debut, lib(LIBELLES_STATUT_RDV, r.statut), r.lieu, extrait(r.notes, 100))).join('\n')) : '',
        taches.rows.length ? bloc('', '## Tâches ouvertes', taches.rows.map(t => ligne(t.date_echeance ? dateFr(t.date_echeance) : 'sans échéance', lib(LIBELLES_STATUT_TACHE, t.statut), t.titre)).join('\n')) : '',
      ),
    };
  },
};

const clientsEnRetard = {
  nom: 'clients_en_retard',
  titre: 'Les clients en retard',
  description: 'La liste des visites qui ont glissé, les plus anciennes d\'abord. Un client inactif ou sans fréquence n\'est jamais en retard.',
  schema: {
    commercial: z.string().optional().describe('Le prénom d\'un collègue ; sinon, les vôtres (toute l\'équipe pour un administrateur).'),
    tournee: z.string().optional().describe('Pour préparer une journée précise.'),
    jours_min: z.number().optional().describe('Ne garder que les retards d\'au moins N jours.'),
    limite: z.number().optional().describe(`Nombre de résultats, ${LIMITE_DEFAUT} par défaut, ${LIMITE_MAX} au maximum.`),
  },
  executer: async (a, { utilisateur }) => {
    let lignes = (await chargerClients(utilisateur, a.commercial, 'clients_en_retard')).filter(c => statutVisite(c) === 'RETARD');
    lignes = filtreTexte(lignes, a.tournee, ['tournee']);
    if (a.jours_min) lignes = lignes.filter(c => joursDeRetard(c) >= a.jours_min);
    lignes.sort((x, y) => joursDeRetard(y) - joursDeRetard(x));
    const limite = borner(a.limite, LIMITE_DEFAUT, LIMITE_MAX);
    const prenoms = await nomsDeLEquipe();
    return {
      resultats: lignes.length,
      texte: bloc(
        entete(ligne('Clients en retard', a.tournee, a.commercial), Math.min(limite, lignes.length), lignes.length),
        '',
        lignes.slice(0, limite).map(c => resumeClient(c, prenoms)).join('\n'),
      ),
    };
  },
};

const JOURS_SEMAINE = { 1: 'Lundi', 2: 'Mardi', 3: 'Mercredi', 4: 'Jeudi', 5: 'Vendredi', 6: 'Samedi', 0: 'Dimanche' };
const MOTIFS = { every: 'toutes les semaines', even: 'semaines paires', odd: 'semaines impaires' };

const secteursEtZones = {
  nom: 'secteurs_et_zones',
  titre: 'Secteurs, zones et tournées',
  description: 'Le découpage du terrain : les zones dessinées sur la carte, celles qui sont prioritaires et leur consigne, le nombre de fiches rattachées, et les jours de tournée avec le rythme des semaines paires ou impaires.',
  schema: {
    commercial: z.string().optional().describe('Le prénom d\'un collègue ; sinon, les vôtres.'),
    prioritaires_seulement: z.boolean().optional().describe('Ne montrer que les zones prioritaires.'),
  },
  executer: async (a, { utilisateur }) => {
    // Les zones et les tournées sont une carte d'équipe : chacun peut les lire.
    const cible = a.commercial ? (await perimetre(utilisateur, a.commercial, 'prospects', 'secteurs_et_zones')).cible : null;
    const params = [];
    let sql = 'SELECT * FROM commercial_zones WHERE 1=1';
    if (cible) { params.push(cible.id); sql += ` AND commercial_id = $${params.length}`; }
    if (a.prioritaires_seulement) sql += ' AND prioritaire';
    const [zones, prospects, clients, configs, prenoms] = await Promise.all([
      db.query(`${sql} ORDER BY prioritaire DESC, nom`, params),
      db.query('SELECT zone_id, COUNT(*)::int AS n FROM prospects WHERE zone_id IS NOT NULL GROUP BY zone_id'),
      db.query('SELECT zone_id, COUNT(*)::int AS n FROM clients WHERE zone_id IS NOT NULL GROUP BY zone_id'),
      db.query('SELECT * FROM tournee_config'),
      nomsDeLEquipe(),
    ]);
    const nbP = new Map(prospects.rows.map(r => [r.zone_id, r.n]));
    const nbC = new Map(clients.rows.map(r => [r.zone_id, r.n]));

    const tournees = configs.rows
      .filter(t => !cible || t.commercial_id === cible.id)
      .map(t => {
        const config = lireConfigTournee(t.config);
        const jours = Object.entries(config)
          .filter(([cle]) => /^[0-6]$/.test(cle))
          .map(([cle, valeurs]) => `${JOURS_SEMAINE[Number(cle)]} : ${(Array.isArray(valeurs) ? valeurs : []).join(', ') || '—'}`);
        return bloc(
          `**${prenoms.get(t.commercial_id) || t.commercial_id}** — ${MOTIFS[t.week_pattern] || MOTIFS.every}`,
          jours.length ? jours.map(j => `  ${j}`).join('\n') : '  aucun jour réglé',
          t.tournee_info ? `  Info : ${extrait(t.tournee_info, 200)}` : '',
        );
      });

    const horsZone = await db.query('SELECT COUNT(*)::int AS n FROM clients WHERE (zone_id IS NULL OR zone_id = \'\') AND latitude <> 0');
    return {
      resultats: zones.rows.length,
      texte: bloc(
        entete(ligne('Zones', a.commercial, a.prioritaires_seulement ? 'prioritaires' : ''), zones.rows.length, zones.rows.length),
        '',
        zones.rows.map(z => ligne(
          `${z.prioritaire ? '★ ' : ''}${z.nom}`,
          prenoms.get(z.commercial_id) || '',
          `${nbP.get(z.id) || 0} prospect(s)`,
          `${nbC.get(z.id) || 0} client(s)`,
          z.consigne ? `consigne : ${extrait(z.consigne, 200)}` : '',
        )).join('\n') || 'Aucune zone dessinée.',
        tournees.length ? bloc('', '## Tournées', tournees.join('\n')) : '',
        '',
        `${horsZone.rows[0]?.n || 0} client(s) géolocalisé(s) hors de toute zone.`,
      ),
    };
  },
};

export default [chercherClient, ficheClient, clientsEnRetard, secteursEtZones];
