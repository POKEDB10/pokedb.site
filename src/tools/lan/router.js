// src/tools/lan/router.js
// Ephemeral in-memory WebRTC LAN signaling router (Zero disk/SQLite persistence, zero file bytes).

const express = require('express');
const crypto = require('node:crypto');

const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const ROOM_CODE_LENGTH = 6;
const DEFAULT_ROOM_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 30 * 1000;
const DEFAULT_SIGNAL_MAX_BYTES = 32 * 1024;
const DEFAULT_SDP_MAX_CHARS = 24 * 1024;
const DEFAULT_CANDIDATE_MAX_CHARS = 1024;
const DEFAULT_MAX_ROOMS = 2000;
const DEFAULT_MAX_ROOMS_PER_IP = 10;
const DEFAULT_MAX_EVENT_QUEUE = 64;
const DEFAULT_EVENT_HISTORY = 32;
const DEFAULT_HEARTBEAT_MS = 20 * 1000;
const SSE_TICKET_TTL_MS = 60 * 1000;
const VALID_SIGNAL_TYPES = new Set(['offer', 'answer', 'ice', 'reject', 'bye']);
const ROOM_CODE_REGEX = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

function normalizeRoomCode(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/[\s-]+/g, '').toUpperCase();
}

function isValidRoomCode(code) {
  return typeof code === 'string' && ROOM_CODE_REGEX.test(code);
}

function sha256Buf(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function timingSafeHashMatch(candidate, expectedHashBuf) {
  if (typeof candidate !== 'string' || !candidate || !Buffer.isBuffer(expectedHashBuf)) {
    return false;
  }
  const candHash = sha256Buf(candidate);
  if (candHash.length !== expectedHashBuf.length) return false;
  return crypto.timingSafeEqual(candHash, expectedHashBuf);
}

function generateRoomCode(roomsMap) {
  for (let attempt = 0; attempt < 32; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[crypto.randomInt(0, ROOM_CODE_ALPHABET.length)];
    }
    if (!roomsMap.has(code)) {
      return code;
    }
  }
  throw new Error('Unable to allocate unique LAN pairing code');
}

function createPeerId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function createRandomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function extractPeerToken(req) {
  const authHeader = (typeof req.get === 'function' ? req.get('authorization') : req.headers?.authorization) || '';
  if (/^bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^bearer\s+/i, '').trim();
  }
  const customHeader = (typeof req.get === 'function' ? req.get('x-lan-token') : req.headers?.['x-lan-token']) || '';
  return typeof customHeader === 'string' ? customHeader.trim() : '';
}

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function setNoStoreSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex');
}

function createMemoryIpLimiter({ windowMs, max, clock, benchBypass, message }) {
  const buckets = new Map();

  function prune(now) {
    if (buckets.size < 2000) return;
    for (const [key, entry] of buckets.entries()) {
      if (entry.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }

  return function ipLimiter(req, res, next) {
    if (benchBypass) return next();

    const now = clock.now();
    prune(now);

    const ip = getClientIp(req);
    let entry = buckets.get(ip);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, entry);
    }

    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    const resetSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetSeconds));

    if (entry.count > max) {
      res.setHeader('Retry-After', String(resetSeconds));
      return res.status(429).json({
        error: 'rate_limit_exceeded',
        message
      });
    }

    return next();
  };
}

