// server.js — PokéDB v2 HTTP Service & Lifecycle Daemon (Task P3.5, ARCH-001)
const { getConfig } = require('./src/config');
const { createSqliteStorage } = require('./src/storage/sqlite');
const { Sweeper } = require('./src/utils/sweeper');
const { createApp } = require('./src/app');

const config = getConfig();
const storage = createSqliteStorage(config.sqliteDbPath);
const sweeper = new Sweeper(storage);
sweeper.start();

const storeRegistry = [];
const { app, clickBuffer, drainTracker } = createApp({ store: storage, config, sweeper, storeRegistry });
app.locals.rateLimitKeyCount = () => storeRegistry.reduce((a, s) => a + (s.memoryStore?.current?.size || 0) + (s.memoryStore?.previous?.size || 0), 0);
app.locals.storage = storage;

let server;
if (require.main === module) {
  server = app.listen(config.port, '0.0.0.0', () => console.log(`Server running on port ${config.port}`));

  const shutdown = (signal) => {
    drainTracker.startDrain(() => {
      console.log('Flushing click buffer and closing storage...');
      try { clickBuffer.close(); sweeper.stop(); storage.close(); } catch (_) {}
      console.log('Server and storage closed successfully');
      server.close(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  ['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => shutdown(sig)));

  if (config.allowTestIpcShutdown || config.isTest || config.enableSoakGc) {
    process.on('message', (msg) => {
      if (msg === 'SIGTERM' || msg === 'SHUTDOWN' || msg?.type === 'SHUTDOWN') shutdown('IPC');
      if (msg === 'FORCE_GC' && global.gc) global.gc();
      if (typeof msg === 'object' && msg?.type === 'TRIGGER_SWEEPER') sweeper.sweepOnce();
      if (typeof msg === 'object' && msg?.type === 'SNAPSHOT') {
        const snap = require('node:v8').writeHeapSnapshot(msg.path);
        process.send?.({ type: 'SNAPSHOT_DONE', path: snap });
      }
      if (typeof msg === 'object' && (msg?.type === 'MEMORY_REPORT' || msg?.type === 'GET_MEMORY')) {
        if (global.gc) global.gc();
        const mem = process.memoryUsage();
        process.send?.({
          type: 'MEMORY_REPORT', memory: mem,
          rss: mem.rss, heapTotal: mem.heapTotal, heapUsed: mem.heapUsed,
          external: mem.external, arrayBuffers: mem.arrayBuffers,
          totalSweptCount: sweeper.getTotalSwept(),
          rateLimitKeys: app.locals.rateLimitKeyCount ? app.locals.rateLimitKeyCount() : 0,
          walSize: storage.getWalSize ? storage.getWalSize() : 0,
          dbSize: storage.getDbSize ? storage.getDbSize() : 0
        });
      }
    });
  }
}

module.exports = app;