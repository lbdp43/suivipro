// ============================================
// Resolution de la configuration effective
// ============================================
// Priorite : variables d'environnement > config enregistree (state.json).
// Permet d'exploiter des secrets via l'env en production tout en gardant
// la possibilite de tout configurer via l'interface web.

import { getConfig as getStoredConfig } from './store.js';

function env(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== '' ? v : fallback;
}

export function resolveConfig() {
  const c = getStoredConfig();
  return {
    easybeer: {
      apiUrl: env('EASYBEER_API_URL', c.easybeer.apiUrl || 'https://api.easybeer.fr'),
      username: env('EASYBEER_USERNAME', c.easybeer.username),
      password: env('EASYBEER_PASSWORD', c.easybeer.password),
    },
    pennylane: {
      apiUrl: env('PENNYLANE_API_URL', c.pennylane.apiUrl || 'https://app.pennylane.com/api/external/v2'),
      token: env('PENNYLANE_TOKEN', c.pennylane.token),
    },
    options: {
      finalize: env('PENNYLANE_FINALIZE', String(c.options.finalize)) === 'true',
      country: env('DEFAULT_COUNTRY', c.options.country || 'FR'),
      currency: env('DEFAULT_CURRENCY', c.options.currency || 'EUR'),
      syncIntervalMin: parseInt(env('SYNC_INTERVAL_MIN', String(c.options.syncIntervalMin || 0)), 10) || 0,
    },
    webhookSecret: env('WEBHOOK_SECRET', c.webhookSecret),
  };
}

// Version masquee (pour renvoyer au front sans exposer les secrets)
export function maskedConfig() {
  const c = resolveConfig();
  const mask = (v) => (v ? '••••••••' : '');
  return {
    easybeer: { apiUrl: c.easybeer.apiUrl, username: c.easybeer.username, password: mask(c.easybeer.password) },
    pennylane: { apiUrl: c.pennylane.apiUrl, token: mask(c.pennylane.token) },
    options: c.options,
    webhookSecret: mask(c.webhookSecret),
    env: {
      easybeerFromEnv: !!process.env.EASYBEER_PASSWORD,
      pennylaneFromEnv: !!process.env.PENNYLANE_TOKEN,
    },
  };
}
