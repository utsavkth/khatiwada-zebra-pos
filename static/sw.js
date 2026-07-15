/* Service worker: keeps the cashier opening and running when the server is
   unreachable (shop internet out, or the Sydney Pi down). Served at /sw.js by
   a Flask route so its scope covers the whole app.

   Strategy:
   - Navigations ("/"): network-first, with a short timeout so a genuinely
     dead connection falls back to the cached shell in seconds rather than
     however long the OS/browser takes to give up on a real TCP/DNS attempt
     (observed on-device: several minutes, not the near-instant failure a
     laptop dev-tools "offline" toggle gives — the difference between "no
     network interface" and "network up but nothing answers", which is the
     realistic shape of a Tailscale/Pi outage).
   - /static/*: cache-first — every static URL carries a ?v= content hash
     (see app.py cache-busting), so a cached response is immutable; new
     deploys produce new URLs and old entries are pruned on activate.
   - /media/* (product photos): cache-first — uploads get a unique filename
     per save, so these are immutable too.
   - /api/*: network only, never cached. Offline behaviour for API data is
     handled in app code against the IndexedDB catalog mirror (offline.js),
     which stays consistent as one snapshot instead of per-URL crumbs.

   Data (catalog mirror, sales outbox) lives in IndexedDB, not here. */

const CACHE = "zebra-shell-v2";
const FETCH_TIMEOUT_MS = 4000;

/* The app shell + assets referenced without a ?v= hash from JS/manifest.
   Hash-versioned asset URLs are cached at runtime on first use.

   Cached individually (not cache.addAll, which is all-or-nothing: one slow
   or flaky fetch — over Tailscale to Sydney, on first install, the QR jpg
   is the biggest single file here — used to fail the ENTIRE install, so
   NOTHING got cached and the app had no offline shell at all). A precache
   miss here is not fatal: the fonepay QR and icons also get cached
   opportunistically by cacheFirst() the first time they're actually
   fetched (e.g. opening the payment step once while online). */
const PRECACHE = [
  "/",
  "/static/fonepay-static-qr.jpg",
  "/static/manifest.json",
  "/static/icon-192.png",
  "/static/icon-512.png",
  "/static/favicon.svg",
];

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("sw: fetch timed out")), ms);
    fetch(request).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(PRECACHE.map((url) => cache.add(url))).then(() => self.skipWaiting())
    )
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
    fetchWithTimeout(request, FETCH_TIMEOUT_MS)
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
        fetchWithTimeout(request, FETCH_TIMEOUT_MS).then((response) => {
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
