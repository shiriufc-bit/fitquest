// ══ FitQuest Service Worker v96 ══
// Gerado em: 09/08/2026 
const CACHE_NAME = 'fitquest-v191';

const ASSETS = [
  '/fitquest/',
  '/fitquest/index.html',
  '/fitquest/manifest.json',
  '/fitquest/icon-192.png',
  '/fitquest/icon-512.png',
  // Bibliotecas de PDF servidas do próprio domínio: entram no cache junto com o
  // app, então a geração de PDF passa a funcionar mesmo sem internet.
  '/fitquest/lib/jspdf.umd.min.js',
  '/fitquest/lib/jspdf.plugin.autotable.min.js',
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
    url.hostname.includes('jsdelivr.net') ||
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('api.emailjs.com') ||
    url.hostname.includes('api.qrserver.com')
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
        // Só devolve a página inicial pra navegação. Antes, QUALQUER requisição
        // que falhasse recebia o HTML de volta — inclusive scripts .js, que
        // quebravam ao ser executados como se fossem JavaScript.
        if(e.request.mode === 'navigate') return caches.match('/fitquest/');
        return Response.error();
      });
    })
  );
});
