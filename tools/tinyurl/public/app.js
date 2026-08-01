(function () {
  var activeShortUrl = '';

  function renderQrImage(containerId, text) {
    var container = document.getElementById(containerId);
    if (!container || !text) return;

    if (window.QRCodeLib && typeof window.QRCodeLib.generateSVG === 'function') {
      try {
        var svg = QRCodeLib.generateSVG(text, {
          dark: '#000000',
          light: '#ffffff',
          margin: 1
        });
        container.innerHTML = svg;
        return;
      } catch (e) {}
    }

    container.innerHTML = '<img src="/api/qr?format=svg&text=' + encodeURIComponent(text) + '" style="width:160px; height:160px; display:block;">';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('shorten-form');
    var longUrlInput = document.getElementById('long-url');
    var customAliasInput = document.getElementById('custom-alias');
    var expiresInSelect = document.getElementById('expires-in');
    var generateQrToggle = document.getElementById('generate-qr-toggle');
    var errorEl = document.getElementById('shorten-error');
    var resultCard = document.getElementById('shorten-result');
    var shortLinkHref = document.getElementById('short-link-href');
    var statsInfo = document.getElementById('stats-info');
    var copyBtn = document.getElementById('copy-btn');
    var qrResultWrap = document.getElementById('qr-result-wrap');
    var downloadPngBtn = document.getElementById('download-png-btn');
    var downloadSvgBtn = document.getElementById('download-svg-btn');

    // Form Submission
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      errorEl.style.display = 'none';
      errorEl.textContent = '';

      var payload = {
        url: longUrlInput.value.trim(),
        customAlias: customAliasInput.value.trim() || undefined,
        expiresInDays: expiresInSelect.value ? Number(expiresInSelect.value) : 30
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

        // Check if QR Code option is checked (Default ON)
        if (generateQrToggle.checked) {
          qrResultWrap.style.display = 'flex';
          renderQrImage('qr-container', activeShortUrl);
        } else {
          qrResultWrap.style.display = 'none';
        }
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

    // Download PNG handler
    downloadPngBtn.addEventListener('click', function () {
      if (!activeShortUrl) return;
      var link = document.createElement('a');
      link.href = '/api/qr?format=png&text=' + encodeURIComponent(activeShortUrl);
      link.download = 'tinyurl-qr.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });

    // Download SVG handler
    downloadSvgBtn.addEventListener('click', function () {
      if (!activeShortUrl) return;
      var link = document.createElement('a');
      link.href = '/api/qr?format=svg&text=' + encodeURIComponent(activeShortUrl);
      link.download = 'tinyurl-qr.svg';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  });
})();
