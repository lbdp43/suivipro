import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required.');
  console.error('On Railway: add a PostgreSQL service and link it to your app,');
  console.error('or set DATABASE_URL manually in your service variables.');
  process.exit(1);
}

// Log connection info (mask password for security)
try {
  const dbUrl = new URL(process.env.DATABASE_URL);
  console.log(`PostgreSQL connection: user=${dbUrl.username} host=${dbUrl.hostname} port=${dbUrl.port} db=${dbUrl.pathname.slice(1)}`);
} catch {
  console.log('DATABASE_URL is set but could not be parsed as URL');
}

const isLocal = process.env.DATABASE_URL?.includes('localhost') || process.env.DATABASE_URL?.includes('127.0.0.1');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

// ============================================
// Schema
// ============================================

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 4000, 8000];

async function initDatabase(attempt = 1) {
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    if (err.code === '28P01') {
      console.error('=== AUTHENTICATION ERROR ===');
      console.error('Password authentication failed for PostgreSQL.');
      console.error('FIX: Go to Railway > your PostgreSQL service > Variables,');
      console.error('copy DATABASE_URL, and paste it in your app service Variables.');
      console.error('Or use: DATABASE_URL=${{Postgres.DATABASE_URL}}');
      console.error('============================');
      throw err;
    }
    if (attempt <= MAX_RETRIES) {
      const delay = RETRY_DELAYS[attempt - 1];
      console.log(`Database connection failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
      return initDatabase(attempt + 1);
    }
    throw err;
  }
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS commerciaux (
        id TEXT PRIMARY KEY,
        prenom TEXT NOT NULL,
        nom TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        telephone TEXT DEFAULT '',
        role TEXT NOT NULL DEFAULT 'commercial',
        password TEXT NOT NULL,
        objectifs TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS google_calendar_tokens (
        commercial_id TEXT PRIMARY KEY,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expiry_date BIGINT NOT NULL,
        calendar_email TEXT DEFAULT '',
        connected_at TEXT NOT NULL,
        FOREIGN KEY (commercial_id) REFERENCES commerciaux(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS prospects (
        id TEXT PRIMARY KEY,
        nom_etablissement TEXT NOT NULL,
        type_etablissement TEXT NOT NULL DEFAULT 'autre',
        nom_contact TEXT DEFAULT '',
        telephone TEXT DEFAULT '',
        email TEXT DEFAULT '',
        adresse TEXT DEFAULT '',
        ville TEXT DEFAULT '',
        code_postal TEXT DEFAULT '',
        departement TEXT DEFAULT '',
        secteur TEXT DEFAULT '',
        latitude DOUBLE PRECISION DEFAULT 0,
        longitude DOUBLE PRECISION DEFAULT 0,
        etape_pipeline TEXT NOT NULL DEFAULT 'nouveau',
        tags TEXT NOT NULL DEFAULT '[]',
        commercial_id TEXT DEFAULT NULL,
        notes TEXT DEFAULT '',
        date_creation TEXT NOT NULL,
        date_modification TEXT NOT NULL,
        score INTEGER DEFAULT 50,
        FOREIGN KEY (commercial_id) REFERENCES commerciaux(id)
      );

      CREATE TABLE IF NOT EXISTS calls (
        id TEXT PRIMARY KEY,
        prospect_id TEXT NOT NULL,
        commercial_id TEXT NOT NULL,
        date TEXT NOT NULL,
        duree INTEGER DEFAULT 0,
        resultat TEXT NOT NULL DEFAULT 'pas_de_reponse',
        notes TEXT DEFAULT '',
        FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE,
        FOREIGN KEY (commercial_id) REFERENCES commerciaux(id)
      );

      CREATE TABLE IF NOT EXISTS appointments (
        id TEXT PRIMARY KEY,
        prospect_id TEXT NOT NULL,
        commercial_id TEXT NOT NULL,
        prospecteur_id TEXT DEFAULT NULL,
        date TEXT NOT NULL,
        heure_debut TEXT DEFAULT '',
        heure_fin TEXT DEFAULT '',
        lieu TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        statut TEXT NOT NULL DEFAULT 'planifie',
        compte_rendu TEXT DEFAULT '',
        FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE,
        FOREIGN KEY (commercial_id) REFERENCES commerciaux(id)
      );

      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        prospect_id TEXT NOT NULL,
        commercial_id TEXT NOT NULL,
        date TEXT NOT NULL,
        heure TEXT DEFAULT '',
        message TEXT DEFAULT '',
        statut TEXT NOT NULL DEFAULT 'actif',
        FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE,
        FOREIGN KEY (commercial_id) REFERENCES commerciaux(id)
      );

      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        nom TEXT NOT NULL,
        couleur TEXT NOT NULL DEFAULT '#6366f1'
      );

      CREATE TABLE IF NOT EXISTS email_templates (
        id TEXT PRIMARY KEY,
        nom TEXT NOT NULL,
        sujet TEXT DEFAULT '',
        corps TEXT DEFAULT '',
        type TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS pipeline_columns (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#6b7280',
        sort_order INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS sirene_etablissements (
        id SERIAL PRIMARY KEY,
        siret TEXT UNIQUE NOT NULL,
        siren TEXT NOT NULL,
        nom TEXT,
        enseigne TEXT,
        code_naf TEXT NOT NULL,
        libelle_naf TEXT,
        date_creation_etab TEXT,
        adresse_voie TEXT,
        code_postal TEXT,
        commune TEXT,
        code_commune TEXT,
        departement TEXT,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        etat_admin TEXT DEFAULT 'A',
        tranche_effectif TEXT,
        date_sync TEXT,
        imported_as_prospect TEXT DEFAULT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sirene_sync_logs (
        id SERIAL PRIMARY KEY,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT DEFAULT 'running',
        records_fetched INTEGER DEFAULT 0,
        records_inserted INTEGER DEFAULT 0,
        records_updated INTEGER DEFAULT 0,
        records_auto_imported INTEGER DEFAULT 0,
        error_message TEXT,
        naf_codes TEXT,
        departements TEXT,
        source TEXT DEFAULT 'datagouv',
        is_cron BOOLEAN DEFAULT FALSE
      );

      CREATE TABLE IF NOT EXISTS sirene_zone_config (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL DEFAULT 'Zone principale',
        entity_type TEXT NOT NULL DEFAULT 'prospect',
        departements TEXT NOT NULL DEFAULT '03,07,26,38,42,43,63',
        naf_codes TEXT NOT NULL DEFAULT '',
        lookback_days INTEGER DEFAULT 7,
        auto_import BOOLEAN DEFAULT TRUE,
        default_commercial_id TEXT DEFAULT '',
        cron_enabled BOOLEAN DEFAULT TRUE,
        cron_schedule TEXT DEFAULT '0 6 * * 1',
        insee_api_key TEXT DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        nom TEXT NOT NULL,
        categorie TEXT NOT NULL DEFAULT 'autre',
        description TEXT DEFAULT '',
        nom_fichier TEXT NOT NULL,
        type_mime TEXT NOT NULL,
        taille INTEGER NOT NULL DEFAULT 0,
        contenu TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        date_creation TEXT NOT NULL,
        FOREIGN KEY (uploaded_by) REFERENCES commerciaux(id)
      );

      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        nom TEXT NOT NULL,
        ville TEXT DEFAULT '',
        adresse TEXT DEFAULT '',
        code_postal TEXT DEFAULT '',
        telephone TEXT DEFAULT '',
        telephone_mobile TEXT DEFAULT '',
        email TEXT DEFAULT '',
        contact TEXT DEFAULT '',
        type_client TEXT NOT NULL DEFAULT 'BAR_RESTAURANT_GENERAL',
        statut TEXT NOT NULL DEFAULT 'ACTIF',
        commercial_id TEXT NOT NULL,
        next_visit TEXT,
        last_visit TEXT,
        notes TEXT DEFAULT '',
        custom_recurrence INTEGER,
        latitude DOUBLE PRECISION DEFAULT 0,
        longitude DOUBLE PRECISION DEFAULT 0,
        siret TEXT DEFAULT '',
        tournee TEXT DEFAULT '',
        prospect_id TEXT,
        date_creation TEXT NOT NULL,
        date_modification TEXT NOT NULL,
        FOREIGN KEY (commercial_id) REFERENCES commerciaux(id),
        FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS interactions (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        commercial_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'VISITE',
        date TEXT NOT NULL,
        comment TEXT DEFAULT '',
        date_creation TEXT NOT NULL,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
        FOREIGN KEY (commercial_id) REFERENCES commerciaux(id)
      );

      CREATE TABLE IF NOT EXISTS tasks_client (
        id TEXT PRIMARY KEY,
        titre TEXT NOT NULL,
        description TEXT DEFAULT '',
        statut TEXT NOT NULL DEFAULT 'A_FAIRE',
        priorite TEXT DEFAULT 'MOYENNE',
        date_echeance TEXT,
        commercial_id TEXT,
        client_id TEXT,
        date_creation TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (commercial_id) REFERENCES commerciaux(id) ON DELETE SET NULL,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS tournee_config (
        commercial_id TEXT PRIMARY KEY,
        config TEXT NOT NULL DEFAULT '{}',
        notes TEXT DEFAULT '',
        tournee_info TEXT DEFAULT '',
        week_pattern TEXT DEFAULT 'every',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (commercial_id) REFERENCES commerciaux(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS visit_frequency_config (
        type_client TEXT PRIMARY KEY,
        frequency_days INTEGER,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS easybeer_config (
        id INTEGER PRIMARY KEY DEFAULT 1,
        username TEXT DEFAULT '',
        password TEXT DEFAULT '',
        api_url TEXT DEFAULT 'https://api.easybeer.fr',
        webhook_secret TEXT DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT '',
        CHECK (id = 1)
      );

      CREATE TABLE IF NOT EXISTS easybeer_clients (
        id SERIAL PRIMARY KEY,
        easybeer_id TEXT UNIQUE,
        name TEXT DEFAULT '',
        type TEXT DEFAULT '',
        contact_name TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        phone_mobile TEXT DEFAULT '',
        email TEXT DEFAULT '',
        city TEXT DEFAULT '',
        address TEXT DEFAULT '',
        postal_code TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        commercial_email TEXT DEFAULT '',
        commercial_name TEXT DEFAULT '',
        siret TEXT DEFAULT '',
        tournee TEXT DEFAULT '',
        latitude DOUBLE PRECISION DEFAULT 0,
        longitude DOUBLE PRECISION DEFAULT 0,
        raw_data TEXT DEFAULT '{}',
        status TEXT DEFAULT 'pending',
        imported_client_id TEXT,
        synced_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS webhooks (
        id SERIAL PRIMARY KEY,
        source TEXT NOT NULL DEFAULT 'easybeer',
        type TEXT NOT NULL DEFAULT '',
        external_id TEXT DEFAULT '',
        payload TEXT DEFAULT '{}',
        received_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS assignment_rules (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL DEFAULT '',
        commercial_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (commercial_id) REFERENCES commerciaux(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS commandes (
        id TEXT PRIMARY KEY,
        client_id TEXT,
        easybeer_id TEXT DEFAULT '',
        numero TEXT DEFAULT '',
        date_commande TEXT NOT NULL,
        date_livraison TEXT DEFAULT '',
        statut TEXT NOT NULL DEFAULT 'en_cours',
        montant_ht DOUBLE PRECISION DEFAULT 0,
        montant_ttc DOUBLE PRECISION DEFAULT 0,
        lignes TEXT DEFAULT '[]',
        notes TEXT DEFAULT '',
        source TEXT DEFAULT 'easybeer',
        client_name TEXT DEFAULT '',
        raw_data TEXT DEFAULT '{}',
        date_creation TEXT NOT NULL,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        message TEXT DEFAULT '',
        data TEXT DEFAULT '{}',
        read BOOLEAN DEFAULT FALSE,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES commerciaux(id) ON DELETE CASCADE
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT DEFAULT '',
        entity_type TEXT DEFAULT '',
        entity_id TEXT DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        FOREIGN KEY (user_id) REFERENCES commerciaux(id) ON DELETE CASCADE
      );
    `);

    // Index for fast lookups by user and date
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_activity_log_user_date ON activity_log (user_id, created_at DESC);
    `);

    // Track last_seen per user
    try {
      await client.query("ALTER TABLE commerciaux ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ");
    } catch { /* column may already exist */ }

    // ============================================
    // Migrations for existing databases
    // ============================================

    try {
      await client.query('ALTER TABLE appointments ADD COLUMN IF NOT EXISTS compte_rendu TEXT DEFAULT \'\'');
    } catch { /* column may already exist */ }
    try {
      await client.query('ALTER TABLE appointments ADD COLUMN IF NOT EXISTS notes_compte_rendu TEXT DEFAULT \'\'');
    } catch { /* column may already exist */ }
    try {
      await client.query('ALTER TABLE appointments ADD COLUMN IF NOT EXISTS created_at TEXT DEFAULT \'\'');
    } catch { /* column may already exist */ }
    try {
      await client.query("ALTER TABLE appointments ADD COLUMN IF NOT EXISTS client_id TEXT DEFAULT NULL");
    } catch { /* column may already exist */ }
    try {
      await client.query("ALTER TABLE appointments ALTER COLUMN prospect_id DROP NOT NULL");
    } catch { /* column may already be nullable */ }
    // Add client_gagne pipeline column if not present
    try {
      const existing = await client.query("SELECT id FROM pipeline_columns WHERE id = 'client_gagne'");
      if (existing.rows.length === 0) {
        const maxO = await client.query('SELECT MAX(sort_order) as m FROM pipeline_columns');
        const nextOrder = (maxO.rows[0]?.m || 0) + 1;
        // Insert before 'perdu': shift perdu and ne_pas_contacter up
        await client.query("UPDATE pipeline_columns SET sort_order = sort_order + 1 WHERE sort_order >= 6");
        await client.query("INSERT INTO pipeline_columns (id, label, color, sort_order) VALUES ('client_gagne', 'Gagne', '#16a34a', 6)");
        // Rename gagne to RDV if it's still the default
        await client.query("UPDATE pipeline_columns SET label = 'RDV' WHERE id = 'gagne' AND label = 'RDV / Gagne'");
      }
    } catch { /* migration may fail on first run */ }

    // ============================================
    // One-time migration: apply pipeline stages for existing compte-rendus
    // that were not persisted due to the MOVE_PROSPECT sync bug
    // ============================================
    try {
      const rdvsDone = await client.query(
        "SELECT a.prospect_id, a.compte_rendu, a.date FROM appointments a WHERE a.statut = 'termine' AND a.compte_rendu != '' ORDER BY a.date ASC"
      );
      for (const rdv of rdvsDone.rows) {
        const p = await client.query('SELECT etape_pipeline FROM prospects WHERE id = $1', [rdv.prospect_id]);
        if (p.rows.length === 0) continue;
        const current = p.rows[0].etape_pipeline;
        const terminal = ['client_gagne', 'perdu', 'ne_pas_contacter'];
        let newStage = null;
        if (rdv.compte_rendu === 'client') {
          newStage = 'client_gagne';
        } else if (rdv.compte_rendu === 'pas_interesse') {
          newStage = 'perdu';
        } else if (rdv.compte_rendu === 'mail_envoye') {
          if (!terminal.includes(current)) newStage = 'negociation';
        } else if (rdv.compte_rendu === 'commande_plus_tard' || rdv.compte_rendu === 'a_relancer') {
          if (!terminal.includes(current)) newStage = 'proposition';
        }
        if (newStage && newStage !== current) {
          await client.query(
            'UPDATE prospects SET etape_pipeline = $1, date_modification = $2 WHERE id = $3',
            [newStage, new Date().toISOString(), rdv.prospect_id]
          );
        }
      }
    } catch (err) { console.error('Migration compte-rendu pipeline:', err); }

    // Make commandes.client_id nullable and add raw_data + client_name columns
    try { await client.query("ALTER TABLE commandes ALTER COLUMN client_id DROP NOT NULL"); } catch { /* */ }
    try { await client.query("ALTER TABLE commandes ADD COLUMN IF NOT EXISTS raw_data TEXT DEFAULT '{}'"); } catch { /* */ }
    try { await client.query("ALTER TABLE commandes ADD COLUMN IF NOT EXISTS client_name TEXT DEFAULT ''"); } catch { /* */ }

    // Add new columns to easybeer_clients
    try { await client.query("ALTER TABLE easybeer_clients ADD COLUMN IF NOT EXISTS phone_mobile TEXT DEFAULT ''"); } catch { /* */ }
    try { await client.query("ALTER TABLE easybeer_clients ADD COLUMN IF NOT EXISTS siret TEXT DEFAULT ''"); } catch { /* */ }
    try { await client.query("ALTER TABLE easybeer_clients ADD COLUMN IF NOT EXISTS tournee TEXT DEFAULT ''"); } catch { /* */ }
    try { await client.query("ALTER TABLE easybeer_clients ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION DEFAULT 0"); } catch { /* */ }
    try { await client.query("ALTER TABLE easybeer_clients ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION DEFAULT 0"); } catch { /* */ }
    try { await client.query("ALTER TABLE easybeer_clients ADD COLUMN IF NOT EXISTS commercial_name TEXT DEFAULT ''"); } catch { /* */ }

    // Add tournee_info and week_pattern to tournee_config
    try {
      await client.query("ALTER TABLE tournee_config ADD COLUMN IF NOT EXISTS tournee_info TEXT DEFAULT ''");
    } catch { /* column may already exist */ }
    try {
      await client.query("ALTER TABLE tournee_config ADD COLUMN IF NOT EXISTS week_pattern TEXT DEFAULT 'every'");
    } catch { /* column may already exist */ }

    // Migration: tasks_client extra columns
    try {
      await client.query("ALTER TABLE tasks_client ADD COLUMN IF NOT EXISTS categorie TEXT DEFAULT 'general'");
    } catch { /* column may already exist */ }
    try {
      await client.query("ALTER TABLE tasks_client ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT ''");
    } catch { /* column may already exist */ }

    // Migration: update Louis/Lucas to prospection role + add Étienne as admin
    try {
      await client.query("UPDATE commerciaux SET role = 'prospection' WHERE prenom IN ('Louis', 'Lucas') AND role = 'commercial'");
    } catch { /* migration may fail */ }
    try {
      const etienneExists = await client.query("SELECT id FROM commerciaux WHERE prenom = 'Etienne'");
      if (etienneExists.rows.length === 0) {
        const hashPwdMig = (pwd) => bcrypt.hashSync(pwd, 10);
        await client.query(
          'INSERT INTO commerciaux (id, prenom, nom, email, telephone, role, password, objectifs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          ['com-6', 'Etienne', 'Commercial', 'etienne@labrasseriedesplantes.fr', '06 00 00 00 05', 'admin', hashPwdMig('etienne123'), JSON.stringify({ appels_semaine: 40, rdv_mois: 12, prospects_mois: 35, taux_conversion: 22 })]
        );
        console.log('Added Etienne as admin.');
      } else {
        await client.query("UPDATE commerciaux SET role = 'admin' WHERE prenom = 'Etienne' AND role = 'commercial'");
      }
    } catch (err) { console.log('Etienne migration:', err.message); }

    // Migration: sirene_zone_config multi-config
    try {
      // Add name and entity_type columns if missing
      await client.query(`ALTER TABLE sirene_zone_config ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Zone principale'`);
      await client.query(`ALTER TABLE sirene_zone_config ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'prospect'`);
      // Remove CHECK constraint (id=1) if it exists - allow multiple rows
      await client.query(`ALTER TABLE sirene_zone_config DROP CONSTRAINT IF EXISTS sirene_zone_config_id_check`);
      await client.query(`ALTER TABLE sirene_zone_config DROP CONSTRAINT IF EXISTS sirene_zone_config_check`);
      // Convert id to SERIAL if it's not already
      try {
        await client.query(`CREATE SEQUENCE IF NOT EXISTS sirene_zone_config_id_seq OWNED BY sirene_zone_config.id`);
        await client.query(`ALTER TABLE sirene_zone_config ALTER COLUMN id SET DEFAULT nextval('sirene_zone_config_id_seq')`);
        const maxId = await client.query('SELECT COALESCE(MAX(id), 0) + 1 as next FROM sirene_zone_config');
        await client.query(`SELECT setval('sirene_zone_config_id_seq', $1, false)`, [maxId.rows[0].next]);
      } catch (seqErr) { /* sequence may already exist */ }
    } catch (err) { console.log('sirene_zone_config multi-config migration:', err.message); }

    // Migration: sirene_import_rules table
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS sirene_import_rules (
          id SERIAL PRIMARY KEY,
          naf_code TEXT NOT NULL,
          naf_label TEXT DEFAULT '',
          entity_type TEXT NOT NULL DEFAULT 'prospect',
          pipeline_stage TEXT DEFAULT 'nouveau_datagouv',
          auto_import BOOLEAN DEFAULT TRUE,
          commercial_id TEXT DEFAULT '',
          sort_order INTEGER DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL DEFAULT ''
        )
      `);
      // Seed default rules if empty
      const ruleCount = await client.query('SELECT COUNT(*) as c FROM sirene_import_rules');
      if (parseInt(ruleCount.rows[0].c) === 0) {
        const now = new Date().toISOString();
        const defaultRules = [
          // Prospects (restaurants, bars, cafes, traiteurs)
          ['56.10A', 'Restauration traditionnelle', 'prospect', 'nouveau_datagouv', true, 1],
          ['56.10B', 'Cafeterias et libres-services', 'prospect', 'nouveau_datagouv', true, 2],
          ['56.10C', 'Restauration rapide', 'prospect', 'nouveau_datagouv', true, 3],
          ['56.21Z', 'Services des traiteurs', 'prospect', 'nouveau_datagouv', true, 4],
          ['56.29A', 'Restauration collective sous contrat', 'prospect', 'nouveau_datagouv', true, 5],
          ['56.29B', 'Autres services de restauration', 'prospect', 'nouveau_datagouv', true, 6],
          ['56.30Z', 'Debits de boissons', 'prospect', 'nouveau_datagouv', true, 7],
          ['47.25Z', 'Cavistes', 'prospect', 'nouveau_datagouv', true, 8],
          // Distributeurs
          ['46.34Z', 'Commerce de gros de boissons', 'distributeur', 'nouveau_datagouv', true, 9],
          ['46.17B', 'Intermediaires boissons et tabac', 'distributeur', 'nouveau_datagouv', true, 10],
          ['46.39B', 'Commerce de gros alimentaire', 'distributeur', 'nouveau_datagouv', true, 11],
          // Concurrents (producteurs boissons)
          ['11.01Z', 'Distilleries / Spiritueux', 'concurrent', 'nouveau_datagouv', false, 12],
          ['11.02A', 'Vins effervescents', 'concurrent', 'nouveau_datagouv', false, 13],
          ['11.02B', 'Vinification', 'concurrent', 'nouveau_datagouv', false, 14],
          ['11.03Z', 'Cidre et vins de fruits', 'concurrent', 'nouveau_datagouv', false, 15],
          ['11.04Z', 'Boissons fermentees', 'concurrent', 'nouveau_datagouv', false, 16],
          ['11.05Z', 'Fabrication de biere', 'concurrent', 'nouveau_datagouv', false, 17],
          ['11.06Z', 'Fabrication de malt', 'concurrent', 'nouveau_datagouv', false, 18],
          ['11.07A', 'Eaux de table', 'concurrent', 'nouveau_datagouv', false, 19],
          ['11.07B', 'Boissons rafraichissantes', 'concurrent', 'nouveau_datagouv', false, 20],
        ];
        for (const [naf, label, type, stage, autoImport, order] of defaultRules) {
          await client.query(
            `INSERT INTO sirene_import_rules (naf_code, naf_label, entity_type, pipeline_stage, auto_import, sort_order, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
            [naf, label, type, stage, autoImport, order, now]
          );
        }
        console.log('Seeded 20 default import rules');
      }
    } catch (err) { console.log('sirene_import_rules migration:', err.message); }

    // Migration: add entity_type column to prospects
    try { await client.query("ALTER TABLE prospects ADD COLUMN IF NOT EXISTS entity_type TEXT DEFAULT 'prospect'"); } catch { /* */ }

    // Migration: make commercial_id nullable on prospects (allow import without assignment)
    try { await client.query("ALTER TABLE prospects ALTER COLUMN commercial_id DROP NOT NULL"); } catch { /* */ }
    try { await client.query("ALTER TABLE prospects ALTER COLUMN commercial_id SET DEFAULT NULL"); } catch { /* */ }

    // Migration: add siret column to prospects for dedup
    try { await client.query("ALTER TABLE prospects ADD COLUMN IF NOT EXISTS siret TEXT DEFAULT ''"); } catch { /* */ }
    // Create index for fast SIRET lookup
    try { await client.query("CREATE INDEX IF NOT EXISTS idx_prospects_siret ON prospects(siret) WHERE siret != ''"); } catch { /* */ }

    // Performance indexes for frequent queries
    try { await client.query("CREATE INDEX IF NOT EXISTS idx_prospects_commercial_id ON prospects(commercial_id)"); } catch { /* */ }
    try { await client.query("CREATE INDEX IF NOT EXISTS idx_calls_prospect_id ON calls(prospect_id)"); } catch { /* */ }
    try { await client.query("CREATE INDEX IF NOT EXISTS idx_appointments_prospect_id ON appointments(prospect_id)"); } catch { /* */ }
    try { await client.query("CREATE INDEX IF NOT EXISTS idx_reminders_prospect_id ON reminders(prospect_id)"); } catch { /* */ }
    try { await client.query("CREATE INDEX IF NOT EXISTS idx_clients_commercial_id ON clients(commercial_id)"); } catch { /* */ }
    try { await client.query("CREATE INDEX IF NOT EXISTS idx_interactions_client_id ON interactions(client_id)"); } catch { /* */ }
    try { await client.query("CREATE INDEX IF NOT EXISTS idx_commandes_client_id ON commandes(client_id)"); } catch { /* */ }
    try { await client.query("CREATE INDEX IF NOT EXISTS idx_tournee_config_commercial_id ON tournee_config(commercial_id)"); } catch { /* */ }

    // Migration: add latitude/longitude to sirene_etablissements (may have been created without them)
    try { await client.query("ALTER TABLE sirene_etablissements ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION"); } catch { /* */ }
    try { await client.query("ALTER TABLE sirene_etablissements ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION"); } catch { /* */ }

    // Migration: sirene_duplicate_queue for admin review
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS sirene_duplicate_queue (
          id SERIAL PRIMARY KEY,
          sirene_etab_id INTEGER,
          existing_prospect_id TEXT,
          match_type TEXT NOT NULL DEFAULT 'siret',
          sirene_nom TEXT DEFAULT '',
          sirene_siret TEXT DEFAULT '',
          sirene_ville TEXT DEFAULT '',
          sirene_naf TEXT DEFAULT '',
          existing_nom TEXT DEFAULT '',
          existing_siret TEXT DEFAULT '',
          existing_ville TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          resolved_by TEXT DEFAULT '',
          resolved_at TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT ''
        )
      `);
    } catch (err) { console.log('sirene_duplicate_queue migration:', err.message); }

    // Migration: entity_types table (custom entity types)
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS entity_types (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          icon TEXT NOT NULL DEFAULT 'Tag',
          color TEXT NOT NULL DEFAULT 'text-gray-600 bg-gray-50 border-gray-200',
          show_in_pipeline BOOLEAN DEFAULT FALSE,
          sort_order INTEGER DEFAULT 100,
          is_default BOOLEAN DEFAULT FALSE,
          created_at TEXT NOT NULL DEFAULT ''
        )
      `);
      // Seed defaults if empty
      const etCount = await client.query('SELECT COUNT(*) as c FROM entity_types');
      if (parseInt(etCount.rows[0].c) === 0) {
        const now = new Date().toISOString();
        const defaults = [
          ['prospect', 'Prospect', 'Users', 'text-sky-600 bg-sky-50 border-sky-200', true, 1, true],
          ['client', 'Client', 'Building2', 'text-green-600 bg-green-50 border-green-200', false, 2, true],
          ['concurrent', 'Concurrent', 'Shield', 'text-red-600 bg-red-50 border-red-200', false, 3, true],
          ['distributeur', 'Distributeur', 'Truck', 'text-amber-600 bg-amber-50 border-amber-200', false, 4, true],
          ['partenaire', 'Partenaire', 'Handshake', 'text-purple-600 bg-purple-50 border-purple-200', false, 5, true],
          ['fournisseur', 'Fournisseur', 'Package', 'text-indigo-600 bg-indigo-50 border-indigo-200', false, 6, true],
        ];
        for (const [id, label, icon, color, showPipeline, order, isDef] of defaults) {
          await client.query(
            'INSERT INTO entity_types (id, label, icon, color, show_in_pipeline, sort_order, is_default, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [id, label, icon, color, showPipeline, order, isDef, now]
          );
        }
        console.log('Seeded 6 default entity types');
      }
    } catch (err) { console.log('entity_types migration:', err.message); }

    // Migration: add new columns to sirene_sync_logs
    try { await client.query("ALTER TABLE sirene_sync_logs ADD COLUMN IF NOT EXISTS records_auto_imported INTEGER DEFAULT 0"); } catch { /* */ }
    try { await client.query("ALTER TABLE sirene_sync_logs ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'datagouv'"); } catch { /* */ }
    try { await client.query("ALTER TABLE sirene_sync_logs ADD COLUMN IF NOT EXISTS is_cron BOOLEAN DEFAULT FALSE"); } catch { /* */ }

    // Migration: add nouveau_datagouv pipeline column if not exists
    try {
      const existingCol = await client.query("SELECT id FROM pipeline_columns WHERE id = 'nouveau_datagouv'");
      if (existingCol.rows.length === 0) {
        // Shift all existing columns sort_order +1
        await client.query("UPDATE pipeline_columns SET sort_order = sort_order + 1");
        await client.query(
          "INSERT INTO pipeline_columns (id, label, color, sort_order) VALUES ('nouveau_datagouv', 'Importe Datagouv', '#0ea5e9', 0)"
        );
        console.log('Added nouveau_datagouv pipeline column.');
      }
    } catch (err) { console.log('Pipeline datagouv migration:', err.message); }

    // ============================================
    // Seed data (only if empty)
    // ============================================

    const userCount = await client.query('SELECT COUNT(*) as c FROM commerciaux');
    if (parseInt(userCount.rows[0].c) === 0) {
      console.log('Seeding database...');

      const hashPwd = (pwd) => bcrypt.hashSync(pwd, 10);

      // Users
      const users = [
        ['com-1', 'Guillaume', 'Commercial', 'guillaume@labrasseriedesplantes.fr', '06 84 44 40 44', 'admin', hashPwd('admin123'), JSON.stringify({ appels_semaine: 30, rdv_mois: 15, prospects_mois: 40, taux_conversion: 25 })],
        ['com-2', 'Louis', 'Prospection', 'louis@labrasseriedesplantes.fr', '06 00 00 00 01', 'prospection', hashPwd('louis123'), JSON.stringify({ appels_semaine: 50, rdv_mois: 10, prospects_mois: 30, taux_conversion: 20 })],
        ['com-3', 'Lucas', 'Prospection', 'lucas@labrasseriedesplantes.fr', '06 00 00 00 02', 'prospection', hashPwd('lucas123'), JSON.stringify({ appels_semaine: 50, rdv_mois: 10, prospects_mois: 30, taux_conversion: 20 })],
        ['com-4', 'Alban', 'Commercial', 'alban@labrasseriedesplantes.fr', '06 00 00 00 03', 'commercial', hashPwd('alban123'), JSON.stringify({ appels_semaine: 40, rdv_mois: 12, prospects_mois: 35, taux_conversion: 22 })],
        ['com-5', 'Loic', 'Commercial', 'loic@labrasseriedesplantes.fr', '06 00 00 00 04', 'commercial', hashPwd('loic123'), JSON.stringify({ appels_semaine: 40, rdv_mois: 12, prospects_mois: 35, taux_conversion: 22 })],
        ['com-6', 'Etienne', 'Commercial', 'etienne@labrasseriedesplantes.fr', '06 00 00 00 05', 'admin', hashPwd('etienne123'), JSON.stringify({ appels_semaine: 40, rdv_mois: 12, prospects_mois: 35, taux_conversion: 22 })],
      ];
      for (const u of users) {
        await client.query(
          'INSERT INTO commerciaux (id, prenom, nom, email, telephone, role, password, objectifs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          u
        );
      }

      // Tags
      const tags = [
        ['tag-1', 'Budget limite', '#ef4444'],
        ['tag-2', 'Gros potentiel', '#22c55e'],
        ['tag-3', 'Deja client concurrent', '#f59e0b'],
        ['tag-4', 'Interesse bio', '#3b82f6'],
        ['tag-5', 'Urgence', '#dc2626'],
        ['tag-6', 'A relancer', '#8b5cf6'],
        ['tag-7', 'Premium', '#f97316'],
      ];
      for (const t of tags) {
        await client.query('INSERT INTO tags (id, nom, couleur) VALUES ($1,$2,$3)', t);
      }

      // Pipeline columns
      const cols = [
        ['nouveau_datagouv', 'Importe Datagouv', '#0ea5e9', 0],
        ['nouveau', 'Nouveau', '#6b7280', 1],
        ['a_contacter', 'A contacter', '#3b82f6', 2],
        ['contacte', 'Contacte', '#8b5cf6', 3],
        ['proposition', 'Proposition', '#f97316', 4],
        ['negociation', 'Negociation', '#ef4444', 5],
        ['gagne', 'RDV', '#22c55e', 6],
        ['client_gagne', 'Gagne', '#16a34a', 7],
        ['perdu', 'Perdu', '#dc2626', 8],
        ['ne_pas_contacter', 'Ne pas contacter', '#991b1b', 9],
      ];
      for (const c of cols) {
        await client.query('INSERT INTO pipeline_columns (id, label, color, sort_order) VALUES ($1,$2,$3,$4)', c);
      }

      // Email templates
      const tpls = [
        ['tpl-1', 'Premier contact – Cave / Epicerie fine', 'Catalogue et tarifs La Brasserie des Plantes – Liqueurs artisanales de Haute-Loire', 'Bonjour {{nom_contact}},\n\nSuite a notre echange telephonique de ce jour, je vous transmets comme convenu notre catalogue et nos tarifs cave.\n\nLa Brasserie des Plantes est un artisan liquoriste de Saint-Didier-en-Velay (43) specialise dans l\'assemblage de plantes par maceration.\n\nNos liqueurs phares :\n- L\'Alchimie Vegetale (50°) – Meilleur Digestif du Monde 2025\n- L\'Herbe des Druides (28°) – Medaille d\'Or au Concours International de Lyon\n- Le Gorgeon des Machures (30°)\n- La Fleche Ardente (27°)\n\nJe serais ravi de venir vous presenter notre gamme a {{nom_etablissement}}.\n\nBien cordialement,\n\n{{commercial}}\nLa Brasserie des Plantes\n{{telephone_commercial}}\n\nArtisanalement votre', 'presentation'],
        ['tpl-2', 'Premier contact – Bar / Restaurant (CHR)', 'Notre gamme liqueurs pour votre carte – La Brasserie des Plantes', 'Bonjour {{nom_contact}},\n\nSuite a notre echange telephonique, je vous transmets comme convenu notre presentation et nos tarifs CHR.\n\nNous proposons des liqueurs artisanales de Haute-Loire parfaites pour vos digestifs et cocktails signature.\n\nPourriez-vous me recevoir 20 minutes a {{nom_etablissement}} pour vous presenter notre gamme ?\n\nBien cordialement,\n\n{{commercial}}\nLa Brasserie des Plantes\n{{telephone_commercial}}\n\nArtisanalement votre', 'presentation'],
        ['tpl-3', 'Relance douce (1ere relance)', 'Re: Catalogue La Brasserie des Plantes – Rendez-vous degustation ?', 'Bonjour {{nom_contact}},\n\nJe reviens vers vous concernant notre echange et l\'envoi de notre catalogue de liqueurs artisanales.\n\nAvez-vous eu l\'occasion de parcourir notre gamme ?\n\n{{commercial}} sera dans votre secteur prochainement. Seriez-vous interesse par une degustation rapide de 20 minutes a {{nom_etablissement}} ?\n\nBien cordialement,\n\n{{commercial}}\nLa Brasserie des Plantes\n{{telephone_commercial}}\n\nArtisanalement votre', 'relance'],
        ['tpl-4', 'Relance insistante (derniere tentative)', 'Derniere proposition – Degustation La Brasserie des Plantes', 'Bonjour {{nom_contact}},\n\nJe vous ai contacte il y a quelques semaines concernant nos liqueurs artisanales de Haute-Loire.\n\nDerniere proposition : {{commercial}} passe dans votre region prochainement et peut s\'arreter 15 minutes a {{nom_etablissement}} pour une degustation express.\n\nSi vous n\'etes pas interesse, n\'hesitez pas a me le faire savoir.\n\nBien cordialement,\n\n{{commercial}}\nLa Brasserie des Plantes\n{{telephone_commercial}}\n\nArtisanalement votre', 'relance'],
        ['tpl-5', 'Confirmation de rendez-vous', 'Confirmation RDV degustation – La Brasserie des Plantes', 'Bonjour {{nom_contact}},\n\nJe vous confirme notre rendez-vous de degustation :\n\nDate : {{date_rdv}}\nLieu : {{nom_etablissement}}\n\nJe viendrai avec une selection de nos creations.\n\nAu plaisir de vous rencontrer !\n\nBien cordialement,\n\n{{commercial}}\nLa Brasserie des Plantes\n{{telephone_commercial}}\n\nArtisanalement votre', 'confirmation'],
        ['tpl-6', 'Remerciement post-degustation', 'Suite a notre degustation – Catalogue La Brasserie des Plantes', 'Bonjour {{nom_contact}},\n\nJe tenais a vous remercier pour votre accueil chaleureux lors de notre degustation a {{nom_etablissement}}.\n\nComme convenu, vous trouverez en piece jointe notre catalogue avec les tarifs professionnels.\n\nJe reste a votre disposition pour passer prendre votre commande.\n\nBien cordialement,\n\n{{commercial}}\nLa Brasserie des Plantes\n{{telephone_commercial}}\n\nArtisanalement votre', 'remerciement'],
        ['tpl-7', 'Envoi catalogue (sur demande)', 'Catalogue professionnel – La Brasserie des Plantes', 'Bonjour {{nom_contact}},\n\nSuite a votre demande, vous trouverez en piece jointe notre catalogue professionnel.\n\nNos produits phares :\n- L\'Herbe des Druides (28°) – Medaillee d\'Or\n- L\'Alchimie Vegetale (50°) – Meilleur Digestif du Monde 2025\n- Le Gorgeon des Machures (30°)\n- La PraliCoquine (15°)\n- Le Zeleste (17,5°)\n\nJe reste a votre disposition pour organiser une degustation a {{nom_etablissement}}.\n\nBien cordialement,\n\n{{commercial}}\nLa Brasserie des Plantes\n{{telephone_commercial}}\n\nArtisanalement votre', 'catalogue'],
        ['tpl-8', 'Annonce nouveaute / medaille', 'Nouveaute – La Brasserie des Plantes', 'Bonjour {{nom_contact}},\n\nNous avons le plaisir de vous annoncer une grande nouvelle !\n\n[DECRIRE LA NOUVEAUTE OU LA MEDAILLE ICI]\n\nN\'hesitez pas a me contacter pour en savoir plus ou organiser une degustation a {{nom_etablissement}}.\n\nBien cordialement,\n\n{{commercial}}\nLa Brasserie des Plantes\n{{telephone_commercial}}\n\nArtisanalement votre', 'nouveaute'],
        ['tpl-9', 'Promotion clients directs', 'Promotion exclusive – La Brasserie des Plantes', 'Bonjour {{nom_contact}},\n\nJe vous contacte pour vous informer d\'une promotion exceptionnelle :\n\nPROMOTION : 5 + 1\n5 bouteilles achetees = 1 bouteille offerte\n1 BIB achete = 1 bouteille offerte\n\nCette promotion s\'applique sur toute notre gamme.\n\nN\'hesitez pas a me contacter pour passer commande.\n\n[Promotion valable du XX au XX]\n\nBien cordialement,\n\n{{commercial}}\nLa Brasserie des Plantes\n{{telephone_commercial}}\n\nArtisanalement votre', 'promotion'],
        ['tpl-10', 'Promotion distributeurs', 'Promotion – Offre speciale pour vos clients', 'Bonjour {{nom_contact}},\n\nNous mettons en place une promotion exceptionnelle pour vos clients.\n\nPROMOTION : 5 + 1\n5 bouteilles achetees = 1 bouteille offerte\n1 BIB achete = 1 bouteille offerte\n\nN\'hesitez pas a relayer cette information aupres de votre reseau.\n\n[Promotion valable du XX au XX]\n\nGuillaume\nLa Brasserie des Plantes\n06 84 44 40 44\nlabrasseriedesplantes@gmail.com\nwww.labrasseriedesplantes.fr\n\nArtisanalement votre', 'promotion'],
      ];
      for (const t of tpls) {
        await client.query('INSERT INTO email_templates (id, nom, sujet, corps, type) VALUES ($1,$2,$3,$4,$5)', t);
      }

      console.log('Database seeded successfully.');
    }

    // Migration: update email templates to v3 (liqueurs)
    const tplCheck = await client.query("SELECT id FROM email_templates WHERE id = 'tpl-7'");
    if (tplCheck.rows.length === 0) {
      console.log('Migrating email templates to v3...');
      await client.query('DELETE FROM email_templates');
      const tplsV3 = [
        ['tpl-1', 'Premier contact – Cave / Epicerie fine', 'Catalogue et tarifs La Brasserie des Plantes – Liqueurs artisanales de Haute-Loire', 'Bonjour {{nom_contact}},\n\nSuite a notre echange telephonique de ce jour, je vous transmets comme convenu notre catalogue et nos tarifs cave.\n\nLa Brasserie des Plantes est un artisan liquoriste de Saint-Didier-en-Velay (43) specialise dans l\'assemblage de plantes par maceration. Contrairement aux monoproduits classiques (une verveine, une menthe, un citron...), nous creons des compositions vegetales uniques entre 15° et 50°.\n\nNos liqueurs phares pour votre clientele :\n- L\'Alchimie Vegetale (50°) – Meilleur Digestif du Monde 2025 aux World Liqueur Awards de Londres (27 plantes)\n- L\'Herbe des Druides (28°) – Medaille d\'Or au Concours International de Lyon (verveine, serpolet, carvi)\n- Le Gorgeon des Machures (30°) – Notre liqueur de verveine aux notes complexes\n- La Fleche Ardente (27°) – Fruits rouges assembles (cassis, framboise, myrtille)\n\nTous nos produits sont elabores artisanalement, avec des plantes principalement issues de Haute-Loire et d\'Ardeche.\n\nJe serais ravi de venir vous presenter notre gamme et organiser une degustation a {{nom_etablissement}}. Etes-vous disponible pour un rendez-vous de 30 minutes ?\n\nEn piece jointe : catalogue produits et grille tarifaire cave.\n\nN\'hesitez pas a me contacter pour toute question.\n\nBien cordialement,\n\n{{commercial}}\nLa Brasserie des Plantes\n{{telephone_commercial}}\n18 Grand Place, 43140 Saint-Didier-en-Velay\nwww.labrasseriedesplantes.fr\n\nArtisanalement votre', 'presentation'],
        ['tpl-2', 'Premier contact – Bar / Restaurant (CHR)', 'Notre gamme liqueurs pour votre carte – La Brasserie des Plantes', 'Bonjour {{nom_contact}},\n\nSuite a notre echange telephonique, je vous transmets comme convenu notre presentation et nos tarifs CHR.\n\nNous proposons des liqueurs artisanales de Haute-Loire parfaites pour vos digestifs et cocktails signature. Nos assemblages de plantes offrent des profils uniques :\n\n- L\'Herbe des Druides (28°) – Medaille d\'Or, parfaite en digestif ou en cocktail\n- L\'Alchimie Vegetale (50°) – Meilleur Digestif du Monde 2025 aux World Liqueur Awards de Londres\n- Le Gorgeon des Machures (30°) – Verveine aux notes de charbon, tres originale en cocktail\n- Gamme 15° a 50° adaptee a tous vos besoins (BIB 5L disponibles)\n\nContrairement aux liqueurs classiques, nos creations permettent de proposer quelque chose de vraiment different a vos clients, avec des marges interessantes.\n\nPourriez-vous me recevoir 20 minutes a {{nom_etablissement}} pour vous presenter notre gamme ? Je peux venir avec des echantillons pour que vous testiez en conditions reelles.\n\nEn piece jointe : catalogue Bar-Restaurant et grille tarifaire professionnelle.\n\nBien cordialement,\n\n{{commercial}}\nLa Brasserie des Plantes\n{{telephone_commercial}}\n18 Grand Place, 43140 Saint-Didier-en-Velay\nwww.labrasseriedesplantes.fr\n\nArtisanalement votre', 'presentation'],
        ['tpl-3', 'Relance douce (1ere relance)', 'Re: Catalogue La Brasserie des Plantes – Rendez-vous degustation ?', 'Bonjour {{nom_contact}},\n\nJe reviens vers vous concernant notre echange et l\'envoi de notre catalogue de liqueurs artisanales.\n\nAvez-vous eu l\'occasion de parcourir notre gamme ?\n\nPour rappel :\n- Artisan liquoriste de Haute-Loire (Saint-Didier-en-Velay)\n- L\'Alchimie Vegetale : Meilleur Digestif du Monde 2025 aux World Liqueur Awards de Londres\n- Assemblages de plantes exclusifs (pas de monoproduits)\n- Marges interessantes pour votre activite\n\n{{commercial}} sera dans votre secteur prochainement. Plutot que d\'echanger par mail, seriez-vous interesse par une degustation rapide de 20 minutes a {{nom_etablissement}} ? Vous pourrez gouter nos produits phares et voir concretement ce qui pourrait convenir a votre clientele.\n\nSi les dates ne conviennent pas, n\'hesitez pas a me proposer d\'autres creneaux !\n\nBien cordialement,\n\n{{commercial}}\nLa Brasserie des Plantes\n{{telephone_commercial}}\n18 Grand Place, 43140 Saint-Didier-en-Velay\nwww.labrasseriedesplantes.fr\n\nArtisanalement votre', 'relance'],
        ['tpl-4', 'Relance insistante (derniere tentative)', 'Derniere proposition – Degustation La Brasserie des Plantes', 'Bonjour {{nom_contact}},\n\nJe vous ai contacte il y a quelques semaines concernant nos liqueurs artisanales de Haute-Loire.\n\nDerniere proposition : {{commercial}} passe dans votre region prochainement et peut s\'arreter 15 minutes a {{nom_etablissement}} pour une degustation express.\n\nL\'opportunite :\n- Gouter l\'Alchimie Vegetale (Meilleur Digestif du Monde 2025)\n- Decouvrir nos assemblages exclusifs\n- Evaluer l\'interet pour votre etablissement\n- Aucun engagement\n\nSi cette date ne vous convient pas ou si vous n\'etes pas interesse, n\'hesitez pas a me le faire savoir et je ne vous solliciterai plus.\n\nMerci pour votre temps !\n\nBien cordialement,\n\n{{commercial}}\nLa Brasserie des Plantes\n{{telephone_commercial}}\n18 Grand Place, 43140 Saint-Didier-en-Velay\nwww.labrasseriedesplantes.fr\n\nArtisanalement votre', 'relance'],
        ['tpl-5', 'Confirmation de rendez-vous', 'Confirmation RDV degustation – La Brasserie des Plantes', 'Bonjour {{nom_contact}},\n\nJe vous confirme notre rendez-vous de degustation :\n\nDate : {{date_rdv}}\nLieu : {{nom_etablissement}}\n\nJe viendrai avec une selection de nos creations pour que vous puissiez gouter et voir ce qui convient le mieux a votre etablissement.\n\nN\'hesitez pas a me prevenir si un changement d\'horaire est necessaire.\n\nAu plaisir de vous rencontrer !\n\nBien cordialement,\n\n{{commercial}}\nLa Brasserie des Plantes\n{{telephone_commercial}}\n18 Grand Place, 43140 Saint-Didier-en-Velay\nwww.labrasseriedesplantes.fr\n\nArtisanalement votre', 'confirmation'],
        ['tpl-6', 'Remerciement post-degustation', 'Suite a notre degustation – Catalogue La Brasserie des Plantes', 'Bonjour {{nom_contact}},\n\nJe tenais a vous remercier pour votre accueil chaleureux lors de notre degustation a {{nom_etablissement}}.\n\nComme convenu, vous trouverez en piece jointe notre catalogue avec les tarifs professionnels et les fiches produits detaillees.\n\nPour rappel, tous nos produits sont elabores artisanalement a Saint-Didier-en-Velay, avec des plantes principalement issues de Haute-Loire et d\'Ardeche.\n\nJe reste a votre disposition pour passer prendre votre commande ou repondre a vos questions.\n\nDans l\'attente de votre retour,\n\nBien cordialement,\n\n{{commercial}}\nLa Brasserie des Plantes\n{{telephone_commercial}}\n18 Grand Place, 43140 Saint-Didier-en-Velay\nwww.labrasseriedesplantes.fr\n\nArtisanalement votre\n\nP.J. : Catalogue professionnel + grille tarifaire', 'remerciement'],
        ['tpl-7', 'Envoi catalogue (sur demande)', 'Catalogue professionnel – La Brasserie des Plantes', 'Bonjour {{nom_contact}},\n\nSuite a votre demande, vous trouverez en piece jointe notre catalogue professionnel.\n\nVous y decouvrirez notre gamme complete de liqueurs artisanales a base de plantes de Haute-Loire et d\'Ardeche, avec nos tarifs preferentiels pour les professionnels.\n\nNos produits phares :\n- L\'Herbe des Druides (28°) – Medaillee d\'Or, assemblage verveine / serpolet / carvi\n- L\'Alchimie Vegetale (50°) – Meilleur Digestif du Monde 2025 (27 plantes)\n- Le Gorgeon des Machures (30°) – Liqueur de verveine intense\n- La PraliCoquine (15°) – Aperitif a la praline\n- Le Zeleste (17,5°) – Notre nouveaute qui cartonne\n\nTous nos produits sont disponibles en differents conditionnements selon vos besoins : bouteilles 20cl a 3L, BIB 5L, formats degustation, etc.\n\nJe reste a votre disposition pour toute question ou pour organiser une degustation a {{nom_etablissement}}.\n\nBien cordialement,\n\n{{commercial}}\nLa Brasserie des Plantes\n{{telephone_commercial}}\n18 Grand Place, 43140 Saint-Didier-en-Velay\nwww.labrasseriedesplantes.fr\n\nArtisanalement votre\n\nP.J. : Catalogue professionnel La Brasserie des Plantes', 'catalogue'],
        ['tpl-8', 'Annonce nouveaute / medaille', 'Nouveaute – La Brasserie des Plantes', 'Bonjour {{nom_contact}},\n\nNous avons le plaisir de vous annoncer une grande nouvelle !\n\n[DECRIRE LA NOUVEAUTE OU LA MEDAILLE ICI]\n\nCette distinction / nouveaute vient renforcer notre gamme de liqueurs artisanales elaborees a Saint-Didier-en-Velay.\n\nN\'hesitez pas a me contacter pour en savoir plus ou organiser une degustation a {{nom_etablissement}}.\n\nBien cordialement,\n\n{{commercial}}\nLa Brasserie des Plantes\n{{telephone_commercial}}\n18 Grand Place, 43140 Saint-Didier-en-Velay\nwww.labrasseriedesplantes.fr\n\nArtisanalement votre', 'nouveaute'],
        ['tpl-9', 'Promotion clients directs', 'Promotion exclusive – La Brasserie des Plantes', 'Bonjour {{nom_contact}},\n\nJ\'espere que tout va bien de votre cote.\n\nJe vous contacte pour vous informer d\'une promotion exceptionnelle reservee a nos clients :\n\nPROMOTION : 5 + 1\n5 bouteilles achetees = 1 bouteille offerte\n1 BIB achete = 1 bouteille offerte\n\nCette promotion s\'applique sur toute notre gamme, y compris les Magnums et Jeroboams.\n\nNos produits phares :\n- L\'Herbe des Druides – Quadruple medaillee (Or Lyon 2023-2024, Argent Paris 2024, Argent World Liqueur Awards 2024)\n- L\'Alchimie Vegetale – Meilleur Digestif du Monde 2025 aux World Liqueur Awards de Londres\n\nN\'hesitez pas a me contacter pour passer commande ou en savoir plus.\n\n[Promotion valable du XX au XX]\n\nBien cordialement,\n\n{{commercial}}\nLa Brasserie des Plantes\n{{telephone_commercial}}\n18 Grand Place, 43140 Saint-Didier-en-Velay\nwww.labrasseriedesplantes.fr\n\nArtisanalement votre', 'promotion'],
        ['tpl-10', 'Promotion distributeurs', 'Promotion – Offre speciale pour vos clients', 'Bonjour {{nom_contact}},\n\nJ\'espere que tout va bien de votre cote.\n\nJe vous contacte pour vous informer que nous mettons en place une promotion exceptionnelle pour vos clients.\n\nPROMOTION : 5 + 1\n5 bouteilles achetees = 1 bouteille offerte\n1 BIB achete = 1 bouteille offerte\n\nCette promotion s\'applique sur toute notre gamme, y compris les Magnums et Jeroboams.\n\nVos arguments de vente :\n- L\'Herbe des Druides – Quadruple medaillee (Or Lyon 2023-2024, Argent Paris 2024, Argent World Liqueur Awards 2024)\n- L\'Alchimie Vegetale – Meilleur Digestif du Monde 2025 aux World Liqueur Awards de Londres\n\nN\'hesitez pas a relayer cette information aupres de votre reseau. Je reste a votre disposition pour echanger sur les modalites.\n\n[Promotion valable du XX au XX]\n\nGuillaume\nLa Brasserie des Plantes\n06 84 44 40 44\nlabrasseriedesplantes@gmail.com\nwww.labrasseriedesplantes.fr\n\nArtisanalement votre', 'promotion'],
      ];
      for (const t of tplsV3) {
        await client.query('INSERT INTO email_templates (id, nom, sujet, corps, type) VALUES ($1,$2,$3,$4,$5)', t);
      }
      console.log('Email templates migrated to v3.');
    }
  } finally {
    if (client) client.release();
  }
}

// Run initialization
const dbReady = initDatabase().catch(err => {
  console.error('Database initialization error:', err);
  process.exit(1);
});

export { pool, dbReady };
export default pool;
