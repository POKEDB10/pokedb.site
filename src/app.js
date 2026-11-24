// src/app.js
// Express Application Factory (Task P3.5, ARCH-001, DX-001).
// Exports createApp({ store, objectStore, config, clock }) without listening.

const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const {
  createCorsMiddleware,
  cspNonceMiddleware,
  createHelmetMiddleware,
  createConnectionDrainTracker
} = require('./middleware/securityHeaders');
const { createOriginLock, resolveHost, tokensMatch } = require('./middleware/proxyTrust');
const { queryTokenRejector } = require('./middleware/auth');
const { robotsPolicy, handleRobotsTxt } = require('./middleware/robotsPolicy');
const { createRateLimiters } = require('./middleware/rateLimit');
const { notFoundHandler, errorHandler } = require('./middleware/errors');
const { createHttpLogger, anonymizeIp } = require('./logger');
const { registry, generateSitemapXml } = require('./registry');
const { ClickBufferManager } = require('./utils/clickBuffer');
const { cliDetector } = require('./middleware/cliDetector');
const { createTurnstileMiddleware } = require('./middleware/turnstile');
const { getAssetHasher } = require('./utils/assetHasher');

// Tool router factories
const { createHealthRouter } = require('./tools/health/router');
const { createQrRouter } = require('./tools/qr/router');
const { createPasteRouter } = require('./tools/paste/router');
const { createTinyurlRouter } = require('./tools/tinyurl/router');
const LAN_ROUTER_PATH = path.join(__dirname, 'tools', 'lan', 'router.js');
const { createLanRouter } = fs.existsSync(LAN_ROUTER_PATH)
  ? require('./tools/lan/router')
  : { createLanRouter: null };
const { createDropRouter } = require('./tools/drop/router');

const ROOT_DIR = path.resolve(__dirname, '..');

