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

  test('7. Enforce Rate Limiting (429 Too Many Requests)', async () => {
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
    expect(rateLimitedResponse.body.error).toMatch(/too many requests/i);
  });

});
