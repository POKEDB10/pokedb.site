(function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────
  var MULTIPART_THRESHOLD = 50 * 1024 * 1024; // 50 MB
  var ONE_GB = 1073741824;

  // ─── State ────────────────────────────────────────────────────────────────
  var queue = [];
  var activeUpload = null;   // { xhr } for small files  |  { abortController, chunkXhrs } for multipart
  var starting = false;
  var paused = false;
  var pendingLargeItem = null;
  var currentResultData = null;
  var activeTab = 'direct';
  var activeFolderBatch = null;

  var formatBytes = window.PokeDbUtils.formatBytes;
  var getFileIcon = window.PokeDbUtils.getFileIcon;

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function element(id) { return document.getElementById(id); }
  function showNotice(msg) { element('drop-notice').textContent = msg; element('drop-notice').style.display = 'block'; }
  function clearNotice() { element('drop-notice').style.display = 'none'; }

  function formatSizeAuto(bytes) {
    var num = Number(bytes) || 0;
    if (num >= 1073741824) {
      return (num / 1073741824).toFixed(2).replace(/\.00$/, '') + 'gb';
    }
    if (num >= 1048576) {
      return (num / 1048576).toFixed(1).replace(/\.0$/, '') + 'mb';
    }
    if (num >= 1024) {
      return (num / 1024).toFixed(0) + 'kb';
    }
    return num + 'b';
  }

  function setProgress(percent, text) {
    element('progress-container').style.display = 'block';
    element('progress-bar-fill').style.width = Math.max(0, Math.min(100, percent)) + '%';
    element('progress-status-text').textContent = text;
    element('progress-percent-text').textContent = Math.round(percent) + '%';
  }
  function hideProgress() { element('progress-container').style.display = 'none'; }

  function updateControls() {
    var hasPending = queue.some(function (item) { return item.status === 'ready' || item.status === 'paused' || item.status === 'failed'; });
    element('start-upload-btn').disabled = !hasPending || Boolean(activeUpload) || starting;
    element('pause-upload-btn').disabled = !activeUpload && !paused;
    element('pause-upload-btn').textContent = paused ? 'Resume queue' : 'Pause queue';
    element('cancel-upload-btn').disabled = !activeUpload && !hasPending;
  }

  function removeItemFromQueue(item) {
    var index = queue.indexOf(item);
    if (index > -1) {
      if (item.status === 'uploading') {
        abortActiveUpload();
      }
      queue.splice(index, 1);
    }
    if (!queue.length) {
      element('drop-default-prompt').style.display = 'block';
      element('drop-file-badge').style.display = 'none';
      hideProgress();
      clearNotice();
      activeFolderBatch = null;
    } else {
      updateBadgeInfo();
    }
    renderQueue();
  }

  function updateBadgeInfo() {
    if (!queue.length) return;
    var first = queue[0];
    if (queue.length === 1) {
      element('badge-icon').textContent = getFileIcon(first.file.name);
      element('badge-name').textContent = first.file.name;
      element('badge-meta').textContent = formatBytes(first.file.size) + ' · Ready to upload';
    } else {
      var totalBytes = queue.reduce(function (sum, i) { return sum + i.file.size; }, 0);
      element('badge-icon').textContent = '📁';
      element('badge-name').textContent = queue.length + ' items selected';
      element('badge-meta').textContent = formatBytes(totalBytes) + ' · Ready to upload as a folder (' + formatSizeAuto(totalBytes) + ')';
    }
  }

  function renderQueue() {
    var container = element('upload-queue');
    container.replaceChildren();
    if (!queue.length) return;
    queue.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'queue-item';
      var icon = document.createElement('span');
      icon.textContent = getFileIcon(item.file.name);
      var details = document.createElement('div');
      var name = document.createElement('div');
      name.className = 'queue-name';
      name.textContent = item.path;
      var meta = document.createElement('span');
      meta.className = 'queue-meta';
      meta.textContent = formatBytes(item.file.size) + ' · ' + (item.status === 'uploading' ? item.progress + '%' : item.status);
      details.append(name, meta);
      var state = document.createElement('span');
      state.className = 'queue-status';
      state.textContent = item.status;

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-queue-btn';
      removeBtn.title = 'Remove item from queue';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        removeItemFromQueue(item);
      });

      row.append(icon, details, state, removeBtn);
      container.appendChild(row);
    });
    updateControls();
  }

  function addFiles(files) {
    Array.from(files).forEach(function (file) {
      queue.push({ file: file, path: file.webkitRelativePath || file.name, status: 'ready', progress: 0, password: null });
    });
    if (queue.length) {
      element('drop-default-prompt').style.display = 'none';
      element('drop-file-badge').style.display = 'block';
      updateBadgeInfo();
      clearNotice();
    }
    renderQueue();
  }

  function showLargeFilePrompt(item) {
    pendingLargeItem = item;
    element('large-file-size-label').textContent = formatBytes(item.file.size);
    element('large-file-pass-input').value = '';
    element('large-pass-status').textContent = '';
    element('large-file-modal').style.display = 'block';
  }

  function nextItem() {
    return queue.find(function (item) { return item.status === 'ready' || item.status === 'paused' || item.status === 'failed'; });
  }

  // ─── Queue orchestration ──────────────────────────────────────────────────
  async function beginQueue() {
    if (activeUpload || starting) return;
    starting = true;
    updateControls();
    try {
      await fetch('/api/drop/status', { cache: 'no-store' });
    } catch (error) {
    } finally {
      starting = false;
      updateControls();
    }
    paused = false;

    var pendingItems = queue.filter(function (item) { return item.status === 'ready' || item.status === 'paused' || item.status === 'failed'; });
    if (!pendingItems.length) { hideProgress(); updateControls(); return; }

    // If multiple items are selected in queue, create a server folder
    if (pendingItems.length > 1 && !activeFolderBatch) {
      try {
        var totalBytes = pendingItems.reduce(function (sum, item) { return sum + item.file.size; }, 0);
        var sizeStr = formatSizeAuto(totalBytes);
        var randStr = Math.random().toString(36).substring(2, 8);
        var folderName = 'pokedb-' + randStr + '-' + sizeStr;

        var folderRes = await fetch('/api/drop/create-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: folderName, totalSize: totalBytes, fileCount: pendingItems.length })
        });
        var folderData = await folderRes.json();
        if (folderRes.ok && folderData.success) {
          activeFolderBatch = {
            folderId: folderData.folderId,
            folderCode: folderData.folderCode,
            name: folderData.name,
            totalSize: totalBytes,
            viewUrl: folderData.viewUrl,
            fileCount: pendingItems.length
          };
        }
      } catch (e) {
        console.warn('Failed to create folder for batch upload:', e);
      }
    }

    var item = nextItem();
    if (!item) { hideProgress(); updateControls(); return; }
    if (item.file.size > ONE_GB && !item.password) { showLargeFilePrompt(item); updateControls(); return; }
    uploadItem(item);
  }

  function uploadItem(item) {
    if (item.file.size >= MULTIPART_THRESHOLD) {
      uploadItemMultipart(item);
    } else {
      uploadItemDirect(item);
    }
  }

  // ─── Direct upload ────────────────────────────────────────────────────────
  function uploadItemDirect(item) {
    clearNotice();
    item.status = 'uploading';
    item.progress = 0;
    renderQueue();

    var formData = new FormData();
    formData.append('file', item.file);
    formData.append('expiresInDays', element('expires-in-select').value);
    formData.append('relativePath', item.path);
    if (activeFolderBatch) {
      formData.append('folderCode', activeFolderBatch.folderCode);
      if (activeFolderBatch.folderId) formData.append('folderId', activeFolderBatch.folderId);
    }

    var xhr = new XMLHttpRequest();
    activeUpload = { xhr: xhr };
    xhr.open('POST', '/api/drop/upload', true);
    if (item.password) xhr.setRequestHeader('x-upload-password', item.password);

    var lastTime = Date.now();
    var lastLoaded = 0;
    xhr.upload.addEventListener('progress', function (event) {
      if (!event.lengthComputable) return;
      item.progress = Math.round((event.loaded / event.total) * 100);
      var now = Date.now();
      var elapsed = (now - lastTime) / 1000;
      var speed = elapsed ? (event.loaded - lastLoaded) / elapsed : 0;
      if (elapsed > 0.2 || event.loaded === event.total) { lastTime = now; lastLoaded = event.loaded; }
      setProgress(item.progress, 'Uploading ' + item.file.name + ' · ' + formatBytes(event.loaded) + ' / ' + formatBytes(event.total) + (speed ? ' · ' + formatBytes(speed) + '/s' : ''));
      renderQueue();
    });

    xhr.onload = function () {
      activeUpload = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var result = JSON.parse(xhr.responseText);
          item.status = 'complete'; item.progress = 100;
          renderQueue();
          var remaining = nextItem();
          if (!remaining && activeFolderBatch) {
            displayFolderResult(activeFolderBatch);
            activeFolderBatch = null;
          } else if (!activeFolderBatch) {
            displayResult(result);
          }
          beginQueue();
        } catch (e) { item.status = 'failed'; showNotice('Upload completed but the response could not be read.'); renderQueue(); }
      } else {
        item.status = 'failed';
        try { showNotice('Upload failed: ' + (JSON.parse(xhr.responseText).error || 'Server error')); } catch (e) { showNotice('Upload failed. Please retry this item.'); }
        renderQueue();
      }
    };
    xhr.onabort = function () { activeUpload = null; item.status = paused ? 'paused' : 'cancelled'; renderQueue(); };
    xhr.onerror = function () { activeUpload = null; item.status = 'failed'; showNotice('The upload connection was interrupted. You can retry the item.'); renderQueue(); };
    xhr.send(formData);
  }

  // ─── Parallel multipart upload (≥ 4 MB) ──────────────────────────────────
  //
  // Flow: init → batch-urls → parallel PUT chunks → complete
  // Parallelism: 3-6 concurrent chunks depending on file size (matches Rootz web UI).
  // Pause/Stop: abort controller + per-chunk XHR abort.
  //
  function getParallelism(fileSize) {
    if (fileSize > 50 * 1024 * 1024 * 1024) return 3;
    if (fileSize > 10 * 1024 * 1024 * 1024) return 4;
    if (fileSize > 1 * 1024 * 1024 * 1024) return 5;
    return 6;
  }

  async function uploadItemMultipart(item) {
    clearNotice();
    item.status = 'uploading';
    item.progress = 0;
    renderQueue();

    var abortController = new AbortController();
    var chunkXhrs = [];
    activeUpload = { abortController: abortController, chunkXhrs: chunkXhrs };

    var signal = abortController.signal;
    var file = item.file;
    var fileSize = file.size;
    var fileName = file.name;
    var mimeType = file.type || 'application/octet-stream';
    var expiresInDays = element('expires-in-select').value;

    try {
      // 1. Initialize multipart session
      setProgress(0, 'Initializing upload for ' + fileName + '…');
      var initBody = {
        fileName: fileName,
        fileSize: fileSize,
        fileType: mimeType
      };
      if (activeFolderBatch) {
        initBody.folderCode = activeFolderBatch.folderCode;
        if (activeFolderBatch.folderId) initBody.folderId = activeFolderBatch.folderId;
      }
      if (item.password) {
        // Server reads the password from this header
        // (multipart/init proxies it on the server side through verifyLargeFilePassword)
      }
      var headers = { 'Content-Type': 'application/json' };
      if (item.password) headers['x-upload-password'] = item.password;

      var initRes = await fetch('/api/drop/multipart/init', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(initBody),
        signal: signal
      });
      var initData = await initRes.json();
      if (!initRes.ok) throw new Error(initData.error || 'Failed to initialize upload.');

      var uploadId = initData.uploadId;
      var key = initData.key;
      var chunkSize = initData.chunkSize;
      var totalParts = initData.totalParts;

      if (!uploadId || !key || !chunkSize || !totalParts) {
        throw new Error('Rootz returned incomplete multipart init data.');
      }

      // 2. Fetch all presigned URLs in one call
      setProgress(0, 'Getting presigned URLs for ' + totalParts + ' parts…');
      var batchRes = await fetch('/api/drop/multipart/batch-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key, uploadId: uploadId, totalParts: totalParts }),
        signal: signal
      });
      var batchData = await batchRes.json();
      if (!batchRes.ok || !batchData.success) throw new Error(batchData.error || 'Failed to get presigned URLs.');

      var urlsDict = batchData.urls; // { "1": "https://...", "2": "https://...", ... }

      // 3. Upload all parts in parallel with bounded concurrency
      var parallelism = getParallelism(fileSize);
      var completedParts = 0;
      var uploadedParts = [];
      var startTime = Date.now();
      var uploadedBytes = 0;

      // Build part descriptor list
      var partDescriptors = [];
      for (var i = 1; i <= totalParts; i++) {
        partDescriptors.push({ partNumber: i, url: urlsDict[String(i)] });
      }

      // Semaphore-style parallel execution
      async function uploadPart(descriptor) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        var partNumber = descriptor.partNumber;
        var url = descriptor.url;
        var start = (partNumber - 1) * chunkSize;
        var end = Math.min(start + chunkSize, fileSize);
        var chunk = file.slice(start, end);

        // Retry up to 3 times with exponential backoff
        for (var attempt = 0; attempt < 3; attempt++) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          try {
            var etag = await new Promise(function (resolve, reject) {
              var xhr = new XMLHttpRequest();
              chunkXhrs.push(xhr);
              xhr.open('PUT', url, true);
              xhr.onload = function () {
                chunkXhrs.splice(chunkXhrs.indexOf(xhr), 1);
                if (xhr.status >= 200 && xhr.status < 300) {
                  var rawEtag = xhr.getResponseHeader('ETag') || '';
                  resolve(rawEtag.replace(/"/g, ''));
                } else {
                  reject(new Error('Part ' + partNumber + ' failed with HTTP ' + xhr.status));
                }
              };
              xhr.onerror = function () {
                chunkXhrs.splice(chunkXhrs.indexOf(xhr), 1);
                reject(new Error('Network error on part ' + partNumber));
              };
              xhr.onabort = function () {
                chunkXhrs.splice(chunkXhrs.indexOf(xhr), 1);
                reject(new DOMException('Aborted', 'AbortError'));
              };
              signal.addEventListener('abort', function () { xhr.abort(); }, { once: true });
              xhr.send(chunk);
            });

            uploadedParts.push({ partNumber: partNumber, etag: etag });
            completedParts++;
            uploadedBytes += (end - start);

            // Update progress
            var elapsed = (Date.now() - startTime) / 1000;
            var speed = elapsed > 0 ? uploadedBytes / elapsed : 0;
            var pct = (completedParts / totalParts) * 100;
            var eta = speed > 0 ? ((fileSize - uploadedBytes) / speed) : 0;
            var etaStr = eta > 3600 ? (eta / 3600).toFixed(1) + 'h' : eta > 60 ? (eta / 60).toFixed(0) + 'm' : Math.round(eta) + 's';
            setProgress(pct,
              'Uploading ' + fileName + ' · ' +
              formatBytes(uploadedBytes) + ' / ' + formatBytes(fileSize) + ' · ' +
              formatBytes(speed) + '/s · ETA ' + etaStr +
              ' · [' + completedParts + '/' + totalParts + ' parts, ' + parallelism + 'x parallel]'
            );
            item.progress = Math.round(pct);
            renderQueue();
            return;
          } catch (err) {
            if (err.name === 'AbortError') throw err;
            if (attempt === 2) throw err;
            // Exponential backoff: 1s, 2s
            await new Promise(function (r) { setTimeout(r, 1000 * Math.pow(2, attempt)); });
          }
        }
      }

      // Parallel pool executor
      var index = 0;
      async function worker() {
        while (index < partDescriptors.length) {
          if (signal.aborted) return;
          var descriptor = partDescriptors[index++];
          await uploadPart(descriptor);
        }
      }

      var workers = [];
      for (var w = 0; w < parallelism; w++) {
        workers.push(worker());
      }
      await Promise.all(workers);

      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      // Sort parts by partNumber (required by Rootz)
      uploadedParts.sort(function (a, b) { return a.partNumber - b.partNumber; });

      // 4. Complete the multipart upload
      setProgress(99, 'Finalizing ' + fileName + '…');
      var completeBody = {
        key: key,
        uploadId: uploadId,
        parts: uploadedParts,
        fileName: fileName,
        fileSize: fileSize,
        contentType: mimeType
      };
      if (activeFolderBatch) {
        completeBody.folderCode = activeFolderBatch.folderCode;
        if (activeFolderBatch.folderId) completeBody.folderId = activeFolderBatch.folderId;
      }
      var completeHeaders = { 'Content-Type': 'application/json' };
      if (item.password) completeHeaders['x-upload-password'] = item.password;

      var completeRes = await fetch('/api/drop/multipart/complete', {
        method: 'POST',
        headers: completeHeaders,
        body: JSON.stringify(completeBody),
        signal: signal
      });
      var completeData = await completeRes.json();
      if (!completeRes.ok || !completeData.success) {
        throw new Error(completeData.error || 'Failed to finalize upload.');
      }

      // Build a result compatible with displayResult()
      var fileRecord = completeData.file || {};
      var result = {
        success: true,
        id: fileRecord.shortId || fileRecord.id,
        shortId: fileRecord.shortId || fileRecord.id,
        name: fileRecord.name || fileName,
        size: fileRecord.size || fileSize,
        mimeType: mimeType,
        url: fileRecord.url || ('https://rootz.so/d/' + (fileRecord.shortId || fileRecord.id)),
        viewUrl: fileRecord.viewUrl,
        expiresAt: fileRecord.expiresAt || null,
        provider: 'rootz',
        createdAt: new Date().toISOString(),
        relativePath: item.path,
        deletionToken: fileRecord.deletionToken
      };

      activeUpload = null;
      item.status = 'complete';
      item.progress = 100;
      setProgress(100, 'Upload complete: ' + fileName);
      renderQueue();
      var remaining = nextItem();
      if (!remaining && activeFolderBatch) {
        displayFolderResult(activeFolderBatch);
        activeFolderBatch = null;
      } else if (!activeFolderBatch) {
        displayResult(result);
      }
      beginQueue();

    } catch (err) {
      activeUpload = null;
      if (err.name === 'AbortError') {
        item.status = paused ? 'paused' : 'cancelled';
      } else {
        item.status = 'failed';
        showNotice('Upload failed: ' + (err.message || 'Unknown error'));
      }
      renderQueue();
    }
  }

  // ─── Pause / Cancel ───────────────────────────────────────────────────────
  function abortActiveUpload() {
    if (!activeUpload) return;
    if (activeUpload.xhr) {
      activeUpload.xhr.abort();
    }
    if (activeUpload.abortController) {
      activeUpload.abortController.abort();
      // Abort any in-flight chunk XHRs immediately
      (activeUpload.chunkXhrs || []).forEach(function (xhr) { try { xhr.abort(); } catch (e) {} });
    }
  }

  function togglePause() {
    if (paused) { beginQueue(); return; }
    paused = true;
    abortActiveUpload();
    updateControls();
  }

  function cancelQueue() {
    paused = false;
    abortActiveUpload();
    queue.forEach(function (item) { if (item.status === 'ready' || item.status === 'paused') item.status = 'cancelled'; });
    renderQueue();
    hideProgress();
  }

  // ─── Result display ───────────────────────────────────────────────────────
  function displayResult(result) {
    currentResultData = result;
    element('result-card').style.display = 'block';
    element('res-file-icon').textContent = getFileIcon(result.name || 'file');
    element('res-file-name').textContent = result.name || 'Uploaded file';
    element('res-file-size').textContent = formatBytes(result.size || 0);
    element('res-storage-provider').textContent = result.provider === 'rootz' ? 'Rootz storage' : 'Storage';
    element('res-downloads-tag').textContent = '0 downloads';
    var code = result.shortId || result.short_id || result.id;
    var viewerUrl = window.location.origin + '/v/' + code;
    element('res-share-link').value = viewerUrl;
    element('open-link-btn').href = viewerUrl;
    element('res-expiry-info').textContent = result.expiresAt ? 'Expires: ' + new Date(result.expiresAt).toLocaleString() : 'Permanent storage link';
  }

  function displayFolderResult(batch) {
    currentResultData = batch;
    element('result-card').style.display = 'block';
    element('res-file-icon').textContent = '📁';
    element('res-file-name').textContent = batch.name;
    element('res-file-size').textContent = formatBytes(batch.totalSize) + ' · ' + batch.fileCount + ' files in folder';
    element('res-storage-provider').textContent = 'Pokedb Drop Folder';
    element('res-downloads-tag').textContent = batch.fileCount + ' items';
    var viewerUrl = batch.viewUrl || (window.location.origin + '/v/' + batch.folderCode);
    element('res-share-link').value = viewerUrl;
    element('open-link-btn').href = viewerUrl;
    element('res-expiry-info').textContent = 'Multi-file folder batch';
  }

  // ─── File manager ─────────────────────────────────────────────────────────
  function addFileListItem(container, file) {
    var row = document.createElement('div'); row.className = 'queue-item';
    var isFolder = file.type === 'folder' || file.kind === 'folder' || file.is_folder === true || Boolean(file.folder_id && !file.name && !file.filename);
    var icon = document.createElement('span'); icon.textContent = isFolder ? '📁' : getFileIcon(file.name || 'file');
    var details = document.createElement('div');
    var name = document.createElement('div'); name.className = 'queue-name'; name.textContent = file.name || file.filename || file.folder_name || 'File';
    var meta = document.createElement('span'); meta.className = 'queue-meta'; meta.textContent = isFolder ? 'Folder · click Open to browse its contents' : formatBytes(Number(file.size || 0)) + ' · ' + (file.folder_name || file.folderId || 'Root folder');
    details.append(name, meta);
    var open = document.createElement(isFolder ? 'button' : 'a'); open.className = 'btn'; open.textContent = 'Open';
    if (isFolder) {
      open.type = 'button';
      open.addEventListener('click', function () { element('manager-folder-id').value = file.folder_id || file.folderId || file.id; loadFileList(); });
    } else { open.target = '_blank'; open.rel = 'noopener'; open.href = window.location.origin + '/v/' + (file.short_id || file.id || file.filecode); }
    row.append(icon, details, open); container.appendChild(row);
  }

  async function loadFileList() {
    var container = element('file-list-container');
    var token = element('manager-token-input').value.trim();
    if (!token) { container.textContent = 'Enter the Render ADMIN_TOKEN to view your Rootz file manager.'; return; }
    sessionStorage.setItem('pokedb-admin-token', token);
    container.textContent = 'Loading files…';
    var params = new URLSearchParams();
    var folderId = element('manager-folder-id').value.trim(); if (folderId) params.set('folderId', folderId);
    try {
      var response = await fetch('/api/drop/list?' + params, { headers: { 'X-Admin-Token': token } });
      var data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load files');
      var payload = data.data || data.result || data;
      var files = Array.isArray(payload) ? payload : (payload.files || data.files || []);
      var folders = Array.isArray(payload.folders) ? payload.folders : (Array.isArray(data.folders) ? data.folders : []);
      files = folders.concat(files);
      container.replaceChildren();
      if (!files.length) { container.textContent = 'No files in this folder.'; return; }
      files.forEach(function (file) { addFileListItem(container, file); });
    } catch (error) { container.textContent = error.message; }
  }

  // ─── DOM wiring ───────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    var storedToken = sessionStorage.getItem('pokedb-admin-token');
    if (storedToken) element('manager-token-input').value = storedToken;

    var fileInput = element('file-input');
    var dropZone = element('drop-zone');

    dropZone.addEventListener('click', function (event) {
      if (event.target === dropZone || event.target.closest('#drop-default-prompt')) fileInput.click();
    });
    fileInput.addEventListener('change', function (event) { addFiles(event.target.files); fileInput.value = ''; });
    ['dragenter', 'dragover'].forEach(function (name) {
      dropZone.addEventListener(name, function (event) { event.preventDefault(); dropZone.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      dropZone.addEventListener(name, function (event) { event.preventDefault(); dropZone.classList.remove('dragover'); });
    });
    dropZone.addEventListener('drop', function (event) { if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files); });

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
        document.querySelectorAll('.tab-btn').forEach(function (button) { button.classList.remove('is-active'); });
        tab.classList.add('is-active');
        activeTab = tab.dataset.tab;
        element('tab-content-direct').style.display = activeTab === 'direct' ? 'block' : 'none';
        element('tab-content-remote').style.display = activeTab === 'remote' ? 'block' : 'none';
        element('tab-content-manager').style.display = activeTab === 'manager' ? 'block' : 'none';
        if (activeTab === 'manager') loadFileList();
      });
    });

    element('refresh-files-btn').addEventListener('click', loadFileList);

    element('remote-upload-btn').addEventListener('click', async function () {
      var url = element('remote-url-input').value.trim();
      if (!url) { showNotice('Enter a public URL first.'); return; }
      try {
        var response = await fetch('/api/drop/remote-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url })
        });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Remote upload failed');
        displayResult(data.data);
      } catch (error) { showNotice(error.message); }
    });

    element('copy-link-btn').addEventListener('click', function () {
      navigator.clipboard.writeText(element('res-share-link').value);
      this.textContent = 'Copied';
      var button = this;
      setTimeout(function () { button.textContent = '$ copy'; }, 1500);
    });

    element('delete-res-file-btn').addEventListener('click', function () {
      showNotice('Delete controls require the file deletion token returned with this upload.');
    });

    renderQueue();
  });
}());
