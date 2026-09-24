/*
  Copyright (c) 2026 DrATLopez Antonio Tur López.
  Todos los derechos reservados. / Licencia Creative Commons Atribución-NoComercial 4.0 (CC BY-NC 4.0)
  Repositorio oficial: https://github.com/dratlopez
*/
// ==UserScript==
// @name         Minimize_Cookies
// @namespace    http://tampermonkey.net/
// @version      1.9
// @description  Detecta banners/popups de cookies en varios idiomas, con verificación estricta anti-falsos-positivos (exige mención literal de "cookie" + aspecto de overlay/modal + interruptor o botón reconocible), incluidos botones de una sola palabra ("Denegar"/"Reject") y banners renderizados dentro de Shadow DOM. Prueba primero las APIs nativas de rechazo de los CMP más comunes (OneTrust, Cookiebot, Didomi, Usercentrics) y selectores exactos conocidos; si no aplican, busca un botón de "rechazar/bloquear todo" por texto, o abre el panel de preferencias, desactiva todas las opciones y confirma/guarda. Añade un botón en forma de rombo arriba a la derecha que se vuelve un círculo verde con check cuando el rechazo se confirma.
// @author       you
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/dratlopez/Minimize_cookies/refs/heads/main/Minimize_cookies.js
// @downloadURL  https://raw.githubusercontent.com/dratlopez/Minimize_cookies/refs/heads/main/Minimize_cookies.js
// from github
// ==/UserScript==

