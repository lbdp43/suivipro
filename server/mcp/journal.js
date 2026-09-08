// Le journal du MCP : tout est tracé, et un usage anormal prévient l'administrateur.
//
// Les lignes rejoignent le journal d'activité de l'application (activity_log), donc la
// purge à 180 jours qui existe déjà s'applique sans rien changer. Aucun blocage
// automatique : prévenir est une chose, couper l'accès en est une autre — c'est une
// décision humaine, dans l'écran d'administration.
import db from '../db.js';
import { logActivity, notifyAdmins } from '../lib/journal.js';

export const SEUILS = {
  appels_par_heure: 200,
  fiches_par_jour: 300,
  contacts_par_jour: 100,
  collegues_par_jour: 20,
  refus_par_heure: 20,
};

/** Une ligne par appel : qui, quel outil, quels filtres, combien de résultats, en combien de temps. */
export async function journaliserAppel({ utilisateur, outil, filtres, resultats, ms, mention }) {
  const details = [
    mention || '',
    filtres && Object.keys(filtres).length ? `filtres ${JSON.stringify(filtres)}` : '',
    resultats == null ? '' : `${resultats} résultat(s)`,
    ms == null ? '' : `${ms} ms`,
  ].filter(Boolean).join(' · ');
  await logActivity(utilisateur.id, `mcp_${outil}`, details.slice(0, 500), 'mcp', outil);
}

/** Une consultation hors périmètre, acceptée parce qu'elle a été demandée par son nom. */
export async function journaliserCollegue(utilisateur, collegue, outil) {
  await logActivity(utilisateur.id, 'mcp_collegue', `${outil} — fiches de ${collegue}`, 'mcp', outil);
}

/** Une lecture de coordonnées : on saura toujours lesquelles sont sorties, et pour qui. */
export async function journaliserContact(utilisateur, quoi, outil) {
  await logActivity(utilisateur.id, 'mcp_contact', `${outil} — coordonnées de ${quoi}`.slice(0, 300), 'mcp', outil);
}

/** Un refus de périmètre : ce qui a été demandé, et pourquoi ce n'était pas possible. */
export async function journaliserRefus(utilisateur, outil, raison) {
  await logActivity(utilisateur.id, 'mcp_refus', `${outil} — ${raison}`.slice(0, 300), 'mcp', outil);
}

// Les mentions (collègue, contact, refus, alerte) sont journalisées à part : elles ne
// comptent pas comme des requêtes, sinon un seul appel en vaudrait trois.
const MENTIONS = ['mcp_alerte', 'mcp_refus', 'mcp_contact', 'mcp_collegue'];

async function compter(utilisateurId, motif, heures, { mentionsExclues = false } = {}) {
  const depuis = new Date(Date.now() - heures * 3600000).toISOString();
  const exclusion = mentionsExclues ? ` AND action <> ALL($4)` : '';
  const params = [utilisateurId, depuis, motif];
  if (mentionsExclues) params.push(MENTIONS);
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM activity_log
      WHERE user_id = $1 AND created_at >= $2 AND action LIKE $3${exclusion}`,
    params
  );
  return r.rows[0]?.n || 0;
}

/** Une seule alerte par signal et par jour : au-delà, l'admin ne les lirait plus. */
async function dejaPrevenu(utilisateurId, signal) {
  const depuis = new Date(Date.now() - 24 * 3600000).toISOString();
  const r = await db.query(
    "SELECT 1 FROM activity_log WHERE user_id = $1 AND action = 'mcp_alerte' AND entity_id = $2 AND created_at >= $3 LIMIT 1",
    [utilisateurId, signal, depuis]
  );
  return r.rows.length > 0;
}

async function alerter(utilisateur, signal, message) {
  if (await dejaPrevenu(utilisateur.id, signal)) return;
  await logActivity(utilisateur.id, 'mcp_alerte', message.slice(0, 300), 'mcp', signal);
  await notifyAdmins('mcp_usage', 'Accès Claude : usage inhabituel', message, { commercial_id: utilisateur.id, signal });
}

/**
 * Les seuils du cahier des charges. Vérifiés après coup, jamais avant : une lecture n'est
 * pas refusée parce qu'elle est la deux-centième.
 */
const derniereVerification = new Map();

export async function verifierSeuils(utilisateur) {
  // Une fois par minute et par personne : les seuils se comptent en centaines, pas en unités.
  const precedente = derniereVerification.get(utilisateur.id) || 0;
  if (Date.now() - precedente < 60000) return;
  derniereVerification.set(utilisateur.id, Date.now());
  try {
    const qui = `${utilisateur.prenom} ${utilisateur.nom}`;
    const [heure, fiches, contacts, collegues, refus] = await Promise.all([
      compter(utilisateur.id, 'mcp\\_%', 1, { mentionsExclues: true }),
      compter(utilisateur.id, 'mcp\\_fiche\\_%', 24),
      compter(utilisateur.id, 'mcp\\_contact', 24),
      compter(utilisateur.id, 'mcp\\_collegue', 24),
      compter(utilisateur.id, 'mcp\\_refus', 1),
    ]);
    if (heure > SEUILS.appels_par_heure) await alerter(utilisateur, 'appels_par_heure', `${qui} : ${heure} requêtes Claude en une heure.`);
    if (fiches > SEUILS.fiches_par_jour) await alerter(utilisateur, 'fiches_par_jour', `${qui} : ${fiches} fiches détaillées lues aujourd'hui via Claude.`);
    if (contacts > SEUILS.contacts_par_jour) await alerter(utilisateur, 'contacts_par_jour', `${qui} : ${contacts} lectures de coordonnées aujourd'hui via Claude.`);
    if (collegues > SEUILS.collegues_par_jour) await alerter(utilisateur, 'collegues_par_jour', `${qui} : ${collegues} consultations de fiches de collègues aujourd'hui via Claude.`);
    if (refus > SEUILS.refus_par_heure) await alerter(utilisateur, 'refus_par_heure', `${qui} : ${refus} demandes hors périmètre refusées en une heure via Claude.`);
  } catch (err) {
    console.error('[MCP] Vérification des seuils impossible :', err.message);
  }
}

/** Un jeton qui dormait depuis un mois et se réveille : l'admin le saura. */
export async function verifierReveil(utilisateur, derniereUtilisation) {
  if (!derniereUtilisation) return;
  const jours = (Date.now() - new Date(derniereUtilisation).getTime()) / 86400000;
  if (jours < 30) return;
  try {
    await alerter(utilisateur, 'reveil', `${utilisateur.prenom} ${utilisateur.nom} : accès Claude réutilisé après ${Math.round(jours)} jours d'inactivité.`);
  } catch (err) {
    console.error('[MCP] Alerte de réveil impossible :', err.message);
  }
}
