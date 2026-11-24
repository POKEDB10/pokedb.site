(function () {
  var sparkline = document.getElementById('sparkline');
  if (sparkline) {
    for (var i = 0; i < 30; i++) {
      var bar = document.createElement('div');
      bar.className = 'spark-bar';
      var h = 15 + Math.floor(Math.random() * 25);
      bar.style.height = h + 'px';
      sparkline.appendChild(bar);
    }
  }

  async function pingHealth() {
    var p50 = document.getElementById('current-p50');
    var checkTime = document.getElementById('check-time');
    try {
      var start = performance.now();
      var res = await fetch('/api/health/ping');
      var duration = (performance.now() - start).toFixed(1);
      if (p50) p50.textContent = res.ok ? ('Live RTT: ' + duration + ' ms') : ('Status: HTTP ' + res.status);
      if (checkTime) checkTime.textContent = 'Checked at ' + new Date().toLocaleTimeString();
    } catch (_) {
      if (p50) p50.textContent = 'Health probe offline';
    }
  }

  pingHealth();
  setInterval(pingHealth, 15000);
})();
