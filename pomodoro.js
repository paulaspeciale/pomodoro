// pomodoro.js — revision v17 (aria-hidden en ícono offline modal; location.hash preservado en applyURLPreset; comentario de sincronización SOUNDS_CACHE)
'use strict';

// ==================== REFS DOM ====================
// Declaradas aquí para visibilidad de módulo, se asignan en DOMContentLoaded
let ciclosContainer, countdownDiv, trabajoContainer, descansoContainer;
let timerDisplay, descansoTime, modoActual, progressBar;
let pauseBtn, resetBtn, cicloActualEl, cicloTotalEl, themeToggle;

// ==================== ESTADO GLOBAL ====================
let tiempoActual = 0, tiempoInicial = 0, isDescanso = false;
let intervalo    = null, isPaused = false;
let ciclosTotales = 0, cicloActual = 0;
let notificationsEnabled = false;
let sessionFinished = false;
let isTransitioning = false; // evita doble transición de fase en el mismo tick
let hiddenAt = null;
let timerWasRunningWhenHidden = false;
let workMinutes = 50;
let breakMinutes = 10;
// Timestamp de inicio de la fase actual (Date.now()) y segundos iniciales.
// Usados para compensar el drift acumulado de setInterval en sesiones largas.
let phaseStartTime = null;
let phaseStartSeconds = 0;
// Flag para suprimir la transición CSS en el primer frame de cada fase
// (debe declararse aquí con el resto del estado, no abajo en el código)
let _suppressProgressTransition = false;
// Guard para evitar duplicar el DOM de pantalla final si mostrarPantallaFin se llama dos veces
let _finScreenRendered = false;
// Referencia al interval de confetti para poder cancelarlo si el usuario reinicia
let _confettiInterval = null;

// ==================== SONIDO AMBIENTAL ====================
let ambientSound  = null;
let currentAmbient = null;
let currentVolume  = 0.45;
let userMutedAmbient = false;
// Flag que se activa en cleanupAudioState() para que cualquier rama de playAmbient()
// que aún tenga awaits pendientes aborte sin crear Howls huérfanos.
// Se resetea en resetSessionState() antes de que el usuario pueda interactuar de nuevo.
let audioCleanedUp = false;

const ambientOptions = {
    none:   { name: 'Sin sonido',      url: null },
    rain:   { name: '🌧️ Lluvia',       url: './sounds/rain.mp3' },
    pink:   { name: '🌸 Ruido Rosa',   url: './sounds/pinknoise.mp3' },
    white:  { name: '⚪ Ruido Blanco', url: './sounds/whitenoise.mp3' },
    forest: { name: '🌲 Bosque',       url: './sounds/woods.mp3' },
    ocean:  { name: '🌊 Océano',       url: './sounds/ocean.mp3' }
};

// Actualiza ícono y opacidad del slider según estado real de Howl
function syncAmbientUI() {
    const toggle = document.getElementById('ambient-toggle');
    const slider = document.getElementById('volume-slider');
    if (!toggle || !slider) return;
    // El sonido está activo si está reproduciéndose ahora mismo,
    // O si hay uno cargando (currentAmbient set, Howl instanciado, usuario no muteó).
    // No incluir el caso de error: si onloaderror limpió ambientSound, isActive debe ser false.
    const isActive = ambientSound && (ambientSound.playing() ||
                     (currentAmbient && !userMutedAmbient && ambientSound.state() !== 'unloaded'));
    toggle.innerHTML = isActive
        ? '<i class="fas fa-volume-up"></i>'
        : '<i class="fas fa-volume-mute"></i>';
    // Actualizar aria-label según el estado real para lectores de pantalla
    toggle.setAttribute('aria-label', isActive ? 'Silenciar sonido ambiental' : 'Activar sonido ambiental');
    slider.style.opacity = currentAmbient ? '1' : '0.4';
}

function initAmbientControls() {
    const select = document.getElementById('ambient-select');
    const slider = document.getElementById('volume-slider');

    // Recuperar volumen guardado
    try {
        const saved = localStorage.getItem('ambientVolume');
        if (saved !== null) {
            currentVolume = parseFloat(saved);
            slider.value  = currentVolume;
        }
    } catch (_) {}

    select.addEventListener('change', (e) => playAmbient(e.target.value));
    document.getElementById('ambient-toggle').addEventListener('click', toggleAmbientSound);

    slider.addEventListener('input', (e) => {
        currentVolume = parseFloat(e.target.value);
        try { localStorage.setItem('ambientVolume', currentVolume); } catch (_) {}
        if (ambientSound) {
            ambientSound.volume(currentVolume);
            // Reanudar solo si el usuario sube el volumen, no está muteado manualmente,
            // y el timer no está en pausa (el timer pausa el audio por su cuenta)
            if (currentVolume > 0 && !ambientSound.playing() && !userMutedAmbient && !isPaused && !sessionFinished) {
                ambientSound.play();
            }
            syncAmbientUI();
        }
    });

    const dismissBtn = document.getElementById('offline-dismiss-btn');
    if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
            document.getElementById('offline-sound-banner').classList.add('hidden');
        });
    }

    const downloadBtn = document.getElementById('offline-download-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            if (currentAmbient && ambientOptions[currentAmbient]?.url) {
                cacheAmbientSound(currentAmbient, ambientOptions[currentAmbient].url);
            }
        });
    }

    initAmbientBg();
    syncAmbientUI();
}

async function playAmbient(type) {
    // Destruir instancia anterior de forma segura
    if (ambientSound) {
        ambientSound.stop();
        ambientSound.unload();
        ambientSound = null;
    }

    if (type === 'none' || !ambientOptions[type]?.url) {
        currentAmbient = null;
        setAmbientBg(null);
        syncAmbientUI();
        hideBanner();
        return;
    }

    currentAmbient = type;
    userMutedAmbient = false;
    setAmbientBg(type);

    // Capturar el tipo ANTES del await para que updateBannerForSound
    // siempre use el mismo tipo que este Howl, incluso si el usuario
    // cambia el selector mientras esperamos la respuesta de la caché.
    const capturedType = type;
    const isCached = await isSoundCached(ambientOptions[capturedType].url);
    // Si el audio fue limpiado (fin/reset de sesión) o el ambiente cambió durante el
    // await, abortar — no crear Howls huérfanos ni tocar el banner.
    if (audioCleanedUp || currentAmbient !== capturedType) return;
    updateBannerForSound(capturedType, isCached);

    // Guard adicional antes de instanciar Howl.
    if (audioCleanedUp || currentAmbient !== capturedType) return;

    // Guard de disponibilidad: Howler se carga con `defer` y puede no estar listo
    // si el usuario interactúa muy rápido. En ese caso abortar silenciosamente;
    // el selector quedará en el valor elegido y el usuario puede volver a seleccionar.
    if (typeof Howl === 'undefined') {
        console.warn('[playAmbient] Howler aún no está disponible. Reintenta en un momento.');
        currentAmbient = null;
        const sel = document.getElementById('ambient-select');
        if (sel) sel.value = 'none';
        setAmbientBg(null);
        syncAmbientUI();
        return;
    }

    // Capturar referencia local para evitar colisión con cambios rápidos
    const localSound = new Howl({
        src:   [ambientOptions[type].url],
        loop:  true,
        volume: currentVolume,
        html5: true,
        onplay:  () => { if (ambientSound === localSound) syncAmbientUI(); },
        onpause: () => { if (ambientSound === localSound) syncAmbientUI(); },
        onstop:  () => { if (ambientSound === localSound) syncAmbientUI(); },
        // La política de autoplay puede bloquear la reproducción incluso tras cargar
        // correctamente. Howler puede desbloquear el contexto de audio en el siguiente
        // gesto del usuario; registrar el hook 'unlock' para reintentar entonces.
        onplayerror: (_id, err) => {
            if (ambientSound !== localSound) return;
            console.warn(`Error de reproducción: ${ambientOptions[type]?.name}`, err);
            localSound.once('unlock', () => {
                if (ambientSound === localSound && !userMutedAmbient && !isPaused && !sessionFinished) {
                    localSound.play();
                }
            });
            syncAmbientUI();
        },
        onloaderror: (id, err) => {
            console.warn(`No se pudo cargar: ${ambientOptions[type].name}`, err);
            // Si este Howl ya fue reemplazado por uno mas nuevo, solo liberarlo
            if (ambientSound !== localSound) {
                try { localSound.unload(); } catch (_) {}
                return;
            }
            showToast('\u26A0\uFE0F No se pudo cargar el sonido.');
            ambientSound  = null;
            currentAmbient = null;
            // Resetear el selector para que refleje el estado real
            const sel = document.getElementById('ambient-select');
            if (sel) sel.value = 'none';
            setAmbientBg(null);
            hideBanner();
            syncAmbientUI();
        },
        onload: () => {
            // Si este Howl ya fue reemplazado, liberarlo sin reproducir
            if (ambientSound !== localSound) {
                try { localSound.unload(); } catch (_) {}
                return;
            }
            // Respetar mute manual, pausa del timer y estado de sesión finalizada:
            // si cualquiera de estas condiciones está activa mientras el sonido
            // cargaba, no reproducir — el sonido arrancará cuando corresponda.
            if (!userMutedAmbient && !isPaused && !sessionFinished) localSound.play();
            else syncAmbientUI(); // actualizar ícono aunque no se reproduzca
        }
    });
    // Guard final: si el audio fue limpiado (fin/reset) o el selector cambió,
    // descartar este Howl y salir.
    if (audioCleanedUp || currentAmbient !== capturedType) {
        try { localSound.unload(); } catch (_) {}
        return;
    }
    // Destruir el Howl anterior que pudiera existir aún en ambientSound
    // (puede haber sido asignado por una llamada concurrente que pasó todos
    // los guards antes que esta). Operar sobre la referencia previa antes de
    // reasignar para no perder el handle.
    if (ambientSound && ambientSound !== localSound) {
        try { ambientSound.stop(); } catch (_) {}
        try { ambientSound.unload(); } catch (_) {}
    }
    // Asignar aquí, tras todos los guards. Los callbacks onload/onerror comprueban
    // `ambientSound === localSound` para decidir si actuar, por lo que la asignación
    // debe ocurrir antes de que esos callbacks puedan dispararse. En la práctica
    // los callbacks son asíncronos (red/caché), así que este orden es seguro.
    ambientSound = localSound;
}