function sanitizeSignalPayload(body, maxSdpChars, maxCandidateChars) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_signal_body', message: 'Request body must be a JSON object.' };
  }

  const type = typeof body.type === 'string' ? body.type.trim().toLowerCase() : '';
  if (!VALID_SIGNAL_TYPES.has(type)) {
    return { ok: false, error: 'invalid_signal_type', message: 'Signal type must be offer, answer, ice, reject, or bye.' };
  }

  if (type === 'offer' || type === 'answer') {
    const sdp = body.sdp;
    if (typeof sdp !== 'string' || sdp.length < 3 || sdp.length > maxSdpChars) {
      return { ok: false, error: 'invalid_sdp', message: 'SDP must be a valid non-empty string within size limits.' };
    }
    if (!sdp.startsWith('v=0')) {
      return { ok: false, error: 'invalid_sdp', message: 'SDP must begin with v=0.' };
    }
    return { ok: true, envelope: { type, sdp } };
  }

  if (type === 'ice') {
    const candidate = body.candidate;
    if (candidate === null) {
      return { ok: true, envelope: { type: 'ice', candidate: null } };
    }
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return { ok: false, error: 'invalid_ice_candidate', message: 'ICE candidate must be an object or null.' };
    }
    if (typeof candidate.candidate !== 'string' || candidate.candidate.length > maxCandidateChars) {
      return { ok: false, error: 'invalid_ice_candidate', message: 'ICE candidate string is missing or exceeds limit.' };
    }
    let sdpMid = null;
    if (candidate.sdpMid !== undefined && candidate.sdpMid !== null) {
      if (typeof candidate.sdpMid !== 'string' || candidate.sdpMid.length > 64) {
        return { ok: false, error: 'invalid_ice_candidate', message: 'Invalid ICE sdpMid field.' };
      }
      sdpMid = candidate.sdpMid;
    }
    let sdpMLineIndex = null;
    if (candidate.sdpMLineIndex !== undefined && candidate.sdpMLineIndex !== null) {
      if (!Number.isInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex < 0 || candidate.sdpMLineIndex > 64) {
        return { ok: false, error: 'invalid_ice_candidate', message: 'Invalid ICE sdpMLineIndex field.' };
      }
      sdpMLineIndex = candidate.sdpMLineIndex;
    }
    const sanitized = {
      candidate: candidate.candidate,
      sdpMid,
      sdpMLineIndex
    };
    if (typeof candidate.usernameFragment === 'string' && candidate.usernameFragment.length <= 128) {
      sanitized.usernameFragment = candidate.usernameFragment;
    }
    return { ok: true, envelope: { type: 'ice', candidate: sanitized } };
  }

  // reject or bye
  let reason = '';
  if (typeof body.reason === 'string') {
    reason = body.reason.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 128);
  }
  return {
    ok: true,
    envelope: reason ? { type, reason } : { type }
  };
}

