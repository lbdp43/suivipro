// ============================================
// Serveur HTTP du portail EasyBeer -> Pennylane (zero dependance)
// ============================================

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveConfig, maskedConfig } from './config.js';
import * as store from './store.js';
import * as sync from './sync.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');
const PORT = parseInt(process.env.PORT || '4000', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

async function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  // anti path-traversal
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC, safe);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  try {
    // ---------- API ----------
    if (path.startsWith('/api/')) {
      // Config
      if (path === '/api/config' && method === 'GET') {
        return json(res, 200, maskedConfig());
      }
      if (path === '/api/config' && method === 'POST') {
        const body = await readBody(req);
        // on n'ecrase pas un secret par sa version masquee
        const patch = sanitizeConfigPatch(body);
        store.setConfig(patch);
        return json(res, 200, maskedConfig());
      }
      if (path === '/api/test-connections' && method === 'POST') {
        return json(res, 200, await sync.testConnections());
      }

      // Synchronisations
      if (path === '/api/sync/clients' && method === 'POST') {
        return json(res, 200, await sync.syncClients());
      }
      if (path === '/api/sync/invoices' && method === 'POST') {
        const body = await readBody(req);
        return json(res, 200, await sync.syncInvoices({ since: body.since }));
      }
      if (path === '/api/sync/payments' && method === 'POST') {
        const body = await readBody(req);
        return json(res, 200, await sync.syncPayments({ since: body.since }));
      }
      if (path === '/api/sync/all' && method === 'POST') {
        const body = await readBody(req);
        return json(res, 200, await sync.syncAll({ since: body.since }));
      }

      // Reconciliation
      if (path === '/api/reconciliation' && method === 'GET') {
        const since = url.searchParams.get('since') || undefined;
        return json(res, 200, await sync.reconcile({ since }));
      }

      // Etat (mappings + logs)
      if (path === '/api/state' && method === 'GET') {
        return json(res, 200, {
          customers: store.allCustomerMappings(),
          invoices: store.allInvoiceMappings(),
          logs: store.getLogs(150),
        });
      }
      if (path === '/api/logs' && method === 'GET') {
        return json(res, 200, store.getLogs(parseInt(url.searchParams.get('limit') || '100', 10)));
      }

      // Webhook EasyBeer : POST /api/webhook/easybeer/<secret>
      const wh = path.match(/^\/api\/webhook\/easybeer\/(.+)$/);
      if (wh && method === 'POST') {
        const cfg = resolveConfig();
        const secret = decodeURIComponent(wh[1]);
        if (!cfg.webhookSecret || secret !== cfg.webhookSecret) {
          store.log('error', 'Webhook EasyBeer: secret invalide');
          return json(res, 401, { error: 'secret invalide' });
        }
        const body = await readBody(req);
        store.log('info', `Webhook EasyBeer recu: ${JSON.stringify(Object.keys(body))}`);
        // declenche une synchro ciblee si un id de facture est present
        const id = body.id || body.idFacture || body.objectId || (body.data && body.data.id);
        handleWebhook(id).catch(e => store.log('error', `Webhook traitement: ${e.message}`));
        return json(res, 200, { ok: true });
      }

      return json(res, 404, { error: 'route inconnue' });
    }

    // ---------- Fichiers statiques ----------
    if (method === 'GET') return serveStatic(req, res, path);
    res.writeHead(405); res.end('Method not allowed');
  } catch (e) {
    store.log('error', `Erreur serveur ${path}: ${e.message}`);
    json(res, 500, { error: e.message });
  }
});

// Traite un webhook : on relance une sync factures+paiements (simple et robuste)
async function handleWebhook(id) {
  store.log('info', `Webhook: synchronisation declenchee${id ? ` (facture ${id})` : ''}`);
  await sync.syncInvoices({});
  await sync.syncPayments({});
}

// N'ecrit pas un secret masque (••••) par-dessus le vrai secret
function sanitizeConfigPatch(body) {
  const isMask = (v) => typeof v === 'string' && /^•+$/.test(v);
  const patch = {};
  if (body.easybeer) {
    patch.easybeer = {};
    if (body.easybeer.apiUrl !== undefined) patch.easybeer.apiUrl = body.easybeer.apiUrl;
    if (body.easybeer.username !== undefined) patch.easybeer.username = body.easybeer.username;
    if (body.easybeer.password && !isMask(body.easybeer.password)) patch.easybeer.password = body.easybeer.password;
  }
  if (body.pennylane) {
    patch.pennylane = {};
    if (body.pennylane.apiUrl !== undefined) patch.pennylane.apiUrl = body.pennylane.apiUrl;
    if (body.pennylane.token && !isMask(body.pennylane.token)) patch.pennylane.token = body.pennylane.token;
  }
  if (body.options) patch.options = body.options;
  if (body.webhookSecret !== undefined && !isMask(body.webhookSecret)) patch.webhookSecret = body.webhookSecret;
  return patch;
}

server.listen(PORT, () => {
  console.log(`\n  Portail EasyBeer -> Pennylane`);
  console.log(`  http://localhost:${PORT}\n`);
  store.log('info', `Serveur demarre sur le port ${PORT}`);

  // Poller optionnel
  const cfg = resolveConfig();
  const min = cfg.options.syncIntervalMin;
  if (min > 0) {
    console.log(`  Synchro automatique toutes les ${min} min`);
    setInterval(() => {
      sync.syncAll({}).catch(e => store.log('error', `Sync auto: ${e.message}`));
    }, min * 60 * 1000);
  }
});
