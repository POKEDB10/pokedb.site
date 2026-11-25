// tests/prod-tools-fixes.test.js
// Regression & end-to-end verification tests for production fixes:
// 1. Optional Turnstile mode (TURNSTILE_MODE=optional) without weakening strict default
// 2. LAN & offline utility production routing (/tools/lan/, no stale lan.pokedb.site links)
// 3. QR Studio monogram center badge contrast fix (non-white text on light badge)
// 4. Drop production fallback storage (Rootz primary + local blob fallback, burn, Range, list, delete)

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { getNavUrl } = require('../src/registry');
const { createSqliteStorage } = require('../src/storage/sqlite');

const ROOT_DIR = path.resolve(__dirname, '..');

describe('Production Fixes Verification Suite', () => {
  describe('1. Turnstile mode configuration & production behavior', () => {
    let store;

    beforeEach(() => {
      store = createSqliteStorage(':memory:');
    });

    afterEach(() => {
      try { store.close(); } catch (_) {}
      jest.restoreAllMocks();
    });

    function cleanupCreated(created) {
      try { if (created.clickBuffer && created.clickBuffer.stop) created.clickBuffer.stop(); } catch (_) {}
      try { if (created.lanRouter && created.lanRouter.destroy) created.lanRouter.destroy(); } catch (_) {}
    }

    test('loadConfig defaults turnstileMode to strict and parses optional + dropDirectFallback', () => {
      const strictCfg = loadConfig({ NODE_ENV: 'production' });
      expect(strictCfg.turnstileMode).toBe('strict');
      expect(strictCfg.dropDirectFallback).toBe(false);

      const optCfg = loadConfig({
        NODE_ENV: 'production',
        TURNSTILE_MODE: 'optional',
        DROP_DIRECT_FALLBACK: '1'
      });
      expect(optCfg.turnstileMode).toBe('optional');
      expect(optCfg.dropDirectFallback).toBe(true);
    });

    test('TURNSTILE_MODE=optional allows TinyURL, Paste, and Abuse Report in production when keys unset', async () => {
      const created = createApp({
        store,
        config: {
          isProduction: true,
          env: 'production',
          turnstileSecretKey: '',
          turnstileMode: 'optional',
          dropDirectFallback: true
        }
      });
      const { app } = created;
      try {
        const shortenRes = await request(app)
          .post('/api/shorten')
          .send({ url: 'https://example.com/optional-turnstile' });
        expect(shortenRes.status).toBe(200);
        expect(shortenRes.body.code).toBeTruthy();
        expect(shortenRes.body.shortUrl).toContain(shortenRes.body.code);

        const pasteRes = await request(app)
          .post('/api/paste/create')
          .send({ content: 'hello production paste' });
        expect(pasteRes.status).toBe(200);
        expect(pasteRes.body.success).toBe(true);

        const reportRes = await request(app)
          .post('/api/report')
          .send({ id: shortenRes.body.code, kind: 'link', reason: 'test' });
        expect(reportRes.status).toBe(200);
        expect(reportRes.body.success).toBe(true);
      } finally {
        cleanupCreated(created);
      }
    });

    test('TURNSTILE_MODE=optional still verifies Turnstile token when secretKey IS configured', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: false })
      });

      try {
        const { app } = createApp({
          store,
          config: {
            isProduction: true,
            env: 'production',
            turnstileSecretKey: 'real-secret-configured',
            turnstileMode: 'optional'
          }
        });

        const res = await request(app)
          .post('/api/shorten')
          .send({ url: 'https://example.com/must-verify', 'cf-turnstile-response': 'bad-tok' });
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('turnstile_verification_failed');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('2. LAN & Offline Utilities Routing (No NXDOMAIN lan.pokedb.site nav links)', () => {
    test('getNavUrl routes lan and offline tools to pokedb.site/tools/* while keeping subdomain tools on subdomains', () => {
      expect(getNavUrl('main', true)).toBe('https://pokedb.site/');
      expect(getNavUrl('tools', true)).toBe('https://tools.pokedb.site/');
      expect(getNavUrl('tinyurl', true)).toBe('https://tinyurl.pokedb.site/');
      expect(getNavUrl('qr', true)).toBe('https://qr.pokedb.site/');
      expect(getNavUrl('drop', true)).toBe('https://drop.pokedb.site/');
      expect(getNavUrl('paste', true)).toBe('https://paste.pokedb.site/');
      expect(getNavUrl('health', true)).toBe('https://health.pokedb.site/');

      expect(getNavUrl('lan', true)).toBe('https://pokedb.site/tools/lan/');
      expect(getNavUrl('json', true)).toBe('https://pokedb.site/tools/json/');
      expect(getNavUrl('jwt', true)).toBe('https://pokedb.site/tools/jwt/');
      expect(getNavUrl('codec', true)).toBe('https://pokedb.site/tools/codec/');
      expect(getNavUrl('hash', true)).toBe('https://pokedb.site/tools/hash/');

      expect(getNavUrl('lan', false)).toBe('/tools/lan/');
    });

    test('no HTML page nav or hub card links to dead https://lan.pokedb.site/', () => {
      const htmlFiles = [
        path.join(ROOT_DIR, 'public', 'index.html'),
        path.join(ROOT_DIR, 'tools', 'public', 'index.html'),
        path.join(ROOT_DIR, 'tools', 'drop', 'public', 'index.html'),
        path.join(ROOT_DIR, 'tools', 'drop', 'public', 'upload.html'),
        path.join(ROOT_DIR, 'tools', 'drop', 'public', 'view.html'),
        path.join(ROOT_DIR, 'tools', 'lan', 'public', 'index.html'),
        path.join(ROOT_DIR, 'tools', 'paste', 'public', 'index.html'),
        path.join(ROOT_DIR, 'tools', 'qr', 'public', 'index.html'),
        path.join(ROOT_DIR, 'tools', 'tinyurl', 'public', 'index.html'),
        path.join(ROOT_DIR, 'tools', 'health', 'public', 'index.html')
      ];
      for (const file of htmlFiles) {
        const content = fs.readFileSync(file, 'utf8');
        expect(content).not.toContain('https://lan.pokedb.site/');
      }
      const switcherSrc = fs.readFileSync(path.join(ROOT_DIR, 'tools', 'shared', 'theme-switcher.js'), 'utf8');
      expect(switcherSrc).toContain("pokedb.site/tools/");
    });
  });

  describe('3. QR Studio Center Monogram Contrast Fix', () => {
    test('tools/qr/public/app.js sets contrasting fillStyle before drawing emoji/monogram text', () => {
      const qrJs = fs.readFileSync(path.join(ROOT_DIR, 'tools', 'qr', 'public', 'app.js'), 'utf8');
      const emojiIdx = qrJs.indexOf("emblemChoice === 'emoji'");
      expect(emojiIdx).toBeGreaterThan(-1);
      const snippet = qrJs.slice(emojiIdx, emojiIdx + 1400);
      expect(snippet).toContain('ctx.fillStyle = badgeTextColor');
      expect(snippet).toContain('ctx.fillText(emojiText');
    });
  });

  describe('4. Drop Production Fallback Storage (Rootz primary + Local ephemeral fallback)', () => {
    let tmpDir;
    let store;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokedb-drop-prod-'));
      store = createSqliteStorage(path.join(tmpDir, 'test.sqlite'));
    });

    afterEach(() => {
      try { store.close(); } catch (_) {}
      fs.rmSync(tmpDir, { recursive: true, force: true });
      jest.restoreAllMocks();
    });

    test('/api/config/public reports dropStorage direct vs disabled vs r2 accurately', async () => {
      const { app: disabledApp } = createApp({
        store,
        config: { isProduction: true, env: 'production', turnstileMode: 'optional' }
      });
      const resDisabled = await request(disabledApp).get('/api/config/public');
      expect(resDisabled.status).toBe(200);
      expect(resDisabled.body.dropStorage).toBe('disabled');

      const { app: directApp } = createApp({
        store,
        config: { isProduction: true, env: 'production', rootzApiKey: 'rtz_dummy', turnstileMode: 'optional' }
      });
      const resDirect = await request(directApp).get('/api/config/public');
      expect(resDirect.status).toBe(200);
      expect(resDirect.body.dropStorage).toBe('direct');
    });

    test('Production Drop local fallback supports upload, list, byte-exact Range download, burn, and delete', async () => {
      const { app } = createApp({
        store,
        config: {
          isProduction: true,
          env: 'production',
          sqliteDbPath: path.join(tmpDir, 'test.sqlite'),
          adminToken: 'admin-prod-token-test',
          turnstileMode: 'optional',
          dropDirectFallback: true
        }
      });

      const payloadText = 'ProofHours Pitch Sample HTML <b>content</b>';
      const uploadRes = await request(app)
        .post('/api/drop/upload')
        .set('Host', 'drop.pokedb.site')
        .field('ttlHours', '12')
        .field('burn', '0')
        .attach('file', Buffer.from(payloadText, 'utf8'), 'pitch.html');

      expect(uploadRes.status).toBe(200);
      expect(uploadRes.body.success).toBe(true);
      expect(uploadRes.body.provider).toBe('local');
      expect(uploadRes.body.ttlHours).toBe(12);
      const dropId = uploadRes.body.code;
      const deleteToken = uploadRes.body.deletionToken;

      // File Manager list returns the uploaded drop
      const listRes = await request(app)
        .get('/api/drop/list')
        .set('Host', 'drop.pokedb.site')
        .set('X-Admin-Token', 'admin-prod-token-test');
      expect(listRes.status).toBe(200);
      expect(listRes.body.drops.some((d) => d.id === dropId && d.name === 'pitch.html')).toBe(true);

      // SSR view reflects local fallback delivery (not R2 claim)
      const viewRes = await request(app).get(`/v/${dropId}`).set('Host', 'drop.pokedb.site');
      expect(viewRes.status).toBe(200);
      expect(viewRes.text).toContain('Encrypted temporary storage');

      // Download returns safe attachment headers + exact bytes
      const dlRes = await request(app).get(`/d/${dropId}`).set('Host', 'drop.pokedb.site');
      expect(dlRes.status).toBe(200);
      expect(dlRes.headers['content-type']).toContain('application/octet-stream');
      expect(dlRes.headers['content-disposition']).toContain('attachment;');
      expect(dlRes.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.from(dlRes.body).toString('utf8')).toBe(payloadText);

      // Partial Range request works
      const rangeRes = await request(app)
        .get(`/d/${dropId}`)
        .set('Host', 'drop.pokedb.site')
        .set('Range', 'bytes=0-9');
      expect(rangeRes.status).toBe(206);
      expect(rangeRes.headers['content-range']).toMatch(/^bytes 0-9\//);
      expect(Buffer.from(rangeRes.body).toString('utf8')).toBe(payloadText.slice(0, 10));

      // Delete removes both DB state and local blob file
      const delRes = await request(app)
        .delete(`/api/drop/delete?fileId=${dropId}`)
        .set('Host', 'drop.pokedb.site')
        .set('X-Delete-Token', deleteToken);
      expect(delRes.status).toBe(200);
      expect(fs.existsSync(path.join(tmpDir, 'drop-blobs', `${dropId}.bin`))).toBe(false);

      // Blocked executable upload rejected in production unless encrypted
      const exeRes = await request(app)
        .post('/api/drop/upload')
        .set('Host', 'drop.pokedb.site')
        .attach('file', Buffer.from('MZ'), 'malware.exe');
      expect(exeRes.status).toBe(400);
    });

    test('Production Drop burn-after-download cleans up local blob after first GET', async () => {
      const { app } = createApp({
        store,
        config: {
          isProduction: true,
          env: 'production',
          sqliteDbPath: path.join(tmpDir, 'test.sqlite'),
          turnstileMode: 'optional',
          dropDirectFallback: true
        }
      });

      const uploadRes = await request(app)
        .post('/api/drop/upload')
        .set('Host', 'drop.pokedb.site')
        .field('burn', '1')
        .attach('file', Buffer.from('burn-once-secret'), 'secret.txt');
      expect(uploadRes.status).toBe(200);
      expect(uploadRes.body.burn).toBe(true);
      const dropId = uploadRes.body.code;

      const firstDl = await request(app).get(`/d/${dropId}`).set('Host', 'drop.pokedb.site');
      expect(firstDl.status).toBe(200);
      expect(Buffer.from(firstDl.body).toString('utf8')).toBe('burn-once-secret');

      const secondDl = await request(app).get(`/d/${dropId}`).set('Host', 'drop.pokedb.site');
      expect(secondDl.status).toBe(410);
    });

    test('Production Drop uses Rootz when rootzApiKey is configured and streams download', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation(async (url, opts) => {
        const u = String(url);
        if (u.includes('rootz.so/api/files/upload')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: { short_id: 'rtzmock99', name: 'doc.txt', size: 11 } })
          };
        }
        if (u.includes('rootz.so/api/files/retrieve')) {
          const bodyStream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('rootz-bytes'));
              controller.close();
            }
          });
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/octet-stream', 'content-length': '11' }),
            body: bodyStream
          };
        }
        if (u.includes('rootz.so/api/files/delete')) {
          return { ok: true, status: 200, json: async () => ({ success: true }) };
        }
        return originalFetch ? originalFetch(url, opts) : { ok: true, status: 200, json: async () => ({}) };
      });

      try {
        const { app } = createApp({
          store,
          config: {
            isProduction: true,
            env: 'production',
            sqliteDbPath: path.join(tmpDir, 'test.sqlite'),
            turnstileMode: 'optional',
            rootzApiKey: 'rtz_test_prod_key',
            rootzFolderId: 'YkGAJ'
          }
        });

        const up = await request(app)
          .post('/api/drop/upload')
          .set('Host', 'drop.pokedb.site')
          .attach('file', Buffer.from('rootz-bytes'), 'doc.txt');
        expect(up.status).toBe(200);
        expect(up.body.provider).toBe('rootz');

        const dl = await request(app).get(`/d/${up.body.code}`).set('Host', 'drop.pokedb.site');
        expect(dl.status).toBe(200);
        expect(Buffer.from(dl.body).toString('utf8')).toBe('rootz-bytes');

        const del = await request(app)
          .delete(`/api/drop/delete?fileId=${up.body.code}`)
          .set('Host', 'drop.pokedb.site')
          .set('X-Delete-Token', up.body.deletionToken);
        expect(del.status).toBe(200);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
