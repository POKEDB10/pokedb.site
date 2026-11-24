# Dependency Ledger & Security Audit Report

## 1. Production Dependencies Summary

| Package | Version | Purpose |
|---|---|---|
| `@aws-sdk/client-s3` | `^3.1164.0` | S3 / Cloudflare R2 client SDK for direct multipart uploads |
| `@aws-sdk/s3-request-presigner` | `^3.1164.0` | Presigned URL generation for secure direct client-to-R2 PUT/GET |
| `cors` | `^2.8.5` | Cross-Origin Resource Sharing middleware |
| `express` | `^4.22.3` | Core HTTP application framework (Express 4.x maintained line) |
| `express-rate-limit` | `^8.7.2` | Route-level rate limiting with IPv6 /56 subnet aggregation |
| `helmet` | `^8.3.0` | Secure HTTP headers (CSP, HSTS, X-Content-Type-Options) |
| `nanoid` | `^3.3.7` | Cryptographic random ID generator |
| `pino` | `^10.4.0` | Low-overhead structured JSON logger with IP masking & token redaction |
| `qrcode` | `^1.5.4` | Server-side QR code generator |

### Dropped Dependencies
- `multer`: Eradicated. Drop v2 uploads stream directly from browser to R2 via presigned URLs. Legacy backwards-compatibility endpoints utilize a 35-line native stream buffer reader without touching disk.

### Overrides (Vulnerability Mitigation in Sub-dependencies)
- `proxy-addr@^2.0.8`: Resolves critical CVE GHSA-jqcg-44mw-7w3h (IP spoofing via IPv4-mapped IPv6 trust subnet).
- `body-parser@^1.20.9`: Resolves high CVE GHSA-27r3-jxmh-p828 (Denial of Service via trailing bytes).
- `qs@^6.16.1`: Resolves moderate advisory GHSA-x5fp-wj9c-mxmx.

---

## 2. Production Security Audit Status

`npm audit --omit=dev --audit-level=high` output:
```text
found 0 vulnerabilities
```
Production dependencies are 100% clean of all high, critical, and moderate vulnerabilities.

---

## 3. Remaining Development Advisories (Dev-Only, Non-Production)

The advisories exist solely within `devDependencies` (transitive dependencies of `jest`):

| Dependency | Advisory ID | Severity | Scope | Exploitability / Risk Analysis |
|---|---|---|---|---|
| `deepmerge` | GHSA-gcqx-w48m-w2h4 | Moderate | Dev (`jest-config`) | Prototype poisoning during Jest config merging. Non-exploitable in production (test runner only; config input is trusted local developer file). |
| `glob` | GHSA-3g3m-2fjr-6pw4 | Moderate | Dev (`jest-runtime`, `test-exclude`) | AbortSignal traversal bypass. Non-exploitable in production (test execution only on local repo files). |
| `minimatch` | GHSA-g3hv-75wg-m249 | Moderate | Dev (`test-exclude` via Jest) | ReDoS via globparts amplification. Non-exploitable in production (used only to resolve test file paths). |

Conclusion: Zero exposure to untrusted network traffic or production execution.
