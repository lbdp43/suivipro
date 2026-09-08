// Helpers partagés (geo) — déplacés tels quels depuis routes.js.

// Geocoding helper using api-adresse.data.gouv.fr
export async function geocodeServer(adresse) {
  if (!adresse || adresse.trim().length < 3) return null;
  try {
    const params = new URLSearchParams({ q: adresse, limit: '1' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://api-adresse.data.gouv.fr/search/?${params}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.features && data.features.length > 0) {
      const [lng, lat] = data.features[0].geometry.coordinates;
      return { latitude: lat, longitude: lng };
    }
    return null;
  } catch {
    return null;
  }
}

// Zones de tournee : la config melange des jours (tableaux de chaines) et une cle
// « prospection » (tableau d'objets { zone, slots }). Comparer une zone en supposant
// une chaine faisait tomber les ecrans commerciaux des qu'un client avait une visite
// prevue dans la semaine avec une tournee absente des jours configures :
// « z.toLowerCase is not a function ».
export function nomZone(z) {
  if (typeof z === 'string') return z;
  if (z && typeof z === 'object' && typeof z.zone === 'string') return z.zone;
  return '';
}

// Config de tournee lue en base : texte JSON, jamais garanti valide.
export { lireConfigTournee } from '../../shared/tournee.js';
