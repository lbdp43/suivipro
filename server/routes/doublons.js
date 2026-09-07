// Doublons clients : détection et fusion — routes déplacées telles quelles depuis routes.js.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import * as eb from '../easybeer-client.js';
import db from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { adminOnly, asyncHandler, authMiddleware, isAdmin } from '../lib/auth.js';
import { SITE_INTERNET_CLIENT_ID, extractEbFieldsSync, findMatchingClient, findMatchingProspect, linkClientToProspect } from '../lib/easybeer-sync.js';
import { geocodeServer } from '../lib/geo.js';
import { logActivity } from '../lib/journal.js';
import { preparerFiche, comparerFiches } from '../../shared/rapprochement.js';
import { validationError } from '../lib/validation.js';
import { calculateNextVisit } from '../lib/visites.js';

const router = Router();

// Paires de clients susceptibles d'etre le meme etablissement.
// Doublons entre PROSPECTS et CLIENTS : un prospect qu'on continue d'appeler alors qu'il
// est déjà client (importé d'EasyBeer, converti à la main…). Mêmes règles que les doublons
// de clients (SIRET / email / téléphone identique, nom identique ou proche), contacts
// partagés ignorés comme preuve.
router.get('/prospects/doublons-clients', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const prospects = (await db.query(
    `SELECT p.id, p.nom_etablissement AS nom, p.ville, p.code_postal, p.email, p.telephone, p.siret, p.etape_pipeline,
            p.commercial_id, p.date_creation, com.prenom AS commercial_prenom, com.nom AS commercial_nom,
            (SELECT COUNT(*) FROM calls c WHERE c.prospect_id = p.id) AS nb_appels,
            (SELECT COUNT(*) FROM appointments a WHERE a.prospect_id = p.id) AS nb_rdv
     FROM prospects p LEFT JOIN commerciaux com ON com.id = p.commercial_id
     WHERE p.etape_pipeline <> 'client_gagne'
     ORDER BY p.nom_etablissement`
  )).rows;
  const clients = (await db.query(
    `SELECT c.id, c.nom, c.ville, c.code_postal, c.email, c.telephone, c.siret, c.easybeer_id, c.statut,
            c.commercial_id, c.date_creation, com.prenom AS commercial_prenom, com.nom AS commercial_nom,
            (SELECT COUNT(*) FROM commandes cm WHERE cm.client_id = c.id) AS nb_commandes
     FROM clients c LEFT JOIN commerciaux com ON com.id = c.commercial_id
     WHERE c.id <> $1 ORDER BY c.nom`,
    [SITE_INTERNET_CLIENT_ID]
  )).rows;

  const prepP = prospects.map(preparerFiche);
  const prepC = clients.map(preparerFiche);
  const SEUIL_PARTAGE = 3;
  const freq = (vals) => { const m = new Map(); for (const v of vals) if (v) m.set(v, (m.get(v) || 0) + 1); return m; };
  const tous = [...prepP, ...prepC];
  const fe = freq(tous.map(c => c._email)), ft = freq(tous.map(c => c._tel));
  for (const c of tous) {
    c._emailPartage = !!c._email && (fe.get(c._email) || 0) >= SEUIL_PARTAGE;
    c._telPartage = !!c._tel && (ft.get(c._tel) || 0) >= SEUIL_PARTAGE;
  }
  const commercial = (x) => [x.commercial_prenom, x.commercial_nom].filter(Boolean).join(' ');
  const paires = [];
  for (let i = 0; i < prepP.length; i++) {
    for (let j = 0; j < prepC.length; j++) {
      const r = comparerFiches(prepP[i], prepC[j]);
      if (!r) continue;
      const p = prospects[i], c = clients[j];
      paires.push({
        score: r.score, motif: r.motif,
        prospect: { id: p.id, nom: p.nom, ville: p.ville || '', email: p.email || '', telephone: p.telephone || '', etape_pipeline: p.etape_pipeline, commercial: commercial(p), nb_appels: Number(p.nb_appels) || 0, nb_rdv: Number(p.nb_rdv) || 0 },
        client: { id: c.id, nom: c.nom, ville: c.ville || '', email: c.email || '', telephone: c.telephone || '', statut: c.statut, easybeer_id: c.easybeer_id || '', commercial: commercial(c), nb_commandes: Number(c.nb_commandes) || 0 },
      });
    }
  }
  paires.sort((x, y) => y.score - x.score || x.prospect.nom.localeCompare(y.prospect.nom));
  res.json({ total_prospects: prospects.length, total_clients: clients.length, total_paires: paires.length, certains: paires.filter(p => p.score === 100).length, paires: paires.slice(0, 2000) });
}));

