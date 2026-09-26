// « Qualité des fiches » : l'atelier où l'on rend le fichier prospects fiable — doublons,
// prospects déjà clients, fiches à compléter, fiches partagées à trier.
//
// Ouvert à qui fait de la prospection et aux administrateurs. Chaque geste est écrit dans
// `qualite_journal` avec de quoi le défaire : l'administration voit ce qui a été fait et
// peut revenir en arrière. On ne défait un champ que s'il n'a pas bougé depuis — une
// correction faite entre-temps par quelqu'un d'autre n'est jamais écrasée.
import { Router } from 'express';
import db from '../db.js';
import { asyncHandler, authMiddleware, isAdmin, adminOnly } from '../lib/auth.js';
import { logActivity } from '../lib/journal.js';
import { changerEtape } from '../lib/tunnel.js';
import { rattacherEntite } from '../lib/zones.js';
import { geocodeServer } from '../lib/geo.js';
import { parseProspect } from '../lib/parse.js';
import { validationError } from '../lib/validation.js';
import { archiver, restaurer } from '../lib/corbeille.js';
import { SITE_INTERNET_CLIENT_ID } from '../lib/easybeer-sync.js';
import { pairesProbables } from '../../shared/rapprochement.js';
import { estQualifiable, manquesBloquants, LIBELLES_MANQUE } from '../../shared/qualite.js';
import { dateLocale } from '../../shared/regles.js';

const router = Router();

/** La page est à ceux qui font de la prospection, et aux administrateurs. */
async function accesQualite(req, res, next) {
  if (isAdmin(req) || req.user.role === 'prospection') return next();
  const r = await db.query('SELECT prospection FROM commerciaux WHERE id = $1', [req.user.id]);
  if (r.rows[0]?.prospection) return next();
  return res.status(403).json({ error: 'Réservé à la prospection' });
}
const acces = [authMiddleware, asyncHandler(accesQualite)];

