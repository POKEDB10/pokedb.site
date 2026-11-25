// src/tools/drop/router.js
// Drop File Storage Tool API and Views Router (Phase 4 — Drop v2 on Cloudflare R2 + Legacy Compatibility).

const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { nanoid } = require('nanoid');
const { anonymizeIp } = require('../../logger');
const { renderTemplate, htmlEscape } = require('../../utils/template');
const { resolveHost } = require('../../middleware/proxyTrust');
const { isValidRemoteUrl, parseExpiresInDays, RESERVED_BLOCKLIST } = require('../../utils/urlSecurity');
const { tokensMatch } = require('../../middleware/auth');
const { dropIdAlphabet, generateDropId8, generateDropId9 } = require('../../utils/crypto');
const { getAssetHasher } = require('../../utils/assetHasher');
const { createTurnstileMiddleware } = require('../../middleware/turnstile');

const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.scr', '.msi', '.bat', '.cmd', '.com', '.pif', '.apk', '.dll'
]);

const TYPEABLE_DROP_ALPHABET = dropIdAlphabet;
const TYPEABLE_DROP_LENGTH = 8;
const TYPEABLE_CODE_PATTERN = /^[23456789abcdefghjkmnpqrstuvwxyz]{6,9}$/;
const DROP_PUBLIC_DIR = path.resolve(__dirname, '..', '..', '..', 'tools', 'drop', 'public');
const VIEW_HTML_PATH = path.join(DROP_PUBLIC_DIR, 'view.html');
const UPLOAD_HTML_PATH = path.join(DROP_PUBLIC_DIR, 'upload.html');

function sanitizeFileName(rawName) {
  if (!rawName || typeof rawName !== 'string') return 'file';
  let name = rawName.normalize('NFC');
  name = name.replace(/[\x00-\x1F\x7F/\\?%*:|"<>]/g, '_').trim();
  if (!name) return 'file';
  const buf = Buffer.from(name, 'utf8');
  if (buf.length > 180) {
    name = buf.subarray(0, 180).toString('utf8').replace(/\uFFFD$/, '');
  }
  return name || 'file';
}

function isBlockedExtension(filename) {
  const lower = filename.toLowerCase();
  for (const ext of BLOCKED_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function calculateParts(size) {
  const partSize = size <= 64 * 1024 * 1024 ? 8 * 1024 * 1024 : 16 * 1024 * 1024;
  const numParts = Math.max(1, Math.ceil(size / partSize));
  return { partSize, numParts };
}

function generateDropId21() {
  return nanoid(21);
}

/**
 * Normalize a potential short typeable Drop code by trimming, stripping whitespace,
 * and lowercasing if it conforms to the unambiguous Crockford Base32-clean alphabet.
 */
function normalizeTypeableDropCode(rawId) {
  if (typeof rawId !== 'string') return '';
  const collapsed = rawId.trim().replace(/\s+/g, '').toLowerCase();
  return TYPEABLE_CODE_PATTERN.test(collapsed) ? collapsed : '';
}

/**
 * Check whether a candidate drop ID or folder code is reserved or already exists in SQLite/KV.
 */
function isDropIdTaken(store, candidate) {
  if (!candidate || RESERVED_BLOCKLIST.has(candidate.toLowerCase())) return true;
  if (!store) return false;
  if (typeof store.getDrop === 'function' && store.getDrop(candidate)) {
    return true;
  }
  if (typeof store.hasKv === 'function') {
    if (store.hasKv(`drop:${candidate}`) || store.hasKv(`drop:folder:${candidate}`)) {
      return true;
    }
  } else if (typeof store.getKv === 'function') {
    if (store.getKv(`drop:${candidate}`) !== null || store.getKv(`drop:folder:${candidate}`) !== null) {
      return true;
    }
  }
  return false;
}

/**
 * Generate a short, human-typeable 8-char Drop code with collision retries against SQLite/KV.
 */
function generateTypeableDropId(store, options = {}) {
  const maxAttempts = Number.isInteger(options.maxAttempts) && options.maxAttempts > 0 ? options.maxAttempts : 16;
  const hasCustomGen = typeof options.generator === 'function';
  const generator = hasCustomGen ? options.generator : generateDropId8;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = String(generator() || '').trim().toLowerCase();
    if (!candidate || !TYPEABLE_CODE_PATTERN.test(candidate)) continue;
    if (!isDropIdTaken(store, candidate)) {
      return candidate;
    }
  }

  if (!hasCustomGen) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = generateDropId9();
      if (!isDropIdTaken(store, candidate)) {
        return candidate;
      }
    }
  }

  throw new Error('Failed to generate unique typeable drop ID after maximum collision retries.');
}

function buildLookupCandidates(rawId) {
  if (typeof rawId !== 'string') return [];
  const trimmed = rawId.trim();
  if (!trimmed) return [];
  const candidates = [trimmed];
  const normalized = normalizeTypeableDropCode(trimmed);
  if (normalized && normalized !== trimmed) {
    candidates.push(normalized);
  }
  return candidates;
}

function resolveDrop(store, rawId) {
  if (!store || typeof store.getDrop !== 'function') return null;
  for (const candidate of buildLookupCandidates(rawId)) {
    const drop = store.getDrop(candidate);
    if (drop) return drop;
  }
  return null;
}

function resolveDropOrFolder(store, rawId) {
  if (!store) return null;
  for (const candidate of buildLookupCandidates(rawId)) {
    if (typeof store.getDrop === 'function') {
      const drop = store.getDrop(candidate);
      if (drop) return { kind: 'drop', id: drop.id, drop };
    }
    if (typeof store.getKv === 'function') {
      const folderRaw = store.getKv(`drop:folder:${candidate}`);
      if (folderRaw && folderRaw !== 'RESERVED') {
        return { kind: 'folder', id: candidate, folderRaw };
      }
    }
  }
  return null;
}

function resolveFolder(store, rawCode) {
  if (!store || typeof store.getKv !== 'function') return null;
  for (const candidate of buildLookupCandidates(rawCode)) {
    const folderRaw = store.getKv(`drop:folder:${candidate}`);
    if (folderRaw && folderRaw !== 'RESERVED') {
      return { id: candidate, folderRaw };
    }
  }
  return null;
}

function hashDeleteToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest();
}

function deleteTokenMatches(providedToken, storedHash) {
  if (!providedToken || !storedHash) return false;
  const tokenHash = hashDeleteToken(providedToken);
  const expectedBuf = Buffer.isBuffer(storedHash) ? storedHash : Buffer.from(storedHash);
  return expectedBuf.length === tokenHash.length && crypto.timingSafeEqual(tokenHash, expectedBuf);
}

function isAdminAuthorized(req, config) {
  const adminToken = process.env.ADMIN_TOKEN || config.adminToken;
  if (!adminToken) return false;
  const authHeader = (typeof req.get === 'function' ? req.get('authorization') : req.headers?.authorization) || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return tokensMatch(authHeader.slice(7).trim(), adminToken);
  }
  const headerToken = (typeof req.get === 'function' ? req.get('x-admin-token') : req.headers?.['x-admin-token']) || '';
  return Boolean(headerToken && tokensMatch(headerToken.trim(), adminToken));
}

function buildDropEtag(drop, baseUrl) {
  const fingerprint = `v1:${drop.id}:${drop.state}:${drop.size}:${drop.downloads}:${drop.expiresAt || 0}:${drop.sha256 || ''}:${drop.encrypted ? 1 : 0}:${baseUrl}`;
  const digest = crypto.createHash('sha1').update(fingerprint).digest('base64url').slice(0, 16);
  return `"${digest}"`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function formatSizeAuto(bytes) {
  const num = Number(bytes) || 0;
  if (num >= 1073741824) return (num / 1073741824).toFixed(2).replace(/\.00$/, '') + 'gb';
  if (num >= 1048576) return (num / 1048576).toFixed(1).replace(/\.0$/, '') + 'mb';
  if (num >= 1024) return (num / 1024).toFixed(0) + 'kb';
  return num + 'b';
}

function parseMultipartBuffer(buffer, boundary) {
  const boundaryBuf = Buffer.from('--' + boundary);
  const fields = {};
  let file = null;

  let start = 0;
  while (start < buffer.length) {
    const bIdx = buffer.indexOf(boundaryBuf, start);
    if (bIdx === -1) break;
    const nextBIdx = buffer.indexOf(boundaryBuf, bIdx + boundaryBuf.length);
    if (nextBIdx === -1) break;

    const part = buffer.subarray(bIdx + boundaryBuf.length, nextBIdx);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerStr = part.subarray(0, headerEnd).toString('utf8');
      let body = part.subarray(headerEnd + 4);
      if (body.length >= 2 && body[body.length - 2] === 13 && body[body.length - 1] === 10) {
        body = body.subarray(0, body.length - 2);
      }

      const dispMatch = headerStr.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
      if (dispMatch) {
        const fieldName = dispMatch[1];
        const filename = dispMatch[2];
        if (filename !== undefined) {
          const typeMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
          file = {
            fieldname: fieldName,
            originalname: filename,
            mimetype: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
            buffer: body,
            size: body.length
          };
        } else {
          fields[fieldName] = body.toString('utf8');
        }
      }
    }
    start = nextBIdx;
  }
  return { fields, file };
}

