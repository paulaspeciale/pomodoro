// sw.js - Service Worker con Workbox + fallback offline sin CDN
'use strict';

const WORKBOX_CDN_URL = 'https://storage.googleapis.com/workbox-cdn/releases/7.3.0/workbox-sw.js';

let workboxLoadError = null;
try {
    importScripts(WORKBOX_CDN_URL);
} catch (err) {
    workboxLoadError = err;
}

const swUrl = new URL(self.location.href);
const CACHE_VERSION = swUrl.searchParams.get('v') || 'unversioned';
if (CACHE_VERSION === 'unversioned') {
    console.warn('[SW] Registrado sin version automatica. El precache puede quedar obsoleto.');
}

const SHELL_CACHE = `pomodoro-shell-${CACHE_VERSION}`;
const FALLBACK_CACHE = `pomodoro-fallback-${CACHE_VERSION}`;
const APP_SHELL_ASSETS = [
    './',
    './index.html',
    './pomodoro.css',
    './pomodoro.js',
    './manifest.json',
    './robots.txt',
    './sitemap.xml',
    './icons/favicon.svg',
    './icons/icon-pomodoro.svg',
    './sounds/ocean.mp3',
    './sounds/pinknoise.mp3',
    './sounds/rain.mp3',
    './sounds/whitenoise.mp3',
    './sounds/woods.mp3'
];

const hasWorkbox = typeof workbox !== 'undefined' && workbox;

if (hasWorkbox) {
    console.log('Workbox cargado correctamente');

    // Activate the new SW immediately on install, without waiting for existing
    // tabs to close. Combined with clients.claim() in activate, this ensures
    // users always get the latest version after a deploy.
    workbox.core.skipWaiting();
    workbox.core.clientsClaim();

    // Precaching de archivos esenciales. CACHE_VERSION viene del registro del SW
    // y cambia automaticamente cuando index.html se actualiza en el servidor.
    // ignoreURLParametersMatching asegura que './index.html?source=pwa' y
    // './index.html?preset=classic' sirvan desde el mismo precache que './index.html'.
    // Sin esto, la primera apertura offline desde el shortcut o el start_url de la PWA
    // puede fallar porque el parámetro de query no coincide con la URL cacheada.
    workbox.precaching.precacheAndRoute(
        APP_SHELL_ASSETS.map(url => ({ url, revision: CACHE_VERSION })),
        { ignoreURLParametersMatching: [/.*/] }
    );

    self.addEventListener('install', event => {
        event.waitUntil(cacheDiscoveredShellAssets(SHELL_CACHE));
    });

    workbox.routing.registerRoute(
        ({ request }) => request.mode === 'navigate',
        new workbox.strategies.NetworkFirst({ cacheName: 'pomodoro-pages-v1' })
    );

    // includes('/sounds/') tolera apps servidas desde subdirectorios
    workbox.routing.registerRoute(
        ({ url }) => url.pathname.includes('/sounds/'),
        new workbox.strategies.CacheFirst({
            cacheName: 'pomodoro-sounds-v1',
            plugins: [
                new workbox.expiration.ExpirationPlugin({
                    maxEntries: 10,
                    maxAgeSeconds: 60 * 60 * 24 * 90 // 90 dias
                })
            ]
        })
    );

    // Cachear librerias CDN externas (Howler, confetti) para que funcionen offline
    workbox.routing.registerRoute(
        ({ url }) =>
            url.hostname === 'cdnjs.cloudflare.com' ||
            url.hostname === 'cdn.jsdelivr.net',
        new workbox.strategies.StaleWhileRevalidate({
            cacheName: 'pomodoro-cdn-libs-v1',
            plugins: [
                new workbox.expiration.ExpirationPlugin({
                    maxEntries: 20,
                    maxAgeSeconds: 60 * 60 * 24 * 90 // 90 dias
                })
            ]
        })
    );

    // Estrategia NetworkFirst para el resto de assets
    workbox.routing.registerRoute(
        ({ request }) => request.destination === 'script' || request.destination === 'style',
        new workbox.strategies.NetworkFirst({ cacheName: 'pomodoro-assets-v1' })
    );

    workbox.routing.registerRoute(
        ({ request }) =>
            request.destination === 'image' ||
            request.destination === 'manifest' ||
            request.destination === 'document',
        new workbox.strategies.StaleWhileRevalidate({ cacheName: 'pomodoro-static-v1' })
    );

    // ==================== LIMPIEZA DE CACHES OBSOLETAS ====================
    // Eliminar caches de versiones anteriores al activar el SW.
    // Se usan los nombres exactos de los caches propios de la app; el cache
    // interno de Workbox (workbox-precache-v2) se preserva implicitamente
    // porque su nombre no empieza por 'pomodoro-'.
    // Nota: skipWaiting() y clientsClaim() arriba hacen que este activate
    // se dispare inmediatamente; el waitUntil garantiza que la limpieza
    // completa antes de que el SW responda a fetch del nuevo cliente.
    self.addEventListener('activate', event => {
        const expectedCaches = [
            'pomodoro-sounds-v1',
            'pomodoro-cdn-libs-v1',
            'pomodoro-assets-v1',
            'pomodoro-pages-v1',
            'pomodoro-static-v1',
            SHELL_CACHE,
            FALLBACK_CACHE  // Bug fix: incluir FALLBACK_CACHE para limpiar versiones antiguas
        ];
        event.waitUntil(
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
        );
    });
} else {
    console.error('Workbox no se pudo cargar. Activando fallback offline.', workboxLoadError);

    self.addEventListener('install', event => {
        self.skipWaiting();
        event.waitUntil(
            cacheDiscoveredShellAssets(FALLBACK_CACHE)
                .catch(err => {
                    console.error('[SW fallback] No se pudo preparar el cache offline:', err);
                })
        );
    });

    self.addEventListener('activate', event => {
        event.waitUntil(
            Promise.all([
                self.clients.claim(),
                caches.keys().then(keys =>
                    Promise.all(
                        keys
                            .filter(k => k.startsWith('pomodoro-') && k !== FALLBACK_CACHE)
                            .map(k => caches.delete(k))
                    )
                ),
                notifyClients({
                    type: 'SW_FALLBACK_ACTIVE',
                    message: 'Modo offline basico activo: no se pudo cargar Workbox.'
                })
            ])
        );
    });

    self.addEventListener('fetch', event => {
        const { request } = event;
        if (request.method !== 'GET') return;

        const url = new URL(request.url);
        if (request.mode === 'navigate') {
            // Servir index.html para cualquier navegación, ignorando parámetros de query
            // (ej. ?source=pwa del start_url o ?preset=classic de los shortcuts).
            event.respondWith(networkFirst(request, './index.html'));
            return;
        }

        if (url.origin === self.location.origin && url.pathname.includes('/sounds/')) {
            event.respondWith(cacheFirst(request));
            return;
        }

        if (
            url.origin === self.location.origin ||
            url.hostname === 'cdnjs.cloudflare.com' ||
            url.hostname === 'cdn.jsdelivr.net'
        ) {
            event.respondWith(staleWhileRevalidate(request));
        }
    });
}

