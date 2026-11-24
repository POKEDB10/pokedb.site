const http = require('http');
const { ensureServer } = require('./_server');

const CONCURRENCY = 30;
const TIMEOUT_MS = 3000;

function sendPasteCreate(baseUrl, index) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const payload = JSON.stringify({
      title: `Concurrent Paste ${index}`,
      content: `Content for concurrent paste #${index} - ${Date.now()}`,
      language: 'javascript'
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
          'X-Forwarded-For': `10.42.0.${index + 1}`
        },
        timeout: TIMEOUT_MS
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          const duration = Date.now() - startTime;
          resolve({
            index,
            status: res.statusCode,
            duration,
            body: body.slice(0, 100),
            error: res.statusCode >= 200 && res.statusCode < 300 ? null : `HTTP ${res.statusCode}`
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      const duration = Date.now() - startTime;
      resolve({
        index,
        status: 'TIMEOUT',
        duration,
        error: `Request timed out after ${TIMEOUT_MS}ms (Promise abandoned/hung in server debounce)`
      });
    });

    req.on('error', (err) => {
      const duration = Date.now() - startTime;
      resolve({
        index,
        status: 'ERROR',
        duration,
        error: err.message
      });
    });

    req.write(payload);
    req.end();
  });
}

async function main() {
  const server = await ensureServer();
  try {
    console.log(`=======================================================`);
    console.log(`PERF-001 Concurrency Reproduction: 30 Parallel Creates`);
    console.log(`Target: ${server.baseUrl}/api/paste/create`);
    console.log(`Timeout: ${TIMEOUT_MS}ms per request`);
    console.log(`=======================================================`);

    const overallStart = Date.now();
    const promises = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      promises.push(sendPasteCreate(server.baseUrl, i));
    }

    const results = await Promise.all(promises);
    const overallElapsed = Date.now() - overallStart;

    let successCount = 0;
    let timeoutCount = 0;
    let errorCount = 0;

    console.log('\nResults per request:');
    for (const r of results) {
      if (r.status === 200) {
        successCount++;
        console.log(`  Req #${String(r.index).padStart(2)}: HTTP 200 (${r.duration}ms)`);
      } else if (r.status === 'TIMEOUT') {
        timeoutCount++;
        console.log(`  Req #${String(r.index).padStart(2)}: TIMEOUT after ${r.duration}ms [HANG REPRODUCED]`);
      } else {
        errorCount++;
        console.log(`  Req #${String(r.index).padStart(2)}: ${r.status} (${r.duration}ms) - ${r.error}`);
      }
    }

    console.log(`\n-------------------------------------------------------`);
    console.log(`Summary:`);
    console.log(`  Total requests sent:   ${CONCURRENCY}`);
    console.log(`  Successful (200 OK):   ${successCount}`);
    console.log(`  Timed out (hung):      ${timeoutCount}`);
    console.log(`  Other errors:          ${errorCount}`);
    console.log(`  Total elapsed wall:    ${overallElapsed}ms`);
    console.log(`-------------------------------------------------------`);

    if (successCount === CONCURRENCY && overallElapsed < 2000) {
      console.log(`PASS: All ${CONCURRENCY} concurrent requests succeeded in ${overallElapsed}ms (< 2000ms target).`);
      process.exit(0);
    } else {
      console.log(`FAIL (PERF-001 reproduced): Expected 30/30 in <2000ms. Got ${successCount}/${CONCURRENCY} in ${overallElapsed}ms.`);
      // Exit 1 if assertion required, or return 1
      if (process.argv.includes('--assert')) {
        process.exit(1);
      }
    }
  } finally {
    await server.stop();
  }
}

main().catch((err) => {
  console.error('Fatal benchmark error:', err);
  process.exit(1);
});
