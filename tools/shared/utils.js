(function (root) {
  function formatBytes(bytes) {
    if (!bytes || isNaN(bytes)) return '0 B';
    var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    var index = Math.floor(Math.log(bytes) / Math.log(1024));
    return parseFloat((bytes / Math.pow(1024, index)).toFixed(2)) + ' ' + sizes[index];
  }

  var SVG_ICONS = {
    video: '<svg class="icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>',
    audio: '<svg class="icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>',
    image: '<svg class="icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
    doc: '<svg class="icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>',
    archive: '<svg class="icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>',
    code: '<svg class="icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>',
    folder: '<svg class="icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
    file: '<svg class="icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>'
  };

  function getFileType(filename) {
    var ext = (filename || '').split('.').pop().toLowerCase();
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'flac', 'ogg', 'm4a'].includes(ext)) return 'audio';
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return 'image';
    if (['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext)) return 'doc';
    if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return 'archive';
    if (['js', 'ts', 'py', 'json', 'html', 'css', 'rs', 'go', 'java', 'c', 'cpp'].includes(ext)) return 'code';
    return 'file';
  }

  function getFileSvg(filename, isFolder) {
    if (isFolder) return SVG_ICONS.folder;
    var type = getFileType(filename);
    return SVG_ICONS[type] || SVG_ICONS.file;
  }

  function getFileIcon(filename) {
    var type = getFileType(filename);
    return '[' + type.toUpperCase() + ']';
  }

  function renderFileIcon(targetEl, filename, isFolder) {
    if (!targetEl) return;
    targetEl.innerHTML = getFileSvg(filename, isFolder);
  }

  function openUploadDb() {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) return reject(new Error('IndexedDB not supported'));
      var req = root.indexedDB.open('pokedb_upload_store_v2', 1);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files');
        }
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target ? e.target.error : e); };
    });
  }

  function saveFileToIndexedDb(id, file) {
    return openUploadDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('files', 'readwrite');
        var store = tx.objectStore('files');
        store.put(file, id);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function (e) { reject(e.target ? e.target.error : e); };
        tx.onabort = function (e) { reject(e.target ? e.target.error : e); };
      });
    }).catch(function (err) {
      console.warn('saveFileToIndexedDb failed:', err);
      return false;
    });
  }

  function getFileFromIndexedDb(id) {
    return openUploadDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('files', 'readonly');
        var store = tx.objectStore('files');
        var req = store.get(id);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function (e) { resolve(null); };
      });
    }).catch(function (err) {
      console.warn('getFileFromIndexedDb failed:', err);
      return null;
    });
  }

  function deleteFileFromIndexedDb(id) {
    return openUploadDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction('files', 'readwrite');
        var store = tx.objectStore('files');
        store.delete(id);
        tx.oncomplete = function () { resolve(); };
      });
    }).catch(function () {});
  }

  function formatSpeedAuto(bytesPerSec) {
    var bytes = Number(bytesPerSec) || 0;
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB/s';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB/s';
    if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB/s';
    return bytes.toFixed(0) + ' B/s';
  }

  root.PokeDbUtils = {
    formatBytes: formatBytes,
    formatSpeedAuto: formatSpeedAuto,
    getFileIcon: getFileIcon,
    getFileSvg: getFileSvg,
    getFileType: getFileType,
    renderFileIcon: renderFileIcon,
    saveFileToIndexedDb: saveFileToIndexedDb,
    getFileFromIndexedDb: getFileFromIndexedDb,
    deleteFileFromIndexedDb: deleteFileFromIndexedDb
  };
})(window);
