const http = require('http');
const { monitorEventLoopDelay } = require('perf_hooks');
const { ensureServer } = require('./_server');

function pingServer(baseUrl) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const req = http.get(`${baseUrl}/api/health/ping`, { timeout: 3000 }, (res) => {
      res.resume();
      res.on('end', () => {
        const diffNs = process.hrtime.bigint() - start;
        const diffMs = Number(diffNs) / 1e6;
        resolve(diffMs);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(3000);
    });
  });
}

function createProtectedPaste(baseUrl, index) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      title: `Protected Paste ${index}`,
      content: `Protected content payload for scrypt load test #${index}`,
      password: `password-${index}-${Date.now()}`
    });

    const url = new URL(`${baseUrl}/api/paste/create`);
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Host': 'paste.pokedb.site',
          'X-Forwarded-For': `10.43.0.${index + 1}`
        },
        timeout: 5000
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.write(payload);
    req.end();
  });
}

function computePercentile(sortedArray, p) {
  if (sortedArray.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedArray.length) - 1;
  return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
}

async function main() {
  const server = await ensureServer();
  const loopMonitor = monitorEventLoopDelay({ resolution: 10 });
  loopMonitor.enable();

  try {
    console.log(`=======================================================`);
    console.log(`Event Loop & Health Latency Benchmark under Load`);
    console.log(`Target: ${server.baseUrl}`);
    console.log(`Workload: 20 parallel protected-paste creates (scrypt)`);
    console.log(`Probing: /api/health/ping every 5ms`);
    console.log(`=======================================================`);

    const samples = [];
    let probing = true;

    // Start background high-frequency health pinging
    const pingLoop = (async () => {
      while (probing) {
        const lat = await pingServer(server.baseUrl);
        if (lat !== null) samples.push(lat);
        await new Promise((r) => setTimeout(r, 5));
      }
    })();

    // Launch 20 parallel protected-paste creations
    console.log('\nFiring 20 parallel protected paste creations...');
    const workloadStart = Date.now();
    const pastePromises = [];
    for (let i = 0; i < 20; i++) {
      pastePromises.push(createProtectedPaste(server.baseUrl, i));
    }
    await Promise.all(pastePromises);
    const workloadDuration = Date.now() - workloadStart;
    console.log(`Workload completed in ${workloadDuration}ms.`);

    // Wait a short moment to capture trailing loop recovery
    await new Promise((r) => setTimeout(r, 200));
    probing = false;
    await pingLoop;
    loopMonitor.disable();

    samples.sort((a, b) => a - b);

    const min = samples[0] || 0;
    const p50 = computePercentile(samples, 50);
    const p90 = computePercentile(samples, 90);
    const p95 = computePercentile(samples, 95);
    const p99 = computePercentile(samples, 99);
    const max = samples[samples.length - 1] || 0;

    const localP99 = (loopMonitor.percentile(99) / 1e6).toFixed(2);
    const localMax = (loopMonitor.max / 1e6).toFixed(2);

    console.log('\n-------------------------------------------------------');
    console.log('Results:');
    console.log(`  Health ping samples:    ${samples.length}`);
    console.log(`  Min ping latency:       ${min.toFixed(2)} ms`);
    console.log(`  p50 ping latency:       ${p50.toFixed(2)} ms`);
    console.log(`  p90 ping latency:       ${p90.toFixed(2)} ms`);
    console.log(`  p95 ping latency:       ${p95.toFixed(2)} ms`);
    console.log(`  p99 ping latency:       ${p99.toFixed(2)} ms`);
    console.log(`  Max ping latency:       ${max.toFixed(2)} ms`);
    console.log(`  Client loop p99 delay:  ${localP99} ms (max: ${localMax} ms)`);
    console.log('-------------------------------------------------------');

    console.log(`Target: p99 delay < 50 ms under load.`);
    if (p99 < 50) {
      console.log(`STATUS: PASS (p99 is ${p99.toFixed(2)} ms < 50 ms)`);
    } else {
      console.log(`STATUS: HIGH DELAY (p99 is ${p99.toFixed(2)} ms >= 50 ms) - event loop starved during scrypt`);
    }
  } finally {
    await server.stop();
  }
}

main().catch((err) => {
  console.error('Event loop benchmark failed:', err);
  process.exit(1);
});
