# PokéDB v2 Automated Evidence Verification Summary (LATEST.md)

**Run Timestamp:** `2026-11-19T14-39-17-373Z`  
**Git Commit:** `0ab8d5b769e7219966cf1b69d61402c503f2448a`  
**Git Tree Clean:** `true`  
**Overall Verification Gate:** **PASSED (18/20 passed)**  

## Verification Checks Summary Table

| # | Check Name | Status | Duration | SHA-256 (Log) | Evidence Log |
|---|---|:---:|:---:|---|---|
| **01** | git-status-clean | `PASS` | 0.2s | `41159dfab82d...` | [`01-git-status-clean.log`](docs/evidence/2026-11-19T14-39-17-373Z/01-git-status-clean.log) |
| **02** | git-tests-diff | `PASS` | 0.3s | `eeb5a63f91d3...` | [`02-git-tests-diff.log`](docs/evidence/2026-11-19T14-39-17-373Z/02-git-tests-diff.log) |
| **03** | node-syntax-check | `PASS` | 10.0s | `104c27104034...` | [`03-node-syntax-check.log`](docs/evidence/2026-11-19T14-39-17-373Z/03-node-syntax-check.log) |
| **04** | npm-test | `PASS` | 59.2s | `d46b8289270d...` | [`04-npm-test.log`](docs/evidence/2026-11-19T14-39-17-373Z/04-npm-test.log) |
| **05** | coverage-src | `PASS` | 58.4s | `1718a8b83b3c...` | [`05-coverage-src.log`](docs/evidence/2026-11-19T14-39-17-373Z/05-coverage-src.log) |
| **06** | npm-audit | `PASS` | 10.2s | `38b6cbd067eb...` | [`06-npm-audit.log`](docs/evidence/2026-11-19T14-39-17-373Z/06-npm-audit.log) |
| **07** | check-env-docs | `PASS` | 0.1s | `5e9f266fe38d...` | [`07-check-env-docs.log`](docs/evidence/2026-11-19T14-39-17-373Z/07-check-env-docs.log) |
| **08** | check-placeholders | `PASS` | 0.1s | `ec3074a3670e...` | [`08-check-placeholders.log`](docs/evidence/2026-11-19T14-39-17-373Z/08-check-placeholders.log) |
| **09** | check-budget | `PASS` | 0.1s | `cae25f15c9f4...` | [`09-check-budget.log`](docs/evidence/2026-11-19T14-39-17-373Z/09-check-budget.log) |
| **10** | audit-contrast | `PASS` | 0.1s | `a37bdefb630d...` | [`10-audit-contrast.log`](docs/evidence/2026-11-19T14-39-17-373Z/10-audit-contrast.log) |
| **11** | runbook-env-test | `PASS` | 2.3s | `64b317120af8...` | [`11-runbook-env-test.log`](docs/evidence/2026-11-19T14-39-17-373Z/11-runbook-env-test.log) |
| **12** | check-compose-ports | `PASS` | 0.1s | `798923a45baa...` | [`12-check-compose-ports.log`](docs/evidence/2026-11-19T14-39-17-373Z/12-check-compose-ports.log) |
| **13** | migration-rehearsal | `PASS` | 0.3s | `a678b66f9721...` | [`13-migration-rehearsal.log`](docs/evidence/2026-11-19T14-39-17-373Z/13-migration-rehearsal.log) |
| **14** | axe-accessibility | `PASS` | 44.3s | `b75596f3ff09...` | [`14-axe-accessibility.log`](docs/evidence/2026-11-19T14-39-17-373Z/14-axe-accessibility.log) |
| **15** | lighthouse-audit | `PASS` | 134.0s | `1ccda0f0a3fb...` | [`15-lighthouse-audit.log`](docs/evidence/2026-11-19T14-39-17-373Z/15-lighthouse-audit.log) |
| **16** | host-mode-seo | `PASS` | 4.8s | `ba1a5c2bfaa4...` | [`16-host-mode-seo.log`](docs/evidence/2026-11-19T14-39-17-373Z/16-host-mode-seo.log) |
| **17** | bench-redirect | `PASS` | 77.2s | `905c5924f140...` | [`17-bench-redirect.log`](docs/evidence/2026-11-19T14-39-17-373Z/17-bench-redirect.log) |
| **18** | soak-test | `STALE-ARTIFACT` | 0.1s | `e73eed3948ca...` | [`18-soak-test.log`](docs/evidence/2026-11-19T14-39-17-373Z/18-soak-test.log) |
| **19** | verify-docker | `SKIPPED (NO DOCKER)` | 0.6s | `15b90fbc7395...` | [`19-verify-docker.log`](docs/evidence/2026-11-19T14-39-17-373Z/19-verify-docker.log) |
| **20** | verify-staging | `PASS [UNVERIFIED]` | 2.3s | `6b1691b3d38e...` | [`20-verify-staging.log`](docs/evidence/2026-11-19T14-39-17-373Z/20-verify-staging.log) |