function toggleAmbientSound() {
    if (!ambientSound || !currentAmbient) return;

    if (ambientSound.playing()) {
        // Sonido reproduciéndose → pausar y marcar como muteado manualmente
        ambientSound.pause();
        userMutedAmbient = true;
    } else if (userMutedAmbient) {
        // Usuario había muteado → desmutar y reanudar si el timer no está en pausa
        userMutedAmbient = false;
        if (!isPaused && !sessionFinished) ambientSound.play();
    } else {
        // Sonido no reproduciéndose (cargando, pausado por timer, etc.)
        // En cualquier caso, el click del usuario indica intención de mutear.
        // Así se evita que el sonido arranque inesperadamente al terminar la carga.
        userMutedAmbient = true;
    }
    syncAmbientUI();
}

// ==================== FONDO AMBIENTAL ====================
function initAmbientBg() {
    if (document.getElementById('ambient-bg')) return;
    const bg = document.createElement('div');
    bg.id = 'ambient-bg';
    document.body.insertBefore(bg, document.body.firstChild);
}

let ambientBgTimeout = null;

function setAmbientBg(type) {
    const bg = document.getElementById('ambient-bg');
    if (!bg) return;

    if (ambientBgTimeout !== null) {
        clearTimeout(ambientBgTimeout);
        ambientBgTimeout = null;
    }

    // Fix: fade out primero, luego limpiar — evita desaparición abrupta al cambiar rápido
    bg.classList.remove('active');

    if (!type) {
        // Sin nuevo tipo: esperar al fade-out (1.2s) antes de limpiar el DOM
        ambientBgTimeout = setTimeout(() => {
            ambientBgTimeout = null;
            bg.innerHTML = '';
            bg.className = '';
        }, 1200);
        return;
    }

    const capturedType = type;
    ambientBgTimeout = setTimeout(() => {
        ambientBgTimeout = null;
        if (currentAmbient !== capturedType) return;
        bg.innerHTML = '';
        bg.className = capturedType;
        buildBgScene(bg, capturedType);
        requestAnimationFrame(() => bg.classList.add('active'));
    }, 700);
}

function buildBgScene(bg, type) {
    // Usar DocumentFragment para reducir reflows (especialmente en 'white' con 120 nodos)
    const frag = document.createDocumentFragment();

    const el = (tag, cls, css) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (css) e.style.cssText = css;
        return e;
    };

    if (type === 'rain') {
        for (let i = 0; i < 55; i++) {
            const h = 20 + Math.random() * 90;
            frag.appendChild(el('div', 'amb-raindrop',
                `left:${Math.random()*100}%;` +
                `top:${Math.random()*-80}px;` +
                `height:${h}px;` +
                `animation-duration:${0.45 + Math.random()*0.65}s;` +
                `animation-delay:${Math.random()*2}s;` +
                `opacity:${0.35 + Math.random()*0.5}`
            ));
        }
        frag.appendChild(el('div', 'amb-puddle'));
        for (let i = 0; i < 10; i++) {
            frag.appendChild(el('div', 'amb-ripple',
                `bottom:${2 + Math.random()*30}px;` +
                `left:${5 + Math.random()*90}%;` +
                `animation-duration:${1.4 + Math.random()*1.4}s;` +
                `animation-delay:${Math.random()*2.5}s`
            ));
        }
    }

    if (type === 'pink') {
        // Espectrograma: número de barras adaptado a mobile/desktop
        const isMobile = window.matchMedia('(max-width: 480px)').matches;
        const barCount = isMobile ? 22 : 38;
        const wrap = el('div', 'amb-pink-bars');
        for (let i = 0; i < barCount; i++) {
            // Perfil de alturas tipo "campana" — barras centrales más altas
            const center = (barCount - 1) / 2;
            const dist   = Math.abs(i - center) / center;
            const baseH  = Math.round((1 - dist * 0.55) * 80 + 15);
            const dur    = (0.35 + Math.random() * 0.55).toFixed(2);
            const delay  = (Math.random() * 0.6).toFixed(2);
            const b = el('div', 'amb-pink-bar',
                `height:${baseH}px;` +
                `animation-duration:${dur}s;` +
                `animation-delay:-${delay}s`
            );
            wrap.appendChild(b);
        }
        frag.appendChild(wrap);
        frag.appendChild(el('div', 'amb-pink-glow'));
    }

    if (type === 'white') {
        // Reducir conteo de nodos en móviles de gama baja para evitar jank
        // (~156 nodos en desktop → ~70 en mobile con viewport estrecho)
        const isMobile = window.matchMedia('(max-width: 480px)').matches;
        const pixelCount = isMobile ? 55 : 120;
        const freqCount  = isMobile ? 14 : 28;
        for (let i = 0; i < pixelCount; i++) {
            frag.appendChild(el('div', 'amb-pixel',
                `top:${Math.random()*100}%;` +
                `left:${Math.random()*100}%;` +
                `animation-duration:${0.08 + Math.random()*0.25}s;` +
                `animation-delay:${Math.random()*0.5}s`
            ));
        }
        for (let i = 0; i < 5; i++) {
            frag.appendChild(el('div', 'amb-oscilloscope',
                `top:${15 + i * 18}%;` +
                `animation-duration:${1.2 + Math.random()*1.8}s;` +
                `animation-delay:${i * 0.4}s`
            ));
        }
        for (let i = 0; i < freqCount; i++) {
            const maxH = 30 + Math.random() * 80;
            frag.appendChild(el('div', 'amb-freq-bar',
                `left:${3 + i * (isMobile ? 6.5 : 3.5)}%;` +
                `height:${maxH}px;` +
                `animation-duration:${0.3 + Math.random()*0.8}s;` +
                `animation-delay:${Math.random()*0.5}s`
            ));
        }
        for (let i = 0; i < 3; i++) {
            const sz = 180 + Math.random() * 150;
            frag.appendChild(el('div', 'amb-glow-orb',
                `width:${sz}px;height:${sz}px;` +
                `top:${Math.random()*80}%;` +
                `left:${Math.random()*80}%;` +
                `animation-duration:${14 + Math.random()*10}s;` +
                `animation-delay:${i*4}s`
            ));
        }
    }

    if (type === 'forest') {
        for (let i = 0; i < 2; i++) {
            frag.appendChild(el('div', 'amb-glow',
                `width:${250 + i*100}px;height:${250 + i*100}px;` +
                `top:${-20 + Math.random()*40}%;` +
                `left:${10 + Math.random()*60}%;` +
                `animation-duration:${4 + i*2}s;` +
                `animation-delay:${i}s`
            ));
        }
        for (let i = 0; i < 35; i++) {
            frag.appendChild(el('div', 'amb-leaf',
                `left:${Math.random()*100}%;` +
                `top:${Math.random()*-30}px;` +
                `animation-duration:${4 + Math.random()*5}s;` +
                `animation-delay:${Math.random()*5}s;` +
                `transform:rotate(${Math.random()*360}deg);` +
                `opacity:${0.4 + Math.random()*0.5}`
            ));
        }
        for (let i = 0; i < 14; i++) {
            frag.appendChild(el('div', 'amb-firefly',
                `top:${15 + Math.random()*70}%;` +
                `left:${5 + Math.random()*90}%;` +
                `animation-duration:${2.5 + Math.random()*4}s;` +
                `animation-delay:${Math.random()*4}s`
            ));
        }
    }

    if (type === 'ocean') {
        // Halo y luna
        frag.appendChild(el('div', 'amb-moon-halo'));
        frag.appendChild(el('div', 'amb-moon'));

        // Estrellas — posiciones fijas para evitar parpadeo en cada render
        const starData = [
            [8,8,1.2,2.8],[15,5,0.8,3.5],[22,12,1.5,2.1],[35,6,1.0,4.0],
            [48,9,0.7,3.2],[55,4,1.3,2.5],[65,11,0.9,3.8],[72,7,1.1,2.0],
            [80,5,0.6,4.2],[90,13,1.4,1.8],[95,8,0.8,3.0],[10,20,1.0,2.6],
            [25,18,1.2,3.4],[42,22,0.7,4.5],[58,16,1.5,2.3],[75,20,0.9,3.7]
        ];
        starData.forEach(([x, y, sz, dur]) => {
            frag.appendChild(el('div', 'amb-star',
                `width:${sz}px;height:${sz}px;` +
                `left:${x}%;top:${y}%;` +
                `animation-duration:${dur}s;` +
                `animation-delay:${-(Math.random() * dur)}s`
            ));
        });

        // Línea de horizonte al 45% de altura
        frag.appendChild(el('div', 'amb-horizon', 'top:45%'));

        // Olas de costa — debajo del horizonte
        for (let i = 0; i < 5; i++) {
            const yPct  = 50 + i * 10;
            const h     = 18 + i * 8;
            const alpha = 0.10 + i * 0.06;
            frag.appendChild(el('div', 'amb-shore-wave',
                `top:${yPct}%;` +
                `height:${h}px;` +
                `background:rgba(10,30,60,${alpha.toFixed(2)});` +
                `animation-duration:${7 + i * 1.5}s;` +
                `animation-delay:${-(i * 1.8)}s`
            ));
        }

        // Reflejos de luna — columna de destellos sobre el agua
        for (let i = 0; i < 9; i++) {
            const xBase  = 82;           // posición horizontal (%) alineada con la luna
            const xOff   = (i - 4) * 4.5;
            const yStart = 47 + Math.abs(xOff) * 0.5;
            const h      = 34 - Math.abs(xOff) * 2.4;
            if (h < 4) continue;
            frag.appendChild(el('div', 'amb-moon-refl',
                `left:${xBase + xOff}%;` +
                `top:${yStart}%;` +
                `height:${h}px;` +
                `animation-duration:${1.4 + Math.random() * 1.2}s;` +
                `animation-delay:${-(Math.random() * 2)}s`
            ));
        }

        // Silueta de costa con SVG inline — rocas y colinas en la base
        const coastSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        coastSvg.setAttribute('viewBox', '0 0 1000 40');
        coastSvg.setAttribute('preserveAspectRatio', 'none');
        coastSvg.className = 'amb-coast-svg';
        const coastPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        coastPath.setAttribute('d',
            'M0,40 L0,28 Q40,18 80,24 Q130,30 170,16 ' +
            'Q210,4  250,10 Q290,16 340,8  ' +
            'Q390,2  430,12 Q470,20 520,14 ' +
            'Q570,8  620,18 Q670,26 720,20 ' +
            'Q770,14 820,22 Q870,28 920,18 ' +
            'Q960,10 1000,16 L1000,40 Z'
        );
        coastPath.setAttribute('fill', '#050d1a');
        coastSvg.appendChild(coastPath);
        frag.appendChild(coastSvg);
    }

    bg.appendChild(frag);
}

