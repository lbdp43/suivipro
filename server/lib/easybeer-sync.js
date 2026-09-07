// Helpers partagés (easybeer-sync) — déplacés tels quels depuis routes.js.
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import * as eb from '../easybeer-client.js';
import db from '../db.js';
import { calculateNextVisit } from './visites.js';

// Map EasyBeer client type (free text) to SuiviPro ClientType enum
export function mapEasyBeerTypeToClientType(ebType) {
  if (!ebType) return 'BAR_RESTAURANT_GENERAL';
  const t = ebType.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  // Cave / Epicerie / Caviste
  if (t.includes('cave') || t.includes('epicerie') || t.includes('caviste') || t.includes('fromager'))
    return 'CAVE_EPICERIE';

  // Grand public / Particulier
  if (t.includes('particulier') || t.includes('grand public') || t.includes('individuel') || t.includes('prive'))
    return 'GRAND_PUBLIC';

  // Bar / Restaurant (includes many subcategories)
  if (t.includes('bar') || t.includes('restaurant') || t.includes('brasserie')
      || t.includes('bistrot') || t.includes('cafe') || t.includes('hotel')
      || t.includes('traiteur') || t.includes('snack') || t.includes('pizz')
      || t.includes('creperi') || t.includes('salon de the') || t.includes('pub'))
    return 'BAR_RESTAURANT_GENERAL';

  // Comite d'entreprise
  if (t.includes('comite') || t.includes('ce ') || t.includes('cse'))
    return 'COMITE_ENTREPRISE';

  // Distributeur
  if (t.includes('distribut') || t.includes('grossiste') || t.includes('revendeur'))
    return 'DISTRIBUTEUR';

  // Souchon
  if (t.includes('souchon'))
    return 'SOUCHON';

  // Export
  if (t.includes('export'))
    return 'EXPORT';

  // Mariage / Evenement
  if (t.includes('mariage') || t.includes('evenement') || t.includes('fete') || t.includes('reception'))
    return 'MARIAGE';

  // Picologie
  if (t.includes('picolog'))
    return 'PICOLOGIE';

  // Fallback
  return 'BAR_RESTAURANT_GENERAL';
}

