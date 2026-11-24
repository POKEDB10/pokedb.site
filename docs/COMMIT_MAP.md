# pokedb.site v2 — Commit Map (Phases 4 through 8)

This document provides a granular traceability mapping from each Implementation Plan task ID (Phases 4 through 8) to its exact Git commit hash and primary modified files on branch `v2/overhaul`.

---

## Phase 4: Drop v2 on Cloudflare R2 & Multer Eradication
**Primary Feature Commit:** `cb9256a` (`feat(drop): implement Drop v2 on Cloudflare R2 with presigned multipart uploads and delete multer (R4)`)  
**Progress Record Commit:** `40f1b2c` (`docs(PROGRESS): record commit hash cb9256a for Checkpoint Phase 4`)

| Task ID | Task Description | Commit | Primary Files Modified |
|---|---|---|---|
| **P4.1** | S3 Client Factory & R2 Storage Adapter | `cb9256a` | `src/storage/r2.js`, `src/storage/fakeObjectStore.js`, `docs/DEPENDENCIES.md` |
| **P4.2** | Presigned Direct Upload & Initial Drop Record | `cb9256a` | `src/tools/drop/router.js`, `src/storage/sqlite.js` |
| **P4.3** | Presigned Multipart Upload Endpoints | `cb9256a` | `src/tools/drop/router.js`, `src/storage/r2.js` |
| **P4.4** | Complete Multipart Endpoint & Atomic Record Commit | `cb9256a` | `src/tools/drop/router.js`, `src/storage/sqlite.js` |
| **P4.5** | Atomic Burn-After-Download & HTTP 410 Handling | `cb9256a` | `src/tools/drop/router.js`, `src/storage/sqlite.js` |
| **P4.6** | Malicious Extension Blocklist & Content-Type Sanitization | `cb9256a` | `src/tools/drop/router.js` |
| **P4.7** | Large File Passphrase & Authorization Tokens | `cb9256a` | `src/tools/drop/router.js` |
| **P4.8** | Client-Side Direct Multipart Upload Logic | `cb9256a` | `tools/drop/public/upload.html`, `src/tools/drop/router.js` |
| **P4.9** | Cloudflare R2 CORS and Lifecycle Specifications | `cb9256a` | `docs/r2/cors.json`, `docs/r2/lifecycle.json` |
| **P4.10** | Drop Media Download View & QR Verification | `cb9256a` | `tools/drop/public/view.html`, `src/tools/drop/router.js` |
| **P4.11** | Background Sweeper R2 Expired Object Purge | `cb9256a` | `src/utils/sweeper.js`, `src/storage/sqlite.js` |
| **P4.12** | Complete Eradication of Multer & Backward Compatibility | `cb9256a` | `package.json`, `package-lock.json`, `src/tools/drop/router.js`, `tests/drop-r2.test.js` |

---

## Phase 5: Abuse Resistance, Bot Defense & Legal Plumbing
**Primary Feature Commit:** `93b2930` (`feat(security): implement abuse resistance, turnstile, safe browsing, legal pages, and takedown audit (R5)`)  
**Progress Record Commit:** `2a4a885` (`docs(PROGRESS): record Checkpoint Phase 5 abuse resistance, trust, and legal plumbing (R5)`)

| Task ID | Task Description | Commit | Primary Files Modified |
|---|---|---|---|
| **P5.1** | Reverse Proxy Trust Verification & Origin Secret Guard | `93b2930` | `src/config.js`, `src/middleware/proxyTrust.js`, `src/app.js` |
| **P5.2** | Cloudflare Turnstile Bot Defense Middleware | `93b2930` | `src/middleware/turnstile.js`, `src/config.js`, `src/tools/tinyurl/router.js`, `src/tools/paste/router.js` |
| **P5.3** | Automated Threat Feeds Sync (abuse.ch URLhaus / MalwareBazaar) | `93b2930` | `src/services/threatFeeds.js`, `src/app.js` |
| **P5.4** | Google Safe Browsing Lookup v4 Integration | `93b2930` | `src/services/safeBrowsing.js`, `src/utils/urlSecurity.js` |
| **P5.5** | Content Quarantine Flagging & Abuse Webhooks | `93b2930` | `src/tools/tinyurl/router.js`, `src/storage/sqlite.js` |
| **P5.6** | Strict SSRF Engine & Private Destination Validation | `93b2930` | `src/utils/urlSecurity.js`, `tests/coverage-p37.test.js` |
| **P5.7** | Safe Download Headers (`nosniff`, `attachment`, `octet-stream`) | `93b2930` | `src/middleware/securityHeaders.js`, `src/tools/drop/router.js`, `src/tools/paste/router.js` |
| **P5.8** | Legal Compliance Pages (Terms of Service, Privacy Policy) | `93b2930` | `public/terms.html`, `public/privacy.html` |
| **P5.9** | Abuse Reporting Flow & RFC 9116 security.txt | `93b2930` | `public/abuse.html`, `public/.well-known/security.txt` |
| **P5.10** | Dynamic XML Sitemap & Strict Robots Matrix | `93b2930` | `src/registry.js`, `src/app.js` |
| **P5.11** | Administrative Takedown & Audit Log Tool | `93b2930` | `scripts/takedown.js`, `src/storage/sqlite.js`, `tests/phase5.test.js` |

---

## Phase 6: Frontend Modernization, PWA & Accessibility
**Primary Feature Commit:** `5cac7ff` (`feat(frontend): implement asset hashing, self-hosted fonts, theme contrast, client qr, and pwa (R6)`)  
**Progress Record Commit:** `a58687a` (`docs(PROGRESS): record commit hash 5cac7ff for Checkpoint Phase 6`)

