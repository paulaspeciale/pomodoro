# Guía de integración — i18n Pomodoro Timer

## Archivos nuevos a agregar al proyecto

```
/locales/es.json     ← traducciones español (base)
/locales/en.json     ← traducciones inglés
/locales/pt.json     ← traducciones portugués
/i18n.js             ← módulo de internacionalización
```

Los tres `.json` se precachean automáticamente por el SW si los agregás a
`APP_SHELL_ASSETS` en `sw.js` (ver sección SW más abajo).

---

## 1. index.html — cambios

### 1a. Cargar i18n.js ANTES de pomodoro.js

```html
<!-- Reemplazar esta línea: -->
<script src="pomodoro.js" defer></script>

<!-- Por estas dos: -->
<script src="i18n.js" defer></script>
<script src="pomodoro.js" defer></script>
```

### 1b. Botones de idioma en .top-buttons

Reemplazar el div `.top-buttons` existente por este:

```html
<div class="top-buttons" role="group" aria-label="Controles de aplicación">
    <!-- Selector de idioma -->
    <div class="lang-selector" role="group" aria-label="Idioma">
        <button class="lang-btn" data-lang-btn="es" aria-pressed="true"  lang="es">ES</button>
        <button class="lang-btn" data-lang-btn="en" aria-pressed="false" lang="en">EN</button>
        <button class="lang-btn" data-lang-btn="pt" aria-pressed="false" lang="pt">PT</button>
    </div>
    <button id="install-btn" class="theme-toggle install-btn hidden"
            aria-label="Instalar aplicación" title="Instalar en escritorio">
        <i class="fas fa-download" aria-hidden="true"></i>
    </button>
    <button id="theme-toggle" class="theme-toggle" aria-label="Cambiar tema">
        <i class="fas fa-moon" aria-hidden="true"></i>
    </button>
</div>
```

### 1c. Atributos data-i18n en elementos estáticos clave

Agregar `data-i18n` a los elementos que tienen texto visible fijo.
El módulo i18n.js los actualiza automáticamente en _applyToDOM().

Ejemplos de los más importantes:

