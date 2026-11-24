# Changelog

All notable changes to `pokedb.site` will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-11-09

### Added
- **Cloudflare R2 Direct Uploads (Drop v2)**: Presigned multipart S3 PUT architecture bypassing server disk and memory completely. Eliminated Multer entirely.
- **Client-Side Cryptography**: Zero-knowledge AES-256-GCM encryption in the browser for Pastebin and File Drop with keys residing exclusively in `#k=` URL fragment.
- **Modular Tool Registry**: Unified extensible architecture (`src/registry.js`) supporting subdomain isolation and local subpaths (`/tools/:id`).
- **Offline Client Utilities (Zero Network Egress)**:
  - JSON Formatter & Minifier with syntax validation.
  - JWT Inspector & WebCrypto HMAC signature verifier.
  - Multi-encoding Codec (Base64, Base64URL, Hex, URL, Binary).
  - Cryptographic Hash Studio with streaming file hashing.
  - UUID v4, time-ordered UUID v7 (RFC 9562), and Crockford ULID generator.
  - 5-part Cron Expression Explainer with next 5 runs projector.
  - Text Diff Studio with visual line-by-line comparison.
  - Minecraft Toolkit with verified PaperMC/Aikar JVM flags and MOTD preview.
  - Log & Secret Sanitizer for automatic client-side PII and token redaction.
- **Cross-Tool UX**: Command Palette (`Ctrl+K`), keyboard shortcuts (`?`), live aria announcements, and paste-anywhere clipboard support.
- **Abuse Resistance & Threat Scanning**: Sub-millisecond local URLhaus parent-domain walking, Google Safe Browsing Lookup v4, Turnstile challenge middleware, and automatic subnet report quarantine.
- **Self-Hosted Subsets**: IBM Plex Mono & Sans Latin WOFF2 subsets served locally, eliminating all external Google Fonts network calls and CSP attack surfaces.
- **WCAG 2.1 AA Contrast**: 60/60 checks passing across all 12 themes with automated budget and contrast audit test scripts.

### Changed
- **Persistence Engine**: Migrated from JSON flat-file storage to transactional SQLite in WAL mode with cached prepared statements and atomic batching.
- **Click Buffering**: Asynchronous in-memory click buffering (`ClickBufferManager`) decoupled redirects from database disk I/O, achieving over 10,000 req/s.
- **Security Headers**: Dynamic per-request nonces in Content-Security-Policy; strict sandbox on `/raw/:id`.

### Fixed
- Fixed timing-attack vulnerability on admin tokens via constant-time buffer comparison.
- Fixed CPU-bound scrypt starvation by converting to asynchronous promises with concurrency semaphore.
- Fixed proxy trust spoofing by validating `TRUST_PROXY` subnets and disabling naive `CF-Connecting-IP` trusts.

---

## [1.0.0] - 2026-10-15

### Added
- Initial deployment of personal portfolio, URL shortener, Pastebin, QR code generator, and file drop.
- Basic theme switcher supporting 12 dark/light color palettes.
