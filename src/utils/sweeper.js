// src/utils/sweeper.js
// Background sweeper timer for expired links, pastes, and drops (Task P3.5, P2.5).

class Sweeper {
  constructor(storage, options = {}) {
    this.storage = storage;
    this.objectStore = options.objectStore || null;
    this.intervalMs = options.intervalMs || 60000;
    this.timer = null;
    this.totalSwept = 0;
    this.lastSweepTimestamp = null;
  }

  async sweepObjectStore(now = Date.now()) {
    if (!this.objectStore || !this.storage) return;
    try {
      if (this.storage.getExpiredDrops) {
        const expiredDrops = this.storage.getExpiredDrops(now, 100);
        if (expiredDrops && expiredDrops.length > 0) {
          const keys = expiredDrops.map((d) => d.object_key).filter(Boolean);
          if (keys.length > 0 && this.objectStore.deleteMany) {
            await this.objectStore.deleteMany({ keys });
          }
          for (const d of expiredDrops) {
            if (this.storage.updateDropState) {
              this.storage.updateDropState(d.id, 'expired');
            }
          }
        }
      }
      if (this.storage.getStaleInitiatedDrops) {
        const stale = this.storage.getStaleInitiatedDrops(now - 3600000, 100);
        if (stale && stale.length > 0) {
          for (const d of stale) {
            if (this.objectStore.abort && d.upload_id) {
              await this.objectStore.abort({ key: d.object_key, uploadId: d.upload_id }).catch(() => {});
            }
            if (this.storage.updateDropState) {
              this.storage.updateDropState(d.id, 'expired');
            }
          }
        }
      }
    } catch (err) {
      console.error('Sweeper objectStore cleanup error:', err.message || err);
    }
  }

  sweepOnce(now = Date.now()) {
    if (!this.storage) return { links: 0, pastes: 0, drops: 0, total: 0 };
    try {
      if (this.objectStore) {
        this.sweepObjectStore(now).catch(() => {});
      }
      const sweptLinks = this.storage.purgeExpiredLinks ? this.storage.purgeExpiredLinks(now) : 0;
      const sweptPastes = this.storage.purgeExpiredPastes ? this.storage.purgeExpiredPastes(now) : 0;
      const sweptDrops = this.storage.purgeExpiredDrops ? this.storage.purgeExpiredDrops(now) : 0;
      const total = sweptLinks + sweptPastes + sweptDrops;
      this.totalSwept += total;
      this.lastSweepTimestamp = now;
      return { links: sweptLinks, pastes: sweptPastes, drops: sweptDrops, total };
    } catch (err) {
      console.error('Sweeper purge error:', err.message || err);
      return { links: 0, pastes: 0, drops: 0, total: 0, error: err.message };
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.sweepOnce();
    }, this.intervalMs);
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getTotalSwept() {
    return this.totalSwept;
  }

  getLastSweepAgeMs(now = Date.now()) {
    if (!this.lastSweepTimestamp) return null;
    return Math.max(0, now - this.lastSweepTimestamp);
  }
}

module.exports = {
  Sweeper
};
