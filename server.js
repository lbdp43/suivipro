import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import cron from 'node-cron';
import { dbReady } from './server/db.js';
import apiRoutes, { runZoneSync, syncNocturneEasybeer } from './server/routes.js';
import googleCalendarRoutes from './server/google-calendar.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, 'dist');
const PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();

// Trust Railway's reverse proxy (fixes X-Forwarded-For / rate-limit)
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      imgSrc: ["'self'", "data:", "https://*.tile.openstreetmap.org", "https://unpkg.com"],
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
}));

// Rate limiting global
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requetes, reessayez dans une minute' },
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
app.use(express.json({ limit: '10mb' }));

// API routes
app.use('/api', apiRoutes);
app.use('/api', googleCalendarRoutes);

// Serve static files from dist (production)
if (existsSync(DIST)) {
  app.use(express.static(DIST, {
    maxAge: '1y',
    immutable: true,
    index: false, // Don't auto-serve index.html for /
  }));

  // SPA fallback: all non-API routes serve index.html
  app.get('{*path}', (req, res) => {
    res.sendFile(join(DIST, 'index.html'));
  });
}

// Global error handler — catches unhandled errors from all routes
app.use((err, req, res, _next) => {
  console.error('Unhandled route error:', err.stack || err.message);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: 'Erreur interne du serveur' });
});

// Wait for database to be ready before starting server
dbReady.then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SuiviPro API + Frontend running on port ${PORT}`);
  });

  // CRON: Synchro nocturne Easybeer (filet de sécurité) — tous les jours 02:30 UTC
  cron.schedule('30 2 * * *', async () => {
    console.log('[CRON] Synchro nocturne Easybeer...');
    try { await syncNocturneEasybeer(); } catch (e) { console.error('[CRON] Sync nocturne échec:', e.message); }
  });

  // CRON: Sync zone INSEE every Monday at 6:00 UTC
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