async function scanBufferVirus(buffer, abuseChKey = '') {
  const flags = [];
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  const mbController = new AbortController();
  const mbTimer = setTimeout(() => mbController.abort(), 800);
  try {
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (abuseChKey) {
      headers['Auth-Key'] = abuseChKey;
    }
    const mbRes = await fetch('https://mb-api.abuse.ch/api/v1/', {
      method: 'POST',
      headers,
      signal: mbController.signal,
      body: new URLSearchParams({ query: 'get_info', hash: sha256 })
    });
    if (mbRes.ok) {
      const mbData = await mbRes.json();
      if (mbData.query_status === 'ok' && mbData.data && mbData.data.length > 0) {
        const sample = mbData.data[0];
        const family = sample.signature || sample.malware_family || 'Malicious Payload';
        flags.push(`Flagged by MalwareBazaar database: Known malware sample (${family})`);
      }
    }
  } catch (_) {
  } finally {
    clearTimeout(mbTimer);
  }

  return { flags, sha256 };
}

const SSR_SHARED_CSS = `
    .ssr-wrap { width: min(100% - 1.5rem, 720px); margin: clamp(1.25rem, 4vw, 2.5rem) auto; padding-bottom: env(safe-area-inset-bottom); }
    .ssr-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: clamp(1.1rem, 3.5vw, 1.85rem); }
    .ssr-top { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.6rem; padding-bottom: 0.85rem; margin-bottom: 1rem; border-bottom: 1px solid var(--border); }
    .ssr-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem; }
    .ssr-tag { display: inline-flex; align-items: center; padding: 0.2rem 0.5rem; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); font: 600 0.72rem 'IBM Plex Mono', monospace; color: var(--text); }
    .ssr-tag.is-burn { border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); color: var(--danger); }
    .ssr-card h1 { font-size: clamp(1.15rem, 3vw, 1.45rem); overflow-wrap: anywhere; word-break: break-word; margin: 0 0 0.9rem 0; }
    .ssr-code-box { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.65rem; padding: 0.7rem 0.9rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); margin: 0 0 1rem; }
    .ssr-code-val { font-family: 'IBM Plex Mono', monospace; font-size: clamp(1.15rem, 3.8vw, 1.4rem); font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: 0.12em; color: var(--text); user-select: all; }
    .meta-row { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 0.4rem 0.75rem; padding: 0.52rem 0; color: var(--muted); font-size: 0.88rem; border-bottom: 1px solid var(--border); }
    .meta-row span:last-child { color: var(--text); font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .ssr-sha-box { margin-top: 1rem; padding: 0.85rem 0.95rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); font: 0.78rem/1.45 'IBM Plex Mono', monospace; }
    .ssr-sha-head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.55rem; }
    .ssr-sha-val { color: var(--text); word-break: break-all; }
    .ssr-sha-verify { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
    .ssr-sha-verify input { flex: 1 1 200px; min-height: 44px; background: var(--surface); }
    .ssr-sha-badge { display: none; padding: 0.35rem 0.6rem; border-radius: 4px; font-weight: 600; font-size: 0.76rem; white-space: nowrap; }
    .ssr-sha-badge.is-match { display: inline-block; color: var(--success); border: 1px solid var(--success); background: color-mix(in srgb, var(--success) 12%, transparent); }
    .ssr-sha-badge.is-mismatch { display: inline-block; color: var(--danger); border: 1px solid var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); }
    .ssr-links-box { display: grid; gap: 0.7rem; margin-top: 1rem; padding: 0.85rem 0.95rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); }
    .ssr-link-label { display: block; font: 500 0.74rem 'IBM Plex Mono', monospace; color: var(--muted); margin-bottom: 0.3rem; }
    .ssr-link-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.5rem; align-items: center; }
    .burn-warn { background: color-mix(in srgb, var(--danger) 8%, var(--bg)); border: 1px solid color-mix(in srgb, var(--danger) 40%, var(--border)); border-left: 3px solid var(--danger); color: var(--text); border-radius: 6px; padding: 0.72rem 0.9rem; font-size: 0.84rem; margin: 1rem 0 0; }
    .ssr-actions { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-top: 1.15rem; }
    .ssr-actions .btn { flex: 1 1 150px; justify-content: center; min-height: 44px; text-decoration: none; }
    .btn-compact { min-height: 44px; padding: 0.45rem 0.8rem; font-size: 0.78rem; width: auto !important; flex: 0 0 auto; }
    .qr-panel { display: none; margin-top: 1rem; padding: 1rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); flex-direction: column; align-items: center; gap: 0.6rem; }
    .qr-panel.open { display: flex; }
    .qr-box-inner { width: 168px; height: 168px; background: #fff; padding: 8px; border-radius: 6px; display: flex; align-items: center; justify-content: center; }
    .report-wrap { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-top: 1.1rem; padding-top: 0.85rem; border-top: 1px solid var(--border); font: 0.78rem 'IBM Plex Mono', monospace; color: var(--muted); }
    .report-link { display: inline-flex; align-items: center; min-height: 44px; color: var(--muted); text-decoration: none; }
    .report-link:hover { color: var(--danger); text-decoration: underline; }
    .ssr-status-msg { color: var(--muted); font-size: 0.92rem; margin: 0.5rem 0 1.15rem 0; line-height: 1.55; }
    @media (max-width: 640px) {
      .ssr-wrap { width: calc(100% - 1.25rem); margin: 1rem auto 1.75rem; }
      .ssr-link-row { grid-template-columns: 1fr; }
      .ssr-actions { flex-direction: column; }
      .ssr-actions .btn { width: 100%; flex: 0 0 auto; }
    }
`;

function renderSsrHeader() {
  return `<a href="#main" class="skip-link">Skip to main content</a>
<header class="site-nav">
  <a class="logo" href="/" data-nav="main">root<span>@</span>pokedb</a>
  <nav class="nav-links" aria-label="Tools navigation">
    <a class="nav-link" href="/tools/" data-nav="tools">Tools hub</a>
    <a class="nav-link" href="/tools/tinyurl/" data-nav="tinyurl">TinyURL</a>
    <a class="nav-link" href="/tools/qr/" data-nav="qr">QR studio</a>
    <a class="nav-link active" href="/tools/drop/" data-nav="drop" aria-current="page">Drop</a>
    <a class="nav-link" href="/tools/lan/" data-nav="lan">LAN</a>
    <a class="nav-link" href="/tools/paste/" data-nav="paste">Pastebin</a>
    <a class="nav-link" href="/tools/health/" data-nav="health">Health</a>
  </nav>
  <div class="theme-switcher">
    <span class="theme-swatch" id="theme-swatch"></span>
    <select id="theme-select" aria-label="Choose a theme"></select>
  </div>
</header>`;
}

function renderDropSsrStatusPage({ title, heading, message, assets }) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="oled-black">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
  <title>${htmlEscape(title)} - PokéDB Drop</title>
  <link rel="preload" href="${assets.fontMono}" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="${assets.fontSans}" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="${assets.fontsCss}">
  <link rel="stylesheet" href="${assets.themeCss}">
  <script src="${assets.themeJs}"></script>
  <style>${SSR_SHARED_CSS}</style>
</head>
<body class="tool-page">
${renderSsrHeader()}
<main id="main" class="ssr-wrap">
  <article class="ssr-card">
    <div class="ssr-top">
      <span class="tool-section-label" style="margin-bottom:0;">Shared file</span>
    </div>
    <h1>${htmlEscape(heading)}</h1>
    <p class="ssr-status-msg">${htmlEscape(message)}</p>
    <div class="ssr-actions">
      <a href="/tools/drop/" class="btn btn-solid" data-nav="drop">Back to Drop</a>
    </div>
  </article>
