# Development, Testing & Benchmarking Guide

This document details development-only and benchmark-only environment variables and operational helpers.

> [!CAUTION]
> **Production Guard:**
> `ALLOW_TEST_IPC_SHUTDOWN`, `BENCH_BYPASS_LIMITER`, and `ENABLE_SOAK_GC` are strictly forbidden when `NODE_ENV=production`.
> In `src/config.js`, attempting to run with `NODE_ENV=production` while any of these flags are set to `1` will cause the application to terminate immediately with a fatal security violation.
> Never include these variables in production deployment manifests or container environment blocks.

## Development & Benchmark Environment Variables

| Variable | Valid Values | Default | Purpose | Production Guard |
|---|---|---|---|---|
| `ALLOW_TEST_IPC_SHUTDOWN` | `0`, `1` | `0` | When enabled in `test` or `development` mode, registers an IPC message handler allowing clean graceful server shutdown during automated test suites. | Throws fatal error if `NODE_ENV=production` and value is `1`. |
| `BENCH_BYPASS_LIMITER` | `0`, `1` | `0` | Bypasses rate limiting middleware on redirect and landing endpoints during dedicated benchmark runs (`NODE_ENV=bench` or `NODE_ENV=test`) to measure raw throughput without HTTP 429 noise. | Throws fatal error if `NODE_ENV=production` and value is `1`. Only active when `NODE_ENV=bench` or `NODE_ENV=test`. |
| `ENABLE_SOAK_GC` | `0`, `1` | `0` | Enables forced V8 garbage collection via IPC handler during 20-minute and 60-minute soak benchmarks to measure post-GC memory retention slopes and detect memory leaks. | Throws fatal error if `NODE_ENV=production` and value is `1`. |

## Local Development Setup

```bash
# Install dependencies
npm install

# Run test suite
npm test

# Run offline unit test suites
npx jest tests/r2-offline.test.js
npx jest tests/url-security-offline.test.js

# Run automated verification harness
npm run verify:final
```

## MinIO Local S3 Test Stand-in
To test R2 presigned uploads locally without network egress:
```bash
# Set R2_ENDPOINT override
export R2_ENDPOINT="http://127.0.0.1:9000"
export R2_ACCESS_KEY_ID="minioadmin"
export R2_SECRET_ACCESS_KEY="minioadmin"
export R2_BUCKET_NAME="pokedb-drops"
```
