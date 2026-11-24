// tests/coverage-p37.test.js
// Targeted unit tests to achieve >= 80% line coverage across src/ (Task P3.7).

const path = require('node:path');
const fs = require('node:fs');
const request = require('supertest');
const { Sweeper } = require('../src/utils/sweeper');
const { Semaphore, generateDropId8, generateDropId9, deriveKey } = require('../src/utils/crypto');
const {
  isPrivateIpv4,
  ipv6Groups,
  isPrivateIpAddress,
  isPrivateHost,
  isValidRemoteUrl,
  inspectUrl,
  analyzeUrlRisk,
  parseExpiresInDays,
  isValidTargetUrl,
  logScannerTelemetry
} = require('../src/utils/urlSecurity');
const {
  normalizeHost,
  resolveHost,
  isLoopbackAddress,
  tokensMatch,
  createOriginLock
} = require('../src/middleware/proxyTrust');
const { anonymizeIp, isSensitivePath, sanitizeUrl } = require('../src/logger');
const { getNavUrl, unregisterTool, getTool } = require('../src/registry');
const { createRateLimiters } = require('../src/middleware/rateLimit');
const { createApp } = require('../src/app');

describe('Task P3.7 Coverage Expansion Suite', () => {
  describe('1. Sweeper Utility (src/utils/sweeper.js)', () => {
    test('Sweeper initializes, triggers single sweep, tracks counts, and stops cleanly', () => {
      const mockStorage = {
        purgeExpiredLinks: () => 2,
        purgeExpiredPastes: () => 2,
        purgeExpiredDrops: () => 1
      };

      const sweeper = new Sweeper(mockStorage, { intervalMs: 50, batchSize: 100 });
      expect(sweeper.getTotalSwept()).toBe(0);

      sweeper.start();
      expect(sweeper.timer).not.toBeNull();

      const res = sweeper.sweepOnce();
      expect(res.total).toBe(5);
      expect(sweeper.getTotalSwept()).toBe(5);

      sweeper.stop();
      expect(sweeper.timer).toBeNull();

      // Calling stop when already stopped is safe
      sweeper.stop();
      expect(sweeper.timer).toBeNull();
    });

    test('Sweeper handles errors gracefully during purgeExpired', () => {
      const mockStorage = {
        purgeExpiredLinks: () => {
          throw new Error('Database locked');
        }
      };
      const sweeper = new Sweeper(mockStorage);
      const res = sweeper.sweepOnce();
      expect(res.total).toBe(0);
      expect(res.error).toBe('Database locked');
    });

    test('Sweeper without storage returns zero total', () => {
      const sweeper = new Sweeper(null);
      expect(sweeper.sweepOnce().total).toBe(0);
    });
  });

  describe('2. Crypto Utility (src/utils/crypto.js)', () => {
    test('Semaphore limits concurrency and drains queued workers FIFO', async () => {
      const sem = new Semaphore(2);
      let active = 0;
      let maxSeen = 0;

      const task = async () => {
        await sem.acquire();
        active++;
        maxSeen = Math.max(maxSeen, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        sem.release();
      };

      await Promise.all([task(), task(), task(), task()]);
      expect(maxSeen).toBeLessThanOrEqual(2);
      expect(active).toBe(0);
    });

    test('Semaphore invariant: current is strictly >= 0 and <= max during concurrent execution', async () => {
      const maxSlots = 3;
      const sem = new Semaphore(maxSlots, 50);
      let minCurrent = Infinity;
      let maxCurrent = -Infinity;

      const workers = Array.from({ length: 25 }, async (_, i) => {
        await sem.acquire();
        minCurrent = Math.min(minCurrent, sem.current);
        maxCurrent = Math.max(maxCurrent, sem.current);
        // Small variable jitter
        await new Promise((r) => setTimeout(r, (i % 5) * 2));
        minCurrent = Math.min(minCurrent, sem.current);
        maxCurrent = Math.max(maxCurrent, sem.current);
        sem.release();
      });

      await Promise.all(workers);
      expect(minCurrent).toBeGreaterThanOrEqual(1);
      expect(maxCurrent).toBeLessThanOrEqual(maxSlots);
      expect(sem.current).toBe(0);
      expect(sem.queue.length).toBe(0);
    });

    test('Semaphore guarantees strict FIFO order across queued acquisitions', async () => {
      const sem = new Semaphore(1, 10);
      const executionOrder = [];

      // Acquire the single slot first
      await sem.acquire();

      // Queue 5 workers in sequence
      const workers = [0, 1, 2, 3, 4].map((id) =>
        sem.run(async () => {
          executionOrder.push(id);
        })
      );

      // Release initial slot to let queued workers process
      sem.release();
      await Promise.all(workers);

      expect(executionOrder).toEqual([0, 1, 2, 3, 4]);
    });

    test('Semaphore does not throw false 503 under high churn within capacity', async () => {
      const sem = new Semaphore(2, 20);
      let completed = 0;

      // Launch 22 workers (2 active + 20 queued = exactly at max queue capacity)
      const tasks = Array.from({ length: 22 }, () =>
        sem.run(async () => {
          await new Promise((r) => setTimeout(r, 5));
          completed++;
        })
      );

      await Promise.all(tasks);
      expect(completed).toBe(22);
      expect(sem.current).toBe(0);
      expect(sem.queue.length).toBe(0);
    });

    test('Semaphore throws 503 with retryAfter when queue exceeds maxQueue', async () => {
      const sem = new Semaphore(1, 2);
      await sem.acquire(); // slot filled (1)

      const p1 = sem.run(async () => {}); // queue 1
      const p2 = sem.run(async () => {}); // queue 2

      // 3rd attempt exceeds maxQueue of 2
      await expect(sem.run(async () => {})).rejects.toMatchObject({
        statusCode: 503,
        retryAfter: 2,
        message: expect.stringMatching(/Crypto service busy/i)
      });

      sem.release();
      await Promise.all([p1, p2]);
    });

    test('generateDropId8 and generateDropId9 generate Crockford Base32 strings', () => {
      const id8 = generateDropId8();
      const id9 = generateDropId9();
      expect(id8).toHaveLength(8);
      expect(id9).toHaveLength(9);
      expect(id8).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/i);
      expect(id9).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{9}$/i);
    });
  });

  describe('3. URL Security & SSRF Engine (src/utils/urlSecurity.js)', () => {
    test('isPrivateIpv4 identifies all private and reserved IPv4 ranges', () => {
      expect(isPrivateIpv4('0.0.0.0')).toBe(true);
      expect(isPrivateIpv4('10.0.0.1')).toBe(true);
      expect(isPrivateIpv4('127.0.0.1')).toBe(true);
      expect(isPrivateIpv4('100.64.0.1')).toBe(true);
      expect(isPrivateIpv4('169.254.1.1')).toBe(true);
      expect(isPrivateIpv4('172.16.0.1')).toBe(true);
      expect(isPrivateIpv4('172.31.255.255')).toBe(true);
      expect(isPrivateIpv4('192.168.1.1')).toBe(true);
      expect(isPrivateIpv4('198.18.0.1')).toBe(true);
      expect(isPrivateIpv4('224.0.0.1')).toBe(true);
      expect(isPrivateIpv4('8.8.8.8')).toBe(false);
      expect(isPrivateIpv4('1.1.1.1')).toBe(false);
    });

    test('isPrivateIpAddress identifies IPv6 loopback, private, and mapped IPv4', () => {
      expect(isPrivateIpAddress('::1')).toBe(true);
      expect(isPrivateIpAddress('::')).toBe(true);
      expect(isPrivateIpAddress('fc00::1')).toBe(true);
      expect(isPrivateIpAddress('fe80::1')).toBe(true);
      expect(isPrivateIpAddress('ff02::1')).toBe(true);
      expect(isPrivateIpAddress('::ffff:192.168.1.1')).toBe(true);
      expect(isPrivateIpAddress('::ffff:8.8.8.8')).toBe(false);
      expect(isPrivateIpAddress('invalid-ip')).toBe(true);
    });

    test('isPrivateHost identifies localhost and loopback domains', async () => {
      expect(await isPrivateHost('localhost')).toBe(true);
      expect(await isPrivateHost('127.0.0.1')).toBe(true);
      expect(await isPrivateHost('')).toBe(true);
    });

    test('isValidRemoteUrl rejects non-http/https protocols', async () => {
      expect(await isValidRemoteUrl('ftp://example.com/file')).toBe(false);
      expect(await isValidRemoteUrl('file:///etc/passwd')).toBe(false);
      expect(await isValidRemoteUrl('not-a-valid-url')).toBe(false);
    });

    test('inspectUrl rejects invalid url and private destinations', async () => {
      await expect(inspectUrl('invalid-url')).rejects.toThrow();
      await expect(inspectUrl('http://127.0.0.1:80/secret')).rejects.toThrow(/restricted/i);
      await expect(inspectUrl('ftp://example.com/')).rejects.toThrow(/Only HTTP/i);
    });

    test('parseExpiresInDays edge cases', () => {
      expect(parseExpiresInDays('')).toBeNull();
      expect(parseExpiresInDays('not-a-number')).toBeNull();
      expect(parseExpiresInDays(-1)).toBeNull();
      expect(parseExpiresInDays(400)).toBeNull();
      expect(parseExpiresInDays(null, 15)).toBe(15);
      expect(parseExpiresInDays(undefined, 20)).toBe(20);
      expect(parseExpiresInDays(7)).toBe(7);
    });

    test('isValidTargetUrl edge cases', () => {
      expect(isValidTargetUrl('')).toBe(false);
      expect(isValidTargetUrl('javascript:alert(1)')).toBe(false);
      expect(isValidTargetUrl('data:text/html,test')).toBe(false);
      expect(isValidTargetUrl('https://pokedb.site/subpath')).toBe(false);
      expect(isValidTargetUrl('https://tools.pokedb.site/')).toBe(false);
      expect(isValidTargetUrl('https://samehost.com/', 'samehost.com')).toBe(false);
      expect(isValidTargetUrl('https://google.com')).toBe(true);
    });

    test('logScannerTelemetry logs warning with IP', () => {
      const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      logScannerTelemetry({ ip: '1.2.3.4', method: 'GET', path: '/test' }, 'Testing telemetry');
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    test('analyzeUrlRisk evaluates Google Safe Browsing and attribution (Task P5.4)', async () => {
      const origFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation((url) => {
        const u = String(url);
        if (u.includes('safebrowsing.googleapis.com')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              matches: [{ threatType: 'MALWARE' }]
            })
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      try {
        const res = await analyzeUrlRisk('https://malicious-test.example.com', {
          googleSafeBrowsingKey: 'test-gsb-key'
        });
        expect(res.isSuspicious).toBe(true);
        expect(res.riskLevel).toBe('high');
        expect(res.flags.length).toBe(1);
        expect(res.flags[0]).toContain('Advisory provided by Google');
      } finally {
        global.fetch = origFetch;
      }
    });
  });

  describe('4. Proxy Trust & Masking (src/middleware/proxyTrust.js & src/logger.js)', () => {
    test('anonymizeIp handles IPv4 and IPv6 masks', () => {
      expect(anonymizeIp('::ffff:192.168.1.50')).toBe('192.168.1.0/24');
      expect(anonymizeIp('192.168.1.50')).toBe('192.168.1.0/24');
      expect(anonymizeIp('')).toBe('unknown');
      expect(anonymizeIp('2001:db8:85a3:0000:0000:8a2e:370:7334')).toContain('/56');
    });

    test('isSensitivePath and sanitizeUrl protect query tokens on sensitive routes', () => {
      expect(isSensitivePath('/d/some-file-code')).toBe(true);
      expect(isSensitivePath('/v/some-paste-code')).toBe(true);
      expect(isSensitivePath('/api/shorten')).toBe(false);

      expect(sanitizeUrl('/d/abc12345?token=secret123')).toBe('/d/abc12345');
      expect(sanitizeUrl('/api/qr?text=hello')).toBe('/api/qr?text=hello');
    });

    test('isLoopbackAddress verifies loopback IPv4 and IPv6', () => {
      expect(isLoopbackAddress('127.0.0.1')).toBe(true);
      expect(isLoopbackAddress('::1')).toBe(true);
      expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
      expect(isLoopbackAddress('10.0.0.1')).toBe(false);
    });
  });

  describe('5. Registry Navigation & Sitemap (src/registry.js)', () => {
    test('getNavUrl returns host-aware URLs for local and production', () => {
      expect(getNavUrl('main', true)).toBe('https://pokedb.site/');
      expect(getNavUrl('tools', true)).toBe('https://tools.pokedb.site/');
      expect(getNavUrl('drop', true)).toBe('https://drop.pokedb.site/');

      expect(getNavUrl('main', false)).toBe('/');
      expect(getNavUrl('tools', false)).toBe('/tools/');
      expect(getNavUrl('drop', false)).toBe('/tools/drop/');
    });

    test('getTool and unregisterTool return undefined/false for non-existent tools', () => {
      expect(getTool('non-existent-tool-xyz')).toBeUndefined();
      expect(unregisterTool('non-existent-tool-xyz')).toBe(false);
    });
  });

  describe('6. Rate Limit Options (src/middleware/rateLimit.js)', () => {
    test('createRateLimiters produces limiters with bench bypass', () => {
      const limiters = createRateLimiters({ benchBypassLimiter: true });
      expect(limiters.shortenLimiter).toBeDefined();
      expect(limiters.pasteCreateLimiter).toBeDefined();
      expect(limiters.uploadLimiter).toBeDefined();
    });
  });

  describe('7. Drop Router Multipart & Status Validation (src/tools/drop/router.js)', () => {
    let app;
    const originalRootzKey = process.env.ROOTZ_API_KEY;

    beforeAll(() => {
      process.env.ROOTZ_API_KEY = 'test-key-for-coverage';
      ({ app } = createApp({ config: { isTest: true } }));
    });

    afterAll(() => {
      if (originalRootzKey !== undefined) {
        process.env.ROOTZ_API_KEY = originalRootzKey;
      } else {
        delete process.env.ROOTZ_API_KEY;
      }
    });

    test('POST /api/drop/multipart/init returns 400 when fileName or fileSize is missing', async () => {
      const res = await request(app).post('/api/drop/multipart/init').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/required/i);
    });

    test('POST /api/drop/multipart/batch-urls returns 400 when required fields missing', async () => {
      const res = await request(app).post('/api/drop/multipart/batch-urls').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/required/i);
    });

    test('POST /api/drop/multipart/complete returns 400 when required fields missing', async () => {
      const res = await request(app).post('/api/drop/multipart/complete').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/required/i);
    });

    test('GET /api/drop/multipart/status returns isComplete false when not found', async () => {
      const res = await request(app).get('/api/drop/multipart/status');
      expect(res.status).toBe(200);
      expect(res.body.isComplete).toBe(false);
    });

    test('GET /api/drop/info returns 400 when file_code is omitted', async () => {
      const res = await request(app).get('/api/drop/info');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/file_code is required/i);
    });

    test('POST /api/drop/create-folder rejects invalid customId characters', async () => {
      const res = await request(app)
        .post('/api/drop/create-folder')
        .send({ customId: 'bad*custom*id!' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid customId format/i);
    });

    test('POST /api/drop/upload rejects invalid customId format', async () => {
      const res = await request(app)
        .post('/api/drop/upload')
        .field('customId', 'bad*upload*id!')
        .attach('file', Buffer.from('test'), 'test.txt');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid customId format/i);
    });
  });

  describe('8. Paste Router Validation Edge Cases (src/tools/paste/router.js)', () => {
    let app;
    let storage;

    beforeAll(() => {
      const { createSqliteStorage } = require('../src/storage/sqlite');
      storage = createSqliteStorage(':memory:');
      ({ app } = createApp({ store: storage, config: { isTest: true } }));
    });

    afterAll(() => {
      if (storage && storage.close) {
        storage.close();
      }
    });

    test('POST /api/paste/create rejects empty content or invalid expiresInDays', async () => {
      const resEmpty = await request(app)
        .post('/api/paste/create')
        .send({ content: '' });
      expect(resEmpty.status).toBe(400);
      expect(resEmpty.body.error).toMatch(/content cannot be empty/i);

      const resExp = await request(app)
        .post('/api/paste/create')
        .send({ content: 'hello', expiresInDays: 999 });
      expect(resExp.status).toBe(400);
      expect(resExp.body.error).toMatch(/expiresInDays must be between/i);
    });

    test('POST /api/paste/view/:code returns 401 when password is required but incorrect/omitted', async () => {
      const createRes = await request(app)
        .post('/api/paste/create')
        .send({ content: 'secret content', password: 'password123' });
      expect(createRes.status).toBe(200);

      const viewRes = await request(app).post(`/api/paste/view/${createRes.body.code}`).send({});
      expect(viewRes.status).toBe(401);
      expect(viewRes.body.error).toMatch(/Incorrect password for protected paste/i);
    });
  });
});

