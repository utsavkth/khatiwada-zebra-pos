/* Service worker: keeps the cashier opening and running when the server is
   unreachable (shop internet out, or the Sydney Pi down). Served at /sw.js by
   a Flask route so its scope covers the whole app.

   Strategy:
   - Navigations ("/"): network-first so a deploy is picked up immediately,
     falling back to the last cached copy when offline.
   - /static/*: cache-first — every static URL carries a ?v= content hash
     (see app.py cache-busting), so a cached response is immutable; new
     deploys produce new URLs and old entries are pruned on activate.
   - /media/* (product photos): cache-first — uploads get a unique filename
     per save, so these are immutable too.
   - /api/*: network only, never cached. Offline behaviour for API data is
     handled in app code against the IndexedDB catalog mirror (offline.js),
     which stays consistent as one snapshot instead of per-URL crumbs.

   Data (catalog mirror, sales outbox) lives in IndexedDB, not here. */

const CACHE = "zebra-shell-v1";

/* The app shell + assets referenced without a ?v= hash from JS/manifest.
   Hash-versioned asset URLs are cached at runtime on first use. */
const PRECACHE = [
  "/",
  "/static/fonepay-static-qr.jpg",
  "/static/manifest.json",
  "/static/icon-192.png",
  "/static/icon-512.png",
  "/static/favicon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(request, cacheKey) {
  return caches.open(CACHE).then((cache) =>
    fetch(request)
      .then((response) => {
        if (response.ok) cache.put(cacheKey || request, response.clone());
        return response;
      })
      .catch(() => cache.match(cacheKey || request))
  );
}

function cacheFirst(request) {
  return caches.open(CACHE).then((cache) =>
    cache.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
    )
  );
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin")) return;

  if (event.request.mode === "navigate" || url.pathname === "/") {
    // All navigations fall back to the cached shell — the cashier is the
    // only page this app needs to open offline.
    event.respondWith(networkFirst(event.request, "/"));
    return;
  }
  if (url.pathname.startsWith("/static/") || url.pathname.startsWith("/media/")) {
    event.respondWith(cacheFirst(event.request));
  }
});
