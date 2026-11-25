// tests/lan-transfer.test.js
// Comprehensive test suite for LAN-to-LAN ephemeral signaling router & WebRTC/E2EE client engine.

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const request = require('supertest');
const { queryTokenRejector } = require('../src/middleware/auth');
const { createApp } = require('../src/app');
const { createSqliteStorage } = require('../src/storage/sqlite');
const { FakeObjectStore } = require('../src/storage/fakeObjectStore');
const {
  createLanRouter,
  ROOM_CODE_ALPHABET,
  normalizeRoomCode,
  isValidRoomCode
} = require('../src/tools/lan/router');
const PokedbLan = require('../tools/lan/public/lan.js');

function createTestServer(routerOptions = {}, withQueryTokenRejector = false) {
  const app = express();
  if (withQueryTokenRejector) {
    app.use(queryTokenRejector);
  }
  const lanRouter = createLanRouter(routerOptions);
  app.use(lanRouter);
  return { app, lanRouter };
}

function makeMockFile(name, bytes, type = 'application/octet-stream') {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const u8 = new Uint8Array(src.byteLength);
  u8.set(src);
  return {
    name,
    size: u8.length,
    type,
    async arrayBuffer() {
      return u8.buffer.slice(0);
    },
    slice(start = 0, end = u8.length) {
      const sub = u8.subarray(start, end);
      return {
        size: sub.length,
        async arrayBuffer() {
          return u8.buffer.slice(sub.byteOffset, sub.byteOffset + sub.byteLength);
        }
      };
    }
  };
}

function createInMemoryWebRtcPair(options = {}) {
  const endpoints = new Map();
  let nextPeerId = 1;

  function createChannelPair(senderPc, receiverPc, label, initOpts) {
    const senderListeners = new Map();
    const receiverListeners = new Map();

    function makeChannel(isSender) {
      const listeners = isSender ? senderListeners : receiverListeners;
      const ch = {
        label,
        ordered: initOpts?.ordered !== false,
        binaryType: 'arraybuffer',
        readyState: 'connecting',
        bufferedAmount: 0,
        bufferedAmountLowThreshold: 0,
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
        addEventListener(type, fn) {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type).add(fn);
        },
        removeEventListener(type, fn) {
          listeners.get(type)?.delete(fn);
        },
        dispatch(type, ev) {
          const prop = ch[`on${type}`];
          if (typeof prop === 'function') prop(ev);
          const set = listeners.get(type);
          if (set) {
            for (const fn of set) fn(ev);
          }
        },
        send(payload) {
          if (ch.readyState !== 'open') {
            throw new Error('RTCDataChannel is not open');
          }
          const peerCh = isSender ? receiverCh : senderCh;
          let wireData = payload;
          if (typeof options.interceptWireFrame === 'function' && typeof payload !== 'string') {
            wireData = options.interceptWireFrame(payload, isSender ? 'sender' : 'receiver');
          }
          const size = typeof wireData === 'string' ? wireData.length : wireData.byteLength;
          ch.bufferedAmount += size;

          setTimeout(() => {
            ch.bufferedAmount = Math.max(0, ch.bufferedAmount - size);
            if (ch.bufferedAmount <= ch.bufferedAmountLowThreshold) {
              ch.dispatch('bufferedamountlow', {});
            }
            if (peerCh.readyState === 'open') {
              peerCh.dispatch('message', { data: wireData });
            }
          }, options.channelDelayMs ?? 1);
        },
        close() {
          if (ch.readyState === 'closed') return;
          ch.readyState = 'closed';
          const peerCh = isSender ? receiverCh : senderCh;
          setTimeout(() => {
            ch.dispatch('close', {});
            if (peerCh.readyState !== 'closed') {
              peerCh.readyState = 'closed';
              peerCh.dispatch('close', {});
            }
          }, 2);
        }
      };
      return ch;
    }

    const senderCh = makeChannel(true);
    const receiverCh = makeChannel(false);

    senderPc._pendingChannel = { senderCh, receiverCh, receiverPc };
    return senderCh;
  }

  class MockRTCPeerConnection {
    constructor(rtcConfig) {
      this._id = `pc-${nextPeerId++}`;
      this.rtcConfig = rtcConfig;
      this.connectionState = 'new';
      this.localDescription = null;
      this.remoteDescription = null;
      this.onicecandidate = null;
      this.ondatachannel = null;
      this.onconnectionstatechange = null;
      this._remoteId = null;
      this._pendingChannel = null;
      endpoints.set(this._id, this);
    }

    createDataChannel(label, initOpts) {
      return createChannelPair(this, null, label, initOpts);
    }

    async createOffer() {
      return {
        type: 'offer',
        sdp: `v=0\r\no=- ${this._id} 2 IN IP4 127.0.0.1\r\ns=lan\r\nt=0 0\r\n`
      };
    }

    async createAnswer() {
      return {
        type: 'answer',
        sdp: `v=0\r\no=- ${this._id} 2 IN IP4 127.0.0.1\r\ns=lan-ans\r\nt=0 0\r\n`
      };
    }

    async setLocalDescription(desc) {
      this.localDescription = desc;
      setTimeout(() => {
        if (this.onicecandidate) {
          this.onicecandidate({
            candidate: {
              candidate: 'candidate:1 1 udp 2122260223 192.168.1.50 54321 typ host',
              sdpMid: '0',
              sdpMLineIndex: 0,
              toJSON() {
                return {
                  candidate: this.candidate,
                  sdpMid: this.sdpMid,
                  sdpMLineIndex: this.sdpMLineIndex
                };
              }
            }
          });
        }
      }, 2);
    }

    async setRemoteDescription(desc) {
      this.remoteDescription = desc;
      const match = desc.sdp && desc.sdp.match(/o=- (pc-\d+)/);
      if (match) {
        this._remoteId = match[1];
        const peer = endpoints.get(this._remoteId);
        if (peer) {
          peer._remoteId = this._id;
          if (desc.type === 'answer' && this._pendingChannel) {
            const { senderCh, receiverCh } = this._pendingChannel;
            setTimeout(() => {
              this.connectionState = 'connected';
              peer.connectionState = 'connected';
              if (peer.ondatachannel) {
                peer.ondatachannel({ channel: receiverCh });
              }
              senderCh.readyState = 'open';
              receiverCh.readyState = 'open';
              senderCh.dispatch('open', {});
              receiverCh.dispatch('open', {});
            }, 5);
          }
        }
      }
    }

    async addIceCandidate() {
      // No-op in mock
    }

    close() {
      this.connectionState = 'closed';
    }
  }

  return MockRTCPeerConnection;
}

