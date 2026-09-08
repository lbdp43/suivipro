// SIRENE (INSEE) : synchronisation par zone, file des doublons — routes déplacées telles quelles depuis routes.js.
import { Router } from 'express';
import db from '../db.js';
import { adminOnly, asyncHandler, authMiddleware } from '../lib/auth.js';
import { dateLocale } from '../../shared/regles.js';
import { logActivity } from '../lib/journal.js';
import { DATAGOUV_BASE_URL, NAF_CODES, fetchAllDatagouv, fetchNearPoint, parseDatagouvResult } from '../lib/sirene-import.js';

const router = Router();

const INSEE_BASE_URL = 'https://api.insee.fr/api-sirene/3.11';

// Parse INSEE result -> array of etablissements
function parseInseeResult(etab) {
  const periodes = etab.periodesEtablissement || [];
  const dernierePeriode = periodes[0] || {};
  const adresse = etab.adresseEtablissement || {};
  const unite = etab.uniteLegale || {};

  return {
    siret: etab.siret || '',
    siren: etab.siren || '',
    nom: unite.denominationUniteLegale || unite.nomUniteLegale || [unite.prenomUsuelUniteLegale, unite.nomUsageUniteLegale || unite.nomUniteLegale].filter(Boolean).join(' ') || 'Non renseigne',
    enseigne: dernierePeriode.enseigne1Etablissement || null,
    code_naf: dernierePeriode.activitePrincipaleEtablissement || '',
    libelle_naf: null, // INSEE ne fournit pas le libelle
    date_creation_etab: etab.dateCreationEtablissement || null,
    adresse_voie: [adresse.numeroVoieEtablissement, adresse.typeVoieEtablissement, adresse.libelleVoieEtablissement].filter(Boolean).join(' ') || null,
    code_postal: adresse.codePostalEtablissement || null,
    commune: adresse.libelleCommuneEtablissement || null,
    code_commune: adresse.codeCommuneEtablissement || null,
    departement: adresse.codePostalEtablissement ? adresse.codePostalEtablissement.substring(0, 2) : '',
    latitude: null, // INSEE ne fournit pas les coords
    longitude: null,
    etat_admin: dernierePeriode.etatAdministratifEtablissement || 'A',
    tranche_effectif: etab.trancheEffectifsEtablissement || null,
  };
}

// Fetch from INSEE API with date filter
// Department filtering is done server-side after fetching results
async function fetchInsee(nafCode, dateFrom, cursor = 0, apiKey = '') {
  // NAF codes contain dots (56.10A) → quote them for Lucene
  // activitePrincipaleEtablissement + etatAdministratifEtablissement are historized → inside periode()
  // dateCreationEtablissement is NOT historized → outside periode()
  const query = `periode(activitePrincipaleEtablissement:"${nafCode}" AND etatAdministratifEtablissement:A) AND dateCreationEtablissement:[${dateFrom} TO *]`;

  const params = new URLSearchParams({
    q: query,
    nombre: '100',
    debut: String(cursor),
  });

  const response = await fetch(`${INSEE_BASE_URL}/siret?${params}`, {
    headers: {
      'Accept': 'application/json',
      'X-INSEE-Api-Key-Integration': apiKey,
    },
  });

  if (response.status === 404) {
    // No results
    return { header: { total: 0 }, etablissements: [] };
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`INSEE API error ${response.status}: ${text}`);
  }

  return response.json();
}

// Fetch all pages from INSEE with rate limiting (30 req/min)
// Returns raw etablissements; caller filters by department
async function fetchAllInsee(nafCode, dateFrom, apiKey) {
  const allResults = [];
  let cursor = 0;
  let total = 0;

  do {
    const data = await fetchInsee(nafCode, dateFrom, cursor, apiKey);
    total = data.header?.total || 0;
    const items = data.etablissements || [];
    allResults.push(...items);
    cursor += items.length;
    // Rate limit: 30 req/min -> wait 2100ms
    if (cursor < total) await new Promise(r => setTimeout(r, 2100));
  } while (cursor < total);

  return allResults;
}

// Enrichir un etab INSEE avec les coords de data.gouv.fr
async function enrichWithDatagouv(siret) {
  try {
    const response = await fetch(`${DATAGOUV_BASE_URL}/search?q=${siret}&per_page=1&minimal=true&include=siege,matching_etablissements`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'suivipro-brasserie/3.0' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.results && data.results.length > 0) {
      const siege = data.results[0].siege || {};
      const matching = data.results[0].matching_etablissements || [];
      const found = matching.find(e => e.siret === siret) || siege;
      if (found.latitude && found.longitude) {
        return { latitude: found.latitude, longitude: found.longitude };
      }
    }
    return null;
  } catch { return null; }
}

// GET /api/sirene/zone-configs - list all configs
router.get('/sirene/zone-configs', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM sirene_zone_config ORDER BY id');
  const configs = result.rows.map(row => ({
    ...row,
    insee_api_key: row.insee_api_key ? '***configured***' : '',
  }));
  res.json(configs);
}));

// Legacy GET /api/sirene/zone-config - return first config for backwards compat
router.get('/sirene/zone-config', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  let config = await db.query('SELECT * FROM sirene_zone_config ORDER BY id LIMIT 1');
  if (config.rows.length === 0) {
    await db.query(
      `INSERT INTO sirene_zone_config (name, entity_type, departements, updated_at) VALUES ('Prospects (restaurants, bars, caves)', 'prospect', '03,07,26,38,42,43,63', $1) RETURNING *`,
      [new Date().toISOString()]
    );
    config = await db.query('SELECT * FROM sirene_zone_config ORDER BY id LIMIT 1');
  }
  const row = config.rows[0];
  res.json({ ...row, insee_api_key: row.insee_api_key ? '***configured***' : '' });
}));