```html
<!-- h1 -->
<h1 data-i18n="appTitle">Pomodoro Timer</h1>

<!-- subtítulo -->
<p class="config-subtitle" data-i18n="configSubtitle">Configura tu sesión de trabajo</p>

<!-- Labels de cards -->
<div class="config-card-label" id="work-card-label">
    <i class="fas fa-brain" aria-hidden="true"></i>
    <span data-i18n="labelWork">Trabajo</span>
</div>
<div class="config-card-label" id="break-card-label">
    <i class="fas fa-mug-hot" aria-hidden="true"></i>
    <span data-i18n="labelBreak">Descanso</span>
</div>

<!-- Label ciclos -->
<label for="ciclos-input" class="cycles-label">
    <i class="fas fa-repeat" aria-hidden="true"></i>
    <span data-i18n="labelCycles">Número de ciclos</span>
</label>

<!-- Presets label -->
<span class="presets-label" data-i18n="presetsLabel">Presets:</span>

<!-- Presets botones -->
<button class="preset-btn" data-work="25" data-break="5"  data-cycles="4" data-i18n="presetClassic">Clásico</button>
<button class="preset-btn" data-work="50" data-break="10" data-cycles="4" data-i18n="preset5010">50/10</button>
<button class="preset-btn" data-work="90" data-break="20" data-cycles="3" data-i18n="presetDeepWork">Deep Work 90/20</button>

<!-- Botón comenzar -->
<button id="start-btn" class="start-btn">
    <i class="fas fa-play" aria-hidden="true"></i>
    <span data-i18n="btnStart">Comenzar</span>
</button>

<!-- Botones de control del timer -->
<button id="pause-btn" class="control-btn" aria-label="Pausar temporizador">
    <i class="fas fa-pause" aria-hidden="true"></i>
    <span data-i18n="btnPause">Pausar</span>
</button>
<button id="reset-btn" class="control-btn reset" data-i18n-aria="ariaReset" aria-label="Reiniciar sesión">
    <i class="fas fa-redo" aria-hidden="true"></i>
    <span data-i18n="btnReset">Reiniciar</span>
</button>

<!-- Inputs: unidades -->
<span class="time-unit" data-i18n="unitMin">min</span>  <!-- en cada card -->
<span class="time-unit" id="cycles-unit-label">ciclos</span>  <!-- este lo maneja JS; ver sección pomodoro.js -->

<!-- Botones footer -->
<button class="footer-btn" data-modal="modal-about-me"   data-i18n="footerAboutMe">Sobre mí</button>
<button class="footer-btn" data-modal="modal-about-app"  data-i18n="footerAboutApp">Sobre la app</button>
<button class="footer-btn" data-modal="modal-donations"  data-i18n="footerDonations">Donaciones</button>
<button class="footer-btn" data-modal="modal-projects"   data-i18n="footerProjects">Otros proyectos</button>
<button class="footer-btn" data-modal="modal-suggestions" data-i18n="footerSuggestions">Sugerencias / Comentarios</button>
<button class="footer-btn" data-modal="modal-offline-guide" data-i18n="footerOffline">Uso offline</button>

<!-- Títulos de modales -->
<h2 id="modal-about-me-title"      data-i18n="modalAboutMeTitle">Sobre mí</h2>
<h2 id="modal-about-app-title"     data-i18n="modalAboutAppTitle">Sobre la app</h2>
<h2 id="modal-donations-title"     data-i18n="modalDonationsTitle">Donaciones</h2>
<h2 id="modal-projects-title"      data-i18n="modalProjectsTitle">Otros proyectos</h2>
<h2 id="modal-suggestions-title"   data-i18n="modalSuggestionsTitle">Sugerencias / Comentarios</h2>

<!-- Formulario de sugerencias -->
<label for="suggestion-name" data-i18n="suggestionNameLabel">Tu nombre</label>
<span class="label-optional" data-i18n="suggestionNameOptional">(opcional)</span>
<label for="suggestion-email" data-i18n="suggestionEmailLabel">Tu email</label>
<span class="label-optional" data-i18n="suggestionEmailOptional">(opcional)</span>
<label for="suggestion-text" data-i18n="suggestionMsgLabel">Mensaje</label>
<textarea id="suggestion-text" ... data-i18n-ph="suggestionMsgPlaceholder"
    placeholder="Cuéntame qué mejorarías..."></textarea>
<button id="suggestion-submit" ... >
    <i class="fas fa-paper-plane" aria-hidden="true"></i>
    <span data-i18n="suggestionSubmit">Enviar</span>
</button>

<!-- Skip link -->
<a href="#main-content" class="skip-link" data-i18n="skipLink">Ir al contenido principal</a>
```

### 1d. Agregar CSS del selector al final de pomodoro.css

Copiar el contenido de `i18n-styles.css` al final de `pomodoro.css`.

---

## 2. pomodoro.js — cambios

### 2a. DOMContentLoaded: inicializar i18n PRIMERO

```js
document.addEventListener('DOMContentLoaded', async () => {
    // ── i18n: inicializar ANTES que cualquier otro init ──────────────
    // Carga las traducciones y aplica al DOM antes de que initConfigControls,
    // initAmbientControls etc. lean valores de atributos o textContent.
    if (window.i18n) {
        await window.i18n.init();
        window.i18n.initLangSelector();
        // Cuando el usuario cambia idioma en vivo, re-sincronizar partes
        // del DOM que pomodoro.js gestiona directamente (no via data-i18n).
        document.addEventListener('langchange', () => {
            _syncDynamicI18n();
        });
    }

    // ... resto de asignaciones DOM y llamadas a init*() sin cambios ...
    ciclosContainer = document.getElementById('ciclos-container');
    // etc.
```

