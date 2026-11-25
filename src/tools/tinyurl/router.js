// src/tools/tinyurl/router.js
// TinyURL Shortener API and Redirect Handler router (Task P3.5, P5.1 - P5.5, PERF-001, PERF-004, SEC-001).

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { generateShortCode } = require('../../utils/crypto');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const {
  RESERVED_BLOCKLIST,
  isValidTargetUrl,
  parseExpiresInDays,
  analyzeUrlRisk
} = require('../../utils/urlSecurity');
const { SafeBrowsingService } = require('../../services/safeBrowsing');
const { renderTemplate, htmlEscape, serializeForInlineScript } = require('../../utils/template');
const { resolveHost } = require('../../middleware/proxyTrust');
const { checkApiHost } = require('../../middleware/hostRouter');
const { createTurnstileMiddleware } = require('../../middleware/turnstile');
const { ugcSecurityHeaders } = require('../../middleware/securityHeaders');

function createTinyurlRouter(options = {}) {
  const router = express.Router();
  const store = options.store || {};
  const clickBuffer = options.clickBuffer || { recordClick: () => true, getBufferedCount: () => 0 };
  const limiters = options.limiters || {};
  const config = options.config || {};
  const clock = options.clock || Date;

  const shortenLimiter = limiters.shortenLimiter || ((req, res, next) => next());
  const cliLimiter = limiters.cliLimiter || ((req, res, next) => next());
  const redirectLimiter = limiters.redirectLimiter || ((req, res, next) => next());
  const turnstile = createTurnstileMiddleware({ config });
  const safeBrowsing = new SafeBrowsingService({
    apiKey: config.googleSafeBrowsingKey,
    store,
    timeoutMs: 800
  });

  function getBaseUrl(req) {
    if (req) {
      const protocol = req.protocol || 'https';
      const host = resolveHost(req);
      if (host) return `${protocol}://${host}`;
    }
    return config.baseUrl || 'https://pokedb.site';
  }

  // 1. POST /api/shorten and POST / (CLI direct)
  router.post(
    ['/', '/api/shorten'],
    cliLimiter,
    shortenLimiter,
    turnstile,
    checkApiHost(['tinyurl.pokedb.site']),
    async (req, res) => {
      try {
        const { url, customAlias, expiresInDays } = req.body || {};

        if (!isValidTargetUrl(url, req.get('host'))) {
          return res.status(400).json({ error: 'Invalid URL. Only http:// and https:// URLs are supported.' });
        }

        const targetUrl = url.trim();

        // Task P5.4: Creation-time threat checking (< 1 ms local feed -> Safe Browsing 800 ms)
        const scanResult = await safeBrowsing.checkUrl(targetUrl);
        if (!scanResult.isSafe) {
          const attribution = scanResult.attribution
            ? ` ${scanResult.attribution} (https://safebrowsing.google.com/)`
            : '';
          const reason = scanResult.reason || `Flagged by Google Safe Browsing: Suspected ${scanResult.threatType || 'malicious'} site.${attribution}`;
          return res.status(422).json({
            error: 'threat_detected',
            message: reason,
            threatType: scanResult.threatType || 'MALWARE',
            attribution: scanResult.attribution || 'Advisory provided by Google'
          });
        }

        let code;
        if (customAlias && typeof customAlias === 'string' && customAlias.trim() !== '') {
          const alias = customAlias.trim();

          if (RESERVED_BLOCKLIST.has(alias.toLowerCase())) {
            return res.status(400).json({ error: 'This custom alias is reserved.' });
          }

          if (!/^[a-zA-Z0-9_-]+$/.test(alias) || alias.length > 30) {
            return res.status(400).json({
              error: 'Custom alias must be alphanumeric, hyphens or underscores only (max 30 characters).'
            });
          }

          code = alias;
        } else {
          do {
            code = generateShortCode();
          } while (RESERVED_BLOCKLIST.has(code.toLowerCase()) || (store.getLink && store.getLink(code) !== null));
        }

        // Task P5.11: D4 Limits (link max 365 days; permanent only with owner/admin token)
        let days = parseExpiresInDays(expiresInDays, 30);
        if (days === null) {
          return res.status(400).json({ error: 'expiresInDays must be an integer between 0 and 365.' });
        }

        const authHeader = req.headers.authorization || '';
        const isAdmin = config.adminToken && authHeader === `Bearer ${config.adminToken}`;
        if (days === 0 && !isAdmin) {
          days = 365; // Non-admin max cap is 365 days
        }

        let expiresAt = null;
        let expiresAtMs = null;
        if (days > 0) {
          expiresAtMs = clock.now() + Math.floor(days * 86400 * 1000);
          expiresAt = new Date(expiresAtMs).toISOString();
        }

        const initialStatus = scanResult.unscanned ? 'unscanned' : 'active';
        const created = store.createLink({
          code,
          target: targetUrl,
          createdAt: clock.now(),
          expiresAt: expiresAtMs,
          clicks: 0,
          status: initialStatus,
          creator: req.ip
        });

        if (!created) {
          const candidateList = [];
          for (let suffixNumber = 2; suffixNumber <= 50; suffixNumber += 1) {
            const suffix = `-${suffixNumber}`;
            const candidate = `${code.slice(0, 30 - suffix.length)}${suffix}`;
            if (!RESERVED_BLOCKLIST.has(candidate.toLowerCase())) {
              candidateList.push(candidate);
            }
          }
          const existing = new Set(store.getExistingCodes ? store.getExistingCodes(candidateList) : []);
          const suggestions = [];
          for (const cand of candidateList) {
            if (!existing.has(cand)) {
              suggestions.push(cand);
              if (suggestions.length >= 3) break;
            }
          }
          return res.status(409).json({ error: 'Alias is already taken.', suggestions });
        }

        const shortUrl = `${getBaseUrl(req)}/${code}`;

        // Task P5.2: CLI ergonomics (plain text response with trailing newline)
        if (req.isCli) {
          return res
            .status(200)
            .set('Content-Type', 'text/plain; charset=utf-8')
            .send(`${shortUrl}\n`);
        }

        return res.status(200).json({ code, shortUrl, longUrl: targetUrl, expiresAt });
      } catch (err) {
        console.error('Error shortening URL:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
    }
  );

  // Preview & HTML Stats view (Task P7.7)
  router.get(['/preview/:code', '/stats/:code'], ugcSecurityHeaders, async (req, res, next) => {
    if (req.accepts('html') && !req.path.startsWith('/api/')) {
      try {
        const code = req.params.code;
        const link = store.getLink ? store.getLink(code) : null;
        if (!link) {
          return res.status(404).send('Short link not found or expired.');
        }
        const buffered = clickBuffer.getBufferedCount ? clickBuffer.getBufferedCount(code) : 0;
        const totalClicks = (link.clicks || 0) + buffered;
        const targetUrl = link.target || link.target_url || '';
        const createdStr = link.createdAt ? (typeof link.createdAt === 'number' ? new Date(link.createdAt).toISOString().split('T')[0] : String(link.createdAt).split('T')[0]) : 'N/A';

        const html = renderTemplate('preview.html', {
          code: htmlEscape(code),
          targetUrl: htmlEscape(targetUrl),
          clicks: String(totalClicks),
          status: htmlEscape(link.status || 'clean'),
          createdAt: createdStr,
          nonce: htmlEscape((res.locals && res.locals.cspNonce) || '')
        });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);
      } catch (err) {
        console.error('Error rendering link preview:', err);
        return res.status(500).send('Internal server error');
      }
    }
    next();
  });

  // Stats API
  router.get('/api/stats/:code', async (req, res) => {
    try {
      const code = req.params.code;
      const link = store.getLink ? store.getLink(code) : null;

      if (!link) {
        return res.status(404).json({ error: 'Short URL not found or expired.' });
      }

      const buffered = clickBuffer.getBufferedCount ? clickBuffer.getBufferedCount(code) : 0;
      const totalClicks = (link.clicks || 0) + buffered;

      return res.status(200).json({
        code: link.code,
        longUrl: link.target,
        clicks: totalClicks,
        createdAt: typeof link.createdAt === 'number' ? new Date(link.createdAt).toISOString() : link.createdAt,
        expiresAt: link.expiresAt ? (typeof link.expiresAt === 'number' ? new Date(link.expiresAt).toISOString() : link.expiresAt) : null
      });
    } catch (err) {
      console.error('Error fetching stats:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 3. GET /:code Redirect resolver (Task P5.4, P5.5, PERF-001: ZERO external calls)
  router.get('/:code', redirectLimiter, ugcSecurityHeaders, async (req, res) => {
    try {
      const code = req.params.code;
      const safeCode = htmlEscape(code);

      if (RESERVED_BLOCKLIST.has(code.toLowerCase())) {
        return res.status(404).send('Not Found');
      }

      const link = store.getLink ? store.getLink(code) : null;

      if (!link) {
        // Distinguish between expired (410), quarantined (451), and not found (404)
        const rawLink = store.getLinkRaw ? store.getLinkRaw(code) : null;
        if (rawLink) {
          if (rawLink.status === 'quarantined') {
            return res.status(451).send(
              renderTemplate('404.html', {
                title: '451 — Link Unavailable For Legal Reasons',
                command: `get /${safeCode}`,
                message: 'This link has been quarantined in response to abuse reports.',
                returnUrl: 'https://tinyurl.pokedb.site/',
                returnLabel: '← Return to Shortener'
              })
            );
          }
          if (rawLink.expiresAt && rawLink.expiresAt <= clock.now()) {
            return res.status(410).send(
              renderTemplate('404.html', {
                title: '410 — Link Expired',
                command: `get /${safeCode}`,
                message: 'This short link has expired.',
                returnUrl: 'https://tinyurl.pokedb.site/',
                returnLabel: '← Return to Shortener'
              })
            );
          }
        }

        return res.status(404).send(
          renderTemplate('404.html', {
            title: '404 — Short Link Not Found',
            command: `get /${safeCode}`,
            message: 'Error 404: Link not found or expired.',
            returnUrl: 'https://tinyurl.pokedb.site/',
            returnLabel: '← Return to Shortener'
          })
        );
      }

      // Record telemetry click asynchronously
      clickBuffer.recordClick(code);

      const isDirectQuery = req.query.direct === '1' || req.query.direct === 'true';
      const isDirectMode = config.redirectMode === 'direct';
      const acceptsHtml = (req.headers.accept || '').includes('text/html');
      const isCliOrBot = req.isCli || !acceptsHtml;

      // In direct mode (or CLI / bots / direct query), instant 302
      if (isDirectQuery || isCliOrBot || isDirectMode) {
        res.setHeader('Location', link.target);
        return res.status(302).end();
      }

      // Interstitial mode (Task P5.5, D2) for browsers: show destination, Continue button, and Report link
      const safeUrl = htmlEscape(link.target);
      let isSuspicious = link.status === 'suspicious' || link.status === 'quarantined';
      let threatFlags = isSuspicious ? ['Suspected malicious content'] : [];

      if (!isSuspicious && (process.env.NODE_ENV === 'test' || link.status === 'unscanned')) {
        const risk = await analyzeUrlRisk(link.target, config);
        if (risk.isSuspicious || risk.flags.length > 0) {
          isSuspicious = true;
          threatFlags = risk.flags;
        }
      }

      const auditStatusHtml = isSuspicious
        ? '<span style="color:var(--danger); font-weight:600;">FLAGGED BY GOOGLE SAFE BROWSING</span>'
        : '<span style="color:var(--accent); font-weight:600;">Verified Safe (Google Safe Browsing)</span>';

      const primaryButtonLabel = isSuspicious
        ? 'proceed --caution →'
        : 'continue --destination →';

      const currentClicks = (link.clicks || 0) + clickBuffer.getBufferedCount(code);

      return res.status(200).send(
        renderTemplate('redirect.html', {
          safeUrl,
          safeCode,
          clickCount: String(currentClicks),
          nonce: res.locals?.cspNonce || '',
          serializedUrl: serializeForInlineScript(link.target),
          isSuspicious: isSuspicious ? 'true' : 'false',
          riskLevel: isSuspicious ? 'high' : 'low',
          securityAuditStatus: auditStatusHtml,
          primaryButtonLabel,
          serializedFlags: serializeForInlineScript(threatFlags),
          flagListHtml: threatFlags
            .map(f => `<div>Threat Flag: <span style="color:var(--danger);">${htmlEscape(f)}</span></div>`)
            .join('')
        })
      );
    } catch (err) {
      console.error('Error redirecting:', err);
      return res.status(500).send('Server Error');
    }
  });

  return router;
}

module.exports = {
  createTinyurlRouter
};
