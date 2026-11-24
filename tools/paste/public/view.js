(function () {
  'use strict';

  function getPasteCode() {
    var path = window.location.pathname;
    var match = path.match(/\/(?:p|v)\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    try {
      var qp = new URLSearchParams(window.location.search).get('code');
      if (qp && /^[a-zA-Z0-9_-]+$/.test(qp)) return qp;
    } catch (_) {}
    return '';
  }

  var code = getPasteCode();
  var loadedContent = null;
  var loadedRawCipher = null;
  var loadedLanguage = 'plaintext';
  var loadedTitle = 'paste-' + (code || 'text');
  var hasAttemptedPassword = false;

  var LANG_EXT = {
    javascript: '.js',
    typescript: '.ts',
    python: '.py',
    html: '.html',
    css: '.css',
    json: '.json',
    sql: '.sql',
    rust: '.rs',
    go: '.go',
    bash: '.sh',
    shell: '.sh',
    sh: '.sh',
    markdown: '.md',
    plaintext: '.txt'
  };

  var KEYWORDS = {
    javascript: /\b(const|let|var|function|return|async|await|if|else|for|while|try|catch|throw|new|class|import|export|from|interface|type|true|false|null|undefined)\b/,
    python: /\b(def|class|return|import|from|as|if|elif|else|for|while|try|except|with|yield|async|await|True|False|None|pass|break|lambda)\b/,
    rust: /\b(fn|let|mut|pub|struct|enum|impl|match|if|else|for|while|loop|return|use|mod|crate|async|await|true|false|Some|None|Ok|Err)\b/,
    go: /\b(func|var|const|type|struct|interface|package|import|return|if|else|for|range|go|defer|chan|select|true|false|nil)\b/,
    sql: /\b(SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|INDEX|JOIN|LEFT|RIGHT|ON|GROUP|ORDER|BY|LIMIT|AND|OR|NOT|NULL|AS)\b/i,
    bash: /\b(if|then|elif|else|fi|for|do|done|while|case|esac|function|export|local|return|echo|exit|set)\b/
  };

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    return (bytes / 1024).toFixed(bytes >= 10240 ? 1 : 2) + ' KiB';
  }

  function formatExpiry(expiresAt) {
    if (!expiresAt) return 'No expiry';
    var diffMs = new Date(expiresAt).getTime() - Date.now();
    if (isNaN(diffMs)) return 'Active';
    if (diffMs <= 0) return 'Expiring soon';
    var mins = Math.round(diffMs / 60000);
    if (mins < 60) return 'Expires in ' + mins + 'm';
    var hrs = Math.round(mins / 60);
    if (hrs < 48) return 'Expires in ' + hrs + 'h';
    var days = Math.round(hrs / 24);
    return 'Expires in ' + days + 'd';
  }

  function appendHighlightedLine(parent, line, lang) {
    if (!lang || lang === 'plaintext') {
      parent.appendChild(document.createTextNode(line));
      return;
    }

    if (lang === 'markdown') {
      if (/^\s{0,3}#{1,6}\s/.test(line) || /^\s*```/.test(line)) {
        var hdr = document.createElement('span');
        hdr.className = 'tok-kw';
        hdr.textContent = line;
        parent.appendChild(hdr);
        return;
      }
    }

    var kwPattern = KEYWORDS[lang];
    var patternSource = lang === 'python' || lang === 'bash'
      ? '(#.*$)|("(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\')|\\b(\\d+(?:\\.\\d+)?)\\b'
      : lang === 'sql'
        ? '(--.*$)|(\'(?:[^\']|\'\')*\')|\\b(\\d+(?:\\.\\d+)?)\\b'
        : lang === 'html'
          ? '(<!--.*?-->)|("(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\')|(<\\/?[a-zA-Z0-9-]+|\\s*\\/?>)'
          : '(\\/\\/.*$|\\/\\*.*?\\*\\/)|("(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)|\\b(\\d+(?:\\.\\d+)?)\\b';

    var tokenRe = new RegExp(patternSource, 'g');
    var lastIdx = 0;
    var m;

    function appendWithKeywords(chunk) {
      if (!chunk) return;
      if (!kwPattern) {
        parent.appendChild(document.createTextNode(chunk));
        return;
      }
      var gRe = new RegExp(kwPattern.source, kwPattern.flags + 'g');
      var kLast = 0;
      var km;
      while ((km = gRe.exec(chunk)) !== null) {
        if (km.index > kLast) {
          parent.appendChild(document.createTextNode(chunk.slice(kLast, km.index)));
        }
        var kwSpan = document.createElement('span');
        kwSpan.className = 'tok-kw';
        kwSpan.textContent = km[0];
        parent.appendChild(kwSpan);
        kLast = km.index + km[0].length;
      }
      if (kLast < chunk.length) {
        parent.appendChild(document.createTextNode(chunk.slice(kLast)));
      }
    }

    while ((m = tokenRe.exec(line)) !== null) {
      if (m.index > lastIdx) {
        appendWithKeywords(line.slice(lastIdx, m.index));
      }
      var span = document.createElement('span');
      if (m[1]) {
        span.className = 'tok-com';
      } else if (m[2]) {
        span.className = (lang === 'json' && line.slice(m.index + m[0].length).trimStart().charAt(0) === ':') ? 'tok-key' : 'tok-str';
      } else if (lang === 'html' && m[3]) {
        span.className = 'tok-kw';
      } else {
        span.className = 'tok-num';
      }
      span.textContent = m[0];
      parent.appendChild(span);
      lastIdx = m.index + m[0].length;
    }

    if (lastIdx < line.length) {
      appendWithKeywords(line.slice(lastIdx));
    }
  }

  function renderCodeLines(codeBox, text, lang) {
    codeBox.replaceChildren();
    var lines = text.split('\n');
    var highlight = lines.length <= 2500 ? lang : 'plaintext';
    var digits = Math.max(2, String(lines.length).length);
    codeBox.style.setProperty('--ln-width', (digits + 1.2) + 'ch');

    var linesPill = document.getElementById('paste-lines');
    if (linesPill) {
      linesPill.textContent = lines.length + (lines.length === 1 ? ' line' : ' lines');
      linesPill.hidden = false;
    }

    var frag = document.createDocumentFragment();
    for (var i = 0; i < lines.length; i++) {
      var lineRow = document.createElement('div');
      lineRow.className = 'paste-line';

      var ln = document.createElement('span');
      ln.className = 'paste-line-num';
      ln.setAttribute('aria-hidden', 'true');
      ln.textContent = String(i + 1);

      var txt = document.createElement('span');
      txt.className = 'paste-line-text';
      appendHighlightedLine(txt, lines[i], highlight);

      lineRow.appendChild(ln);
      lineRow.appendChild(txt);
      frag.appendChild(lineRow);
    }

    codeBox.appendChild(frag);
    codeBox.style.display = 'block';
  }

  function copyWithFallback(text, onDone) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onDone).catch(function () { fallbackCopy(text, onDone); });
    } else {
      fallbackCopy(text, onDone);
    }
  }

  function fallbackCopy(text, onDone) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (onDone) onDone();
    } catch (_) {}
  }

  function setStateCard(id, visible) {
    var el = document.getElementById(id);
    if (el) el.classList.toggle('is-visible', visible);
  }

  function setE2eBadge(text, variant) {
    var badge = document.getElementById('paste-e2e-badge');
    if (!badge) return;
    badge.textContent = text;
    badge.className = 'meta-pill' + (variant ? ' ' + variant : '');
    badge.hidden = !text;
  }

  function resolveDownloadFilename(title, lang) {
    var base = (title || ('paste-' + code)).trim().replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!base) base = 'paste-' + code;
    var ext = LANG_EXT[lang] || '.txt';
    var lower = base.toLowerCase();
    if (lang === 'javascript' && /\.(js|ts|mjs|cjs|jsx|tsx)$/.test(lower)) return base;
    if (lang === 'html' && /\.(html|htm|css)$/.test(lower)) return base;
    if (lang === 'bash' && /\.(sh|bash|zsh)$/.test(lower)) return base;
    if (lower.endsWith(ext)) return base;
    return base + ext;
  }

  async function renderQrModal() {
    var modal = document.getElementById('qr-modal');
    var wrap = document.getElementById('qr-svg-wrap');
    if (!modal || !wrap) return;
    var rendered = false;
    try {
      if (window.QRCode && typeof window.QRCode.toString === 'function') {
        wrap.innerHTML = await window.QRCode.toString(window.location.href, {
          type: 'svg',
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#000000', light: '#ffffff' }
        });
        rendered = true;
      } else if (window.QRCodeLib) {
        wrap.innerHTML = window.QRCodeLib.generateSVG(window.location.href, {
          dark: '#000000',
          light: '#ffffff',
          ecLevel: 'M'
        });
        rendered = true;
      }
    } catch (_) {}
    if (!rendered) {
      wrap.textContent = 'QR unavailable for this URL';
    }
    modal.classList.add('is-open');
    var closeBtn = document.getElementById('close-qr-btn');
    if (closeBtn) closeBtn.focus();
  }

  function closeQrModal() {
    var modal = document.getElementById('qr-modal');
    if (modal) modal.classList.remove('is-open');
    var qrBtn = document.getElementById('qr-btn');
    if (qrBtn) qrBtn.focus();
  }

  async function decryptAndRender(cipherText, rawKey) {
    var key = (rawKey || '').trim().replace(/^#?k=/, '');
    if (!key || !window.CryptoWeb) {
      setE2eBadge('Locked · Key Missing', 'is-danger');
      document.getElementById('key-auth-title').textContent = 'Decryption Key Required (#k=)';
      document.getElementById('key-error').textContent = '';
      setStateCard('key-auth-box', true);
      document.getElementById('paste-body-box').style.display = 'none';
      return false;
    }

    try {
      var plain = await window.CryptoWeb.decryptText(cipherText, key);
      loadedContent = plain;
      setStateCard('key-auth-box', false);
      setE2eBadge('E2E Decrypted', 'is-success');
      var plainSize = typeof TextEncoder !== 'undefined'
        ? new TextEncoder().encode(plain).length
        : plain.length;
      document.getElementById('paste-size').textContent = formatBytes(plainSize);
      renderCodeLines(document.getElementById('paste-body-box'), plain, loadedLanguage);
      return true;
    } catch (decErr) {
      console.warn('[Paste Decrypt] Failed to decrypt with key:', decErr);
      setE2eBadge('Key Mismatch', 'is-danger');
      document.getElementById('key-auth-title').textContent = 'Decryption Key Mismatch';
      document.getElementById('key-error').textContent = 'The provided #k= key could not decrypt this paste.';
      setStateCard('key-auth-box', true);
      document.getElementById('paste-body-box').style.display = 'none';
      return false;
    }
  }

  var codeLabel = document.getElementById('paste-code-label');
  if (codeLabel && code) codeLabel.textContent = code;

  if (!code) {
    document.getElementById('paste-title').textContent = 'Invalid Paste URL';
    setStateCard('paste-error-box', true);
    document.getElementById('paste-error-msg').textContent = 'No paste ID was found in this URL.';
    return;
  }

  var rawBtn = document.getElementById('raw-btn');
  if (rawBtn) {
    rawBtn.href = '/p/' + code + '/raw';
    rawBtn.addEventListener('click', function (e) {
      if (loadedContent !== null) {
        e.preventDefault();
        var blob = new Blob([loadedContent], { type: 'text/plain;charset=utf-8' });
        var blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank', 'noopener');
        setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 60000);
      }
    });
  }

  var copyBtn = document.getElementById('copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      if (loadedContent === null) return;
      copyWithFallback(loadedContent, function () {
        copyBtn.textContent = 'Copied!';
        setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1600);
        if (window.showToast) window.showToast('Paste text copied to clipboard!');
      });
    });
  }

  var dlBtn = document.getElementById('download-btn');
  if (dlBtn) {
    dlBtn.addEventListener('click', function () {
      if (loadedContent === null) return;
      var blob = new Blob([loadedContent], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = resolveDownloadFilename(loadedTitle, loadedLanguage);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
  }

  var wrapBtn = document.getElementById('wrap-btn');
  if (wrapBtn) {
    wrapBtn.addEventListener('click', function () {
      var codeBox = document.getElementById('paste-body-box');
      if (!codeBox) return;
      var wrapped = codeBox.classList.toggle('is-wrapped');
      wrapBtn.setAttribute('aria-pressed', wrapped ? 'true' : 'false');
      wrapBtn.classList.toggle('is-toggled', wrapped);
      wrapBtn.textContent = wrapped ? 'Wrapped' : 'Wrap';
    });
  }

  var linesBtn = document.getElementById('lines-btn');
  if (linesBtn) {
    linesBtn.addEventListener('click', function () {
      var codeBox = document.getElementById('paste-body-box');
      if (!codeBox) return;
      var hidden = codeBox.classList.toggle('hide-line-nums');
      linesBtn.setAttribute('aria-pressed', hidden ? 'false' : 'true');
      linesBtn.classList.toggle('is-toggled', !hidden);
    });
  }

  async function loadPaste(password) {
    try {
      var res = await fetch('/api/paste/view/' + code, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password || '' })
      });
      var data = await res.json();

      if (res.status === 401) {
        setStateCard('pass-auth-box', true);
        setStateCard('key-auth-box', false);
        setStateCard('paste-error-box', false);
        document.getElementById('paste-body-box').style.display = 'none';
        document.getElementById('paste-title').textContent = 'Password Required';
        setE2eBadge('Password Locked', 'is-accent');
        var passErr = document.getElementById('pass-error');
        if (passErr) {
          passErr.textContent = hasAttemptedPassword ? 'Incorrect password. Please try again.' : '';
        }
        var passInput = document.getElementById('pass-input');
        if (passInput) passInput.focus();
        return;
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load paste.');
      }

      var paste = data.paste;
      loadedTitle = paste.title || ('paste-' + code);
      loadedLanguage = (paste.language || 'plaintext').toLowerCase();

      setStateCard('pass-auth-box', false);
      setStateCard('paste-error-box', false);
      document.getElementById('paste-title').textContent = paste.title || 'Untitled Paste';
      document.getElementById('paste-lang').textContent = loadedLanguage;
      document.getElementById('paste-size').textContent = formatBytes(paste.size || 0);
      var viewsCount = paste.views || 1;
      document.getElementById('paste-views').textContent = viewsCount + (viewsCount === 1 ? ' view' : ' views');

      var burnEl = document.getElementById('paste-burn-status');
      if (burnEl) {
        if (paste.burnOnRead) {
          burnEl.textContent = 'Burned on read · Deleted';
          burnEl.className = 'meta-pill is-danger';
          burnEl.hidden = false;
        } else {
          burnEl.textContent = formatExpiry(paste.expiresAt);
          burnEl.className = 'meta-pill is-muted';
          burnEl.hidden = false;
        }
      }

      var hash = window.location.hash || '';
      var keyMatch = hash.match(/[#&]k=([A-Za-z0-9_-]+)/);

      if (paste.encrypted || (keyMatch && keyMatch[1])) {
        loadedRawCipher = paste.content;
        await decryptAndRender(paste.content, keyMatch ? keyMatch[1] : '');
      } else {
        setStateCard('key-auth-box', false);
        setE2eBadge(paste.isProtected ? 'Password Unlocked' : 'Standard', paste.isProtected ? 'is-success' : 'is-muted');
        loadedContent = paste.content;
        renderCodeLines(document.getElementById('paste-body-box'), paste.content, loadedLanguage);
      }
    } catch (err) {
      setStateCard('pass-auth-box', false);
      setStateCard('key-auth-box', false);
      setStateCard('paste-error-box', true);
      document.getElementById('paste-body-box').style.display = 'none';
      document.getElementById('paste-title').textContent = 'Paste Expired or Not Found';
      document.getElementById('paste-error-msg').textContent = err.message;
    }
  }

  var passForm = document.getElementById('pass-form');
  if (passForm) {
    passForm.addEventListener('submit', function (e) {
      e.preventDefault();
      hasAttemptedPassword = true;
      var pass = document.getElementById('pass-input').value;
      loadPaste(pass);
    });
  }

  var toggleUnlockBtn = document.getElementById('toggle-unlock-pass');
  var unlockInput = document.getElementById('pass-input');
  if (toggleUnlockBtn && unlockInput) {
    toggleUnlockBtn.addEventListener('click', function () {
      var show = unlockInput.type === 'password';
      unlockInput.type = show ? 'text' : 'password';
      toggleUnlockBtn.textContent = show ? 'Hide' : 'Show';
      toggleUnlockBtn.setAttribute('aria-pressed', show ? 'true' : 'false');
    });
  }

  var keyForm = document.getElementById('key-form');
  if (keyForm) {
    keyForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (loadedRawCipher === null) return;
      var val = document.getElementById('key-input').value;
      decryptAndRender(loadedRawCipher, val);
    });
  }

  var qrBtn = document.getElementById('qr-btn');
  if (qrBtn) qrBtn.addEventListener('click', renderQrModal);

  var closeQrBtn = document.getElementById('close-qr-btn');
  var doneQrBtn = document.getElementById('qr-done-btn');
  var qrModal = document.getElementById('qr-modal');
  if (closeQrBtn) closeQrBtn.addEventListener('click', closeQrModal);
  if (doneQrBtn) doneQrBtn.addEventListener('click', closeQrModal);
  if (qrModal) {
    qrModal.addEventListener('click', function (e) {
      if (e.target === qrModal) closeQrModal();
    });
  }

  var qrCopyBtn = document.getElementById('qr-copy-link-btn');
  if (qrCopyBtn) {
    qrCopyBtn.addEventListener('click', function () {
      copyWithFallback(window.location.href, function () {
        qrCopyBtn.textContent = 'Copied!';
        setTimeout(function () { qrCopyBtn.textContent = 'Copy Link'; }, 1600);
        if (window.showToast) window.showToast('Paste URL copied!');
      });
    });
  }

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && qrModal && qrModal.classList.contains('is-open')) {
      closeQrModal();
    }
  });

  loadPaste();
})();
