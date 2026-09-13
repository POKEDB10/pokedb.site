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
        if (shortLinkHref) {
          shortLinkHref.href = data.shortUrl;
          shortLinkHref.textContent = data.shortUrl;
        }

        var statsText = 'Code: ' + data.code;
        var expiryText = data.expiresAt ? new Date(data.expiresAt).toLocaleDateString() : 'Never';
        statsText += ' · Expires: ' + expiryText;
        if (statsInfo) statsInfo.textContent = statsText;

        // Open Result Pop-up Modal
        var modal = document.getElementById('shorten-modal');
        var modalUrlInput = document.getElementById('modal-url-input');
        var modalCodeVal = document.getElementById('modal-code-val');
        var modalExpiryVal = document.getElementById('modal-expiry-val');
        var modalOpenLink = document.getElementById('modal-open-link');
        var modalQrWrap = document.getElementById('modal-qr-wrap');

        if (modalUrlInput) modalUrlInput.value = data.shortUrl;
        if (modalCodeVal) modalCodeVal.textContent = data.code;
        if (modalExpiryVal) modalExpiryVal.textContent = expiryText;
        if (modalOpenLink) modalOpenLink.href = data.shortUrl;

        // Check if QR Code option is checked (Default ON)
        if (generateQrToggle.checked) {
          if (modalQrWrap) modalQrWrap.style.display = 'block';
          renderQrImage('modal-qr-container', activeShortUrl);
        } else {
          if (modalQrWrap) modalQrWrap.style.display = 'none';
        }

        if (modal) modal.classList.add('is-open');
        if (resultCard) resultCard.classList.add('is-active');
      } catch (err) {
        errorEl.textContent = 'Network error. Please try again.';
        errorEl.style.display = 'block';
      }
    });

    customAliasInput.addEventListener('input', function () {
      renderSuggestions([], customAliasInput);
    });

    function closeModal() {
      var modal = document.getElementById('shorten-modal');
      if (modal) modal.classList.remove('is-open');
    }

    var modalCloseBtn = document.getElementById('modal-close-btn');
    var modalDoneBtn = document.getElementById('modal-done-btn');
    var modalBackdrop = document.getElementById('shorten-modal');
    if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
    if (modalDoneBtn) modalDoneBtn.addEventListener('click', closeModal);
    if (modalBackdrop) {
      modalBackdrop.addEventListener('click', function (e) {
        if (e.target === modalBackdrop) closeModal();
      });
    }
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
    });

    // Modal Copy to clipboard
    var modalCopyBtn = document.getElementById('modal-copy-btn');
    function handleCopy(buttonEl) {
      if (!activeShortUrl) return;
      navigator.clipboard.writeText(activeShortUrl).then(function () {
        var orig = buttonEl.textContent;
        buttonEl.textContent = 'Copied!';
        buttonEl.style.background = 'var(--success)';
        buttonEl.style.borderColor = 'var(--success)';
        if (window.showToast) window.showToast('Short URL copied to clipboard');
        setTimeout(function () {
          buttonEl.textContent = orig;
          buttonEl.style.background = '';
          buttonEl.style.borderColor = '';
        }, 2000);
      }).catch(function () {
        var input = document.getElementById('modal-url-input');
        if (input) {
          input.select();
          document.execCommand('copy');
          buttonEl.textContent = 'Copied!';
          setTimeout(function () { buttonEl.textContent = 'Copy'; }, 2000);
        }
      });
    }

    if (modalCopyBtn) {
      modalCopyBtn.addEventListener('click', function () { handleCopy(modalCopyBtn); });
    }
    if (copyBtn) {
      copyBtn.addEventListener('click', function () { handleCopy(copyBtn); });
    }

    function triggerDownload(format) {
      if (!activeShortUrl) return;
      var link = document.createElement('a');
      link.href = '/api/qr?format=' + format + '&text=' + encodeURIComponent(activeShortUrl);
      link.download = 'tinyurl-qr.' + format;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    var modalDlPng = document.getElementById('modal-dl-png');
    var modalDlSvg = document.getElementById('modal-dl-svg');
    if (modalDlPng) modalDlPng.addEventListener('click', function () { triggerDownload('png'); });
    if (modalDlSvg) modalDlSvg.addEventListener('click', function () { triggerDownload('svg'); });
    if (downloadPngBtn) downloadPngBtn.addEventListener('click', function () { triggerDownload('png'); });
    if (downloadSvgBtn) downloadSvgBtn.addEventListener('click', function () { triggerDownload('svg'); });
  });
})();
