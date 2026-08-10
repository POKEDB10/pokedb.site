(function () {
  'use strict';
  var id = window.location.pathname.split('/').filter(Boolean).pop();
  var streamUrl = '/api/drop/stream/' + encodeURIComponent(id);
  var byId = function (name) { return document.getElementById(name); };
  var formatBytes = window.PokeDbUtils.formatBytes;
  var getFileIcon = window.PokeDbUtils.getFileIcon;

  function isMedia(name, type) {
    var extension = (name.split('.').pop() || '').toLowerCase();
    if (type.indexOf('image/') === 0 || /^(jpg|jpeg|png|gif|webp|avif|svg)$/.test(extension)) return 'image';
    if (type.indexOf('video/') === 0 || /^(mp4|webm|mov|m4v|ogv)$/.test(extension)) return 'video';
    if (type.indexOf('audio/') === 0 || /^(mp3|wav|ogg|m4a|aac|flac)$/.test(extension)) return 'audio';
    return '';
  }

  function renderPreview(name, type) {
    var kind = isMedia(name, type);
    if (!kind) return;
    var wrapper = byId('media-preview');
    wrapper.replaceChildren();
    var media = document.createElement(kind === 'image' ? 'img' : kind === 'video' ? 'video' : 'audio');
    media.src = streamUrl;
    if (kind === 'image') {
      media.alt = name;
      media.loading = 'eager';
      media.decoding = 'async';
    }
    if (kind === 'video') {
      media.controls = true;
      media.preload = 'metadata';
      media.playsInline = true;
    }
    if (kind === 'audio') {
      media.controls = true;
      media.preload = 'metadata';
    }
    wrapper.appendChild(media);
    wrapper.style.display = 'block';
  }

  async function load() {
    byId('download-btn').href = streamUrl;

    // Instant initial render so user never sees static "Loading file..." stuck
    byId('file-title').textContent = id || 'Shared file';
    byId('file-icon').textContent = getFileIcon(id || 'file');
    byId('file-size').textContent = 'Ready';
    byId('file-downloads').textContent = 'Direct Link';
    byId('file-expiry').textContent = 'Checking expiry…';

    // Fast media preview triggering immediately if file extension indicates image/video/audio
    renderPreview(id || '', '');

    var meta = { name: id, size: 0, mimeType: '', downloads: 0, expiresAt: null, isFolder: false, files: [] };
    try {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timeoutId = controller ? setTimeout(function () { controller.abort(); }, 3500) : null;

      var fetchOpts = { cache: 'no-store' };
      if (controller) fetchOpts.signal = controller.signal;

      var response = await fetch('/api/drop/info?file_code=' + encodeURIComponent(id), fetchOpts);
      if (timeoutId) clearTimeout(timeoutId);

      if (response.ok) {
        var json = await response.json();
        var item = json.data || json.result || json;
        if (Array.isArray(item)) item = item[0];
        if (item) {
          meta.name = item.name || item.filename || meta.name;
          meta.size = Number(item.size || item.bytes || 0);
          meta.mimeType = item.mimeType || item.mime_type || '';
          meta.downloads = Number(item.download || item.downloads || item.download_count || 0);
          meta.expiresAt = item.expiresAt || item.expires_at || null;
          meta.isFolder = item.isFolder === true || meta.mimeType === 'application/x-folder';
          meta.files = item.files || [];
          meta.fileCount = item.fileCount || meta.files.length;
          meta.virusFlags = item.virusFlags || [];
        }
      }
    } catch (error) { /* Instant fallback */ }

    byId('file-title').textContent = meta.name;
    byId('file-icon').textContent = meta.isFolder ? '📁' : getFileIcon(meta.name);
    byId('file-size').textContent = meta.size ? formatBytes(meta.size) + (meta.isFolder ? ' (' + meta.fileCount + ' files)' : '') : 'Ready to download';
    byId('file-downloads').textContent = meta.isFolder ? 'Folder Batch' : meta.downloads + ' downloads';
    byId('file-expiry').textContent = meta.expiresAt ? 'Expires ' + new Date(meta.expiresAt).toLocaleString() : 'Permanent link';

    // Render security caution warning box if file has threat flags
    if (meta.virusFlags && meta.virusFlags.length > 0) {
      var warnBox = byId('security-warning-box');
      var flagList = byId('warning-flag-list');
      if (warnBox && flagList) {
        flagList.replaceChildren();
        meta.virusFlags.forEach(function (flag) {
          var li = document.createElement('li');
          li.textContent = flag;
          flagList.appendChild(li);
        });
        warnBox.style.display = 'block';
      }
    }

    // Handle Download button caution prompt if file has flags
    var downloadBtn = byId('download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', function (e) {
        if (meta.virusFlags && meta.virusFlags.length > 0) {
          e.preventDefault();
          var cautionModal = byId('download-caution-modal');
          var modalFlagList = byId('modal-caution-flag-list');
          var confirmBtn = byId('confirm-unsafe-download-btn');

          if (cautionModal && modalFlagList && confirmBtn) {
            modalFlagList.replaceChildren();
            meta.virusFlags.forEach(function (flag) {
              var li = document.createElement('li');
              li.textContent = flag;
              modalFlagList.appendChild(li);
            });
            confirmBtn.href = streamUrl;
            cautionModal.style.display = 'grid';
          } else {
            window.open(streamUrl, '_blank');
          }
        }
      });
    }

    var cancelDlBtn = byId('cancel-download-btn');
    if (cancelDlBtn) {
      cancelDlBtn.addEventListener('click', function () {
        var cautionModal = byId('download-caution-modal');
        if (cautionModal) cautionModal.style.display = 'none';
      });
    }

    var confirmDlBtn = byId('confirm-unsafe-download-btn');
    if (confirmDlBtn) {
      confirmDlBtn.addEventListener('click', function () {
        var cautionModal = byId('download-caution-modal');
        if (cautionModal) cautionModal.style.display = 'none';
      });
    }

    if (meta.isFolder) {
      byId('download-btn').style.display = 'none';
      var folderList = byId('folder-file-list');
      folderList.replaceChildren();
      var heading = document.createElement('div');
      heading.style.cssText = 'font:600 .85rem "IBM Plex Mono",monospace; color:var(--accent); margin-bottom:.75rem;';
      heading.textContent = '$ ls --files (' + meta.files.length + ' files in this folder)';
      folderList.appendChild(heading);

      meta.files.forEach(function (f) {
        var fileRow = document.createElement('div');
        fileRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:.75rem; padding:.6rem .75rem; border:1px solid var(--border); border-radius:8px; margin-bottom:.5rem; background:var(--bg); font-family:"IBM Plex Mono",monospace; font-size:.82rem;';

        var nameSpan = document.createElement('span');
        nameSpan.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;';
        nameSpan.textContent = getFileIcon(f.name) + ' ' + f.name + ' (' + formatBytes(f.size) + ')';

        var dlBtn = document.createElement('a');
        dlBtn.className = 'btn';
        dlBtn.style.cssText = 'padding:.3rem .6rem; font-size:.75rem;';
        dlBtn.target = '_blank';
        dlBtn.rel = 'noopener';
        dlBtn.href = '/api/drop/stream/' + encodeURIComponent(f.id);
        dlBtn.textContent = 'Download';

        fileRow.append(nameSpan, dlBtn);
        folderList.appendChild(fileRow);
      });
      folderList.style.display = 'block';
    } else {
      renderPreview(meta.name, meta.mimeType);
    }
  }

  byId('copy-btn').addEventListener('click', function () { navigator.clipboard.writeText(window.location.href); this.textContent = 'Copied'; var button = this; setTimeout(function () { button.textContent = 'Copy link'; }, 1500); });
  byId('qr-btn').addEventListener('click', async function () {
    var box = byId('qr-box');
    box.replaceChildren();
    try {
      var response = await fetch('/api/qr?format=svg&text=' + encodeURIComponent(window.location.href));
      if (!response.ok) throw new Error();
      var svgText = await response.text();
      box.innerHTML = svgText;
      var svgEl = box.querySelector('svg');
      if (svgEl) {
        svgEl.setAttribute('width', '220');
        svgEl.setAttribute('height', '220');
        svgEl.style.display = 'block';
        svgEl.style.margin = '0 auto';
      }
      byId('qr-modal').style.display = 'grid';
    } catch (error) {
      box.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 100 100" style="display:block;margin:0 auto"><rect width="100" height="100" fill="#ffffff"/><path d="M10 10h30v30H10zM50 10h40v10H50zM60 30h30v10H60zM10 50h10v40H10zM30 50h20v20H30zM60 50h30v40H60z" fill="#000000"/></svg>';
      byId('qr-modal').style.display = 'grid';
    }
  });
  byId('close-qr-btn').addEventListener('click', function () { byId('qr-modal').style.display = 'none'; });
  load();
}());
