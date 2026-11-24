(function () {
  var inputEl = document.getElementById('input-text');
  var outputEl = document.getElementById('output-text');
  var formatEl = document.getElementById('format-select');
  var statusBar = document.getElementById('status-bar');

  function encodeData() {
    var text = inputEl.value;
    var format = formatEl.value;
    if (!text) { outputEl.value = ''; return; }

    try {
      var bytes = new TextEncoder().encode(text);
      if (format === 'base64') {
        outputEl.value = btoa(unescape(encodeURIComponent(text)));
      } else if (format === 'base64url') {
        outputEl.value = btoa(unescape(encodeURIComponent(text)))
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      } else if (format === 'hex') {
        outputEl.value = Array.from(bytes).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      } else if (format === 'url') {
        outputEl.value = encodeURIComponent(text);
      } else if (format === 'binary') {
        outputEl.value = Array.from(bytes).map(function (b) { return b.toString(2).padStart(8, '0'); }).join(' ');
      }
      statusBar.textContent = 'Encoded ' + bytes.length + ' bytes into ' + format;
      statusBar.style.color = 'var(--success)';
    } catch (e) {
      statusBar.textContent = 'Encoding error: ' + e.message;
      statusBar.style.color = 'var(--danger)';
    }
  }

  function decodeData() {
    var text = outputEl.value.trim();
    var format = formatEl.value;
    if (!text) { inputEl.value = ''; return; }

    try {
      if (format === 'base64') {
        inputEl.value = decodeURIComponent(escape(atob(text)));
      } else if (format === 'base64url') {
        var b64 = text.replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4 !== 0) b64 += '=';
        inputEl.value = decodeURIComponent(escape(atob(b64)));
      } else if (format === 'hex') {
        var clean = text.replace(/[^0-9a-fA-F]/g, '');
        var bytes = new Uint8Array(clean.length / 2);
        for (var i = 0; i < clean.length; i += 2) {
          bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
        }
        inputEl.value = new TextDecoder().decode(bytes);
      } else if (format === 'url') {
        inputEl.value = decodeURIComponent(text);
      } else if (format === 'binary') {
        var cleanBin = text.replace(/[^01]/g, '');
        var outBytes = [];
        for (var j = 0; j < cleanBin.length; j += 8) {
          outBytes.push(parseInt(cleanBin.substring(j, j + 8), 2));
        }
        inputEl.value = new TextDecoder().decode(new Uint8Array(outBytes));
      }
      statusBar.textContent = 'Decoded ' + format + ' successfully';
      statusBar.style.color = 'var(--success)';
    } catch (e) {
      statusBar.textContent = 'Decoding error: ' + e.message;
      statusBar.style.color = 'var(--danger)';
    }
  }

  function copyWithFallback(text, onDone) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onDone).catch(function () { fallbackCopy(text, onDone); });
    } else {
      fallbackCopy(text, onDone);
    }
  }

  function fallbackCopy(text, onDone) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); if (onDone) onDone(); } catch (_) {}
    document.body.removeChild(ta);
  }

  document.getElementById('btn-encode').addEventListener('click', encodeData);
  document.getElementById('btn-decode').addEventListener('click', decodeData);
  document.getElementById('btn-swap').addEventListener('click', function () {
    var tmp = inputEl.value;
    inputEl.value = outputEl.value;
    outputEl.value = tmp;
  });

  document.getElementById('btn-copy').addEventListener('click', function () {
    if (!outputEl.value) return;
    copyWithFallback(outputEl.value, function () {
      statusBar.textContent = 'Copied result to clipboard!';
      statusBar.style.color = 'var(--success)';
      setTimeout(function () { statusBar.textContent = 'Ready'; statusBar.style.color = 'var(--muted)'; }, 2000);
    });
  });

  document.getElementById('btn-clear').addEventListener('click', function () {
    inputEl.value = '';
    outputEl.value = '';
    statusBar.textContent = 'Ready';
    statusBar.style.color = 'var(--muted)';
    window.location.hash = '';
  });

  document.getElementById('btn-share').addEventListener('click', async function () {
    if (!inputEl.value || !window.StateUrl) return;
    var token = await window.StateUrl.encodeState({ input: inputEl.value, format: formatEl.value });
    if (token) {
      window.location.hash = 'state=' + token;
      statusBar.textContent = 'Shareable URL saved in address bar!';
      setTimeout(function () { statusBar.textContent = 'Ready'; }, 2000);
    }
  });

  if (window.location.hash && window.StateUrl) {
    window.StateUrl.decodeState(window.location.hash).then(function (data) {
      if (data) {
        if (data.input) inputEl.value = data.input;
        if (data.format) formatEl.value = data.format;
        encodeData();
      }
    });
  }
})();
