// Front du portail EasyBeer -> Pennylane (vanilla JS)

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

async function api(path, method = 'GET', body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch('/api' + path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  setTimeout(() => { t.className = 'toast'; }, 3500);
}

// ---- Onglets ----
$$('.tabs button').forEach((b) => {
  b.onclick = () => {
    $$('.tabs button').forEach((x) => x.classList.remove('active'));
    $$('.tab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    $('#tab-' + b.dataset.tab).classList.add('active');
    if (b.dataset.tab === 'state') loadState();
    if (b.dataset.tab === 'config') loadConfig();
  };
});

// ---- Test connexions ----
$('#btn-test').onclick = async () => {
  $('#btn-test').disabled = true;
  try {
    const r = await api('/test-connections', 'POST');
    setDot('#dot-eb', r.easybeer && r.easybeer.ok);
    setDot('#dot-pl', r.pennylane && r.pennylane.ok);
    toast('Test terminé');
  } catch (e) { toast(e.message, true); }
  $('#btn-test').disabled = false;
};
function setDot(sel, ok) { $(sel).className = 'dot ' + (ok ? 'ok' : 'ko'); }

// ---- Actions de synchro ----
$$('[data-action]').forEach((btn) => {
  btn.onclick = async () => {
    const action = btn.dataset.action;
    const since = $('#since') ? $('#since').value : undefined;
    btn.disabled = true;
    try {
      let r;
      if (action === 'clients') r = await api('/sync/clients', 'POST');
      else if (action === 'invoices') r = await api('/sync/invoices', 'POST', { since });
      else if (action === 'payments') r = await api('/sync/payments', 'POST', { since });
      else if (action === 'all') r = await api('/sync/all', 'POST', { since });
      else if (action === 'reconcile') { r = await api('/reconciliation' + (since ? `?since=${since}` : '')); renderRecon(r); }
      if (action !== 'reconcile' && $('#action-result')) $('#action-result').textContent = JSON.stringify(r, null, 2);
      toast('Terminé ✓');
    } catch (e) { toast(e.message, true); if ($('#action-result')) $('#action-result').textContent = 'Erreur: ' + e.message; }
    btn.disabled = false;
  };
});

// ---- Réconciliation ----
function renderRecon(r) {
  const c = r.counts;
  $('#recon-summary').innerHTML = `
    <div class="stat"><b>${c.total}</b><span>factures</span></div>
    <div class="stat good"><b>${c.matched}</b><span>concordent</span></div>
    <div class="stat bad"><b>${c.missing}</b><span>absentes Pennylane</span></div>
    <div class="stat warn"><b>${c.amountMismatch}</b><span>écart montant</span></div>
    <div class="stat warn"><b>${c.paidNotInPennylane}</b><span>payées non reportées</span></div>
    <div class="stat bad"><b>${c.overdueUnpaid}</b><span>impayées en retard</span></div>`;
  const tb = $('#recon-table tbody');
  tb.innerHTML = r.items.map((it) => `
    <tr>
      <td>${esc(it.numero)}</td>
      <td>${esc(it.client || '')}</td>
      <td>${fmt(it.montantTtc)}</td>
      <td>${it.paidEasyBeer ? '✓' : ''}</td>
      <td>${it.flags.length ? it.flags.map((f) => `<span class="flag ${f}">${label(f)}</span>`).join('') : '<span class="flag ok">OK</span>'}</td>
    </tr>`).join('');
}
function label(f) {
  return {
    missing_in_pennylane: 'absente PL',
    amount_mismatch: 'écart montant',
    paid_in_easybeer_not_pennylane: 'paiement à reporter',
    overdue_unpaid: 'impayée en retard',
  }[f] || f;
}

// ---- État & logs ----
async function loadState() {
  try {
    const s = await api('/state');
    const inv = Object.entries(s.invoices || {});
    $('#state-invoices tbody').innerHTML = inv.map(([id, m]) => `
      <tr><td>${esc(id)}</td><td>${esc(m.numero || '')}</td><td>${fmt(m.montantTtc)}</td>
      <td>${esc(m.status || '')}</td><td>${m.paidPennylane ? '✓' : (m.paid ? 'EB' : '')}</td>
      <td>${esc(m.pennylaneId || '')}</td></tr>`).join('') || '<tr><td colspan="6">Aucune.</td></tr>';
    $('#logs').textContent = (s.logs || []).map((l) => `[${l.ts.slice(11, 19)}] ${l.level.toUpperCase()} ${l.message}`).join('\n');
  } catch (e) { toast(e.message, true); }
}

// ---- Configuration ----
async function loadConfig() {
  try {
    const c = await api('/config');
    const f = $('#config-form');
    f['eb-apiUrl'].value = c.easybeer.apiUrl || '';
    f['eb-username'].value = c.easybeer.username || '';
    f['eb-password'].placeholder = c.easybeer.password ? '•••••• (défini)' : 'non défini';
    f['pl-apiUrl'].value = c.pennylane.apiUrl || '';
    f['pl-token'].placeholder = c.pennylane.token ? '•••••• (défini)' : 'non défini';
    f['opt-finalize'].checked = !!c.options.finalize;
    f['opt-country'].value = c.options.country || 'FR';
    f['opt-currency'].value = c.options.currency || 'EUR';
    f['opt-interval'].value = c.options.syncIntervalMin || 0;
    f['webhookSecret'].placeholder = c.webhookSecret ? '•••••• (défini)' : 'non défini';
  } catch (e) { toast(e.message, true); }
}

$('#config-form').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const patch = {
    easybeer: { apiUrl: f['eb-apiUrl'].value, username: f['eb-username'].value },
    pennylane: { apiUrl: f['pl-apiUrl'].value },
    options: {
      finalize: f['opt-finalize'].checked,
      country: f['opt-country'].value,
      currency: f['opt-currency'].value,
      syncIntervalMin: parseInt(f['opt-interval'].value, 10) || 0,
    },
  };
  if (f['eb-password'].value) patch.easybeer.password = f['eb-password'].value;
  if (f['pl-token'].value) patch.pennylane.token = f['pl-token'].value;
  if (f['webhookSecret'].value) patch.webhookSecret = f['webhookSecret'].value;
  try {
    await api('/config', 'POST', patch);
    $('#config-saved').textContent = 'Enregistré ✓';
    f['eb-password'].value = ''; f['pl-token'].value = ''; f['webhookSecret'].value = '';
    setTimeout(() => { $('#config-saved').textContent = ''; }, 2500);
    loadConfig();
  } catch (err) { toast(err.message, true); }
};

// ---- utils ----
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fmt(n) { const v = parseFloat(n); return Number.isFinite(v) ? v.toFixed(2) + ' €' : ''; }

// init
loadConfig();