// POST /api/sirene/zone-configs - create new config
router.post('/sirene/zone-configs', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { name, entity_type, departements, naf_codes, lookback_days, auto_import, default_commercial_id, cron_enabled, insee_api_key } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom requis' });

  const result = await db.query(
    `INSERT INTO sirene_zone_config (name, entity_type, departements, naf_codes, lookback_days, auto_import, default_commercial_id, cron_enabled, cron_schedule, insee_api_key, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '0 6 * * 1', $9, $10) RETURNING *`,
    [
      name, entity_type || 'prospect', departements || '03,07,26,38,42,43,63',
      naf_codes || '', lookback_days || 7, auto_import !== undefined ? auto_import : true,
      default_commercial_id || '', cron_enabled !== undefined ? cron_enabled : true,
      insee_api_key || '', new Date().toISOString(),
    ]
  );
  res.json({ ok: true, config: { ...result.rows[0], insee_api_key: result.rows[0].insee_api_key ? '***configured***' : '' } });
}));

// PUT /api/sirene/zone-configs/:id - update a config
router.put('/sirene/zone-configs/:id', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { name, entity_type, departements, naf_codes, lookback_days, auto_import, default_commercial_id, cron_enabled, insee_api_key } = req.body;
  const configId = req.params.id;

  await db.query(
    `UPDATE sirene_zone_config SET
       name = COALESCE(NULLIF($1, ''), name),
       entity_type = COALESCE(NULLIF($2, ''), entity_type),
       departements = COALESCE(NULLIF($3, ''), departements),
       naf_codes = COALESCE($4, naf_codes),
       lookback_days = COALESCE($5, lookback_days),
       auto_import = COALESCE($6, auto_import),
       default_commercial_id = COALESCE($7, default_commercial_id),
       cron_enabled = COALESCE($8, cron_enabled),
       insee_api_key = CASE WHEN $9 = '***configured***' THEN insee_api_key WHEN $9 IS NOT NULL AND $9 != '' THEN $9 ELSE insee_api_key END,
       updated_at = $10
     WHERE id = $11`,
    [
      name || '', entity_type || '', departements || '', naf_codes ?? null,
      lookback_days || null, auto_import ?? null, default_commercial_id ?? null,
      cron_enabled ?? null, insee_api_key || '', new Date().toISOString(), configId,
    ]
  );

  const updated = await db.query('SELECT * FROM sirene_zone_config WHERE id = $1', [configId]);
  res.json({ ok: true, config: { ...updated.rows[0], insee_api_key: updated.rows[0].insee_api_key ? '***configured***' : '' } });
}));

// PUT /api/sirene/zone-config (legacy - updates first config)
router.put('/sirene/zone-config', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { departements, naf_codes, lookback_days, auto_import, default_commercial_id, cron_enabled, cron_schedule, insee_api_key } = req.body;
  let config = await db.query('SELECT id FROM sirene_zone_config ORDER BY id LIMIT 1');
  if (config.rows.length === 0) {
    const ins = await db.query(
      `INSERT INTO sirene_zone_config (name, entity_type, departements, updated_at) VALUES ('Prospects', 'prospect', '03,07,26,38,42,43,63', $1) RETURNING id`,
      [new Date().toISOString()]
    );
    config = { rows: [ins.rows[0]] };
  }
  const configId = config.rows[0].id;
  await db.query(
    `UPDATE sirene_zone_config SET
       departements = COALESCE(NULLIF($1, ''), departements),
       naf_codes = COALESCE($2, naf_codes),
       lookback_days = COALESCE($3, lookback_days),
       auto_import = COALESCE($4, auto_import),
       default_commercial_id = COALESCE($5, default_commercial_id),
       cron_enabled = COALESCE($6, cron_enabled),
       cron_schedule = COALESCE($7, cron_schedule),
       insee_api_key = CASE WHEN $8 = '***configured***' THEN insee_api_key WHEN $8 IS NOT NULL AND $8 != '' THEN $8 ELSE insee_api_key END,
       updated_at = $9
     WHERE id = $10`,
    [
      departements || '', naf_codes || '', lookback_days || 7,
      auto_import !== undefined ? auto_import : true,
      default_commercial_id || '', cron_enabled !== undefined ? cron_enabled : true,
      cron_schedule || '0 6 * * 1', insee_api_key || '',
      new Date().toISOString(), configId,
    ]
  );
  const updated = await db.query('SELECT * FROM sirene_zone_config WHERE id = $1', [configId]);
  res.json({ ok: true, config: { ...updated.rows[0], insee_api_key: updated.rows[0].insee_api_key ? '***configured***' : '' } });
}));

