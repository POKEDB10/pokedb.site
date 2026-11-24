(function () {
  'use strict';

  var ONE_GB = 1073741824;
  var MAX_CLIENT_HASH_BYTES = 100 * 1024 * 1024;
  var CHUNK_TIMEOUT_MS = 120000;

  var queue = [];
  var activeUpload = null;
  var paused = false;
  var pendingLargeItem = null;
  var currentResultData = null;
  var activeTab = 'direct';
  var activeFolderBatch = null;

  var utils = window.PokeDbUtils || {};
  var formatBytes = utils.formatBytes || function (b) { return (b || 0) + ' B'; };
  var getFileIcon = utils.getFileIcon || function () { return '[FILE]'; };

  function element(id) { return document.getElementById(id); }

  function showNotice(msg) {
    var box = element('drop-notice');
    if (box) { box.textContent = msg; box.style.display = 'block'; }
  }

  function clearNotice() {
    var box = element('drop-notice');
    if (box) box.style.display = 'none';
  }

  function copyWithFallback(text, onDone) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onDone).catch(function () { fallbackCopy(text, onDone); });
    } else {
      fallbackCopy(text, onDone);
    }
  }

  function fallbackCopy(text, onDone) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (onDone) onDone();
    } catch (_) {}
  }

  function bindCopyButton(btnId, getTextFn, toastLabel) {
    var btn = element(btnId);
    if (!btn) return;
    var orig = btn.textContent;
    btn.addEventListener('click', function () {
      var val = typeof getTextFn === 'function' ? getTextFn() : '';
      if (!val) return;
      copyWithFallback(val, function () {
        btn.textContent = 'Copied!';
        setTimeout(function () { btn.textContent = orig; }, 1600);
        if (window.showToast && toastLabel) window.showToast(toastLabel);
      });
    });
  }

  function renderQrInto(container, targetUrl, size) {
    if (!container || !targetUrl) return;
    container.replaceChildren();
    var px = String(size || 148);
    if (window.QRCode && typeof window.QRCode.toString === 'function') {
      window.QRCode.toString(targetUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }, function (err, svg) {
        if (!err && svg) {
          container.innerHTML = svg;
          var svgEl = container.querySelector('svg');
          if (svgEl) {
            svgEl.setAttribute('width', px);
            svgEl.setAttribute('height', px);
            svgEl.style.display = 'block';
          }
          return;
        }
        appendQrImgFallback(container, targetUrl, px);
      });
      return;
    }
    try {
      if (window.QRCodeLib && typeof window.QRCodeLib.generateSVG === 'function') {
        container.innerHTML = window.QRCodeLib.generateSVG(targetUrl, { dark: '#000000', light: '#ffffff', margin: 1, ecLevel: 'M' });
        var svg = container.querySelector('svg');
        if (svg) {
          svg.setAttribute('width', px);
          svg.setAttribute('height', px);
          svg.style.display = 'block';
        }
        return;
      }
    } catch (_) {}
    appendQrImgFallback(container, targetUrl, px);
  }

  function appendQrImgFallback(container, targetUrl, px) {
    var img = document.createElement('img');
    img.src = '/api/qr?format=png&text=' + encodeURIComponent(targetUrl);
    img.width = Number(px);
    img.height = Number(px);
    img.alt = 'QR Code';
    img.style.display = 'block';
    container.appendChild(img);
  }

  function getTtlHours() {
    var sel = element('expires-in-select');
    var val = sel ? Number(sel.value) : 24;
    return (val === 1 || val === 12 || val === 24 || val === 72) ? val : 24;
  }

  function getBurnOption() {
    var chk = element('drop-burn-checkbox');
    return Boolean(chk && chk.checked);
  }

  function formatSizeAuto(bytes) {
    var num = Number(bytes) || 0;
    if (num >= 1073741824) return (num / 1073741824).toFixed(2).replace(/\.00$/, '') + 'gb';
    if (num >= 1048576) return (num / 1048576).toFixed(1).replace(/\.0$/, '') + 'mb';
    if (num >= 1024) return (num / 1024).toFixed(0) + 'kb';
    return num + 'b';
  }

  function formatSpeed(speedBps) {
    if (utils.formatSpeedAuto) return utils.formatSpeedAuto(speedBps);
    return formatBytes(speedBps) + '/s';
  }

  function formatEta(etaSeconds) {
    if (!isFinite(etaSeconds) || etaSeconds <= 0) return '0s';
    if (etaSeconds > 3600) return (etaSeconds / 3600).toFixed(1) + 'h';
    if (etaSeconds > 60) return Math.round(etaSeconds / 60) + 'm';
    return Math.round(etaSeconds) + 's';
  }

  function setProgress(percent, text) {
    var container = element('progress-container');
    if (container) container.style.display = 'block';
    var fill = element('progress-bar-fill');
    var clamped = Math.max(0, Math.min(100, percent));
    if (fill) fill.style.width = clamped + '%';
    var statusText = element('progress-status-text');
    if (statusText) statusText.textContent = text;
    var pctText = element('progress-percent-text');
    if (pctText) pctText.textContent = Math.round(clamped) + '%';
  }

  function hideProgress() {
    var container = element('progress-container');
    if (container) container.style.display = 'none';
  }

  function isPendingItem(item) {
    return item.status === 'ready' || item.status === 'paused' || item.status === 'failed';
  }

  function updateControls() {
    var hasPending = queue.some(isPendingItem);
    var startBtn = element('start-upload-btn');
    var canStart = hasPending && !activeUpload;
    if (startBtn) {
      startBtn.setAttribute('aria-disabled', canStart ? 'false' : 'true');
      startBtn.textContent = (paused && hasPending && !activeUpload) ? 'Resume upload' : 'Start upload';
    }
    var pauseBtn = element('pause-upload-btn');
    if (pauseBtn) {
      pauseBtn.disabled = !activeUpload && !paused;
      pauseBtn.textContent = paused ? 'Resume queue' : 'Pause queue';
    }
    var cancelBtn = element('cancel-upload-btn');
    if (cancelBtn) {
      cancelBtn.disabled = !activeUpload && !hasPending;
    }
  }

  function sendAbortSession(session) {
    if (!session || !session.id || !session.deleteToken) return;
    fetch('/api/drop/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: session.id, deleteToken: session.deleteToken }),
      keepalive: true
    }).catch(function () {});
  }

  function removeItemFromQueue(item) {
    var index = queue.indexOf(item);
    if (index > -1) {
      if (item.status === 'uploading') {
        abortActiveUpload(false);
      } else if (item.session && item.status !== 'complete') {
        sendAbortSession(item.session);
        item.session = null;
      }
      queue.splice(index, 1);
    }
    if (!queue.length) {
      element('drop-default-prompt').style.display = 'block';
      element('drop-file-badge').style.display = 'none';
      hideProgress();
      clearNotice();
      activeFolderBatch = null;
      paused = false;
    } else {
      updateBadgeInfo();
    }
    renderQueue();
  }

  function updateBadgeInfo() {
    if (!queue.length) return;
    var first = queue[0];
    if (queue.length === 1) {
      if (utils.renderFileIcon) utils.renderFileIcon(element('badge-icon'), first.file.name, false);
      else element('badge-icon').textContent = getFileIcon(first.file.name);
      element('badge-name').textContent = first.file.name;
      element('badge-meta').textContent = formatBytes(first.file.size) + ' · Ready to upload';
    } else {
      var totalBytes = queue.reduce(function (sum, i) { return sum + i.file.size; }, 0);
      if (utils.renderFileIcon) utils.renderFileIcon(element('badge-icon'), '', true);
      else element('badge-icon').textContent = '[DIR]';
      element('badge-name').textContent = queue.length + ' items selected';
      element('badge-meta').textContent = formatBytes(totalBytes) + ' · Folder batch (' + formatSizeAuto(totalBytes) + ')';
    }
  }

  function updateItemDom(item) {
    if (!item._refs) return;
    var metaParts = [formatBytes(item.file.size)];
    if (item.status === 'uploading' || item.status === 'paused') {
      metaParts.push(item.progress + '%');
      if (item.speedText) metaParts.push(item.speedText);
      if (item.etaText) metaParts.push('ETA ' + item.etaText);
      if (item.partsText) metaParts.push(item.partsText);
    } else {
      metaParts.push(item.status);
    }
    item._refs.metaEl.textContent = metaParts.join(' · ');
    item._refs.statusEl.textContent = item.status;
    item._refs.fillEl.style.width = Math.max(0, Math.min(100, item.progress || 0)) + '%';
  }

  function renderQueue() {
    var container = element('upload-queue');
    container.replaceChildren();
    if (!queue.length) {
      updateControls();
      return;
    }
    queue.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'queue-item';

      var icon = document.createElement('span');
      icon.style.color = 'var(--accent)';
      if (utils.renderFileIcon) utils.renderFileIcon(icon, item.file.name, false);
      else icon.textContent = getFileIcon(item.file.name);

      var details = document.createElement('div');
      details.className = 'queue-details';
      var top = document.createElement('div');
      top.className = 'queue-top';
      var name = document.createElement('div');
      name.className = 'queue-name';
      name.textContent = item.path;
      var state = document.createElement('span');
      state.className = 'queue-status';
      top.append(name, state);

      var meta = document.createElement('span');
      meta.className = 'queue-meta';
      var bar = document.createElement('div');
      bar.className = 'queue-item-bar';
      var fill = document.createElement('div');
      fill.className = 'queue-item-fill';
      bar.appendChild(fill);
      details.append(top, meta, bar);

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-queue-btn';
      removeBtn.title = 'Remove item from queue';
      removeBtn.setAttribute('aria-label', 'Remove ' + (item.file.name || 'item') + ' from queue');
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        removeItemFromQueue(item);
      });

      item._refs = { metaEl: meta, statusEl: state, fillEl: fill };
      updateItemDom(item);

      row.append(icon, details, removeBtn);
      container.appendChild(row);
    });
    updateControls();
  }

  function addFiles(files) {
    var incoming = Array.from(files || []);
    if (!incoming.length) return;
    if (activeTab === 'lan') {
      stageLanFiles(incoming);
      return;
    }
    incoming.forEach(function (file) {
      var relPath = file.relativePathOverride || file.webkitRelativePath || file.name;
      queue.push({
        file: file,
        path: relPath,
        status: 'ready',
        progress: 0,
        speedText: '',
        etaText: '',
        partsText: '',
        password: null,
        session: null,
        _refs: null
      });
    });
    element('drop-default-prompt').style.display = 'none';
    element('drop-file-badge').style.display = 'block';
    updateBadgeInfo();
    clearNotice();
    renderQueue();
  }

  window.handleDroppedFiles = addFiles;

  function showLargeFilePrompt(item) {
    pendingLargeItem = item;
    element('large-file-size-label').textContent = formatBytes(item.file.size);
    element('large-file-pass-input').value = '';
    element('large-pass-status').textContent = '';
    element('large-file-modal').style.display = 'block';
  }

  function nextItem() {
    return queue.find(isPendingItem);
  }

  async function computeSha256(file) {
    if (!window.crypto || !window.crypto.subtle || file.size > MAX_CLIENT_HASH_BYTES) {
      return null;
    }
    try {
      var buf = await file.arrayBuffer();
      var hashBuf = await window.crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(hashBuf))
        .map(function (b) { return b.toString(16).padStart(2, '0'); })
        .join('');
    } catch (_) {
      return null;
    }
  }

  async function beginQueue() {
    if (activeUpload) return;
    clearNotice();
    paused = false;

    var pendingItems = queue.filter(isPendingItem);
    if (!pendingItems.length) {
      showNotice('Select one or more files first.');
      hideProgress();
      updateControls();
      return;
    }

    if (pendingItems.length > 1 && !activeFolderBatch) {
      try {
        var totalBytes = pendingItems.reduce(function (sum, item) { return sum + item.file.size; }, 0);
        var folderName = 'pokedb-' + Math.random().toString(36).substring(2, 8) + '-' + formatSizeAuto(totalBytes);
        var folderRes = await fetch('/api/drop/create-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: folderName, totalSize: totalBytes, fileCount: pendingItems.length })
        });
        var folderData = await folderRes.json();
        if (folderRes.ok && folderData.success) {
          activeFolderBatch = {
            folderCode: folderData.folderCode,
            code: folderData.code || folderData.folderCode,
            name: folderData.name,
            totalSize: totalBytes,
            viewUrl: folderData.viewUrl,
            fileCount: pendingItems.length
          };
        }
      } catch (e) {
        console.warn('Failed to create folder batch:', e);
      }
    }

    var item = nextItem();
    if (!item) { hideProgress(); updateControls(); return; }
    if (item.file.size > ONE_GB && !item.password) {
      showLargeFilePrompt(item);
      updateControls();
      return;
    }
    uploadViaPresignedR2(item);
  }

  async function uploadViaPresignedR2(item) {
    clearNotice();
    item.status = 'uploading';
    updateItemDom(item);
    updateControls();

    var abortController = new AbortController();
    var chunkXhrs = [];
    var dropSession = { abortController: abortController, chunkXhrs: chunkXhrs, session: item.session };
    activeUpload = dropSession;

    var signal = abortController.signal;
    var file = item.file;
    var fileSize = file.size;
    var fileName = file.name;
    var ttlHours = getTtlHours();
    var burn = getBurnOption();

    try {
      var partsToUpload = [];
      var completedMap;
      var id;
      var deleteToken;
      var partSize;

      if (item.session && item.session.id && item.session.deleteToken) {
        id = item.session.id;
        deleteToken = item.session.deleteToken;
        partSize = item.session.partSize;
        completedMap = item.session.completedMap;
        setProgress(item.progress || 0, 'Resuming upload for ' + fileName + '…');
        var resRes = await fetch('/api/drop/resume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, deleteToken: deleteToken }),
          signal: signal
        });
        if (resRes.ok) {
          var resData = await resRes.json();
          partsToUpload = resData.missingParts || [];
          partSize = resData.partSize || partSize;
        }
      }

      if (!id) {
        setProgress(0, 'Initializing upload for ' + fileName + '…');
        var initBody = { name: fileName, size: fileSize, ttlHours: ttlHours, burn: burn };
        if (window.PokedbTurnstile) {
          var tsToken = await window.PokedbTurnstile.getToken('#drop-turnstile-wrap');
          if (tsToken) initBody['cf-turnstile-response'] = tsToken;
        }
        var headers = { 'Content-Type': 'application/json' };
        if (item.password) headers['Authorization'] = 'Bearer ' + item.password;

        var initRes = await fetch('/api/drop/init', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(initBody),
          signal: signal
        });
        if (window.PokedbTurnstile) window.PokedbTurnstile.reset('#drop-turnstile-wrap');

        var initData = await initRes.json().catch(function () { return {}; });
        if (!initRes.ok) {
          var isLocal = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
          if (initRes.status === 503 && initData.error === 'storage_service_unavailable' && isLocal) {
            activeUpload = null;
            uploadItemDirect(item);
            return;
          }
          throw new Error(initData.error || initData.message || ('Upload rejected (HTTP ' + initRes.status + ')'));
        }

        id = initData.code || initData.shortId || initData.id;
        deleteToken = initData.deleteToken;
        partSize = initData.partSize;
        partsToUpload = initData.parts || [];
        completedMap = new Map();
        item.session = { id: id, deleteToken: deleteToken, partSize: partSize, completedMap: completedMap, totalParts: partsToUpload.length };
        dropSession.session = item.session;
      }

      if (!id || (!partsToUpload.length && !completedMap.size)) {
        throw new Error('Invalid presigned upload configuration from server.');
      }

      var totalPartsCount = item.session.totalParts || (partsToUpload.length + completedMap.size);
      var concurrency = Math.min(partsToUpload.length || 1, fileSize > 64 * 1024 * 1024 ? 6 : 4);
      var loadedPerPart = {};

      completedMap.forEach(function (_, pNum) {
        var s = (pNum - 1) * partSize;
        var e = Math.min(s + partSize, fileSize);
        loadedPerPart[pNum] = Math.max(0, e - s);
      });
      partsToUpload.forEach(function (p) { loadedPerPart[p.n] = 0; });

      var samples = [];
      var lastUiTick = 0;

      function computeLoadedBytes() {
        var total = 0;
        for (var k in loadedPerPart) total += loadedPerPart[k];
        return Math.min(total, fileSize);
      }

      function updateOverallProgress(force) {
        var now = Date.now();
        if (!force && now - lastUiTick < 80) return;
        lastUiTick = now;

        var cappedLoaded = computeLoadedBytes();
        var pct = fileSize > 0 ? (cappedLoaded / fileSize) * 100 : 100;

        samples.push({ t: now, b: cappedLoaded });
        var cutoff = now - 2500;
        while (samples.length > 2 && samples[0].t < cutoff) samples.shift();

        var speedBps = 0;
        if (samples.length >= 2) {
          var dt = (samples[samples.length - 1].t - samples[0].t) / 1000;
          var db = samples[samples.length - 1].b - samples[0].b;
          if (dt > 0.05 && db >= 0) speedBps = db / dt;
        }

        var speedText = formatSpeed(speedBps);
        var etaSeconds = speedBps > 0 ? (fileSize - cappedLoaded) / speedBps : 0;
        var etaText = formatEta(etaSeconds);
        var partsText = totalPartsCount > 1 ? (completedMap.size + '/' + totalPartsCount + ' parts') : '';

        var statusText = 'Uploading ' + fileName + ' · ' + formatBytes(cappedLoaded) + ' / ' + formatBytes(fileSize) +
          ' · ' + speedText + ' · ETA ' + etaText + (partsText ? ' · [' + partsText + ']' : '');

        setProgress(pct, statusText);
        item.progress = Math.round(pct);
        item.speedText = speedText;
        item.etaText = etaText;
        item.partsText = partsText;
        updateItemDom(item);
      }

      async function uploadSinglePart(partInfo) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        var partNumber = partInfo.n;
        var presignedUrl = partInfo.url;
        var start = (partNumber - 1) * partSize;
        var end = Math.min(start + partSize, fileSize);
        var chunk = file.slice(start, end);
        var refreshedUrl = false;

        for (var attempt = 0; attempt < 4; attempt++) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          try {
            var etag = await new Promise(function (resolve, reject) {
              var xhr = new XMLHttpRequest();
              chunkXhrs.push(xhr);
              xhr.timeout = CHUNK_TIMEOUT_MS;
              xhr.open('PUT', presignedUrl, true);
              xhr.upload.onprogress = function (e) {
                if (e.lengthComputable) {
                  loadedPerPart[partNumber] = Math.min(e.loaded, chunk.size);
                  updateOverallProgress(e.loaded >= chunk.size);
                }
              };
              function detach() {
                var idx = chunkXhrs.indexOf(xhr);
                if (idx > -1) chunkXhrs.splice(idx, 1);
              }
              xhr.onload = function () {
                detach();
                if (xhr.status >= 200 && xhr.status < 300) {
                  resolve((xhr.getResponseHeader('ETag') || '').replace(/"/g, ''));
                } else {
                  var httpErr = new Error('Part ' + partNumber + ' HTTP ' + xhr.status);
                  httpErr.status = xhr.status;
                  reject(httpErr);
                }
              };
              xhr.onerror = function () { detach(); reject(new Error('Network error uploading part ' + partNumber)); };
              xhr.ontimeout = function () { detach(); reject(new Error('Timeout uploading part ' + partNumber)); };
              xhr.onabort = function () { detach(); reject(new DOMException('Aborted', 'AbortError')); };
              signal.addEventListener('abort', function () { try { xhr.abort(); } catch (_) {} }, { once: true });
              xhr.send(chunk);
            });

            loadedPerPart[partNumber] = chunk.size;
            completedMap.set(partNumber, etag);
            updateOverallProgress(true);
            return;
          } catch (err) {
            if (err.name === 'AbortError') throw err;
            if (err.status === 403 && !refreshedUrl) {
              refreshedUrl = true;
              var rr = await fetch('/api/drop/resume', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id, deleteToken: deleteToken }),
                signal: signal
              });
              if (rr.ok) {
                var rj = await rr.json();
                var found = (rj.missingParts || []).find(function (m) { return m.n === partNumber; });
                if (found) presignedUrl = found.url;
              }
            }
            if (attempt === 3) throw err;
            var backoff = 800 * Math.pow(2, attempt) + Math.floor(Math.random() * 300);
            await new Promise(function (r) { setTimeout(r, backoff); });
          }
        }
      }

      if (partsToUpload.length > 0) {
        var partQueue = partsToUpload.slice();
        var workers = [];
        for (var w = 0; w < concurrency; w++) {
          workers.push((async function () {
            while (partQueue.length > 0) {
              if (signal.aborted) return;
              await uploadSinglePart(partQueue.shift());
            }
          })());
        }
        await Promise.all(workers);
      }

      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      setProgress(99, 'Finalizing ' + fileName + ' & computing checksum…');
      var sha256 = await computeSha256(file);
      var orderedParts = [];
      completedMap.forEach(function (etagVal, pNum) {
        orderedParts.push({ PartNumber: pNum, ETag: etagVal });
      });
      orderedParts.sort(function (a, b) { return a.PartNumber - b.PartNumber; });

      var completeRes = await fetch('/api/drop/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: id,
          deleteToken: deleteToken,
          parts: orderedParts,
          sha256: sha256,
          folderCode: activeFolderBatch ? activeFolderBatch.folderCode : undefined
        }),
        signal: signal
      });

      if (!completeRes.ok) {
        var compErr = await completeRes.json().catch(function () { return {}; });
        throw new Error(compErr.error || 'Failed to complete drop upload.');
      }

      var completeData = await completeRes.json();
      var code = completeData.code || completeData.shortId || completeData.id || id;
      var shareUrl = completeData.shareUrl || (window.location.origin + '/d/' + code);
      var viewUrl = completeData.viewUrl || (window.location.origin + '/v/' + code);

      activeUpload = null;
      item.session = null;
      item.status = 'complete';
      item.progress = 100;
      item.speedText = '';
      item.etaText = '';
      setProgress(100, 'Upload complete: ' + fileName);
      updateItemDom(item);
      updateControls();

      var remaining = nextItem();
      if (!remaining && activeFolderBatch) {
        displayFolderResult(activeFolderBatch);
        activeFolderBatch = null;
      } else if (!activeFolderBatch) {
        displayResult({
          success: true,
          id: code,
          code: code,
          name: fileName,
          size: fileSize,
          shareUrl: shareUrl,
          viewUrl: viewUrl,
          curl: completeData.curl || ('curl -LOJ ' + shareUrl),
          deletionToken: deleteToken,
          sha256: sha256,
          ttlHours: ttlHours,
          burn: burn,
          expiresAt: Date.now() + ttlHours * 3600000
        });
      }
      beginQueue();
    } catch (err) {
      activeUpload = null;
      if (err.name === 'AbortError') {
        item.status = paused ? 'paused' : 'cancelled';
        if (!paused && item.session) {
          sendAbortSession(item.session);
          item.session = null;
        }
      } else {
        item.status = 'failed';
        showNotice(err.message || 'Upload failed. Check your connection and retry.');
      }
      updateItemDom(item);
      updateControls();
    }
  }

  function uploadItemDirect(item) {
    clearNotice();
    item.status = 'uploading';
    item.progress = 0;
    updateItemDom(item);
    updateControls();

    var formData = new FormData();
    formData.append('file', item.file);
    formData.append('expiresInDays', '1');
    formData.append('relativePath', item.path);
    if (activeFolderBatch) formData.append('folderCode', activeFolderBatch.folderCode);

    var xhr = new XMLHttpRequest();
    activeUpload = { xhr: xhr };
    xhr.open('POST', '/api/drop/upload', true);
    if (item.password) xhr.setRequestHeader('x-upload-password', item.password);

    var lastTime = Date.now();
    var lastLoaded = 0;
    xhr.upload.addEventListener('progress', function (event) {
      if (!event.lengthComputable) return;
      item.progress = Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100)));
      var now = Date.now();
      var elapsed = (now - lastTime) / 1000;
      var currentBytes = Math.min(event.loaded, event.total);
      var speed = elapsed > 0.1 ? (currentBytes - lastLoaded) / elapsed : 0;
      if (elapsed > 0.25 || event.loaded >= event.total) { lastTime = now; lastLoaded = currentBytes; }
      item.speedText = speed ? formatSpeed(speed) : '';
      item.etaText = speed > 0 ? formatEta((event.total - currentBytes) / speed) : '';
      setProgress(item.progress, 'Uploading ' + item.file.name + ' · ' + formatBytes(currentBytes) + ' / ' + formatBytes(event.total) + (item.speedText ? ' · ' + item.speedText : ''));
      updateItemDom(item);
    });

    xhr.onload = function () {
      activeUpload = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var result = JSON.parse(xhr.responseText);
          item.status = 'complete';
          item.progress = 100;
          item.speedText = '';
          item.etaText = '';
          updateItemDom(item);
          updateControls();
          var remaining = nextItem();
          if (!remaining && activeFolderBatch) {
            displayFolderResult(activeFolderBatch);
            activeFolderBatch = null;
          } else if (!activeFolderBatch) {
            result.name = result.name || (result.file && result.file.name) || item.file.name;
            result.size = result.size != null ? result.size : ((result.file && result.file.size) != null ? result.file.size : item.file.size);
            if (result.burn === undefined) result.burn = getBurnOption();
            if (result.ttlHours === undefined) result.ttlHours = getTtlHours();
            displayResult(result);
          }
          beginQueue();
        } catch (_) {
          item.status = 'failed';
          showNotice('Upload completed but response could not be parsed.');
          updateItemDom(item);
          updateControls();
        }
      } else {
        item.status = 'failed';
        try {
          showNotice('Upload failed: ' + (JSON.parse(xhr.responseText).error || 'HTTP ' + xhr.status));
        } catch (_) {
          showNotice('Upload failed (HTTP ' + xhr.status + ')');
        }
        updateItemDom(item);
        updateControls();
      }
    };
    xhr.onabort = function () {
      activeUpload = null;
      item.status = paused ? 'paused' : 'cancelled';
      updateItemDom(item);
      updateControls();
    };
    xhr.onerror = function () {
      activeUpload = null;
      item.status = 'failed';
      showNotice('Network connection interrupted.');
      updateItemDom(item);
      updateControls();
    };
    xhr.send(formData);
  }

  function abortActiveUpload(preserveSession) {
    if (!activeUpload) return;
    if (!preserveSession && activeUpload.session) {
      sendAbortSession(activeUpload.session);
      activeUpload.session = null;
    }
    if (activeUpload.xhr) activeUpload.xhr.abort();
    if (activeUpload.abortController) {
      activeUpload.abortController.abort();
      (activeUpload.chunkXhrs || []).forEach(function (xhr) { try { xhr.abort(); } catch (_) {} });
    }
  }

  function togglePause() {
    if (paused) { beginQueue(); return; }
    paused = true;
    abortActiveUpload(true);
    updateControls();
  }

  function cancelQueue() {
    paused = false;
    abortActiveUpload(false);
    queue.forEach(function (item) {
      if (item.session && item.status !== 'complete') {
        sendAbortSession(item.session);
        item.session = null;
      }
      if (item.status === 'ready' || item.status === 'paused' || item.status === 'uploading') {
        item.status = 'cancelled';
      }
    });
    renderQueue();
    hideProgress();
  }

  function displayResult(result) {
    currentResultData = result;
    element('result-card').style.display = 'block';
    var dropModal = element('drop-result-modal');
    if (dropModal) dropModal.classList.add('is-open');

    var qrPanel = element('res-qr-panel');
    if (qrPanel) qrPanel.classList.remove('is-open');
    if (element('res-qr-btn')) element('res-qr-btn').setAttribute('aria-expanded', 'false');

    var resolvedName = result.name || (result.file && result.file.name) || 'Uploaded file';
    var resolvedSize = Number(result.size != null ? result.size : (result.file && result.file.size) || 0);
    if (utils.renderFileIcon) utils.renderFileIcon(element('res-file-icon'), resolvedName, false);
    else element('res-file-icon').textContent = getFileIcon(resolvedName);

    element('res-file-name').textContent = resolvedName;
    element('res-file-size').textContent = formatBytes(resolvedSize);
    element('res-storage-provider').textContent = 'Cloudflare R2';
    element('res-downloads-tag').textContent = result.burn ? '0 / 1 burn' : '0 downloads';

    var burnPill = element('res-burn-pill');
    if (burnPill) burnPill.classList.toggle('is-visible', Boolean(result.burn));

    var code = result.code || result.shortId || result.id;
    var viewUrl = result.viewUrl || (window.location.origin + '/v/' + code);
    var directUrl = result.shareUrl || result.downloadUrl || (window.location.origin + '/d/' + code);
    var curlCmd = result.curl || ('curl -LOJ ' + directUrl);

    if (element('res-short-code')) element('res-short-code').textContent = code || '—';
    element('res-share-link').value = viewUrl;
    if (element('res-direct-row')) element('res-direct-row').style.display = 'block';
    if (element('res-direct-link')) element('res-direct-link').value = directUrl;
    if (element('res-curl-row')) element('res-curl-row').style.display = 'block';
    if (element('res-curl-cmd')) element('res-curl-cmd').value = curlCmd;
    element('open-link-btn').href = viewUrl;

    var shaRow = element('res-sha256-row');
    if (shaRow && element('res-sha256-val')) {
      if (result.sha256) {
        element('res-sha256-val').textContent = result.sha256;
        shaRow.style.display = 'block';
      } else {
        shaRow.style.display = 'none';
      }
    }

    var retention = result.ttlHours ? result.ttlHours + 'h expiry' : (result.expiresAt ? new Date(result.expiresAt).toLocaleString() : '24h expiry');
    if (result.burn) retention += ' · Burn 1×';
    element('res-expiry-info').textContent = retention;
  }

  function displayFolderResult(batch) {
    currentResultData = batch;
    element('result-card').style.display = 'block';
    var dropModal = element('drop-result-modal');
    if (dropModal) dropModal.classList.add('is-open');

    var qrPanel = element('res-qr-panel');
    if (qrPanel) qrPanel.classList.remove('is-open');

    if (utils.renderFileIcon) utils.renderFileIcon(element('res-file-icon'), '', true);
    else element('res-file-icon').textContent = '[DIR]';

    var code = batch.code || batch.folderCode;
    var viewerUrl = batch.viewUrl || (window.location.origin + '/v/' + code);

    element('res-file-name').textContent = batch.name;
    element('res-file-size').textContent = formatBytes(batch.totalSize) + ' · ' + batch.fileCount + ' files';
    element('res-storage-provider').textContent = 'Drop Folder';
    element('res-downloads-tag').textContent = batch.fileCount + ' items';
    if (element('res-burn-pill')) element('res-burn-pill').classList.remove('is-visible');
    if (element('res-short-code')) element('res-short-code').textContent = code || '—';
    element('res-share-link').value = viewerUrl;
    if (element('res-direct-row')) element('res-direct-row').style.display = 'none';
    if (element('res-curl-row')) element('res-curl-row').style.display = 'none';
    if (element('res-sha256-row')) element('res-sha256-row').style.display = 'none';
    element('open-link-btn').href = viewerUrl;
    element('res-expiry-info').textContent = 'Folder batch';
  }

  function addFileListItem(container, file) {
    var row = document.createElement('div');
    row.className = 'queue-item';
    var isFolder = file.type === 'folder' || file.isFolder;
    var icon = document.createElement('span');
    icon.style.color = 'var(--accent)';
    if (utils.renderFileIcon) utils.renderFileIcon(icon, file.name || 'file', isFolder);
    else icon.textContent = isFolder ? '[DIR]' : getFileIcon(file.name || 'file');

    var details = document.createElement('div');
    details.className = 'queue-details';
    var name = document.createElement('div');
    name.className = 'queue-name';
    name.textContent = file.name || 'File';
    var code = file.short_id || file.shortId || file.code || file.id;
    var meta = document.createElement('span');
    meta.className = 'queue-meta';
    meta.textContent = (isFolder ? 'Folder' : formatBytes(Number(file.size || 0))) + ' · ' + code;
    details.append(name, meta);

    var open = document.createElement('a');
    open.className = 'btn btn-sm';
    open.textContent = 'Open';
    open.target = '_blank';
    open.rel = 'noopener';
    open.href = window.location.origin + '/v/' + encodeURIComponent(code);
    row.append(icon, details, open);
    container.appendChild(row);
  }

  async function loadFileList() {
    var container = element('file-list-container');
    var token = element('manager-token-input').value.trim();
    if (!token) { container.textContent = 'Enter your ADMIN_TOKEN to list active Drop files.'; return; }
    sessionStorage.setItem('pokedb-admin-token', token);
    container.textContent = 'Loading files…';
    var params = new URLSearchParams();
    var folderId = element('manager-folder-id').value.trim();
    if (folderId) params.set('folderId', folderId);
    try {
      var response = await fetch('/api/drop/list?' + params, {
        headers: { 'Authorization': 'Bearer ' + token, 'X-Admin-Token': token }
      });
      var data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load files');
      var files = data.drops || data.files || [];
      container.replaceChildren();
      if (!files.length) { container.textContent = 'No active files returned.'; return; }
      files.forEach(function (file) { addFileListItem(container, file); });
    } catch (error) {
      container.textContent = error.message;
    }
  }

  // ── LAN Direct (P2P) UI State & Wiring (window.PokedbLan) ──
  var lanFiles = [];
  var lanSubMode = 'send';
  var lanSender = null;
  var lanReceiver = null;
  var lanPendingOffer = null;
  var lanObjectUrls = [];

  function revokeLanUrls() {
    while (lanObjectUrls.length) {
      try { URL.revokeObjectURL(lanObjectUrls.pop()); } catch (_) {}
    }
  }

  var LAN_STATE_LABELS = {
    'creating': 'Creating ephemeral LAN pairing room…',
    'waiting-peer': 'Waiting for receiver to enter code…',
    'joining': 'Joining LAN pairing room…',
    'connecting': 'Negotiating direct WebRTC connection…',
    'sas-ready': 'SAS ready — verify 6-digit code matches peer.',
    'awaiting-decision': 'Verify SAS matches sender, then Accept or Decline.',
    'sending': 'Streaming AES-256-GCM encrypted chunks…',
    'receiving': 'Receiving AES-256-GCM encrypted chunks…',
    'verifying': 'Verifying SHA-256 integrity checksum…',
    'completed': 'Transfer complete — SHA-256 verified!',
    'declined': 'Transfer declined by receiver.',
    'cancelled': 'LAN session cancelled.',
    'closed': 'LAN session closed.'
  };

  function formatLanState(state, detail) {
    if (!state) return '';
    if (typeof state === 'object') return state.message || LAN_STATE_LABELS[state.state] || state.state || '';
    if (state === 'error' && detail) return typeof detail === 'string' ? detail : (detail.message || 'LAN error');
    return LAN_STATE_LABELS[state] || (typeof detail === 'string' && detail ? detail : state);
  }

  function checkLanSupport() {
    var lan = window.PokedbLan;
    if (!lan) return { ok: false, reason: 'LAN P2P engine is unavailable in this environment.' };
    if (typeof lan.isSupported === 'function') {
      var sup = lan.isSupported();
      if (typeof sup === 'boolean') return { ok: sup, reason: sup ? '' : 'Direct LAN transfer requires WebRTC and WebCrypto.' };
      return { ok: Boolean(sup && sup.supported), reason: (sup && sup.reason) || 'Direct LAN transfer requires WebRTC and WebCrypto.' };
    }
    return { ok: true, reason: '' };
  }

  function stageLanFiles(files) {
    lanFiles = Array.from(files || []);
    if (!lanFiles.length) return;
    var total = lanFiles.reduce(function (s, f) { return s + f.size; }, 0);
    if (lanFiles.length === 1) {
      element('lan-send-file-label').textContent = lanFiles[0].name;
      element('lan-send-file-meta').textContent = formatBytes(total) + ' · Ready for P2P pairing';
    } else {
      element('lan-send-file-label').textContent = lanFiles.length + ' files staged';
      element('lan-send-file-meta').textContent = formatBytes(total) + ' · Ready for P2P pairing';
    }
    element('lan-create-room-btn').disabled = Boolean(lanSender);
    if (lanSender && typeof lanSender.setFiles === 'function') {
      lanSender.setFiles(lanFiles).catch(function () {});
    }
  }

  function resetLanSenderUi(keepFiles) {
    lanSender = null;
    if (!keepFiles) {
      lanFiles = [];
      element('lan-send-file-label').textContent = 'Drop file(s) for direct LAN transfer';
      element('lan-send-file-meta').textContent = 'No file size cap · Stays on your local network';
    }
    element('lan-create-room-btn').disabled = !lanFiles.length;
    element('lan-send-cancel-btn').disabled = true;
    element('lan-send-sas-box').classList.remove('is-visible');
    element('lan-send-progress').style.display = 'none';
    element('lan-send-bar').style.width = '0%';
    element('lan-send-percent').textContent = '0%';
  }

  function resetLanReceiverUi() {
    lanReceiver = null;
    lanPendingOffer = null;
    revokeLanUrls();
    element('lan-join-btn').disabled = false;
    element('lan-recv-status-box').style.display = 'none';
    element('lan-recv-sas-box').classList.remove('is-visible');
    element('lan-incoming-card').style.display = 'none';
    element('lan-incoming-files-list').replaceChildren();
    element('lan-incoming-files-list').style.display = 'none';
    element('lan-recv-progress').style.display = 'none';
    element('lan-recv-bar').style.width = '0%';
    element('lan-recv-percent').textContent = '0%';
    element('lan-recv-complete').style.display = 'none';
    element('lan-recv-downloads-list').replaceChildren();
    element('lan-accept-controls').style.display = 'flex';
    element('lan-accept-btn').disabled = false;
    element('lan-decline-btn').disabled = false;
  }

  function setLanSubMode(mode) {
    lanSubMode = mode === 'receive' ? 'receive' : 'send';
    element('lan-mode-send-btn').classList.toggle('is-active', lanSubMode === 'send');
    element('lan-mode-recv-btn').classList.toggle('is-active', lanSubMode === 'receive');
    element('lan-send-panel').style.display = lanSubMode === 'send' ? 'block' : 'none';
    element('lan-receive-panel').style.display = lanSubMode === 'receive' ? 'block' : 'none';
  }

  function switchMainTab(targetTab) {
    activeTab = targetTab;
    document.querySelectorAll('.tab-btn').forEach(function (button) {
      var isMatch = button.dataset.tab === targetTab;
      button.classList.toggle('is-active', isMatch);
      button.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      button.setAttribute('tabindex', isMatch ? '0' : '-1');
    });
    element('tab-content-direct').style.display = targetTab === 'direct' ? 'block' : 'none';
    element('tab-content-lan').style.display = targetTab === 'lan' ? 'block' : 'none';
    element('tab-content-manager').style.display = targetTab === 'manager' ? 'block' : 'none';
    if (targetTab === 'manager') loadFileList();
  }

  async function startLanSender() {
    clearNotice();
    if (!lanFiles.length) { showNotice('Select one or more files for LAN transfer.'); return; }
    var lan = window.PokedbLan;
    var support = checkLanSupport();
    if (!support.ok) {
      showNotice(support.reason);
      return;
    }

    if (lanSender && typeof lanSender.cancel === 'function') {
      try { lanSender.cancel('restarted'); } catch (_) {}
    }

    element('lan-create-room-btn').disabled = true;
    element('lan-send-cancel-btn').disabled = false;
    element('lan-pairing-card').style.display = 'block';
    element('lan-send-sas-box').classList.remove('is-visible');
    element('lan-send-progress').style.display = 'none';
    element('lan-send-status').textContent = 'Creating ephemeral LAN pairing room…';

    try {
      lanSender = lan.createSender({
        files: lanFiles,
        allowStun: false,
        onStateChange: function (st, detail) {
          var label = formatLanState(st, detail);
          if (label) element('lan-send-status').textContent = label;
        },
        onRoomCreated: function (info) {
          var code = info && info.code ? info.code : '------';
          var pairUrl = window.location.origin + window.location.pathname + '?lan=' + encodeURIComponent(code);
          element('lan-pair-code').textContent = code;
          element('lan-pair-url-text').textContent = pairUrl;
          renderQrInto(element('lan-qr-box'), pairUrl, 140);
          element('lan-send-status').textContent = 'Waiting for receiver to enter code…';
        },
        onPeerJoined: function () {
          element('lan-send-status').textContent = 'Receiver joined — negotiating E2EE WebRTC channel…';
        },
        onSas: function (info) {
          var formatted = (info && info.formattedSas) || (info && info.sas ? lan.formatSas(info.sas) : '');
          if (formatted) {
            element('lan-send-sas-code').textContent = formatted;
            element('lan-send-sas-box').classList.add('is-visible');
          }
        },
        onReceiverDecision: function (decision) {
          var accepted = typeof decision === 'boolean' ? decision : Boolean(decision && decision.accepted !== false);
          if (accepted) {
            element('lan-send-status').textContent = 'Receiver accepted — streaming AES-256-GCM chunks…';
            element('lan-send-progress').style.display = 'block';
          } else {
            element('lan-send-status').textContent = 'Receiver declined the transfer.';
            showNotice('Receiver declined the incoming LAN transfer.');
            resetLanSenderUi(true);
          }
        },
        onProgress: function (p) {
          if (!p) return;
          element('lan-send-progress').style.display = 'block';
          var pct = Math.max(0, Math.min(100, Number(p.percent || 0)));
          element('lan-send-bar').style.width = pct + '%';
          element('lan-send-percent').textContent = Math.round(pct) + '%';
          var prefix = (p.fileCount > 1) ? ('[' + ((p.fileIndex || 0) + 1) + '/' + p.fileCount + '] ') : '';
          var sent = p.bytesSent != null ? p.bytesSent : (p.fileBytesSent || 0);
          var total = p.totalBytes != null ? p.totalBytes : (p.fileSize || 0);
          element('lan-send-progress-text').textContent = prefix + (p.fileName || 'Sending') + ' · ' +
            formatBytes(sent) + ' / ' + formatBytes(total) + ' · ' + formatSpeed(p.speedBps || 0) +
            ' · ETA ' + formatEta(p.etaSeconds || 0);
        },
        onFileComplete: function (info) {
          if (info && info.name && window.showToast) window.showToast('Sent ' + info.name);
        },
        onComplete: function () {
          element('lan-send-bar').style.width = '100%';
          element('lan-send-percent').textContent = '100%';
          element('lan-send-status').textContent = 'Transfer complete — verified by receiver!';
          element('lan-create-room-btn').disabled = false;
          element('lan-send-cancel-btn').disabled = true;
          lanSender = null;
          if (window.showToast) window.showToast('LAN transfer complete');
        },
        onError: function (err) {
          var msg = (err && err.message) ? err.message : String(err || 'LAN sender error');
          showNotice(msg);
          element('lan-send-status').textContent = msg;
          resetLanSenderUi(true);
        }
      });

      var created = await lanSender.start();
      if (created && created.code && element('lan-pair-code').textContent === '------') {
        var pairUrl = window.location.origin + window.location.pathname + '?lan=' + encodeURIComponent(created.code);
        element('lan-pair-code').textContent = created.code;
        element('lan-pair-url-text').textContent = pairUrl;
        renderQrInto(element('lan-qr-box'), pairUrl, 140);
      }
    } catch (err) {
      showNotice((err && err.message) || 'Failed to create LAN room.');
      resetLanSenderUi(true);
    }
  }

  async function startLanReceiver() {
    clearNotice();
    var lan = window.PokedbLan;
    var support = checkLanSupport();
    if (!support.ok) {
      showNotice(support.reason);
      return;
    }

    var rawCode = element('lan-join-code-input').value || '';
    var code = typeof lan.normalizeCode === 'function' ? lan.normalizeCode(rawCode) : rawCode.trim().toUpperCase();
    element('lan-join-code-input').value = code;
    if (!code || (typeof lan.isValidCode === 'function' && !lan.isValidCode(code))) {
      showNotice('Enter a valid 6-character LAN pairing code.');
      return;
    }

    if (lanReceiver && typeof lanReceiver.cancel === 'function') {
      try { lanReceiver.cancel('rejoined'); } catch (_) {}
    }
    resetLanReceiverUi();
    element('lan-join-btn').disabled = true;
    element('lan-recv-status-box').style.display = 'block';
    element('lan-recv-status').textContent = 'Joining room ' + code + '…';

    try {
      lanReceiver = lan.createReceiver({
        code: code,
        allowStun: false,
        autoDownload: false,
        onStateChange: function (st, detail) {
          var label = formatLanState(st, detail);
          if (label) element('lan-recv-status').textContent = label;
        },
        onJoined: function () {
          element('lan-recv-status').textContent = 'Paired — exchanging ECDH keys & WebRTC ICE…';
        },
        onSas: function (info) {
          var formatted = (info && info.formattedSas) || (info && info.sas ? lan.formatSas(info.sas) : '');
          if (formatted) {
            element('lan-recv-sas-code').textContent = formatted;
            element('lan-recv-sas-box').classList.add('is-visible');
          }
        },
        onFileOffer: function (offer) {
          lanPendingOffer = offer;
          var files = Array.isArray(offer && offer.files) ? offer.files : [];
          var totalSize = Number((offer && offer.totalSize) || files.reduce(function (s, f) { return s + (f.size || 0); }, 0));
          var fileCount = (offer && offer.fileCount) || files.length || 1;
          if (offer && (offer.formattedSas || offer.sas)) {
            element('lan-recv-sas-code').textContent = offer.formattedSas || lan.formatSas(offer.sas);
            element('lan-recv-sas-box').classList.add('is-visible');
          }

          element('lan-incoming-card').style.display = 'block';
          element('lan-accept-controls').style.display = 'flex';
          element('lan-accept-btn').disabled = false;
          element('lan-decline-btn').disabled = false;

          var filesListEl = element('lan-incoming-files-list');
          filesListEl.replaceChildren();
          if (files.length <= 1) {
            var single = files[0] || {};
            element('lan-inc-name').textContent = single.name || 'Incoming file';
            element('lan-inc-size').textContent = formatBytes(totalSize);
            element('lan-inc-hash').textContent = single.sha256 ? ('SHA-256: ' + single.sha256) : 'SHA-256: verifying on receipt';
            filesListEl.style.display = 'none';
          } else {
            element('lan-inc-name').textContent = fileCount + ' incoming files';
            element('lan-inc-size').textContent = formatBytes(totalSize);
            element('lan-inc-hash').textContent = 'Per-file SHA-256 verification enabled';
            filesListEl.style.display = 'grid';
            files.forEach(function (f) {
              var row = document.createElement('div');
              row.style.cssText = 'padding:.45rem .65rem; border:1px solid var(--border); border-radius:7px; background:var(--surface); font:500 .76rem "IBM Plex Mono",monospace; overflow-wrap:anywhere;';
              row.textContent = (f.name || 'file') + ' (' + formatBytes(f.size || 0) + ')' + (f.sha256 ? ' · ' + f.sha256.slice(0, 12) + '…' : '');
              filesListEl.appendChild(row);
            });
          }
          element('lan-recv-status').textContent = 'Verify SAS matches sender, then Accept or Decline.';
        },
        onProgress: function (p) {
          if (!p) return;
          element('lan-recv-progress').style.display = 'block';
          var pct = Math.max(0, Math.min(100, Number(p.percent || 0)));
          element('lan-recv-bar').style.width = pct + '%';
          element('lan-recv-percent').textContent = Math.round(pct) + '%';
          var prefix = (p.fileCount > 1) ? ('[' + ((p.fileIndex || 0) + 1) + '/' + p.fileCount + '] ') : '';
          var recvd = p.bytesReceived != null ? p.bytesReceived : (p.bytesTransferred != null ? p.bytesTransferred : (p.fileBytesReceived || 0));
          var total = p.totalBytes != null ? p.totalBytes : (p.fileSize || 0);
          element('lan-recv-progress-text').textContent = prefix + (p.fileName || 'Receiving') + ' · ' +
            formatBytes(recvd) + ' / ' + formatBytes(total) + ' · ' + formatSpeed(p.speedBps || 0) +
            ' · ETA ' + formatEta(p.etaSeconds || 0);
        },
        onFileComplete: function (info) {
          if (!info) return;
          var dlUrl = info.downloadUrl || (info.blob ? URL.createObjectURL(info.blob) : '');
          if (dlUrl && !info.downloadUrl) lanObjectUrls.push(dlUrl);
          element('lan-recv-complete').style.display = 'block';
          element('lan-recv-verified-msg').textContent = info.verified === false
            ? ('✕ Checksum mismatch on ' + (info.name || 'file'))
            : ('✓ SHA-256 Verified: ' + (info.name || 'file'));

          if (dlUrl) {
            var saveLink = document.createElement('a');
            saveLink.className = 'btn btn-solid btn-sm';
            saveLink.href = dlUrl;
            saveLink.download = info.name || 'download.bin';
            saveLink.textContent = 'Save ' + (info.name || 'file');
            element('lan-recv-downloads-list').appendChild(saveLink);

            if (info.verified !== false) {
              var autoA = document.createElement('a');
              autoA.style.display = 'none';
              autoA.href = dlUrl;
              autoA.download = info.name || 'download.bin';
              document.body.appendChild(autoA);
              autoA.click();
              setTimeout(function () { autoA.remove(); }, 1000);
            }
          }
        },
        onComplete: function () {
          element('lan-recv-bar').style.width = '100%';
          element('lan-recv-percent').textContent = '100%';
          element('lan-recv-status').textContent = 'Transfer complete — SHA-256 verified!';
          element('lan-join-btn').disabled = false;
          if (window.showToast) window.showToast('LAN download complete & verified');
        },
        onError: function (err) {
          var msg = (err && err.message) ? err.message : String(err || 'LAN receiver error');
          showNotice(msg);
          element('lan-recv-status').textContent = msg;
          element('lan-join-btn').disabled = false;
        }
      });

      await lanReceiver.join(code);
    } catch (err) {
      showNotice((err && err.message) || 'Failed to join LAN room.');
      element('lan-recv-status').textContent = 'Connection failed';
      element('lan-join-btn').disabled = false;
    }
  }

  function initLanControls() {
    var lanDrop = element('lan-drop-zone');
    var lanInput = element('lan-file-input');
    var lanSelectBtn = element('lan-select-files-btn');
    if (lanSelectBtn && lanInput) {
      lanSelectBtn.addEventListener('click', function (e) { e.stopPropagation(); lanInput.click(); });
    }
    if (lanDrop && lanInput) {
      lanDrop.addEventListener('click', function (e) {
        if (e.target !== lanSelectBtn) lanInput.click();
      });
      ['dragenter', 'dragover'].forEach(function (ev) {
        lanDrop.addEventListener(ev, function (e) { e.preventDefault(); lanDrop.classList.add('dragover'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        lanDrop.addEventListener(ev, function (e) { e.preventDefault(); lanDrop.classList.remove('dragover'); });
      });
      lanDrop.addEventListener('drop', function (e) {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          stageLanFiles(e.dataTransfer.files);
        }
      });
      lanInput.addEventListener('change', function (e) {
        if (e.target.files && e.target.files.length) stageLanFiles(e.target.files);
        lanInput.value = '';
      });
    }

    if (element('lan-mode-send-btn')) {
      element('lan-mode-send-btn').addEventListener('click', function () { setLanSubMode('send'); });
    }
    if (element('lan-mode-recv-btn')) {
      element('lan-mode-recv-btn').addEventListener('click', function () { setLanSubMode('receive'); });
    }

    bindCopyButton('lan-copy-code-btn', function () {
      return element('lan-pair-code') ? element('lan-pair-code').textContent : '';
    }, 'Pairing code copied');

    bindCopyButton('lan-copy-link-btn', function () {
      return element('lan-pair-url-text') ? element('lan-pair-url-text').textContent : '';
    }, 'Pairing link copied');

    if (element('lan-create-room-btn')) {
      element('lan-create-room-btn').addEventListener('click', startLanSender);
    }
    if (element('lan-send-cancel-btn')) {
      element('lan-send-cancel-btn').addEventListener('click', function () {
        if (lanSender && typeof lanSender.cancel === 'function') lanSender.cancel('cancelled_by_sender');
        element('lan-send-status').textContent = 'Session cancelled.';
        element('lan-pairing-card').style.display = 'none';
        resetLanSenderUi(true);
      });
    }

    if (element('lan-join-btn')) {
      element('lan-join-btn').addEventListener('click', startLanReceiver);
    }
    if (element('lan-join-code-input')) {
      element('lan-join-code-input').addEventListener('input', function () {
        var lan = window.PokedbLan;
        if (lan && typeof lan.normalizeCode === 'function') {
          var pos = this.selectionStart;
          var norm = lan.normalizeCode(this.value);
          if (norm !== this.value) {
            this.value = norm;
            try { this.setSelectionRange(pos, pos); } catch (_) {}
          }
        }
      });
      element('lan-join-code-input').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); startLanReceiver(); }
      });
    }
    if (element('lan-recv-cancel-btn')) {
      element('lan-recv-cancel-btn').addEventListener('click', function () {
        if (lanReceiver && typeof lanReceiver.cancel === 'function') lanReceiver.cancel('cancelled_by_receiver');
        resetLanReceiverUi();
      });
    }
    if (element('lan-accept-btn')) {
      element('lan-accept-btn').addEventListener('click', async function () {
        element('lan-accept-btn').disabled = true;
        element('lan-decline-btn').disabled = true;
        element('lan-accept-controls').style.display = 'none';
        element('lan-recv-progress').style.display = 'block';
        element('lan-recv-status').textContent = 'Receiving encrypted stream…';
        try {
          if (lanPendingOffer && typeof lanPendingOffer.accept === 'function') await lanPendingOffer.accept();
          else if (lanReceiver && typeof lanReceiver.accept === 'function') await lanReceiver.accept();
        } catch (err) {
          showNotice((err && err.message) || 'Failed to accept transfer.');
        }
      });
    }
    if (element('lan-decline-btn')) {
      element('lan-decline-btn').addEventListener('click', async function () {
        element('lan-accept-btn').disabled = true;
        element('lan-decline-btn').disabled = true;
        try {
          if (lanPendingOffer && typeof lanPendingOffer.decline === 'function') await lanPendingOffer.decline('User declined');
          else if (lanReceiver && typeof lanReceiver.decline === 'function') await lanReceiver.decline('User declined');
        } catch (_) {}
        resetLanReceiverUi();
      });
    }

    var params = new URLSearchParams(window.location.search);
    var lanCodeParam = (params.get('lan') || '').trim();
    if (lanCodeParam) {
      switchMainTab('lan');
      setLanSubMode('receive');
      var normalized = (window.PokedbLan && typeof window.PokedbLan.normalizeCode === 'function')
        ? window.PokedbLan.normalizeCode(lanCodeParam)
        : lanCodeParam.toUpperCase();
      if (element('lan-join-code-input')) element('lan-join-code-input').value = normalized;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (window.PokedbTurnstile) window.PokedbTurnstile.mount('#drop-turnstile-wrap');

    var storedToken = sessionStorage.getItem('pokedb-admin-token');
    if (storedToken && element('manager-token-input')) element('manager-token-input').value = storedToken;

    var fileInput = element('file-input');
    var folderInput = element('folder-input');
    var dropZone = element('drop-zone');
    var windowOverlay = element('window-drag-overlay');
    var dragCounter = 0;

    window.addEventListener('dragenter', function (e) {
      if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).indexOf('Files') !== -1) {
        dragCounter++;
        if (windowOverlay) windowOverlay.classList.add('is-active');
      }
    });
    window.addEventListener('dragleave', function () {
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        if (windowOverlay) windowOverlay.classList.remove('is-active');
      }
    });
    window.addEventListener('drop', function () {
      dragCounter = 0;
      if (windowOverlay) windowOverlay.classList.remove('is-active');
    });

    if (element('btn-select-files')) {
      element('btn-select-files').addEventListener('click', function (e) { e.stopPropagation(); fileInput.click(); });
    }
    if (element('btn-add-more')) {
      element('btn-add-more').addEventListener('click', function (e) { e.stopPropagation(); fileInput.click(); });
    }
    if (element('btn-clear-queue')) {
      element('btn-clear-queue').addEventListener('click', function (e) {
        e.stopPropagation();
        cancelQueue();
        queue.length = 0;
        activeFolderBatch = null;
        element('drop-default-prompt').style.display = 'block';
        element('drop-file-badge').style.display = 'none';
        clearNotice();
        renderQueue();
      });
    }
    if (element('btn-select-folder') && folderInput) {
      element('btn-select-folder').addEventListener('click', function (e) { e.stopPropagation(); folderInput.click(); });
      folderInput.addEventListener('change', function (event) {
        addFiles(event.target.files);
        folderInput.value = '';
      });
    }

    dropZone.addEventListener('click', function (event) {
      if (event.target === dropZone || event.target.closest('#drop-default-prompt')) {
        fileInput.click();
      }
    });
    fileInput.addEventListener('change', function (event) {
      addFiles(event.target.files);
      fileInput.value = '';
    });

    ['dragenter', 'dragover'].forEach(function (name) {
      dropZone.addEventListener(name, function (event) { event.preventDefault(); dropZone.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      dropZone.addEventListener(name, function (event) { event.preventDefault(); dropZone.classList.remove('dragover'); });
    });

    async function handleDropDataTransfer(dataTransfer) {
      var items = dataTransfer.items;
      var files = [];
      if (items && items.length && items[0].webkitGetAsEntry) {
        var entries = [];
        for (var i = 0; i < items.length; i++) {
          var entry = items[i].webkitGetAsEntry();
          if (entry) entries.push(entry);
        }
        async function traverseEntry(entry, path) {
          if (entry.isFile) {
            await new Promise(function (resolve) {
              entry.file(function (file) {
                file.relativePathOverride = path ? path + '/' + file.name : file.name;
                files.push(file);
                resolve();
              }, function () { resolve(); });
            });
          } else if (entry.isDirectory) {
            var dirReader = entry.createReader();
            var readEntries = await new Promise(function (resolve) {
              var results = [];
              function readBatch() {
                dirReader.readEntries(function (batch) {
                  if (!batch.length) resolve(results);
                  else { results = results.concat(Array.from(batch)); readBatch(); }
                }, function () { resolve(results); });
              }
              readBatch();
            });
            for (var j = 0; j < readEntries.length; j++) {
              await traverseEntry(readEntries[j], path ? path + '/' + entry.name : entry.name);
            }
          }
        }
        for (var k = 0; k < entries.length; k++) await traverseEntry(entries[k], '');
      } else {
        files = Array.from(dataTransfer.files || []);
      }
      addFiles(files);
    }

    dropZone.addEventListener('drop', function (event) {
      if (event.dataTransfer) handleDropDataTransfer(event.dataTransfer);
    });

    element('start-upload-btn').addEventListener('click', beginQueue);
    element('pause-upload-btn').addEventListener('click', togglePause);
    element('cancel-upload-btn').addEventListener('click', cancelQueue);

    element('submit-large-pass-btn').addEventListener('click', function () {
      var password = element('large-file-pass-input').value.trim();
      if (!password) { element('large-pass-status').textContent = 'Password is required for files over 1 GB.'; return; }
      pendingLargeItem.password = password;
      pendingLargeItem.status = 'ready';
      pendingLargeItem = null;
      element('large-file-modal').style.display = 'none';
      beginQueue();
    });
    element('cancel-large-pass-btn').addEventListener('click', function () {
      if (pendingLargeItem) pendingLargeItem.status = 'cancelled';
      pendingLargeItem = null;
      element('large-file-modal').style.display = 'none';
      renderQueue();
    });

    document.querySelectorAll('.tab-btn').forEach(function (tab) {
      tab.addEventListener('click', function () {
        switchMainTab(tab.dataset.tab);
      });
    });

    if (element('refresh-files-btn')) element('refresh-files-btn').addEventListener('click', loadFileList);

    bindCopyButton('copy-code-btn', function () { return element('res-short-code').textContent; }, 'Short code copied');
    bindCopyButton('copy-link-btn', function () { return element('res-share-link').value; }, 'Preview link copied');
    bindCopyButton('copy-direct-btn', function () { return element('res-direct-link').value; }, 'Direct download link copied');
    bindCopyButton('copy-curl-btn', function () { return element('res-curl-cmd').value; }, 'cURL command copied');
    bindCopyButton('copy-res-sha-btn', function () { return element('res-sha256-val').textContent; }, 'SHA-256 copied');

    if (element('res-qr-btn')) {
      element('res-qr-btn').addEventListener('click', function () {
        var panel = element('res-qr-panel');
        var btn = element('res-qr-btn');
        if (!panel) return;
        var open = panel.classList.toggle('is-open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
          var targetUrl = element('res-share-link').value || element('res-direct-link').value;
          renderQrInto(element('res-qr-box'), targetUrl, 136);
        }
      });
    }

    function closeDropModal() {
      var modal = element('drop-result-modal');
      if (modal) modal.classList.remove('is-open');
    }
    if (element('drop-modal-close-btn')) element('drop-modal-close-btn').addEventListener('click', closeDropModal);
    if (element('drop-modal-done-btn')) element('drop-modal-done-btn').addEventListener('click', closeDropModal);
    if (element('drop-result-modal')) {
      element('drop-result-modal').addEventListener('click', function (e) {
        if (e.target === element('drop-result-modal')) closeDropModal();
      });
    }
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDropModal();
    });

    element('delete-res-file-btn').addEventListener('click', async function () {
      if (!currentResultData || !currentResultData.deletionToken) {
        showNotice('Delete controls require the file deletion token returned with this upload.');
        return;
      }
      var fileId = currentResultData.code || currentResultData.shortId || currentResultData.id;
      if (!fileId) return;
      if (!window.confirm('Are you sure you want to permanently delete this file?')) return;
      try {
        var token = currentResultData.deletionToken;
        var res = await fetch('/api/drop/delete?fileId=' + encodeURIComponent(fileId), {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + token, 'X-Delete-Token': token }
        });
        var data = await res.json().catch(function () { return {}; });
        if (res.ok && data.success !== false) {
          showNotice('File deleted successfully.');
          element('result-card').style.display = 'none';
          closeDropModal();
        } else {
          showNotice('Failed to delete file: ' + (data.error || 'Server rejected deletion.'));
        }
      } catch (err) {
        showNotice('Error deleting file: ' + err.message);
      }
    });

    initLanControls();
    renderQueue();
  });
}());
