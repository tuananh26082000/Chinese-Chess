const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = read('index.html');
const manifest = JSON.parse(read('manifest.json'));

// ----- load sw.js in a sandbox with a fake Cache API -----
function loadServiceWorker() {
  const listeners = {};
  const stores = new Map();           // cacheName -> Map(url -> response)
  const abs = (u) => new URL(u, 'https://app.test/').href;
  const response = (body) => ({ ok: true, type: 'basic', body, clone() { return this; } });
  const precacheRequests = [];
  class Request { constructor(url, init = {}) { this.rel = url; this.url = abs(url); this.cache = init.cache; } }
  const caches = {
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const s = stores.get(name);
      return {
        add: async (r) => { precacheRequests.push(r); s.set(r.url, response(`precached:${r.rel}`)); },
        match: async (r) => s.get(typeof r === 'string' ? abs(r) : r.url),
        put: async (r, res) => s.set(r.url, res),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (k) => stores.delete(k),
    match: async (r, opts) => {
      const s = stores.get(opts && opts.cacheName);
      return s && s.get(abs(r));
    },
  };
  const calls = { skipWaiting: 0, claim: 0 };
  const sandbox = {
    URL, Promise, console, caches, Request,
    offline: false,
    fetch: async (r) => { if (sandbox.offline) throw new TypeError('offline'); return response(`network:${r.url}`); },
    self: {
      location: { origin: 'https://app.test' },
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting: () => { calls.skipWaiting++; return Promise.resolve(); },
      clients: { claim: () => { calls.claim++; return Promise.resolve(); } },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(read('sw.js'), sandbox, { filename: 'sw.js' });
  // Dispatch an event and return whatever the handler passed to waitUntil/respondWith
  const run = async (type, extra = {}) => {
    let p;
    listeners[type]({ waitUntil: (x) => { p = x; }, respondWith: (x) => { p = x; }, ...extra });
    return p === undefined ? undefined : await p;
  };
  return { sandbox, stores, calls, precacheRequests, run, get: (n) => vm.runInContext(n, sandbox) };
}

const req = (url, extra = {}) => ({ url, method: 'GET', mode: 'cors', ...extra });

// ----- static checks -----

test('manifest is installable on iOS/Android', () => {
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.name && manifest.short_name);
  assert.ok(manifest.start_url && manifest.scope);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
  const sizes = manifest.icons.map(i => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(manifest.icons.some(i => i.purpose === 'maskable'));
});

test('icons exist and have the dimensions they claim', () => {
  const dims = (file) => {
    const b = fs.readFileSync(path.join(ROOT, file));
    assert.equal(b.subarray(1, 4).toString(), 'PNG', `${file} is a PNG`);
    return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
  };
  for (const icon of manifest.icons) assert.equal(dims(icon.src), icon.sizes, icon.src);
  assert.equal(dims('icons/apple-touch-icon.png'), '180x180', 'iOS home-screen icon');
});

test('index.html wires up manifest, iOS icon, safe-area viewport and the registration script', () => {
  assert.match(html, /<link rel="manifest" href="manifest\.json"/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png"/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /<script src="js\/pwa\.js"><\/script>/);
});

test('every local file index.html loads is precached (otherwise offline breaks)', () => {
  const { get } = loadServiceWorker();
  const precache = Array.from(get('PRECACHE'));
  const local = [
    ...[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]),
    ...[...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map(m => m[1]),
  ].filter(u => !/^(https?:)?\/\//.test(u));
  assert.ok(local.length >= 9, 'found the local assets');
  for (const f of local) assert.ok(precache.includes(f), `${f} is missing from PRECACHE in sw.js`);
});

test('every precached file exists on disk', () => {
  const { get } = loadServiceWorker();
  for (const f of Array.from(get('PRECACHE'))) {
    if (f === './') continue;
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} listed in PRECACHE but not found`);
  }
});

// ----- behaviour -----

test('install precaches the app shell and activates immediately', async () => {
  const sw = loadServiceWorker();
  await sw.run('install');
  const appCache = [...sw.stores.keys()].find(k => k.startsWith('cotuong-app-'));
  assert.ok(appCache);
  assert.ok(sw.stores.get(appCache).size >= 15);
  assert.equal(sw.calls.skipWaiting, 1);
});

test('activate removes old app caches but keeps the font cache', async () => {
  const sw = loadServiceWorker();
  await sw.run('install');
  const current = [...sw.stores.keys()].find(k => k.startsWith('cotuong-app-'));
  sw.stores.set('cotuong-app-old', new Map());
  sw.stores.set('cotuong-fonts', new Map());
  await sw.run('activate');
  assert.ok(!sw.stores.has('cotuong-app-old'), 'stale cache deleted');
  assert.ok(sw.stores.has(current), 'current cache kept');
  assert.ok(sw.stores.has('cotuong-fonts'), 'font cache kept');
  assert.equal(sw.calls.claim, 1);
});

test('works offline: assets come from cache and navigation falls back to the shell', async () => {
  const sw = loadServiceWorker();
  await sw.run('install');
  sw.sandbox.offline = true;

  const js = await sw.run('fetch', { request: req('https://app.test/js/main.js') });
  assert.equal(js.body, 'precached:js/main.js');

  const nav = await sw.run('fetch', { request: req('https://app.test/some/path', { mode: 'navigate' }) });
  assert.equal(nav.body, 'precached:index.html', 'offline navigation serves the cached shell');
});

test('pages and scripts always come from the same cached version (no new HTML with old JS)', async () => {
  const sw = loadServiceWorker();
  await sw.run('install');
  // Online, even though the network could answer: the cached shell is used so it matches the cached scripts
  const nav = await sw.run('fetch', { request: req('https://app.test/', { mode: 'navigate' }) });
  assert.equal(nav.body, 'precached:index.html');
  const js = await sw.run('fetch', { request: req('https://app.test/js/main.js') });
  assert.equal(js.body, 'precached:js/main.js');
});

test('before the first install has completed, navigation falls back to the network', async () => {
  const sw = loadServiceWorker();
  const nav = await sw.run('fetch', { request: req('https://app.test/', { mode: 'navigate' }) });
  assert.match(nav.body, /^network:/);
});

test('a new version is built from fresh files, never from the browser\'s HTTP cache', async () => {
  const sw = loadServiceWorker();
  await sw.run('install');
  assert.equal(sw.precacheRequests.length, Array.from(sw.get('PRECACHE')).length);
  assert.ok(sw.precacheRequests.every(r => r.cache === 'reload'), "every precache request uses cache: 'reload'");
});

test('Google Fonts are cached after first online use and served offline', async () => {
  const sw = loadServiceWorker();
  await sw.run('install');
  const url = 'https://fonts.gstatic.com/s/outfit/v1/a.woff2';
  const first = await sw.run('fetch', { request: req(url) });
  assert.match(first.body, /^network:/);
  sw.sandbox.offline = true;
  const again = await sw.run('fetch', { request: req(url) });
  assert.equal(again.body, first.body, 'served from the font cache while offline');
});

test('non-GET and unrelated cross-origin requests are left alone', async () => {
  const sw = loadServiceWorker();
  await sw.run('install');
  assert.equal(await sw.run('fetch', { request: req('https://app.test/js/main.js', { method: 'POST' }) }), undefined);
  assert.equal(await sw.run('fetch', { request: req('https://cdn.jsdelivr.net/x.js') }), undefined);
});

test('the Stockfish engine bundle is present, precached, and its worker uses relative URLs', () => {
  const { get } = loadServiceWorker();
  const precache = Array.from(get('PRECACHE'));
  for (const f of ['engine/worker.js', 'engine/stockfish.js', 'engine/stockfish.wasm', 'engine/stockfish.worker.js']) {
    assert.ok(precache.includes(f), `${f} must be precached for offline play`);
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} exists`);
  }
  const wasm = fs.readFileSync(path.join(ROOT, 'engine/stockfish.wasm'));
  assert.deepEqual([...wasm.subarray(0, 4)], [0x00, 0x61, 0x73, 0x6d], 'valid WebAssembly binary');
  assert.ok(!/['"]\/engine\//.test(read('engine/worker.js')), 'worker must not hard-code /engine/ (breaks sub-folder hosting)');
});

test('cross-origin isolation headers are configured (needed for SharedArrayBuffer / the real engine)', () => {
  const headers = read('_headers');
  assert.match(headers, /Cross-Origin-Opener-Policy:\s*same-origin/);
  assert.match(headers, /Cross-Origin-Embedder-Policy:\s*require-corp/);
  const server = read('server.py');
  assert.match(server, /Cross-Origin-Opener-Policy/);
  assert.match(server, /Cross-Origin-Embedder-Policy/);
});

// ---------- js/pwa.js: registration and the update flow ----------
const { loadContext } = require('./helpers');

function loadPwa({ protocol = 'https:', hostname = 'app.test', search = '', controller = null, registrations = [], game = null, cacheKeys = [], session = {} } = {}) {
  const log = { registered: [], reloads: 0, unregistered: 0, deletedCaches: [], updates: 0, bannerShown: false, listeners: {}, docListeners: {}, session: { ...session } };
  const reg = { update: () => { log.updates++; } };
  const navigator = {
    serviceWorker: {
      controller,
      register: (url, opts) => { log.registered.push({ url, opts }); return Promise.resolve(reg); },
      addEventListener: (type, fn) => { log.listeners[type] = fn; },
      getRegistrations: () => Promise.resolve(registrations.map(() => ({ unregister: () => { log.unregistered++; return Promise.resolve(true); } }))),
    },
  };
  const banner = { classList: { remove: () => { log.bannerShown = true; } } };
  const button = { addEventListener: (t, fn) => { log.reloadButton = fn; } };
  const document = {
    hidden: false,
    getElementById: (id) => (id === 'update-banner' ? banner : id === 'update-reload' ? button : null),
    addEventListener: (type, fn) => { log.docListeners[type] = fn; },
  };
  const { ctx } = loadContext([], {
    navigator, document,
    location: { protocol, hostname, search, reload: () => { log.reloads++; } },
    caches: { keys: () => Promise.resolve(cacheKeys), delete: (k) => { log.deletedCaches.push(k); return Promise.resolve(true); } },
    sessionStorage: { getItem: (k) => log.session[k] || null, setItem: (k, v) => { log.session[k] = v; } },
    addEventListener: (type, fn) => { log.windowListeners = log.windowListeners || {}; log.windowListeners[type] = fn; },
    game,
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/pwa.js'), 'utf8'), ctx, { filename: 'pwa.js' });
  return { log, fireLoad: async () => { if (log.windowListeners && log.windowListeners.load) log.windowListeners.load(); await Promise.resolve(); await Promise.resolve(); } };
}
const flush = () => new Promise(r => setTimeout(r, 5));
const idleGame = { getState: () => ({ moveHistory: [], mode: 'pvai' }) };
const busyGame = { getState: () => ({ moveHistory: [{}], mode: 'pvai' }) };

test('pwa.js registers the service worker on HTTPS, bypassing the HTTP cache for the worker script', async () => {
  const { log, fireLoad } = loadPwa();
  await fireLoad();
  assert.equal(log.registered.length, 1);
  assert.equal(log.registered[0].url, 'sw.js');
  assert.equal(log.registered[0].opts.updateViaCache, 'none');
});

test('pwa.js does nothing on plain http (except localhost rules below)', async () => {
  const { log, fireLoad } = loadPwa({ protocol: 'http:', hostname: '192.168.1.20' });
  await fireLoad();
  assert.equal(log.registered.length, 0);
});

test('localhost: no service worker by default, and a leftover one (with its caches) is removed, reloading once', async () => {
  const { log, fireLoad } = loadPwa({
    protocol: 'http:', hostname: 'localhost', controller: {}, registrations: [1], cacheKeys: ['cotuong-app-v7', 'cotuong-fonts', 'other-site'],
  });
  await fireLoad(); await flush();
  assert.equal(log.registered.length, 0, 'not registered while developing');
  assert.equal(log.unregistered, 1);
  assert.deepEqual(log.deletedCaches.sort(), ['cotuong-app-v7', 'cotuong-fonts'], 'only this app\'s caches');
  assert.equal(log.reloads, 1, 'reloaded once to drop the stale page');

  assert.equal(log.session['cotuong-sw-removed'], '1');
});

test('localhost: the clean-up reload happens only once per session (no reload loop)', async () => {
  const { log, fireLoad } = loadPwa({
    protocol: 'http:', hostname: 'localhost', controller: {}, registrations: [1], session: { 'cotuong-sw-removed': '1' },
  });
  await fireLoad(); await flush();
  assert.equal(log.unregistered, 1, 'still cleans up');
  assert.equal(log.reloads, 0, 'but does not reload again');
});

test('localhost with ?sw opts in to the service worker for testing', async () => {
  const { log, fireLoad } = loadPwa({ protocol: 'http:', hostname: 'localhost', search: '?sw' });
  await fireLoad();
  assert.equal(log.registered.length, 1);
});

test('update flow: an idle page reloads itself when the new version takes over', async () => {
  const { log } = loadPwa({ controller: {}, game: idleGame });
  log.listeners.controllerchange();
  assert.equal(log.reloads, 1);
  log.listeners.controllerchange();
  assert.equal(log.reloads, 1, 'only once');
});

test('update flow: a game in progress is never thrown away; a banner offers the update instead', async () => {
  const { log } = loadPwa({ controller: {}, game: busyGame });
  log.listeners.controllerchange();
  assert.equal(log.reloads, 0);
  assert.equal(log.bannerShown, true);
  log.reloadButton();
  assert.equal(log.reloads, 1, 'the banner button reloads');
});

test('update flow: analysis mode counts as work in progress', async () => {
  const { log } = loadPwa({ controller: {}, game: { getState: () => ({ moveHistory: [], mode: 'analyze' }) } });
  log.listeners.controllerchange();
  assert.equal(log.reloads, 0);
  assert.equal(log.bannerShown, true);
});

test('update flow: the very first install does not trigger a reload', async () => {
  const { log } = loadPwa({ controller: null, game: idleGame });
  log.listeners.controllerchange();
  assert.equal(log.reloads, 0);
  assert.equal(log.bannerShown, false);
});

test('an installed app checks for updates whenever it returns to the screen', async () => {
  const { log, fireLoad } = loadPwa();
  await fireLoad();
  log.docListeners.visibilitychange();
  assert.equal(log.updates, 1);
});

test('index.html has the update banner that pwa.js uses', () => {
  assert.match(html, /id="update-banner"[^>]*class="update-banner hidden"|class="update-banner hidden"[^>]*id="update-banner"/);
  assert.match(html, /id="update-reload"/);
});