describe('LAN-to-LAN Direct P2P Transfer Suite', () => {
  const activeRouters = [];
  const activeServers = [];

  afterEach(async () => {
    while (activeRouters.length > 0) {
      const r = activeRouters.pop();
      r.close();
    }
    while (activeServers.length > 0) {
      const s = activeServers.pop();
      if (typeof s.closeAllConnections === 'function') {
        s.closeAllConnections();
      }
      await new Promise((resolve) => s.close(resolve));
    }
  });

  describe('1. Server Signaling: Rooms, Lock, Auth, TTL, Rate Limits, Size Caps', () => {
    test('POST /api/lan/room creates 6-char unambiguous pairing code and isolated sender credentials', async () => {
      const { app, lanRouter } = createTestServer();
      activeRouters.push(lanRouter);

      const res = await request(app).post('/api/lan/room').send({});
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.code).toHaveLength(6);
      expect(isValidRoomCode(res.body.code)).toBe(true);
      for (const ch of res.body.code) {
        expect(ROOM_CODE_ALPHABET).toContain(ch);
        expect('0O1IL').not.toContain(ch);
      }
      expect(res.body.role).toBe('sender');
      expect(res.body.peerId).toMatch(/^s_/);
      expect(typeof res.body.peerToken).toBe('string');
      expect(res.body.peerToken.length).toBeGreaterThanOrEqual(24);
      expect(typeof res.body.sseTicket).toBe('string');
      expect(res.body.maxPeers).toBe(2);
      expect(res.body.peerCount).toBe(1);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-robots-tag']).toBe('noindex');
      expect(lanRouter.getActiveRoomCount()).toBe(1);
    });

    test('POST /api/lan/join normalizes code and enforces strict 2-peer lock (409 on 3rd peer)', async () => {
      const { app, lanRouter } = createTestServer();
      activeRouters.push(lanRouter);

      const createRes = await request(app).post('/api/lan/room').send({});
      const code = createRes.body.code;
      const noisyCode = `  ${code.slice(0, 3).toLowerCase()}-${code.slice(3).toLowerCase()} `;

      const joinRes = await request(app).post('/api/lan/join').send({ code: noisyCode });
      expect(joinRes.status).toBe(200);
      expect(joinRes.body.success).toBe(true);
      expect(joinRes.body.code).toBe(code);
      expect(joinRes.body.role).toBe('receiver');
      expect(joinRes.body.peerId).toMatch(/^r_/);
      expect(joinRes.body.peerToken).not.toBe(createRes.body.peerToken);
      expect(joinRes.body.peerCount).toBe(2);

      // 3rd party hijack attempt fails closed with 409 Conflict
      const hijackRes = await request(app).post('/api/lan/join').send({ code });
      expect(hijackRes.status).toBe(409);
      expect(hijackRes.body.error).toBe('room_full');
    });

    test('POST /api/lan/join fails closed with 400 on malformed codes and 404 on unknown codes', async () => {
      const { app, lanRouter } = createTestServer();
      activeRouters.push(lanRouter);

      const badChars = await request(app).post('/api/lan/join').send({ code: '0O1IL2' });
      expect(badChars.status).toBe(400);
      expect(badChars.body.error).toBe('invalid_room_code');

      const shortCode = await request(app).post('/api/lan/join').send({ code: 'ABC' });
      expect(shortCode.status).toBe(400);

      const missingRes = await request(app).post('/api/lan/join').send({ code: 'AAAAAA' });
      expect(missingRes.status).toBe(404);
      expect(missingRes.body.error).toBe('room_not_found');
    });

    test('Auth token checks reject missing, forged, and cross-room tokens on signal/events/close', async () => {
      const { app, lanRouter } = createTestServer({}, true);
      activeRouters.push(lanRouter);

      const room1 = (await request(app).post('/api/lan/room').send({})).body;
      const join1 = (await request(app).post('/api/lan/join').send({ code: room1.code })).body;
      const room2 = (await request(app).post('/api/lan/room').send({})).body;

      // Missing token
      const noAuth = await request(app)
        .post('/api/lan/signal')
        .send({ code: room1.code, type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' });
      expect(noAuth.status).toBe(401);

      // Wrong token (token from room 2 used in room 1)
      const crossRoom = await request(app)
        .post('/api/lan/signal')
        .set('Authorization', `Bearer ${room2.peerToken}`)
        .send({ code: room1.code, type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' });
      expect(crossRoom.status).toBe(403);

      // queryTokenRejector blocks ?token=... when wired with app middleware
      const queryTokenBlocked = await request(app)
        .get(`/api/lan/events?code=${room1.code}&token=${room1.peerToken}`);
      expect(queryTokenBlocked.status).toBe(400);
      expect(queryTokenBlocked.body.error).toBe('query_tokens_forbidden');

      // Wrong token on close
      const badClose = await request(app)
        .post('/api/lan/close')
        .set('X-Lan-Token', 'invalid-token')
        .send({ code: room1.code });
      expect(badClose.status).toBe(403);

      // Valid X-Lan-Token works on signal
      const validSignal = await request(app)
        .post('/api/lan/signal')
        .set('X-Lan-Token', join1.peerToken)
        .send({ code: room1.code, type: 'bye', reason: 'done' });
      expect(validSignal.status).toBe(200);
    });

    test('TTL expiry fails closed with 410 and sweeper purges expired rooms & frees IP quota', async () => {
      let now = 1700000000000;
      const clock = { now: () => now };
      const { app, lanRouter } = createTestServer({
        clock,
        config: { lanRoomTtlMs: 300000, lanMaxRoomsPerIp: 2 }
      });
      activeRouters.push(lanRouter);

      const room1 = (await request(app).post('/api/lan/room').send({})).body;
      expect(lanRouter.getActiveRoomCount()).toBe(1);

      // Advance clock past 5-min TTL
      now += 300001;

      const joinExpired = await request(app).post('/api/lan/join').send({ code: room1.code });
      expect(joinExpired.status).toBe(410);
      expect(joinExpired.body.error).toBe('room_expired');
      expect(lanRouter.getActiveRoomCount()).toBe(0);

      // Create 2 more rooms, test sliding activity refresh on join
      const r2 = (await request(app).post('/api/lan/room').send({})).body;
      now += 200000; // 200s elapsed (< 300s)
      const join2 = await request(app).post('/api/lan/join').send({ code: r2.code });
      expect(join2.status).toBe(200);

      // 150s after join (350s since creation, but only 150s since join!) -> still alive!
      now += 150000;
      const sigRes = await request(app)
        .post('/api/lan/signal')
        .set('Authorization', `Bearer ${r2.peerToken}`)
        .send({ code: r2.code, type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' });
      expect(sigRes.status).toBe(200);

      // Advance past TTL with no activity -> sweeper clears it
      now += 300001;
      expect(lanRouter.sweepExpiredRooms()).toBe(1);
      expect(lanRouter.getActiveRoomCount()).toBe(0);
    });

    test('Enforces strict per-IP rate limits on room creation and join attempts', async () => {
      let now = 1700000000000;
      const clock = { now: () => now };
      const { app, lanRouter } = createTestServer({
        clock,
        config: {
          lanRoomRateMax: 3,
          lanJoinRateMax: 2,
          lanMaxRoomsPerIp: 10
        }
      });
      activeRouters.push(lanRouter);

      for (let i = 0; i < 3; i++) {
        const res = await request(app).post('/api/lan/room').send({});
        expect(res.status).toBe(201);
      }
      const rateLimitedRoom = await request(app).post('/api/lan/room').send({});
      expect(rateLimitedRoom.status).toBe(429);
      expect(rateLimitedRoom.body.error).toBe('rate_limit_exceeded');
      expect(rateLimitedRoom.headers['retry-after']).toBeDefined();

      // Join rate limit
      await request(app).post('/api/lan/join').send({ code: 'AAAAAA' });
      await request(app).post('/api/lan/join').send({ code: 'BBBBBB' });
      const rateLimitedJoin = await request(app).post('/api/lan/join').send({ code: 'CCCCCC' });
      expect(rateLimitedJoin.status).toBe(429);
    });

    test('Signal endpoint enforces 32 KiB size cap, rejects arbitrary fields/types, and sanitizes envelopes', async () => {
      const { app, lanRouter } = createTestServer({
        config: { lanSignalMaxBytes: 32 * 1024 }
      });
      activeRouters.push(lanRouter);

      const room = (await request(app).post('/api/lan/room').send({})).body;

      // Cannot signal before receiver joins
      const preJoin = await request(app)
        .post('/api/lan/signal')
        .set('Authorization', `Bearer ${room.peerToken}`)
        .send({ code: room.code, type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' });
      expect(preJoin.status).toBe(409);

      await request(app).post('/api/lan/join').send({ code: room.code });

      // Oversized payload > 32 KiB -> 413
      const hugeSdp = 'v=0\r\n' + 'a'.repeat(35 * 1024);
      const bigRes = await request(app)
        .post('/api/lan/signal')
        .set('Authorization', `Bearer ${room.peerToken}`)
        .send({ code: room.code, type: 'offer', sdp: hugeSdp });
      expect(bigRes.status).toBe(413);
      expect(bigRes.body.error).toBe('payload_too_large');

      // Disallowed signal type (attempting to send file bytes via signaling)
      const badType = await request(app)
        .post('/api/lan/signal')
        .set('Authorization', `Bearer ${room.peerToken}`)
        .send({ code: room.code, type: 'file-chunk', data: 'AAAA' });
      expect(badType.status).toBe(400);
      expect(badType.body.error).toBe('invalid_signal_type');

      // Malformed SDP without v=0
      const badSdp = await request(app)
        .post('/api/lan/signal')
        .set('Authorization', `Bearer ${room.peerToken}`)
        .send({ code: room.code, type: 'offer', sdp: 'not-an-sdp' });
      expect(badSdp.status).toBe(400);

      // Invalid ICE candidate
      const badIce = await request(app)
        .post('/api/lan/signal')
        .set('Authorization', `Bearer ${room.peerToken}`)
        .send({ code: room.code, type: 'ice', candidate: { candidate: 123, sdpMLineIndex: -1 } });
      expect(badIce.status).toBe(400);
    });
  });

  describe('2. Live HTTP SSE Signaling & Single-Use Ticket Flow', () => {
    test('Relays sanitized peer-joined, offer/answer/ice signals, and room-closed over real SSE stream', async () => {
      const { app, lanRouter } = createTestServer({}, true);
      activeRouters.push(lanRouter);

      const server = http.createServer(app);
      activeServers.push(server);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const baseUrl = `http://127.0.0.1:${server.address().port}`;

      const roomRes = await fetch(`${baseUrl}/api/lan/room`, { method: 'POST' });
      const senderRoom = await roomRes.json();
      expect(roomRes.status).toBe(201);

      const senderAbort = new AbortController();
      const senderEvents = [];
      const senderSseRes = await fetch(`${baseUrl}/api/lan/events?code=${senderRoom.code}`, {
        headers: { Authorization: `Bearer ${senderRoom.peerToken}` },
        signal: senderAbort.signal
      });
      expect(senderSseRes.status).toBe(200);
      expect(senderSseRes.headers.get('content-type')).toContain('text/event-stream');

      const senderReader = senderSseRes.body.getReader();
      const decoder = new TextDecoder();
      let senderBuf = '';
      const senderLoop = (async () => {
        try {
          while (true) {
            const { value, done } = await senderReader.read();
            if (done) break;
            senderBuf += decoder.decode(value, { stream: true });
            const blocks = senderBuf.split('\n\n');
            senderBuf = blocks.pop();
            for (const blk of blocks) {
              if (!blk.trim() || blk.startsWith(':')) continue;
              const evMatch = blk.match(/^event:\s*(.+)$/m);
              const dataMatch = blk.match(/^data:\s*(.+)$/m);
              if (evMatch && dataMatch) {
                senderEvents.push({ event: evMatch[1], data: JSON.parse(dataMatch[1]) });
              }
            }
          }
        } catch (_) {}
      })();

      // Receiver joins
      const joinRes = await fetch(`${baseUrl}/api/lan/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: senderRoom.code })
      });
      const receiverRoom = await joinRes.json();
      expect(joinRes.status).toBe(200);

      // Receiver connects SSE using single-use sseTicket (compatible with native EventSource)
      const receiverAbort = new AbortController();
      const receiverEvents = [];
      const recSseRes = await fetch(
        `${baseUrl}/api/lan/events?code=${receiverRoom.code}&ticket=${encodeURIComponent(receiverRoom.sseTicket)}`,
        { signal: receiverAbort.signal }
      );
      expect(recSseRes.status).toBe(200);

      // Reusing single-use ticket fails closed with 403
      const replayTicketRes = await fetch(
        `${baseUrl}/api/lan/events?code=${receiverRoom.code}&ticket=${encodeURIComponent(receiverRoom.sseTicket)}`
      );
      expect(replayTicketRes.status).toBe(403);

      const recReader = recSseRes.body.getReader();
      let recBuf = '';
      const recLoop = (async () => {
        try {
          while (true) {
            const { value, done } = await recReader.read();
            if (done) break;
            recBuf += decoder.decode(value, { stream: true });
            const blocks = recBuf.split('\n\n');
            recBuf = blocks.pop();
            for (const blk of blocks) {
              if (!blk.trim() || blk.startsWith(':')) continue;
              const evMatch = blk.match(/^event:\s*(.+)$/m);
              const dataMatch = blk.match(/^data:\s*(.+)$/m);
              if (evMatch && dataMatch) {
                receiverEvents.push({ event: evMatch[1], data: JSON.parse(dataMatch[1]) });
              }
            }
          }
        } catch (_) {}
      })();

      // Sender relays offer with sneaky extra field that server must strip
      const sigOfferRes = await fetch(`${baseUrl}/api/lan/signal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${senderRoom.peerToken}`
        },
        body: JSON.stringify({
          code: senderRoom.code,
          type: 'offer',
          sdp: 'v=0\r\no=- 111 2 IN IP4 127.0.0.1\r\n',
          extraMaliciousField: 'should-be-stripped'
        })
      });
      expect(sigOfferRes.status).toBe(200);

      // Receiver relays answer
      const sigAnswerRes = await fetch(`${baseUrl}/api/lan/signal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${receiverRoom.peerToken}`
        },
        body: JSON.stringify({
          code: receiverRoom.code,
          type: 'answer',
          sdp: 'v=0\r\no=- 222 2 IN IP4 127.0.0.1\r\n'
        })
      });
      expect(sigAnswerRes.status).toBe(200);

      await new Promise((r) => setTimeout(r, 40));

      expect(senderEvents.some((e) => e.event === 'ready')).toBe(true);
      expect(senderEvents.some((e) => e.event === 'peer-joined' && e.data.role === 'receiver')).toBe(true);
      const ansEvent = senderEvents.find((e) => e.event === 'signal' && e.data.type === 'answer');
      expect(ansEvent).toBeDefined();
      expect(ansEvent.data.from).toBe('receiver');

      const offerEvent = receiverEvents.find((e) => e.event === 'signal' && e.data.type === 'offer');
      expect(offerEvent).toBeDefined();
      expect(offerEvent.data.payload).toEqual({
        type: 'offer',
        sdp: 'v=0\r\no=- 111 2 IN IP4 127.0.0.1\r\n'
      });
      expect(offerEvent.data.payload.extraMaliciousField).toBeUndefined();

      // Close room and verify room-closed delivered
      const closeRes = await fetch(`${baseUrl}/api/lan/close`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${senderRoom.peerToken}`
        },
        body: JSON.stringify({ code: senderRoom.code })
      });
      expect(closeRes.status).toBe(200);

      await new Promise((r) => setTimeout(r, 30));
      expect(receiverEvents.some((e) => e.event === 'room-closed')).toBe(true);

      senderAbort.abort();
      receiverAbort.abort();
      await Promise.allSettled([senderLoop, recLoop]);
    });
  });

  describe('3. Client WebCrypto E2EE, Incremental SHA-256, & Protocol Security', () => {
    test('Code normalization, filename sanitization, and LAN-only iceServers default', () => {
      expect(normalizeRoomCode(' a2b - 9xz ')).toBe('A2B9XZ');
      expect(isValidRoomCode('A2B9XZ')).toBe(true);
      expect(isValidRoomCode('0O1ILA')).toBe(false);
      expect(PokedbLan.formatSas('042918')).toBe('042 918');
      expect(PokedbLan.sanitizeFilename('../../etc/passwd')).toBe('_.._etc_passwd');
      expect(PokedbLan.sanitizeFilename('...')).toBe('download.bin');
      expect(PokedbLan.sanitizeFilename('hello\x00world.txt')).toBe('hello_world.txt');

      const defaultRtc = PokedbLan._internal.buildRtcConfiguration({});
      expect(defaultRtc).toEqual({ iceServers: [] });

      const stunRtc = PokedbLan._internal.buildRtcConfiguration({ allowStun: true });
      expect(stunRtc.iceServers.length).toBeGreaterThan(0);
    });

    test('IncrementalSha256 matches Node crypto SHA-256 across boundary sizes', () => {
      const { IncrementalSha256 } = PokedbLan._internal;
      const lengths = [0, 1, 55, 56, 63, 64, 65, 128, 1024 * 65 + 17];
      for (const len of lengths) {
        const data = crypto.randomBytes(len);
        const expected = crypto.createHash('sha256').update(data).digest('hex');

        const hasher = new IncrementalSha256();
        // Feed in irregular chunks
        for (let off = 0; off < data.length; off += 19) {
          hasher.update(data.subarray(off, off + 19));
        }
        expect(hasher.digestHex()).toBe(expected);
      }
    });

    test('ECDH P-256 + HKDF-SHA-256 derives matching SAS/keys and detects MITM/tampering/reordering', async () => {
      const { generateEcdhKeyPair, importPeerEcdhPublicKey, deriveSessionCrypto, FRAME_TYPE_CHUNK } = PokedbLan._internal;
      const roomCode = 'K7M9P2';

      const senderKp = await generateEcdhKeyPair();
      const receiverKp = await generateEcdhKeyPair();
      const mitmKp = await generateEcdhKeyPair();

      const senderPeerKey = await importPeerEcdhPublicKey(receiverKp.publicKeyBase64Url);
      const receiverPeerKey = await importPeerEcdhPublicKey(senderKp.publicKeyBase64Url);
      const mitmPeerKey = await importPeerEcdhPublicKey(mitmKp.publicKeyBase64Url);

      const senderCrypto = await deriveSessionCrypto({
        role: 'sender',
        myPrivateKey: senderKp.keyPair.privateKey,
        myPublicKeyRaw: senderKp.publicKeyRaw,
        peerPublicKey: senderPeerKey.publicKey,
        peerPublicKeyRaw: senderPeerKey.publicKeyRaw,
        roomCode
      });

      const receiverCrypto = await deriveSessionCrypto({
        role: 'receiver',
        myPrivateKey: receiverKp.keyPair.privateKey,
        myPublicKeyRaw: receiverKp.publicKeyRaw,
        peerPublicKey: receiverPeerKey.publicKey,
        peerPublicKeyRaw: receiverPeerKey.publicKeyRaw,
        roomCode
      });

      expect(senderCrypto.sas).toMatch(/^\d{6}$/);
      expect(senderCrypto.sas).toBe(receiverCrypto.sas);

      // Wrong room code changes SAS
      const wrongRoomCrypto = await deriveSessionCrypto({
        role: 'receiver',
        myPrivateKey: receiverKp.keyPair.privateKey,
        myPublicKeyRaw: receiverKp.publicKeyRaw,
        peerPublicKey: receiverPeerKey.publicKey,
        peerPublicKeyRaw: receiverPeerKey.publicKeyRaw,
        roomCode: 'Z9X8C7'
      });
      expect(wrongRoomCrypto.sas).not.toBe(senderCrypto.sas);

      // MITM key changes SAS
      const mitmCrypto = await deriveSessionCrypto({
        role: 'sender',
        myPrivateKey: senderKp.keyPair.privateKey,
        myPublicKeyRaw: senderKp.publicKeyRaw,
        peerPublicKey: mitmPeerKey.publicKey,
        peerPublicKeyRaw: mitmPeerKey.publicKeyRaw,
        roomCode
      });
      expect(mitmCrypto.sas).not.toBe(receiverCrypto.sas);

      // Encrypt/Decrypt frames with AAD + anti-replay
      const payload0 = new Uint8Array([10, 20, 30, 40]);
      const payload1 = new Uint8Array([50, 60, 70, 80]);
      const frame0 = await senderCrypto.encryptFrame({
        frameType: FRAME_TYPE_CHUNK,
        transferId: 1,
        chunkIndex: 0,
        isFinal: false,
        plaintextBytes: payload0
      });
      const frame1 = await senderCrypto.encryptFrame({
        frameType: FRAME_TYPE_CHUNK,
        transferId: 1,
        chunkIndex: 1,
        isFinal: true,
        plaintextBytes: payload1
      });

      // Reordering frame1 before frame0 fails
      await expect(receiverCrypto.decryptFrame(frame1.slice(0))).rejects.toThrow(/counter/i);

      // Tampering with AAD header (chunkIndex byte) fails AES-GCM verification
      const tamperedHeader = new Uint8Array(frame0.slice(0));
      tamperedHeader[9] ^= 0x01;
      await expect(receiverCrypto.decryptFrame(tamperedHeader)).rejects.toThrow();

      // Tampering with ciphertext fails AES-GCM verification
      const tamperedCipher = new Uint8Array(frame0.slice(0));
      tamperedCipher[tamperedCipher.length - 1] ^= 0xff;
      await expect(receiverCrypto.decryptFrame(tamperedCipher)).rejects.toThrow();

      // Valid in-order decrypt succeeds
      const dec0 = await receiverCrypto.decryptFrame(frame0);
      expect(Array.from(dec0.plaintext)).toEqual([10, 20, 30, 40]);
      expect(dec0.chunkIndex).toBe(0);
      expect(dec0.isFinal).toBe(false);

      const dec1 = await receiverCrypto.decryptFrame(frame1);
      expect(Array.from(dec1.plaintext)).toEqual([50, 60, 70, 80]);
      expect(dec1.chunkIndex).toBe(1);
      expect(dec1.isFinal).toBe(true);

      // Replaying frame0 fails
      await expect(receiverCrypto.decryptFrame(frame0)).rejects.toThrow(/counter/i);
    });
  });

  describe('4. Full End-to-End P2P Transfer over Live Signaling + Mock WebRTC', () => {
    async function startLiveSignaling() {
      const { app, lanRouter } = createTestServer({}, true);
      activeRouters.push(lanRouter);
      const server = http.createServer(app);
      activeServers.push(server);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      return `http://127.0.0.1:${server.address().port}`;
    }

    test('Transfers multi-chunk binary file with SAS match, Accept gate, progress, and full SHA-256 verification', async () => {
      const apiBase = await startLiveSignaling();
      const MockPeerConnection = createInMemoryWebRtcPair();

      const fileBytes = crypto.randomBytes(175 * 1024); // > 2 x 64 KiB chunks
      const expectedSha = crypto.createHash('sha256').update(fileBytes).digest('hex');
      const file = makeMockFile('archive.bin', fileBytes, 'application/octet-stream');

      let senderSas = '';
      let receiverSas = '';
      let offerSeen = null;
      const senderProgress = [];
      const receiverProgress = [];

      const senderCompletePromise = new Promise((resolve, reject) => {
        const sender = PokedbLan.createSender({
          apiBase,
          RTCPeerConnection: MockPeerConnection,
          files: file,
          onSas: ({ sas }) => { senderSas = sas; },
          onProgress: (p) => senderProgress.push(p),
          onComplete: (res) => resolve(res),
          onError: reject
        });

        sender.start().then(({ code }) => {
          let receivedFile = null;
          const receiver = PokedbLan.createReceiver({
            apiBase,
            RTCPeerConnection: MockPeerConnection,
            code,
            onSas: ({ sas }) => { receiverSas = sas; },
            onFileOffer: async (offer) => {
              offerSeen = offer;
              expect(offer.files[0].name).toBe('archive.bin');
              expect(offer.files[0].size).toBe(fileBytes.length);
              expect(offer.files[0].sha256).toBe(expectedSha);
              await offer.accept();
            },
            onProgress: (p) => receiverProgress.push(p),
            onFileComplete: (f) => { receivedFile = f; },
            onComplete: async (summary) => {
              expect(summary.files).toHaveLength(1);
              expect(receivedFile.verified).toBe(true);
              expect(receivedFile.sha256).toBe(expectedSha);
              const receivedBytes = new Uint8Array(await receivedFile.blob.arrayBuffer());
              expect(Buffer.compare(Buffer.from(receivedBytes), fileBytes)).toBe(0);
            },
            onError: reject
          });
          receiver.join().catch(reject);
        }).catch(reject);
      });

      const senderResult = await senderCompletePromise;
      expect(senderResult.files).toHaveLength(1);
      expect(senderSas).toMatch(/^\d{6}$/);
      expect(senderSas).toBe(receiverSas);
      expect(offerSeen).not.toBeNull();
      expect(senderProgress.length).toBeGreaterThan(0);
      expect(receiverProgress.length).toBeGreaterThan(0);
      expect(receiverProgress[receiverProgress.length - 1].percent).toBe(100);
    });

    test('Receiver Decline gate blocks transfer before any file chunks are sent', async () => {
      const apiBase = await startLiveSignaling();
      const MockPeerConnection = createInMemoryWebRtcPair();
      const file = makeMockFile('secret.pdf', crypto.randomBytes(8192));

      let senderChunkProgressCalled = false;
      const senderDone = new Promise((resolve, reject) => {
        const sender = PokedbLan.createSender({
          apiBase,
          RTCPeerConnection: MockPeerConnection,
          files: file,
          onProgress: () => { senderChunkProgressCalled = true; },
          onReceiverDecision: (dec) => {
            expect(dec.accepted).toBe(false);
            resolve(dec);
          },
          onError: reject
        });

        sender.start().then(({ code }) => {
          const receiver = PokedbLan.createReceiver({
            apiBase,
            RTCPeerConnection: MockPeerConnection,
            code,
            onFileOffer: async (offer) => {
              await offer.decline('not_expected');
            },
            onFileComplete: () => {
              reject(new Error('Should not complete when declined'));
            },
            onError: reject
          });
          receiver.join().catch(reject);
        }).catch(reject);
      });

      await senderDone;
      expect(senderChunkProgressCalled).toBe(false);
    });

    test('Multi-file batch including 0-byte file transfers and verifies each file individually', async () => {
      const apiBase = await startLiveSignaling();
      const MockPeerConnection = createInMemoryWebRtcPair();

      const emptyFile = makeMockFile('empty.txt', new Uint8Array(0), 'text/plain');
      const secondBytes = crypto.randomBytes(70 * 1024);
      const secondFile = makeMockFile('notes.dat', secondBytes);

      const received = [];
      const donePromise = new Promise((resolve, reject) => {
        const sender = PokedbLan.createSender({
          apiBase,
          RTCPeerConnection: MockPeerConnection,
          onError: reject
        });

        sender.start().then(async ({ code }) => {
          await sender.setFiles([emptyFile, secondFile]);
          const receiver = PokedbLan.createReceiver({
            apiBase,
            RTCPeerConnection: MockPeerConnection,
            code,
            onFileOffer: (offer) => offer.accept(),
            onFileComplete: (f) => received.push(f),
            onComplete: () => resolve(),
            onError: reject
          });
          await receiver.join();
        }).catch(reject);
      });

      await donePromise;
      expect(received).toHaveLength(2);
      expect(received[0].name).toBe('empty.txt');
      expect(received[0].size).toBe(0);
      expect(received[0].verified).toBe(true);
      expect(received[1].name).toBe('notes.dat');
      expect(received[1].verified).toBe(true);
      const secondRecvBytes = new Uint8Array(await received[1].blob.arrayBuffer());
      expect(Buffer.compare(Buffer.from(secondRecvBytes), secondBytes)).toBe(0);
    });

    test('Backpressure pauses chunk loop when bufferedAmount exceeds 2 MiB and resumes on bufferedamountlow', async () => {
      const apiBase = await startLiveSignaling();
      let highWaterReached = false;
      let waitedOnLowEvent = false;
      const SlowDrainPeerConnection = createInMemoryWebRtcPair({
        channelDelayMs: 250
      });
      const OrigCreate = SlowDrainPeerConnection.prototype.createDataChannel;
      SlowDrainPeerConnection.prototype.createDataChannel = function (label, initOpts) {
        const ch = OrigCreate.call(this, label, initOpts);
        const origSend = ch.send.bind(ch);
        const origAdd = ch.addEventListener.bind(ch);
        ch.addEventListener = function (type, fn) {
          if (type === 'bufferedamountlow') {
            waitedOnLowEvent = true;
          }
          return origAdd(type, fn);
        };
        ch.send = function (payload) {
          const res = origSend(payload);
          if (ch.bufferedAmount > 2 * 1024 * 1024) {
            highWaterReached = true;
          }
          return res;
        };
        return ch;
      };

      const bigBytes = crypto.randomBytes(3 * 1024 * 1024); // 3 MiB -> > 2 MiB high water
      const expectedSha = crypto.createHash('sha256').update(bigBytes).digest('hex');
      const file = makeMockFile('large-stream.bin', bigBytes);

      let receivedFile = null;
      await new Promise((resolve, reject) => {
        const sender = PokedbLan.createSender({
          apiBase,
          RTCPeerConnection: SlowDrainPeerConnection,
          files: file,
          onComplete: () => resolve(),
          onError: reject
        });
        sender.start().then(({ code }) => {
          const receiver = PokedbLan.createReceiver({
            apiBase,
            RTCPeerConnection: SlowDrainPeerConnection,
            code,
            onFileOffer: (offer) => offer.accept(),
            onFileComplete: async (f) => {
              expect(f.verified).toBe(true);
              expect(f.sha256).toBe(expectedSha);
              const got = new Uint8Array(await f.blob.arrayBuffer());
              expect(got.length).toBe(bigBytes.length);
              receivedFile = f;
            },
            onError: reject
          });
          receiver.join().catch(reject);
        }).catch(reject);
      });

      expect(receivedFile.verified).toBe(true);
      expect(highWaterReached).toBe(true);
      expect(waitedOnLowEvent).toBe(true);
    });

    test('Supports writableStreamFactory direct-to-disk streaming and clean sender cancel/abort', async () => {
      const apiBase = await startLiveSignaling();
      const MockPeerConnection = createInMemoryWebRtcPair();

      const payload = crypto.randomBytes(90 * 1024);
      const expectedSha = crypto.createHash('sha256').update(payload).digest('hex');
      const file = makeMockFile('streamed.iso', payload);

      const writtenChunks = [];
      let streamClosed = false;

      await new Promise((resolve, reject) => {
        const sender = PokedbLan.createSender({
          apiBase,
          RTCPeerConnection: MockPeerConnection,
          files: file,
          onComplete: () => resolve(),
          onError: reject
        });
        sender.start().then(({ code }) => {
          const receiver = PokedbLan.createReceiver({
            apiBase,
            RTCPeerConnection: MockPeerConnection,
            code,
            writableStreamFactory: async () => ({
              async write(chunk) { writtenChunks.push(Buffer.from(chunk)); },
              async close() { streamClosed = true; },
              async abort() {}
            }),
            onFileOffer: (offer) => offer.accept(),
            onFileComplete: (f) => {
              expect(f.verified).toBe(true);
              expect(f.sha256).toBe(expectedSha);
              expect(f.blob).toBeNull();
            },
            onError: reject
          });
          receiver.join().catch(reject);
        }).catch(reject);
      });

      expect(streamClosed).toBe(true);
      expect(Buffer.compare(Buffer.concat(writtenChunks), payload)).toBe(0);

      // Sender cancel cleans up cleanly and notifies receiver
      const sender2 = PokedbLan.createSender({
        apiBase,
        RTCPeerConnection: MockPeerConnection,
        files: makeMockFile('cancel.bin', new Uint8Array([1, 2, 3]))
      });
      const { code: cancelCode } = await sender2.start();
      let receiver2;
      let resolveOfferSeen;
      const offerSeenPromise = new Promise((r) => { resolveOfferSeen = r; });
      const receiverClosedPromise = new Promise((resolve) => {
        receiver2 = PokedbLan.createReceiver({
          apiBase,
          RTCPeerConnection: MockPeerConnection,
          code: cancelCode,
          onFileOffer: () => { resolveOfferSeen(); },
          onStateChange: ({ state }) => {
            if (state === 'cancelled' || state === 'closed') {
              resolve(state);
            }
          }
        });
      });
      await receiver2.join();
      await offerSeenPromise;
      sender2.cancel('user_aborted');
      const finalReceiverState = await receiverClosedPromise;
      expect(sender2.state).toBe('cancelled');
      expect(['cancelled', 'closed']).toContain(finalReceiverState);
    });

    test('Tampered encrypted chunk in transit fails AEAD check and aborts before file completion', async () => {
      const apiBase = await startLiveSignaling();
      let sentDataFrames = 0;
      const TamperingPeerConnection = createInMemoryWebRtcPair({
        interceptWireFrame(frame, from) {
          if (from === 'sender' && frame instanceof ArrayBuffer) {
            sentDataFrames += 1;
            // Frame 1 = file-offer CTRL, Frame 2 = first CHUNK
            if (sentDataFrames === 2) {
              const copy = new Uint8Array(frame.slice(0));
              copy[copy.length - 3] ^= 0xff;
              return copy.buffer;
            }
          }
          return frame;
        }
      });

      const file = makeMockFile('tamper.bin', crypto.randomBytes(10000));
      let completed = false;

      const receiverErrorPromise = new Promise((resolve, reject) => {
        const sender = PokedbLan.createSender({
          apiBase,
          RTCPeerConnection: TamperingPeerConnection,
          files: file
        });
        sender.start().then(({ code }) => {
          const receiver = PokedbLan.createReceiver({
            apiBase,
            RTCPeerConnection: TamperingPeerConnection,
            code,
            onFileOffer: (offer) => offer.accept(),
            onFileComplete: () => {
              completed = true;
              reject(new Error('Tampered file must never complete'));
            },
            onError: (err) => resolve(err)
          });
          receiver.join().catch(reject);
        }).catch(reject);
      });

      const err = await receiverErrorPromise;
      expect(err).toBeInstanceOf(Error);
      expect(completed).toBe(false);
    });
  });

  describe('5. Standalone LAN Share Page Integration & Drop Separation', () => {
    let fullApp;
    let store;
    let clickBuffer;
    let fullLanRouter;

    beforeAll(() => {
      store = createSqliteStorage(':memory:');
      const created = createApp({
        store,
        objectStore: new FakeObjectStore(),
        config: {
          env: 'test',
          isProduction: false,
          baseUrl: 'https://pokedb.site',
          benchBypassLimiter: true
        }
      });
      fullApp = created.app;
      clickBuffer = created.clickBuffer;
      fullLanRouter = created.lanRouter;
    });

    afterAll(() => {
      if (fullLanRouter && typeof fullLanRouter.close === 'function') fullLanRouter.close();
      if (clickBuffer && typeof clickBuffer.close === 'function') clickBuffer.close();
      if (store && typeof store.close === 'function') store.close();
    });

    test('lan.js moved cleanly from tools/drop/public/lan.js to tools/lan/public/lan.js', () => {
      const oldLanPath = path.resolve(__dirname, '../tools/drop/public/lan.js');
      const newLanPath = path.resolve(__dirname, '../tools/lan/public/lan.js');
      expect(fs.existsSync(oldLanPath)).toBe(false);
      expect(fs.existsSync(newLanPath)).toBe(true);
    });

    test('GET /tools/lan/ serves HTTP 200 HTML with X-Robots-Tag: index, follow, clean UI, and no Drop coupling', async () => {
      const res = await request(fullApp).get('/tools/lan/').set('Host', 'pokedb.site');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['x-robots-tag']).toBe('index, follow');

      const html = res.text;
      expect(html).toContain('<body class="tool-page">');
      expect(html).toContain('<h1>LAN Direct Share</h1>');
      expect(html).toContain('class="clean-tabs"');
      expect(html).toContain('id="lan-mode-send-btn"');
      expect(html).toContain('id="lan-mode-recv-btn"');
      expect(html).toContain('id="lan-select-files-btn"');
      expect(html).toContain('id="lan-join-code-input"');
      expect(html).toContain('href="/shared/theme.css"');
      expect(html).toContain('href="/fonts/fonts.css"');
      expect(html).toContain('src="/shared/theme-switcher.js?v=3"');
      expect(html).toContain('src="/shared/utils.js"');
      expect(html).toContain('src="/shared/qrcode.min.js"');
      expect(html).toContain('src="/shared/site.js"');
      expect(html).toContain('src="./lan.js"');
      expect(html).toContain('src="./app.js"');

      // Zero AI slop & zero inline JS / third-party CDNs / analytics
      expect(html).not.toMatch(/\$\s+lan\b/i);
      expect(html).not.toContain('● LIVE');
      expect(html).not.toContain('● E2EE VERIFY');
      expect(html).not.toContain('ZERO UPLOAD');
      expect(html).not.toContain('class="eyebrow"');
      expect(html).not.toContain('term-titlebar');
      expect(html).not.toContain('term-dots');
      expect(html).not.toContain('beacon.min.js');
      expect(html).not.toContain('cloudflareinsights.com');
      expect(html).not.toContain('fonts.googleapis.com');
      expect(html).not.toContain('fonts.gstatic.com');
      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
      expect(html).not.toMatch(/\son(?:click|change|input|load|submit|keydown)=/i);

      // Strict separation from Drop
      expect(html).not.toContain('/api/drop/');
      expect(html).not.toContain('Cloud Upload (R2)');
      expect(html).not.toContain('Burn after download');
      expect(html).not.toContain('File Manager');

      // Keyboard Tab-stop reachability: #lan-select-files-btn <= 12 stops from top
      const focusableMatches = Array.from(
        html.matchAll(/<(?:a\b[^>]*\bhref=|button\b|input\b|select\b|textarea\b)[^>]*>/gi)
      ).map((m) => m[0]).filter((tag) => (
        !/\btype=["']?hidden/i.test(tag) &&
        !/\bhidden\b/i.test(tag) &&
        !/\bdisabled\b/i.test(tag) &&
        !/\btabindex=["']?-1/i.test(tag)
      ));
      const selectBtnIdx = focusableMatches.findIndex((tag) => tag.includes('id="lan-select-files-btn"'));
      expect(selectBtnIdx).toBeGreaterThanOrEqual(0);
      expect(selectBtnIdx + 1).toBeLessThanOrEqual(12);
    });

    test('Host: lan.pokedb.site serves HTTP 200 HTML with X-Robots-Tag: index, follow and valid robots.txt', async () => {
      const rootRes = await request(fullApp).get('/').set('Host', 'lan.pokedb.site');
      expect(rootRes.status).toBe(200);
      expect(rootRes.headers['content-type']).toContain('text/html');
      expect(rootRes.headers['x-robots-tag']).toBe('index, follow');
      expect(rootRes.text).toContain('<h1>LAN Direct Share</h1>');
      expect(rootRes.text).toContain('<body class="tool-page">');

      const robotsRes = await request(fullApp).get('/robots.txt').set('Host', 'lan.pokedb.site');
      expect(robotsRes.status).toBe(200);
      expect(robotsRes.text).toContain('Allow: /$');
      expect(robotsRes.text).toContain('Disallow: /api/');
    });

    test('Standalone LAN assets serve HTTP 200 on subpath and subdomain with ?code= and ?lan= support', async () => {
      const pathLanJs = await request(fullApp).get('/tools/lan/lan.js').set('Host', 'pokedb.site');
      expect(pathLanJs.status).toBe(200);
      expect(pathLanJs.headers['content-type']).toContain('javascript');
      expect(pathLanJs.text).toContain('PokedbLan');

      const subAppJs = await request(fullApp).get('/app.js').set('Host', 'lan.pokedb.site');
      expect(subAppJs.status).toBe(200);
      expect(subAppJs.headers['content-type']).toContain('javascript');
      expect(subAppJs.text).toContain("'?code='");
      expect(subAppJs.text).toContain("params.get('code')");
      expect(subAppJs.text).toContain("params.get('lan')");
      expect(subAppJs.text).not.toContain('/api/drop/');

      const pathAppJs = await request(fullApp).get('/tools/lan/app.js').set('Host', 'pokedb.site');
      expect(pathAppJs.status).toBe(200);
      expect(pathAppJs.text).toBe(subAppJs.text);
    });
  });
});