// Shared function to extract fields from EasyBeer API data
// Handles nested structures: adresses[], contacts[], GPS, tournee, siret, etc.
export function extractEbFieldsSync(data) {
  // ========== ADRESSE ==========
  let adresse = '', ville = '', codePostal = '';
  let adresseObj = null;
  if (data.adresses && Array.isArray(data.adresses) && data.adresses.length > 0) {
    adresseObj = data.adresses.find(a => a.type === 'Facturation' || a.type === 'facturation' || a.principale) || data.adresses[0];
  } else if (data.adresse && typeof data.adresse === 'object') {
    adresseObj = data.adresse;
  } else if (data.adresseFacturation && typeof data.adresseFacturation === 'object') {
    adresseObj = data.adresseFacturation;
  }
  if (adresseObj) {
    if (adresseObj.numero && adresseObj.rue) adresse = `${adresseObj.numero} ${adresseObj.rue}`.trim();
    else if (adresseObj.rue) adresse = adresseObj.rue;
    else {
      const lignes = [
        adresseObj.ligne1 || adresseObj.adresse1 || adresseObj.adresse,
        adresseObj.ligne2 || adresseObj.adresse2 || adresseObj.complement,
        adresseObj.ligne3, adresseObj.ligne4
      ].filter(l => l && String(l).trim());
      adresse = lignes.join(', ');
      if (!adresse && (adresseObj.complete || adresseObj.libelle || adresseObj.adresseComplete)) {
        adresse = adresseObj.complete || adresseObj.libelle || adresseObj.adresseComplete;
      }
    }
    ville = adresseObj.ville || adresseObj.commune || adresseObj.city || '';
    codePostal = adresseObj.codePostal || adresseObj.cp || adresseObj.zipCode || adresseObj.code_postal || '';
  }
  // ========== CONTACTS ==========
  let contactName = '', contactEmail = '', contactTel = '', contactMobile = '';
  let contactObj = null;
  if (data.contacts && Array.isArray(data.contacts) && data.contacts.length > 0) {
    contactObj = data.contacts.find(c => c.type === 'Principal' || c.type === 'principal' || c.principal) || data.contacts[0];
  } else if (data.listeContacts && Array.isArray(data.listeContacts) && data.listeContacts.length > 0) {
    contactObj = data.listeContacts.find(c => c.type === 'Principal' || c.principal) || data.listeContacts[0];
  } else if (data.contactPrincipal && typeof data.contactPrincipal === 'object') {
    contactObj = data.contactPrincipal;
  }
  if (contactObj && typeof contactObj === 'object') {
    contactName = contactObj.denomination || contactObj.libelle || `${contactObj.prenom || ''} ${contactObj.nom || ''}`.trim();
    contactEmail = contactObj.email || contactObj.emailPrincipal || contactObj.mail || '';
    contactTel = contactObj.telephone || contactObj.telephonePrincipal || contactObj.tel || contactObj.phone || '';
    contactMobile = contactObj.mobile || contactObj.portable || contactObj.gsm || contactObj.telephoneMobile || '';
  }
  // ========== TELEPHONE ==========
  const phoneFix = data.telephonePrincipal || data.telephone || contactTel || data.tel || '';
  const phoneMobile = contactMobile || data.mobile || data.portable || '';
  const phone = phoneMobile || phoneFix;
  // ========== GPS ==========
  let latitude = 0, longitude = 0;
  if (adresseObj) {
    if (adresseObj.latitude != null && adresseObj.longitude != null) {
      latitude = parseFloat(adresseObj.latitude) || 0;
      longitude = parseFloat(adresseObj.longitude) || 0;
    } else if (adresseObj.lat != null && adresseObj.lng != null) {
      latitude = parseFloat(adresseObj.lat) || 0;
      longitude = parseFloat(adresseObj.lng) || 0;
    } else if (adresseObj.coordonnees) {
      latitude = parseFloat(adresseObj.coordonnees.latitude || adresseObj.coordonnees.lat) || 0;
      longitude = parseFloat(adresseObj.coordonnees.longitude || adresseObj.coordonnees.lng) || 0;
    }
  }
  if (!latitude && !longitude) {
    if (data.latitude != null && data.longitude != null) {
      latitude = parseFloat(data.latitude) || 0;
      longitude = parseFloat(data.longitude) || 0;
    } else if (data.coordonnees) {
      latitude = parseFloat(data.coordonnees.latitude || data.coordonnees.lat) || 0;
      longitude = parseFloat(data.coordonnees.longitude || data.coordonnees.lng) || 0;
    } else if (data.geoloc) {
      latitude = parseFloat(data.geoloc.latitude || data.geoloc.lat) || 0;
      longitude = parseFloat(data.geoloc.longitude || data.geoloc.lng) || 0;
    }
  }
  // ========== TOURNEE ==========
  let tournee = '';
  if (data.tournee) {
    if (typeof data.tournee === 'string') tournee = data.tournee;
    else tournee = data.tournee.libelle || data.tournee.nom || data.tournee.code || '';
  }
  // ========== TYPE ==========
  let typeStr = data.type || '';
  let typeId = '';
  if (typeof data.type === 'object' && data.type) {
    typeStr = data.type.libelle || data.type.code || '';
    typeId = data.type.idClientType != null ? String(data.type.idClientType) : '';
  }
  // ========== IDENTIFIANTS NATIFS EASYBEER (cles de jointure fiables) ==========
  const easybeerId = String(data.idClient || data.id || '');
  const numeroClient = data.numero || data.numeroClient || '';
  let commercialEasybeerId = '';
  if (data.commercial && typeof data.commercial === 'object' && data.commercial.id != null) commercialEasybeerId = String(data.commercial.id);
  let tourneeId = '';
  if (data.tournee && typeof data.tournee === 'object' && data.tournee.idClientTournee != null) tourneeId = String(data.tournee.idClientTournee);

  return {
    name: data.nom || data.libelle || data.raisonSociale || data.name || '',
    type: typeStr,
    contact_name: contactName || data.contact_name || data.contact || '',
    phone,
    phone_mobile: phoneMobile,
    email: data.emailPrincipal || data.email || contactEmail || data.mail || '',
    city: ville || data.ville || data.city || '',
    address: adresse || data.address || '',
    postal_code: codePostal || data.postal_code || data.cp || '',
    notes: data.notes || data.commentaire || data.observation || '',
    // Identifiants natifs EasyBeer
    easybeer_id: easybeerId,
    numero: numeroClient,
    commercial_easybeer_id: commercialEasybeerId,
    type_id: typeId,
    tournee_id: tourneeId,
    commercial_email: data.commercial?.email || data.commercial?.emailPrincipal || data.commercial_email || data.commercialEmail
      || data.representant?.email || data.vendeur?.email || data.agent?.email || '',
    commercial_name: (data.commercial && typeof data.commercial === 'object'
      ? (`${data.commercial.prenom || ''} ${data.commercial.nom || ''}`.trim() || data.commercial.libelle || data.commercial.denomination || '')
      : '') || (data.representant && typeof data.representant === 'object'
      ? (`${data.representant.prenom || ''} ${data.representant.nom || ''}`.trim()) : '')
      || (typeof data.commercial === 'string' ? data.commercial : '')
      || (typeof data.representant === 'string' ? data.representant : '')
      || '',
    siret: data.siret || data.siren || '',
    tournee,
    latitude,
    longitude,
  };
}

