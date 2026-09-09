// Poser les rendez-vous dans le Google Agenda du commercial concerné.
//
// Jusqu'ici, « exporter » fabriquait un fichier .ics que le navigateur téléchargeait : sur
// un téléphone, il proposait souvent de l'ajouter ; sur un ordinateur, il finissait dans
// les téléchargements et rien ne se passait. D'où les rendez-vous qui « n'arrivaient pas ».
//
// Ici, le serveur écrit directement dans l'agenda du commercial qui a le rendez-vous, avec
// tout ce qu'il faut savoir en arrivant : le contact, l'adresse, les notes, qui a pris le
// rendez-vous et quand, l'appel qui l'a produit, les étiquettes du prospect.
//
// Rien de tout cela ne doit empêcher d'enregistrer un rendez-vous : si Google refuse, si
// la personne n'a pas connecté son agenda, ou si l'application n'a pas d'identifiants
// Google, le rendez-vous est quand même enregistré et le .ics reste disponible.
import { google } from 'googleapis';
import db from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { LIBELLES_ETAPE, LIBELLES_RESULTAT_APPEL, libelle } from '../../shared/libelles.js';

const FUSEAU = 'Europe/Paris';
const DUREE_DEFAUT_MINUTES = 60;

export function googleConfigure() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

function clientOAuth() {
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
}

/** L'agenda d'une personne, ou null si elle ne l'a pas connecté. */
export async function agendaDe(commercialId) {
  if (!googleConfigure() || !commercialId) return null;
  const r = await db.query('SELECT * FROM google_calendar_tokens WHERE commercial_id = $1', [commercialId]);
  const jeton = r.rows[0];
  if (!jeton) return null;
  const oauth = clientOAuth();
  oauth.setCredentials({
    access_token: decrypt(jeton.access_token),
    refresh_token: decrypt(jeton.refresh_token),
    expiry_date: Number(jeton.expiry_date),
  });
  oauth.on('tokens', (t) => {
    if (!t.access_token) return;
    db.query('UPDATE google_calendar_tokens SET access_token = $1, expiry_date = $2 WHERE commercial_id = $3',
      [encrypt(t.access_token), t.expiry_date, commercialId]).catch(() => {});
  });
  return google.calendar({ version: 'v3', auth: oauth });
}

/**
 * Les agendas sur lesquels cette personne peut écrire : le sien, et tous ceux qu'on lui a
 * partagés en écriture. C'est ce qui permet à Eva de poser un rendez-vous sur l'agenda
 * d'Alban sans qu'Alban ait connecté quoi que ce soit à SuiviPro.
 */
export async function agendasAccessibles(commercialId) {
  const agenda = await agendaDe(commercialId);
  if (!agenda) return { connecte: false, agendas: [] };
  try {
    const r = await agenda.calendarList.list({ maxResults: 100, minAccessRole: 'writer' });
    const agendas = (r.data.items || [])
      .filter(c => !c.deleted && (c.accessRole === 'owner' || c.accessRole === 'writer'))
      .map(c => ({ id: c.id, nom: c.summaryOverride || c.summary || c.id, principal: !!c.primary }))
      .sort((a, b) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0) || a.nom.localeCompare(b.nom));
    return { connecte: true, agendas };
  } catch (err) {
    if (await oublierSiRevoque(commercialId, err)) return { connecte: false, agendas: [], raison: 'acces_revoque' };
    console.error('[AGENDA] Liste des agendas impossible :', err.message);
    return { connecte: true, agendas: [], raison: 'erreur' };
  }
}

/**
 * Un accès qui ne vaut plus rien se nettoie : la personne devra reconnecter son agenda.
 *
 * Deux cas. L'accès révoqué ou expiré (401). Et surtout, celui qui n'a que le droit de
 * lecture : jusqu'ici SuiviPro ne demandait que « lire l'agenda », donc tous les accès
 * déjà donnés refusent l'écriture (403). Les garder ne servirait qu'à échouer en boucle.
 */
async function oublierSiRevoque(commercialId, err) {
  const message = String(err?.message || '');
  const motif = err?.errors?.[0]?.reason || '';
  const lectureSeule = err?.code === 403 && /insufficient|permission|scope/i.test(`${motif} ${message}`);
  if (err?.code === 401 || message.includes('invalid_grant') || lectureSeule) {
    await db.query('DELETE FROM google_calendar_tokens WHERE commercial_id = $1', [commercialId]).catch(() => {});
    return true;
  }
  return false;
}

function horaire(date, heure, minutesEnPlus = 0) {
  const jour = String(date || '').slice(0, 10);
  const [h, m] = String(heure || '09:00').slice(0, 5).split(':').map(Number);
  const d = new Date(Date.UTC(2000, 0, 1, Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0));
  d.setUTCMinutes(d.getUTCMinutes() + minutesEnPlus);
  return `${jour}T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:00`;
}

