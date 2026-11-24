// scripts/check-env-docs.js
// Validates that all environment variables accessed in application code
// are documented across .env.example, docker-compose.yml, README.md, and docs/RUNBOOK.md.

const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function extractVarsFromCode() {
  const codeFiles = ['server.js'];
  const srcDir = path.join(ROOT_DIR, 'src');
  if (fs.existsSync(srcDir)) {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && entry.name.endsWith('.js')) {
          codeFiles.push(path.relative(ROOT_DIR, full));
        }
      }
    };
    walk(srcDir);
  }

  const vars = new Set();
  for (const rel of codeFiles) {
    const full = path.join(ROOT_DIR, rel);
    if (!fs.existsSync(full)) continue;
    const content = fs.readFileSync(full, 'utf8');
    const matches = content.matchAll(/process\.env\.([A-Z0-9_]+)/g);
    for (const match of matches) {
      vars.add(match[1]);
    }
    // Also extract env.VAR from src/config.js
    if (rel === path.join('src', 'config.js') || rel === 'src/config.js') {
      const configMatches = content.matchAll(/\benv\.([A-Z0-9_]+)/g);
      for (const match of configMatches) {
        vars.add(match[1]);
      }
    }
  }
  return [...vars].sort();
}

function extractVarsFromEnvExample() {
  const filePath = path.join(ROOT_DIR, '.env.example');
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const vars = new Set();
  const matches = content.matchAll(/^(?:#\s*)?([A-Z0-9_]+)=/gm);
  for (const match of matches) {
    vars.add(match[1]);
  }
  return [...vars].sort();
}

function extractVarsFromDockerCompose() {
  const filePath = path.join(ROOT_DIR, 'docker-compose.yml');
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const vars = new Set();
  // Matches "- VAR=" or "- VAR:?" or "- VAR:-" or "- VAR=${VAR..."
  const matches = content.matchAll(/^\s*-\s*([A-Z0-9_]+)(?:[:=]|\s*$)/gm);
  for (const match of matches) {
    vars.add(match[1]);
  }
  return [...vars].sort();
}

function extractVarsFromReadme() {
  const filePath = path.join(ROOT_DIR, 'README.md');
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const vars = new Set();
  // Matches table rows: | `VAR` | ...
  const matches = content.matchAll(/\|\s*`([A-Z0-9_]+)`\s*\|/g);
  for (const match of matches) {
    vars.add(match[1]);
  }
  return [...vars].sort();
}

function extractVarsFromRunbook() {
  const filePath = path.join(ROOT_DIR, 'docs', 'RUNBOOK.md');
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const vars = new Set();
  // Matches table rows: | `VAR` | ...
  const tableMatches = content.matchAll(/\|\s*`([A-Z0-9_]+)`\s*\|/g);
  for (const match of tableMatches) {
    vars.add(match[1]);
  }
  // Matches env block lines: VAR= or # VAR=
  const envBlockMatches = content.matchAll(/(?:^|\n)(?:#\s*)?([A-Z0-9_]+)=/g);
  for (const match of envBlockMatches) {
    vars.add(match[1]);
  }
  return [...vars].sort();
}

function extractVarsFromDevDoc() {
  const filePath = path.join(ROOT_DIR, 'docs', 'DEVELOPMENT.md');
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const vars = new Set();
  const matches = content.matchAll(/`([A-Z0-9_]+)`/g);
  for (const match of matches) {
    vars.add(match[1]);
  }
  return [...vars].sort();
}

const DEV_ONLY_VARS = new Set(['ALLOW_TEST_IPC_SHUTDOWN', 'BENCH_BYPASS_LIMITER', 'ENABLE_SOAK_GC']);

function run() {
  console.log('=======================================================');
  console.log('Environment Variables Documentation Synchronization Check');
  console.log('=======================================================\n');

  const codeVars = extractVarsFromCode();
  const envExampleVars = new Set(extractVarsFromEnvExample());
  const dockerComposeVars = new Set(extractVarsFromDockerCompose());
  const readmeVars = new Set(extractVarsFromReadme());
  const runbookVars = new Set(extractVarsFromRunbook());
  const devDocVars = new Set(extractVarsFromDevDoc());

  console.log(`Found ${codeVars.length} environment variables in application code:`);
  console.log(codeVars.join(', '));
  console.log('');

  let errors = 0;

  console.log('Verifying documentation consistency:\n');
  console.log(
    'Variable'.padEnd(30) +
    '.env.example'.padEnd(14) +
    'docker-compose'.padEnd(16) +
    'README.md'.padEnd(12) +
    'RUNBOOK.md'.padEnd(12) +
    'Status'
  );
  console.log('-'.repeat(95));

  for (const v of codeVars) {
    const isDevOnly = DEV_ONLY_VARS.has(v);
    const inEnv = envExampleVars.has(v);
    const inDocker = dockerComposeVars.has(v);
    const inReadme = readmeVars.has(v);
    const inRunbook = runbookVars.has(v);
    const inDevDoc = devDocVars.has(v);

    let isComplete = false;
    let status = 'MISSING';

    if (isDevOnly) {
      // Dev-only flags must be documented in docs/DEVELOPMENT.md & RUNBOOK.md table,
      // and MUST NOT be in production docker-compose.yml
      const cleanProdDocker = !inDocker;
      isComplete = inDevDoc && inRunbook && cleanProdDocker;
      if (!isComplete) errors++;
      status = isComplete ? 'OK (DEV-ONLY)' : 'DEV-GUARD-VIOLATION';
      console.log(
        v.padEnd(30) +
        (inEnv ? 'YES' : 'NO').padEnd(14) +
        (cleanProdDocker ? 'ABSENT(SAFE)' : 'PRESENT(RISK)').padEnd(16) +
        (inDevDoc ? 'YES(DEV)' : 'NO').padEnd(12) +
        (inRunbook ? 'YES' : 'NO').padEnd(12) +
        status
      );
    } else {
      isComplete = inEnv && inDocker && inReadme && inRunbook;
      if (!isComplete) errors++;
      status = isComplete ? 'OK' : 'MISSING';
      console.log(
        v.padEnd(30) +
        (inEnv ? 'YES' : 'NO').padEnd(14) +
        (inDocker ? 'YES' : 'NO').padEnd(16) +
        (inReadme ? 'YES' : 'NO').padEnd(12) +
        (inRunbook ? 'YES' : 'NO').padEnd(12) +
        status
      );
    }
  }

  console.log('-'.repeat(95));

  if (errors > 0) {
    console.error(`\nFAILED: Found ${errors} environment variable synchronization discrepancy/discrepancies.`);
    process.exit(1);
  }

  console.log('\nSUCCESS: All environment variables in application code are documented across .env.example, docker-compose.yml, README.md, and docs/RUNBOOK.md.');
}

if (require.main === module) {
  run();
}

module.exports = {
  extractVarsFromCode,
  extractVarsFromEnvExample,
  extractVarsFromDockerCompose,
  extractVarsFromReadme,
  extractVarsFromRunbook,
  run
};
