# Security Hardening & Concurrency Audit Report — pokedb.site

**Branch:** `security-hardening`  
**Date:** August 12, 2026  
**Status:** Completed & Fully Verified  

---

## 1. Concurrency Hardening & Stress Testing

### Changes Implemented
- **Atomic NX Reservation**: `redis.set(key, val, { nx: true })` used for both TinyURL alias reservation and Drop custom folder/file ID claiming. On collision, subsequent concurrent requests immediately return `409 Conflict`.
- **Async Queue Mutex for Folder Attachments**: `attachFileToFolder()` uses an per-folder Promise queue to serialize concurrent file attachment operations. All concurrent file uploads to a batch folder are appended without lost updates.
- **Dual Storage Persistence**: Stores records under both `drop:folder:ID` and `drop:ID` keys in `redis` (which writes through to both Redis and file-backed `inMemoryStore`).

### Verification & Stress Tests (`tests/concurrency.test.js`)
- **50 Concurrent Custom Alias Claims**: 1 request succeeded with `200 OK`, 49 failed with `409 Conflict`. Zero duplicate claims or store corruption.
- **50 Concurrent Random Shortcode Creations**: 50 unique codes created and persisted cleanly.
- **50 Concurrent Custom Folder ID Claims**: 1 request succeeded with `200 OK`, 49 failed with `409 Conflict`.
- **50 Concurrent File Uploads to 1 Folder**: All 50 files attached successfully to the target folder record with 0 lost items (`folderRecord.files.length === 50`).

---

## 2. Adversarial Security Pass & Regression Suite (`tests/security.test.js`)

### Attack Class 1: SSRF & Path Traversal
- **SSRF Evaluation**: `isValidRemoteUrl()` and `isPrivateHost()` validate IP version, private range CIDRs (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16), IPv6 loopback (`::1`), and IPv4-mapped IPv6 (`::ffff:127.0.0.1`). DNS pre-resolution blocks rebinding.
- **Path Traversal Patch**: `res.sendFile()` in `/v/:filename` and local streaming now explicitly verifies `path.resolve(rec.localPath)` is prefixed by `path.resolve(UPLOADS_DIR)`. Arbitrary file reads outside `UPLOADS_DIR` (e.g. `/v/../../etc/passwd`) return `404 Not Found`.

### Attack Class 2: IDOR & Enumeration
- **Drop File Deletion**: `/api/drop/delete` requires a cryptographically random 32-character `deletionToken` created at upload time. Checked using timing-safe comparison (`tokensMatch`).
- **Admin File Listing**: `/api/drop/list` requires `ADMIN_TOKEN`. Attempts with missing or incorrect tokens return `403 Forbidden` with timing-safe comparison.

### Attack Class 3: Rate-Limit Bypass & Header Spoofing
- **Subdomain API Isolation**: `checkApiHost()` validates `req.get('host')` and `Origin` against allowed subdomains. Attempts to route API requests with unauthorized host headers fail with `404 Not Found`.

### Attack Class 4: Upload-Path DoS
- **Payload Validation**: Direct file uploads without file payload return `400 Bad Request`.
- **Large File Password Protection**: Files over 1 GB (`ONE_GB = 1073741824`) require an owner password (`X-Upload-Password`). Unauthenticated requests fail with `401 Unauthorized`.

### Attack Class 5: XSS Defense
- **Input Escaping**: Custom aliases are restricted to `/^[a-zA-Z0-9_-]{3,64}$/`. HTML script injection in custom alias returns `400 Bad Request`.
- **QR Code Payload Handling**: SVG output sets `Content-Type: image/svg+xml` and handles raw text safely without executing script tags.

---

## 3. Test Suite Summary

- **Total Test Suites**: 3 passed (`tests/server.test.js`, `tests/concurrency.test.js`, `tests/security.test.js`)
- **Total Tests**: 38 passed, 0 failed
