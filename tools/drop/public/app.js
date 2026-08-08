(function () {
  'use strict';
  var ONE_GB = 1073741824;
  var queue = [];
  var activeUpload = null;
  var paused = false;
  var pendingLargeItem = null;
  var currentResultData = null;
  var activeTab = 'direct';
  var formatBytes = window.PokeDbUtils.formatBytes;
  var getFileIcon = window.PokeDbUtils.getFileIcon;

  function element(id) { return document.getElementById(id); }
  function showNotice(message) { element('drop-notice').textContent = message; element('drop-notice').style.display = 'block'; }
  function clearNotice() { element('drop-notice').style.display = 'none'; }
  function setProgress(percent, text) { element('progress-container').style.display = 'block'; element('progress-bar-fill').style.width = Math.max(0, Math.min(100, percent)) + '%'; element('progress-status-text').textContent = text; element('progress-percent-text').textContent = Math.round(percent) + '%'; }
  function hideProgress() { element('progress-container').style.display = 'none'; }

  function updateControls() {
    var hasPending = queue.some(function (item) { return item.status === 'ready' || item.status === 'paused' || item.status === 'failed'; });
    element('start-upload-btn').disabled = !hasPending || Boolean(activeUpload);
    element('pause-upload-btn').disabled = !activeUpload && !paused;
    element('pause-upload-btn').textContent = paused ? 'Resume queue' : 'Pause queue';
    element('cancel-upload-btn').disabled = !activeUpload && !hasPending;
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
      row.append(icon, details, state);
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
      var first = queue[0];
      element('badge-icon').textContent = getFileIcon(first.file.name);
      element('badge-name').textContent = queue.length === 1 ? first.file.name : queue.length + ' items selected';
      element('badge-meta').textContent = queue.length === 1 ? formatBytes(first.file.size) + ' · Ready to upload' : 'Ready to upload as a queue';
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

  function nextItem() { return queue.find(function (item) { return item.status === 'ready' || item.status === 'paused' || item.status === 'failed'; }); }

  function beginQueue() {
    if (activeUpload) return;
    paused = false;
    var item = nextItem();
    if (!item) { hideProgress(); updateControls(); return; }
    if (item.file.size > ONE_GB && !item.password) { showLargeFilePrompt(item); updateControls(); return; }
    uploadItem(item);
  }

  function uploadItem(item) {
    clearNotice();
    item.status = 'uploading';
    item.progress = 0;
    renderQueue();
    var formData = new FormData();
    formData.append('file', item.file);
    formData.append('expiresInDays', element('expires-in-select').value);
    formData.append('relativePath', item.path);
    var xhr = new XMLHttpRequest();
    activeUpload = { xhr: xhr, item: item };
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
      if (elapsed > .2 || event.loaded === event.total) { lastTime = now; lastLoaded = event.loaded; }
      setProgress(item.progress, 'Uploading ' + item.file.name + ' · ' + formatBytes(event.loaded) + ' / ' + formatBytes(event.total) + (speed ? ' · ' + formatBytes(speed) + '/s' : ''));
      renderQueue();
    });
    xhr.onload = function () {
      activeUpload = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var result = JSON.parse(xhr.responseText);
          item.status = 'complete'; item.progress = 100;
          displayResult(result);
          renderQueue();
          beginQueue();
        } catch (error) { item.status = 'failed'; showNotice('Upload completed but the response could not be read.'); renderQueue(); }
      } else {
        item.status = 'failed';
        try { showNotice('Upload failed: ' + (JSON.parse(xhr.responseText).error || 'Server error')); } catch (error) { showNotice('Upload failed. Please retry this item.'); }
        renderQueue();
      }
    };
    xhr.onabort = function () {
      activeUpload = null;
      item.status = paused ? 'paused' : 'cancelled';
      renderQueue();
    };
    xhr.onerror = function () { activeUpload = null; item.status = 'failed'; showNotice('The upload connection was interrupted. You can retry the item.'); renderQueue(); };
    xhr.send(formData);
  }

  function togglePause() {
    if (paused) { beginQueue(); return; }
    paused = true;
    if (activeUpload) activeUpload.xhr.abort();
    updateControls();
  }

  function cancelQueue() {
    paused = false;
    if (activeUpload) activeUpload.xhr.abort();
    queue.forEach(function (item) { if (item.status === 'ready' || item.status === 'paused') item.status = 'cancelled'; });
    renderQueue(); hideProgress();
  }

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

  document.addEventListener('DOMContentLoaded', function () {
    var storedToken = sessionStorage.getItem('pokedb-admin-token'); if (storedToken) element('manager-token-input').value = storedToken;
    var fileInput = element('file-input'); var dropZone = element('drop-zone');
    dropZone.addEventListener('click', function (event) { if (event.target === dropZone || event.target.closest('#drop-default-prompt')) fileInput.click(); });
    fileInput.addEventListener('change', function (event) { addFiles(event.target.files); fileInput.value = ''; });
    ['dragenter', 'dragover'].forEach(function (name) { dropZone.addEventListener(name, function (event) { event.preventDefault(); dropZone.classList.add('dragover'); }); });
    ['dragleave', 'drop'].forEach(function (name) { dropZone.addEventListener(name, function (event) { event.preventDefault(); dropZone.classList.remove('dragover'); }); });
    dropZone.addEventListener('drop', function (event) { if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files); });
    element('start-upload-btn').addEventListener('click', beginQueue);
    element('pause-upload-btn').addEventListener('click', togglePause);
    element('cancel-upload-btn').addEventListener('click', cancelQueue);
    element('submit-large-pass-btn').addEventListener('click', function () { var password = element('large-file-pass-input').value.trim(); if (!password) { element('large-pass-status').textContent = 'Password is required for files over 1 GB.'; return; } pendingLargeItem.password = password; pendingLargeItem.status = 'ready'; pendingLargeItem = null; element('large-file-modal').style.display = 'none'; beginQueue(); });
    element('cancel-large-pass-btn').addEventListener('click', function () { if (pendingLargeItem) pendingLargeItem.status = 'cancelled'; pendingLargeItem = null; element('large-file-modal').style.display = 'none'; renderQueue(); });
    document.querySelectorAll('.tab-btn').forEach(function (tab) { tab.addEventListener('click', function () { document.querySelectorAll('.tab-btn').forEach(function (button) { button.classList.remove('is-active'); }); tab.classList.add('is-active'); activeTab = tab.dataset.tab; element('tab-content-direct').style.display = activeTab === 'direct' ? 'block' : 'none'; element('tab-content-remote').style.display = activeTab === 'remote' ? 'block' : 'none'; element('tab-content-manager').style.display = activeTab === 'manager' ? 'block' : 'none'; if (activeTab === 'manager') loadFileList(); }); });
    element('refresh-files-btn').addEventListener('click', loadFileList);
    element('remote-upload-btn').addEventListener('click', async function () { var url = element('remote-url-input').value.trim(); if (!url) { showNotice('Enter a public URL first.'); return; } try { var response = await fetch('/api/drop/remote-upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url }) }); var data = await response.json(); if (!response.ok) throw new Error(data.error || 'Remote upload failed'); displayResult(data.data); } catch (error) { showNotice(error.message); } });
    element('copy-link-btn').addEventListener('click', function () { navigator.clipboard.writeText(element('res-share-link').value); this.textContent = 'Copied'; var button = this; setTimeout(function () { button.textContent = '$ copy'; }, 1500); });
    element('delete-res-file-btn').addEventListener('click', function () { showNotice('Delete controls require the file deletion token returned with this upload.'); });
    renderQueue();
  });
}());