async function noterAuJournal(executeur, { userId, action, prospectId = '', nom = '', ville = '', details = '', annulation = null }) {
  const r = await executeur.query(
    `INSERT INTO qualite_journal (user_id, action, prospect_id, nom, ville, details, annulation)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [userId, action, prospectId, String(nom || '').slice(0, 200), String(ville || '').slice(0, 120), details, annulation ? JSON.stringify(annulation) : '']
  );
  return r.rows[0].id;
}

const paireCle = (a, b) => (a < b ? [a, b] : [b, a]);

// ---------------------------------------------------------------------------------------
// Doublons entre prospects
// ---------------------------------------------------------------------------------------
const COLONNES_FICHE = `p.id, p.nom_etablissement, p.ville, p.code_postal, p.email, p.telephone, p.siret, p.etape_pipeline,
  p.type_etablissement, p.nom_contact, p.adresse, p.notes, p.commercial_id, p.date_creation,
  com.prenom AS commercial_prenom, com.nom AS commercial_nom`;

async function historiques() {
  const compte = async (table) => {
    const m = new Map();
    for (const r of (await db.query(`SELECT prospect_id, COUNT(*)::int AS n FROM ${table} WHERE prospect_id IS NOT NULL GROUP BY prospect_id`)).rows) m.set(r.prospect_id, r.n);
    return m;
  };
  const [appels, rdv, rappels] = await Promise.all([compte('calls'), compte('appointments'), compte('reminders')]);
  return { appels, rdv, rappels };
}

function ficheVisible(p, h) {
  return {
    id: p.id,
    nom: p.nom_etablissement,
    ville: p.ville || '',
    code_postal: p.code_postal || '',
    adresse: p.adresse || '',
    email: p.email || '',
    telephone: p.telephone || '',
    siret: p.siret || '',
    nom_contact: p.nom_contact || '',
    type_etablissement: p.type_etablissement || '',
    etape_pipeline: p.etape_pipeline,
    notes: String(p.notes || '').slice(0, 300),
    commercial: [p.commercial_prenom, p.commercial_nom].filter(Boolean).join(' '),
    date_creation: p.date_creation,
    nb_appels: h.appels.get(p.id) || 0,
    nb_rdv: h.rdv.get(p.id) || 0,
    nb_rappels: h.rappels.get(p.id) || 0,
  };
}

router.get('/qualite/doublons', ...acces, asyncHandler(async (req, res) => {
  const prospects = (await db.query(
    `SELECT ${COLONNES_FICHE} FROM prospects p LEFT JOIN commerciaux com ON com.id = p.commercial_id ORDER BY p.nom_etablissement`
  )).rows;
  const ecartees = new Set((await db.query('SELECT a, b FROM qualite_pas_doublons')).rows.map(r => `${r.a}|${r.b}`));
  const h = await historiques();

  const paires = [];
  for (const { a, b, score, motif } of pairesProbables(prospects, null, { memeCommune: true })) {
    const [x, y] = [prospects[a], prospects[b]];
    const [k1, k2] = paireCle(x.id, y.id);
    if (ecartees.has(`${k1}|${k2}`)) continue;
    const fa = ficheVisible(x, h), fb = ficheVisible(y, h);
    // À garder par défaut : celle qui porte le plus d'histoire, puis la plus ancienne.
    const poids = (f) => f.nb_rdv * 10 + f.nb_appels * 3 + f.nb_rappels;
    const garder = poids(fa) === poids(fb)
      ? (String(fa.date_creation || '') <= String(fb.date_creation || '') ? fa : fb)
      : (poids(fa) > poids(fb) ? fa : fb);
    paires.push({ score, motif, suggestion_garder: garder.id, fiches: [fa, fb] });
  }
  paires.sort((p, q) => q.score - p.score || p.fiches[0].nom.localeCompare(q.fiches[0].nom));
  res.json({
    total: paires.length,
    certains: paires.filter(p => p.score === 100).length,
    affichees: Math.min(paires.length, 500),
    paires: paires.slice(0, 500),
  });
}));

router.post('/qualite/pas-doublons', ...acces, asyncHandler(async (req, res) => {
  const { a, b } = req.body || {};
  if (!a || !b || a === b) return validationError(res, ['Deux fiches différentes sont attendues']);
  const [k1, k2] = paireCle(String(a), String(b));
  // Deux prospects, ou un prospect et un client (fausse alerte « déjà client »).
  const noms = [
    ...(await db.query('SELECT id, nom_etablissement, ville FROM prospects WHERE id = ANY($1)', [[k1, k2]])).rows,
    ...(await db.query('SELECT id, nom AS nom_etablissement, ville FROM clients WHERE id = ANY($1)', [[k1, k2]])).rows,
  ];
  if (noms.length !== 2) return res.status(404).json({ error: 'Fiche introuvable' });
  await db.query(
    'INSERT INTO qualite_pas_doublons (a, b, par) VALUES ($1,$2,$3) ON CONFLICT (a, b) DO NOTHING',
    [k1, k2, req.user.id]
  );
  const [n1, n2] = noms;
  await noterAuJournal(db, {
    userId: req.user.id, action: 'pas_doublon', prospectId: n1.id, nom: n1.nom_etablissement, ville: n1.ville,
    details: `« ${n1.nom_etablissement} » et « ${n2.nom_etablissement} » ne sont pas le même établissement`,
    annulation: { a: k1, b: k2 },
  });
  res.json({ ok: true });
}));

// Les champs qu'une fusion complète sur la fiche gardée, et que l'annulation peut rendre.
const CHAMPS_FUSION = ['telephone', 'email', 'nom_contact', 'adresse', 'ville', 'code_postal', 'departement', 'secteur',
  'latitude', 'longitude', 'siret', 'siren', 'raison_sociale', 'tva_intracom', 'source_url', 'commercial_id', 'tags', 'notes'];

const vide = (v) => v === null || v === undefined || String(v).trim() === '' || ((typeof v === 'number') && v === 0);

function lireTags(v) { try { const t = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(t) ? t : []; } catch { return []; } }

/**
 * Fusionne `absorber` dans `garder` : tout ce qui pointe vers la fiche absorbée (appels,
 * rendez-vous, rappels, historique d'étapes, clients liés, partages) passe sur la fiche
 * gardée ; les champs vides de celle-ci sont complétés, les étiquettes réunies, les notes
 * mises bout à bout ; la fiche absorbée part à la corbeille. Tout d'un bloc.
 */
router.post('/qualite/fusionner', ...acces, asyncHandler(async (req, res) => {
  const { garder_id, absorber_id } = req.body || {};
  if (!garder_id || !absorber_id || garder_id === absorber_id) return validationError(res, ['Deux fiches différentes sont attendues']);

  // Toutes les tables qui pointent vers un prospect, lues dans le schéma : pas de liste en
  // dur qui oublierait la prochaine. Il leur faut une colonne id pour pouvoir défaire.
  const refs = (await db.query(
    `SELECT c.table_name FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.column_name = 'prospect_id' AND c.table_name NOT IN ('prospects', 'corbeille')
       AND EXISTS (SELECT 1 FROM information_schema.columns i WHERE i.table_schema = 'public' AND i.table_name = c.table_name AND i.column_name = 'id')`
  )).rows.map(r => r.table_name);

  const cx = await db.connect();
  let apres;
  let absorbe;
  try {
    await cx.query('BEGIN');
    const garder = (await cx.query('SELECT * FROM prospects WHERE id = $1 FOR UPDATE', [garder_id])).rows[0];
    absorbe = (await cx.query('SELECT * FROM prospects WHERE id = $1 FOR UPDATE', [absorber_id])).rows[0];
    if (!garder || !absorbe) { await cx.query('ROLLBACK'); return res.status(404).json({ error: 'Fiche introuvable' }); }

    const deplaces = {};
    for (const table of refs) {
      const r = await cx.query(`UPDATE "${table}" SET prospect_id = $1 WHERE prospect_id = $2 RETURNING id`, [garder_id, absorber_id]);
      if (r.rowCount > 0) deplaces[table] = r.rows.map(x => x.id);
    }
    // Les sessions d'appel gardent des listes d'identifiants : la fiche gardée y prend la
    // place de l'absorbée (sans doublon). Ce sont des listes du jour : l'annulation n'y touche pas.
    const sessions = (await cx.query(`SELECT id, prospect_ids FROM sessions_appel WHERE prospect_ids LIKE $1`, [`%"${absorber_id}"%`])).rows;
    for (const s of sessions) {
      let ids = []; try { ids = JSON.parse(s.prospect_ids); } catch { ids = []; }
      const nouveaux = [...new Set(ids.map(x => (x === absorber_id ? garder_id : x)))];
      await cx.query('UPDATE sessions_appel SET prospect_ids = $1 WHERE id = $2', [JSON.stringify(nouveaux), s.id]);
    }

    // La fiche gardée : ses valeurs d'abord, celles de l'autre seulement là où elle est vide.
    const maj = {};
    for (const c of CHAMPS_FUSION) {
      if (c === 'tags' || c === 'notes') continue;
      if (vide(garder[c]) && !vide(absorbe[c])) maj[c] = absorbe[c];
    }
    const tags = [...new Set([...lireTags(garder.tags), ...lireTags(absorbe.tags)])];
    if (tags.length !== lireTags(garder.tags).length) maj.tags = JSON.stringify(tags);
    const notesAbsorbe = String(absorbe.notes || '').trim();
    const qui = (await cx.query('SELECT prenom FROM commerciaux WHERE id = $1', [req.user.id])).rows[0]?.prenom || '';
    const entete = `[Fusion ${new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}${qui ? ` · ${qui}` : ''}] Fiche « ${absorbe.nom_etablissement} »${absorbe.ville ? ` (${absorbe.ville})` : ''} fusionnée ici`;
    maj.notes = [String(garder.notes || '').trim(), notesAbsorbe ? `${entete} :\n${notesAbsorbe}` : entete].filter(Boolean).join('\n\n');
    maj.date_modification = new Date().toISOString();
    const colonnes = Object.keys(maj);
    const r = await cx.query(
      `UPDATE prospects SET ${colonnes.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
      [garder_id, ...colonnes.map(c => maj[c])]
    );
    apres = r.rows[0];

    const rangee = await archiver('prospect', absorber_id, req.user.id, { connexion: cx, trace: false });

    const avantChamps = {}, apresChamps = {};
    for (const c of colonnes) { if (c === 'date_modification') continue; avantChamps[c] = garder[c]; apresChamps[c] = apres[c]; }
    await noterAuJournal(cx, {
      userId: req.user.id, action: 'fusion', prospectId: garder_id, nom: garder.nom_etablissement, ville: garder.ville,
      details: `« ${absorbe.nom_etablissement} »${absorbe.ville ? ` (${absorbe.ville})` : ''} fusionnée dans « ${garder.nom_etablissement} »`
        + (Object.keys(deplaces).length ? ` — repris : ${Object.entries(deplaces).map(([t, ids]) => `${ids.length} ${t}`).join(', ')}` : ''),
      annulation: { garder_id, absorbe_id: absorber_id, corbeille_id: rangee.id, deplaces, avant: avantChamps, apres: apresChamps },
    });
    await cx.query('COMMIT');
  } catch (err) {
    try { await cx.query('ROLLBACK'); } catch { /* déjà perdue */ }
    throw err;
  } finally {
    cx.release();
  }
  await rattacherEntite('prospects', garder_id);
  await logActivity(req.user.id, 'prospect_fusionne', `« ${absorbe.nom_etablissement} » fusionnée dans « ${apres.nom_etablissement} »`, 'prospect', garder_id);
  const final = (await db.query('SELECT * FROM prospects WHERE id = $1', [garder_id])).rows[0];
  res.json({ ok: true, prospect: parseProspect(final), absorbe_id: absorber_id });
}));