(function () {
  'use strict';

  const DIAMOND_ID = '__cookie_diamond_btn__';
  let currentBanner = null;
  let diamondEl = null;
  let actionInProgress = false;

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
    '.sp_choice_type_11', '.message-container'
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

  // Busca dentro de un contenedor el primer botón cuyo texto coincida con alguna de las pistas dadas
  function findButtonByHints(container, hints) {
    const clickable = queryDeep(
      container,
      'button, a[role="button"], [role="button"], input[type="submit"], [class*="button" i], [class*="btn" i]'
    );
    for (const el of clickable) {
      const txt = normalize(el.textContent || el.value || '');
      if (!txt) continue;
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

  function isConfirmedCookieBanner(el) {
    if (!isVisible(el)) return false;
    const txt = normalize(el.textContent).slice(0, 3000);
    if (!txt || txt.length < 20) return false;

    const mentionsCookie = txt.includes('cookie'); // cubre "cookie" y "cookies"
    if (!mentionsCookie) return false;

    if (!looksLikeOverlay(el)) return false;

    const hasToggle = queryDeep(
      el,
      'input[type="checkbox"], [role="switch"], [class*="toggle" i], [class*="switch" i]'
    ).length > 0;
    const hasActionButton =
      !!findKnownRejectButton(el) ||
      !!findButtonByHints(el, REJECT_ALL_HINTS) ||
      !!findButtonByHints(el, OPEN_PREFERENCES_HINTS) ||
      !!findButtonByHints(el, CONFIRM_BUTTON_HINTS);

    return hasToggle || hasActionButton;
  }

  function findBanner() {
    // 1) Selectores de CMPs muy específicos: casi nunca dan falso positivo
    for (const sel of TRUSTED_BANNER_SELECTORS) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (isVisible(el) && el.textContent && el.textContent.length > 30) {
          return el;
        }
      }
    }

    // 2) Selectores genéricos por atributo: exigimos la verificación completa
    for (const sel of GENERIC_BANNER_SELECTORS) {
      let els = [];
      try {
        els = document.querySelectorAll(sel);
      } catch (e) { /* selector no soportado, seguimos */ }
      for (const el of els) {
        if (isConfirmedCookieBanner(el)) return el;
      }
    }

    // 3) Heurística genérica de último recurso: overlays grandes que
    //    mencionan "cookie" y tienen pinta real de banner de consentimiento
    const candidates = document.querySelectorAll('div, section, aside');
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 100) continue;
      if (isConfirmedCookieBanner(el)) return el;
    }
    return null;
  }

  // --- Crear el botón rombo ---
  function createDiamondButton() {
    if (document.getElementById(DIAMOND_ID)) return document.getElementById(DIAMOND_ID);

    const btn = document.createElement('div');
    btn.id = DIAMOND_ID;
    btn.title = 'Rechazar todas las cookies';
    btn.style.cssText = `
      position: fixed;
      top: 40px;
      right: 40px;
      width: 46px;
      height: 46px;
      background: #d32f2f;
      transform: rotate(45deg);
      z-index: 2147483647;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      border: 2px solid #fff;
      transition: transform 0.15s ease, background 0.15s ease, border-radius 0.3s ease;
    `;
    const onEnter = () => {
      btn.style.transform = 'rotate(45deg) scale(1.1)';
      btn.style.background = '#b71c1c';
    };
    const onLeave = () => {
      btn.style.transform = 'rotate(45deg) scale(1)';
      btn.style.background = '#d32f2f';
    };
    btn.addEventListener('mouseenter', onEnter);
    btn.addEventListener('mouseleave', onLeave);
    btn._hoverHandlers = { onEnter, onLeave };

    // "X" dentro del rombo (contra-rotada para que se vea recta)
    const inner = document.createElement('div');
    inner.style.cssText = `
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%) rotate(-45deg);
      color: #fff;
      font-size: 20px;
      font-weight: bold;
      font-family: sans-serif;
      user-select: none;
    `;
    inner.textContent = '✕';
    btn.appendChild(inner);

    btn.addEventListener('click', onDiamondClick);

    document.body.appendChild(btn);
    return btn;
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

  // Convierte el rombo en un círculo verde para indicar éxito, y lo retira poco después
  function showSuccessAndRemove(btn) {
    if (!btn) return;
    btn.removeEventListener('click', onDiamondClick);
    if (btn._hoverHandlers) {
      btn.removeEventListener('mouseenter', btn._hoverHandlers.onEnter);
      btn.removeEventListener('mouseleave', btn._hoverHandlers.onLeave);
    }
    btn.style.cursor = 'default';
    btn.style.background = '#2e7d32';
    btn.style.borderRadius = '50%';
    // Contrarrestamos la rotación de 45º del rombo para que quede un círculo perfecto
    btn.style.transform = 'rotate(0deg)';

    const inner = btn.querySelector('div');
    if (inner) {
      inner.style.transform = 'translate(-50%, -50%) rotate(0deg)';
      inner.textContent = '✓';
    }

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
    // Eliminar overlays/backdrops comunes que bloquean el scroll
    document
      .querySelectorAll('[class*="overlay" i], [class*="backdrop" i]')
      .forEach((el) => {
        const txt = normalize(el.textContent).slice(0, 500);
        if (BANNER_TEXT_HINTS.some((h) => txt.includes(normalize(h)))) {
          el.style.setProperty('display', 'none', 'important');
        }
      });
    document.body.style.overflow = '';
  }

  function finalize(banner, btn, actuallyRejected) {
    hideBanner(banner);
    actionInProgress = false;
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
        return true;
      }
    } catch (e) { /* seguimos con la siguiente API */ }

    // Cookiebot
    try {
      if (window.Cookiebot && typeof window.Cookiebot.submitCustomConsent === 'function') {
        window.Cookiebot.submitCustomConsent(false, false, false);
        return true;
      }
    } catch (e) { /* seguimos con la siguiente API */ }

    // Didomi
    try {
      if (window.Didomi && typeof window.Didomi.setUserDisagreeToAll === 'function') {
        window.Didomi.setUserDisagreeToAll();
        if (window.Didomi.notice && typeof window.Didomi.notice.hide === 'function') {
          window.Didomi.notice.hide();
        }
        return true;
      }
    } catch (e) { /* seguimos con la siguiente API */ }

    // Usercentrics (versión nueva)
    try {
      if (window.__ucCmp && typeof window.__ucCmp.denyAllConsents === 'function') {
        window.__ucCmp.denyAllConsents();
        return true;
      }
    } catch (e) { /* seguimos con la siguiente API */ }

    // Usercentrics (versión legacy)
    try {
      if (window.UC_UI && typeof window.UC_UI.denyAllConsents === 'function') {
        window.UC_UI.denyAllConsents();
        return true;
      }
    } catch (e) { /* ninguna API nativa disponible */ }

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
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll'
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
    // 0) Antes de tocar el DOM, probar la API nativa del CMP si está disponible
    if (depth === 0 && tryNativeApiReject()) {
      setTimeout(() => finalize(banner, btn, true), 350);
      return;
    }

    // 1) Prioridad máxima: un botón directo de "rechazar/bloquear todo"
    //    (primero por selector exacto conocido, luego por texto)
    const rejectBtn = findKnownRejectButton(banner) || findButtonByHints(banner, REJECT_ALL_HINTS);
    if (rejectBtn) {
      rejectBtn.click();
      // Algunos CMPs (p.ej. Sourcepoint) solo marcan los interruptores como "desactivado"
      // con este enlace, y requieren pulsar además un botón de guardar/salir aparte.
      setTimeout(() => {
        const saveBtn = findButtonByHints(banner, CONFIRM_BUTTON_HINTS);
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
    if (toggles.length > 0) {
      disableAllToggles(banner);
      setTimeout(() => {
        const confirmBtn = findButtonByHints(banner, CONFIRM_BUTTON_HINTS);
        if (confirmBtn) confirmBtn.click();
        setTimeout(() => finalize(banner, btn, !!confirmBtn), 350);
      }, 200);
      return;
    }

    // 3) No hay ni "rechazar todo" ni interruptores: intentar abrir el panel de preferencias
    if (depth < 2) {
      const openBtn = findButtonByHints(banner, OPEN_PREFERENCES_HINTS);
      if (openBtn) {
        openBtn.click();
        setTimeout(() => {
          const newBanner = findBanner() || banner;
          attemptReject(newBanner, btn, depth + 1);
        }, 500);
        return;
      }
    }

    // 4) Sin ninguna opción reconocible: no podemos confirmar que se ha rechazado nada
    finalize(banner, btn, false);
  }

  function onDiamondClick() {
    const banner = currentBanner || findBanner();
    const btn = document.getElementById(DIAMOND_ID);
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
    const banner = findBanner();
    if (banner && banner !== currentBanner) {
      currentBanner = banner;
      diamondEl = createDiamondButton();
    } else if (!banner && currentBanner) {
      currentBanner = null;
      removeDiamondButton();
    }
  }

  const observer = new MutationObserver(() => {
    checkForBanner();
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
