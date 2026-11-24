// scripts/ops/run-lighthouse.mjs
// Automated Lighthouse Mobile + Desktop Audit for PokéDB v2 (Task R9.2 Item 8)
// Uses default simulated throttling (mobile 4x CPU slowdown, 150ms RTT, 1.6384 Mbps down; desktop 1x CPU, 40ms RTT, 10 Mbps down).
// Audits 7 core pages, extracts failing Best-Practices audits, and evaluates SEO and Core Web Vitals.

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 5063;

const THROTTLING_CONFIG = {
  mobile: {
    method: 'simulate',
    cpuSlowdownMultiplier: 4,
    rttMs: 150,
    throughputKbps: 1638.4,
    requestLatencyMs: 562.5,
    downloadThroughputKbps: 1638.4,
    uploadThroughputKbps: 750
  },
  desktop: {
    method: 'simulate',
    cpuSlowdownMultiplier: 1,
    rttMs: 40,
    throughputKbps: 10240,
    requestLatencyMs: 0,
    downloadThroughputKbps: 10240,
    uploadThroughputKbps: 10240
  }
};

const PAGES = [
  { name: 'Landing Page', path: '/' },
  { name: 'Tools Hub', path: '/tools/' },
  { name: 'TinyURL Tool', path: '/tools/tinyurl/' },
  { name: 'Paste Tool', path: '/tools/paste/' },
  { name: 'Drop Tool', path: '/tools/drop/' },
  { name: 'QR Studio Tool', path: '/tools/qr/' },
  { name: 'Case Study', path: '/projects/pokedb-site.html' }
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log('=======================================================');
  console.log('PokéDB v2 Automated Lighthouse Audit Suite (R9.2 Item 8)');
  console.log('Throttling Configuration: Default Simulated Throttling');
  console.log('  - Mobile:  4x CPU slowdown, 150ms RTT, 1.6 Mbps down, 750 kbps up (Simulated 4G)');
  console.log('  - Desktop: 1x CPU slowdown, 40ms RTT, 10 Mbps down/up');
  console.log('Targets: Mobile & Desktop across 7 core pages (14 runs)');
  console.log('=======================================================\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokedb-lh-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');

  let serverChild = null;
  let chrome = null;

  try {
    // 1. Start server
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
    console.log('   Server online.');

    // 2. Launch Chrome
    console.log('2. Launching headless Chrome via chrome-launcher...');
    chrome = await chromeLauncher.launch({
      chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu']
    });
    console.log(`   Chrome running on port ${chrome.port}.`);

    // 3. Run audits
    console.log('\n3. Executing Lighthouse audits...\n');
    const results = [];
    const bestPracticesFailingAudits = new Map();
    const consoleErrorItems = [];
    const inspectorIssueItems = [];

    for (const page of PAGES) {
      const pageUrl = `http://127.0.0.1:${PORT}${page.path}`;
      console.log(`--> Testing ${page.name} (${page.path})`);

      for (const formFactor of ['mobile', 'desktop']) {
        const auditSingleRun = async (targetUrl, targetFormFactor) => {
          const isDesktop = targetFormFactor === 'desktop';
          const config = {
            extends: 'lighthouse:default',
            settings: {
              onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
              formFactor: isDesktop ? 'desktop' : 'mobile',
              screenEmulation: isDesktop ? {
                mobile: false,
                width: 1350,
                height: 940,
                deviceScaleFactor: 1,
                disabled: false
              } : {
                mobile: true,
                width: 412,
                height: 823,
                deviceScaleFactor: 1.75,
                disabled: false
              },
              throttlingMethod: 'simulate',
              throttling: isDesktop ? THROTTLING_CONFIG.desktop : THROTTLING_CONFIG.mobile
            }
          };

          const runnerResult = await lighthouse(targetUrl, {
            port: chrome.port,
            output: 'json',
            logLevel: 'error'
          }, config);

          const lhrResult = runnerResult?.lhr;
          const perfScore = lhrResult?.categories?.performance?.score;
          if (perfScore === null || perfScore === undefined || perfScore <= 0) {
            throw new Error(`Null, missing, or zero performance score received: ${perfScore}`);
          }
          return lhrResult;
        };

        let lhr = null;
        try {
          lhr = await auditSingleRun(pageUrl, formFactor);
        } catch (firstErr) {
          console.warn(`    [RETRY] First audit attempt failed for ${page.name} (${formFactor}): ${firstErr.message}. Retrying once...`);
          await wait(1000);
          try {
            lhr = await auditSingleRun(pageUrl, formFactor);
            console.log(`    [RETRY SUCCESS] Second attempt succeeded for ${page.name} (${formFactor}).`);
          } catch (retryErr) {
            console.error(`    [FAIL] Retry failed for ${page.name} (${formFactor}): ${retryErr.message}`);
            throw new Error(`Lighthouse audit failed for ${page.name} (${formFactor}) after single retry: ${retryErr.message}`);
          }
        }

        const perf = Math.round((lhr.categories.performance?.score || 0) * 100);
        const a11y = Math.round((lhr.categories.accessibility?.score || 0) * 100);
        const bp = Math.round((lhr.categories['best-practices']?.score || 0) * 100);
        const seo = Math.round((lhr.categories.seo?.score || 0) * 100);

        const lcp = Math.round(lhr.audits['largest-contentful-paint']?.numericValue || 0);
        const tbt = Math.round(lhr.audits['total-blocking-time']?.numericValue || 0);
        const cls = parseFloat((lhr.audits['cumulative-layout-shift']?.numericValue || 0).toFixed(3));
        const inp = lhr.audits['interaction-to-next-paint'] ? Math.round(lhr.audits['interaction-to-next-paint'].numericValue || 0) : 'N/A';

        // Check for failing Best-Practices audits
        const bpCategory = lhr.categories['best-practices'];
        if (bpCategory && bpCategory.auditRefs) {
          for (const ref of bpCategory.auditRefs) {
            const audit = lhr.audits[ref.id];
            if (audit && audit.score !== null && audit.score < 1) {
              if (!bestPracticesFailingAudits.has(ref.id)) {
                bestPracticesFailingAudits.set(ref.id, {
                  id: ref.id,
                  title: audit.title,
                  score: audit.score,
                  explanation: audit.explanation || audit.description || '',
                  affectedPages: []
                });
              }
              bestPracticesFailingAudits.get(ref.id).affectedPages.push(`${page.name} (${formFactor})`);
            }
          }
        }

        // Specifically track errors-in-console and inspector-issues
        const eicAudit = lhr.audits['errors-in-console'];
        if (eicAudit && (eicAudit.score === null || eicAudit.score < 1 || (eicAudit.details?.items && eicAudit.details.items.length > 0))) {
          const items = eicAudit.details?.items || [];
          for (const it of items) {
            consoleErrorItems.push({
              page: page.name,
              path: page.path,
              formFactor,
              url: it.sourceLocation?.url || it.url || pageUrl,
              text: it.description || it.source || JSON.stringify(it)
            });
          }
        }

        const iiAudit = lhr.audits['inspector-issues'];
        if (iiAudit && (iiAudit.score === null || iiAudit.score < 1 || (iiAudit.details?.items && iiAudit.details.items.length > 0))) {
          const items = iiAudit.details?.items || [];
          for (const it of items) {
            inspectorIssueItems.push({
              page: page.name,
              path: page.path,
              formFactor,
              url: pageUrl,
              text: it.issueType || JSON.stringify(it)
            });
          }
        }

        results.push({
          page: page.name,
          path: page.path,
          formFactor,
          scores: { perf, a11y, bp, seo },
          metrics: { lcpMs: lcp, tbtMs: tbt, cls, inp }
        });

        console.log(`    [${formFactor.toUpperCase().padEnd(7)}] Perf: ${String(perf).padStart(3)} | A11y: ${String(a11y).padStart(3)} | BP: ${String(bp).padStart(3)} | SEO: ${String(seo).padStart(3)} | LCP: ${String(lcp).padStart(4)}ms | TBT: ${String(tbt).padStart(3)}ms | CLS: ${cls}`);
      }
    }

    console.log('\n-------------------------------------------------------');
    console.log('Lighthouse Audit Summary Table (Default Simulated Throttling):');
    console.log('-------------------------------------------------------');
    console.log('| Page | Device | Perf | A11y | BP | SEO | LCP (ms) | TBT (ms) | CLS |');
    console.log('|---|---|---|---|---|---|---|---|---|');
    for (const r of results) {
      console.log(`| ${r.page} | ${r.formFactor} | ${r.scores.perf} | ${r.scores.a11y} | ${r.scores.bp} | ${r.scores.seo} | ${r.metrics.lcpMs} | ${r.metrics.tbtMs} | ${r.metrics.cls} |`);
    }

    console.log('\n-------------------------------------------------------');
    console.log('Failing Best-Practices Audits Analysis:');
    if (bestPracticesFailingAudits.size === 0) {
      console.log('  No failing audits in Best Practices category (100% score).');
    } else {
      for (const [id, info] of bestPracticesFailingAudits.entries()) {
        console.log(`  - Audit ID: ${id}`);
        console.log(`    Title:       ${info.title}`);
        console.log(`    Score:       ${info.score}`);
        console.log(`    Explanation: ${info.explanation}`);
        console.log(`    Affected:    ${info.affectedPages.slice(0, 3).join(', ')}${info.affectedPages.length > 3 ? ` (+${info.affectedPages.length - 3} more)` : ''}`);
      }
    }

    console.log('\n-------------------------------------------------------');
    console.log('Console Errors & Inspector Issues Detailed Breakdown:');
    if (consoleErrorItems.length === 0) {
      console.log('  [PASS] errors-in-console: 0 items detected.');
    } else {
      console.log(`  [FAIL] errors-in-console: ${consoleErrorItems.length} items detected:`);
      for (const item of consoleErrorItems) {
        console.log(`    - Page: ${item.page} (${item.formFactor}) | URL: ${item.url} | Text: ${item.text}`);
      }
    }

    if (inspectorIssueItems.length === 0) {
      console.log('  [PASS] inspector-issues: 0 items detected.');
    } else {
      console.log(`  [FAIL] inspector-issues: ${inspectorIssueItems.length} items detected:`);
      for (const item of inspectorIssueItems) {
        console.log(`    - Page: ${item.page} (${item.formFactor}) | URL: ${item.url} | Text: ${item.text}`);
      }
    }

    if (results.length !== 14) {
      console.error(`\n[FAIL] Incomplete Lighthouse audit: Expected exactly 14 runs across 7 pages, but got ${results.length}.`);
      process.exitCode = 1;
    }
    const nonNumeric = results.filter(r => typeof r.scores.perf !== 'number' || r.scores.perf <= 0);
    if (nonNumeric.length > 0) {
      console.error(`\n[FAIL] Non-numeric or zero performance score detected in ${nonNumeric.length} runs:`, nonNumeric.map(r => `${r.page} (${r.formFactor}): ${r.scores.perf}`));
      process.exitCode = 1;
    }

    // Save report to docs
    const reportPath = path.resolve(__dirname, '../../docs/lighthouse-audit-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      throttlingConfig: THROTTLING_CONFIG,
      failingBestPracticesAudits: Array.from(bestPracticesFailingAudits.values()),
      consoleErrorItems,
      inspectorIssueItems,
      results
    }, null, 2));
    console.log(`\nSaved raw Lighthouse results to ${reportPath}`);

    if (consoleErrorItems.length > 0 || inspectorIssueItems.length > 0) {
      console.error(`\n[FAIL] Lighthouse audit failed: ${consoleErrorItems.length} console errors and ${inspectorIssueItems.length} inspector issues detected.`);
      process.exitCode = 1;
    }

  } finally {
    if (chrome) {
      try { await chrome.kill(); } catch (_) {}
    }
    if (serverChild && !serverChild.killed) {
      try { serverChild.kill('SIGKILL'); } catch (_) {}
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

run().catch((err) => {
  console.error('Lighthouse run failed:', err);
  process.exit(1);
});
