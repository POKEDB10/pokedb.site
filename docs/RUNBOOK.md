# pokedb.site — Operations & Disaster Recovery Runbook

**Audience:** System Owner and Operations Maintainers  
**Scope:** Production Deployment, SQLite WAL Backups via Litestream, Cloudflare R2, Proxy Trust Verification, Disaster Recovery Restore Drill, and Rollback Procedures.

---

## 0. Publishing & Repository Privacy Safeguards (Mandatory Step 0)

> [!CAUTION]
> **Vulnerability Reports in History (Private Repo First):**
> Early planning commits (`62456d7`...) contain `audit-reports/` detailing pre-overhaul security vulnerabilities.
> In accordance with strict engineering rules, history on `v2/overhaul` is immutable and must NEVER be rewritten.
> To prevent leaking vulnerability details to the public:
> 1. Keep the GitHub repository **strictly PRIVATE** during development, staging verification, and internal PR review.
> 2. Run Gitleaks across the full git history to assert zero credential or secret leaks:
>    ```bash
>    gitleaks detect --source . --verbose
>    ```
> 3. When ready for open-source public release, use the clean orphan export branch procedure below. **Do NOT run this command on `v2/overhaul`**.

### 0.1 Clean Public Export Branch Procedure (Run only for public release)
```bash
# 1. From a clean merged release commit, create an orphan branch
git checkout --orphan public-release

# 2. Ensure historical audit reports and scratch files are absent from the export tree
rm -rf audit-reports docs/scratch

# 3. Create clean initial release commit
git add -A
git commit -m "feat: release pokedb.site v2"

# 4. Push clean orphan branch as main to the public repository
git push -u public-origin public-release:main
```

