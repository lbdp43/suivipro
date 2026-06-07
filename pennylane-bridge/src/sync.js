// ============================================
// Orchestration de la synchronisation EasyBeer -> Pennylane
// ============================================

import { resolveConfig } from './config.js';
import { EasyBeerClient, extractClient, extractInvoice } from './easybeer.js';
import { PennylaneClient } from './pennylane.js';
import {
  toPennylaneCustomer, toPennylaneInvoice, toPennylanePayment, customerRef,
} from './mapper.js';
import * as store from './store.js';

function clients() {
  const cfg = resolveConfig();
  if (!cfg.easybeer.username) throw new Error('EasyBeer non configure (identifiants manquants)');
  if (!cfg.pennylane.token) throw new Error('Pennylane non configure (token manquant)');
  return {
    cfg,
    eb: new EasyBeerClient(cfg.easybeer),
    pl: new PennylaneClient(cfg.pennylane),
  };
}

// Teste les deux connexions
export async function testConnections() {
  const cfg = resolveConfig();
  const result = { easybeer: null, pennylane: null };
  try {
    result.easybeer = await new EasyBeerClient(cfg.easybeer).ping();
  } catch (e) { result.easybeer = { ok: false, message: e.message }; }
  try {
    result.pennylane = await new PennylaneClient(cfg.pennylane).ping();
  } catch (e) { result.pennylane = { ok: false, message: e.message }; }
  return result;
}

// Garantit qu'un client EasyBeer existe dans Pennylane ; renvoie l'id Pennylane
export async function ensureCustomer(eb, pl, cfg, ebClient) {
  if (!ebClient || !ebClient.id) return null;
  const existing = store.getCustomerMapping(ebClient.id);
  if (existing && existing.pennylaneId) return existing.pennylaneId;

  // anti-doublon : chercher cote Pennylane par reference externe
  const found = await pl.findCustomerByExternalRef(customerRef(ebClient.id));
  if (found && found.id) {
    store.setCustomerMapping(ebClient.id, { pennylaneId: found.id, name: ebClient.name, syncedAt: now() });
    return found.id;
  }

  const created = await pl.createCustomer(toPennylaneCustomer(ebClient, cfg.options));
  const pennylaneId = created && (created.id || (created.customer && created.customer.id));
  store.setCustomerMapping(ebClient.id, { pennylaneId, name: ebClient.name, syncedAt: now() });
  store.log('info', `Client cree dans Pennylane: ${ebClient.name} (EB ${ebClient.id} -> PL ${pennylaneId})`);
  return pennylaneId;
}

// 1) Synchro des clients
export async function syncClients() {
  const { eb, pl, cfg } = clients();
  const raw = await eb.listClients();
  const list = raw.map(extractClient).filter(Boolean);
  let created = 0, skipped = 0, errors = 0;
  for (const c of list) {
    try {
      const before = store.getCustomerMapping(c.id);
      await ensureCustomer(eb, pl, cfg, c);
      if (before && before.pennylaneId) skipped++; else created++;
    } catch (e) {
      errors++;
      store.log('error', `Echec sync client ${c.name} (${c.id}): ${e.message}`);
    }
  }
  const summary = { total: list.length, created, skipped, errors };
  store.log('info', `Sync clients terminee: ${JSON.stringify(summary)}`);
  return summary;
}

// 2) Synchro des factures (cree dans Pennylane si pas deja synchro)
export async function syncInvoices({ since } = {}) {
  const { eb, pl, cfg } = clients();
  const raw = await eb.listInvoices({ since });
  const list = raw.map(extractInvoice).filter(Boolean);
  let created = 0, skipped = 0, errors = 0;
  for (const summary of list) {
    try {
      const mapping = store.getInvoiceMapping(summary.id);
      if (mapping && mapping.pennylaneId) { skipped++; continue; }

      // recuperer le detail complet (lignes, client) si la liste est partielle
      let inv = summary;
      if (!inv.lignes || inv.lignes.length === 0) {
        const detail = await eb.getInvoice(summary.id).catch(() => null);
        if (detail) inv = extractInvoice(detail) || summary;
      }

      // garantir le client
      let ebClient = inv.clientId
        ? extractClient(await eb.getClient(inv.clientId).catch(() => null))
        : null;
      if (!ebClient && inv.clientId) ebClient = { id: inv.clientId, name: inv.clientName };
      if (!ebClient) {
        store.log('error', `Facture ${inv.numero}: client introuvable, ignoree`);
        errors++; continue;
      }
      const pennylaneCustomerId = await ensureCustomer(eb, pl, cfg, ebClient);

      // anti-doublon cote Pennylane
      const existing = await pl.findInvoiceByExternalRef(`easybeer:facture:${inv.id}`);
      if (existing && existing.id) {
        store.setInvoiceMapping(inv.id, {
          pennylaneId: existing.id, numero: inv.numero, montantTtc: inv.montantTtc,
          status: 'existing', paid: inv.paid, syncedAt: now(),
        });
        skipped++; continue;
      }

      const payload = toPennylaneInvoice(inv, pennylaneCustomerId, cfg.options);
      const res = await pl.createInvoice(payload);
      const pennylaneId = res && (res.id || (res.invoice && res.invoice.id) || (res.customer_invoice && res.customer_invoice.id));
      store.setInvoiceMapping(inv.id, {
        pennylaneId, numero: inv.numero, montantTtc: inv.montantTtc,
        status: cfg.options.finalize ? 'finalized' : 'draft',
        paid: inv.paid, paidPennylane: false, syncedAt: now(),
      });
      store.log('info', `Facture creee dans Pennylane: ${inv.numero} (${inv.montantTtc}€ TTC) -> PL ${pennylaneId}`);
      created++;
    } catch (e) {
      errors++;
      store.log('error', `Echec sync facture ${summary.numero} (${summary.id}): ${e.message}`);
    }
  }
  const result = { total: list.length, created, skipped, errors };
  store.log('info', `Sync factures terminee: ${JSON.stringify(result)}`);
  return result;
}

