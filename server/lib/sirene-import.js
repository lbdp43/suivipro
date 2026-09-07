// Helpers partagés (sirene-import) — déplacés tels quels depuis routes.js.

export const DATAGOUV_BASE_URL = 'https://recherche-entreprises.api.gouv.fr';

export const NAF_CODES = [
  { code: '56.10A', label: 'Restauration traditionnelle', type: 'bar_restaurant' },
  { code: '56.10B', label: 'Cafeterias et libres-services', type: 'bar_restaurant' },
  { code: '56.10C', label: 'Restauration rapide', type: 'bar_restaurant' },
  { code: '56.21Z', label: 'Services des traiteurs', type: 'traiteur' },
  { code: '56.29A', label: 'Restauration collective sous contrat', type: 'autre' },
  { code: '56.29B', label: 'Autres services de restauration', type: 'autre' },
  { code: '56.30Z', label: 'Debits de boissons', type: 'bar_restaurant' },
  { code: '47.25Z', label: 'Cavistes', type: 'cave' },
  { code: '46.34Z', label: 'Commerce de gros de boissons', type: 'distributeur' },
  { code: '46.17B', label: 'Intermediaires boissons et tabac', type: 'distributeur' },
  { code: '46.39B', label: 'Commerce de gros alimentaire', type: 'distributeur' },
  { code: '11.01Z', label: 'Distilleries / Spiritueux', type: 'autre' },
  { code: '11.02A', label: 'Vins effervescents', type: 'autre' },
  { code: '11.02B', label: 'Vinification', type: 'autre' },
  { code: '11.03Z', label: 'Cidre et vins de fruits', type: 'autre' },
  { code: '11.04Z', label: 'Boissons fermentees', type: 'autre' },
  { code: '11.05Z', label: 'Fabrication de biere', type: 'autre' },
  { code: '11.06Z', label: 'Fabrication de malt', type: 'autre' },
  { code: '11.07A', label: 'Eaux de table', type: 'autre' },
  { code: '11.07B', label: 'Boissons rafraichissantes', type: 'autre' },
];

// Parse data.gouv.fr result -> array of etablissements
export function parseDatagouvResult(result) {
  const etablissements = [];
  const siege = result.siege || {};
  const allEtabs = result.matching_etablissements || [siege];

  for (const etab of allEtabs) {
    if (!etab.siret) continue;
    etablissements.push({
      siret: etab.siret,
      siren: result.siren,
      nom: result.nom_complet || result.nom_raison_sociale || 'Non renseigne',
      enseigne: etab.nom_commercial || null,
      code_naf: etab.activite_principale || result.activite_principale,
      libelle_naf: etab.libelle_activite_principale || null,
      date_creation_etab: etab.date_creation || result.date_creation,
      adresse_voie: etab.adresse || null,
      code_postal: etab.code_postal || null,
      commune: etab.libelle_commune || null,
      code_commune: etab.commune || null,
      departement: etab.departement || '',
      latitude: etab.latitude || null,
      longitude: etab.longitude || null,
      etat_admin: etab.etat_administratif || 'A',
      tranche_effectif: etab.tranche_effectif_salarie || null,
    });
  }
  return etablissements;
}

// Fetch page from data.gouv.fr API
export async function fetchDatagouvPage(nafCodes, page = 1, departement = '') {
  const params = new URLSearchParams({
    activite_principale: nafCodes.join(','),
    etat_administratif: 'A',
    per_page: '25',
    page: String(page),
    minimal: 'true',
    include: 'siege,matching_etablissements',
  });
  if (departement) params.set('departement', departement);

  const response = await fetch(`${DATAGOUV_BASE_URL}/search?${params}`, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'suivipro-brasserie/3.0',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Datagouv API error ${response.status}: ${text}`);
  }

  return response.json();
}

// Fetch all pages from data.gouv.fr with rate limiting
export async function fetchAllDatagouv(nafCodes, departement = '', maxPages = 400) {
  const allResults = [];
  let page = 1;
  let totalPages = 1;

  do {
    const data = await fetchDatagouvPage(nafCodes, page, departement);
    totalPages = Math.min(data.total_pages || 1, maxPages);
    allResults.push(...(data.results || []));
    page++;
    // Rate limit: 7 req/sec -> wait 200ms
    if (page <= totalPages) await new Promise(r => setTimeout(r, 200));
  } while (page <= totalPages);

  return allResults;
}

// Recherche geographique par lat/lng + rayon
export async function fetchNearPoint(lat, lng, radius = 10, nafCodes = [], page = 1) {
  const params = new URLSearchParams({
    lat: String(lat),
    long: String(lng),
    radius: String(radius),
    per_page: '25',
    page: String(page),
    etat_administratif: 'A',
    minimal: 'true',
    include: 'siege,matching_etablissements',
  });
  if (nafCodes.length > 0) params.set('activite_principale', nafCodes.join(','));

  const response = await fetch(`${DATAGOUV_BASE_URL}/near_point?${params}`, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'suivipro-brasserie/3.0',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Datagouv near_point error ${response.status}: ${text}`);
  }

  return response.json();
}