---

## Raw Log Tails (-20 lines per check)

### Check 01: Git Working Tree Cleanliness Check (`PASS`)
*Log File:* [`docs/evidence/2026-11-19T14-39-17-373Z/01-git-status-clean.log`](docs/evidence/2026-11-19T14-39-17-373Z/01-git-status-clean.log)  
*SHA-256:* `41159dfab82d881508394055c71cc9a30b62f77ec482d1484636c2e51228350a`  

```text
PASS: Git working tree is clean on branch v2/overhaul.
```

### Check 02: Test Files List & ce594ac Diff Audit (`PASS`)
*Log File:* [`docs/evidence/2026-11-19T14-39-17-373Z/02-git-tests-diff.log`](docs/evidence/2026-11-19T14-39-17-373Z/02-git-tests-diff.log)  
*SHA-256:* `eeb5a63f91d32d5f35ff4dc6bd6082e63d518fca02fa60fe96fb72f6e785809d`  

```text
tests/migration.test.js            | 112 +++++++++
 tests/ops-verify.test.js           |  56 +++++
 tests/ops.test.js                  | 130 ++++++++++
 tests/phase1.test.js               | 331 ++++++++++++++++++++++++++
 tests/phase5.test.js               | 475 +++++++++++++++++++++++++++++++++++++
 tests/phase6.test.js               | 231 ++++++++++++++++++
 tests/phase7.test.js               | 247 +++++++++++++++++++
 tests/phase8.test.js               | 315 ++++++++++++++++++++++++
 tests/r2-offline.test.js           | 284 ++++++++++++++++++++++
 tests/registry.test.js             |  67 ++++++
 tests/runbook-env.test.js          |  89 +++++++
 tests/runbook-exec.test.js         | 163 +++++++++++++
 tests/security.test.js             |  18 +-
 tests/server.test.js               |  47 ++--
 tests/skeletons.test.js            |  94 ++++++++
 tests/sqlite.test.js               | 296 +++++++++++++++++++++++
 tests/url-security-offline.test.js | 352 +++++++++++++++++++++++++++
 26 files changed, 5084 insertions(+), 37 deletions(-)

=== TEST_DEVIATIONS.md present: true ===
```

### Check 03: Node Syntax Verification (--check) (`PASS`)
*Log File:* [`docs/evidence/2026-11-19T14-39-17-373Z/03-node-syntax-check.log`](docs/evidence/2026-11-19T14-39-17-373Z/03-node-syntax-check.log)  
*SHA-256:* `104c2710403403b33de69af6d37630b238e13001183f2a47261319c2537cfca3`  

```text
PASS: All 104 JavaScript files passed node --check syntax verification.
```

### Check 04: Full Jest Test Suite Execution (`PASS`)
*Log File:* [`docs/evidence/2026-11-19T14-39-17-373Z/04-npm-test.log`](docs/evidence/2026-11-19T14-39-17-373Z/04-npm-test.log)  
*SHA-256:* `d46b8289270d32558215d452bc9d090513983c75ad35af9bb171cf4c7c35a028`  