// 3) Synchro des paiements (factures reglees dans EasyBeer -> paiement Pennylane)
export async function syncPayments({ since } = {}) {
  const { eb, pl } = clients();
  const raw = await eb.listInvoices({ since });
  const list = raw.map(extractInvoice).filter(Boolean);
  let registered = 0, skipped = 0, errors = 0;
  for (const summary of list) {
    try {
      // detail pour connaitre l'etat de reglement reel
      const detail = await eb.getInvoice(summary.id).catch(() => null);
      const inv = (detail && extractInvoice(detail)) || summary;
      if (!inv.paid) { skipped++; continue; }

      const mapping = store.getInvoiceMapping(inv.id);
      if (!mapping || !mapping.pennylaneId) {
        store.log('error', `Paiement facture ${inv.numero}: non encore synchronisee dans Pennylane, ignoree`);
        skipped++; continue;
      }
      if (mapping.paidPennylane) { skipped++; continue; }

      const payment = toPennylanePayment(inv);
      try {
        await pl.registerPayment(mapping.pennylaneId, payment);
      } catch (e1) {
        // fallback : marquer comme payee
        await pl.markInvoiceAsPaid(mapping.pennylaneId, payment);
      }
      store.setInvoiceMapping(inv.id, { paid: true, paidPennylane: true, paidAt: now() });
      store.log('info', `Paiement enregistre dans Pennylane: facture ${inv.numero} (${payment.amount}€)`);
      registered++;
    } catch (e) {
      errors++;
      store.log('error', `Echec sync paiement ${summary.numero} (${summary.id}): ${e.message}`);
    }
  }
  const result = { total: list.length, registered, skipped, errors };
  store.log('info', `Sync paiements terminee: ${JSON.stringify(result)}`);
  return result;
}

// 4) Reconciliation : compare EasyBeer et Pennylane et liste les ecarts
export async function reconcile({ since } = {}) {
  const { eb, pl } = clients();
  const raw = await eb.listInvoices({ since });
  const ebList = raw.map(extractInvoice).filter(Boolean);

  const report = {
    generatedAt: now(),
    counts: { total: ebList.length, matched: 0, missing: 0, amountMismatch: 0, paidNotInPennylane: 0, overdueUnpaid: 0 },
    items: [],
  };
  const todayStr = new Date().toISOString().slice(0, 10);

  for (const inv of ebList) {
    const mapping = store.getInvoiceMapping(inv.id);
    const entry = {
      ebId: inv.id, numero: inv.numero, client: inv.clientName,
      montantTtc: inv.montantTtc, paidEasyBeer: inv.paid,
      deadline: inv.deadline, flags: [],
      pennylaneId: mapping ? mapping.pennylaneId : null,
    };

    if (!mapping || !mapping.pennylaneId) {
      entry.flags.push('missing_in_pennylane');
      report.counts.missing++;
    } else {
      // recuperer la facture Pennylane pour comparer montant et reglement
      let plInv = null;
      try { plInv = await pl.getInvoice(mapping.pennylaneId); } catch { /* */ }
      const plObj = plInv && (plInv.customer_invoice || plInv.invoice || plInv);
      const plTotal = plObj ? num(plObj.currency_amount || plObj.amount || plObj.total_amount) : null;
      const plPaid = plObj ? isPlPaid(plObj) : false;
      entry.pennylaneTotal = plTotal;
      entry.paidPennylane = plPaid;

      if (plTotal != null && Math.abs(plTotal - inv.montantTtc) > 0.02) {
        entry.flags.push('amount_mismatch');
        report.counts.amountMismatch++;
      } else {
        report.counts.matched++;
      }
      if (inv.paid && !plPaid) {
        entry.flags.push('paid_in_easybeer_not_pennylane');
        report.counts.paidNotInPennylane++;
      }
    }

    if (!inv.paid && inv.deadline && normDateStr(inv.deadline) < todayStr) {
      entry.flags.push('overdue_unpaid');
      report.counts.overdueUnpaid++;
    }

    report.items.push(entry);
  }
  store.log('info', `Reconciliation: ${JSON.stringify(report.counts)}`);
  return report;
}

// Synchro complete (clients -> factures -> paiements)
export async function syncAll({ since } = {}) {
  const c = await syncClients();
  const i = await syncInvoices({ since });
  const p = await syncPayments({ since });
  return { clients: c, invoices: i, payments: p };
}

// ---- utils ----
function now() { return new Date().toISOString(); }
function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
function isPlPaid(o) {
  const s = String(o.status || o.payment_status || o.reconciliation_status || '').toLowerCase();
  if (/paid|reconcil|matched|lettr/.test(s)) return true;
  if (o.paid === true) return true;
  const remaining = o.remaining_amount != null ? num(o.remaining_amount) : null;
  return remaining != null && remaining <= 0.01;
}
function normDateStr(d) {
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const m = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const p = new Date(d); return Number.isNaN(p.getTime()) ? '' : p.toISOString().slice(0, 10);
}
