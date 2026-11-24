(function () {
  var inputEl = document.getElementById('jwt-input');
  var secretEl = document.getElementById('jwt-secret');
  var headerEl = document.getElementById('jwt-header');
  var payloadEl = document.getElementById('jwt-payload');
  var expiryEl = document.getElementById('jwt-expiry');
  var verifyStatus = document.getElementById('verify-status');

  function b64Decode(str) {
    var output = str.replace(/-/g, '+').replace(/_/g, '/');
    while (output.length % 4 !== 0) output += '=';
    return decodeURIComponent(escape(atob(output)));
  }

  function parseJwt() {
    var raw = inputEl.value.trim();
    if (!raw) {
      headerEl.textContent = '{}';
      payloadEl.textContent = '{}';
      expiryEl.textContent = 'No token parsed';
      expiryEl.style.color = 'var(--muted)';
      verifyStatus.textContent = 'Status: Unverified';
      verifyStatus.style.color = 'var(--muted)';
      return;
    }

    var parts = raw.split('.');
    if (parts.length < 2) {
      expiryEl.textContent = 'Invalid JWT: expected 3 dot-separated segments';
      expiryEl.style.color = 'var(--danger)';
      return;
    }

    try {
      var headerObj = JSON.parse(b64Decode(parts[0]));
      headerEl.textContent = JSON.stringify(headerObj, null, 2);
    } catch (e) {
      headerEl.textContent = 'Error decoding header: ' + e.message;
    }

    try {
      var payloadObj = JSON.parse(b64Decode(parts[1]));
      payloadEl.textContent = JSON.stringify(payloadObj, null, 2);

      if (payloadObj.exp) {
        var expDate = new Date(payloadObj.exp * 1000);
        var now = new Date();
        var diffMs = expDate.getTime() - now.getTime();
        var isExpired = diffMs <= 0;
        var diffMins = Math.abs(Math.round(diffMs / 60000));
        expiryEl.textContent = '';
        var line1 = document.createTextNode('Expires: ' + expDate.toISOString());
        var br = document.createElement('br');
        var strong = document.createElement('strong');
        strong.style.color = isExpired ? 'var(--danger)' : 'var(--success)';
        strong.textContent = isExpired
          ? 'Expired ' + diffMins + ' minute(s) ago'
          : 'Valid for next ' + diffMins + ' minute(s)';
        expiryEl.appendChild(line1);
        expiryEl.appendChild(br);
        expiryEl.appendChild(strong);
      } else {
        expiryEl.textContent = 'No "exp" expiration claim specified (Token never expires)';
        expiryEl.style.color = 'var(--text)';
      }
    } catch (e) {
      payloadEl.textContent = 'Error decoding payload: ' + e.message;
    }
  }

  async function verifySignature() {
    var raw = inputEl.value.trim();
    var secret = secretEl.value;
    var parts = raw.split('.');
    if (parts.length !== 3) {
      verifyStatus.textContent = 'Token must have 3 segments to verify signature';
      verifyStatus.style.color = 'var(--danger)';
      return;
    }
    if (!secret) {
      verifyStatus.textContent = 'Enter HMAC secret to verify signature';
      verifyStatus.style.color = 'var(--muted)';
      return;
    }

    try {
      var enc = new TextEncoder();
      var keyData = enc.encode(secret);
      var cryptoKey = await crypto.subtle.importKey(
        'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
      );

      var dataToVerify = enc.encode(parts[0] + '.' + parts[1]);
      var sigBase64 = parts[2].replace(/-/g, '+').replace(/_/g, '/');
      while (sigBase64.length % 4 !== 0) sigBase64 += '=';
      var sigBin = atob(sigBase64);
      var sigBytes = new Uint8Array(sigBin.length);
      for (var i = 0; i < sigBin.length; i++) sigBytes[i] = sigBin.charCodeAt(i);

      var isValid = await crypto.subtle.verify('HMAC', cryptoKey, sigBytes, dataToVerify);
      if (isValid) {
        verifyStatus.textContent = '✓ Signature Verified via WebCrypto HMAC SHA-256';
        verifyStatus.style.color = 'var(--success)';
      } else {
        verifyStatus.textContent = '✗ Invalid Signature (Secret mismatch)';
        verifyStatus.style.color = 'var(--danger)';
      }
    } catch (err) {
      verifyStatus.textContent = 'Verification error: ' + err.message;
      verifyStatus.style.color = 'var(--danger)';
    }
  }

  document.getElementById('btn-sample').addEventListener('click', function () {
    inputEl.value = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkNoYWl0YW55YSIsImFkbWluIjp0cnVlLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MjAwMDAwMDAwMH0.tXm_g97p1e93t6zM2x4q8y0w1v7u5s3r9p8q7v6u5s4';
    secretEl.value = 'pokedb-secret-key';
    parseJwt();
  });

  document.getElementById('btn-clear').addEventListener('click', function () {
    inputEl.value = '';
    secretEl.value = '';
    parseJwt();
    window.location.hash = '';
  });

  document.getElementById('btn-verify').addEventListener('click', verifySignature);
  inputEl.addEventListener('input', parseJwt);

  document.getElementById('btn-share').addEventListener('click', async function () {
    if (!inputEl.value || !window.StateUrl) return;
    var token = await window.StateUrl.encodeState({ jwt: inputEl.value.trim() });
    if (token) {
      window.location.hash = 'state=' + token;
      verifyStatus.textContent = 'Shareable URL saved in address bar!';
      setTimeout(function () { verifyStatus.textContent = 'Status: Unverified'; }, 2000);
    }
  });

  if (window.location.hash && window.StateUrl) {
    window.StateUrl.decodeState(window.location.hash).then(function (data) {
      if (data && data.jwt) {
        inputEl.value = data.jwt;
        parseJwt();
      }
    });
  }
})();
