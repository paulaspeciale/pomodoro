// sw-register.js — Registro del Service Worker (PWA offline)
// Extraído de index.html para eliminar la necesidad de 'unsafe-inline' en la CSP.
'use strict';

if ('serviceWorker' in navigator) {
    // Calcula la versión a partir del HTML fuente, no del DOM serializado.
    // El DOM vivo cambia con el idioma, el tema (clase en <html>) y los textos
    // traducidos; hashearlo generaba un SW y una caché nuevos al cambiar de tema.
    async function computeSwVersion() {
        try {
            const response = await fetch(`./index.html?_swv=${Date.now()}`, { cache: 'no-store' });
            if (response.ok) {
                const html = await response.text();
                let h = 0;
                for (let i = 0; i < html.length; i++) {
                    h = (Math.imul(31, h) + html.charCodeAt(i)) | 0;
                }
                const version = (h >>> 0).toString(36) + '_' + html.length;
                try { localStorage.setItem('pomodoroSwVersion', version); } catch (_) {}
                return version;
            }
        } catch (_) {
            // Sin red: reutilizar la última versión conocida para no forzar
            // reinstalaciones del SW con una URL distinta en cada carga.
        }
        let cached = null;
        try { cached = localStorage.getItem('pomodoroSwVersion'); } catch (_) {}
        return cached || 'static';
    }

    window.addEventListener('load', async () => {
        const swVersion = await computeSwVersion();
        navigator.serviceWorker.register(`./sw.js?v=${swVersion}`)
            .catch(err => console.warn('SW registration failed:', err));
    });
}