### 0.2 Runtime Engine & Framework Prerequisites
- **Node.js Runtime:** Node.js `>= 24.0.0` (LTS; matches `package.json` engines requirement).
- **Express Framework:** Express `>= 4.22.3` / `5.x` (LTS; see official Express support lifecycle: https://expressjs.com/en/advanced/version-support.html).
- **Process & Container Engine:** Docker Engine `>= 24.0` with Docker Compose v2.x.

---

## 1. Storage Architecture & SLA Commitments

- **Primary Store:** Native SQLite with Write-Ahead Logging (`journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000ms`, `temp_store=MEMORY`). Process-crash durable; OS-crash/power-loss durability window governed by `synchronous=NORMAL`.
- **Backup Mechanism:** Continuous streaming replication to Cloudflare R2 via Litestream (`etc/litestream.yml`).
- **Sync Interval:** `sync-interval: 30s` (per plan rule C2 to prevent exhausting Cloudflare R2 Class A free operations).
- **Click Lag Durability Window:** In-memory click counts buffer flushes every 5s in a single SQLite transaction and on SIGTERM/shutdown.
- **Recovery Point Objective (RPO / Max Data-Loss Window):**
  - Links, Pastes, Drops, Reports: **<= 30 seconds** (worst case: host hardware crash before the 30s sync interval flushes the WAL segment to R2).
  - Click Counters: **<= 35 seconds** (<= 5s in-memory buffer lag + <= 30s Litestream sync window).
- **Recovery Time Objective (RTO / Cold-Start Restore Time):**
  - Production Litestream / R2: **[UNVERIFIED]** (target < 2.0 seconds for < 50 MB database; production RTO depends on network pull from Cloudflare R2 and snapshot size).
  - Local file-copy simulation: **~1.1 ms** (local disk only, not Litestream/R2; measured by `scripts/restore-drill.js`).

### 1.1 Litestream Version Pinning (0.3.x vs 0.5.x) & Restore Format Implications
- **Pinned Version:** `v0.3.13`
  - Linux amd64 SHA256: `eb75a3de5cab03875cdae9f5f539e6aedadd66607003d9b1e7a9077948818ba0` (**Self-computed** from official release tarball at `https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.tar.gz`).
  - Linux arm64 SHA256: `9585f5a508516bd66af2b2376bab4de256a5ef8e2b73ec760559e679628f2d59` (**Self-computed** from official release tarball at `https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-arm64.tar.gz`).
  - *Provenance Note:* Litestream v0.3.13 did not publish automated `checksums.txt` assets; hashes were verified and self-computed locally from binaries downloaded from the official release tag.
- **Release Notes Citation:** Litestream v0.3.13 contains critical fix PR #1214 (*"Fix panic on restore when max WAL index is less than min"*, contributed by @benbjohnson, [v0.3.13 release notes](https://github.com/benbjohnson/litestream/releases/tag/v0.3.13)).
- **Format Incompatibility vs Current Line (0.5.x):** The v0.5.x series represents a complete architectural rewrite with a new snapshot manifest format, altered S3 directory hierarchy, and modified CLI syntax. A replica written by v0.3.13 cannot be restored transparently by v0.5.x without migration tooling. Pinned v0.3.13 ensures deterministic cold restores (`litestream restore -if-replica-exists`).
- **Verification Status:** `[UNVERIFIED]` on live Cloudflare R2 until Owner Task O2 connects live credentials on staging.

### 1.2 Replication Health Monitoring & Stale Telemetry
- **Source of `lastSyncAge`:** Scraped from the Litestream Prometheus metrics endpoint (`http://127.0.0.1:9090/metrics`, configured via `addr: ":9090"` in `/etc/litestream.yml`). The application tracks `litestream_sync_count` and `litestream_replica_operation_total` to evaluate sync recency, completely removing reliance on filesystem `/tmp` mtime.
- **Status Code When Stale:** When `REQUIRE_REPLICATION=1` is enabled, if `lastSyncAge > 120s` (4x the 30s sync interval) or if `lastSyncAge` is `"unknown"` past the 60s boot grace window, `/health` automatically responds with **HTTP 503 Service Unavailable** (with `status: "degraded"` and `database: "replication_stale"`). When sync is fresh (`lastSyncAge <= 120s`), it returns **HTTP 200 OK** (`status: "healthy"`).
- **Verification Status:** `[UNVERIFIED]` on live Cloudflare R2 until staging DR drill.

> [!IMPORTANT]
> **Single Writer Per Replica Path (No Overlapping Deploys):**
> SQLite in WAL mode with Litestream requires strictly **ONE writer container per replica path** at any time.
> Under no circumstances should rolling deployments or overlapping containers run concurrently against the same replica path. Overlapping writers cause replica divergence and split-brain WAL generation. Deploys must use stop-before-start (`docker compose down` followed by `docker compose up -d`).

---

## 2. Consolidated Environment Variables Checklist

Every environment variable parsed by `src/config.js` and application services is enumerated below.

> [!CAUTION]
> **Do NOT copy development `.env` to production.** Local `.env` files contain test bypasses (`BENCH_BYPASS_LIMITER=1`, `ALLOW_TEST_IPC_SHUTDOWN=1`), localhost URLs, and unverified mock keys. Generate a fresh production `.env` from the checklist below.

| Variable Name | Required in Prod | Valid Values / Type | Default | Description / Security Enforcement |
|---|---|---|---|---|
| `NODE_ENV` | **YES** | `production`, `test`, `bench` | `development` | Operating environment. In `production`, all limiter/IPC bypasses are strictly forbidden. |
| `PORT` | Optional | Integer (e.g. `5050`) | `5050` | Port on which the HTTP server listens inside the container. |
| `BASE_URL` | **YES** | Absolute URL | `https://pokedb.site` | Canonical base URL for absolute link generation and canonical tags. |
| `TRUST_PROXY` | **YES** | `loopback,uniquelocal`, `1`, CIDR | `loopback,uniquelocal` | Express proxy trust specification. Peels back sidecar hop without trusting external spoofed XFF. |
| `ORIGIN_VERIFY_SECRET` | Conditional | String (or **UNSET**) | `""` | Shared secret with Cloudflare edge. **MUST BE UNSET** when using Cloudflare Tunnel unless edge transforms inject `X-Origin-Verify`. |
| `ADMIN_TOKEN` | **YES** | Hex String (min 32 bytes) | `""` | Secret for `/__diag/ip` diagnostic queries, internal health inspection, and administrative takedowns. |
| `STORE` | Optional | `sqlite`, `redis` | `sqlite` | Persistence backend. If set to `redis` without modules, fails fast at startup. |
| `SQLITE_DB_PATH` | Optional | File path | `data/pokedb.sqlite` | SQLite database file location on host volume. In container: `/app/data/pokedb.sqlite` (matches Litestream replica path). |
| `CLICK_BUFFER_MAX_SIZE` | Optional | Integer | `50000` | Maximum in-memory click delta entries before forced SQLite transaction flush. |
| `ENABLE_SOAK_GC` | Dev/Bench only | `0`, `1` | `0` | Enables forced GC IPC handler for soak benchmark runs. Documented in `docs/DEVELOPMENT.md`. In production, setting `1` **throws fatal security error**. |
| `ALLOW_TEST_IPC_SHUTDOWN` | Dev/Test only | `0`, `1` | `0` | Test helper for clean process teardown. Documented in `docs/DEVELOPMENT.md`. In production, setting `1` **throws fatal security error**. |
| `BENCH_BYPASS_LIMITER` | Dev/Bench only | `0`, `1` | `0` | Benchmark limiter bypass. Documented in `docs/DEVELOPMENT.md`. In production, setting `1` **throws fatal security error**. |
| `REQUIRE_REPLICATION` | **YES** | `0`, `1` | `0` | Set `1` in production to enforce Litestream R2 replication. Throws if R2 credentials missing. |
| `LITESTREAM_METRICS_URL` | Optional | HTTP URL | `http://127.0.0.1:9090/metrics` | Prometheus metrics scrape URL for replica health and sync age monitoring. |
| `LITESTREAM_LAST_SYNC_TIMESTAMP` | Testing only | Epoch seconds | `""` | Testing timestamp override for replication freshness tests. |
| `REDIS_URL` | Optional (Legacy) | Redis URL | `redis://127.0.0.1:6379` | Legacy Redis connection URL (deprecated in PokéDB v2 in favor of SQLite). |
| `REDIS_REJECT_UNAUTHORIZED` | Optional (Legacy) | Boolean | `true` | Reject unauthorized TLS certificates for Redis connections. |
| `REDIS_CA_CERT` | Optional (Legacy) | PEM string | `""` | Optional custom CA certificate for Redis TLS. |
| `R2_ACCOUNT_ID` | **YES** | Cloudflare Hex ID | `""` | Cloudflare Account ID for Litestream and Drop storage endpoints. |
| `R2_ACCESS_KEY_ID` | **YES** | String | `""` | R2 API token Access Key ID (scoped to backups and drops buckets). |
| `R2_SECRET_ACCESS_KEY` | **YES** | String | `""` | R2 API token Secret Access Key. |
| `R2_BUCKET_BACKUPS` | **YES** | Bucket name | `pokedb-backups` | Cloudflare R2 bucket for Litestream SQLite WAL replica snapshots. |
| `R2_BUCKET_NAME` | **YES** | Bucket name | `pokedb-drops` | Cloudflare R2 bucket for PokéDB Drop presigned direct-to-object uploads. |
| `R2_ENDPOINT` | Optional (Dev/Test) | S3 Endpoint URL | `""` | Custom S3/R2 endpoint override for MinIO / local testing. Leave unset in production. |
| `DROP_POLICY` | Optional | `open_limited`, `token_only` | `open_limited` | Quota enforcement policy for Drop storage. |
| `LARGE_FILE_PASSWORD` | **YES** | Secret Passphrase | `""` | Required password for Drop uploads exceeding 100 MB up to 1 GiB cap. |
| `ROOTZ_API_KEY` | Optional (Legacy) | String | `""` | Legacy Rootz storage API key (deprecated in PokéDB v2 in favor of Cloudflare R2). |
| `ROOTZ_FOLDER_ID` | Optional (Legacy) | String | `""` | Legacy Rootz folder ID. |
| `ROOTZ_FOLDER_NAME` | Optional (Legacy) | String | `pokedb.site` | Legacy Rootz folder name. |
| `ROOTZ_TIMEOUT_MS` | Optional (Legacy) | Integer | `1200000` | Legacy Rootz upload timeout in milliseconds (20 min). |
| `TURNSTILE_SITE_KEY` | **YES** | Cloudflare Sitekey | `""` | Public sitekey for Cloudflare Turnstile human verification widget. |
| `TURNSTILE_SECRET_KEY` | **YES** | Cloudflare Secret | `""` | Secret key for Turnstile server verification. If missing in production, **fails closed (HTTP 503)**. |
| `GOOGLE_SAFE_BROWSING_KEY`| **YES** | Google API Key | `""` | Google Safe Browsing v4 lookup key for URL shortener threat screening. |
| `ABUSE_CH_AUTH_KEY` | Optional | Auth Key | `""` | Abuse.ch MalwareBazaar API key for threat indicator updates. |
| `ABUSE_WEBHOOK_URL` | Optional | Webhook URL | `""` | Webhook (Discord / Slack) for instant abuse notification alerts. |
| `REDIRECT_MODE` | Optional | `direct`, `interstitial` | `direct` | Redirect behavior for safe URLs. Suspicious links always show interstitial. |
| `SENTRY_DSN` | Optional | Sentry DSN URL | `""` | Server-side Sentry error reporting DSN (all client IPs masked to `/24`, zero browser SDK). |
| `TUNNEL_TOKEN` | **YES** | Cloudflare Token | `""` | Authentication token for `cloudflared` sidecar connector. |

### 2.1 Production Environment Variables Template (`.env`)

The operator must populate a production `.env` file using the exact keys below:

```env
# ============================================================
# Production Environment Variables Template (.env)
# Generated strictly from scripts/check-env-docs.js specification
# ============================================================

# 1. Runtime & Server Settings
NODE_ENV=production
PORT=5050
BASE_URL=https://pokedb.site
STORE=sqlite
# Local path: data/pokedb.sqlite | Docker volume / Litestream path: /app/data/pokedb.sqlite
SQLITE_DB_PATH=/app/data/pokedb.sqlite

# 2. Reverse Proxy & Security Settings (SEC-001, H2, H3)
TRUST_PROXY=loopback,uniquelocal
# ORIGIN_VERIFY_SECRET: Unset by default; enable ONLY with a Cloudflare Transform Rule
# ORIGIN_VERIFY_SECRET=
ADMIN_TOKEN=replace_with_64_char_crypto_random_hex
LARGE_FILE_PASSWORD=replace_with_large_file_passphrase

# 3. Redis Configuration (Optional / Legacy Migration)
REDIS_URL=redis://127.0.0.1:6379
REDIS_REJECT_UNAUTHORIZED=true
REDIS_CA_CERT=

# 4. Storage & Cloudflare R2 Settings
ROOTZ_API_KEY=
ROOTZ_FOLDER_ID=
ROOTZ_FOLDER_NAME=pokedb.site
ROOTZ_TIMEOUT_MS=1200000
R2_BUCKET_NAME=pokedb-drops
DROP_POLICY=open_limited
# R2_ENDPOINT: Custom S3 endpoint override (leave unset for Cloudflare R2; used in testing/MinIO)
# R2_ENDPOINT=

# 5. Abuse Resistance & Threat Intelligence
GOOGLE_SAFE_BROWSING_KEY=replace_with_google_api_key
TURNSTILE_SECRET_KEY=replace_with_turnstile_secret_key
TURNSTILE_SITE_KEY=replace_with_turnstile_site_key
ABUSE_WEBHOOK_URL=
REDIRECT_MODE=direct
ABUSE_CH_AUTH_KEY=

# 6. Litestream SQLite Continuous Replication to Cloudflare R2 (Task P2.9, R2.5f)
REQUIRE_REPLICATION=1
R2_ACCOUNT_ID=replace_with_cloudflare_account_id
R2_ACCESS_KEY_ID=replace_with_r2_access_key_id
R2_SECRET_ACCESS_KEY=replace_with_r2_secret_access_key
R2_BUCKET_BACKUPS=pokedb-backups

# 7. Performance & Diagnostics Tuning (Task PERF-001, OPS-001)
CLICK_BUFFER_MAX_SIZE=50000
LITESTREAM_METRICS_URL=http://127.0.0.1:9090/metrics
LITESTREAM_LAST_SYNC_TIMESTAMP=
# Note: Dev-only flags (ALLOW_TEST_IPC_SHUTDOWN, BENCH_BYPASS_LIMITER, ENABLE_SOAK_GC)
# are documented in docs/DEVELOPMENT.md and strictly forbidden in production.

# 8. Observability & Orchestration
SENTRY_DSN=
TUNNEL_TOKEN=replace_with_cloudflare_tunnel_token
```

---

## 3. Pre-Flight Client IP Verification & Proxy Trust (Owner Task O1)

Before pointing public DNS to the origin or opening live traffic through Cloudflare Tunnel, the system owner **must** complete pre-flight client IP and proxy trust verification as the mandatory FIRST step.

### 3.1 The Core Requirement
$$\text{req.ip} \equiv \text{Real External Visitor IP}$$
**`req.ip` must NEVER resolve to the internal Cloudflare Tunnel sidecar hop** (e.g. `127.0.0.1`, `172.16.x.x`, or `172.18.x.x`).

### 3.2 TRUST_PROXY Candidates for `cloudflared` Sidecar
When running the `cloudflared` sidecar container in Docker Compose, connections originate from the internal Docker bridge network. The valid configurations are:
1. **`loopback,uniquelocal` (Recommended):** Tells Express to trust RFC 1918 / RFC 4193 private network subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) and loopback (`127.0.0.1`, `::1`). Express automatically peels back the private Docker bridge hop without trusting arbitrary external proxies.
2. **`1` (Alternative):** Explicitly trusts exactly 1 upstream proxy hop (`cloudflared` container -> `web` container).