```text
console.log
      Output:   tests\fixtures\tmp-reverse-export\test-export.json

      at log (scripts/export-sqlite-to-legacy.js:37:11)

    console.log
      SUCCESS: Exported 1 links and 1 pastes to tests\fixtures\tmp-reverse-export\test-export.json

      at log (scripts/export-sqlite-to-legacy.js:98:13)

PASS tests/logger.test.js
PASS tests/config.test.js
PASS tests/click-buffer.test.js
PASS tests/registry.test.js

Test Suites: 27 passed, 27 total
Tests:       363 passed, 363 total
Snapshots:   0 total
Time:        57.982 s
Ran all test suites.
```

### Check 05: Code Coverage on src/ (Lines, Branches, Core Modules) (`PASS`)
*Log File:* [`docs/evidence/2026-11-19T14-39-17-373Z/05-coverage-src.log`](docs/evidence/2026-11-19T14-39-17-373Z/05-coverage-src.log)  
*SHA-256:* `1718a8b83b3c5c8ba84d34bdf2de21adfc08281b3e38c12eb62ac5276e63e1a5`  

```text
Legacy source files remain untouched.

      at log (scripts/migrate-legacy.js:397:13)

PASS tests/config.test.js
PASS tests/registry.test.js
PASS tests/click-buffer.test.js

Test Suites: 27 passed, 27 total
Tests:       363 passed, 363 total
Snapshots:   0 total
Time:        57.361 s
Ran all test suites.

=== Core Module Coverage Evaluation ===
PASS: src/storage/r2.js lines 100% >= gate 80%
PASS: src/utils/urlSecurity.js lines 98.64% >= gate 80%
PASS: src/middleware/auth.js lines 100% >= gate 80%
PASS: src/middleware/proxyTrust.js lines 100% >= gate 80%
PASS: src/utils/crypto.js lines 100% >= gate 80%
```

### Check 06: Production Dependency Vulnerability Audit (`PASS`)
*Log File:* [`docs/evidence/2026-11-19T14-39-17-373Z/06-npm-audit.log`](docs/evidence/2026-11-19T14-39-17-373Z/06-npm-audit.log)  
*SHA-256:* `38b6cbd067eb1f2f75bb1535208b3ce3c92a87fd16a7de7a471d3bc4cac7af4d`  

```text
"isSemVerMajor": true
      }
    },
    "@jest/expect": {
      "name": "@jest/expect",
      "severity": "moderate",
      "isDirect": false,
      "via": [
        "jest-snapshot"
      ],
      "effects": [
        "@jest/globals",
        "jest-circus"
      ],
      "range": ">=30.5.0",
      "nodes": [
        "node_modules/@jest/expect"
      ],
      "fixAvailable": {
        "name...
```

### Check 07: Environment Variables Documentation Consistency (`PASS`)
*Log File:* [`docs/evidence/2026-11-19T14-39-17-373Z/07-check-env-docs.log`](docs/evidence/2026-11-19T14-39-17-373Z/07-check-env-docs.log)  
*SHA-256:* `5e9f266fe38d616f05be3e570f13849e3157ee99b8ef24efcfa026f0698f6d95`  

```text
R2_ENDPOINT                   YES           YES             YES         YES         OK
R2_SECRET_ACCESS_KEY          YES           YES             YES         YES         OK
REDIRECT_MODE                 YES           YES             YES         YES         OK
REDIS_CA_CERT                 YES           YES             YES         YES         OK
REDIS_REJECT_UNAUTHORIZED     YES           YES             YES         YES         OK
REDIS_URL                     YES           YES             YES         YES         OK
REQUIRE_REPLICATION           YES           YES             YES         YES         OK
ROOTZ_API_KEY                 YES           YES             YES         YES         OK
ROOTZ_FOLDER_ID               YES           YES             YES         YES         OK
ROOTZ_FOLDER_NAME             YES           YES             YES         YES         OK
ROOTZ_TIMEOUT_MS              YES           YES             YES         YES         OK
SENTRY_DSN                    YES           YES             YES         YES         OK
SQLITE_DB_PATH                YES           YES             YES         YES         OK
STORE                         YES           YES             YES         YES         OK
TRUST_PROXY                   YES           YES             YES         YES         OK
TURNSTILE_SECRET_KEY          YES           YES             YES         YES         OK
TURNSTILE_SITE_KEY            YES           YES             YES         YES         OK
-----------------------------------------------------------------------------------------------

SUCCESS: All environment variables in application code are documented across .env.example, docker-compose.yml, README.md, and docs/RUNBOOK.md.
```

