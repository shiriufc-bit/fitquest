// ══ FitQuest Service Worker v51 ══
// Cache seguro para GitHub Pages + Android/WebView.
// Regra principal: conteúdo dinâmico (HTML/JS/GIF) tenta a rede primeiro.
// Nunca devolver index.html como fallback para uma imagem/GIF.
const CACHE_NAME = 'fitquest-v140';

const ASSETS = [
  '/fitquest/',
  '/fitquest/index.html',
  '/fitquest/manifest.json',
  '/fitquest/icon-192.png',
  '/fitquest/icon-512.png',
  '/fitquest/gifler.min.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .catch(err => console.warn('FitQuest SW precache:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function isExternalBackend(url){
  return (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('anthropic.com') ||
    url.hostname.includes('mercadopago') ||
    url.hostname.includes('mpago') ||
    url.hostname.includes('googleapis.com')
  );
}

function isDynamicAsset(request, url){
  const p=url.pathname.toLowerCase();
  return (
    request.mode === 'navigate' ||
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'image' ||
    request.destination === 'font' ||
    p.endsWith('.html') ||
    p.endsWith('.js') ||
    p.endsWith('.json') ||
    p.endsWith('.gif') ||
    p.endsWith('.png') ||
    p.endsWith('.jpg') ||
    p.endsWith('.jpeg') ||
    p.endsWith('.webp')
  );
}

self.addEventListener('fetch', event => {
  const request=event.request;
  if(request.method !== 'GET') return;

  const url=new URL(request.url);
  if(isExternalBackend(url)) return;
  if(url.origin !== self.location.origin) return;

  if(isDynamicAsset(request,url)){
    event.respondWith(
      fetch(request,{cache:'no-store'}).then(response => {
        if(response && response.ok){
          const clone=response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request,clone)).catch(()=>{});
        }
        return response;
      }).catch(() =>
        caches.match(request).then(cached => {
          if(cached) return cached;
          // Somente navegação pode usar a página principal como fallback.
          if(request.mode === 'navigate'){
            return caches.match('/fitquest/index.html');
          }
          return Response.error();
        })
      )
    );
    return;
  }

  // Outros arquivos: cache primeiro, rede como fallback.
  event.respondWith(
    caches.match(request).then(cached =>
      cached || fetch(request).then(response => {
        if(response && response.ok){
          const clone=response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request,clone)).catch(()=>{});
        }
        return response;
      })
    )
  );
});
