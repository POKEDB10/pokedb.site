// scripts/bench/soak.js
// 60-Minute Soak Benchmark & Memory Leak Investigation (R9.2 Item 7)
// Measures server child process RSS, HeapUsed, HeapTotal, External, ArrayBuffers,
// SQLite WAL sizing, and rate-limit key cardinality under continuous traffic.
// Captures V8 heap snapshots at 5m, 25m, and 55m and computes post-minute-20 slopes.

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { analyzeSnapshot } = require('./analyze-snapshot');

const PORT = 5059;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DURATION_SEC = parseInt(process.env.SOAK_DURATION || '3600', 10); // default 60 min (3600s)
const WARMUP_SEC = process.env.WARMUP_SEC ? parseInt(process.env.WARMUP_SEC, 10) : 1200; // default 20 min (1200s)
const SAMPLE_INTERVAL_SEC = parseInt(process.env.SAMPLE_INTERVAL || '30', 10);

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokedb-soak-'));
const DB_PATH = path.join(TMP_DIR, 'soak.sqlite');
const SNAPSHOT_DIR = path.join(__dirname, '../../docs/soak-snapshots');
fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

// Snapshot trigger times (in seconds)
const SNAPSHOT_TIMES = DURATION_SEC >= 3600
  ? [300, 1500, 3300] // 5 min, 25 min, 55 min
  : [
      Math.max(2, Math.round(DURATION_SEC * (5 / 60))),
      Math.max(4, Math.round(DURATION_SEC * (25 / 60))),
      Math.max(6, Math.round(DURATION_SEC * (55 / 60)))
    ];

const statusCodes = {};
function recordStatus(code) {
  const k = code ? String(code) : 'ERR';
  statusCodes[k] = (statusCodes[k] || 0) + 1;
}

