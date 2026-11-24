// tests/drop-typeable.test.js
// Tests for short typeable Drop IDs, case/whitespace normalization, legacy 21-char compatibility,
// route/SSR speed & cache safety, and LAN router mounting.

const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createSqliteStorage } = require('../src/storage/sqlite');
const { FakeObjectStore } = require('../src/storage/fakeObjectStore');
const {
  generateDropId21,
  generateTypeableDropId,
  normalizeTypeableDropCode,
  TYPEABLE_DROP_ALPHABET,
  hashDeleteToken
} = require('../src/tools/drop/router');

describe('Drop Typeable Codes, Lookup Normalization, & SSR Optimization', () => {
  let app;
  let store;
  let objectStore;
  let mockClock;
  let currentTime;

  beforeEach(() => {
    currentTime = 1700000000000;
    mockClock = { now: () => currentTime };
    store = createSqliteStorage(':memory:');
    objectStore = new FakeObjectStore();
    ({ app } = createApp({
      store,
      objectStore,
      clock: mockClock,
      config: {
        isTest: true,
        adminToken: 'test-admin-token-xyz',
        dropMaxBytes: 250 * 1024 * 1024,
        ownerMaxBytes: 1024 * 1024 * 1024,
        storageSoftCapBytes: 8.5 * 1024 * 1024 * 1024,
        dropDailyBytesPerSubnet: 500 * 1024 * 1024,
        dropDailyBytesGlobal: 3 * 1024 * 1024 * 1024
      }
    }));
  });

  afterEach(() => {
    if (store && store.close) store.close();
  });

  describe('1. Typeable ID Generation & Collision Retry', () => {
    test('generateDropId21 remains 21 chars while generateTypeableDropId returns unambiguous 8-char codes', () => {
      expect(generateDropId21()).toHaveLength(21);
      expect(TYPEABLE_DROP_ALPHABET).toBe('23456789abcdefghjkmnpqrstuvwxyz');

      for (let i = 0; i < 100; i++) {
        const code = generateTypeableDropId(store);
        expect(code).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/);
        expect(code).not.toMatch(/[0Oo1IilL]/);
      }
    });

    test('generateTypeableDropId retries on SQLite drops, KV keys, and reserved words', () => {
      // Seed colliding drop in SQLite and colliding folder in KV
      store.createDrop({
        id: 'abcd2345',
        objectKey: 'drops/abcd2345',
        uploadId: null,
        name: 'existing.bin',
        size: 100,
        state: 'complete',
        createdAt: currentTime,
        expiresAt: currentTime + 3600000,
        deleteHash: hashDeleteToken('tok')
      });
      store.setKv('drop:efgh6789', 'RESERVED');
      store.setKv('drop:folder:jkmnpq23', JSON.stringify({ id: 'jkmnpq23', files: [] }));

      const candidates = [
        'admin',       // in RESERVED_BLOCKLIST (and <6 chars)
        'abcd2345',    // exists in drops table
        'efgh6789',    // exists in kv drop:*
        'jkmnpq23',    // exists in kv drop:folder:*
        'rstuvw45'     // free!
      ];
      let idx = 0;
      const result = generateTypeableDropId(store, {
        generator: () => candidates[idx++],
        maxAttempts: 10
      });

      expect(result).toBe('rstuvw45');
      expect(idx).toBe(5);
    });

    test('generateTypeableDropId throws cleanly if maxAttempts exhausted', () => {
      store.setKv('drop:zzzz9999', 'RESERVED');
      expect(() =>
        generateTypeableDropId(store, {
          generator: () => 'zzzz9999',
          maxAttempts: 3
        })
      ).toThrow(/Failed to generate unique typeable drop ID/i);
    });

    test('normalizeTypeableDropCode trims, collapses whitespace, lowercases, and rejects ambiguous chars', () => {
      expect(normalizeTypeableDropCode('  K7M9P3XQ  ')).toBe('k7m9p3xq');
      expect(normalizeTypeableDropCode('k7m9 p3xq')).toBe('k7m9p3xq');
      expect(normalizeTypeableDropCode('ab23cd')).toBe('ab23cd');
      expect(normalizeTypeableDropCode('k7m9p3x0')).toBe(''); // 0 excluded
      expect(normalizeTypeableDropCode('k7m9p3x1')).toBe(''); // 1 excluded
      expect(normalizeTypeableDropCode('k7m9p3xi')).toBe(''); // i excluded
      expect(normalizeTypeableDropCode('k7m9p3xl')).toBe(''); // l excluded
      expect(normalizeTypeableDropCode('k7m9p3xo')).toBe(''); // o excluded
      expect(normalizeTypeableDropCode('short')).toBe('');    // < 6 chars
      expect(normalizeTypeableDropCode(null)).toBe('');
    });
  });

  describe('2. Case & Whitespace Normalization Across Drop Lifecycle', () => {
    test('Complete, resume, download, preview, meta, batch, and delete work with uppercase & spaced typeable codes', async () => {
      const initRes = await request(app)
        .post('/api/drop/init')
        .send({ name: 'modpack-v2.mrpack', size: 12 * 1024 * 1024, ttlHours: 24 });

      expect(initRes.status).toBe(200);
      const { id, code, deleteToken } = initRes.body;
      expect(id).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/);
      expect(code).toBe(id);

      const spacedUpper = `  ${id.slice(0, 4).toUpperCase()} ${id.slice(4).toUpperCase()}  `;
      const uploadId = Array.from(objectStore.multiparts.keys())[0];
      await objectStore.recordPartUpload(uploadId, 1, 8 * 1024 * 1024, '"etag-1"');

      // Resume using spaced uppercase ID
      const resumeRes = await request(app)
        .post('/api/drop/resume')
        .send({ id: spacedUpper, deleteToken });
      expect(resumeRes.status).toBe(200);
      expect(resumeRes.body.id).toBe(id);
      expect(resumeRes.body.completedPartCount).toBe(1);

      await objectStore.recordPartUpload(uploadId, 2, 4 * 1024 * 1024, '"etag-2"');

      // Complete using uppercase ID
      const completeRes = await request(app)
        .post('/api/drop/complete')
        .send({
          id: ` ${id.toUpperCase()} `,
          deleteToken,
          parts: [{ n: 1, etag: '"etag-1"' }, { n: 2, etag: '"etag-2"' }],
          sha256: 'b'.repeat(64)
        });
      expect(completeRes.status).toBe(200);
      expect(completeRes.body.id).toBe(id);
      expect(completeRes.body.code).toBe(id);
      expect(completeRes.body.shareUrl).toContain(`/d/${id}`);
      expect(completeRes.body.viewUrl).toContain(`/v/${id}`);

      // Preview /v/:id with uppercase & spaces
      const viewRes = await request(app).get(`/v/${encodeURIComponent(spacedUpper)}`);
      expect(viewRes.status).toBe(200);
      expect(viewRes.text).toContain('modpack-v2.mrpack');
      expect(viewRes.text).toContain(`/d/${id}`);
      expect(viewRes.text).toContain(id);

      // Meta API with uppercase
      const metaRes = await request(app).get(`/api/drop/${id.toUpperCase()}/meta`);
      expect(metaRes.status).toBe(200);
      expect(metaRes.body.id).toBe(id);
      expect(metaRes.body.code).toBe(id);
      expect(metaRes.body.size).toBe(12 * 1024 * 1024);

      // HEAD & GET /d/:id with uppercase
      const headRes = await request(app).head(`/d/${id.toUpperCase()}`);
      expect(headRes.status).toBe(200);
      expect(headRes.headers['content-length']).toBe(String(12 * 1024 * 1024));

      const dlRes = await request(app).get(`/d/${encodeURIComponent(spacedUpper)}`);
      expect(dlRes.status).toBe(302);
      expect(dlRes.headers.location).toContain(`drops/${id}`);

      // Batch links with uppercase
      const batchRes = await request(app)
        .post('/api/drop/batch')
        .send({ ids: [spacedUpper] });
      expect(batchRes.status).toBe(200);
      expect(batchRes.body.batchId).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/);
      expect(batchRes.body.drops).toHaveLength(1);
      expect(batchRes.body.drops[0].id).toBe(id);

      // Delete using uppercase
      const delRes = await request(app)
        .delete(`/api/drop/${id.toUpperCase()}`)
        .set('Authorization', `Bearer ${deleteToken}`);
      expect(delRes.status).toBe(200);
      expect(store.getDrop(id).state).toBe('deleted');
    });

    test('Folder creation & attachment normalize uppercase folder codes', async () => {
      const folderRes = await request(app)
        .post('/api/drop/create-folder')
        .send({ name: 'Release Bundle', totalSize: 1024, fileCount: 1 });
      expect(folderRes.status).toBe(200);
      const { folderCode, code } = folderRes.body;
      expect(folderCode).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/);
      expect(code).toBe(folderCode);

      const initRes = await request(app)
        .post('/api/drop/init')
        .send({ name: 'readme.md', size: 1024 });
      const { id, deleteToken } = initRes.body;
      const uploadId = Array.from(objectStore.multiparts.keys())[0];
      await objectStore.recordPartUpload(uploadId, 1, 1024, '"etag-f1"');

      // Attach using uppercase + whitespace folderCode
      const compRes = await request(app)
        .post('/api/drop/complete')
        .send({
          id,
          deleteToken,
          folderCode: `  ${folderCode.toUpperCase()}  `,
          parts: [{ n: 1, etag: '"etag-f1"' }]
        });
      expect(compRes.status).toBe(200);

      const infoRes = await request(app).get(`/api/drop/info?file_code=${folderCode.toUpperCase()}`);
      expect(infoRes.status).toBe(200);
      expect(infoRes.body.result[0].files).toHaveLength(1);
      expect(infoRes.body.result[0].files[0].id).toBe(id);

      const folderViewRes = await request(app).get(`/v/${folderCode.toUpperCase()}`);
      expect(folderViewRes.status).toBe(200);
      expect(folderViewRes.headers['content-type']).toContain('text/html');
    });

    test('Abort resolves uppercase typeable code and cleans up', async () => {
      const initRes = await request(app)
        .post('/api/drop/init')
        .send({ name: 'cancel.bin', size: 2048 });
      const { id, deleteToken } = initRes.body;

      const abortRes = await request(app)
        .post('/api/drop/abort')
        .send({ id: id.toUpperCase(), deleteToken });
      expect(abortRes.status).toBe(200);
      expect(store.getDrop(id).state).toBe('deleted');
    });
  });

  describe('3. Backward Compatibility with Legacy 21-Char NanoID Drops', () => {
    test('Existing 21-char case-sensitive drops still resolve cleanly while wrong-case 21-char fails', async () => {
      const legacyId = 'AbC123_XyZ-9876543210';
      expect(legacyId).toHaveLength(21);

      const deleteToken = 'legacy-delete-token-1234567890ab';
      const mp = await objectStore.createMultipart({ key: `drops/${legacyId}` });
      await objectStore.recordPartUpload(mp.uploadId, 1, 4096, '"legacy-etag"');
      await objectStore.complete({
        key: `drops/${legacyId}`,
        uploadId: mp.uploadId,
        parts: [{ PartNumber: 1, ETag: '"legacy-etag"' }]
      });

      store.createDrop({
        id: legacyId,
        objectKey: `drops/${legacyId}`,
        uploadId: mp.uploadId,
        name: 'legacy-archive.zip',
        size: 4096,
        state: 'complete',
        createdAt: currentTime,
        expiresAt: currentTime + 86400000,
        downloads: 0,
        maxDownloads: null,
        sha256: 'c'.repeat(64),
        deleteHash: hashDeleteToken(deleteToken),
        encrypted: 0,
        creator: '127.0.0.0/24'
      });

      // Exact 21-char match works (and with leading/trailing spaces)
      const viewRes = await request(app).get(`/v/${legacyId}`);
      expect(viewRes.status).toBe(200);
      expect(viewRes.text).toContain('legacy-archive.zip');

      const dlRes = await request(app).get(`/d/${encodeURIComponent(` ${legacyId} `)}`);
      expect(dlRes.status).toBe(302);
      expect(dlRes.headers.location).toContain(`drops/${legacyId}`);

      // Wrong-case 21-char ID must NOT falsely fold case
      const wrongCaseRes = await request(app).get(`/d/${legacyId.toLowerCase()}`);
      expect(wrongCaseRes.status).toBe(404);
    });
  });

  describe('4. SSR Optimization, Safe Caching, & Security', () => {
    test('Non-burn /v/:id and /meta support ETag 304 revalidation and update ETag after download', async () => {
      const initRes = await request(app)
        .post('/api/drop/init')
        .send({ name: 'cacheable.tar.gz', size: 2048 });
      const { id, deleteToken } = initRes.body;
      const uploadId = Array.from(objectStore.multiparts.keys())[0];
      await objectStore.recordPartUpload(uploadId, 1, 2048, '"etag-c1"');
      await request(app).post('/api/drop/complete').send({ id, deleteToken, parts: [{ n: 1, etag: '"etag-c1"' }] });

      const v1 = await request(app).get(`/v/${id}`);
      expect(v1.status).toBe(200);
      expect(v1.headers['cache-control']).toBe('private, no-cache');
      expect(v1.headers.etag).toBeDefined();

      // Revalidation with matching ETag returns 304 fast
      const v304 = await request(app)
        .get(`/v/${id}`)
        .set('If-None-Match', v1.headers.etag);
      expect(v304.status).toBe(304);

      // Meta API ETag revalidation
      const m1 = await request(app).get(`/api/drop/${id}/meta`);
      expect(m1.status).toBe(200);
      expect(m1.headers['cache-control']).toBe('private, no-cache');
      const m304 = await request(app)
        .get(`/api/drop/${id}/meta`)
        .set('If-None-Match', m1.headers.etag);
      expect(m304.status).toBe(304);

      // Download increments downloads count -> ETag must invalidate
      const dl = await request(app).get(`/d/${id}`);
      expect(dl.status).toBe(302);

      const vAfter = await request(app)
        .get(`/v/${id}`)
        .set('If-None-Match', v1.headers.etag);
      expect(vAfter.status).toBe(200);
      expect(vAfter.headers.etag).not.toBe(v1.headers.etag);
    });

    test('Burn-on-read drops NEVER emit cacheable ETag or allow 304, and /v/:id returns 410 after burn', async () => {
      const initRes = await request(app)
        .post('/api/drop/init')
        .send({ name: 'secret.txt', size: 1024, burn: true });
      const { id, deleteToken } = initRes.body;
      const uploadId = Array.from(objectStore.multiparts.keys())[0];
      await objectStore.recordPartUpload(uploadId, 1, 1024, '"etag-b1"');
      await request(app).post('/api/drop/complete').send({ id, deleteToken, parts: [{ n: 1, etag: '"etag-b1"' }] });

      const vRes = await request(app).get(`/v/${id}`);
      expect(vRes.status).toBe(200);
      expect(vRes.headers['cache-control']).toBe('no-store');
      expect(vRes.headers.etag).toBeUndefined();
      expect(vRes.text).toContain('Burn After 1 Download');

      const metaRes = await request(app).get(`/api/drop/${id}/meta`);
      expect(metaRes.status).toBe(200);
      expect(metaRes.headers['cache-control']).toBe('no-store');
      expect(metaRes.headers.etag).toBeUndefined();

      // Consume the burn download
      const dlRes = await request(app).get(`/d/${id}`);
      expect(dlRes.status).toBe(302);

      // Preview now returns 410 Gone with no-store
      const burnedView = await request(app).get(`/v/${id}`);
      expect(burnedView.status).toBe(410);
      expect(burnedView.headers['cache-control']).toBe('no-store');
      expect(burnedView.text).toMatch(/burned/i);
    });

    test('GET /v/:id uses immutable hashed assets, defer scripts, zero inline scripts/handlers, and mobile header', async () => {
      const initRes = await request(app)
        .post('/api/drop/init')
        .send({ name: 'mobile-preview.pdf', size: 51200, encrypted: true });
      const { id, deleteToken } = initRes.body;
      const uploadId = Array.from(objectStore.multiparts.keys())[0];
      await objectStore.recordPartUpload(uploadId, 1, 51200, '"etag-m1"');
      await request(app).post('/api/drop/complete').send({ id, deleteToken, parts: [{ n: 1, etag: '"etag-m1"' }] });

      const res = await request(app).get(`/v/${id}`);
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/\/assets\/theme\.[a-f0-9]+\.css/);
      expect(res.text).toMatch(/\/assets\/theme-switcher\.[a-f0-9]+\.js/);
      expect(res.text).toMatch(/<script src="\/assets\/qrcode\.min\.[a-f0-9]+\.js" defer><\/script>/);
      expect(res.text).toContain('<script src="/tools/drop/ssr-view.js" defer></script>');
      expect(res.text).toContain('class="site-nav"');
      expect(res.text).toContain('id="theme-select"');
      expect(res.text).toContain('E2E Encrypted');
      expect(res.text).not.toMatch(/<script(?![^>]*src=)[^>]*>/i);
      expect(res.text).not.toMatch(/\son[a-z]+\s*=/i);

      // Missing drop renders styled 404 SSR card without inline scripts
      const missingRes = await request(app).get('/v/notfound');
      expect(missingRes.status).toBe(404);
      expect(missingRes.headers['cache-control']).toBe('no-store');
      expect(missingRes.text).toContain('Drop file not found.');
      expect(missingRes.text).not.toMatch(/<script(?![^>]*src=)[^>]*>/i);
    });

    test('POST /api/drop/init handles mismatched-length invalid Bearer token without 500 error', async () => {
      const res = await request(app)
        .post('/api/drop/init')
        .set('Authorization', 'Bearer short')
        .send({ name: 'safe.txt', size: 1024 });
      expect(res.status).toBe(200);

      const overRes = await request(app)
        .post('/api/drop/init')
        .set('Authorization', 'Bearer short')
        .send({ name: 'big.zip', size: 300 * 1024 * 1024 });
      expect(overRes.status).toBe(413);
    });
  });

  describe('5. LAN Router Mounting Integration in app.js', () => {
    test('createApp mounts lanRouter at root before catch-all handlers', async () => {
      const mockLanRouter = express.Router();
      mockLanRouter.post('/api/lan/room', (req, res) => {
        res.status(201).json({ success: true, code: 'ABC234' });
      });

      const { app: wiredApp, lanRouter } = createApp({
        store,
        objectStore,
        lanRouter: mockLanRouter,
        config: { isTest: true }
      });

      expect(lanRouter).toBe(mockLanRouter);

      const apexRes = await request(wiredApp).post('/api/lan/room').send({});
      expect(apexRes.status).toBe(201);
      expect(apexRes.body.code).toBe('ABC234');

      const dropSubRes = await request(wiredApp)
        .post('/api/lan/room')
        .set('Host', 'drop.pokedb.site')
        .send({});
      expect(dropSubRes.status).toBe(201);
      expect(dropSubRes.body.code).toBe('ABC234');
    });
  });
});
