// Service worker minimal : il rend SuiviPro installable (et donc présent dans le menu
// « Partager » du téléphone) sans rien garder en cache — tout passe par le réseau.
//
// Seule exception : le partage de photos. Android envoie le contenu partagé en POST sur
// /partage ; on range les fichiers dans un cache le temps que l'écran de partage les lise,
// et on redirige vers cet écran avec le texte, le lien et le nombre de photos.
const CACHE_PARTAGE = 'suivipro-partage';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request));
});
