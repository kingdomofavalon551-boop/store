const CACHE = 'hanun-store-v2';
const ASSETS = [
  '/',
  '/index.html',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
  'https://unpkg.com/lucide@latest/dist/umd/lucide.min.js'
];

// Install: cache aset statis
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => {
      // Cache aset lokal saja, skip external yang bisa gagal
      return cache.addAll(['/']);
    }).catch(() => {})
  );
  self.skipWaiting();
});

// Activate: hapus cache lama
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: Network First untuk API, Cache First untuk aset
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API calls: selalu network, jangan cache
  if (url.hostname.includes('vercel.app') || url.pathname.startsWith('/api/')) {
    return; // biarkan browser handle normal
  }

  // Font & library: cache first
  if (url.hostname.includes('fonts.googleapis') ||
      url.hostname.includes('fonts.gstatic') ||
      url.hostname.includes('unpkg.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(resp => {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return resp;
        });
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // HTML utama: network first, fallback ke cache
  if (e.request.mode === 'navigate' || url.pathname === '/') {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return resp;
        })
        .catch(() => caches.match('/') || caches.match('/index.html'))
    );
  }
});
