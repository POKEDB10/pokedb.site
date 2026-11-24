#!/usr/bin/env node
// scripts/ops/verify-proxy-trust.js
// Owner Task O1: Cross-platform verification of proxy trust and client IP extraction.
// Enforces secrets via environment variables ONLY (ADMIN_TOKEN, ORIGIN_VERIFY_SECRET).

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    target: process.env.TARGET_URL || 'https://tinyurl.pokedb.site',
    adminToken: process.env.ADMIN_TOKEN || '',
    originVerifySecret: process.env.ORIGIN_VERIFY_SECRET || '',
    expectedIp: process.env.EXPECTED_IP || null
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' && args[i + 1]) {
      options.target = args[++i];
    } else if (args[i] === '--expected-ip' && args[i + 1]) {
      options.expectedIp = args[++i];
    } else if (args[i] === '--admin-token' || args[i] === '--origin-secret') {
      console.error(`\n[CRITICAL SECURITY ERROR] Passing secrets via CLI arguments (${args[i]}) is strictly prohibited.`);
      console.error('CLI arguments appear in process listings (ps aux) and shell history files.');
      console.error('Provide secrets exclusively via environment variables:\n');
      console.error('  ADMIN_TOKEN="<token>" ORIGIN_VERIFY_SECRET="<secret>" node scripts/ops/verify-proxy-trust.js --target <url>\n');
      process.exit(1);
    }
  }

  return options;
}

function makeRequest(targetUrl, options = {}, postData = null, originSecret = '') {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const client = url.protocol === 'https:' ? https : http;

    const headers = Object.assign({}, options.headers || {});
    if (originSecret && !headers['X-Origin-Verify']) {
      headers['X-Origin-Verify'] = originSecret;
    }

    const reqOptions = {
      method: options.method || 'GET',
      headers,
      timeout: options.timeout || 5000
    };

    const req = client.request(url, reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
          json
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out to ${targetUrl}`));
    });

    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function run() {
  const options = parseArgs();
  const baseUrl = options.target.replace(/\/+$/, '');

  console.log('=======================================================');
  console.log('Task O1: Proxy Trust & Client IP Verification');
  console.log(`Target: ${baseUrl}`);
  console.log('=======================================================\n');

  // Step 1: Query diagnostic endpoint with ADMIN_TOKEN
  console.log('Step 1: Querying /__diag/ip for resolved client IP...');
  if (!options.adminToken) {
    console.warn('[WARN] No ADMIN_TOKEN provided via ADMIN_TOKEN env var. Attempting /__diag/ip without auth...');
  }

  try {
    const diagHeaders = {};
    if (options.adminToken) {
      diagHeaders['Authorization'] = `Bearer ${options.adminToken}`;
    }

    const diagRes = await makeRequest(`${baseUrl}/__diag/ip`, { headers: diagHeaders }, null, options.originVerifySecret);

    if (diagRes.statusCode === 401 || diagRes.statusCode === 403) {
      console.error(`[FAIL] /__diag/ip rejected with HTTP ${diagRes.statusCode}. Valid ADMIN_TOKEN environment variable is required.`);
      process.exit(1);
    }

    if (diagRes.statusCode !== 200 || !diagRes.json) {
      console.error(`[FAIL] /__diag/ip failed with HTTP ${diagRes.statusCode}: ${diagRes.body}`);
      process.exit(1);
    }

    const reportedIp = diagRes.json.ip;
    console.log(`  Reported req.ip:      ${reportedIp}`);
    console.log(`  Reported req.ips:     ${JSON.stringify(diagRes.json.ips || [])}`);

    // Check for Docker bridge subnets
    const isDockerBridge = /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(reportedIp);
    const isLoopback = reportedIp === '127.0.0.1' || reportedIp === '::1';

    if (isDockerBridge) {
      console.error(`\n[CRITICAL FAILURE] req.ip is a Docker bridge IP (${reportedIp})!`);
      console.error('TRUST_PROXY is too low or not configured. All global traffic will share 1 rate-limit bucket.');
      console.error('Configure TRUST_PROXY="loopback,uniquelocal" or "1" in your environment.\n');
      process.exit(1);
    }

    if (options.expectedIp && reportedIp !== options.expectedIp) {
      console.warn(`\n[WARN] Reported IP (${reportedIp}) does not match expected IP (${options.expectedIp}).`);
    } else {
      console.log('  [PASS] Step 1: Client IP resolved to non-bridge address.\n');
    }

  } catch (err) {
    console.error(`[ERROR] Step 1 request failed: ${err.message}`);
    process.exit(1);
  }

  // Step 2: 35-request spoofed-XFF burst against /api/shorten (NO ADMIN TOKEN)
  console.log('Step 2: Executing 35-request spoofed-XFF burst on /api/shorten (No Admin Token)...');
  console.log('Testing whether rotating X-Forwarded-For headers can bypass the 30 req / 15 min limiter.\n');

  const burstResults = [];
  let rateLimitEnforced = false;
  let first429Index = -1;

  for (let i = 1; i <= 35; i++) {
    const fakeIp = `203.0.113.${i}`;
    const payload = JSON.stringify({
      url: 'https://example.com/proxy-test',
      customAlias: `test-proxy-${Date.now()}-${i}`
    });

    try {
      const res = await makeRequest(
        `${baseUrl}/api/shorten`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'X-Forwarded-For': fakeIp,
            'Host': 'tinyurl.pokedb.site'
          }
        },
        payload,
        options.originVerifySecret
      );

      burstResults.push({ index: i, fakeIp, status: res.statusCode });

      if (res.statusCode === 429) {
        if (!rateLimitEnforced) {
          rateLimitEnforced = true;
          first429Index = i;
        }
      }

      process.stdout.write(`  Request ${i.toString().padStart(2, ' ')} [XFF: ${fakeIp}]: HTTP ${res.statusCode}\n`);
    } catch (err) {
      console.error(`  Request ${i} error: ${err.message}`);
      burstResults.push({ index: i, fakeIp, status: 'ERR' });
    }
  }

  console.log('\n-------------------------------------------------------');
  console.log('Task O1 Burst Test Evaluation:');
  console.log(`  Total requests: 35`);
  console.log(`  Limiter enforced at request: ${first429Index > 0 ? first429Index : 'NEVER'}`);

  if (rateLimitEnforced && first429Index <= 31) {
    console.log('  [PASS] SUCCESS: Rate limiter triggered strictly based on origin IP.');
    console.log('  Fake X-Forwarded-For headers did NOT reset rate-limiting budget.');
    console.log('-------------------------------------------------------\n');
    process.exit(0);
  } else {
    console.error('  [CRITICAL FAILURE] Rate limit was NOT enforced by request 31!');
    console.error('  Rotating X-Forwarded-For allowed attacker to bypass rate limiting.');
    console.error('  TRUST_PROXY is configured too permissively (e.g. TRUST_PROXY=true).');
    console.error('  Set TRUST_PROXY="loopback,uniquelocal" or "1".');
    console.error('-------------------------------------------------------\n');
    process.exit(1);
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Verification script crashed:', err);
    process.exit(1);
  });
}

module.exports = { run, makeRequest };
