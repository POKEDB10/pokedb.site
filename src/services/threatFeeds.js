// src/services/threatFeeds.js
// Periodic threat intelligence sync service for local threat_indicators table (Task P5.3).
// Free feeds that passed Gate: abuse.ch URLhaus (requires personal Auth-Key). OpenPhish dropped per Gate.

class ThreatFeedService {
  constructor(options = {}) {
    this.store = options.store || null;
    this.abuseChAuthKey = options.abuseChAuthKey || '';
    this.intervalMs = options.intervalMs || 30 * 60 * 1000; // 30 min
    this.timer = null;
    this.rescanTimer = null;
  }

  start() {
    if (this.timer) return;
    // Initial sync
    this.syncFeeds().catch((err) => {
      console.warn('[THREAT FEEDS] Initial sync encountered an issue (non-fatal):', err.message);
    });

    this.timer = setInterval(() => {
      this.syncFeeds().catch((err) => {
        console.warn('[THREAT FEEDS] Periodic sync encountered an issue (non-fatal):', err.message);
      });
    }, this.intervalMs);
    if (this.timer.unref) this.timer.unref();

    // Hourly rescan of links younger than 7 days against local table (Task P5.4)
    this.rescanTimer = setInterval(() => {
      this.rescanLinks();
    }, 60 * 60 * 1000);
    if (this.rescanTimer.unref) this.rescanTimer.unref();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.rescanTimer) {
      clearInterval(this.rescanTimer);
      this.rescanTimer = null;
    }
  }

  async syncFeeds() {
    if (!this.store || !this.store.bulkAddThreatIndicators) return { added: 0 };

    if (!this.abuseChAuthKey) {
      // Per Gate: abuse.ch now requires an Auth-Key for API/downloads.
      // If unset, skip network fetch, keep existing indicators, and log once.
      return { added: 0, skipped: 'ABUSE_CH_AUTH_KEY not configured' };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000); // 10s timeout
      const endpoint = `https://urlhaus-api.abuse.ch/v2/files/exports/${encodeURIComponent(this.abuseChAuthKey)}/recent.csv`;

      const res = await fetch(endpoint, {
        signal: controller.signal,
        headers: { 'User-Agent': 'pokedb-threat-sync/1.0' }
      });
      clearTimeout(timer);

      if (!res.ok) {
        console.warn(`[THREAT FEEDS] URLhaus returned HTTP ${res.status}; keeping existing data.`);
        return { added: 0 };
      }

      const text = await res.text();
      const lines = text.split('\n');
      const indicators = [];

      for (const line of lines) {
        if (!line || line.startsWith('#')) continue;
        const parts = line.split('","').map((s) => s.replace(/^"|"$/g, ''));
        // URLhaus recent CSV contains URL in column 2 (index 2)
        const urlStr = parts[2];
        if (urlStr && (urlStr.startsWith('http://') || urlStr.startsWith('https://'))) {
          try {
            const host = new URL(urlStr).hostname.toLowerCase().trim();
            if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
              indicators.push({ kind: 'host', value: host, source: 'urlhaus' });
            }
          } catch (_) {}
        }
      }

      if (indicators.length > 0) {
        const added = this.store.bulkAddThreatIndicators(indicators);
        return { added };
      }
      return { added: 0 };
    } catch (err) {
      // Feed failure never blocks the app
      console.warn('[THREAT FEEDS] Failed to fetch abuse.ch URLhaus feed (retaining current cache):', err.message);
      return { added: 0, error: err.message };
    }
  }

  rescanLinks() {
    if (this.store && this.store.rescanRecentLinks) {
      try {
        const count = this.store.rescanRecentLinks(7 * 86400 * 1000);
        if (count > 0) {
          console.warn(`[THREAT FEEDS] Hourly rescan quarantined ${count} weaponized link(s).`);
        }
      } catch (err) {
        console.warn('[THREAT FEEDS] Hourly link rescan error:', err.message);
      }
    }
  }
}

module.exports = {
  ThreatFeedService
};
