# pokedb.site v2 — Publishing & Launch Safety Checklist

This checklist must be executed before making the repository public or deploying to production.

---

## 1. Repository Privacy & Secret Hygiene
- [ ] **Private-Repo-First:** Maintain repository as **Private** on GitHub until all production secret rotations, Cloudflare Tunnel ingress rules, and WAF locks are verified.
- [ ] **Vulnerability Reports in History (Do NOT Rewrite History):**
  Early commits (`62456d7`...) contain `audit-reports/` detailing pre-overhaul vulnerability findings. Because git history on `v2/overhaul` is immutable and must NEVER be rewritten, the repository must remain private until public release.
- [ ] **Full History Gitleaks Scan:** Execute full-history secret detection across every commit and branch:
  ```bash
  # Linux / macOS / Docker:
  gitleaks detect --verbose --source .
  
  # Or via Docker:
  docker run -v ${PWD}:/path zricethezav/gitleaks:latest detect -v --source="/path"
  ```
  Ensure **0 leaks detected** across all commits.
- [ ] **Clean Public Export Branch (Do NOT Run on `v2/overhaul`):**
  When publishing to an open-source public repository, create a clean orphan export branch to ensure historical vulnerability reports are not published:
  ```bash
  # 1. Create clean orphan branch from release tag
  git checkout --orphan public-release
  # 2. Verify audit-reports/ and local scratch are removed
  rm -rf audit-reports docs/scratch
  # 3. Create initial clean public commit
  git add -A
  git commit -m "feat: release pokedb.site v2"
  # 4. Push to public repository main branch
  git push -u public-origin public-release:main
  ```

---

## 2. SEO & Project Showcase Privacy Safeguards
- [ ] **Draft Project Skeletons Unlinked:**
  Verify that the 5 secondary project skeletons (`aegis`, `beacon`, `kds`, `manifold`, `prism`) are strictly unlinked from `public/index.html` (displaying `<span class="card-link">Private · case study soon</span>` rather than clickable `<a>` links).
- [ ] **Noindex Meta Tags on Draft Pages:**
  Verify each draft page contains:
  ```html
  <meta name="robots" content="noindex, nofollow, noarchive">
  ```
  Check automated verification:
  ```powershell
  # PowerShell:
  Select-String -Path public/projects/*.html -Pattern 'noindex'
  ```
- [ ] **Sitemap Verification:**
  Verify `GET /sitemap.xml` includes ONLY published pages (`/`, `/tools`, `/projects/pokedb-site`) and never lists draft projects or private tool state URLs.

---

## 3. Flagship Case Study Number Verification (`/projects/pokedb-site`)
Every benchmark and performance figure cited in `public/projects/pokedb-site.html` is verified against raw telemetry logs:

| Metric Cited in Case Study | Verified Value | Raw Source File & Log Provenance | Verification Method |
|---|---|---|---|
| **P0 Baseline Health Throughput** | `5,350 req/s` | `scripts/bench/health.js` running at commit `338b363` | 26,750 requests in 5.03s, 100% 200 OK, latency p50: 3 ms |
| **v2 Final Health Throughput** | `9,895 req/s` | `scripts/bench/health.js` running on HEAD | Zero-I/O `/healthz` probe, latency p50: 1 ms, p99: 4 ms |
| **P0 Baseline Redirect Throughput** | `3.2 req/s` | `scripts/bench/redirect.js` running at commit `338b363` | 16 requests in 5.06s, 100% 302 Found, latency p50: 311 ms |
| **v2 Direct Redirect Throughput** | `2,663 req/s` | `scripts/bench/redirect.js --direct` on HEAD | 13,315 requests in 5.03s, 100% 302 Found, latency p50: 7 ms |
| **v2 Real Path Redirect Throughput** | `2,247 req/s` | `scripts/bench/redirect.js` real path on HEAD | 11,235 requests in 5.04s, 100% 302 Found, latency p50: 7.5 ms |
| **Server Monolith Line Count** | `52 lines` | `server.js` | `(Get-Content server.js \| Measure-Object -Line).Lines` |
| **Soak Test Memory Slope** | `< 0.5 MB/min` | `scripts/bench/soak.js` (20-minute run) | Statistical linear regression post-warmup and post-step |
| **WCAG 2.1 / 2.2 Contrast Checks** | `60/60 passing` | `scripts/audit-contrast.js` | 12 themes × 5 token pairs, 0 failures |
| **Asset Performance Budgets** | `10/10 satisfied` | `scripts/check-budget.js` | Gzip bundle size under thresholds |

---

## 4. Environment & Deployment Verification
- [ ] Run `node scripts/check-env-docs.js` — assert all 9 production environment variables are documented.
- [ ] Run `node scripts/check-compose-ports.js` — assert `docker-compose.yml` uses `expose: - "5050"` and not host port publishing `ports:`.
- [ ] Run `npm audit --omit=dev` — assert 0 production vulnerabilities.
- [ ] Execute `node scripts/ops/verify-proxy-trust.js` against staging tunnel before opening public traffic.
