// tests/runbook-exec.test.js
// Validates that docs/RUNBOOK.md is executable, that all referenced scripts and files exist,
// that reverse export functions correctly, and that all mandatory operational safety steps are documented.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { exportData } = require('../scripts/export-sqlite-to-legacy');

describe('Task R9.2 Part 2 Item 4: Runbook Executability & Reverse Export Verification', () => {
  const rootDir = path.resolve(__dirname, '..');
  const runbookPath = path.join(rootDir, 'docs', 'RUNBOOK.md');
  const runbookContent = fs.readFileSync(runbookPath, 'utf8');

  test('All script and configuration file paths referenced in RUNBOOK.md exist on disk', () => {
    // Extract file/script paths like scripts/*.js, scripts/ops/*.js, docker-compose*.yml, docs/*.md
    const scriptMatches = runbookContent.matchAll(/(?:node\s+)?(scripts\/[a-zA-Z0-9_\-\/]+\.js)/g);
    const docMatches = runbookContent.matchAll(/`((?:scripts|docs)\/[a-zA-Z0-9_\-\/]+\.[a-z]+)`/g);
    const composeMatches = runbookContent.matchAll(/`(docker-compose(?:\.[a-z]+)?\.yml)`/g);

    const referencedFiles = new Set();
    for (const m of scriptMatches) referencedFiles.add(m[1]);
    for (const m of docMatches) referencedFiles.add(m[1]);
    for (const m of composeMatches) referencedFiles.add(m[1]);

    expect(referencedFiles.size).toBeGreaterThan(5);

    const missingFiles = [];
    for (const relPath of referencedFiles) {
      const fullPath = path.join(rootDir, relPath);
      if (!fs.existsSync(fullPath)) {
        missingFiles.push(relPath);
      }
    }

    expect(missingFiles).toEqual([]);
  });

  test('Step 0 documents private repository, gitleaks full history check, and clean export branch', () => {
    expect(runbookContent).toContain('Publishing & Repository Privacy Safeguards');
    expect(runbookContent).toContain('PRIVATE');
    expect(runbookContent).toContain('gitleaks detect --source . --verbose');
    expect(runbookContent).toContain('git checkout --orphan public-release');
    expect(runbookContent).toContain('rm -rf audit-reports');
  });

  test('Section 0.2 documents required Node.js and Express LTS versions', () => {
    expect(runbookContent).toContain('Runtime Engine & Framework Prerequisites');
    expect(runbookContent).toContain('Node.js');
    expect(runbookContent).toContain('Express');
    expect(runbookContent).toContain('https://expressjs.com/en/advanced/version-support.html');
  });

  test('Section 4 documents Cloudflare Tunnel creation and single-network expose-only topology', () => {
    expect(runbookContent).toContain('Cloudflare Tunnel Setup & Expose-Only Topology');
    expect(runbookContent).toContain('cloudflared tunnel create');
    expect(runbookContent).toContain('cloudflared tunnel route dns');
    expect(runbookContent).toContain('TRUST_PROXY=loopback,uniquelocal');
  });

  test('Section 6 documents migration on an isolated copy without --allow-unmapped and 3-step cutover', () => {
    expect(runbookContent).toContain('/tmp/copy.sqlite');
    expect(runbookContent).toContain('node scripts/migrate-legacy.js --source redis --redis-url');
    // Ensure initial dry-run command does NOT contain --allow-unmapped
    expect(runbookContent).toMatch(/node scripts\/migrate-legacy\.js --source redis [^\n]*\/tmp\/copy\.sqlite(?!.*--allow-unmapped)/);
    // 3-step transition
    expect(runbookContent).toContain('Freeze v1');
    expect(runbookContent).toContain('Final Delta Migration');
    expect(runbookContent).toContain('Production Cutover');
  });

  test('Section 7 documents staging DR drill with pre-destruction snapshot and separate replica path', () => {
    expect(runbookContent).toContain('Disaster Recovery Restore Drill (Staging Only Litestream Drill)');
    expect(runbookContent).toContain('Pre-Destruction Snapshot Verification');
    expect(runbookContent).toContain('R2_BUCKET_BACKUPS=pokedb-backups-staging');
    expect(runbookContent).toContain('Cold-Start Restore from Replica');
    expect(runbookContent).toContain('Verify Row Parity');
  });

  test('Section 8 & 9 document manual backup routine and honest rollback data-loss reality', () => {
    expect(runbookContent).toContain('scripts/backup-sqlite.js');
    expect(runbookContent).toContain('Rollback Runbook & Data-Loss Reality');
    expect(runbookContent).toContain('Reverse Export (Salvaging Post-Cutover v2 Writes)');
    expect(runbookContent).toContain('scripts/export-sqlite-to-legacy.js');
  });

  test('scripts/export-sqlite-to-legacy.js exports links and pastes to legacy JSON format', () => {
    const tmpDir = path.join(rootDir, 'tests', 'fixtures', 'tmp-reverse-export');
    fs.mkdirSync(tmpDir, { recursive: true });
    const testDbPath = path.join(tmpDir, 'test-export.sqlite');
    const testOutPath = path.join(tmpDir, 'test-export.json');

    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testOutPath)) fs.unlinkSync(testOutPath);

    const db = new DatabaseSync(testDbPath);
    db.exec(`
      CREATE TABLE links(
        code TEXT PRIMARY KEY,
        target TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        clicks INTEGER NOT NULL DEFAULT 0,
        status TEXT,
        creator TEXT
      );
      CREATE TABLE pastes(
        id TEXT PRIMARY KEY,
        title TEXT,
        language TEXT,
        body BLOB NOT NULL,
        encrypted INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        creator TEXT
      );
    `);

    const now = Date.now();
    db.prepare('INSERT INTO links VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'rev1',
      'https://example.com/rev1',
      now - 5000,
      now + 60000,
      42,
      'active',
      null
    );
    db.prepare('INSERT INTO pastes VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'paste1',
      'Test Title',
      'javascript',
      Buffer.from('console.log("hello world");', 'utf8'),
      0,
      now - 3000,
      null,
      null
    );
    db.close();

    const res = exportData(['--db', testDbPath, '--out', testOutPath]);
    expect(res.linksCount).toBe(1);
    expect(res.pastesCount).toBe(1);

    expect(fs.existsSync(testOutPath)).toBe(true);
    const exported = JSON.parse(fs.readFileSync(testOutPath, 'utf8'));

    expect(exported['url:rev1']).toBeDefined();
    expect(exported['url:rev1'].longUrl).toBe('https://example.com/rev1');
    expect(exported['url:rev1'].clicks).toBe(42);
    expect(exported['url:rev1:clicks']).toBe(42);

    expect(exported['paste:paste1']).toBeDefined();
    expect(exported['paste:paste1'].title).toBe('Test Title');
    expect(exported['paste:paste1'].language).toBe('javascript');
    expect(exported['paste:paste1'].content).toBe('console.log("hello world");');

    // Cleanup
    fs.unlinkSync(testDbPath);
    fs.unlinkSync(testOutPath);
    fs.rmdirSync(tmpDir);
  });
});
