(function () {
  'use strict';

  var liveAnnouncer = null;
  function getAnnouncer() {
    if (!liveAnnouncer && document.body) {
      liveAnnouncer = document.getElementById('a11y-live-region');
      if (!liveAnnouncer) {
        liveAnnouncer = document.createElement('div');
        liveAnnouncer.id = 'a11y-live-region';
        liveAnnouncer.setAttribute('aria-live', 'polite');
        liveAnnouncer.setAttribute('aria-atomic', 'true');
        liveAnnouncer.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);border:0;';
        document.body.appendChild(liveAnnouncer);
      }
    }
    return liveAnnouncer;
  }

  window.announceA11y = function (msg) {
    var announcer = getAnnouncer();
    if (announcer) announcer.textContent = msg;
  };

  // Toast Notifications
  window.showToast = function (message, duration) {
    duration = duration || 2500;
    window.announceA11y(message);

    if (!document.body) return;
    var container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;display:flex;flex-direction:column;gap:0.5rem;pointer-events:none;';
      document.body.appendChild(container);
    }
    var toast = document.createElement('div');
    toast.className = 'mono';
    toast.style.cssText = 'padding:0.6rem 1rem;background:var(--surface);color:var(--text);border:1px solid var(--accent);border-radius:6px;box-shadow:var(--shadow);font-size:0.8rem;opacity:0;transform:translateY(8px);transition:all 0.2s cubic-bezier(0.16, 1, 0.3, 1);pointer-events:auto;';
    toast.textContent = '$ ' + message;
    container.appendChild(toast);
    requestAnimationFrame(function () {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 200);
    }, duration);
  };

  var toolsList = [
    { title: 'TinyURL Shortener', url: '/tools/tinyurl', desc: 'URL shortener with analytics and threat auditing' },
    { title: 'Encrypted Pastebin', url: '/tools/paste', desc: 'Client-side encrypted zero-knowledge paste sharing' },
    { title: 'QR Studio', url: '/tools/qr', desc: 'SVG & PNG customizable QR generator' },
    { title: 'Secure File Drop', url: '/tools/drop', desc: 'Direct-to-R2 presigned multipart file transfers' },
    { title: 'System Health', url: '/tools/health', desc: 'Real-time telemetry, memory, and replication age' },
    { title: 'JSON Formatter', url: '/tools/json', desc: 'Offline client-side JSON validator and minifier' },
    { title: 'JWT Inspector', url: '/tools/jwt', desc: 'Decode claims & verify HMAC signatures via WebCrypto' },
    { title: 'Codec Studio', url: '/tools/codec', desc: 'Base64, Hex, URL, and Binary encoder & decoder' },
    { title: 'Hash Studio', url: '/tools/hash', desc: 'SHA-256, SHA-512, and streaming file checksums' },
    { title: 'UUID & ULID Generator', url: '/tools/uuid', desc: 'UUID v4, time-ordered v7, and Crockford ULIDs' },
    { title: 'Cron Explainer', url: '/tools/cron', desc: '5-part cron syntax parser and execution calculator' },
    { title: 'Text Diff Studio', url: '/tools/diff', desc: 'Line-by-line visual text diff in browser' },
    { title: 'Minecraft Toolkit', url: '/tools/minecraft', desc: 'Verified Aikar PaperMC JVM flags & MOTD preview' },
    { title: 'Log & Secret Sanitizer', url: '/tools/sanitizer', desc: 'Client-side redaction of IPs, emails, and tokens' },
    { title: 'Flagship Case Study', url: '/projects/pokedb-site', desc: 'Rebuilding pokedb.site: From Monolith to 10k req/s' },
    { title: 'API Documentation', url: '/docs', desc: 'Copy-ready curl examples and shell functions' },
    { title: 'System Changelog', url: '/changelog', desc: 'Release history and architecture evolution' }
  ];

  function createPalette() {
    if (!document.body) return;
    var overlay = document.createElement('div');
    overlay.id = 'cmd-palette-overlay';
    overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);z-index:99999;place-items:center;padding:1rem;';

    overlay.innerHTML = 
      '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;width:100%;max-width:540px;box-shadow:var(--shadow);overflow:hidden;font-family:\'IBM Plex Mono\',monospace;">' +
        '<div style="padding:0.85rem 1rem;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:0.5rem;">' +
          '<span style="color:var(--accent);">$</span>' +
          '<input type="text" id="cmd-palette-input" placeholder="Search tools, projects, docs... (ESC to close)" style="width:100%;background:transparent;border:0;color:var(--text);font-family:inherit;font-size:0.9rem;outline:none;" autocomplete="off">' +
        '</div>' +
        '<div id="cmd-palette-results" style="max-height:320px;overflow-y:auto;padding:0.5rem 0;"></div>' +
      '</div>';

    document.body.appendChild(overlay);

    var input = overlay.querySelector('#cmd-palette-input');
    var results = overlay.querySelector('#cmd-palette-results');

    function renderResults(query) {
      results.innerHTML = '';
      var filtered = toolsList.filter(function (t) {
        return !query || t.title.toLowerCase().includes(query) || t.desc.toLowerCase().includes(query);
      });

      if (filtered.length === 0) {
        results.innerHTML = '<div style="padding:1rem;color:var(--muted);text-align:center;font-size:0.85rem;">No matching tools found.</div>';
        return;
      }

      filtered.forEach(function (item) {
        var a = document.createElement('a');
        a.href = item.url;
        a.style.cssText = 'display:block;padding:0.6rem 1rem;text-decoration:none;color:var(--text);border-bottom:1px solid color-mix(in srgb,var(--border) 40%,transparent);font-size:0.82rem;';
        a.innerHTML = '<div style="font-weight:600;color:var(--accent);">' + item.title + '</div><div style="font-size:0.75rem;color:var(--muted);">' + item.desc + '</div>';
        a.addEventListener('mouseenter', function () { a.style.background = 'var(--surface-2)'; });
        a.addEventListener('mouseleave', function () { a.style.background = 'transparent'; });
        results.appendChild(a);
      });
    }

    input.addEventListener('input', function () {
      renderResults(input.value.trim().toLowerCase());
    });

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closePalette();
    });

    window.openPalette = function () {
      overlay.style.display = 'grid';
      input.value = '';
      renderResults('');
      input.focus();
    };

    window.closePalette = function () {
      overlay.style.display = 'none';
    };
  }

  function initDom() {
    getAnnouncer();
    createPalette();

    // 1. Session Uptime & Year Counter
    var uptime = document.getElementById('uptime');
    if (uptime) {
      var start = Date.now();
      var pad = function (value) { return String(value).padStart(2, '0'); };
      window.setInterval(function () {
        var elapsed = Math.floor((Date.now() - start) / 1000);
        uptime.textContent = 'session uptime · ' + pad(Math.floor(elapsed / 3600)) + ':' + pad(Math.floor((elapsed % 3600) / 60)) + ':' + pad(elapsed % 60);
      }, 1000);
    }

    var year = document.getElementById('footer-year');
    if (year) year.textContent = '© ' + new Date().getFullYear() + ' · pokedb.site';

    // 2. Scroll reveal for project cards
    var cards = document.querySelectorAll('.project-card');
    if (cards.length) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
        cards.forEach(function (card) { card.classList.add('is-visible'); });
      } else {
        var observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible');
              observer.unobserve(entry.target);
            }
          });
        }, { threshold: 0.15 });
        cards.forEach(function (card) { observer.observe(card); });
      }
    }

    // 3. WAI-ARIA arrow-key navigation for .tab-bar controls
    document.querySelectorAll('.tab-bar').forEach(function (bar) {
      var tabs = Array.prototype.slice.call(bar.querySelectorAll('.tab-btn, [role="tab"]'));
      if (!tabs.length) return;
      if (!bar.getAttribute('role')) bar.setAttribute('role', 'tablist');
      tabs.forEach(function (t) {
        if (!t.getAttribute('role')) t.setAttribute('role', 'tab');
        var isActive = t.classList.contains('is-active') || t.classList.contains('active') || t.getAttribute('aria-selected') === 'true';
        t.setAttribute('tabindex', isActive ? '0' : '-1');
      });
      bar.addEventListener('keydown', function (e) {
        var visibleTabs = tabs.filter(function (t) {
          return t.offsetParent !== null && !t.disabled;
        });
        if (visibleTabs.length < 2) return;
        var idx = visibleTabs.indexOf(document.activeElement);
        if (idx === -1) return;
        var nextIdx = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextIdx = (idx + 1) % visibleTabs.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextIdx = (idx - 1 + visibleTabs.length) % visibleTabs.length;
        else if (e.key === 'Home') nextIdx = 0;
        else if (e.key === 'End') nextIdx = visibleTabs.length - 1;
        if (nextIdx !== -1) {
          e.preventDefault();
          visibleTabs.forEach(function (t, i) { t.setAttribute('tabindex', i === nextIdx ? '0' : '-1'); });
          visibleTabs[nextIdx].focus();
          visibleTabs[nextIdx].click();
        }
      });
      bar.addEventListener('click', function (e) {
        var clicked = e.target && e.target.closest ? e.target.closest('.tab-btn, [role="tab"]') : null;
        if (!clicked) return;
        tabs.forEach(function (t) { t.setAttribute('tabindex', t === clicked ? '0' : '-1'); });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDom);
  } else {
    initDom();
  }

  // Keyboard shortcut listener
  window.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      var overlay = document.getElementById('cmd-palette-overlay');
      if (overlay && overlay.style.display === 'grid') {
        window.closePalette();
      } else {
        if (typeof window.openPalette === 'function') window.openPalette();
      }
    } else if (e.key === 'Escape') {
      var ov = document.getElementById('cmd-palette-overlay');
      if (ov && ov.style.display === 'grid') {
        if (typeof window.closePalette === 'function') window.closePalette();
      }
    }
  });

  // Paste-anywhere on Drop/Paste/QR (Task P7.8)
  window.addEventListener('paste', function (e) {
    var tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    var cb = e.clipboardData || window.clipboardData;
    if (!cb) return;
    var text = cb.getData('text');
    var files = e.clipboardData ? e.clipboardData.files : null;

    if (files && files.length > 0 && window.location.pathname.includes('/drop')) {
      var dropZone = document.getElementById('drop-zone');
      if (dropZone && window.handleDroppedFiles) {
        window.handleDroppedFiles(files);
      }
    } else if (text) {
      var pasteArea = document.getElementById('paste-content');
      if (pasteArea) {
        pasteArea.value += text;
        pasteArea.dispatchEvent(new Event('input'));
        window.showToast('Text pasted into editor');
      }
      var qrInput = document.getElementById('url-input') || document.getElementById('qr-text-input');
      if (qrInput) {
        qrInput.value = text;
        qrInput.dispatchEvent(new Event('input'));
        window.showToast('Text pasted into QR generator');
      }
    }
  });

  // Cloudflare Web Analytics loader (when CF_ANALYTICS_TOKEN is defined)
  try {
    var cfToken = window.CF_ANALYTICS_TOKEN || null;
    if (cfToken) {
      var s = document.createElement('script');
      s.defer = true;
      s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
      s.setAttribute('data-cf-beacon', JSON.stringify({ token: cfToken }));
      document.head.appendChild(s);
    }
  } catch (_) {}
}());