const dateFr = (v) => {
  const d = new Date(`${String(v || '').slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
};

/**
 * Le contenu de l'événement, à partir de tout ce que SuiviPro sait du rendez-vous.
 * Fonction pure : c'est elle qu'on vérifie, sans appeler Google.
 */
export function corpsEvenement({ rdv, prospect, client, commercial, prospecteur, etiquettes = [], dernierAppel, adresseApplication = '' }) {
  const nom = client?.nom || prospect?.nom_etablissement || 'Rendez-vous';
  const ville = client?.ville || prospect?.ville || '';
  const contact = client?.contact || prospect?.nom_contact || '';
  const tels = [client?.telephone_mobile, client?.telephone, prospect?.telephone].filter(Boolean);
  // « 20 rue Voltaire, 42400 Saint-Chamond » : le code postal colle à la ville, comme
  // sur une enveloppe — c'est aussi ce que Google Maps sait ouvrir.
  const codePostal = client?.code_postal || prospect?.code_postal || '';
  const adresse = rdv.lieu || [client?.adresse || prospect?.adresse, [codePostal, ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  const lignes = [];
  lignes.push([
    client ? 'Client' : 'Prospect',
    !client && prospect ? `étape : ${libelle(LIBELLES_ETAPE, prospect.etape_pipeline)}` : '',
    !client && prospect && prospect.score != null ? `score ${prospect.score}` : '',
  ].filter(Boolean).join(' · '));
  lignes.push(contact ? `Contact : ${contact}${tels.length ? ` — ${tels[0]}` : ''}` : (tels.length ? `Téléphone : ${tels[0]}` : 'Contact : non renseigné'));
  if (adresse) lignes.push(adresse);
  if (etiquettes.length) lignes.push(`Étiquettes : ${etiquettes.join(', ')}`);

  if (rdv.notes) lignes.push('', 'Notes du rendez-vous :', rdv.notes);

  const prise = [];
  if (prospecteur) prise.push(`Pris par ${prospecteur.prenom} ${prospecteur.nom}`.trim());
  if (rdv.created_at) prise.push(`le ${dateFr(rdv.created_at)}`);
  if (commercial && prospecteur && commercial.id !== prospecteur.id) prise.push(`pour ${commercial.prenom}`);
  if (prise.length) lignes.push('', `${prise.join(' ')}.`);

  if (dernierAppel) {
    lignes.push(`Dernier appel le ${dateFr(dernierAppel.date)} — ${libelle(LIBELLES_RESULTAT_APPEL, dernierAppel.resultat)}${dernierAppel.notes ? ` : ${dernierAppel.notes}` : ''}`);
  }

  if (adresseApplication && (prospect || client)) {
    const chemin = client ? `/clients?id=${client.id}` : `/prospects?id=${prospect.id}`;
    lignes.push('', `Fiche dans SuiviPro : ${adresseApplication}${chemin}`);
  }

  return {
    summary: `RDV · ${ville ? `${nom} (${ville})` : nom}`,
    location: adresse || undefined,
    description: lignes.join('\n').trim(),
    start: { dateTime: horaire(rdv.date, rdv.heure_debut), timeZone: FUSEAU },
    end: {
      dateTime: rdv.heure_fin
        ? horaire(rdv.date, rdv.heure_fin)
        : horaire(rdv.date, rdv.heure_debut, DUREE_DEFAUT_MINUTES),
      timeZone: FUSEAU,
    },
    source: adresseApplication ? { title: 'SuiviPro', url: adresseApplication } : undefined,
  };
}

/** Tout ce que l'événement raconte, rassemblé en une fois. */
async function contexteDuRdv(rdv) {
  const [prospect, client, gens, appel] = await Promise.all([
    rdv.prospect_id ? db.query('SELECT * FROM prospects WHERE id = $1', [rdv.prospect_id]).then(r => r.rows[0]) : null,
    rdv.client_id ? db.query('SELECT * FROM clients WHERE id = $1', [rdv.client_id]).then(r => r.rows[0]) : null,
    db.query('SELECT id, prenom, nom FROM commerciaux WHERE id = ANY($1)', [[rdv.commercial_id, rdv.prospecteur_id].filter(Boolean)]).then(r => r.rows),
    rdv.prospect_id
      ? db.query('SELECT date, resultat, notes FROM calls WHERE prospect_id = $1 ORDER BY date DESC LIMIT 1', [rdv.prospect_id]).then(r => r.rows[0])
      : null,
  ]);

  let etiquettes = [];
  if (prospect) {
    let ids = prospect.tags;
    if (typeof ids === 'string') { try { ids = JSON.parse(ids); } catch { ids = []; } }
    if (Array.isArray(ids) && ids.length) {
      const t = await db.query('SELECT nom FROM tags WHERE id = ANY($1)', [ids]);
      etiquettes = t.rows.map(x => x.nom);
    }
  }

  return {
    rdv,
    prospect,
    client,
    commercial: gens.find(g => g.id === rdv.commercial_id) || null,
    prospecteur: gens.find(g => g.id === rdv.prospecteur_id) || null,
    etiquettes,
    dernierAppel: appel || null,
    adresseApplication: (process.env.APP_URL || process.env.CORS_ORIGIN || '').replace(/\/$/, ''),
  };
}

async function memoriser(rdvId, eventId, commercialId, calendarId) {
  await db.query('UPDATE appointments SET google_event_id = $1, google_commercial_id = $2, google_calendar_id = $3 WHERE id = $4',
    [eventId || '', eventId ? commercialId : '', eventId ? (calendarId || 'primary') : '', rdvId]).catch(() => {});
}

/** Retire l'événement d'un agenda, sans bruit s'il n'y est plus. */
async function retirerDe(commercialId, eventId, calendarId = 'primary') {
  if (!commercialId || !eventId) return;
  const agenda = await agendaDe(commercialId);
  if (!agenda) return;
  try {
    await agenda.events.delete({ calendarId: calendarId || 'primary', eventId });
  } catch (err) {
    if (err?.code !== 404 && err?.code !== 410) {
      await oublierSiRevoque(commercialId, err);
      console.error('[AGENDA] Retrait impossible :', err.message);
    }
  }
}

/**
 * Pose (ou met à jour) le rendez-vous sur un agenda Google.
 *
 * Sans précision, il va sur l'agenda du commercial qui a le rendez-vous, par sa propre
 * connexion. Avec `cible`, il va sur l'agenda demandé, écrit par la connexion de la
 * personne qui le demande — c'est ce qui permet à Eva de poser un rendez-vous sur
 * l'agenda d'Alban, puisqu'Alban le lui a partagé en écriture.
 *
 * Un rendez-vous ne vit que sur un agenda : s'il change de destination, il est retiré de
 * l'ancien avant d'être posé sur le nouveau. Jamais de doublon.
 */
export async function poserRendezVous(rdvId, cible = null) {
  try {
    const r = await db.query('SELECT * FROM appointments WHERE id = $1', [rdvId]);
    const rdv = r.rows[0];
    if (!rdv) return { pose: false, raison: 'introuvable' };

    const via = cible?.viaCommercialId || rdv.commercial_id;
    const calendrier = cible?.calendarId || 'primary';
    const memeEndroit = rdv.google_commercial_id === via && (rdv.google_calendar_id || 'primary') === calendrier;

    // Annulé, ou destination changée : on nettoie d'abord là où il était.
    if (rdv.google_event_id && (rdv.statut === 'annule' || !memeEndroit)) {
      await retirerDe(rdv.google_commercial_id, rdv.google_event_id, rdv.google_calendar_id);
      await memoriser(rdvId, '', '', '');
      rdv.google_event_id = '';
    }
    if (rdv.statut === 'annule') return { pose: false, raison: 'annule' };
    if (!googleConfigure()) return { pose: false, raison: 'non_configure' };

    const agenda = await agendaDe(via);
    if (!agenda) return { pose: false, raison: 'non_connecte' };

    const corps = corpsEvenement(await contexteDuRdv(rdv));
    if (rdv.google_event_id) {
      try {
        const maj = await agenda.events.update({ calendarId: calendrier, eventId: rdv.google_event_id, requestBody: corps });
        return { pose: true, eventId: maj.data.id, calendarId: calendrier, mis_a_jour: true };
      } catch (err) {
        // L'événement a été supprimé à la main dans Google : on en repose un.
        if (err?.code !== 404 && err?.code !== 410) throw err;
      }
    }
    const cree = await agenda.events.insert({ calendarId: calendrier, requestBody: corps });
    await memoriser(rdvId, cree.data.id, via, calendrier);
    return { pose: true, eventId: cree.data.id, calendarId: calendrier, mis_a_jour: false };
  } catch (err) {
    const rdv = (await db.query('SELECT commercial_id FROM appointments WHERE id = $1', [rdvId]).catch(() => ({ rows: [] }))).rows[0];
    const via = cible?.viaCommercialId || rdv?.commercial_id;
    if (via && await oublierSiRevoque(via, err)) return { pose: false, raison: 'acces_revoque' };
    if (err?.code === 403 || err?.code === 404) return { pose: false, raison: 'agenda_refuse', message: err.message };
    console.error('[AGENDA] Pose impossible :', err.message);
    return { pose: false, raison: 'erreur', message: err.message };
  }
}

/** Le rendez-vous disparaît de SuiviPro : il disparaît de l'agenda. */
export async function retirerRendezVous(rdv) {
  if (!rdv?.google_event_id) return;
  await retirerDe(rdv.google_commercial_id || rdv.commercial_id, rdv.google_event_id, rdv.google_calendar_id);
}