### Check 08: Unapproved Placeholder Check (`PASS`)
*Log File:* [`docs/evidence/2026-11-19T14-39-17-373Z/08-check-placeholders.log`](docs/evidence/2026-11-19T14-39-17-373Z/08-check-placeholders.log)  
*SHA-256:* `ec3074a3670eca5640e618dd12471aa17ec28745f4b1d5e5dc97e7fe236722e4`  

```text
[PENDING ALLOWED] public\projects\manifold.html:104 contains TODO(owner): // TODO(owner): insert verified 20-30 line code block from sanitized repo
[PENDING ALLOWED] public\projects\manifold.html:108 contains TODO(owner): // TODO(owner): packet header inspection & pipeline rewrite
[PENDING ALLOWED] public\projects\manifold.html:127 contains TODO(owner): <td>TODO(owner): server spec</td>
[PENDING ALLOWED] public\projects\manifold.html:129 contains TODO(owner): <td>TODO(owner): us added latency</td>
[PENDING ALLOWED] public\projects\manifold.html:130 contains TODO(owner): <td>TODO(owner): req/s</td>
[PENDING ALLOWED] public\projects\prism.html:71 contains TODO(owner): <!-- TODO(owner): Add context on why this repository is private and infrastructure scope -->
[PENDING ALLOWED] public\projects\prism.html:81 contains TODO(owner): <text x="100" y="115" fill="var(--muted)" font-family="monospace" font-size="9" text-anchor="middle">TODO(owner): token budget</text>
[PENDING ALLOWED] public\projects\prism.html:89 contains TODO(owner): <text x="350" y="125" fill="var(--muted)" font-family="monospace" font-size="9" text-anchor="middle">TODO(owner): model weights</text>
[PENDING ALLOWED] public\projects\prism.html:104 contains TODO(owner): # TODO(owner): insert verified 20-30 line code block from sanitized repo
[PENDING ALLOWED] public\projects\prism.html:106 contains TODO(owner): # TODO(owner): token classification & backend selection
[PENDING ALLOWED] public\projects\prism.html:124 contains TODO(owner): <td>TODO(owner): GPU/RAM spec</td>
[PENDING ALLOWED] public\projects\prism.html:126 contains TODO(owner): <td>TODO(owner): ms</td>
[PENDING ALLOWED] public\projects\prism.html:127 contains TODO(owner): <td>TODO(owner): tok/s</td>
[PENDING ALLOWED] public\projects\prism.html:133 contains TODO(owner): <td>TODO(owner): ms</td>
[PENDING ALLOWED] public\projects\prism.html:134 contains TODO(owner): <td>TODO(owner): tok/s</td>
[PENDING ALLOWED] tools\drop\public\view.html:107 contains href="#": <a class="btn btn-solid" id="confirm-unsafe-download-btn" href="#" target="_blank" rel="noopener" style="background:var(--danger); color:var(--accent-text); border-color:var(--danger);">$ download --unsafe →</a>
[PENDING ALLOWED] tools\paste\public\index.html:223 contains href="#": <a class="btn btn-solid" id="modal-paste-view-btn" href="#" target="_blank" rel="noopener" style="text-decoration:none;">View Paste ↗</a>
[PENDING ALLOWED] tools\paste\public\index.html:224 contains href="#": <a class="btn" id="modal-paste-raw-btn" href="#" target="_blank" rel="noopener" style="text-decoration:none;">Raw Text</a>
[PENDING ALLOWED] tools\tinyurl\public\index.html:276 contains href="#": <a class="btn" id="modal-open-link" href="#" target="_blank" rel="noopener">Open Link ↗</a>
[PENDING ALLOWED] tools\tinyurl\public\index.html:284 contains href="#": <a class="result-url" id="short-link-href" href="#">Short link URL</a>
```

