// tests/improvements.test.js
// Regression tests for backend/frontend bug fixes: public config, Drop HEAD burn safety,
// folder batch attachment on R2 complete, upload session route, paste encrypted persistence,
// and strict CSP compliance (no un-nonced inline scripts or inline event handlers).

const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createSqliteStorage } = require('../src/storage/sqlite');
const { FakeObjectStore } = require('../src/storage/fakeObjectStore');

const ROOT = path.resolve(__dirname, '..');

describe('Site & Tool Improvements Regression Suite', () => {
  let app;
  let store;
  let objectStore;

  beforeEach(() => {
    store = createSqliteStorage(':memory:');
    objectStore = new FakeObjectStore();
    ({ app } = createApp({
      store,
      objectStore,
      config: {
        baseUrl: 'https://pokedb.site',
        isProduction: false,
        isTest: true,
        trustProxy: 1,
        turnstileSiteKey: '0x4AAAAAAATestPublicKey',
        turnstileSecretKey: '1x0000000000000000000000000000000AA',
        adminToken: 'super-secret-admin-token'
      }
    }));
  });

  afterEach(() => {
    if (store && store.close) store.close();
  });

  test('GET /api/config/public exposes turnstileSiteKey only and leaks zero secrets', async () => {
    const res = await request(app).get('/api/config/public');
    expect(res.status).toBe(200);
    expect(res.body.turnstileSiteKey).toBe('0x4AAAAAAATestPublicKey');
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('0000000000000000000000000000000AA');
    expect(serialized).not.toContain('super-secret-admin-token');
  });

  test('GET /shared/turnstile.js is served with JavaScript content-type', async () => {
    const res = await request(app).get('/shared/turnstile.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text).toContain('PokedbTurnstile');
  });

  test('HEAD /d/:id on burn-on-download drop does NOT burn or consume the download', async () => {
    const initRes = await request(app)
      .post('/api/drop/init')
      .send({ name: 'one-shot.txt', size: 1024, ttlHours: 24, burn: true });
    expect(initRes.status).toBe(200);
    const { id, deleteToken } = initRes.body;

    const dropRow = store.getDrop(id);
    await objectStore.recordPartUpload(dropRow.uploadId, 1, 1024, '"etag-1"');

    const compRes = await request(app)
      .post('/api/drop/complete')
      .send({ id, deleteToken, parts: [{ PartNumber: 1, ETag: '"etag-1"' }] });
    expect(compRes.status).toBe(200);

    // Pre-flight link unfurlers and mobile browsers often issue HEAD requests
    const head1 = await request(app).head(`/d/${id}`);
    expect(head1.status).toBe(200);
    const head2 = await request(app).head(`/d/${id}`);
    expect(head2.status).toBe(200);

    // Metadata must still show 0 downloads
    const metaBefore = await request(app).get(`/api/drop/${id}/meta`);
    expect(metaBefore.status).toBe(200);
    expect(metaBefore.body.downloads).toBe(0);

    // First real GET claims the download and redirects
    const get1 = await request(app).get(`/d/${id}`);
    expect(get1.status).toBe(302);

    // Second GET is burned (410)
    const get2 = await request(app).get(`/d/${id}`);
    expect(get2.status).toBe(410);
  });

  test('POST /api/drop/complete with folderCode attaches file to folder info', async () => {
    const folderRes = await request(app)
      .post('/api/drop/create-folder')
      .send({ totalSize: 2048, fileCount: 2 });
    expect(folderRes.status).toBe(200);
    const { folderCode } = folderRes.body;

    const initRes = await request(app)
      .post('/api/drop/init')
      .send({ name: 'batch-item.zip', size: 1024, ttlHours: 24 });
    expect(initRes.status).toBe(200);
    const { id, deleteToken } = initRes.body;

    const dropRow = store.getDrop(id);
    await objectStore.recordPartUpload(dropRow.uploadId, 1, 1024, '"etag-b1"');

    const compRes = await request(app)
      .post('/api/drop/complete')
      .send({
        id,
        deleteToken,
        folderCode,
        parts: [{ PartNumber: 1, ETag: '"etag-b1"' }]
      });
    expect(compRes.status).toBe(200);

    const infoRes = await request(app).get(`/api/drop/info?file_code=${folderCode}`);
    expect(infoRes.status).toBe(200);
    const folder = infoRes.body.result[0];
    expect(Array.isArray(folder.files)).toBe(true);
    expect(folder.files.length).toBe(1);
    expect(folder.files[0].id).toBe(id);
    expect(folder.files[0].name).toBe('batch-item.zip');

    const folderViewRes = await request(app).get(`/v/${folderCode}`);
    expect(folderViewRes.status).toBe(200);
    expect(folderViewRes.headers['content-type']).toMatch(/html/);
    expect(folderViewRes.text).toContain('/tools/drop/view.js');
  });

  test('GET /upload/:id serves Drop upload session HTML and GET /v/:id SSR has zero inline scripts', async () => {
    const uploadPageRes = await request(app).get('/upload/test-session-123');
    expect(uploadPageRes.status).toBe(200);
    expect(uploadPageRes.headers['content-type']).toMatch(/html/);
    expect(uploadPageRes.text).toContain('Upload Session');

    const initRes = await request(app)
      .post('/api/drop/init')
      .send({ name: 'ssr-check.zip', size: 1024, ttlHours: 24 });
    const { id, deleteToken } = initRes.body;
    const dropRow = store.getDrop(id);
    await objectStore.recordPartUpload(dropRow.uploadId, 1, 1024, '"etag-s1"');
    await request(app)
      .post('/api/drop/complete')
      .send({ id, deleteToken, sha256: 'a'.repeat(64), parts: [{ PartNumber: 1, ETag: '"etag-s1"' }] });

    const vRes = await request(app).get(`/v/${id}`);
    expect(vRes.status).toBe(200);
    expect(vRes.text).toContain('ssr-check.zip');
    expect(vRes.text).toContain(`/d/${id}`);
    expect(vRes.text).toContain('Download File');
    expect(vRes.text).toContain('Report Abuse');
    // Must not embed un-nonced inline scripts in SSR page
    expect(vRes.text).not.toMatch(/<script(?![^>]*src=)(?![^>]*nonce=)[^>]*>/i);

    const jsRes = await request(app).get('/tools/drop/ssr-view.js');
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers['content-type']).toMatch(/javascript/);
  });

  test('Pastebin persists encrypted flag across create, view, and /raw headers', async () => {
    const createRes = await request(app)
      .post('/api/paste/create')
      .send({
        content: 'v1:encrypted-cipher-payload',
        title: 'Secret Note',
        language: 'plaintext',
        encrypted: true
      });
    expect(createRes.status).toBe(200);
    expect(createRes.body.encrypted).toBe(true);

    const viewRes = await request(app).post(`/api/paste/view/${createRes.body.code}`).send({});
    expect(viewRes.status).toBe(200);
    expect(viewRes.body.paste.encrypted).toBe(true);

    const rawRes = await request(app).get(`/raw/${createRes.body.code}`);
    expect(rawRes.status).toBe(200);
    expect(rawRes.headers['x-paste-encrypted']).toBe('1');
  });

  test('Offline tools and public pages use external scripts (zero inline scripts or on* handlers under CSP)', async () => {
    const offlineTools = ['json', 'jwt', 'codec', 'hash', 'uuid', 'cron', 'diff', 'minecraft', 'sanitizer'];
    for (const tool of offlineTools) {
      const htmlPath = path.join(ROOT, 'tools', tool, 'public', 'index.html');
      const html = fs.readFileSync(htmlPath, 'utf8');
      expect(html).not.toMatch(/\son[a-z]+\s*=/i);
      const inlineScriptTags = html.match(/<script\b(?![^>]*\bsrc=)[^>]*>/gi) || [];
      expect({ tool, inlineScriptTags }).toEqual({ tool, inlineScriptTags: [] });

      const appJsRes = await request(app).get(`/tools/${tool}/app.js`);
      expect(appJsRes.status).toBe(200);
      expect(appJsRes.headers['content-type']).toMatch(/javascript/);
    }

    const publicPages = ['docs.html', 'status.html', 'abuse.html'];
    for (const file of publicPages) {
      const html = fs.readFileSync(path.join(ROOT, 'public', file), 'utf8');
      expect(html).not.toMatch(/\son[a-z]+\s*=/i);
      const inlineScriptTags = html.match(/<script\b(?![^>]*\bsrc=)[^>]*>/gi) || [];
      expect({ file, inlineScriptTags }).toEqual({ file, inlineScriptTags: [] });
    }
  });

  test('/preview/:code includes valid CSP nonce on inline script (no CSP block)', async () => {
    const shortRes = await request(app)
      .post('/api/shorten')
      .send({ url: 'https://example.com/csp-check' });
    expect(shortRes.status).toBe(200);
    const code = shortRes.body.code;
    const res = await request(app).get(`/preview/${code}`);
    expect(res.status).toBe(200);
    const csp = res.headers['content-security-policy'] || '';
    const nonceMatch = csp.match(/'nonce-([^']+)'/);
    expect(nonceMatch).not.toBeNull();
    const expectedNonce = nonceMatch[1];
    expect(res.text).toContain(`<script nonce="${expectedNonce}">`);
  });
});
