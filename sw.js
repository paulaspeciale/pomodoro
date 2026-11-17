// sw.js - Service Worker sin dependencias externas
// Workbox eliminado: todas las estrategias implementadas de forma nativa
// para garantizar funcionamiento offline desde la primera instalación.
'use strict';

const swUrl = new URL(self.location.href);
const _vParam = swUrl.searchParams.get('v');

const CACHE_VERSION = _vParam || (() => {
    const d = new Date();
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
})();

if (!_vParam) {
    console.warn(
        '[SW] Registrado sin ?v= explícito. Usando fecha UTC como versión de emergencia:',
        CACHE_VERSION,
        '— Para builds en producción, inyecta el hash del build en el registro del SW ' +
        '(ver sw-register.js: navigator.serviceWorker.register(`./sw.js?v=${swVersion}`))'
    );
    // El mensaje SW_FALLBACK_ACTIVE se envía desde el evento activate (tras clients.claim())
    // para garantizar que el SW ya controla los clientes en el momento del postMessage.
}

const SHELL_CACHE   = `pomodoro-shell-${CACHE_VERSION}`;
const SOUNDS_CACHE  = 'pomodoro-sounds-v1';
const CDN_CACHE     = 'pomodoro-cdn-libs-v2';
const PAGES_CACHE   = 'pomodoro-pages-v1';
const STATIC_CACHE  = 'pomodoro-static-v1';

const APP_SHELL_ASSETS = [
    './',
    // index.html se cachea explícitamente en cacheDiscoveredShellAssets()
    // junto con el descubrimiento de sus assets — no duplicar aquí.
    './pomodoro.css',
    './pomodoro.js',
    './i18n.js',
    './locales/es.json',
    './locales/en.json',
    './locales/pt.json',
    './sw-register.js',
    './theme-init.js',
    './manifest.json',
    './img/icons/favicon.svg',
    './img/icons/icon-pomodoro.svg',
    './img/icons/apple-touch-icon.png',
    './img/icons/icon-192.png',
    './img/icons/icon-512.png',
    './img/icons/icon-maskable-512.png'
];

// Librerías externas imprescindibles para el uso offline desde la primera
// instalación. El precache del shell solo descubre assets del mismo origen,
// así que estas URLs se cachean explícitamente en CDN_CACHE.
const CDN_PRECACHE = [
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/webfonts/fa-solid-900.woff2',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/webfonts/fa-brands-400.woff2',
    'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/howler/2.2.4/howler.min.js'
];

// ==================== INSTALL ====================
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        Promise.allSettled([
            cacheDiscoveredShellAssets(SHELL_CACHE),
            precacheCdnLibs()
        ])
    );
});

// ==================== ACTIVATE ====================
self.addEventListener('activate', event => {
    const expectedCaches = [
        SHELL_CACHE,
        SOUNDS_CACHE,
        CDN_CACHE,
        PAGES_CACHE,
        STATIC_CACHE
    ];
    event.waitUntil(
        Promise.all([
            self.clients.claim().then(() => {
                // Notificar a los clientes activos DESPUÉS de claim() para que
                // el SW ya controle las páginas en el momento del postMessage.
                // En install el SW aún no es el activo, así que matchAll devolvía
                // lista vacía y el mensaje nunca llegaba.
                if (!_vParam) {
                    self.clients.matchAll({ type: 'window' }).then(clients => {
                        clients.forEach(client => client.postMessage({ type: 'SW_FALLBACK_ACTIVE' }));
                    });
                }
            }),
            caches.keys().then(keys =>
                Promise.all(
                    keys
                        .filter(k => k.startsWith('pomodoro-') && !expectedCaches.includes(k))
                        .map(k => {
                            console.log('[SW] Eliminando cache obsoleta:', k);
                            return caches.delete(k);
                        })
                )
            )
        ])
    );
});