router.get('/clients/doublons', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const clients = (await db.query(
    `SELECT c.id, c.nom, c.ville, c.code_postal, c.email, c.telephone, c.siret, c.easybeer_id,
            c.commercial_id, c.statut, c.type_client, c.date_creation,
            com.prenom AS commercial_prenom, com.nom AS commercial_nom,
            (SELECT COUNT(*) FROM commandes cm WHERE cm.client_id = c.id) AS nb_commandes,
            (SELECT COUNT(*) FROM interactions i WHERE i.client_id = c.id) AS nb_interactions,
            (SELECT COALESCE(SUM(cm.montant_ttc), 0) FROM commandes cm WHERE cm.client_id = c.id) AS ca_ttc
     FROM clients c
     LEFT JOIN commerciaux com ON com.id = c.commercial_id
     WHERE c.id <> $1
     ORDER BY c.nom`,
    [SITE_INTERNET_CLIENT_ID]
  )).rows;

  const fiche = (c) => ({
    id: c.id,
    nom: c.nom,
    ville: c.ville || '',
    code_postal: c.code_postal || '',
    email: c.email || '',
    telephone: c.telephone || '',
    siret: c.siret || '',
    easybeer_id: c.easybeer_id || '',
    statut: c.statut,
    type_client: c.type_client,
    date_creation: c.date_creation,
    commercial: [c.commercial_prenom, c.commercial_nom].filter(Boolean).join(' '),
    nb_commandes: Number(c.nb_commandes) || 0,
    nb_interactions: Number(c.nb_interactions) || 0,
    ca_ttc: Math.round((Number(c.ca_ttc) || 0) * 100) / 100,
  });

  const prepares = clients.map(preparerFiche);

  // Un email ou un telephone porte par 3 fiches ou plus est un contact partage
  // (boite mail de la brasserie, numero du siege...), pas un identifiant : il ne doit
  // pas suffire a declarer un doublon. Deux fiches restent le seuil normal d'un vrai
  // doublon, on ne coupe qu'au-dela.
  const SEUIL_PARTAGE = 3;
  const frequences = (valeurs) => {
    const m = new Map();
    for (const v of valeurs) if (v) m.set(v, (m.get(v) || 0) + 1);
    return m;
  };
  const freqEmail = frequences(prepares.map(c => c._email));
  const freqTel = frequences(prepares.map(c => c._tel));
  // La forme normalisee sert de cle, mais on reaffiche la valeur telle qu'elle est
  // saisie : « labrasseriedesplantesgmailcom » ne parle a personne.
  const lisible = new Map();
  for (const c of prepares) {
    if (c._email && !lisible.has(c._email)) lisible.set(c._email, String(c.email || '').trim().toLowerCase());
    if (c._tel && !lisible.has(c._tel)) lisible.set(c._tel, String(c.telephone || '').trim());
  }
  const partages = { emails: [], telephones: [] };
  for (const c of prepares) {
    c._emailPartage = !!c._email && (freqEmail.get(c._email) || 0) >= SEUIL_PARTAGE;
    c._telPartage = !!c._tel && (freqTel.get(c._tel) || 0) >= SEUIL_PARTAGE;
  }
  for (const [valeur, n] of freqEmail) if (n >= SEUIL_PARTAGE) partages.emails.push({ valeur: lisible.get(valeur) || valeur, clients: n });
  for (const [valeur, n] of freqTel) if (n >= SEUIL_PARTAGE) partages.telephones.push({ valeur: lisible.get(valeur) || valeur, clients: n });
  partages.emails.sort((a, b) => b.clients - a.clients);
  partages.telephones.sort((a, b) => b.clients - a.clients);

  const paires = [];
  for (let i = 0; i < prepares.length; i++) {
    for (let j = i + 1; j < prepares.length; j++) {
      const r = comparerFiches(prepares[i], prepares[j]);
      if (!r) continue;
      // Fiche a garder par defaut : celle qui porte le plus d'historique, puis la plus ancienne.
      const [a, b] = [fiche(clients[i]), fiche(clients[j])];
      const poids = (f) => f.nb_commandes * 10 + f.nb_interactions;
      const garder = poids(a) === poids(b)
        ? (String(a.date_creation || '') <= String(b.date_creation || '') ? a : b)
        : (poids(a) > poids(b) ? a : b);
      paires.push({
        score: r.score,
        motif: r.motif,
        suggestion_garder: garder.id,
        clients: [a, b],
      });
    }
  }
  paires.sort((x, y) => y.score - x.score || x.clients[0].nom.localeCompare(y.clients[0].nom));

  res.json({
    total_clients: clients.length,
    total_paires: paires.length,
    certains: paires.filter(p => p.score === 100).length,
    // Contacts ignores comme preuve d'identite (portes par >= 3 fiches).
    identifiants_partages: partages,
    // Repartition par niveau, pour que l'ecran puisse filtrer sans redemander la liste.
    par_score: {
      certains: paires.filter(p => p.score === 100).length,
      nom_identique: paires.filter(p => p.score === 80).length,
      nom_inclus: paires.filter(p => p.score === 60).length,
      mots_communs: paires.filter(p => p.score === 40).length,
    },
    // Plafond large : avec 300, des paires « nom identique » passaient a la trappe des
    // que les rapprochements plus surs etaient nombreux.
    affichees: Math.min(paires.length, 2000),
    paires: paires.slice(0, 2000),
  });
}));

