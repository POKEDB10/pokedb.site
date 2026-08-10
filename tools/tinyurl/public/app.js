(function () {
  var activeShortUrl = '';

  function renderQrImage(containerId, text) {
    var container = document.getElementById(containerId);
    if (!container || !text) return;

    var image = document.createElement('img');
    image.style.cssText = 'width:160px; height:160px; display:block;';
    image.alt = 'QR code for shortened URL';
    image.onerror = function () {
      image.alt = 'QR code could not be generated. Please use the PNG download instead.';
      image.style.opacity = '.35';
    };
    image.src = '/api/qr?format=png&text=' + encodeURIComponent(text) + '&t=' + Date.now();
    container.replaceChildren(image);
  }

  function renderSuggestions(suggestions, aliasInput) {
    var container = document.getElementById('alias-suggestions');
    container.replaceChildren();
    if (!suggestions || !suggestions.length) {
      container.style.display = 'none';
      return;
    }
    var label = document.createElement('span');
    label.textContent = 'Try one of these available aliases:';
    container.appendChild(label);
    suggestions.forEach(function (suggestion) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'alias-suggestion';
      button.textContent = suggestion;
      button.addEventListener('click', function () {
        aliasInput.value = suggestion;
        container.style.display = 'none';
        aliasInput.focus();
      });
      container.appendChild(button);
    });
    container.style.display = 'flex';
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
      renderSuggestions([], customAliasInput);

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
          renderSuggestions(data.suggestions, customAliasInput);
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

    customAliasInput.addEventListener('input', function () {
      renderSuggestions([], customAliasInput);
    });

    // Copy to clipboard
    copyBtn.addEventListener('click', function () {
      if (!activeShortUrl) return;
      navigator.clipboard.writeText(activeShortUrl).then(function () {
        var origText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        if (window.showToast) window.showToast('Short URL copied to clipboard');
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
