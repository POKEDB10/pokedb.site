# Developer Guide: Adding a Tool to pokedb.site (v2 Architecture)

This document describes how to add a new developer utility or micro-service to `pokedb.site` under the modular v2 architecture (Task P3.4, P3.5, P3.6, ARCH-001, DX-001).

---

## 1. Overview of the v2 Architecture

In pokedb.site v1, all tool routes, HTML rendering, rate limiting, and business logic were coupled in a monolithic `server.js` file (~3,200 lines).

In pokedb.site v2, tool registration is unified and decentralized:
- **`src/registry.js`**: Single source of truth defining all tools, their metadata, subdomains, subpaths, and public directories.
- **`src/app.js`**: Express application factory (`createApp`) that consumes `registry` and mounts tools automatically.
- **`src/middleware/hostRouter.js`**: Host routing middleware that resolves requests by subdomain in production (`<subdomain>.pokedb.site`) and by subpath on localhost (`/tools/<id>/`), ensuring developer workflows never leak or jump to production URLs.
- **`src/tools/<tool-id>/router.js`**: Isolated Express router containing tool-specific endpoints and business logic.
- **`tools/<tool-id>/public/`**: Static HTML, CSS, client-side JavaScript, and assets for the tool.

---

## 2. Adding a Static UI Tool (2 Steps)

If the new tool is client-side only (e.g. formatting, client-side encoding, regex tester, color converter):

### Step 1: Create the Tool UI Directory
Create `tools/<tool-id>/public/index.html`:
```html
<!DOCTYPE html>
<html lang="en" data-theme="oled-black">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My New Tool — pokedb.site</title>
  <link rel="stylesheet" href="/shared/theme.css">
  <script src="/shared/theme-switcher.js"></script>
</head>
<body>
  <h1>My New Tool</h1>
  <p>Self-hosted developer utility.</p>
</body>
</html>
```

### Step 2: Register in `src/registry.js`
Add a single entry to `initialTools` in `src/registry.js`:
```javascript
  {
    id: 'mytool',
    subdomain: 'mytool',
    subpath: '/tools/mytool',
    title: 'My Tool Title',
    description: 'Concise description of the utility for hub cards and search engines',
    indexRoot: path.join(ROOT_DIR, 'tools', 'mytool', 'public'),
    publicDir: path.join(ROOT_DIR, 'tools', 'mytool', 'public')
  }
```

That's it! The application automatically:
1. Serves the tool on `https://mytool.pokedb.site/` in production.
2. Serves the tool on `http://localhost:5050/tools/mytool/` in development.
3. Adds `https://mytool.pokedb.site/` to `/sitemap.xml`.
4. Renders security headers, CSP nonces, and theme tokens.

---

## 3. Adding a Tool with Backend API Endpoints (3 Steps)

If the new tool requires backend API routes, rate-limiting, database storage, or external services:

### Step 1: Create the Static UI
Create `tools/<tool-id>/public/index.html` as described above.

### Step 2: Implement the Router in `src/tools/<tool-id>/router.js`
Export a factory function accepting shared application dependencies:
```javascript
// src/tools/mytool/router.js
const express = require('express');

function createMyToolRouter(options = {}) {
  const router = express.Router();
  const store = options.store;
  const limiters = options.limiters;

  // Example API endpoint: POST /api/mytool/process
  router.post('/api/mytool/process', async (req, res) => {
    try {
      const { input } = req.body || {};
      if (!input) return res.status(400).json({ error: 'input is required' });
      
      const result = input.toUpperCase();
      return res.status(200).json({ success: true, result });
    } catch (err) {
      return res.status(500).json({ error: 'Internal processing error' });
    }
  });

  return router;
}

module.exports = {
  createMyToolRouter
};
```

### Step 3: Register in `src/registry.js` and Mount in `src/app.js`
In `src/registry.js`, add the entry to `initialTools`:
```javascript
  {
    id: 'mytool',
    subdomain: 'mytool',
    subpath: '/tools/mytool',
    title: 'My Backend Tool',
    description: 'High-performance processing engine',
    indexRoot: path.join(ROOT_DIR, 'tools', 'mytool', 'public'),
    publicDir: path.join(ROOT_DIR, 'tools', 'mytool', 'public')
  }
```

In `src/app.js`:
1. Require the router factory:
```javascript
const { createMyToolRouter } = require('./tools/mytool/router');
```
2. Instantiate the router and add it to `toolRouters`:
```javascript
const myToolRouter = createMyToolRouter({ store, limiters, config, clock });

const toolRouters = {
  drop: dropRouter,
  paste: pasteRouter,
  qr: qrRouter,
  health: healthRouter,
  tinyurl: tinyurlRouter,
  mytool: myToolRouter
};
```
3. Mount the API router globally:
```javascript
app.use(myToolRouter);
```

---

## 4. Verification & Testing

Every new tool should be verified with automated unit tests using `supertest`:

```javascript
const request = require('supertest');
const { createApp } = require('../src/app');

describe('My Tool Integration', () => {
  let app;

  beforeAll(() => {
    ({ app } = createApp({ config: { isTest: true } }));
  });

  test('Reachable by subdomain in production host mode', async () => {
    const res = await request(app)
      .get('/')
      .set('Host', 'mytool.pokedb.site');
    expect(res.status).toBe(200);
    expect(res.text).toContain('My Tool Title');
  });

  test('Reachable by subpath in local development mode', async () => {
    const res = await request(app).get('/tools/mytool/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('My Tool Title');
  });

  test('Included in sitemap.xml', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.text).toContain('https://mytool.pokedb.site/');
  });
});
```

Run test suite:
```bash
npx jest tests/mytool.test.js
```
