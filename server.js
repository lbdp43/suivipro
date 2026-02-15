import express from 'express';
import cors from 'cors';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import apiRoutes from './server/routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, 'dist');
const PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API routes
app.use('/api', apiRoutes);

// Serve static files from dist (production)
if (existsSync(DIST)) {
  app.use(express.static(DIST, {
    maxAge: '1y',
    immutable: true,
    index: false, // Don't auto-serve index.html for /
  }));

  // SPA fallback: all non-API routes serve index.html
  app.get('*', (req, res) => {
    res.sendFile(join(DIST, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SuiviPro API + Frontend running on port ${PORT}`);
});