// ---------------------------------------------------------------------------------------
// Prospects déjà clients
// ---------------------------------------------------------------------------------------
router.get('/qualite/deja-clients', ...acces, asyncHandler(async (req, res) => {
  const prospects = (await db.query(
    `SELECT ${COLONNES_FICHE} FROM prospects p LEFT JOIN commerciaux com ON com.id = p.commercial_id
     WHERE p.etape_pipeline NOT IN ('client_gagne', 'perdu', 'ne_pas_contacter') ORDER BY p.nom_etablissement`
  )).rows;
  const clients = (await db.query(
    `SELECT c.id, c.nom, c.ville, c.code_postal, c.email, c.telephone, c.telephone_mobile, c.siret, c.statut, c.prospect_id,
            com.prenom AS commercial_prenom, com.nom AS commercial_nom
     FROM clients c LEFT JOIN commerciaux com ON com.id = c.commercial_id WHERE c.id <> $1`,
    [SITE_INTERNET_CLIENT_ID]
  )).rows;
  const h = await historiques();
  const ecartees = new Set((await db.query('SELECT a, b FROM qualite_pas_doublons')).rows.map(r => `${r.a}|${r.b}`));
  const paires = pairesProbables(prospects, clients).filter(({ a, b }) => {
    const [k1, k2] = paireCle(prospects[a].id, clients[b].id);
    return !ecartees.has(`${k1}|${k2}`);
  }).map(({ a, b, score, motif }) => {
    const c = clients[b];
    return {
      score, motif,
      prospect: ficheVisible(prospects[a], h),
      client: { id: c.id, nom: c.nom, ville: c.ville || '', telephone: c.telephone || c.telephone_mobile || '', email: c.email || '', statut: c.statut, commercial: [c.commercial_prenom, c.commercial_nom].filter(Boolean).join(' ') },
    };
  });
  paires.sort((p, q) => q.score - p.score || p.prospect.nom.localeCompare(q.prospect.nom));
  res.json({ total: paires.length, certains: paires.filter(p => p.score === 100).length, paires: paires.slice(0, 500) });
}));

