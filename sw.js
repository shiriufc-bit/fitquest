// ══ FitQuest Service Worker v4 ══
// Atualize este número a cada deploy para forçar atualização em todos os dispositivos
const CACHE_NAME = 'fitquest-v4';

const ASSETS = [
  '/fitquest/',
  '/fitquest/index.html',
  '/fitquest/manifest.json',
  '/fitquest/icon-192.png',
  '/fitquest/icon-512.png',
];

// ── INSTALL: cacheia os arquivos principais ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .catch(() => {})
  );
  self.skipWaiting();
});

// ── ACTIVATE: remove caches antigos ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── FETCH: serve do cache, busca na rede se não tiver ──
self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if(
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('anthropic.com') ||
    url.hostname.includes('mercadopago') ||
    url.hostname.includes('mpago') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('jsdelivr.net')
  ) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if(cached) return cached;
      return fetch(e.request).then(response => {
        if(!response || response.status !== 200 || response.type !== 'basic') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return response;
      }).catch(() => {
        return caches.match('/fitquest/') || caches.match('/fitquest/index.html');
      });
    })
  );
});