### Check 09: Asset and Bundle Size Performance Budgets (`PASS`)
*Log File:* [`docs/evidence/2026-11-19T14-39-17-373Z/09-check-budget.log`](docs/evidence/2026-11-19T14-39-17-373Z/09-check-budget.log)  
*SHA-256:* `cae25f15c9f46343311d9511562e4afa68a511ff8186a1b68991e4f095a05a6e`  

```text
=======================================================
Performance Page Weight Budget Check (Gzipped)
=======================================================

[PASS] Landing Page (public/index.html): 4.23 KiB gzipped (15.09 KiB raw) <= 35 KiB limit
[PASS] Shared Theme CSS (tools/shared/theme.css): 5.10 KiB gzipped (19.87 KiB raw) <= 10 KiB limit
[PASS] Shared Theme Switcher (tools/shared/theme-switcher.js): 2.33 KiB gzipped (8.54 KiB raw) <= 6 KiB limit
[PASS] Shared QRCode Library (tools/shared/qrcode.min.js): 9.34 KiB gzipped (23.90 KiB raw) <= 15 KiB limit
[PASS] TinyURL Tool (tools/tinyurl/public/index.html + app.js): 5.81 KiB gzipped (20.22 KiB raw) <= 40 KiB limit
[PASS] QR Studio Tool (tools/qr/public/index.html + app.js): 8.92 KiB gzipped (34.05 KiB raw) <= 40 KiB limit
[PASS] Pastebin Tool (tools/paste/public/index.html + app.js): 4.16 KiB gzipped (13.59 KiB raw) <= 40 KiB limit
[PASS] Drop Tool (tools/drop/public/index.html + app.js): 15.38 KiB gzipped (63.90 KiB raw) <= 40 KiB limit
[PASS] Health Dashboard (tools/health/public/index.html + app.js): 4.20 KiB gzipped (13.32 KiB raw) <= 40 KiB limit
[PASS] Tools Hub (tools/public/index.html): 3.35 KiB gzipped (13.48 KiB raw) <= 30 KiB limit

Budget Summary: 10/10 items within budget.
SUCCESS: All pages and bundles satisfy the performance budget.
```

### Check 10: Design Token WCAG AA Contrast Audit (60/60) (`PASS`)
*Log File:* [`docs/evidence/2026-11-19T14-39-17-373Z/10-audit-contrast.log`](docs/evidence/2026-11-19T14-39-17-373Z/10-audit-contrast.log)  
*SHA-256:* `a37bdefb630d5c5003fa26b70afb37a0ea7a43ae5f42c361244bf5a63dc9844f`  

```text
[PASS] muted on bg: 9.02:1
  [PASS] accent on bg: 10.12:1
  [PASS] button text on accent: 10.40:1

Checking Theme: oled-black
  [PASS] text on bg: 19.48:1
  [PASS] text on surface: 18.24:1
  [PASS] muted on bg: 7.70:1
  [PASS] accent on bg: 6.19:1
  [PASS] button text on accent: 6.19:1

Checking Theme: tokyo-neon
  [PASS] text on bg: 13.53:1
  [PASS] text on surface: 11.83:1
  [PASS] muted on bg: 8.75:1
  [PASS] accent on bg: 7.70:1
  [PASS] button text on accent: 7.54:1

Audit Summary: 60/60 checks passed.
SUCCESS: All 12 themes meet WCAG contrast requirements with 0 failures.
```

### Check 11: Runbook Environment & Proxy-Trust Test Suite (`PASS`)
*Log File:* [`docs/evidence/2026-11-19T14-39-17-373Z/11-runbook-env-test.log`](docs/evidence/2026-11-19T14-39-17-373Z/11-runbook-env-test.log)  
*SHA-256:* `64b317120af81e9b7920916caf2322224265315b42ddb927c2bb6c7911c8ae15`  

