// src/middleware/proxyTrust.js
// Proxy trust, host resolution, and origin lock (Task P3.3, SEC-001, H2, H3).

const crypto = require('node:crypto');

function parseTrustProxy(value) {
  if (value === undefined || value === null || value === '') {
    return 'loopback,uniquelocal';
  }
  const str = String(value).trim();
  if (str.toLowerCase() === 'false' || str === '0') return false;
  if (str.toLowerCase() === 'true' || str === '1') return true;
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  if (str.includes(',')) {
    return str.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return str;
}

function normalizeHost(value) {
  if (typeof value !== 'string') return '';
  return value.trim().split(',')[0].trim().replace(/^https?:\/\//i, '').split(':')[0].toLowerCase();
}

function resolveHost(req) {
  if (!req) return '';
  const candidates = [];

  const xsub = req.headers?.['x-subdomain'] || req.headers?.['x-tool-subdomain'];
  if (Array.isArray(xsub)) candidates.push(...xsub);
  else if (typeof xsub === 'string') candidates.push(...xsub.split(','));

  const xfh = req.headers?.['x-forwarded-host'];
  if (Array.isArray(xfh)) candidates.push(...xfh);
  else if (typeof xfh === 'string') candidates.push(...xfh.split(','));

  const xhost = req.headers?.['x-host'];
  if (Array.isArray(xhost)) candidates.push(...xhost);
  else if (typeof xhost === 'string') candidates.push(...xhost.split(','));

  const hostHeader = req.headers?.host || (typeof req.get === 'function' ? req.get('host') : undefined);
  if (typeof hostHeader === 'string') candidates.push(...hostHeader.split(','));

  const hosts = candidates
    .map(h => String(h).trim().split(':')[0].toLowerCase())
    .filter(Boolean);

  const toolSubdomain = hosts.find(h => h.endsWith('.pokedb.site') && h !== 'pokedb.site' && h !== 'www.pokedb.site');
  if (toolSubdomain) return toolSubdomain;

  const apexHost = hosts.find(h => h.endsWith('.pokedb.site') || h === 'pokedb.site');
  if (apexHost) return apexHost;

  return hosts[0] || '';
}

function resolveApiHost(req) {
  const directHost = normalizeHost(req.headers?.host || (typeof req.get === 'function' ? req.get('host') : undefined));
  if (!directHost.endsWith('.onrender.com')) return directHost;

  const forwardedHost = normalizeHost(req.headers?.['x-forwarded-host']);
  if (forwardedHost.endsWith('.pokedb.site')) return forwardedHost;

  const routedSubdomain = normalizeHost(req.headers?.['x-subdomain'] || req.headers?.['x-tool-subdomain']);
  if (routedSubdomain.endsWith('.pokedb.site')) return routedSubdomain;

  return directHost;
}

function resolveBrowserOriginHost(req) {
  const getHeader = typeof req.get === 'function' ? (h) => req.get(h) : (h) => req.headers?.[h.toLowerCase()];
  const candidates = [getHeader('origin'), getHeader('referer')];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const host = new URL(candidate).hostname.toLowerCase();
      if (host.endsWith('.pokedb.site') || host === 'pokedb.site') return host;
    } catch {
      // Ignore malformed browser URLs
    }
  }
  return '';
}

function isLoopbackAddress(addr) {
  if (!addr) return false;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function tokensMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function createOriginLock(secretProvider) {
  return function originLock(req, res, next) {
    const secret = typeof secretProvider === 'function'
      ? secretProvider()
      : (secretProvider || process.env.ORIGIN_VERIFY_SECRET);
    if (!secret) return next();

    // Loopback health exemptions: exact GET /healthz or GET /health
    if (
      req.method === 'GET' &&
      (req.path === '/healthz' || req.path === '/health') &&
      isLoopbackAddress(req.socket?.remoteAddress || req.connection?.remoteAddress)
    ) {
      return next();
    }

    const getHeader = typeof req.get === 'function' ? (h) => req.get(h) : (h) => req.headers?.[h.toLowerCase()];
    const provided = getHeader('x-origin-verify');
    if (!provided || !tokensMatch(provided, secret)) {
      return res.status(403).json({ error: 'Origin verification failed.' });
    }

    next();
  };
}

module.exports = {
  parseTrustProxy,
  normalizeHost,
  resolveHost,
  resolveApiHost,
  resolveBrowserOriginHost,
  isLoopbackAddress,
  tokensMatch,
  createOriginLock
};
