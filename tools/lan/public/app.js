(function () {
  'use strict';

  var utils = window.PokeDbUtils || {};
  var formatBytes = utils.formatBytes || function (b) { return (b || 0) + ' B'; };
  var formatSpeed = utils.formatSpeedAuto || function (bps) { return formatBytes(bps) + '/s'; };

  var stagedFiles = [];
  var activeMode = 'send';
  var activeSender = null;
  var activeReceiver = null;
  var pendingOffer = null;
  var objectUrls = [];

  var STATE_LABELS = {
    'creating': 'Creating ephemeral pairing room…',
    'waiting-peer': 'Waiting for receiver to enter code…',
    'joining': 'Joining pairing room…',
    'connecting': 'Negotiating direct WebRTC connection…',
    'handshaking': 'Deriving ECDH P-256 session keys…',
    'sas-ready': 'Confirm 6-digit safety code matches peer.',
    'awaiting-accept': 'Waiting for receiver to accept…',
    'awaiting-decision': 'Confirm safety code matches sender, then accept or decline.',
    'transferring': 'Streaming AES-256-GCM encrypted chunks…',
    'receiving': 'Receiving AES-256-GCM encrypted chunks…',
    'verifying': 'Verifying SHA-256 checksum…',
    'completed': 'Transfer complete — SHA-256 verified.',
    'declined': 'Transfer declined by receiver.',
    'cancelled': 'Session cancelled.',
    'closed': 'Session closed.'
  };

  function el(id) {
    return document.getElementById(id);
  }

  function showNotice(msg) {
    var box = el('lan-notice');
    if (!box) return;
    box.textContent = msg;
    box.hidden = false;
  }

  function clearNotice() {
    var box = el('lan-notice');
    if (!box) return;
    box.textContent = '';
    box.hidden = true;
  }

  function revokeUrls() {
    while (objectUrls.length) {
      try { URL.revokeObjectURL(objectUrls.pop()); } catch (_) {}
    }
  }

  function formatEta(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return '0s';
    if (seconds > 3600) return (seconds / 3600).toFixed(1) + 'h';
    if (seconds > 60) return Math.round(seconds / 60) + 'm';
    return Math.round(seconds) + 's';
  }

  function formatStateLabel(ev, fallbackDetail) {
    if (!ev) return '';
    var state = typeof ev === 'string' ? ev : ev.state;
    var detail = typeof ev === 'string' ? fallbackDetail : ev.detail;
    if (state === 'error' && detail) {
      return typeof detail === 'string' ? detail : (detail.message || 'Connection error.');
    }
    return STATE_LABELS[state] || (typeof detail === 'string' && detail ? detail : state);
  }

  function checkSupport() {
    var lan = window.PokedbLan;
    if (!lan) return { ok: false, reason: 'LAN transfer engine failed to load.' };
    if (typeof lan.isSupported === 'function') {
      var res = lan.isSupported();
      return {
        ok: Boolean(res && res.supported),
        reason: (res && res.reason) || 'WebRTC and WebCrypto are required in a secure context.'
      };
    }
    return { ok: true, reason: '' };
  }

  function normalizePairingCode(raw) {
    var lan = window.PokedbLan;
    if (lan && typeof lan.normalizeCode === 'function') {
      return lan.normalizeCode(raw);
    }
    return String(raw || '').trim().replace(/[\s-]+/g, '').toUpperCase();
  }

  function buildInviteLink(code) {
    return window.location.origin + window.location.pathname + '?code=' + encodeURIComponent(code);
  }

  function copyText(text, btn, toastMsg) {
    if (!text) return;
    var done = function () {
      if (btn) {
        var orig = btn.dataset.origLabel || btn.textContent;
        btn.dataset.origLabel = orig;
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = orig; }, 1500);
      }
      if (window.showToast && toastMsg) window.showToast(toastMsg);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
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

  function renderQr(container, url) {
    if (!container || !url) return;
    container.replaceChildren();
    if (window.QRCode && typeof window.QRCode.toString === 'function') {
      window.QRCode.toString(url, {
        type: 'svg',
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' }
      }, function (err, svg) {
        if (!err && svg) {
          container.innerHTML = svg;
          var svgEl = container.querySelector('svg');
          if (svgEl) {
            svgEl.setAttribute('width', '126');
            svgEl.setAttribute('height', '126');
            svgEl.setAttribute('aria-hidden', 'true');
            svgEl.style.display = 'block';
          }
          return;
        }
        appendQrImgFallback(container, url);
      });
      return;
    }
    appendQrImgFallback(container, url);
  }

  function appendQrImgFallback(container, url) {
    var img = document.createElement('img');
    img.src = '/api/qr?format=png&text=' + encodeURIComponent(url);
    img.width = 126;
    img.height = 126;
    img.alt = 'Pairing link QR code';
    img.style.display = 'block';
    container.appendChild(img);
  }

  function setProgress(barId, trackId, pctId, textId, percent, label) {
    var clamped = Math.max(0, Math.min(100, Number(percent) || 0));
    var rounded = Math.round(clamped);
    var fill = el(barId);
    var track = el(trackId);
    var pct = el(pctId);
    var txt = el(textId);
    if (fill) fill.style.width = clamped + '%';
    if (track) track.setAttribute('aria-valuenow', String(rounded));
    if (pct) pct.textContent = rounded + '%';
    if (txt && label) txt.textContent = label;
  }

  function setMode(mode) {
    activeMode = mode === 'receive' ? 'receive' : 'send';
    var sendBtn = el('lan-mode-send-btn');
    var recvBtn = el('lan-mode-recv-btn');
    var sendPanel = el('lan-send-panel');
    var recvPanel = el('lan-receive-panel');
    var isSend = activeMode === 'send';

    if (sendBtn) {
      sendBtn.classList.toggle('is-active', isSend);
      sendBtn.setAttribute('aria-selected', isSend ? 'true' : 'false');
      sendBtn.setAttribute('tabindex', isSend ? '0' : '-1');
    }
    if (recvBtn) {
      recvBtn.classList.toggle('is-active', !isSend);
      recvBtn.setAttribute('aria-selected', !isSend ? 'true' : 'false');
      recvBtn.setAttribute('tabindex', !isSend ? '0' : '-1');
    }
    if (sendPanel) sendPanel.hidden = !isSend;
    if (recvPanel) recvPanel.hidden = isSend;
  }

  function renderStagedFiles() {
    var listEl = el('lan-staged-list');
    var labelEl = el('lan-send-file-label');
    var metaEl = el('lan-send-file-meta');
    var createBtn = el('lan-create-room-btn');
    var clearBtn = el('lan-clear-files-btn');

    listEl.replaceChildren();
    if (!stagedFiles.length) {
      listEl.hidden = true;
      labelEl.textContent = 'Drop files here for direct LAN transfer';
      metaEl.textContent = 'Stays on your local network · No file size limit';
      createBtn.disabled = true;
      clearBtn.hidden = true;
      return;
    }

    var totalBytes = stagedFiles.reduce(function (sum, f) { return sum + (f.size || 0); }, 0);
    labelEl.textContent = stagedFiles.length === 1
      ? stagedFiles[0].name
      : stagedFiles.length + ' files selected';
    metaEl.textContent = formatBytes(totalBytes) + ' · Ready for local pairing';

    stagedFiles.forEach(function (file) {
      var li = document.createElement('li');
      var nameSpan = document.createElement('span');
      nameSpan.className = 'lan-file-name';
      nameSpan.textContent = file.name;
      var sizeSpan = document.createElement('span');
      sizeSpan.className = 'lan-file-size';
      sizeSpan.textContent = formatBytes(file.size || 0);
      li.append(nameSpan, sizeSpan);
      listEl.appendChild(li);
    });

    listEl.hidden = false;
    createBtn.disabled = Boolean(activeSender);
    clearBtn.hidden = Boolean(activeSender);
  }

  function stageFiles(fileList) {
    clearNotice();
    var incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    if (incoming.length > 500) {
      showNotice('Select at most 500 files per transfer.');
      return;
    }
    stagedFiles = incoming;
    renderStagedFiles();
    if (activeSender && typeof activeSender.setFiles === 'function') {
      activeSender.setFiles(stagedFiles).catch(function (err) {
        showNotice((err && err.message) || 'Unable to update staged files.');
      });
    }
  }

  function resetSenderSession(keepFiles) {
    activeSender = null;
    if (!keepFiles) {
      stagedFiles = [];
    }
    renderStagedFiles();
    el('lan-send-cancel-btn').disabled = true;
    el('lan-send-sas-box').hidden = true;
    el('lan-send-progress').hidden = true;
    setProgress('lan-send-bar', 'lan-send-progressbar', 'lan-send-percent', 'lan-send-progress-text', 0, 'Sending…');
  }

  function resetReceiverSession() {
    activeReceiver = null;
    pendingOffer = null;
    revokeUrls();
    el('lan-join-btn').disabled = false;
    el('lan-recv-status-box').hidden = true;
    el('lan-recv-sas-box').hidden = true;
    el('lan-incoming-card').hidden = true;
    el('lan-incoming-files-list').replaceChildren();
    el('lan-incoming-files-list').hidden = true;
    el('lan-accept-controls').hidden = false;
    el('lan-accept-btn').disabled = false;
    el('lan-decline-btn').disabled = false;
    el('lan-recv-progress').hidden = true;
    el('lan-recv-complete').hidden = true;
    el('lan-recv-downloads-list').replaceChildren();
    setProgress('lan-recv-bar', 'lan-recv-progressbar', 'lan-recv-percent', 'lan-recv-progress-text', 0, 'Receiving…');
  }

  function updatePairingDisplay(code) {
    var pairUrl = buildInviteLink(code);
    el('lan-pair-code').textContent = code;
    el('lan-pair-url-text').textContent = pairUrl;
    renderQr(el('lan-qr-box'), pairUrl);
  }

  async function startSender() {
    clearNotice();
    if (!stagedFiles.length) {
      showNotice('Choose one or more files first.');
      return;
    }
    var support = checkSupport();
    if (!support.ok) {
      showNotice(support.reason);
      return;
    }
    if (activeSender && typeof activeSender.cancel === 'function') {
      try { activeSender.cancel('restarted'); } catch (_) {}
    }

    el('lan-create-room-btn').disabled = true;
    el('lan-clear-files-btn').hidden = true;
    el('lan-send-cancel-btn').disabled = false;
    el('lan-pairing-card').hidden = false;
    el('lan-send-sas-box').hidden = true;
    el('lan-send-progress').hidden = true;
    el('lan-pair-code').textContent = '------';
    el('lan-send-status').textContent = 'Creating ephemeral pairing room…';

    try {
      var lan = window.PokedbLan;
      activeSender = lan.createSender({
        files: stagedFiles,
        allowStun: false,
        onStateChange: function (ev) {
          var label = formatStateLabel(ev);
          if (label) el('lan-send-status').textContent = label;
          if (ev && (ev.state === 'declined' || ev.state === 'cancelled' || ev.state === 'closed')) {
            resetSenderSession(true);
          }
        },
        onRoomCreated: function (info) {
          var code = info && info.code ? info.code : '------';
          updatePairingDisplay(code);
          el('lan-send-status').textContent = 'Waiting for receiver to enter code…';
        },
        onPeerJoined: function () {
          el('lan-send-status').textContent = 'Receiver joined — negotiating direct WebRTC channel…';
        },
        onSas: function (info) {
          var formatted = (info && info.formattedSas) || (info && info.sas ? lan.formatSas(info.sas) : '');
          if (formatted) {
            el('lan-send-sas-code').textContent = formatted;
            el('lan-send-sas-box').hidden = false;
          }
        },
        onReceiverDecision: function (dec) {
          var accepted = Boolean(dec && dec.accepted);
          if (accepted) {
            el('lan-send-status').textContent = 'Receiver accepted — streaming encrypted chunks…';
            el('lan-send-progress').hidden = false;
          } else {
            showNotice('Receiver declined the transfer.');
            el('lan-send-status').textContent = 'Transfer declined by receiver.';
            resetSenderSession(true);
          }
        },
        onProgress: function (p) {
          if (!p) return;
          el('lan-send-progress').hidden = false;
          var prefix = p.fileCount > 1 ? ('[' + ((p.fileIndex || 0) + 1) + '/' + p.fileCount + '] ') : '';
          var label = prefix + (p.fileName || 'Sending') + ' · ' +
            formatBytes(p.bytesSent || 0) + ' / ' + formatBytes(p.totalBytes || 0) + ' · ' +
            formatSpeed(p.speedBps || 0) + ' · ETA ' + formatEta(p.etaSeconds || 0);
          setProgress('lan-send-bar', 'lan-send-progressbar', 'lan-send-percent', 'lan-send-progress-text', p.percent, label);
        },
        onFileComplete: function (info) {
          if (info && info.name && window.showToast) window.showToast('Sent ' + info.name);
        },
        onComplete: function () {
          setProgress('lan-send-bar', 'lan-send-progressbar', 'lan-send-percent', 'lan-send-progress-text', 100, 'Transfer complete — verified by receiver.');
          el('lan-send-status').textContent = 'Transfer complete — SHA-256 verified by receiver.';
          activeSender = null;
          el('lan-create-room-btn').disabled = !stagedFiles.length;
          el('lan-clear-files-btn').hidden = !stagedFiles.length;
          el('lan-send-cancel-btn').disabled = true;
          if (window.showToast) window.showToast('LAN transfer complete');
        },
        onError: function (err) {
          var msg = (err && err.message) ? err.message : String(err || 'Transfer failed.');
          showNotice(msg);
          el('lan-send-status').textContent = msg;
          resetSenderSession(true);
        }
      });

      var created = await activeSender.start();
      if (created && created.code && el('lan-pair-code').textContent === '------') {
        updatePairingDisplay(created.code);
      }
    } catch (err) {
      showNotice((err && err.message) || 'Failed to create pairing room.');
      el('lan-pairing-card').hidden = true;
      resetSenderSession(true);
    }
  }

  async function startReceiver() {
    clearNotice();
    var support = checkSupport();
    if (!support.ok) {
      showNotice(support.reason);
      return;
    }

    var lan = window.PokedbLan;
    var input = el('lan-join-code-input');
    var code = normalizePairingCode(input.value);
    input.value = code;

    if (!code || (typeof lan.isValidCode === 'function' && !lan.isValidCode(code))) {
      showNotice('Enter a valid 6-character pairing code.');
      input.focus();
      return;
    }

    if (activeReceiver && typeof activeReceiver.cancel === 'function') {
      try { activeReceiver.cancel('rejoined'); } catch (_) {}
    }
    resetReceiverSession();
    el('lan-join-btn').disabled = true;
    el('lan-recv-status-box').hidden = false;
    el('lan-recv-status').textContent = 'Joining room ' + code + '…';

    try {
      activeReceiver = lan.createReceiver({
        code: code,
        allowStun: false,
        autoDownload: false,
        onStateChange: function (ev) {
          var label = formatStateLabel(ev);
          if (label) el('lan-recv-status').textContent = label;
          if (ev && (ev.state === 'cancelled' || ev.state === 'closed' || ev.state === 'declined')) {
            el('lan-join-btn').disabled = false;
          }
        },
        onJoined: function () {
          el('lan-recv-status').textContent = 'Paired — exchanging keys and connecting…';
        },
        onSas: function (info) {
          var formatted = (info && info.formattedSas) || (info && info.sas ? lan.formatSas(info.sas) : '');
          if (formatted) {
            el('lan-recv-sas-code').textContent = formatted;
            el('lan-recv-sas-box').hidden = false;
          }
        },
        onFileOffer: function (offer) {
          pendingOffer = offer;
          var files = Array.isArray(offer && offer.files) ? offer.files : [];
          var totalSize = Number((offer && offer.totalSize) || files.reduce(function (s, f) { return s + (f.size || 0); }, 0));
          var fileCount = (offer && offer.fileCount) || files.length || 1;

          if (offer && (offer.formattedSas || offer.sas)) {
            el('lan-recv-sas-code').textContent = offer.formattedSas || lan.formatSas(offer.sas);
            el('lan-recv-sas-box').hidden = false;
          }

          el('lan-incoming-card').hidden = false;
          el('lan-accept-controls').hidden = false;
          el('lan-accept-btn').disabled = false;
          el('lan-decline-btn').disabled = false;

          var filesList = el('lan-incoming-files-list');
          filesList.replaceChildren();
          if (files.length <= 1) {
            var single = files[0] || {};
            el('lan-inc-name').textContent = single.name || 'Incoming file';
            el('lan-inc-size').textContent = formatBytes(totalSize);
            el('lan-inc-hash').textContent = single.sha256 ? ('SHA-256: ' + single.sha256) : 'SHA-256: verifying on receipt';
            filesList.hidden = true;
          } else {
            el('lan-inc-name').textContent = fileCount + ' incoming files';
            el('lan-inc-size').textContent = formatBytes(totalSize);
            el('lan-inc-hash').textContent = 'Per-file SHA-256 verification enabled';
            files.forEach(function (f) {
              var li = document.createElement('li');
              var n = document.createElement('span');
              n.className = 'lan-file-name';
              n.textContent = f.name || 'file';
              var s = document.createElement('span');
              s.className = 'lan-file-size';
              s.textContent = formatBytes(f.size || 0);
              li.append(n, s);
              filesList.appendChild(li);
            });
            filesList.hidden = false;
          }
          el('lan-recv-status').textContent = 'Confirm safety code matches sender, then accept or decline.';
        },
        onProgress: function (p) {
          if (!p) return;
          el('lan-recv-progress').hidden = false;
          var prefix = p.fileCount > 1 ? ('[' + ((p.fileIndex || 0) + 1) + '/' + p.fileCount + '] ') : '';
          var label = prefix + (p.fileName || 'Receiving') + ' · ' +
            formatBytes(p.bytesReceived || 0) + ' / ' + formatBytes(p.totalBytes || 0) + ' · ' +
            formatSpeed(p.speedBps || 0) + ' · ETA ' + formatEta(p.etaSeconds || 0);
          setProgress('lan-recv-bar', 'lan-recv-progressbar', 'lan-recv-percent', 'lan-recv-progress-text', p.percent, label);
        },
        onFileComplete: function (info) {
          if (!info) return;
          var dlUrl = info.downloadUrl || (info.blob ? URL.createObjectURL(info.blob) : '');
          if (dlUrl && !info.downloadUrl) objectUrls.push(dlUrl);
          el('lan-recv-complete').hidden = false;
          el('lan-recv-verified-msg').textContent = info.verified === false
            ? ('Checksum mismatch on ' + (info.name || 'file'))
            : ('SHA-256 verified: ' + (info.name || 'file'));

          if (dlUrl) {
            var saveLink = document.createElement('a');
            saveLink.className = 'btn btn-solid';
            saveLink.href = dlUrl;
            saveLink.download = info.name || 'download.bin';
            saveLink.textContent = 'Save ' + (info.name || 'file');
            el('lan-recv-downloads-list').appendChild(saveLink);

            if (info.verified !== false) {
              var autoA = document.createElement('a');
              autoA.hidden = true;
              autoA.href = dlUrl;
              autoA.download = info.name || 'download.bin';
              document.body.appendChild(autoA);
              autoA.click();
              setTimeout(function () { autoA.remove(); }, 1000);
            }
          }
        },
        onComplete: function () {
          setProgress('lan-recv-bar', 'lan-recv-progressbar', 'lan-recv-percent', 'lan-recv-progress-text', 100, 'Transfer complete — SHA-256 verified.');
          el('lan-recv-status').textContent = 'Transfer complete — SHA-256 verified.';
          el('lan-join-btn').disabled = false;
          if (window.showToast) window.showToast('Download verified');
        },
        onError: function (err) {
          var msg = (err && err.message) ? err.message : String(err || 'Receiver error.');
          showNotice(msg);
          el('lan-recv-status').textContent = msg;
          el('lan-join-btn').disabled = false;
        }
      });

      await activeReceiver.join(code);
    } catch (err) {
      showNotice((err && err.message) || 'Failed to join pairing room.');
      el('lan-recv-status').textContent = 'Connection failed.';
      el('lan-join-btn').disabled = false;
    }
  }

  function initTabs() {
    var tabList = document.querySelector('.clean-tabs');
    if (!tabList) return;
    var tabs = Array.prototype.slice.call(tabList.querySelectorAll('.clean-tab'));
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        setMode(tab.dataset.mode);
      });
    });
    tabList.addEventListener('keydown', function (e) {
      var idx = tabs.indexOf(document.activeElement);
      if (idx === -1) return;
      var next = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % tabs.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabs.length - 1;
      if (next !== -1) {
        e.preventDefault();
        tabs[next].focus();
        setMode(tabs[next].dataset.mode);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initTabs();

    var dropZone = el('lan-drop-zone');
    var fileInput = el('lan-file-input');
    var selectBtn = el('lan-select-files-btn');

    if (selectBtn && fileInput) {
      selectBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        fileInput.click();
      });
    }
    if (dropZone && fileInput) {
      dropZone.addEventListener('click', function (e) {
        if (e.target !== selectBtn && (!selectBtn || !selectBtn.contains(e.target))) {
          fileInput.click();
        }
      });
      ['dragenter', 'dragover'].forEach(function (evName) {
        dropZone.addEventListener(evName, function (e) {
          e.preventDefault();
          dropZone.classList.add('dragover');
        });
      });
      ['dragleave', 'drop'].forEach(function (evName) {
        dropZone.addEventListener(evName, function (e) {
          e.preventDefault();
          dropZone.classList.remove('dragover');
        });
      });
      dropZone.addEventListener('drop', function (e) {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          stageFiles(e.dataTransfer.files);
        }
      });
      fileInput.addEventListener('change', function (e) {
        if (e.target.files && e.target.files.length) {
          stageFiles(e.target.files);
        }
        fileInput.value = '';
      });
    }

    el('lan-clear-files-btn').addEventListener('click', function () {
      if (activeSender) return;
      stagedFiles = [];
      renderStagedFiles();
    });

    el('lan-create-room-btn').addEventListener('click', startSender);

    el('lan-send-cancel-btn').addEventListener('click', function () {
      if (activeSender && typeof activeSender.cancel === 'function') {
        activeSender.cancel('cancelled_by_sender');
      }
      el('lan-pairing-card').hidden = true;
      resetSenderSession(true);
    });

    el('lan-copy-code-btn').addEventListener('click', function () {
      var code = el('lan-pair-code').textContent;
      if (code && code !== '------') {
        copyText(code, el('lan-copy-code-btn'), 'Pairing code copied');
      }
    });

    el('lan-copy-link-btn').addEventListener('click', function () {
      var url = el('lan-pair-url-text').textContent;
      if (url) {
        copyText(url, el('lan-copy-link-btn'), 'Pairing link copied');
      }
    });

    var joinInput = el('lan-join-code-input');
    joinInput.addEventListener('input', function () {
      var pos = this.selectionStart || 0;
      var before = this.value;
      var norm = normalizePairingCode(before);
      if (norm !== before) {
        this.value = norm;
        var nextPos = Math.max(0, pos - (before.length - norm.length));
        try { this.setSelectionRange(nextPos, nextPos); } catch (_) {}
      }
    });

    el('lan-join-form').addEventListener('submit', function (e) {
      e.preventDefault();
      startReceiver();
    });

    el('lan-recv-cancel-btn').addEventListener('click', function () {
      if (activeReceiver && typeof activeReceiver.cancel === 'function') {
        activeReceiver.cancel('cancelled_by_receiver');
      }
      resetReceiverSession();
    });

    el('lan-accept-btn').addEventListener('click', async function () {
      el('lan-accept-btn').disabled = true;
      el('lan-decline-btn').disabled = true;
      el('lan-accept-controls').hidden = true;
      el('lan-recv-progress').hidden = false;
      el('lan-recv-status').textContent = 'Receiving encrypted stream…';
      try {
        if (pendingOffer && typeof pendingOffer.accept === 'function') await pendingOffer.accept();
        else if (activeReceiver && typeof activeReceiver.accept === 'function') await activeReceiver.accept();
      } catch (err) {
        showNotice((err && err.message) || 'Failed to accept transfer.');
      }
    });

    el('lan-decline-btn').addEventListener('click', async function () {
      el('lan-accept-btn').disabled = true;
      el('lan-decline-btn').disabled = true;
      try {
        if (pendingOffer && typeof pendingOffer.decline === 'function') await pendingOffer.decline('User declined');
        else if (activeReceiver && typeof activeReceiver.decline === 'function') await activeReceiver.decline('User declined');
      } catch (_) {}
      resetReceiverSession();
    });

    window.addEventListener('paste', function (e) {
      if (activeMode !== 'send' || activeSender) return;
      var tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      var files = e.clipboardData ? e.clipboardData.files : null;
      if (files && files.length > 0) stageFiles(files);
    });

    window.addEventListener('pagehide', function (e) {
      if (e && e.persisted) return;
      revokeUrls();
      if (activeSender && typeof activeSender.cancel === 'function') {
        try { activeSender.cancel('page_unload'); } catch (_) {}
      }
      if (activeReceiver && typeof activeReceiver.cancel === 'function') {
        try { activeReceiver.cancel('page_unload'); } catch (_) {}
      }
    });

    var params = new URLSearchParams(window.location.search);
    var inviteCode = (params.get('code') || params.get('lan') || '').trim();
    if (inviteCode) {
      setMode('receive');
      joinInput.value = normalizePairingCode(inviteCode);
    }
  });
}());