```text
PASS tests/runbook-env.test.js
  Task R9.2 Item 1: RUNBOOK Environment Variables & Proxy Trust Verification
    √ RUNBOOK documents every environment variable found in application code (45 ms)
    √ RUNBOOK env template contains no unknown environment variables (42 ms)
    √ ORIGIN_VERIFY_SECRET is UNSET by default in RUNBOOK production template with required comment (1 ms)
    √ RUNBOOK specifies exact code variable names (1 ms)
    √ verify-proxy-trust.js rejects secrets passed via CLI argument --admin-token (114 ms)
    √ verify-proxy-trust.js rejects secrets passed via CLI argument --origin-secret (114 ms)

Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
Snapshots:   0 total
Time:        1.311 s
Ran all test suites matching tests/runbook-env.test.js.
```

### Check 12: Docker Compose Expose-Only Port Audit (`PASS`)
*Log File:* [`docs/evidence/2026-11-19T14-39-17-373Z/12-check-compose-ports.log`](docs/evidence/2026-11-19T14-39-17-373Z/12-check-compose-ports.log)  
*SHA-256:* `798923a45baaf3c4bc63339ade5ff9feef26310e63acedd07ddca2c9bb79459b`  

```text
=======================================================
Docker Compose Port Publishing Security Audit (Task R2.6f)
=======================================================

Audit Results:
- Expose block present:         YES
- Expose port 5050 configured:  YES
- Host ports block found:       NO (Compliant)
- Published port mappings:      NO (Compliant)

SUCCESS: docker-compose.yml complies with origin isolation (0 published host ports, expose 5050 configured).
```

### Check 13: Legacy Storage Migration Rehearsal on Copy Fixtures (`PASS`)
*Log File:* [`docs/evidence/2026-11-19T14-39-17-373Z/13-migration-rehearsal.log`](docs/evidence/2026-11-19T14-39-17-373Z/13-migration-rehearsal.log)  
*SHA-256:* `a678b66f97213b6a64a347318e40da25055d5afac49257257cf0cdfbfb249882`  

```text
SQLite transaction committed successfully.

Performing post-migration parity check from SQLite...
-------------------------------------------------------
Migration Parity Report:
  Links Parity:  99/99 (100% MATCH)
  Pastes Parity: 478/478 (100% MATCH)
  Drops Parity:  0/0 (100% MATCH)
-------------------------------------------------------

[SUCCESS] Migration completed with 100% row-count and payload parity.
Legacy source files remain untouched.

[PASS] Second execution succeeded without conflict
[PASS] Row count maintained at 99 links after re-run (99/99)
[PASS] Row count maintained at 478 pastes after re-run (478/478)

-------------------------------------------------------
Total checks: 13 | Passed: 13 | Failed: 0
-------------------------------------------------------
```

### Check 14: axe-core Accessibility Audit & Full Keyboard Traversal (`PASS`)
*Log File:* [`docs/evidence/2026-11-19T14-39-17-373Z/14-axe-accessibility.log`](docs/evidence/2026-11-19T14-39-17-373Z/14-axe-accessibility.log)  
*SHA-256:* `b75596f3ff09694a2025ef83904a42f74b6903c359c223645212cbd37aa499f6`  

```text
15. <select #emblem-option>
    * [PASS] QR Studio -> Primary button <#generate-btn> reached at Tab step 12 of 15 (<= 12 gate met)

-------------------------------------------------------
CDP E2E Tool Interaction Tests under Production CSP:
-------------------------------------------------------
  Testing TinyURL shorten workflow...
  [PASS] TinyURL: 0 CSP violations, 0 console errors during user interaction.
  Testing Paste create workflow...
  [PASS] Paste: 0 CSP violations, 0 console errors during user interaction.
  Testing QR Studio generate workflow...
  [PASS] QR Studio: 0 CSP violations, 0 console errors during user interaction.
  Testing Drop Tool upload staging interaction...
  [PASS] Drop Tool: 0 CSP violations, 0 console errors during user interaction.

-------------------------------------------------------
Audit Complete: 35 audits run across 7 pages × 4 themes.
Total axe-core Violations: 0
-------------------------------------------------------
Saved detailed report to docs\a11y-wcag22-report.json
```

