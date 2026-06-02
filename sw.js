// sw.js - Service Worker con Workbox + Notificaciones
importScripts('https://storage.googleapis.com/workbox-cdn/releases/7.3.0/workbox-sw.js');

// ⚠️ CACHE_VERSION: DEBE actualizarse en cada deploy para invalidar el precaché.
// Workbox usa la `revision` de cada entrada para decidir si re-descargar el archivo;
// si no cambias este valor, los usuarios seguirán viendo la versión antigua en offline
// aunque hayas subido nuevos assets al servidor.
// En un pipeline CI/CD puedes inyectar aquí el hash del build automáticamente.
const CACHE_VERSION = 'v10-2026-06-01';

if (workbox) {
    console.log('Workbox cargado correctamente');

    // Activate the new SW immediately on install, without waiting for existing
    // tabs to close. Combined with clients.claim() in activate, this ensures
    // users always get the latest version after a deploy.
    workbox.core.skipWaiting();
    workbox.core.clientsClaim();

    // Precaching de archivos esenciales.
    // La `revision` vinculada a CACHE_VERSION garantiza que al actualizar la constante
    // Workbox detecte el cambio y re-descargue todos los assets en el próximo SW activate.
    workbox.precaching.precacheAndRoute([
        { url: './index.html',              revision: CACHE_VERSION },
        { url: './pomodoro.css',            revision: CACHE_VERSION },
        { url: './pomodoro.js',             revision: CACHE_VERSION },
        { url: './manifest.json',           revision: CACHE_VERSION },
        { url: './icons/icon-pomodoro.svg', revision: CACHE_VERSION },
        { url: './icons/icon-pomodoro.png', revision: CACHE_VERSION }
    ]);

    // includes('/sounds/') tolera apps servidas desde subdirectorios
    workbox.routing.registerRoute(
        ({ url }) => url.pathname.includes('/sounds/'),
        new workbox.strategies.CacheFirst({
            cacheName: 'pomodoro-sounds-v1',
            plugins: [
                new workbox.expiration.ExpirationPlugin({
                    maxEntries: 10,
                    maxAgeSeconds: 60 * 60 * 24 * 90 // 90 días
                })
            ]
        })
    );

    // Cachear librerías CDN externas (Howler, confetti) para que funcionen offline
    workbox.routing.registerRoute(
        ({ url }) =>
            url.hostname === 'cdnjs.cloudflare.com' ||
            url.hostname === 'cdn.jsdelivr.net',
        new workbox.strategies.StaleWhileRevalidate({
            cacheName: 'pomodoro-cdn-libs-v1',
            plugins: [
                new workbox.expiration.ExpirationPlugin({
                    maxEntries: 20,
                    maxAgeSeconds: 60 * 60 * 24 * 90 // 90 días
                })
            ]
        })
    );

    // Estrategia NetworkFirst para el resto de assets
    workbox.routing.registerRoute(
        ({ request }) => request.destination === 'script' || request.destination === 'style',
        new workbox.strategies.NetworkFirst({ cacheName: 'pomodoro-assets-v1' })
    );

    // ==================== LIMPIEZA DE CACHÉS OBSOLETAS ====================
    // Eliminar cachés de versiones anteriores al activar el SW.
    // Se usan los nombres exactos de los cachés propios de la app; el caché
    // interno de Workbox (workbox-precache-v2) se preserva implícitamente
    // porque su nombre no empieza por 'pomodoro-'.
    // Nota: skipWaiting() y clientsClaim() arriba hacen que este activate
    // se dispare inmediatamente; el waitUntil garantiza que la limpieza
    // completa antes de que el SW responda a fetch del nuevo cliente.
    self.addEventListener('activate', event => {
        const expectedCaches = [
            'pomodoro-sounds-v1',
            'pomodoro-cdn-libs-v1',
            'pomodoro-assets-v1'
        ];
        event.waitUntil(
            caches.keys().then(keys =>
                Promise.all(
                    keys
                        .filter(k => k.startsWith('pomodoro-') && !expectedCaches.includes(k))
                        .map(k => {
                            console.log('[SW] Eliminando caché obsoleta:', k);
                            return caches.delete(k);
                        })
                )
            )
        );
    });

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

} else {
    console.error('Workbox no se pudo cargar');
}