// Helper: find matching prospect by name, email, or phone
export async function findMatchingProspect(name, email, phone) {
  if (!name && !email && !phone) return null;
  if (email) {
    const r = await db.query('SELECT * FROM prospects WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
    if (r.rows.length > 0) return r.rows[0];
  }
  if (phone) {
    const cleanPhone = phone.replace(/[\s\-\.]/g, '');
    const r = await db.query("SELECT * FROM prospects WHERE REPLACE(REPLACE(REPLACE(telephone, ' ', ''), '-', ''), '.', '') = $1 LIMIT 1", [cleanPhone]);
    if (r.rows.length > 0) return r.rows[0];
  }
  if (name) {
    const r = await db.query('SELECT * FROM prospects WHERE LOWER(nom_etablissement) = LOWER($1) LIMIT 1', [name]);
    if (r.rows.length > 0) return r.rows[0];
  }
  return null;
}

// Helper: garantir le groupe « Site internet » (commandes WooCommerce/Shopify…)
// Un pseudo-commercial sans login + un client de regroupement : les ventes web
// n'appartiennent à personne mais restent visibles et comptées au même endroit.
export const SITE_INTERNET_COMMERCIAL_ID = 'com-site-internet';

export const SITE_INTERNET_CLIENT_ID = 'cli-site-internet';

export async function ensureSiteInternetGroup() {
  const now = new Date().toISOString();
  // Pseudo-commercial (mot de passe aléatoire : personne ne se connecte avec)
  const com = await db.query('SELECT id FROM commerciaux WHERE id = $1', [SITE_INTERNET_COMMERCIAL_ID]);
  if (com.rows.length === 0) {
    const motDePasse = await bcrypt.hash(crypto.randomUUID(), 10);
    await db.query(
      `INSERT INTO commerciaux (id, prenom, nom, email, role, password) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO NOTHING`,
      [SITE_INTERNET_COMMERCIAL_ID, 'Site', 'Internet', 'site-internet@suivipro.local', 'commercial', motDePasse]
    );
    console.log('[Site internet] Pseudo-commercial cree');
  }
  const cli = await db.query('SELECT id FROM clients WHERE id = $1', [SITE_INTERNET_CLIENT_ID]);
  if (cli.rows.length === 0) {
    await db.query(
      `INSERT INTO clients (id, nom, type_client, statut, commercial_id, notes, date_creation, date_modification)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) ON CONFLICT (id) DO NOTHING`,
      [SITE_INTERNET_CLIENT_ID, 'Site internet (ventes web)', 'BAR_RESTAURANT_GENERAL', 'ACTIF',
       SITE_INTERNET_COMMERCIAL_ID, 'Groupe automatique : toutes les commandes du site internet (WooCommerce). Non affecté à un commercial.', now]
    );
    console.log('[Site internet] Client de regroupement cree');
  }
  return SITE_INTERNET_CLIENT_ID;
}

// Client SuiviPro correspondant a un idClient Easybeer.
// Priorite au lien natif porte par la fiche client (pose par la synchro clients) : la
// table de staging easybeer_clients n'a de ligne que pour les fiches passees par un
// webhook, donc elle rate la majorite des clients synchronises depuis l'API.
export async function clientLocalDepuisEasybeerId(ebClientId) {
  if (!ebClientId) return null;
  const direct = await db.query('SELECT id FROM clients WHERE easybeer_id = $1 LIMIT 1', [String(ebClientId)]);
  if (direct.rows.length > 0) return direct.rows[0].id;
  const staging = await db.query(
    "SELECT imported_client_id FROM easybeer_clients WHERE easybeer_id = $1 AND status = 'imported' AND imported_client_id IS NOT NULL LIMIT 1",
    [String(ebClientId)]
  );
  return staging.rows[0]?.imported_client_id || null;
}

// Une commande Easybeer vient-elle du site web ? (drapeaux posés par Easybeer)
export function estCommandeWeb(det) {
  return Boolean(det && (det.wooCommerce || det.shopify || det.prestashop || det.marketPlace));
}

// Helper: find matching existing client by name, email, phone, or SIRET
// Returns { client, confidence: 'high'|'medium'|'low', matchType } or null
export async function findMatchingClient(name, email, phone, siret) {
  if (!name && !email && !phone && !siret) return null;

  // Un identifiant ne prouve une identite que s'il ne designe QU'UN seul client. Avec
  // « LIMIT 1 », une boite mail de societe partagee par dizaines de fiches
  // (labrasseriedesplantes@gmail.com par ex.) faisait matcher n'importe laquelle d'entre
  // elles, au hasard de l'ordre renvoye par Postgres. On lit deux lignes : s'il y en a
  // deux, la valeur n'est pas discriminante et on passe au critere suivant.
  const unique = async (sql, params) => {
    const r = await db.query(sql, params);
    return r.rows.length === 1 ? r.rows[0] : null;
  };

  if (siret && siret.length >= 9) {
    const c = await unique('SELECT * FROM clients WHERE siret = $1 LIMIT 2', [siret]);
    if (c) return { client: c, confidence: 'high', matchType: 'siret' };
  }
  if (email) {
    const c = await unique('SELECT * FROM clients WHERE LOWER(email) = LOWER($1) LIMIT 2', [email]);
    if (c) return { client: c, confidence: 'high', matchType: 'email' };
  }
  if (phone) {
    const cleanPhone = phone.replace(/[\s\-\.]/g, '');
    if (cleanPhone.length >= 8) {
      const c = await unique("SELECT * FROM clients WHERE REPLACE(REPLACE(REPLACE(telephone, ' ', ''), '-', ''), '.', '') = $1 OR REPLACE(REPLACE(REPLACE(telephone_mobile, ' ', ''), '-', ''), '.', '') = $1 LIMIT 2", [cleanPhone]);
      if (c) return { client: c, confidence: 'high', matchType: 'phone' };
    }
  }
  if (name) {
    const c = await unique('SELECT * FROM clients WHERE LOWER(nom) = LOWER($1) LIMIT 2', [name]);
    if (c) return { client: c, confidence: 'medium', matchType: 'name_exact' };
  }
  // Fuzzy name: try without common suffixes/prefixes and trimmed
  if (name && name.length > 4) {
    const normalized = name.trim().toLowerCase()
      .replace(/^(le |la |l'|les |au |aux |chez )/i, '')
      .replace(/(sarl|sas|eurl|sa|srl| & cie)$/i, '')
      .trim();
    if (normalized.length > 3) {
      const c = await unique('SELECT * FROM clients WHERE LOWER(nom) LIKE $1 LIMIT 2', [`%${normalized}%`]);
      if (c) return { client: c, confidence: 'low', matchType: 'name_fuzzy' };
    }
  }
  return null;
}

// Helper: link a newly created client to a matching prospect
export async function linkClientToProspect(clientId, prospect, now) {
  // Update client to reference the prospect
  await db.query('UPDATE clients SET prospect_id = $1 WHERE id = $2', [prospect.id, clientId]);
  // Move prospect to client_gagne
  await db.query(
    'UPDATE prospects SET etape_pipeline = $1, date_modification = $2 WHERE id = $3',
    ['client_gagne', now, prospect.id]
  );
  console.log(`[EasyBeer] Client ${clientId} linked to prospect ${prospect.id} (${prospect.nom_etablissement})`);
}

// Resolve a SuiviPro commercial id from an EasyBeer native commercial id (idCommercial).
export async function resolveCommercialFromEasybeer(easybeerCommercialId) {
  if (!easybeerCommercialId) return null;
  const r = await db.query(
    'SELECT suivipro_commercial_id FROM easybeer_commerciaux WHERE easybeer_id = $1 AND actif = TRUE',
    [String(easybeerCommercialId)]
  );
  return r.rows.length > 0 ? r.rows[0].suivipro_commercial_id : null;
}

// Insert/update one client from an EasyBeer client object. Returns 'created' | 'updated' | 'skipped'.
// Clients only (never prospects). Attribution by native idCommercial, else keeps existing.
// forceClient : importer la fiche meme si EasyBeer la classe en prospect. Reserve aux
// fiches qui ont reellement passe commande — une fiche qui achete est un client de fait.
export async function upsertClientFromEasybeer(cli, { forceClient = false } = {}) {
  // Clients uniquement : ignorer toute fiche marquee PROSPECT cote EasyBeer (etat.code).
  if (!forceClient && String(cli?.etat?.code || '').toUpperCase() === 'PROSPECT') return 'skipped';
  const f = extractEbFieldsSync(cli);
  if (!f.easybeer_id && !f.name) return 'skipped';
  const now = new Date().toISOString();
  const mappedCommercial = await resolveCommercialFromEasybeer(f.commercial_easybeer_id);
  const clientType = mapEasyBeerTypeToClientType(f.type);

  let existing = null;
  if (f.easybeer_id) existing = (await db.query('SELECT * FROM clients WHERE easybeer_id = $1 LIMIT 1', [f.easybeer_id])).rows[0] || null;
  if (!existing) {
    // findMatchingClient renvoie { client, confidence, matchType } : il faut en extraire
    // la fiche. Sans ca l'UPDATE partait sur un id undefined et ne touchait aucune ligne
    // — le client etait annonce « mis a jour » sans jamais recevoir son easybeer_id.
    const m = await findMatchingClient(f.name, f.email, f.phone, f.siret);
    // On ne fusionne que sur un identifiant fort (siret/email/telephone) ou un nom
    // strictement identique. Un rapprochement flou cree une nouvelle fiche : un doublon
    // se voit et se corrige, une fusion erronee melange silencieusement deux etablissements.
    // Et jamais sur une fiche deja rattachee a un AUTRE client EasyBeer : deux fiches
    // homonymes se voleraient leur lien a chaque synchro.
    const dejaLie = m && m.client.easybeer_id && String(m.client.easybeer_id) !== String(f.easybeer_id);
    if (m && !dejaLie && (m.confidence === 'high' || m.confidence === 'medium')) existing = m.client;
    else if (m) console.log(`[EasyBeer SyncClients] "${f.name}" ~ "${m.client.nom}" (${m.matchType}, ${m.confidence}${dejaLie ? ', deja lie a une autre fiche EasyBeer' : ''}) : pas de fusion, nouvelle fiche creee`);
  }

  if (existing) {
    await db.query(
      `UPDATE clients SET
         nom = COALESCE(NULLIF($2,''), nom),
         ville = COALESCE(NULLIF($3,''), ville),
         adresse = COALESCE(NULLIF($4,''), adresse),
         code_postal = COALESCE(NULLIF($5,''), code_postal),
         telephone = COALESCE(NULLIF($6,''), telephone),
         telephone_mobile = COALESCE(NULLIF($7,''), telephone_mobile),
         email = COALESCE(NULLIF($8,''), email),
         contact = COALESCE(NULLIF($9,''), contact),
         siret = COALESCE(NULLIF($10,''), siret),
         tournee = COALESCE(NULLIF($11,''), tournee),
         latitude = CASE WHEN $12::double precision != 0 THEN $12 ELSE latitude END,
         longitude = CASE WHEN $13::double precision != 0 THEN $13 ELSE longitude END,
         easybeer_id = COALESCE(NULLIF($14,''), easybeer_id),
         easybeer_numero = COALESCE(NULLIF($15,''), easybeer_numero),
         easybeer_commercial_id = COALESCE(NULLIF($16,''), easybeer_commercial_id),
         easybeer_type_id = COALESCE(NULLIF($17,''), easybeer_type_id),
         easybeer_tournee_id = COALESCE(NULLIF($18,''), easybeer_tournee_id),
         commercial_id = CASE WHEN (commercial_id IS NULL OR commercial_id = '') AND $19 <> '' THEN $19 ELSE commercial_id END,
         date_modification = $20
       WHERE id = $1`,
      [existing.id, f.name, f.city, f.address, f.postal_code, f.phone, f.phone_mobile, f.email, f.contact_name,
       f.siret, f.tournee, f.latitude, f.longitude, f.easybeer_id, f.numero, f.commercial_easybeer_id, f.type_id, f.tournee_id,
       mappedCommercial || '', now]
    );
    if (f.easybeer_id) {
      try { await db.query("UPDATE easybeer_clients SET status='imported', imported_client_id=$1 WHERE easybeer_id=$2", [existing.id, f.easybeer_id]); } catch { /* staging row may be absent */ }
    }
    return 'updated';
  }

  const nextVisit = mappedCommercial ? await calculateNextVisit(clientType, null, null) : null;
  const clientId = `cli-${crypto.randomUUID()}`;
  await db.query(
    `INSERT INTO clients (id, nom, ville, adresse, code_postal, telephone, telephone_mobile, email, contact,
       type_client, statut, commercial_id, next_visit, notes, siret, tournee, latitude, longitude,
       easybeer_id, easybeer_numero, easybeer_commercial_id, easybeer_type_id, easybeer_tournee_id, date_creation, date_modification)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIF',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
    [clientId, f.name, f.city, f.address, f.postal_code, f.phone, f.phone_mobile, f.email, f.contact_name,
     clientType, mappedCommercial || null, nextVisit, f.notes || '', f.siret, f.tournee, f.latitude, f.longitude,
     f.easybeer_id, f.numero, f.commercial_easybeer_id, f.type_id, f.tournee_id, now, now]
  );
  if (f.easybeer_id) {
    try { await db.query("UPDATE easybeer_clients SET status='imported', imported_client_id=$1 WHERE easybeer_id=$2", [clientId, f.easybeer_id]); } catch { /* */ }
  }
  return 'created';
}

// Importe a la demande la fiche EasyBeer d'une commande dont le client est inconnu.
// EasyBeer garde certaines fiches cote « prospect » alors qu'elles commandent vraiment
// (numero CL, SIRET, commercial affecte) : la liste clients ne les renvoie pas et leurs
// commandes finissaient en orphelines. Une fiche qui achete est un client de fait.
// Renvoie l'id du client SuiviPro, ou null si la fiche est introuvable.
export async function importerClientDepuisCommande(apiBase, hdrs, ebClientId, cache = null) {
  if (!ebClientId) return null;
  const cle = String(ebClientId);
  if (cache && cache.has(cle)) return cache.get(cle);
  let local = null;
  try {
    const det = await eb.detailClient(apiBase, hdrs, cle);
    if (det) {
      await upsertClientFromEasybeer(det, { forceClient: true });
      local = await clientLocalDepuisEasybeerId(cle);
      if (local) console.log(`[EasyBeer] Client ${det.nom || cle} (eb ${cle}) importe suite a une commande -> ${local}`);
    }
  } catch (err) {
    console.error(`[EasyBeer] Import client ${cle} depuis commande echoue: ${err.message}`);
  }
  if (cache) cache.set(cle, local);
  return local;
}

// Create a "visite" interaction from a commande DB row (idempotent via visite_created).
// Reads the order comment from raw_data. Advances last_visit forward-only. Never throws.
export async function createVisiteFromCommandeRow(row) {
  try {
    if (!row || row.visite_created || !row.client_id) return false;
    // Le groupe « Site internet » regroupe les ventes web : ce ne sont pas des visites.
    if (row.client_id === SITE_INTERNET_CLIENT_ID) {
      await db.query('UPDATE commandes SET visite_created = TRUE WHERE id = $1', [row.id]);
      return false;
    }
    const c = (await db.query('SELECT type_client, custom_recurrence, statut, commercial_id, last_visit FROM clients WHERE id = $1', [row.client_id])).rows[0];
    if (!c) return false;
    let commercialId = c.commercial_id;
    let commentaire = row.commentaire || '';
    let orderCommercialEb = row.commercial_easybeer_id || '';
    if (row.raw_data) {
      try {
        const rd = JSON.parse(row.raw_data);
        if (!commentaire) commentaire = rd.commentaireClient || rd.commentaire || rd.note || '';
        if (!orderCommercialEb && rd.commercial && rd.commercial.id != null) orderCommercialEb = String(rd.commercial.id);
      } catch { /* raw_data not JSON */ }
    }
    if (!commercialId && orderCommercialEb) commercialId = await resolveCommercialFromEasybeer(orderCommercialEb);
    if (!commercialId) return false; // interactions.commercial_id is NOT NULL
    const now = new Date().toISOString();
    const visitDate = row.date_commande || now;
    const visitYmd = String(visitDate).split('T')[0];
    const montant = row.montant_ttc ? ` - ${Number(row.montant_ttc).toFixed(2)}€ TTC` : '';
    const base = `Commande #${row.numero}${montant}`;
    const comment = commentaire ? `${base} — ${commentaire}` : base;
    const interId = `int-${crypto.randomUUID()}`;

    const dbClient = await db.connect();
    try {
      await dbClient.query('BEGIN');
      await dbClient.query(
        `INSERT INTO interactions (id, client_id, commercial_id, type, date, comment, date_creation) VALUES ($1,$2,$3,'VISITE',$4,$5,$6)`,
        [interId, row.client_id, commercialId, visitDate, comment, now]
      );
      if (!c.last_visit || visitYmd >= String(c.last_visit)) {
        let nextVisit = null;
        if (c.statut === 'ACTIF') nextVisit = await calculateNextVisit(c.type_client, c.custom_recurrence, visitDate);
        await dbClient.query('UPDATE clients SET last_visit = $1, next_visit = $2, date_modification = $3 WHERE id = $4', [visitYmd, nextVisit, now, row.client_id]);
      }
      await dbClient.query('UPDATE commandes SET visite_created = TRUE WHERE id = $1', [row.id]);
      await dbClient.query('COMMIT');
    } catch (e) { await dbClient.query('ROLLBACK'); throw e; } finally { dbClient.release(); }
    return true;
  } catch (err) {
    console.error('[EasyBeer] createVisiteFromCommandeRow echoue:', err.message);
    return false;
  }
}

// Sweep un-processed commandes and turn each into a visite. Orders older than `sinceDays`
// are marked processed without creating a visite (avoids flooding years of history).
export let visitesSweepRunning = false;

export async function createVisitesFromCommandes({ sinceDays = 365 } = {}) {
  if (visitesSweepRunning) return { ok: false, message: 'Generation deja en cours' };
  visitesSweepRunning = true;
  let created = 0, skippedOld = 0, errors = 0;
  try {
    const cutoff = new Date(Date.now() - sinceDays * 86400000).toISOString();
    const rows = (await db.query(
      "SELECT id, client_id, numero, montant_ttc, date_commande, commentaire, commercial_easybeer_id, raw_data, visite_created FROM commandes WHERE visite_created = FALSE AND client_id IS NOT NULL AND statut <> 'annulee' ORDER BY date_commande DESC LIMIT 8000"
    )).rows;
    for (const row of rows) {
      try {
        if (row.date_commande && String(row.date_commande) < cutoff) {
          await db.query('UPDATE commandes SET visite_created = TRUE WHERE id = $1', [row.id]);
          skippedOld++;
          continue;
        }
        const ok = await createVisiteFromCommandeRow(row);
        if (ok) created++;
      } catch (e) { errors++; console.error('[EasyBeer Visites] row:', e.message); }
    }
    console.log(`[EasyBeer Visites] ${created} visites creees, ${skippedOld} anciennes ignorees, ${errors} erreurs`);
    return { ok: true, created, skippedOld, errors };
  } finally { visitesSweepRunning = false; }
}
