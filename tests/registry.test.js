// tests/registry.test.js
// Unit tests for src/registry.js (Task P3.4)

const path = require('node:path');
const { registry, getTool, registerTool, unregisterTool, generateSitemapXml } = require('../src/registry.js');

describe('Tool Registry (Task P3.4 / src/registry.js)', () => {
  test('contains all 5 canonical tools (tinyurl, paste, qr, drop, health)', () => {
    const ids = registry.map(t => t.id);
    expect(ids).toContain('tinyurl');
    expect(ids).toContain('paste');
    expect(ids).toContain('qr');
    expect(ids).toContain('drop');
    expect(ids).toContain('health');
  });

  test('each tool has required registry metadata', () => {
    for (const tool of registry) {
      expect(tool.id).toBeDefined();
      expect(tool.subdomain).toBeDefined();
      expect(tool.subpath).toBeDefined();
      expect(tool.title).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(typeof tool.subpath).toBe('string');
      expect(tool.subpath.startsWith('/tools/')).toBe(true);
    }
  });

  test('getTool resolves by id or subdomain', () => {
    expect(getTool('tinyurl').id).toBe('tinyurl');
    expect(getTool('paste').subdomain).toBe('paste');
    expect(getTool('qr').title).toBe('QR Studio');
    expect(getTool('unknown-tool')).toBeUndefined();
  });

  test('generateSitemapXml builds valid sitemap with all active tools', () => {
    const xml = generateSitemapXml('https://pokedb.site');
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain('<loc>https://pokedb.site/</loc>');
    expect(xml).toContain('<loc>https://tools.pokedb.site/</loc>');
    expect(xml).toContain('<loc>https://tinyurl.pokedb.site/</loc>');
    expect(xml).toContain('<loc>https://drop.pokedb.site/</loc>');
    expect(xml).toContain('<loc>https://paste.pokedb.site/</loc>');
    expect(xml).toContain('<loc>https://qr.pokedb.site/</loc>');
  });

  test('supports dynamic register and unregister (for P3.6 throwaway hello tool)', () => {
    const dummyTool = {
      id: 'dummy',
      subdomain: 'dummy',
      subpath: '/tools/dummy',
      title: 'Dummy Tool',
      description: 'Test dummy tool',
      indexRoot: '/tmp',
      publicDir: '/tmp'
    };

    registerTool(dummyTool);
    expect(getTool('dummy')).toBeDefined();
    expect(generateSitemapXml('https://pokedb.site')).toContain('https://dummy.pokedb.site/');

    unregisterTool('dummy');
    expect(getTool('dummy')).toBeUndefined();
    expect(generateSitemapXml('https://pokedb.site')).not.toContain('https://dummy.pokedb.site/');
  });
});
