(function () {
  'use strict';
  var history = [];
  var maxHistory = 20;
  var refreshButton = document.getElementById('refresh-btn');
  var pollTimer;

  function setText(id, value) {
    var element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function setStatus(isHealthy) {
    var badge = document.getElementById('system-badge');
    badge.style.color = isHealthy ? 'var(--success)' : 'var(--danger)';
    badge.style.borderColor = isHealthy ? 'color-mix(in srgb,var(--success) 45%,transparent)' : 'color-mix(in srgb,var(--danger) 45%,transparent)';
    setText('system-status-title', isHealthy ? 'All systems operational' : 'Telemetry unavailable');
  }

  function renderHistory() {
    var chart = document.getElementById('ping-chart');
    chart.replaceChildren();
    if (!history.length) return;
    var values = history.map(function (point) { return point.ms; });
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var average = Math.round(values.reduce(function (sum, value) { return sum + value; }, 0) / values.length);
    setText('latency-summary', 'Min ' + min + 'ms · Avg ' + average + 'ms · Max ' + max + 'ms');
    history.forEach(function (point) {
      var bar = document.createElement('span');
      bar.className = 'bar';
      bar.style.height = Math.max(9, Math.round((point.ms / Math.max(max, 80)) * 100)) + '%';
      if (point.error) bar.style.background = 'var(--danger)';
      else if (point.ms > 400) bar.style.background = '#f2b84b';
      bar.title = point.error ? 'Request failed' : point.ms + ' ms';
      chart.appendChild(bar);
    });
  }

  function renderServices(services) {
    var labels = { api: 'Core API gateway', database: 'Persistence layer', tinyurl: 'TinyURL link engine', qr: 'QR code studio', drop: 'Drop storage gateway' };
    var container = document.getElementById('service-list');
    container.replaceChildren();
    Object.keys(labels).forEach(function (key) {
      var row = document.createElement('div');
      row.className = 'service';
      var details = document.createElement('div');
      var name = document.createElement('span');
      name.className = 'service-name';
      name.textContent = labels[key];
      var path = document.createElement('span');
      path.className = 'service-path';
      path.textContent = services[key] || 'checking';
      details.append(name, path);
      var state = document.createElement('span');
      state.className = 'service-state';
      state.textContent = services[key] === 'operational' || services[key] === 'redis_active' || services[key] === 'file_fallback' ? '● online' : '● checking';
      row.append(details, state);
      container.appendChild(row);
    });
  }

  async function fetchTelemetry() {
    var startedAt = performance.now();
    refreshButton.disabled = true;
    try {
      var response = await fetch('/api/health', { cache: 'no-store' });
      var latency = Math.round(performance.now() - startedAt);
      if (!response.ok) throw new Error('Health endpoint returned ' + response.status);
      var data = await response.json();
      history.push({ ms: latency });
      if (history.length > maxHistory) history.shift();
      setStatus(true);
      setText('metric-ping', latency + ' ms');
      setText('metric-ping-detail', latency < 400 ? 'Responsive API response' : 'Response above normal range');
      setText('metric-uptime', data.uptimeFormatted || data.uptimeSeconds + 's');
      setText('metric-memory', data.memoryUsageMB + ' MB');
      setText('metric-store', data.storeMode || 'Online');
      setText('metric-records', (data.recordsCount || 0) + ' active records');
      renderHistory();
      renderServices(data.services || {});
      setText('health-last-updated', 'Updated ' + new Date().toLocaleTimeString());
    } catch (error) {
      history.push({ ms: 800, error: true });
      if (history.length > maxHistory) history.shift();
      setStatus(false);
      setText('metric-ping', 'offline');
      setText('metric-ping-detail', 'Could not reach the health endpoint');
      renderHistory();
      setText('health-last-updated', 'Last check failed');
    } finally {
      refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener('click', fetchTelemetry);
  document.querySelectorAll('[data-copy]').forEach(function (button) {
    button.addEventListener('click', function () {
      var value = document.getElementById(button.getAttribute('data-copy')).textContent;
      navigator.clipboard.writeText(window.location.origin + value).then(function () {
        var label = button.textContent;
        button.textContent = 'Copied';
        window.setTimeout(function () { button.textContent = label; }, 1500);
      });
    });
  });
  fetchTelemetry();
  pollTimer = window.setInterval(fetchTelemetry, 5000);
  window.addEventListener('pagehide', function () { window.clearInterval(pollTimer); }, { once: true });
}());
