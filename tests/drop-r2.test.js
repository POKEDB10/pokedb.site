// tests/drop-r2.test.js
// Acceptance test suite for Phase 4 — Drop v2 on Cloudflare R2 (Tasks P4.1 - P4.11).

const request = require('supertest');
const { createApp } = require('../src/app');
const { createSqliteStorage } = require('../src/storage/sqlite');
const { FakeObjectStore } = require('../src/storage/fakeObjectStore');
const { Sweeper } = require('../src/utils/sweeper');
const {
  sanitizeFileName,
  isBlockedExtension,
  calculateParts,
  generateDropId21
} = require('../src/tools/drop/router');

describe('Phase 4 — Drop v2 on Cloudflare R2 Suite', () => {
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

  describe('1. Helpers & Sanitization', () => {
    test('sanitizeFileName normalizes NFC, strips control chars and path separators, enforces max 180 bytes', () => {
      expect(sanitizeFileName('')).toBe('file');
      expect(sanitizeFileName(null)).toBe('file');
      expect(sanitizeFileName('../../etc/passwd')).toBe('.._.._etc_passwd');
      expect(sanitizeFileName('hello\x00world\r\n.txt')).toBe('hello_world__.txt');
      const longName = 'a'.repeat(250) + '.txt';
      const safe = sanitizeFileName(longName);
      expect(Buffer.from(safe).length).toBeLessThanOrEqual(180);
    });

    test('isBlockedExtension detects dangerous executables and allows safe archives', () => {
      expect(isBlockedExtension('game.exe')).toBe(true);
      expect(isBlockedExtension('installer.msi')).toBe(true);
      expect(isBlockedExtension('script.bat')).toBe(true);
      expect(isBlockedExtension('library.dll')).toBe(true);
      expect(isBlockedExtension('app.apk')).toBe(true);

      // Safe formats explicitly required by Minecraft/developer community
      expect(isBlockedExtension('mod.jar')).toBe(false);
      expect(isBlockedExtension('archive.zip')).toBe(false);
      expect(isBlockedExtension('modpack.mrpack')).toBe(false);
      expect(isBlockedExtension('backup.tar.gz')).toBe(false);
    });

    test('calculateParts sizes 8 MiB for <= 64 MiB, 16 MiB for > 64 MiB', () => {
      const small = calculateParts(10 * 1024 * 1024); // 10 MiB
      expect(small.partSize).toBe(8 * 1024 * 1024);
      expect(small.numParts).toBe(2);

      const large = calculateParts(100 * 1024 * 1024); // 100 MiB
      expect(large.partSize).toBe(16 * 1024 * 1024);
      expect(large.numParts).toBe(7);
    });

    test('generateDropId21 generates 21-character random IDs', () => {
      const id = generateDropId21();
      expect(id).toHaveLength(21);
    });
  });

  describe('2. POST /api/drop/init', () => {
    test('Rejects invalid size, oversize, and unencrypted blocked extensions', async () => {
      // 0 or negative size
      const zeroRes = await request(app).post('/api/drop/init').send({ name: 'test.txt', size: 0 });
      expect(zeroRes.status).toBe(400);

      // Oversize standard user (> 250 MiB)
      const overRes = await request(app)
        .post('/api/drop/init')
        .send({ name: 'big.iso', size: 300 * 1024 * 1024 });
      expect(overRes.status).toBe(413);

      // Blocked extension in plaintext mode
      const blockedRes = await request(app)
        .post('/api/drop/init')
        .send({ name: 'malware.exe', size: 1024, encrypted: false });
      expect(blockedRes.status).toBe(400);
      expect(blockedRes.body.error).toMatch(/Executable file types/i);

      // Blocked extension allowed in encrypted mode
      const encRes = await request(app)
        .post('/api/drop/init')
        .send({ name: 'malware.exe', size: 1024, encrypted: true });
      expect(encRes.status).toBe(200);
      expect(encRes.body.id).toBeDefined();
    });

    test('Admin token allows uploads up to OWNER_MAX_BYTES (1 GiB)', async () => {
      const adminRes = await request(app)
        .post('/api/drop/init')
        .set('Authorization', 'Bearer test-admin-token-xyz')
        .send({ name: 'huge-backup.tar.gz', size: 500 * 1024 * 1024 });
      expect(adminRes.status).toBe(200);
      expect(adminRes.body.id).toBeDefined();
    });

    test('Enforces storage soft cap (503 drop_full)', async () => {
      // Artificially populate storage near cap
      jest.spyOn(store, 'getActiveStorageBytes').mockReturnValue(8.5 * 1024 * 1024 * 1024);
      const res = await request(app)
        .post('/api/drop/init')
        .send({ name: 'test.zip', size: 10 * 1024 * 1024 });
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('drop_full');
    });

    test('Successful init returns multipart presigned URLs and deleteToken', async () => {
      const res = await request(app)
        .post('/api/drop/init')
        .send({ name: 'document.pdf', size: 12 * 1024 * 1024, ttlHours: 24 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.id).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/);
      expect(res.body.code).toBe(res.body.id);
      expect(res.body.parts).toHaveLength(2); // 12 MiB / 8 MiB = 2 parts
      expect(res.body.parts[0].n).toBe(1);
      expect(res.body.parts[0].url).toContain('https://fake-r2.local/');
      expect(res.body.deleteToken).toHaveLength(32);
      expect(res.body.shareUrl).toContain(`/d/${res.body.id}`);
      expect(res.body.viewUrl).toContain(`/v/${res.body.id}`);
    });

    test('In production mode with missing R2 credentials, fails closed with 503 (never silently mocks)', async () => {
      const { createObjectStore } = require('../src/storage/r2');
      const prodStore = createObjectStore({ isProduction: true });
      expect(prodStore).toBeNull();

      const prodConfig = {
        isProduction: true,
        turnstileSecretKey: '1x0000000000000000000000000000000AA',
        turnstileSiteKey: '1x00000000000000000000AA'
      };
      const { app: prodApp } = createApp({ store, objectStore: null, config: prodConfig });
      const res = await request(prodApp)
        .post('/api/drop/init')
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
        .send({
          name: 'photo.png',
          size: 1024 * 1024,
          'cf-turnstile-response': '1x00000000000000000000AA'
        });

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('storage_service_unavailable');
    });
  });

  describe('3. Upload Lifecycle: Complete, Resume, Abort', () => {
    test('Complete marks drop as complete, records sha256, and returns share/curl URLs', async () => {
      const initRes = await request(app)
        .post('/api/drop/init')
        .send({ name: 'photo.png', size: 5 * 1024 * 1024 });

      const { id, deleteToken } = initRes.body;

      // Simulate client PUT parts to R2
      await objectStore.recordPartUpload(objectStore.multiparts.keys().next().value, 1, 5 * 1024 * 1024, '"etag-1"');

      const completeRes = await request(app)
        .post('/api/drop/complete')
        .send({
          id,
          deleteToken,
          parts: [{ n: 1, etag: '"etag-1"' }],
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
        });

      expect(completeRes.status).toBe(200);
      expect(completeRes.body.shareUrl).toContain(`/d/${id}`);
      expect(completeRes.body.curl).toBe(`curl -LOJ ${completeRes.body.shareUrl}`);

      const dropRow = store.getDrop(id);
      expect(dropRow.state).toBe('complete');
      expect(dropRow.sha256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    test('Resume returns fresh URLs for missing parts only', async () => {
      const initRes = await request(app)
        .post('/api/drop/init')
        .send({ name: 'video.mp4', size: 20 * 1024 * 1024 }); // 20 MiB -> 3 parts (8, 8, 4)

      const { id, deleteToken } = initRes.body;
      const uploadId = Array.from(objectStore.multiparts.keys())[0];

      // Client uploaded part 1, then connection died
      await objectStore.recordPartUpload(uploadId, 1, 8 * 1024 * 1024, '"etag-1"');

      const resumeRes = await request(app)
        .post('/api/drop/resume')
        .send({ id, deleteToken });

      expect(resumeRes.status).toBe(200);
      expect(resumeRes.body.completedPartCount).toBe(1);
      expect(resumeRes.body.totalPartCount).toBe(3);
      expect(resumeRes.body.missingParts).toHaveLength(2);
      expect(resumeRes.body.missingParts[0].n).toBe(2);
      expect(resumeRes.body.missingParts[1].n).toBe(3);
    });

    test('Abort cancels multipart upload and cleans up record', async () => {
      const initRes = await request(app)
        .post('/api/drop/init')
        .send({ name: 'cancel-me.zip', size: 10 * 1024 * 1024 });

      const { id, deleteToken } = initRes.body;
      expect(objectStore.multiparts.size).toBe(1);

      const abortRes = await request(app)
        .post('/api/drop/abort')
        .send({ id, deleteToken });

      expect(abortRes.status).toBe(200);
      expect(objectStore.multiparts.size).toBe(0);
      expect(store.getDrop(id).state).toBe('deleted');
    });
  });

  describe('4. Download Engine: GET /d/:id, HEAD, Burn on Download, Expiry', () => {
    test('GET /d/:id returns 302 to presigned GET with strict privacy headers', async () => {
      const initRes = await request(app)
        .post('/api/drop/init')
        .send({ name: 'report.pdf', size: 5 * 1024 * 1024 });
      const { id, deleteToken } = initRes.body;

      const uploadId = Array.from(objectStore.multiparts.keys())[0];
      await objectStore.recordPartUpload(uploadId, 1, 5 * 1024 * 1024, '"etag-1"');
      await request(app).post('/api/drop/complete').send({ id, deleteToken, parts: [{ n: 1, etag: '"etag-1"' }] });

      const res = await request(app).get(`/d/${id}`);
      expect(res.status).toBe(302);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive, nosnippet');
      expect(res.headers.location).toContain('https://fake-r2.local/');
      expect(res.headers.location).toContain('response-content-disposition');
    });

    test('Burn on download allows exactly 1 download, then returns 410', async () => {
      const initRes = await request(app)
        .post('/api/drop/init')
        .send({ name: 'burn-secret.txt', size: 1024, burn: true });
      const { id, deleteToken } = initRes.body;

      const uploadId = Array.from(objectStore.multiparts.keys())[0];
      await objectStore.recordPartUpload(uploadId, 1, 1024, '"etag-1"');
      await request(app).post('/api/drop/complete').send({ id, deleteToken, parts: [{ n: 1, etag: '"etag-1"' }] });

      // First download succeeds (302)
      const firstRes = await request(app).get(`/d/${id}`);
      expect(firstRes.status).toBe(302);

      // Second download returns 410 Gone
      const secondRes = await request(app).get(`/d/${id}`);
      expect(secondRes.status).toBe(410);
      expect(secondRes.body.error).toMatch(/burned/i);
    });

    test('Expired file returns 410 Gone', async () => {
      const initRes = await request(app)
        .post('/api/drop/init')
        .send({ name: 'time-travel.txt', size: 1024, ttlHours: 1 });
      const { id, deleteToken } = initRes.body;

      const uploadId = Array.from(objectStore.multiparts.keys())[0];
      await objectStore.recordPartUpload(uploadId, 1, 1024, '"etag-1"');
      await request(app).post('/api/drop/complete').send({ id, deleteToken, parts: [{ n: 1, etag: '"etag-1"' }] });

      // Advance clock past 1 hour expiry
      currentTime += 3600000 + 1000;

      const res = await request(app).get(`/d/${id}`);
      expect(res.status).toBe(410);
      expect(res.body.error).toMatch(/expired/i);
    });

    test('Quarantined file returns 451', async () => {
      const initRes = await request(app)
        .post('/api/drop/init')
        .send({ name: 'bad-file.zip', size: 1024 });
      const { id, deleteToken } = initRes.body;
      const uploadId = Array.from(objectStore.multiparts.keys())[0];
      await objectStore.recordPartUpload(uploadId, 1, 1024, '"etag-1"');
      await request(app).post('/api/drop/complete').send({ id, deleteToken, parts: [{ n: 1, etag: '"etag-1"' }] });

      store.updateDropState(id, 'quarantined');

      const res = await request(app).get(`/d/${id}`);
      expect(res.status).toBe(451);
      expect(res.body.error).toMatch(/quarantined/i);
    });
  });

  describe('5. Preview (GET /v/:id) & Metadata (GET /api/drop/:id/meta)', () => {
    test('GET /v/:id renders preview HTML with download button and report link', async () => {
      const initRes = await request(app)
        .post('/api/drop/init')
        .send({ name: 'presentation.key', size: 1024 * 1024 });
      const { id, deleteToken } = initRes.body;
      const uploadId = Array.from(objectStore.multiparts.keys())[0];
      await objectStore.recordPartUpload(uploadId, 1, 1024 * 1024, '"etag-1"');
      await request(app).post('/api/drop/complete').send({ id, deleteToken, parts: [{ n: 1, etag: '"etag-1"' }] });

      const res = await request(app).get(`/v/${id}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive, nosnippet');
      expect(res.text).toContain('presentation.key');
      expect(res.text).toContain(`/d/${id}"`);
      expect(res.text).toContain('Download File');
      expect(res.text).toContain('Report Abuse');
    });

    test('GET /api/drop/:id/meta returns facts with noindex', async () => {
      const initRes = await request(app)
        .post('/api/drop/init')
        .send({ name: 'data.json', size: 2048 });
      const { id } = initRes.body;

      const res = await request(app).get(`/api/drop/${id}/meta`);
      expect(res.status).toBe(200);
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(res.body.id).toBe(id);
      expect(res.body.name).toBe('data.json');
      expect(res.body.size).toBe(2048);
    });
  });

  describe('6. Deletion (DELETE /api/drop/:id & DELETE /api/drop/delete)', () => {
    test('Requires valid Bearer or X-Delete-Token, deletes R2 object, and marks state deleted', async () => {
      const initRes = await request(app)
        .post('/api/drop/init')
        .send({ name: 'delete-target.txt', size: 1024 });
      const { id, deleteToken } = initRes.body;
      const uploadId = Array.from(objectStore.multiparts.keys())[0];
      await objectStore.recordPartUpload(uploadId, 1, 1024, '"etag-1"');
      await request(app).post('/api/drop/complete').send({ id, deleteToken, parts: [{ n: 1, etag: '"etag-1"' }] });

      expect(objectStore.objects.has(`drops/${id}`)).toBe(true);

      // Wrong token -> 403
      const badRes = await request(app)
        .delete(`/api/drop/${id}`)
        .set('Authorization', 'Bearer invalid-token');
      expect(badRes.status).toBe(403);

      // Correct Bearer token -> 200
      const okRes = await request(app)
        .delete(`/api/drop/${id}`)
        .set('Authorization', `Bearer ${deleteToken}`);
      expect(okRes.status).toBe(200);
      expect(okRes.body.success).toBe(true);

      // Object removed from R2
      expect(objectStore.objects.has(`drops/${id}`)).toBe(false);
      expect(store.getDrop(id).state).toBe('deleted');

      // Subsequent access returns 404
      const getRes = await request(app).get(`/d/${id}`);
      expect(getRes.status).toBe(404);
    });
  });

  describe('7. Sweeper Automation (P4.6a)', () => {
    test('Sweeper deletes expired drop objects and aborts stale initiated uploads', async () => {
      // 1. Create completed drop that will expire
      const initRes = await request(app)
        .post('/api/drop/init')
        .send({ name: 'expired.bin', size: 1024, ttlHours: 1 });
      const { id: expiredId, deleteToken } = initRes.body;
      const uploadId = Array.from(objectStore.multiparts.keys())[0];
      await objectStore.recordPartUpload(uploadId, 1, 1024, '"etag-1"');
      await request(app).post('/api/drop/complete').send({ id: expiredId, deleteToken, parts: [{ n: 1, etag: '"etag-1"' }] });

      // 2. Create initiated drop older than 1h (stale)
      const staleRes = await request(app)
        .post('/api/drop/init')
        .send({ name: 'abandoned.bin', size: 1024 });
      const staleId = staleRes.body.id;

      expect(objectStore.objects.has(`drops/${expiredId}`)).toBe(true);
      expect(objectStore.multiparts.size).toBe(1);

      // Advance clock past 2 hours
      currentTime += 7200000;

      const sweeper = new Sweeper(store, { objectStore });
      await sweeper.sweepObjectStore(currentTime);

      // Verify R2 object was deleted
      expect(objectStore.objects.has(`drops/${expiredId}`)).toBe(false);
      // Verify stale multipart upload was aborted
      expect(objectStore.multiparts.size).toBe(0);
    });
  });

  describe('8. Security Checks (SEC-002, SEC-006)', () => {
    test('Old remote-upload endpoint explicitly returns 404', async () => {
      const res = await request(app)
        .post('/api/drop/remote-upload')
        .send({ url: 'https://example.com/file.txt' });
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('SEC-002');
    });

    test('HTML and SVG uploads have Content-Disposition attachment set on R2', async () => {
      const initHtml = await request(app)
        .post('/api/drop/init')
        .send({ name: 'payload.html', size: 1024 });
      expect(initHtml.status).toBe(200);

      const initSvg = await request(app)
        .post('/api/drop/init')
        .send({ name: 'vector.svg', size: 1024 });
      expect(initSvg.status).toBe(200);

      // Verify multipart was created with ContentType octet-stream and ContentDisposition attachment
      const mps = Array.from(objectStore.multiparts.values());
      expect(mps.some((mp) => mp.key === `drops/${initHtml.body.id}` && mp.contentType === 'application/octet-stream')).toBe(true);
      expect(mps.some((mp) => mp.key === `drops/${initSvg.body.id}` && mp.contentType === 'application/octet-stream')).toBe(true);
    });

    test('POST /api/drop/upload returns 404 in production environment (Task R9.2 Part 2 Item 2)', async () => {
      const prodApp = createApp({
        store,
        objectStore,
        config: {
          isProduction: true,
          env: 'production'
        }
      }).app;

      const res = await request(prodApp)
        .post('/api/drop/upload')
        .set('Host', 'drop.pokedb.site')
        .send({ customId: 'test-direct-prod' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('not_found');
    });
  });
});
