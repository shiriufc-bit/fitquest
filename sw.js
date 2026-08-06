// ══ FitQuest Service Worker v46 ══
// Atualizado em: 06/08/2026 — de volta pra estrutura de arquivo único,
// DEFINITIVAMENTE. index.html contém HTML+CSS+JS+dados inline; só os
// gifs (assets/gifs/) continuam como arquivos externos, por serem
// binários. Menos arquivos = menos chance de algo ficar desalinhado
// no deploy manual.
const CACHE_NAME = 'fitquest-v120';

const ASSETS = [
  '/fitquest/',
  '/fitquest/index.html',
  '/fitquest/manifest.json',
  '/fitquest/icon-192.png',
  '/fitquest/icon-512.png',
  // Os gifs de exercício NÃO entram aqui de propósito: são ~94 arquivos
  // e crescendo. Ficam cacheados sob demanda pelo handler de fetch
  // abaixo, conforme o aluno realmente visualiza cada um.
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
    url.hostname.includes('cloudflare.com')
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
        if(e.request.mode === 'navigate') return caches.match('/fitquest/');
      });
    })
  );
});