// ==================== NOTIFICACIONES PUSH / LOCAL ====================
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(clientList => {
            if (clientList.length > 0) {
                return clientList[0].focus();
            }
            return clients.openWindow('./index.html');
        })
    );
});

async function networkFirst(request, fallbackUrl) {
    const cache = await caches.open(FALLBACK_CACHE);
    try {
        const response = await fetch(request);
        cache.put(request, response.clone());
        return response;
    } catch (_) {
        // Intentar match exacto primero; luego sin query params (para ?source=pwa, ?preset=...)
        const exactMatch = await cache.match(request);
        if (exactMatch) return exactMatch;
        const urlWithoutParams = new URL(request.url);
        urlWithoutParams.search = '';
        const cleanMatch = await cache.match(urlWithoutParams.href);
        if (cleanMatch) return cleanMatch;
        return (await cache.match(fallbackUrl)) || Response.error();
    }
}

async function cacheFirst(request) {
    const cache = await caches.open(FALLBACK_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(FALLBACK_CACHE);
    const cached = await cache.match(request);
    const fetched = fetch(request)
        .then(response => {
            cache.put(request, response.clone());
            return response;
        })
        .catch(() => null);

    return cached || (await fetched) || Response.error();
}

async function notifyClients(payload) {
    const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    clientList.forEach(client => client.postMessage(payload));
}

async function cacheDiscoveredShellAssets(cacheName) {
    const cache = await caches.open(cacheName);
    const urls = new Set(APP_SHELL_ASSETS);

    try {
        const indexResponse = await fetch('./index.html', { cache: 'no-store' });
        if (indexResponse.ok) {
            const html = await indexResponse.text();
            extractLocalAssetUrls(html).forEach(url => urls.add(url));
        }
    } catch (err) {
        console.warn('[SW] No se pudieron descubrir assets locales desde index.html:', err);
    }

    const results = await Promise.allSettled(
        [...urls].map(async url => {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error(`${url} respondio ${response.status}`);
            await cache.put(url, response);
        })
    );

    results
        .filter(result => result.status === 'rejected')
        .forEach(result => console.warn('[SW] Asset no cacheado:', result.reason));
}

function extractLocalAssetUrls(html) {
    const urls = [];
    const attrPattern = /\s(?:href|src)=["']([^"']+)["']/gi;
    let match;

    while ((match = attrPattern.exec(html)) !== null) {
        const rawUrl = match[1];
        if (!/\.(?:css|js)(?:[?#].*)?$/i.test(rawUrl)) continue;

        try {
            const parsed = new URL(rawUrl, self.location.href);
            if (parsed.origin !== self.location.origin) continue;
            urls.push(parsed.pathname.split('/').pop() === rawUrl ? `./${rawUrl}` : parsed.href);
        } catch (_) {}
    }

    return urls;
}
