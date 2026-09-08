// Rendez-vous et activité de l'équipe.
//
// Les compteurs d'activité sont visibles de tous, comme sur l'accueil : ce sont des
// nombres, pas des fiches. Les rendez-vous, eux, suivent le périmètre.
import { z } from 'zod';
import db from '../../db.js';
import { dateLocale, rdvPasse, rdvAnnule, lundiDeLaSemaine, dimancheDeLaSemaine, semaineIso } from '../../../shared/regles.js';
import { LIBELLES_STATUT_RDV, LIBELLES_RESULTAT_RDV } from '../../../shared/libelles.js';
import { perimetre, estAdmin, faitDeLaProspection, equipe, trouverCommercial } from '../perimetre.js';
import {
  LIMITE_DEFAUT, LIMITE_MAX, borner, dateFr, ligne, bloc, entete, extrait, lib, nommer,
} from '../format.js';

async function prenomsEquipe() {
  return new Map((await equipe()).map(g => [g.id, g.prenom]));
}

const rendezVous = {
  nom: 'rendez_vous',
  titre: 'Les rendez-vous',
  description: 'Les rendez-vous à venir, ceux qui sont passés, et ceux dont le compte rendu manque. Dit qui a le rendez-vous et qui l\'a pris.',
  schema: {
    quand: z.enum(['a_venir', 'passes', 'sans_compte_rendu']).optional().describe('« a_venir » par défaut.'),
    du: z.string().optional().describe('Date de début, au format AAAA-MM-JJ.'),
    au: z.string().optional().describe('Date de fin, au format AAAA-MM-JJ.'),
    commercial: z.string().optional().describe('Celui qui a le rendez-vous.'),
    pris_par: z.string().optional().describe('Celui qui a décroché le rendez-vous.'),
    limite: z.number().optional().describe(`Nombre de résultats, ${LIMITE_DEFAUT} par défaut, ${LIMITE_MAX} au maximum.`),
  },
  executer: async (a, { utilisateur }) => {
    const quand = a.quand || 'a_venir';
    const params = [];
    const conditions = [];

    if (a.commercial) {
      const { cible } = await perimetre(utilisateur, a.commercial, 'prospects', 'rendez_vous');
      params.push(cible.id);
      conditions.push(`r.commercial_id = $${params.length}`);
    } else if (faitDeLaProspection(utilisateur)) {
      // La prospection prend des rendez-vous pour les commerciaux : ce sont les siens.
      params.push(utilisateur.id);
      conditions.push(`(r.prospecteur_id = $${params.length} OR r.commercial_id = $${params.length})`);
    } else if (!estAdmin(utilisateur)) {
      params.push(utilisateur.id);
      conditions.push(`(r.commercial_id = $${params.length} OR r.prospecteur_id = $${params.length})`);
    }
    if (a.pris_par) {
      const cible = await trouverCommercial(a.pris_par);
      params.push(cible.id);
      conditions.push(`r.prospecteur_id = $${params.length}`);
    }
    if (a.du) { params.push(a.du); conditions.push(`r.date >= $${params.length}`); }
    if (a.au) { params.push(a.au); conditions.push(`r.date <= $${params.length}`); }

    const sql = `SELECT r.*, p.nom_etablissement, p.ville AS ville_prospect, c.nom AS nom_client, c.ville AS ville_client
                   FROM appointments r
                   LEFT JOIN prospects p ON p.id = r.prospect_id
                   LEFT JOIN clients c ON c.id = r.client_id
                  ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
                  ORDER BY r.date, r.heure_debut`;
    const r = await db.query(sql, params);

    let lignes = r.rows;
    if (quand === 'a_venir') lignes = lignes.filter(x => !rdvAnnule(x) && !rdvPasse(x));
    else if (quand === 'passes') lignes = lignes.filter(x => rdvPasse(x));
    else lignes = lignes.filter(x => !rdvAnnule(x) && rdvPasse(x) && !x.compte_rendu);
    if (quand !== 'a_venir') lignes = [...lignes].reverse();

    const prenoms = await prenomsEquipe();
    const limite = borner(a.limite, LIMITE_DEFAUT, LIMITE_MAX);
    const titres = { a_venir: 'Rendez-vous à venir', passes: 'Rendez-vous passés', sans_compte_rendu: 'Rendez-vous sans compte rendu' };
    return {
      resultats: lignes.length,
      texte: bloc(
        entete(ligne(titres[quand], a.commercial && `pour ${a.commercial}`, a.pris_par && `pris par ${a.pris_par}`), Math.min(limite, lignes.length), lignes.length),
        '',
        lignes.slice(0, limite).map(x => ligne(
          dateFr(x.date),
          x.heure_debut || '',
          nommer(x.nom_client || x.nom_etablissement || 'Rendez-vous', x.ville_client || x.ville_prospect),
          x.nom_client ? 'client' : 'prospect',
          `pour ${prenoms.get(x.commercial_id) || '?'}`,
          x.prospecteur_id && x.prospecteur_id !== x.commercial_id ? `pris par ${prenoms.get(x.prospecteur_id) || '?'}` : '',
          x.statut !== 'planifie' ? lib(LIBELLES_STATUT_RDV, x.statut) : '',
          x.lieu ? `lieu ${x.lieu}` : '',
          x.compte_rendu ? `compte rendu : ${lib(LIBELLES_RESULTAT_RDV, x.compte_rendu)}` : '',
          extrait(x.notes_compte_rendu || x.notes, 160),
        )).join('\n') || 'Aucun rendez-vous.',
      ),
    };
  },
};

