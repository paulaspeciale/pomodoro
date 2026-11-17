// theme-init.js — aplica el tema guardado antes del primer paint.
// Se carga de forma bloqueante en <head> (sin defer) para evitar el FOUC:
// si el usuario prefiere el tema oscuro, la clase debe existir antes de que
// el navegador pinte el <body>.
// Se mantiene como archivo externo para no necesitar 'unsafe-inline' en la CSP.
'use strict';

(function () {
    var pref = null;
    try { pref = localStorage.getItem('themePreference'); } catch (_) {}

    // Migrar la preferencia del sistema anterior ('darkMode': 'true'/'false')
    if (pref === null) {
        try {
            var legacy = localStorage.getItem('darkMode');
            if (legacy === 'true')  { pref = 'dark';  localStorage.setItem('themePreference', 'dark'); }
            if (legacy === 'false') { pref = 'light'; localStorage.setItem('themePreference', 'light'); }
            if (legacy !== null) localStorage.removeItem('darkMode');
        } catch (_) {}
    }

    var root = document.documentElement;
    if (pref === 'dark')  root.classList.add('dark');
    if (pref === 'light') root.classList.add('light');
})();
