// src/tools/health/probe.js
// Background health probe daemon & ring buffer (Task P8.1, TOOL-HEALTH-001).
// Visitors can NEVER trigger live dependency calls: all readiness and status endpoints
// read from this cached background snapshot.

const fs = require('node:fs');
const path = require('node:path');
let monitorEventLoopDelay;
try {
  ({ monitorEventLoopDelay } = require('node:perf_hooks'));
} catch (_) {}

class HealthProbeManager {
  constructor(options = {}) {
    this.store = options.store || null;
    this.objectStore = options.objectStore || null;
    this.sweeper = options.sweeper || null;
    this.config = options.config || {};
    this.clock = options.clock || Date;
    this.dataDir = options.dataDir || (this.config.sqliteDbPath ? path.dirname(this.config.sqliteDbPath) : '.');
    this.probeIntervalMs = options.probeIntervalMs || 60000;
    this.ringBuffer = [];
    this.maxRingBufferSize = 60;
    this.timer = null;

    this.elHistogram = null;
    if (monitorEventLoopDelay) {
      try {
        this.elHistogram = monitorEventLoopDelay({ resolution: 20 });
        this.elHistogram.enable();
      } catch (_) {}
    }

    // Default snapshot until first probe finishes
    this.currentSnapshot = {
      timestamp: new Date(this.clock.now()).toISOString(),
      timestampMs: this.clock.now(),
      status: 'operational',
      statusCode: 200,
      failing: [],
      subsystems: {
        database: 'operational',
        objectStore: 'operational',
        eventLoop: 'operational',
        disk: 'operational',
        sweeper: 'operational'
      },
      metrics: {
        eventLoopP99Ms: 0,
        rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        diskFreeBytes: 0,
        diskTotalBytes: 0,
        diskFreePercent: 100,
        sweeperLastRunAgeMs: 0
      }
    };
  }

  async runProbe() {
    const now = this.clock.now();
    const failing = [];
    const subsystems = {
      database: 'operational',
      objectStore: 'operational',
      eventLoop: 'operational',
      disk: 'operational',
      sweeper: 'operational'
    };

    // 1. SQLite probe (SELECT 1 + tiny write)
    if (this.store) {
      try {
        if (typeof this.store.healthProbe === 'function') {
          this.store.healthProbe();
        } else if (typeof this.store.getRawDb === 'function') {
          const db = this.store.getRawDb();
          if (db) db.prepare('SELECT 1').get();
        }
        subsystems.database = 'operational';
      } catch (err) {
        subsystems.database = 'degraded';
        failing.push('database');
      }
    }

    // 2. ObjectStore probe (R2 HeadBucket or fake store)
    if (this.objectStore && typeof this.objectStore.healthProbe === 'function') {
      try {
        await this.objectStore.healthProbe();
        subsystems.objectStore = 'operational';
      } catch (err) {
        // If R2 credentials are fully configured, mark degraded; otherwise skip marking degraded in offline/mock mode
        if (this.config.r2Bucket || this.config.r2AccountId) {
          subsystems.objectStore = 'degraded';
          failing.push('objectStore');
        } else {
          subsystems.objectStore = 'unconfigured';
        }
      }
    }

    // 3. Event Loop Delay p99
    let eventLoopP99Ms = 0;
    if (this.elHistogram) {
      try {
        eventLoopP99Ms = Math.round(Number(this.elHistogram.percentile(99)) / 1e6);
        this.elHistogram.reset();
      } catch (_) {}
    }
    if (eventLoopP99Ms > 1000) {
      subsystems.eventLoop = 'degraded';
      failing.push('eventLoop');
    }

    // 4. Memory Usage (RSS)
    const mem = process.memoryUsage();
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);

    // 5. Disk Free Space via statfs
    let diskFreeBytes = 0;
    let diskTotalBytes = 0;
    let diskFreePercent = 100;
    try {
      if (fs.statfsSync) {
        const targetDir = fs.existsSync(this.dataDir) ? this.dataDir : '.';
        const st = fs.statfsSync(targetDir);
        diskFreeBytes = Number(st.bavail) * Number(st.bsize);
        diskTotalBytes = Number(st.blocks) * Number(st.bsize);
        diskFreePercent = diskTotalBytes > 0 ? Math.round((diskFreeBytes / diskTotalBytes) * 100) : 100;
        if (diskFreePercent < 2) {
          subsystems.disk = 'low_space';
          failing.push('disk');
        }
      }
    } catch (_) {}

    // 6. Age of last sweeper run
    let sweeperAgeMs = null;
    if (this.sweeper && typeof this.sweeper.getLastSweepAgeMs === 'function') {
      sweeperAgeMs = this.sweeper.getLastSweepAgeMs(now);
      if (sweeperAgeMs !== null && sweeperAgeMs > 600000) {
        subsystems.sweeper = 'stale';
        failing.push('sweeper');
      }
    }

    const isDegraded = failing.length > 0;
    const snapshot = {
      timestamp: new Date(now).toISOString(),
      timestampMs: now,
      status: isDegraded ? 'degraded' : 'operational',
      statusCode: isDegraded ? 503 : 200,
      failing,
      subsystems,
      metrics: {
        eventLoopP99Ms,
        rssMB,
        heapUsedMB,
        diskFreeBytes,
        diskTotalBytes,
        diskFreePercent,
        sweeperLastRunAgeMs: sweeperAgeMs
      }
    };

    this.currentSnapshot = snapshot;
    this.ringBuffer.push(snapshot);
    if (this.ringBuffer.length > this.maxRingBufferSize) {
      this.ringBuffer.shift();
    }

    return snapshot;
  }

  start() {
    if (this.timer) return;
    if (this.ringBuffer.length === 0) {
      this.runProbe().catch(() => {});
    }
    this.timer = setInterval(() => {
      this.runProbe().catch(() => {});
    }, this.probeIntervalMs);
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.elHistogram) {
      try {
        this.elHistogram.disable();
      } catch (_) {}
    }
  }

  getSnapshot() {
    return this.currentSnapshot;
  }

  getRingBuffer() {
    return [...this.ringBuffer];
  }
}

module.exports = {
  HealthProbeManager
};
