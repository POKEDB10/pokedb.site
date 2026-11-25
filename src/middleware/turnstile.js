// src/middleware/turnstile.js
// Cloudflare Turnstile verification middleware with timeout and test secret bypass (Task P5.1).

const CLOUDFLARE_TEST_SECRET_PASS = '1x0000000000000000000000000000000AA';
const CLOUDFLARE_TEST_SECRET_FAIL = '2x0000000000000000000000000000000AA';
const CLOUDFLARE_TEST_TOKEN_PASS = 'XXXX.DUMMY.TOKEN.XXXX';

function createTurnstileMiddleware(options = {}) {
  const config = options.config || {};
  const secretKey = options.secretKey || config.turnstileSecretKey || '';
  const isProduction = config.isProduction ?? (process.env.NODE_ENV === 'production');
  const turnstileMode = String(options.mode || config.turnstileMode || 'strict').toLowerCase();
  const timeoutMs = options.timeoutMs || 2000;

  return async function turnstileMiddleware(req, res, next) {
    // P5.2: CLI requests (curl, Wget, Accept: text/plain) skip Turnstile on allowed endpoints
    if (req.isCli) {
      return next();
    }

    const token =
      req.body?.['cf-turnstile-response'] ||
      req.headers['cf-turnstile-response'] ||
      req.headers['x-turnstile-token'] ||
      req.query?.turnstile_token;

    // In dev / test environments without production constraints
    if (!isProduction) {
      // If secret is the Cloudflare Always-Fail test key
      if (secretKey === CLOUDFLARE_TEST_SECRET_FAIL || token === '2x00000000000000000000AB' || token === 'FAIL') {
        return res.status(403).json({ error: 'turnstile_verification_failed' });
      }

      // If secret is the Cloudflare Always-Pass test key or token is dummy or secret unconfigured
      if (
        secretKey === CLOUDFLARE_TEST_SECRET_PASS ||
        !secretKey ||
        token === CLOUDFLARE_TEST_TOKEN_PASS ||
        (token && token.startsWith('1x'))
      ) {
        return next();
      }
    }

    // Production mode: fail closed unless TURNSTILE_MODE=optional
    if (isProduction && !secretKey) {
      if (turnstileMode === 'optional') {
        return next();
      }
      return res.status(503).json({
        error: 'turnstile_not_configured',
        message: 'Security verification is temporarily unavailable.'
      });
    }

    if (!token) {
      return res.status(400).json({
        error: 'turnstile_token_required',
        message: 'Human verification required.'
      });
    }

    // Verify token with Cloudflare siteverify endpoint
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const endpoint = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
      const body = new URLSearchParams({
        secret: secretKey,
        response: token,
        remoteip: req.ip || ''
      });

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal
      });

      clearTimeout(timer);

      if (!response.ok) {
        return res.status(403).json({
          error: 'turnstile_verification_failed',
          message: 'Security challenge failed.'
        });
      }

      const result = await response.json();
      if (!result.success) {
        return res.status(403).json({
          error: 'turnstile_verification_failed',
          message: 'Human verification failed. Please try again.'
        });
      }

      next();
    } catch (err) {
      clearTimeout(timer);
      // Fail closed in production on timeout or network error
      return res.status(403).json({
        error: 'turnstile_verification_failed',
        message: 'Security challenge timed out or could not be verified.'
      });
    }
  };
}

module.exports = {
  createTurnstileMiddleware,
  CLOUDFLARE_TEST_SECRET_PASS,
  CLOUDFLARE_TEST_SECRET_FAIL,
  CLOUDFLARE_TEST_TOKEN_PASS
};