| Task ID | Task Description | Commit | Primary Files Modified |
|---|---|---|---|
| **P6.1** | Static Asset SHA-256 Content-Hashing Pipeline | `5cac7ff` | `src/utils/assetHasher.js`, `src/app.js`, `templates/redirect.html` |
| **P6.2** | Purge Google Fonts CDN & Subset Self-Hosted IBM Plex WOFF2 | `5cac7ff` | `public/fonts/*`, `scripts/download-fonts.js`, `public/index.html` |
| **P6.3** | Automated Theme Contrast Audit (WCAG 2.1 / 2.2 AA) | `5cac7ff` | `scripts/audit-contrast.js`, `tools/shared/theme.css` |
| **P6.4** | 320px Viewport Responsive Layout & 44px Touch Targets | `5cac7ff` | `tools/shared/theme.css`, `public/index.html` |
| **P6.5** | Reduced Motion Preferences & Focus-Visible Styling | `5cac7ff` | `tools/shared/theme.css`, `tools/shared/theme-switcher.js` |
| **P6.6** | Client-Side Vector QR Generation Engine | `5cac7ff` | `tools/qr/public/app.js`, `tools/shared/qrcode.min.js`, `src/tools/qr/router.js` |
| **P6.7** | Web App Manifest & Service Worker Offline Cache | `5cac7ff` | `public/manifest.webmanifest`, `tools/public/manifest.webmanifest`, `tools/public/sw.js` |
| **P6.8** | Frontend Page & Asset Bundle Budget Check | `5cac7ff` | `scripts/check-budget.js`, `tests/phase6.test.js` |

---

## Phase 7: Engineering Portfolio, Case Studies & Offline Tools
**Primary Feature Commit:** `ebe6182` (`feat(portfolio): implement project cards schema, case studies, offline tools suite, command palette, and docs (R7)`)  
**Progress Record Commit:** `16ae0bb` (`docs(PROGRESS): record commit hash ebe6182 for Checkpoint Phase 7`)

| Task ID | Task Description | Commit | Primary Files Modified |
|---|---|---|---|
| **P7.1** | Projects Schema Definition & Validation Script | `ebe6182` | `data/projects.json`, `scripts/validate-projects.js` |
| **P7.2** | Terminal Landing Hero, Live Status Strip & JSON-LD Graph | `ebe6182` | `public/index.html`, `src/app.js` |
| **P7.3** | Flagship pokedb.site Architectural Case Study | `ebe6182` | `public/projects/pokedb-site.html` |
| **P7.4** | Draft Project Skeletons & Status Badges | `ebe6182` | `public/projects/aegis.html`, `beacon.html`, `kds.html`, `manifold.html`, `prism.html` |
| **P7.5** | 9 Offline Zero-Egress Developer Utilities (`connect-src 'none'`) | `ebe6182` | `tools/codec/*`, `cron/*`, `diff/*`, `hash/*`, `json/*`, `jwt/*`, `minecraft/*`, `sanitizer/*`, `uuid/*`, `tools/shared/state-url.js` |
| **P7.6** | Paste v2 Client-Side WebCrypto AES-256-GCM Encryption | `ebe6182` | `tools/shared/crypto-web.js`, `tools/paste/public/index.html`, `tools/paste/public/view.js` |
| **P7.7** | TinyURL v2 Preview Modal & Direct Redirect Analytics | `ebe6182` | `src/tools/tinyurl/router.js`, `templates/preview.html` |
| **P7.8** | Command Palette (`Ctrl+K`), ShareX Uploaders & OpenAPI Spec | `ebe6182` | `tools/shared/site.js`, `public/sharex/*`, `docs/openapi.yaml`, `public/docs.html` |
| **P7.9** | Changelog, Public Status Page & Valid RSS 2.0 Feed | `ebe6182` | `docs/CHANGELOG.md`, `public/changelog.html`, `public/status.html`, `public/feed.xml` |

---

## Phase 8: Observability, Sentry Scrubbing & Operations
**Primary Feature Commit:** `94df324` (`feat(ops): implement cached health probes, ring buffer, sentry scrubbing, backup routine, and ci gates (R8)`)  
**Progress Record Commit:** `5c0a4b0` (`docs(PROGRESS): record commit hash 94df324 for Checkpoint Phase 8`)

| Task ID | Task Description | Commit | Primary Files Modified |
|---|---|---|---|
| **P8.1** | Background Health Probe & 60-Point Ring Buffer | `94df324` | `src/tools/health/probe.js`, `src/tools/health/router.js`, `src/storage/sqlite.js` |
| **P8.2** | Server-Side Sentry Client with PII Scrubbing & Rate Capping | `94df324` | `src/services/sentry.js`, `src/tools/health/router.js` |
| **P8.3** | Cloudflare Web Analytics Snippet Isolation | `94df324` | `public/index.html`, `tools/public/index.html`, `src/middleware/securityHeaders.js` |
| **P8.4** | Automated CI Workflow Gates & Dependabot Configuration | `94df324` | `.github/workflows/ci.yml`, `.github/dependabot.yml` |
| **P8.5** | Production Operations Runbook Expansion | `94df324` | `docs/RUNBOOK.md` |
| **P8.6** | Monthly Transactional SQLite Snapshot Backup Routine | `94df324` | `scripts/backup-sqlite.js`, `tests/phase8.test.js` |
