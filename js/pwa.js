/**
 * pwa.js - Offline support (service worker) and keeping installed copies up to date.
 *
 * - HTTPS only. On localhost the service worker is NOT used (so edits show up immediately while
 *   developing) and any worker registered earlier is removed; add ?sw to the URL to test it locally.
 * - When a new version has been installed the page reloads itself if nothing would be lost, otherwise
 *   an "update" banner asks first (a game in progress or a position being analysed is never thrown away).
 */
(() => {
  if (!('serviceWorker' in navigator)) return;

  const host = location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  const optedIn = /[?&]sw(=|&|$)/.test(location.search);

  if (isLocal && !optedIn) {
    removeServiceWorkers();
    return;
  }
  if (location.protocol !== 'https:' && !isLocal) {
    console.info('Offline mode needs HTTPS; service worker not registered.');
    return;
  }

  // Anything in progress that a reload would lose?
  function hasWorkInProgress() {
    const g = window.game && window.game.getState && window.game.getState();
    return !!g && (g.moveHistory.length > 0 || g.mode === 'analyze');
  }

  function showUpdateBanner() {
    const banner = document.getElementById('update-banner');
    if (!banner) return;
    banner.classList.remove('hidden');
    document.getElementById('update-reload')?.addEventListener('click', () => location.reload());
  }

  const hadController = !!navigator.serviceWorker.controller;   // false on the very first install
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;                    // first install: nothing to update
    if (hasWorkInProgress()) { showUpdateBanner(); return; }
    reloading = true;
    location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        // An installed app can stay open for days: look for a new version whenever it comes back to the screen
        document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update(); });
      })
      .catch((err) => console.warn('Service worker registration failed:', err));
  });

  // Development: drop a worker (and its caches) left over from earlier visits, once, and reload clean
  function removeServiceWorkers() {
    const hadWorker = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .then(() => (typeof caches !== 'undefined' ? caches.keys() : []))
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cotuong-')).map((k) => caches.delete(k))))
      .then(() => {
        if (hadWorker && !sessionStorage.getItem('cotuong-sw-removed')) {
          sessionStorage.setItem('cotuong-sw-removed', '1');
          location.reload();
        }
      })
      .catch(() => {});
  }
})();
