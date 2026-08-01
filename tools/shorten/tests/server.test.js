process.env.NODE_ENV = 'test';
const request = require('supertest');
const app = require('../server');

describe('URL Shortener API Suite', () => {

  test('1. Reject invalid, dangerous, or self-referential URLs (400 Bad Request)', async () => {
    const invalidUrls = [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'ftp://invalid-protocol.com',
      'not-a-url',
      'http://pokedb.site/tools/shorten'
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
    const reservedAliases = ['api', 'tools', 'admin', 'favicon.ico'];

    for (const customAlias of reservedAliases) {
      const res = await request(app)
        .post('/api/shorten')
        .send({ url: 'https://example.com', customAlias });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/reserved/i);
    }
  });

  test('3. Return 409 Conflict when claiming an existing custom alias', async () => {
    // First creation
    const alias = 'mycustomalias';
    const firstRes = await request(app)
      .post('/api/shorten')
      .send({ url: 'https://example.com/first', customAlias: alias });
    expect(firstRes.status).toBe(200);

    // Duplicate creation
    const secondRes = await request(app)
      .post('/api/shorten')
      .send({ url: 'https://example.com/second', customAlias: alias });
    expect(secondRes.status).toBe(409);
    expect(secondRes.body.error).toMatch(/already taken/i);
  });

  test('4. Successfully create a short URL (200 OK)', async () => {
    const res = await request(app)
      .post('/api/shorten')
      .send({ url: 'https://github.com/POKEDB10', expiresInDays: 7 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('code');
    expect(res.body).toHaveProperty('shortUrl');
    expect(res.body.longUrl).toBe('https://github.com/POKEDB10');
  });

  test('5. Redirect GET /:code to target URL with 302', async () => {
    const createRes = await request(app)
      .post('/api/shorten')
      .send({ url: 'https://packspliter.qzz.io', customAlias: 'packspliter-test' });

    expect(createRes.status).toBe(200);

    const redirectRes = await request(app)
      .get('/packspliter-test');

    expect(redirectRes.status).toBe(302);
    expect(redirectRes.headers.location).toBe('https://packspliter.qzz.io');
  });

  test('6. Accurately report stats and click counts via GET /api/stats/:code', async () => {
    const alias = 'stats-test-link';
    await request(app)
      .post('/api/shorten')
      .send({ url: 'https://eternal.host', customAlias: alias });

    // Visit link twice
    await request(app).get(`/${alias}`);
    await request(app).get(`/${alias}`);

    const statsRes = await request(app).get(`/api/stats/${alias}`);
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.code).toBe(alias);
    expect(statsRes.body.longUrl).toBe('https://eternal.host');
    expect(statsRes.body.clicks).toBe(2);
  });

  test('7. Enforce Rate Limiting (429 Too Many Requests)', async () => {
    // Send 35 rapid requests to trigger rate limit (max 30)
    let rateLimited = false;

    for (let i = 0; i < 35; i++) {
      const res = await request(app)
        .post('/api/shorten')
        .send({ url: `https://example.com/item-${i}` });

      if (res.status === 429) {
        rateLimited = true;
        expect(res.body.error).toMatch(/too many requests/i);
        break;
      }
    }

    expect(rateLimited).toBe(true);
  });

});
