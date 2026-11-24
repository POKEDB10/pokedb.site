# pokedb.site — v2 Implementation Plan

**For:** the IDE AI working in the `pokedb.site` repo.
**Inputs you must read first:** `audit-reports/00-inventory.md`, `01-baseline.md`, `02-findings.md`, `03-research-queue.md`, `04-summary.md`, and this file.
**Goal:** fix every finding in the audit, apply the research decisions (corrected where noted below), make Drop's upload and download as fast as the user's connection allows, and turn pokedb.site into a CV that convinces recruiters plus a tools site developers bookmark.
**Budget:** $0/month target, $5/month hard ceiling. Solo developer. No user accounts.

Save this file in the repo as `docs/IMPLEMENTATION_PLAN.md` and re-read the section you are working on before each phase.

---

## 0. Working rules (non-negotiable)

1. **Branch:** work on `v2/overhaul`. One commit per task ID, Conventional Commits, finding IDs in the message (`fix(SEC-001): ...`). Never leave the branch with failing tests. Do not push to or deploy `main`; the owner deploys at the release checkpoints in §4.
2. **Evidence:** after each task append to `docs/PROGRESS.md`: task ID, commit hash, and the raw output of the acceptance command. "Done" without raw output does not count.
3. **No fabrication.** Never invent metrics, benchmarks, project facts, legal statements, or citations. Anything you cannot know gets the literal marker `TODO(owner)`. Metrics on the site must come from measurements you ran (store them in `docs/BENCH.md`). The research report's example numbers (e.g. "p99 310 ms to 0.3 ms") are projections, not results.
4. **Secrets:** never print, log, or commit secret values. Use Cloudflare's published Turnstile test keys in dev/tests. Anything that needs a real account (R2, Turnstile, Sentry, Google Cloud, Cloudflare dashboard) is listed in §3 as an owner task; build against environment variables and mocks, then tell the owner what to do.
5. **Dependencies:** prefer Node built-ins. For every new dependency write one line in `docs/DEPENDENCIES.md` (name, version, size, why, alternative considered).
6. **Tests:** never delete or weaken a test to get green. If a behavior is intentionally removed (e.g. Rootz endpoints), change the test in the same commit and say why in the message.
7. **Gate checks:** each phase starts with a "Gate" list of facts to re-verify, because parts of the research were not verifiable offline. If a gate fails, stop, write the result in `docs/PROGRESS.md`, and choose the documented fallback.
8. **Ask the owner only about items in §2.** Everything else: proceed with the stated default.
9. **Stop conditions:** if a measurement contradicts this plan (a number worse than before, a test you cannot keep green), stop and report instead of working around it.

---

## 1. Corrections to the research report (apply these; do not follow the report where it conflicts)

| # | Report said | Correct handling |
|---|---|---|
| C1 | Downgrade advice for multer was wrong (H1) | Confirmed: multer 2.x is the maintained line (2.1.0 fixed two high-severity DoS CVEs, 2.2.0 fixed another). Never use 1.x. Do **not** trust the report's specific "2.5.0" and CVE-2026-77xxx ids until you run `npm view multer dist-tags` and `npm audit --omit=dev`. Once Drop v2 ships, remove multer entirely. |
| C2 | Litestream streams WAL "only when writes occur", so R2 Class A ops are safe | Each committed write can trigger a replication PUT. At the default 1 s sync interval, a busy redirect service (every click is a write) could pass R2's 1,000,000 free Class A ops/month. Required: batch click counters (flush every 5 s in one transaction) **and** set Litestream `sync-interval` to 30 s or more. Verify the key names against the installed Litestream version. |
| C3 | Put R2 lifecycle expiry on the bucket | Use **two buckets**: `drops` (lifecycle: expire after 3 days, abort incomplete multipart after 1 day) and `backups` (no expiry rule). A shared bucket with an expiry rule would delete the database replica. |
| C4 | Mandatory client-side encryption for Drop | It breaks curl uploads and server-side hash checks, and it is a legal-posture choice. Implement it as a policy switch (`DROP_POLICY`, §2 D1), not a hard-coded rule. |
| C5 | `CSP: sandbox; default-src 'none'` on `/v/:id` | That would break the page's own script. Apply the sandbox CSP only to raw text responses (`/raw/:id`). Download pages use a normal strict CSP. |
| C6 | PoW header for CLI is P0 | Demoted. First ship Turnstile for web forms plus strict per-subnet limits for CLI. Add PoW only if abuse appears (task P5.9). |
| C7 | Migrate Jest to node:test | Skip. It is dev-only, risky, and not needed to ship. Keep Jest, upgrade it, gate CI on `npm audit --omit=dev`. |
| C8 | `express-rate-limit@^7.5` with `ipKeyGenerator` | `ipKeyGenerator` and default IPv6 /56 masking ship in v8. Check `npm view express-rate-limit version`. Prefer v8 and its default key generator. |
| C9 | Cloudflare Web Analytics everywhere plus "offline verified" badge (`connect-src 'none'`) | Contradiction: the analytics beacon needs `connect-src`. No analytics and no third-party scripts on client-side tool pages. Badge only where true. |
| C10 | "XSS is mathematically impossible" after moving downloads to R2 | Overclaim. Say "mitigated" and keep the headers/tests. |
| C11 | Presigned URLs with custom domains | Presigned URLs are for the S3 endpoint (`*.r2.cloudflarestorage.com`). Verify before designing around a custom download domain. |
| C12 | Sign exact `ContentLength` on each part | Try it (SDK `unhoistableHeaders`/signable headers) and test with curl that R2 rejects a larger body. If it does not enforce, rely on the post-upload `ListParts` size check at `/complete` (already in P4) and delete oversize uploads. |

---

## 2. Owner decisions (defaults apply if unanswered) and owner-only tasks

### Decisions

| ID | Decision | Default the plan implements |
|---|---|---|
| D1 | **Drop policy** (`DROP_POLICY`): `open_limited` (plaintext allowed, caps, Turnstile, reports) / `encrypted_only` (browser must encrypt) / `disabled` (owner token only). The report's legal section says anonymous file hosting is the highest-liability feature for a UAE-based operator. It comes from law-firm blog summaries, not legal advice. Consider a short lawyer consult. | `open_limited` in code and `.env.example`; **the owner must confirm D1 before the public deploy** (checkpoint R4). Switching later is one env var. |
| D2 | **Where untrusted content lives:** (A) second cheap domain for redirects, drop pages and paste views (check the *renewal* price, not first-year), or (B) stay on `*.pokedb.site` with an interstitial preview before redirects. | B now, implemented through `UGC_BASE_URL` and `REDIRECT_MODE=interstitial|direct`, so moving to A is configuration only. |
| D3 | **Hosting:** (A) self-host + Cloudflare Tunnel + SQLite, or (B) Render/Koyeb free + Upstash Redis. | A. The Redis adapter is built only if the owner picks B. |
| D4 | **Retention defaults.** Drop 24 h default / 72 h max / 250 MiB. Paste 7 d default / 30 d max / 256 KiB. Short links 30 d default / 365 d max (permanent only with owner token); 0-click links pruned after 14 d. | As stated. |
| D5 | **R2 spend.** Free tier is 10 GB-month. With 250 MiB files only ~34 max-size files fit. R2 beyond free is about $0.015/GB-month, so 100 GB-month is about $1.50. | Soft cap 8.5 GB (`STORAGE_SOFT_CAP_BYTES`), owner may raise it. |

### Owner-only tasks (the IDE AI cannot do these)

