// tests/phase7.test.js
// Dedicated Phase 7 test suite: Portfolio, Case Studies, Client-Side Tool Suite, Cross-Tool UX, and Growth.

const request = require('supertest');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../src/app');
const { createSqliteStorage } = require('../src/storage/sqlite');
const { FakeObjectStore } = require('../src/storage/fakeObjectStore');
const { registry } = require('../src/registry');
const CryptoWeb = require('../tools/shared/crypto-web');

describe('Phase 7: Portfolio, Tools, and Growth Suite', () => {
  let app;
  let store;
  let objectStore;
  let clickBuffer;
  let config;

  beforeEach(() => {
    config = {
      isProduction: false,
      baseUrl: 'https://pokedb.site',
      benchBypassLimiter: true
    };
    store = createSqliteStorage(':memory:');
    objectStore = new FakeObjectStore();
    const appBundle = createApp({ config, store, objectStore });
    app = appBundle.app;
    clickBuffer = appBundle.clickBuffer;
  });

  afterEach(() => {
    if (clickBuffer && clickBuffer.stop) clickBuffer.stop();
    if (store && store.close) store.close();
  });

  // -------------------------------------------------------------------------
  // P7.1: Single Source of Truth for Project Cards
  // -------------------------------------------------------------------------
  describe('P7.1 Project Data Validation', () => {
    test('data/projects.json contains valid projects adhering to schema', () => {
      const projectsPath = path.join(__dirname, '..', 'data', 'projects.json');
      expect(fs.existsSync(projectsPath)).toBe(true);

      const projects = JSON.parse(fs.readFileSync(projectsPath, 'utf8'));
      expect(Array.isArray(projects)).toBe(true);
      expect(projects.length).toBeGreaterThanOrEqual(6);

      const published = projects.filter(p => p.status !== 'draft');
      expect(published.length).toBeGreaterThanOrEqual(3);

      for (const p of published) {
        expect(p.slug).toMatch(/^[a-z0-9-]+$/);
        expect(p.title).toBeTruthy();
        expect(p.summary).toBeTruthy();
        expect(p.metric).toBeTruthy();
        expect(Array.isArray(p.stack)).toBe(true);
        expect(Object.keys(p.links).length).toBeGreaterThan(0);
        expect(JSON.stringify(p)).not.toContain('TODO(owner)');
      }
    });
  });

  // -------------------------------------------------------------------------
  // P7.2: Landing Hero & SEO JSON-LD
  // -------------------------------------------------------------------------
  describe('P7.2 Landing Page Hero & SEO JSON-LD', () => {
    test('GET / renders scannable hero, action buttons, and structured JSON-LD', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);

      // Verify JSON-LD graph
      expect(res.text).toContain('application/ld+json');
      expect(res.text).toContain('"@type": "Person"');
      expect(res.text).toContain('"@type": "ProfilePage"');
      expect(res.text).toContain('"@type": "WebApplication"');
      expect(res.text).toContain('"applicationCategory": "DeveloperApplication"');

      // Verify Hero and Action bar
      expect(res.text).toContain('Systems &amp; Infrastructure Developer');
      expect(res.text).toContain('View projects');
      expect(res.text).toContain('Launch tools');
      expect(res.text).toContain('All systems operational · 10,000 req/s verified');
    });
  });

  // -------------------------------------------------------------------------
  // P7.3 & P7.4: Projects & Case Studies
  // -------------------------------------------------------------------------
  describe('P7.3 & P7.4 Case Studies & Project Skeletons', () => {
    test('GET /projects/pokedb-site renders flagship case study with measured telemetry', async () => {
      const res = await request(app).get('/projects/pokedb-site');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Rebuilding pokedb.site');
      expect(res.text).toContain('ClickBufferManager');
      expect(res.text).toContain('autocannon');
      expect(res.text).toContain('4,765 req/s');
      expect(res.text).toContain('Zero Server Disk I/O');
    });

    test('GET /projects/:slug renders draft project skeletons with TODO markers', async () => {
      const slugs = ['aegis', 'beacon', 'kds', 'manifold', 'prism'];
      for (const slug of slugs) {
        const res = await request(app).get(`/projects/${slug}`);
        expect(res.status).toBe(200);
        expect(res.text).toContain('DRAFT SPECIFICATION');
        expect(res.text).toContain('TODO(owner)');
      }
    });
  });

  // -------------------------------------------------------------------------
  // P7.5: Client-Side Tool Suite & Offline Zero-Egress CSP
  // -------------------------------------------------------------------------
  describe('P7.5 Client-Side Tool Suite & Zero-Egress CSP', () => {
    const offlineTools = [
      'json', 'jwt', 'codec', 'hash', 'uuid', 'cron', 'diff', 'minecraft', 'sanitizer'
    ];

    test.each(offlineTools)('GET /tools/%s serves 200 with connect-src none', async (toolId) => {
      const res = await request(app).get(`/tools/${toolId}/`);
      expect(res.status).toBe(200);
      const csp = res.headers['content-security-policy'] || '';
      expect(csp).toContain("connect-src 'none'");
    });

    test('all 9 offline tools are registered in tool registry', () => {
      for (const id of offlineTools) {
        const tool = registry.find(t => t.id === id);
        expect(tool).toBeDefined();
        expect(tool.offline).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // P7.6: Paste v2 End-to-End Cryptography
  // -------------------------------------------------------------------------
  describe('P7.6 Paste v2 WebCrypto AES-256-GCM', () => {
    test('CryptoWeb helper encrypts and decrypts text with correct chunk IV & AAD', async () => {
      const plain = 'Secret credentials to share across machines: 42-X-99';
      const enc = await CryptoWeb.encryptText(plain);
      expect(enc.ciphertext).toBeTruthy();
      expect(enc.key).toBeTruthy();

      const decrypted = await CryptoWeb.decryptText(enc.ciphertext, enc.key);
      expect(decrypted).toBe(plain);
    });

    test('plain text pastes continue to function without encryption (curl parity)', async () => {
      const res = await request(app)
        .post('/api/paste/create')
        .send({ content: 'echo "hello from curl"', language: 'bash' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.url).not.toContain('#k=');
    });
  });

  // -------------------------------------------------------------------------
  // P7.7: TinyURL v2 Preview & CLI Root Shortening
  // -------------------------------------------------------------------------
  describe('P7.7 TinyURL v2 Preview & CLI Shortening', () => {
    test('GET /preview/:code renders HTML preview and QR SVG', async () => {
      const shortenRes = await request(app)
        .post('/api/shorten')
        .send({ url: 'https://example.com/target-test' });
      expect(shortenRes.status).toBe(200);
      const code = shortenRes.body.code;

      const previewRes = await request(app).get(`/preview/${code}`);
      expect(previewRes.status).toBe(200);
      expect(previewRes.text).toContain('Link Preview &amp; Analytics');
      expect(previewRes.text).toContain('https://example.com/target-test');
      expect(previewRes.text).toContain('Download QR SVG');
    });

    test('POST / with CLI user-agent returns plain text short URL', async () => {
      const res = await request(app)
        .post('/')
        .set('User-Agent', 'curl/8.4.0')
        .send({ url: 'https://github.com/POKEDB10' });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.text).toMatch(/^https?:\/\/[^\/]+\/[a-zA-Z0-9_-]+\n$/);
    });
  });

  // -------------------------------------------------------------------------
  // P7.8: Cross-Tool UX & API Docs
  // -------------------------------------------------------------------------
  describe('P7.8 Cross-Tool UX & Docs', () => {
    test('GET /docs renders copy-ready curl examples and shell functions', async () => {
      const res = await request(app).get('/docs');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Developer API &amp; CLI Reference');
      expect(res.text).toContain('pbpaste()');
      expect(res.text).toContain('curl -d url=');
    });

    test('ShareX configuration files are accessible and valid JSON', () => {
      const sxcuPath = path.join(__dirname, '..', 'public', 'sharex', 'pokedb-tinyurl.sxcu');
      expect(fs.existsSync(sxcuPath)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(sxcuPath, 'utf8'));
      expect(parsed.Name).toContain('pokedb.site');
      expect(parsed.RequestMethod).toBe('POST');
    });

    test('docs/openapi.yaml exists and defines core endpoints', () => {
      const yamlPath = path.join(__dirname, '..', 'docs', 'openapi.yaml');
      expect(fs.existsSync(yamlPath)).toBe(true);
      const content = fs.readFileSync(yamlPath, 'utf8');
      expect(content).toContain('/api/shorten');
      expect(content).toContain('/api/paste/create');
      expect(content).toContain('/healthz');
    });
  });

  // -------------------------------------------------------------------------
  // P7.9: Changelog, RSS Feed & Public Status
  // -------------------------------------------------------------------------
  describe('P7.9 Changelog, RSS Feed & Status History', () => {
    test('GET /changelog renders release history', async () => {
      const res = await request(app).get('/changelog');
      expect(res.status).toBe(200);
      expect(res.text).toContain('System Changelog');
      expect(res.text).toContain('v2.0.0');
    });

    test('GET /feed.xml returns valid RSS 2.0 XML document', async () => {
      const res = await request(app).get('/feed.xml');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<?xml');
      expect(res.text).toContain('<rss version="2.0"');
      expect(res.text).toContain('<title>pokedb.site Changelog</title>');
    });

    test('GET /status renders public status and subsystem list', async () => {
      const res = await request(app).get('/status');
      expect(res.status).toBe(200);
      expect(res.text).toContain('System Status &amp; Telemetry');
      expect(res.text).toContain('All Core Services Operational');
      expect(res.text).toContain('SQLite WAL Engine');
    });
  });
});
