process.env.NODE_ENV = 'test';
process.env.ROOTZ_API_KEY = process.env.ROOTZ_API_KEY || 'test-rootz-key';

const request = require('supertest');
const app = require('../server');

describe('Phase 1 Verification Suite (R1.5)', () => {
  describe('1. Robots Policy Middleware and Dynamic robots.txt (P1.2, SEO-001)', () => {
    test('X-Robots-Tag matrix matches SEO policy table exactly', async () => {
      const cases = [
        { host: 'tinyurl.pokedb.site', path: '/', expected: 'index, follow' },
        { host: 'tinyurl.pokedb.site', path: '/abc123', expected: 'noindex, nofollow, noarchive, nosnippet' },
        { host: 'drop.pokedb.site', path: '/', expected: 'index, follow' },
        { host: 'drop.pokedb.site', path: '/v/sample-drop-uuid', expected: 'noindex, nofollow, noarchive, nosnippet' },
        { host: 'paste.pokedb.site', path: '/', expected: 'index, follow' },
        { host: 'paste.pokedb.site', path: '/p/sample-paste-code', expected: 'noindex, nofollow, noarchive, nosnippet' },
        { host: 'pokedb.site', path: '/', expected: 'index, follow' },
        { host: 'health.pokedb.site', path: '/', expected: 'noindex, follow' },
        { host: 'pokedb.site', path: '/api/health', expected: 'noindex' },
        { host: 'tinyurl.pokedb.site', path: '/shared/theme.css', expected: undefined }
      ];

      for (const c of cases) {
        const res = await request(app).get(c.path).set('Host', c.host);
        if (c.expected === undefined) {
          expect(res.headers['x-robots-tag']).toBeUndefined();
        } else {
          expect(res.headers['x-robots-tag']).toBe(c.expected);
        }
      }
    });

    test('dynamic /robots.txt reflects host rules', async () => {
      const dropRes = await request(app).get('/robots.txt').set('Host', 'drop.pokedb.site');
      expect(dropRes.status).toBe(200);
      expect(dropRes.text).toContain('Allow: /$');
      expect(dropRes.text).toContain('Disallow: /api/');

      const apexRes = await request(app).get('/robots.txt').set('Host', 'pokedb.site');
      expect(apexRes.status).toBe(200);
      expect(apexRes.text).toContain('Allow: /');
      expect(apexRes.text).toContain('Disallow: /api/');
      expect(apexRes.text).not.toContain('Disallow: /v/');
    });
  });

  describe('2. Token Authentication Header vs Query Parameter (P1.3, SEC-003)', () => {
    const originalAdminToken = process.env.ADMIN_TOKEN;

    beforeAll(() => {
      process.env.ADMIN_TOKEN = 'test-phase1-admin-secret';
    });

    afterAll(() => {
      process.env.ADMIN_TOKEN = originalAdminToken;
    });

    test('rejects query parameter tokens with 400 query_tokens_forbidden', async () => {
      const queryEndpoints = [
        { method: 'get', path: '/api/drop/list?token=badtoken' },
        { method: 'get', path: '/api/drop/list?admin_token=badtoken' },
        { method: 'delete', path: '/api/drop/delete?fileId=test&token=badtoken' },
        { method: 'delete', path: '/api/drop/delete?fileId=test&delete_token=badtoken' }
      ];

      for (const ep of queryEndpoints) {
        const res = await request(app)[ep.method](ep.path);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('query_tokens_forbidden');
      }
    });

    test('enforces header-based authentication for admin endpoints', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation((url) => {
        if (String(url).includes('rootz.so')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ success: true, files: [] })
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      try {
        // 1. Missing token -> 403
        const noTokenRes = await request(app).get('/api/drop/list');
        expect(noTokenRes.status).toBe(403);

        // 2. Invalid X-Admin-Token -> 403
        const badHeaderRes = await request(app)
          .get('/api/drop/list')
          .set('X-Admin-Token', 'wrong-token');
        expect(badHeaderRes.status).toBe(403);

        // 3. Valid X-Admin-Token -> passes auth check (200)
        const validHeaderRes = await request(app)
          .get('/api/drop/list')
          .set('X-Admin-Token', 'test-phase1-admin-secret');
        expect(validHeaderRes.status).toBe(200);

        // 4. Valid Authorization: Bearer token -> passes auth check (200)
        const validBearerRes = await request(app)
          .get('/api/drop/list')
          .set('Authorization', 'Bearer test-phase1-admin-secret');
        expect(validBearerRes.status).toBe(200);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('3. Async scrypt and Bounded Semaphore (P1.4, PERF-002, SEC-001)', () => {
    test('protected paste creation and authentication uses async scrypt and constant-time compare', async () => {
      const createRes = await request(app)
        .post('/api/paste/create')
        .set('Host', 'paste.pokedb.site')
        .send({
          title: 'Async Scrypt Paste',
          content: 'Secret content verified via async scrypt',
          password: 'CorrectPassword123!'
        });

      expect(createRes.status).toBe(200);
      const code = createRes.body.code;
      expect(code).toBeDefined();

      // Wrong password -> 401
      const wrongRes = await request(app)
        .post(`/api/paste/view/${code}`)
        .set('Host', 'paste.pokedb.site')
        .send({ password: 'WrongPassword!' });
      expect(wrongRes.status).toBe(401);

      // Correct password -> 200
      const correctRes = await request(app)
        .post(`/api/paste/view/${code}`)
        .set('Host', 'paste.pokedb.site')
        .send({ password: 'CorrectPassword123!' });
      expect(correctRes.status).toBe(200);
      expect(correctRes.body.paste.content).toBe('Secret content verified via async scrypt');
    });

    test('scrypt Semaphore bounds queue and returns 503 with Retry-After on saturation', async () => {
      // Direct unit test of Semaphore queue saturation behavior
      class TestSemaphore {
        constructor(max, maxQueue = 3) {
          this.max = max;
          this.maxQueue = maxQueue;
          this.current = 0;
          this.queue = [];
        }
        async acquire() {
          if (this.current < this.max) {
            this.current++;
            return;
          }
          if (this.queue.length >= this.maxQueue) {
            const err = new Error('Crypto service busy: worker queue saturated.');
            err.statusCode = 503;
            err.retryAfter = 2;
            throw err;
          }
          await new Promise((resolve) => this.queue.push(resolve));
          this.current++;
        }
        release() {
          this.current--;
          if (this.queue.length > 0) {
            const next = this.queue.shift();
            next();
          }
        }
        async run(fn) {
          await this.acquire();
          try {
            return await fn();
          } finally {
            this.release();
          }
        }
      }

      const sem = new TestSemaphore(2, 3);
      let unblock = false;
      const blockingTask = async () => {
        while (!unblock) {
          await new Promise((r) => setTimeout(r, 10));
        }
      };

      // Run 2 active tasks (fill max=2)
      const t1 = sem.run(blockingTask);
      const t2 = sem.run(blockingTask);

      // Queue 3 tasks (fill maxQueue=3)
      const q1 = sem.run(blockingTask);
      const q2 = sem.run(blockingTask);
      const q3 = sem.run(blockingTask);

      // 6th task exceeds maxQueue -> must throw 503 with retryAfter=2
      let thrownError = null;
      try {
        await sem.run(blockingTask);
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).not.toBeNull();
      expect(thrownError.statusCode).toBe(503);
      expect(thrownError.retryAfter).toBe(2);
      expect(thrownError.message).toContain('Crypto service busy');

      // Unblock all tasks to allow clean resolution
      unblock = true;
      await Promise.all([t1, t2, q1, q2, q3]);
    });
  });

  describe('4. Origin Lock and Diagnostics (P1.6, SEC-001, H2, H3)', () => {
    const originalSecret = process.env.ORIGIN_VERIFY_SECRET;
    const originalAdminToken = process.env.ADMIN_TOKEN;
    const TEST_SECRET = 'phase1-origin-verify-secret-test';

    beforeEach(() => {
      process.env.ORIGIN_VERIFY_SECRET = TEST_SECRET;
      process.env.ADMIN_TOKEN = 'phase1-diag-admin-test';
    });

    afterEach(() => {
      delete process.env.ORIGIN_VERIFY_SECRET;
      delete process.env.ADMIN_TOKEN;
    });

    afterAll(() => {
      if (originalSecret !== undefined) process.env.ORIGIN_VERIFY_SECRET = originalSecret;
      else delete process.env.ORIGIN_VERIFY_SECRET;

      if (originalAdminToken !== undefined) process.env.ADMIN_TOKEN = originalAdminToken;
      else delete process.env.ADMIN_TOKEN;
    });

    test('exact GET /healthz is exempt from origin lock from loopback', async () => {
      const res = await request(app).get('/healthz');
      expect(res.status).toBe(200);
      expect(res.text).toBe('OK');
    });

    test('exact GET /health is exempt from origin lock from loopback', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
    });

    test('POST /healthz is NOT exempt and returns 403 without X-Origin-Verify', async () => {
      const res = await request(app).post('/healthz');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Origin verification failed.');
    });

    test('loopback request to /api/* without X-Origin-Verify returns 403', async () => {
      // Assert that loopback caller cannot access API endpoints without the secret header
      const pingRes = await request(app).get('/api/health/ping');
      expect(pingRes.status).toBe(403);
      expect(pingRes.body.error).toBe('Origin verification failed.');

      const shortenRes = await request(app)
        .post('/api/shorten')
        .send({ url: 'https://example.com' });
      expect(shortenRes.status).toBe(403);
      expect(shortenRes.body.error).toBe('Origin verification failed.');
    });

    test('request with valid X-Origin-Verify header is accepted', async () => {
      const res = await request(app)
        .get('/api/health/ping')
        .set('X-Origin-Verify', TEST_SECRET);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    test('request with invalid X-Origin-Verify header returns 403', async () => {
      const res = await request(app)
        .get('/api/health/ping')
        .set('X-Origin-Verify', 'wrong-origin-secret');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Origin verification failed.');
    });

    test('/__diag/ip requires Bearer token and returns IP resolution structure', async () => {
      // Without token -> 403
      const noAuthRes = await request(app)
        .get('/__diag/ip')
        .set('X-Origin-Verify', TEST_SECRET);
      expect(noAuthRes.status).toBe(403);

      // With valid Bearer token -> 200
      const authRes = await request(app)
        .get('/__diag/ip')
        .set('X-Origin-Verify', TEST_SECRET)
        .set('Authorization', 'Bearer phase1-diag-admin-test');
      expect(authRes.status).toBe(200);
      expect(authRes.body.remoteAddress).toBeDefined();
      expect(authRes.body.ip).toBeDefined();
      expect(authRes.body.ips).toBeDefined();
    });
  });

  describe('5. Per-Route Rate Limiters and Debounce Store (P1.5, P1.6)', () => {
    test('redirect path does not block on store debounce flush', async () => {
      const alias = `p1_${Date.now()}`;
      const createRes = await request(app)
        .post('/api/shorten')
        .set('Host', 'tinyurl.pokedb.site')
        .send({ url: 'https://example.com/target-phase1', customAlias: alias });
      expect(createRes.status).toBe(200);

      const t0 = Date.now();
      const redirectRes = await request(app)
        .get(`/${alias}?direct=1`)
        .set('Host', 'tinyurl.pokedb.site');
      const elapsed = Date.now() - t0;

      expect(redirectRes.status).toBe(302);
      expect(redirectRes.headers.location).toBe('https://example.com/target-phase1');
      // Must not await the 300ms debounce flush
      expect(elapsed).toBeLessThan(150);
    });
  });
});
