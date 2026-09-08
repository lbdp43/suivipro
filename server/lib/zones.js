// Zones dessinées sur la carte : rattachement des fiches et état du géocodage.
//
// Une zone est un polygone [[lat, lng], ...] appartenant à un commercial. Chaque prospect
// et chaque client géolocalisé est rattaché à la zone qui le contient (zone_id) ; quand
// plusieurs zones se recouvrent, la plus petite gagne. Pour les prospects, le rattachement
// remplit aussi le secteur avec le nom de la zone quand il est vide, pour que les fiches
// importées rejoignent d'elles-mêmes les jours de tournée.
import db from '../db.js';
import { geocodeServer } from './geo.js';

export function pointDansPolygone(lat, lng, polygone) {
  // Ray casting ; polygone = [[lat, lng], ...]
  let dedans = false;
  for (let i = 0, j = polygone.length - 1; i < polygone.length; j = i++) {
    const [yi, xi] = polygone[i], [yj, xj] = polygone[j];
    const coupe = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (coupe) dedans = !dedans;
  }
  return dedans;
}

function airePolygone(polygone) {
  let aire = 0;
  for (let i = 0, j = polygone.length - 1; i < polygone.length; j = i++) {
    aire += (polygone[j][1] + polygone[i][1]) * (polygone[j][0] - polygone[i][0]);
  }
  return Math.abs(aire / 2);
}

function lireZones(rows) {
  return rows.map(z => {
    let coordinates = z.coordinates;
    if (typeof coordinates === 'string') { try { coordinates = JSON.parse(coordinates); } catch { coordinates = []; } }
    if (!Array.isArray(coordinates)) coordinates = [];
    return { ...z, coordinates, aire: airePolygone(coordinates) };
  }).filter(z => z.coordinates.length >= 3);
}

/** La zone (la plus petite) qui contient le point, ou null. */
export function zoneDuPoint(lat, lng, zones) {
  if (!lat || !lng) return null;
  let meilleure = null;
  for (const z of zones) {
    if (!pointDansPolygone(lat, lng, z.coordinates)) continue;
    if (!meilleure || z.aire < meilleure.aire) meilleure = z;
  }
  return meilleure;
}

// Les zones servent à la prospection : seul le secteur des prospects est rempli avec le nom de
// la zone. Les clients reçoivent juste leur zone_id (pour savoir qui est hors zone), leur
// tournée reste réglée à la main.
const TABLES = {
  prospects: { champNom: 'secteur', remplirNom: true },
  clients: { champNom: 'tournee', remplirNom: false },
};

async function chargerZones() {
  const r = await db.query('SELECT id, commercial_id, nom, coordinates FROM commercial_zones');
  return lireZones(r.rows);
}

async function appliquer(table, ligne, zones) {
  const { champNom, remplirNom } = TABLES[table];
  const zone = zoneDuPoint(Number(ligne.latitude), Number(ligne.longitude), zones);
  const zoneId = zone ? zone.id : null;
  const nomActuel = (ligne[champNom] || '').trim();
  const nouveauNom = remplirNom && zone && !nomActuel && zone.nom ? zone.nom : null;
  if ((ligne.zone_id || null) === zoneId && !nouveauNom) return false;
  if (nouveauNom) {
    await db.query(`UPDATE ${table} SET zone_id = $1, ${champNom} = $2 WHERE id = $3`, [zoneId, nouveauNom, ligne.id]);
  } else {
    await db.query(`UPDATE ${table} SET zone_id = $1 WHERE id = $2`, [zoneId, ligne.id]);
  }
  return true;
}

/** Rattache une seule fiche (après création ou modification). */
export async function rattacherEntite(table, id) {
  if (!TABLES[table]) return;
  const { champNom } = TABLES[table];
  const r = await db.query(`SELECT id, latitude, longitude, zone_id, ${champNom} FROM ${table} WHERE id = $1`, [id]);
  if (r.rows.length === 0) return;
  const zones = await chargerZones();
  await appliquer(table, r.rows[0], zones);
}

/** Rattache toutes les fiches (après un import ou une zone modifiée). */
export async function rattacherTout() {
  const zones = await chargerZones();
  const bilan = { zones: zones.length, prospects_modifies: 0, clients_modifies: 0 };
  for (const table of Object.keys(TABLES)) {
    const { champNom } = TABLES[table];
    const r = await db.query(`SELECT id, latitude, longitude, zone_id, ${champNom} FROM ${table}`);
    for (const ligne of r.rows) {
      if (await appliquer(table, ligne, zones)) bilan[`${table}_modifies`] += 1;
    }
  }
  return bilan;
}

/** Ce qu'il manque pour placer les fiches : sans coordonnées, hors zone. */
export async function etatGeocodage() {
  const compter = async (table) => {
    const r = await db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE latitude IS NULL OR latitude = 0 OR longitude IS NULL OR longitude = 0)::int AS sans_coordonnees,
              COUNT(*) FILTER (WHERE latitude IS NOT NULL AND latitude <> 0 AND longitude IS NOT NULL AND longitude <> 0 AND zone_id IS NULL)::int AS hors_zone,
              COUNT(*) FILTER (WHERE (latitude IS NULL OR latitude = 0 OR longitude IS NULL OR longitude = 0)
                                 AND COALESCE(adresse, '') = '' AND COALESCE(ville, '') = '' AND COALESCE(code_postal, '') = '')::int AS sans_adresse
       FROM ${table}`
    );
    return r.rows[0];
  };
  const zones = await db.query('SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE prioritaire)::int AS prioritaires FROM commercial_zones');
  return { prospects: await compter('prospects'), clients: await compter('clients'), zones: zones.rows[0] };
}

/**
 * Géocode les fiches sans coordonnées qui ont une adresse, par paquets (api-adresse est
 * un service public : on espace les appels). Renvoie le bilan et ce qu'il reste.
 */
export async function geocoderManquants({ limite = 150 } = {}) {
  const bilan = { tentes: 0, geocodes: 0, echecs: 0, restants: 0 };
  for (const table of Object.keys(TABLES)) {
    const r = await db.query(
      `SELECT id, adresse, ville, code_postal FROM ${table}
       WHERE (latitude IS NULL OR latitude = 0 OR longitude IS NULL OR longitude = 0)
         AND (COALESCE(adresse, '') <> '' OR COALESCE(ville, '') <> '' OR COALESCE(code_postal, '') <> '')
       ORDER BY date_modification DESC`
    );
    const aFaire = r.rows.slice(0, Math.max(0, limite - bilan.tentes));
    bilan.restants += r.rows.length - aFaire.length;
    for (const ligne of aFaire) {
      bilan.tentes += 1;
      const geo = await geocodeServer([ligne.adresse, ligne.code_postal, ligne.ville].filter(Boolean).join(' '));
      if (geo) {
        await db.query(`UPDATE ${table} SET latitude = $1, longitude = $2 WHERE id = $3`, [geo.latitude, geo.longitude, ligne.id]);
        bilan.geocodes += 1;
      } else {
        bilan.echecs += 1;
      }
      await new Promise(r => setTimeout(r, 120));
    }
  }
  if (bilan.geocodes > 0) await rattacherTout();
  return bilan;
}
