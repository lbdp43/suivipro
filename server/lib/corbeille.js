// La corbeille : supprimer ne détruit plus rien.
//
// Avant, « Supprimer » sur un prospect effaçait la ligne — et la base emportait au passage
// tous ses appels, ses rendez-vous, ses rappels et son historique d'étapes (ON DELETE
// CASCADE). Même chose pour un client avec ses visites, ses tâches et ses commandes. Une
// fausse manœuvre coûtait donc bien plus que la fiche.
//
// Désormais, on recopie la fiche ET tout ce qui serait parti avec elle dans la table
// `corbeille`, puis on retire la ligne. Rien ne change pour le reste de l'application :
// la fiche a bien disparu des écrans, mais l'administrateur peut la remettre en place à
// l'identique depuis la page Administration.
import db from '../db.js';
import { logActivity } from './journal.js';
import { noter, oublier } from './ecartes.js';
import { oublierLesComptesRetires } from './auth.js';

/** Ce qui part avec une fiche, et qu'il faut donc ranger avec elle. */
const DEPENDANCES = {
  prospect: [
    { table: 'calls', cle: 'prospect_id' },
    { table: 'appointments', cle: 'prospect_id' },
    { table: 'reminders', cle: 'prospect_id' },
    { table: 'prospect_etapes', cle: 'prospect_id' },
  ],
  client: [
    { table: 'interactions', cle: 'client_id' },
    { table: 'tasks_client', cle: 'client_id' },
    { table: 'commandes', cle: 'client_id' },
  ],
  // Un membre n'est pas effacé (voir plus bas) : son secteur, ses réglages de tournée et
  // son journal restent donc en place tels quels. Seuls ses accès vivants partent avec
  // lui, parce qu'ils n'ont plus lieu d'être une fois la personne partie.
  membre: [
    { table: 'google_calendar_tokens', cle: 'commercial_id' },
    { table: 'mcp_jetons', cle: 'commercial_id' },
  ],
};

// Ce qui empêche de retirer quelqu'un tant que ça lui appartient. Ces liens ne s'effacent
// pas en cascade : la base refuserait la suppression avec une erreur illisible. On préfère
// nommer ce qui reste et demander de le réattribuer d'abord — la sélection sur la carte
// est faite pour ça.
// Ce qui doit avoir un propriétaire en poste. On ne bloque que là-dessus : les appels, les
// visites et les rendez-vous passés portent le nom de qui les a faits, les réattribuer
// fausserait l'historique — ils restent donc attachés à la personne retirée.
const BLOQUANTS = {
  membre: [
    { table: 'prospects', cle: 'commercial_id', un: 'prospect', plusieurs: 'prospects' },
    { table: 'clients', cle: 'commercial_id', un: 'client', plusieurs: 'clients' },
    { table: 'documents', cle: 'uploaded_by', un: 'document', plusieurs: 'documents' },
    { table: 'commercial_zones', cle: 'commercial_id', un: 'secteur dessiné', plusieurs: 'secteurs dessinés' },
  ],
};

const TABLE = { prospect: 'prospects', client: 'clients', membre: 'commerciaux' };

/** Ce qui reste attaché à quelqu'un et doit être réattribué avant de le retirer. */
export class EncoreRattache extends Error {}

export class Introuvable extends Error {}

/** Le nom lisible d'une fiche, pour la liste de la corbeille. */
function nomDe(type, ligne) {
  if (type === 'membre') return `${ligne.prenom || ''} ${ligne.nom || ''}`.trim().slice(0, 200) || ligne.id;
  return String((type === 'prospect' ? ligne.nom_etablissement : ligne.nom) || '').slice(0, 200);
}

/** Combien d'éléments d'histoire partent avec la fiche — affiché avant de restaurer. */
function resumeDe(dependances) {
  const r = {};
  for (const [table, lignes] of Object.entries(dependances)) {
    if (lignes.length > 0) r[table] = lignes.length;
  }
  return r;
}

/**
 * Range une fiche dans la corbeille et la retire des écrans.
 * Tout se fait dans une seule transaction : soit la fiche est rangée puis retirée, soit
 * rien ne bouge — jamais une suppression sans sa copie.
 */
