# pokedb.site — Developer Tools & Storage Platform (v2)

[![CI](https://github.com/POKEDB10/pokedb.site/actions/workflows/ci.yml/badge.svg)](https://github.com/POKEDB10/pokedb.site/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-24%20LTS-brightgreen)](https://nodejs.org/)
[![Storage](https://img.shields.io/badge/Storage-SQLite%20WAL%20%2B%20Litestream-blue)](https://litestream.io/)
[![Object Store](https://img.shields.io/badge/Objects-Cloudflare%20R2-orange)](https://cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A modular, high-performance developer tools hub, cloud storage gateway, and engineering portfolio built with Node.js, Express, native SQLite WAL mode, and Vanilla HTML5/CSS3. Zero CDN dependencies, self-hosted WOFF2 fonts, offline-first developer utilities, and direct browser-to-R2 presigned multipart uploads.

---

## Architecture Overview

```text
               +-------------------------------------------+
               |        Cloudflare Edge (WAF / Tunnel)     |
               +-------------------------------------------+
                                     |
               +-------------------------------------------+
               |        pokedb.site v2 Core Gateway        |
               |       (Express Factory / Registry)        |
               +-------------------------------------------+
                     /               |               \
       +------------------+  +---------------+  +------------------+
       |   UGC Services   |  | Offline Tools |  |  Storage Layer   |
       |  (Direct / API)  |  | (Zero Egress) |  |   (WAL + S3)     |
       +------------------+  +---------------+  +------------------+
       | • /tools/tinyurl |  | • JSON Studio |  | • SQLite WAL     |
       | • /tools/paste   |  | • JWT Studio  |  | • Click Buffer   |
       | • /tools/drop    |  | • Base64/Hex  |  | • Cloudflare R2  |
       | • /tools/qr      |  | • WebCrypto   |  | • Litestream     |
       | • /healthz       |  | • Diff / Cron |  | • Sweeper Daemon |
       +------------------+  +---------------+  +------------------+
```

---

## Core Tool Suite

### 1. TinyURL v2 (`/tools/tinyurl/`)
- Non-sequential hash generation and custom alias claiming (`/custom-alias`).
- High-throughput direct redirect path (`3,744+ req/s`) with in-memory non-blocking click buffer.
- Link preview and analytics inspector (`/preview/:code`, `/stats/:code`).
- Instant CLI shortening (`curl -d "url=https://example.com" https://tinyurl.pokedb.site`).

### 2. Drop v2 Cloudflare R2 Gateway (`/tools/drop/`)
- **Direct Browser-to-R2 Uploads**: Zero server disk staging; files upload directly via presigned multipart S3 URLs.
- **Burn-After-Download Semantics**: Single-use download claiming (`GET /d/:id`) burns database record with automatic HTTP 410 Gone on second fetch; presigned GET URL expires after 10 minutes and background sweeper purges uncollected storage.
- **Client-Side Encryption**: Optional browser AES-256-GCM chunked encryption before transmission.
- **Security Gates**: Strict extension blocklist (`.exe`, `.msi`, `.dll` blocked unless encrypted; `.jar`, `.zip`, `.tar.gz` permitted).

### 3. Pastebin v2 (`/tools/paste/`)
- **Zero-Knowledge Client Encryption**: In-browser WebCrypto AES-256-GCM encryption with decryption key strictly in URL hash fragment (`#k=`). Zero plaintext touches origin.
- Line numbering, raw view (`/raw/:code`), and burn-on-read support.
- Fully backward-compatible plain-text curl API (`curl -d "content" https://paste.pokedb.site`).

### 4. QR Studio (`/tools/qr/`)
- 100% in-browser vector SVG and PNG QR rendering (`tools/shared/qrcode.min.js`).
- Cached server fallback API (`GET /api/qr` with `Cache-Control: public, max-age=86400`).

### 5. Offline Zero-Egress Developer Utilities
9 offline-first developer utilities operating entirely in the visitor's browser with CSP `connect-src 'none'`:
- **JSON Formatter & Validator** (`/tools/json/`): Prettify, minify, sort keys, byte counter.
- **JWT Inspector & WebCrypto Verifier** (`/tools/jwt/`): Decode claims, expiration timeline, HMAC verifier.
- **Multi-Codec Studio** (`/tools/codec/`): Two-way converter for Base64, Base64URL, Hex, URL, and Binary.
- **Hash & Checksum Studio** (`/tools/hash/`): SHA-256, SHA-512, SHA-384, SHA-1 streaming file hashing.
- **UUID & ULID Generator** (`/tools/uuid/`): UUID v4, time-ordered UUID v7 (RFC 9562), Crockford ULID.
- **Cron Expression Explainer** (`/tools/cron/`): 5-part cron syntax parser, English breakdown, upcoming run schedule.
- **Visual Text Diff** (`/tools/diff/`): Line-by-line visual difference comparison in pure browser JS.
- **Minecraft Server Toolkit** (`/tools/minecraft/`): Official Aikar G1GC optimization flags and server.properties generator.
- **Privacy Sanitizer** (`/tools/sanitizer/`): Scrubber for IP addresses, emails, Bearer tokens, and filesystem paths.

---

## Benchmarks & Telemetry

Tested on Node.js v24 LTS (`NODE_ENV=production`):

| Target | Metric | Telemetry | Notes |
|---|---|---|---|
| **Health Liveness (`/healthz`)** | Throughput | **9,895+ req/s** | Zero-I/O fast path, 1.43 ms avg latency (100% 200 OK) |
| **Redirect Hot Path (`/:code?direct=1`)** | Throughput | **2,072 – 3,744 req/s** | SQLite WAL read + in-memory click buffer (100% 302 Found) |
| **Landing Hero (`/`)** | Throughput | **1,753 req/s** | Static compressed HTML, 29.7 MB/s transfer rate |
| **Memory Leak Soak** | Slope | **0.000 MB/min** | 20-minute continuous write/read load with zero heap growth |
| **WCAG 2.1 AA Contrast** | Conformance | **60 / 60 passed** | All 12 themes exceed 4.5:1 text and 3:1 UI contrast |
| **Page Weight Budgets** | Bundle Size | **10 / 10 passed** | Landing page 4.36 KiB gzipped (<= 35 KiB budget) |

---

## Developer Guide & Adding Tools

`pokedb.site` features an automated filesystem and host-aware tool registry. Adding a new tool is fully modular:
See the step-by-step developer guide: **[docs/ADDING_A_TOOL.md](docs/ADDING_A_TOOL.md)**.

Operations, deployment, and disaster recovery procedures are documented in: **[docs/RUNBOOK.md](docs/RUNBOOK.md)**.

---

## Configuration Reference

Documented environment variables:

| Variable | Required | Purpose / Value |
|---|---|---|
| `NODE_ENV` | Yes | `production`, `development`, or `test`. |
| `PORT` | No | Server listen port (defaults to `5050`). |
| `BASE_URL` | Yes | Canonical base URL, e.g. `https://pokedb.site` (or `http://localhost:5050` in dev). |
| `STORE` | No | Storage backend (`sqlite` default). |
| `SQLITE_DB_PATH` | No | SQLite database file path (defaults to `data/pokedb.sqlite`; `/app/data/pokedb.sqlite` in container). |
| `TRUST_PROXY` | Recommended | Reverse proxy trust configuration (`loopback,uniquelocal` or `1`). |
| `ORIGIN_VERIFY_SECRET` | Optional | Shared origin verification secret (`X-Origin-Verify` header); leave unset unless proxy injects it. |
| `ADMIN_TOKEN` | For admin APIs | Cryptographic secret for diagnostics (`/__diag/ip`), takedowns, and audit logs. |
| `LARGE_FILE_PASSWORD` | Optional | Owner-only passphrase for large storage transfers. |
| `ROOTZ_API_KEY` | Optional | Legacy storage API key (retained for backward migration). |
| `ROOTZ_FOLDER_ID` | Optional | Legacy storage folder ID. |
| `ROOTZ_FOLDER_NAME` | Optional | Legacy storage folder name (defaults to `pokedb.site`). |
| `ROOTZ_TIMEOUT_MS` | Optional | Legacy storage upload timeout (defaults to `1200000`). |
| `GOOGLE_SAFE_BROWSING_KEY` | Optional | Google Safe Browsing Lookup API v4 key for link verification. |
| `REQUIRE_REPLICATION` | Optional | Set to `1` in production to enforce active Litestream replication health. |
| `LITESTREAM_METRICS_URL` | Optional | Prometheus metrics endpoint for Litestream (default `http://127.0.0.1:9090/metrics`). |
| `LITESTREAM_LAST_SYNC_TIMESTAMP` | Testing only | Timestamp override for deterministic replication tests. |
| `REDIS_URL` | Optional | Redis connection URL for optional cache/store. |
| `REDIS_REJECT_UNAUTHORIZED` | Optional | TLS certificate verification for Redis (`true` by default). |
| `REDIS_CA_CERT` | Optional | Custom CA certificate for Redis TLS. |
| `R2_ACCOUNT_ID` | Conditional | Cloudflare Account ID for Litestream backups and Drop uploads. |
| `R2_ACCESS_KEY_ID` | Conditional | Cloudflare R2 Access Key ID. |
| `R2_SECRET_ACCESS_KEY` | Conditional | Cloudflare R2 Secret Access Key. |
| `R2_BUCKET_NAME` | Conditional | Cloudflare R2 bucket name for Drop storage (defaults to `pokedb-drops`). |
| `R2_ENDPOINT` | Optional | Custom S3 endpoint override for MinIO / local testing (leave unset for Cloudflare R2). |
| `R2_BUCKET_BACKUPS` | Conditional | Cloudflare R2 bucket name for Litestream snapshots (defaults to `pokedb-backups`). |
| `DROP_POLICY` | Optional | Drop upload access policy (`open_limited` default). |
| `DROP_DIRECT_FALLBACK` | Optional | Set `1` to allow ephemeral disk Drop fallback when R2 is unconfigured (default `0`). |
| `TURNSTILE_SITE_KEY` | Optional | Cloudflare Turnstile public site key. |
| `TURNSTILE_SECRET_KEY` | Optional | Cloudflare Turnstile secret verification key. |
| `TURNSTILE_MODE` | Optional | `strict` (fail-closed `503` if unconfigured) or `optional` (skip if key unset; default `strict`). |
| `ABUSE_CH_AUTH_KEY` | Optional | Threat intelligence feed authentication key. |
| `ABUSE_WEBHOOK_URL` | Optional | Discord/Slack incoming webhook URL for abuse reports. |
| `REDIRECT_MODE` | Optional | Short link redirect behavior (`direct` default). |
| `CLICK_BUFFER_MAX_SIZE` | Optional | Maximum in-memory click counts before forced SQLite sync (defaults to `50000`). |
| `ALLOW_TEST_IPC_SHUTDOWN` | Testing only | Allows test runner to signal process termination via IPC (forbidden in production). |
| `ENABLE_SOAK_GC` | Testing only | Exposes manual GC trigger for soak test diagnostics (forbidden in production). |
| `BENCH_BYPASS_LIMITER` | Testing only | Bypasses rate limiting during synthetic benchmarks (forbidden in production). |
| `SENTRY_DSN` | Optional | Sentry server-side error logging DSN. |
| `TUNNEL_TOKEN` | Production | Cloudflare Tunnel authentication token for `cloudflared` sidecar container. |

---

## License

Released under the [MIT License](LICENSE). Created and maintained by [POKEDB10](https://github.com/POKEDB10).
