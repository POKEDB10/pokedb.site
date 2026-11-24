(function () {
  var MC_COLORS = {
    '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
    '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
    '8': '#555555', '9': '#5555FF', 'a': '#55FF55', 'b': '#55FFFF',
    'c': '#FF5555', 'd': '#FF55FF', 'e': '#FFFF55', 'f': '#FFFFFF'
  };

  function updateJvmFlags() {
    var ram = document.getElementById('mc-memory').value;
    var jar = document.getElementById('mc-jar').value || 'server.jar';
    var gb = parseInt(ram, 10);

    var newSize = '30', maxNewSize = '40', ihop = '15', reserve = '20';
    if (gb >= 12) {
      newSize = '40'; maxNewSize = '50'; ihop = '20'; reserve = '15';
    }

    var flags = 'java -Xms' + ram + ' -Xmx' + ram +
      ' -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200' +
      ' -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch' +
      ' -XX:G1NewSizePercent=' + newSize + ' -XX:G1MaxNewSizePercent=' + maxNewSize +
      ' -XX:G1ReservePercent=' + reserve + ' -XX:G1HeapWastePercent=5' +
      ' -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=' + ihop +
      ' -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5' +
      ' -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1' +
      ' -Dusing.aikars.flags=https://mcflags.emc.gs -Daikars.new.flags=true -jar ' + jar + ' nogui';

    document.getElementById('jvm-output').value = flags;
  }

  function renderMotd() {
    var raw = document.getElementById('motd-input').value;
    var preview = document.getElementById('motd-preview');
    preview.textContent = '';

    var currentColor = '#FFFFFF';
    var isBold = false;
    var isItalic = false;
    var buffer = '';

    function flush() {
      if (!buffer) return;
      var span = document.createElement('span');
      span.style.color = currentColor;
      if (isBold) span.style.fontWeight = 'bold';
      if (isItalic) span.style.fontStyle = 'italic';
      span.textContent = buffer;
      preview.appendChild(span);
      buffer = '';
    }

    for (var i = 0; i < raw.length; i++) {
      if ((raw[i] === '&' || raw[i] === '§') && i + 1 < raw.length) {
        var code = raw[i + 1].toLowerCase();
        if (MC_COLORS[code]) {
          flush();
          currentColor = MC_COLORS[code];
          i++;
          continue;
        } else if (code === 'l') {
          flush(); isBold = true; i++; continue;
        } else if (code === 'o') {
          flush(); isItalic = true; i++; continue;
        } else if (code === 'r') {
          flush(); currentColor = '#FFFFFF'; isBold = false; isItalic = false; i++; continue;
        }
      }
      buffer += raw[i];
    }
    flush();
  }

  function updateSrv() {
    var domain = document.getElementById('srv-domain').value.trim() || 'play.example.com';
    var target = document.getElementById('srv-target').value.trim() || 'node01.example.com';
    var port = document.getElementById('srv-port').value.trim() || '25565';
    var sub = domain.split('.')[0];

    document.getElementById('srv-output').value =
      '_minecraft._tcp.' + domain + '. 3600 IN SRV 0 5 ' + port + ' ' + target + '.\n' +
      'Cloudflare UI: Service: _minecraft | Protocol: TCP | Name: ' + sub + ' | Priority: 0 | Weight: 5 | Port: ' + port + ' | Target: ' + target;
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

  document.querySelectorAll('[data-copy-id]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-copy-id');
      var el = document.getElementById(id);
      if (!el || !el.value) return;
      var orig = btn.textContent;
      copyWithFallback(el.value, function () {
        btn.textContent = 'Copied!';
        setTimeout(function () { btn.textContent = orig; }, 1400);
      });
    });
  });

  document.getElementById('mc-memory').addEventListener('change', updateJvmFlags);
  document.getElementById('mc-jar').addEventListener('input', updateJvmFlags);
  document.getElementById('motd-input').addEventListener('input', renderMotd);
  document.getElementById('srv-domain').addEventListener('input', updateSrv);
  document.getElementById('srv-target').addEventListener('input', updateSrv);
  document.getElementById('srv-port').addEventListener('input', updateSrv);

  updateJvmFlags();
  renderMotd();
  updateSrv();
})();
