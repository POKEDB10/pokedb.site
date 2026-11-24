// tests/phase6.test.js
// Dedicated Phase 6 Test Suite: Frontend speed, themes, responsive a11y, PWA (Tasks P6.1 - P6.8).

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createSqliteStorage } = require('../src/storage/sqlite');
const { FakeObjectStore } = require('../src/storage/fakeObjectStore');
const { AssetHasher, getAssetHasher } = require('../src/utils/assetHasher');
const { runAudit, THEMES, contrastRatio } = require('../scripts/audit-contrast');
const { checkBudgets, BUDGETS } = require('../scripts/check-budget');

const ROOT_DIR = path.resolve(__dirname, '..');

describe('Phase 6 Suite — Frontend speed, themes, responsive a11y, PWA (R5)', () => {
  let app;
  let storage;
  let objectStore;
  let clickBuffer;

  beforeAll(() => {
    storage = createSqliteStorage(':memory:');
    objectStore = new FakeObjectStore();
    ({ app, clickBuffer } = createApp({
      store: storage,
      objectStore,
      config: {
        isProduction: false,
        baseUrl: 'http://127.0.0.1:5050'
      }
    }));
  });

  afterAll(() => {
    if (clickBuffer && clickBuffer.stop) clickBuffer.stop();
    if (storage && storage.close) storage.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Asset Hashing & Immutable Headers (P6.1)
  // ─────────────────────────────────────────────────────────────────────────
  describe('P6.1 Asset Hasher & Caching Headers', () => {
    test('computes 8-character hex SHA-256 for assets and creates lookup manifest', () => {
      const hasher = new AssetHasher({ rootDir: ROOT_DIR });
      expect(hasher.manifest.size).toBeGreaterThan(0);

      const themeHashed = hasher.getHashedPath('/shared/theme.css');
      expect(themeHashed).toMatch(/^\/assets\/theme\.[a-f0-9]{8}\.css$/);
    });

    test('serves /assets/:filename with Cache-Control: public, max-age=31536000, immutable', async () => {
      const hasher = getAssetHasher();
      const themeHashed = hasher.getHashedPath('/shared/theme.css');

      const res = await request(app).get(themeHashed);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-type']).toContain('text/css');
    });

    test('rewrites asset references in HTML strings', () => {
      const hasher = getAssetHasher();
      const inputHtml = '<link rel="stylesheet" href="/shared/theme.css"><script src="/shared/theme-switcher.js"></script>';
      const rewritten = hasher.rewriteHtml(inputHtml);

      expect(rewritten).not.toContain('href="/shared/theme.css"');
      expect(rewritten).toMatch(/href="\/assets\/theme\.[a-f0-9]{8}\.css"/);
      expect(rewritten).toMatch(/src="\/assets\/theme-switcher\.[a-f0-9]{8}\.js"/);
    });

    test('no bare max-age=300 exists across application codebase', () => {
      const srcFiles = ['src/app.js', 'server.js', 'tools/shared/theme.css', 'tools/shared/theme-switcher.js'];
      for (const rel of srcFiles) {
        const full = path.join(ROOT_DIR, rel);
        if (fs.existsSync(full)) {
          const content = fs.readFileSync(full, 'utf8');
          expect(content).not.toMatch(/max-age=300\b(?!,)/);
        }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Self-Hosted Fonts & Zero Third-Party CDNs (P6.2)
  // ─────────────────────────────────────────────────────────────────────────
  describe('P6.2 Self-Hosted Fonts (IBM Plex Mono & Sans)', () => {
    test('public/fonts contains all 6 Latin WOFF2 subsets and SIL OFL license', () => {
      const fontsDir = path.join(ROOT_DIR, 'public', 'fonts');
      expect(fs.existsSync(path.join(fontsDir, 'fonts.css'))).toBe(true);
      expect(fs.existsSync(path.join(fontsDir, 'OFL.txt'))).toBe(true);
      expect(fs.existsSync(path.join(fontsDir, 'ibm-plex-mono-400.woff2'))).toBe(true);
      expect(fs.existsSync(path.join(fontsDir, 'ibm-plex-mono-500.woff2'))).toBe(true);
      expect(fs.existsSync(path.join(fontsDir, 'ibm-plex-mono-600.woff2'))).toBe(true);
      expect(fs.existsSync(path.join(fontsDir, 'ibm-plex-sans-400.woff2'))).toBe(true);
      expect(fs.existsSync(path.join(fontsDir, 'ibm-plex-sans-500.woff2'))).toBe(true);
      expect(fs.existsSync(path.join(fontsDir, 'ibm-plex-sans-600.woff2'))).toBe(true);
    });

    test('zero references to googleapis or gstatic in public, tools, or templates', () => {
      const checkDirs = ['public', 'tools', 'templates'];
      const walk = (dir) => {
        const list = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of list) {
          const p = path.join(dir, item.name);
          if (item.isDirectory()) {
            walk(p);
          } else if (item.isFile() && (p.endsWith('.html') || p.endsWith('.css') || p.endsWith('.js'))) {
            const content = fs.readFileSync(p, 'utf8');
            expect(content).not.toContain('fonts.googleapis.com');
            expect(content).not.toContain('fonts.gstatic.com');
          }
        }
      };

      for (const d of checkDirs) {
        walk(path.join(ROOT_DIR, d));
      }
    });

    test('GET /fonts/fonts.css returns self-hosted font definitions', async () => {
      const res = await request(app).get('/fonts/fonts.css');
      expect(res.status).toBe(200);
      expect(res.text).toContain("font-family: 'IBM Plex Mono'");
      expect(res.text).toContain("font-family: 'IBM Plex Sans'");
      expect(res.text).toContain('url(\'/fonts/ibm-plex-mono-400.woff2\')');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Theme System & Contrast Audit (P6.3)
  // ─────────────────────────────────────────────────────────────────────────
  describe('P6.3 Theme System & WCAG Contrast Audit', () => {
    test('all 12 themes pass WCAG 2.1 AA contrast requirements with 0 failures', () => {
      expect(Object.keys(THEMES).length).toBe(12);

      for (const [name, tokens] of Object.entries(THEMES)) {
        const textOnBg = contrastRatio(tokens.text, tokens.bg);
        expect(textOnBg).toBeGreaterThanOrEqual(4.5);

        const textOnSurface = contrastRatio(tokens.text, tokens.surface);
        expect(textOnSurface).toBeGreaterThanOrEqual(4.5);

        const mutedOnBg = contrastRatio(tokens.muted, tokens.bg);
        expect(mutedOnBg).toBeGreaterThanOrEqual(4.5);

        const accentOnBg = contrastRatio(tokens.accent, tokens.bg);
        expect(accentOnBg).toBeGreaterThanOrEqual(3.0);

        const buttonContrast = contrastRatio(tokens.accentText, tokens.accent);
        expect(buttonContrast).toBeGreaterThanOrEqual(4.5);
      }
    });

    test('theme-switcher.js uses static token map and eliminates probe element reflows', () => {
      const switcherContent = fs.readFileSync(path.join(ROOT_DIR, 'tools', 'shared', 'theme-switcher.js'), 'utf8');
      expect(switcherContent).toContain('STATIC_TOKENS');
      expect(switcherContent).not.toContain('getComputedStyle(probe)');
      expect(switcherContent).toContain('document.cookie');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Client-Side QR Generation & Cache Headers (P6.6)
  // ─────────────────────────────────────────────────────────────────────────
  describe('P6.6 Client-Side QR Generation & API Caching', () => {
    test('tools/shared/qrcode.min.js is vendored with MIT license header', () => {
      const qrJs = fs.readFileSync(path.join(ROOT_DIR, 'tools', 'shared', 'qrcode.min.js'), 'utf8');
      expect(qrJs).toContain('License: MIT');
      expect(qrJs).toContain('Ryan Day');
      expect(qrJs.length).toBeGreaterThan(10000);
    });

    test('GET /api/qr returns Cache-Control: public, max-age=86400', async () => {
      const res = await request(app).get('/api/qr?text=https://example.com&format=svg');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('public, max-age=86400');
      expect(res.headers['content-type']).toContain('image/svg+xml');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. PWA Manifest & Service Worker (P6.7)
  // ─────────────────────────────────────────────────────────────────────────
  describe('P6.7 PWA Manifest & Service Worker', () => {
    test('manifest.webmanifest defines standalone display, theme color, and maskable icons', () => {
      const manifestPath = path.join(ROOT_DIR, 'tools', 'public', 'manifest.webmanifest');
      expect(fs.existsSync(manifestPath)).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      expect(manifest.display).toBe('standalone');
      expect(manifest.theme_color).toBe('#070708');
      expect(Array.isArray(manifest.icons)).toBe(true);
      expect(manifest.icons.some(i => i.purpose && i.purpose.includes('maskable'))).toBe(true);
    });

    test('sw.js configures precaching, CacheFirst for assets, and NetworkOnly for APIs', () => {
      const swPath = path.join(ROOT_DIR, 'tools', 'public', 'sw.js');
      expect(fs.existsSync(swPath)).toBe(true);

      const sw = fs.readFileSync(swPath, 'utf8');
      expect(sw).toContain('PRECACHE_ASSETS');
      expect(sw).toContain("url.pathname.startsWith('/api')");
      expect(sw).toContain("url.pathname.startsWith('/d/')");
      expect(sw).toContain("url.pathname.startsWith('/assets/')");
      expect(sw).toContain('skipWaiting');
      expect(sw).toContain('clients.claim');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Performance Budget & Gzip Sizes (P6.8)
  // ─────────────────────────────────────────────────────────────────────────
  describe('P6.8 Performance Budget Check', () => {
    test('all pages and bundles pass gzip size budgets in scripts/check-budget.js', () => {
      expect(BUDGETS.length).toBeGreaterThanOrEqual(10);
      for (const item of BUDGETS) {
        let totalGzip = 0;
        for (const f of item.files) {
          const full = path.join(ROOT_DIR, f);
          if (fs.existsSync(full)) {
            const zlib = require('zlib');
            totalGzip += zlib.gzipSync(fs.readFileSync(full)).length;
          }
        }
        expect(totalGzip).toBeLessThanOrEqual(item.limitKb * 1024);
      }
    });
  });
});
