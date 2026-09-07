// Service worker minimal : il rend SuiviPro installable (et donc présent dans le menu
// « Partager » du téléphone) sans rien garder en cache — tout passe par le réseau.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request));
});
