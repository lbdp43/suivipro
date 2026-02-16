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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
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
