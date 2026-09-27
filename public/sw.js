// Service worker : il rend SuiviPro installable (et donc présent dans le menu « Partager »
// du téléphone), et lui permet de s'ouvrir sans réseau.
//
// - Les pages : le réseau d'abord (on veut toujours la dernière version), la dernière copie
//   reçue sinon. Hors connexion, l'appli s'ouvre donc, et affiche les dernières données
//   gardées sur le téléphone (src/utils/cacheEtat.ts).
// - Les fichiers /assets/ : leur nom change à chaque version (empreinte), ils ne changent
//   jamais sous le même nom — gardés dès le premier chargement, servis depuis le cache.
// - L'API n'est jamais mise en cache ici.
//
// Seule exception : le partage de photos. Android envoie le contenu partagé en POST sur
// /partage ; on range les fichiers dans un cache le temps que l'écran de partage les lise,
// et on redirige vers cet écran avec le texte, le lien et le nombre de photos.
const CACHE_PARTAGE = 'suivipro-partage';
const CACHE_APPLI = 'suivipro-appli-v1';
const CACHE_FICHIERS = 'suivipro-fichiers-v1';
const GARDES = [CACHE_PARTAGE, CACHE_APPLI, CACHE_FICHIERS];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  const noms = await caches.keys();
  await Promise.all(noms.filter(n => !GARDES.includes(n)).map(n => caches.delete(n)));
  await self.clients.claim();
})()));

/** La page : réseau d'abord ; la dernière copie reçue (une seule, celle de l'accueil) sinon. */
async function page(request) {
  try {
    const reponse = await fetch(request);
    // Seule la page de l'appli est gardée — jamais un document ouvert par un lien.
    if (reponse.ok && (reponse.headers.get('Content-Type') || '').includes('text/html')) {
      const cache = await caches.open(CACHE_APPLI);
      await cache.put('/', reponse.clone());
    }
    return reponse;
  } catch (err) {
    const copie = await caches.match('/', { cacheName: CACHE_APPLI });
    if (copie) return copie;
    throw err;
  }
}

/** Un fichier à empreinte : le cache d'abord, le réseau sinon (et on le garde). */
async function fichier(request) {
  const cache = await caches.open(CACHE_FICHIERS);
  const garde = await cache.match(request);
  if (garde) return garde;
  const reponse = await fetch(request);
  if (reponse.ok) {
    await cache.put(request, reponse.clone());
    // Au-delà de 150 fichiers, les plus anciens partent (versions précédentes de l'appli).
    const cles = await cache.keys();
    if (cles.length > 150) await Promise.all(cles.slice(0, cles.length - 150).map(k => cache.delete(k)));
  }
  return reponse;
}

async function recevoirPartage(request) {
  const donnees = await request.formData();
  const cache = await caches.open(CACHE_PARTAGE);
  const anciennes = await cache.keys();
  await Promise.all(anciennes.map(k => cache.delete(k)));
  const fichiers = donnees.getAll('photos').filter(f => f && typeof f === 'object' && f.size > 0);
  let n = 0;
  for (const fichier of fichiers.slice(0, 6)) {
    await cache.put(`/partage-fichier/${n}`, new Response(fichier, { headers: { 'Content-Type': fichier.type || 'image/jpeg', 'X-Nom': encodeURIComponent(fichier.name || '') } }));
    n++;
  }
  const params = new URLSearchParams();
  for (const cle of ['title', 'text', 'url']) { const v = donnees.get(cle); if (typeof v === 'string' && v) params.set(cle, v); }
  if (n > 0) params.set('fichiers', String(n));
  return Response.redirect(`/partage?${params.toString()}`, 303);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/partage') {
    event.respondWith(recevoirPartage(event.request).catch(() => Response.redirect('/partage?sans_fichiers=1', 303)));
    return;
  }
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/mcp')) return;
  if (event.request.mode === 'navigate') { event.respondWith(page(event.request)); return; }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icones/')) event.respondWith(fichier(event.request));
});