// ==================== CACHE API - SONIDOS OFFLINE ====================
// ⚠️ SOUNDS_CACHE debe coincidir exactamente con la constante del mismo nombre en sw.js.
// Si se actualiza la versión aquí, actualizarla también allí (y viceversa).
const SOUNDS_CACHE = 'pomodoro-sounds-v1';

async function isSoundCached(url) {
    if (!('caches' in window)) return false;
    try {
        const cache = await caches.open(SOUNDS_CACHE);
        const match = await cache.match(url);
        return !!match;
    } catch { return false; }
}

async function cacheAmbientSound(type, url) {
    if (!('caches' in window)) {
        showToast('⚠️ Tu navegador no soporta caché offline.');
        return;
    }

    // Capturar el tipo al inicio: si el usuario cambia el selector durante la descarga,
    // el tipo ya no coincidirá con currentAmbient y abortaremos la actualización de UI.
    const capturedType = type;

    const btn             = document.getElementById('offline-download-btn');
    const progressWrap    = document.getElementById('offline-progress-wrap');
    const cacheProgressBar = document.getElementById('offline-progress-bar');

    // Deshabilitar inmediatamente (antes de cualquier await) para prevenir doble-clic
    btn.disabled = true;
    btn.classList.add('downloading');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Descargando...';
    progressWrap.style.display = 'block';
    cacheProgressBar.style.width = '0%';
    // Pequeño rAF para que el navegador pinte el 0% antes de saltar a 10%
    await new Promise(r => requestAnimationFrame(r));

    // Si el ambiente cambió durante el rAF, abortar y limpiar UI
    if (currentAmbient !== capturedType) {
        btn.disabled = false;
        btn.classList.remove('downloading');
        btn.innerHTML = '<i class="fas fa-download"></i> Guardar offline';
        progressWrap.style.display = 'none';
        return;
    }

    cacheProgressBar.style.width = '10%';

    try {
        const cache    = await caches.open(SOUNDS_CACHE);
        const response = await fetch(url);
        if (!response.ok) throw new Error('Error al descargar');

        // Verificar de nuevo tras el fetch (puede haber tardado)
        if (currentAmbient !== capturedType) {
            progressWrap.style.display = 'none';
            btn.disabled = false;
            btn.classList.remove('downloading');
            btn.innerHTML = '<i class="fas fa-download"></i> Guardar offline';
            return;
        }

        const contentLength = response.headers.get('content-length');
        const total  = contentLength ? parseInt(contentLength) : 0;
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;
        let indeterminateProgress = 10;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                received += value.length;
                // Si el ambiente cambió durante la lectura, cancelar el stream
                if (currentAmbient !== capturedType) {
                    try { reader.cancel(); } catch (_) {}
                    progressWrap.style.display = 'none';
                    btn.disabled = false;
                    btn.classList.remove('downloading');
                    btn.innerHTML = '<i class="fas fa-download"></i> Guardar offline';
                    return;
                }
                if (total > 0) {
                    cacheProgressBar.style.width = `${Math.min(90, Math.round((received / total) * 90))}%`;
                } else {
                    indeterminateProgress = Math.min(indeterminateProgress + 5, 85);
                    cacheProgressBar.style.width = `${indeterminateProgress}%`;
                }
            }
        } catch (readErr) {
            try { reader.cancel(); } catch (_) {}
            throw readErr;
        }

        const blob = new Blob(chunks);
        await cache.put(url, new Response(blob, { headers: { 'Content-Type': 'audio/mpeg' } }));

        // Verificación final: solo actualizar UI si el ambiente no cambió
        if (currentAmbient !== capturedType) {
            progressWrap.style.display = 'none';
            return;
        }

        cacheProgressBar.style.width = '100%';
        btn.classList.remove('downloading');
        btn.classList.add('cached');
        btn.innerHTML = '<i class="fas fa-check"></i> Guardado offline';
        btn.disabled  = false;
        showToast(`✅ ${ambientOptions[capturedType].name} disponible sin conexión`);
        setTimeout(() => { progressWrap.style.display = 'none'; }, 1200);

    } catch (err) {
        // Solo mostrar error si el ambiente sigue siendo el mismo
        progressWrap.style.display = 'none';
        btn.disabled = false;
        btn.classList.remove('downloading');
        btn.innerHTML = '<i class="fas fa-download"></i> Guardar offline';
        if (currentAmbient === capturedType) {
            console.error('Error cacheando sonido:', err);
            showToast('❌ No se pudo guardar. Verifica tu conexión.');
        }
    }
}

function updateBannerForSound(type, isCached) {
    const banner      = document.getElementById('offline-sound-banner');
    const nameEl      = document.getElementById('offline-sound-name');
    const btn         = document.getElementById('offline-download-btn');
    const progressWrap = document.getElementById('offline-progress-wrap');

    nameEl.textContent = ambientOptions[type].name;
    progressWrap.style.display = 'none';
    btn.disabled = false;
    // Limpiar estado residual de descarga anterior
    btn.classList.remove('downloading', 'cached');

    if (isCached) {
        btn.classList.add('cached');
        btn.innerHTML = '<i class="fas fa-check"></i> Guardado offline';
        banner.classList.remove('hidden');
    } else {
        if (!navigator.onLine) {
            banner.classList.add('hidden');
            return;
        }
        btn.innerHTML = '<i class="fas fa-download"></i> Guardar offline';
        banner.classList.remove('hidden');
    }
}

function hideBanner() {
    document.getElementById('offline-sound-banner').classList.add('hidden');
}

// ==================== PWA INSTALL ====================
let deferredInstallPrompt = null;

function initInstallButton() {
    const btn = document.getElementById('install-btn');
    if (!btn) return;

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        btn.classList.remove('hidden');
    });

    window.addEventListener('appinstalled', () => {
        btn.classList.add('hidden');
        deferredInstallPrompt = null;
        showToast('✅ App instalada correctamente');
    });

    btn.addEventListener('click', async () => {
        if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            const { outcome } = await deferredInstallPrompt.userChoice;
            if (outcome === 'accepted') showToast('🎉 Instalando Pomodoro Timer...');
            deferredInstallPrompt = null;
            btn.classList.add('hidden');
        } else if (navigator.standalone === false) {
            showToast('📱 En Safari: toca Compartir → "Añadir a pantalla de inicio"');
        } else {
            showToast('ℹ️ Abre esta página en Chrome o Edge para instalarla');
        }
    });

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isIos && !isStandalone) btn.classList.remove('hidden');
}

