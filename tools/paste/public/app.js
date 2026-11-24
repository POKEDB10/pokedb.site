(function () {
  'use strict';

  var MAX_BYTES = 256 * 1024;
  var textarea = document.getElementById('paste-content');
  var charCounter = document.getElementById('char-counter');
  var sizeProgress = document.getElementById('size-progress');
  var pasteError = document.getElementById('paste-error');
  var pasteForm = document.getElementById('paste-form');
  var titleInput = document.getElementById('paste-title');
  var langSelect = document.getElementById('paste-language');
  var expirySelect = document.getElementById('paste-expiry');
  var encryptBox = document.getElementById('paste-client-encrypt');
  var burnBox = document.getElementById('paste-burn');
  var tabIndentBox = document.getElementById('paste-tab-indent');
  var passInput = document.getElementById('paste-password');
  var togglePassBtn = document.getElementById('toggle-pass-btn');
  var clearBtn = document.getElementById('clear-btn');
  var createBtn = document.getElementById('create-btn');
  var createBtnLabel = document.getElementById('create-btn-label');
  var editorLangBadge = document.getElementById('editor-lang-badge');
  var editorE2eBadge = document.getElementById('editor-e2e-badge');
  var payloadHint = document.getElementById('payload-hint');

  var pasteModal = document.getElementById('paste-result-modal');
  var pasteCloseBtn = document.getElementById('paste-modal-close-btn');
  var pasteDoneBtn = document.getElementById('modal-paste-done-btn');
  var pasteCopyBtn = document.getElementById('modal-paste-copy-btn');
  var pasteUrlInput = document.getElementById('modal-paste-url');
  var modalQrBtn = document.getElementById('modal-paste-qr-btn');
  var modalQrBox = document.getElementById('modal-qr-box');
  var modalQrContainer = document.getElementById('modal-qr-container');
  var modalBurnNotice = document.getElementById('modal-burn-notice');
  var modalRawBtn = document.getElementById('modal-paste-raw-btn');

  var userSelectedLang = false;
  var lastFocusedBeforeModal = null;

  var EXT_TO_LANG = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    ts: 'javascript', tsx: 'javascript',
    py: 'python', pyw: 'python',
    html: 'html', htm: 'html', css: 'html', svg: 'html',
    json: 'json',
    sql: 'sql',
    rs: 'rust',
    go: 'go',
    sh: 'bash', bash: 'bash', zsh: 'bash', env: 'bash',
    md: 'markdown', markdown: 'markdown',
    txt: 'plaintext', log: 'plaintext'
  };

  function formatSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    return (bytes / 1024).toFixed(bytes >= 10240 ? 1 : 2) + ' KiB';
  }

  function showError(msg) {
    if (!pasteError) return;
    pasteError.textContent = msg;
    pasteError.classList.add('is-visible');
  }

  function clearError() {
    if (!pasteError) return;
    pasteError.textContent = '';
    pasteError.classList.remove('is-visible');
  }

  function utf8ByteLength(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
    return new Blob([str]).size;
  }

  function estimateWireBytes(plainBytes) {
    if (!plainBytes) return 0;
    if (encryptBox && encryptBox.checked) {
      return Math.ceil((plainBytes + 28) * 4 / 3);
    }
    return plainBytes;
  }

  function syncPillClasses() {
    [encryptBox, burnBox, tabIndentBox].forEach(function (box) {
      if (!box) return;
      var pill = box.closest('.toggle-pill');
      if (pill) pill.classList.toggle('is-checked', box.checked);
    });
    if (editorE2eBadge) {
      var e2eOn = Boolean(encryptBox && encryptBox.checked);
      editorE2eBadge.textContent = e2eOn ? 'E2E #k=' : 'Standard';
      editorE2eBadge.classList.toggle('is-accent', e2eOn);
      editorE2eBadge.classList.toggle('is-muted', !e2eOn);
    }
    if (payloadHint) {
      if (encryptBox && encryptBox.checked) {
        payloadHint.textContent = 'Client AES-GCM active · key stays in #k=';
      } else {
        payloadHint.textContent = 'Plain server storage · raw endpoint enabled';
      }
    }
  }

  function updateEditorMetrics() {
    var text = textarea ? textarea.value : '';
    var lines = text ? text.split('\n').length : 0;
    var plainBytes = utf8ByteLength(text);
    var wireBytes = estimateWireBytes(plainBytes);
    var pct = Math.min(100, (wireBytes / MAX_BYTES) * 100);

    if (charCounter) {
      var sizeLabel = formatSize(plainBytes);
      if (encryptBox && encryptBox.checked && plainBytes > 0) {
        sizeLabel += ' (~' + formatSize(wireBytes) + ' enc)';
      }
      charCounter.textContent = lines + (lines === 1 ? ' line · ' : ' lines · ') + sizeLabel + ' / 256 KiB';
      charCounter.classList.toggle('is-warn', wireBytes > MAX_BYTES * 0.8 && wireBytes <= MAX_BYTES);
      charCounter.classList.toggle('is-over', wireBytes > MAX_BYTES);
    }

    if (sizeProgress) {
      sizeProgress.style.width = pct.toFixed(1) + '%';
      sizeProgress.classList.toggle('is-warn', wireBytes > MAX_BYTES * 0.8 && wireBytes <= MAX_BYTES);
      sizeProgress.classList.toggle('is-over', wireBytes > MAX_BYTES);
    }
  }

  function syncLangBadge() {
    if (editorLangBadge && langSelect) {
      editorLangBadge.textContent = langSelect.options[langSelect.selectedIndex].text;
    }
  }

  function maybeDetectLanguageFromName(name) {
    if (userSelectedLang || !name || !langSelect) return;
    var parts = name.trim().toLowerCase().split('.');
    if (parts.length < 2) return;
    var ext = parts.pop();
    if (EXT_TO_LANG[ext]) {
      langSelect.value = EXT_TO_LANG[ext];
      syncLangBadge();
    }
  }

  function closePasteModal() {
    if (!pasteModal) return;
    pasteModal.classList.remove('is-open');
    if (modalQrBox) modalQrBox.classList.remove('is-visible');
    if (modalQrBtn) modalQrBtn.setAttribute('aria-expanded', 'false');
    if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === 'function') {
      lastFocusedBeforeModal.focus();
      lastFocusedBeforeModal = null;
    }
  }

  function openPasteModal() {
    if (!pasteModal) return;
    lastFocusedBeforeModal = document.activeElement;
    pasteModal.classList.add('is-open');
    if (pasteCopyBtn) pasteCopyBtn.focus();
  }

  async function renderModalQr(url) {
    if (!modalQrContainer || !url) return;
    try {
      if (window.QRCode && typeof window.QRCode.toString === 'function') {
        modalQrContainer.innerHTML = await window.QRCode.toString(url, {
          type: 'svg',
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#000000', light: '#ffffff' }
        });
        return;
      }
      if (window.QRCodeLib) {
        modalQrContainer.innerHTML = window.QRCodeLib.generateSVG(url, {
          dark: '#000000',
          light: '#ffffff',
          ecLevel: 'M'
        });
        return;
      }
    } catch (_) {}
    modalQrContainer.textContent = 'QR unavailable for this URL';
  }

  function setSubmitting(busy) {
    if (!createBtn) return;
    createBtn.disabled = busy;
    if (createBtnLabel) {
      createBtnLabel.textContent = busy ? 'Encrypting & Saving…' : 'Create Paste';
    }
  }

  if (pasteCloseBtn) pasteCloseBtn.addEventListener('click', closePasteModal);
  if (pasteDoneBtn) pasteDoneBtn.addEventListener('click', closePasteModal);
  if (pasteModal) {
    pasteModal.addEventListener('click', function (e) {
      if (e.target === pasteModal) closePasteModal();
    });
  }
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && pasteModal && pasteModal.classList.contains('is-open')) {
      closePasteModal();
    }
  });

  if (pasteCopyBtn) {
    pasteCopyBtn.addEventListener('click', function () {
      if (!pasteUrlInput || !pasteUrlInput.value) return;
      var text = pasteUrlInput.value;
      var onCopied = function () {
        pasteCopyBtn.textContent = 'Copied!';
        setTimeout(function () { pasteCopyBtn.textContent = 'Copy Link'; }, 1800);
        if (window.showToast) window.showToast('Paste link copied to clipboard');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(onCopied).catch(function () {
          pasteUrlInput.select();
          document.execCommand('copy');
          onCopied();
        });
      } else {
        pasteUrlInput.select();
        document.execCommand('copy');
        onCopied();
      }
    });
  }

  if (modalQrBtn && modalQrBox) {
    modalQrBtn.addEventListener('click', function () {
      var open = modalQrBox.classList.toggle('is-visible');
      modalQrBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && pasteUrlInput && pasteUrlInput.value) {
        renderModalQr(pasteUrlInput.value);
      }
    });
  }

  if (togglePassBtn && passInput) {
    togglePassBtn.addEventListener('click', function () {
      var show = passInput.type === 'password';
      passInput.type = show ? 'text' : 'password';
      togglePassBtn.textContent = show ? 'Hide' : 'Show';
      togglePassBtn.setAttribute('aria-pressed', show ? 'true' : 'false');
      togglePassBtn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  }

  if (textarea) {
    textarea.addEventListener('input', function () {
      clearError();
      updateEditorMetrics();
    });

    textarea.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (pasteForm) pasteForm.requestSubmit();
        return;
      }

      if (e.key === 'Escape' && tabIndentBox && tabIndentBox.checked) {
        tabIndentBox.checked = false;
        syncPillClasses();
        if (window.showToast) window.showToast('Tab indentation paused — Tab moves focus');
        return;
      }

      if (e.key === 'Tab' && tabIndentBox && tabIndentBox.checked) {
        e.preventDefault();
        var start = textarea.selectionStart;
        var end = textarea.selectionEnd;
        var val = textarea.value;

        if (e.shiftKey) {
          var lineStart = val.lastIndexOf('\n', start - 1) + 1;
          var lineSlice = val.slice(lineStart, end);
          var removedBeforeStart = 0;
          var replaced = lineSlice.replace(/^ {1,2}|^\t/gm, function (m, offset) {
            if (offset === 0) removedBeforeStart = m.length;
            return '';
          });
          textarea.value = val.slice(0, lineStart) + replaced + val.slice(end);
          textarea.selectionStart = Math.max(lineStart, start - removedBeforeStart);
          textarea.selectionEnd = Math.max(lineStart, end - (lineSlice.length - replaced.length));
        } else {
          textarea.value = val.slice(0, start) + '  ' + val.slice(end);
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        }
        updateEditorMetrics();
      }
    });

    textarea.addEventListener('dragover', function (e) {
      e.preventDefault();
      textarea.classList.add('is-dragover');
    });
    textarea.addEventListener('dragleave', function () {
      textarea.classList.remove('is-dragover');
    });
    textarea.addEventListener('drop', function (e) {
      e.preventDefault();
      textarea.classList.remove('is-dragover');
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      if (file.size > MAX_BYTES) {
        showError('Dropped file is ' + formatSize(file.size) + ', exceeding the 256 KiB cap.');
        return;
      }
      file.text().then(function (text) {
        textarea.value = text;
        if (titleInput && !titleInput.value.trim()) {
          titleInput.value = file.name.slice(0, 100);
        }
        maybeDetectLanguageFromName(file.name);
        clearError();
        updateEditorMetrics();
        if (window.showToast) window.showToast('Loaded ' + file.name);
      }).catch(function () {
        showError('Could not read dropped file as text.');
      });
    });
  }

  if (titleInput) {
    titleInput.addEventListener('input', function () {
      maybeDetectLanguageFromName(titleInput.value);
    });
  }

  if (langSelect) {
    langSelect.addEventListener('change', function () {
      userSelectedLang = true;
      syncLangBadge();
    });
  }

  [encryptBox, burnBox, tabIndentBox].forEach(function (box) {
    if (!box) return;
    box.addEventListener('change', function () {
      syncPillClasses();
      updateEditorMetrics();
    });
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      if (textarea) textarea.value = '';
      if (titleInput) titleInput.value = '';
      if (passInput) passInput.value = '';
      if (langSelect) langSelect.value = 'plaintext';
      userSelectedLang = false;
      clearError();
      syncLangBadge();
      updateEditorMetrics();
      if (textarea) textarea.focus();
    });
  }

  if (window.PokedbTurnstile) {
    window.PokedbTurnstile.mount('#paste-turnstile-wrap');
  }

  if (pasteForm) {
    pasteForm.addEventListener('submit', async function (e) {
      if (e) e.preventDefault();
      clearError();

      var content = textarea ? textarea.value : '';
      if (!content.trim()) {
        showError('Paste content cannot be empty.');
        if (textarea) textarea.focus();
        return;
      }

      var plainBytes = utf8ByteLength(content);
      var estimatedBytes = estimateWireBytes(plainBytes);
      if (estimatedBytes > MAX_BYTES) {
        showError('Payload is ~' + formatSize(estimatedBytes) + ', exceeding the 256 KiB limit. Disable E2E or shorten the paste.');
        return;
      }

      setSubmitting(true);

      try {
        var payloadContent = content;
        var fragmentKey = '';

        if (encryptBox && encryptBox.checked && window.CryptoWeb) {
          try {
            var encResult = await window.CryptoWeb.encryptText(content);
            payloadContent = encResult.ciphertext;
            fragmentKey = encResult.key;
          } catch (encErr) {
            console.warn('[Paste] Encryption failed, falling back to plain:', encErr);
          }
        }

        var actualBytes = utf8ByteLength(payloadContent);
        if (actualBytes > MAX_BYTES) {
          throw new Error('Encrypted payload (' + formatSize(actualBytes) + ') exceeds the 256 KiB limit.');
        }

        var bodyPayload = {
          content: payloadContent,
          title: titleInput ? titleInput.value.trim() : '',
          language: langSelect ? langSelect.value : 'plaintext',
          expiresInDays: expirySelect ? expirySelect.value : '30',
          burnOnRead: Boolean(burnBox && burnBox.checked),
          password: passInput ? passInput.value : '',
          encrypted: Boolean(fragmentKey)
        };

        if (window.PokedbTurnstile) {
          var tsToken = await window.PokedbTurnstile.getToken('#paste-turnstile-wrap');
          if (tsToken) bodyPayload['cf-turnstile-response'] = tsToken;
        }

        var res = await fetch('/api/paste/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyPayload)
        });
        var data = await res.json();
        if (window.PokedbTurnstile) window.PokedbTurnstile.reset('#paste-turnstile-wrap');
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create paste.');

        var finalUrl = data.url;
        if (fragmentKey) finalUrl += '#k=' + fragmentKey;

        pasteForm._rawContent = content;
        pasteForm._useLocalRaw = Boolean(fragmentKey || (burnBox && burnBox.checked) || (passInput && passInput.value));

        pasteUrlInput.value = finalUrl;
        document.getElementById('modal-paste-view-btn').href = finalUrl;
        document.getElementById('modal-paste-raw-btn').href = data.rawUrl || (data.url + '/raw');
        document.getElementById('modal-paste-lang').textContent = langSelect.options[langSelect.selectedIndex].text;
        document.getElementById('modal-paste-expiry').textContent = expirySelect.options[expirySelect.selectedIndex].text;
        document.getElementById('modal-paste-size').textContent = formatSize(plainBytes);

        var secFlags = [];
        if (fragmentKey) secFlags.push('E2E AES-GCM');
        if (burnBox && burnBox.checked) secFlags.push('Burn');
        if (passInput && passInput.value.trim()) secFlags.push('Password');
        document.getElementById('modal-paste-security').textContent = secFlags.length ? secFlags.join(' · ') : 'Standard';

        if (modalBurnNotice) {
          modalBurnNotice.classList.toggle('is-visible', Boolean(burnBox && burnBox.checked));
        }
        if (modalQrBox && modalQrBox.classList.contains('is-visible')) {
          renderModalQr(finalUrl);
        }

        openPasteModal();
        setSubmitting(false);

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(finalUrl).catch(function () {});
        }
      } catch (err) {
        showError(err.message);
        if (window.showToast) window.showToast('Error: ' + err.message);
        setSubmitting(false);
      }
    });
  }

  if (modalRawBtn && pasteForm) {
    modalRawBtn.addEventListener('click', function (e) {
      if (pasteForm._useLocalRaw && typeof pasteForm._rawContent === 'string') {
        e.preventDefault();
        var blob = new Blob([pasteForm._rawContent], { type: 'text/plain;charset=utf-8' });
        var blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank', 'noopener');
        setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 60000);
      }
    });
  }

  syncPillClasses();
  syncLangBadge();
  updateEditorMetrics();
})();
