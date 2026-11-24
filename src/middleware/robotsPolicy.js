// src/middleware/robotsPolicy.js
// Search engine robots policy middleware and dynamic robots.txt handler (Task P3.3, SEO-001, H4).

const { resolveHost } = require('./proxyTrust');

function robotsPolicy(req, res, next) {
  const host = resolveHost(req) || '';
  const p = req.path;

  // 1. Static assets: no robots header
  if (
    p.startsWith('/assets/') ||
    p.startsWith('/fonts/') ||
    p.startsWith('/shared/') ||
    /\.(css|js|ico|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|webp|map)$/i.test(p)
  ) {
    return next();
  }

  // 2. APIs, admin, diagnostics
  if (p.startsWith('/api/') || p.startsWith('/admin/') || p.startsWith('/__diag/')) {
    res.setHeader('X-Robots-Tag', 'noindex');
    return next();
  }

  // 3. User-generated content routes (viewers, direct download, batch, raw, paste)
  if (
    p.startsWith('/v/') ||
    p.startsWith('/view/') ||
    p.startsWith('/d/') ||
    p.startsWith('/b/') ||
    p.startsWith('/raw/') ||
    p.startsWith('/p/')
  ) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
    return next();
  }

  // 4. Health monitor subdomain
  if (host.startsWith('health.')) {
    res.setHeader('X-Robots-Tag', 'noindex, follow');
    return next();
  }

  // 5. Exact root on storing tools (tinyurl, drop, paste)
  if ((host.startsWith('tinyurl.') || host.startsWith('drop.') || host.startsWith('paste.')) && p === '/') {
    res.setHeader('X-Robots-Tag', 'index, follow');
    return next();
  }

  // 6. Non-root paths on tinyurl (e.g. short link codes /:code)
  if (host.startsWith('tinyurl.') && p !== '/') {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
    return next();
  }

  // 7. General indexable surfaces: pokedb.site/, /projects/*, tools hub/pages, qr.pokedb.site/
  if (
    p === '/' ||
    p.startsWith('/projects/') ||
    p.startsWith('/tools/') ||
    host.startsWith('tools.') ||
    host.startsWith('qr.') ||
    host === 'pokedb.site' ||
    host === 'www.pokedb.site'
  ) {
    res.setHeader('X-Robots-Tag', 'index, follow');
    return next();
  }

  next();
}

function handleRobotsTxt(req, res) {
  res.type('text/plain');
  const host = resolveHost(req) || '';

  if (host.startsWith('tinyurl.') || host.startsWith('drop.') || host.startsWith('paste.')) {
    return res.send(`User-agent: *
Allow: /$
Disallow: /api/
Disallow: /admin/
Disallow: /__diag/
`);
  }

  if (host.startsWith('health.')) {
    return res.send(`User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin/
Disallow: /__diag/
`);
  }

  return res.send(`User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin/
Disallow: /__diag/
`);
}

module.exports = {
  robotsPolicy,
  handleRobotsTxt
};
