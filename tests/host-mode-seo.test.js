// tests/host-mode-seo.test.js
// Regression test suite for Host-Mode vs Path-Mode SEO and Robots Policies (R9.2 Item 8)

const request = require('supertest');
const { createApp } = require('../src/app');
const { createSqliteStorage } = require('../src/storage/sqlite');
const { getConfig } = require('../src/config');
const { Sweeper } = require('../src/utils/sweeper');

describe('Host-Mode vs Path-Mode SEO & Robots Header Telemetry (R9.2 Item 8)', () => {
  let app;
  let storage;
  let sweeper;

  beforeAll(() => {
    const config = getConfig();
    storage = createSqliteStorage(':memory:');
    sweeper = new Sweeper(storage);
    const created = createApp({ store: storage, config, sweeper });
    app = created.app;
  });

  afterAll(() => {
    try {
      sweeper.stop();
      storage.close();
    } catch (_) {}
  });

  describe('Host-Mode Subdomain Routing', () => {
    test('Tool roots on subdomains return X-Robots-Tag: index, follow', async () => {
      const hosts = [
        'tinyurl.pokedb.site',
        'paste.pokedb.site',
        'drop.pokedb.site',
        'tools.pokedb.site',
        'qr.pokedb.site'
      ];

      for (const host of hosts) {
        const res = await request(app).get('/').set('Host', host);
        expect(res.headers['x-robots-tag']).toBe('index, follow');
      }
    });

    test('Short link paths and preview paths on tinyurl subdomain return strict noindex', async () => {
      const resShort = await request(app).get('/abc123').set('Host', 'tinyurl.pokedb.site');
      expect(resShort.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive, nosnippet');

      const resPreview = await request(app).get('/preview/abc123').set('Host', 'tinyurl.pokedb.site');
      expect(resPreview.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive, nosnippet');
    });

    test('Paste views and raw routes on paste subdomain return strict noindex', async () => {
      const resView = await request(app).get('/v/p12345').set('Host', 'paste.pokedb.site');
      expect(resView.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive, nosnippet');

      const resRaw = await request(app).get('/raw/p12345').set('Host', 'paste.pokedb.site');
      expect(resRaw.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive, nosnippet');
    });

    test('Drop downloads and file views on drop subdomain return strict noindex', async () => {
      const resDl = await request(app).get('/d/f12345').set('Host', 'drop.pokedb.site');
      expect(resDl.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive, nosnippet');

      const resView = await request(app).get('/v/f12345').set('Host', 'drop.pokedb.site');
      expect(resView.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive, nosnippet');
    });
  });

  describe('Path-Mode Apex Routing', () => {
    test('Tool roots under /tools/ return X-Robots-Tag: index, follow', async () => {
      const toolPaths = [
        '/tools/',
        '/tools/tinyurl/',
        '/tools/paste/',
        '/tools/drop/',
        '/tools/qr/'
      ];

      for (const p of toolPaths) {
        const res = await request(app).get(p).set('Host', 'pokedb.site');
        expect(res.headers['x-robots-tag']).toBe('index, follow');
      }
    });

    test('User content paths on apex return strict noindex', async () => {
      const contentPaths = [
        '/v/sample-id',
        '/view/sample-id',
        '/d/sample-id',
        '/raw/sample-id'
      ];

      for (const p of contentPaths) {
        const res = await request(app).get(p).set('Host', 'pokedb.site');
        expect(res.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive, nosnippet');
      }
    });
  });
});
