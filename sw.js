// Offline cache. Bump VERSION whenever files change so installed copies pick up the update.
const VERSION = 'smm-v4';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './src/ui/app.js', './src/ui/app-lang.js', './src/ui/components.js', './src/ui/dom.js', './src/ui/icons.js', './src/ui/runtime.js',
  './src/ui/i18n/index.js', './src/ui/i18n/pseudo.js', './src/ui/i18n/de.js', './src/ui/i18n/tr.js', './src/ui/i18n/fa.js',
  './src/ui/screens/home.js', './src/ui/screens/products.js', './src/ui/screens/stock.js', './src/ui/screens/orders.js',
  './src/ui/screens/reports.js', './src/ui/screens/settings.js',
  './src/core/alerts.js', './src/core/context.js', './src/core/csv.js', './src/core/dates.js', './src/core/demo.js',
  './src/core/forecast.js', './src/core/format.js', './src/core/inventory.js', './src/core/io.js', './src/core/locales.js',
  './src/core/model.js', './src/core/numbers.js', './src/core/reports.js', './src/core/store.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Stale-while-revalidate for our own files only.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const network = fetch(e.request).then((res) => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    }),
  );
});