// DELETE /api/sirene/zone-configs/:id - delete a config
router.delete('/sirene/zone-configs/:id', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  await db.query('DELETE FROM sirene_zone_config WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// POST /api/sirene/sync-zone - Manual or CRON zone sync (uses INSEE API)
router.post('/sirene/sync-zone', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const configId = req.body.config_id;
  const configRes = configId
    ? await db.query('SELECT * FROM sirene_zone_config WHERE id = $1', [configId])
    : await db.query('SELECT * FROM sirene_zone_config ORDER BY id LIMIT 1');
  if (configRes.rows.length === 0) return res.status(400).json({ error: 'Zone non configuree. Configurez d\'abord la zone.' });

  const config = configRes.rows[0];
  const apiKey = config.insee_api_key || process.env.SIRENE_API_KEY || '';
  if (!apiKey) return res.status(400).json({ error: 'Cle API INSEE non configuree. Ajoutez-la dans la configuration de zone ou en variable d\'environnement SIRENE_API_KEY.' });

  const departements = config.departements.split(',').map(d => d.trim()).filter(Boolean);
  const nafCodes = config.naf_codes ? config.naf_codes.split(',').map(c => c.trim()).filter(Boolean) : NAF_CODES.map(n => n.code);
  const lookbackDays = config.lookback_days || 7;
  const dateFrom = dateLocale(new Date(Date.now() - lookbackDays * 86400000));

  const logRes = await db.query(
    `INSERT INTO sirene_sync_logs (started_at, naf_codes, departements, source, is_cron)
     VALUES ($1, $2, $3, 'insee', $4) RETURNING id`,
    [new Date().toISOString(), nafCodes.join(','), departements.join(','), req.body.is_cron || false]
  );
  const syncLogId = logRes.rows[0].id;

  // Run in background
  (async () => {
    let totalFetched = 0, totalInserted = 0, totalUpdated = 0, totalAutoImported = 0;
    try {
      for (const nafCode of nafCodes) {
        console.log(`[INSEE ZONE] Fetching NAF ${nafCode} since ${dateFrom}...`);
        const rawEtabs = await fetchAllInsee(nafCode, dateFrom, apiKey);
        console.log(`[INSEE ZONE]   -> ${rawEtabs.length} etablissements (avant filtre dept)`);

        for (const rawEtab of rawEtabs) {
          const etab = parseInseeResult(rawEtab);
          if (!etab.siret) continue;

          // Filter by department server-side (postal code prefix)
          const etabDept = etab.code_postal ? etab.code_postal.substring(0, 2) : etab.departement;
          if (departements.length > 0 && !departements.includes(etabDept)) continue;

          totalFetched++;
          const nafInfo = NAF_CODES.find(n => n.code === etab.code_naf || n.code === etab.code_naf.replace('.', ''));

          // Try to enrich with lat/lng from data.gouv.fr
          const coords = await enrichWithDatagouv(etab.siret);
          if (coords) {
            etab.latitude = coords.latitude;
            etab.longitude = coords.longitude;
          }
          // Small delay for data.gouv enrichment rate limit
          await new Promise(r => setTimeout(r, 200));

          const dbResult = await db.query(
            `INSERT INTO sirene_etablissements (siret, siren, nom, enseigne, code_naf, libelle_naf, date_creation_etab,
              adresse_voie, code_postal, commune, code_commune, departement,
              latitude, longitude, etat_admin, tranche_effectif, date_sync, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
            ON CONFLICT (siret) DO UPDATE SET
              nom = EXCLUDED.nom, enseigne = EXCLUDED.enseigne,
              etat_admin = EXCLUDED.etat_admin, tranche_effectif = EXCLUDED.tranche_effectif,
              latitude = COALESCE(EXCLUDED.latitude, sirene_etablissements.latitude),
              longitude = COALESCE(EXCLUDED.longitude, sirene_etablissements.longitude),
              date_sync = EXCLUDED.date_sync
            RETURNING (xmax = 0) AS is_insert, id`,
            [
              etab.siret, etab.siren, etab.nom, etab.enseigne,
              etab.code_naf, etab.libelle_naf || nafInfo?.label || '',
              etab.date_creation_etab,
              etab.adresse_voie, etab.code_postal,
              etab.commune, etab.code_commune, etab.departement,
              etab.latitude, etab.longitude,
              etab.etat_admin, etab.tranche_effectif,
              new Date().toISOString(), new Date().toISOString(),
            ]
          );

          const isNew = dbResult.rows[0]?.is_insert;
          if (isNew) totalInserted++;
          else totalUpdated++;

          // Auto-import as prospect if enabled
          if (isNew && config.auto_import) {
            const etabRow = await db.query('SELECT * FROM sirene_etablissements WHERE id = $1', [dbResult.rows[0].id]);
            if (etabRow.rows.length > 0 && !etabRow.rows[0].imported_as_prospect) {
              const result = await importEtabAsProspect(etabRow.rows[0], config.default_commercial_id, new Date().toISOString(), null, config.entity_type);
              if (result === 'imported') totalAutoImported++;
            }
          }
        }
      }

      await db.query(
        `UPDATE sirene_sync_logs SET finished_at = $2, status = 'success',
         records_fetched = $3, records_inserted = $4, records_updated = $5, records_auto_imported = $6
         WHERE id = $1`,
        [syncLogId, new Date().toISOString(), totalFetched, totalInserted, totalUpdated, totalAutoImported]
      );
      console.log(`[INSEE ZONE] Sync done: ${totalFetched} fetched, ${totalInserted} new, ${totalUpdated} updated, ${totalAutoImported} auto-imported`);
    } catch (error) {
      console.error('[INSEE ZONE] Sync error:', error.message);
      await db.query(
        `UPDATE sirene_sync_logs SET finished_at = $2, status = 'error', error_message = $3 WHERE id = $1`,
        [syncLogId, new Date().toISOString(), error.message]
      );
    }
  })();

  res.json({ ok: true, sync_log_id: syncLogId, message: `Sync zone INSEE lancee: ${nafCodes.length} codes NAF x ${departements.length} departements, depuis ${dateFrom}` });
}));

// GET /api/sirene/config
router.get('/sirene/config', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  res.json({
    naf_codes: NAF_CODES,
    api_configured: true, // data.gouv.fr ne necessite aucune cle
    api_source: 'data.gouv.fr',
  });
}));

// GET /api/sirene/sync-logs
router.get('/sirene/sync-logs', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM sirene_sync_logs ORDER BY started_at DESC LIMIT 20');
  res.json(result.rows);
}));

// GET /api/sirene/etablissements
router.get('/sirene/etablissements', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { departement, code_naf, imported, limit = 100 } = req.query;
  let query = 'SELECT * FROM sirene_etablissements WHERE 1=1';
  const params = [];

  if (departement) {
    params.push(departement);
    query += ` AND departement = $${params.length}`;
  }
  if (code_naf) {
    params.push(code_naf);
    query += ` AND code_naf = $${params.length}`;
  }
  if (imported === 'true') {
    query += ' AND imported_as_prospect IS NOT NULL';
  } else if (imported === 'false') {
    query += ' AND imported_as_prospect IS NULL';
  }

  params.push(parseInt(limit) || 100);
  query += ` ORDER BY created_at DESC LIMIT $${params.length}`;

  const result = await db.query(query, params);
  res.json(result.rows);
}));