### 2b. Helper _syncDynamicI18n() — re-sincronizar strings dinámicos

Agregar esta función cerca de `initTheme()` o al final del módulo:

```js
// Sincroniza los elementos del DOM que pomodoro.js gestiona directamente
// y que no se cubren con data-i18n estático (porque dependen del estado).
function _syncDynamicI18n() {
    if (!window.i18n) return;
    const { t } = window.i18n;

    // Badge de modo (TRABAJO / DESCANSO) — depende de isDescanso
    if (modoActual) {
        modoActual.textContent = isDescanso ? t('modeBreak') : t('modeWork');
    }

    // Label de descanso ("10 minutos de descanso")
    const descansoLabel = document.getElementById('descanso-label');
    if (descansoLabel) {
        descansoLabel.textContent = `${breakMinutes} ${t('breakMinutesLabel')}`;
    }

    // Unidad de ciclos en el label (ciclo/ciclos)
    const cyclesLabel = document.getElementById('cycles-unit-label');
    if (cyclesLabel) {
        const val = parseInt(document.getElementById('ciclos-input')?.value) || 4;
        cyclesLabel.textContent = val === 1 ? t('unitCycle') : t('unitCycles');
    }

    // Botón pausa — depende de isPaused
    if (pauseBtn && !sessionFinished) {
        const icon = isPaused ? 'play' : 'pause';
        const label = isPaused ? t('btnResume') : t('btnPause');
        pauseBtn.innerHTML = `<i class="fas fa-${icon}" aria-hidden="true"></i><span>${label}</span>`;
        pauseBtn.setAttribute('aria-label', isPaused ? t('ariaResume') : t('ariaPause'));
    }

    // Resumen de configuración
    updateSummary();
}
```

### 2c. Reemplazar strings hardcodeados por t()

En cada función que muestra texto al usuario, reemplazar los literales.
El patrón es: `'texto fijo'` → `i18n.t('clave')`.

**Ejemplos de las funciones más usadas:**

```js
// showToast
showToast(i18n.t('toastLoadError'));                 // era: '⚠️ No se pudo cargar el sonido.'
showToast(i18n.t('toastOfflineMode'));               // era: 'Modo offline básico activo...'
showToast(`✅ ${ambientOptions[t].name} ${i18n.t('offlineSaveSuccess')}`);

// showNotification (en iniciarCicloTrabajo)
showNotification(
    i18n.t('notifWorkTitle'),
    `Ciclo ${cicloActual}/${ciclosTotales} ${i18n.t('notifWorkBody')}`
);

// announcePhase (en iniciarCicloTrabajo)
announcePhase(
    `Ciclo ${cicloActual} de ${ciclosTotales}. ${i18n.t('announceWork')} ${workMinutes} ${i18n.t('unitMin')}.`
);

// announcePhase (en iniciarDescanso)
announcePhase(
    `${i18n.t('announceBreak')} ${breakMinutes} ${i18n.t('announceBreakDuration')}`
);

// announcePhase (en finalizarTodo)
announcePhase(
    `${i18n.t('announceDone')} ${ciclosTotales} ${i18n.t('announceDoneCycles')}`
);

// mostrarPantallaFin — botón y textos
title.textContent = i18n.t('sessionComplete');
desc.textContent  = i18n.t('sessionCompleteDesc1') + ' ';
strong.textContent = `${ciclosTotales} ${ciclosTotales !== 1
    ? i18n.t('sessionCompleteDesc2cycles')
    : i18n.t('sessionCompleteDesc2cycle')}`;
desc.appendChild(document.createTextNode(' ' + i18n.t('sessionCompleteDesc3')));
btn.appendChild(document.createTextNode(' ' + i18n.t('btnNewSession')));

// cacheAmbientSound — botones de estado
btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${i18n.t('offlineDownloading')}`;
btn.innerHTML = `<i class="fas fa-check"></i> ${i18n.t('offlineSaved')}`;
btn.innerHTML = `<i class="fas fa-download"></i> ${i18n.t('offlineSaveBtn')}`;