### 3.3 Passing ADMIN_TOKEN via Environment Variables (Never CLI Arguments)
To prevent leaking sensitive admin tokens into process tables (`ps aux`) or shell histories, always pass `ADMIN_TOKEN` via environment variables.

#### PowerShell:
```powershell
$env:ADMIN_TOKEN = "your-admin-token-here"
node scripts/ops/verify-proxy-trust.js --target https://tinyurl.pokedb.site
Remove-Item env:ADMIN_TOKEN
```

#### Linux / POSIX:
```bash
ADMIN_TOKEN="your-admin-token-here" node scripts/ops/verify-proxy-trust.js --target https://tinyurl.pokedb.site
```

### 3.4 Verification Procedure & Gate Criteria
The verification script automatically performs two tests from an external host:
1. **Step 1: Diagnostic Endpoint Check (`GET /__diag/ip`):**
   - Validates that `req.ip` equals your external client's true public IP.
   - Rejects if `req.ip` is `127.0.0.1` or any `172.x.x.x` Docker bridge address.
2. **Step 2: Spoofed-XFF Rate Limiter Burst Test (Link Creation):**
   - Fires 35 rapid requests with rotating fake `X-Forwarded-For: 203.0.113.$i` headers **with NO token**.
   - **Gate Check:** Requests 1 through 30 return HTTP 200 or 201; **requests 31 through 35 MUST return HTTP 429 Too Many Requests**.
   - If request 31 returns 200/201, STOP. Express is trusting the client-supplied header and resetting the rate limit per request!

