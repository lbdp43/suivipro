// Le journal de prospection : tout ce qui a été fait sur les PROSPECTS, dans l'ordre, pour
// une personne et une période. « activite » compte ; ici on raconte : à qui on a parlé,
// ce qui s'est dit, ce que ça a changé.
//
// Un appel entraîne souvent un changement d'étape, un rendez-vous ou une prochaine action
// dans la même minute : ils sont rattachés à la ligne de l'appel (même prospect, même
// personne, un quart d'heure autour) plutôt que listés à part. Les heures sont celles de
// Paris. Lecture seule ; le journal d'un collègue est réservé aux administrateurs, comme
// « mes_actions ».
import { z } from 'zod';
import db from '../../db.js';
import { dateLocale } from '../../../shared/regles.js';
import { LIBELLES_ETAPE, LIBELLES_TYPE_ETABLISSEMENT } from '../../../shared/libelles.js';
import { RAISONS_PERTE, TYPES_ACTION } from '../../../shared/tunnel.js';
import { estAdmin, trouverCommercial, equipe, HorsPerimetre } from '../perimetre.js';
import { borner, dateFr, heureParis, jourParis, ligne, bloc, extrait, lib, nommer } from '../format.js';
import { jourParisSql, clauseTexte } from '../sql.js';

const dateValide = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(d));

const LIMITE_DEFAUT = 100;
const LIMITE_MAX = 500;
/** Ce qui suit un appel dans ce délai lui appartient. */
const FENETRE_MS = 15 * 60 * 1000;

const TYPES = ['tout', 'appel', 'mail', 'rdv_pris', 'changement_etape', 'note', 'prospect_cree'];
/** Les résultats tels qu'on les demande, et ce que l'écran d'appel enregistre. */
const RESULTATS = { abouti: 'repondu', repondeur: 'messagerie', pas_de_reponse: 'pas_de_reponse', numero_faux: 'injoignable' };
const LIBELLE_RESULTAT = { repondu: 'abouti', messagerie: 'répondeur', pas_de_reponse: 'pas de réponse', injoignable: 'injoignable' };
const ETAPES_REFUS = ['perdu', 'ne_pas_contacter'];