// updateBannerForSound
btn.innerHTML = `<i class="fas fa-check"></i> ${i18n.t('offlineSaved')}`;
btn.innerHTML = `<i class="fas fa-download"></i> ${i18n.t('offlineSaveBtn')}`;

// Banner offline: "Guarda X para escuchar sin conexión"
// (el span con id="offline-sound-name" va entre offlineSaveFor y offlineSaveForEnd)
// En index.html:
//   <span><i ...></i> <span data-i18n="offlineSaveFor">Guarda</span>
//   <strong id="offline-sound-name"></strong>
//   <span data-i18n="offlineSaveForEnd">para escuchar sin conexión</span></span>

// updateCyclesLabel en initConfigControls
const updateCyclesLabel = () => {
    const label = document.getElementById('cycles-unit-label');
    const val   = parseInt(cyclesInput.value);
    if (label) label.textContent = val === 1
        ? (window.i18n ? window.i18n.t('unitCycle') : 'ciclo')
        : (window.i18n ? window.i18n.t('unitCycles') : 'ciclos');
};

// suggestion submit button
submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${i18n.t('suggestionSubmitting')}`;
submitBtn.innerHTML = `<i class="fas fa-paper-plane"></i> ${i18n.t('suggestionSubmit')}`;

// success state
const titleEl = successEl.querySelector('.success-title'); // si lo agregás con data-i18n, no necesitás tocarlo
```

### 2d. ambientOptions.name — actualizar con t()

El objeto `ambientOptions` tiene los nombres en español fijos. Para que
`syncAmbientUI()` y el toast de descarga funcionen en el idioma activo,
agregar un getter dinámico o una función auxiliar:

```js
// En lugar de acceder a ambientOptions[type].name directamente,
// usar esta función donde se necesite el nombre localizado:
function getAmbientName(type) {
    const keyMap = {
        none: 'ambientNone', rain: 'ambientRain', pink: 'ambientPink',
        white: 'ambientWhite', forest: 'ambientForest', ocean: 'ambientOcean'
    };
    if (window.i18n && keyMap[type]) return window.i18n.t(keyMap[type]);
    return ambientOptions[type]?.name ?? type;
}
```

Reemplazar `ambientOptions[capturedType].name` en `cacheAmbientSound()`
y en `updateBannerForSound()` por `getAmbientName(capturedType)`.

---

## 3. sw.js — precachear los JSON de locales

En `APP_SHELL_ASSETS`, agregar:

```js
const APP_SHELL_ASSETS = [
    './',
    './pomodoro.css',
    './pomodoro.js',
    './i18n.js',          // ← nuevo
    './locales/es.json',  // ← nuevo
    './locales/en.json',  // ← nuevo
    './locales/pt.json',  // ← nuevo
    './sw-register.js',
    './manifest.json',
    // ... resto sin cambios
];
```

Esto garantiza que los tres idiomas estén disponibles offline desde la
primera instalación de la PWA, sin necesidad de ningún fetch extra.

---

## Resumen de prioridades de implementación

| Paso | Impacto | Esfuerzo |
|------|---------|----------|
| Agregar archivos JSON + i18n.js | Base necesaria | Copia directa |
| Agregar `<script src="i18n.js">` en index.html | Activa detección automática | 1 línea |
| Agregar botones lang-btn en top-buttons | UI de selección | 3 líneas |
| Agregar CSS del selector | Visual | Copiar bloque |
| `await i18n.init()` en DOMContentLoaded | Aplica idioma al DOM | ~5 líneas |
| Atributos data-i18n en el HTML | Texto estático | Edición incremental |
| Reemplazar strings en pomodoro.js | Texto dinámico | Incremental |
| Precachear JSON en sw.js | Offline | 3 líneas |