// ==================== MODALES ====================
function initModals() {
    const overlay = document.getElementById('modal-overlay');

    // Inyectar separadores · entre botones del footer como spans reales
    // (evita el bug del pseudo-selector + con flex-wrap)
    const footerBtns = Array.from(document.querySelectorAll('.footer-btn[data-modal]'));
    footerBtns.forEach((btn, i) => {
        if (i === 0) return;
        const sep = document.createElement('span');
        sep.className = 'footer-sep';
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = '·';
        btn.parentNode.insertBefore(sep, btn);
    });

    document.querySelectorAll('.footer-btn[data-modal]').forEach(btn => {
        btn.addEventListener('click', () => openModal(btn.dataset.modal));
    });

    overlay.addEventListener('click', closeAllModals);
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllModals();
    });
}

function restorePageScroll() {
    document.body.style.overflow = '';
}

function openModal(id) {
    // Cerrar modales abiertos sin restaurar scroll (se restaurará cuando abra el nuevo)
    closeAllModals(false);
    const modal   = document.getElementById(id);
    const overlay = document.getElementById('modal-overlay');
    if (!modal) { restorePageScroll(); return; }
    // Esperar al transition del modal previo (250ms) antes de abrir el nuevo,
    // evitando que overflow:hidden quede atascado si dos modales se solapan.
    setTimeout(() => {
        overlay.classList.remove('hidden');
        modal.classList.remove('hidden');
        requestAnimationFrame(() => modal.classList.add('open'));
        document.body.style.overflow = 'hidden';
    }, 260);
}

function closeAllModals(restoreScroll = true) {
    document.querySelectorAll('.modal.open').forEach(m => {
        m.classList.remove('open');
        setTimeout(() => {
            m.classList.add('hidden');
            // Si era el modal de sugerencias, restaurar el formulario por si
            // el estado de éxito estaba visible, para que la próxima apertura
            // muestre el form vacío y no el mensaje de confirmación.
            if (m.id === 'modal-suggestions') {
                const formEl    = document.getElementById('suggestion-form');
                const successEl = document.getElementById('suggestion-success');
                if (formEl)    formEl.classList.remove('hidden');
                if (successEl) successEl.classList.add('hidden');
                if (_suggestionRestoreTimeout) {
                    clearTimeout(_suggestionRestoreTimeout);
                    _suggestionRestoreTimeout = null;
                }
            }
        }, 250);
    });
    document.getElementById('modal-overlay').classList.add('hidden');
    if (restoreScroll) restorePageScroll();
}

function isAnyModalOpen() {
    return document.querySelector('[role="dialog"].open') !== null;
}

// ==================== FORMULARIO SUGERENCIAS ====================
// Envío via FormSubmit (https://formsubmit.co) — sin backend propio.
// El primer envío activa una confirmación por email de FormSubmit (solo una vez).
const FORMSUBMIT_ENDPOINT = 'https://formsubmit.co/ajax/silentstudybuddy@gmail.com';

// ==================== DONACIONES ====================
// El onclick inline fue eliminado de index.html para cumplir con la CSP
// (script-src no incluye 'unsafe-inline'). La lógica vive aquí.
function initDonations() {
    const copyBtn = document.getElementById('donation-copy-mp');
    if (!copyBtn) return;

    copyBtn.addEventListener('click', function () {
        const alias = 'paula.speciale';

        // Intentar Clipboard API moderna (requiere foco y contexto seguro)
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(alias)
                .then(() => {
                    copyBtn.textContent = '✓ Copiado';
                    setTimeout(() => { copyBtn.textContent = 'Copiar'; }, 2000);
                })
                .catch(() => _clipboardFallback(alias, copyBtn));
        } else {
            _clipboardFallback(alias, copyBtn);
        }
    });
}

// Fallback de copia: crea un <textarea> temporal, lo selecciona y ejecuta
// document.execCommand('copy'). Funciona en Safari iOS, contextos sin foco
// y navegadores sin Clipboard API. Si también falla, muestra el toast.
function _clipboardFallback(text, btn) {
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        // Fuera de la vista para no causar scroll ni parpadeo
        ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) {
            btn.textContent = '✓ Copiado';
            setTimeout(() => { btn.textContent = 'Copiar'; }, 2000);
        } else {
            throw new Error('execCommand returned false');
        }
    } catch (_) {
        showToast('⚠️ No se pudo copiar. Alias: paula.speciale');
    }
}

// Timeout de restauración del botón de sugerencias — guardado a nivel de módulo
// para poder cancelarlo si el usuario vuelve a pulsar antes de que expire.
let _suggestionRestoreTimeout = null;

function initSuggestionForm() {
    const textarea    = document.getElementById('suggestion-text');
    const charCurrent = document.getElementById('char-current');
    const submitBtn   = document.getElementById('suggestion-submit');
    if (!textarea || !submitBtn) return;
    // Guard contra doble inicialización (ej. hot reload en desarrollo)
    if (submitBtn.dataset.initialized) return;
    submitBtn.dataset.initialized = 'true';

    // Contador de caracteres
    textarea.addEventListener('input', () => {
        const len     = textarea.value.length;
        charCurrent.textContent = len;
        const countEl = charCurrent.closest('.char-count');
        countEl.classList.toggle('near-limit', len >= 400 && len < 500);
        countEl.classList.toggle('at-limit',   len >= 500);
    });

    submitBtn.addEventListener('click', () => {
        const nameInput  = document.getElementById('suggestion-name');
        const emailInput = document.getElementById('suggestion-email');
        const name  = nameInput  ? nameInput.value.trim()  : '';
        const email = emailInput ? emailInput.value.trim() : '';
        const text  = textarea.value.trim();

        // Validar mensaje (único campo requerido)
        if (!text) {
            textarea.focus();
            textarea.classList.add('input-error');
            setTimeout(() => textarea.classList.remove('input-error'), 1200);
            showToast('⚠️ Escribe tu mensaje antes de enviar');
            return;
        }

        // Validar email solo si se rellenó
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
            emailInput.focus();
            emailInput.classList.add('input-error');
            setTimeout(() => emailInput.classList.remove('input-error'), 1200);
            showToast('⚠️ El email no parece válido');
            return;
        }

        // Cancelar timeout previo si existe
        if (_suggestionRestoreTimeout) {
            clearTimeout(_suggestionRestoreTimeout);
            _suggestionRestoreTimeout = null;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';

        // Construir payload para FormSubmit AJAX
        const payload = {
            nombre:  name  || '(no indicado)',
            email:   email || '(no indicado)',
            mensaje: text,
            _subject: 'Nueva sugerencia — Pomodoro Timer',
            _captcha: 'false'   // deshabilitar captcha de FormSubmit
        };

        fetch(FORMSUBMIT_ENDPOINT, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Accept':        'application/json'
            },
            body: JSON.stringify(payload)
        })
        .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        })
        .then(() => {
            // Mostrar pantalla de éxito dentro del modal
            const formEl    = document.getElementById('suggestion-form');
            const successEl = document.getElementById('suggestion-success');
            if (formEl)    formEl.classList.add('hidden');
            if (successEl) successEl.classList.remove('hidden');

            // Limpiar campos para cuando el modal vuelva a abrirse
            textarea.value = '';
            if (nameInput)  nameInput.value  = '';
            if (emailInput) emailInput.value = '';
            charCurrent.textContent = '0';
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar';

            // Restaurar formulario después de 4 s
            _suggestionRestoreTimeout = setTimeout(() => {
                _suggestionRestoreTimeout = null;
                if (formEl)    formEl.classList.remove('hidden');
                if (successEl) successEl.classList.add('hidden');
            }, 4000);
        })
        .catch(() => {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar';
            showToast('❌ No se pudo enviar. Verifica tu conexión e inténtalo de nuevo.');
        });
    });
}

// ==================== TOAST ====================
// #pomo-toast se crea aquí en el primer uso si no existe en el HTML.
// Para evitar el FOUC, añádelo directamente en index.html con opacity:0.
let toastTimeout = null;

function showToast(msg) {
    let toast = document.getElementById('pomo-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'pomo-toast';
        // No se aplican estilos inline: los estilos viven en pomodoro.css (#pomo-toast)
        document.body.appendChild(toast);
    }
    // Cancelar el timeout anterior para evitar que se oculte antes de tiempo
    if (toastTimeout) { clearTimeout(toastTimeout); toastTimeout = null; }
    toast.textContent = msg;
    toast.classList.add('show');
    toastTimeout = setTimeout(() => { toast.classList.remove('show'); toastTimeout = null; }, 3200);
}

// ==================== CONFETTI ====================
function launchVictoryConfetti() {
    // La librería se carga con `defer`; si el timer termina muy rápido
    // (ej. en tests con 1 min) puede que aún no esté disponible en window.
    if (typeof confetti !== 'function') return;
    // Cancelar un confetti anterior si el usuario inicia sesiones muy rápido
    if (_confettiInterval) { clearInterval(_confettiInterval); _confettiInterval = null; }
    confetti({ particleCount: 200, spread: 70, origin: { y: 0.6 } });
    const end = Date.now() + 4200;
    _confettiInterval = setInterval(() => {
        if (Date.now() >= end) { clearInterval(_confettiInterval); _confettiInterval = null; return; }
        // Re-verificar en cada tick: la librería puede no estar disponible
        // si el script se descargó o falló después del primer disparo.
        if (typeof confetti !== 'function') { clearInterval(_confettiInterval); _confettiInterval = null; return; }
        confetti({
            particleCount: 80,
            angle:  Math.random() * 60 + 30,
            spread: 55,
            origin: { x: Math.random(), y: Math.random() - 0.2 }
        });
    }, 280);
}

