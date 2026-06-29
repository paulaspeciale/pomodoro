// i18n.js — Sistema de internacionalización para Pomodoro Timer
// Vanilla JS, sin dependencias. Soporta ES / EN / PT.
// Detección automática por navigator.languages con fallback a español.
// Persistencia en localStorage. Precacheable por el Service Worker.
'use strict';

// ==================== CONFIGURACIÓN ====================
const SUPPORTED_LANGS = ['es', 'en', 'pt'];
const DEFAULT_LANG    = 'es';
const LS_KEY          = 'pomodoroLang';
const LOCALES_PATH    = './locales/';

// ==================== ESTADO ====================
// _strings contiene las traducciones del idioma activo.
// _fallback contiene siempre el español como red de seguridad.
let _strings  = {};
let _fallback = {};
let _currentLang = DEFAULT_LANG;

// ==================== API PÚBLICA ====================

/**
 * t(key) — Traduce una clave.
 * Devuelve el string del idioma activo, con fallback al español,
 * y como último recurso la propia clave (para detectar claves faltantes).
 */
function t(key) {
    return _strings[key] ?? _fallback[key] ?? key;
}

/** Idioma actualmente activo (código BCP-47 base: 'es', 'en', 'pt') */
function currentLang() { return _currentLang; }

/**
 * init() — Detecta el idioma y carga las traducciones.
 * Debe llamarse ANTES de que el DOM se renderice con texto dinámico.
 * Retorna una Promise que resuelve cuando las traducciones están listas.
 */
async function init() {
    const lang = _detectLang();
    try {
        await _loadLang(lang);
    } catch (_) {
        // Si falla la carga del idioma detectado, seguimos con _strings vacío;
        // t() ya cae a _fallback/clave cruda, así que la app no se rompe.
    }
    // Precalentar fallback en español si no es el idioma activo
    if (lang !== DEFAULT_LANG) {
        try {
            await _loadLang(DEFAULT_LANG, true);
        } catch (_) {
            // Mismo criterio: fallback silencioso, t() usará la clave cruda si falta todo.
        }
    }
    _currentLang = lang;
    _applyToDOM();
    _updateHtmlLang();
    return lang;
}

/**
 * setLang(lang) — Cambia el idioma en tiempo de ejecución.
 * Guarda la preferencia en localStorage y re-renderiza el DOM.
 */
async function setLang(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) return;
    if (lang === _currentLang) return;
    try {
        await _loadLang(lang);
    } catch (_) {
        // La carga falló (ej. 404 transitorio): no avanzamos _currentLang ni
        // re-renderizamos. Así el botón de idioma NO queda marcado como activo
        // mientras el texto sigue en el idioma anterior — el estado inconsistente
        // que causaba "el cambio de idioma no funciona" a simple vista.
        console.warn(`[i18n] No se pudo cambiar a "${lang}", se mantiene "${_currentLang}"`);
        return;
    }
    _currentLang = lang;
    try { localStorage.setItem(LS_KEY, lang); } catch (_) {}
    _applyToDOM();
    _updateHtmlLang();
    // Disparar evento personalizado para que pomodoro.js pueda reaccionar
    // (ej. re-renderizar el selector de ambient, el badge de modo, etc.)
    document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
}

// ==================== INTERNOS ====================

function _detectLang() {
    // 1. Preferencia guardada por el usuario
    try {
        const saved = localStorage.getItem(LS_KEY);
        if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
    } catch (_) {}

    // 2. navigator.languages — lista priorizada del navegador
    const preferred = (navigator.languages?.length
        ? navigator.languages
        : [navigator.language || DEFAULT_LANG]
    ).map(l => l.split('-')[0].toLowerCase());

    for (const lang of preferred) {
        if (SUPPORTED_LANGS.includes(lang)) return lang;
    }

    return DEFAULT_LANG;
}

// Caché en memoria: evita re-fetching del mismo archivo
const _cache = {};

