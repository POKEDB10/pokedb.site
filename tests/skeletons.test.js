// tests/skeletons.test.js
// Tests for skeleton pages production behavior and TODO hygiene (Task Item 7)

const request = require('supertest');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../src/app');

describe('Task Item 7: Skeleton Project Pages Production Hygiene', () => {
  const SKELETONS = ['aegis', 'beacon', 'kds', 'manifold', 'prism'];

  test('In production mode, requesting skeleton pages returns 404 Not Found', async () => {
    const { app: prodApp } = createApp({
      config: {
        env: 'production',
        isProduction: true,
        dataDir: path.join(__dirname, 'fixtures')
      }
    });

    for (const slug of SKELETONS) {
      const res = await request(prodApp).get(`/projects/${slug}`);
      expect(res.status).toBe(404);
    }
  });

  test('In non-production mode, requesting skeleton pages sets noindex headers', async () => {
    const { app: testApp } = createApp({
      config: {
        env: 'test',
        isProduction: false,
        dataDir: path.join(__dirname, 'fixtures')
      }
    });

    for (const slug of SKELETONS) {
      const res = await request(testApp).get(`/projects/${slug}`);
      expect(res.status).toBe(200);
      expect(res.headers['x-robots-tag']).toContain('noindex');
    }
  });

  test('Skeleton pages are strictly absent from sitemap.xml', async () => {
    const { app } = createApp({
      config: {
        env: 'test',
        dataDir: path.join(__dirname, 'fixtures')
      }
    });

    const res = await request(app).get('/sitemap.xml');
    expect(res.status).toBe(200);
    const body = res.text;

    for (const slug of SKELETONS) {
      expect(body).not.toContain(`/projects/${slug}`);
    }
  });

  test('Skeleton pages are not linked in site navigation', () => {
    const landingHtml = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
    const toolsHubHtml = fs.readFileSync(path.resolve(__dirname, '../tools/public/index.html'), 'utf8');

    for (const slug of SKELETONS) {
      expect(landingHtml).not.toMatch(new RegExp(`<a[^>]+href="[^"]*${slug}[^"]*"`));
      expect(toolsHubHtml).not.toMatch(new RegExp(`<a[^>]+href="[^"]*${slug}[^"]*"`));
    }
  });

  test('No visible TODO(owner) text exists in production-served HTML pages (HTML comments OK)', () => {
    const prodPages = [
      '../public/index.html',
      '../public/docs.html',
      '../public/status.html',
      '../public/changelog.html',
      '../public/terms.html',
      '../public/privacy.html',
      '../public/abuse.html',
      '../public/projects/pokedb-site.html'
    ];

    for (const relPath of prodPages) {
      const fullPath = path.resolve(__dirname, relPath);
      if (!fs.existsSync(fullPath)) continue;
      const html = fs.readFileSync(fullPath, 'utf8');

      // Strip HTML comments: <!-- ... -->
      const strippedHtml = html.replace(/<!--[\s\S]*?-->/g, '');

      // Assert no visible TODO(owner) remains
      expect(strippedHtml).not.toContain('TODO(owner)');
    }
  });
});
