(function () {
  function sanitizeText(raw) {
    var text = raw;
    var ipCount = 0, emailCount = 0, tokenCount = 0, pathCount = 0;

    text = text.replace(/Bearer\s+[A-Za-z0-9_\-\.]{15,}/gi, function () {
      tokenCount++;
      return 'Bearer [TOKEN_REDACTED]';
    });
    text = text.replace(/ey[A-Za-z0-9_\-]{15,}\.[A-Za-z0-9_\-]{15,}\.[A-Za-z0-9_\-]{15,}/g, function () {
      tokenCount++;
      return '[JWT_REDACTED]';
    });
    text = text.replace(/ghp_[A-Za-z0-9]{30,}/g, function () {
      tokenCount++;
      return '[GITHUB_TOKEN_REDACTED]';
    });
    text = text.replace(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g, function () {
      emailCount++;
      return '[EMAIL_REDACTED]';
    });
    text = text.replace(/\b(?!127\.0\.0\.1)(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g, function () {
      ipCount++;
      return '[IP_REDACTED]';
    });
    text = text.replace(/(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}/g, function () {
      ipCount++;
      return '[IPV6_REDACTED]';
    });
    text = text.replace(/(\/home\/|\/Users\/)[a-zA-Z0-9_-]+/gi, function (m, p1) {
      pathCount++;
      return p1 + '[USER]';
    });
    text = text.replace(/(C:\\Users\\)[a-zA-Z0-9_-]+/gi, function (m, p1) {
      pathCount++;
      return p1 + '[USER]';
    });

    return { text: text, ipCount: ipCount, emailCount: emailCount, tokenCount: tokenCount, pathCount: pathCount };
  }

  function runSanitize() {
    var raw = document.getElementById('raw-input').value;
    var res = sanitizeText(raw);
    document.getElementById('sanitized-output').value = res.text;
    document.getElementById('stat-ips').textContent = 'IPs Redacted: ' + res.ipCount;
    document.getElementById('stat-emails').textContent = 'Emails Redacted: ' + res.emailCount;
    document.getElementById('stat-tokens').textContent = 'Tokens/Keys Redacted: ' + res.tokenCount;
    document.getElementById('stat-paths').textContent = 'Paths Redacted: ' + res.pathCount;
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

  document.getElementById('btn-sanitize').addEventListener('click', runSanitize);
  document.getElementById('raw-input').addEventListener('input', runSanitize);

  document.getElementById('btn-copy').addEventListener('click', function () {
    var text = document.getElementById('sanitized-output').value;
    if (!text) return;
    var btn = document.getElementById('btn-copy');
    copyWithFallback(text, function () {
      btn.textContent = 'Copied!';
      setTimeout(function () { btn.textContent = 'Copy Sanitized'; }, 1500);
    });
  });

  document.getElementById('btn-clear').addEventListener('click', function () {
    document.getElementById('raw-input').value = '';
    document.getElementById('sanitized-output').value = '';
    runSanitize();
    window.location.hash = '';
  });

  document.getElementById('btn-sample').addEventListener('click', function () {
    document.getElementById('raw-input').value =
      '[2026-11-09T14:22:01.120Z] INFO (worker-1): User admin (ops@enterprise.corp) authenticated via Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMzA5In0.secret\n' +
      '[2026-11-09T14:22:01.125Z] WARN: Connection from 198.51.100.42 to internal node /home/chaitanya/server/data failed.\n' +
      '[2026-11-09T14:22:01.130Z] ERROR: File error in C:\\Users\\Administrator\\AppData\\Local\\Temp\\pokedb.sqlite';
    runSanitize();
  });

  document.getElementById('btn-share').addEventListener('click', async function () {
    var val = document.getElementById('raw-input').value.trim();
    if (!val || !window.StateUrl) return;
    var token = await window.StateUrl.encodeState({ log: val });
    if (token) {
      window.location.hash = 'state=' + token;
    }
  });

  if (window.location.hash && window.StateUrl) {
    window.StateUrl.decodeState(window.location.hash).then(function (data) {
      if (data && data.log) {
        document.getElementById('raw-input').value = data.log;
        runSanitize();
      }
    });
  }
})();
