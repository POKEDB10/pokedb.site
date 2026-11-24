// tests/logger.test.js
// Unit tests for src/logger.js (Task P3.2)
// Verifies structured JSON logging, redaction of sensitive tokens/headers,
// IP anonymization (/24 and /56), and query string stripping on sensitive routes.

const { createLogger, anonymizeIp, sanitizeUrl, createHttpLogger } = require('../src/logger.js');
const { Writable } = require('node:stream');

describe('Structured Logger & Privacy Redaction (Task P3.2 / src/logger.js)', () => {
  let logOutput = [];
  let destination;

  beforeEach(() => {
    logOutput = [];
    destination = new Writable({
      write(chunk, encoding, callback) {
        logOutput.push(chunk.toString());
        callback();
      }
    });
  });

  test('anonymizes IPv4 to /24 prefix', () => {
    expect(anonymizeIp('198.51.100.42')).toBe('198.51.100.0/24');
    expect(anonymizeIp('::ffff:198.51.100.42')).toBe('198.51.100.0/24');
    expect(anonymizeIp('127.0.0.1')).toBe('127.0.0.0/24');
  });

  test('anonymizes IPv6 to /56 prefix', () => {
    expect(anonymizeIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe('2001:db8:85a3::/56');
    expect(anonymizeIp('2606:4700:4700::1111')).toBe('2606:4700:4700::/56');
  });

  test('handles unknown or empty IP gracefully', () => {
    expect(anonymizeIp('')).toBe('unknown');
    expect(anonymizeIp(null)).toBe('unknown');
    expect(anonymizeIp(undefined)).toBe('unknown');
  });

  test('sanitizes query strings for sensitive redirect and file routes (/:code, /d/:id, /v/:id)', () => {
    expect(sanitizeUrl('/d/abc12345?token=secret123&download=1')).toBe('/d/abc12345');
    expect(sanitizeUrl('/v/paste999?key=confidential')).toBe('/v/paste999');
    expect(sanitizeUrl('/xyz789?ref=sensitive_campaign')).toBe('/xyz789');
    // Non-sensitive routes preserve safe query strings
    expect(sanitizeUrl('/tools/qr/?text=hello')).toBe('/tools/qr/?text=hello');
  });

  test('strictly redacts authorization header and tokens from log output', () => {
    const logger = createLogger({ destination });

    const SECRET_TOKEN = 'secret-token-xyz-123456';
    const BEARER_AUTH = 'Bearer my-top-secret-bearer-token';
    const ADMIN_PASS = 'super-secret-admin-password';

    logger.info({
      token: SECRET_TOKEN,
      deleteToken: SECRET_TOKEN,
      password: ADMIN_PASS,
      req: {
        headers: {
          authorization: BEARER_AUTH,
          cookie: 'session=abc'
        }
      },
      message: 'Processing sensitive request'
    });

    const combinedOutput = logOutput.join('\n');

    // Assert that the raw sensitive values NEVER appear anywhere in the output
    expect(combinedOutput).not.toContain(SECRET_TOKEN);
    expect(combinedOutput).not.toContain(BEARER_AUTH);
    expect(combinedOutput).not.toContain(ADMIN_PASS);

    // Assert JSON structured output with redacted placeholder
    const parsed = JSON.parse(combinedOutput);
    expect(parsed.token).toBe('[REDACTED]');
    expect(parsed.deleteToken).toBe('[REDACTED]');
    expect(parsed.password).toBe('[REDACTED]');
    expect(parsed.req.headers.authorization).toBe('[REDACTED]');
  });

  test('httpLogger middleware assigns request id and redacts sensitive query and IP', (done) => {
    const logger = createLogger({ destination });
    const httpLogger = createHttpLogger({ logger });

    const req = {
      method: 'GET',
      url: '/d/xyz12345?token=sensitive_token_to_hide',
      originalUrl: '/d/xyz12345?token=sensitive_token_to_hide',
      path: '/d/xyz12345',
      headers: {
        authorization: 'Bearer sensitive-token-999',
        'x-forwarded-for': '203.0.113.195'
      },
      ip: '203.0.113.195'
    };

    const listeners = {};
    const res = {
      statusCode: 200,
      setHeader: jest.fn(),
      on: (event, handler) => {
        listeners[event] = handler;
      }
    };

    httpLogger(req, res, () => {
      expect(req.id).toBeDefined();
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.id);

      // Trigger 'finish' event
      listeners['finish']();

      const combinedOutput = logOutput.join('\n');
      expect(combinedOutput).not.toContain('sensitive_token_to_hide');
      expect(combinedOutput).not.toContain('sensitive-token-999');
      expect(combinedOutput).not.toContain('203.0.113.195'); // Full IP not logged
      expect(combinedOutput).toContain('203.0.113.0/24'); // Masked IP logged

      done();
    });
  });
});