---

## 4. Cloudflare Tunnel Setup & Expose-Only Topology (Owner Task O4)

Cloudflare Tunnel provides secure, inbound-free connectivity between Cloudflare's global edge and the Docker origin container.

### 4.1 Topology Design: Expose-Only Single-Network Architecture
- **No Published Host Ports:** The `web` service in `docker-compose.yml` configures `expose: ["5050"]` only. No ports are published to the host (`ports:` is intentionally omitted). The origin server refuses all direct internet connections on port 80/443/5050.
- **Sidecar Routing:** The `cloudflared` container runs on the same internal Docker bridge network, connecting directly to `http://web:5050`.
- **Proxy Trust:** `TRUST_PROXY=loopback,uniquelocal` ensures Express peels back the internal `172.16.x.x` Docker bridge hop and resolves `req.ip` to the authentic visitor IP without trusting spoofed client headers.

### 4.2 Creating the Tunnel (Two Methods)

#### Method A: Cloudflare Zero Trust Dashboard (Recommended)
1. In Cloudflare Zero Trust Dashboard, navigate to **Networks** -> **Tunnels** -> **Create a tunnel**.
2. Select **Cloudflared**, name the tunnel `pokedb-production`, and copy the tunnel token.
3. Add the token to production `.env` as `TUNNEL_TOKEN=<token>`.

#### Method B: Cloudflare CLI (`cloudflared`)
```bash
# 1. Authenticate with Cloudflare
cloudflared tunnel login

# 2. Create the tunnel
cloudflared tunnel create pokedb-production

# 3. Associate DNS routes
cloudflared tunnel route dns pokedb-production pokedb.site
cloudflared tunnel route dns pokedb-production tinyurl.pokedb.site
cloudflared tunnel route dns pokedb-production paste.pokedb.site
cloudflared tunnel route dns pokedb-production drop.pokedb.site
cloudflared tunnel route dns pokedb-production qr.pokedb.site

# 4. Extract token for docker-compose:
cloudflared tunnel token pokedb-production
# Copy token into .env: TUNNEL_TOKEN=<token>
```

### 4.3 Ingress Hostname Configuration
Configure public hostnames in Cloudflare Zero Trust (or `config.yml`) to forward traffic to the internal Docker service:

