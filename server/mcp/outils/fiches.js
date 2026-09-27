// Tenir ses fiches à jour depuis Claude : désactiver ou réactiver des clients, régler leur
// récurrence de visite, changer l'étape de prospects.
//
// Mêmes règles que l'application : l'étape passe par lib/tunnel.js (historique, date
// d'étape, raison de perte, journal) ; la prochaine visite se calcule par
// lib/visites.js (fréquence du client, sinon celle de son type). Chacun agit sur ses
// fiches — l'administrateur sur toutes ; la prospection change l'étape des prospects,
// qu'elle travaille pour toute l'équipe, mais ne touche pas aux clients. Tout se fait en
// deux temps : un aperçu sans rien écrire, puis la confirmation.
import { z } from 'zod';
import db from '../../db.js';
import { normaliserPourComparaison } from '../../../shared/normalisation.js';
import { LIBELLES_TYPE_CLIENT, FREQUENCES_VISITE } from '../../../shared/libelles.js';
import { RAISONS_PERTE } from '../../../shared/tunnel.js';
import { changerEtape } from '../../lib/tunnel.js';
import { calculateNextVisit } from '../../lib/visites.js';
import { logActivity } from '../../lib/journal.js';
import { journaliserRefus } from '../journal.js';
import { estAdmin, faitDeLaProspection, HorsPerimetre } from '../perimetre.js';
import { clauseTexte } from '../sql.js';
import { dateFr, ligne, bloc, nommer, lib } from '../format.js';
import { chargerClients } from './clients.js';
import { libellesEtapes, codesDEtape } from './prospects.js';
import { CONFIRMER, deuxTemps } from './suivi.js';

/** Une demande qu'on ne peut pas exécuter telle quelle : la réponse dit quoi corriger. */
export class ModificationRefusee extends Error {}

const MAX_NOMMES = 30;    // clients ou prospects désignés un par un
const MAX_GROUPE = 300;   // clients désignés par un groupe (tournée, type, ville)
const dateValide = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(d));

// ---------------------------------------------------------------------------------------
// Choisir les clients : par nom ou référence, ou tout un groupe.

const SELECTION_CLIENTS = {
  clients: z.array(z.string()).optional().describe(`Les clients désignés un par un, par nom ou référence (réf.) — ${MAX_NOMMES} au plus. Sinon, un groupe avec tournee / type / ville.`),
  tournee: z.string().optional().describe('Tout un groupe : les clients de cette tournée.'),
  type: z.string().optional().describe('Tout un groupe : les clients de ce type (bar, cave, distributeur…).'),
  ville: z.string().optional().describe('Tout un groupe : les clients de cette ville (ou code postal).'),
  commercial: z.string().optional().describe('Administrateur seulement, pour un groupe : les clients de ce collègue. Sinon, un commercial agit sur les siens.'),
};

/** Un client du périmètre d'écriture : les siens, tous pour l'administrateur. */
async function unClient(utilisateur, recherche, outil) {
  const parId = (await db.query('SELECT * FROM clients WHERE id = $1', [recherche])).rows[0];
  if (parId) {
    if (!estAdmin(utilisateur) && parId.commercial_id !== utilisateur.id) {
      throw new HorsPerimetre(`${parId.nom} n'est pas l'un de vos clients : seul son commercial (ou un administrateur) le modifie.`);
    }
    return parId;
  }
  const trouves = await chargerClients(utilisateur, null, outil, { texte: recherche });
  const q = normaliserPourComparaison(recherche);
  const exacts = trouves.filter(c => normaliserPourComparaison(c.nom) === q);
  const candidats = exacts.length ? exacts : trouves;
  if (candidats.length === 1) return candidats[0];
  if (candidats.length > 1) {
    throw new ModificationRefusee(`plusieurs clients correspondent à « ${recherche} » : ${candidats.slice(0, 5).map(c => `réf. ${c.id} ${nommer(c.nom, c.ville)}`).join(', ')}`);
  }
  const params = [];
  const ailleurs = await db.query(`SELECT COUNT(*)::int AS n FROM clients WHERE 1=1${clauseTexte(['nom'], recherche, params)}`, params);
  if (!estAdmin(utilisateur) && ailleurs.rows[0]?.n > 0) {
    throw new HorsPerimetre(`« ${recherche} » existe, mais n'est pas l'un de vos clients : seul son commercial (ou un administrateur) le modifie.`);
  }
  throw new ModificationRefusee(`aucun client ne correspond à « ${recherche} »`);
}