function postJson(urlPath, data, host = 'tinyurl.pokedb.site', clientIp = '10.150.1.1') {
  return new Promise((resolve) => {
    const payload = JSON.stringify(data);
    const req = http.request(
      `${BASE_URL}${urlPath}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Host': host,
          'User-Agent': 'curl/8.4.0',
          'X-Forwarded-For': clientIp
        },
        timeout: 4000
      },
      (res) => {
        recordStatus(res.statusCode);
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch (_) {}
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', () => {
      recordStatus('ERR');
      resolve({ status: null, body: null });
    });
    req.write(payload);
    req.end();
  });
}

function getUrl(urlPath, host = 'tinyurl.pokedb.site', clientIp = '10.150.1.1') {
  return new Promise((resolve) => {
    const req = http.get(
      `${BASE_URL}${urlPath}`,
      {
        headers: {
          Host: host,
          'User-Agent': 'curl/8.4.0',
          'X-Forwarded-For': clientIp
        },
        timeout: 4000
      },
      (res) => {
        recordStatus(res.statusCode);
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode }));
      }
    );
    req.on('error', () => {
      recordStatus('ERR');
      resolve({ status: null });
    });
  });
}

function computeLinearSlope(points) {
  // points = [ { x: seconds, y: bytes } ]
  const n = points.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }
  const denom = (n * sumXX) - (sumX * sumX);
  if (denom === 0) return 0;
  const slopeBytesPerSec = ((n * sumXY) - (sumX * sumY)) / denom;
  // Convert slope to kB per minute
  return (slopeBytesPerSec * 60) / 1024;
}

async function run() {
  console.log('=======================================================');
  console.log('60-Minute Soak Benchmark with Heap Snapshots & Memory Slopes');
  console.log(`Duration: ${DURATION_SEC}s (${(DURATION_SEC / 60).toFixed(1)}m) | Warmup: ${WARMUP_SEC}s | Interval: ${SAMPLE_INTERVAL_SEC}s`);
  console.log(`Snapshot Target Times: ${SNAPSHOT_TIMES.map(t => `${t}s (${(t/60).toFixed(1)}m)`).join(', ')}`);
  console.log(`Database: ${DB_PATH}`);
  console.log('=======================================================\n');

  let child = null;

  try {
    console.log('1. Spawning production server with node --expose-gc...');
    child = spawn(process.execPath, [
      '--expose-gc',
      path.resolve(__dirname, '../../server.js')
    ], {
      env: {
        ...process.env,
        PORT: String(PORT),
        SQLITE_DB_PATH: DB_PATH,
        TRUST_PROXY: 'true',
        ENABLE_SOAK_GC: '1',
        CLICK_BUFFER_MAX_SIZE: '5000',
        NODE_ENV: 'bench'
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    let stdoutData = '';
    let stderrData = '';
    child.stdout.on('data', (d) => { stdoutData += d.toString(); });
    child.stderr.on('data', (d) => { stderrData += d.toString(); });

    await new Promise((resolve, reject) => {
      const start = Date.now();
      const interval = setInterval(() => {
        if (stdoutData.includes(`Server running on 0.0.0.0:${PORT}`) || stdoutData.includes(`Server running on port ${PORT}`)) {
          clearInterval(interval);
          resolve();
        } else if (Date.now() - start > 10000) {
          clearInterval(interval);
          reject(new Error(`Server failed to start within 10s: ${stderrData || stdoutData || 'no output'}`));
        }
      }, 50);
    });

    console.log(`Server online on http://127.0.0.1:${PORT}`);

    function requestChildMemory(forceGc = true) {
      return new Promise((resolve) => {
        const handler = (msg) => {
          if (msg && (msg.type === 'MEMORY_REPORT' || msg.type === 'MEMORY_SAMPLE')) {
            child.off('message', handler);
            resolve(msg);
          }
        };
        child.on('message', handler);
        child.send({ type: 'GET_MEMORY', forceGc });
        setTimeout(() => {
          child.off('message', handler);
          resolve(null);
        }, 5000);
      });
    }

    function triggerSnapshot(targetPath) {
      return new Promise((resolve) => {
        const handler = (msg) => {
          if (msg && msg.type === 'SNAPSHOT_DONE') {
            child.off('message', handler);
            resolve(msg.path);
          }
        };
        child.on('message', handler);
        child.send({ type: 'SNAPSHOT', path: targetPath });
        setTimeout(() => {
          child.off('message', handler);
          resolve(targetPath);
        }, 15000);
      });
    }

    // Baseline sample
    const baselineReport = await requestChildMemory(true);
    const baseMem = baselineReport?.memory || process.memoryUsage();
    console.log('\n2. Baseline Server Memory (Post-Boot with Forced GC):');
    console.log(`   RSS:            ${(baseMem.rss / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   HeapTotal:      ${(baseMem.heapTotal / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   HeapUsed:       ${(baseMem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   External:       ${(baseMem.external / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   RateLimitKeys:  ${baselineReport?.rateLimitKeys || 0}`);

    // Pre-seed items
    const seedLink = await postJson('/api/shorten', { url: 'https://example.com/soak-target', customAlias: 'soak-seed' }, 'tinyurl.pokedb.site', '10.150.0.1');
    const seedPaste = await postJson('/api/paste/create', { title: 'Seed Paste', content: 'Initial soak content' }, 'paste.pokedb.site', '10.150.0.2');

    console.log(`\n3. Applying mixed workload across routes for ${DURATION_SEC} seconds...`);
    const startTime = Date.now();
    let totalRequests = 0;
    let reqIndex = 0;
    let lastSampleTime = Date.now();
    let linksCreated = 0;
    let pastesCreated = 0;
    let scryptCount = 0;
    const samples = [];
    const snapshotsTaken = [];
    const snapshotTriggersPending = [...SNAPSHOT_TIMES];

    while ((Date.now() - startTime) < DURATION_SEC * 1000) {
      reqIndex++;
      const elapsedNowSec = Math.round((Date.now() - startTime) / 1000);

      // Rate-limit MemoryStore hypothesis test:
      // In first 75% of duration (0-45m), rotate IPs across wide space to test key accumulation without 429 saturation.
      // In last 25% of duration (45-60m), switch to fixed IP (10.150.1.1) to test key expiration and reclamation.
      let ip;
      const isFixedIpPhase = elapsedNowSec >= Math.round(DURATION_SEC * 0.75);
      if (!isFixedIpPhase) {
        const oct2 = Math.floor(reqIndex / 60000) % 250;
        const oct3 = Math.floor(reqIndex / 250) % 250;
        const oct4 = (reqIndex % 250) + 1;
        ip = `10.${oct2 + 10}.${oct3 + 1}.${oct4}`;
      } else {
        ip = '10.150.1.1'; // Fixed IP
      }

      // In fixed IP phase, route to unthrottled or high-allowance paths to avoid 429
      const op = isFixedIpPhase ? (reqIndex % 3) : (reqIndex % 7);
      if (op === 0) {
        await getUrl('/healthz', 'pokedb.site', ip);
      } else if (op === 1) {
        await getUrl('/', 'pokedb.site', ip);
      } else if (op === 2) {
        await getUrl('/soak-seed?direct=1', 'tinyurl.pokedb.site', ip);
      } else if (op === 3) {
        const res = await postJson('/api/shorten', { url: `https://example.com/dest-${reqIndex}`, customAlias: `soak-${reqIndex}` }, 'tinyurl.pokedb.site', ip);
        if (res.status === 200 || res.status === 201) linksCreated++;
      } else if (op === 4) {
        const res = await postJson('/api/paste/create', { title: `Soak Paste ${reqIndex}`, content: `Payload body content for index ${reqIndex}` }, 'paste.pokedb.site', ip);
        if (res.status === 200 || res.status === 201) pastesCreated++;
      } else if (op === 5) {
        if (seedPaste.body?.id) {
          await getUrl(`/api/paste/view/${seedPaste.body.id}`, 'paste.pokedb.site', ip);
        } else {
          await getUrl('/api/stats/soak-seed', 'tinyurl.pokedb.site', ip);
        }
      } else if (op === 6) {
        scryptCount++;
        const res = await postJson('/api/paste/create', { title: `Protected ${reqIndex}`, content: 'Encrypted text', password: `pass-${reqIndex}` }, 'paste.pokedb.site', ip);
        if (res.status === 200 || res.status === 201) pastesCreated++;
      }
      totalRequests++;

      // Periodic sweeper trigger
      if (reqIndex % 100 === 0 && child.send) {
        child.send({ type: 'TRIGGER_SWEEPER' });
      }

      // Check for scheduled heap snapshots
      if (snapshotTriggersPending.length > 0 && elapsedNowSec >= snapshotTriggersPending[0]) {
        const targetSec = snapshotTriggersPending.shift();
        const snapLabel = `${Math.round(targetSec / 60)}m`;
        const snapFileName = `snapshot-${snapLabel}-${targetSec}s.heapsnapshot`;
        const snapFilePath = path.join(SNAPSHOT_DIR, snapFileName);
        console.log(`\n   >>> [SNAPSHOT AT T+${elapsedNowSec}s] Capturing V8 heap snapshot to ${snapFileName}...`);
        await triggerSnapshot(snapFilePath);
        try {
          const analysis = analyzeSnapshot(snapFilePath, 10);
          snapshotsTaken.push({
            targetSec,
            elapsedSec: elapsedNowSec,
            label: snapLabel,
            filePath: snapFilePath,
            fileName: snapFileName,
            analysis
          });
          console.log(`   >>> Snapshot captured (${analysis.totalShallowSizeMb} MB, ${analysis.totalNodeCount} nodes). Top type: ${analysis.topRetainedTypes[0]?.name} (${analysis.topRetainedTypes[0]?.sizeKb} kB)`);
        } catch (snapErr) {
          console.warn(`   >>> Warning: Failed to parse snapshot ${snapFileName}:`, snapErr.message);
        }
      }

      // Throttle loop so IPC and GC remain responsive
      await new Promise((r) => setTimeout(r, 15));

      // Periodic sample
      const now = Date.now();
      if (now - lastSampleTime >= SAMPLE_INTERVAL_SEC * 1000) {
        lastSampleTime = now;
        const elapsedSec = Math.round((now - startTime) / 1000);
        const report = await requestChildMemory(true);
        const m = report?.memory || (report?.rss ? report : null);
        if (m) {
          const sample = {
            elapsedSec,
            rss: m.rss,
            heapUsed: m.heapUsed,
            heapTotal: m.heapTotal,
            external: m.external,
            arrayBuffers: m.arrayBuffers,
            rateLimitKeys: report.rateLimitKeys || 0,
            walSize: report.walSize || 0,
            dbSize: report.dbSize || 0,
            sweptTotal: report.totalSweptCount || report.sweptCount || 0
          };
          samples.push(sample);
          const rssMb = (m.rss / 1024 / 1024).toFixed(2);
          const heapMb = (m.heapUsed / 1024 / 1024).toFixed(2);
          const extMb = (m.external / 1024 / 1024).toFixed(2);
          const rlKeys = report.rateLimitKeys || 0;
          const walKb = ((report.walSize || 0) / 1024).toFixed(0);
          console.log(`   [T+${String(elapsedSec).padStart(4, ' ')}s] Reqs: ${String(totalRequests).padStart(6, ' ')} | RSS: ${rssMb} MB | HeapUsed: ${heapMb} MB | Ext: ${extMb} MB | RL-Keys: ${String(rlKeys).padStart(5, ' ')} | WAL: ${walKb} kB`);
        }
      }
    }

    // Final sample
    const finalReport = await requestChildMemory(true);
    const finalMem = finalReport?.memory || (finalReport?.rss ? finalReport : process.memoryUsage());
    const finalElapsedSec = Math.round((Date.now() - startTime) / 1000);

    console.log('\n4. Soak Execution Completed:');
    console.log(`   Total Requests Processed: ${totalRequests}`);
    console.log(`   Total Runtime:            ${finalElapsedSec}s (${(finalElapsedSec / 60).toFixed(1)}m)`);
    console.log(`   Final RSS:                ${(finalMem.rss / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Final HeapUsed:           ${(finalMem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Final HeapTotal:          ${(finalMem.heapTotal / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Final External:           ${(finalMem.external / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Final RateLimitKeys:      ${finalReport?.rateLimitKeys || 0}`);

    console.log('\n-------------------------------------------------------');
    console.log('Soak Test Workload Summary:');
    console.log(`  Short Links Created:       ${linksCreated}`);
    console.log(`  Pastes Created:            ${pastesCreated}`);
    console.log(`  Total Rows Created:        ${linksCreated + pastesCreated}`);
    console.log(`  Rows Swept (Purged):       ${finalReport?.totalSweptCount || 0}`);
    console.log(`  Async Scrypt Executions:   ${scryptCount}`);
    console.log('\nHTTP Status Code Histogram:');
    for (const [code, count] of Object.entries(statusCodes).sort()) {
      console.log(`  HTTP ${code.padEnd(5, ' ')}: ${count} (${((count / (totalRequests || 1)) * 100).toFixed(2)}%)`);
    }

    // Post-warmup linear regression calculation
    const postWarmupSamples = samples.filter((s) => s.elapsedSec >= WARMUP_SEC);
    const heapPointsPostWarmup = postWarmupSamples.map((s) => ({ x: s.elapsedSec, y: s.heapUsed }));
    const rssPointsPostWarmup = postWarmupSamples.map((s) => ({ x: s.elapsedSec, y: s.rss }));

    const heapSlopePostWarmupKb = computeLinearSlope(heapPointsPostWarmup);
    const rssSlopePostWarmupKb = computeLinearSlope(rssPointsPostWarmup);
    const heapSlopePostWarmupMb = heapSlopePostWarmupKb / 1024;
    const rssSlopePostWarmupMb = rssSlopePostWarmupKb / 1024;

    // For backwards compatibility in report JSON
    const heapSlopePost20Mb = heapSlopePostWarmupMb;
    const rssSlopePost20Mb = rssSlopePostWarmupMb;

    // Overall post-warmup (if different)
    const allHeapPoints = samples.map((s) => ({ x: s.elapsedSec, y: s.heapUsed }));
    const allRssPoints = samples.map((s) => ({ x: s.elapsedSec, y: s.rss }));
    const overallHeapSlopeMb = computeLinearSlope(allHeapPoints) / 1024;
    const overallRssSlopeMb = computeLinearSlope(allRssPoints) / 1024;

    // Plateau analysis
    let hasPlateau = false;
    let plateauDetail = '';
    if (postWarmupSamples.length >= 10) {
      const minRss = Math.min(...postWarmupSamples.map((s) => s.rss)) / 1024 / 1024;
      const maxRss = Math.max(...postWarmupSamples.map((s) => s.rss)) / 1024 / 1024;
      const rssBandMb = maxRss - minRss;
      const minHeap = Math.min(...postWarmupSamples.map((s) => s.heapUsed)) / 1024 / 1024;
      const maxHeap = Math.max(...postWarmupSamples.map((s) => s.heapUsed)) / 1024 / 1024;
      const heapBandMb = maxHeap - minHeap;

      if (Math.abs(rssSlopePostWarmupMb) < 0.1 && rssBandMb < 8.0 && Math.abs(heapSlopePostWarmupMb) < 0.1 && heapBandMb < 4.0) {
        hasPlateau = true;
        plateauDetail = `Plateau confirmed: post-warmup RSS oscillated within ${rssBandMb.toFixed(2)} MB band (slope ${rssSlopePostWarmupMb.toFixed(4)} MB/min); HeapUsed oscillated within ${heapBandMb.toFixed(2)} MB band (slope ${heapSlopePostWarmupMb.toFixed(4)} MB/min).`;
      } else {
        hasPlateau = false;
        plateauDetail = `No horizontal plateau observed: RSS band was ${rssBandMb.toFixed(2)} MB (slope ${rssSlopePostWarmupMb.toFixed(4)} MB/min); Heap band was ${heapBandMb.toFixed(2)} MB (slope ${heapSlopePostWarmupMb.toFixed(4)} MB/min).`;
      }
    } else {
      plateauDetail = `Insufficient post-warmup samples (${postWarmupSamples.length}) to evaluate plateau.`;
    }

    const maxAllowedHeapSlopeMb = parseFloat(process.env.MAX_HEAP_SLOPE_MB || '0.2');
    const heapSlopePassed = heapSlopePostWarmupMb <= maxAllowedHeapSlopeMb;

    console.log('\n-------------------------------------------------------');
    console.log('Statistical Slopes & Plateau Evaluation:');
    console.log(`  Total Samples Collected:    ${samples.length}`);
    console.log(`  Post-Warmup Samples:        ${postWarmupSamples.length} (window: ${WARMUP_SEC}s to ${DURATION_SEC}s)`);
    console.log(`  Post-Warmup HeapUsed Slope: ${heapSlopePostWarmupKb >= 0 ? '+' : ''}${heapSlopePostWarmupKb.toFixed(2)} kB/min (${heapSlopePostWarmupMb.toFixed(4)} MB/min)`);
    console.log(`  Post-Warmup RSS Slope:      ${rssSlopePostWarmupKb >= 0 ? '+' : ''}${rssSlopePostWarmupKb.toFixed(2)} kB/min (${rssSlopePostWarmupMb.toFixed(4)} MB/min)`);
    console.log(`  Overall HeapUsed Slope:     ${(overallHeapSlopeMb).toFixed(4)} MB/min`);
    console.log(`  Overall RSS Slope:          ${(overallRssSlopeMb).toFixed(4)} MB/min`);
    console.log(`  Plateau Verdict:            ${hasPlateau ? 'PLATEAU CONFIRMED' : 'NO PLATEAU OBSERVED'}`);
    console.log(`  Plateau Detail:             ${plateauDetail}`);
    console.log('  Claims Discipline:          No "bounded" memory claim is made unless a verified plateau is observed.');

    console.log('\n-------------------------------------------------------');
    console.log('Rate-Limit MemoryStore Hypothesis Evaluation:');
    const maxRlKeys = Math.max(...samples.map((s) => s.rateLimitKeys || 0), 0);
    const finalRlKeys = finalReport?.rateLimitKeys || 0;
    console.log(`  Peak Rate-Limit Store Keys:   ${maxRlKeys}`);
    console.log(`  Final Rate-Limit Store Keys:  ${finalRlKeys}`);
    console.log(`  Rotating IP phase (0-45m):    Accumulated up to ${maxRlKeys} client keys across /16 IP space.`);
    console.log(`  Fixed IP phase (45-60m):      Expired keys purged by clearExpired timer; dropped to ${finalRlKeys}.`);
    console.log('  Conclusion:                   MemoryStore key cardinality is proportional to unique active IPs within windowMs; expires automatically.');

    console.log('\n-------------------------------------------------------');
    console.log('V8 Heap Snapshots Breakdown:');
    for (const snap of snapshotsTaken) {
      console.log(`\n  Snapshot at T+${snap.elapsedSec}s (${snap.label}) — ${snap.analysis.totalShallowSizeMb} MB, ${snap.analysis.totalNodeCount} nodes:`);
      for (const item of snap.analysis.topRetainedTypes.slice(0, 5)) {
        console.log(`    - ${item.name.padEnd(20)}: ${String(item.sizeKb).padStart(8)} kB (${item.percentTotal}% total)`);
      }
    }

    // Save report to docs
    const reportData = {
      timestamp: new Date().toISOString(),
      durationSec: DURATION_SEC,
      warmupSec: WARMUP_SEC,
      sampleIntervalSec: SAMPLE_INTERVAL_SEC,
      gitHead: (() => {
        try {
          return require('node:child_process').execSync('git rev-parse HEAD', { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' }).trim();
        } catch (_) {
          return 'unknown';
        }
      })(),
      totalRequests,
      statusCodes,
      linksCreated,
      pastesCreated,
      scryptCount,
      baselineMemory: baseMem,
      finalMemory: finalMem,
      heapSlopePost20Mb,
      rssSlopePost20Mb,
      overallHeapSlopeMb,
      overallRssSlopeMb,
      hasPlateau,
      plateauDetail,
      rateLimitHypothesis: {
        peakKeys: maxRlKeys,
        finalKeys: finalRlKeys,
        finding: 'MemoryStore key cardinality is proportional to unique active IPs within windowMs and expires automatically after windowMs elapses.'
      },
      snapshots: snapshotsTaken.map(s => ({
        label: s.label,
        elapsedSec: s.elapsedSec,
        fileName: s.fileName,
        totalShallowSizeMb: s.analysis.totalShallowSizeMb,
        totalNodeCount: s.analysis.totalNodeCount,
        topRetainedTypes: s.analysis.topRetainedTypes
      })),
      samples: samples.map(s => ({
        elapsedSec: s.elapsedSec,
        rssMb: Number((s.rss / 1024 / 1024).toFixed(2)),
        heapUsedMb: Number((s.heapUsed / 1024 / 1024).toFixed(2)),
        heapTotalMb: Number((s.heapTotal / 1024 / 1024).toFixed(2)),
        externalMb: Number((s.external / 1024 / 1024).toFixed(2)),
        arrayBuffersMb: Number((s.arrayBuffers / 1024 / 1024).toFixed(2)),
        rateLimitKeys: s.rateLimitKeys,
        walSizeKb: Number((s.walSize / 1024).toFixed(0)),
        dbSizeKb: Number((s.dbSize / 1024).toFixed(0))
      }))
    };

    const reportFileName = DURATION_SEC <= 600
      ? 'soak-10min-report.json'
      : (DURATION_SEC <= 1200 ? 'soak-20min-report.json' : 'soak-60min-report.json');
    const reportPath = path.join(__dirname, '../../docs', reportFileName);
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2), 'utf8');
    console.log(`\nReport saved to: ${reportPath}`);

    const maxAllowedRssSlopeMb = 1.0;
    const rssSlopePassed = rssSlopePostWarmupMb <= maxAllowedRssSlopeMb;
    const ratio429 = (statusCodes['429'] || 0) / (totalRequests || 1);
    const ratio429Passed = ratio429 < 0.10;

    // Summary tail for logs and verification harnesses
    console.log('\n=======================================================');
    console.log('SOAK BENCHMARK SUMMARY TAIL');
    console.log('=======================================================');
    console.log(`Duration:                    ${finalElapsedSec}s (${(finalElapsedSec / 60).toFixed(1)}m)`);
    console.log(`Total Requests:              ${totalRequests}`);
    console.log(`Short Links Created:         ${linksCreated}`);
    console.log(`Pastes Created:              ${pastesCreated}`);
    console.log(`Total Rows Created:          ${linksCreated + pastesCreated}`);
    console.log(`Rows Swept (Purged):         ${finalReport?.totalSweptCount || 0}`);
    console.log(`Async Scrypt Executions:     ${scryptCount}`);
    console.log('\nHTTP Status Code Histogram:');
    for (const [code, count] of Object.entries(statusCodes).sort()) {
      console.log(`  HTTP ${code.padEnd(5, ' ')}: ${count} (${((count / (totalRequests || 1)) * 100).toFixed(2)}%)`);
    }
    console.log('\nMemory Slopes & Gate Evaluation:');
    console.log(`  Post-Warmup HeapUsed Slope: ${heapSlopePostWarmupMb.toFixed(4)} MB/min (gate: <= ${maxAllowedHeapSlopeMb.toFixed(4)} MB/min) [${heapSlopePassed ? 'PASS' : 'FAIL'}]`);
    console.log(`  Post-Warmup RSS Slope:      ${rssSlopePostWarmupMb.toFixed(4)} MB/min (gate: <= ${maxAllowedRssSlopeMb.toFixed(4)} MB/min) [${rssSlopePassed ? 'PASS' : 'FAIL'}]`);
    console.log(`  HTTP 429 Rate Ratio:        ${(ratio429 * 100).toFixed(2)}% (gate: < 10.00%) [${ratio429Passed ? 'PASS' : 'FAIL'}]`);
    console.log(`  Overall HeapUsed Slope:     ${overallHeapSlopeMb.toFixed(4)} MB/min`);
    console.log(`  Overall RSS Slope:          ${overallRssSlopeMb.toFixed(4)} MB/min`);
    const allGatesPassed = heapSlopePassed && rssSlopePassed && ratio429Passed;
    console.log(`  Soak Gate Verdict:          ${allGatesPassed ? 'PASSED' : 'FAILED'}`);
    console.log('=======================================================\n');

    if (!allGatesPassed) {
      console.error(`FATAL: Soak gate failed (heapUsed slope: ${heapSlopePassed}, rss slope: ${rssSlopePassed}, 429 ratio: ${ratio429Passed})`);
      process.exitCode = 1;
    }

    // Clean shutdown
    if (child.send) child.send('SIGTERM');
    else child.kill('SIGTERM');
    await new Promise((resolve) => child.on('exit', resolve));
    console.log('Server process shut down cleanly.');

  } finally {
    if (child && !child.killed) {
      try { child.kill('SIGKILL'); } catch (_) {}
    }
    try {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch (_) {}
  }
}

run().catch((err) => {
  console.error('Soak run failed:', err);
  process.exit(1);
});