### Check 15: Lighthouse Performance & SEO Simulated Throttling (`PASS`)
*Log File:* [`docs/evidence/2026-11-19T14-39-17-373Z/15-lighthouse-audit.log`](docs/evidence/2026-11-19T14-39-17-373Z/15-lighthouse-audit.log)  
*SHA-256:* `1ccda0f0a3fbf8fa982329b9bf6a2737fd36b040f9d5931a1a037407bb11e265`  

```text
| Paste Tool | desktop | 100 | 100 | 100 | 100 | 348 | 0 | 0.001 |
| Drop Tool | mobile | 98 | 100 | 100 | 100 | 1911 | 68 | 0.031 |
| Drop Tool | desktop | 100 | 100 | 100 | 100 | 443 | 0 | 0.001 |
| QR Studio Tool | mobile | 98 | 100 | 100 | 100 | 1769 | 108 | 0.003 |
| QR Studio Tool | desktop | 100 | 100 | 100 | 100 | 459 | 0 | 0.004 |
| Case Study | mobile | 99 | 100 | 100 | 100 | 1062 | 127 | 0.013 |
| Case Study | desktop | 100 | 100 | 100 | 100 | 325 | 0 | 0 |

-------------------------------------------------------
Failing Best-Practices Audits Analysis:
  No failing audits in Best Practices category (100% score).

-------------------------------------------------------
Console Errors & Inspector Issues Detailed Breakdown:
  [PASS] errors-in-console: 0 items detected.
  [PASS] inspector-issues: 0 items detected.

Saved raw Lighthouse results to docs\lighthouse-audit-report.json

    [RETRY] First audit attempt failed for Paste Tool (desktop): Null, missing, or zero performance score received: null. Retrying once...
```

### Check 16: Host-Mode vs Path-Mode Robots & SEO Tests (`PASS`)
*Log File:* [`docs/evidence/2026-11-19T14-39-17-373Z/16-host-mode-seo.log`](docs/evidence/2026-11-19T14-39-17-373Z/16-host-mode-seo.log)  
*SHA-256:* `ba1a5c2bfaa4fd9eb28f133c60f8468a055f2e56842bd6b613fdea8fc4061a88`  

```text
at node_modules/express-rate-limit/dist/index.cjs:879:5

{"level":30,"time":"2026-11-19T14:44:42.136Z","pid":25832,"reqId":"a26e5545-bac0-4cfe-b36e-c9daa26cd3e3","type":"http_request","method":"GET","url":"/raw/sample-id","statusCode":404,"ip":"127.0.0.0/24","durationMs":14.45}

PASS tests/host-mode-seo.test.js
  Host-Mode vs Path-Mode SEO & Robots Header Telemetry (R9.2 Item 8)
    Host-Mode Subdomain Routing
      √ Tool roots on subdomains return X-Robots-Tag: index, follow (143 ms)
      √ Short link paths and preview paths on tinyurl subdomain return strict noindex (61 ms)
      √ Paste views and raw routes on paste subdomain return strict noindex (97 ms)
      √ Drop downloads and file views on drop subdomain return strict noindex (20 ms)
    Path-Mode Apex Routing
      √ Tool roots under /tools/ return X-Robots-Tag: index, follow (46 ms)
      √ User content paths on apex return strict noindex (46 ms)

Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
Snapshots:   0 total
Time:        3.554 s
Ran all test suites matching tests/host-mode-seo.test.js.
```

### Check 17: Redirect Benchmark (20c, 5 Repeats, 100% 302, Median >= 2000 req/s) (`PASS`)
*Log File:* [`docs/evidence/2026-11-19T14-39-17-373Z/17-bench-redirect.log`](docs/evidence/2026-11-19T14-39-17-373Z/17-bench-redirect.log)  
*SHA-256:* `905c5924f140bad5bb4db94bc78885c224825c60c7a448d8406a3c9ba7197965`  

