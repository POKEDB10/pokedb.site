(function () {
  'use strict';

  function byId(id) { return document.getElementById(id); }

  var pathParts = window.location.pathname.split('/').filter(Boolean);
  var sessionId = pathParts[pathParts.length - 1] || 'upload';
  if (sessionId === 'upload.html') sessionId = 'session';

  byId('session-id-display').textContent = sessionId;

  var sessionKey = 'pokedb-upload-' + sessionId;
  var sessionData = null;
  try {
    var raw = localStorage.getItem(sessionKey);
    if (raw) sessionData = JSON.parse(raw);
  } catch (_) {}

  var currentFile = null;
  var isPaused = false;
  var isCancelled = false;
  var activeController = null;
  var activeChunkXhrs = [];
  var activeDropSession = null;

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
  }

  function formatEta(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '--:--';
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function updateProgressUI(pct, speedBps, current, total) {
    var cappedCurrent = Math.min(current, total);
    var cappedPct = total > 0 ? Math.min(100, Math.max(0, (cappedCurrent / total) * 100)) : 0;
    byId('progress-bar-fill').style.width = cappedPct + '%';
    byId('stat-percent').textContent = Math.round(cappedPct) + '%';
    byId('stat-speed').textContent = window.PokeDbUtils && window.PokeDbUtils.formatSpeedAuto
      ? window.PokeDbUtils.formatSpeedAuto(speedBps)
      : formatBytes(speedBps) + '/s';
    byId('stat-bytes').textContent = formatBytes(cappedCurrent) + ' / ' + formatBytes(total);
    var eta = speedBps > 0 ? (total - cappedCurrent) / speedBps : 0;
    byId('stat-eta').textContent = formatEta(eta);
  }

  function markCompleted(viewerUrl) {
    byId('progress-bar-fill').style.width = '100%';
    byId('stat-percent').textContent = '100%';
    byId('stat-speed').textContent = 'Done';
    byId('stat-eta').textContent = 'Done';
    byId('up-status-text').textContent = 'Upload completed';
    byId('controls-row').style.display = 'none';
    byId('reselect-box').style.display = 'none';
    byId('upload-complete-card').style.display = 'block';
    byId('up-share-url').value = viewerUrl;
    byId('up-open-btn').href = viewerUrl;
    try { localStorage.removeItem(sessionKey); } catch (_) {}
    if (window.PokeDbUtils && window.PokeDbUtils.deleteFileFromIndexedDb) {
      window.PokeDbUtils.deleteFileFromIndexedDb(sessionId);
    }
  }

  function abortInflight(sendServerAbort) {
    if (activeController) activeController.abort();
    activeChunkXhrs.forEach(function (xhr) { try { xhr.abort(); } catch (_) {} });
    activeChunkXhrs = [];
    if (sendServerAbort && activeDropSession) {
      fetch('/api/drop/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeDropSession.id, deleteToken: activeDropSession.deleteToken }),
        keepalive: true
      }).catch(function () {});
      activeDropSession = null;
    }
  }

  async function runR2Upload(file) {
    currentFile = file;
    byId('up-file-name').textContent = file.name;
    byId('up-file-size').textContent = formatBytes(file.size);
    byId('up-status-text').textContent = activeDropSession ? 'Resuming upload…' : 'Initializing upload…';

    activeController = new AbortController();
    var signal = activeController.signal;

    try {
      var parts = [];
      var partSize;
      var id;
      var deleteToken;
      var completedMap;

      if (activeDropSession) {
        id = activeDropSession.id;
        deleteToken = activeDropSession.deleteToken;
        partSize = activeDropSession.partSize;
        completedMap = activeDropSession.completedMap;
        var resRes = await fetch('/api/drop/resume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, deleteToken: deleteToken }),
          signal: signal
        });
        if (resRes.ok) {
          var resData = await resRes.json();
          parts = resData.missingParts || [];
          partSize = resData.partSize || partSize;
        }
      }

      if (!id) {
        var initRes = await fetch('/api/drop/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, size: file.size, ttlHours: 24 }),
          signal: signal
        });
        if (!initRes.ok) {
          var errJson = await initRes.json().catch(function () { return {}; });
          throw new Error(errJson.error || 'Failed to initialize upload (' + initRes.status + ')');
        }
        var initData = await initRes.json();
        id = initData.code || initData.shortId || initData.id;
        deleteToken = initData.deleteToken;
        parts = initData.parts || [];
        partSize = initData.partSize;
        completedMap = new Map();
        activeDropSession = { id: id, deleteToken: deleteToken, partSize: partSize, completedMap: completedMap };
      }

      byId('up-status-text').textContent = 'Uploading to Cloudflare R2…';
      var loadedPerPart = {};
      completedMap.forEach(function (_, pNum) {
        var s = (pNum - 1) * partSize;
        var e = Math.min(s + partSize, file.size);
        loadedPerPart[pNum] = Math.max(0, e - s);
      });
      parts.forEach(function (p) { loadedPerPart[p.n] = 0; });

      var samples = [];
      var lastTick = 0;
      function emitProgress(force) {
        var now = Date.now();
        if (!force && now - lastTick < 80) return;
        lastTick = now;
        var totalDone = 0;
        for (var k in loadedPerPart) totalDone += loadedPerPart[k];
        totalDone = Math.min(totalDone, file.size);
        samples.push({ t: now, b: totalDone });
        while (samples.length > 2 && samples[0].t < now - 2500) samples.shift();
        var speed = 0;
        if (samples.length >= 2) {
          var dt = (samples[samples.length - 1].t - samples[0].t) / 1000;
          var db = samples[samples.length - 1].b - samples[0].b;
          if (dt > 0.05 && db >= 0) speed = db / dt;
        }
        var pct = file.size > 0 ? (totalDone / file.size) * 100 : 100;
        updateProgressUI(pct, speed, totalDone, file.size);
      }

      async function uploadPart(p) {
        var start = (p.n - 1) * partSize;
        var end = Math.min(start + partSize, file.size);
        var chunk = file.slice(start, end);
        for (var attempt = 0; attempt < 3; attempt++) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          try {
            var etag = await new Promise(function (resolve, reject) {
              var xhr = new XMLHttpRequest();
              activeChunkXhrs.push(xhr);
              xhr.timeout = 120000;
              xhr.open('PUT', p.url, true);
              xhr.upload.onprogress = function (e) {
                if (e.lengthComputable) {
                  loadedPerPart[p.n] = Math.min(e.loaded, chunk.size);
                  emitProgress(e.loaded >= chunk.size);
                }
              };
              function clean() {
                var idx = activeChunkXhrs.indexOf(xhr);
                if (idx > -1) activeChunkXhrs.splice(idx, 1);
              }
              xhr.onload = function () {
                clean();
                if (xhr.status >= 200 && xhr.status < 300) {
                  resolve((xhr.getResponseHeader('ETag') || '').replace(/"/g, ''));
                } else {
                  reject(new Error('Chunk upload failed HTTP ' + xhr.status));
                }
              };
              xhr.onerror = function () { clean(); reject(new Error('Network error during upload')); };
              xhr.ontimeout = function () { clean(); reject(new Error('Chunk timeout')); };
              xhr.onabort = function () { clean(); reject(new DOMException('Aborted', 'AbortError')); };
              signal.addEventListener('abort', function () { try { xhr.abort(); } catch (_) {} }, { once: true });
              xhr.send(chunk);
            });
            loadedPerPart[p.n] = chunk.size;
            completedMap.set(p.n, etag);
            emitProgress(true);
            return;
          } catch (err) {
            if (err.name === 'AbortError' || attempt === 2) throw err;
            await new Promise(function (r) { setTimeout(r, 800 * Math.pow(2, attempt)); });
          }
        }
      }

      if (parts.length) {
        var q = parts.slice();
        var concurrency = Math.min(parts.length, 4);
        var workers = [];
        for (var w = 0; w < concurrency; w++) {
          workers.push((async function () {
            while (q.length > 0) {
              if (signal.aborted) return;
              await uploadPart(q.shift());
            }
          })());
        }
        await Promise.all(workers);
      }

      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      byId('up-status-text').textContent = 'Finalizing upload…';
      var orderedParts = [];
      completedMap.forEach(function (etagVal, pNum) {
        orderedParts.push({ PartNumber: pNum, ETag: etagVal });
      });
      orderedParts.sort(function (a, b) { return a.PartNumber - b.PartNumber; });

      var compRes = await fetch('/api/drop/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id, deleteToken: deleteToken, parts: orderedParts }),
        signal: signal
      });
      if (!compRes.ok) throw new Error('Failed to complete upload');

      var compData = await compRes.json();
      activeDropSession = null;
      markCompleted(compData.viewUrl || (window.location.origin + '/v/' + id));
    } catch (err) {
      if (err.name !== 'AbortError' && !isCancelled && !isPaused) {
        byId('up-status-text').textContent = 'Upload error: ' + (err.message || 'interrupted');
      }
    } finally {
      activeController = null;
    }
  }

  function closeQrModal() {
    var m = byId('up-qr-modal');
    if (m) {
      m.classList.remove('is-open');
      m.style.display = 'none';
    }
  }

  function wireStaticListeners() {
    var copyBtn = byId('up-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var url = byId('up-share-url').value;
        var orig = copyBtn.textContent;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            copyBtn.textContent = 'Copied!';
            if (window.showToast) window.showToast('Link copied');
            setTimeout(function () { copyBtn.textContent = orig; }, 1500);
          }).catch(function () {});
        }
      });
    }

    if (byId('up-qr-btn')) {
      byId('up-qr-btn').addEventListener('click', function () {
        var box = byId('up-qr-box');
        box.replaceChildren();
        var shareUrl = byId('up-share-url').value || (window.location.origin + '/v/' + sessionId);
        var modal = byId('up-qr-modal');
        modal.style.display = 'grid';
        modal.classList.add('is-open');
        if (window.QRCode && typeof window.QRCode.toString === 'function') {
          window.QRCode.toString(shareUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }, function (err, svg) {
            if (!err && svg) {
              box.innerHTML = svg;
              var svgEl = box.querySelector('svg');
              if (svgEl) { svgEl.setAttribute('width', '200'); svgEl.setAttribute('height', '200'); }
              return;
            }
            var img = document.createElement('img');
            img.src = '/api/qr?format=png&text=' + encodeURIComponent(shareUrl);
            img.width = 200;
            img.height = 200;
            img.alt = 'QR Code';
            box.appendChild(img);
          });
          return;
        }
        try {
          if (window.QRCodeLib && typeof window.QRCodeLib.generateSVG === 'function') {
            box.innerHTML = window.QRCodeLib.generateSVG(shareUrl, { dark: '#000000', light: '#ffffff', margin: 1, ecLevel: 'M' });
            var svg = box.querySelector('svg');
            if (svg) { svg.setAttribute('width', '200'); svg.setAttribute('height', '200'); }
            return;
          }
        } catch (_) {}
        var img = document.createElement('img');
        img.src = '/api/qr?format=png&text=' + encodeURIComponent(shareUrl);
        img.width = 200;
        img.height = 200;
        img.alt = 'QR Code';
        box.appendChild(img);
      });
    }

    if (byId('up-close-qr-btn')) {
      byId('up-close-qr-btn').addEventListener('click', closeQrModal);
    }
    if (byId('up-qr-modal')) {
      byId('up-qr-modal').addEventListener('click', function (e) {
        if (e.target === byId('up-qr-modal')) closeQrModal();
      });
    }
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeQrModal();
    });

    var pauseBtn = byId('pause-btn');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', function () {
        if (!currentFile) return;
        if (!isPaused) {
          isPaused = true;
          abortInflight(false);
          pauseBtn.textContent = 'Resume Upload';
          byId('up-status-text').textContent = 'Paused';
        } else {
          isPaused = false;
          pauseBtn.textContent = 'Pause Upload';
          runR2Upload(currentFile);
        }
      });
    }

    var stopBtn = byId('stop-btn');
    if (stopBtn) {
      stopBtn.addEventListener('click', function () {
        isCancelled = true;
        abortInflight(true);
        byId('up-status-text').textContent = 'Cancelled';
        try { localStorage.removeItem(sessionKey); } catch (_) {}
        if (window.PokeDbUtils && window.PokeDbUtils.deleteFileFromIndexedDb) {
          window.PokeDbUtils.deleteFileFromIndexedDb(sessionId);
        }
      });
    }
  }

  async function init() {
    wireStaticListeners();
    try {
      var res = await fetch('/api/drop/info?id=' + encodeURIComponent(sessionId));
      if (res.ok) {
        var data = await res.json();
        var rec = data.result && data.result[0];
        if (rec && rec.id) {
          byId('up-file-name').textContent = rec.name || 'Uploaded File';
          byId('up-file-size').textContent = formatBytes(rec.size || 0);
          markCompleted(window.location.origin + '/v/' + (rec.shortId || rec.code || rec.id));
          return;
        }
      }
    } catch (_) {}

    if (window.pendingUploadFile) {
      var f = window.pendingUploadFile;
      window.pendingUploadFile = null;
      runR2Upload(f);
      return;
    }

    if (window.PokeDbUtils && window.PokeDbUtils.getFileFromIndexedDb) {
      var idbFile = await window.PokeDbUtils.getFileFromIndexedDb(sessionId);
      if (idbFile) {
        runR2Upload(idbFile);
        return;
      }
    }

    byId('up-file-name').textContent = (sessionData && sessionData.fileName) ? sessionData.fileName : ('Session [' + sessionId + ']');
    byId('up-file-size').textContent = sessionData && sessionData.fileSize ? formatBytes(sessionData.fileSize) : '';
    byId('up-status-text').textContent = 'Select a file to upload';
    byId('reselect-box').style.display = 'block';

    var reselectInput = byId('reselect-file-input');
    byId('reselect-btn').addEventListener('click', function () { reselectInput.click(); });
    reselectInput.addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (file) {
        byId('reselect-box').style.display = 'none';
        runR2Upload(file);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
}());
