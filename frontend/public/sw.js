/* Campaign HQ service worker: offline shell for field agents.
 *
 * - Hashed build assets (/_next/static) → cache-first (immutable).
 * - Page navigations → network-first, falling back to the last cached copy,
 *   so the capture screen opens with no signal.
 * - The API is NEVER cached here: it serves personal data and sets no-store.
 *   Offline captures are queued in IndexedDB by the app, not by this worker.
 */
const VERSION = "chq-v1";
const SHELL = ["/voters/new", "/dashboard", "/manifest.webmanifest", "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API, map tiles: straight to network

  if (url.pathname.startsWith("/_next/static/") || /\.(png|svg|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
        return res;
      })),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match("/voters/new"))),
    );
  }
});