// Fusionne deux clients : tout l'historique du doublon part sur la fiche gardee, les
// champs vides de celle-ci sont completes, puis le doublon est supprime.
router.post('/clients/fusionner', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { garder_id, supprimer_id } = req.body || {};
  if (!garder_id || !supprimer_id) return validationError(res, ['garder_id et supprimer_id sont requis']);
  if (garder_id === supprimer_id) return validationError(res, ['Les deux identifiants sont identiques']);
  if (garder_id === SITE_INTERNET_CLIENT_ID || supprimer_id === SITE_INTERNET_CLIENT_ID) {
    return validationError(res, ['Le groupe « Site internet » ne peut pas etre fusionne']);
  }

  const garder = (await db.query('SELECT * FROM clients WHERE id = $1', [garder_id])).rows[0];
  const doublon = (await db.query('SELECT * FROM clients WHERE id = $1', [supprimer_id])).rows[0];
  if (!garder || !doublon) return res.status(404).json({ error: 'Client introuvable' });

  // Toutes les tables qui referencent un client, decouvertes dans le schema : pas de
  // liste en dur qui se perimerait a la prochaine migration.
  const refs = (await db.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name <> 'clients'
       AND column_name IN ('client_id', 'imported_client_id')`
  )).rows;

  const dbClient = await db.connect();
  let deplacees = 0;
  const detailDeplacements = [];
  try {
    await dbClient.query('BEGIN');
    for (const ref of refs) {
      const r = await dbClient.query(
        `UPDATE "${ref.table_name}" SET "${ref.column_name}" = $1 WHERE "${ref.column_name}" = $2`,
        [garder_id, supprimer_id]
      );
      if (r.rowCount > 0) {
        deplacees += r.rowCount;
        detailDeplacements.push(`${ref.table_name}: ${r.rowCount}`);
      }
    }

    // Champs vides de la fiche gardee completes par ceux du doublon (jamais l'inverse).
    await dbClient.query(
      `UPDATE clients SET
         email = COALESCE(NULLIF(email,''), $2),
         telephone = COALESCE(NULLIF(telephone,''), $3),
         telephone_mobile = COALESCE(NULLIF(telephone_mobile,''), $4),
         adresse = COALESCE(NULLIF(adresse,''), $5),
         ville = COALESCE(NULLIF(ville,''), $6),
         code_postal = COALESCE(NULLIF(code_postal,''), $7),
         siret = COALESCE(NULLIF(siret,''), $8),
         contact = COALESCE(NULLIF(contact,''), $9),
         tournee = COALESCE(NULLIF(tournee,''), $10),
         easybeer_id = COALESCE(NULLIF(easybeer_id,''), $11),
         easybeer_numero = COALESCE(NULLIF(easybeer_numero,''), $12),
         commercial_id = COALESCE(commercial_id, $13),
         prospect_id = COALESCE(prospect_id, $19),
         latitude = CASE WHEN latitude IS NULL OR latitude = 0 THEN $14 ELSE latitude END,
         longitude = CASE WHEN longitude IS NULL OR longitude = 0 THEN $15 ELSE longitude END,
         last_visit = NULLIF(GREATEST(COALESCE(last_visit,''), COALESCE($16,'')), ''),
         notes = CASE WHEN COALESCE(NULLIF($17,''), '') = '' THEN notes
                      ELSE TRIM(BOTH E'\\n' FROM COALESCE(notes,'') || E'\\n' || $17) END,
         date_modification = $18
       WHERE id = $1`,
      [garder_id, doublon.email, doublon.telephone, doublon.telephone_mobile, doublon.adresse,
       doublon.ville, doublon.code_postal, doublon.siret, doublon.contact, doublon.tournee,
       doublon.easybeer_id, doublon.easybeer_numero, doublon.commercial_id,
       doublon.latitude, doublon.longitude, doublon.last_visit, doublon.notes,
       new Date().toISOString(), doublon.prospect_id]
    );

    await dbClient.query('DELETE FROM clients WHERE id = $1', [supprimer_id]);
    await dbClient.query('COMMIT');
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }

  const resume = `"${doublon.nom}" fusionne dans "${garder.nom}" (${deplacees} element(s) deplace(s)${detailDeplacements.length ? ' — ' + detailDeplacements.join(', ') : ''})`;
  console.log(`[Doublons] ${resume}`);
  logActivity(req.user.id, 'client_fusionne', resume, 'client', garder_id);

  res.json({ ok: true, message: resume, elements_deplaces: deplacees, detail: detailDeplacements });
}));

router.get('/easybeer/pending-clients', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query("SELECT * FROM easybeer_clients WHERE status = 'pending' ORDER BY synced_at DESC"); // les statuts 'site_internet' sont volontairement exclus
  res.json(result.rows);
}));

router.post('/easybeer/pending-clients/:id/import', authMiddleware, asyncHandler(async (req, res) => {
  const ebClient = await db.query('SELECT * FROM easybeer_clients WHERE id = $1', [req.params.id]);
  if (ebClient.rows.length === 0) return res.status(404).json({ error: 'Client EasyBeer non trouve' });

  const eb = ebClient.rows[0];
  const { commercial_id, type_client, tournee } = req.body;
  const now = new Date().toISOString();

  // Check if a matching client already exists (imported from Excel)
  const match = await findMatchingClient(eb.name, eb.email, eb.phone, eb.siret);
  const existingClient = match?.client;

  if (existingClient) {
    // Link to existing client instead of creating a duplicate (admin action, always proceed)
    await db.query(
      `UPDATE clients SET
        telephone_mobile = CASE WHEN (telephone_mobile IS NULL OR telephone_mobile = '') AND $2 != '' THEN $2 ELSE telephone_mobile END,
        siret = CASE WHEN (siret IS NULL OR siret = '') AND $3 != '' THEN $3 ELSE siret END,
        tournee = CASE WHEN (tournee IS NULL OR tournee = '') AND $4 != '' THEN $4 ELSE tournee END,
        latitude = CASE WHEN (latitude IS NULL OR latitude = 0) AND $5::double precision != 0 THEN $5 ELSE latitude END,
        longitude = CASE WHEN (longitude IS NULL OR longitude = 0) AND $6::double precision != 0 THEN $6 ELSE longitude END,
        contact = CASE WHEN (contact IS NULL OR contact = '') AND $7 != '' THEN $7 ELSE contact END,
        date_modification = $8
      WHERE id = $1`,
      [existingClient.id, eb.phone_mobile || '', eb.siret || '', tournee || eb.tournee || '',
       eb.latitude || 0, eb.longitude || 0, eb.contact_name || '', now]
    );

    await db.query("UPDATE easybeer_clients SET status = 'imported', imported_client_id = $1 WHERE id = $2", [existingClient.id, req.params.id]);

    // Link prospect too if exists
    const prospect = await findMatchingProspect(eb.name, eb.email, eb.phone);
    if (prospect && !existingClient.prospect_id) {
      await linkClientToProspect(existingClient.id, prospect, now);
    }

    return res.json({ ok: true, client_id: existingClient.id, linked_existing: true, linked_prospect: prospect?.id || null, match_type: match.matchType, confidence: match.confidence });
  }

  // No existing client found - create new one
  const clientType = type_client || 'BAR_RESTAURANT_GENERAL';
  const nextVisit = await calculateNextVisit(clientType, null, null);
  const clientId = `cli-${crypto.randomUUID()}`;

  const prospect = await findMatchingProspect(eb.name, eb.email, eb.phone);

  let lat = eb.latitude || prospect?.latitude || 0;
  let lng = eb.longitude || prospect?.longitude || 0;
  if ((!lat || !lng) && (eb.address || eb.city)) {
    const geo = await geocodeServer([eb.address, eb.postal_code, eb.city].filter(Boolean).join(' '));
    if (geo) { lat = geo.latitude; lng = geo.longitude; }
  }

  await db.query(
    `INSERT INTO clients (id, nom, ville, adresse, code_postal, telephone, telephone_mobile, email, contact,
     type_client, statut, commercial_id, next_visit, notes, siret, tournee, latitude, longitude, prospect_id, date_creation, date_modification)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    [clientId, eb.name, eb.city || '', eb.address || '', eb.postal_code || '',
     eb.phone || '', eb.phone_mobile || '', eb.email || '', eb.contact_name || '', clientType, 'ACTIF',
     commercial_id || prospect?.commercial_id || req.user.id, nextVisit || null,
     [prospect?.notes, eb.notes].filter(Boolean).join('\n') || '',
     eb.siret || '', tournee || prospect?.tournee || eb.tournee || '', lat, lng,
     prospect?.id || null, now, now]
  );

  if (prospect) {
    await linkClientToProspect(clientId, prospect, now);
  }

  await db.query("UPDATE easybeer_clients SET status = 'imported', imported_client_id = $1 WHERE id = $2", [clientId, req.params.id]);
  res.json({ ok: true, client_id: clientId, linked_prospect: prospect?.id || null });
}));

