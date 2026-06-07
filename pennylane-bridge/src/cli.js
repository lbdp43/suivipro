// ============================================
// CLI : synchronisation sans interface web
// ============================================
// Usage :
//   node src/cli.js test          -> teste les connexions
//   node src/cli.js clients       -> synchro des clients
//   node src/cli.js invoices      -> synchro des factures
//   node src/cli.js payments      -> synchro des paiements
//   node src/cli.js all           -> tout
//   node src/cli.js reconcile     -> rapport de reconciliation

import * as sync from './sync.js';

const cmd = process.argv[2] || 'all';
const since = process.argv[3]; // optionnel : date ISO

const run = {
  test: () => sync.testConnections(),
  clients: () => sync.syncClients(),
  invoices: () => sync.syncInvoices({ since }),
  payments: () => sync.syncPayments({ since }),
  all: () => sync.syncAll({ since }),
  reconcile: () => sync.reconcile({ since }),
};

if (!run[cmd]) {
  console.error(`Commande inconnue: ${cmd}. Options: ${Object.keys(run).join(', ')}`);
  process.exit(1);
}

run[cmd]()
  .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
  .catch((e) => { console.error('Erreur:', e.message); process.exit(1); });
