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
    var media = document.createElement(kind === 'image' ? 'img' : kind === 'video' ? 'video' : 'audio');
    media.src = streamUrl;
    media.preload = 'metadata';
    if (kind === 'image') media.alt = name;
    if (kind !== 'image') media.controls = true;
    wrapper.appendChild(media);
    wrapper.style.display = 'block';
  }

  async function load() {
    byId('download-btn').href = streamUrl;
    var meta = { name: id, size: 0, mimeType: '', downloads: 0, expiresAt: null };
    try {
      var response = await fetch('/api/drop/info?file_code=' + encodeURIComponent(id), { cache: 'no-store' });
      if (!response.ok) throw new Error('Metadata unavailable');
      var json = await response.json();
      var item = json.data || json.result || json;
      if (Array.isArray(item)) item = item[0];
      if (item) { meta.name = item.name || item.filename || meta.name; meta.size = Number(item.size || item.bytes || 0); meta.mimeType = item.mimeType || item.mime_type || ''; meta.downloads = Number(item.download || item.downloads || item.download_count || 0); meta.expiresAt = item.expiresAt || item.expires_at || null; }
    } catch (error) { /* The direct stream is still usable when metadata is unavailable. */ }
    byId('file-title').textContent = meta.name;
    byId('file-icon').textContent = getFileIcon(meta.name);
    byId('file-size').textContent = formatBytes(meta.size);
    byId('file-downloads').textContent = meta.downloads + ' downloads';
    byId('file-expiry').textContent = meta.expiresAt ? 'Expires ' + new Date(meta.expiresAt).toLocaleString() : 'No expiry';
    renderPreview(meta.name, meta.mimeType);
  }

  byId('copy-btn').addEventListener('click', function () { navigator.clipboard.writeText(window.location.href); this.textContent = 'Copied'; var button = this; setTimeout(function () { button.textContent = 'Copy link'; }, 1500); });
  byId('qr-btn').addEventListener('click', async function () { var box = byId('qr-box'); box.replaceChildren(); try { var response = await fetch('/api/qr?format=png&text=' + encodeURIComponent(window.location.href)); if (!response.ok) throw new Error(); var image = document.createElement('img'); image.width = 220; image.height = 220; image.alt = 'QR code for this file'; image.src = URL.createObjectURL(await response.blob()); box.appendChild(image); byId('qr-modal').style.display = 'grid'; } catch (error) { box.textContent = 'QR generation failed. Please retry.'; byId('qr-modal').style.display = 'grid'; } });
  byId('close-qr-btn').addEventListener('click', function () { byId('qr-modal').style.display = 'none'; });
  load();
}());
