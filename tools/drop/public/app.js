(function () {
  var activeTab = 'direct';
  var pendingFile = null;
  var currentResultData = null;

  var ONE_GB = 1073741824; // 1 GB in bytes
  var formatBytes = window.PokeDbUtils.formatBytes;
  var getFileIcon = window.PokeDbUtils.getFileIcon;

  function showNotice(message) {
    var notice = document.getElementById('drop-notice');
    if (!notice) return;
    notice.textContent = message;
    notice.style.display = 'block';
  }

  function clearNotice() {
    var notice = document.getElementById('drop-notice');
    if (notice) notice.style.display = 'none';
  }

  function showProgress(percent, text) {
    var container = document.getElementById('progress-container');
    var fill = document.getElementById('progress-bar-fill');
    var textEl = document.getElementById('progress-status-text');
    var percentEl = document.getElementById('progress-percent-text');

    container.style.display = 'block';
    fill.style.width = Math.min(100, Math.max(0, percent)) + '%';
    if (text) textEl.textContent = text;
    percentEl.textContent = Math.round(percent) + '%';
  }

  function hideProgress() {
    document.getElementById('progress-container').style.display = 'none';
  }

  function displayResult(result) {
    hideProgress();
    currentResultData = result;

    var badgeMeta = document.getElementById('badge-meta');
    if (badgeMeta) {
      badgeMeta.textContent = formatBytes(result.size) + ' · Upload Complete ✓';
      badgeMeta.style.color = 'var(--accent)';
    }

    var card = document.getElementById('result-card');
    card.style.display = 'block';

    document.getElementById('res-file-icon').textContent = getFileIcon(result.name);
    document.getElementById('res-file-name').textContent = result.name || 'Uploaded File';
    document.getElementById('res-file-size').textContent = formatBytes(result.size);

    var downloadsCount = result.downloads || result.download_count || 0;
    document.getElementById('res-downloads-tag').textContent = '👁️ ' + downloadsCount + ' downloads';

    var providerEl = document.getElementById('res-storage-provider');
    if (result.provider === 'rootz' || result.isAnonymous === false) {
      providerEl.textContent = 'Rootz Account Storage';
      providerEl.style.borderColor = 'var(--accent)';
    } else {
      providerEl.textContent = 'Local Storage';
    }

    var fileCode = result.shortId || result.short_id || result.id;
    var viewerUrl = window.location.origin + '/v/' + fileCode;
    document.getElementById('res-share-link').value = viewerUrl;
    document.getElementById('open-link-btn').href = viewerUrl;

    var expiryEl = document.getElementById('res-expiry-info');
    if (result.expiresAt || result.expires_at) {
      var expDate = new Date(result.expiresAt || result.expires_at);
      expiryEl.textContent = '⏱ Expires: ' + expDate.toLocaleString();
    } else {
      expiryEl.textContent = '🔒 Permanent Storage Link';
    }
  }

  async function deleteFile(fileId, token, isLocal) {
    if (!confirm('Are you sure you want to permanently delete this file? This action cannot be undone.')) {
      return;
    }

    try {
      var query = 'fileId=' + encodeURIComponent(fileId);
      if (token) query += '&token=' + encodeURIComponent(token);
      if (isLocal) query += '&isLocal=true';

      var res = await fetch('/api/drop/delete?' + query, { method: 'DELETE' });
      var data = await res.json();

      if (res.ok && data.success) {
        alert('File deleted successfully.');
        document.getElementById('result-card').style.display = 'none';
        if (activeTab === 'manager') loadFileList();
      } else {
        alert('Failed to delete file: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Error connecting to server for file deletion.');
    }
  }

  function setFileListMessage(container, message, color, padding) {
    var item = document.createElement('div');
    item.style.cssText = 'color:' + color + '; text-align:center; padding:' + padding + '; font-family:"IBM Plex Mono",monospace;';
    item.textContent = message;
    container.replaceChildren(item);
  }

  function addFileListItem(container, file) {
    var fileCard = document.createElement('div');
    fileCard.style.cssText = 'background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:1rem; display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-wrap:wrap;';

    var details = document.createElement('div');
    details.style.cssText = 'display:flex; align-items:center; gap:.85rem; flex:1; min-width:200px;';
    var icon = document.createElement('span');
    icon.style.fontSize = '1.4rem';
    icon.textContent = getFileIcon(file.name);
    var textWrap = document.createElement('div');
    textWrap.style.overflow = 'hidden';
    var name = document.createElement('div');
    name.style.cssText = 'font-weight:600; font-size:.95rem; word-break:break-all;';
    name.textContent = file.name || 'File';
    var metadata = document.createElement('div');
    metadata.style.cssText = 'font-size:.78rem; color:var(--muted); font-family:"IBM Plex Mono",monospace; margin-top:.2rem;';
    metadata.textContent = formatBytes(file.size) + ' · 👁️ ' + (file.download_count || 0) + ' downloads · ' + (file.expires_at ? '⏱ ' + new Date(file.expires_at).toLocaleDateString() : '🔒 Permanent');
    textWrap.append(name, metadata);
    details.append(icon, textWrap);

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex; gap:.5rem; align-items:center;';
    var shareLink = file.short_id ? 'https://rootz.so/d/' + file.short_id : (window.location.origin + '/api/drop/file/' + file.id);
    var copyButton = document.createElement('button');
    copyButton.className = 'btn';
    copyButton.style.fontSize = '.78rem';
    copyButton.textContent = '$ copy';
    copyButton.addEventListener('click', function () {
      navigator.clipboard.writeText(shareLink);
      copyButton.textContent = '$ copied!';
      setTimeout(function () { copyButton.textContent = '$ copy'; }, 2000);
    });
    var openLink = document.createElement('a');
    openLink.className = 'btn';
    openLink.href = shareLink;
    openLink.target = '_blank';
    openLink.rel = 'noopener';
    openLink.style.fontSize = '.78rem';
    openLink.textContent = '$ open ↗';
    var deleteButton = document.createElement('button');
    deleteButton.className = 'btn';
    deleteButton.style.cssText = 'border-color:#ef4444; color:#ef4444; font-size:.78rem;';
    deleteButton.textContent = '🗑️ Delete';
    deleteButton.addEventListener('click', function () { deleteFile(file.id, null, false); });
    actions.append(copyButton, openLink, deleteButton);
    fileCard.append(details, actions);
    container.appendChild(fileCard);
  }

  async function loadFileList() {
    var container = document.getElementById('file-list-container');
    setFileListMessage(container, 'Loading files...', 'var(--muted)', '1rem');

    try {
      var res = await fetch('/api/drop/list');
      var json = await res.json();

      if (!res.ok || !json.success) {
        setFileListMessage(container, json.error || 'Failed to load file list', 'red', '1rem');
        return;
      }

      var files = json.data || [];
      if (files.length === 0) {
        setFileListMessage(container, 'No uploaded files found in your Rootz account.', 'var(--muted)', '1.5rem');
        return;
      }

      container.replaceChildren();
      files.forEach(function (file) { addFileListItem(container, file); });

    } catch (err) {
      setFileListMessage(container, 'Error loading file list from server.', 'red', '1rem');
    }
  }

  function uploadFile(file, password) {
    if (!file) return;
    clearNotice();

    var expiresSelect = document.getElementById('expires-in-select');
    var expDays = expiresSelect ? expiresSelect.value : 30;

    var formData = new FormData();
    formData.append('file', file);
    formData.append('expiresInDays', expDays);

    showProgress(0, 'Preparing file upload...');

    var startTime = Date.now();
    var lastLoaded = 0;
    var lastTime = startTime;

    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/drop/upload', true);

    if (password) {
      xhr.setRequestHeader('x-upload-password', password);
    }

    xhr.upload.addEventListener('progress', function (e) {
      if (e.lengthComputable) {
        var now = Date.now();
        var timeDiff = (now - lastTime) / 1000;
        if (timeDiff >= 0.2 || e.loaded === e.total) {
          var loadedDiff = e.loaded - lastLoaded;
          var speedBps = timeDiff > 0 ? (loadedDiff / timeDiff) : 0;
          lastLoaded = e.loaded;
          lastTime = now;

          var speedStr = formatBytes(speedBps) + '/s';
          var remainingBytes = e.total - e.loaded;
          var etaSec = speedBps > 0 ? Math.ceil(remainingBytes / speedBps) : 0;
          var etaStr = etaSec > 0 ? (' · ETA: ' + etaSec + 's') : '';

          var pct = (e.loaded / e.total) * 100;
          if (pct >= 99.5) {
            showProgress(100, 'Processing with Rootz storage...');
          } else {
            showProgress(pct, 'Uploading ' + file.name + ' (' + formatBytes(e.loaded) + ' / ' + formatBytes(e.total) + ') · ⚡ ' + speedStr + etaStr);
          }
        }
      }
    });

    xhr.onload = function () {
      if (xhr.status === 200) {
        try {
          var res = JSON.parse(xhr.responseText);
          displayResult(res);
        } catch (err) {
          showNotice('Upload completed, but the server returned an unreadable response.');
          hideProgress();
        }
      } else {
        try {
          var errData = JSON.parse(xhr.responseText);
          showNotice('Upload failed: ' + (errData.error || xhr.responseText));
        } catch (e) {
          showNotice('Upload failed: ' + (xhr.responseText || 'Server error'));
        }
        hideProgress();
      }
    };

    xhr.onerror = function () {
      showNotice('The upload connection was interrupted. Your file was not marked as complete; please retry.');
      hideProgress();
    };

    xhr.send(formData);
  }

  function updateDropBoxBadge(file) {
    var prompt = document.getElementById('drop-default-prompt');
    var badge = document.getElementById('drop-file-badge');
    var iconEl = document.getElementById('badge-icon');
    var nameEl = document.getElementById('badge-name');
    var metaEl = document.getElementById('badge-meta');

    if (!file) {
      if (prompt) prompt.style.display = 'block';
      if (badge) badge.style.display = 'none';
      return;
    }

    if (prompt) prompt.style.display = 'none';
    if (badge) badge.style.display = 'block';

    if (iconEl) iconEl.textContent = getFileIcon(file.name);
    if (nameEl) nameEl.textContent = file.name || 'Selected File';
    if (metaEl) metaEl.textContent = formatBytes(file.size) + ' · Uploading...';
  }

  function initiateFileUpload(file) {
    if (!file) return;
    updateDropBoxBadge(file);

    if (file.size > ONE_GB) {
      pendingFile = file;
      document.getElementById('large-file-size-label').textContent = formatBytes(file.size);
      document.getElementById('large-file-pass-input').value = '';
      document.getElementById('large-pass-status').textContent = '';
      document.getElementById('large-file-modal').style.display = 'block';
    } else {
      uploadFile(file, null);
    }
  }

  async function handleRemoteUpload(password) {
    var urlInput = document.getElementById('remote-url-input');
    var folderInput = document.getElementById('remote-folder-id');
    var targetUrl = urlInput.value.trim();

    if (!targetUrl) {
      showNotice('Enter a public HTTP or HTTPS file URL first.');
      return;
    }
    clearNotice();

    showProgress(25, 'Initiating remote URL upload via Rootz Account...');

    try {
      var headers = { 'Content-Type': 'application/json' };
      if (password) {
        headers['x-upload-password'] = password;
      }

      var res = await fetch('/api/drop/remote-upload', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          url: targetUrl,
          folderId: folderInput.value.trim() || null
        })
      });

      var data = await res.json();
      if (res.ok && data.success) {
        showProgress(100, 'Remote upload completed!');
        displayResult(data.data);
      } else {
        showNotice('Remote upload failed: ' + (data.error || 'Failed to process the remote URL.'));
        hideProgress();
      }
    } catch (err) {
      showNotice('Could not start the remote upload. Check your connection and try again.');
      hideProgress();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var tabs = document.querySelectorAll('.tab-btn');
    var dropZone = document.getElementById('drop-zone');
    var fileInput = document.getElementById('file-input');
    var remoteBtn = document.getElementById('remote-upload-btn');
    var refreshFilesBtn = document.getElementById('refresh-files-btn');
    var deleteResBtn = document.getElementById('delete-res-file-btn');

    // Password Modal elements
    var largeModal = document.getElementById('large-file-modal');
    var passInput = document.getElementById('large-file-pass-input');
    var submitPassBtn = document.getElementById('submit-large-pass-btn');
    var cancelPassBtn = document.getElementById('cancel-large-pass-btn');
    var passStatus = document.getElementById('large-pass-status');

    submitPassBtn.addEventListener('click', function () {
      var pass = passInput.value.trim();
      if (!pass) {
        passStatus.textContent = 'Password is required for files over 1 GB.';
        return;
      }
      largeModal.style.display = 'none';
      if (pendingFile) {
        uploadFile(pendingFile, pass);
        pendingFile = null;
      } else {
        handleRemoteUpload(pass);
      }
    });

    cancelPassBtn.addEventListener('click', function () {
      largeModal.style.display = 'none';
      pendingFile = null;
    });

    // Tab Switching
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('is-active'); });
        tab.classList.add('is-active');
        activeTab = tab.getAttribute('data-tab');

        document.getElementById('tab-content-direct').style.display = activeTab === 'direct' ? 'block' : 'none';
        document.getElementById('tab-content-remote').style.display = activeTab === 'remote' ? 'block' : 'none';
        document.getElementById('tab-content-manager').style.display = activeTab === 'manager' ? 'block' : 'none';

        if (activeTab === 'manager') {
          loadFileList();
        }
      });
    });

    if (refreshFilesBtn) {
      refreshFilesBtn.addEventListener('click', loadFileList);
    }

    if (deleteResBtn) {
      deleteResBtn.addEventListener('click', function () {
        if (!currentResultData) return;
        var fileId = currentResultData.id;
        var token = currentResultData.deletionToken || currentResultData.deletion_token;
        var isLocal = currentResultData.provider === 'local';
        deleteFile(fileId, token, isLocal);
      });
    }

    // Drag & Drop
    dropZone.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) {
        initiateFileUpload(e.target.files[0]);
      }
    });

    ['dragenter', 'dragover'].forEach(function (evt) {
      dropZone.addEventListener(evt, function (e) {
        e.preventDefault();
        dropZone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(function (evt) {
      dropZone.addEventListener(evt, function (e) {
        e.preventDefault();
        dropZone.classList.remove('dragover');
      });
    });

    dropZone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        initiateFileUpload(e.dataTransfer.files[0]);
      }
    });

    // Remote Upload Button
    remoteBtn.addEventListener('click', function () {
      handleRemoteUpload(null);
    });

    // Copy Link Button
    document.getElementById('copy-link-btn').addEventListener('click', function () {
      var input = document.getElementById('res-share-link');
      input.select();
      navigator.clipboard.writeText(input.value);
      this.textContent = '$ copied!';
      var b = this;
      setTimeout(function () { b.textContent = '$ copy'; }, 2000);
    });
  });
})();
