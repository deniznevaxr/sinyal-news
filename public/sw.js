// Service worker: makes SİNYAL installable as an app and keeps the last news readable offline.
// Strategy is network-first, so a new deploy or a fresh data.json always wins when online.
const CACHE = 'sinyal-v2';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'favicon.svg', 'css/app.css',
  'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/brief.js', 'js/chrome.js', 'js/fmt.js', 'js/i18n.js', 'js/model.js', 'js/overlays.js',
  'js/text.js', 'js/translate.js', 'js/ui.js', 'js/util.js', 'js/views.js',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One missing file must not break installation.
    await Promise.allSettled(SHELL.map(u => cache.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;     // fonts, thumbnails: browser's own cache
  if (url.pathname.includes('/api/')) return;      // live server API and its event stream
  const key = url.origin + url.pathname;           // data.json?t=… is stored as data.json
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(key, copy));
      }
      return res;
    } catch {
      const cached = await caches.match(key) || (req.mode === 'navigate' ? await caches.match(new URL('index.html', self.registration.scope).href) : null);
      return cached || new Response('', { status: 504, statusText: 'offline' });
    }
  })());
});
