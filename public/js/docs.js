(function () {
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

  document.querySelectorAll('.code-copy-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var codeEl = btn.nextElementSibling && btn.nextElementSibling.querySelector('code');
      if (!codeEl) return;
      var orig = btn.textContent;
      copyWithFallback(codeEl.textContent, function () {
        btn.textContent = 'Copied!';
        setTimeout(function () { btn.textContent = orig; }, 1500);
      });
    });
  });
})();
