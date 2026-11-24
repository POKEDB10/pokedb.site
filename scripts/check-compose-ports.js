// scripts/check-compose-ports.js
// Validates that docker-compose.yml contains NO published host ports in production (Task R2.6f)
// and verifies that web service uses internal expose only.

const fs = require('node:fs');
const path = require('node:path');

const COMPOSE_FILE = path.resolve(__dirname, '../docker-compose.yml');

function run() {
  console.log('=======================================================');
  console.log('Docker Compose Port Publishing Security Audit (Task R2.6f)');
  console.log('=======================================================\n');

  if (!fs.existsSync(COMPOSE_FILE)) {
    console.error(`ERROR: ${COMPOSE_FILE} not found.`);
    process.exit(1);
  }

  const content = fs.readFileSync(COMPOSE_FILE, 'utf8');

  // 1. Check for any host port publishing under web service
  // Regex looks for ports: block or - "xxx:xxx" style publishing
  const hasPortsBlock = /^\s*ports\s*:/m.test(content);
  const hasPublishedPortPattern = /^\s*-\s*["']?(?:\d+\.\d+\.\d+\.\d+:)?\d+:\d+["']?/m.test(content);

  // 2. Check for expose: - "5050"
  const hasExposeBlock = /^\s*expose\s*:/m.test(content);
  const hasExposed5050 = /^\s*-\s*["']?5050["']?/m.test(content);

  console.log('Audit Results:');
  console.log(`- Expose block present:         ${hasExposeBlock ? 'YES' : 'NO'}`);
  console.log(`- Expose port 5050 configured:  ${hasExposed5050 ? 'YES' : 'NO'}`);
  console.log(`- Host ports block found:       ${hasPortsBlock ? 'YES (VIOLATION)' : 'NO (Compliant)'}`);
  console.log(`- Published port mappings:      ${hasPublishedPortPattern ? 'YES (VIOLATION)' : 'NO (Compliant)'}`);

  if (hasPortsBlock || hasPublishedPortPattern) {
    console.error('\nFAILED: docker-compose.yml must NOT publish host ports in production.');
    console.error('Use expose: - "5050" for internal network routing via Cloudflare Tunnel.');
    console.error('For local diagnostics, use docker-compose.override.yml with 127.0.0.1 bind.');
    process.exit(1);
  }

  if (!hasExposeBlock || !hasExposed5050) {
    console.error('\nFAILED: docker-compose.yml missing expose: - "5050" for internal container networking.');
    process.exit(1);
  }

  console.log('\nSUCCESS: docker-compose.yml complies with origin isolation (0 published host ports, expose 5050 configured).');
}

run();