// POST /api/sirene/sync - Sync from data.gouv.fr
router.post('/sirene/sync', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { naf_codes = [], departements = [], lookback_days = 30 } = req.body;
  const codesToSync = naf_codes.length > 0
    ? naf_codes
    : NAF_CODES.map(n => n.code);

  const dateFrom = dateLocale(new Date(Date.now() - lookback_days * 86400000));

  // Create sync log
  const logRes = await db.query(
    `INSERT INTO sirene_sync_logs (started_at, naf_codes, departements)
     VALUES ($1, $2, $3) RETURNING id`,
    [new Date().toISOString(), codesToSync.join(','), (departements || []).join(',')]
  );
  const syncLogId = logRes.rows[0].id;

  // Run sync in background
  (async () => {
    let totalFetched = 0, totalInserted = 0, totalUpdated = 0;
    try {
      // data.gouv.fr accepts all NAF codes in one query
      // If departements specified, query per departement; otherwise query all
      const deptList = departements.length > 0 ? departements : [''];

      for (const dept of deptList) {
        console.log(`[DATAGOUV] Syncing NAF codes${dept ? ` for dept ${dept}` : ''}...`);
        const rawResults = await fetchAllDatagouv(codesToSync, dept);
        console.log(`[DATAGOUV]   -> ${rawResults.length} unites legales`);

        for (const result of rawResults) {
          const etablissements = parseDatagouvResult(result);

          for (const etab of etablissements) {
            totalFetched++;

            // Filter by creation date (data.gouv.fr doesn't support this natively)
            if (etab.date_creation_etab && etab.date_creation_etab < dateFrom) continue;

            const nafInfo = NAF_CODES.find(n => n.code === etab.code_naf);

            const dbResult = await db.query(
              `INSERT INTO sirene_etablissements (siret, siren, nom, enseigne, code_naf, libelle_naf, date_creation_etab,
                adresse_voie, code_postal, commune, code_commune, departement,
                latitude, longitude, etat_admin, tranche_effectif, date_sync, created_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
              ON CONFLICT (siret) DO UPDATE SET
                nom = EXCLUDED.nom,
                enseigne = EXCLUDED.enseigne,
                etat_admin = EXCLUDED.etat_admin,
                tranche_effectif = EXCLUDED.tranche_effectif,
                latitude = COALESCE(EXCLUDED.latitude, sirene_etablissements.latitude),
                longitude = COALESCE(EXCLUDED.longitude, sirene_etablissements.longitude),
                date_sync = EXCLUDED.date_sync
              RETURNING (xmax = 0) AS is_insert`,
              [
                etab.siret, etab.siren, etab.nom, etab.enseigne,
                etab.code_naf, etab.libelle_naf || nafInfo?.label || '',
                etab.date_creation_etab,
                etab.adresse_voie, etab.code_postal,
                etab.commune, etab.code_commune, etab.departement,
                etab.latitude, etab.longitude,
                etab.etat_admin, etab.tranche_effectif,
                new Date().toISOString(), new Date().toISOString(),
              ]
            );
            if (dbResult.rows[0]?.is_insert) totalInserted++;
            else totalUpdated++;
          }
        }
      }

      await db.query(
        `UPDATE sirene_sync_logs SET finished_at = $2, status = 'success',
         records_fetched = $3, records_inserted = $4, records_updated = $5
         WHERE id = $1`,
        [syncLogId, new Date().toISOString(), totalFetched, totalInserted, totalUpdated]
      );
      console.log(`[DATAGOUV] Sync done: ${totalFetched} fetched, ${totalInserted} inserted, ${totalUpdated} updated`);
    } catch (error) {
      console.error('[DATAGOUV] Sync error:', error.message);
      await db.query(
        `UPDATE sirene_sync_logs SET finished_at = $2, status = 'error', error_message = $3 WHERE id = $1`,
        [syncLogId, new Date().toISOString(), error.message]
      );
    }
  })();

  res.json({ ok: true, sync_log_id: syncLogId, message: 'Synchronisation data.gouv.fr lancee en arriere-plan' });
}));

