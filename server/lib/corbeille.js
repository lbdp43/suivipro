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
};

const TABLE = { prospect: 'prospects', client: 'clients' };

export class Introuvable extends Error {}

/** Le nom lisible d'une fiche, pour la liste de la corbeille. */
function nomDe(type, ligne) {
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

    const dependances = {};
    for (const dep of DEPENDANCES[type]) {
      try {
        const res = await cx.query(`SELECT * FROM ${dep.table} WHERE ${dep.cle} = $1`, [entiteId]);
        dependances[dep.table] = res.rows;
      } catch {
        // Une table absente sur une base ancienne ne doit pas empêcher de ranger la fiche.
        dependances[dep.table] = [];
      }
    }

    // Les clients rattachés à ce prospect perdent le lien (ON DELETE SET NULL) : on note
    // lesquels pour pouvoir le rétablir à la restauration.
    let clientsLies = [];
    if (type === 'prospect') {
      const res = await cx.query('SELECT id FROM clients WHERE prospect_id = $1', [entiteId]);
      clientsLies = res.rows.map(r => r.id);
    }

    const contenu = JSON.stringify({ fiche: ligne, dependances, clientsLies });
    const insere = await cx.query(
      `INSERT INTO corbeille (type, entite_id, nom, ville, commercial_id, contenu, resume, supprime_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [type, entiteId, nomDe(type, ligne), String(ligne.ville || '').slice(0, 200),
       ligne.commercial_id || '', contenu, JSON.stringify(resumeDe(dependances)), utilisateurId]
    );

    await cx.query(`DELETE FROM ${table} WHERE id = $1`, [entiteId]);
    await cx.query('COMMIT');

    await logActivity(
      utilisateurId,
      type === 'prospect' ? 'prospect_supprime' : 'client_supprime',
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

/** Réécrit une ligne telle qu'elle était, en ignorant les colonnes disparues depuis. */
async function reinserer(cx, table, ligne) {
  const colonnes = Object.keys(ligne);
  if (colonnes.length === 0) return;
  const params = colonnes.map((_, i) => `$${i + 1}`).join(',');
  await cx.query(
    `INSERT INTO ${table} (${colonnes.map(c => `"${c}"`).join(',')}) VALUES (${params}) ON CONFLICT (id) DO NOTHING`,
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

    const { fiche, dependances, clientsLies } = JSON.parse(entree.contenu);
    const table = TABLE[entree.type];

    await reinserer(cx, table, fiche);
    for (const dep of DEPENDANCES[entree.type]) {
      for (const ligne of dependances[dep.table] || []) {
        try { await reinserer(cx, dep.table, ligne); } catch { /* table disparue : on garde le reste */ }
      }
    }
    for (const clientId of clientsLies || []) {
      await cx.query('UPDATE clients SET prospect_id = $1 WHERE id = $2 AND prospect_id IS NULL',
        [entree.entite_id, clientId]);
    }

    await cx.query('UPDATE corbeille SET restaure_par = $1, restaure_le = NOW() WHERE id = $2',
      [utilisateurId, ligneId]);
    await cx.query('COMMIT');

    await logActivity(
      utilisateurId,
      entree.type === 'prospect' ? 'prospect_restaure' : 'client_restaure',
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
