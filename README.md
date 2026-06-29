# 🍅 Pomodoro Timer

Temporizador Pomodoro gratuito, sin anuncios y sin registro. Progressive Web App (PWA) instalable con soporte offline completo, sonidos ambientales, temas claro/oscuro e internacionalización en español, inglés y portugués.

**Demo:** [paulaspeciale.github.io/pomodoro](https://paulaspeciale.github.io/pomodoro/)

---

## Funcionalidades

### Temporizador
- Ciclos de trabajo y descanso completamente configurables (1–180 min trabajo, 1–60 min descanso, 1–20 ciclos)
- Tres presets rápidos: **Clásico 25/5**, **50/10** y **Deep Work 90/20**
- Progreso visual con barra animada y compensación de drift acumulado (corrección por timestamp, no por tick)
- Pausa/reanudación con confirmación inline en el botón de reinicio (sin `confirm()` bloqueante)
- Compensación automática del tiempo transcurrido al volver desde segundo plano (`visibilitychange`)
- Pantalla de fin de sesión con confetti y botón de nueva sesión

### Sonidos ambientales
- Seis opciones: sin sonido, lluvia, ruido rosa, ruido blanco, bosque y océano
- Control de volumen con slider y botón de mute/unmute
- Descarga y caché offline de cada sonido por separado (Cache API + progreso de descarga)
- Fondo visual animado sincronizado con cada ambiente (gotas, espectrograma, píxeles, luciérnagas, estrellas y olas)

### Internacionalización (i18n)
- Soporte completo para **Español**, **Inglés** y **Portugués**
- Detección automática por `navigator.languages` con fallback a español
- Persistencia de preferencia en `localStorage`
- Sistema de traducciones propio sin dependencias externas: atributos `data-i18n`, `data-i18n-aria`, `data-i18n-ph` y `data-i18n-title`
- Cambio de idioma en tiempo real sin recargar la página
- 117 claves de traducción con paridad entre los tres archivos de locale

### Tema visual
- Paleta inspirada en café parisino vintage (rojo vino, crema, oliva, ámbar)
- Tres estados: sigue al sistema operativo (`prefers-color-scheme`), forzado claro o forzado oscuro
- Preferencia guardada en `localStorage` con migración del formato anterior

### PWA e instalación
- Instalable como app en Android (Chrome), iOS (Safari) y escritorio (Chrome/Edge)
- Offline completo desde la primera instalación: shell, scripts, estilos y locales precacheados por el Service Worker
- Shortcuts del manifest para iniciar directamente con un preset desde el launcher
- Versión del Service Worker generada por hash del HTML (sin depender de cabeceras HTTP)

### Notificaciones y accesibilidad
- Notificaciones del sistema al cambiar de fase (trabajo → descanso y viceversa)
- Sonido de cambio de fase vía Web Audio API (oscilador sine, sin archivos externos)
- `aria-live` regions para anuncios de fase en lectores de pantalla
- Focus trap en modales, roving tabindex en tabs, skip link y `:focus-visible` en todos los interactivos
- Compatible con `prefers-reduced-motion`

### Modales y formulario
- Modales de: Sobre mí, Sobre la app, Donaciones, Otros proyectos, Sugerencias y Guía offline
- Formulario de sugerencias enviado vía FormSubmit (AJAX, sin backend propio)
- Guía offline con tabs por plataforma (Android, iOS, escritorio) con auto-detección del dispositivo

---

## Tecnologías

### Core
| Tecnología | Uso |
|---|---|
| HTML5 | Estructura semántica, atributos ARIA, metadatos SEO y PWA |
| CSS3 | Custom properties (variables de tema), animaciones, layout responsive |
| JavaScript (ES2020+) | Lógica del timer, i18n, audio, Service Worker, Cache API |

### APIs del navegador
| API | Uso |
|---|---|
| Service Worker API | Estrategias de caché (shell, sonidos, CDN, páginas), precache en install |
| Cache API | Caché offline de sonidos ambientales con progreso de descarga |
| Web Audio API | Sonido de cambio de fase (oscilador, sin archivos de audio) |
| Notifications API | Notificaciones del sistema al cambiar de fase |
| Web App Manifest | Instalación PWA, shortcuts, iconos, colores de tema |
| localStorage | Preferencias de idioma, tema y volumen |
| History API | Limpieza de parámetros de URL tras aplicar presets |
| Clipboard API | Copia del alias de donación (con fallback `execCommand`) |
| Page Visibility API | `visibilitychange` para compensar tiempo transcurrido en segundo plano |

### Librerías externas (CDN)
| Librería | Versión | Uso |
|---|---|---|
| [Howler.js](https://howlerjs.com/) | 2.2.4 | Reproducción de sonidos ambientales (HTML5 audio con fallback Web Audio) |
| [canvas-confetti](https://github.com/catdad/canvas-confetti) | 1.9.3 | Animación de confetti en la pantalla de fin de sesión |
| [Font Awesome](https://fontawesome.com/) | 6.5.2 | Iconografía de la interfaz |

### Integración de terceros
| Servicio | Uso |
|---|---|
| [FormSubmit](https://formsubmit.co/) | Envío del formulario de sugerencias (AJAX, sin backend) |
| [Cafecito](https://cafecito.app/) | Botón de donación para Argentina |

---

## Estructura del proyecto

```
/
├── index.html              # App shell y estructura de la UI
├── pomodoro.js             # Lógica principal: timer, audio, modales, PWA
├── pomodoro.css            # Estilos: temas, animaciones, responsive
├── i18n.js                 # Sistema de internacionalización
├── sw.js                   # Service Worker: estrategias de caché
├── sw-register.js          # Registro del SW (fuera del HTML por CSP)
├── manifest.json           # Web App Manifest
├── robots.txt              # Directivas para crawlers
├── sitemap.xml             # Mapa del sitio
├── locales/
│   ├── es.json             # Traducciones en español (base)
│   ├── en.json             # Traducciones en inglés
│   └── pt.json             # Traducciones en portugués
└── img/
    ├── icons/
    │   ├── favicon.svg
    │   ├── icon-pomodoro.svg
    │   └── apple-touch-icon.png
    └── sounds/
        ├── rain.mp3
        ├── pinknoise.mp3
        ├── whitenoise.mp3
        ├── woods.mp3
        └── ocean.mp3
```

---

## Arquitectura

### Timer
El timer evita el drift acumulado de `setInterval` anclando un timestamp al inicio de cada fase (`phaseStartTime`) y calculando el tiempo restante como `phaseStartSeconds - elapsed` en cada tick, en lugar de decrementar 1 segundo por intervalo. Al volver desde segundo plano, el tiempo transcurrido se compensa en un solo paso antes de reiniciar el intervalo.

### Service Worker
Implementa cinco estrategias nativas sin Workbox:
- **NetworkFirst** para navegación (con fallback a `index.html` para modo SPA offline)
- **CacheFirst** para sonidos (archivos grandes que cambian poco)
- **StaleWhileRevalidate** para scripts, estilos, imágenes y CDN externas

La versión del SW se genera como hash del HTML serializado para garantizar actualizaciones en cada deploy sin depender de las cabeceras `Last-Modified` del servidor.

### i18n
Módulo propio sin dependencias. Carga archivos JSON desde `/locales/` con `fetch({ cache: 'default' })` — evita cachear respuestas 404 de arranques en carrera con el SW. Los strings se aplican al DOM mediante atributos declarativos (`data-i18n`, `data-i18n-aria`, `data-i18n-ph`, `data-i18n-title`) y mediante la función `t(key)` para strings dinámicos generados por JavaScript.

### Audio ambiental
Usa un único `AudioContext` compartido por sesión para el sonido de cambio de fase (evita el límite de ~6 contextos simultáneos del navegador). Los sonidos ambientales se manejan con Howler.js, con guards de concurrencia para abortar instancias huérfanas si el usuario cambia de ambiente mientras un archivo está cargando.

---

## Instalación local

No requiere build ni dependencias de Node. Sirve los archivos estáticos con cualquier servidor local:

```bash
# Con Python
python -m http.server 5500

# Con Node
npx serve .

# Con VS Code
# Extensión Live Server → clic derecho en index.html → Open with Live Server
```

> El Service Worker solo se activa en `localhost` o bajo HTTPS. En HTTP sin `localhost` la app funciona pero sin funcionalidad offline.

---

## Despliegue

Sitio estático desplegable en cualquier hosting de archivos planos. Actualmente en **GitHub Pages**.

Antes de desplegar en un dominio propio, reemplazar `paulaspeciale.github.io/pomodoro` por el dominio real en:
- `index.html` (canonical, og:url, og:image, twitter:image, JSON-LD)
- `sitemap.xml` (todos los elementos `<loc>` y `<xhtml:link>`)
- `robots.txt` (directiva `Sitemap:`)

---

## Licencia

Uso personal y educativo libre. Para uso comercial, contactar a la autora.
