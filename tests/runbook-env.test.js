// tests/runbook-env.test.js
// Validates that docs/RUNBOOK.md env blocks and tables match application code exactly,
// that ORIGIN_VERIFY_SECRET is unset in the production template, and that
// verify-proxy-trust.js rejects CLI secret flags.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { extractVarsFromCode, extractVarsFromRunbook } = require('../scripts/check-env-docs');

describe('Task R9.2 Item 1: RUNBOOK Environment Variables & Proxy Trust Verification', () => {
  const rootDir = path.resolve(__dirname, '..');
  const runbookPath = path.join(rootDir, 'docs', 'RUNBOOK.md');
  const runbookContent = fs.readFileSync(runbookPath, 'utf8');

  test('RUNBOOK documents every environment variable found in application code', () => {
    const codeVars = extractVarsFromCode();
    const runbookVars = new Set(extractVarsFromRunbook());

    const missingInRunbook = codeVars.filter((v) => !runbookVars.has(v));
    expect(missingInRunbook).toEqual([]);
  });

  test('RUNBOOK env template contains no unknown environment variables', () => {
    const codeVars = new Set(extractVarsFromCode());
    // Known ops/orchestration variables permitted in production .env
    const allowedOpsVars = new Set(['TUNNEL_TOKEN']);

    // Extract variables specifically defined in the Section 2.1 ```env block
    const envBlockMatch = runbookContent.match(/```env([\s\S]*?)```/);
    expect(envBlockMatch).not.toBeNull();

    const envBlockContent = envBlockMatch[1];
    const envBlockVars = new Set();
    for (const match of envBlockContent.matchAll(/(?:^|\n)(?:#\s*)?([A-Z0-9_]+)=/g)) {
      envBlockVars.add(match[1]);
    }

    const unknownVars = [...envBlockVars].filter(
      (v) => !codeVars.has(v) && !allowedOpsVars.has(v)
    );
    expect(unknownVars).toEqual([]);
  });

  test('ORIGIN_VERIFY_SECRET is UNSET by default in RUNBOOK production template with required comment', () => {
    // Assert the comment is present
    expect(runbookContent).toContain(
      '# ORIGIN_VERIFY_SECRET: Unset by default; enable ONLY with a Cloudflare Transform Rule'
    );
    // Assert that ORIGIN_VERIFY_SECRET is commented out or empty, not assigned a dummy value
    expect(runbookContent).toMatch(/#\s*ORIGIN_VERIFY_SECRET=\s*(?:\n|$)/);
    expect(runbookContent).not.toMatch(/^ORIGIN_VERIFY_SECRET=[^\s#]+/m);
  });

  test('RUNBOOK specifies exact code variable names', () => {
    const requiredKeys = [
      'PORT',
      'SQLITE_DB_PATH',
      'TURNSTILE_SITE_KEY',
      'TURNSTILE_SECRET_KEY',
      'GOOGLE_SAFE_BROWSING_KEY',
      'R2_BUCKET_NAME',
      'R2_BUCKET_BACKUPS',
      'REQUIRE_REPLICATION',
      'TUNNEL_TOKEN'
    ];
    for (const key of requiredKeys) {
      expect(runbookContent).toContain(`\`${key}\``);
    }
  });

  test('verify-proxy-trust.js rejects secrets passed via CLI argument --admin-token', () => {
    const scriptPath = path.join(rootDir, 'scripts', 'ops', 'verify-proxy-trust.js');
    const result = spawnSync(process.execPath, [scriptPath, '--admin-token', 'leaked_secret'], {
      encoding: 'utf8'
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Passing secrets via CLI arguments (--admin-token) is strictly prohibited');
  });

  test('verify-proxy-trust.js rejects secrets passed via CLI argument --origin-secret', () => {
    const scriptPath = path.join(rootDir, 'scripts', 'ops', 'verify-proxy-trust.js');
    const result = spawnSync(process.execPath, [scriptPath, '--origin-secret', 'leaked_secret'], {
      encoding: 'utf8'
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Passing secrets via CLI arguments (--origin-secret) is strictly prohibited');
  });
});
