# PokéDB v2 — Test Deviations & Evolution Register (docs/TEST_DEVIATIONS.md)

This document records the exact evolution of the PokéDB v2 test suites and reconciles all naming differences between early planning documents (R9.1), audit reports (R9.2), and the implemented codebase on branch \`v2/overhaul\`.

---

## 1. Test Suite & Services Architecture Reconciliation

### 1.1 Discrepancy Analysis
Early engineering checkpoints (R9.1) and subsequent review prompts (R9.2) referenced different naming conventions for test suites and security service modules:

| Referenced In Early Reports | Implemented Location in Repository | Commit Hash | Architecture Rationale |
|---|---|:---:|---|
| \`src/services/threatIntel.js\` | \`src/services/safeBrowsing.js\` & \`src/services/threatFeeds.js\` | \`12c0673\` | Separation of concerns: Google Safe Browsing API (v4 JSON client) is decoupled from URLhaus / MalwareBazaar abuse.ch CSV/JSON threat feed ingestion. |
| \`tests/sweeper.test.js\` | \`tests/phase5.test.js\` & \`tests/coverage-p37.test.js\` | \`993309a\` | Background expiration sweepers for SQLite records and object keys were integrated directly into the lifecycle and coverage regression suites. |
| \`tests/threat-intel.test.js\` | \`tests/phase5.test.js\` & \`tests/coverage-p37.test.js\` | \`12c0673\` | Multi-provider threat intelligence tests were co-located with Phase 5 threat feed integration tests. |
| \`tests/url-security.test.js\` | \`tests/url-security-offline.test.js\` | \`42957fb\` | Expanded into a comprehensive 51-test offline SSRF, IPv4/IPv6 private CIDR, decimal/octal/hex obfuscation, and socket IP pinning suite. |
| \`tests/crypto.test.js\` | \`tests/phase1.test.js\` & \`tests/coverage-p37.test.js\` | \`42957fb\` | Cryptographic hash functions, scrypt key derivation, and semaphore queueing were tested across Phase 1 unit tests and coverage suites. |
| \`tests/fake-object-store.test.js\` | \`tests/drop-r2.test.js\` | \`42957fb\` | In-memory S3-compatible mock store was grouped with Drop v2 multipart and presigned URL test specifications. |

---

## 2. Complete Roster of Implemented Test Suites (25 Suites Total)

All test suites execute under \`npm test\` with 100% pass rate:
1. \`tests/app.test.js\` — Express app instantiation, lifecycle, and middleware ordering.
2. \`tests/characterization.test.js\` — Baseline characterization tests preserved from commit \`ce594ac\`.
3. \`tests/click-buffer.test.js\` — In-memory batch click buffer, capacity capping, and backoff.
4. \`tests/concurrency.test.js\` — High-concurrency store access and lock contention.
5. \`tests/config.test.js\` — Configuration parsing, environment validation, and production fail-closed guards.
6. \`tests/coverage-p37.test.js\` — Behavioral coverage assertions across utility and security helpers.
7. \`tests/drop-r2.test.js\` — Drop v2 presigned multipart uploads, download tokens, and FakeObjectStore.
8. \`tests/host-mode-seo.test.js\` — Host-routed robots headers, sitemap.xml, and subdomain SEO rules.
9. \`tests/logger.test.js\` — Pino structured JSON logging, IP subnet anonymization, and secret redaction.
10. \`tests/middleware.test.js\` — Security headers, CSP nonces, CORS policies, and CLI detection.
11. \`tests/migration.test.js\` — Legacy JSON storage migration into SQLite with parity verification.
12. \`tests/ops.test.js\` — Health monitoring endpoints, process metrics, and replication status.
13. \`tests/ops-verify.test.js\` — Verification runners for Docker and Staging mock workflows.
14. \`tests/phase1.test.js\` — Phase 1 core hardening: scrypt async, error formats, and rate limiting.
15. \`tests/phase5.test.js\` — Phase 5 security: threat feeds, abuse reporting, and tamper detection.
16. \`tests/phase6.test.js\` — Phase 6 frontend assets: theme switching, tokens, and templates.
17. \`tests/phase7.test.js\` — Phase 7 showcase projects, metadata, and case study markup.
18. \`tests/phase8.test.js\` — Phase 8 analytics beacon scoping, offline PWA, and legal notices.
19. \`tests/r2-offline.test.js\` — Offline S3/R2 presigned URL SigV4 cryptography and multipart completion.
20. \`tests/registry.test.js\` — Automatic filesystem tool discovery and dynamic route mounting.
21. \`tests/runbook-env.test.js\` — Environment variable synchronization against RUNBOOK.md templates.
22. \`tests/runbook-exec.test.js\` — Verification of executable runbook command paths and script targets.
23. \`tests/security.test.js\` — Adversarial security regressions (XFF injection, SSRF, IDOR).
24. \`tests/server.test.js\` — Monolith-to-modular server regression suite.
25. \`tests/sqlite.test.js\` — SQLite schema, WAL mode, prepared statements, and transactional rollbacks.
26. \`tests/url-security-offline.test.js\` — Comprehensive offline SSRF protection, IP pinning, and DNS rebinding prevention.

---

## 3. Logged Test Deviations vs Baseline (\`ce594ac\`)

Per project rules, every modification to pre-existing test files vs commit \`ce594ac\` is logged with its exact plan citation:

### 3.1 \`tests/characterization.test.js\`
- **Hunk 6 (Robots Headers & robots.txt):**
  - *Baseline Behavior:* Tested absence of \`X-Robots-Tag\` on root and monolithic \`Disallow: /\` on subdomains.
  - *Updated Behavior:* Tests that root has \`index, follow\`, subdomains allow exact root (\`Allow: /$\`), and short codes enforce \`noindex, nofollow, noarchive, nosnippet\`.
  - *Plan Citation:* Task P1.2, SEO-001 (search engine indexing of tools hub while protecting user content).
- **Hunk 7 (Drop Deletion Security):**
  - *Baseline Behavior:* Accepted \`?token=\` query parameter for deletion.
  - *Updated Behavior:* Enforces that query tokens return HTTP 400 Bad Request (\`query_tokens_forbidden\`). Deletion requires \`Authorization: Bearer <token>\` or \`X-Delete-Token: <token>\`.
  - *Plan Citation:* Task P1.3, SEC-003 (credential leakage prevention in server access logs and referrers).

### 3.2 \`tests/security.test.js\`
- **Hunk 2a (Drop Deletion Token Rejection):**
  - *Baseline Behavior:* Checked invalid query deletion token for HTTP 403.
  - *Updated Behavior:* Verifies query token is immediately rejected with HTTP 400 (\`query_tokens_forbidden\`), and header-supplied token is evaluated for authentication.
  - *Plan Citation:* Task P1.3, SEC-003.

### 3.3 \`tests/server.test.js\`
- **Lines 265–275 (Malware Scanning Mock):**
  - *Baseline Behavior:* Mocked legacy \`process.env.VIRUSTOTAL_API_KEY\`.
  - *Updated Behavior:* Modernized to use free-tier MalwareBazaar API key mock; removed external VirusTotal dependency.
  - *Plan Citation:* Task P5.4.
- **Lines 290–305 (Drop Token Headers):**
  - *Baseline Behavior:* Used query parameter token for deletion.
  - *Updated Behavior:* Enforces HTTP 400 rejection for query token; tests \`X-Delete-Token\` header.
  - *Plan Citation:* SEC-003.
- **Lines 480–505 (Host Routing Robots Matrix):**
  - *Baseline Behavior:* Expected blanket \`noindex\` on all paths longer than 1 character.
  - *Updated Behavior:* Aligned with P1.2 host routing matrix: tool root pages indexable, content paths protected.
  - *Plan Citation:* SEO-001.
- **Lines 520–535 (Rate Limiter Exemption):**
  - *Baseline Behavior:* Blanket rate limiting blocked \`/api/health/ping\`.
  - *Updated Behavior:* Health endpoints are explicitly exempt from rate limiting to prevent orchestrator false-positives; per-route limiters (QR 120/min) enforced.
  - *Plan Citation:* Task P1.5, P9.1.

### 3.4 \`tests/ops.test.js\`
- **Lines 98–110 (Production Startup Security Violation Regex):**
  - *Baseline Behavior:* Checked specific error message regex \`/Security violation: ALLOW_TEST_IPC_SHUTDOWN and BENCH_BYPASS_LIMITER are strictly forbidden/\`.
  - *Updated Behavior:* Updated regex to \`/strictly forbidden in production mode/\` to accommodate the addition of \`ENABLE_SOAK_GC\` to the fatal production guard.
  - *Plan Citation:* Task R9.2 Part 2 Item 3 (Prod guards).

---

## 4. Framework Upgrade: Express 5 Transition & LTS Citation (Task R9.2 Part 2 Item 7)
- **Framework Version:** Production framework upgraded to \`express@^5.0.0\` (installed \`express@5.3.0\`).
- **Support Roadmap & Citation:** Express 4 entered Maintenance mode on 2025-04-01 (see official Express version support timeline: https://expressjs.com/en/advanced/version-support.html). Upgrading ensures the codebase receives ongoing security patches, native async route error propagation, and modern routing semantics.
- **Test Compatibility:** All 26 test suites and 354/354 tests pass cleanly (100% pass rate) under Express 5.
- **Revert Procedure:** Should any edge middleware incompatibilities occur, operators can cleanly revert to Express 4 via:
  \`\`\`bash
  npm install express@4.22.3
  \`\`\`

---

## 5. Soak Benchmark Gate Tightening (FINAL-FINAL Item 4)
- **Gate Threshold:** Tightened \`maxHeapSlopeMbMin\` in \`scripts/ops/gates.json\` from \`0.5 MB/min\` to \`0.2 MB/min\`.
- **Rationale:** Enforce rigorous memory bounds detection during soak runs; actual observed post-warmup heapUsed slope is ~0.0887 MB/min (20-min) and -0.0620 MB/min (60-min), well beneath the 0.2 MB/min threshold.
- **Reporting:** Reports are partitioned by duration (\`docs/soak-20min-report.json\` and \`docs/soak-60min-report.json\`).

---

## 6. Core Module Coverage Restoration & Gate Enforcement (HARNESS INTEGRITY Item 4)
- **Drop Since R9.2 Root Cause Analysis:**
  - In R9.2 performance tuning commits (specifically \`63d45c5\` and \`52647ee\`), \`src/middleware/hostRouter.js\` had duplicated implementations of \`normalizeHost\`, \`resolveApiHost\`, and \`resolveBrowserOriginHost\` instead of delegating to \`src/middleware/proxyTrust.js\`.
  - When Express 5 router integration occurred, the shadowed helper functions inside \`proxyTrust.js\` (lines 21–22, 58–82) were bypassed during route execution, leading to an apparent coverage drop in \`proxyTrust.js\` (73.84% lines).
  - Similarly, \`src/middleware/auth.js\` helper \`extractBearerOrHeaderToken\` (lines 15–23) and edge branches in \`createRequireAdmin\` (line 71 for missing \`adminToken\` 503 response, line 79 for query-based \`admin_token\` authentication) were not exercised directly in unit tests (75.00% lines).
- **Remediation & Commit Actions:**
  - Deduplicated \`src/middleware/hostRouter.js\` by importing \`normalizeHost\`, \`resolveApiHost\`, and \`resolveBrowserOriginHost\` directly from \`./proxyTrust\`.
  - Added unit test suites in \`tests/middleware.test.js\` covering \`extractBearerOrHeaderToken\`, \`requireAdmin\` unconfigured (503) and query fallback, \`normalizeHost\` malformed URLs, \`resolveApiHost\` forwarding, and \`resolveBrowserOriginHost\` origin/referer filtering.
  - Achieved line coverage: \`auth.js\` = 100.0%, \`proxyTrust.js\` = 95.38% (well above the 80% per-module gate).
- **Automated Gate Enforcement:**
  - Check 05 in \`scripts/ops/verify-final.js\` now parses \`coverage/coverage-summary.json\` and enforces per-module lines >= 80 for all modules defined in \`gates.json\` (\`auth.js\`, \`proxyTrust.js\`, \`r2.js\`, \`crypto.js\`, \`urlSecurity.js\`). Failure in any core module causes check 05 to fail immediately.

---

## 7. Soak Benchmark RSS Slope & 429 Gate Alignment (HARNESS INTEGRITY Item 5)
- **Gate Threshold Additions:**
  - Added \`maxRssSlopeMbMin: 1.0\` (MB/min) and \`max429Ratio: 0.10\` (10%) to \`scripts/ops/gates.json\` soak specification.
  - Retained strict \`maxHeapSlopeMbMin: 0.2\` (MB/min).
- **gitHead Binding & Execution Integrity:**
  - Bound all soak reports directly to \`gitHead\` via \`git rev-parse HEAD\`.
  - Check 18 in \`scripts/ops/verify-final.js\` validates that any existing report matches the current repository commit hash. If the artifact was generated against an older commit, the harness detects \`STALE-ARTIFACT\` and executes a live 10-minute benchmark (\`SOAK_DURATION=600\`, \`WARMUP_SEC=120\`) in benchmark mode (\`NODE_ENV=bench\`).
  - Required reporting of complete HTTP status code histogram, post-warmup memory slopes, and rows created/purged.
