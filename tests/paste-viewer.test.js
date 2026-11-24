// tests/paste-viewer.test.js
// Verification of Pastebin viewer routing, raw endpoints, script serving, and access control.

const request = require('supertest');
const { createApp } = require('../src/app');
const { createSqliteStorage } = require('../src/storage/sqlite');

describe('Pastebin Viewer & Routing Suite', () => {
  let app;
  let store;

  beforeEach(() => {
    store = createSqliteStorage(':memory:');
    const result = createApp({
      store,
      config: {
        baseUrl: 'https://pokedb.site',
        isProduction: false,
        trustProxy: 1
      }
    });
    app = result.app;
  });

  afterEach(() => {
    if (store && store.close) {
      store.close();
    }
  });

  test('GET /tools/paste/view.js and /view.js are served with JavaScript Content-Type', async () => {
    const res1 = await request(app).get('/tools/paste/view.js');
    expect(res1.status).toBe(200);
    expect(res1.headers['content-type']).toMatch(/javascript/);
    expect(res1.text).toContain('loadPaste');

    const res2 = await request(app).get('/view.js');
    expect(res2.status).toBe(200);
    expect(res2.headers['content-type']).toMatch(/javascript/);
    expect(res2.text).toContain('loadPaste');
  });

  test('GET /p/:code serves view.html with correct script link', async () => {
    const createRes = await request(app)
      .post('/api/paste/create')
      .send({ content: 'console.log("hello");', title: 'Test Paste' });
    expect(createRes.status).toBe(200);
    const code = createRes.body.code;

    const resP = await request(app).get(`/p/${code}`);
    expect(resP.status).toBe(200);
    expect(resP.headers['content-type']).toMatch(/html/);
    expect(resP.text).toContain('/tools/paste/view.js');
  });

  test('Raw endpoints: /raw/:code and /p/:code/raw both return plain text', async () => {
    const createRes = await request(app)
      .post('/api/paste/create')
      .send({ content: 'Line 1\nLine 2\nLine 3', title: 'Multiline' });
    const code = createRes.body.code;

    const raw1 = await request(app).get(`/raw/${code}`);
    expect(raw1.status).toBe(200);
    expect(raw1.text).toBe('Line 1\nLine 2\nLine 3');

    const raw2 = await request(app).get(`/p/${code}/raw`);
    expect(raw2.status).toBe(200);
    expect(raw2.text).toBe('Line 1\nLine 2\nLine 3');
  });

  test('Password-protected paste denies raw access and enforces password check on view', async () => {
    const createRes = await request(app)
      .post('/api/paste/create')
      .send({ content: 'Confidential records', title: 'Protected', password: 'SecretKey99!' });
    const code = createRes.body.code;

    // Raw mode is blocked for password-protected pastes
    const rawRes = await request(app).get(`/p/${code}/raw`);
    expect(rawRes.status).toBe(403);

    // View without password returns 401
    const unauthView = await request(app).post(`/api/paste/view/${code}`).send({});
    expect(unauthView.status).toBe(401);

    // View with wrong password returns 401
    const wrongView = await request(app).post(`/api/paste/view/${code}`).send({ password: 'wrong' });
    expect(wrongView.status).toBe(401);

    // View with correct password returns 200
    const authView = await request(app).post(`/api/paste/view/${code}`).send({ password: 'SecretKey99!' });
    expect(authView.status).toBe(200);
    expect(authView.body.paste.content).toBe('Confidential records');
  });

  test('Burn-on-read paste is destroyed after the first view', async () => {
    const createRes = await request(app)
      .post('/api/paste/create')
      .send({ content: 'Self destruct message', title: 'Burnable', burnOnRead: true });
    const code = createRes.body.code;

    // First view succeeds
    const firstView = await request(app).post(`/api/paste/view/${code}`).send({});
    expect(firstView.status).toBe(200);
    expect(firstView.body.paste.content).toBe('Self destruct message');
    expect(firstView.body.paste.burnOnRead).toBe(true);

    // Second view returns 404 because it was burned
    const secondView = await request(app).post(`/api/paste/view/${code}`).send({});
    expect(secondView.status).toBe(404);
  });
});
