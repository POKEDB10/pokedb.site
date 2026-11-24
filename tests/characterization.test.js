process.env.NODE_ENV = 'test';
process.env.ROOTZ_API_KEY = process.env.ROOTZ_API_KEY || 'test-rootz-key';
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const app = require('../server');

describe('P0.3 Characterization Tests for Behaviors that will Move', () => {
  describe('1. Redirect + Click Counting', () => {
    test('short link redirect increments click count and redirects 302', async () => {
      const alias = `char-redirect-${Date.now()}`;
      const createRes = await request(app)
        .post('/api/shorten')
        .set('Host', 'tinyurl.pokedb.site')
        .send({ url: 'https://example.com/target-characterization', customAlias: alias });

      expect(createRes.status).toBe(200);
      expect(createRes.body.code).toBe(alias);

      // Perform redirect with direct=1
      const redirectRes = await request(app)
        .get(`/${alias}?direct=1`)
        .set('Host', 'tinyurl.pokedb.site');

      expect(redirectRes.status).toBe(302);
      expect(redirectRes.headers.location).toBe('https://example.com/target-characterization');

      // Check stats endpoint reflects at least 1 click
      const statsRes = await request(app)
        .get(`/api/stats/${alias}`)
        .set('Host', 'tinyurl.pokedb.site');

      expect(statsRes.status).toBe(200);
      expect(statsRes.body.code).toBe(alias);
      expect(Number(statsRes.body.clicks)).toBeGreaterThanOrEqual(1);
    });
  });

  describe('2. Alias Collision Suggestions', () => {
    test('claiming an existing alias returns 409 with suggestions array', async () => {
      const alias = `char-collision-${Date.now()}`;
      const firstRes = await request(app)
        .post('/api/shorten')
        .set('Host', 'tinyurl.pokedb.site')
        .send({ url: 'https://example.com/target-1', customAlias: alias });

      expect(firstRes.status).toBe(200);

      const secondRes = await request(app)
        .post('/api/shorten')
        .set('Host', 'tinyurl.pokedb.site')
        .send({ url: 'https://example.com/target-2', customAlias: alias });

      expect(secondRes.status).toBe(409);
      expect(secondRes.body.error).toMatch(/already taken/i);
      expect(Array.isArray(secondRes.body.suggestions)).toBe(true);
      expect(secondRes.body.suggestions.length).toBeGreaterThan(0);
      expect(secondRes.body.suggestions[0]).toContain(alias);
    });
  });

  describe('3. Paste Burn-on-Read', () => {
    test('burn-on-read paste is readable once and returns 404 on subsequent reads', async () => {
      const createRes = await request(app)
        .post('/api/paste/create')
        .set('Host', 'paste.pokedb.site')
        .send({
          title: 'Burn Test',
          content: 'Burn after reading content',
          burnOnRead: true
        });

      expect(createRes.status).toBe(200);
      const code = createRes.body.code;
      expect(code).toBeDefined();

      // First view succeeds
      const firstView = await request(app)
        .post(`/api/paste/view/${code}`)
        .set('Host', 'paste.pokedb.site');

      expect(firstView.status).toBe(200);
      expect(firstView.body.paste.content).toBe('Burn after reading content');

      // Second view must return 404
      const secondView = await request(app)
        .post(`/api/paste/view/${code}`)
        .set('Host', 'paste.pokedb.site');

      expect(secondView.status).toBe(404);
    });
  });

  describe('4. Password-Protected Paste', () => {
    test('password paste rejects missing/wrong password with 401 and succeeds with correct password', async () => {
      const createRes = await request(app)
        .post('/api/paste/create')
        .set('Host', 'paste.pokedb.site')
        .send({
          title: 'Secret Paste',
          content: 'Confidential message',
          password: 'CorrectSecretPassword123'
        });

      expect(createRes.status).toBe(200);
      const code = createRes.body.code;
      expect(createRes.body.isProtected).toBe(true);

      // View without password -> 401
      const noPass = await request(app)
        .post(`/api/paste/view/${code}`)
        .set('Host', 'paste.pokedb.site')
        .send({});

      expect(noPass.status).toBe(401);
      expect(noPass.body.error).toMatch(/incorrect password/i);

      // View with wrong password -> 401
      const wrongPass = await request(app)
        .post(`/api/paste/view/${code}`)
        .set('Host', 'paste.pokedb.site')
        .send({ password: 'WrongPassword' });

      expect(wrongPass.status).toBe(401);

      // View with correct password -> 200
      const correctPass = await request(app)
        .post(`/api/paste/view/${code}`)
        .set('Host', 'paste.pokedb.site')
        .send({ password: 'CorrectSecretPassword123' });

      expect(correctPass.status).toBe(200);
      expect(correctPass.body.paste.content).toBe('Confidential message');
    });
  });

  describe('5. Host Routing per Subdomain', () => {
    test('routes request to correct tool handler based on Host header', async () => {
      const mainRes = await request(app).get('/').set('Host', 'pokedb.site');
      expect(mainRes.status).toBe(200);
      expect(mainRes.text).toContain('POKEDB');

      const toolsRes = await request(app).get('/').set('Host', 'tools.pokedb.site');
      expect(toolsRes.status).toBe(200);
      expect(toolsRes.text).toContain('Tools Hub');

      const tinyurlRes = await request(app).get('/').set('Host', 'tinyurl.pokedb.site');
      expect(tinyurlRes.status).toBe(200);
      expect(tinyurlRes.text).toContain('TinyURL');

      const qrRes = await request(app).get('/').set('Host', 'qr.pokedb.site');
      expect(qrRes.status).toBe(200);
      expect(qrRes.text).toContain('QR Code Studio');

      const dropRes = await request(app).get('/').set('Host', 'drop.pokedb.site');
      expect(dropRes.status).toBe(200);
      expect(dropRes.text).toContain('Drop');
    });
  });

  describe('6. Robots Headers & robots.txt (P1.2 Policy Matrix)', () => {
    test('evaluates robots tags and robots.txt per host routing rules', async () => {
      // Landing page on pokedb.site has index, follow
      const mainRes = await request(app).get('/').set('Host', 'pokedb.site');
      expect(mainRes.headers['x-robots-tag']).toBe('index, follow');

      // Tool exact root on tinyurl.pokedb.site has index, follow
      const toolRootRes = await request(app).get('/').set('Host', 'tinyurl.pokedb.site');
      expect(toolRootRes.headers['x-robots-tag']).toBe('index, follow');

      // Short link path on tinyurl has noindex, nofollow, noarchive, nosnippet
      const shortCodeRes = await request(app).get('/abc123').set('Host', 'tinyurl.pokedb.site');
      expect(shortCodeRes.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive, nosnippet');

      // Static assets have NO robots header
      const cssRes = await request(app).get('/shared/theme.css').set('Host', 'tinyurl.pokedb.site');
      expect(cssRes.headers['x-robots-tag']).toBeUndefined();

      // robots.txt on tinyurl.pokedb.site allows exact root only
      const robotsRes = await request(app).get('/robots.txt').set('Host', 'tinyurl.pokedb.site');
      expect(robotsRes.status).toBe(200);
      expect(robotsRes.text).toContain('Allow: /$');
      expect(robotsRes.text).toContain('Disallow: /api/');
    });
  });

  describe('7. Drop Delete Token', () => {
    test('deleting a drop requires a valid deletion token', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true })
      });

      const dummyFile = path.join(__dirname, 'temp-char-drop.txt');
      fs.writeFileSync(dummyFile, 'Characterization drop content');

      try {
        const uploadRes = await request(app)
          .post('/api/drop/upload')
          .set('Host', 'drop.pokedb.site')
          .attach('file', dummyFile);

        expect(uploadRes.status).toBe(200);
        const fileId = uploadRes.body.id || uploadRes.body.shortId;
        const deletionToken = uploadRes.body.deletionToken;
        expect(fileId).toBeDefined();
        expect(deletionToken).toBeDefined();

        // Query token is forbidden (SEC-003) -> 400
        const queryTokenRes = await request(app)
          .delete(`/api/drop/delete?fileId=${fileId}&token=${deletionToken}`)
          .set('Host', 'drop.pokedb.site');
        expect(queryTokenRes.status).toBe(400);
        expect(queryTokenRes.body.error).toBe('query_tokens_forbidden');

        // Deletion with invalid header token -> 403
        const wrongTokenRes = await request(app)
          .delete(`/api/drop/delete?fileId=${fileId}`)
          .set('Host', 'drop.pokedb.site')
          .set('X-Delete-Token', 'invalid-token');

        expect(wrongTokenRes.status).toBe(403);
        expect(wrongTokenRes.body.error).toMatch(/valid deletion token/i);

        // Deletion with valid Bearer token -> 200
        const validDeleteRes = await request(app)
          .delete(`/api/drop/delete?fileId=${fileId}`)
          .set('Host', 'drop.pokedb.site')
          .set('Authorization', `Bearer ${deletionToken}`);

        expect(validDeleteRes.status).toBe(200);
        expect(validDeleteRes.body.success).toBe(true);
      } finally {
        global.fetch = originalFetch;
        if (fs.existsSync(dummyFile)) {
          fs.unlinkSync(dummyFile);
        }
      }
    });
  });
});