// ==================== FETCH ====================
self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // Petición de versión del registro (sw-register.js): siempre red, nunca caché.
    // Evita llenar SHELL_CACHE con una URL distinta en cada carga.
    if (url.searchParams.has('_swv')) {
        event.respondWith(fetch(request).catch(() => Response.error()));
        return;
    }

    // Navegación → NetworkFirst con fallback a index.html
    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request, PAGES_CACHE, './index.html'));
        return;
    }

    // Sonidos → CacheFirst (grandes, cambian poco). La ruta real es /sounds/,
    // no /img/sounds/ (bug histórico que dejaba el audio en SHELL_CACHE).
    if (url.origin === self.location.origin && /(^|\/)sounds\//.test(url.pathname)) {
        event.respondWith(cacheFirst(request, SOUNDS_CACHE));
        return;
    }

    // CDN externas (Howler, confetti, Font Awesome, Cafecito) → StaleWhileRevalidate
    if (
        url.hostname === 'cdnjs.cloudflare.com' ||
        url.hostname === 'cdn.jsdelivr.net' ||
        url.hostname === 'cdn.cafecito.app'
    ) {
        event.respondWith(staleWhileRevalidate(request, CDN_CACHE));
        return;
    }

    // Scripts y estilos propios → StaleWhileRevalidate con SHELL_CACHE.
    // Los assets propios se pre-cachean en SHELL_CACHE durante install, por lo que
    // staleWhileRevalidate los sirve instantáneamente offline desde ese caché.
    if (request.destination === 'script' || request.destination === 'style') {
        event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
        return;
    }

    // Imágenes, manifest, documentos → StaleWhileRevalidate
    if (
        request.destination === 'image' ||
        request.destination === 'manifest' ||
        request.destination === 'document'
    ) {
        event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
        return;
    }

    // Resto de assets del mismo origen → StaleWhileRevalidate
    if (url.origin === self.location.origin) {
        event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    }
});

// ==================== NOTIFICACIONES ====================
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then(clientList => {
            if (clientList.length > 0) return clientList[0].focus();
            return self.clients.openWindow('./index.html');
        })
    );
});

// ==================== ESTRATEGIAS DE CACHE ====================

async function networkFirst(request, cacheName, fallbackUrl) {
    const cache = await caches.open(cacheName);
    // Timeout de red: una conexión colgada no debe bloquear la navegación
    // indefinidamente; si expira, se sirve la copia cacheada.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
        const response = await fetch(request, { signal: controller.signal });
        if (response.status === 200) {
            cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    } catch (_) {
        // 1. Match exacto
        const exactMatch = await cache.match(request);
        if (exactMatch) return exactMatch;
        // 2. Sin query params (?source=pwa, ?preset=classic, etc.)
        const urlWithoutParams = new URL(request.url);
        urlWithoutParams.search = '';
        const cleanMatch = await cache.match(urlWithoutParams.href);
        if (cleanMatch) return cleanMatch;
        // 3. Fallback a index.html (para navegación SPA offline)
        if (fallbackUrl) {
            const base = self.location.href.replace(/\/[^/]*$/, '/');
            const shellCache = await caches.open(SHELL_CACHE);
            // Intentar todas las variantes de la URL de fallback que pueden
            // haber sido usadas como clave durante el precache.
            const fallbackVariants = [
                new URL(fallbackUrl, base).href,                      // absoluta: https://…/index.html
                fallbackUrl,                                           // relativa: ./index.html
                new URL(fallbackUrl, base).href.replace(/index\.html$/, ''), // sin filename
            ];
            for (const variant of fallbackVariants) {
                const fallback = (await cache.match(variant)) || (await shellCache.match(variant));
                if (fallback) return fallback;
            }
        }
        return Response.error();
    } finally {
        clearTimeout(timeoutId);
    }
}

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    // Cache.match ignora los headers de la petición (incluido Range), así que un
    // audio completo cacheado también sirve peticiones parciales del elemento <audio>.
    const cached = await cache.match(request);
    if (cached) return cached;
    // No cachear respuestas 206 Partial Content: guardarían fragmentos incompletos.
    const isRangeRequest = request.headers.has('range');
    try {
        const response = await fetch(request);
        if (!isRangeRequest && response.status === 200) {
            cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    } catch (_) {
        return Response.error();
    }
}

