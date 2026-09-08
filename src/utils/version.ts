// Nouvelle version de l'application : quand le serveur est redéployé, les fichiers des
// pages changent de nom, et un onglet resté ouvert ne peut plus les charger. On lit la
// version que le serveur renvoie sur chaque réponse ; dès qu'elle change, la prochaine
// navigation recharge la page entière au lieu de tomber sur « ce bloc n'a pas pu s'afficher ».
const CLE = 'suivipro_rechargement';
let versionConnue: string | null = null;
let nouvelleVersion = false;

export function noterVersion(v: string | null) {
  if (!v) return;
  if (versionConnue === null) { versionConnue = v; return; }
  if (v !== versionConnue) nouvelleVersion = true;
}

export function nouvelleVersionDisponible(): boolean {
  return nouvelleVersion;
}

/** Un fichier de page introuvable ou refusé : le cas typique après une mise en production. */
export function estUneErreurDeChargement(err: unknown): boolean {
  const m = String((err as { message?: string })?.message || err || '');
  return /dynamically imported module|Importing a module script failed|Loading chunk|Loading CSS chunk|Failed to fetch|error loading dynamically imported|MIME type/i.test(m);
}

/**
 * Recharge la page une seule fois par minute : si le rechargement ne règle rien, on ne
 * boucle pas, on laisse le message s'afficher. Renvoie true si un rechargement est lancé.
 */
export function rechargerUneFois(vers?: string): boolean {
  try {
    const dernier = Number(sessionStorage.getItem(CLE) || 0);
    if (Date.now() - dernier < 60000) return false;
    sessionStorage.setItem(CLE, String(Date.now()));
  } catch { /* stockage indisponible : on recharge quand même */ }
  if (vers) window.location.replace(vers); else window.location.reload();
  return true;
}
