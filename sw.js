const CACHE_NAME = "gabriel-daily-reminder-v2";
const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./tablet-beta.css",
  "./app.js",
  "./tablet-beta.js",
  "./initial-state.json",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/gabriel-avatar.jpg",
  "./illustrations/morning-breakfast.jpg",
  "./illustrations/zoom-class.jpg",
  "./illustrations/living-english-hub.jpg",
  "./illustrations/toy-play.jpg",
  "./illustrations/book-reading.jpg",
  "./illustrations/gentle-stretch-art.jpg",
  "./illustrations/rest-recharge.jpg",
  "./illustrations/bedtime-sleep.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const reqUrl = new URL(event.request.url);

  // Never intercept local backend API endpoints on localhost:8098
  if (reqUrl.pathname.startsWith("/api/")) return;

  // Cache-first for static images & pre-generated neural voice MP3 clips
  const isMedia = /\.(mp3|jpg|jpeg|png|svg|ico)$/i.test(reqUrl.pathname);
  if (isMedia) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  // Network-first for HTML, JS, CSS & JSON so updates appear immediately, with full offline fallback
  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match("./index.html"))
      )
  );
});