| Public Hostname | Service Type | URL | Additional Settings |
|---|---|---|---|
| `pokedb.site` | HTTP | `web:5050` | HTTP Host Header: `pokedb.site` |
| `tinyurl.pokedb.site` | HTTP | `web:5050` | HTTP Host Header: `tinyurl.pokedb.site` |
| `paste.pokedb.site` | HTTP | `web:5050` | HTTP Host Header: `paste.pokedb.site` |
| `drop.pokedb.site` | HTTP | `web:5050` | HTTP Host Header: `drop.pokedb.site` |
| `qr.pokedb.site` | HTTP | `web:5050` | HTTP Host Header: `qr.pokedb.site` |

> [!WARNING]
> **ORIGIN_VERIFY_SECRET Caution:**
> Do NOT populate `ORIGIN_VERIFY_SECRET` in production `.env` unless you have created Cloudflare Edge Transform Rules to inject the `X-Origin-Verify` header on every incoming request. Populating this variable without edge header injection causes immediate HTTP 403 Forbidden for all incoming tunnel traffic.

---

## 5. Cloudflare R2 Buckets, Tokens, CORS, and Lifecycle (Owner Task O2)

### 5.1 Bucket Provisioning
Create two R2 buckets in the Cloudflare Dashboard:
1. `pokedb-backups`: Litestream continuous WAL replica destination (private bucket).
2. `pokedb-drops`: Direct-to-object Drop storage (private bucket).

### 5.1.1 Private Bucket Architecture & Omission of `R2_PUBLIC_BASE_URL`
The `pokedb-drops` bucket is configured as a **strictly private bucket** (public access disabled in Cloudflare Dashboard).
- All file downloads are served via short-lived (600s / 10-minute) presigned `GET` URLs generated on demand by `/api/drop/download/:fileId` via the S3 SDK (`presignGet({ key, expiresInSeconds = 600, filename })`).
- Files are NEVER exposed via public bucket URLs (`R2_PUBLIC_BASE_URL` is intentionally omitted). Public bucket exposure would bypass password verification (`LARGE_FILE_PASSWORD`), burn-after-download semantics, download count accounting, and retention expiration.

### 5.2 R2 API Token Provisioning
1. In Cloudflare Dashboard -> **R2** -> **Manage R2 API Tokens**, create a scoped token:
   - Permissions: **Object Read & Write**
   - Bucket scoping: Specific buckets (`pokedb-backups` and `pokedb-drops`)
   - TTL: Permanent or per organization key rotation policy
2. Record `Access Key ID` and `Secret Access Key` in `.env`.

### 5.3 Automated Policy Verification Script
The repository provides JSON definitions for R2 policies in `docs/r2/`:
- `docs/r2/cors.json`: Restricts CORS origins to `https://*.pokedb.site` and `https://pokedb.site`, allowing `GET`, `PUT`, `HEAD`, `POST`, `DELETE` methods and presigned upload headers (`Content-Type`, `Content-Length`, `ETag`, `x-amz-*`).
- `docs/r2/lifecycle.json`: Enforces aborting incomplete multipart uploads after 1 day (preventing orphaned byte accumulation and storage billing) and expiring drop objects after 7 days.

Verify policy compliance before deploying:
```bash
# PowerShell or Linux
node scripts/verify-r2-policies.js
```

### 5.4 Applying Policies via Wrangler CLI
#### PowerShell:
```powershell
npx wrangler r2 bucket cors set pokedb-drops --file docs/r2/cors.json
npx wrangler r2 bucket lifecycle set pokedb-drops --file docs/r2/lifecycle.json
```
#### Linux:
```bash
npx wrangler r2 bucket cors set pokedb-drops --file docs/r2/cors.json
npx wrangler r2 bucket lifecycle set pokedb-drops --file docs/r2/lifecycle.json
```

---

## 6. Legacy Data Migration Routine (Redis / Rootz -> SQLite WAL)

> [!IMPORTANT]
> **MIGRATE ON A COPY FIRST & REVIEW UNMAPPED KEYS:**
> Never execute migration directly against the active production database file without a dry run. Always perform an initial dry run WITHOUT `--allow-unmapped` against an isolated database copy. Review any unmapped keys, freeze v1 writes, run final delta migration, and cut over.

### 6.1 Prerequisites
The migration utility requires `ioredis` for Redis sources:
```bash
# On dev host or staging:
npm install --no-save ioredis
```

### 6.2 Step 1: Initial Dry-Run on Isolated Copy (WITHOUT `--allow-unmapped`)
Always run on a copy first with `--allow-unmapped` omitted to detect unknown data prefixes:

#### PowerShell:
```powershell
# Create temporary copy
Copy-Item ./data/pokedb.sqlite /tmp/copy.sqlite -ErrorAction SilentlyContinue

# Dry-run migration (default is dry-run, no writes executed)
node scripts/migrate-legacy.js --source redis --redis-url "redis://your-redis-host:6379" --db /tmp/copy.sqlite
```

#### Linux:
```bash
# Create temporary copy
cp ./data/pokedb.sqlite /tmp/copy.sqlite

# Dry-run migration (default is dry-run, no writes executed)
node scripts/migrate-legacy.js --source redis --redis-url "redis://your-redis-host:6379" --db /tmp/copy.sqlite
```

### 6.3 Step 2: Unmapped-Key Report Review & Prefix Validation
When the source database contains keys that do not start with recognized prefixes (`link:`, `paste:`, `drop:`), `migrate-legacy.js` generates an unmapped-key report and aborts with a non-zero exit code:
```text
Unmapped key(s) found in source store: 4 unknown key(s) (samples: session:xyz, rate:192.168.1.1, cache:temp)
Aborting migration. Pass --allow-unmapped to proceed anyway.
```
**Operator Review Action:**
1. Examine the reported sample unmapped keys.
2. Confirm whether the unmapped keys represent discarded legacy session/rate-limit keys, or whether they contain valid data that requires custom migration mapping.
3. Only after confirming that all unmapped keys are safe to drop may the operator append `--allow-unmapped`.