// ==================== NOTIFICACIONES ====================
function initNotifications() {
    if (!('Notification' in window)) return;
    notificationsEnabled = Notification.permission === 'granted';
    // La re-sincronización del permiso cuando el usuario vuelve a la app
    // se hace en handleTimerVisibilityChange (visibilitychange ya registrado
    // en DOMContentLoaded), evitando un segundo listener duplicado.
}

async function requestNotificationPermissionOnUserGesture() {
    if (!('Notification' in window)) return;
    notificationsEnabled = Notification.permission === 'granted';
    if (notificationsEnabled || Notification.permission === 'denied') return;

    // Usar feature-detect en lugar de UA sniffing: iOS Safari < 16.4 no expone
    // Notification.requestPermission, por lo que el check anterior ya lo cubre.
    // En iPadOS 16.4+ con PWA instalada las notificaciones sí funcionan.
    if (typeof Notification.requestPermission !== 'function') return;

    try {
        const perm = await Notification.requestPermission();
        notificationsEnabled = perm === 'granted';
    } catch (e) {
        console.warn('No se pudo solicitar permiso de notificaciones:', e);
    }
}

function showNotification(title, body) {
    if (notificationsEnabled) {
        new Notification(title, { body, icon: './img/icons/icon-pomodoro.svg', tag: 'pomodoro' });
    }
}

// ==================== SONIDO DE FASE ====================
// Un único AudioContext para toda la sesión. Los navegadores tienen un límite
// de ~6 contextos simultáneos; crear uno por fase agota ese límite en sesiones largas.
// Se inicializa en el primer gesto del usuario (playPhaseChangeSound) y se reutiliza.
let sharedAudioContext = null;

async function getAudioContext() {
    // Reutilizar si existe y no está cerrado — nunca crear uno nuevo si ya hay uno válido
    if (sharedAudioContext && sharedAudioContext.state !== 'closed') {
        if (sharedAudioContext.state === 'suspended') {
            await sharedAudioContext.resume();
        }
        return sharedAudioContext;
    }
    // Solo crear si no existe o fue explícitamente cerrado en finalizarTodo.
    // Se omite el prefijo webkit: está deprecado en todos los navegadores modernos
    // y Safari ≥ 14.1 expone AudioContext sin prefijo.
    if (!window.AudioContext) {
        console.warn('AudioContext no disponible en este navegador.');
        return null;
    }
    sharedAudioContext = new AudioContext();
    return sharedAudioContext;
}

async function playPhaseChangeSound(isBreak) {
    try {
        const audio = await getAudioContext();
        if (!audio) return; // AudioContext no disponible en este navegador
        const osc   = audio.createOscillator();
        const gain  = audio.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(isBreak ? 880 : 660, audio.currentTime);
        gain.gain.value = 0.4;
        osc.connect(gain).connect(audio.destination);
        osc.start();
        // Desconectar nodos del AudioGraph tras stop() para evitar acumulación en memoria
        osc.onended = () => {
            try { osc.disconnect(); } catch (_) {}
            try { gain.disconnect(); } catch (_) {}
        };
        // Capturar currentTime antes del setTimeout para evitar drift
        const startTime = audio.currentTime;
        setTimeout(() => {
            gain.gain.linearRampToValueAtTime(0, startTime + 1.0);
            osc.stop(startTime + 1.1);
        }, 200);
    } catch (e) {}
}

// ==================== URL PRESETS (shortcuts del manifest PWA) ====================
// Aplica el preset indicado en ?preset=classic|50-10|deepwork al cargar la app.
// Sin esto, los shortcuts del manifest.json no hacen nada distinto a abrir la app normal.
function applyURLPreset() {
    try {
        const params = new URLSearchParams(window.location.search);
        const preset = params.get('preset');
        if (!preset) return;

        const presets = {
            classic:  { work: 25, breakTime: 5,  cycles: 4 },
            '50-10':  { work: 50, breakTime: 10, cycles: 4 },
            deepwork: { work: 90, breakTime: 20, cycles: 3 }
        };

        const cfg = presets[preset.toLowerCase()];
        if (!cfg) return;

        const wInput = document.getElementById('work-minutes');
        const bInput = document.getElementById('break-minutes');
        const cInput = document.getElementById('ciclos-input');
        if (!wInput || !bInput || !cInput) return;

        wInput.value = cfg.work;
        bInput.value = cfg.breakTime;
        cInput.value = cfg.cycles;

        // Disparar events para que updateSummary y syncActivePreset se actualicen
        [wInput, bInput, cInput].forEach(inp => inp.dispatchEvent(new Event('input')));

        // Limpiar parámetros de URL para que recargas o URLs copiadas no
        // re-apliquen el preset ni expongan ?preset= o ?source= al usuario.
        // Se preserva location.hash por si la app se abre con un fragmento.
        try {
            history.replaceState({}, '', location.pathname + location.hash);
        } catch (_) {}
    } catch (_) {}
}

// ==================== TEMA ====================
function initTheme() {
    let isDark;
    try {
        const saved = localStorage.getItem('darkMode');
        isDark = saved !== null ? saved === 'true' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (_) {
        isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    document.body.classList.toggle('dark', isDark);
    themeToggle.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';

    themeToggle.addEventListener('click', () => {
        const isDarkNow = document.body.classList.toggle('dark');
        try { localStorage.setItem('darkMode', isDarkNow); } catch (_) {}
        themeToggle.innerHTML = isDarkNow ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    });
}

// ==================== CONTROLES DE CONFIGURACIÓN ====================
function initConfigControls() {
    const startBtn    = document.getElementById('start-btn');
    const workInput   = document.getElementById('work-minutes');
    const breakInput  = document.getElementById('break-minutes');
    const cyclesInput = document.getElementById('ciclos-input');

    // Botones +/-
    document.querySelectorAll('.time-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = document.getElementById(btn.dataset.target);
            if (!target) return;
            const step = btn.classList.contains('plus') ? 1 : -1;
            const min  = parseInt(target.min) || 1;
            const max  = parseInt(target.max) || 999;
            let val    = parseInt(target.value) || 0;
            val = Math.min(max, Math.max(min, val + step));
            target.value = val;
            target.dispatchEvent(new Event('input'));
        });
    });

    // Marcar el preset activo segun los valores actuales de los inputs
    // Declarado antes de los listeners para poder referenciarlo en blur
    const syncActivePreset = () => {
        if (!workInput || !breakInput || !cyclesInput) return;
        const w = workInput.value, b = breakInput.value, c = cyclesInput.value;
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.classList.toggle('active',
                btn.dataset.work === w && btn.dataset.break === b && btn.dataset.cycles === c
            );
        });
    };

    // Validar al salir del campo: clampear, actualizar resumen y preset activo
    [workInput, breakInput, cyclesInput].forEach(inp => {
        if (!inp) return;
        inp.addEventListener('blur', () => {
            readClampedValue(inp, parseInt(inp.min), parseInt(inp.max));
            updateSummary();
            syncActivePreset();
        });
        inp.addEventListener('input', () => { updateSummary(); syncActivePreset(); });
    });

    // Pluralizar label de ciclos
    if (cyclesInput) {
        const updateCyclesLabel = () => {
            const label = document.getElementById('cycles-unit-label');
            if (label) label.textContent = parseInt(cyclesInput.value) === 1 ? 'ciclo' : 'ciclos';
        };
        cyclesInput.addEventListener('input', updateCyclesLabel);
        updateCyclesLabel();
    }

    // Presets
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!workInput || !breakInput || !cyclesInput) return;
            workInput.value   = btn.dataset.work;
            breakInput.value  = btn.dataset.break;
            cyclesInput.value = btn.dataset.cycles;
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateSummary();
        });
    });

    // rAF garantiza que Safari haya pintado los valores por defecto del HTML antes de marcar preset
    requestAnimationFrame(syncActivePreset);

    if (startBtn) startBtn.addEventListener('click', iniciarPomodoros);

    // Enter inicia solo si no hay modal abierto y estamos en la config
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter'
            && !ciclosContainer.classList.contains('hidden')
            && !isAnyModalOpen()) {
            // No disparar si el foco está en un campo editable
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            iniciarPomodoros();
        }
    });

    updateSummary();
}

function updateSummary() {
    const wRaw = parseInt(document.getElementById('work-minutes')?.value);
    const bRaw = parseInt(document.getElementById('break-minutes')?.value);
    const cRaw = parseInt(document.getElementById('ciclos-input')?.value);
    const w = isNaN(wRaw) ? 50 : Math.max(1, wRaw);
    const b = isNaN(bRaw) ? 10 : Math.max(1, bRaw);
    const c = isNaN(cRaw) ?  4 : Math.max(1, cRaw);
    // El ultimo ciclo de trabajo no lleva descanso posterior, por eso se resta 1 descanso
    const totalMin = w * c + b * Math.max(0, c - 1);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const summaryEl = document.getElementById('config-summary');
    if (!summaryEl) return;
    summaryEl.innerHTML = h > 0
        ? `Total estimado: <strong>${h}h ${m > 0 ? m + ' min' : '0 min'}</strong>`
        : `Total estimado: <strong>${m} min</strong>`;
}

