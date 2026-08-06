// ══ FitQuest Service Worker v45 ══
// Atualizado em: 06/08/2026 — CSS com cores de reserva (fallback) no
// body/telas principais, pra nunca mais cair em fundo branco se a
// variável --bg falhar de carregar por qualquer motivo (cache, rede).
const CACHE_NAME = 'fitquest-v119';

const ASSETS = [
  '/fitquest/',
  '/fitquest/index.html',
  '/fitquest/manifest.json',
  '/fitquest/icon-192.png',
  '/fitquest/icon-512.png',

  // CSS
  '/fitquest/css/app.css',
  '/fitquest/css/auth.css',
  '/fitquest/css/treino.css',
  '/fitquest/css/admin.css',
  '/fitquest/css/corrida.css',

  // JS
  '/fitquest/js/supabase.js',
  '/fitquest/js/app.js',
  '/fitquest/js/auth.js',
  '/fitquest/js/treino.js',
  '/fitquest/js/corrida.js',
  '/fitquest/js/admin.js',
  '/fitquest/js/financeiro.js',
  '/fitquest/js/ebook.js',

  // Banco de dados (exercícios, treinos padrão, ebooks)
  '/fitquest/database/exercicios.json',
  '/fitquest/database/treinos.json',
  '/fitquest/database/ebooks.json',

  // Os gifs de exercícios (assets/gifs/*.gif) NÃO entram aqui de propósito:
  // são ~94 arquivos e crescendo. Ficam cacheados sob demanda pelo handler
  // de fetch abaixo, conforme o aluno realmente visualiza cada um.
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