### 6.4 Step 3: Freeze v1 -> Final Delta Migration -> Production Cutover
To achieve a clean transition without split-brain writes:
1. **Freeze v1 Traffic:** Set v1 to maintenance mode or pause inbound writes at the reverse proxy so no new writes enter Redis.
2. **Execute Final Delta Migration:**
   ```bash
   # PowerShell / Linux:
   node scripts/migrate-legacy.js --execute --source redis --redis-url "redis://your-redis-host:6379" --db ./data/pokedb.sqlite --allow-unmapped
   ```
3. **Verify Parity Checksums:**
   Confirm the output reports `100% MATCH` for links, pastes, and drops parity, and that `errorCount === 0`.
4. **Cutover:** Point the Cloudflare Tunnel ingress route to `web:5050` and verify `/healthz`.

### 6.5 Rootz Drop Orphan Note
Legacy v1 PokéDB stored file drops using the third-party Rootz API. When migrating legacy drops:
- SQLite metadata records are preserved (`object_key`, `upload_id`, `state`, `created_at`, `expires_at`).
- If Rootz credentials lapse or third-party files are deleted upstream, legacy drop download links will return HTTP 404 or 503.
- All new v2 drops are stored directly in Cloudflare R2 with native presigned URLs, eliminating external third-party dependencies.

---

## 7. Disaster Recovery Restore Drill (Staging Only Litestream Drill)

> [!CAUTION]
> **STAGING ENVIRONMENT ONLY:**
> This drill simulates catastrophic volume obliteration by deleting container volumes.
> **NEVER execute this drill against the production stack or production R2 bucket.**
> Configure the staging stack with a completely separate replica bucket and subpath (e.g. `R2_BUCKET_BACKUPS=pokedb-backups-staging` with `path: staging-db` in `etc/litestream.yml`).

### Step 1: Pre-Destruction Snapshot Verification
Ensure Litestream has completed at least one active snapshot to R2 before simulating destruction:
```bash
docker compose exec web litestream snapshots -config /etc/litestream.yml /app/data/pokedb.sqlite
```
**Gate Check:** Confirm that at least one valid snapshot is listed. If none appear, STOP.

### Step 2: Write Verification Record
#### PowerShell:
```powershell
$Headers = @{ "Content-Type" = "application/json"; "Host" = "tinyurl.pokedb.site"; "User-Agent" = "curl/8.4.0" }
$Body = '{"url": "https://example.com/restore-drill-target", "customAlias": "drill-verify-link"}'
Invoke-RestMethod -Uri "http://localhost:5050/api/shorten" -Method Post -Headers $Headers -Body $Body
```
#### Linux:
```bash
curl -s -X POST http://localhost:5050/api/shorten \
  -H "Host: tinyurl.pokedb.site" \
  -H "User-Agent: curl/8.4.0" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/restore-drill-target", "customAlias": "drill-verify-link"}'
```

### Step 3: Wait One Sync Interval
Wait 35 seconds for Litestream to flush WAL frames to Cloudflare R2:
```powershell
# PowerShell
Start-Sleep -Seconds 35

# Linux
sleep 35
```

### Step 4: Simulate Catastrophic Volume Obliteration (Staging Only)
```powershell
# PowerShell & Linux (Staging Stack Only)
docker compose down
docker volume rm pokedb-data
```

### Step 5: Cold-Start Restore from Replica
Restart the staging container stack. The entrypoint script detects missing SQLite database and invokes `litestream restore -if-replica-exists`:
```powershell
docker compose up -d
docker compose logs -f web
```
Look for startup log output:
```text
[entrypoint] Litestream credentials detected. Checking for replica restore...
[entrypoint] Local database missing at /app/data/pokedb.sqlite. Restoring from R2 replica...
[entrypoint] Starting Litestream continuous replication (sync-interval: 30s)...
Server running on 0.0.0.0:5050
```

### Step 6: Verify Row Parity
```powershell
# PowerShell
Invoke-RestMethod -Uri "http://localhost:5050/api/stats/drill-verify-link" -Headers @{ "Host" = "tinyurl.pokedb.site" }

# Linux
curl -s -H "Host: tinyurl.pokedb.site" http://localhost:5050/api/stats/drill-verify-link
```
Expected output: HTTP 200 with matching target URL and click stats.

---

## 8. Deploy & Rollback Procedures (Production Cutover & Rollback)

> [!IMPORTANT]
> **Deploy from Tag or Merged PR Commit (Never Feature Branch):**
> Production deployments must always be performed from an immutable Git release tag or a merged commit on the release branch, never from an unverified working tree.

### 8.1 Manual Backup Routine (On-Demand Point-in-Time Snapshot via backup-sqlite.js)
In addition to continuous Litestream replication, operators should execute an on-demand manual transactional backup (`VACUUM INTO`) before major maintenance or cutover:
#### PowerShell:
```powershell
node scripts/backup-sqlite.js --db ./data/pokedb.sqlite --out "./backups/pokedb-pre-cutover-$(Get-Date -Format 'yyyy-MM-dd-HHmm').sqlite"
```
#### Linux:
```bash
node scripts/backup-sqlite.js --db ./data/pokedb.sqlite --out "./backups/pokedb-pre-cutover-$(date +%Y-%m-%d-%H%M).sqlite"
```

