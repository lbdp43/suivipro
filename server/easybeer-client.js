// Client API Easybeer — endpoints vérifiés en réel (juillet 2026), rythme régulé.
// Référence complète des pièges : voir docs/EASYBEER-API.md du projet SumEasy.
//
// Règles d'or :
//  - Easybeer limite à 10 req/s puis bannit ~30 s → tous les appels passent par
//    une file sérialisée (300 ms d'intervalle) avec retry automatique après ban.
//  - Liste clients  : POST /parametres/client/liste?colonneTri=nom&numeroPage=N (N ≥ 1)
//    (colonneTri=libelle ou numeroPage=0 → 500 « erreur inconnue », vérifié).
//  - Liste commandes: POST /commande/liste/{etat-kebab-minuscule} (tous, en-cours…),
//    pages ≥ 1, corps = ModeleCommandeFiltre ({ idClient, dateDebutCreation… }).
//  - Détail commande: GET /commande/detail/{id} → elementsBouteilles / elementsAutres /
//    elementsSaisieLibre (PAS « lignes »), etat = OBJET {code, libelle}, totalHT/totalTTC.
//  - Détail client  : GET /parametres/client/detail/{idClient}.

const INTERVALLE_MS = 300;
let chaine = Promise.resolve();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Appel régulé + retry après ban. headers doit contenir Authorization (Basic). */
export function ebFetch(apiBase, headers, path, { method = 'GET', query = null, body = null, timeout = 20000 } = {}) {
  const p = chaine.then(() => ebFetchBrut(apiBase, headers, path, { method, query, body, timeout }));
  chaine = p.then(() => sleep(INTERVALLE_MS), () => sleep(INTERVALLE_MS));
  return p;
}

