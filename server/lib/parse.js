// Helpers partagés (parse) — déplacés tels quels depuis routes.js.

/** Les rayons proposés pour « Appeler autour » ; 10 km à défaut. */
export const RAYONS_APPELS_KM = [3, 5, 10, 15, 20];

export function parseSessionAppel(s) {
  if (!s) return s;
  const lire = (v) => { if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = []; } } return Array.isArray(v) ? v : []; };
  let origine = null;
  if (s.origine && typeof s.origine === 'string') { try { origine = JSON.parse(s.origine); } catch { origine = null; } }
  else if (s.origine && typeof s.origine === 'object') origine = s.origine;
  return { ...s, prospect_ids: lire(s.prospect_ids), client_ids: lire(s.client_ids), origine: origine && typeof origine === 'object' ? origine : null };
}

export function parseProspect(p) {
  if (!p) return p;
  let tags = p.tags;
  if (typeof tags === 'string') {
    try { tags = JSON.parse(tags); } catch { tags = []; }
  }
  if (!Array.isArray(tags)) tags = [];
  return { ...p, tags };
}

/** Un rendez-vous ou un événement : les participants (JSON en base) redeviennent une liste. */
export function parseAppointment(a) {
  if (!a) return a;
  let participants = a.participants;
  if (typeof participants === 'string') { try { participants = JSON.parse(participants); } catch { participants = []; } }
  return { ...a, event_type: a.event_type || 'rdv', titre: a.titre || '', participants: Array.isArray(participants) ? participants : [] };
}

export function parseCommercial(c) {
  if (!c) return c;
  const { password: _, hub_password: __, hub_email: ___, ...u } = c;
  return { ...u, objectifs: JSON.parse(u.objectifs || '{}'), rayon_appels_km: RAYONS_APPELS_KM.includes(Number(u.rayon_appels_km)) ? Number(u.rayon_appels_km) : 10 };
}
