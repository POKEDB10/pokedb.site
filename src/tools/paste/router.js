// src/tools/paste/router.js
// Pastebin API endpoints and static UI router (Task P3.5, P5.1, P5.2, P5.7, P5.11).

const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const { nanoid } = require('nanoid');
const { deriveKey } = require('../../utils/crypto');
const { parseExpiresInDays, logScannerTelemetry } = require('../../utils/urlSecurity');
const { resolveHost } = require('../../middleware/proxyTrust');
const { createTurnstileMiddleware } = require('../../middleware/turnstile');
const { rawSecurityHeaders, ugcSecurityHeaders } = require('../../middleware/securityHeaders');

const MAX_PASTE_BYTES = 256 * 1024; // 256 KiB limit (Task P5.11 / D4)

function createPasteRouter(options = {}) {
  const router = express.Router();
  const store = options.store || {};
  const limiters = options.limiters || {};
  const config = options.config || {};
  const clock = options.clock || Date;

  const pasteCreateLimiter = limiters.pasteCreateLimiter || ((req, res, next) => next());
  const cliLimiter = limiters.cliLimiter || ((req, res, next) => next());
  const pasteAuthLimiter = limiters.pasteAuthLimiter || ((req, res, next) => next());
  const viewerLimiter = limiters.viewerLimiter || ((req, res, next) => next());
  const turnstile = createTurnstileMiddleware({ config });

  function getBaseUrl(req) {
    if (req) {
      const protocol = req.protocol || 'https';
      const host = resolveHost(req);
      if (host) return `${protocol}://${host}`;
    }
    return config.baseUrl || 'https://pokedb.site';
  }

  // 1. Create Paste
  router.post('/api/paste/create', cliLimiter, pasteCreateLimiter, turnstile, async (req, res) => {
    try {
      const { content, title, language, expiresInDays, burnOnRead, password, encrypted } = req.body || {};
      const isEncrypted = Boolean(encrypted);
      if (!content || typeof content !== 'string' || content.trim().length === 0) {
        return res.status(400).json({ error: 'Paste content cannot be empty.' });
      }

      // Task P5.11: D4 Limit (256 KiB max)
      const contentBytes = Buffer.byteLength(content, 'utf8');
      if (contentBytes > MAX_PASTE_BYTES) {
        return res.status(400).json({ error: 'Paste content exceeds the 256 KiB limit.' });
      }

      const expDays = parseExpiresInDays(expiresInDays, 30);
      if (expDays === null) {
        return res.status(400).json({ error: 'expiresInDays must be between 0 and 365.' });
      }

      let pasteCode = '';
      let attempts = 0;
      while (attempts < 5) {
        const candidate = nanoid(8);
        if (!store.getPaste(candidate) && !store.hasKv(`paste:${candidate}`)) {
          pasteCode = candidate;
          break;
        }
        attempts++;
      }

      if (!pasteCode) {
        return res.status(500).json({ error: 'Failed to generate unique paste ID. Please retry.' });
      }

      let passwordMeta = null;
      if (password && typeof password === 'string' && password.trim().length > 0) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hashBuffer = await deriveKey(password.trim(), salt, 64);
        const hash = hashBuffer.toString('hex');
        passwordMeta = { salt, hash };
      }

      const expMs = expDays ? clock.now() + expDays * 86400000 : null;
      const expiresAtIso = expMs ? new Date(expMs).toISOString() : null;

      store.createPaste({
        id: pasteCode,
        title: (title || 'Untitled Paste').substring(0, 100),
        language: (language || 'plaintext').substring(0, 30),
        body: Buffer.from(content, 'utf8'),
        encrypted: isEncrypted ? 1 : 0,
        pwSalt: passwordMeta ? Buffer.from(passwordMeta.salt, 'hex') : null,
        pwHash: passwordMeta ? Buffer.from(passwordMeta.hash, 'hex') : null,
        burn: burnOnRead ? 1 : 0,
        views: 0,
        createdAt: clock.now(),
        expiresAt: expMs,
        status: 'active',
        creator: req.ip
      });

      const pasteUrl = `${getBaseUrl(req)}/p/${pasteCode}`;
      const rawUrl = `${getBaseUrl(req)}/raw/${pasteCode}`;

      // Task P5.2: CLI ergonomics (plain text output for curl/Wget)
      if (req.isCli) {
        return res
          .status(200)
          .set('Content-Type', 'text/plain; charset=utf-8')
          .send(`${pasteUrl}\n`);
      }

      return res.status(200).json({
        success: true,
        code: pasteCode,
        url: pasteUrl,
        rawUrl,
        title: (title || 'Untitled Paste').substring(0, 100),
        language: (language || 'plaintext').substring(0, 30),
        expiresAt: expiresAtIso,
        burnOnRead: Boolean(burnOnRead),
        encrypted: isEncrypted,
        isProtected: Boolean(passwordMeta)
      });
    } catch (err) {
      if (err.statusCode === 503) {
        if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
        return res.status(503).json({ error: 'Crypto service busy: worker queue saturated. Please retry shortly.' });
      }
      console.error('Paste creation error:', err);
      return res.status(500).json({ error: 'Internal server error creating paste.' });
    }
  });

  // 2. View Paste
  async function handlePasteView(req, res) {
    try {
      const code = req.params.code;
      const paste = store.getPaste(code);

      if (!paste) {
        logScannerTelemetry(req, 'Paste not found');
        return res.status(404).json({ error: 'Paste not found or has expired.' });
      }

      if (paste.burn) {
        store.burnPaste(code);
      }

      if (paste.pwSalt && paste.pwHash) {
        const inputPass = req.body && req.body.password ? String(req.body.password) : '';
        const saltHex = paste.pwSalt.toString('hex');
        const computedHash = await deriveKey(inputPass.trim(), saltHex, 64);
        const storedHash = paste.pwHash;

        if (computedHash.length !== storedHash.length || !crypto.timingSafeEqual(computedHash, storedHash)) {
          if (paste.burn) {
            store.restorePaste(code);
          }
          return res.status(401).json({ error: 'Incorrect password for protected paste.' });
        }
      }

      store.incrementPasteViews(code);

      const safeRecord = {
        id: paste.id,
        code: paste.id,
        title: paste.title,
        language: paste.language,
        content: paste.body ? paste.body.toString('utf8') : '',
        size: paste.body ? paste.body.length : 0,
        createdAt: typeof paste.createdAt === 'number' ? new Date(paste.createdAt).toISOString() : paste.createdAt,
        expiresAt: paste.expiresAt ? (typeof paste.expiresAt === 'number' ? new Date(paste.expiresAt).toISOString() : paste.expiresAt) : null,
        burnOnRead: Boolean(paste.burn),
        encrypted: Boolean(paste.encrypted),
        isProtected: Boolean(paste.pwSalt && paste.pwHash),
        views: (paste.views || 0) + 1
      };

      return res.status(200).json({ success: true, paste: safeRecord });
    } catch (err) {
      if (err.statusCode === 503) {
        if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
        return res.status(503).json({ error: 'Crypto service busy: worker queue saturated. Please retry shortly.' });
      }
      console.error('Paste view error:', err);
      return res.status(500).json({ error: 'Failed to retrieve paste.' });
    }
  }

  router.post('/api/paste/view/:code', pasteAuthLimiter, viewerLimiter, ugcSecurityHeaders, handlePasteView);
  router.get('/api/paste/view/:code', viewerLimiter, ugcSecurityHeaders, handlePasteView);

  // 3. Raw plain text paste (Task P5.7: strict sandbox, nosniff, no-referrer)
  router.get(['/api/paste/raw/:code', '/raw/:code', '/p/:code/raw'], viewerLimiter, rawSecurityHeaders, async (req, res) => {
    try {
      const code = req.params.code;
      const paste = store.getPaste(code);
      if (!paste) {
        logScannerTelemetry(req, 'Raw paste not found');
        return res.status(404).send('Error 404: Paste not found or expired.');
      }

      if (paste.pwSalt && paste.pwHash) {
        return res.status(403).send('Error 403: Protected pastes cannot be viewed in raw mode without authentication.');
      }

      if (paste.burn) {
        store.burnPaste(code);
      }

      if (paste.encrypted) {
        res.setHeader('X-Paste-Encrypted', '1');
      }

      return res.status(200).send(paste.body ? paste.body.toString('utf8') : '');
    } catch {
      return res.status(500).send('Error 500: Server error retrieving raw paste.');
    }
  });

  // 4. Viewer HTML page for /p/:code
  const publicDir = path.resolve(__dirname, '..', '..', '..', 'tools', 'paste', 'public');
  router.get('/p/:code', viewerLimiter, (req, res) => {
    res.sendFile(path.join(publicDir, 'view.html'));
  });

  // 5. Viewer JavaScript asset route
  router.get(['/tools/paste/view.js', '/view.js'], (req, res) => {
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
    res.sendFile(path.join(publicDir, 'view.js'));
  });

  return router;
}

module.exports = {
  createPasteRouter,
  MAX_PASTE_BYTES
};
