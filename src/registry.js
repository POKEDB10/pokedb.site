// src/registry.js
// Tool Registry: single source of truth for all tools, subdomains, routing,
// navigation, hub cards, and sitemap generation (Task P3.4, ARCH-001, DX-001).

const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

const initialTools = [
  {
    id: 'tinyurl',
    subdomain: 'tinyurl',
    subpath: '/tools/tinyurl',
    title: 'URL Shortener',
    description: 'Fast, collision-resistant link shortening with analytics and safety auditing',
    indexRoot: path.join(ROOT_DIR, 'tools', 'tinyurl', 'public'),
    publicDir: path.join(ROOT_DIR, 'tools', 'tinyurl', 'public')
  },
  {
    id: 'paste',
    subdomain: 'paste',
    subpath: '/tools/paste',
    title: 'Encrypted Pastebin',
    description: 'Zero-knowledge client-side encrypted text and code sharing with scrypt protection',
    indexRoot: path.join(ROOT_DIR, 'tools', 'paste', 'public'),
    publicDir: path.join(ROOT_DIR, 'tools', 'paste', 'public')
  },
  {
    id: 'qr',
    subdomain: 'qr',
    subpath: '/tools/qr',
    title: 'QR Studio',
    description: 'High-density customizable SVG and PNG QR code generator',
    indexRoot: path.join(ROOT_DIR, 'tools', 'qr', 'public'),
    publicDir: path.join(ROOT_DIR, 'tools', 'qr', 'public')
  },
  {
    id: 'drop',
    subdomain: 'drop',
    subpath: '/tools/drop',
    title: 'Drop File Transfer',
    description: 'Direct-to-storage multipart file sharing with short typeable links',
    indexRoot: path.join(ROOT_DIR, 'tools', 'drop', 'public'),
    publicDir: path.join(ROOT_DIR, 'tools', 'drop', 'public')
  },
  {
    id: 'lan',
    subdomain: 'lan',
    subpath: '/tools/lan',
    title: 'LAN Direct Share',
    description: 'Direct browser-to-browser file transfer over your local network with end-to-end encryption',
    indexRoot: path.join(ROOT_DIR, 'tools', 'lan', 'public'),
    publicDir: path.join(ROOT_DIR, 'tools', 'lan', 'public')
  },
  {
    id: 'health',
    subdomain: 'health',
    subpath: '/tools/health',
    title: 'System Health',
    description: 'Real-time operational telemetry, replication age, and system metrics',
    indexRoot: path.join(ROOT_DIR, 'tools', 'health', 'public'),
    publicDir: path.join(ROOT_DIR, 'tools', 'health', 'public')
  },
  {
    id: 'json',
    subdomain: 'json',
    subpath: '/tools/json',
    title: 'JSON Formatter & Validator',
    description: 'Offline-first client-side JSON formatting, minification, and syntax validation',
    indexRoot: path.join(ROOT_DIR, 'tools', 'json', 'public'),
    publicDir: path.join(ROOT_DIR, 'tools', 'json', 'public'),
    offline: true
  },
  {
    id: 'jwt',
    subdomain: 'jwt',
    subpath: '/tools/jwt',
    title: 'JWT Inspector',
    description: 'Offline JWT claim decoder, expiry timeline, and WebCrypto signature verifier',
    indexRoot: path.join(ROOT_DIR, 'tools', 'jwt', 'public'),
    publicDir: path.join(ROOT_DIR, 'tools', 'jwt', 'public'),
    offline: true
  },
  {
    id: 'codec',
    subdomain: 'codec',
    subpath: '/tools/codec',
    title: 'Base64, Hex & URL Codec',
    description: 'Fast two-way encoder and decoder for Base64, Base64URL, Hex, URL, and Binary',
    indexRoot: path.join(ROOT_DIR, 'tools', 'codec', 'public'),
    publicDir: path.join(ROOT_DIR, 'tools', 'codec', 'public'),
    offline: true
  },
  {
    id: 'hash',
    subdomain: 'hash',
    subpath: '/tools/hash',
    title: 'Cryptographic Hash Studio',
    description: 'Client-side SHA-256, SHA-512, and streaming file checksum verification',
    indexRoot: path.join(ROOT_DIR, 'tools', 'hash', 'public'),
    publicDir: path.join(ROOT_DIR, 'tools', 'hash', 'public'),
    offline: true
  },
  {
    id: 'uuid',
    subdomain: 'uuid',
    subpath: '/tools/uuid',
    title: 'UUID & ULID Generator',
    description: 'Cryptographic UUID v4, time-ordered UUID v7, and sortable ULID generator',
    indexRoot: path.join(ROOT_DIR, 'tools', 'uuid', 'public'),
    publicDir: path.join(ROOT_DIR, 'tools', 'uuid', 'public'),
    offline: true
  },
  {
    id: 'cron',
    subdomain: 'cron',
    subpath: '/tools/cron',
    title: 'Cron Expression Explainer',
    description: 'Human-readable 5-part cron syntax parser and upcoming execution scheduler',
    indexRoot: path.join(ROOT_DIR, 'tools', 'cron', 'public'),
    publicDir: path.join(ROOT_DIR, 'tools', 'cron', 'public'),
    offline: true
  },
  {
    id: 'diff',
    subdomain: 'diff',
    subpath: '/tools/diff',
    title: 'Text Diff Studio',
    description: 'Line-by-line unified and side-by-side text difference inspector in pure JS',
    indexRoot: path.join(ROOT_DIR, 'tools', 'diff', 'public'),
    publicDir: path.join(ROOT_DIR, 'tools', 'diff', 'public'),
    offline: true
  },
  {
    id: 'minecraft',
    subdomain: 'minecraft',
    subpath: '/tools/minecraft',
    title: 'Minecraft Server Toolkit',
    description: 'Verified Aikar PaperMC JVM flags, server.properties generator, and MOTD preview',
    indexRoot: path.join(ROOT_DIR, 'tools', 'minecraft', 'public'),
    publicDir: path.join(ROOT_DIR, 'tools', 'minecraft', 'public'),
    offline: true
  },
  {
    id: 'sanitizer',
    subdomain: 'sanitizer',
    subpath: '/tools/sanitizer',
    title: 'Log & Secret Sanitizer',
    description: 'Client-side redaction of IPs, emails, auth tokens, JWTs, and home paths',
    indexRoot: path.join(ROOT_DIR, 'tools', 'sanitizer', 'public'),
    publicDir: path.join(ROOT_DIR, 'tools', 'sanitizer', 'public'),
    offline: true
  }
];