const activite = {
  nom: 'activite',
  titre: 'L\'activité de l\'équipe',
  description: 'Combien chacun a passé d\'appels, envoyé de mails, fait de visites, pris de rendez-vous et saisi de comptes rendus sur une période. Des compteurs, jamais des fiches : visibles de toute l\'équipe, comme sur l\'accueil.',
  schema: {
    qui: z.string().optional().describe('Le prénom d\'une personne ; sinon, toute l\'équipe.'),
    du: z.string().optional().describe('Date de début AAAA-MM-JJ ; par défaut le lundi de cette semaine.'),
    au: z.string().optional().describe('Date de fin AAAA-MM-JJ ; par défaut dimanche.'),
    groupe_par: z.enum(['personne', 'jour', 'semaine']).optional().describe('« personne » par défaut.'),
  },
  executer: async (a) => {
    const du = a.du || dateLocale(lundiDeLaSemaine());
    const au = a.au || dateLocale(dimancheDeLaSemaine());
    const cible = a.qui ? await trouverCommercial(a.qui) : null;
    const idsCible = cible ? [cible.id] : null;

    const filtre = (champ) => (idsCible ? ` AND ${champ} = ANY($3)` : '');
    const params = idsCible ? [du, au, idsCible] : [du, au];
    const [appels, interactions, rdvs, comptesRendus, prospectsCrees] = await Promise.all([
      db.query(`SELECT commercial_id, left(date, 10) AS jour, resultat, COUNT(*)::int AS n FROM calls
                 WHERE left(date, 10) BETWEEN $1 AND $2${filtre('commercial_id')} GROUP BY 1,2,3`, params),
      db.query(`SELECT commercial_id, left(date, 10) AS jour, type, COUNT(*)::int AS n FROM interactions
                 WHERE left(date, 10) BETWEEN $1 AND $2${filtre('commercial_id')} GROUP BY 1,2,3`, params),
      db.query(`SELECT COALESCE(prospecteur_id, commercial_id) AS commercial_id, left(COALESCE(NULLIF(created_at, ''), date), 10) AS jour, COUNT(*)::int AS n
                  FROM appointments WHERE left(COALESCE(NULLIF(created_at, ''), date), 10) BETWEEN $1 AND $2${filtre('COALESCE(prospecteur_id, commercial_id)')} GROUP BY 1,2`, params),
      db.query(`SELECT commercial_id, left(date, 10) AS jour, COUNT(*)::int AS n FROM appointments
                 WHERE compte_rendu <> '' AND left(date, 10) BETWEEN $1 AND $2${filtre('commercial_id')} GROUP BY 1,2`, params),
      db.query(`SELECT commercial_id, left(date_creation, 10) AS jour, COUNT(*)::int AS n FROM prospects
                 WHERE left(date_creation, 10) BETWEEN $1 AND $2${filtre('commercial_id')} GROUP BY 1,2`, params),
    ]);

    const groupe = a.groupe_par || 'personne';
    const prenoms = await prenomsEquipe();
    const cle = (commercialId, jour) => {
      if (groupe === 'personne') return prenoms.get(commercialId) || commercialId || '—';
      if (groupe === 'jour') return jour;
      const { annee, semaine } = semaineIso(new Date(`${jour}T12:00:00`));
      return `${annee} S${String(semaine).padStart(2, '0')}`;
    };
    const compteurs = new Map();
    const vide = () => ({ appels: 0, aboutis: 0, mails: 0, visites: 0, rdv_pris: 0, comptes_rendus: 0, prospects: 0 });
    const ajouter = (k, champ, n) => {
      if (!k) return;
      if (!compteurs.has(k)) compteurs.set(k, vide());
      compteurs.get(k)[champ] += n;
    };
    // Par personne, toute l'équipe apparaît, même à zéro : « qui n'a rien fait cette
    // semaine » est justement la question qu'on pose.
    if (groupe === 'personne' && !cible) for (const g of await equipe()) compteurs.set(g.prenom, vide());
    for (const r of appels.rows) {
      const k = cle(r.commercial_id, r.jour);
      if (r.resultat === 'email_envoye') ajouter(k, 'mails', r.n);
      else { ajouter(k, 'appels', r.n); if (r.resultat === 'repondu') ajouter(k, 'aboutis', r.n); }
    }
    for (const r of interactions.rows) {
      const k = cle(r.commercial_id, r.jour);
      if (r.type === 'VISITE') ajouter(k, 'visites', r.n); else ajouter(k, 'appels', r.n);
    }
    for (const r of rdvs.rows) ajouter(cle(r.commercial_id, r.jour), 'rdv_pris', r.n);
    for (const r of comptesRendus.rows) ajouter(cle(r.commercial_id, r.jour), 'comptes_rendus', r.n);
    for (const r of prospectsCrees.rows) ajouter(cle(r.commercial_id, r.jour), 'prospects', r.n);

    const lignes = [...compteurs.entries()].sort((x, y) => x[0].localeCompare(y[0]));
    return {
      resultats: lignes.length,
      texte: bloc(
        `Activité du ${dateFr(du, { relatif: false })} au ${dateFr(au, { relatif: false })}${cible ? ` — ${cible.prenom} ${cible.nom}` : ' — toute l\'équipe'} (par ${groupe})`,
        '',
        lignes.map(([k, c]) => ligne(
          k,
          `${c.appels} appel(s)${c.appels ? ` dont ${c.aboutis} abouti(s)` : ''}`,
          c.mails ? `${c.mails} mail(s)` : '',
          c.visites ? `${c.visites} visite(s)` : '',
          c.rdv_pris ? `${c.rdv_pris} RDV pris` : '',
          c.comptes_rendus ? `${c.comptes_rendus} compte(s) rendu(s)` : '',
          c.prospects ? `${c.prospects} prospect(s) créé(s)` : '',
        )).join('\n') || 'Aucune activité sur la période.',
      ),
    };
  },
};

export default [rendezVous, activite];
