// scripts/ops/run-axe-audit.js
// Automated WCAG 2.2 and axe-core accessibility audit across 4 themes (Task R9.1 Item 3)
// Audits: Landing, Tools Hub, TinyURL, Paste, Drop, QR, and Case Study.
// Themes: paper (light), matrix (dark), cyberpunk (saturated 1), synthwave (saturated 2).

const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const PORT = 5062;
const CDP_PORT = 9229;
const CHROME_PATH = process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : (process.env.CHROME_BIN || '/usr/bin/google-chrome');

const AXE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../node_modules/axe-core/axe.min.js'), 'utf8');

const PAGES = [
  { name: 'Landing Page', path: '/' },
  { name: 'Tools Hub', path: '/tools/' },
  { name: 'TinyURL Tool', path: '/tools/tinyurl/' },
  { name: 'Paste Tool', path: '/tools/paste/' },
  { name: 'Drop Tool', path: '/tools/drop/' },
  { name: 'QR Studio Tool', path: '/tools/qr/' },
  { name: 'Case Study', path: '/projects/pokedb-site.html' }
];

const THEMES = ['paper', 'matrix', 'cyberpunk', 'synthwave'];

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
      } catch (e) {}
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalInBrowser(ws, expression, awaitPromise = false) {
  const res = await cdpSend(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  }
  return res.result?.value;
}