| ID | Task | Env var(s) the code expects |
|---|---|---|
| O1 | Production topology: run `GET /__diag/ip` (built in P1.6) from the live site and send the output to the AI. Tells us the real proxy hop count. | `TRUST_PROXY` |
| O2 | Cloudflare R2: enable (a payment method is required even for the free tier), create buckets `pokedb-drops` and `pokedb-backups`, create two API tokens scoped per bucket (Object Read & Write), apply the CORS + lifecycle JSON from P4.2. | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_DROPS`, `R2_BUCKET_BACKUPS` |
| O3 | Turnstile: create one widget covering the tool hostnames. | `TURNSTILE_SITEKEY`, `TURNSTILE_SECRET` |
| O4 | Cloudflare Tunnel created and token issued; origin ports closed on the host firewall. | `TUNNEL_TOKEN` (compose only) |
| O5 | Cloudflare Email Routing: `abuse@`, `dmca@`, `security@`, `contact@pokedb.site` to the owner's inbox. | none |
| O6 | Discord webhook for abuse alerts. | `ABUSE_WEBHOOK_URL` |
| O7 | Google Cloud project with Safe Browsing API key (non-commercial use). | `GSB_API_KEY` |
| O8 | Sentry project (server-side only) and uptime monitor. | `SENTRY_DSN` |
| O9 | Cloudflare dashboard: Brotli on, HTTP/3 on, Early Hints on, Bot Fight Mode on, one rate-limiting rule (e.g. 60 POST/min on `/api/*`), Web Analytics on non-tool pages only. | none |
| O10 | Project facts for the five placeholder cards (private or public? real metrics? what can be shown?), `resume.pdf`, LinkedIn URL. | none (`data/projects.json`) |
| O11 | Run `scripts/bench-drop.js` against real R2 from the owner's own network and commit the output. | none |

---

## 3. Targets (measured, not claimed)

| Area | Target | How measured |
|---|---|---|
| Redirect hot path | ≥ 2,000 req/s and p99 < 15 ms at 50 connections, locally | `scripts/bench/redirect.js` (autocannon) |
| Concurrent writes | 30 parallel `POST /api/paste/create` all succeed in < 2 s | `scripts/bench/paste-concurrency.js` (PERF-001 repro, now passing) |
| Event loop | p99 delay < 50 ms under the above loads | `perf_hooks.monitorEventLoopDelay` in bench script |
| Drop `POST /api/drop/init` | p95 < 150 ms at origin | bench script |
| Drop `GET /d/:id` (302 to R2) | p95 < 30 ms at origin | bench script |
| Drop upload | ≥ 85% of the owner's measured line speed on a 100 MiB file; first byte sent < 500 ms after file selection (Turnstile pre-warmed); resume works after killing the network mid-upload | `scripts/bench-drop.js` plus manual test |
| Drop download | bytes never touch the origin; Range requests work | `curl -r 0-1023` and `curl -C -` against a presigned URL |
| Lighthouse (mobile, every page) | Performance ≥ 95, Accessibility ≥ 98, Best Practices ≥ 95, SEO = 100 (tinyurl/drop/paste were 63 because of noindex) | `npx lighthouse` per page, stored in `docs/BENCH.md` |
| Page weight | first load ≤ 75 KB compressed per tool page including fonts | `scripts/check-budget.js` |
| Layout | no horizontal overflow at 320–1920 px, tap targets ≥ 44 px, CLS ≤ 0.02 | Playwright test |
| Accessibility | 0 serious/critical axe violations on the 3 key pages in all 12 themes | axe in CI |
| Security hygiene | `npm audit --omit=dev` shows 0 high/critical; 0 secrets in tree and history | CI |
| Coverage | ≥ 80% lines on `src/` | `jest --coverage` |
| Content | 0 `href="#"`, 0 `TODO(owner)` in published pages | `scripts/check-placeholders.js` in CI |

---

## 4. Release checkpoints (owner deploys at each)

| Checkpoint | After | What changes in production |
|---|---|---|
| R1 | Phase 1 | Safe patches: deps, robots/SEO headers, token handling, async scrypt, diagnostics endpoint. |
| R2 | Phase 2 | SQLite store + Litestream backups + new Dockerfile/compose. Needs O2 (backups bucket), O4. Run the restore drill first. |
| R3 | Phase 3 | Modular app; localhost dev works. No user-visible change expected. |
| R4 | Phase 4 | Drop v2 on R2. Needs O2, O3, and **D1 confirmed**. |
| R5 | Phases 5–6 | Abuse controls, legal pages, new CSP, hashed assets, responsive/a11y fixes, PWA. |
| R6 | Phases 7–9 | Portfolio rebuild, new tools, observability, final verification report. |

Phase order is chosen so each checkpoint is independently shippable. Do not start a phase before the previous phase's Definition of Done is met.

---

## Phase 0 — Prep and baseline (do first)

**Gate:** run and record in `docs/PROGRESS.md`:
`node -v`, `node -e "require('node:sqlite'); console.log('sqlite ok')"` (note any ExperimentalWarning), `npm view multer dist-tags`, `npm view express-rate-limit version`, `npm view helmet version`, `npm view express version`.
If `node:sqlite` is missing or unstable on the target runtime, record that and plan to use `better-sqlite3` behind the same store interface in Phase 2 (prebuilt musl binaries exist; verify on the Docker base image).

| Task | Work | Acceptance |
|---|---|---|
| P0.1 | Create `v2/overhaul`. Commit `audit-reports/` as-is. | `git status` clean. |
| P0.2 | Add `scripts/bench/` (autocannon via `npx`, not a dependency): `redirect.js` (seeds one link), `health.js`, `landing.js`, `qr.js`, `paste-concurrency.js` (30 parallel creates, reproduces PERF-001), `event-loop.js` (reports p99 delay). Run them against the **current** code, production mode. | `docs/BASELINE.md` has raw output for each. The paste-concurrency script must visibly reproduce the hang before any fix. |
| P0.3 | Characterization tests for behavior that will move: redirect + click count, alias collision suggestions, paste burn-on-read, password paste, host routing per subdomain, robots headers, drop delete token. | New tests pass on current code (41 old + new). |
| P0.4 | Tooling: `.nvmrc` (24), `engines` in `package.json`, `.editorconfig`, GitHub Actions workflow (`npm ci`, `node --check`, `npm test`, `npm audit --omit=dev --audit-level=high`, `scripts/check-placeholders.js`, hadolint). `scripts/check-placeholders.js` fails on `href="#"` and `TODO(owner)` inside `public/` and `tools/` (allow a list of files that are still pending, shrinking to zero by Phase 7). | CI green on the branch. |

**DoD:** baseline numbers saved; CI exists; all tests green.

---

## Phase 1 — Stop the bleeding (ship as R1)

Small independent commits. These must not change the data model.

| Task | Findings | Work | Acceptance |
|---|---|---|---|
| P1.1 | SEC-004, H1 | Bump multer to the latest **2.x** (never 1.x), express to latest 4.x, helmet and express-rate-limit to current majors (C8), upgrade Jest. Run `npm audit --omit=dev`. Document each remaining advisory (production vs dev, exploitable or not) in `docs/DEPENDENCIES.md`. | `npm audit --omit=dev` → 0 high/critical. Tests green. |
| P1.2 | SEO-001, H4 | Replace the host/path-length noindex logic with a route-pattern `robotsPolicy` middleware per the table below. | The curl matrix below passes. |
| P1.3 | SEC-003 | Tokens (admin, delete) accepted only via `Authorization: Bearer` or `X-Admin-Token`/`X-Delete-Token` headers. A `token`/`admin_token` query parameter → 400 `{"error":"query_tokens_forbidden"}`. Update frontends (drop view delete button etc.) to send headers. All comparisons constant-time. | `curl -i "$H/api/drop/list?token=x"` → 400. Header version works. |
| P1.4 | PERF-002 | Replace `crypto.scryptSync` with promisified `crypto.scrypt`. Add a small semaphore (max 2 concurrent scrypt jobs) so hashing cannot starve the libuv pool that fs/DNS also use. | During 20 parallel protected-paste creations, `/health` stays < 50 ms (event-loop script). |
| P1.5 | PERF-001, PERF-004 | Interim fix only: `savePersistentStore()` resolves **all** pending promises of a debounce window, and the redirect path never awaits persistence. (Phase 2 deletes this code; keep the change tiny.) | `paste-concurrency.js`: 30/30 succeed. Redirect bench no longer ~3 req/s. |
| P1.6 | SEC-001, H2, H3 | (a) `TRUST_PROXY` env parsed as `false` / integer / comma list / named subnets; if unset in production, keep today's value and log a loud warning at boot. (b) Admin-only `GET /__diag/ip` (Bearer) returning `req.socket.remoteAddress`, raw `X-Forwarded-For`, `CF-Connecting-IP`, resolved `req.ip`, `req.ips`. (c) Optional `ORIGIN_VERIFY_SECRET`: when set, requests lacking a matching `X-Origin-Verify` (timing-safe) get 403, except `/healthz` from loopback. (d) Remove the blunt global `/api/` 120-per-15-min limiter; use per-route budgets from the table below. (e) Rate-limit identity: `req.ip` with IPv6 collapsed to /56 (v8 default). Never read `CF-Connecting-IP` unless origin lock (c) or Tunnel is active. | Tests with a fake proxy chain for: direct (spoof ignored), 1 hop, 2 hops, Tunnel (`['loopback','uniquelocal']`). Owner runs O1 and sets `TRUST_PROXY`. Spoof test: `for i in $(seq 1 35); do curl -s -o /dev/null -w "%{http_code}\n" -H "X-Forwarded-For: 203.0.113.$i" $H/api/shorten -d '{"url":"https://example.com"}' -H 'content-type: application/json'; done` → requests 31–35 are 429. |
| P1.7 | ARCH-003/004, DX | Delete the 44-byte `tools/shared/qrcode.min.js` stub and obsolete `tools/README.md`. Make `.env.example`, README env table, and docker-compose agree (every variable read in code appears in all three; add `scripts/check-env-docs.js` and run it in CI). Fix README setup steps. | Script passes. |
| P1.8 | CV-001 (interim) | Cards whose URL is `#` render as non-clickable "Case study in progress" (no dead link). | `grep -c 'href="#"' public/index.html` → 0. |

### Robots policy (P1.2)

| Host / path | `X-Robots-Tag` | robots.txt |
|---|---|---|
| `pokedb.site/`, `/projects/*` | `index, follow` | Allow |
| `tools.` hub and tool pages, `qr.pokedb.site/` | `index, follow` | Allow |
| `tinyurl.`, `drop.`, `paste.` **exact `/` only** | `index, follow` | `Allow: /$` |
| `/:code`, `/v/:id`, `/d/:id`, `/b/:id`, `/raw/:id`, `/p/:id`, interstitials | `noindex, nofollow, noarchive, nosnippet` | **Do not Disallow** (crawlers must fetch the page to see the header) |
| `/api/*`, `/admin/*`, `/__diag/*` | `noindex` | `Disallow` |
| `health.` | `noindex, follow` | Allow |
| `/assets/*`, `/fonts/*` | none | Allow |

Acceptance: `curl -sI -H "Host: tinyurl.pokedb.site" $H/` shows `index, follow`; `.../abc123` shows `noindex, nofollow, noarchive`; `/assets/x.css` has no robots header.

### Rate-limit budgets (replace the global limiter)

| Route | Budget |
|---|---|
| `GET /:code` redirect | 300/min per IP |
| `POST /api/shorten` (browser, Turnstile in P5) | 30 / 15 min |
| `POST /api/paste/create` | 30 / 15 min |
| paste password attempts | 10 / 15 min per (ip, paste) |
| viewers (`/v`, `/raw`, `/d`) | 120/min |
| `GET/POST /api/qr` | 120/min (responses cacheable at the edge) |
| admin endpoints | 10 failed attempts / 15 min |
| Drop init | 10/hour per subnet, plus daily byte quota (P4) |

**DoD:** R1 deployable; `npm audit --omit=dev` clean; the PERF-001 repro passes; robots matrix passes.

---

## Phase 2 — Storage and deployability (ship as R2)

**Gate:** if D3 = (B) Render/Upstash, also build `src/storage/redis.js` behind the same interface and skip Litestream.

| Task | Findings | Work |
|---|---|---|
| P2.1 | PERF-001/004/005, REL-002/003 | `src/storage/sqlite.js` using `node:sqlite` `DatabaseSync` (or better-sqlite3 per the Gate). Pragmas: `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, `foreign_keys=ON`, `temp_store=MEMORY`. Versioned migrations table. Prepared statements cached. A `transaction(fn)` helper. |
| P2.2 | | Schema (adjust names to fit existing code, keep types and indexes): |

```sql
CREATE TABLE links(code TEXT PRIMARY KEY, target TEXT NOT NULL, created_at INTEGER NOT NULL,
  expires_at INTEGER, clicks INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
  creator TEXT) WITHOUT ROWID;
CREATE INDEX links_exp ON links(expires_at) WHERE expires_at IS NOT NULL;
CREATE TABLE pastes(id TEXT PRIMARY KEY, title TEXT, language TEXT, body BLOB NOT NULL,
  encrypted INTEGER NOT NULL DEFAULT 0, pw_salt BLOB, pw_hash BLOB, burn INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active', creator TEXT) WITHOUT ROWID;
CREATE INDEX pastes_exp ON pastes(expires_at);
CREATE TABLE drops(id TEXT PRIMARY KEY, object_key TEXT NOT NULL, upload_id TEXT, name TEXT NOT NULL,
  size INTEGER NOT NULL, state TEXT NOT NULL,            -- initiated|complete|expired|quarantined|deleted
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, downloads INTEGER NOT NULL DEFAULT 0,
  max_downloads INTEGER, sha256 TEXT, delete_hash BLOB NOT NULL, encrypted INTEGER NOT NULL DEFAULT 0,
  creator TEXT) WITHOUT ROWID;
CREATE INDEX drops_state_exp ON drops(state, expires_at);
CREATE TABLE reports(id INTEGER PRIMARY KEY, kind TEXT, target_id TEXT, subnet TEXT, reason TEXT, at INTEGER);
CREATE TABLE threat_indicators(kind TEXT, value TEXT, source TEXT, added_at INTEGER, PRIMARY KEY(kind,value)) WITHOUT ROWID;
CREATE TABLE verdict_cache(host TEXT PRIMARY KEY, verdict TEXT, checked_at INTEGER) WITHOUT ROWID;
CREATE TABLE takedown_audit(id INTEGER PRIMARY KEY, kind TEXT, target_id TEXT, content_sha256 TEXT,
  created_at INTEGER, creator_subnet TEXT, removed_at INTEGER, reason TEXT);
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER);
```

| Task | Work | Acceptance |
|---|---|---|
| P2.3 | Replace the Redis / in-memory Map / `data/store.json` triple path with the single store. Delete the debounce flush entirely. `STORE=sqlite` (default) or `redis` (only if D3 = B). `data/store.json` is never written again. | `grep -rn "store.json" src server.js` → none (except the migration script). |
| P2.4 | **Redirect hot path:** one prepared `SELECT target FROM links WHERE code=? AND status='active' AND (expires_at IS NULL OR expires_at>?)`. Click counting goes to an in-memory `Map<code,delta>` flushed every 5 s in one transaction and on shutdown. No external calls, no awaits on I/O. (Accepts losing ≤ 5 s of click counts on a hard crash; document it.) | `scripts/bench/redirect.js`: ≥ 2,000 req/s, p99 < 15 ms at 50 connections. |
| P2.5 | Sweeper timer: delete expired rows in batches of 500 per tick; daily `PRAGMA optimize`; passive WAL checkpoint on shutdown only (Litestream owns checkpointing). | Test with 10k expired rows: loop never blocks > 50 ms. |
| P2.6 | TOOL-TINY-001: alias suggestions use one `WHERE code IN (...)` query instead of up to 48 sequential lookups. | Unit test. |
| P2.7 | `scripts/migrate-legacy.js`: imports `data/store.json` and/or Redis keys (`url:*`, `paste:*`, `drop:*`) into SQLite. `--dry-run` by default, prints counts per type, skips expired. | Dry run on a copy of production data shows matching counts. |
| P2.8 | Graceful shutdown: on SIGTERM stop accepting, flush click buffer, wait for in-flight (max 10 s), passive checkpoint, close DB. | Test sends SIGTERM mid-load; no data loss. |
| P2.9 | **Deployability (OPS-001):** multi-stage Dockerfile (`node:24-alpine`, `npm ci --omit=dev`, `COPY --chown`, numeric non-root user, `HEALTHCHECK` on `/healthz`, `tini`/`init: true`). `docker-compose.yml`: app has **no published ports**, a `cloudflared` service with `TUNNEL_TOKEN`, a named volume for `/data`, `read_only: true` root with tmpfs `/tmp`, memory limit, `restart: unless-stopped`, all env vars from P1.7. Litestream: restore-if-missing then `replicate -exec` as the entrypoint; replica = backups bucket on R2 (S3 endpoint `https://<account>.r2.cloudflarestorage.com`, region `auto`), `sync-interval` ≥ 30 s (C2), sensible `retention`. Verify the YAML keys against the Litestream version you install. | `hadolint Dockerfile` → 0 findings. If Docker is not installed on the dev machine, mark the build/run checks **UNVERIFIED** and give the owner exact commands. |
| P2.10 | **Restore drill** (documented in `docs/RUNBOOK.md` and executed once by the owner): write rows, wait one sync interval, delete the volume, start the stack, confirm rows are back. | Row counts match before and after. |

**Durability test (P2.3):** create 100 links and pastes, `kill -9` the process, restart, count rows. Expect 100/100 (WAL). Expect click counters to lag by at most 5 s.

**DoD (R2):** no JSON store, no dual-store sync, no hung promises, backups verified by a restore drill.

---

## Phase 3 — Modularize (ship as R3)

**Goal:** `server.js` becomes ~40 lines; adding a tool really is two steps (ARCH-001, ARCH-002, DX-001, RESP-003).

| Task | Work | Acceptance |
|---|---|---|
| P3.1 | `src/config.js`: one validated config object (no new dependency). In production, missing required variables abort startup with a clear message. `.env.example` and README table generated or checked from it. | `scripts/check-env-docs.js` passes. |
| P3.2 | `src/logger.js` (pino): JSON logs, request id, redaction of `authorization`, tokens, and full IPs (log `/24` or `/56` prefix only). Never log query strings for `/:code`, `/d/:id`, `/v/:id`. | Test asserts a token never appears in log output. |
| P3.3 | `src/middleware/`: `proxyTrust`, `rateLimit`, `auth`, `robotsPolicy`, `securityHeaders`, `hostRouter`, `errors`. Behavior unchanged from Phase 1; tests move with them. | Existing tests green. |
| P3.4 | `src/registry.js`: array of `{ id, subdomain, subpath, title, description, indexRoot, router, public }`. A `hostRouter` resolves a tool from `Host` (production) or from `/tools/<id>/` (localhost and unknown hosts). `GET /` on localhost serves the landing page. Navigation links on every page are generated from the registry (host-aware), so local navigation never jumps to production. The hub cards and `/sitemap.xml` are generated from the same registry. | `curl localhost:5050/` → 200; `/tools/tinyurl/`, `/tools/qr/`, `/tools/drop/`, `/tools/paste/`, `/tools/health/` → 200. Clicking nav on localhost stays on localhost. |
| P3.5 | Per-tool routers `src/tools/{tinyurl,paste,qr,drop,health}/router.js`. `src/app.js` exports `createApp({ store, objectStore, config, clock })` and does **not** listen. Shared helpers move to `src/utils/` before routes move (avoids closure breakage). Move one tool per commit. | Tests green after every commit. |
| P3.6 | Prove the claim: add a throwaway `hello` tool using only (1) a folder and (2) one registry line; confirm it is reachable by subdomain and subpath, listed on the hub, and in the sitemap. Delete it. Write `docs/ADDING_A_TOOL.md`. | Raw curl output in `PROGRESS.md`. |
| P3.7 | Coverage: add tests until `src/` is ≥ 80% lines (host router, limiter keys, auth, robots, store, sweeper, shutdown, error handler). | `jest --coverage` report. |
| P3.8 | Optional, only if every test stays green: Express 5 (`/*splat` wildcards, async error forwarding). Otherwise stay on latest 4.x and note why. | Decision in `PROGRESS.md`. |

**DoD (R3):** `wc -l server.js` ≤ 60; adding-a-tool proof passes; localhost works.

---

## Phase 4 — Drop v2 on Cloudflare R2 (ship as R4) — the speed phase

**Gate (re-verify before writing code):**
1. R2 multipart rules: minimum part size 5 MiB (except last), **all non-final parts the same size**, up to 10,000 parts.
2. Does R2 enforce a signed `content-length` on a presigned UploadPart? (Test with curl; see C12.)
3. Does R2 honor `response-content-disposition` / `response-content-type` on presigned GET? (If not, rely on headers stored at `CreateMultipartUpload`, which this design sets anyway.)
4. R2 free-tier numbers and "payment method required" on the current pricing page.
5. Cloudflare's current proxied request-body limit (the design avoids it entirely because bytes go browser → R2).
If R2 cannot be activated (no card), switch the object store to Backblaze B2 behind the same `objectStore` interface (S3-compatible; same flow).

### 4.1 Architecture

```
Browser ──(1) POST /api/drop/init ─────────────► origin (Tunnel) ──► R2 CreateMultipartUpload
Browser ◄─ {id, partSize, presigned part URLs[], deleteToken}
Browser ══(2) PUT part n  (XHR, 6–8 in parallel) ══════════════════► R2 S3 endpoint (bypasses origin and Tunnel)
Browser ──(3) POST /api/drop/complete {parts[etag]} ─► origin ──► R2 ListParts + CompleteMultipartUpload
Downloader ─ GET /d/:id ─► origin ─ 302 (presigned GET, 10 min) ─► R2  (bytes never touch the origin)
```

Rules: a single object-store interface (`objectStore`) with `createMultipart`, `presignPart`, `listParts`, `complete`, `abort`, `head`, `presignGet`, `delete`, `deleteMany`. Production implementation uses `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (log it in `DEPENDENCIES.md`). Tests use an in-memory fake. Object key: `drops/<id>` with `id = 21 chars from crypto.randomBytes` (≥ 126 bits). Always use multipart, even for tiny files (one part): this lets the **server** set `ContentType: application/octet-stream` and `ContentDisposition: attachment; filename=...` at creation, so the browser needs no signed headers and CORS stays simple. A single-PUT fast path for small files is optional after benchmarking (P4.12).

### 4.2 R2 configuration (owner applies; ship the JSON in `docs/r2/`)

CORS for the `pokedb-drops` bucket:

```json
[{
  "AllowedOrigins": ["https://drop.pokedb.site"],
  "AllowedMethods": ["PUT", "GET", "HEAD"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3600
}]
```

Missing `ExposeHeaders: ["ETag"]` is the #1 failure: the browser cannot read part ETags. The client must detect this on the first part and show an explicit error, not a generic failure. Add the local dev origin only in a separate dev bucket.

Lifecycle (drops bucket only): delete objects with prefix `drops/` after 3 days; abort incomplete multipart uploads after 1 day. This is a backstop; the app's sweeper deletes at the exact expiry. The backups bucket has no expiry rule (C3).

### 4.3 Server API (new, replaces every Rootz/multer/multipart route)

| Route | Behavior |
|---|---|
| `POST /api/drop/init` | Body `{name,size,ttlHours:1\|12\|24\|72,burn,encrypted,turnstileToken}`. Checks, in order: `DROP_POLICY` (D1); Turnstile (P5; skipped with test keys in dev); rate limit; `size` 1…`DROP_MAX_BYTES` (250 MiB; owner token may exceed up to `OWNER_MAX_BYTES`); sanitized name; blocked extensions unless `encrypted` (`.exe .scr .msi .bat .cmd .com .pif .apk .dll`; **allow** `.jar .zip .mrpack .tar.gz`, the Minecraft community needs them); storage soft cap (D5); daily per-subnet and global byte quota. Creates the multipart upload, inserts the `drops` row (`state=initiated`), returns `{id, partSize, parts:[{n,url}], shareUrl, deleteToken}`. `deleteToken` is shown once, stored as a hash. Part URLs expire in 15 min. |
| `POST /api/drop/resume` | Body `{id,deleteToken}`. Calls `ListParts`, returns fresh URLs for the missing parts only. |
| `POST /api/drop/complete` | Body `{id,deleteToken,parts:[{n,etag}],sha256?}`. Server runs `ListParts`, checks part count and the **sum of part sizes against the declared size and the cap** (this is the enforcement of last resort, C12). On violation: abort/delete and return 413. Otherwise `CompleteMultipartUpload`, `HeadObject` size check, set `state=complete`, fire the async hash check (P5.4), return `{shareUrl, viewUrl, curl}`. |
| `POST /api/drop/abort` | Body `{id,deleteToken}`. Aborts the multipart upload and marks deleted. |
| `GET /d/:id` (and `HEAD`) | Validate: exists, complete, not expired, not quarantined, downloads left. Atomically increment the counter (`UPDATE … WHERE downloads < max`). Respond `302` to a presigned GET (TTL 10 min) with `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex…`. Works for `curl -LOJ`, download managers, and `Range`/resume. |
| `GET /v/:id` | Small HTML preview: name, size, expiry, downloads left, **Download** button (plain link to `/d/:id`, works without JS), copy-curl button, QR for mobile, **Report abuse**. Normal strict CSP (not sandbox, C5). |
| `GET /api/drop/:id/meta` | JSON of the same facts; `noindex`. |
| `DELETE /api/drop/:id` | Bearer `deleteToken` (hash compared in constant time). Deletes the object and marks deleted. |
| Removed | Rootz client and `ROOTZ_*` vars, `/api/drop/remote-upload` (resolves SEC-002), `/api/drop/multipart/*`, local disk staging, multer, `LARGE_FILE_PASSWORD`. After removal, `npm ls multer` should be empty. |

Burn after download: the claim in `/d/:id` marks the drop consumed, the URL stays valid for its 10-minute TTL, and the sweeper deletes the object after that. Document the trade-off (a failed download after the claim is not retried).

### 4.4 Client upload algorithm (`tools/drop/public/upload.js`) — this is where speed comes from

```
on page load:     pre-warm an invisible Turnstile token (refresh before it ages out)
on file selected: POST /api/drop/init              # first byte can leave within ~1 round trip
                  start uploading immediately      # do NOT wait for hashing
                  in parallel: SHA-256 in a Web Worker (streaming hash lib or SubtleCrypto
                  for ≤ 250 MiB); result is sent at /complete, never on the critical path
part sizing:      size ≤ 64 MiB → 8 MiB parts; otherwise 16 MiB (≤ 16 parts at 250 MiB).
                  All parts equal size except the last. Larger parts matter because each
                  cross-origin PUT triggers a CORS preflight that browsers cache per full
                  URL, so every part pays one extra round trip.
concurrency:      start at 4. +1 every 3 successful parts while aggregate throughput improved
                  ≥ 10%; max 8. -1 on timeout or 5xx (min 2).
per part:         XMLHttpRequest PUT (not fetch: upload progress events are needed),
                  Content-Type: application/octet-stream, stall timeout 30 s without progress,
                  4 retries with exponential backoff + jitter (0.5 s → 8 s),
                  on 403/expired URL call /api/drop/resume for fresh URLs, then retry.
ETag:             read from the response header; if missing, stop and show the
                  "CORS ExposeHeaders ETag" diagnostic.
persist:          { id, deleteToken, doneParts:[{n,etag}] } in IndexedDB keyed by
                  name|size|lastModified. Re-selecting the same file offers "Resume".
complete:         POST /api/drop/complete with all {n,etag} + sha256.
UX:               aggregated progress, EMA-smoothed MB/s and ETA, pause/resume (abort in-flight
                  XHRs, keep finished parts), beforeunload guard, navigator.wakeLock while
                  uploading (try/catch), clear errors per failure type.
```

### 4.5 Download speed rules

- Origin and Tunnel only hand out a 302; the file bytes go straight from R2 to the user. This matters twice for a self-hosted origin: it is not capped by the home uplink and does not hit Cloudflare's proxy size limits.
- Never proxy or buffer file bytes in Node. No `res.sendFile` for drops anywhere.
- `Range` requests pass through to R2 (resume, `aria2c -x8`, parallel managers).
- Presigned GET URLs hit the S3 endpoint and are not CDN-cached. A Worker with an R2 binding plus a signed token could cache popular files at the edge, but only build that if `bench-drop.js` shows the S3 endpoint is the bottleneck (P4.12).

### 4.6 Lifecycle, accounting, abuse guards

| Task | Work |
|---|---|
| P4.6a | Sweeper every 5 min: (1) `complete` and past `expires_at` → `deleteMany` (free op) → `state=expired`; (2) `initiated` older than 1 h → `AbortMultipartUpload`; (3) `quarantined` → delete object; (4) bounded batches. Resolves TOOL-DROP-001. |
| P4.6b | Storage accounting from the `drops` table. If active bytes > `STORAGE_SOFT_CAP_BYTES` (default 8.5 GB) → `init` returns 503 `drop_full`. Daily caps: `DROP_DAILY_BYTES_PER_SUBNET` (500 MiB) and `DROP_DAILY_BYTES_GLOBAL` (default 3 GB). Alert via the abuse webhook at 70% of cap. R2 bills beyond the free tier, so these caps are the safety net. |
| P4.6c | Filename handling: NFC normalize, strip control chars and path separators, max 180 bytes, fallback `file`; build `Content-Disposition` with an ASCII fallback plus `filename*=UTF-8''…`. |
| P4.6d | Legacy Rootz files: only if the owner says active files exist (open question U-04), keep `/v/:legacyId` as a read-only redirect until `LEGACY_ROOTZ_UNTIL`; otherwise delete all Rootz code. |

### 4.7 UI

Rebuild `tools/drop/public/*` around the algorithm above: one drop zone, paste-anywhere (Ctrl+V), TTL and burn options, live speed/ETA, resumable state, copy link + curl command + QR, delete button using the Bearer token, clear limits text (250 MiB, 24–72 h). Batch links (parity with the old "folder" feature): after several files finish, `POST /api/drop/batch {ids}` creates `/b/:id` listing them with the earliest expiry.

### 4.8 Optional encrypted mode (when D1 ≠ `open_limited`, or as a user toggle)

AES-256-GCM via WebCrypto in 1 MiB chunks; per-chunk IV = 4 random bytes + 8-byte counter; chunk index and a "final" flag go in the AAD (stops reordering and truncation); key only in the URL fragment (`#k=`). Encrypted drops are browser-download only (the curl link downloads ciphertext), skip server hash checks, and may bypass the executable-extension block. Decryption buffers into a Blob (fine up to 250 MiB on desktop; warn on mobile). Same chunk format will be reused for pastes in P7.

### 4.9 Benchmark and tuning (`scripts/bench-drop.js`, owner runs it: O11)

Uploads a random 100 MiB buffer to a real R2 bucket using presigned parts. Sweeps concurrency {1,2,4,6,8} × part size {8,16,32} MiB, prints a table (wall time, MB/s), then downloads via the 302 with `curl -w "%{speed_download}"` and with 4 ranged parallel requests. Commit results to `docs/BENCH.md` and set the **defaults from measurement**. Node's networking differs from a browser, so also do one manual browser run with DevTools throttling off and record MB/s next to the owner's speedtest result. The acceptance target is ≥ 85% of line speed.

### 4.10 Tests (fake object store)

- init rejects: oversize, blocked extension (plaintext), bad TTL, missing Turnstile in production, policy `disabled`.
- complete rejects when the part-size sum exceeds the cap or the declared size, and aborts the upload.
- `/d/:id`: 302 with correct headers; expired → 410; quarantined → 451; burn consumes exactly once under concurrent requests.
- sweeper deletes expired and aborts stale uploads; storage cap returns 503.
- no code path calls `fs.createWriteStream` for uploads; `npm ls multer` is empty.

### 4.11 Security checks specific to Drop (SEC-002, SEC-006)

Upload an HTML file and an SVG file containing script; fetch via the presigned URL; assert the response has `Content-Disposition: attachment` and `application/octet-stream`. Confirm the old remote-upload route returns 404.

### 4.12 Optional optimizations (only after P4.9 data justifies them)

Small-file fast path (single presigned PUT with signed headers) · bucket location hint near the main user region (best-effort) · edge-cached downloads through a Worker · tus is **not** needed.

**DoD (R4):** all acceptance items in §3 for Drop; D1 confirmed by the owner; `docs/BENCH.md` has measured numbers.

---

## Phase 5 — Abuse resistance, trust, legal, SEO plumbing (part of R5)

**Gate (verify and record before coding):** (1) what access abuse.ch now requires for URLhaus and MalwareBazaar downloads or API (an auth key?) and their terms; (2) OpenPhish community feed terms; (3) Google Safe Browsing v4 Lookup availability, quota, non-commercial terms, and attribution wording; (4) Cloudflare's published Turnstile test keys. If a feed is not accessible on free terms, drop it and say so; do not substitute guesses.

| Task | Findings | Work |
|---|---|---|
| P5.1 | | **Turnstile**: `src/middleware/turnstile.js` verifies tokens server-side (`siteverify`, timeout 2 s, fails closed in production, bypassed only with the test secret). Client helper pre-warms tokens. CSP allows `challenges.cloudflare.com` for script and frame. Required on: shorten, paste create, drop init, report. |
| P5.2 | | **CLI ergonomics**: requests with `User-Agent: curl/*`, `Wget/*`, or `Accept: text/plain` get plain-text responses (just the URL plus newline). CLI traffic skips Turnstile but gets a stricter limit (5/min per /56) and only for shorten and paste. Drop is browser-only in v1. |
| P5.3 | LEGAL-002, PERF-004 | **Threat feeds**: `src/services/threatFeeds.js` syncs the feeds that pass the Gate every 30 min into `threat_indicators` inside one transaction (hosts only). Lookup walks parent domains (`a.b.evil.com` → `b.evil.com` → `evil.com`). Feed failure never blocks the app (log and keep old data). |
| P5.4 | LEGAL-002, PERF-004, H6 | **Creation-time scanning only.** Order at `POST /api/shorten`: validation → local indicators (< 1 ms) → Safe Browsing Lookup on **host + path with the query string and fragment stripped**, 800 ms timeout, 6 h verdict cache by host → on timeout allow but mark `unscanned`. An hourly job rescans links younger than 7 days against the local table (zero external calls) to catch delayed weaponization. Drop: after `/complete`, check SHA-256 against MalwareBazaar (if accessible), quarantine and ban on match. **Delete** URLScan, VirusTotal, PhishTank, AbuseIPDB code, tests, env vars and docs. The redirect path makes zero external calls. Acceptance: `GET /:code` bench unchanged; `curl -d '{"url":"http://malware.testing.google.test/testing/malware/"}'` → 422 within ~150 ms when a key is configured (with the exact attribution wording Google requires). |
| P5.5 | | **Redirect mode (D2)**: `REDIRECT_MODE=interstitial` shows the full destination, a Continue button, and Report; browsers only (curl and bots get a plain 302 only when the link passed scanning). `direct` gives an instant 302. Link validation at creation: allow `http`/`https` only; reject userinfo (`user:pass@`), IP-literal and `localhost` hosts, URLs > 2,048 chars, links to pokedb.site itself or known shorteners (bit.ly, tinyurl.com, t.co, is.gd, cutt.ly, ...), and reserved aliases. |
| P5.6 | | **Reports and quarantine**: `POST /api/report` (Turnstile). Three reports from three distinct /24 (IPv4) or /56 (IPv6) subnets set `status='quarantined'` (HTTP 451 page; reversible). Send a Discord webhook (`ABUSE_WEBHOOK_URL`). Admin takedown: `DELETE /api/admin/:kind/:id` (Bearer) and `scripts/takedown.js`: deletes content and R2 object, writes `takedown_audit` (content hash, kind, creator subnet, timestamps), adds the domain or hash to `threat_indicators`. Audit rows purged after 90 days; abuse logs after 14 days; both disclosed in the privacy page. |
| P5.7 | SEC-005, SEC-006 | **Headers**: nonce-based CSP on all HTML (no `'unsafe-inline'` for styles or scripts; move inline `<style>`/`<script>` to hashed files or nonce them). Matrix: tool pages `default-src 'self'`; drop adds `connect-src 'self' https://*.r2.cloudflarestorage.com`; Turnstile hosts where used; **offline tools `connect-src 'none'`**; `/raw/:id` → `text/plain; charset=utf-8`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`. Plus `Referrer-Policy: no-referrer` on UGC routes, `Permissions-Policy` minimal, `Cross-Origin-Opener-Policy: same-origin`. Paste and drop pages render user text with `textContent` only. Add a header regression test per route class. |
| P5.8 | LEGAL-001 | **Legal pages** `/terms`, `/privacy`, `/abuse` linked in every footer, plus `/.well-known/security.txt`. Adapt the open-source Basecamp policies (CC BY 4.0, keep attribution). Facts to state accurately: what is collected (rate-limit identity as hashed or truncated IP, click counts, drop metadata), retention (D4, abuse logs 14 d, takedown audit 90 d), subprocessors (Cloudflare, R2, Google Safe Browsing, Sentry if enabled), the required "Advisory provided by Google" attribution, contact addresses (O5). Prohibit unlawful content under UAE law and the law of the user's jurisdiction. **Do not quote statutes or penalty amounts** and do not claim legal compliance. Every page carries `TODO(owner-review)` until the owner approves it; this is not legal advice. |
| P5.9 | | Optional and only if abuse appears (C6): SHA-256 proof-of-work header for CLI creates. |
| P5.10 | SEO-002 | `GET /sitemap.xml` generated from the registry (landing, projects, tool landing pages only, never UGC); per-host dynamic `robots.txt` per the P1.2 table; `rel=canonical`; OpenGraph/Twitter tags with static OG images; JSON-LD `Person` + `ProfilePage` on the landing page, `WebApplication` (`offers.price: "0"`, `applicationCategory: DeveloperApplication`) on tool pages, `BreadcrumbList`; real 404 and 410 pages (expired items return 410, not a soft 404). Titles target real intent, e.g. "Free SVG QR code generator — no signup", "Privacy-friendly URL shortener with curl API", "Encrypted pastebin with curl support", "Minecraft server.properties and JVM flags generator". |
| P5.11 | | Enforce D4 limits server-side (paste 256 KiB; TTLs; link max 365 d). Update affected tests with an explanatory commit. Permanent links only with the owner token. |

**DoD:** the redirect path makes no network calls; header tests pass; legal pages exist with owner-review markers; sitemap and robots match the policy table.

---

## Phase 6 — Frontend speed, responsive design, accessibility, PWA (part of R5)

| Task | Findings | Work | Acceptance |
|---|---|---|---|
| P6.1 | FE-001, H3 | `src/utils/assetHasher.js`: at boot hash every `.css/.js/.woff2` (first 8 hex of SHA-256), serve `/assets/<name>.<hash>.<ext>` with `Cache-Control: public, max-age=31536000, immutable`, rewrite references in HTML templates. HTML: `no-cache` for dynamic pages; static landing pages may use `public, max-age=0, s-maxage=300, stale-while-revalidate=86400`. API and UGC: `no-store`. No `max-age=300` anywhere. | `curl -sI /assets/…` shows immutable; changing a CSS file changes its URL. |
| P6.2 | FE-002 | Self-host the fonts the site already uses (IBM Plex Mono/Sans, SIL OFL; include the license file). Subset to Latin and to the weights actually used, WOFF2, `font-display: swap`, preload only the one or two critical files, fallback `size-adjust` metrics to avoid layout shift. Remove every `fonts.googleapis.com`/`gstatic` reference. | `grep -r googleapis public tools templates` → none. |
| P6.3 | FE-004, A11Y-001 | Theme system: static token map instead of probing computed styles; tiny nonce'd inline script sets `data-theme` before first paint (no flash); persist in `localStorage` plus a first-party `theme` cookie on `.pokedb.site` so the choice follows the user across tool subdomains. `scripts/audit-contrast.js` computes WCAG ratios for text/background, accent/background, and button-text/accent in **all 12 themes**; adjust tokens until normal text ≥ 4.5:1 and UI ≥ 3:1 while keeping each theme's identity. | Script prints 0 failures; axe clean on OLED. |
| P6.4 | RESP-001/002, CLS | Nav wraps or collapses ≤ 480 px; links and buttons `min-height: 44px`; safe-area insets; reserve space on the health page so CLS ≤ 0.02. Playwright test: 7 pages × widths 320/375/414/768/1024/1440/1920 asserting no horizontal overflow and tap-target sizes. | Test in CI. |
| P6.5 | A11Y-002/003, paste score 88 | Toast container `role="status" aria-live="polite"`; decorative terminal glyphs `aria-hidden` plus a visually-hidden summary of the intro; fix the paste page labels flagged by axe; visible `:focus-visible`; skip link; honor `prefers-reduced-motion`. Add axe (WCAG 2.2 AA tags) over landing, drop, paste in every theme to CI. | 0 serious/critical. |
| P6.6 | FE-003 | QR Studio generates in the browser with a minified vendored library (record source and license); `GET /api/qr` stays for curl and gets `Cache-Control: public, max-age=86400` so Cloudflare serves repeats. De-duplicate shared JS between tool pages. | Page weight budget met. |
| P6.7 | PWA-001 | `manifest.webmanifest` (standalone, 192/512 maskable icons) and `sw.js` on the tools host: precache hashed shell assets; CacheFirst for `/assets` and `/fonts`; StaleWhileRevalidate for tool HTML; **NetworkOnly** for `/api`, `/d`, `/v`, `/b`, `/raw`, `/:code`, `/healthz`; cache name = asset build hash; `skipWaiting` + `clients.claim`; `sw.js` itself `no-cache`. Install button appears after a user's second tool use. A service worker only controls its own origin, so only the tools hub (and any host that serves offline tools) registers one. Document the limit. | Lighthouse PWA/installability check passes on the tools host; offline load of a client-side tool works. |
| P6.8 | H3, PERF-003 | Compression and HTTP/3 belong to Cloudflare (O9). The origin does **not** compress in production behind Cloudflare. Verify live after deploy: `curl -sI -H 'Accept-Encoding: br' https://pokedb.site \| grep -i content-encoding` → `br`. `scripts/check-budget.js` measures gzip size per page; Lighthouse CI asserts the §3 targets. | Budget script and LHCI in CI. |

---

## Phase 7 — Portfolio, tools, and growth (R6)

**Principle:** a recruiter must learn who you are, what you build, and see proof within 30 seconds on a phone. Developers must find a tool that beats the alternatives on speed, privacy, or curl ergonomics. Every claim on the site is backed by something real.

| Task | Findings | Work |
|---|---|---|
| P7.1 | CV-001/002 | `data/projects.json` is the single source of truth for cards: `{slug,title,status:"open"\|"private"\|"draft",summary,metric,stack[],links{github,demo,caseStudy}}`. Build-time validation: a published card needs at least one real link; `draft` cards are hidden; any `TODO(owner)` fails CI. Card layout: title + status badge, one-sentence problem and scale, one measured metric pill, stack tags, two links (Case study, Code or benchmark). |
| P7.2 | CV-003 | Landing hero: headline and one-line proof, action bar (Resume if `public/resume.pdf` exists and is served `inline`, GitHub, LinkedIn if supplied, `mailto:` on a Cloudflare-routed alias so it works without JS), live status strip from `/api/status`, tool shortcuts. Keep the terminal look but make the first screen scannable. |
| P7.3 | | `/projects/<slug>` pages (400–600 words): context and why it is private, SVG architecture diagram, 20–40 lines of sanitized key code, benchmark table with workload + hardware + tool, link to a micro-benchmark repo if one exists. For the five existing projects (Aegis, Beacon, KDS, Manifold, Prism) **create skeletons only; leave every fact `TODO(owner)`** and keep the card `draft` until the owner fills them (O10). Never invent numbers or architecture. |
| P7.4 | | Flagship case study "Rebuilding pokedb.site": write it fully, using only measured before/after figures from `BASELINE.md` and `BENCH.md`, in the form *metric change + workload + hardware + measurement tool*. This single page demonstrates debugging, profiling, and safely handling untrusted input, which are the skills systems internships screen for. |
| P7.5 | | **Client-side tool suite** under the tools hub, each a registry entry, offline-capable, `connect-src 'none'`, shareable via `#state=` (CompressionStream + base64url): JSON formatter (Web Worker), JWT decode/verify (WebCrypto), Base64/Hex/URL codec, hash studio (streams files), UUID v4/v7/ULID, cron explainer, text diff, Minecraft: `server.properties` generator, JVM flags generator (**check every flag against current PaperMC/Aikar documentation; do not invent flags**), MOTD and color-code preview, SRV record helper, and a **log sanitizer** that redacts IPs, emails, tokens, and home paths entirely in the browser. |
| P7.6 | TOOL-PASTE-001 | Paste v2: browser-side AES-256-GCM by default (key in `#k=`, same chunk format as P4.8, single chunk), language select with lazy-loaded self-hosted syntax highlighting, line numbers, burn-after-read, raw view, expiry options. Plain mode stays for curl. |
| P7.7 | | TinyURL v2: expiry choice, custom alias, QR download, `/preview/:code`, stats page, clean curl API (`curl -d url=… https://tinyurl.pokedb.site` returns just the short URL). |
| P7.8 | | Cross-tool UX: Ctrl/Cmd+K command palette generated from the registry; paste-anywhere on drop/paste/qr; keyboard shortcut help; copy buttons announcing via the live region; ShareX `.sxcu` and a 5-line shell function for paste. `openapi.yaml` plus a `/docs` page with copy-ready curl examples. |
| P7.9 | | `/changelog` and RSS from `docs/CHANGELOG.md`; public `/status` history from the health probe. |
| P7.10 | Optional | Minecraft server status checker **only if** done SSRF-safe: resolve DNS, reject loopback/private/link-local/metadata ranges for IPv4 and IPv6, connect to the **resolved IP** (pinned) not the hostname, 3 s timeout, read at most 64 KiB, no redirects, port 1024–65535, Turnstile, 10/h per subnet. Tests must include a DNS-rebinding case. If you cannot meet all of these, do not ship it. |

---

## Phase 8 — Observability and operations (part of R6)

| Task | Findings | Work |
|---|---|---|
| P8.1 | TOOL-HEALTH-001 | `GET /healthz` (no I/O, liveness). `GET /readyz` and `GET /api/status` read a **cached** result from one background probe every 60 s: SQLite `SELECT 1` plus a tiny write, R2 `HeadBucket` (about 43k Class B ops/month, negligible), event-loop p99 (`monitorEventLoopDelay`), RSS, free space on `/data` (`fs.statfs`), age of last sweeper run. 60-point ring buffer for history. Degraded → 503 with the failing subsystem named. Visitors can never trigger live dependency calls. |
| P8.2 | OPS-002 | Server-side Sentry only (no browser SDK): scrub IPs, URLs, query strings, tokens in `beforeSend`; never send 4xx; cap events per hour. |
| P8.3 | | Cloudflare Web Analytics on landing and hub only, never on client-side tool pages (C9). |
| P8.4 | OPS-003 | CI: tests, coverage gate, `npm audit --omit=dev`, hadolint, gitleaks (tree and history), placeholder and env-doc checks, Playwright, axe, Lighthouse CI, Docker build. Weekly dependency update PRs (Dependabot or Renovate) for npm and Docker. |
| P8.5 | | `docs/RUNBOOK.md`: deploy and rollback, restore drill, secret rotation, takedown procedure, R2 outage behavior, quota alarms, how to read `/__diag/ip`, Cloudflare settings list (O9). |
| P8.6 | | Backups: Litestream plus a monthly `.backup` export to the backups bucket; restore drill repeated after any storage change. |

---

## Phase 9 — Verification and handoff (R6)

| Task | Work |
|---|---|
| P9.1 | Re-run every Phase 0 benchmark. Fill a before/after table (same machine, same scripts). Anything worse than baseline is a bug. |
| P9.2 | Lighthouse mobile + desktop for every page, Playwright responsive run, axe across themes. Store raw results. |
| P9.3 | Security regression list with raw output: XFF spoof (429s), query tokens (400), paste with `<script>`, uploaded HTML and SVG downloads as attachment/octet-stream, remote-upload route 404, CSP present on each route class, no `unsafe-inline`, robots matrix, `npm audit --omit=dev`, gitleaks on history, no secrets in logs. |
| P9.4 | Drop speed report in `docs/BENCH.md`: sweep table, chosen defaults, owner's measured line speed, achieved MB/s, resume test, download test with and without ranges. |
| P9.5 | `docs/V2_REPORT.md`: every audit finding ID → status → commit → proof (use the matrix below), re-scored 14 domains with evidence, list of anything still UNVERIFIED, list of owner actions outstanding. |
| P9.6 | Repo polish: README with a short GIF of an upload, SVG architecture diagram, CI badge, benchmark summary, "adding a tool" link, license, repo description/topics, pinned repo. |
| P9.7 | Owner launch checklist: D1 confirmed, O1–O11 done, Turnstile active, WAF rule on, abuse alerts tested, backups restored, legal pages reviewed, zero `TODO(owner)`, uptime monitor live. |

---

## Traceability matrix (every audit finding → task)

| Finding | Task(s) | | Finding | Task(s) |
|---|---|---|---|---|
| PERF-001 | P1.5, P2.3 | | SEC-006 | P4.11, P5.7 |
| PERF-002 | P1.4 | | REL-002 / REL-003 | P2.1–P2.3, P2.9 |
| PERF-003 | P6.8 (edge Brotli, O9) | | TOOL-DROP-001 | P4.6a |
| PERF-004 | P1.5, P2.4, P5.4 | | TOOL-DROP-002 | Phase 4 |
| PERF-005 | P2.3 | | TOOL-TINY-001 | P2.6 |
| FE-001 | P6.1 | | TOOL-PASTE-001 | P7.6 |
| FE-002 | P6.2 | | TOOL-HEALTH-001 | P8.1 |
| FE-003 | P6.6 | | ARCH-001 / ARCH-002 | P3.1–P3.6 |
| FE-004 | P6.3 | | ARCH-003 / ARCH-004 | P1.7 |
| RESP-001 / RESP-002 | P6.4 | | OPS-001 | P2.9 |
| RESP-003 | P3.4 | | OPS-002 | P3.2, P8.2 |
| A11Y-001 | P6.3 | | OPS-003 | P8.4 |
| A11Y-002 / A11Y-003 | P6.5 | | SEO-001 | P1.2 |
| SEC-001 | P1.6 | | SEO-002 | P5.10 |
| SEC-002 | P4.3 (route removed) | | PWA-001 | P6.7 |
| SEC-003 | P1.3 | | LEGAL-001 | P5.8 |
| SEC-004 | P1.1 | | LEGAL-002 | P5.3, P5.4 |
| SEC-005 | P5.7 | | CV-001 / CV-002 / CV-003 | P1.8, P7.1–P7.4 |
| DX-001 | P3.4 | | DX-002 | P0.4 |
| Env drift, README mismatches | P1.7, P3.1 | | Hadolint DL3066 | P2.9 |
| Coverage 55% | P3.7 | | Lighthouse SEO 63 on three tools | P1.2, P5.10 |

If a finding in `02-findings.md` is missing from this matrix, add it to the nearest phase before you start and note it in `docs/PROGRESS.md`.

---

## Start here

1. Read the audit reports and this file completely.
2. Run the Phase 0 Gate commands and report the results.
3. Do Phase 0, then Phase 1. Stop at R1 and tell the owner what to deploy and what to run (O1).
4. Continue phase by phase. At each checkpoint, list the owner tasks that are now required.