// ==================== HELPERS ====================
// readClampedValue: normaliza el valor del input al rango [min, max],
// escribe el valor de vuelta para mantener la UI en sintonía y lo devuelve.
// Si el elemento no existe o su valor es NaN, se devuelve min como fallback real.
function readClampedValue(el, min, max) {
    if (!el) return min;
    let v = parseInt(el.value);
    if (isNaN(v) || v < min) v = min;
    if (v > max) v = max;
    el.value = v;
    return v;
}

function formatTime(seconds) {
    const s = Math.max(0, seconds);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`;
}

// ==================== LÓGICA DEL TIMER ====================
function iniciarPomodoros() {
    requestNotificationPermissionOnUserGesture();

    const wInput = document.getElementById('work-minutes');
    const bInput = document.getElementById('break-minutes');
    const cInput = document.getElementById('ciclos-input');

    workMinutes  = readClampedValue(wInput,  1, 180);
    breakMinutes = readClampedValue(bInput,  1,  60);
    const ciclos = readClampedValue(cInput,  1,  20);

    ciclosContainer.classList.add('hidden');
    // Quitar 'hidden' y añadir 'active' en el mismo frame para evitar parpadeo
    countdownDiv.classList.remove('hidden');
    countdownDiv.classList.add('active');

    const descansoLabel = document.getElementById('descanso-label');
    if (descansoLabel) descansoLabel.textContent = `${breakMinutes} minutos de descanso`;

    ciclosTotales = ciclos;
    cicloActual   = 0;
    isPaused      = false;
    sessionFinished = false;
    isTransitioning = false;
    hiddenAt = null;
    timerWasRunningWhenHidden = false;
    iniciarCicloTrabajo();
}

function resetPauseState() {
    isPaused = false;
    pauseBtn.disabled = false;
    pauseBtn.removeAttribute('aria-disabled');
    pauseBtn.innerHTML = '<i class="fas fa-pause"></i><span>Pausar</span>';
    pauseBtn.classList.remove('paused');
    document.body.classList.remove('timer-paused');
    // El resume del audio ambiental se hace en startTimer(), una vez que el
    // intervalo ya está configurado, para garantizar el orden de operaciones.
}

function iniciarCicloTrabajo() {
    // Punto de entrada tras un descanso completado.
    // Cuando iniciarDescanso detecta que ya no hay más ciclos, llama directamente
    // a finalizarTodo — por lo que este guard nunca se dispara en uso normal.
    // Se conserva únicamente como defensa frente a llamadas externas inesperadas.
    if (cicloActual >= ciclosTotales) return finalizarTodo();
    cicloActual++;

    isDescanso   = false;
    tiempoActual = workMinutes * 60;
    tiempoInicial = tiempoActual;
    _suppressProgressTransition = true;

    resetPauseState();

    playPhaseChangeSound(false);
    showNotification('🟥 Pomodoro', `Ciclo ${cicloActual}/${ciclosTotales} — ¡Enfócate!`);

    actualizarPantalla();
    startTimer();
}

function iniciarDescanso() {
    // No descanso después del último ciclo — ir directo al final
    if (cicloActual >= ciclosTotales) return finalizarTodo();

    isDescanso   = true;
    tiempoActual = breakMinutes * 60;
    tiempoInicial = tiempoActual;
    _suppressProgressTransition = true;

    resetPauseState();

    playPhaseChangeSound(true);
    showNotification('🟩 Descanso', `Ciclo ${cicloActual}/${ciclosTotales} — Recupera energías`);

    actualizarPantalla();
    startTimer();
}

function startTimer() {
    // Reset the transition guard here — after the new phase is fully configured —
    // so any stale tick from the old interval can't sneak through during setup.
    isTransitioning = false;
    clearInterval(intervalo);
    // Anclar timestamp de inicio para compensar drift acumulado del event loop.
    // tick() calculará tiempoActual como (phaseStartSeconds - elapsed) en lugar de
    // decrementar 1 cada vez, eliminando la desviación en sesiones largas (90 min+).
    phaseStartTime    = Date.now();
    phaseStartSeconds = tiempoActual;
    intervalo = setInterval(tick, 1000);
    // Reanudar audio ambiental aquí, con el timer ya configurado, salvo que el
    // usuario lo haya muteado manualmente o la sesión haya finalizado.
    if (ambientSound && !userMutedAmbient && !ambientSound.playing() && !sessionFinished) {
        ambientSound.play();
    }
}

function completeCurrentPhase() {
    if (isTransitioning) return;
    isTransitioning = true;     // bloquear antes de clearInterval para cerrar la ventana
    clearInterval(intervalo);
    intervalo = null;
    if (isDescanso) {
        iniciarCicloTrabajo();
    } else {
        iniciarDescanso();
    }
}

function tick() {
    if (isPaused || isTransitioning || sessionFinished) return;
    if (!phaseStartTime) return;

    // Calcular tiempo restante desde el timestamp de inicio de la fase para
    // evitar el drift acumulado de setInterval en sesiones largas (90 min+).
    // El delta se redondea hacia abajo: tiempoActual avanza en segundos enteros
    // tal como el usuario espera, pero los errores de timing del event loop
    // no se acumulan entre ticks.
    const elapsedSinceStart = Math.floor((Date.now() - phaseStartTime) / 1000);
    tiempoActual = Math.max(0, phaseStartSeconds - elapsedSinceStart);

    // Mostrar 00:00 en pantalla ANTES de hacer transición de fase,
    // para que el usuario vea el último segundo correctamente.
    actualizarPantalla();
    if (tiempoActual <= 0) {
        completeCurrentPhase();
    }
}

function handleTimerVisibilityChange() {
    // Guard temprano: si la sesión ya terminó, ignorar cualquier evento de visibilidad.
    // Sin este guard, una carrera entre finalizarTodo() y el evento 'visible' podía
    // volver a llamar a completeCurrentPhase() con sessionFinished=true.
    if (document.visibilityState === 'visible' && sessionFinished) return;

    // Re-sincronizar permiso de notificaciones cuando el usuario vuelve a la app:
    // puede haberlo concedido desde ajustes del navegador mientras estaba en background.
    if (document.visibilityState === 'visible' && 'Notification' in window) {
        notificationsEnabled = Notification.permission === 'granted';
    }

    if (document.visibilityState === 'hidden') {
        timerWasRunningWhenHidden = Boolean(intervalo && !isPaused && !isTransitioning && !sessionFinished);
        hiddenAt = timerWasRunningWhenHidden ? Date.now() : null;
        if (timerWasRunningWhenHidden) {
            clearInterval(intervalo);
            intervalo = null;
        }
        return;
    }

    if (!hiddenAt || !timerWasRunningWhenHidden) return;

    const elapsedSeconds = Math.floor((Date.now() - hiddenAt) / 1000);
    hiddenAt = null;
    timerWasRunningWhenHidden = false;

    if (sessionFinished) return;

    // Limpiar cualquier intervalo activo (puede existir si el navegador no
    // disparó correctamente el evento 'hidden' o en condiciones de carrera)
    // antes de compensar el tiempo transcurrido.
    if (intervalo) { clearInterval(intervalo); intervalo = null; }

    if (elapsedSeconds > 0) {
        tiempoActual = Math.max(0, tiempoActual - elapsedSeconds);
        // Reanclar el timestamp de fase para que tick() parta desde el nuevo
        // tiempoActual ya compensado, sin volver a restar el tiempo en background.
        phaseStartTime    = Date.now();
        phaseStartSeconds = tiempoActual;
        _suppressProgressTransition = true;
        if (tiempoActual <= 0) {
            // Re-verificar sessionFinished: puede haber cambiado entre el guard
            // temprano y este punto si finalizarTodo() corrió en el mismo tick.
            if (!sessionFinished) completeCurrentPhase();
            return;
        }
        // Solo actualizar pantalla si la sesión sigue activa
        if (!sessionFinished) actualizarPantalla();
    }

    // Re-verificar antes de reanudar el timer y el audio para cerrar la ventana
    // de carrera entre el cálculo de elapsed y las funciones de inicio.
    if (sessionFinished) return;
    if (!intervalo && !isPaused && !isTransitioning) {
        startTimer();
    }
    if (ambientSound && !userMutedAmbient && !ambientSound.playing()) {
        ambientSound.play();
    }
}

function togglePause() {
    isPaused = !isPaused;
    const icon = isPaused ? 'play' : 'pause';
    const text = isPaused ? 'Reanudar' : 'Pausar';

    pauseBtn.innerHTML = `<i class="fas fa-${icon}"></i><span>${text}</span>`;
    pauseBtn.classList.toggle('paused', isPaused);
    // Fix: usar clase en body para controlar animación pulseTimer correctamente
    document.body.classList.toggle('timer-paused', isPaused);

    if (!isPaused) {
        // Al reanudar, reanclar el timestamp de inicio para que el tiempo que
        // estuvo pausado no cuente como tiempo transcurrido en tick().
        phaseStartTime    = Date.now();
        phaseStartSeconds = tiempoActual;
    }

    if (ambientSound) {
        if (isPaused) {
            ambientSound.pause();
        } else if (!userMutedAmbient && !sessionFinished) {
            ambientSound.play();
        }
    }
}

function snapProgressBar(pct) {
    progressBar.style.transition = 'none';
    progressBar.style.width = `${pct}%`;
    // Forzar reflow síncrono leyendo offsetWidth — garantiza que el navegador ha
    // pintado el frame sin transición antes de restaurarla, eliminando la dependencia
    // del timing del doble-rAF que podía restaurar la transición prematuramente.
    void progressBar.offsetWidth;
    progressBar.style.transition = '';
}

function actualizarPantalla() {
    const display = isDescanso ? descansoTime : timerDisplay;
    display.textContent = formatTime(tiempoActual);

    cicloActualEl.textContent = cicloActual;
    cicloTotalEl.textContent  = ciclosTotales;

    const porcentaje = Math.max(0, (tiempoActual / tiempoInicial) * 100);
    if (_suppressProgressTransition) {
        _suppressProgressTransition = false;
        snapProgressBar(porcentaje);
    } else {
        progressBar.style.width = `${porcentaje}%`;
    }

    countdownDiv.classList.toggle('descanso-mode', isDescanso);

    if (isDescanso) {
        trabajoContainer.classList.add('hidden');
        descansoContainer.classList.remove('hidden');
        modoActual.textContent = 'DESCANSO';
        // Fix: clases CSS en lugar de inline style — estilos definidos en pomodoro.css
        modoActual.parentElement.classList.remove('mode-work');
        modoActual.parentElement.classList.add('mode-break');
    } else {
        trabajoContainer.classList.remove('hidden');
        descansoContainer.classList.add('hidden');
        modoActual.textContent = 'TRABAJO';
        modoActual.parentElement.classList.remove('mode-break');
        modoActual.parentElement.classList.add('mode-work');
    }
}

function cleanupAudioState() {
    // Señalizar a cualquier rama async de playAmbient() que siga en vuelo
    // (awaits pendientes de isSoundCached o de instanciación de Howl) que debe
    // abortar sin crear ni asignar Howls. Se resetea en resetSessionState().
    audioCleanedUp = true;
    // Nulificar currentAmbient ANTES de detener el sonido para que cualquier
    // instancia de playAmbient que esté en un await lo detecte y aborte.
    currentAmbient = null;
    userMutedAmbient = false; // Bug fix: restaurar mute manual para la próxima sesión

    // Capturar la referencia ANTES de nulificar la variable global.
    // Si playAmbient() tiene un await pendiente y llega a asignar
    // ambientSound = localSound justo después de que limpiamos aquí,
    // ese nuevo Howl quedaría huérfano sin unload(). Al operar sobre
    // la referencia local (toDestroy) nos aseguramos de destruir
    // exactamente el Howl que existía en el momento de llamar a cleanup,
    // sin tocar ningún Howl que pueda haberse creado concurrentemente.
    const toDestroy = ambientSound;
    ambientSound = null;
    if (toDestroy) {
        try { toDestroy.stop(); } catch (_) {}
        try { toDestroy.unload(); } catch (_) {}
    }

    // Cancelar cualquier timeout de transición de fondo pendiente antes de limpiar
    if (ambientBgTimeout !== null) {
        clearTimeout(ambientBgTimeout);
        ambientBgTimeout = null;
    }

    const ambSel = document.getElementById('ambient-select');
    if (ambSel) ambSel.value = 'none';
    const volSlider = document.getElementById('volume-slider');
    if (volSlider) volSlider.value = currentVolume; // resync visual; currentVolume no cambia
    setAmbientBg(null);
    hideBanner();
    syncAmbientUI();

    if (sharedAudioContext && sharedAudioContext.state !== 'closed') {
        // Retardar el cierre ~1.5 s para que los osciladores activos de
        // playPhaseChangeSound (duración máxima 1.1 s + 200 ms de delay) terminen
        // su fade-out antes de que el contexto se cierre. Sin este margen, osc.stop()
        // se llama sobre un contexto cerrado y lanza una excepción silenciada.
        const ctxToClose = sharedAudioContext;
        sharedAudioContext = null;
        setTimeout(() => {
            if (ctxToClose.state !== 'closed') ctxToClose.close().catch(() => {});
        }, 1500);
    }
}

function resetSessionState() {
    clearInterval(intervalo);
    intervalo = null;
    // Cancelar confetti si aún está activo
    if (_confettiInterval) { clearInterval(_confettiInterval); _confettiInterval = null; }
    sessionFinished = false;
    isPaused = false;
    isTransitioning = false;
    hiddenAt = null;
    timerWasRunningWhenHidden = false;
    phaseStartTime = null;
    phaseStartSeconds = 0;
    cicloActual = 0;
    ciclosTotales = readClampedValue(document.getElementById('ciclos-input'), 1, 20);
    workMinutes = readClampedValue(document.getElementById('work-minutes'), 1, 180);
    breakMinutes = readClampedValue(document.getElementById('break-minutes'), 1, 60);
    isDescanso = false;
    tiempoActual = workMinutes * 60;
    tiempoInicial = tiempoActual;
    _suppressProgressTransition = true;

    cleanupAudioState();
    // Permitir de nuevo la creación de Howls en la próxima sesión
    audioCleanedUp = false;

    // Limpiar estado de confirmación de reset si estaba pendiente
    _resetConfirming = false;
    if (_resetCancelTimeout) {
        clearTimeout(_resetCancelTimeout);
        _resetCancelTimeout = null;
    }
    if (_resetClickOutsideHandler) {
        document.removeEventListener('click', _resetClickOutsideHandler);
        _resetClickOutsideHandler = null;
    }

    const finEl = document.getElementById('fin-sesion');
    if (finEl) finEl.remove();
    _finScreenRendered = false;

    ciclosContainer.classList.remove('hidden');
    countdownDiv.classList.remove('active');
    countdownDiv.classList.add('hidden');
    countdownDiv.classList.remove('descanso-mode');
    document.body.classList.remove('timer-paused');

    trabajoContainer.classList.remove('hidden');
    descansoContainer.classList.add('hidden');

    const estadoEl = countdownDiv.querySelector('.estado');
    if (estadoEl) {
        estadoEl.classList.remove('hidden', 'mode-break');
        estadoEl.classList.add('mode-work');
    }
    modoActual.textContent = 'TRABAJO';

    const progressContainer = countdownDiv.querySelector('.progress-container');
    const controls = countdownDiv.querySelector('.controls');
    const infoCiclo = countdownDiv.querySelector('.info-ciclo');
    if (progressContainer) progressContainer.classList.remove('hidden');
    if (controls) controls.classList.remove('hidden');
    if (infoCiclo) infoCiclo.classList.remove('hidden');

    pauseBtn.disabled = false;
    pauseBtn.removeAttribute('aria-disabled');
    pauseBtn.style.display = '';
    pauseBtn.innerHTML = '<i class="fas fa-pause"></i><span>Pausar</span>';
    pauseBtn.classList.remove('paused');
    resetBtn.disabled = false;
    resetBtn.removeAttribute('aria-disabled');
    resetBtn.style.display = '';
    resetBtn.innerHTML = '<i class="fas fa-redo"></i> Reiniciar';

    cicloActualEl.textContent = '1';
    cicloTotalEl.textContent = ciclosTotales;
    timerDisplay.textContent = formatTime(tiempoActual);
    descansoTime.textContent = formatTime(breakMinutes * 60);
    const descansoLabel = document.getElementById('descanso-label');
    if (descansoLabel) descansoLabel.textContent = `${breakMinutes} minutos de descanso`;
    progressBar.style.width = '100%';
    updateSummary();
}

function finalizarTodo() {
    clearInterval(intervalo);
    intervalo = null;
    sessionFinished = true;
    isPaused = false; // limpiar estado de pausa por si el timer terminó estando pausado
    isTransitioning = false; // limpiar para no bloquear futuros runs si se reutiliza el estado
    hiddenAt = null;
    timerWasRunningWhenHidden = false;
    phaseStartTime = null;
    phaseStartSeconds = 0;
    document.body.classList.remove('timer-paused');

    // Cancelar confirmación de reset pendiente si el timer termina mientras está activa
    _resetConfirming = false;
    if (_resetCancelTimeout) { clearTimeout(_resetCancelTimeout); _resetCancelTimeout = null; }
    if (_resetClickOutsideHandler) {
        document.removeEventListener('click', _resetClickOutsideHandler);
        _resetClickOutsideHandler = null;
    }

    pauseBtn.disabled = true;
    pauseBtn.setAttribute('aria-disabled', 'true');
    // Hide action buttons entirely on session end — disable + hide is cleaner than
    // showing a greyed-out "Reiniciar" button next to the new "Nueva sesión" button.
    pauseBtn.style.display = 'none';
    resetBtn.innerHTML = '<i class="fas fa-redo"></i> Reiniciar'; // restaurar en caso de que estuviera en modo ¿Confirmar?
    resetBtn.style.display = 'none';
    resetBtn.disabled = true;

    // Actualizar el DOM de pantalla final ANTES de limpiar el audio: así el fade-out
    // del fondo ambiental (1.2 s) ocurre mientras la pantalla de fin ya está visible,
    // evitando el flash visual que producía limpiar el fondo antes de pintar la UI.
    showNotification('🎉 ¡Completado!', 'Has terminado todos los ciclos. ¡Excelente trabajo!');
    launchVictoryConfetti();
    mostrarPantallaFin();
    cleanupAudioState();
}

function mostrarPantallaFin() {
    const trabajoEl  = document.getElementById('trabajo-container');
    const descansoEl = document.getElementById('descanso-container');
    if (trabajoEl)  trabajoEl.classList.add('hidden');
    if (descansoEl) descansoEl.classList.add('hidden');

    // Ocultar también el badge de modo (TRABAJO/DESCANSO)
    const estadoEl = countdownDiv.querySelector('.estado');
    if (estadoEl) estadoEl.classList.add('hidden');

    // Guard via module-level flag: si por cualquier razon se llama dos veces
    // no se duplica el boton ni se registra un segundo listener.
    if (!_finScreenRendered) {
        _finScreenRendered = true;
        const finEl = document.createElement('div');
        finEl.id = 'fin-sesion';
        finEl.style.cssText = 'text-align:center;padding:10px 0 20px;animation:fadeInScale 0.5s ease forwards';

        // Construir el DOM manualmente para evitar interpolación de valores
        // numéricos en innerHTML (patrón XSS aunque aquí el valor sea seguro).
        const emoji = document.createElement('div');
        emoji.style.cssText = 'font-size:3.5rem;margin-bottom:12px';
        emoji.textContent = '🎉';

        const title = document.createElement('h2');
        title.style.cssText = 'font-size:1.6rem;font-weight:700;color:var(--accent-break);margin-bottom:8px';
        title.textContent = '¡Sesión completada!';

        const desc = document.createElement('p');
        desc.style.cssText = 'color:var(--text-secondary);font-size:0.95rem;margin-bottom:28px';
        desc.textContent = 'Has completado ';
        const strong = document.createElement('strong');
        strong.style.color = 'var(--text-primary)';
        strong.textContent = `${ciclosTotales} ciclo${ciclosTotales !== 1 ? 's' : ''}`;
        desc.appendChild(strong);
        desc.appendChild(document.createTextNode(' de trabajo. ¡Excelente esfuerzo!'));

        const btn = document.createElement('button');
        btn.id = 'nueva-sesion-btn';
        btn.style.cssText = [
            'padding:14px 32px',
            'background:var(--accent-work)',
            'color:white',
            'border:none',
            'border-radius:50px',
            'font-size:1.05rem',
            'font-weight:700',
            'font-family:inherit',
            'cursor:pointer',
            'display:inline-flex',
            'align-items:center',
            'gap:10px',
            'box-shadow:0 6px 20px rgba(211,47,47,0.35)',
            'transition:all 0.3s ease'
        ].join(';');
        // Construir el contenido del botón íntegramente con el DOM API,
        // sin mezclar innerHTML y appendChild en el mismo elemento.
        const btnIcon = document.createElement('i');
        btnIcon.className = 'fas fa-redo';
        btn.appendChild(btnIcon);
        btn.appendChild(document.createTextNode(' Nueva sesión'));

        finEl.appendChild(emoji);
        finEl.appendChild(title);
        finEl.appendChild(desc);
        finEl.appendChild(btn);
        countdownDiv.appendChild(finEl);

        document.getElementById('nueva-sesion-btn').addEventListener('click', () => {
            resetSessionState();
        });
    }

    const progressContainer = countdownDiv.querySelector('.progress-container');
    const controls          = countdownDiv.querySelector('.controls');
    const infoCiclo         = countdownDiv.querySelector('.info-ciclo');
    if (progressContainer) progressContainer.classList.add('hidden');
    if (controls)          controls.classList.add('hidden');
    if (infoCiclo)         infoCiclo.classList.add('hidden');
}

// Referencia al listener onClickOutside del resetBtn guardada a nivel de módulo.
// Permite que removeEventListener siempre elimine exactamente la función registrada,
// incluso entre llamadas rápidas al botón, sin depender del closure del setTimeout.
let _resetClickOutsideHandler = null;
let _resetConfirming = false;
let _resetCancelTimeout = null;


document.addEventListener('DOMContentLoaded', () => {
    // Fix: asignar refs DOM aquí para que sean seguras independientemente
    // de dónde esté el <script> (head con defer, body, etc.)
    ciclosContainer   = document.getElementById('ciclos-container');
    countdownDiv      = document.getElementById('countdown');
    trabajoContainer  = document.getElementById('trabajo-container');
    descansoContainer = document.getElementById('descanso-container');
    timerDisplay      = document.getElementById('countdown-text');
    descansoTime      = document.getElementById('descanso-time');
    modoActual        = document.getElementById('modo-actual');
    progressBar       = document.getElementById('progress-bar');
    pauseBtn          = document.getElementById('pause-btn');
    resetBtn          = document.getElementById('reset-btn');
    cicloActualEl     = document.getElementById('ciclo-actual');
    cicloTotalEl      = document.getElementById('ciclo-total');
    themeToggle       = document.getElementById('theme-toggle');

    initTheme();
    initAmbientControls();
    initNotifications();
    initInstallButton();
    initModals();
    initDonations();
    initSuggestionForm();
    initConfigControls();
    initOfflineGuide();
    applyURLPreset();

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', event => {
            if (event.data?.type === 'SW_FALLBACK_ACTIVE') {
                showToast('Modo offline básico activo. Algunas funciones pueden tardar en cachearse.');
            }
        });
    }

    document.addEventListener('visibilitychange', handleTimerVisibilityChange);
    pauseBtn.addEventListener('click', togglePause);

    resetBtn.addEventListener('click', (evt) => {
        // Evitar confirm() bloqueante: mostrar confirmacion inline en el propio boton
        if (_resetConfirming) {
            // Limpiar el timeout de cancelación antes de recargar
            if (_resetCancelTimeout) { clearTimeout(_resetCancelTimeout); _resetCancelTimeout = null; }
            if (_resetClickOutsideHandler) {
                document.removeEventListener('click', _resetClickOutsideHandler);
                _resetClickOutsideHandler = null;
            }
            _resetConfirming = false;
            resetSessionState();
            return;
        }

        // Limpiar cualquier handler y timeout previos antes de registrar uno nuevo
        if (_resetCancelTimeout) { clearTimeout(_resetCancelTimeout); _resetCancelTimeout = null; }
        if (_resetClickOutsideHandler) {
            document.removeEventListener('click', _resetClickOutsideHandler);
            _resetClickOutsideHandler = null;
        }

        const originalHTML = resetBtn.innerHTML;
        _resetConfirming = true;
        resetBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> <span>¿Confirmar?</span>';

        const cancelConfirm = () => {
            _resetConfirming = false;
            _resetCancelTimeout = null;
            resetBtn.innerHTML = originalHTML;
            if (_resetClickOutsideHandler) {
                document.removeEventListener('click', _resetClickOutsideHandler);
                _resetClickOutsideHandler = null;
            }
        };

        _resetCancelTimeout = setTimeout(cancelConfirm, 3000);

        _resetClickOutsideHandler = (e) => {
            if (!resetBtn.contains(e.target)) {
                if (_resetCancelTimeout) { clearTimeout(_resetCancelTimeout); _resetCancelTimeout = null; }
                cancelConfirm();
            }
        };

        // Registrar el handler en el siguiente tick para que este mismo evento click
        // no lo dispare inmediatamente. Usar capture:false para que los clicks en el
        // propio botón pasen primero por el listener del botón (que gestiona _resetConfirming)
        // antes que por este handler externo.
        // CORRECCIÓN: en lugar de setTimeout(0) —que creaba una ventana de carrera
        // con dobles clicks muy rápidos—, detenemos la propagación del click actual
        // y registramos el handler de forma síncrona. Así no hay tick en el que
        // _resetConfirming sea true pero el handler aún no esté registrado.
        evt.stopPropagation();
        document.addEventListener('click', _resetClickOutsideHandler);
    });

    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space'
            && !sessionFinished
            && !countdownDiv.classList.contains('hidden')
            && !isAnyModalOpen()) {
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            e.preventDefault();
            togglePause();
        }
    });
});

// ==================== TUTORIAL OFFLINE ====================
function initOfflineGuide() {
    const modal = document.getElementById('modal-offline-guide');
    if (!modal) return;
    // Guard contra doble inicialización (coherente con initSuggestionForm)
    if (modal.dataset.initialized) return;
    modal.dataset.initialized = 'true';

    // Auto-detectar plataforma para mostrar la pestaña más relevante por defecto
    const ua = navigator.userAgent.toLowerCase();
    let defaultTab = 'android';
    if (/iphone|ipad|ipod/.test(ua)) {
        defaultTab = 'ios';
    } else if (!/android/.test(ua)) {
        defaultTab = 'desktop';
    }
    _activateOfflineTab(modal, defaultTab);

    // Delegación de eventos en las tabs
    modal.addEventListener('click', (e) => {
        const tab = e.target.closest('.ofl-tab[data-tab]');
        if (!tab) return;
        _activateOfflineTab(modal, tab.dataset.tab);
    });
}

function _activateOfflineTab(modal, tabId) {
    // Actualizar tabs
    modal.querySelectorAll('.ofl-tab').forEach(btn => {
        const active = btn.dataset.tab === tabId;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    // Mostrar panel correcto
    modal.querySelectorAll('.ofl-panel').forEach(panel => {
        panel.classList.toggle('hidden', panel.id !== `ofl-${tabId}`);
    });
}
