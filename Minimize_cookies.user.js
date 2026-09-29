/*
  Copyright (c) 2026 DrATLopez Andino Tur López.
  Todos los derechos reservados. / Licencia Creative Commons Atribución-NoComercial 4.0 (CC BY-NC 4.0)
  Repositorio oficial: https://github.com/dratlopez
*/
// ==UserScript==
// @name         Minimize Cookies (carita boca torcida)
// @namespace    http://tampermonkey.net/
// @version      2.9
// @description  Sube automáticamente de confianza BAJA a MEDIA cuando el propio botón encontrado por la heurística de último recurso menciona "cookie" en su texto (p. ej. "Manage Cookies"), como en los diálogos genéricos de Radix UI/shadcn sin ningún selector fijo al que agarrarse (arena.ai). Corrige el log de descarte por confianza baja, que mostraba el propio icono del script en vez del elemento real de la página. Añade el patrón "Aceptar solo cookies necesarias" (Liferay) y una regla anti-contenedor que descarta candidatos a botón que también mencionan "aceptar todo". Detecta banners de cookies en varios idiomas con soporte para OneTrust, Cookiebot, Didomi, Usercentrics y consentmanager.net. Panel de depuración en pantalla (DEBUG=true) con historial acumulado. Incluye soporte de Shadow DOM, y la cascada habitual: API nativa → selector conocido → texto multi-idioma → abrir preferencias → apagar todo y guardar.
// @author       you
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const DIAMOND_ID = '__cookie_diamond_btn__';
  let currentBanner = null;
  let currentConfidence = 'high'; // 'high' | 'medium' | 'low'
  let diamondEl = null;
  let actionInProgress = false;

  // Modo de depuración: si es 'true', cada vez que se detecta un banner
  // (real o falso positivo) se imprime en la consola (F12) Y se muestra un
  // panel visible en pantalla (abajo a la izquierda) con el mismo detalle:
  // qué elemento fue, qué texto contenía y qué botón/interruptor hizo que
  // se considerara válido. El panel es útil en móvil, donde no hay consola.
  const DEBUG = true;
  const DEBUG_PANEL_ID = '__cookie_diamond_debug_panel__';
  let debugMessages = [];
  // Evita registrar el MISMO elemento una y otra vez en cada sondeo del
  // observer/interval (eso era lo que provocaba el bucle que colgaba la página).
  const loggedBannerElements = new WeakSet();

  function renderDebugPanel() {
    try {
      const fullText = debugMessages.join('\n\n---\n\n');

      let panel = document.getElementById(DEBUG_PANEL_ID);
      if (!panel) {
        panel = document.createElement('div');
        panel.id = DEBUG_PANEL_ID;
        panel.style.cssText = `
          position: fixed;
          left: 10px;
          bottom: 10px;
          max-width: 90vw;
          max-height: 45vh;
          overflow: auto;
          background: #0f1720;
          color: #edf1f5;
          border: 1px solid #e5484d;
          border-radius: 8px;
          padding: 10px;
          font-family: monospace;
          font-size: 11px;
          line-height: 1.4;
          z-index: 2147483647;
          box-shadow: 0 4px 16px rgba(0,0,0,0.5);
          white-space: pre-wrap;
          word-break: break-word;
        `;
        document.body.appendChild(panel);
      }

      panel.innerHTML = '';

      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex; gap:8px; margin-bottom:6px; position:sticky; top:0;';

      const copyBtn = document.createElement('button');
      copyBtn.textContent = '📋 Copiar todo';
      copyBtn.style.cssText = 'font:inherit; font-size:11px; padding:3px 8px; border-radius:4px; border:1px solid #e5484d; background:#1a2733; color:#fff;';
      copyBtn.addEventListener('click', () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(fullText).then(() => {
            copyBtn.textContent = '✓ Copiado';
            setTimeout(() => { copyBtn.textContent = '📋 Copiar todo'; }, 1500);
          }).catch(() => { copyBtn.textContent = '⚠️ Error al copiar'; });
        }
      });

      const clearBtn = document.createElement('button');
      clearBtn.textContent = '🗑️ Vaciar';
      clearBtn.style.cssText = 'font:inherit; font-size:11px; padding:3px 8px; border-radius:4px; border:1px solid #444; background:#1a2733; color:#fff;';
      clearBtn.addEventListener('click', () => { debugMessages = []; renderDebugPanel(); });

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕ Cerrar';
      closeBtn.style.cssText = 'font:inherit; font-size:11px; padding:3px 8px; border-radius:4px; border:1px solid #444; background:#1a2733; color:#fff;';
      closeBtn.addEventListener('click', () => panel.remove());

      bar.appendChild(copyBtn);
      bar.appendChild(clearBtn);
      bar.appendChild(closeBtn);
      panel.appendChild(bar);

      const pre = document.createElement('div');
      pre.textContent = fullText;
      panel.appendChild(pre);

      panel.scrollTop = panel.scrollHeight;
    } catch (e) { /* nunca romper el script por un panel de depuración */ }
  }

  // Añade una línea de texto simple al historial (trazas del proceso de
  // rechazo: qué paso se intentó, si encontró botón, si hubo error...).
  function debugTrace(message) {
    if (!DEBUG) return;
    try {
      console.log('%c[cookie-diamond] ' + message, 'color:#c9791c;');
    } catch (e) { /* no romper por esto */ }
    debugMessages.push('[' + new Date().toLocaleTimeString() + '] ' + message);
    if (debugMessages.length > 40) debugMessages = debugMessages.slice(-40);
    renderDebugPanel();
  }

  function debugLog(label, el, extra) {
    if (!DEBUG) return;
    try {
      console.log(
        '%c[cookie-diamond] ' + label,
        'color:#e5484d;font-weight:bold;',
        el,
        Object.assign(
          {
            texto: (el.textContent || '').trim().slice(0, 200),
            posicion: window.getComputedStyle(el).position,
            html: el.outerHTML.slice(0, 300)
          },
          extra || {}
        )
      );
    } catch (e) { /* nunca romper el script por un log */ }

    try {
      const info = Object.assign(
        {
          etiqueta: label,
          texto: (el.textContent || '').trim().slice(0, 200),
          posicion: window.getComputedStyle(el).position,
          url: location.href,
          html: el.outerHTML.slice(0, 400)
        },
        extra || {}
      );
      debugMessages.push(JSON.stringify(info, null, 2));
      if (debugMessages.length > 40) debugMessages = debugMessages.slice(-40);
      renderDebugPanel();
    } catch (e) { /* nunca romper el script por un panel de depuración */ }
  }

  // --- Palabras clave para localizar el banner de cookies ---
  const BANNER_TEXT_HINTS = [
    'cookies', 'cookie', 'preferencias sobre los datos', 'consentimiento',
    'privacidad', 'datos personales', 'gestionar preferencias',
    'consent', 'privacy', 'personal data', 'consentement', 'confidentialite',
    'confidentialité', 'donnees personnelles', 'données personnelles',
    'einwilligung', 'zustimmung', 'datenschutz', 'personenbezogene daten',
    'consenso', 'privacidade', 'dados pessoais', 'toestemming', 'privacybeleid'
  ];

  // Selectores de CMPs concretos: muy específicos, prácticamente nunca dan falso positivo
  const TRUSTED_BANNER_SELECTORS = [
    '#onetrust-banner-sdk', '#onetrust-consent-sdk',
    '.qc-cmp2-container', '.qc-cmp2-summary-buttons',
    '.didomi-popup-container', '#didomi-host',
    '#CybotCookiebotDialog',
    '#truste-consent-track',
    '.sp_choice_type_11', '.message-container',
    '#cmpbox', '#cmpwrapper' // consentmanager.net
  ];

  // Selectores genéricos por atributo: útiles, pero al ser tan amplios
  // (cualquier "id/class" que contenga "cookie" o "consent") necesitan
  // una verificación extra antes de confiar en ellos (ver isConfirmedCookieBanner).
  const GENERIC_BANNER_SELECTORS = [
    '[id*="consent"]', '[class*="consent"]',
    '[id*="cookie"]', '[class*="cookie"]',
    '[aria-label*="cookie" i]', '[aria-label*="consent" i]'
  ];

  // Botones de "confirmar / guardar / aceptar configuración" (NO "aceptar todo")
  const CONFIRM_BUTTON_HINTS = [
    // Español
    'confirmar opciones', 'confirmar mis opciones', 'guardar', 'guardar opciones',
    'guardar preferencias', 'guardar y salir', 'confirmar', 'aceptar seleccion',
    'aceptar selección', 'aceptar configuracion', 'aceptar configuración', 'aplicar',
    // Inglés
    'save choices', 'save settings', 'save preferences', 'save and exit',
    'confirm choices', 'confirm my choices', 'submit preferences', 'apply', 'save',
    'confirm settings', 'accept settings', 'accept selection',
    // Francés
    'confirmer mes choix', 'confirmer', 'enregistrer', 'appliquer', 'valider',
    // Alemán
    'bestätigen', 'bestatigen', 'speichern', 'übernehmen', 'ubernehmen', 'anwenden',
    // Italiano
    'conferma', 'salva', 'salva le preferenze', 'applica',
    // Portugués
    'confirmar', 'guardar preferências', 'guardar preferencias', 'salvar', 'aplicar',
    // Neerlandés
    'bevestigen', 'opslaan', 'voorkeuren opslaan'
  ];

  // Botones que rechazan TODO de una vez (la opción preferida siempre que exista)
  const REJECT_ALL_HINTS = [
    // Español (frases completas + palabra suelta, p.ej. botones que solo dicen "Denegar")
    'rechazar todo', 'rechazar todas', 'rechazar tudo', 'denegar todo',
    'denegar todas', 'bloquear todo', 'bloquear todas', 'solo necesarias',
    'solo esenciales', 'únicamente necesarias', 'unicamente necesarias',
    'continuar sin aceptar', 'no aceptar todo', 'rechazar cookies',
    'aceptar solo cookies necesarias', 'aceptar solo las necesarias',
    'aceptar unicamente las necesarias', 'aceptar únicamente las necesarias',
    'denegar', 'rechazar', 'bloquear', 'declinar',
    // Inglés
    'reject all', 'decline all', 'refuse all', 'deny all', 'disagree',
    'necessary only', 'essential only', 'reject all cookies', 'reject cookies',
    'continue without accepting', 'block all', 'use necessary cookies only',
    'i do not accept', 'reject', 'decline', 'refuse', 'deny',
    // Francés
    'tout refuser', 'refuser tout', 'refuser tous', 'refuser les cookies',
    'rejeter tout', 'rejeter tous', 'uniquement nécessaire', 'uniquement necessaire',
    'continuer sans accepter', 'refuser', 'rejeter',
    // Alemán
    'alle ablehnen', 'ablehnen', 'nur notwendige', 'nur erforderliche',
    'nur notwendige akzeptieren', 'ohne zustimmung fortfahren',
    // Italiano
    'rifiuta tutto', 'rifiuta tutti', 'rifiuta', 'solo necessari',
    'solo cookie necessari', 'continua senza accettare',
    // Portugués
    'rejeitar tudo', 'recusar tudo', 'rejeitar todos', 'apenas necessarios',
    'apenas necessários', 'continuar sem aceitar', 'recusar', 'rejeitar',
    // Neerlandés
    'alles weigeren', 'weigeren', 'alleen noodzakelijke',
    // Otros idiomas comunes en la UE
    'odrzuc wszystkie', 'odrzuć wszystkie', 'avvisa alla', 'avvis alle', 'afvis alle',
    'hylkaa kaikki', 'hylkää kaikki'
  ];

  // Botones que abren el panel de preferencias/detalle cuando el banner simple no trae "rechazar todo"
  const OPEN_PREFERENCES_HINTS = [
    // Español
    'establecer preferencias', 'gestionar preferencias', 'gestionar cookies',
    'configurar', 'personalizar', 'ver opciones', 'preferencias de cookies',
    'preferencias', 'mas opciones', 'más opciones', 'elegir', 'elige tus opciones',
    'configuracion de privacidad', 'configuración de privacidad', 'configuracion',
    'ajustes de cookies', 'ajustes de privacidad', 'panel de privacidad',
    // Inglés
    'manage preferences', 'manage cookies', 'set preferences', 'more options',
    'more choices', 'cookie settings', 'preferences', 'customize', 'customise',
    'choose your options', 'options', 'privacy settings', 'privacy preferences',
    // Francés
    'gérer les préférences', 'gerer les preferences', 'paramétrer', 'parametrer',
    'personnaliser', 'préférences', 'preferences', 'parametres de confidentialite',
    // Alemán
    'einstellungen verwalten', 'einstellungen', 'präferenzen verwalten',
    'praferenzen verwalten', 'anpassen', 'optionen', 'datenschutzeinstellungen',
    // Italiano
    'gestisci preferenze', 'impostazioni', 'personalizza', 'impostazioni privacy',
    // Portugués
    'gerir preferências', 'gerir preferencias', 'gerenciar preferências',
    'configurações', 'configuracoes', 'configuracoes de privacidade',
    // Neerlandés
    'voorkeuren beheren', 'instellingen'
  ];

  // Frases usadas solo para DESCARTAR candidatos: si un elemento que estamos
  // evaluando como "botón de rechazo/preferencias/confirmar" menciona también
  // una de estas frases de "aceptar todo", es señal segura de que hemos capturado
  // un CONTENEDOR con varios botones dentro (aceptar + rechazar + preferencias...),
  // no un botón individual — un botón real nunca ofrece ambas acciones a la vez.
  const ACCEPT_ALL_WRAPPER_HINTS = [
    'aceptar todo', 'aceptar todas', 'aceitar tudo', 'accept all',
    'autorizar todo', 'autorizar todas', 'permitir todas', 'permitir todo',
    'tout accepter', 'alle akzeptieren', 'accetta tutto', 'alles accepteren',
    'aceptar y continuar'
  ];

  // Busca dentro de un contenedor el primer botón cuyo texto coincida con alguna de las pistas dadas
  function findButtonByHints(container, hints) {
    const clickable = queryDeep(
      container,
      'button, a[role="button"], [role="button"], input[type="submit"], [class*="button" i], [class*="btn" i]'
    );
    for (const el of clickable) {
      const txt = normalize(el.textContent || el.value || '');
      if (!txt) continue;
      // Un botón real casi nunca supera este largo; si lo supera, es señal de
      // que el selector capturó un CONTENEDOR con varios botones dentro
      // (p. ej. una clase "cmpboxbtns" coincide con [class*="btn"]), y su
      // texto sería la concatenación de todas las etiquetas de esos botones.
      if (txt.length > 60) continue;
      // Si además menciona "aceptar todo" y similares, es casi seguro un
      // contenedor con varios botones, no el botón individual que buscamos.
      if (ACCEPT_ALL_WRAPPER_HINTS.some((h) => txt.includes(normalize(h)))) continue;
      if (hints.some((hint) => txt.includes(normalize(hint)))) {
        return el;
      }
    }

    // Fallback: muchos CMPs usan simples enlaces o <span>/<div> cortos como
    // "BLOQUEAR TODO" / "AUTORIZAR TODO" sin clases identificables.
    // Buscamos elementos "hoja" (sin hijos) con texto corto que coincida exactamente.
    const leafCandidates = queryDeep(container, '*');
    for (const el of leafCandidates) {
      if (el.children.length > 0) continue;
      const txt = normalize(el.textContent);
      if (!txt || txt.length > 40) continue;
      if (hints.some((hint) => txt === normalize(hint))) {
        return el;
      }
    }
    return null;
  }

  function normalize(txt) {
    return (txt || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // quita acentos
      .trim();
  }

  // Busca un selector no solo en el DOM normal, sino también dentro de cualquier
  // Shadow DOM abierto anidado (cada vez más usado por banners modernos de cookies,
  // y que querySelectorAll normal NO puede atravesar).
  function queryDeep(root, selector) {
    let results = [];
    try {
      results = Array.from(root.querySelectorAll(selector));
    } catch (e) { /* selector no soportado en esta raíz */ }
    let all = [];
    try {
      all = root.querySelectorAll('*');
    } catch (e) { /* nada que recorrer */ }
    all.forEach((el) => {
      if (el.shadowRoot) {
        results = results.concat(queryDeep(el.shadowRoot, selector));
      }
    });
    return results;
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      parseFloat(style.opacity) !== 0
    );
  }

  // Un elemento solo se considera un banner de cookies "confirmado" si:
  // 1) menciona literalmente la palabra "cookie" (prácticamente universal,
  //    incluso en banners en otros idiomas), Y
  // 2) tiene pinta de overlay/modal (fixed, sticky, role=dialog, o un bloque
  //    position:absolute que cubre buena parte del viewport) — así se
  //    descartan secciones normales de contenido que casualmente mencionan
  //    "cookies" o "privacidad" en un enlace del pie de página, Y
  // 3) contiene algún interruptor/checkbox O un botón reconocible de
  //    aceptar/rechazar/preferencias.
  function looksLikeOverlay(el) {
    let style;
    try {
      style = window.getComputedStyle(el);
    } catch (e) {
      return false;
    }
    if (style.position === 'fixed' || style.position === 'sticky') return true;
    if (el.getAttribute('role') === 'dialog' || el.getAttribute('role') === 'alertdialog') return true;
    if (style.position === 'absolute') {
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      if (rect.width / vw > 0.4 && rect.height / vh > 0.12) return true;
    }
    return false;
  }

  function isConfirmedCookieBanner(el, confidenceLabel) {
    if (!isVisible(el)) return { confirmed: false, buttonMentionsCookie: false };
    const txt = normalize(el.textContent).slice(0, 3000);
    if (!txt || txt.length < 20) return { confirmed: false, buttonMentionsCookie: false };

    const mentionsCookie = txt.includes('cookie'); // cubre "cookie" y "cookies"
    if (!mentionsCookie) return { confirmed: false, buttonMentionsCookie: false };

    if (!looksLikeOverlay(el)) return { confirmed: false, buttonMentionsCookie: false };

    const hasToggle = queryDeep(
      el,
      'input[type="checkbox"], [role="switch"], [class*="toggle" i], [class*="switch" i]'
    ).length > 0;
    const knownRejectBtn = findKnownRejectButton(el);
    const rejectHintBtn = findButtonByHints(el, REJECT_ALL_HINTS);
    const openPrefsBtn = findButtonByHints(el, OPEN_PREFERENCES_HINTS);
    const confirmBtn = findButtonByHints(el, CONFIRM_BUTTON_HINTS);
    const hasActionButton = !!(knownRejectBtn || rejectHintBtn || openPrefsBtn || confirmBtn);

    // Señal fuerte, independiente de que el resto de la página mencione
    // "cookie": si el propio BOTÓN encontrado dice algo como "Manage Cookies"
    // (en vez de un genérico "Save"/"Settings"), es muy poco probable que sea
    // un falso positivo — así que esto puede subir la confianza a "media"
    // aunque la capa de detección haya sido la heurística de último recurso.
    const buttonMentionsCookie = [knownRejectBtn, rejectHintBtn, openPrefsBtn, confirmBtn]
      .some((b) => b && normalize(b.textContent || '').includes('cookie'));

    const confirmed = hasToggle || hasActionButton;
    if (confirmed && !loggedBannerElements.has(el)) {
      loggedBannerElements.add(el);
      debugLog('Banner CONFIRMADO', el, {
        confianza: confidenceLabel || '(sin determinar)',
        motivo: hasToggle ? 'tiene interruptor/checkbox' : 'tiene botón de acción',
        boton_menciona_cookie: buttonMentionsCookie,
        boton_rechazo_conocido: knownRejectBtn ? knownRejectBtn.textContent.trim().slice(0, 60) : null,
        boton_rechazar_todo: rejectHintBtn ? rejectHintBtn.textContent.trim().slice(0, 60) : null,
        boton_abrir_preferencias: openPrefsBtn ? openPrefsBtn.textContent.trim().slice(0, 60) : null,
        boton_confirmar: confirmBtn ? confirmBtn.textContent.trim().slice(0, 60) : null
      });
    }
    return { confirmed, buttonMentionsCookie };
  }

  function findBanner() {
    // 1) Selectores de CMPs muy específicos: casi nunca dan falso positivo → alta confianza
    for (const sel of TRUSTED_BANNER_SELECTORS) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (isVisible(el) && el.textContent && el.textContent.length > 30) {
          if (!loggedBannerElements.has(el)) {
            loggedBannerElements.add(el);
            debugLog('Banner CONFIRMADO (selector de confianza alta)', el, {
              confianza: 'alta',
              selector_usado: sel
            });
          }
          return { el, confidence: 'high' };
        }
      }
    }

    // 2) Selectores genéricos por atributo, verificados a fondo → confianza media
    for (const sel of GENERIC_BANNER_SELECTORS) {
      let els = [];
      try {
        els = document.querySelectorAll(sel);
      } catch (e) { /* selector no soportado, seguimos */ }
      for (const el of els) {
        if (isConfirmedCookieBanner(el, 'media').confirmed) return { el, confidence: 'medium' };
      }
    }

    // 3) Heurística genérica de último recurso: cualquier bloque grande que
    //    mencione "cookie" y tenga pinta de overlay. Esta capa puede
    //    confundirse con contenido normal que simplemente habla de cookies
    //    (por ejemplo, el propio historial de un chat sobre este script),
    //    así que por defecto se marca como confianza BAJA y nunca actúa sola.
    //    EXCEPCIÓN: si el propio botón encontrado menciona "cookie" en su
    //    texto (p. ej. "Manage Cookies"), es una señal lo bastante fuerte
    //    como para subirla a confianza MEDIA y sí actuar.
    const candidates = document.querySelectorAll('div, section, aside');
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 100) continue;
      const result = isConfirmedCookieBanner(el, 'baja');
      if (result.confirmed) {
        return { el, confidence: result.buttonMentionsCookie ? 'medium' : 'low' };
      }
    }
    return null;
  }

  // Colores de fondo de la carita según el nivel de confianza (el borde y los
  // rasgos —ojos, boca— se mantienen siempre oscuros, como en el diseño original)
  const CONFIDENCE_STYLE = {
    high:   { base: '#cb355c', hover: '#a82a4c', title: 'Rechazar todas las cookies' },
    medium: { base: '#c9791c', hover: '#a8620f', title: 'Posible banner de cookies — pulsa para intentar rechazarlo' },
    low:    { base: '#5b6b78', hover: '#465158', title: 'Detección poco fiable: puede no ser un banner real. Pulsar solo lo descarta, no realiza ninguna acción.' }
  };
  const FACE_BORDER = '#28101a';

  // --- Crear el botón con la carita (boca torcida) ---
  function createDiamondButton(confidence) {
    const existing = document.getElementById(DIAMOND_ID);
    if (existing) return existing;

    const style = CONFIDENCE_STYLE[confidence] || CONFIDENCE_STYLE.high;

    const btn = document.createElement('div');
    btn.id = DIAMOND_ID;
    btn.dataset.confidence = confidence;
    btn.title = style.title;
    btn.style.cssText = `
      position: fixed;
      top: 40px;
      right: 40px;
      width: 46px;
      height: 46px;
      background: ${style.base};
      border-radius: 50%;
      z-index: 2147483647;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      border: 3px solid ${FACE_BORDER};
      transition: transform 0.15s ease, background 0.15s ease;
    `;
    const onEnter = () => {
      const s = CONFIDENCE_STYLE[btn.dataset.confidence] || CONFIDENCE_STYLE.high;
      btn.style.transform = 'scale(1.1)';
      btn.style.background = s.hover;
    };
    const onLeave = () => {
      const s = CONFIDENCE_STYLE[btn.dataset.confidence] || CONFIDENCE_STYLE.high;
      btn.style.transform = 'scale(1)';
      btn.style.background = s.base;
    };
    btn.addEventListener('mouseenter', onEnter);
    btn.addEventListener('mouseleave', onLeave);
    btn._hoverHandlers = { onEnter, onLeave };

    // Rasgos de la carita, reescalados desde el diseño original (220px → 46px)
    const face = document.createElement('div');
    face.className = 'diamond-face-parts';
    face.style.cssText = 'position:absolute; inset:0;';
    face.innerHTML = `
      <div style="position:absolute; width:6px; height:6px; left:10px; top:17px; background:${FACE_BORDER}; border-radius:50%;"></div>
      <div style="position:absolute; width:6px; height:6px; right:10px; top:17px; background:${FACE_BORDER}; border-radius:50%;"></div>
      <div style="position:absolute; width:16px; height:3px; left:15px; top:30px; background:${FACE_BORDER}; border-radius:3px; transform:rotate(-18deg);"></div>
    `;
    btn.appendChild(face);

    // Check de éxito, oculto hasta que se confirme el rechazo
    const check = document.createElement('div');
    check.className = 'diamond-success-check';
    check.style.cssText = `
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      color: #fff;
      font-size: 20px;
      font-weight: bold;
      font-family: sans-serif;
      user-select: none;
      display: none;
    `;
    check.textContent = '✓';
    btn.appendChild(check);

    btn.addEventListener('click', onDiamondClick);

    document.body.appendChild(btn);
    return btn;
  }

  // Actualiza el color/tooltip de una carita ya existente si su confianza cambia
  // (por ejemplo, la página termina de cargar y aparece un selector más fiable)
  function updateDiamondConfidence(btn, confidence) {
    if (!btn || btn.dataset.success === 'true') return;
    btn.dataset.confidence = confidence;
    const style = CONFIDENCE_STYLE[confidence] || CONFIDENCE_STYLE.high;
    btn.title = style.title;
    btn.style.background = style.base;
  }

  function removeDiamondButton() {
    const el = document.getElementById(DIAMOND_ID);
    if (el && el.dataset.success !== 'true') {
      el.remove();
    }
    if (!el || el.dataset.success !== 'true') {
      diamondEl = null;
    }
  }

  // Convierte la carita en un círculo verde con check para indicar éxito, y la retira poco después
  function showSuccessAndRemove(btn) {
    if (!btn) return;
    btn.removeEventListener('click', onDiamondClick);
    if (btn._hoverHandlers) {
      btn.removeEventListener('mouseenter', btn._hoverHandlers.onEnter);
      btn.removeEventListener('mouseleave', btn._hoverHandlers.onLeave);
    }
    btn.style.cursor = 'default';
    btn.style.background = '#2e7d32';
    btn.style.border = '3px solid #1b5e20';

    const face = btn.querySelector('.diamond-face-parts');
    if (face) face.style.display = 'none';
    const check = btn.querySelector('.diamond-success-check');
    if (check) check.style.display = 'block';

    setTimeout(() => {
      btn.style.transition = 'opacity 0.4s ease';
      btn.style.opacity = '0';
      setTimeout(() => {
        if (document.body.contains(btn)) btn.remove();
        if (diamondEl === btn) diamondEl = null;
      }, 400);
    }, 1500);
  }

  // --- Desactivar todos los interruptores/checkboxes dentro del banner ---
  function disableAllToggles(banner) {
    // input[type=checkbox]
    queryDeep(banner, 'input[type="checkbox"]').forEach((input) => {
      if (input.checked && !input.disabled) {
        input.click();
      }
    });

    // elementos con role="switch" y aria-checked
    queryDeep(banner, '[role="switch"]').forEach((el) => {
      const checked = el.getAttribute('aria-checked');
      if (checked === 'true' && el.getAttribute('aria-disabled') !== 'true') {
        el.click();
      }
    });

    // toggles genéricos por clase que usan aria-checked o clases "active/on/checked"
    queryDeep(banner, '[class*="toggle" i], [class*="switch" i]')
      .forEach((el) => {
        const ariaChecked = el.getAttribute('aria-checked');
        const looksOn =
          ariaChecked === 'true' ||
          /(^|\s)(on|active|checked|is-active)(\s|$)/i.test(el.className);
        const isClickable = el.tagName === 'BUTTON' || el.onclick || el.getAttribute('role');
        if (looksOn && isClickable) {
          el.click();
        }
      });
  }

  
  function hideBanner(banner) {
    // Forzamos la ocultación del banner si aún sigue visible
    if (banner && document.body.contains(banner) && isVisible(banner)) {
      banner.style.setProperty('display', 'none', 'important');
    }

    // Los "backdrop" (fondo oscuro tras un modal) casi nunca tienen texto
    // propio, así que no podemos exigirles que mencionen "cookie": si están
    // visibles, se ocultan directamente.
    document.querySelectorAll('[class*="backdrop" i]').forEach((el) => {
      if (isVisible(el)) el.style.setProperty('display', 'none', 'important');
    });

    // Los "overlay" genéricos sí pueden ser contenido legítimo de la página,
    // así que ahí seguimos exigiendo que mencionen algo relacionado con cookies.
    document.querySelectorAll('[class*="overlay" i]').forEach((el) => {
      const txt = normalize(el.textContent).slice(0, 500);
      if (BANNER_TEXT_HINTS.some((h) => txt.includes(normalize(h)))) {
        el.style.setProperty('display', 'none', 'important');
      }
    });

    // Restaurar el scroll: muchos modales bloquean body/html con una clase
    // ("modal-open" es el patrón más común, de Bootstrap y derivados) además
    // de con estilos inline.
    document.body.classList.remove('modal-open');
    document.documentElement.classList.remove('modal-open');
    document.body.style.overflow = '';
    document.body.style.removeProperty('overflow');
    document.documentElement.style.removeProperty('overflow');
  }

  function finalize(banner, btn, actuallyRejected) {
    hideBanner(banner);
    actionInProgress = false;
    debugTrace('FINALIZE — actuallyRejected=' + actuallyRejected +
      ', ¿banner sigue visible tras hideBanner()? ' + isVisible(banner));
    if (actuallyRejected) {
      btn.dataset.success = 'true';
      showSuccessAndRemove(btn);
    } else {
      removeDiamondButton();
    }
  }

  // --- Paso 0: APIs nativas de los CMP más extendidos ---
  // Mucho más fiables que buscar botones por texto: si el sitio usa una de
  // estas plataformas, esto rechaza todo con una sola llamada de su propia API.
  function tryNativeApiReject() {
    // OneTrust
    try {
      if (window.OneTrust && typeof window.OneTrust.RejectAll === 'function') {
        window.OneTrust.RejectAll();
        if (typeof window.OneTrust.Close === 'function') window.OneTrust.Close();
        debugTrace('API nativa: OneTrust.RejectAll() ejecutada sin errores');
        return true;
      }
    } catch (e) {
      debugTrace('API nativa: OneTrust.RejectAll() lanzó un error: ' + e.message);
    }

    // Cookiebot
    try {
      if (window.Cookiebot && typeof window.Cookiebot.submitCustomConsent === 'function') {
        window.Cookiebot.submitCustomConsent(false, false, false);
        debugTrace('API nativa: Cookiebot.submitCustomConsent() ejecutada sin errores');
        return true;
      }
    } catch (e) {
      debugTrace('API nativa: Cookiebot.submitCustomConsent() lanzó un error: ' + e.message);
    }

    // Didomi
    try {
      if (window.Didomi && typeof window.Didomi.setUserDisagreeToAll === 'function') {
        window.Didomi.setUserDisagreeToAll();
        if (window.Didomi.notice && typeof window.Didomi.notice.hide === 'function') {
          window.Didomi.notice.hide();
        }
        debugTrace('API nativa: Didomi.setUserDisagreeToAll() ejecutada sin errores');
        return true;
      }
    } catch (e) {
      debugTrace('API nativa: Didomi.setUserDisagreeToAll() lanzó un error: ' + e.message);
    }

    // Usercentrics (versión nueva)
    try {
      if (window.__ucCmp && typeof window.__ucCmp.denyAllConsents === 'function') {
        window.__ucCmp.denyAllConsents();
        debugTrace('API nativa: __ucCmp.denyAllConsents() ejecutada sin errores');
        return true;
      }
    } catch (e) {
      debugTrace('API nativa: __ucCmp.denyAllConsents() lanzó un error: ' + e.message);
    }

    // Usercentrics (versión legacy)
    try {
      if (window.UC_UI && typeof window.UC_UI.denyAllConsents === 'function') {
        window.UC_UI.denyAllConsents();
        debugTrace('API nativa: UC_UI.denyAllConsents() ejecutada sin errores');
        return true;
      }
    } catch (e) {
      debugTrace('API nativa: UC_UI.denyAllConsents() lanzó un error: ' + e.message);
    }

    // consentmanager.net (identificable por el contenedor #cmpbox/#cmpwrapper)
    // API: __cmp('setConsent', Parameter, Callback, Async) — Parameter 0 = rechazar todo
    try {
      if (typeof window.__cmp === 'function') {
        window.__cmp('setConsent', 0, function () {}, false);
        debugTrace('API nativa: __cmp(\'setConsent\', 0) ejecutada sin errores');
        return true;
      }
    } catch (e) {
      debugTrace('API nativa: __cmp(\'setConsent\', 0) lanzó un error: ' + e.message);
    }

    debugTrace('API nativa: ninguna API de CMP conocida detectada en window (' +
      'OneTrust=' + (!!window.OneTrust) + ', Cookiebot=' + (!!window.Cookiebot) +
      ', Didomi=' + (!!window.Didomi) + ', __ucCmp=' + (!!window.__ucCmp) +
      ', UC_UI=' + (!!window.UC_UI) + ', __cmp=' + (typeof window.__cmp) + ')');
    return false;
  }

  // Selectores exactos de botones "rechazar todo" de CMPs conocidos (muy fiables cuando existen)
  const KNOWN_REJECT_SELECTORS = [
    '#onetrust-reject-all-handler',
    '.ot-pc-refuse-all-handler',
    '[data-testid="uc-deny-all-button"]',
    'button.didomi-continue-without-agreeing',
    '#didomi-notice-disagree-button',
    '#CybotCookiebotDialogBodyButtonDecline',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
    '.cmpboxbtnno' // consentmanager.net: botón "no / rechazar todo"
  ];

  function findKnownRejectButton(container) {
    for (const sel of KNOWN_REJECT_SELECTORS) {
      let el = null;
      try {
        const matches = container ? queryDeep(container, sel) : [];
        el = matches.find((m) => isVisible(m));
        if (!el) {
          const docMatches = queryDeep(document, sel);
          el = docMatches.find((m) => isVisible(m));
        }
      } catch (e) { /* selector no soportado, seguimos */ }
      if (el) return el;
    }
    return null;
  }

  function attemptReject(banner, btn, depth) {
    debugTrace('attemptReject — profundidad ' + depth + ', banner: ' + (banner ? banner.tagName + (banner.id ? '#' + banner.id : '') : 'null'));

    // 0) Antes de tocar el DOM, probar la API nativa del CMP si está disponible
    if (depth === 0 && tryNativeApiReject()) {
      setTimeout(() => finalize(banner, btn, true), 350);
      return;
    }

    // 1) Prioridad máxima: un botón directo de "rechazar/bloquear todo"
    //    (primero por selector exacto conocido, luego por texto)
    const rejectBtn = findKnownRejectButton(banner) || findButtonByHints(banner, REJECT_ALL_HINTS);
    debugTrace('Paso 1 — botón "rechazar todo": ' +
      (rejectBtn ? 'ENCONTRADO → "' + rejectBtn.textContent.trim().slice(0, 50) + '"' : 'no encontrado'));
    if (rejectBtn) {
      rejectBtn.click();
      // Algunos CMPs (p.ej. Sourcepoint) solo marcan los interruptores como "desactivado"
      // con este enlace, y requieren pulsar además un botón de guardar/salir aparte.
      setTimeout(() => {
        const saveBtn = findButtonByHints(banner, CONFIRM_BUTTON_HINTS);
        debugTrace('Paso 1 — botón guardar/salir tras el clic: ' +
          (saveBtn ? 'ENCONTRADO → "' + saveBtn.textContent.trim().slice(0, 50) + '"' : 'no encontrado (no hacía falta)'));
        if (saveBtn) saveBtn.click();
        setTimeout(() => finalize(banner, btn, true), 350);
      }, 250);
      return;
    }

    // 2) Si hay interruptores visibles en este mismo panel, apagarlos y guardar/confirmar
    const toggles = queryDeep(
      banner,
      'input[type="checkbox"], [role="switch"], [class*="toggle" i], [class*="switch" i]'
    );
    debugTrace('Paso 2 — interruptores encontrados en el panel: ' + toggles.length);
    if (toggles.length > 0) {
      disableAllToggles(banner);
      setTimeout(() => {
        const confirmBtn = findButtonByHints(banner, CONFIRM_BUTTON_HINTS);
        debugTrace('Paso 2 — botón confirmar/guardar: ' +
          (confirmBtn ? 'ENCONTRADO → "' + confirmBtn.textContent.trim().slice(0, 50) + '"' : 'no encontrado'));
        if (confirmBtn) confirmBtn.click();
        setTimeout(() => finalize(banner, btn, !!confirmBtn), 350);
      }, 200);
      return;
    }

    // 3) No hay ni "rechazar todo" ni interruptores: intentar abrir el panel de preferencias
    if (depth < 2) {
      const openBtn = findButtonByHints(banner, OPEN_PREFERENCES_HINTS);
      debugTrace('Paso 3 — botón abrir preferencias: ' +
        (openBtn ? 'ENCONTRADO → "' + openBtn.textContent.trim().slice(0, 50) + '"' : 'no encontrado'));
      if (openBtn) {
        openBtn.click();
        setTimeout(() => {
          const newBanner = (findBanner() || {}).el || banner;
          attemptReject(newBanner, btn, depth + 1);
        }, 500);
        return;
      }
    }

    // 4) Sin ninguna opción reconocible: no podemos confirmar que se ha rechazado nada
    debugTrace('Paso 4 — sin ninguna opción reconocible en ningún nivel. Abortando sin acción.');
    finalize(banner, btn, false);
  }

  function onDiamondClick() {
    const btn = document.getElementById(DIAMOND_ID);
    const confidence = (btn && btn.dataset.confidence) || currentConfidence;

    // Confianza BAJA: no hacemos ningún clic real en la página. Podría no
    // ser un banner de cookies en absoluto (p. ej. la propia conversación
    // menciona la palabra "cookie"), así que pulsar el rombo solo lo retira.
    if (confidence === 'low') {
      debugLog(
        'Rombo de baja confianza descartado sin ejecutar ninguna acción',
        currentBanner || btn || document.body
      );
      currentBanner = null;
      removeDiamondButton();
      return;
    }

    const banner = currentBanner || (findBanner() || {}).el;
    if (!banner) {
      removeDiamondButton();
      return;
    }
    actionInProgress = true;
    attemptReject(banner, btn, 0);
  }

  // --- Observador que detecta la aparición del banner ---
  function checkForBanner() {
    if (actionInProgress) return;
    const result = findBanner();
    if (result && result.el !== currentBanner) {
      currentBanner = result.el;
      currentConfidence = result.confidence;
      diamondEl = createDiamondButton(result.confidence);
    } else if (result && result.el === currentBanner && result.confidence !== currentConfidence) {
      // Mismo elemento, pero cambió el nivel de confianza (p. ej. ahora
      // coincide también con un selector más fiable): actualizamos el color.
      currentConfidence = result.confidence;
      updateDiamondConfidence(document.getElementById(DIAMOND_ID), result.confidence);
    } else if (!result && currentBanner) {
      currentBanner = null;
      removeDiamondButton();
    }
  }

  // Si TODAS las mutaciones de una tanda ocurren dentro de nuestra propia UI
  // (la carita o el panel de depuración), las ignoramos — si no, cada vez que
  // el propio script actualiza su panel de debug, se dispararía a sí mismo en bucle.
  function isOwnUiNode(node) {
    if (!node || node.nodeType !== 1) return !!(node && node.parentNode && isOwnUiNode(node.parentNode));
    if (node.id === DIAMOND_ID || node.id === DEBUG_PANEL_ID) return true;
    return !!(node.closest && node.closest('#' + DIAMOND_ID + ', #' + DEBUG_PANEL_ID));
  }

  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((m) => !isOwnUiNode(m.target));
    if (relevant) checkForBanner();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Chequeo inicial y periódico de respaldo (algunos banners tardan en pintarse)
  checkForBanner();
  const interval = setInterval(checkForBanner, 1000);
  // Detener el polling tras 30s para no consumir recursos innecesariamente
  setTimeout(() => clearInterval(interval), 30000);
})();
