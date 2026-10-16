// Rendez-vous et activité de l'équipe.
//
// Les compteurs d'activité sont visibles de tous, comme sur l'accueil : ce sont des
// nombres, pas des fiches. Les rendez-vous, eux, suivent le périmètre.
import { z } from 'zod';
import db from '../../db.js';
import { dateLocale, rdvPasse, rdvAnnule, lundiDeLaSemaine, dimancheDeLaSemaine, semaineIso } from '../../../shared/regles.js';
import { SQL_RDV_PRIS, SQL_QUI_A_PRIS } from '../../../shared/activite.js';
import { LIBELLES_STATUT_RDV, LIBELLES_RESULTAT_RDV } from '../../../shared/libelles.js';
import { perimetre, estAdmin, faitDeLaProspection, equipe, trouverCommercial } from '../perimetre.js';
import {
  LIMITE_DEFAUT, LIMITE_MAX, borner, dateFr, heureParis, ligne, bloc, entete, extrait, lib, nommer,
} from '../format.js';
import { jourParisSql } from '../sql.js';

async function prenomsEquipe() {
  return new Map((await equipe()).map(g => [g.id, g.prenom]));
}

const rendezVous = {
  nom: 'rendez_vous',
  titre: 'Les rendez-vous',
  description: 'Les rendez-vous à venir, ceux qui sont passés, et ceux dont le compte rendu manque. Dit qui a le rendez-vous, qui l\'a pris et quand (pris le) ; pour un rendez-vous passé, comment il s\'est conclu (honoré, annulé, reporté, sans compte rendu) et son résultat. « pris_du » / « pris_au » listent les rendez-vous décrochés un jour donné, quelle que soit la date du rendez-vous.',
  schema: {
    quand: z.enum(['a_venir', 'passes', 'sans_compte_rendu', 'tous']).optional().describe('« a_venir » par défaut ; « tous » dès qu\'on filtre sur la date de prise.'),
    du: z.string().optional().describe('Date de début du rendez-vous, au format AAAA-MM-JJ.'),
    au: z.string().optional().describe('Date de fin du rendez-vous, au format AAAA-MM-JJ.'),
    pris_du: z.string().optional().describe('Rendez-vous pris à partir de ce jour (AAAA-MM-JJ, heure de Paris).'),
    pris_au: z.string().optional().describe('Rendez-vous pris jusqu\'à ce jour inclus (AAAA-MM-JJ).'),
    commercial: z.string().optional().describe('Celui qui a le rendez-vous.'),
    pris_par: z.string().optional().describe('Celui qui a décroché le rendez-vous.'),
    limite: z.number().optional().describe(`Nombre de résultats, ${LIMITE_DEFAUT} par défaut, ${LIMITE_MAX} au maximum.`),
  },
  executer: async (a, { utilisateur }) => {
    // Filtrer sur le jour de prise, c'est mesurer la prospection : on veut alors tous les
    // rendez-vous pris ce jour-là, à venir ou passés.
    const quand = a.quand || (a.pris_du || a.pris_au ? 'tous' : 'a_venir');
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
    const prisLe = jourParisSql("NULLIF(r.created_at, '')");
    if (a.pris_du) { params.push(a.pris_du); conditions.push(`${prisLe} >= $${params.length}`); }
    if (a.pris_au) { params.push(a.pris_au); conditions.push(`${prisLe} <= $${params.length}`); }

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
    else if (quand === 'sans_compte_rendu') lignes = lignes.filter(x => !rdvAnnule(x) && rdvPasse(x) && !x.compte_rendu);
    if (quand !== 'a_venir' && quand !== 'tous') lignes = [...lignes].reverse();
    // Comment un rendez-vous passé s'est conclu : la seule chose qui compte pour mesurer la
    // transformation. « Reporté » = compte rendu « RDV décalé » ; sans compte rendu, on ne
    // sait pas s'il a eu lieu.
    const conclusion = (x) => {
      if (rdvAnnule(x)) return 'annulé';
      if (!rdvPasse(x)) return '';
      if (x.compte_rendu === 'decale') return 'reporté';
      if (x.compte_rendu || x.statut === 'termine') return 'honoré';
      return 'sans compte rendu';
    };

    const prenoms = await prenomsEquipe();
    const limite = borner(a.limite, LIMITE_DEFAUT, LIMITE_MAX);
    const titres = { a_venir: 'Rendez-vous à venir', passes: 'Rendez-vous passés', sans_compte_rendu: 'Rendez-vous sans compte rendu', tous: 'Rendez-vous' };
    const quandPris = a.pris_du || a.pris_au ? `pris ${a.pris_du && a.pris_au && a.pris_du !== a.pris_au ? `du ${dateFr(a.pris_du, { relatif: false })} au ${dateFr(a.pris_au, { relatif: false })}` : `le ${dateFr(a.pris_du || a.pris_au, { relatif: false })}`}` : '';
    return {
      resultats: lignes.length,
      texte: bloc(
        entete(ligne(titres[quand], a.commercial && `pour ${a.commercial}`, a.pris_par && `pris par ${a.pris_par}`, quandPris), Math.min(limite, lignes.length), lignes.length),
        '',
        lignes.slice(0, limite).map(x => ligne(
          dateFr(x.date),
          x.heure_debut || '',
          nommer(x.nom_client || x.nom_etablissement || 'Rendez-vous', x.ville_client || x.ville_prospect),
          x.nom_client ? 'client' : 'prospect',
          `pour ${prenoms.get(x.commercial_id) || '?'}`,
          x.prospecteur_id && x.prospecteur_id !== x.commercial_id ? `pris par ${prenoms.get(x.prospecteur_id) || '?'}` : '',
          x.created_at ? `pris le ${ligne(dateFr(x.created_at, { relatif: false }), heureParis(x.created_at))}` : '',
          conclusion(x) || (x.statut !== 'planifie' ? lib(LIBELLES_STATUT_RDV, x.statut) : ''),
          x.lieu ? `lieu ${x.lieu}` : '',
          x.compte_rendu && x.compte_rendu !== 'decale' ? `résultat : ${lib(LIBELLES_RESULTAT_RDV, x.compte_rendu)}` : '',
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
      // Les jours sont ceux de Paris (le serveur vit en UTC), comme dans journal_prospection :
      // les deux outils doivent donner les mêmes nombres.
      db.query(`SELECT commercial_id, ${jourParisSql('date')} AS jour, resultat, COUNT(*)::int AS n FROM calls
                 WHERE ${jourParisSql('date')} BETWEEN $1 AND $2${filtre('commercial_id')} GROUP BY 1,2,3`, params),
      // Une interaction « compte » quand elle a valu une visite (règle partagée shared/activite).
      db.query(`SELECT commercial_id, ${jourParisSql('date')} AS jour, type, COALESCE(compte_visite, type = 'VISITE') AS compte, COUNT(*)::int AS n FROM interactions
                 WHERE ${jourParisSql('date')} BETWEEN $1 AND $2${filtre('commercial_id')} GROUP BY 1,2,3,4`, params),
      // RDV pris : la règle partagée (prospect, date de prise, non annulé, au nom de qui l'a pris).
      db.query(`SELECT ${SQL_QUI_A_PRIS} AS commercial_id, ${jourParisSql('created_at')} AS jour, COUNT(*)::int AS n
                  FROM appointments WHERE ${SQL_RDV_PRIS} AND ${jourParisSql('created_at')} BETWEEN $1 AND $2${filtre(SQL_QUI_A_PRIS)} GROUP BY 1,2`, params),
      db.query(`SELECT commercial_id, left(date, 10) AS jour, COUNT(*)::int AS n FROM appointments
                 WHERE compte_rendu <> '' AND left(date, 10) BETWEEN $1 AND $2${filtre('commercial_id')} GROUP BY 1,2`, params),
      db.query(`SELECT commercial_id, ${jourParisSql('date_creation')} AS jour, COUNT(*)::int AS n FROM prospects
                 WHERE ${jourParisSql('date_creation')} BETWEEN $1 AND $2${filtre('commercial_id')} GROUP BY 1,2`, params),
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
      // Visite = ce qui a compté comme telle (sur place, ou appel abouti) ; appel = type APPEL ;
      // un rendez-vous planifié n'est ni l'un ni l'autre.
      if (r.compte) ajouter(k, 'visites', r.n);
      if (r.type === 'APPEL') { ajouter(k, 'appels', r.n); if (r.compte) ajouter(k, 'aboutis', r.n); }
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
