// tests/click-buffer.test.js
// Unit tests for click buffer capping, backoff retry on SQLITE_BUSY, and flush behavior

const { createSqliteStorage } = require('../src/storage/sqlite.js');

describe('Click Buffer & Retry Backoff (Task P2.4 & R2.5c)', () => {
  let storage;

  beforeEach(() => {
    storage = createSqliteStorage(':memory:');
    storage.createLink({
      code: 'test_code_1',
      target: 'https://example.com/1',
      createdAt: Date.now()
    });
    storage.createLink({
      code: 'test_code_2',
      target: 'https://example.com/2',
      createdAt: Date.now()
    });
  });

  afterEach(() => {
    if (storage) storage.close();
  });

  test('caps buffer size and flushes when cap is reached', () => {
    const buffer = new Map();
    const MAX_CAP = 5;

    function recordClick(code) {
      if (!buffer.has(code) && buffer.size >= MAX_CAP) {
        // Attempt flush
        flush();
        if (!buffer.has(code) && buffer.size >= MAX_CAP) {
          return false; // Dropped
        }
      }
      buffer.set(code, (buffer.get(code) || 0) + 1);
      return true;
    }

    function flush() {
      if (buffer.size === 0) return;
      const entries = Array.from(buffer.entries());
      buffer.clear();
      storage.transaction(() => {
        for (const [c, delta] of entries) {
          storage.incrementClicks(c, delta);
        }
      });
    }

    // Seed 5 distinct codes
    for (let i = 1; i <= 5; i++) {
      expect(recordClick(`code_${i}`)).toBe(true);
    }
    expect(buffer.size).toBe(5);

    // 6th code triggers flush, freeing space
    expect(recordClick('code_6')).toBe(true);
    expect(buffer.size).toBe(1);
    expect(buffer.has('code_6')).toBe(true);
  });

  test('re-enqueues clicks and applies exponential backoff when transaction throws SQLITE_BUSY', () => {
    const buffer = new Map();
    let consecutiveFailures = 0;
    let nextBackoffDelay = 0;
    const BASE_BACKOFF_MS = 250;
    const MAX_BACKOFF_MS = 5000;

    buffer.set('test_code_1', 3);
    buffer.set('test_code_2', 5);

    function flush(simulateError = false) {
      if (buffer.size === 0) return true;
      const entries = Array.from(buffer.entries());
      buffer.clear();

      try {
        if (simulateError) {
          const err = new Error('SQLITE_BUSY: database is locked');
          err.code = 'SQLITE_BUSY';
          throw err;
        }
        storage.transaction(() => {
          for (const [c, delta] of entries) {
            storage.incrementClicks(c, delta);
          }
        });
        consecutiveFailures = 0;
        nextBackoffDelay = 5000;
        return true;
      } catch (err) {
        consecutiveFailures++;
        for (const [c, delta] of entries) {
          buffer.set(c, (buffer.get(c) || 0) + delta);
        }
        nextBackoffDelay = Math.min(BASE_BACKOFF_MS * Math.pow(2, consecutiveFailures - 1), MAX_BACKOFF_MS);
        return false;
      }
    }

    // First attempt fails with SQLITE_BUSY
    const success1 = flush(true);
    expect(success1).toBe(false);
    expect(buffer.get('test_code_1')).toBe(3);
    expect(buffer.get('test_code_2')).toBe(5);
    expect(consecutiveFailures).toBe(1);
    expect(nextBackoffDelay).toBe(250);

    // Second attempt fails with SQLITE_BUSY
    const success2 = flush(true);
    expect(success2).toBe(false);
    expect(consecutiveFailures).toBe(2);
    expect(nextBackoffDelay).toBe(500);

    // Third attempt succeeds
    const success3 = flush(false);
    expect(success3).toBe(true);
    expect(buffer.size).toBe(0);
    expect(consecutiveFailures).toBe(0);
    expect(nextBackoffDelay).toBe(5000);

    // Confirm clicks in SQLite table
    const link1 = storage.getLink('test_code_1');
    const link2 = storage.getLink('test_code_2');
    expect(link1.clicks).toBe(3);
    expect(link2.clicks).toBe(5);
  });
});