const registry = [...initialTools];

function getTool(idOrSubdomain) {
  if (!idOrSubdomain) return undefined;
  const target = String(idOrSubdomain).toLowerCase();
  return registry.find(t => t.id === target || t.subdomain === target);
}

function registerTool(toolDef) {
  if (!toolDef || !toolDef.id) throw new Error('Tool definition must include an id');
  const existingIndex = registry.findIndex(t => t.id === toolDef.id);
  if (existingIndex >= 0) {
    registry[existingIndex] = toolDef;
  } else {
    registry.push(toolDef);
  }
}

function unregisterTool(id) {
  const index = registry.findIndex(t => t.id === id);
  if (index >= 0) {
    registry.splice(index, 1);
    return true;
  }
  return false;
}

function generateSitemapXml(baseUrl = 'https://pokedb.site') {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const now = new Date().toISOString().split('T')[0];

  const urls = [
    { loc: `${cleanBase}/`, priority: '1.0', changefreq: 'weekly' },
    { loc: `https://tools.pokedb.site/`, priority: '0.9', changefreq: 'weekly' },
    { loc: `${cleanBase}/projects/pokedb-site`, priority: '0.8', changefreq: 'monthly' },
    { loc: `${cleanBase}/changelog`, priority: '0.7', changefreq: 'weekly' },
    { loc: `${cleanBase}/docs`, priority: '0.7', changefreq: 'weekly' },
    { loc: `${cleanBase}/status`, priority: '0.6', changefreq: 'daily' },
    { loc: `${cleanBase}/terms`, priority: '0.5', changefreq: 'monthly' },
    { loc: `${cleanBase}/privacy`, priority: '0.5', changefreq: 'monthly' },
    { loc: `${cleanBase}/abuse`, priority: '0.5', changefreq: 'monthly' }
  ];

  for (const tool of registry) {
    urls.push({
      loc: `https://${tool.subdomain}.pokedb.site/`,
      priority: '0.8',
      changefreq: 'weekly'
    });
  }

  const urlEntries = urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;
}

function getNavUrl(targetId, isProduction = false) {
  const SUBDOMAIN_TOOLS = new Set(['tools', 'tinyurl', 'qr', 'drop', 'paste', 'health']);
  if (isProduction) {
    if (targetId === 'main') return 'https://pokedb.site/';
    if (targetId === 'tools') return 'https://tools.pokedb.site/';
    if (SUBDOMAIN_TOOLS.has(targetId)) return `https://${targetId}.pokedb.site/`;
    return `https://pokedb.site/tools/${targetId}/`;
  }
  if (targetId === 'main') return '/';
  if (targetId === 'tools') return '/tools/';
  return `/tools/${targetId}/`;
}

module.exports = {
  registry,
  getTool,
  registerTool,
  unregisterTool,
  generateSitemapXml,
  getNavUrl
};
