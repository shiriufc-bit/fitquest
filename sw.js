// ══ FitQuest Service Worker — cache seguro para Android/WebView ══
const CACHE_NAME = 'fitquest-v140';
const APP_SHELL = [
  '/fitquest/',
  '/fitquest/index.html',
  '/fitquest/manifest.json',
  '/fitquest/icon-192.png',
  '/fitquest/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(err => console.warn('SW install cache:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isExternalDynamic(url){
  return url.hostname.includes('supabase.co') ||
         url.hostname.includes('jsdelivr.net') ||
         url.hostname.includes('unpkg.com') ||
         url.hostname.includes('cdnjs.cloudflare.com') ||
         url.hostname.includes('googleapis.com') ||
         url.hostname.includes('mercadopago') ||
         url.hostname.includes('mpago') ||
         url.hostname.includes('anthropic.com');
}

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin || isExternalDynamic(url)) return;

  const isNavigation = event.request.mode === 'navigate';
  const isGif = url.pathname.toLowerCase().endsWith('.gif');

  event.respondWith((async()=>{
    try{
      // Para HTML e GIF, rede primeiro: evita Android preso em cache antigo.
      const network = await fetch(event.request, {cache:'no-store'});
      if(network && network.ok){
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, network.clone()).catch(()=>{});
        return network;
      }
    }catch(e){}

    // Só usamos cache como fallback para o próprio recurso solicitado.
    const cached = await caches.match(event.request);
    if(cached) return cached;

    // Apenas navegações podem cair no shell do app.
    if(isNavigation){
      const shell = await caches.match('/fitquest/index.html');
      if(shell) return shell;
    }

    // Nunca devolver index.html para GIF, JS, CSS, imagem etc.
    return new Response('', {status:404, statusText:'Offline'});
  })());
});