async function ebFetchBrut(apiBase, headers, path, opts, tentative = 0) {
  const url = new URL(apiBase.replace(/\/$/, '') + path);
  if (opts.query) for (const [k, v] of Object.entries(opts.query)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method: opts.method,
    headers: { ...headers, Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(opts.timeout),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = (json && (json.message || json.error)) || text.slice(0, 200);
    const ban = /try again in (\d+) seconds?/i.exec(msg);
    if (ban && tentative < 2) {
      await sleep((Number(ban[1]) + 2) * 1000);
      return ebFetchBrut(apiBase, headers, path, opts, tentative + 1);
    }
    const err = new Error(`Easybeer ${opts.method} ${path} → HTTP ${res.status} : ${msg}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

/** GET /commande/detail/{id} — null si introuvable (404). */
export async function detailCommande(apiBase, headers, id) {
  try {
    const d = await ebFetch(apiBase, headers, `/commande/detail/${id}`);
    return d && (d.numero || d.idCommande || d.client) ? d : null;
  } catch (e) {
    if (e.status === 404 || e.status === 400) return null;
    throw e;
  }
}

/** GET /parametres/client/detail/{idClient} — null si introuvable. */
export async function detailClient(apiBase, headers, id) {
  try {
    const d = await ebFetch(apiBase, headers, `/parametres/client/detail/${id}`);
    return d && (d.nom || d.idClient) ? d : null;
  } catch (e) {
    if (e.status === 404 || e.status === 400) return null;
    throw e;
  }
}

/**
 * Liste paginée des commandes. etat en kebab minuscule ('tous', 'en-cours'…).
 * filtre = ModeleCommandeFiltre ({ idClient, dateDebutCreation: 'yyyy-MM-dd', … }).
 * Rappel : réponse { liste, totalElements, totalPages }, pages À PARTIR DE 1.
 */
export function listeCommandesPage(apiBase, headers, { etat = 'tous', filtre = {}, page = 1, parPage = 200 } = {}) {
  return ebFetch(apiBase, headers, `/commande/liste/${etat}`, {
    method: 'POST',
    query: { colonneTri: '-numero', nombreParPage: parPage, numeroPage: page },
    body: filtre,
  });
}

/** Toutes les commandes d'un filtre (pagination suivie, borne de sécurité). */
export async function listeCommandes(apiBase, headers, { etat = 'tous', filtre = {}, maxPages = 25 } = {}) {
  const toutes = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await listeCommandesPage(apiBase, headers, { etat, filtre, page });
    toutes.push(...((res && res.liste) || []));
    if (!res || page >= (res.totalPages || 1)) break;
  }
  return toutes;
}

/** Liste paginée des clients (pages À PARTIR DE 1, colonneTri=nom obligatoire). */
export function listeClientsPage(apiBase, headers, { page = 1, parPage = 500, filtre = {} } = {}) {
  return ebFetch(apiBase, headers, '/parametres/client/liste', {
    method: 'POST',
    query: { colonneTri: 'nom', mode: 'ASC', nombreParPage: parPage, numeroPage: page },
    body: filtre,
    timeout: 30000,
  });
}

/** Tous les clients Easybeer ({ idClient, nom, … }). */
export async function listeClients(apiBase, headers, { maxPages = 20 } = {}) {
  const tous = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await listeClientsPage(apiBase, headers, { page });
    const liste = (res && res.liste) || [];
    tous.push(...liste);
    if (!res || page >= (res.totalPages || 1)) break;
  }
  return tous;
}

// --- Parsing du détail de commande (formes RÉELLES de l'API) -----------------

const ETATS_LIVREE = ['LIVREE', 'FACTUREE', 'ARCHIVEE'];
const ETATS_ANNULEE = ['ANNULEE'];

/**
 * Normalise un détail de commande Easybeer vers le modèle SuiviPro.
 * @returns {{ numero, dateCommande, dateLivraison, statut, montantHt, montantTtc,
 *             lignes: Array, clientEb: {id, nom}|null, urlMinifie, estFacturee }}
 */
export function parseCommandeDetail(det) {
  const etatCode = String((det.etat && det.etat.code) || '').toUpperCase();
  let statut = 'en_cours';
  if (det.estFacturee || det.estLivree || ETATS_LIVREE.includes(etatCode)) statut = 'livree';
  else if (det.estAnnulee || ETATS_ANNULEE.includes(etatCode)) statut = 'annulee';

  const lignes = [];
  for (const e of det.elementsBouteilles || []) {
    const produit = (e.stockBouteille && e.stockBouteille.produit && e.stockBouteille.produit.nom) || '';
    const contenant = (e.stockBouteille && e.stockBouteille.contenant && e.stockBouteille.contenant.nom) || '';
    const designation = e.designation || [produit, contenant].filter(Boolean).join(' - ') || 'Produit';
    lignes.push({
      produit: produit ? `${produit}${contenant ? ' - ' + contenant : ''}` : designation,
      nom_produit: produit || designation,
      format: contenant || e.designation || '',
      quantite: Number(e.quantite) || 0,
      prix_unitaire: Number(e.prixUnitaireHTHorsRemise ?? e.prixLotHT) || 0,
      montant: Number(e.prixTotalHT) || 0,
      tva: Number(e.tauxTVA && e.tauxTVA.taux) || 0,
      reference: e.referenceExterne || '',
    });
  }
  for (const e of det.elementsAutres || []) {
    lignes.push({
      produit: e.libelle || 'Stock autre',
      nom_produit: e.libelle || '',
      format: 'stock autre',
      quantite: Number(e.quantite) || 0,
      prix_unitaire: Number(e.prixUnitaireHT) || 0,
      montant: Number(e.prixTotalHT) || 0,
      tva: Number(e.tauxTVA && e.tauxTVA.taux) || 0,
      reference: e.referenceExterne || '',
    });
  }
  for (const e of det.elementsSaisieLibre || []) {
    lignes.push({
      produit: e.libelle || 'Saisie libre',
      nom_produit: e.libelle || '',
      format: 'saisie libre',
      quantite: Number(e.quantite) || 0,
      prix_unitaire: Number(e.prixUnitaireHT) || 0,
      montant: Number(e.prixTotalHT) || 0,
      tva: Number(e.tauxTVA && e.tauxTVA.taux) || 0,
      reference: '',
    });
  }

  const tsToIso = (ts) => (ts ? new Date(ts).toISOString() : '');
  return {
    numero: String(det.numero || det.idCommande || ''),
    dateCommande: tsToIso(det.dateCreation) || new Date().toISOString(),
    dateLivraison: tsToIso(det.dateLivraisonReelle || det.dateLivraisonPrevue),
    statut,
    montantHt: Number(det.totalHT) || 0,
    montantTtc: Number(det.totalTTC ?? det.total ?? det.netAPayer) || 0,
    lignes,
    clientEb: det.client && det.client.idClient
      ? { id: String(det.client.idClient), nom: det.client.nom || '' }
      : null,
    urlMinifie: det.urlMinifie || '',
    estFacturee: Boolean(det.estFacturee),
    referenceExterne: det.referenceExterne || '',
  };
}