router.delete('/easybeer/pending-clients/:id', authMiddleware, asyncHandler(async (req, res) => {
  await db.query("UPDATE easybeer_clients SET status = 'dismissed' WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));

// Re-sync a pending client from EasyBeer API
router.post('/easybeer/pending-clients/:id/sync', authMiddleware, asyncHandler(async (req, res) => {
  const ebClient = await db.query('SELECT * FROM easybeer_clients WHERE id = $1', [req.params.id]);
  if (ebClient.rows.length === 0) return res.status(404).json({ error: 'Client non trouve' });
  const eb = ebClient.rows[0];
  const ebId = eb.easybeer_id;

  const configResult = await db.query('SELECT * FROM easybeer_config WHERE id = 1');
  const config = configResult.rows[0];
  if (!config?.username || !config?.api_url) {
    return res.json({ ok: false, message: 'Configuration EasyBeer incomplete' });
  }

  const authHeader = 'Basic ' + Buffer.from(`${config.username}:${decrypt(config.password)}`).toString('base64');
  const apiBase = (config.api_url || 'https://api.easybeer.fr').replace(/\/$/, '');
  const headers = { 'Authorization': authHeader, 'Accept': 'application/json' };

  // Helper to update client from data (uses shared extractEbFields from webhook handler)
  const updateFromData = async (data, path) => {
    const f = extractEbFieldsSync(data);
    const now = new Date().toISOString();
    await db.query(
      `UPDATE easybeer_clients SET
        name = COALESCE(NULLIF($2, ''), name),
        type = COALESCE(NULLIF($3, ''), type),
        contact_name = COALESCE(NULLIF($4, ''), contact_name),
        phone = COALESCE(NULLIF($5, ''), phone),
        phone_mobile = COALESCE(NULLIF($6, ''), phone_mobile),
        email = COALESCE(NULLIF($7, ''), email),
        city = COALESCE(NULLIF($8, ''), city),
        address = COALESCE(NULLIF($9, ''), address),
        postal_code = COALESCE(NULLIF($10, ''), postal_code),
        notes = COALESCE(NULLIF($11, ''), notes),
        commercial_email = COALESCE(NULLIF($12, ''), commercial_email),
        siret = COALESCE(NULLIF($13, ''), siret),
        tournee = COALESCE(NULLIF($14, ''), tournee),
        latitude = CASE WHEN $15::double precision != 0 THEN $15 ELSE latitude END,
        longitude = CASE WHEN $16::double precision != 0 THEN $16 ELSE longitude END,
        raw_data = $17, updated_at = $18
      WHERE id = $1`,
      [req.params.id, f.name, f.type, f.contact_name, f.phone, f.phone_mobile, f.email,
       f.city, f.address, f.postal_code, f.notes, f.commercial_email,
       f.siret, f.tournee, f.latitude, f.longitude, JSON.stringify(data), now]
    );
    return res.json({ ok: true, message: `Synchronise via ${path}`, name: f.name });
  };

  // Strategy 1: Try direct ID lookup via EasyBeer /parametres/client/detail/{id}
  const directPaths = [`/parametres/client/detail/${ebId}`, `/param%C3%A8tres/client/detail/${ebId}`, `/parametres/client/${ebId}`, `/client/${ebId}`];
  const errors = [];
  let firstErrorBody = '';

  for (const path of directPaths) {
    try {
      const resp = await fetch(`${apiBase}${path}`, { headers, signal: AbortSignal.timeout(15000) });
      if (resp.ok) {
        let data = await resp.json();
        if (Array.isArray(data)) data = data.find(d => String(d.id || d.idClient) === String(ebId)) || data[0] || {};
        return await updateFromData(data, path);
      } else {
        const body = await resp.text().catch(() => '');
        errors.push(`${path}: HTTP ${resp.status}`);
        if (!firstErrorBody && body) firstErrorBody = body.substring(0, 200);
      }
    } catch (err) {
      errors.push(`${path}: ${err.message}`);
    }
  }

  // Strategy 2: Fetch the full list via POST /parametres/client/liste and search by ID
  // Try Swagger format (query params) then legacy (body params)
  const listFormats = [
    { url: `${apiBase}/parametres/client/liste?colonneTri=libelle&nombreParPage=1000&numeroPage=0`, body: {} },
    { url: `${apiBase}/parametres/client/liste`, body: { colonneTri: 'libelle', mode: 'ASC', nombreParPage: 1000, numeroPage: 0 } },
  ];
  for (const fmt of listFormats) {
    try {
      const resp = await fetch(fmt.url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(fmt.body),
        signal: AbortSignal.timeout(20000)
      });
      if (resp.ok) {
        const data = await resp.json();
        const items = Array.isArray(data) ? data : (data.liste || data.results || data.data || data.items || []);
        if (Array.isArray(items)) {
          const match = items.find(d => String(d.id || d.idClient) === String(ebId));
          if (match) {
            return await updateFromData(match, `client/liste (${fmt.url.includes('?') ? 'swagger' : 'legacy'})`);
          }
          errors.push(`client/liste: OK (${items.length} items) mais ID ${ebId} non trouve`);
        }
      }
    } catch { /* ignore list errors */ }
  }

  const detail = firstErrorBody ? ` | Reponse API: ${firstErrorBody}` : '';
  return res.json({ ok: false, message: `Impossible de recuperer le client ${ebId}. ${errors.slice(0, 4).join(' | ')}${detail}` });
}));

// Assignment rules
router.get('/assignment-rules', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM assignment_rules ORDER BY created_at');
  res.json(result.rows);
}));

router.post('/assignment-rules', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { email, commercial_id } = req.body;
  if (!email || !commercial_id) return res.status(400).json({ error: 'Email et commercial requis' });
  const id = `rule-${Date.now()}`;
  const now = new Date().toISOString();
  await db.query(
    'INSERT INTO assignment_rules (id, email, commercial_id, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING',
    [id, email.toLowerCase(), commercial_id, now]
  );
  res.json({ ok: true, id });
}));

