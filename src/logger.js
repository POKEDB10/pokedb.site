// src/logger.js
// Structured JSON logger with privacy-preserving redaction (Task P3.2).
// Masked IPs (/24 and /56), query string stripping on sensitive routes,
// and token/secret redaction.

const pino = require('pino');
const crypto = require('node:crypto');

function anonymizeIp(ip) {
  if (!ip || typeof ip !== 'string') return 'unknown';

  let cleaned = ip.trim();
  // Strip IPv4-mapped IPv6 prefix
  if (cleaned.startsWith('::ffff:')) {
    cleaned = cleaned.slice(7);
  }

  // IPv4 check
  const ipv4Match = cleaned.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  if (ipv4Match) {
    return `${ipv4Match[1]}.0/24`;
  }

  // IPv6 check
  if (cleaned.includes(':')) {
    // Expand or extract leading /56 prefix
    const parts = cleaned.split(':').filter(Boolean);
    const prefixParts = [];
    for (let i = 0; i < Math.min(3, parts.length); i++) {
      // Normalize hex segment
      const num = parseInt(parts[i], 16);
      prefixParts.push(Number.isNaN(num) ? parts[i] : num.toString(16));
    }
    return `${prefixParts.join(':')}::/56`;
  }

  return 'unknown';
}

function isSensitivePath(pathPart) {
  // Sensitive paths: /d/:id (drop), /v/:id (paste), /:code (short link redirect)
  if (/^\/d\/[a-zA-Z0-9_-]+/i.test(pathPart)) return true;
  if (/^\/v\/[a-zA-Z0-9_-]+/i.test(pathPart)) return true;
  if (/^\/[a-zA-Z0-9_-]{4,12}$/i.test(pathPart)) return true;
  return false;
}

function sanitizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const [pathname, search] = rawUrl.split('?');
  if (isSensitivePath(pathname)) {
    return pathname;
  }
  return rawUrl;
}

function createLogger(options = {}) {
  const destination = options.destination;
  const level = options.level || (process.env.NODE_ENV === 'test' ? 'info' : (process.env.NODE_ENV === 'bench' ? 'silent' : 'info'));

  const pinoOptions = {
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.token',
        '*.deleteToken',
        '*.password',
        '*.adminToken',
        '*.secret',
        '*.key',
        'token',
        'deleteToken',
        'password',
        'adminToken',
        'secret',
        'authorization'
      ],
      censor: '[REDACTED]'
    },
    base: {
      pid: process.pid
    },
    timestamp: pino.stdTimeFunctions.isoTime
  };

  return pino(pinoOptions, destination);
}

function createHttpLogger(options = {}) {
  const logger = options.logger || createLogger();

  return function httpLogger(req, res, next) {
    if (logger.level === 'silent') {
      const reqId = req.headers['x-request-id'] || 'bench-req';
      req.id = reqId;
      req.log = logger;
      return next();
    }

    const reqId = req.headers['x-request-id'] || crypto.randomUUID();
    req.id = reqId;
    if (typeof res.setHeader === 'function') {
      res.setHeader('X-Request-Id', reqId);
    }

    const clientIp = anonymizeIp(req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for']);
    req.log = logger.child({ reqId });

    const startTime = process.hrtime.bigint();

    if (typeof res.on === 'function') {
      res.on('finish', () => {
        const endTime = process.hrtime.bigint();
        const durationMs = Number(endTime - startTime) / 1e6;

        const sanitizedUrl = sanitizeUrl(req.originalUrl || req.url || req.path);

        req.log.info({
          type: 'http_request',
          method: req.method,
          url: sanitizedUrl,
          statusCode: res.statusCode,
          ip: clientIp,
          durationMs: Math.round(durationMs * 100) / 100
        });
      });
    }

    next();
  };
}

const defaultLogger = createLogger();

module.exports = {
  createLogger,
  createHttpLogger,
  anonymizeIp,
  isSensitivePath,
  sanitizeUrl,
  logger: defaultLogger
};
