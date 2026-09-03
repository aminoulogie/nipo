// Service worker for the app shell.
//
// Scope is deliberately narrow: it caches the files that make up the app, and
// nothing else. Subsonic API calls and audio streams are always network-only —
// they are personal, they can be very large, and downloaded tracks already
// live in IndexedDB, which is the right store for them.
//
// Bump CACHE when the shell changes so old entries are cleared on activate.

const CACHE = 'nipo-shell-v1';

const SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/extras.js',
  '/styles.css',
  '/md5.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll fails the whole install if any single file 404s, so entries are
      // added individually and a miss is tolerated.
      .then((cache) => Promise.all(
        SHELL.map((url) => cache.add(url).catch(() => {})),
      ))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the API or audio: responses are user-specific, streamed, and
  // range-requested, none of which belongs in a shell cache.
  if (url.pathname.startsWith('/rest/')) return;

  // Network-first for the shell, so a running server always wins and the
  // cache is only a fallback. Cache-first would mean deploys did not reach
  // the phone until the cache was cleared, which is the failure mode this
  // project has already been bitten by.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => (
        hit || (req.mode === 'navigate' ? caches.match('/index.html') : undefined)
      ))),
  );
});
