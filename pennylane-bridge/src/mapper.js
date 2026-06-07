// ============================================
// Mapping EasyBeer -> Pennylane
// ============================================
// Point UNIQUE a ajuster si la structure attendue par ton compte Pennylane
// differe (ex: format du taux de TVA, structure de l'adresse). Tout est ici.

// Reference externe stable, utilisee pour eviter les doublons et reconcilier
export function customerRef(ebClientId) {
  return `easybeer:client:${ebClientId}`;
}
export function invoiceRef(ebInvoiceId) {
  return `easybeer:facture:${ebInvoiceId}`;
}

// Client EasyBeer -> payload customer Pennylane
export function toPennylaneCustomer(ebClient, opts = {}) {
  const country = (ebClient.country || opts.country || 'FR').toUpperCase().slice(0, 2);
  const isCompany = !!(ebClient.name || ebClient.siret);
  const payload = {
    customer_type: isCompany ? 'company' : 'individual',
    name: ebClient.name || 'Client sans nom',
    external_reference: customerRef(ebClient.id),
    emails: ebClient.email ? [ebClient.email] : [],
    address: ebClient.address || '',
    postal_code: ebClient.postalCode || '',
    city: ebClient.city || '',
    country_alpha2: country,
  };
  if (ebClient.siret) payload.reg_no = ebClient.siret;
  if (ebClient.vatNumber) payload.vat_number = ebClient.vatNumber;
  if (ebClient.phone) payload.phone = ebClient.phone;
  return payload;
}

// Convertit un taux numerique (ex 20, 5.5) en valeur attendue par Pennylane.
// Pennylane v2 accepte une chaine de pourcentage ("20.0"). On normalise.
function vatRate(taux) {
  const n = parseFloat(taux);
  if (!Number.isFinite(n) || n <= 0) return '0.0';
  return n.toFixed(1);
}

// Facture EasyBeer -> payload customer_invoice Pennylane
export function toPennylaneInvoice(ebInvoice, pennylaneCustomerId, opts = {}) {
  const lines = (ebInvoice.lignes || []).map((l) => ({
    label: l.label || 'Article',
    quantity: l.quantity || 1,
    unit: 'piece',
    // prix unitaire HT en chaine (precision monetaire)
    raw_currency_unit_price: String(round2(l.unitPrice)),
    vat_rate: vatRate(l.vat),
  }));

  // Si aucune ligne exploitable, on cree une ligne unique a partir du total HT
  if (lines.length === 0 && ebInvoice.montantHt > 0) {
    lines.push({
      label: `Facture EasyBeer ${ebInvoice.numero}`,
      quantity: 1,
      unit: 'piece',
      raw_currency_unit_price: String(round2(ebInvoice.montantHt)),
      vat_rate: vatRate(deriveVat(ebInvoice)),
    });
  }

  const payload = {
    customer_id: pennylaneCustomerId,
    external_reference: invoiceRef(ebInvoice.id),
    date: normDate(ebInvoice.date),
    deadline: normDate(ebInvoice.deadline) || normDate(ebInvoice.date),
    currency: ebInvoice.currency || opts.currency || 'EUR',
    draft: !opts.finalize, // finalize=true => facture finalisee
    invoice_lines: lines,
  };
  // Numero d'origine conserve en note pour la tracabilite (Pennylane numerote lui-meme)
  payload.label = `EasyBeer ${ebInvoice.numero}`;
  return payload;
}

// Paiement EasyBeer -> payload paiement Pennylane
export function toPennylanePayment(ebInvoice) {
  return {
    amount: String(round2(ebInvoice.paidAmount || ebInvoice.montantTtc)),
    date: normDate(ebInvoice.paidDate) || normDate(ebInvoice.date) || today(),
    source: 'easybeer',
  };
}

// ---- utilitaires ----
function deriveVat(inv) {
  if (inv.montantHt > 0 && inv.montantTtc > inv.montantHt) {
    return ((inv.montantTtc / inv.montantHt - 1) * 100);
  }
  return 20;
}
function round2(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function normDate(d) {
  if (!d) return '';
  // accepte ISO, "YYYY-MM-DD", "DD/MM/YYYY"
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const m = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