// Le prospect est en réalité ce client : il passe en Gagné et la fiche client s'y rattache.
router.post('/qualite/deja-client', ...acces, asyncHandler(async (req, res) => {
  const { prospect_id, client_id } = req.body || {};
  const p = (await db.query('SELECT * FROM prospects WHERE id = $1', [prospect_id])).rows[0];
  const c = (await db.query('SELECT id, nom, prospect_id FROM clients WHERE id = $1', [client_id])).rows[0];
  if (!p || !c) return res.status(404).json({ error: 'Fiche introuvable' });
  const lie = !c.prospect_id;
  if (lie) await db.query('UPDATE clients SET prospect_id = $1 WHERE id = $2 AND prospect_id IS NULL', [prospect_id, client_id]);
  await changerEtape(prospect_id, 'client_gagne', req.user.id);
  await noterAuJournal(db, {
    userId: req.user.id, action: 'deja_client', prospectId: prospect_id, nom: p.nom_etablissement, ville: p.ville,
    details: `« ${p.nom_etablissement} » est déjà le client « ${c.nom} » : passé en Gagné${lie ? ' et rattaché' : ''}`,
    annulation: { etape_avant: p.etape_pipeline, raison_avant: p.raison_perte || '', client_id: lie ? client_id : null },
  });
  const final = (await db.query('SELECT * FROM prospects WHERE id = $1', [prospect_id])).rows[0];
  res.json({ ok: true, prospect: parseProspect(final) });
}));

