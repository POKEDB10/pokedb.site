(function () {
  var activeShortUrl = '';
  var activeStandaloneText = 'https://pokedb.site';

  // Helper to extract crisp high-contrast QR colors
  function getThemeColors() {
    var cs = getComputedStyle(document.documentElement);
    var accent = cs.getPropertyValue('--accent').trim() || '#6366F1';
    return { dark: '#000000', light: '#ffffff' };
  }

  // Render QR Code to <img> element via Base64 Data URL
  function renderQrImage(imgId, text) {
    var img = document.getElementById(imgId);
    if (!img || !text || !window.QRCode) return;

    var colors = getThemeColors();
    QRCode.toDataURL(text, {
      width: 250,
      margin: 1,
      color: {
        dark: colors.dark,
        light: colors.light
      }
    }, function (err, url) {
      if (err) {
        console.error('QR Error:', err);
        return;
      }
      img.src = url;
    });
  }

  // Generate SVG String using QRCode.toString
  function downloadSvg(text, filename) {
    if (!text || !window.QRCode) return;
    var colors = getThemeColors();

    QRCode.toString(text, {
      type: 'svg',
      margin: 1,
      color: {
        dark: colors.dark,
        light: colors.light
      }
    }, function (err, svgString) {
      if (err || !svgString) return console.error('QR SVG Error:', err);

      var blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = filename || 'qrcode.svg';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
  }

  // Download PNG from img element or DataURL
  function downloadPng(imgId, filename) {
    var img = document.getElementById(imgId);
    if (!img || !img.src) return;
    var link = document.createElement('a');
    link.href = img.src;
    link.download = filename || 'qrcode.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Refresh all active QR codes on screen
  function refreshQrCodes() {
    if (activeShortUrl) {
      renderQrImage('qr-img', activeShortUrl);
    }
    var standaloneInput = document.getElementById('qr-input-text');
    var text = (standaloneInput && standaloneInput.value.trim()) || activeStandaloneText;
    renderQrImage('standalone-qr-img', text);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('shorten-form');
    var longUrlInput = document.getElementById('long-url');
    var customAliasInput = document.getElementById('custom-alias');
    var expiresInSelect = document.getElementById('expires-in');
    var errorEl = document.getElementById('shorten-error');
    var resultCard = document.getElementById('shorten-result');
    var shortLinkHref = document.getElementById('short-link-href');
    var statsInfo = document.getElementById('stats-info');
    var copyBtn = document.getElementById('copy-btn');
    var standaloneInput = document.getElementById('qr-input-text');

    // Initial Standalone QR code
    standaloneInput.value = activeStandaloneText;
    renderQrImage('standalone-qr-img', activeStandaloneText);

    // Standalone input listener
    standaloneInput.addEventListener('input', function () {
      var text = standaloneInput.value.trim() || activeStandaloneText;
      renderQrImage('standalone-qr-img', text);
    });

    // Form Submission
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      errorEl.style.display = 'none';
      errorEl.textContent = '';

      var payload = {
        url: longUrlInput.value.trim(),
        customAlias: customAliasInput.value.trim() || undefined,
        expiresInDays: expiresInSelect.value ? Number(expiresInSelect.value) : undefined
      };

      try {
        var res = await fetch('/api/shorten', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        var data = await res.json();

        if (!res.ok) {
          errorEl.textContent = data.error || 'Failed to shorten URL.';
          errorEl.style.display = 'block';
          return;
        }

        activeShortUrl = data.shortUrl;
        shortLinkHref.href = data.shortUrl;
        shortLinkHref.textContent = data.shortUrl;

        var statsText = 'Code: ' + data.code;
        if (data.expiresAt) {
          statsText += ' · Expires: ' + new Date(data.expiresAt).toLocaleDateString();
        } else {
          statsText += ' · Expires: Never';
        }
        statsInfo.textContent = statsText;

        resultCard.classList.add('is-active');
        renderQrImage('qr-img', activeShortUrl);
      } catch (err) {
        errorEl.textContent = 'Network error. Please try again.';
        errorEl.style.display = 'block';
      }
    });

    // Copy to clipboard
    copyBtn.addEventListener('click', function () {
      if (!activeShortUrl) return;
      navigator.clipboard.writeText(activeShortUrl).then(function () {
        var origText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(function () { copyBtn.textContent = origText; }, 2000);
      });
    });

    // Download handlers
    document.getElementById('download-png-btn').addEventListener('click', function () {
      downloadPng('qr-img', 'shortener-qr.png');
    });
    document.getElementById('download-svg-btn').addEventListener('click', function () {
      downloadSvg(activeShortUrl, 'shortener-qr.svg');
    });

    document.getElementById('standalone-png-btn').addEventListener('click', function () {
      downloadPng('standalone-qr-img', 'standalone-qr.png');
    });
    document.getElementById('standalone-svg-btn').addEventListener('click', function () {
      var text = standaloneInput.value.trim() || activeStandaloneText;
      downloadSvg(text, 'standalone-qr.svg');
    });
  });

  // Re-color QR codes dynamically when theme changes
  window.addEventListener('themeChanged', function () {
    setTimeout(refreshQrCodes, 50);
  });
})();
