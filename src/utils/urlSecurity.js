// src/utils/urlSecurity.js
// Multi-provider threat intelligence and URL validation engine (Task P3.5).

const net = require('node:net');
const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');

const RESERVED_BLOCKLIST = new Set([
  'api', 'tools', 'shared', 'favicon.ico', 'static', 'public',
  'shorten', 'health', 'index.html', 'stats', 'admin', 'dashboard',
  'robots.txt', 'sitemap.xml', 'security.txt', 'healthz', 'manifest.json',
  'assets', 'fonts', 'docs', 'legal', 'terms', 'privacy',
  'v', 'drop', 'tinyurl', 'qr'
]);

function parseExpiresInDays(value, defaultValue = 30) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'string' && value.trim() === '') return null;

  const days = Number(value);
  if (!Number.isInteger(days) || days < 0 || days > 365) return null;
  return days;
}

function isPrivateIpv4(address) {
  const octets = address.split('.').map(Number);
  return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
    (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 0 && octets[2] === 0) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 198 && octets[1] >= 18 && octets[1] <= 19) ||
    (octets[0] >= 224);
}

function ipv6Groups(address) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const parts = normalized.split('::');
  const expandPart = (part) => (part ? part.split(':').filter(Boolean) : []);
  let left = expandPart(parts[0]);
  let right = expandPart(parts[1]);

  const convertEmbeddedIpv4 = (groups) => {
    const last = groups.at(-1);
    if (!last || !last.includes('.')) return groups;
    const octets = last.split('.').map(Number);
    return [...groups.slice(0, -1), ((octets[0] << 8) | octets[1]).toString(16), ((octets[2] << 8) | octets[3]).toString(16)];
  };

  left = convertEmbeddedIpv4(left);
  right = convertEmbeddedIpv4(right);
  const missing = 8 - left.length - right.length;
  return [...left, ...Array(Math.max(0, missing)).fill('0'), ...right].map((group) => Number.parseInt(group, 16));
}

function isPrivateIpAddress(address) {
  const version = net.isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version !== 6) return true;

  const groups = ipv6Groups(address);
  if (groups.length !== 8 || groups.some(Number.isNaN)) return true;
  const isAllZero = groups.every((group) => group === 0);
  const isLoopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  const isMappedIpv4 = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  const isCompatibleIpv4 = groups.slice(0, 6).every((group) => group === 0);

  if (isMappedIpv4 || isCompatibleIpv4) {
    const ipv4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    return isPrivateIpv4(ipv4);
  }

  return (
    isAllZero ||
    isLoopback ||
    (groups[0] & 0xfe00) === 0xfc00 ||
    (groups[0] & 0xffc0) === 0xfe80 ||
    (groups[0] & 0xff00) === 0xff00
  );
}

const isPrivateHost = async (host) => {
  if (!host) return true;
  const hostname = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost') return true;
  if (net.isIP(hostname)) return isPrivateIpAddress(hostname);

  try {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    return addresses.length === 0 || addresses.some(({ address }) => isPrivateIpAddress(address));
  } catch (err) {
    return true;
  }
};

const isValidRemoteUrl = async (rawUrl) => {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return !(await isPrivateHost(parsed.hostname));
  } catch (err) {
    return false;
  }
};

