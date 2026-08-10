(function () {
  'use strict';

  function getPasteCode() {
    var path = window.location.pathname;
    var match = path.match(/\/p\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : '';
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  var code = getPasteCode();
  if (!code) {
    document.getElementById('paste-title').textContent = 'Invalid Paste URL';
    return;
  }

  var rawBtn = document.getElementById('raw-btn');
  rawBtn.href = '/raw/' + code;

  async function loadPaste(password) {
    try {
      var res = await fetch('/api/paste/view/' + code, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password || '' })
      });
      var data = await res.json();

      if (res.status === 401) {
        document.getElementById('pass-auth-box').style.display = 'block';
        document.getElementById('paste-body-box').style.display = 'none';
        document.getElementById('paste-title').textContent = 'Password Required';
        return;
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load paste.');
      }

      var paste = data.paste;
      document.getElementById('pass-auth-box').style.display = 'none';
      document.getElementById('paste-title').textContent = paste.title || 'Untitled Paste';
      document.getElementById('paste-lang').textContent = paste.language || 'plaintext';
      document.getElementById('paste-size').textContent = (paste.size || 0) + ' bytes';
      document.getElementById('paste-views').textContent = (paste.views || 1) + ' views';

      if (paste.burnOnRead) {
        document.getElementById('paste-burn-status').textContent = '🔥 Burned on Read (This paste was deleted)';
        document.getElementById('paste-burn-status').style.color = 'var(--danger, #ef4444)';
      }

      var codeBox = document.getElementById('paste-body-box');
      codeBox.innerHTML = escapeHtml(paste.content);
      codeBox.style.display = 'block';

      document.getElementById('copy-btn').addEventListener('click', function () {
        navigator.clipboard.writeText(paste.content);
        if (window.showToast) window.showToast('Paste text copied to clipboard!');
      });
    } catch (err) {
      document.getElementById('paste-title').textContent = 'Paste Expired or Not Found';
      document.getElementById('paste-body-box').textContent = err.message;
      document.getElementById('paste-body-box').style.display = 'block';
    }
  }

  document.getElementById('pass-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var pass = document.getElementById('pass-input').value;
    loadPaste(pass);
  });

  document.getElementById('qr-btn').addEventListener('click', function () {
    var modal = document.getElementById('qr-modal');
    var wrap = document.getElementById('qr-svg-wrap');
    if (window.QRCodeLib) {
      wrap.innerHTML = window.QRCodeLib.generateSVG(window.location.href, { dark: '#000000', light: '#ffffff' });
    }
    modal.style.display = 'grid';
  });

  document.getElementById('close-qr-btn').addEventListener('click', function () {
    document.getElementById('qr-modal').style.display = 'none';
  });

  loadPaste();
})();
