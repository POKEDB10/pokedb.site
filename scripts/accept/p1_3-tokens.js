// scripts/accept/p1_3-tokens.js
// Acceptance script for Task P1.3 (SEC-003: Token handling)

const { ensureServer } = require('../bench/_server.js');
const http = require('node:http');

const PORT = 5051;
const ADMIN_TOKEN = 'test-accept-admin-token-secret-12345';

function request(method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path,
        method,
        headers: {
          Host: 'drop.pokedb.site',
          ...headers
        }
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(body); } catch (_) {}
          resolve({ status: res.statusCode, headers: res.headers, body, json });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  console.log('=======================================================');
  console.log('Phase 1.3 Token Handling Acceptance Verification');
  console.log(`Target: http://127.0.0.1:${PORT}`);
  console.log('=======================================================\n');

  const server = await ensureServer({ port: PORT, env: { ADMIN_TOKEN } });
  let passed = 0;
  let failed = 0;

  function assert(condition, message, detail = '') {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message} - ${detail}`);
      failed++;
    }
  }

  try {
    // 1. GET /api/drop/list?token=x -> 400 query_tokens_forbidden
    const res1 = await request('GET', '/api/drop/list?token=x');
    assert(
      res1.status === 400 && res1.json?.error === 'query_tokens_forbidden',
      'GET /api/drop/list?token=x rejected with 400 query_tokens_forbidden',
      `Got status ${res1.status}, body: ${res1.body}`
    );

    // 2. GET /api/drop/list?admin_token=x -> 400 query_tokens_forbidden
    const res2 = await request('GET', '/api/drop/list?admin_token=x');
    assert(
      res2.status === 400 && res2.json?.error === 'query_tokens_forbidden',
      'GET /api/drop/list?admin_token=x rejected with 400 query_tokens_forbidden',
      `Got status ${res2.status}, body: ${res2.body}`
    );

    // 3. DELETE /api/drop/delete?fileId=test&token=x -> 400 query_tokens_forbidden
    const res3 = await request('DELETE', '/api/drop/delete?fileId=test&token=x');
    assert(
      res3.status === 400 && res3.json?.error === 'query_tokens_forbidden',
      'DELETE /api/drop/delete?fileId=test&token=x rejected with 400 query_tokens_forbidden',
      `Got status ${res3.status}, body: ${res3.body}`
    );

    // 4. DELETE /api/drop/delete?fileId=test&delete_token=x -> 400 query_tokens_forbidden
    const res4 = await request('DELETE', '/api/drop/delete?fileId=test&delete_token=x');
    assert(
      res4.status === 400 && res4.json?.error === 'query_tokens_forbidden',
      'DELETE /api/drop/delete?fileId=test&delete_token=x rejected with 400 query_tokens_forbidden',
      `Got status ${res4.status}, body: ${res4.body}`
    );

    // 5. GET /api/drop/list with no token -> 403
    const res5 = await request('GET', '/api/drop/list');
    assert(
      res5.status === 403,
      'GET /api/drop/list without token header returns 403',
      `Got status ${res5.status}`
    );

    // 6. GET /api/drop/list with invalid X-Admin-Token -> 403
    const res6 = await request('GET', '/api/drop/list', { 'X-Admin-Token': 'wrong-admin-token' });
    assert(
      res6.status === 403,
      'GET /api/drop/list with invalid X-Admin-Token returns 403',
      `Got status ${res6.status}`
    );

    // 7. GET /api/drop/list with invalid Bearer token -> 403
    const res7 = await request('GET', '/api/drop/list', { 'Authorization': 'Bearer wrong-admin-token' });
    assert(
      res7.status === 403,
      'GET /api/drop/list with invalid Bearer token returns 403',
      `Got status ${res7.status}`
    );

    // 8. GET /api/drop/list with valid X-Admin-Token header passes auth (not 400 and not 403)
    const res8 = await request('GET', '/api/drop/list', { 'X-Admin-Token': ADMIN_TOKEN });
    assert(
      res8.status !== 400 && res8.status !== 403,
      'GET /api/drop/list with valid X-Admin-Token passes auth check',
      `Got status ${res8.status}`
    );

    // 9. GET /api/drop/list with valid Authorization: Bearer header passes auth (not 400 and not 403)
    const res9 = await request('GET', '/api/drop/list', { 'Authorization': `Bearer ${ADMIN_TOKEN}` });
    assert(
      res9.status !== 400 && res9.status !== 403,
      'GET /api/drop/list with valid Bearer token passes auth check',
      `Got status ${res9.status}`
    );

    // 10. DELETE /api/drop/delete without token header -> 403
    const res10 = await request('DELETE', '/api/drop/delete?fileId=nonexistent');
    assert(
      res10.status === 403,
      'DELETE /api/drop/delete without token header returns 403',
      `Got status ${res10.status}`
    );

    console.log('\n-------------------------------------------------------');
    console.log(`Total checks: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
    console.log('-------------------------------------------------------');

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    server.stop();
  }
}

run().catch((err) => {
  console.error('Acceptance run failed:', err);
  process.exit(1);
});