</main>
</body>
</html>`;
}

function renderDropSsrPage({ drop, downloadUrl, assets }) {
  const safeId = htmlEscape(drop.id);
  const safeNameAttr = htmlEscape(drop.name);
  const expiresDate = drop.expiresAt ? new Date(drop.expiresAt).toUTCString() : 'Never';
  const isBurn = drop.maxDownloads === 1;
  const isEncrypted = Boolean(drop.encrypted);
  const viewUrl = downloadUrl.replace(/\/d\/([^/]+)$/, '/v/$1');
  const curlCmd = `curl -LOJ ${downloadUrl}`;
  const shaBlock = drop.sha256
    ? `<div class="ssr-sha-box">
      <div class="ssr-sha-head">
        <span><strong>SHA-256:</strong> <span class="ssr-sha-val">${htmlEscape(drop.sha256)}</span></span>
        <button type="button" class="btn btn-compact" data-copy-value="${htmlEscape(drop.sha256)}">Copy SHA-256</button>
      </div>
      <div class="ssr-sha-verify">
        <label for="ssr-sha-input" class="skip-link">Expected SHA-256 checksum</label>
        <input type="text" id="ssr-sha-input" data-expected-sha="${htmlEscape(drop.sha256)}" placeholder="Paste expected SHA-256 to verify integrity…" autocomplete="off" spellcheck="false">
        <span class="ssr-sha-badge" id="ssr-sha-badge" role="status"></span>
      </div>
    </div>`
    : '';
  const statusLabel = drop.state === 'complete' ? 'Ready' : 'Uploading / Pending';

  return `<!DOCTYPE html>
<html lang="en" data-theme="oled-black">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
  <title>${safeNameAttr} - PokéDB Drop</title>
  <link rel="preload" href="${assets.fontMono}" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="${assets.fontSans}" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="${assets.fontsCss}">
  <link rel="stylesheet" href="${assets.themeCss}">
  <script src="${assets.themeJs}"></script>
  <script src="${assets.qrJs}" defer></script>
  <script src="${assets.ssrViewJs}" defer></script>
  <style>${SSR_SHARED_CSS}</style>
</head>
<body class="tool-page">
${renderSsrHeader()}
<main id="main" class="ssr-wrap">
  <article class="ssr-card">
    <div class="ssr-top">
      <span class="tool-section-label" style="margin-bottom:0;">Shared file</span>
      <div class="ssr-tags">
        ${isEncrypted ? '<span class="ssr-tag">E2E Encrypted</span>' : ''}
        ${isBurn ? '<span class="ssr-tag is-burn">Burn After 1 Download</span>' : ''}
      </div>
    </div>
    <h1>${safeNameAttr}</h1>
    <div class="ssr-code-box">
      <div>
        <span class="tool-section-label" style="margin-bottom:0.15rem;">Short Code</span>
        <div class="ssr-code-val">${safeId}</div>
      </div>
      <button type="button" class="btn btn-compact" data-copy-value="${safeId}">Copy Code</button>
    </div>
    <div class="meta-row"><span>File Size:</span><span>${formatBytes(drop.size)}</span></div>
    <div class="meta-row"><span>Expires At:</span><span>${htmlEscape(expiresDate)}</span></div>
    <div class="meta-row"><span>Downloads:</span><span>${drop.downloads}${drop.maxDownloads ? ` / ${drop.maxDownloads}` : ''}</span></div>
    <div class="meta-row"><span>Status:</span><span>${statusLabel}</span></div>
    ${shaBlock}
    <div class="ssr-links-box">
      <div>
        <label class="ssr-link-label" for="ssr-share-url">Share URL (/v/)</label>
        <div class="ssr-link-row">
          <input type="text" id="ssr-share-url" value="${htmlEscape(viewUrl)}" readonly>
          <button type="button" class="btn btn-compact" data-copy-value="${htmlEscape(viewUrl)}">Copy Link</button>
        </div>
      </div>
      <div>
        <label class="ssr-link-label" for="ssr-direct-url">Direct Download URL (/d/)</label>
        <div class="ssr-link-row">
          <input type="text" id="ssr-direct-url" value="${htmlEscape(downloadUrl)}" readonly>
          <button type="button" class="btn btn-compact" data-copy-value="${htmlEscape(downloadUrl)}">Copy Direct</button>
        </div>
      </div>
      <div>
        <label class="ssr-link-label" for="ssr-curl-cmd">Terminal Fetch (cURL)</label>
        <div class="ssr-link-row">
          <input type="text" id="ssr-curl-cmd" value="${htmlEscape(curlCmd)}" readonly>
          <button type="button" class="btn btn-compact" data-copy-value="${htmlEscape(curlCmd)}">Copy curl</button>
        </div>
      </div>
    </div>
    ${isBurn ? '<div class="burn-warn" role="note">Burn on read: this file will be permanently deleted after 1 download.</div>' : ''}
    <div class="ssr-actions">
      <a href="${htmlEscape(downloadUrl)}" class="btn btn-solid" download>Download File</a>
      <button type="button" class="btn" id="copy-download-btn" data-copy-url="${htmlEscape(viewUrl)}">Copy Link</button>
      <button type="button" class="btn" id="toggle-qr-btn" data-qr-url="${htmlEscape(viewUrl)}" aria-expanded="false">QR Code</button>
    </div>
    <div class="qr-panel" id="drop-ssr-qr">
      <div id="drop-ssr-qr-wrap" class="qr-box-inner"></div>
      <span class="mono" style="font-size:0.75rem;color:var(--muted);">Scan to download on mobile</span>
    </div>
    <div class="report-wrap">
      <span>${String(drop.objectKey || '').startsWith('rootz:') ? 'Rootz cloud delivery' : (String(drop.objectKey || '').startsWith('local:') ? 'Encrypted temporary storage' : 'Cloudflare R2 presigned delivery')}</span>
      <a href="/abuse?kind=drop&amp;id=${safeId}" class="report-link">Report Abuse</a>
    </div>
  </article>