// ---------------------------------------------------------------------------------------
// Compléter une fiche
// ---------------------------------------------------------------------------------------
const CHAMPS_COMPLETABLES = ['nom_etablissement', 'type_etablissement', 'telephone', 'email', 'nom_contact', 'adresse',
  'code_postal', 'ville', 'departement', 'siret', 'latitude', 'longitude'];

router.post('/qualite/completer/:id', ...acces, asyncHandler(async (req, res) => {
  const p = (await db.query('SELECT * FROM prospects WHERE id = $1', [req.params.id])).rows[0];
  if (!p) return res.status(404).json({ error: 'Fiche introuvable' });
  const corps = req.body || {};
  const maj = {};
  for (const c of CHAMPS_COMPLETABLES) {
    if (corps[c] === undefined) continue;
    const v = (c === 'latitude' || c === 'longitude') ? (Number(corps[c]) || 0) : String(corps[c] ?? '').trim();
    if (c === 'nom_etablissement' && !v) return validationError(res, ['Le nom ne peut pas être vide']);
    if (String(v) !== String(p[c] ?? '')) maj[c] = v;
  }
  if (maj.code_postal !== undefined && maj.departement === undefined && /^\d{5}$/.test(maj.code_postal)) maj.departement = maj.code_postal.slice(0, 2);
  // Adresse changée sans coordonnées fournies : on place la fiche sur la carte nous-mêmes.
  const adresseChangee = ['adresse', 'code_postal', 'ville'].some(c => maj[c] !== undefined);
  if (adresseChangee && maj.latitude === undefined) {
    const adr = [maj.adresse ?? p.adresse, maj.code_postal ?? p.code_postal, maj.ville ?? p.ville].filter(Boolean).join(' ');
    const geo = await geocodeServer(adr);
    if (geo) { maj.latitude = geo.latitude; maj.longitude = geo.longitude; }
  }
  if (Object.keys(maj).length === 0) return res.json({ ok: true, prospect: parseProspect(p), inchange: true });

  maj.date_modification = new Date().toISOString();
  const colonnes = Object.keys(maj);
  const apres = (await db.query(
    `UPDATE prospects SET ${colonnes.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
    [req.params.id, ...colonnes.map(c => maj[c])]
  )).rows[0];
  if (maj.latitude !== undefined || maj.longitude !== undefined) await rattacherEntite('prospects', req.params.id);

  const avant = {}, apresChamps = {};
  for (const c of colonnes) { if (c === 'date_modification') continue; avant[c] = p[c]; apresChamps[c] = apres[c]; }
  const libelle = (c) => ({ nom_etablissement: 'nom', type_etablissement: 'type', telephone: 'téléphone', email: 'mail', nom_contact: 'contact', adresse: 'adresse', code_postal: 'code postal', ville: 'commune', departement: 'département', siret: 'SIRET', latitude: 'carte', longitude: 'carte' }[c] || c);
  await noterAuJournal(db, {
    userId: req.user.id, action: 'completee', prospectId: p.id, nom: apres.nom_etablissement, ville: apres.ville,
    details: `Complété : ${[...new Set(Object.keys(avant).map(libelle))].join(', ')}`,
    annulation: { avant, apres: apresChamps },
  });
  await logActivity(req.user.id, 'modification_prospect', `${apres.nom_etablissement} (qualité)`, 'prospect', p.id);
  const final = (await db.query('SELECT * FROM prospects WHERE id = $1', [req.params.id])).rows[0];
  res.json({ ok: true, prospect: parseProspect(final) });
}));

// ---------------------------------------------------------------------------------------
// Trier une fiche partagée
// ---------------------------------------------------------------------------------------
const DECISIONS = {
  qualifiee: { vers: 'a_contacter', libelle: 'qualifiée → À contacter' },
  pas_pour_nous: { vers: 'ne_pas_contacter', libelle: 'pas pour nous → Ne pas contacter' },
  ferme: { vers: 'perdu', raison: 'ferme', libelle: 'fermé → Perdu' },
};

router.post('/qualite/trier/:id', ...acces, asyncHandler(async (req, res) => {
  const { decision, note } = req.body || {};
  const d = DECISIONS[decision];
  if (!d) return validationError(res, ['Décision inconnue']);
  const p = (await db.query('SELECT * FROM prospects WHERE id = $1', [req.params.id])).rows[0];
  if (!p) return res.status(404).json({ error: 'Fiche introuvable' });
  // Qualifiée veut dire « un commercial peut appeler sans chercher » : on le vérifie ici aussi.
  if (decision === 'qualifiee' && !estQualifiable(p)) {
    return validationError(res, [`Il manque encore : ${manquesBloquants(p).map(m => LIBELLES_MANQUE[m]).join(', ')}`]);
  }
  let notesApres = null;
  const texte = String(note || '').trim();
  if (texte) {
    const qui = (await db.query('SELECT prenom FROM commerciaux WHERE id = $1', [req.user.id])).rows[0]?.prenom || '';
    const ligne = `[Qualité ${new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}${qui ? ` · ${qui}` : ''}] ${texte}`;
    notesApres = [String(p.notes || '').trim(), ligne].filter(Boolean).join('\n');
    await db.query('UPDATE prospects SET notes = $1, date_modification = $2 WHERE id = $3', [notesApres, new Date().toISOString(), p.id]);
  }
  await changerEtape(p.id, d.vers, req.user.id, { raison: d.raison || '' });
  await noterAuJournal(db, {
    userId: req.user.id, action: `tri_${decision}`, prospectId: p.id, nom: p.nom_etablissement, ville: p.ville,
    details: `Trié : ${d.libelle}${texte ? ` — « ${texte.slice(0, 120)} »` : ''}`,
    annulation: { etape_avant: p.etape_pipeline, raison_avant: p.raison_perte || '', notes_avant: notesApres !== null ? p.notes : null, notes_apres: notesApres },
  });
  const final = (await db.query('SELECT * FROM prospects WHERE id = $1', [p.id])).rows[0];
  res.json({ ok: true, prospect: parseProspect(final) });
}));

// ---------------------------------------------------------------------------------------
// Le journal, et défaire un geste
// ---------------------------------------------------------------------------------------
router.get('/qualite/journal', ...acces, asyncHandler(async (req, res) => {
  const depuis = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.depuis || '')) ? req.query.depuis : dateLocale(new Date(Date.now() - 7 * 86400000));
  // Chacun voit son propre travail ; l'administration voit celui de tout le monde.
  const qui = isAdmin(req) ? String(req.query.qui || '') : req.user.id;
  const params = [depuis];
  let filtre = '';
  if (qui) { params.push(qui); filtre = ` AND j.user_id = $${params.length}`; }
  const lignes = (await db.query(
    `SELECT j.id, j.user_id, j.action, j.prospect_id, j.nom, j.ville, j.details, j.created_at, j.annule_le,
            (j.annulation <> '') AS annulable, com.prenom, com.nom AS nom_membre
     FROM qualite_journal j LEFT JOIN commerciaux com ON com.id = j.user_id
     WHERE j.created_at >= ($1::date AT TIME ZONE 'Europe/Paris')${filtre}
     ORDER BY j.created_at DESC LIMIT 500`,
    params
  )).rows;
  const totaux = {};
  for (const l of lignes) {
    if (l.annule_le) continue;
    const t = totaux[l.user_id] || (totaux[l.user_id] = { qui: [l.prenom, l.nom_membre].filter(Boolean).join(' '), total: 0, par_action: {} });
    t.total += 1;
    t.par_action[l.action] = (t.par_action[l.action] || 0) + 1;
  }
  res.json({
    depuis,
    totaux: Object.entries(totaux).map(([user_id, t]) => ({ user_id, ...t })),
    lignes: lignes.map(l => ({
      id: l.id, user_id: l.user_id, qui: [l.prenom, l.nom_membre].filter(Boolean).join(' '), action: l.action,
      prospect_id: l.prospect_id, nom: l.nom, ville: l.ville, details: l.details, le: l.created_at,
      annule: !!l.annule_le, annulable: !!l.annulable && !l.annule_le,
    })),
  });
}));

/** Remet les champs listés à leur valeur d'avant, un par un, seulement s'ils n'ont pas bougé depuis. */
async function rendreChamps(cx, prospectId, avant, apres) {
  const actuel = (await cx.query('SELECT * FROM prospects WHERE id = $1', [prospectId])).rows[0];
  if (!actuel) return [];
  const aRendre = Object.keys(avant || {}).filter(c => String(actuel[c] ?? '') === String(apres?.[c] ?? ''));
  const gardes = Object.keys(avant || {}).filter(c => !aRendre.includes(c));
  if (aRendre.length) {
    await cx.query(
      `UPDATE prospects SET ${aRendre.map((c, i) => `${c} = $${i + 2}`).join(', ')}, date_modification = $${aRendre.length + 2} WHERE id = $1`,
      [prospectId, ...aRendre.map(c => avant[c]), new Date().toISOString()]
    );
  }
  return gardes;
}

router.post('/qualite/journal/:id/annuler', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const cx = await db.connect();
  let message = '';
  let prospectsTouches = [];
  try {
    await cx.query('BEGIN');
    const j = (await cx.query('SELECT * FROM qualite_journal WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!j) { await cx.query('ROLLBACK'); return res.status(404).json({ error: 'Geste introuvable' }); }
    if (j.annule_le) { await cx.query('ROLLBACK'); return validationError(res, ['Ce geste a déjà été annulé']); }
    if (!j.annulation) { await cx.query('ROLLBACK'); return validationError(res, ['Ce geste ne se défait pas']); }
    const a = JSON.parse(j.annulation);
    let gardes = [];

    if (j.action === 'fusion') {
      await restaurer(a.corbeille_id, req.user.id, { connexion: cx });
      for (const [table, ids] of Object.entries(a.deplaces || {})) {
        await cx.query(`UPDATE "${table}" SET prospect_id = $1 WHERE id = ANY($2) AND prospect_id = $3`, [a.absorbe_id, ids, a.garder_id]);
      }
      gardes = await rendreChamps(cx, a.garder_id, a.avant, a.apres);
      prospectsTouches = [a.garder_id, a.absorbe_id];
      message = 'Fusion défaite : les deux fiches sont de nouveau séparées';
    } else if (j.action === 'completee') {
      gardes = await rendreChamps(cx, j.prospect_id, a.avant, a.apres);
      prospectsTouches = [j.prospect_id];
      message = 'Modifications rendues';
    } else if (j.action.startsWith('tri_') || j.action === 'deja_client') {
      await changerEtape(j.prospect_id, a.etape_avant, req.user.id, { raison: a.raison_avant || '', executeur: cx });
      if (a.notes_apres !== null && a.notes_apres !== undefined) {
        gardes = await rendreChamps(cx, j.prospect_id, { notes: a.notes_avant }, { notes: a.notes_apres });
      }
      if (a.client_id) await cx.query('UPDATE clients SET prospect_id = NULL WHERE id = $1 AND prospect_id = $2', [a.client_id, j.prospect_id]);
      prospectsTouches = [j.prospect_id];
      message = 'Tri défait : la fiche est revenue à son étape';
    } else if (j.action === 'pas_doublon') {
      await cx.query('DELETE FROM qualite_pas_doublons WHERE a = $1 AND b = $2', [a.a, a.b]);
      message = 'La paire revient dans les doublons à vérifier';
    } else {
      await cx.query('ROLLBACK');
      return validationError(res, ['Ce geste ne se défait pas']);
    }
    await cx.query('UPDATE qualite_journal SET annule_le = NOW(), annule_par = $1 WHERE id = $2', [req.user.id, j.id]);
    await cx.query('COMMIT');
    if (gardes.length) message += ` (${gardes.length} champ(s) modifié(s) depuis gardé(s) tel(s) quel(s))`;
  } catch (err) {
    try { await cx.query('ROLLBACK'); } catch { /* déjà perdue */ }
    throw err;
  } finally {
    cx.release();
  }
  for (const id of prospectsTouches) await rattacherEntite('prospects', id);
  await logActivity(req.user.id, 'qualite_annule', message, 'prospect', prospectsTouches[0] || '');
  const prospects = prospectsTouches.length
    ? (await db.query('SELECT * FROM prospects WHERE id = ANY($1)', [prospectsTouches])).rows.map(parseProspect)
    : [];
  res.json({ ok: true, message, prospects });
}));

export default router;
