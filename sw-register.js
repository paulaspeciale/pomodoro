// sw-register.js — Registro del Service Worker (PWA offline)
// Extraído de index.html para eliminar la necesidad de 'unsafe-inline' en la CSP.
'use strict';

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // Generar una versión basada en un hash ligero del contenido del documento
        // en lugar de lastModified (que los CDNs/caches frecuentemente no actualizan).
        // Se usa la longitud + un checksum simple del HTML serializado como proxy
        // de cambio; cambia en cada deploy sin depender de cabeceras HTTP.
        let swVersion;
        try {
            const html = document.documentElement.outerHTML;
            let h = 0;
            for (let i = 0; i < Math.min(html.length, 8000); i++) {
                h = (Math.imul(31, h) + html.charCodeAt(i)) | 0;
            }
            swVersion = (h >>> 0).toString(36) + '_' + html.length;
        } catch (_) {
            swVersion = Date.now().toString(36);
        }
        navigator.serviceWorker.register(`./sw.js?v=${swVersion}`)
            .catch(err => console.warn('SW registration failed:', err));
    });
}
