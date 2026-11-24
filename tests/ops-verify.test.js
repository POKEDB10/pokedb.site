// tests/ops-verify.test.js
// Unit tests for verify-docker and verify-staging runners (Task R9.2 Part 1)
// Mocks underlying processes and verifies flags, exit codes, and security error handling.

const { isDockerRunning, runVerification } = require('../scripts/ops/verify-docker');
const { parseArgs, runStagingVerification } = require('../scripts/ops/verify-staging');

describe('Part 1: Docker & Staging Verification Harness Suites', () => {
  describe('scripts/ops/verify-docker.js', () => {
    test('isDockerRunning returns boolean without throwing', () => {
      const running = isDockerRunning();
      expect(typeof running).toBe('boolean');
    });

    test('runVerification in --mock mode exercises all 10 steps cleanly', async () => {
      const result = await runVerification(true);
      expect(result.passed).toBe(10);
      expect(result.total).toBe(10);
      expect(result.status).toBe('UNVERIFIED');
    });
  });

  describe('scripts/ops/verify-staging.js', () => {
    test('parseArgs parses --host and --mock correctly', () => {
      const args = parseArgs(['--host', 'https://staging.pokedb.site', '--mock']);
      expect(args.host).toBe('https://staging.pokedb.site');
      expect(args.mock).toBe(true);
    });

    test('parseArgs rejects CLI secret --admin-token with security error', () => {
      const originalExit = process.exit;
      const originalError = console.error;
      let exitCode = null;
      let errorMsg = '';

      process.exit = (code) => { exitCode = code; };
      console.error = (msg) => { errorMsg += msg; };

      try {
        parseArgs(['--host', 'https://staging.pokedb.site', '--admin-token', 'leak']);
        expect(exitCode).toBe(1);
        expect(errorMsg).toContain('strictly prohibited');
      } finally {
        process.exit = originalExit;
        console.error = originalError;
      }
    });

    test('runStagingVerification in --mock mode executes all 7 checks and reports UNVERIFIED register', async () => {
      const results = await runStagingVerification({ host: 'https://staging.pokedb.site', mock: true });
      expect(results.length).toBe(7);
      expect(results.filter((r) => r.status === 'PASS').length).toBe(3);
      expect(results.filter((r) => r.status === 'MANUAL').length).toBe(4);
    });
  });
});