function createLanRouter({ limiters = {}, config = {}, clock = Date } = {}) {
  const router = express.Router();
  const rooms = new Map();
  const activeRoomsByIp = new Map();

  const ttlMs = Number(config.lanRoomTtlMs) > 0 ? Number(config.lanRoomTtlMs) : DEFAULT_ROOM_TTL_MS;
  const cleanupIntervalMs = Number(config.lanCleanupIntervalMs) > 0
    ? Number(config.lanCleanupIntervalMs)
    : DEFAULT_CLEANUP_INTERVAL_MS;
  const maxSignalBytes = Number(config.lanSignalMaxBytes) > 0
    ? Number(config.lanSignalMaxBytes)
    : DEFAULT_SIGNAL_MAX_BYTES;
  const maxSdpChars = Number(config.lanSdpMaxChars) > 0 ? Number(config.lanSdpMaxChars) : DEFAULT_SDP_MAX_CHARS;
  const maxCandidateChars = Number(config.lanCandidateMaxChars) > 0
    ? Number(config.lanCandidateMaxChars)
    : DEFAULT_CANDIDATE_MAX_CHARS;
  const maxRooms = Number(config.lanMaxRooms) > 0 ? Number(config.lanMaxRooms) : DEFAULT_MAX_ROOMS;
  const maxRoomsPerIp = Number(config.lanMaxRoomsPerIp) > 0 ? Number(config.lanMaxRoomsPerIp) : DEFAULT_MAX_ROOMS_PER_IP;
  const heartbeatMs = Number(config.lanHeartbeatMs) > 0 ? Number(config.lanHeartbeatMs) : DEFAULT_HEARTBEAT_MS;
  const benchBypass = Boolean(config.benchBypassLimiter);

  const roomLimiter = limiters.lanRoomLimiter || createMemoryIpLimiter({
    windowMs: Number(config.lanRoomWindowMs) || 15 * 60 * 1000,
    max: Number(config.lanRoomRateMax) || 20,
    clock,
    benchBypass,
    message: 'Too many LAN pairing rooms created from this IP. Please try again later.'
  });

  const joinLimiter = limiters.lanJoinLimiter || createMemoryIpLimiter({
    windowMs: Number(config.lanJoinWindowMs) || 5 * 60 * 1000,
    max: Number(config.lanJoinRateMax) || 30,
    clock,
    benchBypass,
    message: 'Too many LAN pairing join attempts from this IP. Please slow down.'
  });

  const signalLimiter = limiters.lanSignalLimiter || createMemoryIpLimiter({
    windowMs: Number(config.lanSignalWindowMs) || 60 * 1000,
    max: Number(config.lanSignalRateMax) || 240,
    clock,
    benchBypass,
    message: 'Too many LAN signaling messages sent. Please slow down.'
  });

  const eventsLimiter = limiters.lanEventsLimiter || createMemoryIpLimiter({
    windowMs: Number(config.lanEventsWindowMs) || 5 * 60 * 1000,
    max: Number(config.lanEventsRateMax) || 60,
    clock,
    benchBypass,
    message: 'Too many SSE stream connections from this IP.'
  });

  function closePeerStream(peer, closedPayload) {
    if (!peer) return;
    if (peer.heartbeatTimer) {
      clearInterval(peer.heartbeatTimer);
      peer.heartbeatTimer = null;
    }
    if (peer.sseRes) {
      const res = peer.sseRes;
      peer.sseRes = null;
      if (!res.writableEnded) {
        if (closedPayload) {
          try {
            res.write(`event: room-closed\ndata: ${JSON.stringify(closedPayload)}\n\n`);
          } catch (_) {}
        }
        try {
          res.end();
        } catch (_) {}
      }
    }
  }

  function destroyRoom(code, reason = 'closed', extra = {}) {
    const room = rooms.get(code);
    if (!room) return false;
    rooms.delete(code);
    room.closed = true;

    const ipCount = activeRoomsByIp.get(room.creatorIp) || 0;
    if (ipCount <= 1) {
      activeRoomsByIp.delete(room.creatorIp);
    } else {
      activeRoomsByIp.set(room.creatorIp, ipCount - 1);
    }

    const closedPayload = {
      type: 'room-closed',
      reason,
      ...extra,
      timestamp: clock.now()
    };
    closePeerStream(room.sender, closedPayload);
    closePeerStream(room.receiver, closedPayload);
    return true;
  }

  function sweepExpiredRooms() {
    const now = clock.now();
    let swept = 0;
    for (const [code, room] of rooms.entries()) {
      if (room.closed || now >= room.expiresAt) {
        destroyRoom(code, 'expired');
        swept += 1;
      }
    }
    return swept;
  }

  const cleanupTimer = setInterval(() => {
    sweepExpiredRooms();
  }, cleanupIntervalMs);
  if (typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }

  function createPeerSlot(role, now) {
    const peerId = createPeerId(role === 'sender' ? 's' : 'r');
    const peerToken = createRandomToken(24);
    const sseTicket = createRandomToken(18);
    const slot = {
      id: peerId,
      role,
      tokenHash: sha256Buf(peerToken),
      ticketHash: sha256Buf(sseTicket),
      ticketExpiresAt: now + SSE_TICKET_TTL_MS,
      sseRes: null,
      heartbeatTimer: null,
      nextEventId: 1,
      queue: [],
      history: []
    };
    return { slot, peerToken, sseTicket };
  }

  function emitToPeer(peer, eventName, dataObj) {
    if (!peer) return { ok: false, delivered: false };
    const eventId = peer.nextEventId++;
    const frame = `id: ${eventId}\nevent: ${eventName}\ndata: ${JSON.stringify(dataObj)}\n\n`;

    peer.history.push({ id: eventId, frame });
    if (peer.history.length > DEFAULT_EVENT_HISTORY) {
      peer.history.shift();
    }

    if (peer.sseRes && !peer.sseRes.writableEnded) {
      try {
        peer.sseRes.write(frame);
        return { ok: true, delivered: true, eventId };
      } catch (_) {
        closePeerStream(peer);
      }
    }

    if (peer.queue.length >= DEFAULT_MAX_EVENT_QUEUE) {
      return { ok: false, queueFull: true, delivered: false };
    }
    peer.queue.push({ id: eventId, frame });
    return { ok: true, delivered: false, queued: true, eventId };
  }

  function resolveAuthenticatedPeer(room, token, ticket, now) {
    const peers = [room.sender, room.receiver].filter(Boolean);
    if (token) {
      for (const peer of peers) {
        if (timingSafeHashMatch(token, peer.tokenHash)) {
          return peer;
        }
      }
      return null;
    }
    if (ticket) {
      for (const peer of peers) {
        if (peer.ticketHash && peer.ticketExpiresAt > now && timingSafeHashMatch(ticket, peer.ticketHash)) {
          // Single-use ticket: consume immediately upon opening SSE
          peer.ticketHash = null;
          peer.ticketExpiresAt = 0;
          return peer;
        }
      }
      return null;
    }
    return null;
  }

  function checkRoomStatus(rawCode) {
    const code = normalizeRoomCode(rawCode);
    if (!isValidRoomCode(code)) {
      return {
        ok: false,
        status: 400,
        error: 'invalid_room_code',
        message: 'Pairing code must be 6 valid characters (letters/digits excluding 0, O, 1, I, L).'
      };
    }

    const room = rooms.get(code);
    if (!room) {
      return {
        ok: false,
        status: 404,
        error: 'room_not_found',
        message: 'Pairing room not found or has expired.'
      };
    }

    const now = clock.now();
    if (room.closed) {
      destroyRoom(code, 'closed');
      return {
        ok: false,
        status: 410,
        error: 'room_closed',
        message: 'Pairing room has been closed.'
      };
    }

    if (now >= room.expiresAt) {
      destroyRoom(code, 'expired');
      return {
        ok: false,
        status: 410,
        error: 'room_expired',
        message: 'Pairing room has expired due to inactivity.'
      };
    }

    return { ok: true, code, room, now };
  }

  // Enforce compact JSON parsing when router is mounted standalone without app.js parser
  router.use('/api/lan', (req, res, next) => {
    setNoStoreSecurityHeaders(res);
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const contentLength = Number(req.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > maxSignalBytes) {
      return res.status(413).json({
        error: 'payload_too_large',
        message: `LAN signaling payload exceeds ${maxSignalBytes} bytes.`
      });
    }
    if (req.body !== undefined) {
      if (req.body && Buffer.byteLength(JSON.stringify(req.body), 'utf8') > maxSignalBytes) {
        return res.status(413).json({
          error: 'payload_too_large',
          message: `LAN signaling payload exceeds ${maxSignalBytes} bytes.`
        });
      }
      return next();
    }
    return express.json({ limit: maxSignalBytes })(req, res, next);
  });

  // 1. POST /api/lan/room — Create ephemeral 2-peer room (sender)
  router.post('/api/lan/room', roomLimiter, (req, res) => {
    sweepExpiredRooms();

    const creatorIp = getClientIp(req);
    const ipRoomCount = activeRoomsByIp.get(creatorIp) || 0;
    if (ipRoomCount >= maxRoomsPerIp) {
      return res.status(429).json({
        error: 'too_many_active_rooms',
        message: 'Too many active LAN pairing rooms from this IP.'
      });
    }

    if (rooms.size >= maxRooms) {
      return res.status(503).json({
        error: 'lan_capacity_reached',
        message: 'LAN signaling capacity temporarily reached. Please retry shortly.'
      });
    }

    const now = clock.now();
    const code = generateRoomCode(rooms);
    const { slot: senderSlot, peerToken, sseTicket } = createPeerSlot('sender', now);

    const room = {
      code,
      creatorIp,
      createdAt: now,
      lastActivityAt: now,
      expiresAt: now + ttlMs,
      ttlMs,
      state: 'waiting',
      closed: false,
      sender: senderSlot,
      receiver: null
    };

    rooms.set(code, room);
    activeRoomsByIp.set(creatorIp, ipRoomCount + 1);

    return res.status(201).json({
      success: true,
      code,
      role: 'sender',
      peerId: senderSlot.id,
      peerToken,
      sseTicket,
      maxPeers: 2,
      peerCount: 1,
      ttlMs,
      expiresAt: room.expiresAt
    });
  });

  // 2. POST /api/lan/join — Receiver joins room by 6-char code (strict max 2 peers lock)
  router.post('/api/lan/join', joinLimiter, (req, res) => {
    const check = checkRoomStatus(req.body?.code);
    if (!check.ok) {
      return res.status(check.status).json({ error: check.error, message: check.message });
    }

    const { code, room, now } = check;
    if (room.receiver !== null || room.state !== 'waiting') {
      return res.status(409).json({
        error: 'room_full',
        message: 'Pairing room already has 2 peers and is locked.'
      });
    }

    const { slot: receiverSlot, peerToken, sseTicket } = createPeerSlot('receiver', now);
    room.receiver = receiverSlot;
    room.state = 'paired';
    room.lastActivityAt = now;
    room.expiresAt = now + room.ttlMs;

    emitToPeer(room.sender, 'peer-joined', {
      type: 'peer-joined',
      role: 'receiver',
      peerId: receiverSlot.id,
      timestamp: now
    });

    return res.status(200).json({
      success: true,
      code,
      role: 'receiver',
      peerId: receiverSlot.id,
      peerToken,
      sseTicket,
      maxPeers: 2,
      peerCount: 2,
      ttlMs: room.ttlMs,
      expiresAt: room.expiresAt
    });
  });

  // 3. POST /api/lan/ticket — Mint fresh single-use 60s SSE ticket for EventSource reconnects
  router.post('/api/lan/ticket', eventsLimiter, (req, res) => {
    const check = checkRoomStatus(req.body?.code || req.query?.code);
    if (!check.ok) {
      return res.status(check.status).json({ error: check.error, message: check.message });
    }
    const { room, now } = check;
    const token = extractPeerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'unauthorized', message: 'Peer authentication token required.' });
    }
    const peer = resolveAuthenticatedPeer(room, token, '', now);
    if (!peer) {
      return res.status(403).json({ error: 'forbidden', message: 'Invalid peer token for this room.' });
    }

    const sseTicket = createRandomToken(18);
    peer.ticketHash = sha256Buf(sseTicket);
    peer.ticketExpiresAt = now + SSE_TICKET_TTL_MS;

    return res.status(200).json({
      success: true,
      sseTicket,
      expiresAt: peer.ticketExpiresAt
    });
  });

  // 4. GET /api/lan/events — Server-Sent Events stream for authenticated peer
  router.get('/api/lan/events', eventsLimiter, (req, res) => {
    const check = checkRoomStatus(req.query?.code);
    if (!check.ok) {
      return res.status(check.status).json({ error: check.error, message: check.message });
    }

    const { code, room, now } = check;
    const headerToken = extractPeerToken(req);
    const queryTicket = typeof req.query?.ticket === 'string' ? req.query.ticket.trim() : '';
    const queryTokenFallback = typeof req.query?.token === 'string' ? req.query.token.trim() : '';
    const effectiveToken = headerToken || queryTokenFallback;

    if (!effectiveToken && !queryTicket) {
      return res.status(401).json({ error: 'unauthorized', message: 'Authentication header or SSE ticket required.' });
    }

    const peer = resolveAuthenticatedPeer(room, effectiveToken, queryTicket, now);
    if (!peer) {
      return res.status(403).json({ error: 'forbidden', message: 'Invalid or expired peer credentials.' });
    }

    // Replace any stale SSE stream for the same peer cleanly
    if (peer.sseRes) {
      closePeerStream(peer);
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    setNoStoreSecurityHeaders(res);
    req.socket?.setNoDelay?.(true);
    res.flushHeaders?.();

    peer.sseRes = res;
    room.lastActivityAt = now;
    room.expiresAt = now + room.ttlMs;

    res.write(': connected\n\n');
    res.write(`event: ready\ndata: ${JSON.stringify({
      role: peer.role,
      peerId: peer.id,
      peerCount: room.receiver ? 2 : 1,
      expiresAt: room.expiresAt
    })}\n\n`);

    const lastEventIdRaw = typeof req.get === 'function' ? req.get('last-event-id') : req.headers?.['last-event-id'];
    const lastEventId = lastEventIdRaw ? Number(lastEventIdRaw) : NaN;
    if (Number.isInteger(lastEventId) && lastEventId >= 0) {
      const sentIds = new Set();
      for (const item of peer.history) {
        if (item.id > lastEventId) {
          res.write(item.frame);
          sentIds.add(item.id);
        }
      }
      for (const item of peer.queue) {
        if (item.id > lastEventId && !sentIds.has(item.id)) {
          res.write(item.frame);
        }
      }
      peer.queue.length = 0;
    } else if (peer.queue.length > 0) {
      for (const item of peer.queue) {
        res.write(item.frame);
      }
      peer.queue.length = 0;
    }

    peer.heartbeatTimer = setInterval(() => {
      if (res.writableEnded) {
        closePeerStream(peer);
        return;
      }
      const tickNow = clock.now();
      if (room.closed || tickNow >= room.expiresAt || !rooms.has(code)) {
        destroyRoom(code, 'expired');
        return;
      }
      try {
        res.write(`: ping ${tickNow}\n\n`);
      } catch (_) {
        closePeerStream(peer);
      }
    }, heartbeatMs);
    if (typeof peer.heartbeatTimer.unref === 'function') {
      peer.heartbeatTimer.unref();
    }

    const onDisconnect = () => {
      if (peer.sseRes === res) {
        if (peer.heartbeatTimer) {
          clearInterval(peer.heartbeatTimer);
          peer.heartbeatTimer = null;
        }
        peer.sseRes = null;
      }
    };
    req.on('close', onDisconnect);
    res.on('close', onDisconnect);
  });

  // 5. POST /api/lan/signal — Authenticated peer relays sanitized SDP/ICE/control to the other peer
  router.post('/api/lan/signal', signalLimiter, (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'invalid_signal_body', message: 'Request body must be a JSON object.' });
    }

    const payloadBytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
    if (payloadBytes > maxSignalBytes) {
      return res.status(413).json({
        error: 'payload_too_large',
        message: `Signaling payload exceeds ${maxSignalBytes} bytes limit.`
      });
    }

    const check = checkRoomStatus(body.code);
    if (!check.ok) {
      return res.status(check.status).json({ error: check.error, message: check.message });
    }

    const { room, now } = check;
    const token = extractPeerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'unauthorized', message: 'Authorization Bearer or X-Lan-Token header required.' });
    }

    const senderPeer = resolveAuthenticatedPeer(room, token, '', now);
    if (!senderPeer) {
      return res.status(403).json({ error: 'forbidden', message: 'Invalid peer token for this room.' });
    }

    const sanitized = sanitizeSignalPayload(body, maxSdpChars, maxCandidateChars);
    if (!sanitized.ok) {
      return res.status(400).json({ error: sanitized.error, message: sanitized.message });
    }

    const targetPeer = senderPeer.role === 'sender' ? room.receiver : room.sender;
    if (!targetPeer) {
      return res.status(409).json({
        error: 'peer_not_joined',
        message: 'Cannot relay signal before receiver joins the pairing room.'
      });
    }

    room.lastActivityAt = now;
    room.expiresAt = now + room.ttlMs;

    const signalEvent = {
      type: sanitized.envelope.type,
      from: senderPeer.role,
      fromPeerId: senderPeer.id,
      payload: sanitized.envelope,
      timestamp: now
    };

    const result = emitToPeer(targetPeer, 'signal', signalEvent);
    if (!result.ok && result.queueFull) {
      return res.status(429).json({
        error: 'signal_queue_full',
        message: 'Peer signaling queue is full; waiting for peer stream consumption.'
      });
    }

    return res.status(200).json({
      success: true,
      delivered: Boolean(result.delivered),
      queued: Boolean(result.queued),
      eventId: result.eventId
    });
  });

  // 6. POST /api/lan/close — Authenticated peer cleanly closes pairing room
  router.post('/api/lan/close', (req, res) => {
    const check = checkRoomStatus(req.body?.code || req.query?.code);
    if (!check.ok) {
      return res.status(check.status).json({ error: check.error, message: check.message });
    }

    const { code, room, now } = check;
    const token = extractPeerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'unauthorized', message: 'Peer authentication token required.' });
    }

    const peer = resolveAuthenticatedPeer(room, token, '', now);
    if (!peer) {
      return res.status(403).json({ error: 'forbidden', message: 'Invalid peer token for this room.' });
    }

    destroyRoom(code, 'closed_by_peer', { by: peer.role });
    return res.status(200).json({ success: true, closed: true });
  });

  // Handle body-parser JSON syntax / payload size errors cleanly
  router.use('/api/lan', (err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
      return res.status(413).json({
        error: 'payload_too_large',
        message: `LAN signaling payload exceeds ${maxSignalBytes} bytes limit.`
      });
    }
    if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
      return res.status(400).json({
        error: 'invalid_json',
        message: 'Malformed JSON body.'
      });
    }
    return next(err);
  });

  router.sweepExpiredRooms = sweepExpiredRooms;
  router.getActiveRoomCount = () => {
    sweepExpiredRooms();
    return rooms.size;
  };
  router.close = () => {
    clearInterval(cleanupTimer);
    for (const code of Array.from(rooms.keys())) {
      destroyRoom(code, 'server_shutdown');
    }
  };

  return router;
}

module.exports = {
  createLanRouter,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  DEFAULT_ROOM_TTL_MS,
  DEFAULT_SIGNAL_MAX_BYTES,
  normalizeRoomCode,
  isValidRoomCode,
  sanitizeSignalPayload
};