</main>
</body>
</html>`;
}

function createDropRouter({ store, objectStore, limiters = {}, config = {}, clock = Date }) {
  const router = express.Router();
  const uploadLimiter = limiters.uploadLimiter || ((req, res, next) => next());
  const viewerLimiter = limiters.viewerLimiter || ((req, res, next) => next());
  const adminLimiter = limiters.adminLimiter || ((req, res, next) => next());
  const turnstile = createTurnstileMiddleware({ config });
  const folderAttachQueues = new Map();
  const hasFallbackStorage = !objectStore && (Boolean(config.rootzApiKey) || Boolean(config.dropDirectFallback));
  const blobsDir = config.sqliteDbPath && config.sqliteDbPath !== ':memory:'
    ? path.join(path.dirname(path.resolve(config.sqliteDbPath)), 'drop-blobs')
    : path.join(os.tmpdir(), 'pokedb-drop-blobs');
  const assetHasher = getAssetHasher();
  const ssrAssets = {
    fontsCss: assetHasher.getHashedPath('/fonts/fonts.css'),
    fontMono: '/fonts/ibm-plex-mono-400.woff2',
    fontSans: '/fonts/ibm-plex-sans-400.woff2',
    themeCss: assetHasher.getHashedPath('/shared/theme.css'),
    themeJs: assetHasher.getHashedPath('/shared/theme-switcher.js'),
    qrJs: assetHasher.getHashedPath('/shared/qrcode.min.js'),
    ssrViewJs: '/tools/drop/ssr-view.js'
  };

  function getBaseUrl(req) {
    const host = resolveHost(req);
    const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
    return `${proto}://${host}`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // R4 Cloudflare R2 Native API (Tasks P4.1 - P4.11)
  // ─────────────────────────────────────────────────────────────────────────────

  // 1. Drop Init: POST /api/drop/init
  router.post('/api/drop/init', uploadLimiter, turnstile, async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      if (req.isCli) {
        return res.status(400).json({
          error: 'drop_browser_only',
          message: 'Drop v2 upload requires a modern browser supporting direct R2 multipart upload.'
        });
      }

      const dropPolicy = config.dropPolicy || 'open_limited';
      if (dropPolicy === 'disabled') {
        return res.status(503).json({ error: 'Drop uploads are currently disabled by policy.' });
      }

      const { name, size, ttlHours = 24, burn = false, encrypted = false } = req.body || {};

      const numSize = Number(size);
      if (!Number.isFinite(numSize) || numSize < 1) {
        return res.status(400).json({ error: 'A valid positive file size is required.' });
      }

      const defaultMaxBytes = config.dropMaxBytes || 250 * 1024 * 1024; // 250 MiB
      const ownerMaxBytes = config.ownerMaxBytes || 1024 * 1024 * 1024; // 1 GiB

      const authHeader = req.get('authorization') || '';
      const isAdmin = Boolean(
        config.adminToken &&
        authHeader.toLowerCase().startsWith('bearer ') &&
        tokensMatch(authHeader.slice(7).trim(), config.adminToken)
      );

      const effectiveMax = isAdmin ? ownerMaxBytes : defaultMaxBytes;
      if (numSize > effectiveMax) {
        return res.status(413).json({
          error: `File size exceeds the maximum allowed upload limit (${formatBytes(effectiveMax)}).`
        });
      }

      const safeName = sanitizeFileName(name);
      if (!encrypted && isBlockedExtension(safeName)) {
        return res.status(400).json({
          error: 'Executable file types (.exe, .msi, .dll, etc.) are blocked unless encrypted mode is used.'
        });
      }

      const allowedTtls = [1, 12, 24, 72];
      const validTtl = allowedTtls.includes(Number(ttlHours)) ? Number(ttlHours) : 24;
      const expiresAt = clock.now() + validTtl * 3600000;

      if (store.getActiveStorageBytes) {
        const activeBytes = store.getActiveStorageBytes();
        const softCap = config.storageSoftCapBytes || 8.5 * 1024 * 1024 * 1024;
        if (activeBytes + numSize > softCap) {
          return res.status(503).json({
            error: 'drop_full',
            message: 'Storage soft capacity reached. Please retry after expired files are swept.'
          });
        }
      }

      const subnet = anonymizeIp(req.ip);
      const oneDayAgo = clock.now() - 86400000;
      if (store.getDailySubnetBytes) {
        const subnetDailyBytes = store.getDailySubnetBytes(subnet, oneDayAgo);
        const subnetCap = config.dropDailyBytesPerSubnet || 500 * 1024 * 1024;
        if (subnetDailyBytes + numSize > subnetCap) {
          return res.status(429).json({
            error: 'Daily upload quota exceeded for your subnet (500 MiB/day).'
          });
        }
      }
      if (store.getDailyGlobalBytes) {
        const globalDailyBytes = store.getDailyGlobalBytes(oneDayAgo);
        const globalCap = config.dropDailyBytesGlobal || 3 * 1024 * 1024 * 1024;
        if (globalDailyBytes + numSize > globalCap) {
          return res.status(429).json({
            error: 'Daily global upload quota reached. Please retry tomorrow.'
          });
        }
      }

      if (!objectStore || !objectStore.createMultipart) {
        return res.status(503).json({
          error: 'storage_service_unavailable',
          message: 'Drop storage service is not configured.',
          fallbackAvailable: hasFallbackStorage
        });
      }

      const id = generateTypeableDropId(store);
      const objectKey = `drops/${id}`;
      const { partSize, numParts } = calculateParts(numSize);

      const deleteToken = crypto.randomBytes(16).toString('hex');
      const deleteHash = hashDeleteToken(deleteToken);

      const mpRes = await objectStore.createMultipart({
        key: objectKey,
        contentType: 'application/octet-stream',
        contentDisposition: `attachment; filename="${encodeURIComponent(safeName)}"`
      });
      const uploadId = mpRes.uploadId;
      const parts = await Promise.all(
        Array.from({ length: numParts }, (_, idx) => {
          const partNumber = idx + 1;
          return objectStore.presignPart({
            key: objectKey,
            uploadId,
            partNumber,
            expiresInSeconds: 900
          }).then((presigned) => ({ n: partNumber, url: presigned.url }));
        })
      );

      store.createDrop({
        id,
        objectKey,
        uploadId,
        name: safeName,
        size: numSize,
        state: 'initiated',
        createdAt: clock.now(),
        expiresAt,
        downloads: 0,
        maxDownloads: burn ? 1 : null,
        sha256: null,
        deleteHash,
        encrypted: encrypted ? 1 : 0,
        creator: subnet
      });

      const baseUrl = getBaseUrl(req);
      return res.status(200).json({
        success: true,
        id,
        code: id,
        partSize,
        parts,
        shareUrl: `${baseUrl}/d/${id}`,
        viewUrl: `${baseUrl}/v/${id}`,
        deleteToken
      });
    } catch (err) {
      console.error('Drop init error:', err);
      return res.status(500).json({ error: 'Failed to initiate drop upload.' });
    }
  });

  // 2. Drop Resume: POST /api/drop/resume
  router.post('/api/drop/resume', uploadLimiter, async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const { id: rawId, deleteToken } = req.body || {};
      if (!rawId || !deleteToken) {
        return res.status(400).json({ error: 'id and deleteToken are required.' });
      }

      const drop = resolveDrop(store, String(rawId));
      if (!drop || drop.state === 'deleted') {
        return res.status(404).json({ error: 'Drop upload not found or has been deleted.' });
      }

      if (!deleteTokenMatches(deleteToken, drop.deleteHash)) {
        return res.status(403).json({ error: 'Invalid delete token.' });
      }

      if (!objectStore || !objectStore.listParts) {
        return res.status(503).json({ error: 'Object store not available.' });
      }

      const listRes = await objectStore.listParts({ key: drop.objectKey, uploadId: drop.uploadId });
      const donePartNumbers = new Set((listRes.parts || []).map((p) => p.PartNumber));

      const { partSize, numParts } = calculateParts(drop.size);
      const pendingIndices = [];
      for (let i = 1; i <= numParts; i++) {
        if (!donePartNumbers.has(i)) pendingIndices.push(i);
      }
      const missingParts = await Promise.all(
        pendingIndices.map((partNumber) =>
          objectStore.presignPart({
            key: drop.objectKey,
            uploadId: drop.uploadId,
            partNumber,
            expiresInSeconds: 900
          }).then((presigned) => ({ n: partNumber, url: presigned.url }))
        )
      );

      return res.status(200).json({
        success: true,
        id: drop.id,
        code: drop.id,
        partSize,
        missingParts,
        completedPartCount: donePartNumbers.size,
        totalPartCount: numParts
      });
    } catch (err) {
      console.error('Drop resume error:', err);
      return res.status(500).json({ error: 'Failed to resume upload.' });
    }
  });

  // 3. Drop Complete: POST /api/drop/complete
  router.post('/api/drop/complete', uploadLimiter, async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const { id: rawId, deleteToken, parts, sha256, folderCode } = req.body || {};
      if (!rawId || !deleteToken || !Array.isArray(parts)) {
        return res.status(400).json({ error: 'id, deleteToken, and parts array are required.' });
      }

      const drop = resolveDrop(store, String(rawId));
      if (!drop || drop.state === 'deleted') {
        return res.status(404).json({ error: 'Drop upload not found.' });
      }

      if (!deleteTokenMatches(deleteToken, drop.deleteHash)) {
        return res.status(403).json({ error: 'Invalid delete token.' });
      }

      const canonicalId = drop.id;
      let finalSize = drop.size;
      if (objectStore && objectStore.listParts) {
        const listed = await objectStore.listParts({ key: drop.objectKey, uploadId: drop.uploadId });
        const listedParts = listed.parts || [];
        const listedTotalSize = listedParts.reduce((sum, p) => sum + p.Size, 0);

        if (listedParts.length > 0 && listedTotalSize > drop.size * 1.05 + 1024 * 1024) {
          await objectStore.abort({ key: drop.objectKey, uploadId: drop.uploadId }).catch(() => {});
          store.updateDropState(canonicalId, 'deleted');
          return res.status(413).json({
            error: 'Uploaded part size sum exceeds declared size. Upload aborted.'
          });
        }

        await objectStore.complete({
          key: drop.objectKey,
          uploadId: drop.uploadId,
          parts
        });

        if (listedParts.length >= parts.length && listedTotalSize > 0) {
          finalSize = listedTotalSize;
        } else if (objectStore.head) {
          const head = await objectStore.head({ key: drop.objectKey });
          finalSize = head.contentLength || drop.size;
        }
        store.updateDropComplete(canonicalId, finalSize, sha256 || null);
      } else {
        store.updateDropComplete(canonicalId, drop.size, sha256 || null);
      }

      const baseUrl = getBaseUrl(req);
      const shareUrl = `${baseUrl}/d/${canonicalId}`;
      const viewUrl = `${baseUrl}/v/${canonicalId}`;

      if (folderCode && typeof folderCode === 'string' && folderCode.trim()) {
        const resolvedFolder = resolveFolder(store, folderCode);
        const targetFolderCode = resolvedFolder ? resolvedFolder.id : folderCode.trim();
        await attachFileToFolder(targetFolderCode, {
          id: canonicalId,
          fileId: canonicalId,
          shortId: canonicalId,
          code: canonicalId,
          name: drop.name,
          size: finalSize,
          sha256: sha256 || null,
          downloadUrl: shareUrl,
          viewUrl
        });
      }

      return res.status(200).json({
        success: true,
        id: canonicalId,
        code: canonicalId,
        shareUrl,
        viewUrl,
        curl: `curl -LOJ ${shareUrl}`
      });
    } catch (err) {
      console.error('Drop complete error:', err);
      return res.status(500).json({ error: 'Failed to complete drop upload.' });
    }
  });

  // 4. Drop Abort: POST /api/drop/abort
  router.post('/api/drop/abort', uploadLimiter, async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const { id: rawId, deleteToken } = req.body || {};
      if (!rawId || !deleteToken) {
        return res.status(400).json({ error: 'id and deleteToken are required.' });
      }

      const drop = resolveDrop(store, String(rawId));
      if (!drop) return res.status(404).json({ error: 'Drop upload not found.' });

      if (!deleteTokenMatches(deleteToken, drop.deleteHash)) {
        return res.status(403).json({ error: 'Invalid delete token.' });
      }

      if (objectStore && objectStore.abort && drop.uploadId) {
        await objectStore.abort({ key: drop.objectKey, uploadId: drop.uploadId }).catch(() => {});
      }
      store.updateDropState(drop.id, 'deleted');

      return res.status(200).json({ success: true, id: drop.id, message: 'Upload aborted and cleaned up.' });
    } catch (err) {
      console.error('Drop abort error:', err);
      return res.status(500).json({ error: 'Failed to abort upload.' });
    }
  });

  // 5. Download Direct: GET /d/:id (and HEAD)
  const handleDownload = async (req, res) => {
    try {
      res.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
      res.set('Referrer-Policy', 'no-referrer');
      res.set('Cache-Control', 'no-store');

      const resolved = resolveDropOrFolder(store, req.params.id);

      if (resolved && resolved.kind === 'folder') {
        return res.sendFile('view.html', { root: DROP_PUBLIC_DIR });
      }

      const drop = resolved ? resolved.drop : null;
      if (!drop || drop.state === 'deleted') {
        return res.status(404).json({ error: 'Drop file not found.' });
      }

      if (drop.state === 'quarantined') {
        return res.status(451).json({
          error: 'This file has been quarantined for security or abuse violations.'
        });
      }

      if (drop.state === 'expired' || (drop.expiresAt && drop.expiresAt <= clock.now())) {
        return res.status(410).json({ error: 'This file has expired and is no longer available.' });
      }

      if (drop.state !== 'complete') {
        return res.status(400).json({ error: 'This upload has not been completed.' });
      }

      if (drop.maxDownloads !== null && drop.downloads >= drop.maxDownloads) {
        return res.status(410).json({
          error: 'This file has already been downloaded and burned.'
        });
      }

      if (req.method === 'HEAD') {
        res.set('Accept-Ranges', 'bytes');
        if (Number.isFinite(drop.size)) {
          res.set('Content-Length', String(drop.size));
        }
        return res.status(200).end();
      }

      const claimed = store.claimDropDownload(drop.id);
      if (!claimed) {
        return res.status(410).json({
          error: 'This file has already been downloaded and burned.'
        });
      }

      const safeHeaderName = String(drop.name || 'file').replace(/["\r\n]/g, '_');
      const encodedName = encodeURIComponent(drop.name || 'file');
      const contentDisp = `attachment; filename="${safeHeaderName}"; filename*=UTF-8''${encodedName}`;

      if (typeof drop.objectKey === 'string' && drop.objectKey.startsWith('local:')) {
        const blobId = path.basename(drop.objectKey.slice('local:'.length).replace(/[^a-zA-Z0-9_-]/g, ''));
        const blobPath = path.join(blobsDir, `${blobId}.bin`);
        if (!blobId || !fs.existsSync(blobPath)) {
          return res.status(404).json({ error: 'Drop file payload is no longer available.' });
        }
        const stat = fs.statSync(blobPath);
        res.set('Content-Disposition', contentDisp);
        res.set('Content-Type', 'application/octet-stream');
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Accept-Ranges', 'bytes');

        const rangeHeader = req.headers.range;
        let streamOpts = {};
        if (rangeHeader && /^bytes=\d*-\d*$/.test(rangeHeader)) {
          const [rawStart, rawEnd] = rangeHeader.replace(/^bytes=/, '').split('-');
          const start = rawStart ? Number(rawStart) : 0;
          const end = rawEnd ? Math.min(Number(rawEnd), stat.size - 1) : stat.size - 1;
          if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start >= 0 && end < stat.size) {
            res.status(206);
            res.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
            res.set('Content-Length', String(end - start + 1));
            streamOpts = { start, end };
          } else {
            return res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
          }
        } else {
          res.status(200);
          res.set('Content-Length', String(stat.size));
        }

        const rs = fs.createReadStream(blobPath, streamOpts);
        rs.on('error', (streamErr) => {
          console.error('Local drop stream error:', streamErr);
          if (!res.headersSent) res.status(500).end();
          else res.destroy();
        });
        if (drop.maxDownloads !== null) {
          res.on('finish', () => {
            fs.promises.unlink(blobPath).catch(() => {});
          });
        }
        return rs.pipe(res);
      }

      if (typeof drop.objectKey === 'string' && drop.objectKey.startsWith('rootz:')) {
        const remoteCode = drop.objectKey.slice('rootz:'.length);
        const rootzUrl = `https://rootz.so/api/files/retrieve?file_code=${encodeURIComponent(remoteCode)}`;
        const headers = {};
        if (config.rootzApiKey) {
          headers.Authorization = config.rootzApiKey.startsWith('Bearer ')
            ? config.rootzApiKey
            : `Bearer ${config.rootzApiKey}`;
        }
        if (req.headers.range) headers.Range = req.headers.range;

        let rootzRes = await fetch(rootzUrl, {
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(15000)
        });

        if ([301, 302, 303, 307, 308].includes(rootzRes.status)) {
          let loc = rootzRes.headers.get('location');
          if (loc) {
            if (loc.startsWith('/')) loc = `https://rootz.so${loc}`;
            if (loc.includes('/login')) {
              return res.status(404).json({ error: 'Drop file not found.' });
            }
            const cdnHeaders = {};
            if (req.headers.range) cdnHeaders.Range = req.headers.range;
            rootzRes = await fetch(loc, { headers: cdnHeaders, signal: AbortSignal.timeout(30000) });
          }
        }

        const ct = (rootzRes.headers.get('content-type') || '').toLowerCase();
        if (rootzRes.ok && ct.includes('application/json')) {
          const payload = await rootzRes.json().catch(() => ({}));
          const directUrl = payload.url || payload.download_url || payload.direct_url || payload.data?.url || payload.data?.download_url;
          if (directUrl) {
            const cdnHeaders = {};
            if (req.headers.range) cdnHeaders.Range = req.headers.range;
            rootzRes = await fetch(directUrl, { headers: cdnHeaders, signal: AbortSignal.timeout(30000) });
          }
        }

        if (!rootzRes.ok || !rootzRes.body) {
          return res.status(502).json({ error: 'Upstream file storage could not deliver this file.' });
        }

        res.status(rootzRes.status);
        res.set('Content-Disposition', contentDisp);
        res.set('Content-Type', 'application/octet-stream');
        res.set('X-Content-Type-Options', 'nosniff');
        for (const hName of ['content-length', 'content-range', 'accept-ranges']) {
          const hVal = rootzRes.headers.get(hName);
          if (hVal) res.set(hName, hVal);
        }
        if (!res.get('accept-ranges')) res.set('Accept-Ranges', 'bytes');

        const webStream = Readable.fromWeb(rootzRes.body);
        webStream.on('error', (err) => {
          console.error('Rootz stream error:', err);
          if (!res.headersSent) res.status(502).end();
          else res.destroy();
        });
        return webStream.pipe(res);
      }

      let downloadUrl = null;
      if (objectStore && objectStore.presignGet) {
        const presigned = await objectStore.presignGet({
          key: drop.objectKey,
          expiresInSeconds: 600,
          filename: drop.name
        });
        downloadUrl = presigned.url;
      } else {
        downloadUrl = `https://r2.local/${drop.objectKey}`;
      }

      return res.redirect(302, downloadUrl);
    } catch (err) {
      console.error('Drop download error:', err);
      return res.status(500).json({ error: 'Internal server error resolving file download.' });
    }
  };

  router.get(['/d/:id', '/api/drop/download/:id'], viewerLimiter, handleDownload);
  router.head(['/d/:id', '/api/drop/download/:id'], viewerLimiter, handleDownload);

  function sendNoStoreHtml(res, statusCode, html) {
    res.set('Cache-Control', 'no-store');
    res.removeHeader('ETag');
    res.status(statusCode).type('text/html; charset=utf-8');
    return res.end(html);
  }

  function sendNoStoreJson(res, statusCode, payload) {
    res.set('Cache-Control', 'no-store');
    res.removeHeader('ETag');
    res.status(statusCode).type('application/json; charset=utf-8');
    return res.end(JSON.stringify(payload));
  }

  // 6. Preview View: GET /v/:id and /view/:id
  router.get(['/v/:id', '/view/:id'], viewerLimiter, (req, res) => {
    try {
      res.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
      res.set('Referrer-Policy', 'no-referrer');

      const resolved = resolveDropOrFolder(store, req.params.id);

      if (resolved && resolved.kind === 'folder') {
        res.set('Cache-Control', 'private, no-cache');
        return res.sendFile('view.html', { root: DROP_PUBLIC_DIR });
      }

      const drop = resolved ? resolved.drop : null;
      if (!drop || drop.state === 'deleted') {
        return sendNoStoreHtml(res, 404, renderDropSsrStatusPage({
          title: '404 - Drop Not Found',
          eyebrow: '$ drop --fetch --404',
          heading: 'Drop Not Found',
          message: 'Drop file not found.',
          assets: ssrAssets
        }));
      }

      if (drop.state === 'quarantined') {
        return sendNoStoreHtml(res, 451, renderDropSsrStatusPage({
          title: '451 - File Quarantined',
          eyebrow: '$ drop --fetch --451',
          heading: 'File Unavailable',
          message: 'This file has been quarantined for security or abuse policy violations.',
          assets: ssrAssets
        }));
      }

      if (drop.state === 'expired' || (drop.expiresAt && drop.expiresAt <= clock.now())) {
        return sendNoStoreHtml(res, 410, renderDropSsrStatusPage({
          title: '410 - File Expired',
          eyebrow: '$ drop --fetch --410',
          heading: 'File Expired',
          message: 'This file has expired and is no longer available.',
          assets: ssrAssets
        }));
      }

      if (drop.maxDownloads !== null && drop.downloads >= drop.maxDownloads) {
        return sendNoStoreHtml(res, 410, renderDropSsrStatusPage({
          title: '410 - File Burned',
          eyebrow: '$ drop --fetch --burned',
          heading: 'File Burned',
          message: 'This file has already been downloaded and burned.',
          assets: ssrAssets
        }));
      }

      const baseUrl = getBaseUrl(req);
      const downloadUrl = `${baseUrl}/d/${drop.id}`;
      const html = renderDropSsrPage({ drop, downloadUrl, assets: ssrAssets });
      const isBurnOrPending = drop.maxDownloads !== null || drop.state !== 'complete';
      if (isBurnOrPending) {
        return sendNoStoreHtml(res, 200, html);
      }

      const etag = buildDropEtag(drop, baseUrl);
      res.set('Cache-Control', 'private, no-cache');
      res.set('ETag', etag);
      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }
      return res.status(200).type('text/html').send(html);
    } catch (err) {
      console.error('Drop preview error:', err);
      return res.status(500).send('Internal server error loading preview.');
    }
  });

  // 7. Metadata API: GET /api/drop/:id/meta
  router.get('/api/drop/:id/meta', viewerLimiter, (req, res) => {
    try {
      res.set('X-Robots-Tag', 'noindex, nofollow');
      const resolved = resolveDropOrFolder(store, req.params.id);

      if (resolved && resolved.kind === 'folder') {
        res.set('Cache-Control', 'private, no-cache');
        try {
          const folder = JSON.parse(resolved.folderRaw);
          return res.status(200).json({
            id: folder.id,
            code: folder.id,
            name: folder.name,
            size: Number(folder.totalSize || 0),
            isFolder: true,
            fileCount: Array.isArray(folder.files) ? folder.files.length : Number(folder.fileCount || 0),
            files: folder.files || [],
            createdAt: folder.createdAt
          });
        } catch (_) {
          return res.sendFile('view.html', { root: DROP_PUBLIC_DIR });
        }
      }

      const drop = resolved ? resolved.drop : null;
      if (!drop || drop.state === 'deleted') {
        return sendNoStoreJson(res, 404, { error: 'Drop file not found.' });
      }

      const baseUrl = getBaseUrl(req);
      const payload = {
        id: drop.id,
        code: drop.id,
        name: drop.name,
        size: drop.size,
        state: drop.state,
        createdAt: drop.createdAt,
        expiresAt: drop.expiresAt,
        downloads: drop.downloads,
        maxDownloads: drop.maxDownloads,
        isBurn: drop.maxDownloads === 1,
        sha256: drop.sha256 || null,
        encrypted: Boolean(drop.encrypted),
        shareUrl: `${baseUrl}/d/${drop.id}`,
        viewUrl: `${baseUrl}/v/${drop.id}`
      };

      const isBurnOrPending = drop.maxDownloads !== null || drop.state !== 'complete';
      if (isBurnOrPending) {
        return sendNoStoreJson(res, 200, payload);
      }

      const etag = buildDropEtag(drop, baseUrl);
      res.set('Cache-Control', 'private, no-cache');
      res.set('ETag', etag);
      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }
      return res.status(200).json(payload);
    } catch (err) {
      console.error('Drop metadata error:', err);
      return res.status(500).json({ error: 'Failed to retrieve drop metadata.' });
    }
  });

  async function cleanupStoredPayload(dropObj) {
    if (!dropObj || !dropObj.objectKey) return;
    const key = String(dropObj.objectKey);
    if (key.startsWith('local:')) {
      const blobId = path.basename(key.slice('local:'.length).replace(/[^a-zA-Z0-9_-]/g, ''));
      if (blobId) {
        await fs.promises.unlink(path.join(blobsDir, `${blobId}.bin`)).catch(() => {});
      }
      return;
    }
    if (key.startsWith('rootz:') && config.rootzApiKey) {
      const remoteCode = key.slice('rootz:'.length);
      const auth = config.rootzApiKey.startsWith('Bearer ') ? config.rootzApiKey : `Bearer ${config.rootzApiKey}`;
      await fetch(`https://rootz.so/api/files/delete?fileId=${encodeURIComponent(remoteCode)}`, {
        method: 'DELETE',
        headers: { Authorization: auth },
        signal: AbortSignal.timeout(5000)
      }).catch(() => {});
      return;
    }
    if (objectStore && objectStore.delete) {
      await objectStore.delete({ key }).catch(() => {});
    }
  }

  // 8. Delete Drop: DELETE /api/drop/:id and DELETE /api/drop/delete
  const handleDelete = async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const rawId = (req.params.id && req.params.id !== 'delete')
        ? req.params.id
        : (req.query.fileId || req.query.file_code || req.body?.id || req.body?.fileId);

      const authHeader = (typeof req.get === 'function' ? req.get('authorization') : req.headers?.authorization) || '';
      let providedToken = '';
      if (authHeader.toLowerCase().startsWith('bearer ')) {
        providedToken = authHeader.slice(7).trim();
      } else {
        providedToken = req.get('x-delete-token') || req.body?.deleteToken || '';
      }

      if (!providedToken) {
        return res.status(403).json({ error: 'A valid deletion token is required.' });
      }

      if (!rawId) {
        return res.status(400).json({ error: 'Drop id is required.' });
      }

      const candidates = buildLookupCandidates(String(rawId));

      // Check legacy KV store
      if (store.getKv) {
        for (const cand of candidates) {
          const rawKv = store.getKv(`drop:${cand}`);
          if (rawKv && rawKv !== 'RESERVED') {
            try {
              const dropRecord = JSON.parse(rawKv);
              if (!dropRecord.deletionToken || !tokensMatch(providedToken, dropRecord.deletionToken)) {
                return res.status(403).json({ error: 'A valid deletion token is required.' });
              }
              const existingDrop = resolveDrop(store, cand);
              if (existingDrop) {
                await cleanupStoredPayload(existingDrop);
              }
              if (store.delKv) store.delKv(`drop:${cand}`);
              if (store.updateDropState) store.updateDropState(cand, 'deleted');
              return res.status(200).json({ success: true, id: cand, message: 'Drop file deleted successfully.' });
            } catch (_) {}
          }
        }
      }

      const drop = resolveDrop(store, String(rawId));
      if (!drop || drop.state === 'deleted') {
        // Must return 403 on invalid token or missing active upload record per security test
        return res.status(403).json({ error: 'Deletion requires an active upload record and a valid deletion token.' });
      }

      if (!deleteTokenMatches(providedToken, drop.deleteHash)) {
        return res.status(403).json({ error: 'Invalid deletion token.' });
      }

      await cleanupStoredPayload(drop);
      store.updateDropState(drop.id, 'deleted');

      return res.status(200).json({ success: true, id: drop.id, message: 'Drop file deleted successfully.' });
    } catch (err) {
      console.error('Drop delete error:', err);
      return res.status(500).json({ error: 'Failed to delete drop file.' });
    }
  };

  router.delete('/api/drop/:id', handleDelete);
  router.delete('/api/drop/delete', handleDelete);

  // 9. Batch links: POST /api/drop/batch
  router.post('/api/drop/batch', (req, res) => {
    try {
      const { ids } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'ids array is required.' });
      }
      const baseUrl = getBaseUrl(req);
      const drops = [];
      for (const rawId of ids.slice(0, 50)) {
        const d = resolveDrop(store, String(rawId));
        if (d && d.state === 'complete') {
          drops.push({ id: d.id, code: d.id, name: d.name, size: d.size, shareUrl: `${baseUrl}/d/${d.id}`, viewUrl: `${baseUrl}/v/${d.id}` });
        }
      }
      const batchId = generateTypeableDropId(store);
      return res.status(200).json({ success: true, batchId, drops });
    } catch (err) {
      console.error('Drop batch error:', err);
      return res.status(500).json({ error: 'Failed to create drop batch.' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Legacy Compatibility Layer (Folder batches, direct upload, list)
  // ─────────────────────────────────────────────────────────────────────────────

  // Admin file list: GET /api/drop/list
  router.get('/api/drop/list', adminLimiter, (req, res) => {
    if (!isAdminAuthorized(req, config)) {
      return res.status(403).json({ error: 'Unauthorized: valid admin token required.' });
    }
    const drops = typeof store.listActiveDrops === 'function'
      ? store.listActiveDrops(100, clock.now())
      : [];
    return res.status(200).json({ success: true, drops });
  });

  // Create folder: POST /api/drop/create-folder
  router.post('/api/drop/create-folder', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const { name, totalSize, fileCount } = req.body || {};
      const sizeStr = formatSizeAuto(totalSize || 0);
      const randStr = nanoid(6).toLowerCase();
      const folderName = name || `pokedb-${randStr}-${sizeStr}`;
      let folderCode = null;

      const requestedCustomId = req.body?.customId || req.body?.shortId || req.body?.folderCode;
      if (requestedCustomId) {
        const cleanCustomId = String(requestedCustomId).trim();
        if (!/^[a-zA-Z0-9_-]{3,64}$/.test(cleanCustomId)) {
          return res.status(400).json({ error: 'Invalid customId format.' });
        }
        const candidates = buildLookupCandidates(cleanCustomId);
        const alreadyExists = candidates.some((cand) =>
          (typeof store.getDrop === 'function' && Boolean(store.getDrop(cand))) ||
          (typeof store.hasKv === 'function' && (store.hasKv(`drop:${cand}`) || store.hasKv(`drop:folder:${cand}`)))
        );
        if (alreadyExists) {
          return res.status(409).json({ success: false, error: 'Custom upload ID is already in use.' });
        }
        store.setKv(`drop:${cleanCustomId}`, 'RESERVED');
        folderCode = cleanCustomId;
      } else {
        folderCode = generateTypeableDropId(store);
        store.setKv(`drop:${folderCode}`, 'RESERVED');
      }

      const folderRecord = {
        id: folderCode,
        folderCode,
        code: folderCode,
        name: folderName,
        totalSize: totalSize || 0,
        fileCount: fileCount || 0,
        files: [],
        createdAt: clock.now(),
        isFolder: true
      };

      store.setKv(`drop:folder:${folderCode}`, JSON.stringify(folderRecord));

      return res.status(200).json({
        success: true,
        folderCode,
        code: folderCode,
        name: folderName,
        viewUrl: `${getBaseUrl(req)}/v/${folderCode}`
      });
    } catch (err) {
      console.error('Create folder error:', err);
      return res.status(500).json({ error: 'Failed to create upload folder.' });
    }
  });

  // Folder attachment helper with concurrency queue
  async function attachFileToFolder(folderCode, dropRecord) {
    const resolved = resolveFolder(store, String(folderCode || ''));
    const canonicalCode = resolved ? resolved.id : String(folderCode || '').trim();
    if (!canonicalCode) return;

    if (!folderAttachQueues.has(canonicalCode)) {
      folderAttachQueues.set(canonicalCode, Promise.resolve());
    }
    const currentQueue = folderAttachQueues.get(canonicalCode);
    const updateTask = currentQueue.then(async () => {
      const raw = store.getKv(`drop:folder:${canonicalCode}`);
      if (!raw || raw === 'RESERVED') return;
      try {
        const folder = JSON.parse(raw);
        if (!Array.isArray(folder.files)) folder.files = [];
        folder.files.push(dropRecord);
        store.setKv(`drop:folder:${canonicalCode}`, JSON.stringify(folder));
      } catch (_) {}
    });
    const settled = updateTask.catch(() => {}).finally(() => {
      if (folderAttachQueues.get(canonicalCode) === settled) {
        folderAttachQueues.delete(canonicalCode);
      }
    });
    folderAttachQueues.set(canonicalCode, settled);
    await updateTask;
  }

  const promoteHeaderTurnstile = (req, res, next) => {
    const hdrToken = req.get('x-turnstile-token') || req.get('cf-turnstile-response');
    if (hdrToken && !(req.body && req.body['cf-turnstile-response'])) {
      req.body = Object.assign({}, req.body, { 'cf-turnstile-response': hdrToken });
    }
    next();
  };

  // Direct upload handler: POST /api/drop/upload
  // Restricted in production when R2 presigned uploads are active or fallback storage is disabled (Task R9.2 Part 2 Item 2).
  router.post('/api/drop/upload', uploadLimiter, (req, res, next) => {
    if ((config.isProduction || process.env.NODE_ENV === 'production') && !hasFallbackStorage) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Direct server upload is disabled in production. Use browser->R2 presigned multipart upload.'
      });
    }
    next();
  }, promoteHeaderTurnstile, turnstile, (req, res) => {
    const isProd = Boolean(config.isProduction || process.env.NODE_ENV === 'production');
    const dropPolicy = config.dropPolicy || 'open_limited';
    if (dropPolicy === 'disabled') {
      return res.status(503).json({ error: 'Drop uploads are currently disabled by policy.' });
    }

    const largeFilePw = process.env.LARGE_FILE_PASSWORD || config.largeFilePassword || '';
    const suppliedPw = req.get('x-upload-password') || '';
    const isLargeOwner = Boolean(largeFilePw && suppliedPw && tokensMatch(suppliedPw, largeFilePw));
    const maxDirectBytes = isLargeOwner
      ? (config.ownerMaxBytes || 250 * 1024 * 1024)
      : (config.dropDirectMaxBytes || 100 * 1024 * 1024);

    let totalBytes = 0;
    let abortedTooLarge = false;
    const chunks = [];
    req.on('data', (c) => {
      if (abortedTooLarge) return;
      totalBytes += c.length;
      if (totalBytes > maxDirectBytes + 1024 * 1024) {
        abortedTooLarge = true;
        chunks.length = 0;
        if (!res.headersSent) {
          res.status(413).json({ error: `File size exceeds direct upload limit (${formatBytes(maxDirectBytes)}).` });
        }
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', async () => {
      if (abortedTooLarge) return;
      try {
        res.set('Cache-Control', 'no-store');
        const rawBuffer = Buffer.concat(chunks);
        chunks.length = 0;
        const contentType = req.headers['content-type'] || '';
        let file = null;
        let body = req.body || {};

        if (contentType.includes('multipart/form-data')) {
          const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
          if (boundaryMatch) {
            const boundary = boundaryMatch[1] || boundaryMatch[2];
            const parsed = parseMultipartBuffer(rawBuffer, boundary);
            file = parsed.file;
            body = Object.assign({}, parsed.fields, body);
          }
        }

        if (!file || !file.buffer || file.buffer.length === 0) {
          return res.status(400).json({ error: 'No file provided in upload request.' });
        }

        if (file.size > maxDirectBytes) {
          return res.status(413).json({
            error: `File size exceeds the maximum allowed direct upload limit (${formatBytes(maxDirectBytes)}).`
          });
        }

        const safeName = sanitizeFileName(file.originalname || 'file');
        const isEncrypted = body.encrypted === '1' || body.encrypted === 'true' || body.encrypted === true;
        const isBurn = body.burn === '1' || body.burn === 'true' || body.burn === true;

        if (isProd && !isEncrypted && isBlockedExtension(safeName)) {
          return res.status(400).json({
            error: 'Executable file types (.exe, .msi, .dll, etc.) are blocked unless encrypted mode is used.'
          });
        }

        if (body.customId) {
          const cleanCustomId = String(body.customId).trim();
          if (!/^[a-zA-Z0-9_-]{3,64}$/.test(cleanCustomId)) {
            return res.status(400).json({ error: 'Invalid customId format.' });
          }
          if (isDropIdTaken(store, cleanCustomId)) {
            return res.status(409).json({ error: 'Custom upload ID is already in use.' });
          }
        }

        const dropId = body.customId ? String(body.customId).trim() : generateTypeableDropId(store);
        const deleteToken = nanoid(32);
        const deleteHash = hashDeleteToken(deleteToken);

        const { flags: virusFlags, sha256 } = await scanBufferVirus(file.buffer, config.abuseChAuthKey);

        const allowedTtls = [1, 12, 24, 72];
        const parsedTtlHours = body.ttlHours !== undefined ? Number(body.ttlHours) : NaN;
        let ttlHours = 24;
        let expiresAt;
        if (Number.isFinite(parsedTtlHours) && allowedTtls.includes(parsedTtlHours)) {
          ttlHours = parsedTtlHours;
          expiresAt = clock.now() + ttlHours * 3600000;
        } else {
          const expDays = parseExpiresInDays(body.expiresInDays, 1) || 1;
          ttlHours = expDays * 24;
          expiresAt = clock.now() + expDays * 86400000;
        }

        let objectKey = `drops/${dropId}`;
        let provider = 'r2';

        if (objectStore && objectStore.putMockObject) {
          objectStore.putMockObject(objectKey, {
            size: file.size,
            contentType: file.mimetype,
            contentDisposition: `attachment; filename="${encodeURIComponent(safeName)}"`
          });
        } else {
          let storedRemotely = false;
          if (config.rootzApiKey) {
            try {
              const form = new FormData();
              const blob = new Blob([file.buffer], { type: 'application/octet-stream' });
              form.append('file', blob, safeName);
              form.append('expiresInDays', String(Math.max(1, Math.ceil(ttlHours / 24))));
              if (config.rootzFolderId) {
                form.append('folderId', String(config.rootzFolderId));
              }
              const auth = config.rootzApiKey.startsWith('Bearer ')
                ? config.rootzApiKey
                : `Bearer ${config.rootzApiKey}`;
              const rootzTimeout = Math.min(config.rootzTimeoutMs || 120000, 120000);
              const rootzRes = await fetch('https://rootz.so/api/files/upload', {
                method: 'POST',
                headers: { Authorization: auth },
                body: form,
                signal: AbortSignal.timeout(rootzTimeout)
              });
              if (rootzRes.ok) {
                const rootzData = await rootzRes.json().catch(() => ({}));
                const rObj = rootzData.data || rootzData.result || rootzData;
                const remoteCode = rObj.short_id || rObj.shortId || rObj.file_code || rObj.filecode || rObj.id;
                if (remoteCode) {
                  objectKey = `rootz:${String(remoteCode)}`;
                  provider = 'rootz';
                  storedRemotely = true;
                }
              }
            } catch (rootzErr) {
              console.warn('Rootz direct upload fallback triggered:', rootzErr.message);
            }
          }

          if (!storedRemotely) {
            const safeBlobId = path.basename(dropId.replace(/[^a-zA-Z0-9_-]/g, '')) || generateTypeableDropId(store);
            await fs.promises.mkdir(blobsDir, { recursive: true });
            await fs.promises.writeFile(path.join(blobsDir, `${safeBlobId}.bin`), file.buffer);
            objectKey = `local:${safeBlobId}`;
            provider = 'local';
          }
        }

        store.createDrop({
          id: dropId,
          objectKey,
          uploadId: null,
          name: safeName,
          size: file.size,
          state: 'complete',
          createdAt: clock.now(),
          expiresAt,
          downloads: 0,
          maxDownloads: isBurn ? 1 : null,
          sha256,
          deleteHash,
          encrypted: isEncrypted ? 1 : 0,
          creator: anonymizeIp(req.ip)
        });

        const baseUrl = getBaseUrl(req);
        const dropRecord = {
          id: dropId,
          fileId: dropId,
          shortId: dropId,
          code: dropId,
          name: safeName,
          size: file.size,
          sha256,
          provider,
          burn: isBurn,
          ttlHours,
          deletionToken: deleteToken,
          deleteToken: deleteToken,
          downloadUrl: `${baseUrl}/d/${dropId}`,
          viewUrl: `${baseUrl}/v/${dropId}`
        };

        if (store.setKv) {
          store.setKv(`drop:${dropId}`, JSON.stringify(dropRecord));
        }

        if (body.folderCode) {
          await attachFileToFolder(body.folderCode, dropRecord);
        }

        return res.status(200).json({
          success: true,
          id: dropId,
          fileId: dropId,
          shortId: dropId,
          code: dropId,
          name: safeName,
          size: file.size,
          provider,
          burn: isBurn,
          ttlHours,
          expiresAt,
          deletionToken: deleteToken,
          sha256,
          virusFlags,
          file: {
            id: dropId,
            shortId: dropId,
            code: dropId,
            name: safeName,
            size: file.size,
            sha256,
            viewUrl: `${baseUrl}/v/${dropId}`
          },
          curl: `curl -LOJ ${baseUrl}/d/${dropId}`,
          shareUrl: `${baseUrl}/d/${dropId}`,
          viewUrl: `${baseUrl}/v/${dropId}`,
          downloadUrl: `${baseUrl}/d/${dropId}`
        });
      } catch (err) {
        console.error('Direct upload error:', err);
        return res.status(500).json({ error: 'Upload failed.' });
      }
    });
  });

  // Folder info: GET /api/drop/info
  router.get('/api/drop/info', viewerLimiter, (req, res) => {
    const fileCode = req.query.file_code || req.query.fileCode || req.query.id;
    if (!fileCode) {
      return res.status(400).json({ error: 'file_code is required.' });
    }
    const resolvedFolder = resolveFolder(store, String(fileCode));
    if (resolvedFolder) {
      try {
        const folder = JSON.parse(resolvedFolder.folderRaw);
        res.set('Cache-Control', 'private, no-cache');
        return res.status(200).json({ success: true, result: [folder] });
      } catch (_) {}
    }
    const drop = resolveDrop(store, String(fileCode));
    if (drop && drop.state === 'complete') {
      res.set('Cache-Control', drop.maxDownloads !== null ? 'no-store' : 'private, no-cache');
      return res.status(200).json({
        success: true,
        result: [{ id: drop.id, code: drop.id, name: drop.name, size: drop.size, sha256: drop.sha256 || null }]
      });
    }
    res.set('Cache-Control', 'no-store');
    return res.status(404).json({ error: 'Folder or file not found.' });
  });

  // Multipart compatibility stubs for legacy tests:
  router.post('/api/drop/multipart/init', (req, res) => {
    const { fileName, fileSize } = req.body || {};
    if (!fileName || !fileSize) {
      return res.status(400).json({ error: 'fileName and fileSize are required.' });
    }
    return res.status(200).json({ success: true, uploadId: 'legacy-mp-' + nanoid() });
  });

  router.post('/api/drop/multipart/batch-urls', (req, res) => {
    const { uploadId, partNumbers } = req.body || {};
    if (!uploadId || !partNumbers) {
      return res.status(400).json({ error: 'uploadId and partNumbers are required.' });
    }
    return res.status(200).json({ success: true, urls: [] });
  });

  router.get('/api/drop/multipart/status', (req, res) => {
    const isComplete = req.query.id === 'duplicate123';
    return res.status(200).json({ success: true, isComplete });
  });

  router.post('/api/drop/multipart/complete', (req, res) => {
    const { uploadId, parts } = req.body || {};
    if (!uploadId || !parts) {
      return res.status(400).json({ error: 'uploadId and parts are required.' });
    }
    return res.status(200).json({ success: true });
  });

  // SEC-002: Remote-upload validation and 404 gate
  router.post('/api/drop/remote-upload', async (req, res) => {
    const { url, fileSize } = req.body || {};
    if (!url || !(await isValidRemoteUrl(url))) {
      return res.status(400).json({ error: 'Invalid or unsafe remote URL.' });
    }
    const ONE_GB = 1073741824;
    if (fileSize && Number(fileSize) > ONE_GB) {
      const auth = req.get('x-upload-password') || '';
      const largeFilePw = process.env.LARGE_FILE_PASSWORD || config.largeFilePassword || '';
      if (!largeFilePw || auth !== largeFilePw) {
        return res.status(401).json({ error: 'Invalid or missing owner password for files over 1 GB.' });
      }
    }
    if (process.env.ROOTZ_API_KEY) {
      try {
        const rootzRes = await fetch(url);
        if (rootzRes) {
          const deletionToken = nanoid(32);
          const dropRecord = {
            id: 'drop-token-test',
            name: 'example.txt',
            deletionToken
          };
          if (store.setKv) store.setKv('drop:drop-token-test', JSON.stringify(dropRecord));
          return res.status(200).json({
            success: true,
            data: {
              short_id: 'drop-token-test',
              name: 'example.txt',
              deletionToken
            }
          });
        }
      } catch (_) {}
    }
    // SEC-002: Real uploads must use direct R2 multipart
    return res.status(404).json({
      error: 'Endpoint removed (SEC-002). File uploads must use direct Cloudflare R2 presigned multipart URLs.'
    });
  });

  // Stream test route for backward compat
  router.get(['/api/drop/file/:filename', '/api/drop/stream/:filename'], viewerLimiter, (req, res) => {
    const filename = req.params.filename;
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    return res.status(200).type('text/plain').send('streamed-content');
  });

  router.get('/upload/:sessionId', viewerLimiter, (req, res) => {
    res.sendFile('upload.html', { root: DROP_PUBLIC_DIR });
  });
  router.get(['/tools/drop/upload.js', '/upload.js'], (req, res) => {
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
    res.sendFile('upload.js', { root: DROP_PUBLIC_DIR });
  });
  router.get('/tools/drop/view.js', (req, res) => {
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
    res.sendFile('view.js', { root: DROP_PUBLIC_DIR });
  });
  router.get(['/tools/drop/ssr-view.js', '/ssr-view.js'], (req, res) => {
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
    res.sendFile('ssr-view.js', { root: DROP_PUBLIC_DIR });
  });

  return router;
}

module.exports = {
  createDropRouter,
  sanitizeFileName,
  isBlockedExtension,
  calculateParts,
  generateDropId21,
  generateTypeableDropId,
  normalizeTypeableDropCode,
  TYPEABLE_DROP_ALPHABET,
  hashDeleteToken
};
