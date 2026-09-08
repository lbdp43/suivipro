// Helpers partagés (parse) — déplacés tels quels depuis routes.js.

export function parseSessionAppel(s) {
  if (!s) return s;
  const lire = (v) => { if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = []; } } return Array.isArray(v) ? v : []; };
  return { ...s, prospect_ids: lire(s.prospect_ids), client_ids: lire(s.client_ids) };
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

export function parseCommercial(c) {
  if (!c) return c;
  const { password: _, hub_password: __, hub_email: ___, ...u } = c;
  return { ...u, objectifs: JSON.parse(u.objectifs || '{}') };
}