/**
 * Les clients visés, et les lignes qui bloquent. Rien ne s'écrit tant qu'une ligne bloque :
 * l'aperçu les montre à leur place.
 */
async function choisirClients(utilisateur, a, outil) {
  if (faitDeLaProspection(utilisateur)) {
    throw new HorsPerimetre('Les clients ne font pas partie de votre périmètre : la prospection ne désactive pas de client et ne règle pas leurs visites.');
  }
  const parGroupe = a.tournee || a.type || a.ville;
  if (a.clients?.length && parGroupe) throw new ModificationRefusee('Désignez les clients soit un par un (« clients »), soit par groupe (tournée, type, ville) — pas les deux à la fois.');
  if (a.commercial && !estAdmin(utilisateur)) throw new HorsPerimetre('Vous agissez sur vos propres clients ; seul un administrateur agit sur ceux d\'un collègue.');

  if (a.clients?.length) {
    if (a.clients.length > MAX_NOMMES) throw new ModificationRefusee(`${MAX_NOMMES} clients au plus quand on les nomme un par un : coupez la liste, ou désignez-les par groupe.`);
    const choisis = []; const bloques = []; const vus = new Set();
    for (const [n, recherche] of a.clients.entries()) {
      try {
        const c = await unClient(utilisateur, recherche, outil);
        if (vus.has(c.id)) throw new ModificationRefusee(`${c.nom} figure deux fois dans la liste`);
        vus.add(c.id);
        choisis.push(c);
      } catch (err) {
        if (!(err instanceof ModificationRefusee || err instanceof HorsPerimetre)) throw err;
        if (err instanceof HorsPerimetre) await journaliserRefus(utilisateur, outil, err.message);
        bloques.push(`${n + 1}. ${recherche} — ${err.message}`);
      }
    }
    return { choisis, bloques, groupe: null };
  }
  if (!parGroupe) throw new ModificationRefusee('Quels clients ? Nommez-les (« clients »), ou désignez un groupe : une tournée, un type, une ville.');
  const choisis = await chargerClients(utilisateur, a.commercial, outil, { tournee: a.tournee, type: a.type, ville: a.ville });
  const groupe = ligne(a.tournee && `tournée « ${a.tournee} »`, a.type && `type « ${a.type} »`, a.ville && `ville « ${a.ville} »`);
  if (!choisis.length) throw new ModificationRefusee(`Aucun de vos clients ne correspond : ${groupe}.`);
  if (choisis.length > MAX_GROUPE) throw new ModificationRefusee(`${choisis.length} clients dans ce groupe : c'est plus que ${MAX_GROUPE}. Resserrez (une tournée, un type, une ville).`);
  return { choisis, bloques: [], groupe };
}

/** L'aperçu : un bloc « rien d'enregistré » avec une ligne par client, tronqué au-delà de 40. */
function apercu(tete, lignes, bloques) {
  if (bloques.length) {
    return { resultats: 0, texte: bloc(`${bloques.length} ligne(s) bloquent : rien n'est enregistré. Corrigez-les (ou retirez-les) puis rappelez l'outil.`, ...bloques) };
  }
  const montrees = lignes.slice(0, 40);
  const reste = lignes.length - montrees.length;
  return { resultats: 0, texte: deuxTemps([tete, ...montrees, ...(reste > 0 ? [`… et ${reste} autre(s) client(s) du groupe.`] : [])]) };
}