async function inspectUrl(targetUrl, hopCount = 0, options = {}) {
  if (hopCount > 5) {
    throw new Error('Too many redirects (maximum 5 hops allowed).');
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (e) {
    throw new Error('Invalid target URL format.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs can be inspected.');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (await isPrivateHost(hostname)) {
    throw new Error('Target resolves to a private, loopback, or restricted IP address.');
  }

  const resolver = options.resolver || dns.lookup;
  const addresses = await resolver(hostname, { all: true, verbatim: true });
  if (!addresses || !addresses.length) {
    throw new Error('DNS resolution failed for target host.');
  }

  for (const addr of addresses) {
    if (isPrivateIpAddress(addr.address)) {
      throw new Error('Target resolves to a restricted IP address.');
    }
  }

  const resolvedIp = addresses[0].address;
  const isHttps = parsed.protocol === 'https:';
  const port = parsed.port ? Number(parsed.port) : (isHttps ? 443 : 80);
  const reqPath = (parsed.pathname || '/') + (parsed.search || '');

  return new Promise((resolve, reject) => {
    const transport = isHttps ? https : http;
    const reqOptions = {
      hostname: resolvedIp,
      port: port,
      path: reqPath,
      method: 'GET',
      headers: {
        Host: parsed.host,
        'User-Agent': 'Pokedb-SecurityInspector/1.0 (+https://pokedb.site)',
        Accept: '*/*'
      },
      servername: isHttps ? hostname : undefined,
      rejectUnauthorized: true,
      timeout: 10000,
      // Socket IP Pinning (Task R9.2 Part 2 Item 5):
      // Custom lookup hook strictly pins socket connection to the pre-validated resolvedIp,
      // defeating any TOCTOU DNS rebinding attempts
      lookup: (host, opts, cb) => {
        cb(null, resolvedIp, net.isIP(resolvedIp));
      }
    };

    const req = transport.request(reqOptions, async (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const loc = res.headers.location;
        req.destroy();
        if (!loc) return reject(new Error('Redirect returned without Location header.'));
        try {
          const redirectUrl = new URL(loc, targetUrl).href;
          return resolve(await inspectUrl(redirectUrl, hopCount + 1));
        } catch (err) {
          return reject(err);
        }
      }

      let bodySnippet = '';
      let bytesRead = 0;

      res.on('data', (chunk) => {
        bytesRead += chunk.length;
        if (bodySnippet.length < 16384) {
          bodySnippet += chunk.toString('utf8', 0, Math.min(chunk.length, 16384 - bodySnippet.length));
        }
        if (bytesRead > 65536) {
          res.destroy();
        }
      });

      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          url: targetUrl,
          finalUrl: targetUrl,
          hopCount: hopCount,
          headers: res.headers,
          bodySnippet: bodySnippet
        });
      });

      res.on('error', (err) => reject(err));
    });

    req.on('timeout', () => {
      req.destroy(new Error('Request timed out after 10000ms.'));
    });

    req.on('error', (err) => reject(err));
    req.end();
  });
}

const KNOWN_SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'is.gd',
  'cutt.ly',
  'goo.gl',
  'ow.ly',
  'buff.ly',
  'rebrand.ly',
  'tiny.cc'
]);

function isValidTargetUrl(targetUrl, reqHost) {
  if (!targetUrl || typeof targetUrl !== 'string') return false;
  const trimmed = targetUrl.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return false;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

    // Reject userinfo (e.g. http://user:pass@host)
    if (parsed.username || parsed.password) return false;

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    // Reject localhost and IP-literals (IPv4 or IPv6)
    if (hostname === 'localhost' || net.isIP(hostname)) {
      return false;
    }

    // Reject links to pokedb.site itself, configured subdomains, or the current host
    if (reqHost && parsed.host.toLowerCase() === reqHost.toLowerCase()) return false;
    if (
      hostname === 'pokedb.site' ||
      hostname.endsWith('.pokedb.site') ||
      hostname === '127.0.0.1'
    ) {
      return false;
    }

    // Reject known shorteners (loop prevention)
    if (KNOWN_SHORTENERS.has(hostname)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function isValidUrl(urlStr) {
  return isValidTargetUrl(urlStr);
}

function logScannerTelemetry(req, reason = 'Not Found') {
  const ip = req?.ip || req?.connection?.remoteAddress || 'unknown';
  console.warn(`[SECURITY TELEMETRY] Possible ID enumeration attempt from ${ip} on ${req?.method || 'GET'} ${req?.originalUrl || req?.path || ''}: ${reason}`);
}

async function analyzeUrlRisk(urlStr, config = {}) {
  const flags = [];
  let riskLevel = 'low';

  const gsbKey = config.googleSafeBrowsingKey || process.env.GOOGLE_SAFE_BROWSING_KEY;

  // Google Safe Browsing API v4 only (Task P5.4)
  if (gsbKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);
    try {
      // Strip query and fragment per Task P5.4
      let checkUrl = urlStr;
      try {
        const p = new URL(urlStr);
        checkUrl = `${p.protocol}//${p.host}${p.pathname}`;
      } catch (_) {}

      const res = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(gsbKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          client: { clientId: 'pokedb-site', clientVersion: '2.0.0' },
          threatInfo: {
            threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: [{ url: checkUrl }]
          }
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.matches && data.matches.length > 0) {
          const matchType = (data.matches[0].threatType || 'MALICIOUS_SITE').replace(/_/g, ' ');
          flags.push(`Flagged by Google Safe Browsing API: ${matchType}. Advisory provided by Google`);
          riskLevel = 'high';
        }
      }
    } catch (_) {
      // Safe timeout / offline ignore
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    isSuspicious: flags.length > 0,
    riskLevel,
    flags
  };
}

module.exports = {
  RESERVED_BLOCKLIST,
  parseExpiresInDays,
  isValidTargetUrl,
  isValidUrl,
  logScannerTelemetry,
  analyzeUrlRisk,
  isPrivateIpv4,
  ipv6Groups,
  isPrivateIpAddress,
  isPrivateHost,
  isValidRemoteUrl,
  inspectUrl
};
