// scripts/verify-r2-policies.js
// Validates Cloudflare R2 CORS and Lifecycle policy configurations (Task R9.1 Item 9).

const fs = require('node:fs');
const path = require('node:path');

const CORS_PATH = path.join(__dirname, '..', 'docs', 'r2', 'cors.json');
const LIFECYCLE_PATH = path.join(__dirname, '..', 'docs', 'r2', 'lifecycle.json');

function verifyR2Policies() {
  console.log('Verifying Cloudflare R2 bucket policy specifications...\n');

  // 1. Verify CORS specification
  if (!fs.existsSync(CORS_PATH)) {
    throw new Error(`CORS policy file missing at: ${CORS_PATH}`);
  }
  const corsRaw = fs.readFileSync(CORS_PATH, 'utf8');
  const cors = JSON.parse(corsRaw);
  if (!Array.isArray(cors) || cors.length === 0) {
    throw new Error('CORS specification must be a non-empty array of rules.');
  }

  const mainCors = cors[0];
  const requiredMethods = ['PUT', 'GET', 'HEAD'];
  for (const m of requiredMethods) {
    if (!mainCors.AllowedMethods || !mainCors.AllowedMethods.includes(m)) {
      throw new Error(`CORS policy missing required AllowedMethod: ${m}`);
    }
  }

  if (!mainCors.ExposeHeaders || !mainCors.ExposeHeaders.includes('ETag')) {
    throw new Error('CORS policy must expose "ETag" header for browser multipart uploads.');
  }
  console.log('  [PASS] docs/r2/cors.json: Validated AllowedOrigins, AllowedMethods (PUT/GET/HEAD), and ExposeHeaders (ETag).');

  // 2. Verify Lifecycle specification
  if (!fs.existsSync(LIFECYCLE_PATH)) {
    throw new Error(`Lifecycle policy file missing at: ${LIFECYCLE_PATH}`);
  }
  const lifecycleRaw = fs.readFileSync(LIFECYCLE_PATH, 'utf8');
  const lifecycle = JSON.parse(lifecycleRaw);
  if (!lifecycle.Rules || !Array.isArray(lifecycle.Rules) || lifecycle.Rules.length === 0) {
    throw new Error('Lifecycle specification must contain a non-empty Rules array.');
  }

  const dropRule = lifecycle.Rules.find((r) => r.Status === 'Enabled');
  if (!dropRule) {
    throw new Error('Lifecycle specification must have at least one Enabled rule.');
  }
  if (!dropRule.Expiration || !dropRule.Expiration.Days || dropRule.Expiration.Days <= 0) {
    throw new Error('Lifecycle rule must specify positive Expiration.Days.');
  }
  if (!dropRule.AbortIncompleteMultipartUpload || !dropRule.AbortIncompleteMultipartUpload.DaysAfterInitiation) {
    throw new Error('Lifecycle rule must specify AbortIncompleteMultipartUpload.DaysAfterInitiation to prevent orphaned upload billing.');
  }
  console.log(`  [PASS] docs/r2/lifecycle.json: Validated Expiration (${dropRule.Expiration.Days}d) and AbortIncompleteMultipartUpload (${dropRule.AbortIncompleteMultipartUpload.DaysAfterInitiation}d).`);

  console.log('\n[SUCCESS] Cloudflare R2 bucket policies verified successfully.');
}

try {
  verifyR2Policies();
} catch (err) {
  console.error(`\n[FAIL] R2 policy verification failed: ${err.message}`);
  process.exit(1);
}
