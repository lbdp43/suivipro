import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import compression from 'compression';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import cron from 'node-cron';
import { dbReady } from './server/db.js';
import apiRoutes, { runZoneSync, syncNocturneEasybeer, purgerJournaux } from './server/routes.js';
import { rattacherTout } from './server/lib/zones.js';
import googleCalendarRoutes from './server/google-calendar.js';
import mcpRoutes from './server/mcp/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, 'dist');
const PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();

// Trust Railway's reverse proxy (fixes X-Forwarded-For / rate-limit)
app.set('trust proxy', 1);

// Le MCP (accès Claude) avant tout le reste : ce n'est pas un navigateur de l'application,
// il lui faut sa propre origine autorisée et son propre quota. Lecture seule.
app.use('/mcp', mcpRoutes);

// Un client MCP qui n'a pas trouvé de service de connexion va sonder ces adresses. Sans
// réponse nette, il reçoit la page de l'application (200, du HTML), en conclut qu'un OAuth
// existe, tente une inscription impossible et affiche « problème de connexion ».
app.use((req, res, next) => {
  if (!req.path.startsWith('/.well-known/oauth-')) return next();
  return res.status(404).json({ error: 'SuiviPro n\'utilise pas OAuth : l\'accès au MCP se fait par un jeton d\'en-tête.' });
});

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.tile.openstreetmap.org", "https://unpkg.com"],
      connectSrc: ["'self'", "https://api-adresse.data.gouv.fr", "https://recherche-entreprises.api.gouv.fr", "https://api.insee.fr"],
      fontSrc: ["'self'"],
      frameSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS restrictif
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
  exposedHeaders: ['X-Non-Lues', 'X-Version'],
}));

// Rate limiting global — PAR UTILISATEUR, sur l'API seulement.
// Toute l'équipe au bureau sort par la même adresse IP : un quota par IP se partageait
// entre tous, et les fichiers statiques (écrans, polices) le consommaient aussi.
// Un utilisateur identifié a son propre compteur ; un anonyme garde le compteur par IP.
function cleQuota(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const decode = jwt.decode(auth.slice(7));
    if (decode && decode.id) return `u:${decode.id}`;
  }
  return ipKeyGenerator(req.ip);
}
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  keyGenerator: cleQuota,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
}));

// Rate limiting strict sur le login
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion, reessayez dans 15 minutes' },
}));

// Rate limiting sur les webhooks et imports
app.use('/api/webhook', rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de webhooks, reessayez dans une minute' },
}));
app.use('/api/prospects/import', rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop d\'imports, reessayez dans une minute' },
}));

// Body parser — 10mb pour les uploads de documents
// /state pèse plusieurs Mo en JSON : compressé, il en fait dix fois moins sur la 4G.
app.use(compression());
app.use(express.json({ limit: '10mb' }));

// Version de l'application déployée : l'écran la lit sur chaque réponse et se recharge de
// lui-même à la prochaine navigation quand elle change (les fichiers des pages changent
// de nom à chaque déploiement).
const VERSION_APPLI = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.APP_VERSION || String(Date.now());
app.use('/api', (_req, res, next) => { res.setHeader('X-Version', VERSION_APPLI); next(); });

// API routes
app.use('/api', apiRoutes);
app.use('/api', googleCalendarRoutes);

// Serve static files from dist (production)
if (existsSync(DIST)) {
  app.use(express.static(DIST, {
    maxAge: '1y',
    immutable: true,
    index: false, // Don't auto-serve index.html for /
    // Le service worker et le manifeste changent sans changer de nom : jamais mis en cache un an.
    setHeaders: (res, chemin) => {
      if (/\/(sw\.js|manifest\.webmanifest)$/.test(chemin)) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  // Partage de fichiers depuis Android : le service worker intercepte ce POST et redirige vers
  // l'écran de partage. S'il n'est pas encore actif (toute première ouverture), on y renvoie
  // quand même, sans les photos, avec un mot d'explication.
  app.post('/partage', (_req, res) => res.redirect(303, '/partage?sans_fichiers=1'));

  // SPA fallback: all non-API routes serve index.html
  app.get('{*path}', (req, res) => {
    res.sendFile(join(DIST, 'index.html'));
  });
}

// Global error handler — catches unhandled errors from all routes
app.use((err, req, res, _next) => {
  console.error('Unhandled route error:', err.stack || err.message);
  if (res.headersSent) return;
  // Le message (sans la pile) est renvoye : « z.toLowerCase is not a function » dit ou
  // chercher, « Erreur interne du serveur » ne dit rien. Outil interne, utilisateurs
  // authentifies : le gain de diagnostic vaut largement l'exposition d'un message.
  const detail = err && err.message ? String(err.message).slice(0, 300) : '';
  res.status(err.status || 500).json({ error: detail ? `Erreur interne du serveur : ${detail}` : 'Erreur interne du serveur' });
});

// Wait for database to be ready before starting server
dbReady.then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SuiviPro API + Frontend running on port ${PORT}`);
  });

  // Rattache les fiches géolocalisées aux zones dessinées (une fois, après les migrations).
  rattacherTout().then(b => console.log(`[ZONES] ${b.zones} zone(s), ${b.prospects_modifies} prospect(s) et ${b.clients_modifies} client(s) mis à jour`))
    .catch(e => console.error('[ZONES] Rattachement échec:', e.message));

  // CRON: Synchro nocturne Easybeer (filet de sécurité) — tous les jours 02:30 UTC
  cron.schedule('30 2 * * *', async () => {
    console.log('[CRON] Synchro nocturne Easybeer...');
    try { await syncNocturneEasybeer(); } catch (e) { console.error('[CRON] Sync nocturne échec:', e.message); }
  });

  // CRON: Sync zone INSEE every Monday at 6:00 UTC
  // Purge des journaux tous les jours à 3 h 10 (notifications lues > 90 j, activité > 180 j,
  // 200 derniers journaux de synchronisation).
  cron.schedule('10 3 * * *', async () => {
    try { await purgerJournaux(); } catch (e) { console.error('[CRON] Purge échec:', e.message); }
  }, { timezone: 'Europe/Paris' });

  cron.schedule('0 6 * * 1', async () => {
    console.log('[CRON] Lancement sync zone hebdomadaire (lundi 6h UTC)...');
    try {
      await runZoneSync();
    } catch (err) {
      console.error('[CRON] Erreur sync zone:', err.message);
    }
  }, { timezone: 'Europe/Paris' });

  console.log('CRON schedule: sync zone INSEE every Monday at 6:00 (Europe/Paris)');
});
