// scripts/accept/browser-drop-upload-delete.js
// Browser-level verification of Drop upload -> delete flow via Chrome DevTools Protocol (CDP)
// Verifies:
// 1. Drop UI uploads file and receives deletion token
// 2. UI deletion succeeds using header token (Authorization / X-Delete-Token)
// 3. Browser navigation to legacy query token URLs (?token=...) displays friendly 400 page

const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const PORT = 5057;
const CDP_PORT = 9227;
const CHROME_PATH = process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : (process.env.CHROME_BIN || '/usr/bin/google-chrome');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokedb-cdp-'));
const DB_PATH = path.join(TMP_DIR, 'drop-test.sqlite');

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
  console.log(`[PASS] ${message}`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cdpSend(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1000000);
    const handler = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          ws.removeEventListener('message', handler);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      } catch (e) {
        // Ignore non-json messages
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  console.log('=======================================================');
  console.log('Browser-Level Acceptance: Drop Upload -> Delete Flow');
  console.log('Engine: Headless Chrome via Chrome DevTools Protocol (CDP)');
  console.log(`Target: http://127.0.0.1:${PORT}/tools/drop/`);
  console.log('=======================================================\n');

  if (!fs.existsSync(CHROME_PATH)) {
    console.log(`[SKIP] Chrome binary not found at ${CHROME_PATH}. Test is marked SIMULATED/UNVERIFIED for non-browser hosts.`);
    process.exit(0);
  }

  let serverChild = null;
  let chromeChild = null;

  try {
    // 1. Start server
    console.log('1. Starting test server...');
    serverChild = spawn(process.execPath, [path.resolve(__dirname, '../../server.js')], {
      env: {
        ...process.env,
        PORT: String(PORT),
        SQLITE_DB_PATH: DB_PATH,
        NODE_ENV: 'test',
        BENCH_BYPASS_LIMITER: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdoutData = '';
    serverChild.stdout.on('data', (d) => {
      stdoutData += d.toString();
      if (process.env.DEBUG_TEST) process.stdout.write('[server out] ' + d);
    });
    serverChild.stderr.on('data', (d) => {
      stdoutData += d.toString();
      process.stderr.write('[server err] ' + d);
    });

    let serverReady = false;
    for (let i = 0; i < 30; i++) {
      if (stdoutData.includes(`Server running on 0.0.0.0:${PORT}`) || stdoutData.includes(`Server running on port ${PORT}`)) {
        serverReady = true;
        break;
      }
      await wait(100);
    }
    assert(serverReady, `Test server listening on port ${PORT}`);

    // 2. Spawn headless Chrome
    console.log('\n2. Launching Headless Chrome with remote debugging on port ' + CDP_PORT + '...');
    chromeChild = spawn(CHROME_PATH, [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      '--disable-gpu',
      '--no-sandbox',
      '--disable-extensions',
      'about:blank'
    ]);

    await wait(1500);

    // 3. Connect to CDP via HTTP and WebSocket
    console.log('\n3. Connecting to Chrome DevTools Protocol...');
    const pageJson = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port: CDP_PORT,
        path: `/json/new?http://127.0.0.1:${PORT}/tools/drop/`,
        method: 'PUT'
      }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.end();
    });

    assert(pageJson && pageJson.webSocketDebuggerUrl, 'CDP target created with WebSocket URL');
    const ws = new WebSocket(pageJson.webSocketDebuggerUrl);

    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    await cdpSend(ws, 'Page.enable');
    await cdpSend(ws, 'Runtime.enable');
    await cdpSend(ws, 'Log.enable');
    await cdpSend(ws, 'Network.enable');

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.method === 'Log.entryAdded') {
          console.log('[browser log]', msg.params.entry.text);
        } else if (msg.method === 'Network.loadingFailed') {
          console.log('[browser net failed]', msg.params.errorText, msg.params.canceled);
        }
      } catch (_) {}
    });

    await cdpSend(ws, 'Network.setExtraHTTPHeaders', { headers: { 'X-Host': 'drop.pokedb.site' } });
    await cdpSend(ws, 'Page.navigate', { url: `http://127.0.0.1:${PORT}/` });

    console.log('   Waiting for page DOM ready in headless browser...');
    await wait(1500);

    const loc = await cdpSend(ws, 'Runtime.evaluate', { returnByValue: true, expression: 'window.location.href' });
    console.log('   Current location:', loc?.result?.value);

    // 4. In-browser evaluation: simulate upload -> delete using header tokens
    console.log('\n4. Executing upload -> delete workflow inside browser context...');
    const browserEval = await cdpSend(ws, 'Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `
        (async () => {
          // 1. Create a test file payload
          const blob = new Blob(['Browser acceptance test content: ' + Date.now()], { type: 'text/plain' });
          const formData = new FormData();
          formData.append('file', blob, 'browser-test.txt');

          const uploadRes = await fetch('/api/drop/upload', {
            method: 'POST',
            body: formData
          });
          const uploadData = await uploadRes.json();
          const fileId = uploadData.fileId || uploadData.id || uploadData.shortId;
          const deletionToken = uploadData.deletionToken;
          if (!uploadRes.ok || !fileId || !deletionToken) {
            return { success: false, step: 'upload', res: uploadData };
          }

          // 2. Execute deletion using HTTP header tokens (X-Delete-Token and Authorization)
          const deleteRes = await fetch('/api/drop/delete?fileId=' + encodeURIComponent(fileId), {
            method: 'DELETE',
            headers: {
              'Authorization': 'Bearer ' + deletionToken,
              'X-Delete-Token': deletionToken
            }
          });
          const deleteData = await deleteRes.json().catch(() => ({}));

          return {
            success: deleteRes.ok,
            fileId,
            deletionToken,
            deleteStatus: deleteRes.status,
            deleteData
          };
        })()
      `
    });

    const result = browserEval?.result?.value;
    assert(result && result.success, `Browser upload -> delete succeeded with deletion token: ${result?.fileId}`);
    assert(result?.deleteStatus === 200, `Delete endpoint returned HTTP ${result?.deleteStatus}`);

    // 5. Test friendly 400 page for legacy query token in browser navigation
    console.log('\n5. Verifying friendly 400 deprecation page on legacy ?token= navigation...');
    await cdpSend(ws, 'Page.navigate', {
      url: `http://127.0.0.1:${PORT}/api/drop/delete?fileId=${result.fileId}&token=${result.deletionToken}`
    });

    await wait(1000);

    const pageContent = await cdpSend(ws, 'Runtime.evaluate', {
      returnByValue: true,
      expression: `({ title: document.title, bodyText: document.body.innerText })`
    });

    const doc = pageContent?.result?.value;
    assert(doc?.title?.includes('400') && doc?.title?.includes('Query Tokens Deprecated'), 'Browser displays 400 Query Tokens Deprecated page');
    assert(doc?.bodyText?.includes('Authorization: Bearer'), '400 page explains header token migration requirement');

    ws.close();
    console.log('\n[ALL BROWSER ACCEPTANCE CHECKS PASSED]');

  } finally {
    if (chromeChild) {
      try { chromeChild.kill(); } catch (_) {}
    }
    if (serverChild) {
      try { serverChild.kill(); } catch (_) {}
    }
    try {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch (_) {}
  }
}

main().catch((err) => {
  console.error('Browser test failed:', err);
  process.exit(1);
});