const frequenceDuType = async (type) => {
  try {
    const r = await db.query('SELECT frequency_days FROM visit_frequency_config WHERE type_client = $1', [type]);
    if (r.rows[0]?.frequency_days != null) return r.rows[0].frequency_days;
  } catch { /* la table des réglages manque : les fréquences par défaut suffisent */ }
  return FREQUENCES_VISITE[type] ?? null;
};

const texteFrequence = (jours) => (jours ? `tous les ${jours} jours` : 'sans récurrence');

// ---------------------------------------------------------------------------------------
const activer = {
  nom: 'activer_ou_desactiver_client',
  titre: 'Désactiver ou réactiver des clients',
  ecrit: true,
  description: `Passe des clients en inactif (ils sortent du calendrier des visites, de la carte et des retards ; leur prochaine visite est effacée) ou les réactive (la prochaine visite est recalculée d'après leur fréquence et leur dernière visite). Rien n'est supprimé : l'historique reste. Clients désignés un par un (${MAX_NOMMES} au plus) ou par groupe (tournée, type, ville). Un commercial agit sur ses clients, l'administrateur sur tous ; la prospection n'y a pas accès. En deux temps : sans « confirmer », l'aperçu liste ce qui va changer ; « confirmer: true » seulement après l'accord de la personne.`,
  schema: {
    action: z.enum(['desactiver', 'reactiver']).describe('« desactiver » : client inactif. « reactiver » : client de nouveau actif.'),
    ...SELECTION_CLIENTS,
    confirmer: CONFIRMER,
  },
  executer: async (a, { utilisateur }) => {
    const { choisis, bloques, groupe } = await choisirClients(utilisateur, a, 'activer_ou_desactiver_client');
    const actif = a.action === 'reactiver';
    const plans = [];
    const lignes = [];
    for (const c of choisis) {
      if ((c.statut === 'INACTIF') !== actif) { lignes.push(`${nommer(c.nom, c.ville)} : déjà ${actif ? 'actif' : 'inactif'}, rien à changer`); continue; }
      const prochaine = actif ? (c.next_visit || await calculateNextVisit(c.type_client, c.custom_recurrence, c.last_visit)) : null;
      plans.push({ c, prochaine });
      lignes.push(actif
        ? `${nommer(c.nom, c.ville)} : réactivé${prochaine ? `, prochaine visite le ${dateFr(prochaine, { relatif: false })}` : ', sans récurrence (aucune prochaine visite)'}`
        : `${nommer(c.nom, c.ville)} : désactivé${c.next_visit ? ` (la visite prévue le ${dateFr(c.next_visit, { relatif: false })} est effacée)` : ''}`);
    }
    const tete = `${plans.length} client(s) à ${actif ? 'réactiver' : 'désactiver'}${groupe ? ` — ${groupe}` : ''}${choisis.length > plans.length ? ` (${choisis.length - plans.length} déjà ${actif ? 'actif(s)' : 'inactif(s)'})` : ''} :`;
    if (!a.confirmer || bloques.length) return apercu(tete, lignes, bloques);
    if (!plans.length) return { resultats: 0, texte: 'Rien à changer : ces clients sont déjà dans cet état.' };

    const maintenant = new Date().toISOString();
    for (const { c, prochaine } of plans) {
      await db.query('UPDATE clients SET statut = $1, next_visit = $2, date_modification = $3 WHERE id = $4', [actif ? 'ACTIF' : 'INACTIF', prochaine, maintenant, c.id]);
      await logActivity(utilisateur.id, actif ? 'client_reactive' : 'client_desactive', `${c.nom} ${actif ? 'réactivé' : 'désactivé'} (via Claude)`, 'client', c.id);
    }
    return { resultats: plans.length, texte: bloc(`${plans.length} client(s) ${actif ? 'réactivé(s)' : 'désactivé(s)'} dans SuiviPro :`, ...lignes.map(l => `- ${l}`)) };
  },
};