// POST /api/sirene/sync-near - Sync by geographic proximity
router.post('/sirene/sync-near', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { latitude, longitude, radius = 10, naf_codes = [] } = req.body;
  if (!latitude || !longitude) return res.status(400).json({ error: 'latitude et longitude requis' });

  const codesToSync = naf_codes.length > 0 ? naf_codes : NAF_CODES.map(n => n.code);

  const logRes = await db.query(
    `INSERT INTO sirene_sync_logs (started_at, naf_codes, departements)
     VALUES ($1, $2, $3) RETURNING id`,
    [new Date().toISOString(), codesToSync.join(','), `geo:${latitude},${longitude},${radius}km`]
  );
  const syncLogId = logRes.rows[0].id;

  (async () => {
    let totalFetched = 0, totalInserted = 0, totalUpdated = 0;
    try {
      let page = 1;
      let totalPages = 1;

      do {
        const data = await fetchNearPoint(latitude, longitude, radius, codesToSync, page);
        totalPages = Math.min(data.total_pages || 1, 200);

        for (const result of (data.results || [])) {
          const etablissements = parseDatagouvResult(result);
          for (const etab of etablissements) {
            totalFetched++;
            const nafInfo = NAF_CODES.find(n => n.code === etab.code_naf);

            const dbResult = await db.query(
              `INSERT INTO sirene_etablissements (siret, siren, nom, enseigne, code_naf, libelle_naf, date_creation_etab,
                adresse_voie, code_postal, commune, code_commune, departement,
                latitude, longitude, etat_admin, tranche_effectif, date_sync, created_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
              ON CONFLICT (siret) DO UPDATE SET
                nom = EXCLUDED.nom, enseigne = EXCLUDED.enseigne,
                etat_admin = EXCLUDED.etat_admin, tranche_effectif = EXCLUDED.tranche_effectif,
                latitude = COALESCE(EXCLUDED.latitude, sirene_etablissements.latitude),
                longitude = COALESCE(EXCLUDED.longitude, sirene_etablissements.longitude),
                date_sync = EXCLUDED.date_sync
              RETURNING (xmax = 0) AS is_insert`,
              [
                etab.siret, etab.siren, etab.nom, etab.enseigne,
                etab.code_naf, etab.libelle_naf || nafInfo?.label || '',
                etab.date_creation_etab,
                etab.adresse_voie, etab.code_postal,
                etab.commune, etab.code_commune, etab.departement,
                etab.latitude, etab.longitude,
                etab.etat_admin, etab.tranche_effectif,
                new Date().toISOString(), new Date().toISOString(),
              ]
            );
            if (dbResult.rows[0]?.is_insert) totalInserted++;
            else totalUpdated++;
          }
        }

        page++;
        if (page <= totalPages) await new Promise(r => setTimeout(r, 200));
      } while (page <= totalPages);

      await db.query(
        `UPDATE sirene_sync_logs SET finished_at = $2, status = 'success',
         records_fetched = $3, records_inserted = $4, records_updated = $5 WHERE id = $1`,
        [syncLogId, new Date().toISOString(), totalFetched, totalInserted, totalUpdated]
      );
      console.log(`[DATAGOUV] Geo sync done: ${totalFetched} fetched, ${totalInserted} inserted`);
    } catch (error) {
      console.error('[DATAGOUV] Geo sync error:', error.message);
      await db.query(
        `UPDATE sirene_sync_logs SET finished_at = $2, status = 'error', error_message = $3 WHERE id = $1`,
        [syncLogId, new Date().toISOString(), error.message]
      );
    }
  })();

  res.json({ ok: true, sync_log_id: syncLogId, message: `Recherche geographique lancee (${radius}km autour de ${latitude},${longitude})` });
}));

// Helper function to import a single etablissement as prospect
// - Detects duplicates by: SIRET column, SIRET in notes, ID sirene_xxx, nom+ville
// - If duplicate found: enriches existing prospect with missing data
// - If no duplicate: creates new prospect in nouveau_datagouv pipeline
async function importEtabAsProspect(etab, commercialId, now, userId, configEntityType = null) {
  // Look up import rule for this NAF code
  const ruleRes = await db.query('SELECT * FROM sirene_import_rules WHERE naf_code = $1 LIMIT 1', [etab.code_naf]);
  const rule = ruleRes.rows[0] || null;

  const nafInfo = NAF_CODES.find(n => n.code === etab.code_naf);
  const typeEtab = rule?.entity_type === 'distributeur' ? 'distributeur' : (nafInfo?.type || 'autre');
  // Zone config entity_type takes priority over import rule
  const entityType = configEntityType || rule?.entity_type || 'prospect';
  const pipelineStage = rule?.pipeline_stage || 'nouveau_datagouv';
  const ruleCommercial = rule?.commercial_id || commercialId || null;
  const nomEtab = etab.enseigne || etab.nom || 'Non renseigne';
  const prospectId = `sirene_${etab.siret}`;

  // 1. Check by SIRET column (fast, indexed)
  let existing = await db.query("SELECT * FROM prospects WHERE siret = $1 AND siret != ''", [etab.siret]);

  // 2. Check by ID sirene_xxx
  if (existing.rows.length === 0) {
    existing = await db.query("SELECT * FROM prospects WHERE id = $1", [prospectId]);
  }

  // 3. Check by SIRET in notes (legacy)
  if (existing.rows.length === 0) {
    existing = await db.query("SELECT * FROM prospects WHERE notes LIKE $1", [`%SIRET: ${etab.siret}%`]);
  }

  // 4. Check by nom + ville (fuzzy match)
  if (existing.rows.length === 0 && etab.commune) {
    const nomSearch = nomEtab.toLowerCase().trim();
    existing = await db.query(
      "SELECT * FROM prospects WHERE LOWER(nom_etablissement) = $1 AND LOWER(ville) = $2",
      [nomSearch, etab.commune.toLowerCase().trim()]
    );
  }

  // Duplicate found → queue for admin validation
  if (existing.rows.length > 0) {
    const prospect = existing.rows[0];
    const matchType = prospect.siret === etab.siret ? 'siret'
      : prospect.id === prospectId ? 'id'
      : prospect.notes?.includes(`SIRET: ${etab.siret}`) ? 'notes'
      : 'nom_ville';

    // Check if already queued
    const alreadyQueued = await db.query(
      'SELECT id FROM sirene_duplicate_queue WHERE sirene_etab_id = $1 AND existing_prospect_id = $2 AND status = $3',
      [etab.id, prospect.id, 'pending']
    );
    if (alreadyQueued.rows.length === 0) {
      await db.query(
        `INSERT INTO sirene_duplicate_queue (sirene_etab_id, existing_prospect_id, match_type, sirene_nom, sirene_siret, sirene_ville, sirene_naf, existing_nom, existing_siret, existing_ville, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [etab.id, prospect.id, matchType, nomEtab, etab.siret, etab.commune || '', etab.code_naf || '',
         prospect.nom_etablissement || '', prospect.siret || '', prospect.ville || '', now]
      );
    }

    // Link the sirene_etablissement to this prospect
    await db.query('UPDATE sirene_etablissements SET imported_as_prospect = $1 WHERE id = $2', [prospect.id, etab.id]);
    return 'duplicate_queued';
  }

  // No duplicate → create new entry (prospect/concurrent/distributeur/partenaire)
  await db.query(
    `INSERT INTO prospects (id, nom_etablissement, type_etablissement, nom_contact, telephone, email,
      adresse, ville, code_postal, departement, secteur, latitude, longitude,
      etape_pipeline, tags, commercial_id, siret, entity_type, notes, date_creation, date_modification, score)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [
      prospectId, nomEtab, typeEtab, '', '', '',
      etab.adresse_voie || '', etab.commune || '', etab.code_postal || '', etab.departement || '',
      etab.libelle_naf || '', etab.latitude || 0, etab.longitude || 0,
      pipelineStage, '[]', ruleCommercial, etab.siret, entityType,
      `Importe depuis Datagouv (${entityType})\nSIRET: ${etab.siret}\nSIREN: ${etab.siren}\nNAF: ${etab.code_naf} - ${etab.libelle_naf || ''}\nDate creation: ${etab.date_creation_etab || 'N/A'}`,
      now, now, 30,
    ]
  );

  await db.query('UPDATE sirene_etablissements SET imported_as_prospect = $1 WHERE id = $2', [prospectId, etab.id]);
  if (userId) logActivity(userId, 'import_datagouv', `${nomEtab} (${entityType}) (SIRET: ${etab.siret})`, 'prospect', prospectId);
  return 'imported';
}

// POST /api/sirene/import-prospects
router.post('/sirene/import-prospects', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { etablissement_ids = [], commercial_id = '' } = req.body;
  if (etablissement_ids.length === 0) return res.status(400).json({ error: 'Aucun etablissement selectionne' });

  const now = new Date().toISOString();
  let imported = 0, duplicates = 0, skipped = 0;

  for (const etabId of etablissement_ids) {
    const etabRes = await db.query('SELECT * FROM sirene_etablissements WHERE id = $1', [etabId]);
    const etab = etabRes.rows[0];
    if (!etab || etab.imported_as_prospect) { skipped++; continue; }

    const result = await importEtabAsProspect(etab, commercial_id, now, req.user.id);
    if (result === 'imported') imported++;
    else if (result === 'duplicate_queued') duplicates++;
    else skipped++;
  }

  res.json({ ok: true, imported, duplicates, skipped });
}));