### 8.2 Standard Stop-Before-Start Deployment
Because SQLite in WAL mode requires strictly ONE writer container per database replica path, never run overlapping containers.
#### PowerShell & Linux:
```bash
# 1. Fetch release tag or merged commit
git fetch --tags origin
git checkout v2.0.0

# 2. Record cutover timestamp for delta tracking
date +%s%3N > ./data/cutover-timestamp.txt

# 3. Stop running container gracefully (allows 10s drain & WAL sync)
docker compose down

# 4. Start updated container stack
docker compose up -d

# 5. Monitor startup and replication logs
docker compose logs -f web
```

### 8.3 Post-Deploy Smoke Checklist
- [ ] `curl -s http://127.0.0.1:5050/healthz` returns `{"status":"ok"}`
- [ ] `curl -s http://127.0.0.1:5050/readyz` returns `{"status":"ready"}`
- [ ] Proxy trust verified via `verify-proxy-trust.js`
- [ ] Short link creation and redirect resolves correctly
- [ ] Paste creation and view works
- [ ] Drop upload and download presigned URL generation functions

---

## 9. Rollback Runbook & Data-Loss Reality

> [!WARNING]
> **Data-Loss Reality for Post-Cutover v2 Writes (No "Zero Data Loss"):**
> Once production traffic routes to v2, any records created in v2 (new short links, pastes, drops) are stored in SQLite WAL and Cloudflare R2.
> If a rollback to legacy v1 is initiated, **any writes accepted by v2 will NOT exist in the legacy v1 store**.
> Rolling back to v1 restores operational availability, but post-cutover v2 writes will be lost unless salvaged via the reverse export procedure below.

### 9.1 Fast Ingress Rollback: Keep v1 Origin Active
During cutover, maintain the legacy v1 service running in standby mode. If an issue occurs:
1. In Cloudflare Zero Trust Dashboard, immediately edit the Tunnel Public Hostname routes to point back to the v1 internal IP/port.
2. Traffic reverts to v1 within seconds at the edge.

### 9.2 Optional Reverse Export (Salvaging Post-Cutover v2 Writes)
Before destroying or restoring the v2 database, extract writes that occurred after the recorded cutover timestamp:

#### PowerShell:
```powershell
$CutoverTs = Get-Content ./data/cutover-timestamp.txt -ErrorAction SilentlyContinue
if (-not $CutoverTs) { $CutoverTs = 0 }

# Reverse export links and pastes to legacy store JSON format (preserves v2 writes for legacy v1 backfill)
node scripts/export-sqlite-to-legacy.js --db ./data/pokedb.sqlite --out ./data/store.reverse-export.json --since $CutoverTs

# Alternative: Raw sqlite3 export of newly created links
sqlite3 ./data/pokedb.sqlite "SELECT json_object('code', code, 'target_url', target_url, 'created_at', created_at) FROM links WHERE created_at > $CutoverTs;" | Out-File -FilePath ./data/v2-salvaged-links.jsonl -Encoding utf8
```

#### Linux:
```bash
CUTOVER_TS=$(cat ./data/cutover-timestamp.txt 2>/dev/null || echo 0)

# Reverse export links and pastes to legacy store JSON format (preserves v2 writes for legacy v1 backfill)
node scripts/export-sqlite-to-legacy.js --db ./data/pokedb.sqlite --out ./data/store.reverse-export.json --since $CUTOVER_TS

# Alternative: Raw sqlite3 export of newly created links & pastes
sqlite3 ./data/pokedb.sqlite "SELECT json_object('code', code, 'target_url', target_url, 'created_at', created_at) FROM links WHERE created_at > $CUTOVER_TS;" > ./data/v2-salvaged-links.jsonl
sqlite3 ./data/pokedb.sqlite "SELECT json_object('id', id, 'language', language, 'created_at', created_at) FROM pastes WHERE created_at > $CUTOVER_TS;" > ./data/v2-salvaged-pastes.jsonl
```
Review `data/store.reverse-export.json` (or `v2-salvaged-links.jsonl`) to backfill active links into the restored legacy store.

### 9.3 Database Rollback to Pre-Cutover Snapshot
If reverting to pre-cutover state:
```bash
# 1. Stop v2 container
docker compose down

# 2. Restore pre-cutover SQLite snapshot
cp ./backups/pokedb-pre-cutover-*.sqlite ./data/pokedb.sqlite

# 3. Checkout previous known-good release tag
git checkout v1-legacy-tag

# 4. Start v1 stack
docker compose up -d
```

---

## 10. Production Missing Keys Behavior & Security Matrix

The system implements strict fail-closed security enforcement in production mode:

| Integration | Missing Key Behavior in Production | HTTP Status & Error | Rationale |
|---|---|---|---|
| **Cloudflare Turnstile** | **FAILS CLOSED** | `HTTP 503` `turnstile_not_configured` | Prevents automated abuse/bot flooding. Production must never silently mock verification. |
| **Cloudflare R2** | **FAILS CLOSED** | `HTTP 503` `storage_service_unavailable` | Preserves data integrity. Prevents writing to ephemeral memory or failing uploads mid-stream. |
| **Google Safe Browsing** | **FAILS OPEN** (with notice) | `HTTP 200` (link status: `unscanned`) | Prevents complete URL shortening outage when Google API is unreachable, but marks link for deferred background vetting. |
| **Sentry Error Reporting** | **SILENT NO-OP** | No error thrown | Prevents monitoring failure from impacting end-user request handling. |