```text
-------------------------------------------------------
Redirect Benchmark Results (5-Repeat Summary):
  Median Throughput:           2,003 req/s (Spread: 1,487 - 2,323 req/s)
  Median P99 Latency:          14 ms
  Median Run Status Histogram: {"302":10011} (302: 100%)
  Aggregated Status Histogram: {"302":48576}
  Aggregated 302 Ratio:        100.00% (48,576 / 48,576 requests)
-------------------------------------------------------

Running Health Endpoint Benchmark (20 connections, 5s)...
  /health: 2,387 req/s | p99: 16ms | Status 200: 100%

Running Landing Page Benchmark (20 connections, 5s)...
  Landing /: 1,412 req/s | p99: 21ms | Status 200: 100%
Regression Gate: Median 2003 req/s vs previous 2096 req/s (threshold: >= 1572 req/s) [PASS]

[PASS] All redirect benchmark gates satisfied.

(node:11472) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
(Use `node --trace-deprecation ...` to show where the warning was created)
```

### Check 18: Soak Benchmark & Memory Telemetry (Post-Warmup Slopes & 429 Ratio) (`STALE-ARTIFACT`)
*Log File:* [`docs/evidence/2026-11-19T14-39-17-373Z/18-soak-test.log`](docs/evidence/2026-11-19T14-39-17-373Z/18-soak-test.log)  
*SHA-256:* `e73eed3948cac1de6b679ba8a40c229aadacc52f26d59e37b6cc72216d1c7a1f`  

```text
[STALE-ARTIFACT]
Report: soak-20min-report.json
Report gitHead: unbound
Current gitHead: 0ab8d5b769e7219966cf1b69d61402c503f2448a
Status: STALE-ARTIFACT (Artifact gitHead does not match current repository HEAD).

Report Details (soak-20min-report.json):
Duration: 1200s (20.0m) | Requests: 32328
HeapUsed Post-Warmup Slope: 0.0887 MB/min (gate: <= 0.2000 MB/min) [PASS]
RSS Post-Warmup Slope:      0.8928 MB/min (gate: <= 1.0000 MB/min) [PASS]
HTTP 429 Ratio:             5.60% (gate: < 10.00%) [PASS]
Total Rows Created:         9597
Rows Swept (Purged):        0
Async Scrypt Count:         3199
Status Histogram:
  HTTP 200: 25819 (79.87%)
  HTTP 302: 4701 (14.54%)
  HTTP 429: 1810 (5.60%)
Verdict: PASSED [STALE-ARTIFACT]
```

### Check 19: Docker & Container Services End-to-End Verification (`SKIPPED (NO DOCKER)`)
*Log File:* [`docs/evidence/2026-11-19T14-39-17-373Z/19-verify-docker.log`](docs/evidence/2026-11-19T14-39-17-373Z/19-verify-docker.log)  
*SHA-256:* `15b90fbc739537f3d313a13ffaa4ac43ca8f10d039fd8452167aaf8239494db4`  

```text
SKIPPED-NO-DOCKER
```

### Check 20: Staging Environment Runner & Mock Security Tests (`PASS [UNVERIFIED]`)
*Log File:* [`docs/evidence/2026-11-19T14-39-17-373Z/20-verify-staging.log`](docs/evidence/2026-11-19T14-39-17-373Z/20-verify-staging.log)  
*SHA-256:* `6b1691b3d38ea786943a3936b4cb1b674ab65c85d1affdd465e75395f7bd1e82`  

```text
-------------------------------------------------------

      at log (scripts/ops/verify-staging.js:126:11)


PASS tests/ops-verify.test.js
  Part 1: Docker & Staging Verification Harness Suites
    scripts/ops/verify-docker.js
      √ isDockerRunning returns boolean without throwing (506 ms)
      √ runVerification in --mock mode exercises all 10 steps cleanly (106 ms)
    scripts/ops/verify-staging.js
      √ parseArgs parses --host and --mock correctly (1 ms)
      √ parseArgs rejects CLI secret --admin-token with security error (2 ms)
      √ runStagingVerification in --mock mode executes all 7 checks and reports UNVERIFIED register (32 ms)

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Snapshots:   0 total
Time:        1.502 s
Ran all test suites matching tests/ops-verify.test.js.
```

