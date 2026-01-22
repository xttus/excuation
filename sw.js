/* Minimal offline cache for static assets (served over http/https). */
// Bump this to invalidate old caches when shipping changes.
const CACHE_NAME = "execpanel-mvp-v6";
const ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./storage.js", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k)))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  event.respondWith(
    (async () => {
      const url = new URL(request.url);
      const sameOrigin = url.origin === self.location.origin;

      // For core assets, prefer network-first so updates are visible without manual cache clearing.
      if (sameOrigin && ASSETS.some((p) => url.pathname.endsWith(p.replace("./", "/")) || (p === "./" && url.pathname === "/"))) {
        try {
          const resp = await fetch(new Request(request, { cache: "reload" }));
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => {});
          return resp;
        } catch {
          return (await caches.match(request)) || Response.error();
        }
      }

      const cached = await caches.match(request);
      if (cached) return cached;

      try {
        const resp = await fetch(request);
        if (sameOrigin) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => {});
        }
        return resp;
      } catch {
        return cached || Response.error();
      }
    })()
  );
});