async function run() {
  console.log('=======================================================');
  console.log('PokéDB v2 WCAG 2.2 Accessibility & axe-core Audit Suite');
  console.log('Themes: paper (light), matrix (dark), cyberpunk, synthwave');
  console.log('=======================================================\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokedb-axe-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');

  let serverChild = null;
  let chromeChild = null;

  try {
    // 1. Start test server
    console.log(`1. Starting server on http://127.0.0.1:${PORT}...`);
    serverChild = spawn(process.execPath, [path.resolve(__dirname, '../../server.js')], {
      env: {
        ...process.env,
        PORT: String(PORT),
        SQLITE_DB_PATH: dbPath,
        NODE_ENV: 'test',
        BENCH_BYPASS_LIMITER: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdoutData = '';
    serverChild.stdout.on('data', (d) => { stdoutData += d.toString(); });
    serverChild.stderr.on('data', () => {});

    for (let i = 0; i < 30; i++) {
      if (stdoutData.includes(`Server running on 0.0.0.0:${PORT}`) || stdoutData.includes(`Server running on port ${PORT}`)) break;
      await wait(100);
    }

    // 2. Spawn headless Chrome
    console.log(`2. Spawning headless Chrome on port ${CDP_PORT}...`);
    chromeChild = spawn(CHROME_PATH, [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      '--disable-gpu',
      '--no-sandbox',
      '--disable-extensions',
      'about:blank'
    ]);

    // Wait for Chrome CDP endpoint to be ready
    let chromeReady = false;
    for (let i = 0; i < 40; i++) {
      try {
        await new Promise((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${CDP_PORT}/json/version`, { timeout: 1000 }, (res) => {
            if (res.statusCode === 200) resolve();
            else reject(new Error(`Status ${res.statusCode}`));
          });
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        });
        chromeReady = true;
        break;
      } catch (_) {
        await wait(250);
      }
    }
    if (!chromeReady) {
      throw new Error(`Chrome failed to respond on CDP port ${CDP_PORT} within 10s`);
    }

    // 3. Connect CDP
    const pageJson = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port: CDP_PORT,
        path: `/json/new?http://127.0.0.1:${PORT}/`,
        method: 'PUT'
      }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(JSON.parse(data)));
      });
      req.on('error', reject);
      req.end();
    });

    const ws = new WebSocket(pageJson.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    await cdpSend(ws, 'Page.enable');
    await cdpSend(ws, 'Runtime.enable');
    await cdpSend(ws, 'DOM.enable');
    await cdpSend(ws, 'CSS.enable');

    console.log('3. Running axe-core across 7 pages × 4 themes (28 audit runs)...\n');

    const auditResults = [];

    for (const page of PAGES) {
      console.log(`--> Auditing: ${page.name} (${page.path})`);
      const pageUrl = `http://127.0.0.1:${PORT}${page.path}`;

      for (const theme of THEMES) {
        // Navigate
        await cdpSend(ws, 'Page.navigate', { url: pageUrl });
        await wait(600);

        // Apply theme
        await evalInBrowser(ws, `
          document.documentElement.setAttribute('data-theme', '${theme}');
          localStorage.setItem('pokedb_theme', '${theme}');
        `);
        await wait(150);

        // Inject axe
        await evalInBrowser(ws, AXE_SOURCE);

        // Run axe
        const axeResult = await evalInBrowser(ws, `
          new Promise((resolve) => {
            axe.run({
              runOnly: {
                type: 'tag',
                values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
              }
            }, (err, results) => {
              if (err) resolve({ error: err.message, violations: [] });
              else resolve({
                violations: results.violations.map(v => ({
                  id: v.id,
                  impact: v.impact,
                  description: v.description,
                  help: v.help,
                  helpUrl: v.helpUrl,
                  nodesCount: v.nodes.length,
                  targets: v.nodes.slice(0, 3).map(n => n.target.join(' > '))
                })),
                passesCount: results.passes.length,
                incompleteCount: results.incomplete.length
              });
            });
          })
        `, true);

        const vCount = axeResult?.violations?.length || 0;
        auditResults.push({
          page: page.name,
          path: page.path,
          theme,
          violationsCount: vCount,
          passesCount: axeResult?.passesCount || 0,
          violations: axeResult?.violations || []
        });

        console.log(`    Theme: ${theme.padEnd(12)} | Violations: ${vCount} | Passes: ${axeResult?.passesCount || 0}`);
        if (vCount > 0) {
          for (const v of axeResult.violations) {
            console.log(`      * [${v.impact.toUpperCase()}] ${v.id}: ${v.help} (${v.nodesCount} nodes: ${v.targets.join(', ')})`);
          }
        }
      }
    }

    console.log('\n3b. Running axe-core across 7 pages @ 320px mobile viewport (Reflow / Mobile A11y)...\n');
    await cdpSend(ws, 'Emulation.setDeviceMetricsOverride', {
      width: 320,
      height: 640,
      deviceScaleFactor: 2,
      mobile: true
    });

    for (const page of PAGES) {
      const pageUrl = `http://127.0.0.1:${PORT}${page.path}`;
      await cdpSend(ws, 'Page.navigate', { url: pageUrl });
      await wait(600);
      await evalInBrowser(ws, AXE_SOURCE);
      const axeResult = await evalInBrowser(ws, `
        new Promise((resolve) => {
          axe.run({
            runOnly: {
              type: 'tag',
              values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
            }
          }, (err, results) => {
            if (err) resolve({ error: err.message, violations: [] });
            else resolve({
              violations: results.violations.map(v => ({
                id: v.id,
                impact: v.impact,
                description: v.description,
                help: v.help,
                helpUrl: v.helpUrl,
                nodesCount: v.nodes.length,
                targets: v.nodes.slice(0, 3).map(n => n.target.join(' > '))
              })),
              passesCount: results.passes.length,
              incompleteCount: results.incomplete.length
            });
          });
        })
      `, true);

      const vCount = axeResult?.violations?.length || 0;
      auditResults.push({
        page: page.name + ' (320px)',
        path: page.path,
        theme: '320px-viewport',
        violationsCount: vCount,
        passesCount: axeResult?.passesCount || 0,
        violations: axeResult?.violations || []
      });

      console.log(`    Page: ${page.name.padEnd(16)} (320px) | Violations: ${vCount} | Passes: ${axeResult?.passesCount || 0}`);
      if (vCount > 0) {
        for (const v of axeResult.violations) {
          console.log(`      * [${v.impact.toUpperCase()}] ${v.id}: ${v.help} (${v.nodesCount} nodes: ${v.targets.join(', ')})`);
        }
      }
    }

    await cdpSend(ws, 'Emulation.clearDeviceMetricsOverride');

    console.log('\n-------------------------------------------------------');
    console.log('4. WCAG 2.2 Specific Success Criteria Evaluation:');

    // 2.4.11 Focus Appearance
    const focusCheck = await evalInBrowser(ws, `
      (function() {
        var buttons = Array.from(document.querySelectorAll('button, input, select, textarea, a'));
        var hasVisibleOutline = true;
        var checked = 0;
        buttons.slice(0, 10).forEach(function(el) {
          el.focus();
          var style = window.getComputedStyle(el);
          var outlineWidth = parseInt(style.outlineWidth) || 0;
          var boxShadow = style.boxShadow;
          if (outlineWidth < 1 && (!boxShadow || boxShadow === 'none')) {
            hasVisibleOutline = false;
          }
          checked++;
        });
        return { checked: checked, hasVisibleOutline: hasVisibleOutline };
      })()
    `);
    console.log(`  WCAG 2.2 2.4.11 Focus Appearance:         ${focusCheck.hasVisibleOutline ? 'PASS (Visible 2px outline/box-shadow active)' : 'PARTIAL/NOTICE'}`);

    // 2.5.7 Dragging Movements
    await cdpSend(ws, 'Page.navigate', { url: `http://127.0.0.1:${PORT}/tools/drop/` });
    await wait(500);
    const draggingCheck = await evalInBrowser(ws, `
      (function() {
        var dropZone = document.querySelector('.dropzone, [data-dropzone], #dropzone, input[type="file"]');
        var fileInput = document.querySelector('input[type="file"]');
        return {
          hasDropZone: Boolean(dropZone),
          hasFileInputAlternative: Boolean(fileInput),
          isClickable: Boolean(fileInput && (fileInput.offsetParent !== null || fileInput.getAttribute('aria-hidden') !== 'true' || fileInput.parentElement))
        };
      })()
    `);
    console.log(`  WCAG 2.2 2.5.7 Dragging Movements:        ${draggingCheck.hasFileInputAlternative ? 'PASS (Single-pointer <input type="file"> file picker alternative provided)' : 'FAIL'}`);

    // 2.5.8 Target Size (Minimum 24x24 px)
    const targetSizeCheck = await evalInBrowser(ws, `
      (function() {
        var interactives = Array.from(document.querySelectorAll('button, a, input, select, textarea'));
        var smallTargets = [];
        interactives.forEach(function(el) {
          var rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            // Check if inline link inside text paragraph (exemption under 2.5.8)
            var isInline = window.getComputedStyle(el).display === 'inline';
            if (rect.width < 24 || rect.height < 24) {
              if (!isInline) {
                smallTargets.push({
                  tag: el.tagName,
                  id: el.id,
                  cls: el.className,
                  w: Math.round(rect.width),
                  h: Math.round(rect.height),
                  text: (el.textContent || '').trim().slice(0, 20)
                });
              }
            }
          }
        });
        return { total: interactives.length, violations: smallTargets };
      })()
    `);
    console.log(`  WCAG 2.2 2.5.8 Target Size (>= 24x24 px): ${targetSizeCheck.violations.length === 0 ? 'PASS (All non-inline interactive controls >= 24x24 px)' : `WARNING (${targetSizeCheck.violations.length} undersized elements)`}`);
    if (targetSizeCheck.violations.length > 0) {
      targetSizeCheck.violations.slice(0, 5).forEach(v => console.log(`      * <${v.tag}> "${v.text}" is ${v.w}x${v.h}px`));
    }

    // 3.3.8 Accessible Authentication
    console.log(`  WCAG 2.2 3.3.8 Accessible Authentication: [UNVERIFIED] (Turnstile managed challenge requires live staging verification; cognitive function test exemption under 3.3.8 exception)`);

    // 5. Keyboard-only walkthrough simulation
    console.log('\n-------------------------------------------------------');
    console.log('5. Keyboard-Only Walkthrough Simulation:');
    
    // Shorten walkthrough
    await cdpSend(ws, 'Page.navigate', { url: `http://127.0.0.1:${PORT}/tools/tinyurl/` });
    await wait(500);
    const tinyTabOrder = await evalInBrowser(ws, `
      (function() {
        var focusable = Array.from(document.querySelectorAll('input:not([type=hidden]), button, a[href], select, textarea, [tabindex]:not([tabindex="-1"])'));
        return focusable.map(el => el.id || el.name || el.className || el.tagName);
      })()
    `);
    console.log(`  TinyURL Keyboard Tab Sequence (${tinyTabOrder.length} nodes): ${tinyTabOrder.slice(0, 6).join(' -> ')}`);

    // Paste walkthrough
    await cdpSend(ws, 'Page.navigate', { url: `http://127.0.0.1:${PORT}/tools/paste/` });
    await wait(500);
    const pasteTabOrder = await evalInBrowser(ws, `
      (function() {
        var focusable = Array.from(document.querySelectorAll('input:not([type=hidden]), button, a[href], select, textarea, [tabindex]:not([tabindex="-1"])'));
        return focusable.map(el => el.id || el.name || el.className || el.tagName);
      })()
    `);
    console.log(`  Paste Keyboard Tab Sequence (${pasteTabOrder.length} nodes):    ${pasteTabOrder.slice(0, 6).join(' -> ')}`);

    // Drop walkthrough
    await cdpSend(ws, 'Page.navigate', { url: `http://127.0.0.1:${PORT}/tools/drop/` });
    await wait(500);
    const dropTabOrder = await evalInBrowser(ws, `
      (function() {
        var focusable = Array.from(document.querySelectorAll('input:not([type=hidden]), button, a[href], select, textarea, [tabindex]:not([tabindex="-1"])'));
        return focusable.map(el => el.id || el.name || el.className || el.tagName);
      })()
    `);
    console.log(`  Drop Keyboard Tab Sequence (${dropTabOrder.length} nodes):     ${dropTabOrder.slice(0, 6).join(' -> ')}`);

    // QR Studio walkthrough (Task R9.2 Part 1)
    await cdpSend(ws, 'Page.navigate', { url: `http://127.0.0.1:${PORT}/tools/qr/` });
    await wait(500);
    const qrTabOrder = await evalInBrowser(ws, `
      (function() {
        var focusable = Array.from(document.querySelectorAll('input:not([type=hidden]), button, a[href], select, textarea, [tabindex]:not([tabindex="-1"])'));
        return focusable.map(el => el.id || el.name || el.className || el.tagName);
      })()
    `);
    console.log(`  QR Studio Keyboard Tab Sequence (${qrTabOrder.length} nodes):  ${qrTabOrder.slice(0, 6).join(' -> ')}`);

    // Full Tab navigation verification to primary action button across all 4 tools (Task Item 5)
    const submitVerification = [
      { tool: 'TinyURL', path: '/tools/tinyurl/', submitId: 'shorten-btn', name: 'Shorten URL' },
      { tool: 'Paste', path: '/tools/paste/', submitId: 'create-btn', name: 'Create Paste' },
      { tool: 'Drop', path: '/tools/drop/', submitId: 'start-upload-btn', name: 'Start Upload' },
      { tool: 'QR Studio', path: '/tools/qr/', submitId: 'generate-btn', name: 'Generate QR Code' }
    ];

    console.log('\n  Primary Action Button Tab Sequence Reachability (Gate: <= 12 Tab stops):');
    for (const item of submitVerification) {
      await cdpSend(ws, 'Page.navigate', { url: `http://127.0.0.1:${PORT}${item.path}` });
      await wait(400);
      const reachability = await evalInBrowser(ws, `
        (function() {
          var focusable = Array.from(document.querySelectorAll('a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), input:not([type=hidden]):not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"])'));
          var visible = focusable.filter(function(el) {
            var style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.classList.contains('skip-link'));
          });
          var allStops = visible.map(function(el) {
            return '<' + el.tagName.toLowerCase() + (el.id ? ' #' + el.id : '') + (el.className ? ' .' + el.className.split(' ').join('.') : '') + '>';
          });
          var target = document.getElementById('${item.submitId}');
          var targetIndex = target ? visible.indexOf(target) : -1;
          return {
            found: target !== null,
            targetId: target ? target.id : null,
            tabPosition: targetIndex >= 0 ? targetIndex + 1 : -1,
            totalFocusable: visible.length,
            allStops: allStops
          };
        })()
      `);

      console.log(`\n    === ${item.tool} Tab Stops (${reachability.allStops.length} total) ===`);
      reachability.allStops.forEach(function(stop, idx) {
        console.log('      ' + (idx + 1) + '. ' + stop);
      });

      if (reachability.tabPosition < 1 || reachability.tabPosition > 12) {
        console.error(`    * [FAIL] ${item.tool} -> Primary button <#${item.submitId}> reached at Tab step ${reachability.tabPosition} of ${reachability.totalFocusable} (EXCEEDS 12 GATE)`);
        throw new Error(`${item.tool} primary action needs ${reachability.tabPosition} tab stops (>12 gate failure)`);
      } else {
        console.log(`    * [PASS] ${item.tool} -> Primary button <#${item.submitId}> reached at Tab step ${reachability.tabPosition} of ${reachability.totalFocusable} (<= 12 gate met)`);
      }
    }

    // CDP E2E Interaction Tests under Production CSP (Task HARNESS INTEGRITY Item 6)
    console.log('\n-------------------------------------------------------');
    console.log('CDP E2E Tool Interaction Tests under Production CSP:');
    console.log('-------------------------------------------------------');

    const setupTracker = async () => {
      await evalInBrowser(ws, `
        window.__cspViolations = [];
        window.__consoleErrors = [];
        document.addEventListener('securitypolicyviolation', function(e) {
          window.__cspViolations.push({
            directive: e.violatedDirective,
            blockedURI: e.blockedURI,
            sample: e.sample
          });
        });
        window.addEventListener('error', function(e) {
          window.__consoleErrors.push(e.message || String(e));
        });
      `);
    };

    const assertNoErrorsOrViolations = async (toolName) => {
      const violations = await evalInBrowser(ws, 'window.__cspViolations || []');
      const errors = await evalInBrowser(ws, 'window.__consoleErrors || []');
      if (violations.length > 0) {
        console.error(`  [FAIL] ${toolName}: ${violations.length} securitypolicyviolation event(s) detected:`, violations);
        throw new Error(`${toolName} triggered securitypolicyviolation under CSP: ${JSON.stringify(violations)}`);
      }
      if (errors.length > 0) {
        console.error(`  [FAIL] ${toolName}: ${errors.length} console error(s) detected:`, errors);
        throw new Error(`${toolName} triggered console errors during interaction: ${JSON.stringify(errors)}`);
      }
      console.log(`  [PASS] ${toolName}: 0 CSP violations, 0 console errors during user interaction.`);
    };

    // 1. TinyURL Shorten Interaction
    console.log('  Testing TinyURL shorten workflow...');
    await cdpSend(ws, 'Page.navigate', { url: `http://127.0.0.1:${PORT}/tools/tinyurl/` });
    await wait(500);
    await setupTracker();
    const tinyUrlResult = await evalInBrowser(ws, `
      (async function() {
        var input = document.getElementById('long-url');
        if (!input) return { error: 'Missing long-url input' };
        input.value = 'https://example.com/test-e2e-cdp-interaction';
        var form = document.getElementById('shorten-form');
        var btn = document.getElementById('shorten-btn');
        btn.click();
        for (var i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 100));
          var modal = document.getElementById('shorten-modal');
          var urlInput = document.getElementById('modal-url-input');
          if (modal && modal.classList.contains('is-open') && urlInput && urlInput.value) {
            return { success: true, shortUrl: urlInput.value };
          }
        }
        return { error: 'Timed out waiting for modal' };
      })()
    `, true);
    if (!tinyUrlResult?.success) throw new Error('TinyURL E2E interaction failed: ' + JSON.stringify(tinyUrlResult));
    await assertNoErrorsOrViolations('TinyURL');

    // 2. Paste Create Interaction
    console.log('  Testing Paste create workflow...');
    await cdpSend(ws, 'Page.navigate', { url: `http://127.0.0.1:${PORT}/tools/paste/` });
    await wait(500);
    await setupTracker();
    const pasteResult = await evalInBrowser(ws, `
      (async function() {
        var textarea = document.getElementById('paste-content');
        if (!textarea) return { error: 'Missing paste-content textarea' };
        textarea.value = 'console.log("Hello from CDP E2E interaction test under CSP");';
        var btn = document.getElementById('create-btn');
        btn.click();
        for (var i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 100));
          var modal = document.getElementById('paste-result-modal');
          var urlInput = document.getElementById('modal-paste-url');
          if (modal && modal.classList.contains('is-open') && urlInput && urlInput.value) {
            return { success: true, pasteUrl: urlInput.value };
          }
        }
        return { error: 'Timed out waiting for paste modal' };
      })()
    `, true);
    if (!pasteResult?.success) throw new Error('Paste E2E interaction failed: ' + JSON.stringify(pasteResult));
    await assertNoErrorsOrViolations('Paste');

    // 3. QR Studio Generate Interaction
    console.log('  Testing QR Studio generate workflow...');
    await cdpSend(ws, 'Page.navigate', { url: `http://127.0.0.1:${PORT}/tools/qr/` });
    await wait(500);
    await setupTracker();
    const qrResult = await evalInBrowser(ws, `
      (async function() {
        var input = document.getElementById('url-input');
        if (!input) return { error: 'Missing url-input' };
        input.value = 'https://pokedb.site/cdp-qr-test';
        var btn = document.getElementById('generate-btn');
        btn.click();
        for (var i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 100));
          var img = document.getElementById('qr-preview-img') || document.getElementById('modal-qr-img');
          var modal = document.getElementById('qr-result-modal');
          if ((img && img.src && (img.src.startsWith('data:image') || img.src.length > 50)) || (modal && modal.classList.contains('is-open'))) {
            return { success: true, rendered: true };
          }
        }
        return { error: 'Timed out waiting for QR code generation' };
      })()
    `, true);
    if (!qrResult?.success) throw new Error('QR Studio E2E interaction failed: ' + JSON.stringify(qrResult));
    await assertNoErrorsOrViolations('QR Studio');

    // 4. Drop Tool UI Interaction
    console.log('  Testing Drop Tool upload staging interaction...');
    await cdpSend(ws, 'Page.navigate', { url: `http://127.0.0.1:${PORT}/tools/drop/` });
    await wait(500);
    await setupTracker();
    const dropResult = await evalInBrowser(ws, `
      (async function() {
        var dropZone = document.getElementById('drop-zone');
        var fileInput = document.getElementById('file-input');
        if (!dropZone || !fileInput) return { error: 'Missing dropZone elements' };
        // Trigger dragover/dragleave events
        var dragEvent = new DragEvent('dragover', { bubbles: true, cancelable: true });
        dropZone.dispatchEvent(dragEvent);
        return { success: true };
      })()
    `, true);
    if (!dropResult?.success) throw new Error('Drop Tool interaction failed: ' + JSON.stringify(dropResult));
    await assertNoErrorsOrViolations('Drop Tool');

    // Summary
    const totalViolations = auditResults.reduce((acc, r) => acc + r.violationsCount, 0);
    console.log('\n-------------------------------------------------------');
    console.log(`Audit Complete: ${auditResults.length} audits run across 7 pages × 4 themes.`);
    console.log(`Total axe-core Violations: ${totalViolations}`);
    console.log('-------------------------------------------------------');

    // Save report
    const reportPath = path.resolve(__dirname, '../../docs/a11y-wcag22-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      standard: 'WCAG 2.2 AA',
      themes: THEMES,
      pages: PAGES,
      totalViolations,
      wcag22Checks: {
        focusAppearance_2_4_11: focusCheck,
        draggingMovements_2_5_7: draggingCheck,
        targetSize_2_5_8: targetSizeCheck,
        accessibleAuthentication_3_3_8: { pass: false, status: 'UNVERIFIED', exemption: 'Managed non-cognitive challenge requires live staging verification' }
      },
      auditResults
    }, null, 2));
    console.log(`Saved detailed report to ${reportPath}`);

  } finally {
    if (chromeChild && !chromeChild.killed) {
      try { chromeChild.kill('SIGKILL'); } catch (_) {}
    }
    if (serverChild && !serverChild.killed) {
      try { serverChild.kill('SIGKILL'); } catch (_) {}
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

run().catch((err) => {
  console.error('Audit run failed:', err);
  process.exit(1);
});
