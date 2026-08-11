(function (root) {
  function formatBytes(bytes) {
    if (!bytes || isNaN(bytes)) return '0 B';
    var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    var index = Math.floor(Math.log(bytes) / Math.log(1024));
    return parseFloat((bytes / Math.pow(1024, index)).toFixed(2)) + ' ' + sizes[index];
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

  root.PokeDbUtils = {
    formatBytes: formatBytes,
    getFileIcon: getFileIcon,
    saveFileToIndexedDb: saveFileToIndexedDb,
    getFileFromIndexedDb: getFileFromIndexedDb,
    deleteFileFromIndexedDb: deleteFileFromIndexedDb
  };
})(window);