---

## 11. Secret Rotation Runbook

### 11.1 Rotating ADMIN_TOKEN
1. Generate a new cryptographically secure 32-byte hex secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Update `ADMIN_TOKEN=<new_secret>` in production `.env`.
3. Restart container (`docker compose down && docker compose up -d`).
4. Validate access via `verify-proxy-trust.js`.

### 11.2 Rotating LARGE_FILE_PASSWORD
1. Generate new passphrase or hex string.
2. Update `LARGE_FILE_PASSWORD=<new_secret>` in `.env`.
3. Restart container.

### 11.3 Rotating Cloudflare R2 Credentials
1. In Cloudflare Dashboard -> **R2** -> **Manage R2 API Tokens**, create a new scoped token with Object Read & Write permissions on `pokedb-backups` and `pokedb-drops`.
2. Update `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` in `.env`.
3. Restart container.
4. Verify Litestream logs (`docker compose logs web | grep litestream`).
5. Revoke the old R2 API token in Cloudflare Dashboard.

---

## 12. Takedown & Abuse Audit Procedure (SEC-005, P5.7)

Pass `ADMIN_TOKEN` via environment variable (never CLI arguments) to invoke administrative content takedowns:

#### PowerShell:
```powershell
$env:ADMIN_TOKEN = "your-admin-token"
# Takedown a short link
node scripts/takedown.js --kind link --id phishing-code --reason "Phishing report #101"

# Takedown a paste
node scripts/takedown.js --kind paste --id badpaste123 --reason "PII violation"

# Takedown a drop
node scripts/takedown.js --kind drop --id dropabc12 --reason "Malware payload"
Remove-Item env:ADMIN_TOKEN
```

#### Linux:
```bash
# Takedown a short link
ADMIN_TOKEN="your-admin-token" node scripts/takedown.js --kind link --id phishing-code --reason "Phishing report #101"

# Takedown a paste
ADMIN_TOKEN="your-admin-token" node scripts/takedown.js --kind paste --id badpaste123 --reason "PII violation"

# Takedown a drop
ADMIN_TOKEN="your-admin-token" node scripts/takedown.js --kind drop --id dropabc12 --reason "Malware payload"
```

Review recent audit entries:
```bash
curl -s -H "Authorization: Bearer <ADMIN_TOKEN>" http://127.0.0.1:5050/api/admin/takedown-audit | jq .
```

---

## 13. Cloudflare R2 Outage Behavior & Resilience

When Cloudflare R2 experiences network partitions or regional outages:
- **Drop Uploads:** Fail fast with HTTP 503 `storage_service_unavailable` or `drop_unavailable` during multipart initiation. Bytes never touch host disk.
- **Drop Downloads:** Return HTTP 503 `drop_unavailable` when fetching presigned redirect URLs.
- **TinyURL, Paste & QR Studio:** **100% OPERATIONAL.** These core tools run entirely on local SQLite WAL storage and in-memory caches, completely insulated from R2 outages.
- **9 Client-Side Developer Utilities:** **100% OPERATIONAL.** The offline tool suite executes 100% in-browser with zero external network roundtrips.
- **Litestream WAL Replication:** Litestream automatically queues WAL frames in local memory and retries exponential backoff until R2 connectivity recovers.

---

## 14. Quota Alarms & Storage Capacity Tuning

The system enforces automated daily and subnet rate caps to prevent denial-of-wallet and storage exhaustion:
- **Drop Active Storage Soft Cap:** 10 GiB active file storage. When reached, returns HTTP 503 `drop_full`.
- **Daily Global Upload Budget:** 50 GiB / 24-hour rolling window.
- **Subnet Daily Upload Budget:** 5 GiB / 24-hour rolling window per `/24` IPv4 or `/48` IPv6 subnet.

### Monitoring Quotas
Check storage metrics in real-time via the background probe:
```bash
curl -s http://127.0.0.1:5050/api/status | jq .metrics
```

---

## 15. Cloudflare Dashboard Recommended Settings (Owner Task O9)

| Section | Setting | Value | Rationale |
|---|---|---|---|
| **SSL/TLS** | Encryption Mode | Full (strict) | Enforces end-to-end TLS verification between edge and origin sidecar. |
| **SSL/TLS -> Edge Certificates** | Always Use HTTPS | ON | Enforces 301 redirect to HTTPS for all HTTP traffic. |
| **Speed -> Optimization** | Brotli Compression | ON | Compresses text, HTML, and CSS payloads up to 25% better than gzip. |
| **Network** | HTTP/2 & HTTP/3 (with QUIC) | ON | Enables modern multiplexed transport for lower latency and packet loss resilience. |
| **Security** | Security Level | Medium | Balances threat mitigation and visitor friction. |
| **Security** | Bot Fight Mode | ON | Automatically mitigates known credential stuffers and malicious scrapers. |
| **Web Analytics** | Web Analytics Token | `CF_BEACON_TOKEN` | Enables privacy-preserving visitor telemetry on landing and hub only (C9). |

---

## 16. Monthly SQLite Snapshot Routine (Task P8.6)

In addition to continuous Litestream streaming, execute a monthly `VACUUM INTO` snapshot:
```bash
node scripts/backup-sqlite.js --db ./data/pokedb.sqlite --out ./backups/pokedb-monthly-$(date +%Y-%m-%d).sqlite
```
The script automatically validates the snapshot with `PRAGMA integrity_check;` and logs file size and elapsed time.
