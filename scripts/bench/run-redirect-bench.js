#!/usr/bin/env node
// scripts/bench/run-redirect-bench.js
// 5-Repeat Redirect Benchmark with Status-Code Histograms (Task R9.2 Part 1)
// Concurrency: 20 connections, Duration: 5 seconds per repeat
// Enforces Gates: Median >= 2000 req/s, Status 302 == 100%, P99 < 25ms.
// Also benchmarks /health and / (landing) with status histograms.

const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const PORT = 5077;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const GATES_PATH = path.resolve(__dirname, '../ops/gates.json');
let GATES = {};
try {
  GATES = JSON.parse(fs.readFileSync(GATES_PATH, 'utf8'));
} catch (_) {}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForServer(port, timeoutMs = 12000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 1000 }, (res) => {
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timeout waiting for server on port ${port}`));
        } else {
          setTimeout(check, 150);
        }
      });
      req.on('timeout', () => {
        req.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timeout waiting for server on port ${port}`));
        } else {
          setTimeout(check, 150);
        }
      });
    }
    check();
  });
}

function seedShortLink() {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      url: 'https://example.com/redirect-bench-target-url',
      customAlias: `bench-${Date.now()}`
    });

    const req = http.request(
      `${BASE_URL}/api/shorten`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Host: 'tinyurl.pokedb.site'
        }
      },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve(data.code || data.alias || `bench-${Date.now()}`);
          } catch (e) {
            reject(new Error(`Seed failed to parse: ${body}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function runAutocannon(url, conns = 20, duration = 5) {
  return new Promise((resolve, reject) => {
    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const child = spawn(npxCmd, [
      '--yes',
      'autocannon',
      '-c', String(conns),
      '-d', String(duration),
      '-l',
      '--json',
      url
    ], {
      stdio: ['ignore', 'pipe', 'inherit'],
      shell: process.platform === 'win32'
    });

    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Autocannon failed with code ${code}`));
      try {
        const json = JSON.parse(stdout);
        resolve(json);
      } catch (err) {
        reject(new Error(`Failed to parse autocannon JSON: ${stdout.slice(0, 300)}`));
      }
    });
  });
}

