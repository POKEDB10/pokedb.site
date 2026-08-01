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

  document.addEventListener('DOMContentLoaded', function () {
    applyTheme(savedTheme, false);

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
    }
  };
})();
