// tools/lan/public/lan.js
// Client-side LAN-to-LAN WebRTC P2P + E2EE (ECDH P-256 + HKDF-SHA-256 + SAS + AES-256-GCM) engine.
// Exports window.PokedbLan in browsers and CommonJS module in Node.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(globalThis);
  } else {
    root.PokedbLan = factory(root);
  }
})(typeof self !== 'undefined' ? self : this, function (globalScope) {
  'use strict';

  var ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  var ROOM_CODE_REGEX = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

  var FRAME_VERSION = 1;
  var FRAME_TYPE_CTRL = 1;
  var FRAME_TYPE_CHUNK = 2;
  var FLAG_FINAL = 1;
  var HEADER_BYTES = 11;
  var IV_BYTES = 12;
  var GCM_TAG_BYTES = 16;

  var CHUNK_SIZE = 64 * 1024;
  var HASH_SLICE_SIZE = 2 * 1024 * 1024;
  var SUBTLE_HASH_THRESHOLD = 32 * 1024 * 1024;
  var BUFFERED_LOW_THRESHOLD = 512 * 1024;
  var BUFFERED_HIGH_WATER = 2 * 1024 * 1024;
  var MAX_FILES_PER_TRANSFER = 500;
  var MAX_CTRL_PLAINTEXT_BYTES = 64 * 1024;
  var MAX_CHUNK_FRAME_BYTES = 256 * 1024;

  var textEncoder = new TextEncoder();
  var textDecoder = new TextDecoder('utf-8');

  var SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function IncrementalSha256() {
    this._h = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]);
    this._block = new Uint8Array(64);
    this._blockLen = 0;
    this._totalBytes = 0;
    this._w = new Uint32Array(64);
  }

  IncrementalSha256.prototype._compress = function (block, offset) {
    var w = this._w;
    var i;
    for (i = 0; i < 16; i++) {
      var j = offset + i * 4;
      w[i] = ((block[j] << 24) | (block[j + 1] << 16) | (block[j + 2] << 8) | block[j + 3]) >>> 0;
    }
    for (i = 16; i < 64; i++) {
      var s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      var s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    var h = this._h;
    var a = h[0], b = h[1], c = h[2], d = h[3];
    var e = h[4], f = h[5], g = h[6], hh = h[7];

    for (i = 0; i < 64; i++) {
      var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      var ch = (e & f) ^ ((~e) & g);
      var temp1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = (S0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  };

  IncrementalSha256.prototype.update = function (input) {
    var bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    var offset = 0;
    var len = bytes.length;
    this._totalBytes += len;

    if (this._blockLen > 0) {
      var needed = 64 - this._blockLen;
      if (len < needed) {
        this._block.set(bytes, this._blockLen);
        this._blockLen += len;
        return this;
      }
      this._block.set(bytes.subarray(0, needed), this._blockLen);
      this._compress(this._block, 0);
      this._blockLen = 0;
      offset = needed;
    }

    while (offset + 64 <= len) {
      this._compress(bytes, offset);
      offset += 64;
    }

    if (offset < len) {
      var rem = len - offset;
      this._block.set(bytes.subarray(offset), 0);
      this._blockLen = rem;
    }
    return this;
  };

  IncrementalSha256.prototype.digestBytes = function () {
    if (this._cachedDigest) return this._cachedDigest;
    var block = new Uint8Array(this._block);
    var pos = this._blockLen;
    block[pos++] = 0x80;
    if (pos > 56) {
      block.fill(0, pos, 64);
      this._compress(block, 0);
      pos = 0;
    }
    block.fill(0, pos, 56);
    var high = Math.floor(this._totalBytes / 0x20000000);
    var low = (this._totalBytes << 3) >>> 0;
    var dv = new DataView(block.buffer);
    dv.setUint32(56, high >>> 0, false);
    dv.setUint32(60, low, false);
    this._compress(block, 0);

    var out = new Uint8Array(32);
    var outView = new DataView(out.buffer);
    for (var i = 0; i < 8; i++) {
      outView.setUint32(i * 4, this._h[i], false);
    }
    this._cachedDigest = out;
    return out;
  };

  IncrementalSha256.prototype.digestHex = function () {
    return bytesToHex(this.digestBytes());
  };

  function bytesToHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      out += bytes[i].toString(16).padStart(2, '0');
    }
    return out;
  }

  function getCrypto() {
    var c = globalScope.crypto;
    if (!c || !c.subtle) {
      throw new Error('WebCrypto API (crypto.subtle) is required for LAN E2EE transfer.');
    }
    return c;
  }

  function normalizeCode(raw) {
    if (typeof raw !== 'string') return '';
    return raw.trim().replace(/[\s-]+/g, '').toUpperCase();
  }

  function isValidCode(raw) {
    return ROOM_CODE_REGEX.test(normalizeCode(raw));
  }

  function formatSas(sas) {
    var str = String(sas || '').replace(/\D+/g, '');
    if (str.length === 6) {
      return str.slice(0, 3) + ' ' + str.slice(3);
    }
    return str;
  }

  function sanitizeFilename(rawName) {
    if (typeof rawName !== 'string' || !rawName) return 'download.bin';
    var name = rawName.normalize ? rawName.normalize('NFC') : rawName;
    name = name.replace(/[\x00-\x1F\x7F/\\?%*:|"<>]/g, '_').replace(/^\.+/, '').trim();
    if (!name) return 'download.bin';
    var encoded = textEncoder.encode(name);
    if (encoded.length > 180) {
      name = textDecoder.decode(encoded.subarray(0, 180)).replace(/\uFFFD$/, '');
    }
    return name || 'download.bin';
  }

  function isSupported() {
    var hasRtc = typeof globalScope.RTCPeerConnection === 'function';
    var hasCrypto = Boolean(globalScope.crypto && globalScope.crypto.subtle);
    var hasFetch = typeof globalScope.fetch === 'function';
    if (!hasRtc) {
      return { supported: false, reason: 'WebRTC RTCPeerConnection is unavailable in this browser.' };
    }
    if (!hasCrypto) {
      return { supported: false, reason: 'WebCrypto requires a secure context (HTTPS or localhost).' };
    }
    if (!hasFetch) {
      return { supported: false, reason: 'Fetch API is unavailable in this browser.' };
    }
    return { supported: true };
  }

  function bufToBase64Url(buf) {
    var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var chunks = [];
    for (var i = 0; i < bytes.length; i += 0x8000) {
      chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
    }
    return btoa(chunks.join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlToBuf(str) {
    if (typeof str !== 'string' || !str) {
      throw new Error('Invalid base64url string.');
    }
    var base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) base64 += '=';
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function concatBytes() {
    var total = 0;
    var i;
    for (i = 0; i < arguments.length; i++) {
      total += arguments[i].length;
    }
    var out = new Uint8Array(total);
    var offset = 0;
    for (i = 0; i < arguments.length; i++) {
      out.set(arguments[i], offset);
      offset += arguments[i].length;
    }
    return out;
  }

  function compareBytes(a, b) {
    var len = Math.min(a.length, b.length);
    for (var i = 0; i < len; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    if (a.length < b.length) return -1;
    if (a.length > b.length) return 1;
    return 0;
  }

  async function computeFileSha256(file, onHashProgress) {
    var cryptoObj = getCrypto();
    var size = Number(file.size || 0);
    if (size <= SUBTLE_HASH_THRESHOLD && typeof file.arrayBuffer === 'function') {
      var buf = await file.arrayBuffer();
      var digest = await cryptoObj.subtle.digest('SHA-256', buf);
      return bytesToHex(new Uint8Array(digest));
    }

    var hasher = new IncrementalSha256();
    var offset = 0;
    while (offset < size) {
      var end = Math.min(offset + HASH_SLICE_SIZE, size);
      var slice = file.slice(offset, end);
      var sliceBuf = await slice.arrayBuffer();
      hasher.update(new Uint8Array(sliceBuf));
      offset = end;
      if (typeof onHashProgress === 'function') {
        onHashProgress({ hashedBytes: offset, totalBytes: size });
      }
    }
    return hasher.digestHex();
  }

  async function generateEcdhKeyPair() {
    var cryptoObj = getCrypto();
    var keyPair = await cryptoObj.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits']
    );
    var rawBuf = await cryptoObj.subtle.exportKey('raw', keyPair.publicKey);
    var publicKeyRaw = new Uint8Array(rawBuf);
    return {
      keyPair: keyPair,
      publicKeyRaw: publicKeyRaw,
      publicKeyBase64Url: bufToBase64Url(publicKeyRaw)
    };
  }

  async function importPeerEcdhPublicKey(peerPubInput) {
    var cryptoObj = getCrypto();
    var raw = typeof peerPubInput === 'string'
      ? base64UrlToBuf(peerPubInput)
      : (peerPubInput instanceof Uint8Array ? peerPubInput : new Uint8Array(peerPubInput));

    if (raw.length !== 65 || raw[0] !== 0x04) {
      throw new Error('Invalid peer ECDH P-256 public key format.');
    }

    var publicKey = await cryptoObj.subtle.importKey(
      'raw',
      raw,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );
    return { publicKey: publicKey, publicKeyRaw: raw };
  }

  async function deriveSessionCrypto(params) {
    var cryptoObj = getCrypto();
    var subtle = cryptoObj.subtle;
    var role = params.role;
    if (role !== 'sender' && role !== 'receiver') {
      throw new Error('Role must be sender or receiver.');
    }

    var sharedBits = await subtle.deriveBits(
      { name: 'ECDH', public: params.peerPublicKey },
      params.myPrivateKey,
      256
    );

    var hkdfKey = await subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey', 'deriveBits']);

    var cmp = compareBytes(params.myPublicKeyRaw, params.peerPublicKeyRaw);
    var firstPub = cmp <= 0 ? params.myPublicKeyRaw : params.peerPublicKeyRaw;
    var secondPub = cmp <= 0 ? params.peerPublicKeyRaw : params.myPublicKeyRaw;
    var roomCodeBytes = textEncoder.encode(normalizeCode(params.roomCode));

    var transcript = concatBytes(
      textEncoder.encode('pokedb-lan-v1'),
      roomCodeBytes,
      firstPub,
      secondPub
    );
    var salt = new Uint8Array(await subtle.digest('SHA-256', transcript));

    var sasBits = await subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: salt,
        info: textEncoder.encode('pokedb-lan-sas-v1')
      },
      hkdfKey,
      32
    );
    var sasInt = new DataView(sasBits).getUint32(0, false) % 1000000;
    var sas = String(sasInt).padStart(6, '0');

    var s2rKey = await subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: salt,
        info: textEncoder.encode('pokedb-lan-s2r-v1')
      },
      hkdfKey,
      { name: 'AES-GCM', length: 256 },
      false,
      role === 'sender' ? ['encrypt'] : ['decrypt']
    );

    var r2sKey = await subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: salt,
        info: textEncoder.encode('pokedb-lan-r2s-v1')
      },
      hkdfKey,
      { name: 'AES-GCM', length: 256 },
      false,
      role === 'receiver' ? ['encrypt'] : ['decrypt']
    );

    var sendKey = role === 'sender' ? s2rKey : r2sKey;
    var recvKey = role === 'sender' ? r2sKey : s2rKey;

    var sendIvPrefix = new Uint8Array(4);
    cryptoObj.getRandomValues(sendIvPrefix);
    var sendCounter = 0n;
    var expectedRecvCounter = 0n;
    var expectedPeerIvPrefix = null;
    var encryptChain = Promise.resolve();
    var decryptChain = Promise.resolve();

    function encryptFrame(opts) {
      var run = encryptChain.then(async function () {
        var frameType = opts.frameType;
        var transferId = opts.transferId >>> 0;
        var chunkIndex = opts.chunkIndex >>> 0;
        var isFinal = Boolean(opts.isFinal);
        var plainBytes = opts.plaintextBytes instanceof Uint8Array
          ? opts.plaintextBytes
          : new Uint8Array(opts.plaintextBytes);

        var header = new Uint8Array(HEADER_BYTES);
        var hView = new DataView(header.buffer);
        header[0] = FRAME_VERSION;
        header[1] = frameType & 0xff;
        hView.setUint32(2, transferId, false);
        hView.setUint32(6, chunkIndex, false);
        header[10] = isFinal ? FLAG_FINAL : 0;

        var iv = new Uint8Array(IV_BYTES);
        iv.set(sendIvPrefix, 0);
        var ivView = new DataView(iv.buffer);
        var counter = sendCounter;
        sendCounter += 1n;
        ivView.setBigUint64(4, counter, false);

        var cipherBuf = await subtle.encrypt(
          { name: 'AES-GCM', iv: iv, additionalData: header },
          sendKey,
          plainBytes
        );

        var frame = new Uint8Array(HEADER_BYTES + IV_BYTES + cipherBuf.byteLength);
        frame.set(header, 0);
        frame.set(iv, HEADER_BYTES);
        frame.set(new Uint8Array(cipherBuf), HEADER_BYTES + IV_BYTES);
        return frame.buffer;
      });
      encryptChain = run.catch(function () {});
      return run;
    }

    function decryptFrame(rawFrame) {
      var run = decryptChain.then(async function () {
        var frameBytes = rawFrame instanceof Uint8Array ? rawFrame : new Uint8Array(rawFrame);
        if (frameBytes.length < HEADER_BYTES + IV_BYTES + GCM_TAG_BYTES) {
          throw new Error('Encrypted frame too short or corrupted.');
        }

        var header = frameBytes.subarray(0, HEADER_BYTES);
        if (header[0] !== FRAME_VERSION) {
          throw new Error('Unsupported encrypted frame version.');
        }

        var iv = frameBytes.subarray(HEADER_BYTES, HEADER_BYTES + IV_BYTES);
        var ciphertext = frameBytes.subarray(HEADER_BYTES + IV_BYTES);

        var ivView = new DataView(iv.buffer, iv.byteOffset, iv.byteLength);
        var frameCounter = ivView.getBigUint64(4, false);
        if (frameCounter !== expectedRecvCounter) {
          throw new Error('Frame counter mismatch (possible replay or out-of-order tampering).');
        }

        if (expectedPeerIvPrefix === null) {
          expectedPeerIvPrefix = new Uint8Array(iv.subarray(0, 4));
        } else {
          for (var i = 0; i < 4; i++) {
            if (iv[i] !== expectedPeerIvPrefix[i]) {
              throw new Error('Peer IV prefix mismatch.');
            }
          }
        }

        var plainBuf = await subtle.decrypt(
          { name: 'AES-GCM', iv: iv, additionalData: header },
          recvKey,
          ciphertext
        );

        expectedRecvCounter += 1n;

        var hView = new DataView(header.buffer, header.byteOffset, header.byteLength);
        return {
          frameType: header[1],
          transferId: hView.getUint32(2, false),
          chunkIndex: hView.getUint32(6, false),
          isFinal: (header[10] & FLAG_FINAL) !== 0,
          plaintext: new Uint8Array(plainBuf)
        };
      });
      decryptChain = run.catch(function () {});
      return run;
    }

    return {
      sas: sas,
      formattedSas: formatSas(sas),
      transcriptSalt: salt,
      sendKey: sendKey,
      recvKey: recvKey,
      encryptFrame: encryptFrame,
      decryptFrame: decryptFrame
    };
  }

  function buildRtcConfiguration(options) {
    if (options && options.allowStun === true) {
      var customIce = Array.isArray(options.iceServers) && options.iceServers.length > 0
        ? options.iceServers
        : [{ urls: 'stun:stun.l.google.com:19302' }];
      return { iceServers: customIce };
    }
    return { iceServers: [] };
  }

  function normalizeFilesInput(input) {
    if (!input) return [];
    if (Array.isArray(input)) return input.filter(Boolean);
    if (typeof input.length === 'number' && typeof input !== 'string') {
      return Array.prototype.slice.call(input).filter(Boolean);
    }
    return [input];
  }

  function openSseClient(params) {
    var fetchFn = params.fetchImpl || globalScope.fetch.bind(globalScope);
    var url = params.url;
    var peerToken = params.peerToken;
    var sseTicket = params.sseTicket;
    var apiBase = params.apiBase || '';
    var code = params.code;
    var onEvent = params.onEvent;
    var onFatalError = params.onFatalError;

    var closed = false;
    var lastEventId = '';
    var activeAbort = null;
    var eventSource = null;
    var retryCount = 0;

    function dispatchBlock(blockText) {
      if (!blockText || !blockText.trim()) return;
      var lines = blockText.split(/\r?\n/);
      var eventName = 'message';
      var dataLines = [];
      var eventId = '';

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line || line.charAt(0) === ':') continue;
        var colonIdx = line.indexOf(':');
        var field = colonIdx === -1 ? line : line.slice(0, colonIdx);
        var val = colonIdx === -1 ? '' : line.slice(colonIdx + 1);
        if (val.charAt(0) === ' ') val = val.slice(1);

        if (field === 'event') eventName = val;
        else if (field === 'data') dataLines.push(val);
        else if (field === 'id') eventId = val;
      }

      if (eventId) lastEventId = eventId;
      if (!dataLines.length) return;
      var rawData = dataLines.join('\n');
      var parsedData = rawData;
      try {
        parsedData = JSON.parse(rawData);
      } catch (_) {}

      onEvent(eventName, parsedData);
    }

    async function connectFetchLoop() {
      while (!closed) {
        activeAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
        try {
          var headers = {
            'Authorization': 'Bearer ' + peerToken,
            'Accept': 'text/event-stream'
          };
          if (lastEventId) headers['Last-Event-ID'] = lastEventId;

          var res = await fetchFn(url, {
            method: 'GET',
            headers: headers,
            cache: 'no-store',
            signal: activeAbort ? activeAbort.signal : undefined
          });

          if (!res.ok) {
            var errPayload = await res.json().catch(function () { return {}; });
            var fatal = res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404 || res.status === 410;
            if (fatal) {
              if (!closed) {
                var err = new Error(errPayload.message || errPayload.error || ('Signaling stream failed (HTTP ' + res.status + ')'));
                err.status = res.status;
                err.code = errPayload.error;
                onFatalError(err);
              }
              return;
            }
            throw new Error('SSE HTTP ' + res.status);
          }

          if (!res.body || typeof res.body.getReader !== 'function') {
            return connectEventSourceFallback();
          }

          retryCount = 0;
          var reader = res.body.getReader();
          var decoder = new TextDecoder('utf-8');
          var buffer = '';

          while (!closed) {
            var chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            buffer = buffer.replace(/\r\n/g, '\n');
            var boundaryIdx;
            while ((boundaryIdx = buffer.indexOf('\n\n')) !== -1) {
              var block = buffer.slice(0, boundaryIdx);
              buffer = buffer.slice(boundaryIdx + 2);
              dispatchBlock(block);
            }
          }
          buffer += decoder.decode();
          if (buffer.trim()) {
            dispatchBlock(buffer);
          }
          if (!closed) {
            retryCount += 1;
            if (retryCount > 5) {
              onFatalError(new Error('Signaling SSE stream closed unexpectedly.'));
              return;
            }
            await new Promise(function (resolve) { setTimeout(resolve, 400); });
          }
        } catch (err) {
          if (closed || (err && err.name === 'AbortError')) return;
          retryCount += 1;
          if (retryCount > 5) {
            onFatalError(err);
            return;
          }
          var delay = Math.min(4000, 400 * Math.pow(2, retryCount - 1));
          await new Promise(function (resolve) { setTimeout(resolve, delay); });
        }
      }
    }

    function connectEventSourceFallback() {
      if (closed || typeof globalScope.EventSource !== 'function' || !sseTicket) {
        onFatalError(new Error('Streaming SSE transport is unavailable.'));
        return;
      }
      var esUrl = apiBase + '/api/lan/events?code=' + encodeURIComponent(code) + '&ticket=' + encodeURIComponent(sseTicket);
      eventSource = new globalScope.EventSource(esUrl);
      ['ready', 'peer-joined', 'signal', 'peer-disconnected', 'room-closed'].forEach(function (evName) {
        eventSource.addEventListener(evName, function (e) {
          var parsed = e.data;
          try { parsed = JSON.parse(e.data); } catch (_) {}
          onEvent(evName, parsed);
        });
      });
      eventSource.onerror = function () {
        if (!closed && eventSource && eventSource.readyState === 2) {
          onFatalError(new Error('Signaling EventSource connection closed.'));
        }
      };
    }

    connectFetchLoop();

    return {
      close: function () {
        closed = true;
        if (activeAbort) {
          try { activeAbort.abort(); } catch (_) {}
          activeAbort = null;
        }
        if (eventSource) {
          try { eventSource.close(); } catch (_) {}
          eventSource = null;
        }
      }
    };
  }

  function createSessionCore(options) {
    var apiBase = (options && options.apiBase) ? String(options.apiBase).replace(/\/+$/, '') : '';
    var fetchFn = (options && options.fetch) || globalScope.fetch.bind(globalScope);
    var RtcPeerConnectionCtor = (options && options.RTCPeerConnection) || globalScope.RTCPeerConnection;

    async function postJson(path, body, token) {
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      var res = await fetchFn(apiBase + path, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body || {})
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        var err = new Error(data.message || data.error || ('Request failed (HTTP ' + res.status + ')'));
        err.status = res.status;
        err.code = data.error;
        throw err;
      }
      return data;
    }

    return {
      apiBase: apiBase,
      fetchFn: fetchFn,
      RtcPeerConnectionCtor: RtcPeerConnectionCtor,
      postJson: postJson
    };
  }

  function createSender(options) {
    options = options || {};
    var core = createSessionCore(options);
    var files = normalizeFilesInput(options.files);
    var requireSenderSasConfirm = Boolean(options.requireSenderSasConfirm);

    var state = 'idle';
    var code = '';
    var peerId = '';
    var peerToken = '';
    var sseTicket = '';
    var expiresAt = 0;
    var closed = false;
    var cancelling = false;
    var pc = null;
    var dc = null;
    var sseClient = null;
    var myEcdh = null;
    var sessionCrypto = null;
    var pendingRemoteIce = [];
    var remoteDescSet = false;
    var offerSent = false;
    var fileOfferSent = false;
    var senderSasConfirmed = !requireSenderSasConfirm;
    var receiverAccepted = false;
    var transferStarted = false;
    var preparedOfferMeta = null;
    var currentTransferId = 1;
    var ctrlSeq = 0;
    var sendAbortListeners = [];
    var messageQueue = Promise.resolve();

    function emitState(nextState, detail) {
      state = nextState;
      if (typeof options.onStateChange === 'function') {
        options.onStateChange({ state: state, code: code, detail: detail || null });
      }
    }

    function failSession(err) {
      if (closed) return;
      emitState('error', err && err.message ? err.message : String(err));
      if (typeof options.onError === 'function') {
        options.onError(err instanceof Error ? err : new Error(String(err)));
      }
      cleanupResources(false);
    }

    function cleanupResources(notifyServer) {
      if (closed) return;
      closed = true;

      for (var i = 0; i < sendAbortListeners.length; i++) {
        try { sendAbortListeners[i](); } catch (_) {}
      }
      sendAbortListeners.length = 0;

      if (notifyServer && code && peerToken) {
        core.postJson('/api/lan/close', { code: code }, peerToken).catch(function () {});
      }
      if (sseClient) {
        sseClient.close();
        sseClient = null;
      }
      if (dc) {
        try { dc.close(); } catch (_) {}
        dc = null;
      }
      if (pc) {
        try { pc.close(); } catch (_) {}
        pc = null;
      }
      sessionCrypto = null;
      myEcdh = null;
    }

    async function sendSignal(body) {
      if (closed || !code || !peerToken) return;
      body.code = code;
      await core.postJson('/api/lan/signal', body, peerToken);
    }

    async function sendEncryptedCtrl(obj, isFinal) {
      if (!sessionCrypto || !dc || dc.readyState !== 'open') return;
      var payloadBytes = textEncoder.encode(JSON.stringify(obj));
      if (payloadBytes.length > MAX_CTRL_PLAINTEXT_BYTES) {
        throw new Error('Control payload exceeds maximum size.');
      }
      var frame = await sessionCrypto.encryptFrame({
        frameType: FRAME_TYPE_CTRL,
        transferId: currentTransferId,
        chunkIndex: ctrlSeq++,
        isFinal: Boolean(isFinal),
        plaintextBytes: payloadBytes
      });
      dc.send(frame);
    }

    async function waitForBackpressure(channel) {
      if (closed) throw new Error('Transfer cancelled.');
      if (channel.bufferedAmount <= BUFFERED_HIGH_WATER) return;
      await new Promise(function (resolve, reject) {
        var settled = false;
        var pollTimer = null;

        function done(err) {
          if (settled) return;
          settled = true;
          if (pollTimer) clearInterval(pollTimer);
          if (typeof channel.removeEventListener === 'function') {
            channel.removeEventListener('bufferedamountlow', onLow);
            channel.removeEventListener('close', onClose);
          }
          if (err) reject(err);
          else resolve();
        }

        function onLow() {
          if (channel.bufferedAmount <= BUFFERED_HIGH_WATER) done();
        }
        function onClose() {
          done(new Error('DataChannel closed during transfer.'));
        }
        function onAbort() {
          done(new Error('Transfer cancelled.'));
        }

        sendAbortListeners.push(onAbort);
        if (typeof channel.addEventListener === 'function') {
          channel.addEventListener('bufferedamountlow', onLow);
          channel.addEventListener('close', onClose);
        }
        pollTimer = setInterval(function () {
          if (closed || channel.readyState !== 'open') {
            done(new Error('Transfer aborted.'));
          } else if (channel.bufferedAmount <= BUFFERED_HIGH_WATER) {
            done();
          }
        }, 40);
      });
    }

    async function prepareMetadataAndOffer() {
      if (closed || !sessionCrypto || fileOfferSent || !files.length) return;
      fileOfferSent = true;

      var fileMetas = [];
      var totalSize = 0;
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var fSize = Number(f.size || 0);
        if (!Number.isFinite(fSize) || fSize < 0) {
          throw new Error('Invalid file size.');
        }
        var sha256 = await computeFileSha256(f);
        if (closed) return;
        totalSize += fSize;
        fileMetas.push({
          index: i,
          name: sanitizeFilename(f.name || ('file-' + (i + 1))),
          size: fSize,
          mimeType: String(f.type || 'application/octet-stream').slice(0, 128),
          sha256: sha256
        });
      }

      preparedOfferMeta = {
        type: 'file-offer',
        transferId: currentTransferId,
        fileCount: fileMetas.length,
        totalSize: totalSize,
        files: fileMetas
      };

      await sendEncryptedCtrl(preparedOfferMeta, false);
      emitState('awaiting-accept', { fileCount: fileMetas.length, totalSize: totalSize });
      maybeStartTransfer();
    }

    async function maybeStartTransfer() {
      if (closed || transferStarted || !receiverAccepted || !senderSasConfirmed || !preparedOfferMeta) return;
      transferStarted = true;
      var startTime = Date.now();
      preparedOfferMeta._startedAt = startTime;
      emitState('transferring');

      var totalBytes = preparedOfferMeta.totalSize;
      var totalSent = 0;
      var samples = [];
      var lastProgressAt = 0;

      function emitProgress(fileIndex, fileMeta, fileBytesSent, force) {
        if (typeof options.onProgress !== 'function') return;
        var now = Date.now();
        if (!force && now - lastProgressAt < 80) return;
        lastProgressAt = now;

        samples.push({ t: now, b: totalSent });
        var cutoff = now - 2500;
        while (samples.length > 2 && samples[0].t < cutoff) samples.shift();

        var speedBps = 0;
        if (samples.length >= 2) {
          var dt = (samples[samples.length - 1].t - samples[0].t) / 1000;
          var db = samples[samples.length - 1].b - samples[0].b;
          if (dt > 0.05 && db >= 0) speedBps = db / dt;
        }
        var etaSeconds = speedBps > 0 ? Math.max(0, (totalBytes - totalSent) / speedBps) : 0;
        var percent = totalBytes > 0 ? Math.min(100, (totalSent / totalBytes) * 100) : 100;

        options.onProgress({
          fileIndex: fileIndex,
          fileCount: files.length,
          fileName: fileMeta.name,
          bytesSent: totalSent,
          totalBytes: totalBytes,
          fileBytesSent: fileBytesSent,
          fileSize: fileMeta.size,
          percent: percent,
          speedBps: speedBps,
          etaSeconds: etaSeconds
        });
      }

      try {
        for (var i = 0; i < files.length; i++) {
          if (closed || cancelling) return;
          var file = files[i];
          var meta = preparedOfferMeta.files[i];
          var fSize = meta.size;

          if (fSize === 0) {
            var emptyFrame = await sessionCrypto.encryptFrame({
              frameType: FRAME_TYPE_CHUNK,
              transferId: currentTransferId,
              chunkIndex: 0,
              isFinal: true,
              plaintextBytes: new Uint8Array(0)
            });
            if (closed || cancelling || !dc || dc.readyState !== 'open') return;
            dc.send(emptyFrame);
            emitProgress(i, meta, 0, true);
          } else {
            var offset = 0;
            var chunkIdx = 0;
            while (offset < fSize) {
              if (closed || cancelling) return;
              if (dc.bufferedAmount > BUFFERED_HIGH_WATER) {
                await waitForBackpressure(dc);
              }
              if (closed || cancelling) return;
              var end = Math.min(offset + CHUNK_SIZE, fSize);
              var isFinalChunk = end >= fSize;
              var sliceBuf = await file.slice(offset, end).arrayBuffer();
              var plainBytes = new Uint8Array(sliceBuf);

              var encryptedFrame = await sessionCrypto.encryptFrame({
                frameType: FRAME_TYPE_CHUNK,
                transferId: currentTransferId,
                chunkIndex: chunkIdx,
                isFinal: isFinalChunk,
                plaintextBytes: plainBytes
              });
              if (closed || cancelling || !dc || dc.readyState !== 'open') return;
              dc.send(encryptedFrame);

              offset = end;
              totalSent += plainBytes.length;
              chunkIdx += 1;
              emitProgress(i, meta, offset, isFinalChunk);
            }
          }

          await sendEncryptedCtrl({
            type: 'file-done',
            transferId: currentTransferId,
            fileIndex: i,
            sha256: meta.sha256
          }, false);

          if (typeof options.onFileComplete === 'function') {
            options.onFileComplete({
              fileIndex: i,
              name: meta.name,
              size: meta.size,
              sha256: meta.sha256
            });
          }
        }

        await sendEncryptedCtrl({
          type: 'transfer-complete',
          transferId: currentTransferId,
          fileCount: files.length,
          totalSize: totalBytes
        }, true);

        preparedOfferMeta._startedAt = startTime;
      } catch (err) {
        failSession(err);
      }
    }

    async function handleDataChannelMessage(data) {
      if (closed) return;
      if (typeof data === 'string') {
        var msg;
        try {
          msg = JSON.parse(data);
        } catch (_) {
          throw new Error('Invalid handshake message from receiver.');
        }
        if (msg && msg.proto === 'pokedb-lan-ecdh-v1' && msg.role === 'receiver' && !sessionCrypto) {
          var peerKeyInfo = await importPeerEcdhPublicKey(msg.pub);
          sessionCrypto = await deriveSessionCrypto({
            role: 'sender',
            myPrivateKey: myEcdh.keyPair.privateKey,
            myPublicKeyRaw: myEcdh.publicKeyRaw,
            peerPublicKey: peerKeyInfo.publicKey,
            peerPublicKeyRaw: peerKeyInfo.publicKeyRaw,
            roomCode: code
          });
          emitState('sas-ready', { sas: sessionCrypto.sas, formattedSas: sessionCrypto.formattedSas });
          if (typeof options.onSas === 'function') {
            options.onSas({
              sas: sessionCrypto.sas,
              formattedSas: sessionCrypto.formattedSas,
              roomCode: code
            });
          }
          await prepareMetadataAndOffer();
        }
        return;
      }

      if (!sessionCrypto) {
        throw new Error('Received binary frame before E2EE handshake completed.');
      }

      var frame = await sessionCrypto.decryptFrame(data);
      if (frame.frameType !== FRAME_TYPE_CTRL) {
        throw new Error('Unexpected data frame received by sender.');
      }

      var ctrl = JSON.parse(textDecoder.decode(frame.plaintext));
      if (ctrl.type === 'accept' && ctrl.transferId === currentTransferId) {
        receiverAccepted = true;
        if (typeof options.onReceiverDecision === 'function') {
          options.onReceiverDecision({ accepted: true });
        }
        maybeStartTransfer();
      } else if (ctrl.type === 'decline' && ctrl.transferId === currentTransferId) {
        if (typeof options.onReceiverDecision === 'function') {
          options.onReceiverDecision({ accepted: false, reason: ctrl.reason || 'declined' });
        }
        emitState('declined', ctrl.reason || 'Receiver declined transfer.');
        cleanupResources(true);
      } else if (ctrl.type === 'transfer-ack' && ctrl.transferId === currentTransferId) {
        var durationMs = preparedOfferMeta && preparedOfferMeta._startedAt
          ? Math.max(1, Date.now() - preparedOfferMeta._startedAt)
          : 1;
        emitState('completed');
        if (typeof options.onComplete === 'function') {
          options.onComplete({
            files: preparedOfferMeta ? preparedOfferMeta.files : [],
            durationMs: durationMs
          });
        }
        cleanupResources(true);
      } else if (ctrl.type === 'abort') {
        emitState('cancelled', ctrl.reason || 'Receiver cancelled transfer.');
        cleanupResources(false);
      }
    }

    async function initiatePeerConnection() {
      if (closed || offerSent) return;
      offerSent = true;
      emitState('connecting');

      var rtcConfig = buildRtcConfiguration(options);
      pc = new core.RtcPeerConnectionCtor(rtcConfig);

      dc = pc.createDataChannel('pokedb-lan-v1', { ordered: true });
      dc.binaryType = 'arraybuffer';
      try {
        dc.bufferedAmountLowThreshold = BUFFERED_LOW_THRESHOLD;
      } catch (_) {}

      dc.onopen = function () {
        if (closed) return;
        emitState('handshaking');
        generateEcdhKeyPair().then(function (ecdh) {
          if (closed || !dc || dc.readyState !== 'open') return;
          myEcdh = ecdh;
          dc.send(JSON.stringify({
            proto: 'pokedb-lan-ecdh-v1',
            role: 'sender',
            pub: ecdh.publicKeyBase64Url
          }));
        }).catch(failSession);
      };

      dc.onmessage = function (ev) {
        messageQueue = messageQueue.then(function () {
          return handleDataChannelMessage(ev.data);
        }).catch(failSession);
      };

      dc.onerror = function () {
        if (!closed && state !== 'completed' && state !== 'declined') {
          failSession(new Error('WebRTC DataChannel error.'));
        }
      };

      dc.onclose = function () {
        messageQueue.catch(function () {}).then(function () {
          if (!closed && !cancelling && state !== 'completed' && state !== 'declined' && state !== 'cancelled') {
            failSession(new Error('Peer closed DataChannel unexpectedly.'));
          }
        });
      };

      pc.onicecandidate = function (ev) {
        if (closed) return;
        if (ev.candidate) {
          var cand = typeof ev.candidate.toJSON === 'function' ? ev.candidate.toJSON() : {
            candidate: ev.candidate.candidate,
            sdpMid: ev.candidate.sdpMid ?? null,
            sdpMLineIndex: ev.candidate.sdpMLineIndex ?? null,
            usernameFragment: ev.candidate.usernameFragment
          };
          sendSignal({ type: 'ice', candidate: cand }).catch(function () {});
        }
      };

      pc.onconnectionstatechange = function () {
        if (closed || !pc) return;
        if (pc.connectionState === 'failed') {
          failSession(new Error('Direct LAN peer connection failed (check firewall/NAT or retry).'));
        }
      };

      var offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal({ type: 'offer', sdp: offer.sdp }).catch(function (err) {
        if (err && (err.status === 404 || err.status === 410)) return;
        throw err;
      });
    }

    async function handleSignal(eventData) {
      if (closed || !eventData) return;
      var payload = eventData.payload || eventData;
      var type = payload.type;

      if (type === 'answer' && pc) {
        await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
        remoteDescSet = true;
        while (pendingRemoteIce.length > 0) {
          var c = pendingRemoteIce.shift();
          await pc.addIceCandidate(c).catch(function () {});
        }
      } else if (type === 'ice' && pc) {
        if (payload.candidate === null) return;
        if (!remoteDescSet) {
          pendingRemoteIce.push(payload.candidate);
        } else {
          await pc.addIceCandidate(payload.candidate).catch(function () {});
        }
      } else if (type === 'reject') {
        emitState('declined', payload.reason || 'Receiver rejected connection.');
        cleanupResources(false);
      } else if (type === 'bye') {
        if (state !== 'completed' && state !== 'declined') {
          emitState('cancelled', payload.reason || 'Receiver disconnected.');
        }
        cleanupResources(false);
      }
    }

    return {
      get code() { return code; },
      get state() { return state; },
      get sas() { return sessionCrypto ? sessionCrypto.sas : ''; },

      start: async function () {
        var support = isSupported();
        if (!support.supported && !options.RTCPeerConnection) {
          throw new Error(support.reason);
        }
        emitState('creating');
        var room = await core.postJson('/api/lan/room', {});
        code = room.code;
        peerId = room.peerId;
        peerToken = room.peerToken;
        sseTicket = room.sseTicket;
        expiresAt = room.expiresAt;

        emitState('waiting-peer', { expiresAt: expiresAt });
        if (typeof options.onRoomCreated === 'function') {
          options.onRoomCreated({
            code: code,
            expiresAt: expiresAt,
            ttlMs: room.ttlMs,
            maxPeers: room.maxPeers || 2
          });
        }

        sseClient = openSseClient({
          url: core.apiBase + '/api/lan/events?code=' + encodeURIComponent(code),
          apiBase: core.apiBase,
          code: code,
          peerToken: peerToken,
          sseTicket: sseTicket,
          fetchImpl: core.fetchFn,
          onEvent: function (evName, evData) {
            if (closed) return;
            if (evName === 'peer-joined') {
              if (typeof options.onPeerJoined === 'function') {
                options.onPeerJoined({ peerId: evData && evData.peerId });
              }
              initiatePeerConnection().catch(failSession);
            } else if (evName === 'signal') {
              handleSignal(evData).catch(failSession);
            } else if (evName === 'room-closed') {
              if (state !== 'completed' && state !== 'declined' && state !== 'cancelled') {
                var reason = (evData && evData.reason) || 'closed';
                emitState(reason === 'expired' ? 'error' : 'closed', reason);
                if (reason === 'expired' && typeof options.onError === 'function') {
                  options.onError(new Error('LAN pairing room expired.'));
                }
              }
              cleanupResources(false);
            }
          },
          onFatalError: failSession
        });

        return {
          code: code,
          expiresAt: expiresAt,
          ttlMs: room.ttlMs
        };
      },

      setFiles: async function (fileOrFiles) {
        if (fileOfferSent) {
          throw new Error('File offer already sent for this session.');
        }
        var normalized = normalizeFilesInput(fileOrFiles);
        if (!normalized.length || normalized.length > MAX_FILES_PER_TRANSFER) {
          throw new Error('Select between 1 and ' + MAX_FILES_PER_TRANSFER + ' files.');
        }
        files = normalized;
        if (sessionCrypto && !fileOfferSent) {
          await prepareMetadataAndOffer();
        }
      },

      confirmSas: function () {
        senderSasConfirmed = true;
        maybeStartTransfer();
      },

      cancel: function (reason) {
        if (closed || cancelling) return;
        cancelling = true;
        emitState('cancelled', reason || 'Cancelled by sender');
        if (sessionCrypto && dc && dc.readyState === 'open') {
          for (var i = 0; i < sendAbortListeners.length; i++) {
            try { sendAbortListeners[i](); } catch (_) {}
          }
          sendAbortListeners.length = 0;
          sendEncryptedCtrl({ type: 'abort', reason: reason || 'cancelled' }, true)
            .catch(function () {})
            .then(function () {
              setTimeout(function () { cleanupResources(true); }, 35);
            });
          return;
        }
        cleanupResources(true);
      },

      close: function () {
        this.cancel('closed');
      }
    };
  }

  function createReceiver(options) {
    options = options || {};
    var core = createSessionCore(options);
    var autoDownload = Boolean(options.autoDownload);

    var state = 'idle';
    var code = normalizeCode(options.code || '');
    var peerId = '';
    var peerToken = '';
    var sseTicket = '';
    var expiresAt = 0;
    var closed = false;
    var cancelling = false;
    var pc = null;
    var dc = null;
    var sseClient = null;
    var myEcdh = null;
    var sessionCrypto = null;
    var pendingRemoteIce = [];
    var remoteDescSet = false;

    var currentOffer = null;
    var decisionAccepted = false;
    var activeFileIndex = 0;
    var activeChunkIndex = 0;
    var activeFileBytes = 0;
    var totalBytesReceived = 0;
    var activeHasher = null;
    var activeChunks = null;
    var activeWritable = null;
    var completedFiles = [];
    var transferStartTime = 0;
    var speedSamples = [];
    var lastProgressAt = 0;
    var ctrlSeq = 0;
    var messageQueue = Promise.resolve();
    var deferredCleanupTimer = null;

    function emitState(nextState, detail) {
      state = nextState;
      if (typeof options.onStateChange === 'function') {
        options.onStateChange({ state: state, code: code, detail: detail || null });
      }
    }

    function cleanupResources(notifyServer) {
      if (closed) return;
      closed = true;

      if (deferredCleanupTimer) {
        clearTimeout(deferredCleanupTimer);
        deferredCleanupTimer = null;
      }

      if (activeWritable && typeof activeWritable.abort === 'function') {
        try { activeWritable.abort(); } catch (_) {}
        activeWritable = null;
      }
      activeChunks = null;

      if (notifyServer && code && peerToken) {
        core.postJson('/api/lan/close', { code: code }, peerToken).catch(function () {});
      }
      if (sseClient) {
        sseClient.close();
        sseClient = null;
      }
      if (dc) {
        try { dc.close(); } catch (_) {}
        dc = null;
      }
      if (pc) {
        try { pc.close(); } catch (_) {}
        pc = null;
      }
      sessionCrypto = null;
      myEcdh = null;
    }

    function failSession(err) {
      if (closed) return;
      emitState('error', err && err.message ? err.message : String(err));
      if (typeof options.onError === 'function') {
        options.onError(err instanceof Error ? err : new Error(String(err)));
      }
      cleanupResources(false);
    }

    async function sendSignal(body) {
      if (closed || !code || !peerToken) return;
      body.code = code;
      await core.postJson('/api/lan/signal', body, peerToken);
    }

    async function sendEncryptedCtrl(obj, isFinal) {
      if (!sessionCrypto || !dc || dc.readyState !== 'open') return;
      var payloadBytes = textEncoder.encode(JSON.stringify(obj));
      var frame = await sessionCrypto.encryptFrame({
        frameType: FRAME_TYPE_CTRL,
        transferId: currentOffer ? currentOffer.transferId : 0,
        chunkIndex: ctrlSeq++,
        isFinal: Boolean(isFinal),
        plaintextBytes: payloadBytes
      });
      dc.send(frame);
    }

    async function prepareNextFileSink(fileIndex) {
      var meta = currentOffer.files[fileIndex];
      activeFileIndex = fileIndex;
      activeChunkIndex = 0;
      activeFileBytes = 0;
      activeHasher = new IncrementalSha256();
      activeWritable = null;
      activeChunks = null;

      if (typeof options.writableStreamFactory === 'function') {
        activeWritable = await options.writableStreamFactory(meta);
      }
      if (!activeWritable) {
        activeChunks = [];
      }
    }

    function triggerAutoDownload(downloadUrl, filename) {
      if (!downloadUrl || typeof document === 'undefined') return;
      try {
        var link = document.createElement('a');
        link.href = downloadUrl;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (_) {}
    }

    function emitReceiveProgress(force) {
      if (typeof options.onProgress !== 'function' || !currentOffer) return;
      var now = Date.now();
      if (!force && now - lastProgressAt < 80) return;
      lastProgressAt = now;

      speedSamples.push({ t: now, b: totalBytesReceived });
      var cutoff = now - 2500;
      while (speedSamples.length > 2 && speedSamples[0].t < cutoff) speedSamples.shift();

      var speedBps = 0;
      if (speedSamples.length >= 2) {
        var dt = (speedSamples[speedSamples.length - 1].t - speedSamples[0].t) / 1000;
        var db = speedSamples[speedSamples.length - 1].b - speedSamples[0].b;
        if (dt > 0.05 && db >= 0) speedBps = db / dt;
      }

      var totalSize = currentOffer.totalSize;
      var etaSeconds = speedBps > 0 ? Math.max(0, (totalSize - totalBytesReceived) / speedBps) : 0;
      var percent = totalSize > 0 ? Math.min(100, (totalBytesReceived / totalSize) * 100) : 100;
      var meta = currentOffer.files[activeFileIndex] || { name: '', size: 0 };

      options.onProgress({
        fileIndex: activeFileIndex,
        fileCount: currentOffer.fileCount,
        fileName: meta.name,
        bytesReceived: totalBytesReceived,
        totalBytes: totalSize,
        fileBytesReceived: activeFileBytes,
        fileSize: meta.size,
        percent: percent,
        speedBps: speedBps,
        etaSeconds: etaSeconds
      });
    }

    async function handleAccept() {
      if (closed || !currentOffer || decisionAccepted) return;
      decisionAccepted = true;
      transferStartTime = Date.now();
      await prepareNextFileSink(0);
      emitState('receiving');
      await sendEncryptedCtrl({
        type: 'accept',
        transferId: currentOffer.transferId
      }, false);
    }

    async function handleDecline(reason) {
      if (closed || decisionAccepted) return;
      emitState('declined', reason || 'Declined by receiver.');
      if (sessionCrypto && dc && dc.readyState === 'open') {
        await sendEncryptedCtrl({
          type: 'decline',
          transferId: currentOffer ? currentOffer.transferId : 0,
          reason: String(reason || 'declined').slice(0, 128)
        }, true).catch(function () {});
        deferredCleanupTimer = setTimeout(function () {
          cleanupResources(true);
        }, 80);
      } else {
        cleanupResources(true);
      }
    }

    async function handleDataChannelMessage(data) {
      if (closed) return;

      if (typeof data === 'string') {
        var msg;
        try {
          msg = JSON.parse(data);
        } catch (_) {
          throw new Error('Invalid handshake message from sender.');
        }
        if (msg && msg.proto === 'pokedb-lan-ecdh-v1' && msg.role === 'sender' && !sessionCrypto) {
          var peerKeyInfo = await importPeerEcdhPublicKey(msg.pub);
          myEcdh = await generateEcdhKeyPair();
          dc.send(JSON.stringify({
            proto: 'pokedb-lan-ecdh-v1',
            role: 'receiver',
            pub: myEcdh.publicKeyBase64Url
          }));

          sessionCrypto = await deriveSessionCrypto({
            role: 'receiver',
            myPrivateKey: myEcdh.keyPair.privateKey,
            myPublicKeyRaw: myEcdh.publicKeyRaw,
            peerPublicKey: peerKeyInfo.publicKey,
            peerPublicKeyRaw: peerKeyInfo.publicKeyRaw,
            roomCode: code
          });

          emitState('sas-ready', { sas: sessionCrypto.sas, formattedSas: sessionCrypto.formattedSas });
          if (typeof options.onSas === 'function') {
            options.onSas({
              sas: sessionCrypto.sas,
              formattedSas: sessionCrypto.formattedSas,
              roomCode: code
            });
          }
        }
        return;
      }

      if (!sessionCrypto) {
        throw new Error('Received encrypted frame before E2EE handshake completed.');
      }

      var frameBytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      if (frameBytes.length > MAX_CHUNK_FRAME_BYTES) {
        throw new Error('Received frame exceeds maximum frame size.');
      }

      var frame = await sessionCrypto.decryptFrame(frameBytes);

      if (frame.frameType === FRAME_TYPE_CTRL) {
        var ctrl = JSON.parse(textDecoder.decode(frame.plaintext));
        if (ctrl.type === 'file-offer') {
          if (currentOffer) {
            throw new Error('Duplicate file offer received.');
          }
          if (!Array.isArray(ctrl.files) || ctrl.files.length === 0 || ctrl.files.length > MAX_FILES_PER_TRANSFER) {
            throw new Error('Invalid file offer metadata.');
          }

          var sanitizedFiles = [];
          var computedTotal = 0;
          for (var i = 0; i < ctrl.files.length; i++) {
            var rf = ctrl.files[i];
            var fSize = Number(rf.size);
            if (!Number.isInteger(fSize) || fSize < 0) {
              throw new Error('Invalid file size in offer.');
            }
            if (typeof rf.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(rf.sha256)) {
              throw new Error('Missing or invalid SHA-256 checksum in file offer.');
            }
            computedTotal += fSize;
            sanitizedFiles.push({
              index: i,
              name: sanitizeFilename(rf.name),
              size: fSize,
              mimeType: String(rf.mimeType || 'application/octet-stream').slice(0, 128),
              sha256: rf.sha256.toLowerCase()
            });
          }

          currentOffer = {
            transferId: ctrl.transferId,
            fileCount: sanitizedFiles.length,
            totalSize: computedTotal,
            files: sanitizedFiles
          };

          emitState('awaiting-decision', currentOffer);
          if (typeof options.onFileOffer === 'function') {
            options.onFileOffer({
              transferId: currentOffer.transferId,
              files: sanitizedFiles,
              totalSize: computedTotal,
              fileCount: sanitizedFiles.length,
              sas: sessionCrypto.sas,
              formattedSas: sessionCrypto.formattedSas,
              accept: handleAccept,
              decline: handleDecline
            });
          }
          return;
        }

        if (ctrl.type === 'file-done') {
          if (!decisionAccepted || !currentOffer || ctrl.transferId !== currentOffer.transferId) {
            throw new Error('Unexpected file-done frame.');
          }
          if (ctrl.fileIndex !== activeFileIndex) {
            throw new Error('Out-of-order file-done frame.');
          }

          emitState('verifying');
          var expectedMeta = currentOffer.files[activeFileIndex];
          if (activeFileBytes !== expectedMeta.size) {
            throw new Error('Received byte count mismatch for ' + expectedMeta.name);
          }

          var actualSha256 = activeHasher.digestHex();
          if (actualSha256 !== expectedMeta.sha256) {
            throw new Error('SHA-256 verification failed for ' + expectedMeta.name);
          }

          var blob = null;
          var downloadUrl = null;
          if (activeWritable) {
            await activeWritable.close();
            activeWritable = null;
          } else {
            blob = typeof globalScope.Blob === 'function'
              ? new globalScope.Blob(activeChunks, { type: expectedMeta.mimeType || 'application/octet-stream' })
              : null;
            if (blob && globalScope.URL && typeof globalScope.URL.createObjectURL === 'function') {
              downloadUrl = globalScope.URL.createObjectURL(blob);
            }
            activeChunks = null;
          }

          if (autoDownload && downloadUrl) {
            triggerAutoDownload(downloadUrl, expectedMeta.name);
          }

          var completedItem = {
            fileIndex: activeFileIndex,
            name: expectedMeta.name,
            size: expectedMeta.size,
            mimeType: expectedMeta.mimeType,
            sha256: actualSha256,
            verified: true,
            blob: blob,
            downloadUrl: downloadUrl
          };
          completedFiles.push(completedItem);

          if (typeof options.onFileComplete === 'function') {
            options.onFileComplete(completedItem);
          }

          if (activeFileIndex + 1 < currentOffer.fileCount) {
            await prepareNextFileSink(activeFileIndex + 1);
            emitState('receiving');
          }
          return;
        }

        if (ctrl.type === 'transfer-complete') {
          if (!decisionAccepted || !currentOffer || ctrl.transferId !== currentOffer.transferId) {
            throw new Error('Unexpected transfer-complete frame.');
          }
          if (completedFiles.length !== currentOffer.fileCount) {
            throw new Error('Transfer completed prematurely with missing files.');
          }

          await sendEncryptedCtrl({
            type: 'transfer-ack',
            transferId: currentOffer.transferId
          }, true);

          var durationMs = Math.max(1, Date.now() - transferStartTime);
          emitState('completed');
          if (typeof options.onComplete === 'function') {
            options.onComplete({
              files: completedFiles,
              durationMs: durationMs
            });
          }
          deferredCleanupTimer = setTimeout(function () {
            cleanupResources(false);
          }, 1500);
          return;
        }

        if (ctrl.type === 'abort') {
          emitState('cancelled', ctrl.reason || 'Sender aborted transfer.');
          cleanupResources(false);
          return;
        }
      } else if (frame.frameType === FRAME_TYPE_CHUNK) {
        if (!decisionAccepted || !currentOffer || frame.transferId !== currentOffer.transferId) {
          throw new Error('Received file chunk before receiver accepted transfer.');
        }
        if (frame.chunkIndex !== activeChunkIndex) {
          throw new Error('Chunk sequence mismatch.');
        }

        var meta = currentOffer.files[activeFileIndex];
        if (!meta) {
          throw new Error('Unexpected chunk for non-existent file.');
        }
        if (activeFileBytes + frame.plaintext.length > meta.size) {
          throw new Error('Received chunk exceeds declared file size.');
        }

        activeHasher.update(frame.plaintext);
        activeFileBytes += frame.plaintext.length;
        totalBytesReceived += frame.plaintext.length;
        activeChunkIndex += 1;

        if (activeWritable) {
          await activeWritable.write(frame.plaintext);
        } else if (activeChunks) {
          activeChunks.push(frame.plaintext);
        }

        emitReceiveProgress(frame.isFinal);
      }
    }

    async function handleSignal(eventData) {
      if (closed || !eventData) return;
      var payload = eventData.payload || eventData;
      var type = payload.type;

      if (type === 'offer') {
        emitState('connecting');
        var rtcConfig = buildRtcConfiguration(options);
        pc = new core.RtcPeerConnectionCtor(rtcConfig);

        pc.ondatachannel = function (ev) {
          dc = ev.channel;
          dc.binaryType = 'arraybuffer';
          dc.onopen = function () {
            if (!closed) emitState('handshaking');
          };
          dc.onmessage = function (msgEv) {
            messageQueue = messageQueue.then(function () {
              return handleDataChannelMessage(msgEv.data);
            }).catch(failSession);
          };
          dc.onerror = function () {
            if (!closed && state !== 'completed' && state !== 'declined') {
              failSession(new Error('WebRTC DataChannel error.'));
            }
          };
          dc.onclose = function () {
            messageQueue.catch(function () {}).then(function () {
              if (!closed && !cancelling && state !== 'completed' && state !== 'declined' && state !== 'cancelled') {
                failSession(new Error('Sender closed DataChannel unexpectedly.'));
              }
            });
          };
        };

        pc.onicecandidate = function (ev) {
          if (closed) return;
          if (ev.candidate) {
            var cand = typeof ev.candidate.toJSON === 'function' ? ev.candidate.toJSON() : {
              candidate: ev.candidate.candidate,
              sdpMid: ev.candidate.sdpMid ?? null,
              sdpMLineIndex: ev.candidate.sdpMLineIndex ?? null,
              usernameFragment: ev.candidate.usernameFragment
            };
            sendSignal({ type: 'ice', candidate: cand }).catch(function () {});
          }
        };

        pc.onconnectionstatechange = function () {
          if (closed || !pc) return;
          if (pc.connectionState === 'failed') {
            failSession(new Error('Direct LAN peer connection failed.'));
          }
        };

        await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
        remoteDescSet = true;
        while (pendingRemoteIce.length > 0) {
          var c = pendingRemoteIce.shift();
          await pc.addIceCandidate(c).catch(function () {});
        }
        var answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal({ type: 'answer', sdp: answer.sdp }).catch(function (err) {
          if (err && (err.status === 404 || err.status === 410)) return;
          throw err;
        });
      } else if (type === 'ice' && pc) {
        if (payload.candidate === null) return;
        if (!remoteDescSet) {
          pendingRemoteIce.push(payload.candidate);
        } else {
          await pc.addIceCandidate(payload.candidate).catch(function () {});
        }
      } else if (type === 'bye' || type === 'reject') {
        if (state !== 'completed' && state !== 'declined') {
          emitState('cancelled', payload.reason || 'Sender disconnected.');
        }
        cleanupResources(false);
      }
    }

    return {
      get code() { return code; },
      get state() { return state; },
      get sas() { return sessionCrypto ? sessionCrypto.sas : ''; },

      join: async function (overrideCode) {
        var support = isSupported();
        if (!support.supported && !options.RTCPeerConnection) {
          throw new Error(support.reason);
        }
        if (overrideCode !== undefined) {
          code = normalizeCode(overrideCode);
        }
        if (!isValidCode(code)) {
          throw new Error('Enter a valid 6-character LAN pairing code.');
        }

        emitState('joining');
        var joined = await core.postJson('/api/lan/join', { code: code });
        code = joined.code;
        peerId = joined.peerId;
        peerToken = joined.peerToken;
        sseTicket = joined.sseTicket;
        expiresAt = joined.expiresAt;

        if (typeof options.onJoined === 'function') {
          options.onJoined({
            code: code,
            expiresAt: expiresAt,
            ttlMs: joined.ttlMs
          });
        }

        sseClient = openSseClient({
          url: core.apiBase + '/api/lan/events?code=' + encodeURIComponent(code),
          apiBase: core.apiBase,
          code: code,
          peerToken: peerToken,
          sseTicket: sseTicket,
          fetchImpl: core.fetchFn,
          onEvent: function (evName, evData) {
            if (closed) return;
            if (evName === 'signal') {
              handleSignal(evData).catch(failSession);
            } else if (evName === 'room-closed') {
              if (state !== 'completed' && state !== 'declined' && state !== 'cancelled') {
                var reason = (evData && evData.reason) || 'closed';
                emitState(reason === 'expired' ? 'error' : 'closed', reason);
                if (reason === 'expired' && typeof options.onError === 'function') {
                  options.onError(new Error('LAN pairing room expired.'));
                }
              }
              cleanupResources(false);
            }
          },
          onFatalError: failSession
        });

        return {
          code: code,
          expiresAt: expiresAt,
          ttlMs: joined.ttlMs
        };
      },

      accept: handleAccept,
      decline: handleDecline,

      cancel: function (reason) {
        if (closed || cancelling) return;
        cancelling = true;
        emitState('cancelled', reason || 'Cancelled by receiver');
        if (sessionCrypto && dc && dc.readyState === 'open') {
          sendEncryptedCtrl({ type: 'abort', reason: reason || 'cancelled' }, true)
            .catch(function () {})
            .then(function () {
              deferredCleanupTimer = setTimeout(function () { cleanupResources(true); }, 35);
            });
          return;
        }
        cleanupResources(true);
      },

      close: function () {
        this.cancel('closed');
      }
    };
  }

  return {
    ROOM_CODE_ALPHABET: ROOM_CODE_ALPHABET,
    CHUNK_SIZE: CHUNK_SIZE,
    isSupported: isSupported,
    normalizeCode: normalizeCode,
    isValidCode: isValidCode,
    formatSas: formatSas,
    sanitizeFilename: sanitizeFilename,
    computeFileSha256: computeFileSha256,
    createSender: createSender,
    createReceiver: createReceiver,
    _internal: {
      IncrementalSha256: IncrementalSha256,
      generateEcdhKeyPair: generateEcdhKeyPair,
      importPeerEcdhPublicKey: importPeerEcdhPublicKey,
      deriveSessionCrypto: deriveSessionCrypto,
      buildRtcConfiguration: buildRtcConfiguration,
      FRAME_TYPE_CTRL: FRAME_TYPE_CTRL,
      FRAME_TYPE_CHUNK: FRAME_TYPE_CHUNK
    }
  };
});