export async function archiver(type, entiteId, utilisateurId) {
  const table = TABLE[type];
  if (!table) throw new Error(`type inconnu : ${type}`);

  const cx = await db.connect();
  try {
    await cx.query('BEGIN');

    const fiche = await cx.query(`SELECT * FROM ${table} WHERE id = $1`, [entiteId]);
    if (fiche.rows.length === 0) throw new Introuvable(`${type} ${entiteId} introuvable`);
    const ligne = fiche.rows[0];
    if (type === 'membre' && ligne.actif === false) {
      throw new Introuvable(`${nomDe(type, ligne)} a déjà été retiré de l'équipe`);
    }

    // Une table absente sur une base ancienne ne doit pas empêcher de ranger la fiche. Le
    // point de reprise est indispensable : sous PostgreSQL, une requête en erreur annule
    // toute la transaction, un simple try/catch ne suffirait donc pas à continuer.
    const dependances = {};
    for (const dep of DEPENDANCES[type]) {
      await cx.query('SAVEPOINT dep');
      try {
        const res = await cx.query(`SELECT * FROM ${dep.table} WHERE ${dep.cle} = $1`, [entiteId]);
        dependances[dep.table] = res.rows;
        await cx.query('RELEASE SAVEPOINT dep');
      } catch {
        await cx.query('ROLLBACK TO SAVEPOINT dep');
        dependances[dep.table] = [];
      }
    }

    // Ce qui appartient encore à la personne l'empêche de partir : on le nomme au lieu de
    // laisser la base répondre par une violation de clé étrangère.
    const reste = [];
    for (const b of BLOQUANTS[type] || []) {
      const res = await cx.query(`SELECT COUNT(*)::int AS n FROM ${b.table} WHERE ${b.cle} = $1`, [entiteId]);
      const n = res.rows[0].n;
      if (n > 0) reste.push(`${n} ${n > 1 ? b.plusieurs : b.un}`);
    }
    if (reste.length > 0) {
      throw new EncoreRattache(
        `${nomDe(type, ligne)} a encore ${reste.join(', ')}. Réattribuez ce qui lui appartient avant de le retirer de l'équipe.`
      );
    }

    // Les clients rattachés à ce prospect perdent le lien (ON DELETE SET NULL) : on note
    // lesquels pour pouvoir le rétablir à la restauration. Même chose pour les tâches
    // confiées à un membre qu'on retire.
    let clientsLies = [];
    if (type === 'prospect') {
      const res = await cx.query('SELECT id FROM clients WHERE prospect_id = $1', [entiteId]);
      clientsLies = res.rows.map(r => r.id);
    }
    let tachesLiees = [];
    if (type === 'membre') {
      const res = await cx.query('SELECT id FROM tasks_client WHERE commercial_id = $1', [entiteId]);
      tachesLiees = res.rows.map(r => r.id);
    }

    const contenu = JSON.stringify({ fiche: ligne, dependances, clientsLies, tachesLiees });
    const insere = await cx.query(
      `INSERT INTO corbeille (type, entite_id, nom, ville, commercial_id, contenu, resume, supprime_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [type, entiteId, nomDe(type, ligne), String(ligne.ville || '').slice(0, 200),
       ligne.commercial_id || '', contenu, JSON.stringify(resumeDe(dependances)), utilisateurId]
    );

    if (type === 'membre') {
      // On ne supprime pas la ligne : elle porte le nom de l'auteur sur chaque appel,
      // chaque visite, chaque rendez-vous passé. Marquée inactive, la personne ne se
      // connecte plus et sort de toutes les listes (voir routes/etat.js), mais son
      // travail garde son auteur. Ses accès vivants, eux, sont retirés pour de bon.
      await cx.query('UPDATE commerciaux SET actif = FALSE WHERE id = $1', [entiteId]);
      oublierLesComptesRetires();
      for (const dep of DEPENDANCES.membre) {
        await cx.query('SAVEPOINT ret');
        try {
          await cx.query(`DELETE FROM ${dep.table} WHERE ${dep.cle} = $1`, [entiteId]);
          await cx.query('RELEASE SAVEPOINT ret');
        } catch { await cx.query('ROLLBACK TO SAVEPOINT ret'); }
      }
    } else {
      await cx.query(`DELETE FROM ${table} WHERE id = $1`, [entiteId]);
    }
    await cx.query('COMMIT');

    // Une fiche rangée à la corbeille laisse une trace d'identité : si le même
    // établissement revient un jour dans la boîte de prospection, on saura le dire au lieu
    // de laisser recréer ce qu'on venait d'écarter. Un membre n'en laisse pas : ce n'est
    // pas un établissement.
    if (type !== 'membre') {
      await noter({
        origine: type,
        origineId: entiteId,
        nom: nomDe(type, ligne),
        ville: ligne.ville || '',
        telephone: ligne.telephone || '',
        motif: `${type}_corbeille`,
        parQui: utilisateurId,
      });
    }

    await logActivity(
      utilisateurId,
      `${type}_supprime`,
      `${nomDe(type, ligne)}${ligne.ville ? ` (${ligne.ville})` : ''} rangé dans la corbeille`,
      type, entiteId,
    );
    return { id: insere.rows[0].id, nom: nomDe(type, ligne) };
  } catch (err) {
    try { await cx.query('ROLLBACK'); } catch { /* la transaction est déjà perdue */ }
    throw err;
  } finally {
    cx.release();
  }
}

// Le journal se numérote tout seul (id SERIAL) : réécrire les anciens numéros préparerait
// une collision au prochain enregistrement. On laisse la base en attribuer de nouveaux.
const NUMEROTE_SEUL = new Set(['activity_log']);

/**
 * Réécrit une ligne telle qu'elle était.
 * `ON CONFLICT DO NOTHING` sans colonne visée : toutes ces tables n'ont pas de clé « id »
 * — tournee_config, google_calendar_tokens et easybeer_commerciaux sont tenues par le
 * commercial — et nommer la mauvaise colonne ferait échouer la restauration.
 */
async function reinserer(cx, table, ligne) {
  const colonnes = Object.keys(ligne).filter(c => !(NUMEROTE_SEUL.has(table) && c === 'id'));
  if (colonnes.length === 0) return;
  const params = colonnes.map((_, i) => `$${i + 1}`).join(',');
  await cx.query(
    `INSERT INTO ${table} (${colonnes.map(c => `"${c}"`).join(',')}) VALUES (${params}) ON CONFLICT DO NOTHING`,
    colonnes.map(c => ligne[c]),
  );
}

/**
 * Remet une fiche en place, avec son histoire. Réservé à l'administrateur.
 * Une fiche déjà restaurée, ou dont l'identifiant a été repris entre-temps, ne l'est pas
 * une deuxième fois : ON CONFLICT DO NOTHING protège les données en place.
 */
export async function restaurer(ligneId, utilisateurId) {
  const cx = await db.connect();
  try {
    await cx.query('BEGIN');

    const res = await cx.query('SELECT * FROM corbeille WHERE id = $1 FOR UPDATE', [ligneId]);
    if (res.rows.length === 0) throw new Introuvable('ligne de corbeille introuvable');
    const entree = res.rows[0];
    if (entree.restaure_le) throw new Introuvable('cette fiche a déjà été restaurée');

    const { fiche, dependances, clientsLies, tachesLiees } = JSON.parse(entree.contenu);
    const table = TABLE[entree.type];

    if (entree.type === 'membre') {
      // Retour en poste. On ne remet volontairement ni le lien Google Agenda ni l'accès
      // Claude : ce sont des autorisations vivantes, elles se redonnent explicitement.
      await cx.query('UPDATE commerciaux SET actif = TRUE WHERE id = $1', [entree.entite_id]);
      oublierLesComptesRetires();
      await cx.query('UPDATE corbeille SET restaure_par = $1, restaure_le = NOW() WHERE id = $2',
        [utilisateurId, ligneId]);
      await cx.query('COMMIT');
      await logActivity(utilisateurId, 'membre_restaure', `${entree.nom} est de retour dans l'équipe`, 'membre', entree.entite_id);
      return { nom: entree.nom, type: entree.type, entite_id: entree.entite_id };
    }

    await reinserer(cx, table, fiche);
    for (const dep of DEPENDANCES[entree.type]) {
      const lignes = dependances[dep.table] || [];
      if (lignes.length === 0) continue;
      // Point de reprise par table : si l'une a disparu du schéma depuis, on remet quand
      // même tout le reste au lieu de perdre la restauration entière.
      await cx.query('SAVEPOINT dep');
      try {
        for (const ligne of lignes) await reinserer(cx, dep.table, ligne);
        await cx.query('RELEASE SAVEPOINT dep');
      } catch {
        await cx.query('ROLLBACK TO SAVEPOINT dep');
      }
    }
    for (const clientId of clientsLies || []) {
      await cx.query('UPDATE clients SET prospect_id = $1 WHERE id = $2 AND prospect_id IS NULL',
        [entree.entite_id, clientId]);
    }
    for (const tacheId of tachesLiees || []) {
      await cx.query('UPDATE tasks_client SET commercial_id = $1 WHERE id = $2 AND commercial_id IS NULL',
        [entree.entite_id, tacheId]);
    }

    await cx.query('UPDATE corbeille SET restaure_par = $1, restaure_le = NOW() WHERE id = $2',
      [utilisateurId, ligneId]);
    await cx.query('COMMIT');

    // La fiche est de retour : l'avertissement qui la disait écartée n'a plus lieu d'être.
    await oublier(entree.type, entree.entite_id);

    await logActivity(
      utilisateurId,
      `${entree.type}_restaure`,
      `${entree.nom}${entree.ville ? ` (${entree.ville})` : ''} remis en place`,
      entree.type, entree.entite_id,
    );
    return { nom: entree.nom, type: entree.type, entite_id: entree.entite_id };
  } catch (err) {
    try { await cx.query('ROLLBACK'); } catch { /* la transaction est déjà perdue */ }
    throw err;
  } finally {
    cx.release();
  }
}