function createApp(options = {}) {
  const config = options.config || require('./config').getConfig();
  const store = options.store;
  const { createObjectStore } = require('./storage/r2');
  const objectStore = options.objectStore || createObjectStore(config);
  const clock = options.clock || Date;

  const app = express();

  // 1. Trust proxy
  app.set('trust proxy', config.trustProxy);

  // 2. Connection drain tracking
  const drainTracker = createConnectionDrainTracker();
  app.use(drainTracker.middleware);

  // 3. Security headers, CSP nonces, CORS
  const corsMiddleware = createCorsMiddleware();
  const helmetMiddleware = createHelmetMiddleware();
  app.use((req, res, next) => {
    // Short-circuit heavy CSP on direct 302 redirect hot path (?direct=1)
    if (req.method === 'GET' && (req.query?.direct === '1' || req.url?.includes('direct=1'))) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      return next();
    }
    corsMiddleware(req, res, (err) => {
      if (err) return next(err);
      cspNonceMiddleware(req, res, () => {
        helmetMiddleware(req, res, next);
      });
    });
  });

  // 4. Request logging
  app.use(createHttpLogger());

  // 5. Body parsers (streamlined: skip for GET and HEAD methods)
  const jsonParser = express.json({ limit: '2mb' });
  const urlencodedParser = express.urlencoded({ extended: true, limit: '2mb' });
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return next();
    }
    jsonParser(req, res, (err) => {
      if (err) return next(err);
      urlencodedParser(req, res, next);
    });
  });
  app.use(cliDetector);

  // 6. Security hygiene & gates
  app.use(queryTokenRejector);
  app.use(createOriginLock(config.originVerifySecret));
  app.use(robotsPolicy);

  // 7. Sitemap, Robots, and Legal Pages (Task P5.8, P5.10, P6.1)
  const staticHtmlHeaders = (res) => {
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
  };
  app.get('/favicon.ico', (req, res) => res.status(204).end());
  app.get('/robots.txt', handleRobotsTxt);
  app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml').send(generateSitemapXml(config.baseUrl));
  });
  app.get('/terms', (req, res) => {
    staticHtmlHeaders(res);
    res.sendFile(path.join(ROOT_DIR, 'public', 'terms.html'));
  });
  app.get('/privacy', (req, res) => {
    staticHtmlHeaders(res);
    res.sendFile(path.join(ROOT_DIR, 'public', 'privacy.html'));
  });
  app.get('/abuse', (req, res) => {
    staticHtmlHeaders(res);
    res.sendFile(path.join(ROOT_DIR, 'public', 'abuse.html'));
  });
  app.get('/projects/:slug', (req, res, next) => {
    const slug = (req.params.slug || '').replace(/[^a-z0-9-]/gi, '').toLowerCase();
    const SKELETON_SLUGS = ['aegis', 'beacon', 'kds', 'manifold', 'prism'];
    if (SKELETON_SLUGS.includes(slug)) {
      if (config.env === 'production' || config.isProduction) {
        return res.status(404).send('Not Found');
      }
      res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    }
    const filePath = path.join(ROOT_DIR, 'public', 'projects', `${slug}.html`);
    if (fs.existsSync(filePath)) {
      staticHtmlHeaders(res);
      return res.sendFile(filePath);
    }
    next();
  });
  app.get('/changelog', (req, res) => {
    staticHtmlHeaders(res);
    res.sendFile(path.join(ROOT_DIR, 'public', 'changelog.html'));
  });
  app.get('/docs', (req, res) => {
    staticHtmlHeaders(res);
    res.sendFile(path.join(ROOT_DIR, 'public', 'docs.html'));
  });
  app.get('/status', (req, res) => {
    staticHtmlHeaders(res);
    res.sendFile(path.join(ROOT_DIR, 'public', 'status.html'));
  });
  app.use('/.well-known', express.static(path.join(ROOT_DIR, 'public', '.well-known')));

  // 8. Immutable Hashed Assets, Fonts, & Shared Themes (Task P6.1, P6.2, FE-001)
  const assetHasher = getAssetHasher();
  const assetMiddleware = assetHasher.createMiddleware();
  app.use((req, res, next) => {
    if (req.method === 'GET' && (req.path.startsWith('/shared/') || req.path.startsWith('/fonts/') || req.path.includes('.'))) {
      return assetMiddleware(req, res, next);
    }
    next();
  });

  app.use('/fonts', express.static(path.join(ROOT_DIR, 'public', 'fonts'), {
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }));

  const sharedStatic = express.static(path.join(ROOT_DIR, 'tools', 'shared'), {
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
    }
  });
  app.use('/shared', sharedStatic);
  app.use('/tools/shared', sharedStatic);

  // 9. Rate limiters & Click buffer
  const limiters = createRateLimiters({
    benchBypassLimiter: config.benchBypassLimiter,
    storeRegistry: options.storeRegistry
  });
  const clickBuffer = new ClickBufferManager(store, {
    maxEntries: config.clickBufferMaxSize
  });
  const turnstile = createTurnstileMiddleware({ config });

  // Public client configuration (strictly non-secret runtime values only)
  app.get('/api/config/public', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
    return res.status(200).json({
      turnstileSiteKey: config.turnstileSiteKey || ''
    });
  });

  // Abuse reporting API (Task P5.6)
  app.post('/api/report', limiters.reportLimiter || ((req, res, next) => next()), turnstile, async (req, res) => {
    try {
      const { id, kind, reason, details } = req.body || {};
      if (!id || !kind) {
        return res.status(400).json({ error: 'Both id and kind (link, paste, drop) are required.' });
      }

      const validKinds = ['link', 'paste', 'drop'];
      if (!validKinds.includes(kind.toLowerCase())) {
        return res.status(400).json({ error: `Invalid kind "${kind}". Must be link, paste, or drop.` });
      }

      if (!store || !store.addReport) {
        return res.status(200).json({ success: true, message: 'Report received.' });
      }

      const subnet = anonymizeIp(req.ip);
      const reportRes = store.addReport({
        kind: kind.toLowerCase(),
        targetId: String(id).trim(),
        subnet,
        reason: (reason || 'abuse').substring(0, 100)
      });

      if (reportRes.quarantined && config.abuseWebhookUrl) {
        // Dispatch asynchronous notification to Discord alert webhook
        fetch(config.abuseWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: `🚨 **[ABUSE QUARANTINE]** ${kind}:${id} has been automatically quarantined after receiving reports from 3 distinct subnets.`
          })
        }).catch((err) => {
          console.warn('[ABUSE WEBHOOK] Failed to dispatch Discord alert:', err.message);
        });
      }

      return res.status(200).json({
        success: true,
        quarantined: Boolean(reportRes.quarantined),
        distinctSubnets: reportRes.distinctSubnets
      });
    } catch (err) {
      console.error('Error recording abuse report:', err);
      return res.status(500).json({ error: 'Internal error processing abuse report.' });
    }
  });

  // Admin takedown API (Task P5.6)
  app.delete('/api/admin/:kind/:id', limiters.adminLimiter || ((req, res, next) => next()), async (req, res) => {
    const adminToken = process.env.ADMIN_TOKEN || config.adminToken;
    const auth = (req.get('authorization') || '').trim();
    let provided = '';
    if (auth.toLowerCase().startsWith('bearer ')) {
      provided = auth.slice(7).trim();
    } else {
      provided = req.get('x-admin-token') || '';
    }

    if (!adminToken) {
      return res.status(503).json({ error: 'Admin unavailable: ADMIN_TOKEN not configured.' });
    }

    if (!provided || !tokensMatch(provided, adminToken)) {
      return res.status(403).json({ error: 'Unauthorized: valid admin token required.' });
    }

    const { kind, id } = req.params;
    if (!['link', 'paste', 'drop'].includes(kind.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid kind. Must be link, paste, or drop.' });
    }

    try {
      if (kind.toLowerCase() === 'drop' && objectStore) {
        const drop = store.getDrop ? store.getDrop(id) : null;
        if (drop && drop.objectKey) {
          await objectStore.deleteObject(drop.objectKey).catch(() => {});
        }
      }

      if (store && store.takedown) {
        store.takedown({
          kind: kind.toLowerCase(),
          targetId: id,
          reason: req.body?.reason || 'admin_takedown'
        });
      }

      return res.status(200).json({ success: true, deleted: true, kind, id });
    } catch (err) {
      console.error('Admin takedown error:', err);
      return res.status(500).json({ error: 'Takedown failed.' });
    }
  });

  // Diagnostics: IP resolution and proxy diagnostics (SEC-001, H2, H3)
  app.get('/__diag/ip', limiters.adminLimiter || ((req, res, next) => next()), (req, res) => {
    const adminToken = process.env.ADMIN_TOKEN || config.adminToken;
    const auth = (req.get('authorization') || '').trim();
    let provided = '';
    if (auth.toLowerCase().startsWith('bearer ')) {
      provided = auth.slice(7).trim();
    } else {
      provided = req.get('x-admin-token') || '';
    }

    if (!adminToken) {
      return res.status(503).json({ error: 'Diagnostics unavailable: ADMIN_TOKEN not configured.' });
    }

    if (!provided || !tokensMatch(provided, adminToken)) {
      return res.status(403).json({ error: 'Unauthorized: valid admin token required.' });
    }

    return res.status(200).json({
      remoteAddress: req.socket?.remoteAddress || null,
      rawXForwardedFor: req.get('x-forwarded-for') || null,
      cfConnectingIp: req.get('cf-connecting-ip') || null,
      ip: req.ip || null,
      ips: req.ips || []
    });
  });

  // 10. Instantiate Tool Routers
  const healthRouter = createHealthRouter({ config, store, objectStore, sweeper: options.sweeper, probe: options.probe, clock });
  const qrRouter = createQrRouter({ limiters });
  const pasteRouter = createPasteRouter({ store, limiters, config, clock });
  const dropRouter = createDropRouter({ store, objectStore, limiters, config, clock });
  const tinyurlRouter = createTinyurlRouter({ store, clickBuffer, limiters, config, clock });
  const lanRouter = options.lanRouter || (createLanRouter ? createLanRouter({ limiters, config, clock }) : null);

  // 11. Subpath mounts for localhost / unified navigation (/tools/:id/)
  const toolRouters = {
    drop: dropRouter,
    paste: pasteRouter,
    qr: qrRouter,
    health: healthRouter,
    tinyurl: tinyurlRouter
  };

  for (const tool of registry) {
    const dir = tool.publicDir || tool.indexRoot;
    if (dir && fs.existsSync(dir)) {
      app.use(`/tools/${tool.id}`, express.static(dir, { index: ['index.html'] }));
    }
    const router = toolRouters[tool.id];
    if (router) {
      app.use(`/tools/${tool.id}`, router);
    }
  }

  // Tools Hub UI at /tools/
  app.use('/tools', express.static(path.join(ROOT_DIR, 'tools', 'public'), { index: ['index.html'] }));

  // 12. Direct API mounts (so /api/shorten, /api/paste/*, /api/drop/*, /api/lan/*, /api/qr, /health work everywhere)
  app.use(healthRouter);
  app.use(qrRouter);
  app.use(pasteRouter);
  app.use(dropRouter);
  if (lanRouter) {
    app.use(lanRouter);
  }

  // 13. Subdomain host routing middleware
  app.use((req, res, next) => {
    const host = resolveHost(req) || '';

    for (const tool of registry) {
      if (host.startsWith(`${tool.subdomain}.`)) {
        const dir = tool.publicDir || tool.indexRoot;
        const router = toolRouters[tool.id];
        if (dir && fs.existsSync(dir)) {
          return express.static(dir, { index: ['index.html'] })(req, res, () =>
            router ? router(req, res, next) : next()
          );
        }
        if (router) return router(req, res, next);
      }
    }

    if (host.startsWith('tools.')) {
      return express.static(path.join(ROOT_DIR, 'tools', 'public'), { index: ['index.html'] })(req, res, next);
    }

    next();
  });

  // 14. Main landing page & portfolio
  app.use(express.static(path.join(ROOT_DIR, 'public'), {
    index: ['index.html'],
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
      } else if (filePath.endsWith('.woff2') || filePath.endsWith('.svg')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }));

  // 15. TinyURL short code catch-all (e.g. /:code redirect)
  app.use(tinyurlRouter);

  // 16. Error handlers
  app.use(notFoundHandler);
  app.use(errorHandler);

  return {
    app,
    clickBuffer,
    drainTracker,
    limiters,
    lanRouter
  };
}

module.exports = {
  createApp
};
