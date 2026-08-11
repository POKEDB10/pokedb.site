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
  } catch (e) {}

  var currentFile = null;
  var isPaused = false;
  var isCancelled = false;
  var startTime = Date.now();
  var loadedBytes = 0;
  var totalBytes = 0;

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
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
    byId('stat-speed').textContent = window.PokeDbUtils && window.PokeDbUtils.formatSpeedAuto ? window.PokeDbUtils.formatSpeedAuto(speedBps) : formatBytes(speedBps) + '/s';
    byId('stat-bytes').textContent = formatBytes(cappedCurrent) + ' / ' + formatBytes(total);
    var remainingBytes = total - cappedCurrent;
    var eta = speedBps > 0 ? remainingBytes / speedBps : 0;
    byId('stat-eta').textContent = formatEta(eta);
  }

  function markCompleted(viewerUrl) {
    byId('progress-bar-fill').style.width = '100%';
    byId('stat-percent').textContent = '100%';
    byId('stat-speed').textContent = '0 MB/s';
    byId('stat-eta').textContent = 'Done';
    byId('up-status-text').textContent = 'Upload completed';
    byId('controls-row').style.display = 'none';
    byId('reselect-box').style.display = 'none';
    byId('upload-complete-card').style.display = 'block';
    byId('up-share-url').value = viewerUrl;
    byId('up-open-btn').href = viewerUrl;

    try { localStorage.removeItem(sessionKey); } catch (e) {}
    if (window.PokeDbUtils && window.PokeDbUtils.deleteFileFromIndexedDb) {
      window.PokeDbUtils.deleteFileFromIndexedDb(sessionId);
    }
  }

  byId('up-copy-btn').addEventListener('click', function () {
    var url = byId('up-share-url').value;
    navigator.clipboard.writeText(url);
    this.textContent = 'Copied!';
    if (window.showToast) window.showToast('Download link copied!');
    var btn = this;
    setTimeout(function () { btn.textContent = '$ copy'; }, 1500);
  });

  if (byId('up-qr-btn')) {
    byId('up-qr-btn').addEventListener('click', function () {
      var box = byId('up-qr-box');
      box.replaceChildren();
      var shareUrl = byId('up-share-url').value || (window.location.origin + '/v/' + sessionId);
      byId('up-qr-modal').style.display = 'grid';

      try {
        if (window.QRCodeLib && typeof window.QRCodeLib.generateSVG === 'function') {
          var svgText = window.QRCodeLib.generateSVG(shareUrl, { dark: '#000000', light: '#ffffff', margin: 1 });
          box.innerHTML = svgText;
          var svgEl = box.querySelector('svg');
          if (svgEl) {
            svgEl.setAttribute('width', '220');
            svgEl.setAttribute('height', '220');
            svgEl.style.display = 'block';
            svgEl.style.margin = '0 auto';
          }
          return;
        }
      } catch (e) {
        console.warn('Local QR SVG generation failed, using fallback:', e);
      }

      var img = document.createElement('img');
      img.src = '/api/qr?format=png&text=' + encodeURIComponent(shareUrl);
      img.width = 220;
      img.height = 220;
      img.alt = 'QR Code';
      img.style.display = 'block';
      img.style.margin = '0 auto';
      box.appendChild(img);
    });
  }

  if (byId('up-close-qr-btn')) {
    byId('up-close-qr-btn').addEventListener('click', function () {
      byId('up-qr-modal').style.display = 'none';
    });
  }

  // Check server status first
  async function checkServerStatus() {
    try {
      var res = await fetch('/api/drop/multipart/status?id=' + encodeURIComponent(sessionId));
      if (res.ok) {
        var data = await res.json();
        if (data && data.isComplete && data.record) {
          var viewerUrl = window.location.origin + '/v/' + sessionId;
          byId('up-file-name').textContent = data.record.name || 'Uploaded File';
          byId('up-file-size').textContent = formatBytes(data.record.size || 0);
          markCompleted(viewerUrl);
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  async function startDirectUpload(file) {
    byId('up-file-name').textContent = file.name;
    byId('up-file-size').textContent = formatBytes(file.size);
    byId('up-status-text').textContent = 'Uploading…';
    totalBytes = file.size;

    var formData = new FormData();
    formData.append('file', file);
    formData.append('customId', sessionId);

    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/drop/upload');

    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) {
        loadedBytes = Math.min(e.loaded, totalBytes);
        var elapsed = (Date.now() - startTime) / 1000;
        var speed = elapsed > 0 ? loadedBytes / elapsed : 0;
        var pct = totalBytes > 0 ? Math.min(100, Math.max(0, (loadedBytes / totalBytes) * 100)) : 0;
        updateProgressUI(pct, speed, loadedBytes, totalBytes);
      }
    };

    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        var res = JSON.parse(xhr.responseText);
        var viewUrl = res.viewUrl || (window.location.origin + '/v/' + sessionId);
        markCompleted(viewUrl);
      } else {
        byId('up-status-text').textContent = 'Upload failed (' + xhr.status + ')';
      }
    };

    xhr.onerror = function () {
      byId('up-status-text').textContent = 'Upload error occurred';
    };

    byId('pause-btn').addEventListener('click', function () {
      if (!isPaused) {
        isPaused = true;
        xhr.abort();
        this.textContent = 'Resume Upload';
        byId('up-status-text').textContent = 'Paused';
      } else {
        isPaused = false;
        this.textContent = 'Pause Upload';
        startDirectUpload(file);
      }
    });

    byId('stop-btn').addEventListener('click', function () {
      isCancelled = true;
      xhr.abort();
      byId('up-status-text').textContent = 'Cancelled';
      try { localStorage.removeItem(sessionKey); } catch (e) {}
      if (window.PokeDbUtils && window.PokeDbUtils.deleteFileFromIndexedDb) {
        window.PokeDbUtils.deleteFileFromIndexedDb(sessionId);
      }
    });

    xhr.send(formData);
  }

  async function init() {
    var alreadyComplete = await checkServerStatus();
    if (alreadyComplete) return;

    // Check transient memory or IndexedDB for auto-resume without asking for re-selection
    if (window.pendingUploadFile) {
      currentFile = window.pendingUploadFile;
      window.pendingUploadFile = null;
      startDirectUpload(currentFile);
      return;
    }

    // Retrieve file from IndexedDB if saved during session redirect
    if (window.PokeDbUtils && window.PokeDbUtils.getFileFromIndexedDb) {
      var idbFile = await window.PokeDbUtils.getFileFromIndexedDb(sessionId);
      if (idbFile) {
        currentFile = idbFile;
        startDirectUpload(currentFile);
        return;
      }
    }

    if (sessionData && sessionData.fileName) {
      byId('up-file-name').textContent = sessionData.fileName;
      byId('up-file-size').textContent = formatBytes(sessionData.fileSize || 0);
      byId('up-status-text').textContent = 'Re-selection required to resume';
      byId('reselect-box').style.display = 'block';

      var reselectInput = byId('reselect-file-input');
      byId('reselect-btn').addEventListener('click', function () {
        reselectInput.click();
      });
      reselectInput.addEventListener('change', function (e) {
        var file = e.target.files[0];
        if (file) {
          byId('reselect-box').style.display = 'none';
          currentFile = file;
          startDirectUpload(file);
        }
      });
    } else {
      byId('up-file-name').textContent = 'Session [' + sessionId + ']';
      byId('up-status-text').textContent = 'Ready for upload';
      byId('reselect-box').style.display = 'block';

      var reselectInput = byId('reselect-file-input');
      byId('reselect-btn').addEventListener('click', function () {
        reselectInput.click();
      });
      reselectInput.addEventListener('change', function (e) {
        var file = e.target.files[0];
        if (file) {
          byId('reselect-box').style.display = 'none';
          currentFile = file;
          startDirectUpload(file);
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
}());
