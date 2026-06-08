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
        '(ver index.html: navigator.serviceWorker.register(`./sw.js?v=${swVersion}`))'
    );
    // El mensaje SW_FALLBACK_ACTIVE se envía desde el evento activate (tras clients.claim())
    // para garantizar que el SW ya controla los clientes en el momento del postMessage.
}

const SHELL_CACHE   = `pomodoro-shell-${CACHE_VERSION}`;
const SOUNDS_CACHE  = 'pomodoro-sounds-v1';
const CDN_CACHE     = 'pomodoro-cdn-libs-v1';
const ASSETS_CACHE  = 'pomodoro-assets-v1';
const PAGES_CACHE   = 'pomodoro-pages-v1';
const STATIC_CACHE  = 'pomodoro-static-v1';

const APP_SHELL_ASSETS = [
    './',
    // index.html se cachea explícitamente en cacheDiscoveredShellAssets()
    // junto con el descubrimiento de sus assets — no duplicar aquí.
    './pomodoro.css',
    './pomodoro.js',
    './sw-register.js',
    './manifest.json',
    './icons/favicon.svg',
    './icons/icon-pomodoro.svg',
    './icons/apple-touch-icon.png'
];

// ==================== INSTALL ====================
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        cacheDiscoveredShellAssets(SHELL_CACHE)
            .catch(err => console.error('[SW] No se pudo preparar el cache offline:', err))
    );
});

// ==================== ACTIVATE ====================
self.addEventListener('activate', event => {
    const expectedCaches = [
        SHELL_CACHE,
        SOUNDS_CACHE,
        CDN_CACHE,
        ASSETS_CACHE,
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

    // Navegación → NetworkFirst con fallback a index.html
    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request, PAGES_CACHE, './index.html'));
        return;
    }

    // Sonidos → CacheFirst (grandes, cambian poco)
    if (url.origin === self.location.origin && url.pathname.includes('/sounds/')) {
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
    // NetworkFirst con ASSETS_CACHE era incorrecto: fallaba offline porque ASSETS_CACHE
    // empieza vacío y los scripts están en SHELL_CACHE, no en ASSETS_CACHE.
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
    try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
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
            // Intentar todas las variantes de la URL de fallback que pueden
            // haber sido usadas como clave durante el precache.
            const fallbackVariants = [
                new URL(fallbackUrl, base).href,                      // absoluta: https://…/index.html
                fallbackUrl,                                           // relativa: ./index.html
                new URL(fallbackUrl, base).href.replace(/index\.html$/, ''), // sin filename
            ];
            for (const variant of fallbackVariants) {
                const fallback = await cache.match(variant);
                if (fallback) return fallback;
            }
        }
        return Response.error();
    }
}

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
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
            if (response.ok) cache.put(request, response.clone());
            return response;
        })
        .catch(() => null);
    return cached || (await fetchPromise) || Response.error();
}

// ==================== PRECACHE AL INSTALAR ====================

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
