// scripts/bench/reconcile-all-cells.js
// Reconciles all benchmark cells (P0, R2.7, HEAD) across Redirect, Health, and Landing in a single session.
// Captures raw throughput, latency percentiles, and exact status-code histograms.

const { spawn, spawnSync, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const TEMP_P0 = path.join(ROOT_DIR, 'temp-p0');
const TEMP_R27 = path.join(ROOT_DIR, 'temp-r27');

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

function seedLink(port) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      url: 'https://example.com/reconcile-benchmark-target',
      customAlias: `bench-${Date.now()}`
    });

    const req = http.request(
      `http://127.0.0.1:${port}/api/shorten`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Host': 'tinyurl.pokedb.site'
        }
      },
      (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve(data.code);
          } catch (e) {
            reject(new Error(`Failed to seed link on port ${port}: ${body}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function runAutocannon(url, options = {}) {
  return new Promise((resolve, reject) => {
    const conns = options.connections || 20;
    const duration = options.duration || 5;
    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const args = ['--yes', 'autocannon', '-c', String(conns), '-d', String(duration), '-j', url];

    const child = spawn(npxCmd, args, {
      cwd: ROOT_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('close', (code) => {
      try {
        const json = JSON.parse(stdout);
        resolve(json);
      } catch (err) {
        reject(new Error(`Autocannon failed (code ${code}): ${stderr || stdout}`));
      }
    });
    child.on('error', reject);
  });
}

async function runCell(name, dir, port, envOverrides = {}) {
  console.log(`\n=======================================================`);
  console.log(`Starting Cell: ${name} (Port: ${port}, Cwd: ${dir})`);
  console.log(`=======================================================`);

  const serverEnv = Object.assign({}, process.env, {
    PORT: String(port),
    NODE_ENV: 'bench',
    BENCH_BYPASS_LIMITER: '1'
  }, envOverrides);

  const serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: serverEnv,
    stdio: ['ignore', 'ignore', 'pipe']
  });

  serverProcess.stderr.on('data', (d) => {
    const str = d.toString();
    if (str.includes('Error')) console.error(`[Server Error] ${str.trim()}`);
  });

  try {
    await waitForServer(port);
    console.log(`Server online on port ${port}`);

    // Seed short link
    const code = await seedLink(port);
    console.log(`Seeded short link: ${code}`);

    // 1. Short Link Redirect (?direct=1)
    console.log(`Benchmarking Redirect (/:code?direct=1, 20c, 5s)...`);
    const redirectRes = await runAutocannon(`http://127.0.0.1:${port}/${code}?direct=1`, { connections: 20, duration: 5 });

    // 2. Health Check
    const healthUrl = fs.existsSync(path.join(dir, 'src', 'tools', 'health')) ? `http://127.0.0.1:${port}/healthz` : `http://127.0.0.1:${port}/health`;
    console.log(`Benchmarking Health (${healthUrl}, 20c, 5s)...`);
    const healthRes = await runAutocannon(healthUrl, { connections: 20, duration: 5 });

    // 3. Landing Page
    console.log(`Benchmarking Landing (/, 20c, 5s)...`);
    const landingRes = await runAutocannon(`http://127.0.0.1:${port}/`, { connections: 20, duration: 5 });

    // Format cell summary
    return {
      name,
      redirect: {
        reqSec: redirectRes.requests.average,
        latencyAvg: redirectRes.latency.average,
        latencyP50: redirectRes.latency.p50,
        latencyP99: redirectRes.latency.p99,
        total: redirectRes.requests.total,
        statusCodes: redirectRes.statusCodeStats
      },
      health: {
        reqSec: healthRes.requests.average,
        latencyAvg: healthRes.latency.average,
        latencyP50: healthRes.latency.p50,
        latencyP99: healthRes.latency.p99,
        total: healthRes.requests.total,
        statusCodes: healthRes.statusCodeStats
      },
      landing: {
        reqSec: landingRes.requests.average,
        latencyAvg: landingRes.latency.average,
        latencyP50: landingRes.latency.p50,
        latencyP99: landingRes.latency.p99,
        total: landingRes.requests.total,
        statusCodes: landingRes.statusCodeStats
      }
    };
  } finally {
    serverProcess.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function runSession() {
  const results = {};

  // 1. P0 (commit 338b363)
  results.p0 = await runCell('P0 Baseline (commit 338b363)', TEMP_P0, 5061);

  // 2. R2.7 (commit 3ef3c2a)
  results.r27 = await runCell('R2.7 Baseline (commit 3ef3c2a)', TEMP_R27, 5062);

  // 3. HEAD (logging OFF / silent)
  results.head = await runCell('HEAD (v2/overhaul, logging-off)', ROOT_DIR, 5063);

  // 4. HEAD (logging ON / A/B delta attribution)
  results.headLogging = await runCell('HEAD (v2/overhaul, logging-on A/B)', ROOT_DIR, 5064, { LOG_LEVEL: 'info', DEBUG_LOGGING: '1' });

  console.log('\n\n=======================================================');
  console.log('RECONCILED LIKE-FOR-LIKE BENCHMARK RESULTS (ONE SESSION)');
  console.log('=======================================================\n');
  console.log(JSON.stringify(results, null, 2));

  // Save report to docs/reconciled-benchmarks.json
  fs.writeFileSync(path.join(ROOT_DIR, 'docs', 'reconciled-benchmarks.json'), JSON.stringify(results, null, 2));
}

runSession().catch((err) => {
  console.error('Benchmark session crashed:', err);
  process.exit(1);
});
