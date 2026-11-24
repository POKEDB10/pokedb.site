// src/middleware/securityHeaders.js
// Security headers, CSP nonces, CORS policy, and graceful connection tracking (Task P3.3).

const crypto = require('node:crypto');
const helmet = require('helmet');
const cors = require('cors');

const ALLOWED_CORS_ORIGIN = /^(?:https?:\/\/)(?:[a-z0-9-]+\.)*pokedb\.site$/i;

function createCorsMiddleware() {
  return cors({
    origin(origin, callback) {
      if (
        !origin ||
        ALLOWED_CORS_ORIGIN.test(origin) ||
        /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin) ||
        /^https?:\/\/pokedb-site\.onrender\.com$/i.test(origin)
      ) {
        return callback(null, true);
      }
      return callback(new Error('Origin is not allowed by CORS'));
    },
    maxAge: 86400,
    preflightContinue: false,
    optionsSuccessStatus: 204
  });
}

function cspNonceMiddleware(req, res, next) {
  res.locals = res.locals || {};
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
}

function createHelmetMiddleware() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          (req, res) => `'nonce-${res.locals.cspNonce}'`,
          'https://challenges.cloudflare.com',
          'https://static.cloudflareinsights.com'
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'"
        ],
        fontSrc: ["'self'"],
        connectSrc: [
          (req, res) => {
            const isOffline = res.locals?.offlineTool ||
              /^\/tools\/(json|jwt|codec|hash|uuid|cron|diff|minecraft|sanitizer)/.test(req.path) ||
              /^(json|jwt|codec|hash|uuid|cron|diff|minecraft|sanitizer)\./.test(req.headers?.host || '');
            if (isOffline) {
              return "'none'";
            }
            return "'self' https://*.r2.cloudflarestorage.com https://cloudflareinsights.com";
          }
        ],
        frameSrc: ["'self'", 'https://challenges.cloudflare.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        upgradeInsecureRequests: null
      }
    },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    xPoweredBy: false,
    frameguard: { action: 'sameorigin' },
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  });
}

function rawSecurityHeaders(req, res, next) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  next();
}

function ugcSecurityHeaders(req, res, next) {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

function createConnectionDrainTracker() {
  let activeRequests = 0;
  let isShuttingDown = false;
  let onDrainedCallback = null;

  function middleware(req, res, next) {
    if (isShuttingDown) {
      res.set('Connection', 'close');
    }
    activeRequests++;
    let accounted = false;
    const onDone = () => {
      if (!accounted) {
        accounted = true;
        activeRequests--;
        if (isShuttingDown && activeRequests <= 0 && onDrainedCallback) {
          onDrainedCallback();
        }
      }
    };
    res.on('finish', onDone);
    res.on('close', onDone);
    next();
  }

  function startDrain(onDrained) {
    isShuttingDown = true;
    onDrainedCallback = onDrained;
    if (activeRequests <= 0 && onDrainedCallback) {
      onDrainedCallback();
    }
  }

  function getActiveRequests() {
    return activeRequests;
  }

  return {
    middleware,
    startDrain,
    getActiveRequests
  };
}

module.exports = {
  createCorsMiddleware,
  cspNonceMiddleware,
  createHelmetMiddleware,
  rawSecurityHeaders,
  ugcSecurityHeaders,
  createConnectionDrainTracker
};
