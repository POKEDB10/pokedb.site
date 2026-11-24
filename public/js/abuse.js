(function () {
  var form = document.getElementById('report-form');
  var statusBox = document.getElementById('status-box');
  var submitBtn = document.getElementById('submit-btn');
  var kindEl = document.getElementById('kind');
  var idEl = document.getElementById('id');
  var turnstileContainer = document.getElementById('abuse-turnstile-wrap');

  if (!form || !statusBox || !submitBtn) return;

  // Support prefill from ?kind=drop&id=... or legacy ?target=...
  var params = new URLSearchParams(window.location.search || '');
  var qKind = params.get('kind');
  var qId = params.get('id') || params.get('target');
  if (qKind && kindEl) {
    var lower = qKind.toLowerCase();
    if (lower === 'link' || lower === 'paste' || lower === 'drop') {
      kindEl.value = lower;
    }
  }
  if (qId && idEl) {
    idEl.value = qId;
  }

  if (window.PokedbTurnstile && turnstileContainer) {
    window.PokedbTurnstile.mount('#abuse-turnstile-wrap');
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    statusBox.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    var idVal = (idEl ? idEl.value : '').trim();
    if (idVal.indexOf('d/') === 0) idVal = idVal.slice(2);
    if (idVal.indexOf('p/') === 0) idVal = idVal.slice(2);
    if (idVal.indexOf('/') !== -1) idVal = idVal.split('/').pop();

    var payload = {
      kind: kindEl ? kindEl.value : 'link',
      id: idVal,
      reason: document.getElementById('reason').value,
      details: document.getElementById('details').value
    };

    if (window.PokedbTurnstile) {
      var token = await window.PokedbTurnstile.getToken('#abuse-turnstile-wrap');
      if (token) {
        payload['cf-turnstile-response'] = token;
      }
    }

    try {
      var res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (res.ok && data.success) {
        statusBox.className = 'status-msg success';
        statusBox.textContent = data.quarantined
          ? 'Report recorded. The content has been automatically quarantined (HTTP 451).'
          : 'Thank you. Your report has been recorded and submitted for automated triage.';
        statusBox.style.display = 'block';
        form.reset();
        if (window.PokedbTurnstile) window.PokedbTurnstile.reset('#abuse-turnstile-wrap');
      } else {
        statusBox.className = 'status-msg error';
        statusBox.textContent = data.message || data.error || 'Failed to submit report.';
        statusBox.style.display = 'block';
        if (window.PokedbTurnstile) window.PokedbTurnstile.reset('#abuse-turnstile-wrap');
      }
    } catch (_) {
      statusBox.className = 'status-msg error';
      statusBox.textContent = 'Network error submitting report.';
      statusBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '$ submit --report';
    }
  });
})();
