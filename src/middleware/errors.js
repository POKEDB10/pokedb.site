// src/middleware/errors.js
// 404 Not Found and 500 Error Handlers (Task P3.3).

const { renderTemplate, htmlEscape } = require('../utils/template');
const { resolveHost } = require('./proxyTrust');

function notFoundHandler(req, res) {
  const host = resolveHost(req) || '';
  const isPrimaryHost = ['pokedb.site', 'www.pokedb.site', 'pokedb-site.onrender.com'].includes(host);
  const acceptsHtml = (req.headers?.accept || '').includes('text/html');

  if (!acceptsHtml) {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'not_found', message: 'API endpoint not found' });
    }
    return res.status(404).send('Not Found');
  }

  const requestedTool = host.split('.')[0];
  const safePath = htmlEscape(req.path);
  const safeRequestedTool = htmlEscape(requestedTool);

  const errMessage = isPrimaryHost
    ? `Error 404: Page '${safePath}' not found on pokedb.site.`
    : `Error 404: Subdomain '${safeRequestedTool}.pokedb.site' does not correspond to any active tool.`;

  const cmdMessage = isPrimaryHost
    ? `pokedb resolve --path "${safePath}"`
    : `pokedb resolve --subdomain "${safeRequestedTool}"`;

  return res.status(404).send(
    renderTemplate('404.html', {
      title: '404 — Not Found | pokedb.site',
      command: cmdMessage,
      message: errMessage,
      returnUrl: 'https://tools.pokedb.site/',
      returnLabel: '← Explore Tools Hub (tools.pokedb.site)'
    })
  );
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  if (err.message === 'Origin is not allowed by CORS') {
    return res.status(403).json({ error: 'cors_forbidden', message: 'Origin is not allowed by CORS' });
  }

  const isProd = process.env.NODE_ENV === 'production';
  const reqId = req.id || 'unknown';

  if (req.log && typeof req.log.error === 'function') {
    req.log.error({ err, reqId }, 'Unhandled application error');
  } else {
    console.error(`[ERROR ${reqId}]`, err);
  }

  const acceptsHtml = (req.headers?.accept || '').includes('text/html');
  if (acceptsHtml) {
    return res.status(500).send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>500 — Server Error | pokedb.site</title></head>
<body style="font-family:sans-serif; background:#0b0f19; color:#f3f4f6; padding:2rem; text-align:center;">
  <h1>500 &mdash; Internal Server Error</h1>
  <p style="color:#9ca3af;">An unexpected error occurred while processing your request.</p>
  <p><small style="color:#6b7280;">Request ID: ${htmlEscape(reqId)}</small></p>
  <a href="/" style="color:#60a5fa;">Return Home</a>
</body>
</html>`);
  }

  res.status(500).json({
    error: 'internal_error',
    message: isProd ? 'Internal Server Error' : err.message,
    requestId: reqId
  });
}

module.exports = {
  notFoundHandler,
  errorHandler
};
