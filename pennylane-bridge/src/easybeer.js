// ============================================
// Client API EasyBeer (source)
// ============================================
// EasyBeer s'authentifie en Basic auth (username:password).
// Les chemins et formats de reponse varient ; on tente plusieurs candidats
// et on extrait les champs de facon defensive (memes fallbacks que SuiviPro).

const TIMEOUT = 15000;

export class EasyBeerClient {
  constructor({ apiUrl, username, password }) {
    this.base = (apiUrl || 'https://api.easybeer.fr').replace(/\/$/, '');
    this.username = username;
    this.headers = {
      Authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
      Accept: 'application/json',
    };
  }

  async _get(path) {
    const resp = await fetch(`${this.base}${path}`, {
      headers: this.headers,
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!resp.ok) {
      const err = new Error(`EasyBeer ${path} -> HTTP ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    return resp.json();
  }

  // Tente plusieurs chemins, renvoie la premiere reponse exploitable
  async _getFirst(paths) {
    let lastErr = null;
    for (const path of paths) {
      try {
        const data = await this._get(path);
        if (data) return { data, path };
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;
    return { data: null, path: null };
  }

  // Test de connexion : on verifie juste que la base repond avec les identifiants
  async ping() {
    const resp = await fetch(this.base, {
      headers: this.headers,
      signal: AbortSignal.timeout(8000),
    });
    return { ok: resp.status < 500, status: resp.status };
  }

  async listClients() {
    const { data } = await this._getFirst([
      '/clients',
      '/ventes/clients',
      '/tiers/clients',
      '/parametres/clients',
    ]);
    return pickList(data);
  }

  async getClient(id) {
    const { data } = await this._getFirst([
      `/clients/${id}`,
      `/ventes/client/${id}`,
      `/tiers/client/${id}`,
    ]);
    return data;
  }

  // Liste des factures, eventuellement depuis une date (ISO) si l'API l'accepte
  async listInvoices({ since } = {}) {
    const q = since ? `?dateDebut=${encodeURIComponent(since)}` : '';
    const { data } = await this._getFirst([
      `/ventes/factures${q}`,
      `/factures${q}`,
      `/ventes/facture/liste${q}`,
      `/documents/factures${q}`,
    ]);
    return pickList(data);
  }

  async getInvoice(id) {
    const { data } = await this._getFirst([
      `/ventes/facture/detail/${id}`,
      `/ventes/facture/${id}`,
      `/factures/${id}`,
      `/documents/facture/${id}`,
    ]);
    return data;
  }
}

// ---- Extraction defensive (reprend les fallbacks de SuiviPro) ----

// Une reponse "liste" peut etre un tableau direct ou un objet enveloppe
export function pickList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  return data.liste || data.results || data.data || data.items
    || data.commandes || data.factures || data.clients || [];
}

export function extractClient(data) {
  if (!data) return null;
  let adresseObj = null;
  if (Array.isArray(data.adresses) && data.adresses.length) {
    adresseObj = data.adresses.find(a => a.type === 'Facturation' || a.type === 'facturation' || a.principale) || data.adresses[0];
  } else if (data.adresse && typeof data.adresse === 'object') {
    adresseObj = data.adresse;
  } else if (data.adresseFacturation && typeof data.adresseFacturation === 'object') {
    adresseObj = data.adresseFacturation;
  }
  let address = '', city = '', postalCode = '';
  if (adresseObj) {
    if (adresseObj.numero && adresseObj.rue) address = `${adresseObj.numero} ${adresseObj.rue}`.trim();
    else address = adresseObj.rue || adresseObj.ligne1 || adresseObj.adresse1 || adresseObj.adresse
      || adresseObj.complete || adresseObj.libelle || '';
    city = adresseObj.ville || adresseObj.commune || adresseObj.city || '';
    postalCode = adresseObj.codePostal || adresseObj.cp || adresseObj.code_postal || adresseObj.zipCode || '';
  }

  let contactObj = null;
  if (Array.isArray(data.contacts) && data.contacts.length) {
    contactObj = data.contacts.find(c => c.principal || c.type === 'Principal') || data.contacts[0];
  } else if (data.contactPrincipal && typeof data.contactPrincipal === 'object') {
    contactObj = data.contactPrincipal;
  }
  const email = data.emailPrincipal || data.email || (contactObj && (contactObj.email || contactObj.emailPrincipal)) || data.mail || '';

  return {
    id: String(data.id || data.idClient || data.idTiers || data.code || ''),
    name: data.nom || data.libelle || data.raisonSociale || data.name || '',
    email,
    phone: data.telephonePrincipal || data.telephone || (contactObj && contactObj.telephone) || '',
    address,
    city,
    postalCode,
    country: data.pays || data.country || 'FR',
    siret: data.siret || data.siren || '',
    vatNumber: data.tvaIntra || data.numeroTVA || data.vatNumber || data.tva_intracom || '',
    raw: data,
  };
}

export function extractInvoice(data) {
  if (!data) return null;
  const id = String(data.id || data.idFacture || data.idPiece || data.numPiece || data.numero || '');
  const numero = String(data.numero || data.reference || data.ref || data.numPiece || data.num_piece || id);
  const date = data.date || data.dateFacture || data.datePiece || data.dateCreation || data.date_facture || '';
  const deadline = data.dateEcheance || data.echeance || data.dateLimite || data.date_echeance || '';
  const montantHt = num(data.montantHT || data.totalHT || data.montant_ht || data.ht);
  const montantTtc = num(data.montantTTC || data.totalTTC || data.montant_ttc || data.ttc);

  // Client lie
  let clientObj = null;
  if (data.client && typeof data.client === 'object') clientObj = data.client;
  else if (data.tiers && typeof data.tiers === 'object') clientObj = data.tiers;
  else if (data.acheteur && typeof data.acheteur === 'object') clientObj = data.acheteur;
  const clientId = String(
    data.clientId || data.client_id || data.tiersId || data.idClient || data.id_client
    || (clientObj && (clientObj.id || clientObj.idClient || clientObj.idTiers)) || ''
  );
  const clientName = data.clientNom || data.nomClient || data.raisonSociale || data.nomTiers
    || (typeof data.client === 'string' ? data.client : '')
    || (clientObj && (clientObj.nom || clientObj.libelle || clientObj.raisonSociale)) || '';

  // Lignes
  const rawLignes = data.lignes || data.details || data.articles || data.items
    || data.lignesFacture || data.produits || data.lignesPiece
    || (Array.isArray(data.detail) ? data.detail : null) || [];
  const lignes = (Array.isArray(rawLignes) ? rawLignes : []).map(l => ({
    label: l.libelle || l.designation || l.nom || l.produit || l.article || l.description || l.nomArticle || '',
    quantity: num(l.quantite || l.qte || l.qty || l.nombre || l.quantiteCommandee) || 1,
    unitPrice: num(l.prixUnitaire || l.pu || l.prixUnitaireHT || l.prix || l.pv || l.prixVente),
    amount: num(l.montant || l.total || l.montantHT || l.totalLigne || l.montantLigne),
    vat: num(l.tauxTVA || l.tva || l.txTVA),
    reference: l.reference || l.ref || l.code || l.codeArticle || '',
  }));

  // Etat de reglement
  const paidAmount = num(data.montantRegle || data.montantPaye || data.regle || data.montant_regle);
  const solde = data.solde != null ? num(data.solde) : (montantTtc ? montantTtc - paidAmount : 0);
  const statutReg = String(data.statutReglement || data.etatReglement || data.statut || data.etat || '').toLowerCase();
  const paid = /pay|regl|solde|acquit|encaiss/.test(statutReg)
    || (montantTtc > 0 && paidAmount >= montantTtc - 0.01)
    || (montantTtc > 0 && solde <= 0.01 && paidAmount > 0);
  const paidDate = data.datePaiement || data.dateReglement || data.dateEncaissement || data.date_paiement || '';

  return {
    id, numero, date, deadline, montantHt, montantTtc,
    clientId, clientName, lignes,
    paid, paidAmount: paidAmount || (paid ? montantTtc : 0), paidDate,
    currency: data.devise || data.currency || 'EUR',
    raw: data,
  };
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
