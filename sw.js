/**
 * sw.js - Service worker: makes the app work offline.
 *
 * RULES (also enforced by tests/pwa.test.js):
 *  - Every local file index.html loads must be listed in PRECACHE.
 *  - Bump CACHE_VERSION whenever a precached file changes, otherwise installed
 *    copies keep serving the old files.
 */
const CACHE_VERSION = 'v16';
const APP_CACHE = `cotuong-app-${CACHE_VERSION}`;
const FONT_CACHE = 'cotuong-fonts';   // survives version bumps: fonts rarely change

const PRECACHE = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'js/xiangqi.js',
  'js/engine.js',
  'js/geometry.js',
  'js/ui.js',
  'js/editor.js',
  'js/analyzer.js',
  'js/lessons.js',
  'js/pwa.js',
  'js/main.js',
  // Stockfish engine (loaded by Engine.init via engine/worker.js, so not referenced from index.html)
  'engine/worker.js',
  'engine/stockfish.js',
  'engine/stockfish.wasm',
  'engine/stockfish.worker.js',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  // cache: 'reload' bypasses the browser's HTTP cache, so a new version can never be built from stale files
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('cotuong-app-') && k !== APP_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: cache on first online use, then serve from cache.
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, FONT_CACHE));
    return;
  }

  // Everything else that isn't ours (e.g. the engine CDN) goes straight to the network.
  if (url.origin !== self.location.origin) return;

  // Page navigations: serve the page from the SAME cache as its scripts, so HTML and JS always belong to
  // one version (a fresh HTML with cached old JS is what made new buttons do nothing). New versions are
  // picked up by the update flow in js/pwa.js; before the first install completes, fall back to the network.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('index.html', { cacheName: APP_CACHE }).then((shell) => shell || fetch(req))
    );
    return;
  }

  // Static assets: cache-first (fast + offline); refreshed whenever CACHE_VERSION changes.
  event.respondWith(cacheFirst(req, APP_CACHE));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  // Opaque (cross-origin no-cors) responses have status 0 but are still cacheable.
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}
