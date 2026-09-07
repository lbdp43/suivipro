// Helpers partagés (dates) — déplacés tels quels depuis routes.js.

// Helper to format a Date as YYYY-MM-DD using local timezone
export function toLocalDateStr(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
