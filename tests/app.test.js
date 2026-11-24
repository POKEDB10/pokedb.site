// tests/app.test.js
// Unit tests for src/app.js (Task P3.5)

const request = require('supertest');
const { createApp } = require('../src/app.js');
const { createSqliteStorage } = require('../src/storage/sqlite.js');
const { loadConfig } = require('../src/config.js');

describe('Application Factory (Task P3.5 / src/app.js)', () => {
  let app;
  let store;
  let clickBuffer;

  beforeAll(() => {
    const config = loadConfig({
      NODE_ENV: 'test',
      SQLITE_DB_PATH: ':memory:'
    });
    store = createSqliteStorage(':memory:');
    const createdApp = createApp({ store, config });
    app = createdApp.app;
    clickBuffer = createdApp.clickBuffer;
  });

  afterAll(() => {
    if (clickBuffer) clickBuffer.close();
    if (store) store.close();
  });

  test('GET /healthz returns 200 OK', async () => {
    const res = await request(app).get('/healthz');
    expect(res.statusCode).toBe(200);
    expect(res.text).toBe('OK');
  });

  test('GET /health returns JSON operational status', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('healthy');
  });

  test('GET /sitemap.xml returns XML sitemap including active tools', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/xml/);
    expect(res.text).toContain('<loc>https://pokedb.site/</loc>');
    expect(res.text).toContain('<loc>https://tinyurl.pokedb.site/</loc>');
  });

  test('GET /robots.txt serves robots policy per host', async () => {
    const res = await request(app).get('/robots.txt');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('Allow: /');
  });

  test('Localhost routing: GET / serves landing page', async () => {
    const res = await request(app).get('/').set('Host', 'localhost:5050');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('pokedb.site');
  });

  test('Localhost routing: /tools/:toolId/ serves respective tool pages', async () => {
    const tools = ['tinyurl', 'qr', 'drop', 'paste', 'health'];
    for (const toolId of tools) {
      const res = await request(app).get(`/tools/${toolId}/`).set('Host', 'localhost:5050');
      expect(res.statusCode).toBe(200);
    }
  });

  test('Subdomain routing: Host drop.pokedb.site routes to Drop tool', async () => {
    const res = await request(app).get('/').set('Host', 'drop.pokedb.site');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('Drop');
  });
});
