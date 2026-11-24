(function () {
  var inputEl = document.getElementById('json-input');
  var outputEl = document.getElementById('json-output');
  var inputStats = document.getElementById('input-stats');
  var outputStats = document.getElementById('output-stats');
  var ariaStatus = document.getElementById('aria-status');

  function announce(msg) {
    if (ariaStatus) ariaStatus.textContent = msg;
  }

  function updateInputStats() {
    var text = inputEl.value;
    var bytes = new Blob([text]).size;
    var lines = text ? text.split('\n').length : 0;
    inputStats.textContent = 'Bytes: ' + bytes.toLocaleString() + ' | Lines: ' + lines.toLocaleString();
  }

  function formatJson(indent) {
    var text = inputEl.value.trim();
    if (!text) {
      outputEl.value = '';
      outputStats.textContent = 'Status: Empty';
      outputStats.style.color = 'var(--muted)';
      return;
    }
    try {
      var parsed = JSON.parse(text);
      outputEl.value = JSON.stringify(parsed, null, indent);
      outputStats.textContent = 'Status: Valid JSON | Formatted (' + (indent === 0 ? 'minified' : indent + ' spaces') + ')';
      outputStats.style.color = 'var(--success)';
      announce('JSON successfully formatted');
    } catch (err) {
      outputEl.value = '';
      outputStats.textContent = 'Error: ' + err.message;
      outputStats.style.color = 'var(--danger)';
      announce('JSON syntax error: ' + err.message);
    }
  }

  function copyWithFallback(text, onDone) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onDone).catch(function () {
        fallbackCopy(text, onDone);
      });
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
    try {
      document.execCommand('copy');
      if (onDone) onDone();
    } catch (_) {
      announce('Failed to copy to clipboard');
    }
    document.body.removeChild(ta);
  }

  document.getElementById('btn-format').addEventListener('click', function () { formatJson(2); });
  document.getElementById('btn-format-4').addEventListener('click', function () { formatJson(4); });
  document.getElementById('btn-minify').addEventListener('click', function () { formatJson(0); });

  document.getElementById('btn-copy').addEventListener('click', function () {
    if (!outputEl.value) return;
    copyWithFallback(outputEl.value, function () {
      announce('Formatted JSON copied to clipboard');
      var orig = outputStats.textContent;
      outputStats.textContent = 'Copied to clipboard!';
      setTimeout(function () { outputStats.textContent = orig; }, 2000);
    });
  });

  document.getElementById('btn-clear').addEventListener('click', function () {
    inputEl.value = '';
    outputEl.value = '';
    updateInputStats();
    outputStats.textContent = 'Status: Ready';
    outputStats.style.color = 'var(--muted)';
    window.location.hash = '';
  });

  document.getElementById('btn-share').addEventListener('click', async function () {
    var val = inputEl.value.trim();
    if (!val || !window.StateUrl) return;
    var token = await window.StateUrl.encodeState({ input: val });
    if (token) {
      window.location.hash = 'state=' + token;
      announce('State saved to URL hash');
      outputStats.textContent = 'Shareable URL saved in address bar!';
      setTimeout(function () { outputStats.textContent = 'Status: Ready'; }, 2500);
    }
  });

  inputEl.addEventListener('input', updateInputStats);

  if (window.location.hash && window.StateUrl) {
    window.StateUrl.decodeState(window.location.hash).then(function (data) {
      if (data && data.input) {
        inputEl.value = data.input;
        updateInputStats();
        formatJson(2);
      }
    });
  }
})();
