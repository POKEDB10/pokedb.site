// src/services/sentry.js
// Server-side Sentry error reporting with PII scrubbing, 4xx filtering, and rate capping (Task P8.2, OPS-002).
// No browser SDK is ever loaded.

const SENSITIVE_QUERY_PARAMS = new Set([
  'token',
  'key',
  'secret',
  'password',
  'code',
  'admintoken',
  'auth',
  'api_key',
  'apikey',
  'access_key',
  'signature'
]);

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-admin-token',
  'x-origin-verify',
  'x-forwarded-for',
  'cf-connecting-ip'
]);

function scrubIp(ip) {
  if (!ip || typeof ip !== 'string') return '[REDACTED]';
  const clean = ip.trim();
  if (clean.includes('.')) {
    // IPv4: mask to /24 subnet
    const parts = clean.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
    }
  } else if (clean.includes(':')) {
    // IPv6: mask to /48
    const parts = clean.split(':');
    return `${parts.slice(0, 3).join(':')}::/48`;
  }
  return '[REDACTED]';
}

function scrubUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return urlString;
  try {
    const isRelative = urlString.startsWith('/');
    const dummyBase = 'http://localhost';
    const parsed = new URL(isRelative ? `${dummyBase}${urlString}` : urlString);

    let changed = false;
    for (const [key, value] of parsed.searchParams.entries()) {
      if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, '[REDACTED]');
        changed = true;
      }
    }

    if (!changed) return urlString;
    return isRelative ? `${parsed.pathname}${parsed.search}` : parsed.toString();
  } catch (_) {
    return urlString;
  }
}

function scrubHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const scrubbed = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_HEADERS.has(lower)) {
      scrubbed[key] = '[REDACTED]';
    } else {
      scrubbed[key] = value;
    }
  }
  return scrubbed;
}

function is4xxError(event, hint) {
  // Check hint error status/statusCode
  const error = hint?.originalException;
  if (error) {
    const code = Number(error.statusCode || error.status);
    if (!Number.isNaN(code) && code >= 400 && code < 500) {
      return true;
    }
    // Check known client-error names
    if (error.name === 'BadRequestError' || error.name === 'NotFoundError' || error.type === 'entity.parse.failed') {
      return true;
    }
  }

  // Check event tags/contexts
  const responseStatus = Number(
    event?.contexts?.response?.status_code ||
    event?.tags?.status_code ||
    event?.extra?.status_code ||
    event?.extra?.statusCode
  );
  if (!Number.isNaN(responseStatus) && responseStatus >= 400 && responseStatus < 500) {
    return true;
  }

  return false;
}

class HourlyRateLimiter {
  constructor(maxEventsPerHour = 50, clock = Date) {
    this.maxEvents = maxEventsPerHour;
    this.clock = clock;
    this.events = [];
  }

  tryAcquire() {
    const now = this.clock.now();
    const oneHourAgo = now - 3600000;
    this.events = this.events.filter((ts) => ts > oneHourAgo);

    if (this.events.length >= this.maxEvents) {
      return false; // Rate cap exceeded
    }

    this.events.push(now);
    return true;
  }

  getRecentCount() {
    const now = this.clock.now();
    const oneHourAgo = now - 3600000;
    this.events = this.events.filter((ts) => ts > oneHourAgo);
    return this.events.length;
  }

  reset() {
    this.events = [];
  }
}

function createBeforeSend(options = {}) {
  const rateLimiter = options.rateLimiter || new HourlyRateLimiter(options.maxEventsPerHour || 50, options.clock || Date);

  return function beforeSend(event, hint) {
    if (!event) return null;

    // 1. Never send 4xx client errors
    if (is4xxError(event, hint)) {
      return null;
    }

    // 2. Cap events per hour
    if (!rateLimiter.tryAcquire()) {
      return null;
    }

    // 3. Scrub IP addresses
    if (event.user) {
      if (event.user.ip_address) {
        event.user.ip_address = scrubIp(event.user.ip_address);
      }
    }
    if (event.request) {
      if (event.request.env?.REMOTE_ADDR) {
        event.request.env.REMOTE_ADDR = scrubIp(event.request.env.REMOTE_ADDR);
      }
      if (event.request.url) {
        event.request.url = scrubUrl(event.request.url);
      }
      if (event.request.query_string) {
        event.request.query_string = scrubUrl(event.request.query_string);
      }
      if (event.request.headers) {
        event.request.headers = scrubHeaders(event.request.headers);
      }
    }

    return event;
  };
}

function createSentryService(options = {}) {
  const config = options.config || {};
  const dsn = options.dsn || config.sentryDsn;
  const isEnabled = Boolean(dsn);
  const maxEventsPerHour = options.maxEventsPerHour || 50;
  const clock = options.clock || Date;

  const rateLimiter = new HourlyRateLimiter(maxEventsPerHour, clock);
  const beforeSend = createBeforeSend({ rateLimiter, clock });

  let sentryClient = null;
  if (isEnabled) {
    try {
      const Sentry = require('@sentry/node');
      Sentry.init({
        dsn,
        environment: config.nodeEnv || process.env.NODE_ENV || 'production',
        sampleRate: 1.0,
        beforeSend
      });
      sentryClient = Sentry;
    } catch (_) {
      // Optional dependency not installed; safe no-op
    }
  }

  return {
    isEnabled,
    dsn,
    rateLimiter,
    beforeSend,
    captureException(err, context = {}) {
      if (!isEnabled || !sentryClient) return null;
      return sentryClient.captureException(err, context);
    },
    errorHandler() {
      return (err, req, res, next) => {
        if (isEnabled && sentryClient) {
          const status = Number(err.statusCode || err.status || 500);
          if (status >= 500) {
            sentryClient.captureException(err, { extra: { statusCode: status, path: req.path } });
          }
        }
        next(err);
      };
    }
  };
}

module.exports = {
  scrubIp,
  scrubUrl,
  scrubHeaders,
  is4xxError,
  HourlyRateLimiter,
  createBeforeSend,
  createSentryService
};