// POST /api/sirene/import-all
router.post('/sirene/import-all', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { commercial_id = '', departements = [], naf_codes = [] } = req.body;

  let query = "SELECT * FROM sirene_etablissements WHERE imported_as_prospect IS NULL AND etat_admin = 'A'";
  const params = [];
  if (departements.length > 0) {
    params.push(departements);
    query += ` AND departement = ANY($${params.length})`;
  }
  if (naf_codes.length > 0) {
    params.push(naf_codes);
    query += ` AND code_naf = ANY($${params.length})`;
  }

  const result = await db.query(query, params);
  if (result.rows.length === 0) return res.json({ ok: true, imported: 0, enriched: 0, skipped: 0 });

  const now = new Date().toISOString();
  let imported = 0, duplicates = 0, skipped = 0;

  for (const etab of result.rows) {
    const r = await importEtabAsProspect(etab, commercial_id, now, null);
    if (r === 'imported') imported++;
    else if (r === 'duplicate_queued') duplicates++;
    else skipped++;
  }

  if (imported > 0) {
    await logActivity(req.user.id, 'import_datagouv_bulk', `${imported} importes, ${duplicates} doublons a valider`, '', '');
  }

  res.json({ ok: true, imported, duplicates, skipped });
}));

// POST /api/sirene/delete-etablissements - bulk delete selected
router.post('/sirene/delete-etablissements', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { ids = [] } = req.body;
  if (ids.length === 0) return res.status(400).json({ error: 'Aucun etablissement selectionne' });
  await db.query('DELETE FROM sirene_etablissements WHERE id = ANY($1)', [ids]);
  res.json({ ok: true, deleted: ids.length });
}));

// GET /api/sirene/duplicates - list pending duplicates
router.get('/sirene/duplicates', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const result = await db.query(
    'SELECT * FROM sirene_duplicate_queue WHERE status = $1 ORDER BY created_at DESC LIMIT 100',
    ['pending']
  );
  res.json(result.rows);
}));

// POST /api/sirene/duplicates/:id/merge - merge (enrich existing prospect with SIRENE data)
router.post('/sirene/duplicates/:id/merge', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const dup = await db.query('SELECT * FROM sirene_duplicate_queue WHERE id = $1', [req.params.id]);
  if (dup.rows.length === 0) return res.status(404).json({ error: 'Doublon non trouve' });
  const d = dup.rows[0];

  const etabRes = await db.query('SELECT * FROM sirene_etablissements WHERE id = $1', [d.sirene_etab_id]);
  const prospectRes = await db.query('SELECT * FROM prospects WHERE id = $1', [d.existing_prospect_id]);
  if (etabRes.rows.length === 0 || prospectRes.rows.length === 0) {
    await db.query("UPDATE sirene_duplicate_queue SET status = 'error', resolved_at = $2 WHERE id = $1", [d.id, new Date().toISOString()]);
    return res.status(404).json({ error: 'Etablissement ou prospect introuvable' });
  }

  const etab = etabRes.rows[0];
  const prospect = prospectRes.rows[0];
  const now = new Date().toISOString();
  const updates = [];
  const params = [];
  let paramIdx = 1;

  if (!prospect.siret && etab.siret) { params.push(etab.siret); updates.push(`siret = $${paramIdx++}`); }
  if ((!prospect.adresse || prospect.adresse === '') && etab.adresse_voie) { params.push(etab.adresse_voie); updates.push(`adresse = $${paramIdx++}`); }
  if ((!prospect.ville || prospect.ville === '') && etab.commune) { params.push(etab.commune); updates.push(`ville = $${paramIdx++}`); }
  if ((!prospect.code_postal || prospect.code_postal === '') && etab.code_postal) { params.push(etab.code_postal); updates.push(`code_postal = $${paramIdx++}`); }
  if ((!prospect.departement || prospect.departement === '') && etab.departement) { params.push(etab.departement); updates.push(`departement = $${paramIdx++}`); }
  if ((!prospect.latitude || prospect.latitude === 0) && etab.latitude) { params.push(etab.latitude); updates.push(`latitude = $${paramIdx++}`); }
  if ((!prospect.longitude || prospect.longitude === 0) && etab.longitude) { params.push(etab.longitude); updates.push(`longitude = $${paramIdx++}`); }
  if (prospect.type_etablissement === 'autre' && etab.libelle_naf) { params.push(etab.libelle_naf); updates.push(`secteur = $${paramIdx++}`); }

  if (updates.length > 0) {
    params.push(now);
    updates.push(`date_modification = $${paramIdx++}`);
    params.push(prospect.id);
    await db.query(`UPDATE prospects SET ${updates.join(', ')} WHERE id = $${paramIdx}`, params);
  }

  await db.query("UPDATE sirene_duplicate_queue SET status = 'merged', resolved_by = $2, resolved_at = $3 WHERE id = $1", [d.id, req.user.id, now]);
  await logActivity(req.user.id, 'merge_doublon', `Fusion ${d.sirene_nom} → ${prospect.nom_etablissement}`, 'prospect', prospect.id);
  res.json({ ok: true, action: 'merged' });
}));

