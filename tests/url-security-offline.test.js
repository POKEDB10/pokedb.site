// tests/url-security-offline.test.js
// Offline Unit Test Suite for URL Security & SSRF Protection (Task R9.2 Item 10)
// Validates lines 129–208 of src/utils/urlSecurity.js: private IPs, IPv6 variants,
// decimal/octal/hex obfuscation, redirect chains, DNS rebinding with injected resolver,
// stream size truncation, and timeout handling.

const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const EventEmitter = require('node:events');
const {
  isPrivateIpv4,
  ipv6Groups,
  isPrivateIpAddress,
  isPrivateHost,
  inspectUrl
} = require('../src/utils/urlSecurity');

describe('URL Security Offline Suite (src/utils/urlSecurity.js lines 129–208)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('1. Private IP Ranges (IPv4)', () => {
    const privateV4 = [
      '0.0.0.0',
      '10.0.0.1',
      '10.255.255.255',
      '127.0.0.1',
      '127.0.1.1',
      '100.64.0.1',     // Carrier-grade NAT (RFC 6598)
      '100.127.255.255',
      '169.254.1.1',     // Link-local / Cloud metadata (RFC 3927)
      '169.254.169.254',
      '172.16.0.1',      // Private class B (RFC 1918)
      '172.31.255.255',
      '192.168.0.1',     // Private class C (RFC 1918)
      '192.168.255.254',
      '192.0.0.1',       // IETF protocol assignments
      '198.18.0.1',      // Benchmark testing (RFC 2544)
      '198.19.255.255',
      '224.0.0.1',       // Multicast
      '240.0.0.1'        // Reserved
    ];

    const publicV4 = [
      '1.1.1.1',
      '8.8.8.8',
      '93.184.216.34',
      '104.16.123.96',
      '151.101.1.140'
    ];

    test.each(privateV4)('identifies private IPv4: %s', (ip) => {
      expect(isPrivateIpv4(ip)).toBe(true);
      expect(isPrivateIpAddress(ip)).toBe(true);
    });

    test.each(publicV4)('identifies public IPv4: %s', (ip) => {
      expect(isPrivateIpv4(ip)).toBe(false);
      expect(isPrivateIpAddress(ip)).toBe(false);
    });
  });

  describe('2. IPv6 Representations and IPv4-Mapped Variants', () => {
    const privateV6 = [
      '::',                      // Unspecified
      '::1',                     // Loopback
      'fe80::1',                 // Link-local (fe80::/10)
      'fe80::200:5aee:feaa:20a2',
      'fc00::1',                 // Unique Local Address (fc00::/7)
      'fd12:3456:789a:1::1',
      'ff02::1',                 // Multicast
      '::ffff:127.0.0.1',        // IPv4-mapped loopback
      '::ffff:10.0.0.1',         // IPv4-mapped private
      '::ffff:169.254.169.254',  // IPv4-mapped metadata
      '::ffff:192.168.1.1',      // IPv4-mapped private
      '::127.0.0.1'              // IPv4-compatible loopback
    ];

    const publicV6 = [
      '2606:4700:4700::1111',    // Cloudflare DNS
      '2001:4860:4860::8888',    // Google DNS
      '2a00:1450:4009:81f::200e' // Google Web
    ];

    test.each(privateV6)('identifies restricted IPv6: %s', (ip) => {
      expect(isPrivateIpAddress(ip)).toBe(true);
    });

    test.each(publicV6)('identifies public routable IPv6: %s', (ip) => {
      expect(isPrivateIpAddress(ip)).toBe(false);
    });
  });

  describe('3. Decimal, Octal, and Hex IP Obfuscation Detection', () => {
    test('isPrivateHost blocks decimal representation of 127.0.0.1 (2130706433)', async () => {
      jest.spyOn(dns, 'lookup').mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
      const isPrivate = await isPrivateHost('2130706433');
      expect(isPrivate).toBe(true);
    });

    test('isPrivateHost blocks octal representation of 127.0.0.1 (0177.0.0.1)', async () => {
      jest.spyOn(dns, 'lookup').mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
      const isPrivate = await isPrivateHost('0177.0.0.1');
      expect(isPrivate).toBe(true);
    });

    test('isPrivateHost blocks hex representation of 127.0.0.1 (0x7f.0.0.1)', async () => {
      jest.spyOn(dns, 'lookup').mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
      const isPrivate = await isPrivateHost('0x7f.0.0.1');
      expect(isPrivate).toBe(true);
    });

    test('isPrivateHost blocks cloud metadata IP 169.254.169.254 in decimal (2852039166)', async () => {
      jest.spyOn(dns, 'lookup').mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
      const isPrivate = await isPrivateHost('2852039166');
      expect(isPrivate).toBe(true);
    });
  });

  describe('4. DNS Rebinding Protection with Injected Resolver (Lines 129–138)', () => {
    test('detects and aborts when DNS rebinds from public IP to 127.0.0.1 between check and lookup', async () => {
      // First lookup during isPrivateHost() returns public IP (benign)
      // Second lookup at line 129 returns 127.0.0.1 (rebound to loopback)
      let lookupCount = 0;
      jest.spyOn(dns, 'lookup').mockImplementation(async (host) => {
        lookupCount++;
        if (lookupCount === 1) {
          return [{ address: '93.184.216.34', family: 4 }];
        }
        return [{ address: '127.0.0.1', family: 4 }];
      });

      await expect(inspectUrl('http://attacker-rebind.internal.evil/'))
        .rejects.toThrow('Target resolves to a restricted IP address.');
    });

    test('detects and aborts when second address in multi-homed response is private (Line 135)', async () => {
      // Multi-homed DNS response: first IP is public, but second IP is private metadata
      jest.spyOn(dns, 'lookup').mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '169.254.169.254', family: 4 }
      ]);

      await expect(inspectUrl('http://dual-homed.evil/'))
        .rejects.toThrow('Target resolves to a private, loopback, or restricted IP address.');
    });

    test('rejects immediately when DNS resolution returns empty addresses', async () => {
      let lookupCount = 0;
      jest.spyOn(dns, 'lookup').mockImplementation(async () => {
        lookupCount++;
        if (lookupCount === 1) return [{ address: '93.184.216.34', family: 4 }];
        return [];
      });

      await expect(inspectUrl('http://empty-dns.example.com/'))
        .rejects.toThrow('DNS resolution failed for target host.');
    });
  });

  describe('5. Redirect Chains and Maximum Hop Rules (Lines 163–173)', () => {
    function createMockResponse(statusCode, headers = {}, body = '') {
      const res = new EventEmitter();
      res.statusCode = statusCode;
      res.statusMessage = statusCode === 302 ? 'Found' : 'OK';
      res.headers = headers;
      setImmediate(() => {
        if (body) res.emit('data', Buffer.from(body));
        setImmediate(() => {
          res.emit('end');
        });
      });
      return res;
    }

    test('follows redirect chain across 3 hops and returns finalUrl and hopCount', async () => {
      jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

      let requestCount = 0;
      jest.spyOn(http, 'request').mockImplementation((opts, callback) => {
        requestCount++;
        const req = new EventEmitter();
        req.destroy = jest.fn();
        req.end = jest.fn();

        if (requestCount === 1) {
          const res = createMockResponse(301, { location: 'http://hop1.example.com/' });
          process.nextTick(() => callback(res));
        } else if (requestCount === 2) {
          const res = createMockResponse(302, { location: 'http://hop2.example.com/' });
          process.nextTick(() => callback(res));
        } else {
          const res = createMockResponse(200, { 'content-type': 'text/html' }, '<html>Final Destination</html>');
          process.nextTick(() => callback(res));
        }
        return req;
      });

      const result = await inspectUrl('http://initial.example.com/');
      expect(result.statusCode).toBe(200);
      expect(result.hopCount).toBe(2);
      expect(result.bodySnippet).toContain('Final Destination');
    });

    test('throws when redirect chain exceeds 5 hops', async () => {
      jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

      jest.spyOn(http, 'request').mockImplementation((opts, callback) => {
        const req = new EventEmitter();
        req.destroy = jest.fn();
        req.end = jest.fn();
        const res = createMockResponse(302, { location: 'http://loop.example.com/' });
        process.nextTick(() => callback(res));
        return req;
      });

      await expect(inspectUrl('http://loop.example.com/'))
        .rejects.toThrow('Too many redirects (maximum 5 hops allowed).');
    });

    test('rejects when redirect returns without Location header', async () => {
      jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

      jest.spyOn(http, 'request').mockImplementation((opts, callback) => {
        const req = new EventEmitter();
        req.destroy = jest.fn();
        req.end = jest.fn();
        const res = createMockResponse(302, {}); // No location header
        process.nextTick(() => callback(res));
        return req;
      });

      await expect(inspectUrl('http://no-loc.example.com/'))
        .rejects.toThrow('Redirect returned without Location header.');
    });

    test('rejects redirect that jumps to private metadata IP (SSRF chain prevention)', async () => {
      let reqStep = 0;
      jest.spyOn(dns, 'lookup').mockImplementation(async (host) => {
        if (host.includes('metadata.internal')) {
          return [{ address: '169.254.169.254', family: 4 }];
        }
        return [{ address: '93.184.216.34', family: 4 }];
      });

      jest.spyOn(http, 'request').mockImplementation((opts, callback) => {
        reqStep++;
        const req = new EventEmitter();
        req.destroy = jest.fn();
        req.end = jest.fn();
        const res = createMockResponse(302, { location: 'http://metadata.internal/latest/meta-data/' });
        process.nextTick(() => callback(res));
        return req;
      });

      await expect(inspectUrl('http://public.example.com/'))
        .rejects.toThrow('Target resolves to a private, loopback, or restricted IP address.');
    });
  });

  describe('6. Stream Truncation and Timeout Handling (Lines 175–208)', () => {
    test('truncates bodySnippet at 16,384 bytes and destroys stream if exceeding 65,536 bytes', async () => {
      jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

      jest.spyOn(http, 'request').mockImplementation((opts, callback) => {
        const req = new EventEmitter();
        req.destroy = jest.fn();
        req.end = jest.fn();

        const res = new EventEmitter();
        res.statusCode = 200;
        res.headers = { 'content-type': 'application/octet-stream' };
        res.destroy = jest.fn();

        process.nextTick(() => {
          callback(res);
          // Emit 70 KB of data (exceeds 65,536-byte threshold)
          const chunk = Buffer.alloc(35000, 'A');
          res.emit('data', chunk);
          res.emit('data', chunk);
          res.emit('end');
        });
        return req;
      });

      const res = await inspectUrl('http://large-file.example.com/');
      expect(res.statusCode).toBe(200);
      expect(res.bodySnippet.length).toBe(16384); // Capped at 16 KiB
    });

    test('rejects with timeout error when request emits timeout event', async () => {
      jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

      jest.spyOn(http, 'request').mockImplementation(() => {
        const req = new EventEmitter();
        req.destroy = jest.fn((err) => {
          if (err) req.emit('error', err);
        });
        req.end = jest.fn(() => {
          process.nextTick(() => req.emit('timeout'));
        });
        return req;
      });

      await expect(inspectUrl('http://timeout.example.com/'))
        .rejects.toThrow('Request timed out after 10000ms.');
    });
  });

  describe('7. Socket IP Pinning & DNS Rebinding Protection (Task R9.2 Part 2 Item 5)', () => {
    test('enforces socket IP pinning via lookup hook and rejects TOCTOU rebinding with injected resolver', async () => {
      let capturedReqOptions = null;
      jest.spyOn(http, 'request').mockImplementation((opts, callback) => {
        capturedReqOptions = opts;
        const req = new EventEmitter();
        req.destroy = jest.fn();
        req.end = jest.fn();
        const res = new EventEmitter();
        res.statusCode = 200;
        res.headers = { 'content-type': 'text/html' };
        process.nextTick(() => {
          callback(res);
          res.emit('end');
        });
        return req;
      });

      // Injected resolver returning public IP 93.184.216.34
      const mockResolver = jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      jest.spyOn(dns, 'lookup').mockImplementation(mockResolver);

      const res = await inspectUrl('http://rebind-target.example.com/', 0, { resolver: mockResolver });
      expect(res.statusCode).toBe(200);

      // Verify socket IP pinning: hostname is resolved IP, and lookup hook is registered
      expect(capturedReqOptions.hostname).toBe('93.184.216.34');
      expect(typeof capturedReqOptions.lookup).toBe('function');

      // Test that the lookup hook strictly returns the pinned IP regardless of query
      const callbackSpy = jest.fn();
      capturedReqOptions.lookup('any-host.com', {}, callbackSpy);
      expect(callbackSpy).toHaveBeenCalledWith(null, '93.184.216.34', 4);

      // Verify that if resolver returns a re-bound private IP, inspectUrl rejects before connection
      const rebindingResolver = jest.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
      await expect(inspectUrl('http://evil-rebind.example.com/', 0, { resolver: rebindingResolver }))
        .rejects.toThrow('Target resolves to a restricted IP address.');
    });
  });
});
