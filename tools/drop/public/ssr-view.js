// tools/drop/public/ssr-view.js
// External interactive controls for SSR /v/:id file preview (strict CSP compliant).
(function () {
  'use strict';

  function copyText(text, btn, defaultLabel, toastMsg) {
    if (!text) return;
    function showCopied() {
      if (btn) {
        btn.textContent = 'Copied!';
        setTimeout(function () { btn.textContent = defaultLabel; }, 1500);
      }
      if (window.showToast && toastMsg) window.showToast(toastMsg);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(showCopied).catch(function () {
        fallbackCopy(text, showCopied);
      });
    } else {
      fallbackCopy(text, showCopied);
    }
  }

  function fallbackCopy(text, cb) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (cb) cb();
    } catch (_) {}
  }

  var copyBtn = document.getElementById('copy-download-btn');
  if (copyBtn) {
    var origLabel = copyBtn.textContent || 'Copy Link';
    copyBtn.addEventListener('click', function () {
      var url = copyBtn.getAttribute('data-copy-url') || window.location.href;
      copyText(url, copyBtn, origLabel, 'Link copied to clipboard');
    });
  }

  document.querySelectorAll('[data-copy-value]').forEach(function (el) {
    var defaultLabel = el.textContent || 'Copy';
    el.addEventListener('click', function () {
      var val = el.getAttribute('data-copy-value') || '';
      copyText(val, el, defaultLabel, 'Copied to clipboard');
    });
  });

  var qrBtn = document.getElementById('toggle-qr-btn');
  var qrPanel = document.getElementById('drop-ssr-qr');
  var qrWrap = document.getElementById('drop-ssr-qr-wrap');
  var qrRendered = false;

  if (qrBtn && qrPanel && qrWrap) {
    qrBtn.addEventListener('click', function () {
      qrPanel.classList.toggle('open');
      if (!qrRendered && qrPanel.classList.contains('open')) {
        var qrUrl = qrBtn.getAttribute('data-qr-url') || window.location.href;
        if (window.QRCodeLib && typeof window.QRCodeLib.generateSVG === 'function') {
          qrWrap.innerHTML = window.QRCodeLib.generateSVG(qrUrl, { dark: '#000000', light: '#ffffff', margin: 1 });
          qrRendered = true;
        } else if (window.QRCode && typeof window.QRCode.toString === 'function') {
          window.QRCode.toString(qrUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }, function (err, svg) {
            if (!err && svg) {
              qrWrap.innerHTML = svg;
              qrRendered = true;
            }
          });
        } else if (window.QRCodeLib && typeof window.QRCodeLib.renderSVG === 'function') {
          qrWrap.innerHTML = window.QRCodeLib.renderSVG(qrUrl, 152);
          qrRendered = true;
        }
      }
    });
  }

  var themeBtn = document.getElementById('theme-btn');
  if (themeBtn && !document.getElementById('theme-select') && window.PokedbTheme) {
    var cycle = ['oled-black', 'paper', 'matrix', 'cyberpunk', 'synthwave'];
    themeBtn.addEventListener('click', function () {
      var cur = window.PokedbTheme.getCurrentTheme ? window.PokedbTheme.getCurrentTheme() : 'oled-black';
      var next = cycle[(cycle.indexOf(cur) + 1) % cycle.length];
      window.PokedbTheme.applyTheme(next, true);
    });
  }
})();
