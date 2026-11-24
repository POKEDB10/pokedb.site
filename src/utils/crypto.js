// src/utils/crypto.js
// Cryptographic utilities, concurrency semaphore, and ID generators (Task P3.5, PERF-002, SEC-001).

const crypto = require('node:crypto');
const util = require('node:util');
const { customAlphabet } = require('nanoid');

const scryptAsync = util.promisify(crypto.scrypt);

class Semaphore {
  constructor(max, maxQueue = 20) {
    this.max = max;
    this.maxQueue = maxQueue;
    this.current = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    if (this.queue.length >= this.maxQueue) {
      const err = new Error('Crypto service busy: worker queue saturated.');
      err.statusCode = 503;
      err.retryAfter = 2;
      throw err;
    }
    await new Promise((resolve) => this.queue.push(resolve));
  }

  release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next();
    } else {
      this.current--;
    }
  }

  async run(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// Reconciled Semaphore Configuration (Task R9.2 Item 10)
// Concurrency: 2 workers (reserves remaining libuv threads for I/O and crypto operations)
// Queue Backlog: 20 pending derivations (balanced between 10 fail-fast limit and 50 burst headroom)
const SCRYPT_MAX_CONCURRENCY = 2;
const SCRYPT_MAX_QUEUE = 20;

const scryptSemaphore = new Semaphore(SCRYPT_MAX_CONCURRENCY, SCRYPT_MAX_QUEUE);

async function deriveKey(password, salt, keylen = 64) {
  return scryptSemaphore.run(() => scryptAsync(password, salt, keylen));
}

const generateShortCode = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 6);

// 8-character and 9-character Crockford Base32-clean alphabet (omitting ambiguous 0, o, 1, i, l)
const dropIdAlphabet = '23456789abcdefghjkmnpqrstuvwxyz';
const generateDropId8 = customAlphabet(dropIdAlphabet, 8);
const generateDropId9 = customAlphabet(dropIdAlphabet, 9);

module.exports = {
  Semaphore,
  SCRYPT_MAX_CONCURRENCY,
  SCRYPT_MAX_QUEUE,
  scryptSemaphore,
  deriveKey,
  generateShortCode,
  dropIdAlphabet,
  generateDropId8,
  generateDropId9
};
