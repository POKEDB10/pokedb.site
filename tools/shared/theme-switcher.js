(function () {
  var THEME_KEY = 'pokedb-theme';
  var root = document.documentElement;

  function getAccentAndSurface(theme) {
    var probe = document.createElement('div');
    probe.setAttribute('data-theme', theme);
    probe.style.display = 'none';
    document.body ? document.body.appendChild(probe) : document.documentElement.appendChild(probe);
    var cs = getComputedStyle(probe);
    var accent = cs.getPropertyValue('--accent').trim();
    var surface = cs.getPropertyValue('--surface').trim();
    if (probe.parentNode) probe.parentNode.removeChild(probe);
    return { accent: accent, surface: surface };
  }

  function applyTheme(theme, persist) {
    root.setAttribute('data-theme', theme);
    var select = document.getElementById('theme-select');
    var swatch = document.getElementById('theme-swatch');
    
    var colors = getAccentAndSurface(theme);
    if (select) select.value = theme;
    if (swatch) swatch.style.background = colors.accent;

    if (persist) {
      try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
    }

    window.dispatchEvent(new CustomEvent('themeChanged', {
      detail: { theme: theme, accent: colors.accent, surface: colors.surface }
    }));
  }

  // Restore theme immediately before paint
  var savedTheme = 'oled-black';
  try {
    var stored = localStorage.getItem(THEME_KEY);
    if (stored) savedTheme = stored;
  } catch (e) {}
  root.setAttribute('data-theme', savedTheme);

  function resolveNavLinks() {
    var host = window.location.hostname.toLowerCase();
    var isProduction = host.includes('pokedb.site');
    var proto = window.location.protocol;

    var navElements = document.querySelectorAll('[data-nav]');
    navElements.forEach(function (el) {
      var key = el.getAttribute('data-nav');
      if (!key) return;

      if (isProduction) {
        if (key === 'main') el.href = proto + '//pokedb.site/';
        else if (key === 'tools') el.href = proto + '//tools.pokedb.site/';
        else el.href = proto + '//' + key + '.pokedb.site/';
      } else {
        if (key === 'main') el.href = '/';
        else if (key === 'tools') el.href = '/tools/';
        else el.href = '/tools/' + key + '/';
      }
    });
  }

  function renderSharedNav() {
    var header = document.querySelector('.site-nav');
    if (!header) return;

    var path = window.location.pathname;
    var host = window.location.hostname.toLowerCase();
    var isProduction = host.includes('pokedb.site');
    var proto = window.location.protocol;

    function getNavUrl(target) {
      if (isProduction) {
        if (target === 'main') return proto + '//pokedb.site/';
        if (target === 'tools') return proto + '//tools.pokedb.site/';
        return proto + '//' + target + '.pokedb.site/';
      } else {
        if (target === 'main') return '/';
        if (target === 'tools') return '/tools/';
        return '/tools/' + target + '/';
      }
    }

    var activeKey = '';
    if (host.includes('tinyurl.') || path.includes('/tools/tinyurl')) activeKey = 'tinyurl';
    else if (host.includes('qr.') || path.includes('/tools/qr')) activeKey = 'qr';
    else if (host.includes('drop.') || path.includes('/tools/drop')) activeKey = 'drop';
    else if (host.includes('health.') || path.includes('/tools/health')) activeKey = 'health';
    else if (host.includes('tools.') || path.startsWith('/tools')) activeKey = 'tools';
    else activeKey = 'main';

    var navLinks = header.querySelector('.nav-links');
    if (!navLinks) {
      navLinks = document.createElement('nav');
      navLinks.className = 'nav-links';
      var themeSwitcher = header.querySelector('.theme-switcher');
      if (themeSwitcher) {
        header.insertBefore(navLinks, themeSwitcher);
      } else {
        header.appendChild(navLinks);
      }
    } else if (navLinks.parentNode !== header) {
      var themeSwitcher = header.querySelector('.theme-switcher');
      if (themeSwitcher) {
        header.insertBefore(navLinks, themeSwitcher);
      } else {
        header.appendChild(navLinks);
      }
    }
    navLinks.setAttribute('aria-label', 'Tools navigation');

    navLinks.innerHTML = 
      '<a class="nav-link' + (activeKey === 'tools' ? ' active' : '') + '" href="' + getNavUrl('tools') + '" data-nav="tools">Tools hub</a>' +
      '<a class="nav-link' + (activeKey === 'tinyurl' ? ' active' : '') + '" href="' + getNavUrl('tinyurl') + '" data-nav="tinyurl">TinyURL</a>' +
      '<a class="nav-link' + (activeKey === 'qr' ? ' active' : '') + '" href="' + getNavUrl('qr') + '" data-nav="qr">QR studio</a>' +
      '<a class="nav-link' + (activeKey === 'drop' ? ' active' : '') + '" href="' + getNavUrl('drop') + '" data-nav="drop">Drop</a>' +
      '<a class="nav-link' + (activeKey === 'health' ? ' active' : '') + '" href="' + getNavUrl('health') + '" data-nav="health">Health</a>';
  }

  var navInitialized = false;
  function initNav() {
    if (navInitialized) return;
    navInitialized = true;
    renderSharedNav();
    resolveNavLinks();
  }

  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    initNav();
  }

  document.addEventListener('DOMContentLoaded', function () {
    applyTheme(savedTheme, false);
    initNav();

    var select = document.getElementById('theme-select');
    if (select) {
      select.addEventListener('change', function () {
        applyTheme(select.value, true);
      });
    }
  });

  window.PokedbTheme = {
    applyTheme: applyTheme,
    getAccentAndSurface: getAccentAndSurface,
    getCurrentTheme: function () {
      return root.getAttribute('data-theme') || savedTheme;
    },
    getNavUrl: function (target) {
      var host = window.location.hostname.toLowerCase();
      var isProduction = host.includes('pokedb.site');
      var proto = window.location.protocol;

      if (isProduction) {
        if (target === 'main') return proto + '//pokedb.site/';
        if (target === 'tools') return proto + '//tools.pokedb.site/';
        return proto + '//' + target + '.pokedb.site/';
      } else {
        if (target === 'main') return '/';
        if (target === 'tools') return '/tools/';
        return '/tools/' + target + '/';
      }
    }
  };
})();
