// ══ FitQuest Service Worker v48 ══
// Gerado em: 01/08/2026
const CACHE_NAME = 'fitquest-v121';

const ASSETS = [
  '/fitquest/',
  '/fitquest/index.html',
  '/fitquest/manifest.json',
  '/fitquest/icon-192.png',
  '/fitquest/icon-512.png',
  '/fitquest/exercicios/e001.gif',
  '/fitquest/exercicios/e002.gif',
  '/fitquest/exercicios/e003.gif',
  '/fitquest/exercicios/e004.gif',
  '/fitquest/exercicios/e005.gif',
  '/fitquest/exercicios/e006.gif',
  '/fitquest/exercicios/e007.gif',
  '/fitquest/exercicios/e008.gif',
  '/fitquest/exercicios/e009.gif',
  '/fitquest/exercicios/e010.gif',
  '/fitquest/exercicios/e011.gif',
  '/fitquest/exercicios/e013.gif',
  '/fitquest/exercicios/e014.gif',
  '/fitquest/exercicios/e015.gif',
  '/fitquest/exercicios/e016.gif',
  '/fitquest/exercicios/e017.gif',
  '/fitquest/exercicios/e018.gif',
  '/fitquest/exercicios/e019.gif',
  '/fitquest/exercicios/e020.gif',
  '/fitquest/exercicios/e021.gif',
  '/fitquest/exercicios/e022.gif',
  '/fitquest/exercicios/e023.gif',
  '/fitquest/exercicios/e024.gif',
  '/fitquest/exercicios/e026.gif',
  '/fitquest/exercicios/e027.gif',
  '/fitquest/exercicios/e028.gif',
  '/fitquest/exercicios/e030.gif',
  '/fitquest/exercicios/e037.gif',
  '/fitquest/exercicios/e041.gif',
  '/fitquest/exercicios/e045.gif',
  '/fitquest/exercicios/e046.gif',
  '/fitquest/exercicios/e050.gif',
  '/fitquest/exercicios/e051.gif',
  '/fitquest/exercicios/e052.gif',
  '/fitquest/exercicios/e053.gif',
  '/fitquest/exercicios/e054.gif',
  '/fitquest/exercicios/e061.gif',
  '/fitquest/exercicios/e063.gif',
  '/fitquest/exercicios/e075.gif',
  '/fitquest/exercicios/e077.gif',
  '/fitquest/exercicios/e079.gif',
  '/fitquest/exercicios/e113.gif',
  '/fitquest/exercicios/e120.gif',
  '/fitquest/exercicios/e131.gif',
  '/fitquest/exercicios/e136.gif',
  '/fitquest/exercicios/e144.gif',
  '/fitquest/exercicios/e149.gif',
  '/fitquest/exercicios/e152.gif',
  '/fitquest/exercicios/e182.gif',
  '/fitquest/exercicios/e193.gif',
  '/fitquest/exercicios/e196.gif',
  '/fitquest/exercicios/e203.gif',
  '/fitquest/exercicios/e217.gif',
  '/fitquest/exercicios/e218.gif',
  '/fitquest/exercicios/e225.gif',
  '/fitquest/exercicios/e237.gif',
  '/fitquest/exercicios/e238.gif',
  '/fitquest/exercicios/e239.gif',
  '/fitquest/exercicios/e240.gif',
  '/fitquest/exercicios/e241.gif',
  '/fitquest/exercicios/e242.gif',
  '/fitquest/exercicios/e243.gif',
  '/fitquest/exercicios/e244.gif',
  '/fitquest/exercicios/e245.gif',
  '/fitquest/exercicios/e246.gif',
  '/fitquest/exercicios/e247.gif',
  '/fitquest/exercicios/e248.gif',
  '/fitquest/exercicios/e249.gif',
  '/fitquest/exercicios/e250.gif',
  '/fitquest/exercicios/e251.gif',
  '/fitquest/exercicios/e252.gif',
  '/fitquest/exercicios/e253.gif',
  '/fitquest/exercicios/e254.gif',
  '/fitquest/exercicios/e255.gif',
  '/fitquest/exercicios/e256.gif',
  '/fitquest/exercicios/e257.gif',
  '/fitquest/exercicios/e258.gif',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

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
      }).catch(() => caches.match('/fitquest/'));
    })
  );
});
