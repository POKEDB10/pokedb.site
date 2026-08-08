process.env.NODE_ENV = 'test';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const request = require('supertest');
const app = require('../server');

describe('URL Shortener API Suite', () => {

  test('1. Reject invalid, dangerous, or self-referential URLs (400 Bad Request)', async () => {
    const invalidUrls = [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'ftp://invalid-protocol.com',
      'not-a-url',
      'http://pokedb.site/tools/tinyurl'
    ];

    for (const url of invalidUrls) {
      const res = await request(app)
        .post('/api/shorten')
        .send({ url });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    }
  });

  test('2. Reject reserved short-codes for custom alias (400 Bad Request)', async () => {
    const reservedAliases = ['api', 'health', 'tools', 'v', 'admin', 'dashboard'];

    for (const alias of reservedAliases) {
      const res = await request(app)
        .post('/api/shorten')
        .send({
          url: 'https://example.com/target',
          customAlias: alias
        });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    }
  });

  test('3. Return 409 Conflict when claiming an existing custom alias', async () => {
    const customAlias = 'duplicate-test-alias';

    const res1 = await request(app)
      .post('/api/shorten')
      .send({
        url: 'https://example.com/first',
        customAlias
      });
    expect(res1.status).toBe(200);

    const res2 = await request(app)
      .post('/api/shorten')
      .send({
        url: 'https://example.com/second',
        customAlias
      });
    expect(res2.status).toBe(409);
    expect(res2.body.error).toMatch(/already taken/i);
  });

  test('4. Successfully create a short URL (200 OK)', async () => {
    const targetUrl = 'https://example.com/valid-page-test';

    const res = await request(app)
      .post('/api/shorten')
      .send({ url: targetUrl });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('code');
    expect(res.body).toHaveProperty('shortUrl');
    expect(res.body.longUrl).toBe(targetUrl);
  });

  test('5. Redirect GET /:code to target URL with 302', async () => {
    const targetUrl = 'https://example.com/redirect-target-test';

    const createRes = await request(app)
      .post('/api/shorten')
      .send({ url: targetUrl });

    const code = createRes.body.code;

    const redirectRes = await request(app).get(`/${code}`);
    expect(redirectRes.status).toBe(302);
    expect(redirectRes.headers.location).toBe(targetUrl);
  });

  test('6. Accurately report stats and click counts via GET /api/stats/:code', async () => {
    const targetUrl = 'https://example.com/stats-tracking-test';

    const createRes = await request(app)
      .post('/api/shorten')
      .send({ url: targetUrl });

    const code = createRes.body.code;

    await request(app).get(`/${code}`);
    await request(app).get(`/${code}`);

    const statsRes = await request(app).get(`/api/stats/${code}`);
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.clicks).toBe(2);
    expect(statsRes.body.longUrl).toBe(targetUrl);
  });

  test('7. Reject API requests sent to an unauthorized host despite spoofed routing headers', async () => {
    const res = await request(app)
      .post('/api/shorten')
      .set('Host', 'pokedb.site')
      .set('X-Subdomain', 'tinyurl.pokedb.site')
      .send({ url: 'https://example.com/host-routing-test' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not available/i);
  });

  test('7b. Accept a tool API request routed through Render using its trusted platform host', async () => {
    const res = await request(app)
      .post('/api/shorten')
      .set('Host', 'pokedb-site.onrender.com')
      .set('X-Subdomain', 'tinyurl.pokedb.site')
      .send({ url: 'https://example.com/render-routing-test' });

    expect(res.status).toBe(200);
    expect(res.body.shortUrl).toContain('tinyurl.pokedb.site');
  });

  test('7c. Accept a tool API request using the browser origin when Render omits the custom host', async () => {
    const shortenRes = await request(app)
      .post('/api/shorten')
      .set('Host', 'pokedb-site.onrender.com')
      .set('Origin', 'https://tinyurl.pokedb.site')
      .send({ url: 'https://example.com/browser-origin-routing-test' });
    const qrRes = await request(app)
      .get('/api/qr?format=svg&text=browser-origin-routing-test')
      .set('Host', 'pokedb-site.onrender.com')
      .set('Referer', 'https://qr.pokedb.site/');

    expect(shortenRes.status).toBe(200);
    expect(qrRes.status).toBe(200);
    expect(qrRes.headers['content-type']).toContain('image/svg+xml');
  });

  test('8. Escape redirect data and authorize the inline script with a CSP nonce', async () => {
    const targetUrl = 'https://example.com/</script><script>window.injected=true</script>';
    const createRes = await request(app)
      .post('/api/shorten')
      .send({ url: targetUrl });

    expect(createRes.status).toBe(200);

    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const redirectRes = await request(app)
        .get(`/${createRes.body.code}`)
        .set('Accept', 'text/html');
      const csp = redirectRes.headers['content-security-policy'];
      const nonceMatch = csp.match(/script-src 'self' 'nonce-([^']+)'/);

      expect(redirectRes.status).toBe(200);
      expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
      expect(nonceMatch).not.toBeNull();
      expect(redirectRes.text).toContain(`<script nonce="${nonceMatch[1]}">`);
      expect(redirectRes.text).toContain('\\u003c\\/script\\u003e');
      expect(redirectRes.text).not.toContain('</script><script>window.injected=true</script>');
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  test('9. Require an upload-specific deletion token before deleting a drop file', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { short_id: 'drop-token-test', name: 'example.txt' } })
    });

    try {
      const uploadRes = await request(app)
        .post('/api/drop/remote-upload')
        .send({ url: 'https://1.1.1.1/example.txt' });

      expect(uploadRes.status).toBe(200);
      expect(uploadRes.body.data.deletionToken).toMatch(/^[A-Za-z0-9_-]{32}$/);

      const missingTokenRes = await request(app)
        .delete('/api/drop/delete?fileId=drop-token-test');
      const invalidTokenRes = await request(app)
        .delete('/api/drop/delete?fileId=drop-token-test&token=incorrect-token');

      expect(missingTokenRes.status).toBe(403);
      expect(invalidTokenRes.status).toBe(403);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('10. Require a timing-safe admin token before listing Rootz files', async () => {
    const originalAdminToken = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = 'test-admin-token-with-sufficient-length';

    try {
      const missingTokenRes = await request(app).get('/api/drop/list');
      const invalidTokenRes = await request(app)
        .get('/api/drop/list')
        .set('X-Admin-Token', 'incorrect-admin-token');

      expect(missingTokenRes.status).toBe(403);
      expect(invalidTokenRes.status).toBe(403);
    } finally {
      if (originalAdminToken === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = originalAdminToken;
    }
  });

  test('11. Cover health, QR, CORS, expiration validation, and private IPv6 SSRF protection', async () => {
    const healthRes = await request(app)
      .get('/api/health/ping')
      .set('Origin', 'https://qr.pokedb.site');
    const qrRes = await request(app).get('/api/qr?format=svg&text=coverage-test');
    const expiryRes = await request(app)
      .post('/api/shorten')
      .send({ url: 'https://example.com/expiry-validation', expiresInDays: 366 });
    const privateIpv6Res = await request(app)
      .post('/api/drop/remote-upload')
      .send({ url: 'http://[::1]/private-file' });

    expect(healthRes.status).toBe(200);
    expect(healthRes.headers['access-control-allow-origin']).toBe('https://qr.pokedb.site');
    expect(qrRes.status).toBe(200);
    expect(qrRes.headers['content-type']).toContain('image/svg+xml');
    expect(expiryRes.status).toBe(400);
    expect(privateIpv6Res.status).toBe(400);
  });

  test('12. Use a NanoID fallback and remove temporary direct-upload files', async () => {
    const originalFetch = global.fetch;
    const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');
    const before = new Set(fs.readdirSync(uploadsDir));
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    try {
      const response = await request(app)
        .post('/api/drop/upload')
        .field('expiresInDays', '30')
        .attach('file', Buffer.from('temporary upload coverage'), 'coverage.txt');

      expect(response.status).toBe(200);
      expect(response.body.id).toMatch(/^[A-Za-z0-9_-]{21}$/);
      expect(new Set(fs.readdirSync(uploadsDir))).toEqual(before);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('13. Stream Rootz download responses without materializing a full buffer', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue(new Response('streamed-content', {
      status: 200,
      headers: { 'content-type': 'text/plain', 'content-length': '16' }
    }));

    try {
      const response = await request(app).get('/api/drop/file/stream-test');
      expect(response.status).toBe(200);
      expect(response.text).toBe('streamed-content');
      expect(response.headers['content-type']).toContain('text/plain');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('14. Enforce the shared API rate limit', async () => {
    const responses = await Promise.all(Array.from({ length: 130 }, () => request(app).get('/api/health/ping')));
    expect(responses.some((response) => response.status === 429)).toBe(true);
  });

  test('15. Enforce Rate Limiting (429 Too Many Requests)', async () => {
    const requests = [];
    for (let i = 0; i < 110; i++) {
      requests.push(
        request(app)
          .post('/api/shorten')
          .send({ url: 'https://example.com/rate-limit-test' })
      );
    }

    const responses = await Promise.all(requests);
    const rateLimitedResponse = responses.find(r => r.status === 429);
    expect(rateLimitedResponse).toBeDefined();
    expect(rateLimitedResponse.body.error).toMatch(/too many .*requests/i);
  });

  test('16. Start cleanly when Redis is unavailable during production boot', () => {
    const rootDir = path.join(__dirname, '..');
    const result = spawnSync(process.execPath, [
      '-e',
      "require('./server'); setTimeout(() => process.exit(0), 1500);"
    ], {
      cwd: rootDir,
      env: { ...process.env, NODE_ENV: 'production', REDIS_URL: 'redis://127.0.0.1:1' },
      encoding: 'utf8',
      timeout: 5000
    });

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('Stream isn\'t writeable');
  });

});
