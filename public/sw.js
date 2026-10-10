const CACHE = 'nipo-shell-v2';
const SHELL = [
  '/', '/index.html', '/local.js', '/styles.css',
  '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE)
    .then(cache => Promise.all(SHELL.map(url => cache.add(url).catch(()=>{}))))
    .then(()=>self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then(hit => hit || fetch(event.request).then(res=>{
      if(res && res.ok) caches.open(CACHE).then(c=>c.put(event.request,res.clone())).catch(()=>{});
      return res;
    }).catch(()=> event.request.mode==='navigate' ? caches.match('/index.html') : undefined))
  );
});