const ts = (valeur) => { const d = new Date(valeur); return Number.isNaN(d.getTime()) ? null : d.getTime(); };
const proche = (a, b) => a !== null && b !== null && Math.abs(a - b) <= FENETRE_MS;
const typeCourt = (code) => (LIBELLES_TYPE_ETABLISSEMENT[code] || code || '').toLowerCase();
const fiche = (x) => (x.nom_etablissement ? `${x.nom_etablissement} (${[x.ville, typeCourt(x.type_etablissement)].filter(Boolean).join(', ')})` : 'prospect supprimé');
const duree = (s) => (s > 0 ? (s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`) : '');

/** D'où vient une fiche : la boîte, une fiche partagée (Google Maps), un import, la main. */
function sourceDe(p, { signales, crees, premieresEtapes }) {
  if (signales.has(p.id)) return 'boîte de prospection';
  const details = crees.get(p.id);
  if (/fiche partag/i.test(details || '') || p.source_url) return 'fiche partagée (module prospecteur)';
  if (details !== undefined) return 'saisie manuelle';
  const premiere = premieresEtapes.get(p.id) || p.etape_pipeline;
  if (premiere === 'nouveau_datagouv' || /^(dg|datagouv|sirene|sir)-/.test(p.id)) return 'import SIRENE / data.gouv';
  return 'import de fichier';
}

const journal = {
  nom: 'journal_prospection',
  titre: 'Le journal de prospection',
  description: 'Tout ce qui a été fait sur les prospects, dans l\'ordre, pour une personne et une période : chaque appel avec son résultat, l\'interlocuteur, le commentaire, le changement d\'étape, la prochaine action et le rendez-vous pris dans la foulée ; les mails, les rendez-vous pris, les changements d\'étape, les fiches modifiées, les prospects créés et leur source. En tête, le résumé par personne (appels par résultat, premier et dernier appel, rendez-vous pris, refus et leurs raisons), cohérent avec « activite ». Pour raconter la journée de quelqu\'un, c\'est cet outil.',
  schema: {
    qui: z.string().optional().describe('Le prénom de l\'auteur des actions (Noa, Tony…) ; sinon toute l\'équipe. Lire le journal d\'un collègue est réservé aux administrateurs.'),
    du: z.string().optional().describe('Premier jour, AAAA-MM-JJ ; aujourd\'hui par défaut.'),
    au: z.string().optional().describe('Dernier jour inclus, AAAA-MM-JJ ; le même jour que « du » par défaut.'),
    type: z.enum(TYPES).optional().describe('« tout » par défaut. « note » = modification de la fiche.'),
    resultat: z.enum(['abouti', 'repondeur', 'pas_de_reponse', 'numero_faux', 'a_rappeler', 'refus']).optional()
      .describe('Ne garder que les appels avec ce résultat. « a_rappeler » : un rappel a été programmé dans la foulée ; « refus » : le prospect est passé en perdu ou ne pas contacter.'),
    secteur: z.string().optional().describe('Un secteur ou une zone (tournée), par son nom.'),
    limite: z.number().optional().describe(`Nombre de lignes, ${LIMITE_DEFAUT} par défaut, ${LIMITE_MAX} au maximum.`),
  },
  executer: async (a, { utilisateur }) => {
    // Qui : soi, ou — pour l'administrateur — la personne nommée, ou toute l'équipe.
    let ids = estAdmin(utilisateur) ? null : [utilisateur.id];
    let cible = null;
    if (a.qui) {
      cible = await trouverCommercial(a.qui);
      if (!estAdmin(utilisateur) && cible.id !== utilisateur.id) {
        throw new HorsPerimetre('Le journal d\'un collègue est réservé aux administrateurs : vous ne pouvez lire que le vôtre.');
      }
      ids = [cible.id];
    }
    const du = a.du || dateLocale();
    const au = a.au || du;
    if (!dateValide(du) || !dateValide(au)) throw new HorsPerimetre('Les dates se donnent au format AAAA-MM-JJ.');
    if (au < du) throw new HorsPerimetre('« au » est avant « du ».');
    const type = a.resultat ? 'appel' : (a.type || 'tout');
    const veut = (t) => type === 'tout' || type === t;

    // Les mêmes bornes pour toutes les requêtes : $1 = du, $2 = au, puis le filtre de personne
    // et de secteur, dans cet ordre.
    const params = [du, au];
    let filtreQui = '';
    if (ids) { params.push(ids); filtreQui = ` AND ${'%QUI%'} = ANY($${params.length})`; }
    const filtreSecteur = clauseTexte(['p.secteur', 'z.nom'], a.secteur, params);
    const qui = (champ) => filtreQui.replace('%QUI%', champ);
    const PROSPECT = `LEFT JOIN prospects p ON p.id = %PID% LEFT JOIN commercial_zones z ON z.id = p.zone_id`;
    const champsProspect = 'p.nom_etablissement, p.ville, p.secteur, p.type_etablissement, p.nom_contact, p.source_url, p.etape_pipeline';
    const jointure = (pid) => PROSPECT.replace('%PID%', pid);

    const [appels, rdvs, etapes, crees, notes, rappels, appelsClients, rdvClients] = await Promise.all([
      veut('appel') || veut('mail') ? db.query(
        `SELECT c.*, ${champsProspect} FROM calls c ${jointure('c.prospect_id')}
          WHERE ${jourParisSql('c.date')} BETWEEN $1 AND $2${qui('c.commercial_id')}${filtreSecteur}`, params) : { rows: [] },
      // Pris pour un prospect ; celui qui l'a décroché en est l'auteur.
      db.query(
        `SELECT r.*, ${champsProspect}, COALESCE(r.prospecteur_id, r.commercial_id) AS auteur FROM appointments r ${jointure('r.prospect_id')}
          WHERE r.prospect_id IS NOT NULL AND r.prospect_id <> '' AND NULLIF(r.created_at, '') IS NOT NULL
            AND ${jourParisSql('r.created_at')} BETWEEN $1 AND $2${qui('COALESCE(r.prospecteur_id, r.commercial_id)')}${filtreSecteur}`, params),
      db.query(
        `SELECT e.*, ${champsProspect} FROM prospect_etapes e ${jointure('e.prospect_id')}
          WHERE ${jourParisSql('e.date')} BETWEEN $1 AND $2${qui('e.commercial_id')}${filtreSecteur}`, params),
      veut('prospect_cree') ? db.query(
        `SELECT p.id, p.commercial_id, p.date_creation, ${champsProspect} FROM prospects p LEFT JOIN commercial_zones z ON z.id = p.zone_id
          WHERE ${jourParisSql('p.date_creation')} BETWEEN $1 AND $2${qui('p.commercial_id')}${filtreSecteur}`, params) : { rows: [] },
      veut('note') ? db.query(
        `SELECT l.user_id AS commercial_id, l.created_at, l.details, l.entity_id AS prospect_id, ${champsProspect}
           FROM activity_log l ${jointure('l.entity_id')}
          WHERE l.action = 'modification_prospect' AND l.entity_type = 'prospect'
            AND ${jourParisSql('l.created_at::text')} BETWEEN $1 AND $2${qui('l.user_id')}${filtreSecteur}`, params) : { rows: [] },
      // Les rappels créés sur la période, pour les rattacher à l'appel qui les a provoqués.
      db.query(
        `SELECT r.id, r.prospect_id, r.commercial_id, r.date, r.type, r.created_at FROM reminders r
          WHERE NULLIF(r.created_at, '') IS NOT NULL AND ${jourParisSql('r.created_at')} BETWEEN $1 AND $2${qui('r.commercial_id')}`, ids ? params.slice(0, 3) : params.slice(0, 2)),
      // Pour que le total colle à « activite », qui compte aussi les appels chez les clients.
      db.query(
        `SELECT commercial_id, COUNT(*)::int AS n FROM interactions
          WHERE type = 'APPEL' AND ${jourParisSql('date')} BETWEEN $1 AND $2${qui('commercial_id')} GROUP BY 1`, ids ? params.slice(0, 3) : params.slice(0, 2)),
      db.query(
        `SELECT COALESCE(prospecteur_id, commercial_id) AS auteur, COUNT(*)::int AS n FROM appointments
          WHERE (prospect_id IS NULL OR prospect_id = '') AND ${jourParisSql("COALESCE(NULLIF(created_at, ''), date)")} BETWEEN $1 AND $2${qui('COALESCE(prospecteur_id, commercial_id)')} GROUP BY 1`, ids ? params.slice(0, 3) : params.slice(0, 2)),
    ]);

    // D'où viennent les fiches créées.
    let sources = { signales: new Set(), crees: new Map(), premieresEtapes: new Map() };
    if (crees.rows.length) {
      const idsCrees = crees.rows.map(p => p.id);
      const [sig, log, prem] = await Promise.all([
        db.query('SELECT prospect_id FROM signalements WHERE prospect_id = ANY($1)', [idsCrees]),
        db.query("SELECT entity_id, details FROM activity_log WHERE action = 'creation_prospect' AND entity_id = ANY($1)", [idsCrees]),
        db.query('SELECT DISTINCT ON (prospect_id) prospect_id, vers FROM prospect_etapes WHERE prospect_id = ANY($1) ORDER BY prospect_id, date', [idsCrees]),
      ]);
      sources = {
        signales: new Set(sig.rows.map(r => r.prospect_id)),
        crees: new Map(log.rows.map(r => [r.entity_id, r.details || ''])),
        premieresEtapes: new Map(prem.rows.map(r => [r.prospect_id, r.vers])),
      };
    }

    const prenoms = new Map((await equipe()).map(g => [g.id, g.prenom]));
    const prenom = (id) => prenoms.get(id) || '?';
    const plusieurs = !ids || ids.length > 1;
    const libEtape = (code) => lib(LIBELLES_ETAPE, code);

    // Chaque appel prend ce qui s'est passé autour de lui ; le reste est listé à part.
    const prisEtapes = new Set(); const prisRdv = new Set(); const prisRappels = new Set();
    const autour = (liste, pris, c, cle = 'date') => liste.filter(x => x.prospect_id === c.prospect_id && !pris.has(x.id)
      && (x.auteur || x.commercial_id) === c.commercial_id && proche(ts(x[cle]), ts(c.date)));

    const evenements = [];
    for (const c of appels.rows) {
      const mail = c.resultat === 'email_envoye';
      if (mail ? !veut('mail') : !veut('appel')) continue;
      const etapesLiees = autour(etapes.rows, prisEtapes, c);
      const rdvLies = autour(rdvs.rows, prisRdv, c, 'created_at');
      const rappelsLies = autour(rappels.rows, prisRappels, c, 'created_at');
      const refus = etapesLiees.find(e => ETAPES_REFUS.includes(e.vers));
      const aRappeler = rappelsLies.some(r => (r.type || 'appeler') === 'appeler');
      if (a.resultat) {
        if (mail) continue;
        const ok = a.resultat === 'a_rappeler' ? aRappeler : a.resultat === 'refus' ? !!refus : c.resultat === RESULTATS[a.resultat];
        if (!ok) continue;
      }
      etapesLiees.forEach(e => prisEtapes.add(e.id)); rdvLies.forEach(r => prisRdv.add(r.id)); rappelsLies.forEach(r => prisRappels.add(r.id));
      evenements.push({
        t: ts(c.date), auteur: c.commercial_id, genre: mail ? 'mail' : 'appel', resultat: c.resultat, refus,
        rdv: rdvLies.length, prospect: c.prospect_id,
        texte: ligne(
          mail ? 'mail' : 'appel',
          mail ? '' : LIBELLE_RESULTAT[c.resultat] || c.resultat,
          fiche(c),
          mail ? '' : (c.nom_contact || '—'),
          c.notes ? `« ${extrait(c.notes, 160)} »` : '',
          duree(c.duree),
          c.origine === 'rappel' ? 'depuis un rappel' : '',
          ...etapesLiees.map(e => `${e.de ? `${libEtape(e.de)} -> ` : '-> '}${libEtape(e.vers)}${e.raison ? ` (raison : ${lib(RAISONS_PERTE, e.raison)})` : ''}`),
          ...rdvLies.map(r => `RDV ${dateFr(r.date, { relatif: false })} ${r.heure_debut || ''} pour ${prenom(r.commercial_id)}`.replace(/\s+/g, ' ')),
          ...rappelsLies.map(r => `prochaine action : ${(TYPES_ACTION[r.type || 'appeler'] || 'à faire').toLowerCase()} ${dateFr(r.date, { relatif: false })}`),
        ),
      });
    }
    if (veut('rdv_pris')) for (const r of rdvs.rows) {
      if (prisRdv.has(r.id)) continue;
      evenements.push({ t: ts(r.created_at), auteur: r.auteur, genre: 'rdv_pris', rdv: 1, prospect: r.prospect_id,
        texte: ligne('RDV pris', fiche(r), `RDV ${dateFr(r.date, { relatif: false })} ${r.heure_debut || ''} pour ${prenom(r.commercial_id)}`.replace(/\s+/g, ' '), r.lieu ? `lieu ${r.lieu}` : '', extrait(r.notes, 120)) });
    }
    if (veut('changement_etape')) for (const e of etapes.rows) {
      if (prisEtapes.has(e.id)) continue;
      const refus = ETAPES_REFUS.includes(e.vers) ? e : null;
      evenements.push({ t: ts(e.date), auteur: e.commercial_id, genre: 'changement_etape', refus, prospect: e.prospect_id,
        texte: ligne('étape', fiche(e), `${e.de ? `${libEtape(e.de)} -> ` : '-> '}${libEtape(e.vers)}`, e.raison ? `raison : ${lib(RAISONS_PERTE, e.raison)}` : '') });
    }
    for (const n of notes.rows) {
      evenements.push({ t: ts(n.created_at), auteur: n.commercial_id, genre: 'note', prospect: n.prospect_id,
        texte: ligne('fiche modifiée', fiche(n), extrait(n.details, 120)) });
    }
    for (const p of crees.rows) {
      evenements.push({ t: ts(p.date_creation), auteur: p.commercial_id, genre: 'prospect_cree', prospect: p.id,
        texte: ligne('prospect créé', fiche(p), `source : ${sourceDe(p, sources)}`, p.secteur ? `secteur ${p.secteur}` : '') });
    }
    evenements.sort((x, y) => (x.t || 0) - (y.t || 0));

    // Le résumé par personne, sur tout ce qui a été trouvé (pas seulement les lignes montrées).
    // Appels et aboutis sont comptés comme dans « activite » : les mails à part, un appel
    // sans réponse n'est pas abouti.
    const resume = new Map();
    const de = (id) => { if (!resume.has(id)) resume.set(id, { appels: 0, parResultat: {}, mails: 0, premier: null, dernier: null, rdv: 0, refus: [], crees: 0, notes: 0 }); return resume.get(id); };
    if (ids) ids.forEach(de);
    for (const e of evenements) {
      const s = de(e.auteur);
      if (e.genre === 'appel') {
        s.appels += 1; s.parResultat[e.resultat] = (s.parResultat[e.resultat] || 0) + 1;
        if (e.t !== null) { if (s.premier === null || e.t < s.premier) s.premier = e.t; if (s.dernier === null || e.t > s.dernier) s.dernier = e.t; }
      }
      if (e.genre === 'mail') s.mails += 1;
      if (e.rdv) s.rdv += e.rdv;
      if (e.refus) s.refus.push(e.refus.raison ? lib(RAISONS_PERTE, e.refus.raison) : (e.refus.vers === 'ne_pas_contacter' ? 'ne pas contacter' : 'sans raison'));
      if (e.genre === 'prospect_cree') s.crees += 1;
      if (e.genre === 'note') s.notes += 1;
    }
    const clients = new Map(appelsClients.rows.map(r => [r.commercial_id, r.n]));
    const rdvClientsPar = new Map(rdvClients.rows.map(r => [r.auteur, r.n]));
    const compter = (liste) => { const m = new Map(); liste.forEach(x => m.set(x, (m.get(x) || 0) + 1)); return [...m.entries()].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(', '); };
    const lignesResume = [...resume.entries()]
      .sort((x, y) => prenom(x[0]).localeCompare(prenom(y[0])))
      .map(([id, s]) => ligne(
        prenom(id),
        `${s.appels} appel(s)${s.appels ? ` (${['repondu', 'messagerie', 'pas_de_reponse', 'injoignable'].filter(r => s.parResultat[r]).map(r => `${s.parResultat[r]} ${LIBELLE_RESULTAT[r]}`).join(', ')})` : ''}`,
        s.mails ? `${s.mails} mail(s)` : '',
        s.rdv ? `${s.rdv} RDV pris` : '',
        s.refus.length ? `${s.refus.length} refus (${compter(s.refus)})` : '',
        s.crees ? `${s.crees} prospect(s) créé(s)` : '',
        s.notes ? `${s.notes} fiche(s) modifiée(s)` : '',
        s.premier !== null ? `${heureParis(new Date(s.premier).toISOString())} -> ${heureParis(new Date(s.dernier).toISOString())}` : '',
        clients.get(id) ? `+ ${clients.get(id)} appel(s) chez des clients (voir visites_et_appels)` : '',
        rdvClientsPar.get(id) ? `+ ${rdvClientsPar.get(id)} RDV client(s)` : '',
      ));

    // Les lignes, par jour.
    const limite = borner(a.limite, LIMITE_DEFAUT, LIMITE_MAX);
    const montres = evenements.slice(0, limite);
    const parJour = new Map();
    for (const e of montres) {
      const j = e.t !== null ? jourParis(new Date(e.t).toISOString()) : du;
      if (!parJour.has(j)) parJour.set(j, []);
      parJour.get(j).push(e);
    }
    const periode = du === au ? dateFr(du, { relatif: false }) : `du ${dateFr(du, { relatif: false })} au ${dateFr(au, { relatif: false })}`;
    const filtres = ligne(type !== 'tout' ? `type ${type}` : '', a.resultat ? `résultat ${a.resultat}` : '', a.secteur ? `secteur ${a.secteur}` : '');
    const titre = `Journal de prospection — ${cible ? cible.prenom : (ids ? prenom(ids[0]) : 'toute l\'équipe')} — ${periode}${filtres ? ` (${filtres})` : ''}`;
    return {
      resultats: evenements.length,
      texte: bloc(
        titre,
        lignesResume.length ? 'Résumé :' : 'Résumé : rien sur la période.',
        ...lignesResume.map(l => `- ${l}`),
        '',
        evenements.length === 0 ? 'Aucune action sur les prospects sur la période.' : (montres.length < evenements.length ? `${montres.length} lignes sur ${evenements.length} (affinez la période ou le type pour voir les autres)` : `${evenements.length} ligne(s)`),
        ...[...parJour.entries()].flatMap(([j, lignes]) => [
          parJour.size > 1 ? `\n## ${dateFr(j, { relatif: false })}` : '',
          ...lignes.map(e => ligne(e.t !== null ? heureParis(new Date(e.t).toISOString()) : '', plusieurs ? prenom(e.auteur) : '', e.texte)),
        ]),
      ),
    };
  },
};

export default [journal];
