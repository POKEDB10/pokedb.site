(function () {
  var CROCKFORD_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

  function generateUuidV7() {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    var now = Date.now();
    bytes[0] = (now / 0x10000000000) & 0xff;
    bytes[1] = (now / 0x100000000) & 0xff;
    bytes[2] = (now / 0x1000000) & 0xff;
    bytes[3] = (now / 0x10000) & 0xff;
    bytes[4] = (now / 0x100) & 0xff;
    bytes[5] = now & 0xff;
    bytes[6] = 0x70 | (bytes[6] & 0x0f);
    bytes[8] = 0x80 | (bytes[8] & 0x3f);

    var hex = Array.from(bytes).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function generateUlid() {
    var now = Date.now();
    var timeStr = '';
    var timeVal = now;
    for (var i = 9; i >= 0; i--) {
      timeStr = CROCKFORD_CHARS[timeVal % 32] + timeStr;
      timeVal = Math.floor(timeVal / 32);
    }
    var randBytes = new Uint8Array(10);
    crypto.getRandomValues(randBytes);
    var randStr = '';
    for (var j = 0; j < 16; j++) {
      var idx = (randBytes[j % 10] + j * 3) % 32;
      randStr += CROCKFORD_CHARS[idx];
    }
    return timeStr + randStr;
  }

  function generate() {
    var type = document.getElementById('type-select').value;
    var count = parseInt(document.getElementById('count-select').value, 10) || 1;
    var results = [];

    for (var i = 0; i < count; i++) {
      if (type === 'v4') results.push(crypto.randomUUID());
      else if (type === 'v7') results.push(generateUuidV7());
      else if (type === 'ulid') results.push(generateUlid());
    }

    document.getElementById('output-box').value = results.join('\n');
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

  document.getElementById('btn-generate').addEventListener('click', generate);

  document.getElementById('btn-copy').addEventListener('click', function () {
    var text = document.getElementById('output-box').value;
    if (!text) return;
    var btn = document.getElementById('btn-copy');
    copyWithFallback(text, function () {
      btn.textContent = 'Copied!';
      setTimeout(function () { btn.textContent = 'Copy All'; }, 1500);
    });
  });

  document.getElementById('btn-inspect').addEventListener('click', function () {
    var raw = document.getElementById('inspect-input').value.trim();
    var resEl = document.getElementById('inspect-result');
    if (!raw) {
      resEl.textContent = 'Please enter an identifier';
      return;
    }

    var uuidMatch = raw.match(/^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i);
    if (uuidMatch) {
      var version = parseInt(uuidMatch[3].charAt(0), 16);
      var extra = '';
      if (version === 7) {
        var highHex = uuidMatch[1] + uuidMatch[2];
        var timeMs = parseInt(highHex, 16);
        extra = '\nTimestamp: ' + new Date(timeMs).toISOString() + ' (' + timeMs + ' ms)';
      }
      resEl.textContent = 'Type: UUID\nVersion: v' + version + '\nStandard: RFC 4122 / RFC 9562' + extra;
      return;
    }

    if (raw.length === 26 && /^[0-9A-HJKMNP-TV-Z]+$/i.test(raw)) {
      var timePart = raw.slice(0, 10).toUpperCase();
      var timeVal = 0;
      for (var i = 0; i < timePart.length; i++) {
        timeVal = timeVal * 32 + CROCKFORD_CHARS.indexOf(timePart[i]);
      }
      resEl.textContent = 'Type: ULID (Crockford\'s Base32)\nTimestamp: ' + new Date(timeVal).toISOString() + ' (' + timeVal + ' ms)\nRandomness entropy: 80 bits';
      return;
    }

    resEl.textContent = 'Unrecognized identifier format. Expected 36-char UUID or 26-char ULID.';
  });

  generate();
})();
