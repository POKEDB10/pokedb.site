(function () {
  'use strict';

  var byId = function (name) { return document.getElementById(name); };
  var utils = window.PokeDbUtils || {};
  var formatBytes = utils.formatBytes || function (b) { return (b || 0) + ' B'; };
  var getFileIcon = utils.getFileIcon || function () { return '[FILE]'; };

  function resolveId() {
    var params = new URLSearchParams(window.location.search);
    var qId = params.get('code') || params.get('id') || '';
    if (qId.trim()) return qId.trim();
    var parts = window.location.pathname.split('/').filter(Boolean);
    var tail = parts.pop() || '';
    if (tail === 'view.html' || tail === 'drop') return '';
    return decodeURIComponent(tail).trim();
  }

  var id = resolveId();
  var streamUrl = id ? ('/d/' + encodeURIComponent(id)) : '';

  function copyText(text, btn, defaultLabel, toastMsg) {
    if (!text) return;
    function done() {
      if (btn) {
        btn.textContent = 'Copied!';
        setTimeout(function () { btn.textContent = defaultLabel; }, 1500);
      }
      if (window.showToast && toastMsg) window.showToast(toastMsg);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (done) done();
    } catch (_) {}
  }

  function isMedia(name, type) {
    var ext = (name.split('.').pop() || '').toLowerCase();
    if ((type || '').indexOf('image/') === 0 || /^(jpg|jpeg|png|gif|webp|avif|svg)$/.test(ext)) return 'image';
    if ((type || '').indexOf('video/') === 0 || /^(mp4|webm|mov|m4v|ogv)$/.test(ext)) return 'video';
    if ((type || '').indexOf('audio/') === 0 || /^(mp3|wav|ogg|m4a|aac|flac)$/.test(ext)) return 'audio';
    return '';
  }

  function renderPreview(name, type, isFolder) {
    var wrapper = byId('media-preview');
    if (!wrapper) return;
    if (isFolder || !streamUrl) {
      wrapper.style.display = 'none';
      wrapper.replaceChildren();
      return;
    }
    var kind = isMedia(name, type);
    if (!kind) return;
    wrapper.replaceChildren();
    var media = document.createElement(kind === 'image' ? 'img' : kind === 'video' ? 'video' : 'audio');
    media.src = streamUrl;
    if (kind === 'image') {
      media.alt = name;
      media.loading = 'eager';
      media.decoding = 'async';
    } else if (kind === 'video') {
      media.controls = true;
      media.preload = 'metadata';
      media.playsInline = true;
    } else {
      media.controls = true;
      media.preload = 'metadata';
    }
    media.addEventListener('error', function () {
      wrapper.style.display = 'none';
      wrapper.replaceChildren();
    });
    wrapper.appendChild(media);
    wrapper.style.display = 'block';
  }

  async function fetchJsonSafe(url, signal) {
    try {
      var opts = { cache: 'no-store' };
      if (signal) opts.signal = signal;
      var res = await fetch(url, opts);
      var ctype = (res.headers.get('content-type') || '').toLowerCase();
      var data = ctype.indexOf('application/json') !== -1 ? await res.json().catch(function () { return null; }) : null;
      return { ok: res.ok, status: res.status, data: data };
    } catch (_) {
      return { ok: false, status: 0, data: null };
    }
  }

  function renderCautionFlags(listEl, flags) {
    listEl.replaceChildren();
    flags.forEach(function (flag) {
      var li = document.createElement('li');
      li.textContent = flag;
      listEl.appendChild(li);
    });
  }

  function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.remove('is-open');
    modalEl.style.display = 'none';
  }

  function openModal(modalEl) {
    if (!modalEl) return;
    modalEl.style.display = 'grid';
    modalEl.classList.add('is-open');
  }

  async function load() {
    var dlBtn = byId('download-btn');
    if (dlBtn && streamUrl) dlBtn.href = streamUrl;
    if (byId('drop-code-val')) byId('drop-code-val').textContent = id || '—';
    if (byId('report-abuse-link') && id) {
      byId('report-abuse-link').href = '/abuse?kind=drop&id=' + encodeURIComponent(id);
    }

    byId('file-title').textContent = id || 'Shared Drop';
    if (utils.renderFileIcon) utils.renderFileIcon(byId('file-icon'), id || 'file', false);
    else byId('file-icon').textContent = getFileIcon(id || 'file');
    byId('file-size').textContent = 'Checking…';
    byId('file-downloads').textContent = '—';
    byId('file-expiry').textContent = 'Checking…';

    if (!id) {
      byId('file-title').textContent = 'No Drop code specified';
      byId('file-size').textContent = '—';
      byId('drop-status-pill').textContent = '● INVALID';
      if (dlBtn) dlBtn.style.display = 'none';
      return;
    }

    var meta = {
      code: id,
      name: id,
      size: 0,
      mimeType: '',
      downloads: 0,
      maxDownloads: null,
      isBurn: false,
      expiresAt: null,
      isFolder: false,
      files: [],
      fileCount: 0,
      sha256: null,
      virusFlags: []
    };

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeoutId = controller ? setTimeout(function () { controller.abort(); }, 4000) : null;

    var results = await Promise.all([
      fetchJsonSafe('/api/drop/' + encodeURIComponent(id) + '/meta', controller ? controller.signal : null),
      fetchJsonSafe('/api/drop/info?file_code=' + encodeURIComponent(id), controller ? controller.signal : null)
    ]);
    if (timeoutId) clearTimeout(timeoutId);

    var metaRes = results[0];
    var infoRes = results[1];
    var resolved = false;
    var errorStatus = 0;

    if (infoRes.ok && infoRes.data) {
      var infoItem = infoRes.data.data || infoRes.data.result || infoRes.data;
      if (Array.isArray(infoItem)) infoItem = infoItem[0];
      if (infoItem) {
        resolved = true;
        meta.code = infoItem.code || infoItem.shortId || infoItem.folderCode || infoItem.id || meta.code;
        meta.name = infoItem.name || infoItem.filename || meta.name;
        meta.size = Number(infoItem.size || infoItem.totalSize || infoItem.bytes || 0);
        meta.mimeType = infoItem.mimeType || infoItem.mime_type || meta.mimeType;
        meta.downloads = Number(infoItem.download || infoItem.downloads || infoItem.download_count || 0);
        meta.expiresAt = infoItem.expiresAt || infoItem.expires_at || meta.expiresAt;
        meta.isFolder = infoItem.isFolder === true || meta.mimeType === 'application/x-folder' || Array.isArray(infoItem.files);
        meta.files = Array.isArray(infoItem.files) ? infoItem.files : [];
        meta.fileCount = Number(infoItem.fileCount || meta.files.length || 0);
        meta.sha256 = infoItem.sha256 || meta.sha256;
        meta.isBurn = Boolean(infoItem.isBurn || infoItem.burn);
      }
    }

    if (metaRes.ok && metaRes.data && !meta.isFolder) {
      resolved = true;
      var m = metaRes.data;
      meta.code = m.code || m.shortId || m.id || meta.code;
      meta.name = m.name || m.filename || meta.name;
      meta.size = Number(m.size || m.bytes || meta.size || 0);
      meta.mimeType = m.mimeType || m.mime_type || meta.mimeType;
      meta.downloads = Number(m.downloads != null ? m.downloads : meta.downloads);
      meta.maxDownloads = m.maxDownloads != null ? Number(m.maxDownloads) : null;
      meta.isBurn = Boolean(m.isBurn || m.maxDownloads === 1);
      meta.expiresAt = m.expiresAt || meta.expiresAt;
      meta.sha256 = m.sha256 || meta.sha256;
      meta.virusFlags = Array.isArray(m.virusFlags) ? m.virusFlags : [];
      if (m.state === 'expired' || (m.expiresAt && m.expiresAt <= Date.now())) errorStatus = 410;
      if (m.state === 'quarantined') errorStatus = 451;
      if (m.maxDownloads !== null && m.downloads >= m.maxDownloads) errorStatus = 410;
    } else if (!resolved) {
      errorStatus = metaRes.status || infoRes.status || 404;
    }

    var canonicalCode = meta.code || id;
    streamUrl = '/d/' + encodeURIComponent(canonicalCode);
    var fullDirectUrl = window.location.origin + streamUrl;
    var banner = byId('drop-state-banner');
    var statusPill = byId('drop-status-pill');

    if (byId('drop-code-val')) byId('drop-code-val').textContent = canonicalCode;
    if (dlBtn) dlBtn.href = streamUrl;

    if (!resolved || errorStatus >= 400) {
      var errText = errorStatus === 451
        ? 'This file has been quarantined for security or abuse policy violations.'
        : errorStatus === 410
          ? 'This link has expired or already been burned after download.'
          : 'This Drop link could not be found or has been deleted.';
      if (banner) {
        banner.className = 'state-banner is-error';
        banner.textContent = errText;
      }
      if (statusPill) {
        statusPill.classList.add('is-danger');
        statusPill.textContent = errorStatus === 451 ? '● QUARANTINED' : errorStatus === 410 ? '● EXPIRED' : '● NOT FOUND';
      }
      byId('file-title').textContent = resolved ? meta.name : ('Unavailable (' + canonicalCode + ')');
      byId('file-size').textContent = meta.size ? formatBytes(meta.size) : 'Unavailable';
      byId('file-downloads').textContent = 'Unavailable';
      byId('file-expiry').textContent = errorStatus === 410 ? 'Expired / Burned' : 'Unavailable';
      if (dlBtn) dlBtn.style.display = 'none';
      return;
    }

    byId('file-title').textContent = meta.name;
    document.title = meta.name + ' | Drop — pokedb.site';
    if (utils.renderFileIcon) {
      utils.renderFileIcon(byId('file-icon'), meta.name, meta.isFolder);
    } else {
      byId('file-icon').textContent = meta.isFolder ? '[DIR]' : getFileIcon(meta.name);
    }

    byId('file-size').textContent = meta.size
      ? formatBytes(meta.size) + (meta.isFolder ? ' (' + meta.fileCount + ' files)' : '')
      : (meta.isFolder ? meta.fileCount + ' files' : 'Ready');
    byId('file-downloads').textContent = meta.isFolder
      ? ('Folder · ' + meta.fileCount + ' items')
      : (meta.downloads + (meta.maxDownloads ? ' / ' + meta.maxDownloads : '') + ' downloads');
    byId('file-expiry').textContent = meta.expiresAt
      ? new Date(meta.expiresAt).toLocaleString()
      : (meta.isFolder ? 'Folder batch' : 'Active');

    if (meta.isBurn && banner) {
      banner.className = 'state-banner is-burn';
      banner.textContent = 'Burn-on-read enabled: this file is permanently deleted after 1 download.';
      if (statusPill) statusPill.textContent = '● BURN 1×';
    } else if (meta.isFolder && statusPill) {
      statusPill.textContent = '● FOLDER';
    } else if (statusPill) {
      statusPill.textContent = '● READY';
    }

    if (!meta.isFolder) {
      renderPreview(meta.name, meta.mimeType, false);
      var quickBox = byId('quick-links-box');
      if (quickBox) quickBox.classList.add('is-visible');
      if (byId('direct-link-input')) byId('direct-link-input').value = fullDirectUrl;
      if (byId('curl-cmd-input')) byId('curl-cmd-input').value = 'curl -LOJ ' + fullDirectUrl;
    }

    if (meta.virusFlags && meta.virusFlags.length > 0) {
      var warnBox = byId('security-warning-box');
      var flagList = byId('warning-flag-list');
      if (warnBox && flagList) {
        renderCautionFlags(flagList, meta.virusFlags);
        warnBox.style.display = 'block';
      }
    }

    if (dlBtn) {
      dlBtn.addEventListener('click', function (e) {
        if (meta.virusFlags && meta.virusFlags.length > 0) {
          e.preventDefault();
          var cautionModal = byId('download-caution-modal');
          var modalFlagList = byId('modal-caution-flag-list');
          var confirmBtn = byId('confirm-unsafe-download-btn');
          if (cautionModal && modalFlagList && confirmBtn) {
            renderCautionFlags(modalFlagList, meta.virusFlags);
            confirmBtn.href = streamUrl;
            openModal(cautionModal);
          }
        }
      });
    }

    if (meta.sha256) {
      var shaBox = byId('file-sha256-box');
      var shaHashSpan = byId('file-sha256-hash');
      var copyShaBtn = byId('copy-sha256-btn');
      var expectedInput = byId('expected-sha256-input');
      var matchBadge = byId('sha256-match-badge');

      if (shaBox && shaHashSpan) {
        shaHashSpan.textContent = meta.sha256;
        shaBox.style.display = 'block';
        if (copyShaBtn) {
          copyShaBtn.addEventListener('click', function () {
            copyText(meta.sha256, copyShaBtn, 'Copy SHA-256', 'SHA-256 checksum copied');
          });
        }
        if (expectedInput && matchBadge) {
          expectedInput.addEventListener('input', function () {
            var val = expectedInput.value.trim().toLowerCase();
            if (!val) {
              matchBadge.style.display = 'none';
              return;
            }
            matchBadge.style.display = 'inline-block';
            if (val === meta.sha256.toLowerCase()) {
              matchBadge.style.background = 'color-mix(in srgb, var(--success) 15%, transparent)';
              matchBadge.style.color = 'var(--success)';
              matchBadge.style.border = '1px solid var(--success)';
              matchBadge.textContent = '✓ MATCH';
            } else {
              matchBadge.style.background = 'color-mix(in srgb, var(--danger) 15%, transparent)';
              matchBadge.style.color = 'var(--danger)';
              matchBadge.style.border = '1px solid var(--danger)';
              matchBadge.textContent = '✕ MISMATCH';
            }
          });
        }
      }
    }

    if (meta.isFolder) {
      if (dlBtn) dlBtn.style.display = 'none';
      var dlAllBtn = byId('download-all-btn');
      if (dlAllBtn) {
        dlAllBtn.textContent = 'Download All (' + meta.files.length + ')';
        dlAllBtn.style.display = 'inline-flex';
        dlAllBtn.addEventListener('click', function () {
          if (!meta.files.length) return;
          meta.files.forEach(function (f, idx) {
            var fCode = f.shortId || f.code || f.id;
            setTimeout(function () {
              var a = document.createElement('a');
              a.style.display = 'none';
              a.href = '/d/' + encodeURIComponent(fCode);
              a.download = f.name || 'file';
              a.target = '_blank';
              a.rel = 'noopener';
              document.body.appendChild(a);
              a.click();
              setTimeout(function () { a.remove(); }, 1000);
            }, idx * 400);
          });
          if (window.showToast) window.showToast('Downloading all ' + meta.files.length + ' files…');
        });
      }

      var folderList = byId('folder-file-list');
      folderList.replaceChildren();
      var heading = document.createElement('div');
      heading.className = 'folder-heading';
      heading.textContent = '$ ls --files (' + meta.files.length + ' files in folder)';
      folderList.appendChild(heading);

      meta.files.forEach(function (f) {
        var fCode = f.shortId || f.code || f.id;
        var fUrl = window.location.origin + '/d/' + encodeURIComponent(fCode);

        var fileRow = document.createElement('div');
        fileRow.className = 'folder-item';

        var infoWrap = document.createElement('div');
        infoWrap.className = 'folder-item-info';

        var itemIcon = document.createElement('span');
        if (utils.renderFileIcon) utils.renderFileIcon(itemIcon, f.name, false);
        else itemIcon.textContent = getFileIcon(f.name);

        var textWrap = document.createElement('div');
        textWrap.className = 'folder-item-text';
        var nameEl = document.createElement('div');
        nameEl.textContent = f.name || 'file';
        var sizeEl = document.createElement('span');
        sizeEl.className = 'folder-item-size';
        sizeEl.textContent = formatBytes(Number(f.size || 0)) + ' · code: ' + fCode;
        textWrap.append(nameEl, sizeEl);
        infoWrap.append(itemIcon, textWrap);

        var rowActions = document.createElement('div');
        rowActions.className = 'folder-item-actions';

        var copyItemBtn = document.createElement('button');
        copyItemBtn.type = 'button';
        copyItemBtn.className = 'btn btn-compact';
        copyItemBtn.textContent = 'Copy Link';
        copyItemBtn.addEventListener('click', function () {
          copyText(fUrl, copyItemBtn, 'Copy Link', 'File link copied');
        });

        var dlItemBtn = document.createElement('a');
        dlItemBtn.className = 'btn btn-solid btn-compact';
        dlItemBtn.target = '_blank';
        dlItemBtn.rel = 'noopener';
        dlItemBtn.href = '/d/' + encodeURIComponent(fCode);
        dlItemBtn.textContent = 'Download';

        rowActions.append(copyItemBtn, dlItemBtn);
        fileRow.append(infoWrap, rowActions);
        folderList.appendChild(fileRow);
      });
      folderList.style.display = 'block';
    }
  }

  function wireStaticControls() {
    var copyCodeBtn = byId('copy-code-btn');
    if (copyCodeBtn) {
      copyCodeBtn.addEventListener('click', function () {
        var codeText = byId('drop-code-val') ? byId('drop-code-val').textContent : id;
        copyText(codeText, copyCodeBtn, 'Copy Code', 'Drop code copied');
      });
    }
    var copyBtn = byId('copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        copyText(window.location.href, copyBtn, 'Copy Link', 'Share link copied');
      });
    }
    var copyDirectBtn = byId('copy-direct-btn');
    if (copyDirectBtn) {
      copyDirectBtn.addEventListener('click', function () {
        var val = byId('direct-link-input') ? byId('direct-link-input').value : '';
        copyText(val, copyDirectBtn, 'Copy Direct', 'Direct download link copied');
      });
    }
    var copyCurlBtn = byId('copy-curl-btn');
    if (copyCurlBtn) {
      copyCurlBtn.addEventListener('click', function () {
        var val = byId('curl-cmd-input') ? byId('curl-cmd-input').value : '';
        copyText(val, copyCurlBtn, 'Copy curl', 'cURL command copied');
      });
    }

    var qrModal = byId('qr-modal');
    var cautionModal = byId('download-caution-modal');

    var qrBtn = byId('qr-btn');
    if (qrBtn) {
      qrBtn.addEventListener('click', function () {
        var box = byId('qr-box');
        if (!box) return;
        box.replaceChildren();
        var targetUrl = window.location.href;
        if (byId('qr-url-caption')) byId('qr-url-caption').textContent = targetUrl;
        openModal(qrModal);
        if (window.QRCode && typeof window.QRCode.toString === 'function') {
          window.QRCode.toString(targetUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }, function (err, svg) {
            if (!err && svg) {
              box.innerHTML = svg;
              var svgEl = box.querySelector('svg');
              if (svgEl) {
                svgEl.setAttribute('width', '200');
                svgEl.setAttribute('height', '200');
                svgEl.style.display = 'block';
                svgEl.style.margin = '0 auto';
              }
              return;
            }
            appendViewQrFallback(box, targetUrl);
          });
          return;
        }
        try {
          if (window.QRCodeLib && typeof window.QRCodeLib.generateSVG === 'function') {
            box.innerHTML = window.QRCodeLib.generateSVG(targetUrl, { dark: '#000000', light: '#ffffff', margin: 1, ecLevel: 'M' });
            var svgEl = box.querySelector('svg');
            if (svgEl) {
              svgEl.setAttribute('width', '200');
              svgEl.setAttribute('height', '200');
              svgEl.style.display = 'block';
              svgEl.style.margin = '0 auto';
            }
            return;
          }
        } catch (_) {}
        appendViewQrFallback(box, targetUrl);
      });
    }

    function appendViewQrFallback(box, targetUrl) {
      var img = document.createElement('img');
      img.src = '/api/qr?format=png&text=' + encodeURIComponent(targetUrl);
      img.width = 200;
      img.height = 200;
      img.alt = 'QR Code';
      img.style.display = 'block';
      box.appendChild(img);
    }

    if (byId('close-qr-btn')) {
      byId('close-qr-btn').addEventListener('click', function () { closeModal(qrModal); });
    }
    if (qrModal) {
      qrModal.addEventListener('click', function (e) {
        if (e.target === qrModal) closeModal(qrModal);
      });
    }
    if (byId('cancel-download-btn')) {
      byId('cancel-download-btn').addEventListener('click', function () { closeModal(cautionModal); });
    }
    if (cautionModal) {
      cautionModal.addEventListener('click', function (e) {
        if (e.target === cautionModal) closeModal(cautionModal);
      });
    }
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeModal(qrModal);
        closeModal(cautionModal);
      }
    });
  }

  wireStaticControls();
  load();
}());