async function _loadLang(lang, asFallback = false) {
    // Si ya está en caché, solo asignar
    if (_cache[lang]) {
        if (asFallback) _fallback = _cache[lang];
        else _strings = _cache[lang];
        return;
    }
    try {
        // 'default': respeta la caché HTTP normal (revalida si es necesario) en
        // lugar de 'force-cache', que reutilizaba ciegamente incluso una respuesta
        // 404 fallida del primer intento (carrera con el Service Worker al arrancar),
        // dejando el idioma roto de forma permanente hasta limpiar caché a mano.
        const res = await fetch(`${LOCALES_PATH}${lang}.json`, { cache: 'default' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // Solo cachear en memoria si la carga fue exitosa. Si falla, NO guardar
        // nada en _cache[lang]: así el próximo intento (reintento manual del
        // usuario, o un segundo setLang) vuelve a pedir la red en vez de quedar
        // atascado repitiendo el mismo fallo para siempre.
        _cache[lang] = data;
        if (asFallback) _fallback = data;
        else _strings = data;
    } catch (err) {
        console.warn(`[i18n] No se pudo cargar ${lang}.json:`, err.message);
        // Fallback silencioso: usar lo que ya hay en _strings/_fallback.
        // Re-lanzamos para que el llamador (init/setLang) sepa que falló
        // y no avance _currentLang como si el cambio hubiera funcionado.
        throw err;
    }
}

// ==================== APLICAR AL DOM ====================
// Elementos con data-i18n="clave"    → textContent
// Elementos con data-i18n-ph="clave" → placeholder
// Elementos con data-i18n-aria="clave" → aria-label
// Elementos con data-i18n-title="clave" → title

function _applyToDOM() {
    // Texto visible
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        const val = t(key);
        if (val !== key) el.textContent = val;
    });

    // Placeholders (textarea, input)
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
        const val = t(el.dataset.i18nPh);
        if (val !== el.dataset.i18nPh) el.placeholder = val;
    });

    // aria-label
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
        const val = t(el.dataset.i18nAria);
        if (val !== el.dataset.i18nAria) el.setAttribute('aria-label', val);
    });

    // title (tooltips)
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const val = t(el.dataset.i18nTitle);
        if (val !== el.dataset.i18nTitle) el.title = val;
    });

    // <option> dentro de #ambient-select: texto + value intacto
    _updateAmbientSelectOptions();

    // Selector de idioma: marcar el activo
    _syncLangSelector();
}

function _updateAmbientSelectOptions() {
    const select = document.getElementById('ambient-select');
    if (!select) return;
    const keyMap = {
        none:   'ambientNone',
        rain:   'ambientRain',
        pink:   'ambientPink',
        white:  'ambientWhite',
        forest: 'ambientForest',
        ocean:  'ambientOcean'
    };
    select.querySelectorAll('option').forEach(opt => {
        const key = keyMap[opt.value];
        if (!key) return;
        const val = t(key);
        // Igual que el resto de _applyToDOM: si la traducción no cargó, t() devuelve
        // la propia clave como último recurso. No pisar el texto estático del HTML
        // (que ya tiene el emoji + nombre en español) con la clave cruda.
        if (val !== key) opt.textContent = val;
    });
}

function _syncLangSelector() {
    const sel = document.getElementById('lang-select');
    if (sel) sel.value = _currentLang;

    // Botones tipo flag/pill si se usa ese patrón
    document.querySelectorAll('[data-lang-btn]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.langBtn === _currentLang);
        btn.setAttribute('aria-pressed', btn.dataset.langBtn === _currentLang ? 'true' : 'false');
    });
}

function _updateHtmlLang() {
    document.documentElement.lang = _currentLang === 'pt' ? 'pt-BR'
        : _currentLang === 'en' ? 'en'
        : 'es-ES';
}

// ==================== SELECTOR DE IDIOMA UI ====================
/**
 * initLangSelector() — Inicializa el widget de selección de idioma.
 * Busca #lang-select (un <select>) o botones [data-lang-btn] en el DOM.
 * Llamar desde DOMContentLoaded en pomodoro.js, después de init().
 */
function initLangSelector() {
    // Opción A: <select id="lang-select">
    const sel = document.getElementById('lang-select');
    if (sel) {
        sel.value = _currentLang;
        sel.addEventListener('change', (e) => setLang(e.target.value));
    }

    // Opción B: botones con data-lang-btn="es|en|pt"
    document.querySelectorAll('[data-lang-btn]').forEach(btn => {
        btn.addEventListener('click', () => setLang(btn.dataset.langBtn));
    });

    _syncLangSelector();
}

// Exportar como objeto global (compatible con el patrón sin módulos de la app)
window.i18n = { t, currentLang, init, setLang, initLangSelector };
