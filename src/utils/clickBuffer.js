// src/utils/clickBuffer.js
// In-memory click buffer with size cap and backoff escalation on SQLITE_BUSY (Task P3.5, P2.4, R2.5c).

class ClickBufferManager {
  constructor(storage, options = {}) {
    this.storage = storage;
    this.maxEntries = options.maxEntries || 10000;
    this.baseDelayMs = options.baseDelayMs || 5000;
    this.baseFlushBackoffMs = 250;
    this.maxFlushBackoffMs = 5000;

    this.buffer = new Map();
    this.flushTimer = null;
    this.consecutiveFailures = 0;
    this.isClosed = false;

    this.scheduleFlush(this.baseDelayMs);
  }

  scheduleFlush(delayMs = this.baseDelayMs) {
    if (this.isClosed) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flush();
    }, delayMs);
    if (this.flushTimer && typeof this.flushTimer.unref === 'function') {
      this.flushTimer.unref();
    }
  }

  flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.size === 0) {
      this.consecutiveFailures = 0;
      this.scheduleFlush(this.baseDelayMs);
      return;
    }

    const entries = Array.from(this.buffer.entries());
    this.buffer.clear();

    try {
      this.storage.transaction(() => {
        for (const [code, delta] of entries) {
          this.storage.incrementClicks(code, delta);
        }
      });
      this.consecutiveFailures = 0;
      this.scheduleFlush(this.baseDelayMs);
    } catch (err) {
      this.consecutiveFailures++;
      console.error(`Error flushing click buffer (failure #${this.consecutiveFailures}):`, err.message || err);

      for (const [code, delta] of entries) {
        if (this.buffer.size < this.maxEntries || this.buffer.has(code)) {
          this.buffer.set(code, (this.buffer.get(code) || 0) + delta);
        }
      }

      const backoffMs = Math.min(
        this.baseFlushBackoffMs * Math.pow(2, this.consecutiveFailures - 1),
        this.maxFlushBackoffMs
      );
      this.scheduleFlush(backoffMs);
    }
  }

  recordClick(code) {
    if (!this.buffer.has(code) && this.buffer.size >= this.maxEntries) {
      this.flush();
      if (!this.buffer.has(code) && this.buffer.size >= this.maxEntries) {
        console.warn(`[CLICK_BUFFER] Max capacity (${this.maxEntries}) reached; dropping click for ${code}`);
        return false;
      }
    }
    this.buffer.set(code, (this.buffer.get(code) || 0) + 1);
    return true;
  }

  getBufferedCount(code) {
    return this.buffer.get(code) || 0;
  }

  getSize() {
    return this.buffer.size;
  }

  close() {
    this.isClosed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  stop() {
    this.close();
  }
}

module.exports = {
  ClickBufferManager
};