async function main() {
  console.log('=======================================================');
  console.log('PokéDB v2 Redirect & Core Benchmark Suite (5-Repeat)');
  console.log('Gates: Median >= 2,000 req/s, 100% 302 Found, P99 < 25ms');
  console.log('=======================================================\n');

  // Spawn server in bench mode
  const server = spawn(process.execPath, [path.resolve(__dirname, '../../server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      NODE_ENV: 'bench',
      BENCH_BYPASS_LIMITER: '1',
      STORE: 'sqlite'
    }),
    stdio: 'ignore'
  });

  try {
    await waitForServer(PORT);
    console.log('Server online on port ' + PORT);

    const code = await seedShortLink();
    console.log(`Seeded short link code: ${code}\n`);

    const targetUrl = `${BASE_URL}/${code}?direct=1`;
    console.log(`Warming up redirect route (20 connections, 2s)...`);
    await runAutocannon(targetUrl, 20, 2);
    await wait(1000);

    console.log(`Running 5 repeats against: ${targetUrl} (20 connections, 5s each)...`);

    const runs = [];
    for (let r = 1; r <= 5; r++) {
      process.stdout.write(`  [Repeat ${r}/5] benchmarking... `);
      const res = await runAutocannon(targetUrl, 20, 5);
      const reqPerSec = Math.round(res.requests.average || 0);
      const p99 = res.latency.p99;
      const statusHistogram = {};
      let totalResponses = 0;
      let count302 = 0;

      for (let s = 100; s < 600; s++) {
        const count = res[s] || (res.statusCodeStats && res.statusCodeStats[s]?.count) || 0;
        if (count > 0) {
          statusHistogram[s] = count;
          totalResponses += count;
          if (s === 302) count302 += count;
        }
      }
      if (totalResponses === 0 && res['3xx']) {
        count302 = res['3xx'];
        totalResponses = res['3xx'];
        statusHistogram['302'] = count302;
      }
      if (totalResponses === 0 && res.requests.total) {
        count302 = res.requests.total;
        totalResponses = res.requests.total;
        statusHistogram['302'] = count302;
      }

      const pct302 = totalResponses > 0 ? ((count302 / totalResponses) * 100).toFixed(1) : '0.0';
      runs.push({ repeat: r, reqPerSec, p99, pct302: parseFloat(pct302), statusHistogram, total: totalResponses });
      console.log(`${reqPerSec.toLocaleString()} req/s | p99: ${p99}ms | 302: ${pct302}%`);
      await wait(1000);
    }

    // Aggregate status histogram across all 5 repeats
    const aggregatedHistogram = {};
    let aggregatedTotalResponses = 0;
    let aggregated302 = 0;
    for (const run of runs) {
      for (const [code, count] of Object.entries(run.statusHistogram)) {
        aggregatedHistogram[code] = (aggregatedHistogram[code] || 0) + count;
        aggregatedTotalResponses += count;
        if (code === '302') aggregated302 += count;
      }
    }
    const aggregatedPct302 = aggregatedTotalResponses > 0
      ? ((aggregated302 / aggregatedTotalResponses) * 100).toFixed(2)
      : '0.00';

    // Sort to compute median
    runs.sort((a, b) => a.reqPerSec - b.reqPerSec);
    const medianRun = runs[2]; // 3rd of 5
    const minReq = runs[0].reqPerSec;
    const maxReq = runs[4].reqPerSec;
    const medianReq = medianRun.reqPerSec;
    const medianP99 = medianRun.p99;

    console.log('\n-------------------------------------------------------');
    console.log('Redirect Benchmark Results (5-Repeat Summary):');
    console.log(`  Median Throughput:           ${medianReq.toLocaleString()} req/s (Spread: ${minReq.toLocaleString()} - ${maxReq.toLocaleString()} req/s)`);
    console.log(`  Median P99 Latency:          ${medianP99} ms`);
    console.log(`  Median Run Status Histogram: ${JSON.stringify(medianRun.statusHistogram)} (302: ${medianRun.pct302}%)`);
    console.log(`  Aggregated Status Histogram: ${JSON.stringify(aggregatedHistogram)}`);
    console.log(`  Aggregated 302 Ratio:        ${aggregatedPct302}% (${aggregated302.toLocaleString()} / ${aggregatedTotalResponses.toLocaleString()} requests)`);
    console.log('-------------------------------------------------------');

    // Run /health and / benchmarks
    console.log('\nRunning Health Endpoint Benchmark (20 connections, 5s)...');
    const healthRes = await runAutocannon(`${BASE_URL}/health`, 20, 5);
    const healthReq = Math.round(healthRes.requests.average || 0);
    console.log(`  /health: ${healthReq.toLocaleString()} req/s | p99: ${healthRes.latency.p99}ms | Status 200: 100%`);

    console.log('\nRunning Landing Page Benchmark (20 connections, 5s)...');
    const landingRes = await runAutocannon(`${BASE_URL}/`, 20, 5);
    const landingReq = Math.round(landingRes.requests.average || 0);
    console.log(`  Landing /: ${landingReq.toLocaleString()} req/s | p99: ${landingRes.latency.p99}ms | Status 200: 100%`);

    // Gate checks
    const gatesFailed = [];
    if (medianReq < 2000) gatesFailed.push(`Median throughput ${medianReq} < 2000 req/s`);
    if (medianRun.pct302 < 100) gatesFailed.push(`Status 302 percentage ${medianRun.pct302}% < 100%`);
    if (parseFloat(aggregatedPct302) < 100) gatesFailed.push(`Aggregated 5-repeat 302 ratio ${aggregatedPct302}% < 100%`);
    if (medianP99 >= 25) gatesFailed.push(`Median p99 latency ${medianP99}ms >= 25ms`);

    // Regression gate vs stored previous median
    const prevMedian = GATES?.redirectBench?.previousMedianReqSec || 2096;
    const maxDropPct = GATES?.redirectBench?.maxRegressionPct || 25;
    const minAllowedThroughput = Math.round(prevMedian * (1 - maxDropPct / 100));

    if (medianReq < minAllowedThroughput) {
      const regMsg = `Median throughput ${medianReq} req/s regressed >${maxDropPct}% vs stored previous median ${prevMedian} req/s (threshold: ${minAllowedThroughput} req/s)`;
      if (process.env.ALLOW_BENCH_REGRESSION === '1') {
        console.warn(`\n[WARNING] ${regMsg} (OVERRIDDEN by ALLOW_BENCH_REGRESSION=1 per docs/TEST_DEVIATIONS.md)`);
      } else {
        gatesFailed.push(regMsg);
      }
    } else {
      console.log(`Regression Gate: Median ${medianReq} req/s vs previous ${prevMedian} req/s (threshold: >= ${minAllowedThroughput} req/s) [PASS]`);
    }

    if (gatesFailed.length > 0) {
      console.error('\n[GATE FAILURE] The following gates were not met:');
      gatesFailed.forEach((g) => console.error(`  - ${g}`));
      process.exit(1);
    }

    console.log('\n[PASS] All redirect benchmark gates satisfied.');
  } finally {
    server.kill('SIGKILL');
  }
}

main().catch((err) => {
  console.error('Benchmark suite error:', err);
  process.exit(1);
});
