// tools/shared/turnstile.js
// Lightweight shared Cloudflare Turnstile integration.
// Fetches /api/config/public once; does nothing in offline/local mode when turnstileSiteKey is empty.
(function () {
  var configPromise = null;
  var scriptPromise = null;
  var widgets = new Map();

  function fetchPublicConfig() {
    if (!configPromise) {
      configPromise = fetch('/api/config/public', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .catch(function () { return {}; });
    }
    return configPromise;
  }

  function loadTurnstileScript() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!scriptPromise) {
      scriptPromise = new Promise(function (resolve) {
        var existing = document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]');
        if (existing) {
          var timer = setInterval(function () {
            if (window.turnstile) {
              clearInterval(timer);
              resolve(window.turnstile);
            }
          }, 50);
          setTimeout(function () { clearInterval(timer); resolve(window.turnstile || null); }, 5000);
          return;
        }
        var s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.defer = true;
        s.onload = function () { resolve(window.turnstile || null); };
        s.onerror = function () { resolve(null); };
        document.head.appendChild(s);
      });
    }
    return scriptPromise;
  }

  function resolveEl(target) {
    if (!target) return null;
    return typeof target === 'string' ? document.querySelector(target) : target;
  }

  async function mount(target) {
    var el = resolveEl(target);
    if (!el) return null;
    if (widgets.has(el)) return widgets.get(el);

    var cfg = await fetchPublicConfig();
    var siteKey = cfg && cfg.turnstileSiteKey ? String(cfg.turnstileSiteKey).trim() : '';
    if (!siteKey) return null;

    var ts = await loadTurnstileScript();
    if (!ts || typeof ts.render !== 'function') return null;

    var currentTheme = document.documentElement.getAttribute('data-theme') || 'oled-black';
    var tsTheme = currentTheme === 'paper' || currentTheme === 'nordic-ice' ? 'light' : 'dark';
    var widgetId = ts.render(el, {
      sitekey: siteKey,
      theme: tsTheme,
      appearance: 'interaction-only'
    });
    widgets.set(el, { widgetId: widgetId, el: el });
    return widgetId;
  }

  async function getToken(target) {
    var el = resolveEl(target);
    if (el && !widgets.has(el)) {
      await mount(el);
    }
    if (el) {
      var input = el.querySelector('input[name="cf-turnstile-response"]');
      if (input && input.value) return input.value;
      var entry = widgets.get(el);
      if (entry && window.turnstile && typeof window.turnstile.getResponse === 'function') {
        return window.turnstile.getResponse(entry.widgetId) || '';
      }
    }
    var fallbackInput = document.querySelector('input[name="cf-turnstile-response"]');
    return fallbackInput ? (fallbackInput.value || '') : '';
  }

  function reset(target) {
    var el = resolveEl(target);
    if (!el || !window.turnstile || typeof window.turnstile.reset !== 'function') return;
    var entry = widgets.get(el);
    if (entry) {
      try { window.turnstile.reset(entry.widgetId); } catch (_) {}
    }
  }

  window.PokedbTurnstile = {
    mount: mount,
    getToken: getToken,
    reset: reset
  };
})();