// ---------------------------------------------------------------------------------------
const recurrence = {
  nom: 'regler_recurrence',
  titre: 'Régler la récurrence de visite de clients',
  ecrit: true,
  description: `Règle tous les combien de jours on visite des clients, et leur prochaine visite. « frequence » : un nombre de jours (ex. 21), « type » pour revenir à la fréquence de leur type de client (15 j pour un bar, 30 j pour une cave… voir « contexte » sujet frequences), ou « aucune » pour ne plus les planifier. La prochaine visite est recalculée depuis la dernière visite, sauf si « prochaine_visite » donne une date. Clients désignés un par un (${MAX_NOMMES} au plus) ou par groupe (tournée, type, ville). Un commercial agit sur ses clients, l'administrateur sur tous ; la prospection n'y a pas accès. En deux temps : sans « confirmer », l'aperçu montre pour chaque client l'ancienne et la nouvelle fréquence et la prochaine visite ; « confirmer: true » seulement après l'accord de la personne.`,
  schema: {
    frequence: z.union([z.number().int().min(1).max(365), z.enum(['type', 'aucune'])]).optional()
      .describe('Nombre de jours entre deux visites (1 à 365), « type » (la fréquence de leur type) ou « aucune ». Laisser vide pour ne changer que la prochaine visite.'),
    prochaine_visite: z.string().optional().describe('AAAA-MM-JJ : la date de la prochaine visite, pour tous les clients désignés. Sinon, elle est recalculée depuis la dernière visite quand la fréquence change.'),
    ...SELECTION_CLIENTS,
    confirmer: CONFIRMER,
  },
  executer: async (a, { utilisateur }) => {
    if (a.frequence == null && !a.prochaine_visite) throw new ModificationRefusee('Que faut-il régler ? Une fréquence (« frequence »), une prochaine visite (« prochaine_visite »), ou les deux.');
    if (a.prochaine_visite && !dateValide(a.prochaine_visite)) throw new ModificationRefusee('La prochaine visite s\'écrit AAAA-MM-JJ.');
    if (a.prochaine_visite && a.frequence === 'aucune') throw new ModificationRefusee('« aucune » récurrence et une prochaine visite se contredisent : choisissez l\'une ou l\'autre.');
    const { choisis, bloques, groupe } = await choisirClients(utilisateur, a, 'regler_recurrence');

    const plans = [];
    const lignes = [];
    for (const c of choisis) {
      const avantJours = c.custom_recurrence === 0 ? null : (c.custom_recurrence || await frequenceDuType(c.type_client));
      // null = la fréquence du type ; 0 = aucune récurrence ; sinon un nombre de jours.
      const custom = a.frequence == null ? c.custom_recurrence : a.frequence === 'type' ? null : a.frequence === 'aucune' ? 0 : a.frequence;
      const apresJours = custom === 0 ? null : (custom || await frequenceDuType(c.type_client));
      let prochaine;
      if (c.statut === 'INACTIF') prochaine = null;
      else if (a.prochaine_visite) prochaine = a.prochaine_visite;
      else if (custom === 0) prochaine = null;
      else if (a.frequence != null && custom !== c.custom_recurrence) prochaine = await calculateNextVisit(c.type_client, custom, c.last_visit);
      else prochaine = c.next_visit || null;
      const change = custom !== c.custom_recurrence || (prochaine || null) !== (c.next_visit || null);
      const frequence = a.frequence == null || avantJours === apresJours ? texteFrequence(apresJours) : `${texteFrequence(avantJours)} → ${texteFrequence(apresJours)}`;
      const suite = c.statut === 'INACTIF' ? 'client inactif : pas de prochaine visite tant qu\'il n\'est pas réactivé'
        : prochaine ? `prochaine visite le ${dateFr(prochaine, { relatif: false })}${c.last_visit ? ` (dernière le ${dateFr(c.last_visit, { relatif: false })})` : ''}` : 'plus de prochaine visite';
      lignes.push(`${nommer(c.nom, c.ville)} · ${lib(LIBELLES_TYPE_CLIENT, c.type_client)} : ${frequence} — ${suite}${change ? '' : ' — inchangé'}`);
      if (change) plans.push({ c, custom, prochaine, frequence });
    }
    const tete = `${plans.length} client(s) à modifier${groupe ? ` — ${groupe}` : ''}${choisis.length > plans.length ? `, ${choisis.length - plans.length} déjà réglé(s) ainsi` : ''} :`;
    if (!a.confirmer || bloques.length) return apercu(tete, lignes, bloques);
    if (!plans.length) return { resultats: 0, texte: 'Rien à changer : ces clients sont déjà réglés ainsi.' };

    const maintenant = new Date().toISOString();
    for (const { c, custom, prochaine, frequence } of plans) {
      await db.query('UPDATE clients SET custom_recurrence = $1, next_visit = $2, date_modification = $3 WHERE id = $4', [custom, prochaine, maintenant, c.id]);
      await logActivity(utilisateur.id, 'recurrence_client', `${c.nom} : ${frequence}${prochaine ? `, prochaine visite ${prochaine}` : ''} (via Claude)`, 'client', c.id);
    }
    return { resultats: plans.length, texte: bloc(`${plans.length} client(s) mis à jour dans SuiviPro :`, ...lignes.map(l => `- ${l}`)) };
  },
};

