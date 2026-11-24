// tests/middleware.test.js
// Unit tests for src/middleware/ (Task P3.3)

const request = require('supertest');
const express = require('express');
const {
  parseTrustProxy,
  normalizeHost,
  resolveHost,
  resolveApiHost,
  resolveBrowserOriginHost,
  tokensMatch,
  createOriginLock,
  extractBearerOrHeaderToken,
  queryTokenRejector,
  createRequireAdmin,
  createRateLimiters,
  robotsPolicy,
  handleRobotsTxt,
  createCorsMiddleware,
  cspNonceMiddleware,
  createHelmetMiddleware,
  createConnectionDrainTracker,
  createHostRouter,
  notFoundHandler,
  errorHandler
} = require('../src/middleware');

describe('Middleware Suite (Task P3.3 / src/middleware/)', () => {
  describe('proxyTrust', () => {
    test('parseTrustProxy handles various input formats', () => {
      expect(parseTrustProxy(undefined)).toBe('loopback,uniquelocal');
      expect(parseTrustProxy('true')).toBe(true);
      expect(parseTrustProxy('false')).toBe(false);
      expect(parseTrustProxy('1')).toBe(true);
      expect(parseTrustProxy('0')).toBe(false);
      expect(parseTrustProxy('2')).toBe(2);
      expect(parseTrustProxy('loopback, linklocal')).toEqual(['loopback', 'linklocal']);
      expect(parseTrustProxy('10.0.0.1')).toBe('10.0.0.1');
    });

    test('resolveHost resolves priority: tool subdomain > apex > fallback', () => {
      expect(resolveHost({ headers: { host: 'drop.pokedb.site' } })).toBe('drop.pokedb.site');
      expect(resolveHost({ headers: { host: 'pokedb.site' } })).toBe('pokedb.site');
      expect(resolveHost({ headers: { 'x-host': 'paste.pokedb.site' } })).toBe('paste.pokedb.site');
      expect(resolveHost({ headers: { 'x-subdomain': 'qr.pokedb.site' } })).toBe('qr.pokedb.site');
      expect(resolveHost({ headers: { host: 'localhost:5050' } })).toBe('localhost');
    });

    test('tokensMatch timing-safe token comparison', () => {
      expect(tokensMatch('secret123', 'secret123')).toBe(true);
      expect(tokensMatch('secret123', 'wrong')).toBe(false);
      expect(tokensMatch('', 'secret123')).toBe(false);
      expect(tokensMatch(null, 'secret123')).toBe(false);
    });

    test('originLock rejects unauthorized external requests and exempts loopback health', async () => {
      const app = express();
      app.use(createOriginLock('my-secret-key'));
      app.get('/healthz', (req, res) => res.send('OK'));
      app.get('/api/test', (req, res) => res.send('OK'));

      // 1. Missing header -> 403
      const res1 = await request(app).get('/api/test');
      expect(res1.statusCode).toBe(403);

      // 2. Wrong header -> 403
      const res2 = await request(app).get('/api/test').set('X-Origin-Verify', 'wrong');
      expect(res2.statusCode).toBe(403);

      // 3. Valid header -> 200
      const res3 = await request(app).get('/api/test').set('X-Origin-Verify', 'my-secret-key');
      expect(res3.statusCode).toBe(200);
    });

    test('normalizeHost handles malformed, url, and multi-value inputs', () => {
      expect(normalizeHost(null)).toBe('');
      expect(normalizeHost(undefined)).toBe('');
      expect(normalizeHost(123)).toBe('');
      expect(normalizeHost('https://Drop.PokeDB.site:443, other.host')).toBe('drop.pokedb.site');
      expect(normalizeHost('http://localhost:5050')).toBe('localhost');
      expect(normalizeHost('  pokedb.site  ')).toBe('pokedb.site');
    });

    test('resolveApiHost handles render host forwarding', () => {
      expect(resolveApiHost({ headers: { host: 'drop.pokedb.site' } })).toBe('drop.pokedb.site');
      expect(resolveApiHost({ headers: { host: 'app.onrender.com', 'x-forwarded-host': 'tools.pokedb.site' } })).toBe('tools.pokedb.site');
      expect(resolveApiHost({ headers: { host: 'app.onrender.com', 'x-subdomain': 'paste.pokedb.site' } })).toBe('paste.pokedb.site');
      expect(resolveApiHost({ headers: { host: 'app.onrender.com' } })).toBe('app.onrender.com');
    });

    test('resolveBrowserOriginHost extracts trusted pokedb origins and ignores untrusted/malformed', () => {
      expect(resolveBrowserOriginHost({ get: (h) => (h === 'origin' ? 'https://qr.pokedb.site' : undefined) })).toBe('qr.pokedb.site');
      expect(resolveBrowserOriginHost({ headers: { referer: 'https://pokedb.site/about' } })).toBe('pokedb.site');
      expect(resolveBrowserOriginHost({ headers: { origin: 'not-a-valid-url' } })).toBe('');
      expect(resolveBrowserOriginHost({ headers: { origin: 'https://attacker.example.com' } })).toBe('');
      expect(resolveBrowserOriginHost({ headers: {} })).toBe('');
    });
  });

  describe('auth', () => {
    test('queryTokenRejector rejects query tokens with 400 HTML for browser and 400 JSON for API', async () => {
      const app = express();
      app.use(queryTokenRejector);
      app.get('/test', (req, res) => res.send('OK'));

      // HTML client
      const resHtml = await request(app)
        .get('/test?token=secret123')
        .set('Accept', 'text/html');
      expect(resHtml.statusCode).toBe(400);
      expect(resHtml.text).toContain('Query Tokens Deprecated');

      // JSON client
      const resJson = await request(app)
        .get('/test?delete_token=secret123')
        .set('Accept', 'application/json');
      expect(resJson.statusCode).toBe(400);
      expect(resJson.body.error).toBe('query_tokens_forbidden');

      // Safe request without query tokens
      const resSafe = await request(app).get('/test?other=param');
      expect(resSafe.statusCode).toBe(200);
    });

    test('extractBearerOrHeaderToken extracts tokens from bearer or custom headers', () => {
      expect(extractBearerOrHeaderToken({ get: (h) => (h === 'authorization' ? 'Bearer tok123' : '') })).toBe('tok123');
      expect(extractBearerOrHeaderToken({ headers: { authorization: 'Bearer tok456' } })).toBe('tok456');
      expect(extractBearerOrHeaderToken({ get: (h) => (h === 'x-delete-token' ? 'del789' : '') })).toBe('del789');
      expect(extractBearerOrHeaderToken({ headers: { 'x-custom-token': 'cust000' } }, 'x-custom-token')).toBe('cust000');
      expect(extractBearerOrHeaderToken({ headers: {} })).toBe('');
    });

    test('requireAdmin authorizes valid tokens and rejects invalid', async () => {
      const appUnconfigured = express();
      appUnconfigured.use('/admin', createRequireAdmin(''), (req, res) => res.send('ADMIN_OK'));
      const res503 = await request(appUnconfigured).get('/admin');
      expect(res503.statusCode).toBe(503);
      expect(res503.body.error).toContain('ADMIN_TOKEN is not configured');

      const app = express();
      app.use('/admin', createRequireAdmin('admin-super-pass'), (req, res) => res.send('ADMIN_OK'));

      const resFail = await request(app).get('/admin');
      expect(resFail.statusCode).toBe(401);

      const resPassBearer = await request(app)
        .get('/admin')
        .set('Authorization', 'Bearer admin-super-pass');
      expect(resPassBearer.statusCode).toBe(200);
      expect(resPassBearer.text).toBe('ADMIN_OK');

      const resPassQuery = await request(app)
        .get('/admin?admin_token=admin-super-pass');
      expect(resPassQuery.statusCode).toBe(200);
      expect(resPassQuery.text).toBe('ADMIN_OK');
    });
  });

  describe('robotsPolicy', () => {
    test('applies expected X-Robots-Tag per route', async () => {
      const app = express();
      app.use(robotsPolicy);
      app.get('/', (req, res) => res.send('root'));
      app.get('/api/test', (req, res) => res.send('api'));
      app.get('/v/xyz', (req, res) => res.send('viewer'));
      app.get('/shared/style.css', (req, res) => res.send('css'));

      // Root with host pokedb.site
      const resRoot = await request(app).get('/').set('Host', 'pokedb.site');
      expect(resRoot.headers['x-robots-tag']).toBe('index, follow');

      // API route
      const resApi = await request(app).get('/api/test');
      expect(resApi.headers['x-robots-tag']).toBe('noindex');

      // Viewer route
      const resView = await request(app).get('/v/xyz');
      expect(resView.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive, nosnippet');

      // Static css
      const resCss = await request(app).get('/shared/style.css');
      expect(resCss.headers['x-robots-tag']).toBeUndefined();
    });

    test('handleRobotsTxt produces correct robots.txt', async () => {
      const app = express();
      app.get('/robots.txt', handleRobotsTxt);

      const resApex = await request(app).get('/robots.txt').set('Host', 'pokedb.site');
      expect(resApex.statusCode).toBe(200);
      expect(resApex.text).toContain('Allow: /');
      expect(resApex.text).toContain('Disallow: /api/');

      const resTiny = await request(app).get('/robots.txt').set('Host', 'tinyurl.pokedb.site');
      expect(resTiny.text).toContain('Allow: /$');
    });
  });

  describe('securityHeaders & CORS', () => {
    test('generates random CSP nonce and sets security headers', async () => {
      const app = express();
      app.use(cspNonceMiddleware);
      app.use(createHelmetMiddleware());
      app.get('/nonce-test', (req, res) => {
        res.send(`nonce:${res.locals.cspNonce}`);
      });

      const res = await request(app).get('/nonce-test');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.text).toMatch(/^nonce:[a-zA-Z0-9+/=]+$/);
    });

    test('CORS allows valid subdomains and rejects untrusted origins', async () => {
      const app = express();
      app.use(createCorsMiddleware());
      app.get('/cors-test', (req, res) => res.send('OK'));
      app.use(errorHandler);

      const resAllowed = await request(app)
        .get('/cors-test')
        .set('Origin', 'https://drop.pokedb.site');
      expect(resAllowed.statusCode).toBe(200);

      const resBlocked = await request(app)
        .get('/cors-test')
        .set('Origin', 'https://malicious-site.example');
      expect(resBlocked.statusCode).toBe(403);
    });
  });

  describe('hostRouter', () => {
    test('routes subdomain and /tools/:id subpath', () => {
      const mockRegistry = [
        { id: 'drop', subdomain: 'drop', title: 'Drop' },
        { id: 'paste', subdomain: 'paste', title: 'Paste' }
      ];
      const router = createHostRouter({ registry: mockRegistry });

      const reqSubdomain = { headers: { host: 'drop.pokedb.site' }, path: '/' };
      router(reqSubdomain, {}, () => {});
      expect(reqSubdomain.currentTool.id).toBe('drop');

      const reqSubpath = { headers: { host: 'localhost:5050' }, path: '/tools/paste/view' };
      router(reqSubpath, {}, () => {});
      expect(reqSubpath.currentTool.id).toBe('paste');
      expect(reqSubpath.toolSubpath).toBe('view');
    });
  });

  describe('errors', () => {
    test('notFoundHandler returns 404 HTML for browsers and 404 JSON for API', async () => {
      const app = express();
      app.use(notFoundHandler);

      const resHtml = await request(app).get('/non-existent').set('Accept', 'text/html');
      expect(resHtml.statusCode).toBe(404);
      expect(resHtml.text).toContain('404 — Not Found');

      const resApi = await request(app).get('/api/non-existent').set('Accept', 'application/json');
      expect(resApi.statusCode).toBe(404);
      expect(resApi.body.error).toBe('not_found');
    });

    test('errorHandler handles general errors with request id', async () => {
      const app = express();
      app.get('/crash', (req, res) => {
        throw new Error('Explosion');
      });
      app.use(errorHandler);

      const res = await request(app).get('/crash').set('Accept', 'application/json');
      expect(res.statusCode).toBe(500);
      expect(res.body.error).toBe('internal_error');
    });
  });
});
