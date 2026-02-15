import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required.');
  console.error('On Railway: add a PostgreSQL service and link it to your app,');
  console.error('or set DATABASE_URL manually in your service variables.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ============================================
// Schema
// ============================================

async function initDatabase() {
  const client = await pool.connect();
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
        commercial_id TEXT NOT NULL,
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
    `);

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
        ['com-2', 'Louis', 'Prospection', 'louis@labrasseriedesplantes.fr', '06 00 00 00 01', 'commercial', hashPwd('louis123'), JSON.stringify({ appels_semaine: 50, rdv_mois: 10, prospects_mois: 30, taux_conversion: 20 })],
        ['com-3', 'Lucas', 'Prospection', 'lucas@labrasseriedesplantes.fr', '06 00 00 00 02', 'commercial', hashPwd('lucas123'), JSON.stringify({ appels_semaine: 50, rdv_mois: 10, prospects_mois: 30, taux_conversion: 20 })],
        ['com-4', 'Alban', 'Commercial', 'alban@labrasseriedesplantes.fr', '06 00 00 00 03', 'commercial', hashPwd('alban123'), JSON.stringify({ appels_semaine: 40, rdv_mois: 12, prospects_mois: 35, taux_conversion: 22 })],
        ['com-5', 'Loic', 'Commercial', 'loic@labrasseriedesplantes.fr', '06 00 00 00 04', 'commercial', hashPwd('loic123'), JSON.stringify({ appels_semaine: 40, rdv_mois: 12, prospects_mois: 35, taux_conversion: 22 })],
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
        ['nouveau', 'Nouveau', '#6b7280', 0],
        ['a_contacter', 'A contacter', '#3b82f6', 1],
        ['contacte', 'Contacte', '#8b5cf6', 2],
        ['proposition', 'Proposition', '#f97316', 3],
        ['negociation', 'Negociation', '#ef4444', 4],
        ['gagne', 'RDV / Gagne', '#22c55e', 5],
        ['perdu', 'Perdu', '#dc2626', 6],
        ['ne_pas_contacter', 'Ne pas contacter', '#991b1b', 7],
      ];
      for (const c of cols) {
        await client.query('INSERT INTO pipeline_columns (id, label, color, sort_order) VALUES ($1,$2,$3,$4)', c);
      }

      // Email templates
      const tpls = [
        ['tpl-1', 'Presentation', 'Decouvrez nos bieres artisanales', 'Bonjour {nom_contact},\n\nJe suis {commercial} de La Brasserie des Plantes.\n\nNous proposons une gamme de bieres artisanales brassees dans la Loire.\n\nCordialement,\n{commercial}', 'prospection'],
        ['tpl-2', 'Relance', 'Suite a notre echange', 'Bonjour {nom_contact},\n\nJe me permets de revenir vers vous suite a notre dernier echange.\n\nCordialement,\n{commercial}', 'relance'],
        ['tpl-3', 'Confirmation RDV', 'Confirmation de notre rendez-vous', 'Bonjour {nom_contact},\n\nJe vous confirme notre rendez-vous.\n\nCordialement,\n{commercial}', 'rdv'],
        ['tpl-4', 'Remerciement', 'Merci pour votre accueil', 'Bonjour {nom_contact},\n\nMerci pour le temps que vous nous avez accorde.\n\nCordialement,\n{commercial}', 'post_rdv'],
        ['tpl-5', 'Catalogue', 'Notre catalogue de bieres', 'Bonjour {nom_contact},\n\nVeuillez trouver notre catalogue.\n\nCordialement,\n{commercial}', 'catalogue'],
        ['tpl-6', 'Nouveaute', 'Nouvelle biere en production !', 'Bonjour {nom_contact},\n\nNous sommes ravis de vous annoncer une nouveaute.\n\nCordialement,\n{commercial}', 'nouveaute'],
      ];
      for (const t of tpls) {
        await client.query('INSERT INTO email_templates (id, nom, sujet, corps, type) VALUES ($1,$2,$3,$4,$5)', t);
      }

      console.log('Database seeded successfully.');
    }
  } finally {
    client.release();
  }
}

// Run initialization
const dbReady = initDatabase().catch(err => {
  console.error('Database initialization error:', err);
  process.exit(1);
});

export { pool, dbReady };
export default pool;