// ---------------------------------------------------------------------------------------
/** Un prospect du périmètre d'écriture : les siens (et ceux sans commercial), tous pour l'administrateur et la prospection. */
async function unProspect(utilisateur, recherche) {
  const large = estAdmin(utilisateur) || faitDeLaProspection(utilisateur);
  const aLui = (p) => large || !p.commercial_id || p.commercial_id === utilisateur.id;
  const parId = (await db.query('SELECT id, nom_etablissement, ville, etape_pipeline, commercial_id FROM prospects WHERE id = $1', [recherche])).rows[0];
  const params = [];
  const trouves = parId ? [parId] : (await db.query(
    `SELECT id, nom_etablissement, ville, etape_pipeline, commercial_id FROM prospects WHERE 1=1${clauseTexte(['nom_etablissement'], recherche, params)} ORDER BY nom_etablissement LIMIT 50`, params
  )).rows;
  const q = normaliserPourComparaison(recherche);
  const exacts = trouves.filter(p => normaliserPourComparaison(p.nom_etablissement) === q);
  const candidats = (exacts.length ? exacts : trouves);
  const miens = candidats.filter(aLui);
  if (miens.length === 1) return miens[0];
  if (miens.length > 1) throw new ModificationRefusee(`plusieurs prospects correspondent à « ${recherche} » : ${miens.slice(0, 5).map(p => `réf. ${p.id} ${nommer(p.nom_etablissement, p.ville)}`).join(', ')}`);
  if (candidats.length) throw new HorsPerimetre(`« ${candidats[0].nom_etablissement} » est suivi par un collègue : seul son commercial (ou un administrateur) change son étape.`);
  throw new ModificationRefusee(`aucun prospect ne correspond à « ${recherche} »`);
}