async function staleWhileRevalidate(request, cacheName) {
    const cache  = await caches.open(cacheName);
    const cached = await cache.match(request);
    const fetchPromise = fetch(request)
        .then(response => {
            // Cachear respuestas válidas y también opacas (no-cors): si una CDN
            // no envía cabeceras CORS, `ok` es false pero la respuesta sirve offline.
            if (response && (response.ok || response.type === 'opaque')) {
                cache.put(request, response.clone()).catch(() => {});
            }
            return response;
        })
        .catch(() => null);
    return cached || (await fetchPromise) || Response.error();
}

// ==================== PRECACHE AL INSTALAR ====================

async function precacheCdnLibs() {
    const cache = await caches.open(CDN_CACHE);
    const results = await Promise.allSettled(
        CDN_PRECACHE.map(async url => {
            if (await cache.match(url)) return;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            try {
                const response = await fetch(url, { cache: 'no-store', mode: 'cors', signal: controller.signal });
                if (!response.ok) throw new Error(`${url} respondió ${response.status}`);
                await cache.put(url, response);
            } finally {
                clearTimeout(timeoutId);
            }
        })
    );
    results
        .filter(r => r.status === 'rejected')
        .forEach(r => console.warn('[SW] Librería CDN no cacheada:', r.reason));
}

async function cacheDiscoveredShellAssets(cacheName) {
    const cache = await caches.open(cacheName);
    const urls  = new Set();
    const base  = self.location.href.replace(/\/[^/]*$/, '/');

    APP_SHELL_ASSETS.forEach(url => {
        try { urls.add(new URL(url, base).href); } catch (_) { urls.add(url); }
    });

    try {
        const indexResponse = await fetch('./index.html', { cache: 'no-store' });
        if (indexResponse.ok) {
            const html = await indexResponse.text();
            // Cachear el index además de descubrir assets
            await cache.put(new URL('./index.html', base).href, new Response(html, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            }));
            extractLocalAssetUrls(html, base).forEach(url => urls.add(url));
        }
    } catch (err) {
        console.info('[SW] No se pudo descubrir assets desde index.html:', err.message);
    }

    const results = await Promise.allSettled(
        [...urls].map(async url => {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error(`${url} respondió ${response.status}`);
            await cache.put(url, response);
        })
    );

    results
        .filter(r => r.status === 'rejected')
        .forEach(r => console.warn('[SW] Asset no cacheado:', r.reason));
}

function extractLocalAssetUrls(html, base) {
    const urls = [];
    const seen = new Set();

    const add = (rawUrl) => {
        if (!rawUrl || seen.has(rawUrl)) return;
        if (!/\.(?:css|js|svg|json|png|webp|jpg|jpeg)(?:[?#].*)?$/i.test(rawUrl)) return;
        try {
            const parsed = new URL(rawUrl, base || self.location.href);
            if (parsed.origin !== self.location.origin) return;
            parsed.search = '';
            parsed.hash   = '';
            if (!seen.has(parsed.href)) {
                seen.add(parsed.href);
                urls.push(parsed.href);
            }
        } catch (_) {}
    };

    // Atributos href/src en etiquetas HTML
    const attrPattern = /\s(?:href|src)=["']([^"']+)["']/gi;
    let match;
    while ((match = attrPattern.exec(html)) !== null) add(match[1]);

    // url() en bloques <style> o atributos style= del HTML
    const cssUrlPattern = /url\(["']?([^"')]+)["']?\)/gi;
    while ((match = cssUrlPattern.exec(html)) !== null) add(match[1]);

    return urls;
}
