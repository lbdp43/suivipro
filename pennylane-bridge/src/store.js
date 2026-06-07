// ============================================
// Stockage persistant (fichier JSON, zero dependance)
// ============================================
// Conserve : la configuration, les correspondances clients/factures
// (EasyBeer <-> Pennylane), et un journal d'evenements.
// Volume attendu (une brasserie) largement compatible avec un store JSON.

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const FILE = join(DATA_DIR, 'state.json');

const EMPTY = {
  config: {
    easybeer: { apiUrl: '', username: '', password: '' },
    pennylane: { apiUrl: 'https://app.pennylane.com/api/external/v2', token: '' },
    options: { finalize: false, country: 'FR', currency: 'EUR', syncIntervalMin: 0 },
    webhookSecret: '',
  },
  // ebClientId -> { pennylaneId, name, syncedAt }
  customers: {},
  // ebInvoiceId -> { pennylaneId, numero, montantTtc, status, paid, paidPennylane, syncedAt }
  invoices: {},
  // journal circulaire
  logs: [],
};

let state = null;

function deepMerge(base, override) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(override || {})) {
    if (override[k] && typeof override[k] === 'object' && !Array.isArray(override[k])) {
      out[k] = deepMerge(base[k] || {}, override[k]);
    } else {
      out[k] = override[k];
    }
  }
  return out;
}

export function load() {
  if (state) return state;
  if (existsSync(FILE)) {
    try {
      const raw = JSON.parse(readFileSync(FILE, 'utf8'));
      state = deepMerge(EMPTY, raw);
    } catch (e) {
      console.error('[store] state.json illisible, repartir a vide:', e.message);
      state = structuredClone(EMPTY);
    }
  } else {
    state = structuredClone(EMPTY);
  }
  return state;
}

export function save() {
  if (!state) return;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  // ecriture atomique : tmp puis rename
  const tmp = FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmp, FILE);
}

export function getConfig() {
  return load().config;
}

export function setConfig(patch) {
  const s = load();
  s.config = deepMerge(s.config, patch);
  save();
  return s.config;
}

export function getCustomerMapping(ebClientId) {
  return load().customers[String(ebClientId)] || null;
}

export function setCustomerMapping(ebClientId, data) {
  const s = load();
  s.customers[String(ebClientId)] = { ...(s.customers[String(ebClientId)] || {}), ...data };
  save();
  return s.customers[String(ebClientId)];
}

export function getInvoiceMapping(ebInvoiceId) {
  return load().invoices[String(ebInvoiceId)] || null;
}

export function setInvoiceMapping(ebInvoiceId, data) {
  const s = load();
  s.invoices[String(ebInvoiceId)] = { ...(s.invoices[String(ebInvoiceId)] || {}), ...data };
  save();
  return s.invoices[String(ebInvoiceId)];
}

export function allInvoiceMappings() {
  return load().invoices;
}

export function allCustomerMappings() {
  return load().customers;
}

const MAX_LOGS = 500;

export function log(level, message, extra) {
  const s = load();
  const entry = { ts: new Date().toISOString(), level, message };
  if (extra !== undefined) entry.extra = extra;
  s.logs.unshift(entry);
  if (s.logs.length > MAX_LOGS) s.logs.length = MAX_LOGS;
  save();
  const tag = `[bridge:${level}]`;
  if (level === 'error') console.error(tag, message);
  else console.log(tag, message);
  return entry;
}

export function getLogs(limit = 100) {
  return load().logs.slice(0, limit);
}