router.delete('/assignment-rules/:id', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM assignment_rules WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// Import clients from Excel (bulk)
router.post('/clients/import', authMiddleware, asyncHandler(async (req, res) => {
  const { clients, newCommerciaux } = req.body;
  if (!Array.isArray(clients) || clients.length === 0) {
    return res.status(400).json({ error: 'Liste de clients requise' });
  }

  const commerciauxCreated = [];

  // Auto-create missing commercials if provided (admin only)
  if (isAdmin(req) && Array.isArray(newCommerciaux) && newCommerciaux.length > 0) {
    for (const nc of newCommerciaux) {
      try {
        // Check if email already exists
        const existing = await db.query('SELECT id FROM commerciaux WHERE LOWER(email) = LOWER($1)', [nc.email]);
        if (existing.rows.length > 0) continue;

        const hashedPwd = bcrypt.hashSync(nc.password || 'Changeme1', 10);
        const comId = nc.id || `com-${crypto.randomUUID()}`;
        await db.query(
          'INSERT INTO commerciaux (id, prenom, nom, email, telephone, role, password, objectifs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [comId, nc.prenom || '', nc.nom || '', nc.email, nc.telephone || '', nc.role || 'commercial', hashedPwd, JSON.stringify(nc.objectifs || {})]
        );
        commerciauxCreated.push({ id: comId, email: nc.email, prenom: nc.prenom || '', nom: nc.nom || '' });
      } catch (err) {
        console.error('Error creating commercial:', nc.email, err.message);
      }
    }
  }

  let imported = 0;
  let skipped = 0;
  let enrichedFromProspect = 0;
  const importErrors = [];

  for (const c of clients) {
    try {
      const now = new Date().toISOString();
      const clientType = c.type_client || 'BAR_RESTAURANT_GENERAL';
      const nextVisit = await calculateNextVisit(clientType, c.custom_recurrence || null, null);

      // --- Prospect matching & enrichment ---
      // Search for a matching prospect by SIRET, email, phone, or name
      const prospect = await findMatchingProspect(c.nom, c.email, c.telephone || c.telephone_mobile);
      // Also try SIRET-based match if not found by other means
      let prospectMatch = prospect;
      if (!prospectMatch && c.siret && c.siret.length >= 9) {
        const siretRes = await db.query("SELECT * FROM prospects WHERE siret = $1 AND siret != '' LIMIT 1", [c.siret]);
        if (siretRes.rows.length > 0) prospectMatch = siretRes.rows[0];
      }

      // Import data takes precedence; prospect fills empty fields (enrichment)
      let finalVille = c.ville || '';
      let finalAdresse = c.adresse || '';
      let finalCp = c.code_postal || '';
      let finalTel = c.telephone || '';
      let finalTelMobile = c.telephone_mobile || '';
      let finalEmail = c.email || '';
      let finalContact = c.contact || '';
      let finalNotes = c.notes || '';
      let finalTournee = c.tournee || '';
      let finalSiret = c.siret || '';
      let finalLat = c.latitude || 0;
      let finalLng = c.longitude || 0;
      let finalCommercialId = c.commercial_id;
      let prospectId = null;

      if (prospectMatch) {
        // Prospect data serves as enrichment: fill empty fields from prospect
        if (!finalVille && prospectMatch.ville) finalVille = prospectMatch.ville;
        if (!finalAdresse && prospectMatch.adresse) finalAdresse = prospectMatch.adresse;
        if (!finalCp && prospectMatch.code_postal) finalCp = prospectMatch.code_postal;
        if (!finalTel && prospectMatch.telephone) finalTel = prospectMatch.telephone;
        if (!finalEmail && prospectMatch.email) finalEmail = prospectMatch.email;
        if (!finalContact && prospectMatch.nom_contact) finalContact = prospectMatch.nom_contact;
        if (!finalTournee && prospectMatch.secteur) finalTournee = prospectMatch.secteur;
        if (!finalSiret && prospectMatch.siret) finalSiret = prospectMatch.siret;
        if ((!finalLat || finalLat === 0) && prospectMatch.latitude) finalLat = prospectMatch.latitude;
        if ((!finalLng || finalLng === 0) && prospectMatch.longitude) finalLng = prospectMatch.longitude;
        if (!finalCommercialId && prospectMatch.commercial_id) finalCommercialId = prospectMatch.commercial_id;
        // Merge notes: import notes first, then prospect notes if different
        if (prospectMatch.notes && prospectMatch.notes !== finalNotes) {
          finalNotes = finalNotes ? `${finalNotes}\n---\nNotes prospect: ${prospectMatch.notes}` : prospectMatch.notes;
        }
        prospectId = prospectMatch.id;
        enrichedFromProspect++;
      }

      await db.query(
        `INSERT INTO clients (id, nom, ville, adresse, code_postal, telephone, telephone_mobile, email, contact,
         type_client, statut, commercial_id, next_visit, last_visit, notes, custom_recurrence, tournee, siret,
         latitude, longitude, prospect_id, date_creation, date_modification)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [c.id, c.nom, finalVille, finalAdresse, finalCp,
         finalTel, finalTelMobile, finalEmail, finalContact,
         clientType, 'ACTIF', finalCommercialId, nextVisit || null, c.last_visit || null, finalNotes,
         c.custom_recurrence || null, finalTournee, finalSiret, finalLat, finalLng, prospectId, now, now]
      );

      // Link prospect to client: mark prospect as client_gagne
      if (prospectMatch) {
        await db.query(
          'UPDATE prospects SET etape_pipeline = $1, date_modification = $2 WHERE id = $3',
          ['client_gagne', now, prospectMatch.id]
        );
      }

      // Try to link to EasyBeer client (for order sync)
      try {
        const ebMatch = await db.query(
          `SELECT easybeer_id FROM easybeer_clients WHERE status = 'pending' AND (
            (name != '' AND LOWER(name) = LOWER($1))
            OR (email != '' AND LOWER(email) = LOWER($2))
            OR (siret != '' AND siret = $3 AND LENGTH(siret) >= 9)
            OR (phone != '' AND REPLACE(REPLACE(REPLACE(phone, ' ', ''), '.', ''), '-', '') = REPLACE(REPLACE(REPLACE($4, ' ', ''), '.', ''), '-', ''))
          ) LIMIT 1`,
          [c.nom || '', finalEmail || '', finalSiret || '', finalTel || '']
        );
        if (ebMatch.rows.length > 0) {
          await db.query(
            "UPDATE easybeer_clients SET status = 'imported', imported_client_id = $1, updated_at = $2 WHERE easybeer_id = $3",
            [c.id, now, ebMatch.rows[0].easybeer_id]
          );
          console.log(`[Import Excel] Client ${c.nom} lie a EasyBeer id=${ebMatch.rows[0].easybeer_id}`);
        }
      } catch (ebErr) {
        console.log(`[Import Excel] EasyBeer link check failed for ${c.nom}: ${ebErr.message}`);
      }

      imported++;
    } catch (err) {
      if (err.code === '23505') {
        skipped++;
      } else {
        importErrors.push(`${c.nom}: ${err.message}`);
      }
    }
  }
  res.json({ ok: true, imported, skipped, enrichedFromProspect, commerciauxCreated, errors: importErrors });
}));

export default router;
