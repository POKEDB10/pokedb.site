// src/tools/health/router.js
// Health check, readiness probes, replication age, and operational telemetry router (Task P8.1, TOOL-HEALTH-001).

const express = require('express');
const http = require('node:http');
const https = require('node:https');
const { HealthProbeManager } = require('./probe');

function createHealthRouter(options = {}) {
  const router = express.Router();
  const config = options.config || {};
  const store = options.store || {};
  const clock = options.clock || Date;
  const objectStore = options.objectStore || null;
  const sweeper = options.sweeper || null;

  // Background probe manager with 60-point ring buffer
  const probe = options.probe || new HealthProbeManager({
    store,
    objectStore,
    sweeper,
    config,
    clock
  });
  probe.start();

  let litestreamMetricsCache = {
    lastSyncTimestampMs: null,
    lastScrapedMs: 0
  };

  function pollLitestreamMetrics() {
    const metricsUrl = config.litestreamMetricsUrl || process.env.LITESTREAM_METRICS_URL || 'http://127.0.0.1:9090/metrics';
    try {
      const url = new URL(metricsUrl);
      const client = url.protocol === 'https:' ? https : http;
      const req = client.get(url, { timeout: 1500 }, (res) => {
        if (res.statusCode === 200) {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            litestreamMetricsCache.lastScrapedMs = clock.now();
            if (data.includes('litestream_sync_count') || data.includes('litestream_replica_operation_total')) {
              litestreamMetricsCache.lastSyncTimestampMs = clock.now();
            }
          });
        }
      });
      req.on('error', () => {});
      req.on('timeout', () => req.destroy());
    } catch (_) {}
  }

  const requireReplication = config.requireReplication ?? (process.env.REQUIRE_REPLICATION === '1');
  const metricsUrl = config.litestreamMetricsUrl || process.env.LITESTREAM_METRICS_URL;

  if (requireReplication || metricsUrl) {
    const timer = setInterval(pollLitestreamMetrics, 10000);
    if (typeof timer.unref === 'function') timer.unref();
    pollLitestreamMetrics();
  }

  function getReplicationLastSyncAge() {
    const testSyncTs = process.env.LITESTREAM_LAST_SYNC_TIMESTAMP || config.litestreamLastSyncTimestamp;
    if (testSyncTs) {
      const ts = Number(testSyncTs);
      if (!Number.isNaN(ts) && ts > 0) {
        return Math.floor((clock.now() - ts) / 1000);
      }
    }
    if (litestreamMetricsCache.lastSyncTimestampMs) {
      return Math.floor((clock.now() - litestreamMetricsCache.lastSyncTimestampMs) / 1000);
    }
    return 'unknown';
  }

  function getHealthStatus() {
    const uptime = Math.floor(process.uptime());
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const secs = uptime % 60;
    const uptimeFormatted = `${hours > 0 ? hours + 'h ' : ''}${mins > 0 ? mins + 'm ' : ''}${secs}s`;
    const lastSyncAge = getReplicationLastSyncAge();
    const isRequired = process.env.REQUIRE_REPLICATION === '1' || Boolean(config.requireReplication);
    const isReplicationStale = isRequired && (lastSyncAge === 'unknown' ? uptime > 60 : lastSyncAge > 120);

    // Read cached snapshot from background probe (ZERO live I/O)
    const probeSnapshot = probe.getSnapshot();
    const isProbeDegraded = probeSnapshot.status === 'degraded';
    const isDegraded = isReplicationStale || isProbeDegraded;

    const failingSubsystems = [...probeSnapshot.failing];
    if (isReplicationStale && !failingSubsystems.includes('database_replication')) {
      failingSubsystems.push('database_replication');
    }

    return {
      status: isDegraded ? 'degraded' : 'healthy',
      statusCode: isDegraded ? 503 : 200,
      uptimeSeconds: uptime,
      uptimeFormatted,
      memoryUsageMB: probeSnapshot.metrics.rssMB,
      storeMode: 'SQLite WAL',
      recordsCount: typeof store.getRecordCount === 'function' ? store.getRecordCount() : 0,
      replication: {
        required: isRequired,
        lastSyncAge,
        status: isReplicationStale ? 'stale' : 'operational'
      },
      replicationLastSyncAge: lastSyncAge,
      nodeVersion: process.version,
      subsystems: probeSnapshot.subsystems,
      failing: failingSubsystems,
      metrics: probeSnapshot.metrics,
      services: {
        api: 'operational',
        database: isReplicationStale ? 'replication_stale' : probeSnapshot.subsystems.database,
        tinyurl: 'operational',
        qr: 'operational',
        drop: probeSnapshot.subsystems.objectStore
      },
      timestamp: new Date(clock.now()).toISOString()
    };
  }

  // 1. Liveness probe (GET /healthz): fast, zero I/O
  router.get('/healthz', (req, res) => {
    res.status(200).send('OK');
  });

  // 2. Readiness probe (GET /readyz): reads cached background snapshot (ZERO live I/O)
  router.get('/readyz', (req, res) => {
    const snapshot = probe.getSnapshot();
    if (snapshot.status === 'degraded') {
      res.status(503).json({
        status: 'degraded',
        failing: snapshot.failing,
        subsystems: snapshot.subsystems,
        timestamp: snapshot.timestamp
      });
    } else {
      res.status(200).json({
        status: 'ready',
        subsystems: snapshot.subsystems,
        timestamp: snapshot.timestamp
      });
    }
  });

  // 3. Operational status & history (GET /api/status): reads cached snapshot & ring buffer
  router.get('/api/status', (req, res) => {
    const snapshot = probe.getSnapshot();
    res.status(snapshot.statusCode || 200).json({
      status: snapshot.status,
      current: snapshot,
      history: probe.getRingBuffer(),
      timestamp: new Date(clock.now()).toISOString()
    });
  });

  // 4. Comprehensive health check (GET /health, GET /api/health)
  router.get(['/health', '/api/health'], (req, res) => {
    const health = getHealthStatus();
    res.status(health.statusCode || 200).json(health);
  });

  // 5. Ping
  router.get('/api/health/ping', (req, res) => {
    res.status(200).json({ status: 'ok', pong: true, timestamp: clock.now() });
  });

  // Expose probe instance for tests or shutdown
  router.probe = probe;

  return router;
}

module.exports = {
  createHealthRouter
};
