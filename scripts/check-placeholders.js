#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Allowlist of files pending remediation in later phases.
// P1.8 resolved all href="#" in public/index.html; draft cards retain TODO(owner) until O10 in Phase 7.
const PENDING_ALLOWLIST = new Set([
  path.normalize('public/index.html'),
  path.normalize('public/projects/aegis.html'),
  path.normalize('public/projects/beacon.html'),
  path.normalize('public/projects/kds.html'),
  path.normalize('public/projects/manifold.html'),
  path.normalize('public/projects/prism.html'),
  path.normalize('tools/drop/public/view.html'),
  path.normalize('tools/paste/public/index.html'),
  path.normalize('tools/tinyurl/public/index.html')
]);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (/\.(html|js|css|json|md)$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function main() {
  const rootDirs = ['public', 'tools'];
  const allFiles = rootDirs.flatMap((d) => walk(path.join(process.cwd(), d)));

  let violations = 0;
  let allowedPending = 0;

  console.log(`Scanning ${allFiles.length} files in public/ and tools/ for href="#" and TODO(owner)...`);

  for (const file of allFiles) {
    const relPath = path.normalize(path.relative(process.cwd(), file));
    const content = fs.readFileSync(file, 'utf8');

    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      const lineNum = idx + 1;
      const hasDeadHash = /href=["']#["']/i.test(line);
      const hasTodoOwner = /TODO\(owner\)/i.test(line);

      if (hasDeadHash || hasTodoOwner) {
        const issue = hasDeadHash && hasTodoOwner
          ? 'href="#" AND TODO(owner)'
          : hasDeadHash
            ? 'href="#"'
            : 'TODO(owner)';

        // public/index.html must have 0 href="#" (P1.8 gate)
        if (relPath === path.normalize('public/index.html') && hasDeadHash) {
          violations++;
          console.error(`[VIOLATION] ${relPath}:${lineNum} contains forbidden dead link ${issue}: ${line.trim()}`);
        } else if (PENDING_ALLOWLIST.has(relPath)) {
          allowedPending++;
          console.warn(`[PENDING ALLOWED] ${relPath}:${lineNum} contains ${issue}: ${line.trim()}`);
        } else {
          violations++;
          console.error(`[VIOLATION] ${relPath}:${lineNum} contains forbidden ${issue}: ${line.trim()}`);
        }
      }
    });
  }

  console.log(`\nPlaceholder Scan Summary:`);
  console.log(`  Allowed pending occurrences: ${allowedPending}`);
  console.log(`  Unapproved violations:        ${violations}`);

  if (violations > 0) {
    console.error(`\nFAILED: Found ${violations} unapproved placeholder(s).`);
    process.exit(1);
  }

  console.log(`\nPASSED: Zero unapproved placeholders found.`);
}

main();
