# PokéDB v2 — Operator Verification & Launch TODO (docs/OWNER_TODO.md)

This runbook is generated dynamically from the PokéDB v2 UNVERIFIED register.
Every item below maps an unverified production claim to the exact command required to verify it.

---

## 1. Staging Proxy Trust & Network Verification
- **Verification Target:** Cloudflare edge header translation and loopback CIDR enforcement.
- **Coverage Script:** `npm run verify:staging -- --host <staging-url>`
- **Execution Command:**
  ```bash
  ADMIN_TOKEN="<prod-token>" ORIGIN_VERIFY_SECRET="<secret>" node scripts/ops/verify-proxy-trust.js --host https://staging.pokedb.site
  ```
- **Expected Output:**
  ```text
  [PASS] Spoofed XFF rejected with HTTP 403 Forbidden.
  [PASS] Trusted loopback client IP correctly parsed.
  ```

---

## 2. Staging Litestream Disaster Recovery Drill
- **Verification Target:** Production Litestream backup snapshot creation and fresh volume restore parity.
- **Coverage Script:** `npm run verify:docker` (or manual staging restore drill)
- **Execution Command:**
  ```bash
  node scripts/restore-drill.js --replica "s3://pokedb-backups-staging/pokedb.sqlite"
  ```
- **Expected Output:**
  ```text
  [SUCCESS] Restored 100% link and paste rows from Cloudflare R2 replica.
  ```

---

## 3. Cloudflare R2 Direct Browser Multipart Uploads
- **Verification Target:** Direct browser-to-R2 presigned PUTs and CORS policy enforcement.
- **Coverage Script:** `node scripts/verify-r2-policies.js`
- **Execution Command:**
  ```bash
  node scripts/verify-r2-policies.js
  ```
- **Expected Output:**
  ```text
  [PASS] R2 CORS and lifecycle rules verified across pokedb-drops and pokedb-backups.
  ```

---

## 4. Real-Network Mobile Lighthouse Core Web Vitals
- **Verification Target:** Verification of 90+ Performance and LCP < 2.5s over real 4G network.
- **Coverage Script:** `npm run verify:staging -- --host https://staging.pokedb.site`
- **Execution Command:**
  ```bash
  npx lighthouse https://staging.pokedb.site --view --preset=mobile
  ```
- **Expected Output:**
  ```text
  Performance: >= 90 | LCP: < 2500ms | CLS: < 0.1 | INP: < 200ms
  ```

---

## 5. Cloudflare Turnstile Live Challenge & WCAG 2.2 3.3.8
- **Verification Target:** Interactive and non-interactive challenge rendering on live domain without cognitive function test barriers.
- **Coverage Script:** `npm run verify:staging -- --host <staging-url>`
- **Manual Verification Step:**
  1. Open `https://staging.pokedb.site/tools/tinyurl/` in Chrome.
  2. Verify that the Cloudflare Turnstile widget initializes and renders a clean checkmark without console errors.

---

## 6. Google Safe Browsing API Key Activation
- **Verification Target:** Live malware URL detection and flagging.
- **Execution Command:**
  ```bash
  curl -s -X POST https://staging.pokedb.site/api/shorten \
    -H "Content-Type: application/json" \
    -d '{"url":"http://testsafebrowsing.appspot.com/s/malware.html"}'
  ```
- **Expected Output:**
  ```json
  {"error":"unsafe_url","details":"URL flagged as malware or phishing by Google Safe Browsing."}
  ```

---

## 7. Production Cutover & Database Migration
- **Verification Target:** Zero data-loss transition from legacy JSON store to SQLite v2.
- **Execution Command:**
  ```bash
  cp ./data/store.json /tmp/store-copy.json
  node scripts/migrate-legacy.js --execute --source /tmp/store-copy.json --db ./data/pokedb.sqlite
  ```
- **Expected Output:**
  ```text
  [SUCCESS] Migration completed with 100% row-count and payload parity.
  ```

---

## 8. Draft Project Showcase Completion
- **Verification Target:** Drafting and publishing the 5 secondary project skeletons (`aegis`, `beacon`, `kds`, `manifold`, `prism`).
- **Owner Action:**
  1. Review architecture and telemetry in `public/projects/<slug>.html`.
  2. Replace `TODO(owner)` markers with sanitized production metrics.
  3. Change status badge from upcoming to active in `public/index.html`.
