// src/middleware/auth.js
// Authentication, token header enforcement, query token rejection, and timing-safe checks (Task P3.3, SEC-003).

const crypto = require('node:crypto');

function tokensMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function extractBearerOrHeaderToken(req, headerName = 'x-delete-token') {
  const authHeader = (typeof req.get === 'function' ? req.get('authorization') : req.headers?.['authorization']) || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const customHeader = (typeof req.get === 'function' ? req.get(headerName) : req.headers?.[headerName.toLowerCase()]) || '';
  if (customHeader) {
    return customHeader.trim();
  }
  return '';
}

function queryTokenRejector(req, res, next) {
  if (req.query) {
    const forbidden = ['token', 'admin_token', 'delete_token', 'deletetoken'];
    const queryKeys = Object.keys(req.query).map(k => k.toLowerCase());
    if (queryKeys.some(k => forbidden.includes(k))) {
      const acceptHeader = (typeof req.get === 'function' ? req.get('accept') : req.headers?.['accept']) || '';
      const isHtml = acceptHeader.includes('text/html');
      if (isHtml) {
        return res.status(400).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>400 - Query Tokens Deprecated | PokéDB</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f3f4f6; padding: 2rem; display: flex; justify-content: center; align-items: center; min-height: 80vh; margin: 0; }
    .card { background: #111827; border: 1px solid #374151; border-radius: 8px; padding: 2rem; max-width: 540px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.5); }
    h1 { color: #f87171; font-size: 1.5rem; margin-top: 0; }
    p { line-height: 1.6; color: #9ca3af; }
    code { background: #1f2937; color: #60a5fa; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9em; }
    .btn { display: inline-block; margin-top: 1rem; background: #2563eb; color: #fff; text-decoration: none; padding: 0.6rem 1.2rem; border-radius: 4px; font-weight: 500; }
  </style>
</head>
<body>
  <div class="card" role="main">
    <h1>400 &mdash; Query Tokens Deprecated</h1>
    <p>For security, authentication and deletion tokens in URL query strings (<code>?token=...</code>) are no longer accepted to prevent credentials from leaking into browser history, referrer logs, and shared links.</p>
    <p>Please use the tool user interface or pass your token via the <code>Authorization: Bearer &lt;token&gt;</code> or <code>X-Delete-Token: &lt;token&gt;</code> HTTP request header.</p>
    <a href="/" class="btn">Return to Home</a>
  </div>
</body>
</html>`);
      }
      return res.status(400).json({
        error: 'query_tokens_forbidden',
        message: 'Tokens in URL query parameters are forbidden for security. Pass tokens in the Authorization or X-Delete-Token header.'
      });
    }
  }
  next();
}

function createRequireAdmin(adminToken) {
  return function requireAdmin(req, res, next) {
    if (!adminToken) {
      return res.status(503).json({ error: 'ADMIN_TOKEN is not configured on this server.' });
    }

    const authHeader = (typeof req.get === 'function' ? req.get('authorization') : req.headers?.['authorization']) || '';
    let provided = '';
    if (authHeader.startsWith('Bearer ')) {
      provided = authHeader.slice(7).trim();
    } else if (req.query?.admin_token) {
      provided = String(req.query.admin_token).trim();
    }

    if (!provided || !tokensMatch(provided, adminToken)) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing admin token.' });
    }

    next();
  };
}

module.exports = {
  tokensMatch,
  extractBearerOrHeaderToken,
  queryTokenRejector,
  createRequireAdmin
};
