// ============================================
// Client API Pennylane v2 (destination)
// ============================================
// Base : https://app.pennylane.com/api/external/v2
// Auth : Bearer <COMPANY_API_TOKEN>
// Les listes renvoient { items: [...], has_more, next_cursor }.
//
// NOTE : certains noms de champs (vat_rate, structure adresse client,
// endpoint de paiement) peuvent devoir etre ajustes selon ton compte.
// Tout le mapping reel est centralise dans mapper.js.

const TIMEOUT = 20000;

export class PennylaneClient {
  constructor({ apiUrl, token }) {
    this.base = (apiUrl || 'https://app.pennylane.com/api/external/v2').replace(/\/$/, '');
    this.headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async _request(method, path, body) {
    const opts = { method, headers: this.headers, signal: AbortSignal.timeout(TIMEOUT) };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const resp = await fetch(`${this.base}${path}`, opts);
    const text = await resp.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* reponse non-JSON */ }
    if (!resp.ok) {
      const err = new Error(`Pennylane ${method} ${path} -> HTTP ${resp.status}: ${text.slice(0, 300)}`);
      err.status = resp.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  // Test de connexion
  async ping() {
    try {
      await this._request('GET', '/customer_invoices?limit=1');
      return { ok: true };
    } catch (e) {
      return { ok: false, status: e.status, message: e.message };
    }
  }

  // ---- Clients ----
  async listCustomers({ cursor } = {}) {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this._request('GET', `/customers${q}`);
  }

  // Recherche par reference externe (on stocke easybeer:<id> a la creation)
  async findCustomerByExternalRef(ref) {
    // Filtre v2 : ?filter=[{"field":"external_reference","operator":"eq","value":"..."}]
    const filter = encodeURIComponent(JSON.stringify([
      { field: 'external_reference', operator: 'eq', value: ref },
    ]));
    try {
      const res = await this._request('GET', `/customers?filter=${filter}&limit=1`);
      const items = (res && (res.items || res.customers)) || [];
      return items[0] || null;
    } catch {
      return null; // si le filtre n'est pas supporte, on retombe sur le store
    }
  }

  async createCustomer(payload) {
    return this._request('POST', '/customers', payload);
  }

  // ---- Factures clients ----
  async listInvoices({ cursor } = {}) {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this._request('GET', `/customer_invoices${q}`);
  }

  async getInvoice(id) {
    return this._request('GET', `/customer_invoices/${id}`);
  }

  async findInvoiceByExternalRef(ref) {
    const filter = encodeURIComponent(JSON.stringify([
      { field: 'external_reference', operator: 'eq', value: ref },
    ]));
    try {
      const res = await this._request('GET', `/customer_invoices?filter=${filter}&limit=1`);
      const items = (res && (res.items || res.customer_invoices)) || [];
      return items[0] || null;
    } catch {
      return null;
    }
  }

  async createInvoice(payload) {
    return this._request('POST', '/customer_invoices', payload);
  }

  // ---- Paiements ----
  // L'enregistrement d'un paiement varie selon les comptes ; on tente
  // l'endpoint imbrique puis on bascule sur "mark as paid" si besoin.
  async registerPayment(invoiceId, payload) {
    return this._request('POST', `/customer_invoices/${invoiceId}/payments`, payload);
  }

  async markInvoiceAsPaid(invoiceId, payload) {
    return this._request('PUT', `/customer_invoices/${invoiceId}/mark_as_paid`, payload);
  }
}
