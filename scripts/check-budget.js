// scripts/check-budget.js
// Measures gzip size per page and static bundles against performance budget (Task P6.8, PERF-003).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT_DIR = path.join(__dirname, '..');

const BUDGETS = [
  {
    name: 'Landing Page (public/index.html)',
    files: ['public/index.html'],
    limitKb: 35
  },
  {
    name: 'Shared Theme CSS (tools/shared/theme.css)',
    files: ['tools/shared/theme.css'],
    limitKb: 10
  },
  {
    name: 'Shared Theme Switcher (tools/shared/theme-switcher.js)',
    files: ['tools/shared/theme-switcher.js'],
    limitKb: 6
  },
  {
    name: 'Shared QRCode Library (tools/shared/qrcode.min.js)',
    files: ['tools/shared/qrcode.min.js'],
    limitKb: 15
  },
  {
    name: 'TinyURL Tool (tools/tinyurl/public/index.html + app.js)',
    files: ['tools/tinyurl/public/index.html', 'tools/tinyurl/public/app.js'],
    limitKb: 40
  },
  {
    name: 'QR Studio Tool (tools/qr/public/index.html + app.js)',
    files: ['tools/qr/public/index.html', 'tools/qr/public/app.js'],
    limitKb: 40
  },
  {
    name: 'Pastebin Tool (tools/paste/public/index.html + app.js)',
    files: ['tools/paste/public/index.html', 'tools/paste/public/app.js'],
    limitKb: 40
  },
  {
    name: 'Drop Tool (tools/drop/public/index.html + app.js)',
    files: ['tools/drop/public/index.html', 'tools/drop/public/app.js'],
    limitKb: 40
  },
  {
    name: 'Health Dashboard (tools/health/public/index.html + app.js)',
    files: ['tools/health/public/index.html', 'tools/health/public/app.js'],
    limitKb: 40
  },
  {
    name: 'Tools Hub (tools/public/index.html)',
    files: ['tools/public/index.html'],
    limitKb: 30
  }
];

function checkBudgets() {
  console.log('=======================================================');
  console.log('Performance Page Weight Budget Check (Gzipped)');
  console.log('=======================================================\n');

  let passed = 0;
  let failed = 0;

  for (const item of BUDGETS) {
    let totalRawBytes = 0;
    let totalGzipBytes = 0;

    for (const relFile of item.files) {
      const fullPath = path.join(ROOT_DIR, relFile);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath);
        totalRawBytes += content.length;
        const gzipped = zlib.gzipSync(content);
        totalGzipBytes += gzipped.length;
      }
    }

    const gzipKb = (totalGzipBytes / 1024).toFixed(2);
    const rawKb = (totalRawBytes / 1024).toFixed(2);

    if (totalGzipBytes > item.limitKb * 1024) {
      console.error(`[FAIL] ${item.name}: ${gzipKb} KiB gzipped (${rawKb} KiB raw) exceeds budget of ${item.limitKb} KiB`);
      failed++;
    } else {
      console.log(`[PASS] ${item.name}: ${gzipKb} KiB gzipped (${rawKb} KiB raw) <= ${item.limitKb} KiB limit`);
      passed++;
    }
  }

  console.log(`\nBudget Summary: ${passed}/${passed + failed} items within budget.`);
  if (failed > 0) {
    console.error(`FAILED: ${failed} items exceeded size budget.`);
    process.exit(1);
  } else {
    console.log('SUCCESS: All pages and bundles satisfy the performance budget.');
  }
}

if (require.main === module) {
  checkBudgets();
}

module.exports = {
  BUDGETS,
  checkBudgets
};
