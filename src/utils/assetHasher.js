// src/utils/assetHasher.js
// Boot-time asset hashing and immutable asset middleware (Task P6.1, FE-001, H3).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class AssetHasher {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.join(__dirname, '..', '..');
    this.manifest = new Map(); // original path -> hashed URL (/assets/name.hash.ext)
    this.assetMap = new Map(); // filename (name.hash.ext) -> { filePath, mimeType }
    this.scan();
  }

  getMimeType(ext) {
    switch (ext.toLowerCase()) {
      case '.css': return 'text/css; charset=utf-8';
      case '.js': return 'application/javascript; charset=utf-8';
      case '.woff2': return 'font/woff2';
      case '.svg': return 'image/svg+xml';
      case '.png': return 'image/png';
      case '.ico': return 'image/x-icon';
      case '.json':
      case '.webmanifest': return 'application/manifest+json';
      default: return 'application/octet-stream';
    }
  }

  scan() {
    this.manifest.clear();
    this.assetMap.clear();

    const scanDirs = [
      { dir: path.join(this.rootDir, 'public'), prefix: '' },
      { dir: path.join(this.rootDir, 'tools', 'shared'), prefix: '/shared' }
    ];

    for (const { dir, prefix } of scanDirs) {
      if (!fs.existsSync(dir)) continue;
      this.walkDir(dir, dir, prefix);
    }
  }

  walkDir(currentDir, baseDir, prefix) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        this.walkDir(fullPath, baseDir, prefix);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (!['.css', '.js', '.woff2', '.svg', '.webmanifest'].includes(ext.toLowerCase())) {
          continue;
        }

        const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
        const originalUrl = `${prefix}/${relativePath}`.replace(/\/+/g, '/');

        const content = fs.readFileSync(fullPath);
        const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
        const baseName = path.basename(entry.name, ext);
        const hashedFileName = `${baseName}.${hash}${ext}`;
        const hashedUrl = `/assets/${hashedFileName}`;

        this.manifest.set(originalUrl, hashedUrl);
        this.assetMap.set(hashedFileName, {
          filePath: fullPath,
          mimeType: this.getMimeType(ext)
        });
      }
    }
  }

  getHashedPath(originalUrl) {
    return this.manifest.get(originalUrl) || originalUrl;
  }

  rewriteHtml(html) {
    if (typeof html !== 'string') return html;
    let rewritten = html;
    for (const [originalUrl, hashedUrl] of this.manifest.entries()) {
      // Replace href="..." and src="..."
      const pattern = new RegExp(`(href|src)=["']${originalUrl}["']`, 'g');
      rewritten = rewritten.replace(pattern, `$1="${hashedUrl}"`);
    }
    return rewritten;
  }

  createMiddleware() {
    return (req, res, next) => {
      if (!req.path.startsWith('/assets/')) {
        return next();
      }

      const fileName = req.path.replace(/^\/assets\//, '');
      const asset = this.assetMap.get(fileName);

      if (!asset) {
        return res.status(404).send('Asset Not Found');
      }

      res.set({
        'Content-Type': asset.mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff'
      });

      fs.createReadStream(asset.filePath).pipe(res);
    };
  }
}

let defaultHasher = null;

function getAssetHasher(options) {
  if (!defaultHasher || options) {
    defaultHasher = new AssetHasher(options);
  }
  return defaultHasher;
}

module.exports = {
  AssetHasher,
  getAssetHasher
};
