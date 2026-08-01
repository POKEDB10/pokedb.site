(function () {
  var activeTab = 'direct';
  var pendingFile = null;
  var currentResultData = null;

  var ONE_GB = 1073741824; // 1 GB in bytes

  function formatBytes(bytes) {
    if (!bytes || isNaN(bytes)) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function getFileIcon(filename) {
    var ext = (filename || '').split('.').pop().toLowerCase();
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return '🎥';
    if (['mp3', 'wav', 'flac', 'ogg', 'm4a'].includes(ext)) return '🎵';
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return '🖼️';
    if (['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext)) return '📄';
    if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return '📦';
    if (['js', 'ts', 'py', 'json', 'html', 'css', 'rs', 'go'].includes(ext)) return '💻';
    return '📁';
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

  async function loadFileList() {
    var container = document.getElementById('file-list-container');
    container.innerHTML = '<div style="color:var(--muted); text-align:center; padding:1rem; font-family:\'IBM Plex Mono\',monospace;">Loading files...</div>';

    try {
      var res = await fetch('/api/drop/list');
      var json = await res.json();

      if (!res.ok || !json.success) {
        container.innerHTML = '<div style="color:red; text-align:center; padding:1rem; font-family:\'IBM Plex Mono\',monospace;">' + (json.error || 'Failed to load file list') + '</div>';
        return;
      }

      var files = json.data || [];
      if (files.length === 0) {
        container.innerHTML = '<div style="color:var(--muted); text-align:center; padding:1.5rem; font-family:\'IBM Plex Mono\',monospace;">No uploaded files found in your Rootz account.</div>';
        return;
      }

      container.innerHTML = '';
      files.forEach(function (file) {
        var fileCard = document.createElement('div');
        fileCard.style.cssText = 'background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:1rem; display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-wrap:wrap;';

        var icon = getFileIcon(file.name);
        var sizeStr = formatBytes(file.size);
        var downloads = file.download_count || 0;
        var expStr = file.expires_at ? '⏱ ' + new Date(file.expires_at).toLocaleDateString() : '🔒 Permanent';
        var shareLink = file.short_id ? 'https://rootz.so/d/' + file.short_id : (window.location.origin + '/api/drop/file/' + file.id);

        fileCard.innerHTML =
          '<div style="display:flex; align-items:center; gap:.85rem; flex:1; min-width:200px;">' +
            '<span style="font-size:1.4rem;">' + icon + '</span>' +
            '<div style="overflow:hidden;">' +
              '<div style="font-weight:600; font-size:.95rem; word-break:break-all;">' + (file.name || 'File') + '</div>' +
              '<div style="font-size:.78rem; color:var(--muted); font-family:\'IBM Plex Mono\',monospace; margin-top:.2rem;">' +
                sizeStr + ' · 👁️ ' + downloads + ' downloads · ' + expStr +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex; gap:.5rem; align-items:center;">' +
            '<button class="btn copy-item-btn" data-link="' + shareLink + '" style="font-size:.78rem;">$ copy</button>' +
            '<a class="btn" href="' + shareLink + '" target="_blank" style="font-size:.78rem;">$ open ↗</a>' +
            '<button class="btn delete-item-btn" data-id="' + file.id + '" style="border-color:#ef4444; color:#ef4444; font-size:.78rem;">🗑️ Delete</button>' +
          '</div>';

        container.appendChild(fileCard);
      });

      // Event handlers for dynamically created items
      container.querySelectorAll('.copy-item-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var link = btn.getAttribute('data-link');
          navigator.clipboard.writeText(link);
          btn.textContent = '$ copied!';
          setTimeout(function () { btn.textContent = '$ copy'; }, 2000);
        });
      });

      container.querySelectorAll('.delete-item-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-id');
          deleteFile(id, null, false);
        });
      });

    } catch (err) {
      container.innerHTML = '<div style="color:red; text-align:center; padding:1rem; font-family:\'IBM Plex Mono\',monospace;">Error loading file list from server.</div>';
    }
  }

  function uploadFile(file, password) {
    if (!file) return;

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
          alert('Upload completed but response format was invalid.');
          hideProgress();
        }
      } else {
        try {
          var errData = JSON.parse(xhr.responseText);
          alert('Upload failed: ' + (errData.error || xhr.responseText));
        } catch (e) {
          alert('Upload failed: ' + (xhr.responseText || 'Server error'));
        }
        hideProgress();
      }
    };

    xhr.onerror = function () {
      alert('Network error occurred during file upload.');
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
      alert('Please enter a valid remote file URL.');
      return;
    }

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
        alert('Remote upload error: ' + (data.error || 'Failed to process remote URL'));
        hideProgress();
      }
    } catch (err) {
      alert('Network error initiating remote upload.');
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
