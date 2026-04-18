/* ═══════════════════════════════════════════════════════════
   ACESSO LIVRE — Service Worker (PWA)
   Estratégia: Cache-First para o app shell,
               Network-First para o Firebase (dados ao vivo)
════════════════════════════════════════════════════════════ */

const CACHE_NAME    = 'acesso-livre-v2';
const CACHE_ASSETS  = [
    './index.html',
    './style.css',
    './app.js',
    './auth.js',
    './firebase-config.js',
    './questions.js',
    './logo.png',
    './manifest.json',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
];

// ── Instalação: pré-cache dos arquivos do app shell ───────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[SW] Pré-cache do app shell');
            // addAll com catch individual para não quebrar se uma fonte falhar offline
            return Promise.allSettled(
                CACHE_ASSETS.map(url => cache.add(url).catch(() => {}))
            );
        }).then(() => self.skipWaiting())
    );
});

// ── Ativação: limpa caches antigos ────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(k => k !== CACHE_NAME)
                    .map(k => { console.log('[SW] Removendo cache antigo:', k); return caches.delete(k); })
            )
        ).then(() => self.clients.claim())
    );
});

// ── Fetch: decide a estratégia por tipo de recurso ────────
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Firebase / APIs externas → sempre rede (dados ao vivo)
    if (
        url.hostname.includes('firestore.googleapis.com') ||
        url.hostname.includes('identitytoolkit.googleapis.com') ||
        url.hostname.includes('firebase') ||
        url.hostname.includes('googleapis.com')
    ) {
        return; // deixa passar direto para a rede
    }

    // Google Fonts → cache-first
    if (url.hostname.includes('fonts.gstatic.com') || url.hostname.includes('fonts.googleapis.com')) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                return cached || fetch(event.request).then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
                    return response;
                });
            })
        );
        return;
    }

    // App shell (HTML, CSS, JS, imagens) → cache-first, fallback para rede
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;

            return fetch(event.request).then(response => {
                // Só cacheia respostas válidas
                if (!response || response.status !== 200 || response.type === 'opaque') {
                    return response;
                }
                const clone = response.clone();
                caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
                return response;
            }).catch(() => {
                // Offline fallback: retorna o index.html
                if (event.request.destination === 'document') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});
