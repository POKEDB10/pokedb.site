// src/services/safeBrowsing.js
// Google Safe Browsing Lookup API v4 Client with 30-minute verdict caching (Task P5.4, LEGAL-002, PERF-004).

class SafeBrowsingService {
  constructor(options = {}) {
    this.apiKey = options.apiKey || '';
    this.store = options.store || null;
    this.timeoutMs = options.timeoutMs || 800;
    this.memoryCache = new Map(); // host -> { verdict, expiresAt }
  }

  // Canonicalize URL: strip query string and fragment (Task P5.4)
  static stripQueryAndFragment(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
      return rawUrl;
    }
  }

  async checkUrl(rawUrl) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { isSafe: false, reason: 'Invalid URL format' };
    }

    const host = parsed.hostname.toLowerCase();

    // 1. Check local threat indicators first (< 1 ms, Task P5.4)
    if (this.store && this.store.isHostThreat && this.store.isHostThreat(host)) {
      return {
        isSafe: false,
        source: 'local_feed',
        reason: 'Destination domain flagged in threat feed'
      };
    }

    // 2. Check 30-minute verdict cache (per Google Safe Browsing Terms of Service)
    const cached = this.getVerdictFromCache(host);
    if (cached) {
      if (cached === 'SAFE') {
        return { isSafe: true, cached: true };
      }
      return {
        isSafe: false,
        source: 'safe_browsing_cache',
        threatType: cached,
        attribution: 'Advisory provided by Google'
      };
    }

    // If no API key configured, pass as unscanned (fails open for creation, logged)
    if (!this.apiKey) {
      return { isSafe: true, unscanned: true };
    }

    // 3. Query Google Safe Browsing v4 Lookup API
    const canonicalUrl = SafeBrowsingService.stripQueryAndFragment(rawUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const endpoint = `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(this.apiKey)}`;
      const payload = {
        client: {
          clientId: 'pokedb-site',
          clientVersion: '2.0.0'
        },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [{ url: canonicalUrl }]
        }
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!res.ok) {
        // Safe timeout / HTTP error: allow creation but mark unscanned (Task P5.4)
        return { isSafe: true, unscanned: true, httpStatus: res.status };
      }

      const data = await res.json();
      if (data.matches && data.matches.length > 0) {
        const match = data.matches[0];
        const threatType = match.threatType || 'MALWARE';
        this.saveVerdictToCache(host, threatType);
        return {
          isSafe: false,
          source: 'google_safe_browsing',
          threatType,
          attribution: 'Advisory provided by Google'
        };
      }

      // Safe verdict: cache for up to 30 min
      this.saveVerdictToCache(host, 'SAFE');
      return { isSafe: true, unscanned: false };
    } catch (err) {
      // Abort / network error: allow but mark unscanned
      return { isSafe: true, unscanned: true, timeout: err.name === 'AbortError' };
    } finally {
      clearTimeout(timer);
    }
  }

  getVerdictFromCache(host) {
    const now = Date.now();
    const mem = this.memoryCache.get(host);
    if (mem && mem.expiresAt > now) {
      return mem.verdict;
    }
    if (this.store && this.store.getVerdict) {
      const dbVerdict = this.store.getVerdict(host, 1800000); // 30 min
      if (dbVerdict) {
        this.memoryCache.set(host, { verdict: dbVerdict, expiresAt: now + 1800000 });
        return dbVerdict;
      }
    }
    return null;
  }

  saveVerdictToCache(host, verdict) {
    const expiresAt = Date.now() + 1800000; // 30 min
    this.memoryCache.set(host, { verdict, expiresAt });
    if (this.store && this.store.setVerdict) {
      try {
        this.store.setVerdict(host, verdict);
      } catch (_) {}
    }
  }
}

module.exports = {
  SafeBrowsingService
};