// POST /api/sirene/duplicates/:id/skip - skip (ignore this duplicate, don't import)
router.post('/sirene/duplicates/:id/skip', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const now = new Date().toISOString();
  await db.query("UPDATE sirene_duplicate_queue SET status = 'skipped', resolved_by = $2, resolved_at = $3 WHERE id = $1", [req.params.id, req.user.id, now]);
  res.json({ ok: true, action: 'skipped' });
}));

// POST /api/sirene/duplicates/:id/import - force import as new entry (not a duplicate)
router.post('/sirene/duplicates/:id/import', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const dup = await db.query('SELECT * FROM sirene_duplicate_queue WHERE id = $1', [req.params.id]);
  if (dup.rows.length === 0) return res.status(404).json({ error: 'Doublon non trouve' });
  const d = dup.rows[0];

  const etabRes = await db.query('SELECT * FROM sirene_etablissements WHERE id = $1', [d.sirene_etab_id]);
  if (etabRes.rows.length === 0) return res.status(404).json({ error: 'Etablissement introuvable' });

  // Unlink from existing prospect so importEtabAsProspect creates a new entry
  await db.query('UPDATE sirene_etablissements SET imported_as_prospect = NULL WHERE id = $1', [d.sirene_etab_id]);

  // Force create new prospect by giving a unique ID
  const etab = etabRes.rows[0];
  const now = new Date().toISOString();
  const ruleRes = await db.query('SELECT * FROM sirene_import_rules WHERE naf_code = $1 LIMIT 1', [etab.code_naf]);
  const rule = ruleRes.rows[0] || null;
  const nafInfo = NAF_CODES.find(n => n.code === etab.code_naf);
  const typeEtab = rule?.entity_type === 'distributeur' ? 'distributeur' : (nafInfo?.type || 'autre');
  const entityType = rule?.entity_type || 'prospect';
  const pipelineStage = rule?.pipeline_stage || 'nouveau_datagouv';
  const nomEtab = etab.enseigne || etab.nom || 'Non renseigne';
  const prospectId = `sirene_${etab.siret}_${Date.now()}`;

  await db.query(
    `INSERT INTO prospects (id, nom_etablissement, type_etablissement, nom_contact, telephone, email,
      adresse, ville, code_postal, departement, secteur, latitude, longitude,
      etape_pipeline, tags, commercial_id, siret, entity_type, notes, date_creation, date_modification, score)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [
      prospectId, nomEtab, typeEtab, '', '', '',
      etab.adresse_voie || '', etab.commune || '', etab.code_postal || '', etab.departement || '',
      etab.libelle_naf || '', etab.latitude || 0, etab.longitude || 0,
      pipelineStage, '[]', '', etab.siret, entityType,
      `Import force (doublon ignore)\nSIRET: ${etab.siret}\nNAF: ${etab.code_naf} - ${etab.libelle_naf || ''}`,
      now, now, 30,
    ]
  );
  await db.query('UPDATE sirene_etablissements SET imported_as_prospect = $1 WHERE id = $2', [prospectId, etab.id]);
  await db.query("UPDATE sirene_duplicate_queue SET status = 'force_imported', resolved_by = $2, resolved_at = $3 WHERE id = $1", [d.id, req.user.id, now]);
  await logActivity(req.user.id, 'force_import_doublon', `Import force: ${nomEtab} (SIRET: ${etab.siret})`, 'prospect', prospectId);
  res.json({ ok: true, action: 'force_imported' });
}));

// GET /api/sirene/stats
router.get('/sirene/stats', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const total = await db.query('SELECT COUNT(*) as count FROM sirene_etablissements');
  const notImported = await db.query("SELECT COUNT(*) as count FROM sirene_etablissements WHERE imported_as_prospect IS NULL AND etat_admin = 'A'");
  const imported = await db.query('SELECT COUNT(*) as count FROM sirene_etablissements WHERE imported_as_prospect IS NOT NULL');
  const byNaf = await db.query(
    "SELECT code_naf, libelle_naf, COUNT(*) as count FROM sirene_etablissements WHERE etat_admin = 'A' GROUP BY code_naf, libelle_naf ORDER BY count DESC"
  );
  const byDept = await db.query(
    "SELECT departement, COUNT(*) as count FROM sirene_etablissements WHERE etat_admin = 'A' GROUP BY departement ORDER BY count DESC LIMIT 20"
  );
  const lastSync = await db.query('SELECT * FROM sirene_sync_logs ORDER BY started_at DESC LIMIT 1');

  res.json({
    total: parseInt(total.rows[0].count),
    not_imported: parseInt(notImported.rows[0].count),
    imported: parseInt(imported.rows[0].count),
    by_naf: byNaf.rows,
    by_departement: byDept.rows,
    last_sync: lastSync.rows[0] || null,
  });
}));

// Exported function for CRON scheduler - iterates all active configs
export async function runZoneSync() {
  const allConfigs = await db.query('SELECT * FROM sirene_zone_config WHERE cron_enabled = TRUE ORDER BY id');
  if (allConfigs.rows.length === 0) {
    console.log('[CRON] Aucune config active, sync ignoree');
    return;
  }

  for (const config of allConfigs.rows) {
    await runSyncForConfig(config, true);
  }
}

async function runSyncForConfig(config, isCron = false) {
  const apiKey = config.insee_api_key || process.env.SIRENE_API_KEY || '';
  if (!apiKey) {
    console.log(`[SYNC] Config "${config.name}" (id=${config.id}): Pas de cle API INSEE, sync ignoree`);
    return;
  }

  const departements = config.departements.split(',').map(d => d.trim()).filter(Boolean);
  const nafCodes = config.naf_codes ? config.naf_codes.split(',').map(c => c.trim()).filter(Boolean) : NAF_CODES.map(n => n.code);
  const lookbackDays = config.lookback_days || 7;
  const dateFrom = dateLocale(new Date(Date.now() - lookbackDays * 86400000));

  console.log(`[SYNC] Config "${config.name}" (${config.entity_type}): ${nafCodes.length} NAF x ${departements.length} depts, depuis ${dateFrom}`);

  const logRes = await db.query(
    `INSERT INTO sirene_sync_logs (started_at, naf_codes, departements, source, is_cron)
     VALUES ($1, $2, $3, 'insee', $4) RETURNING id`,
    [new Date().toISOString(), nafCodes.join(','), departements.join(','), isCron]
  );
  const syncLogId = logRes.rows[0].id;

  let totalFetched = 0, totalInserted = 0, totalUpdated = 0, totalAutoImported = 0;
  try {
    for (const nafCode of nafCodes) {
      console.log(`[SYNC]   NAF ${nafCode} depuis ${dateFrom}...`);
      const rawEtabs = await fetchAllInsee(nafCode, dateFrom, apiKey);
      console.log(`[SYNC]   -> ${rawEtabs.length} etablissements (avant filtre dept)`);

      for (const rawEtab of rawEtabs) {
        const etab = parseInseeResult(rawEtab);
        if (!etab.siret) continue;

        // Filter by department server-side
        const etabDept = etab.code_postal ? etab.code_postal.substring(0, 2) : etab.departement;
        if (departements.length > 0 && !departements.includes(etabDept)) continue;

        totalFetched++;
        const nafInfo = NAF_CODES.find(n => n.code === etab.code_naf || n.code === etab.code_naf.replace('.', ''));

        // Enrich with coords
        const coords = await enrichWithDatagouv(etab.siret);
        if (coords) {
          etab.latitude = coords.latitude;
          etab.longitude = coords.longitude;
        }
        await new Promise(r => setTimeout(r, 200));

        const dbResult = await db.query(
          `INSERT INTO sirene_etablissements (siret, siren, nom, enseigne, code_naf, libelle_naf, date_creation_etab,
            adresse_voie, code_postal, commune, code_commune, departement,
            latitude, longitude, etat_admin, tranche_effectif, date_sync, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
          ON CONFLICT (siret) DO UPDATE SET
            nom = EXCLUDED.nom, enseigne = EXCLUDED.enseigne,
            etat_admin = EXCLUDED.etat_admin, tranche_effectif = EXCLUDED.tranche_effectif,
            latitude = COALESCE(EXCLUDED.latitude, sirene_etablissements.latitude),
            longitude = COALESCE(EXCLUDED.longitude, sirene_etablissements.longitude),
            date_sync = EXCLUDED.date_sync
          RETURNING (xmax = 0) AS is_insert, id`,
          [
            etab.siret, etab.siren, etab.nom, etab.enseigne,
            etab.code_naf, etab.libelle_naf || nafInfo?.label || '',
            etab.date_creation_etab,
            etab.adresse_voie, etab.code_postal,
            etab.commune, etab.code_commune, etab.departement,
            etab.latitude, etab.longitude,
            etab.etat_admin, etab.tranche_effectif,
            new Date().toISOString(), new Date().toISOString(),
          ]
        );

        const isNew = dbResult.rows[0]?.is_insert;
        if (isNew) totalInserted++;
        else totalUpdated++;

        if (isNew && config.auto_import) {
          const etabRow = await db.query('SELECT * FROM sirene_etablissements WHERE id = $1', [dbResult.rows[0].id]);
          if (etabRow.rows.length > 0 && !etabRow.rows[0].imported_as_prospect) {
            const result = await importEtabAsProspect(etabRow.rows[0], config.default_commercial_id || '', new Date().toISOString(), null, config.entity_type);
            if (result === 'imported') totalAutoImported++;
          }
        }
      }
    }

    await db.query(
      `UPDATE sirene_sync_logs SET finished_at = $2, status = 'success',
       records_fetched = $3, records_inserted = $4, records_updated = $5, records_auto_imported = $6
       WHERE id = $1`,
      [syncLogId, new Date().toISOString(), totalFetched, totalInserted, totalUpdated, totalAutoImported]
    );
    console.log(`[SYNC] Config "${config.name}" terminee: ${totalFetched} recup, ${totalInserted} nouveaux, ${totalAutoImported} auto-importes`);
  } catch (error) {
    console.error(`[SYNC] Config "${config.name}" error:`, error.message);
    await db.query(
      `UPDATE sirene_sync_logs SET finished_at = $2, status = 'error', error_message = $3 WHERE id = $1`,
      [syncLogId, new Date().toISOString(), error.message]
    );
  }
}

export default router;