const etape = {
  nom: 'changer_etape_prospect',
  titre: 'Changer l\'étape de prospects',
  ecrit: true,
  description: `Déplace un ou plusieurs prospects (${MAX_NOMMES} au plus) dans le tunnel : à contacter, contacté, proposition, négociation, RDV, gagné, perdu, ne pas contacter… C'est aussi ainsi qu'on « désactive » un prospect : « ne pas contacter » ou « perdu ». Même règle que le glisser dans le pipeline : l'historique d'étapes et le journal sont tenus. « perdu » demande la raison (ne l'inventez pas : demandez-la). Passé en gagné, le client arrive ensuite d'EasyBeer. Un commercial déplace ses prospects et ceux sans commercial ; la prospection et l'administrateur, tous. En deux temps : sans « confirmer », l'aperçu montre chaque déplacement ; « confirmer: true » seulement après l'accord de la personne.`,
  schema: {
    prospects: z.array(z.string()).min(1).describe('Les prospects, par nom ou référence (réf.).'),
    etape: z.string().describe('L\'étape d\'arrivée, par son nom (« négociation », « perdu », « ne pas contacter », « à contacter »…) ; « pipeline » liste les étapes.'),
    raison_perte: z.enum(Object.keys(RAISONS_PERTE)).optional()
      .describe(`Obligatoire pour « perdu » : ${Object.entries(RAISONS_PERTE).map(([k, v]) => `${k} (${v})`).join(', ')}.`),
    confirmer: CONFIRMER,
  },
  executer: async (a, { utilisateur }) => {
    if (a.prospects.length > MAX_NOMMES) throw new ModificationRefusee(`${MAX_NOMMES} prospects au plus à la fois : coupez la liste.`);
    const etapes = await libellesEtapes();
    // Le nom affiché d'abord (« Gagné » est client_gagne, « RDV » est gagne), puis le code,
    // puis un morceau du nom.
    const q = normaliserPourComparaison(a.etape);
    const parNom = Object.keys(etapes).filter(c => normaliserPourComparaison(etapes[c]) === q);
    const parCode = Object.keys(etapes).filter(c => normaliserPourComparaison(c) === q);
    const codes = parNom.length ? parNom : parCode.length ? parCode : codesDEtape(a.etape, etapes).filter(c => etapes[c]);
    if (codes.length !== 1) {
      throw new ModificationRefusee(codes.length
        ? `« ${a.etape} » peut désigner plusieurs étapes : ${codes.map(c => etapes[c]).join(', ')}. Précisez.`
        : `Aucune étape ne s'appelle « ${a.etape} ». Les étapes : ${Object.values(etapes).join(', ')}.`);
    }
    const vers = codes[0];
    if (vers === 'perdu' && !a.raison_perte) throw new ModificationRefusee(`Pour passer en « ${etapes.perdu} », il faut la raison : ${Object.values(RAISONS_PERTE).join(', ')}. Demandez-la.`);

    const choisis = []; const bloques = []; const lignes = []; const vus = new Set();
    for (const [n, recherche] of a.prospects.entries()) {
      try {
        const p = await unProspect(utilisateur, recherche);
        if (vus.has(p.id)) throw new ModificationRefusee(`${p.nom_etablissement} figure deux fois dans la liste`);
        vus.add(p.id);
        if (p.etape_pipeline === vers) { lignes.push(`${nommer(p.nom_etablissement, p.ville)} : déjà en « ${etapes[vers]} »`); continue; }
        choisis.push(p);
        lignes.push(`${nommer(p.nom_etablissement, p.ville)} : ${etapes[p.etape_pipeline] || p.etape_pipeline} → ${etapes[vers]}${vers === 'perdu' ? ` (${RAISONS_PERTE[a.raison_perte]})` : ''}`);
      } catch (err) {
        if (!(err instanceof ModificationRefusee || err instanceof HorsPerimetre)) throw err;
        if (err instanceof HorsPerimetre) await journaliserRefus(utilisateur, 'changer_etape_prospect', err.message);
        bloques.push(`${n + 1}. ${recherche} — ${err.message}`);
      }
    }
    if (['gagne', 'client_gagne'].includes(vers)) lignes.push(`Passé en « ${etapes[vers]} » : le client arrivera ensuite d'EasyBeer.`);
    if (!a.confirmer || bloques.length) {
      if (bloques.length) return { resultats: 0, texte: bloc(`${bloques.length} ligne(s) bloquent : rien n'est enregistré. Corrigez-les (ou retirez-les) puis rappelez l'outil.`, ...bloques) };
      return { resultats: 0, texte: deuxTemps([`${choisis.length} prospect(s) à déplacer vers « ${etapes[vers]} » :`, ...lignes]) };
    }
    if (!choisis.length) return { resultats: 0, texte: `Rien à changer : ces prospects sont déjà en « ${etapes[vers]} ».` };
    for (const p of choisis) await changerEtape(p.id, vers, utilisateur.id, { raison: vers === 'perdu' ? a.raison_perte : '' });
    return { resultats: choisis.length, texte: bloc(`${choisis.length} prospect(s) déplacé(s) dans SuiviPro :`, ...lignes.map(l => `- ${l}`)) };
  },
};

export default [activer, recurrence, etape];
