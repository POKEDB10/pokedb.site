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

  root.PokeDbUtils = { formatBytes: formatBytes, getFileIcon: getFileIcon };
})(window);
