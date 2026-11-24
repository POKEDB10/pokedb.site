(function () {
  function bufToHex(buffer) {
    var bytes = new Uint8Array(buffer);
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  async function computeHashes(bytes) {
    try {
      var digests = await Promise.all([
        crypto.subtle.digest('SHA-256', bytes),
        crypto.subtle.digest('SHA-512', bytes),
        crypto.subtle.digest('SHA-384', bytes),
        crypto.subtle.digest('SHA-1', bytes)
      ]);
      document.getElementById('hash-sha256').value = bufToHex(digests[0]);
      document.getElementById('hash-sha512').value = bufToHex(digests[1]);
      document.getElementById('hash-sha384').value = bufToHex(digests[2]);
      document.getElementById('hash-sha1').value = bufToHex(digests[3]);
    } catch (err) {
      console.error('Hashing error:', err);
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

  document.querySelectorAll('[data-copy-target]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var targetId = btn.getAttribute('data-copy-target');
      var el = document.getElementById(targetId);
      if (!el || !el.value) return;
      var orig = btn.textContent;
      copyWithFallback(el.value, function () {
        btn.textContent = 'Copied!';
        setTimeout(function () { btn.textContent = orig; }, 1400);
      });
    });
  });

  var textInput = document.getElementById('text-input');
  textInput.addEventListener('input', function () {
    var text = textInput.value;
    if (!text) {
      document.getElementById('hash-sha256').value = '';
      document.getElementById('hash-sha512').value = '';
      document.getElementById('hash-sha384').value = '';
      document.getElementById('hash-sha1').value = '';
      return;
    }
    computeHashes(new TextEncoder().encode(text));
  });

  var dropZone = document.getElementById('drop-zone');
  var fileInput = document.getElementById('file-input');

  async function handleFile(file) {
    dropZone.querySelector('p').textContent = 'Processing ' + file.name + ' (' + (file.size / 1024 / 1024).toFixed(2) + ' MB)...';
    var buffer = await file.arrayBuffer();
    await computeHashes(buffer);
    dropZone.querySelector('p').textContent = 'Computed hashes for ' + file.name;
  }

  dropZone.addEventListener('click', function () { fileInput.click(); });
  dropZone.addEventListener('dragover', function (e) { e.preventDefault(); dropZone.style.borderColor = 'var(--accent)'; });
  dropZone.addEventListener('dragleave', function () { dropZone.style.borderColor = 'var(--border)'; });
  dropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--border)';
    if (e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', function () {
    if (fileInput.files.length > 0) {
      handleFile(fileInput.files[0]);
    }
  });

  document.getElementById('btn-compare').addEventListener('click', function () {
    var expected = document.getElementById('verify-input').value.trim().toLowerCase();
    var matchStatus = document.getElementById('match-status');
    if (!expected) {
      matchStatus.textContent = 'Please enter an expected hash to compare';
      matchStatus.style.color = 'var(--muted)';
      return;
    }
    var hashes = [
      document.getElementById('hash-sha256').value.toLowerCase(),
      document.getElementById('hash-sha512').value.toLowerCase(),
      document.getElementById('hash-sha384').value.toLowerCase(),
      document.getElementById('hash-sha1').value.toLowerCase()
    ];
    if (hashes.indexOf(expected) !== -1) {
      matchStatus.textContent = '✓ Checksum MATCHES calculated hash!';
      matchStatus.style.color = 'var(--success)';
    } else {
      matchStatus.textContent = '✗ Checksum does NOT match any computed hash.';
      matchStatus.style.color = 'var(--danger)';
    }
  });
})();
