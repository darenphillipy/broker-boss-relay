#!/usr/bin/env node
/**
 * relay-server.js
 * Broker Boss Online — Multiplayer Relay Server
 *
 * Run with: node relay-server.js
 * Listens on ws://<this-machine's-address>:8081 by default (PORT env var
 * to override).
 *
 * -----------------------------------------------------------------------
 * WHAT THIS IS AND ISN'T
 *
 * This is a real, working WebSocket server — room creation, joining,
 * host controls, and a server-authoritative game engine that actually
 * runs your real engine.bundle.js server-side (loaded via Node's vm
 * module, the exact same technique used to test every card handler this
 * whole project). It is NOT, by itself, something other people on other
 * devices can already reach — it's a process that needs to be RUN
 * somewhere network-reachable to those devices:
 *   - Same room / same LAN: run this on one machine, have other devices
 *     connect to that machine's local network IP (e.g. ws://192.168.1.
 *     23:8081) instead of localhost.
 *   - Different networks / the real internet: this machine needs a
 *     public address — either port-forwarding on your router, or
 *     deploying this file to a host (Render, Fly.io, a VPS, etc.) that
 *     gives you a public URL. That deployment step is infrastructure
 *     work outside what I can do from here; this file is what you'd run
 *     wherever you host it.
 *
 * WHY SERVER-AUTHORITATIVE (not just relaying raw clicks)
 *
 * Broker Boss's engine has real RNG (shuffles, bot decisions) baked into
 * game logic. If every client ran the engine independently off the same
 * relayed actions, any tiny timing/ordering difference could silently
 * diverge two players' game states from each other with no way to
 * detect it. Instead, this server holds the one real game state per
 * room, applies every action through the actual engine, and broadcasts
 * the resulting state to everyone — the same model used by essentially
 * every real-time multiplayer board game implementation.
 * -----------------------------------------------------------------------
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8081;
const ENGINE_DIR = __dirname;

// ---------------------------------------------------------------------------
// Load the real engine, exactly like every test this whole project has run.

function loadEngine() {
  const bundleCode = fs.readFileSync(path.join(ENGINE_DIR, 'engine.bundle.js'), 'utf8');
  const context = { console };
  vm.createContext(context);
  vm.runInContext(bundleCode, context);
  return context.BrokerBossEngine;
}

let BrokerBossEngine;
let catalogCache = null;
let agentCatalogCache = null;

function loadCatalogs() {
  if (!catalogCache) {
    catalogCache = JSON.parse(fs.readFileSync(path.join(ENGINE_DIR, 'catalog.json'), 'utf8'));
  }
  if (!agentCatalogCache) {
    agentCatalogCache = JSON.parse(fs.readFileSync(path.join(ENGINE_DIR, 'agentCatalog.json'), 'utf8'));
  }
  return { ...catalogCache, agentCards: agentCatalogCache };
}

function realShuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// FIX: this was still using the OLD, obsolete GRW_* substitute values
// from BEFORE a catalog loader bug was fixed in app.js (buildCatalogId
// was double-prefixing S1-S7 as "START_S1" instead of the bare "S1" the
// engine expects). app.js's own startGame() was corrected to use the
// real S1-S7 cards, but this file was never updated to match — meaning
// every online multiplayer game has been dealing a completely different
// (and wrong) starting hand/draw pile than offline games this whole
// time. Now genuinely identical to app.js's real, corrected values.
const REAL_STARTING_HAND = ['S1', 'S2', 'S3', 'S4', 'S5'];
const REAL_STARTING_DRAW_PILE = ['S6', 'S7'];
const RESERVED_STARTING_DECK_CATALOG_IDS = new Set([...REAL_STARTING_HAND, ...REAL_STARTING_DRAW_PILE]);

// [v68.21] 5 distinct names per archetype (same title). Keep identical to
// BOT_PERSONALITY_REGISTRY in app.js.
const BOT_PERSONALITY_REGISTRY = {
  Aggressive: { title: 'Aggressive / Shark', names: ['Vince "The Shark" Steel', 'Rita "Riptide" Vance', 'Max "The Closer" Cutter', 'Dana "Barracuda" Cole', 'Rex "Hammer" Holt'] },
  Engine: { title: 'Efficiency / Operations', names: ['Calculated Carl', 'Precise Priya', 'Methodical Mel', 'Efficient Eddie', 'Systematic Sam'] },
  Growth: { title: 'Recruiter / Headhunter', names: ['Hunter Hayes', 'Scout Sanders', 'Talent Tess Rivera', 'Network Nate', 'Rally Rhodes'] },
  Cautious: { title: 'Balanced / Defensive', names: ['Morgan Trust', 'Steady Stella', 'Prudent Pete', 'Careful Cora', 'Balanced Ben'] },
};
const RANDOMIZABLE_ARCHETYPES = Object.keys(BOT_PERSONALITY_REGISTRY);
const BOT_COLORS = ['blue', 'green', 'gold', 'purple', 'grey'];
const SEAT_COLORS = ['red', 'blue', 'green', 'gold', 'purple', 'grey'];

// usedNames: object whose keys are display names already at the table.
// Picks the first unused name in the archetype's pool and records it.
function resolveBotPersonality(requestedArchetype, usedNames) {
  const resolvedArchetype = requestedArchetype === 'Random' ? RANDOMIZABLE_ARCHETYPES[Math.floor(Math.random() * RANDOMIZABLE_ARCHETYPES.length)] : requestedArchetype;
  const persona = BOT_PERSONALITY_REGISTRY[resolvedArchetype] || { names: ['Bot'], title: resolvedArchetype };
  let displayName = persona.names.find((n) => !usedNames[n]);
  for (let k = 2; !displayName; k++) if (!usedNames[`Bot ${k}`]) displayName = `Bot ${k}`;
  usedNames[displayName] = 1;
  return { archetype: resolvedArchetype, displayName };
}

// ---------------------------------------------------------------------------
// Room model
//
// room = {
//   code, hostConnectionId, maxSeats,
//   seats: [{ seatIndex, type: 'human'|'bot'|'locked'|'open', connectionId, displayName, archetype }],
//   state: <real engine state, or null before START_GAME>,
// }

const rooms = new Map(); // roomCode -> room
const connections = new Map(); // connectionId -> { ws, roomCode, seatIndex }
const pendingSeatTimeouts = new Map(); // "roomCode:seatIndex" -> Timeout handle
const RECONNECT_TIMEOUT_MS = Number(process.env.RECONNECT_TIMEOUT_MS) || 60000;
// [v68.27] Phase 1 reconnection settings.
// HEARTBEAT: the server pings every socket; one that misses a ping round is
// dead (phone asleep, wifi gone, a half-open connection that never sent a
// close) and is cut, which starts that seat's normal reconnect window.
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS) || 25000;
// A room with no connected human for this long is deleted (memory cleanup).
const ROOM_IDLE_TTL_MS = Number(process.env.ROOM_IDLE_TTL_MS) || 2 * 60 * 60 * 1000;
const ROOM_SWEEP_INTERVAL_MS = Number(process.env.ROOM_SWEEP_INTERVAL_MS) || 60000;
const SESSION_REPLACED_CLOSE_CODE = 4001;
// [v68.28] Phase 2: host / spectators / teaching tools.
const MAX_SPECTATORS = Number(process.env.MAX_SPECTATORS) || 30;
const POINTER_MIN_INTERVAL_MS = 25; // pointer updates faster than this are dropped
const PING_MIN_INTERVAL_MS = 150;

function clampUnit(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
}

function newPlayerToken() {
  return crypto.randomBytes(16).toString('hex');
}
// Constant-time token comparison.
function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
// What the client saves in localStorage. playerToken/roomId are the
// Phase 1 names; reconnectToken/roomCode stay for already-loaded pages.
function sessionCredentials(room, seat) {
  return { roomId: room.code, roomCode: room.code, seatIndex: seat.seatIndex, playerToken: seat.reconnectToken, reconnectToken: seat.reconnectToken };
}

function generateRoomCode() {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
  let code;
  do {
    code = Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function newConnectionId() {
  return crypto.randomBytes(8).toString('hex');
}

function defaultSeats(maxSeats, presenter = false) {
  return Array.from({ length: maxSeats }, (_, i) => ({
    seatIndex: i,
    // seat 0 is the host's seat, unless the host is a non-playing presenter
    type: i === 0 && !presenter ? 'human' : 'open',
    connectionId: null,
    displayName: null,
    archetype: null,
    connectionStatus: 'connected',
    reconnectToken: null,
    disconnectedAt: null,
  }));
}

function roomPublicView(room) {
  return {
    code: room.code,
    hostConnectionId: room.hostConnectionId,
    maxSeats: room.maxSeats,
    // reconnectToken is a credential — never broadcast it to every
    // connection in the room, only ever sent directly to the seat's own
    // owner (in ROOM_CREATED/ROOM_JOINED/RECONNECTED).
    seats: room.seats.map((s) => {
      const { reconnectToken, originalDisplayName, ...publicSeat } = s;
      return {
        ...publicSeat,
        // Computed fresh on every broadcast (not a one-time flag the
        // client has to remember) so the UI's "is this seat still
        // reconnectable" logic always matches the server's own real
        // enforcement in handleUpdateSeats/handleConvertDisconnectedSeat.
        reconnectWindowExpired: s.connectionStatus === 'disconnected' && !!s.disconnectedAt && Date.now() - s.disconnectedAt >= RECONNECT_TIMEOUT_MS,
      };
    }),
    gameStarted: !!room.state,
    reconnectWindowMs: RECONNECT_TIMEOUT_MS, // [v68.27] for the "back in Ns" notice
    // [v68.28] Phase 2: who is hosting / watching (never tokens)
    hostMode: room.hostMode || 'player',
    host: room.host ? { displayName: room.host.displayName, connectionStatus: room.host.connectionStatus } : null,
    spectators: (room.spectators || []).map((sp) => ({ displayName: sp.displayName, connectionStatus: sp.connectionStatus })),
    spectatorsSeeHands: !!room.spectatorsSeeHands,
  };
}

// [v68.28] Every live connection in a room: seated players, a presenter
// host (no seat) and spectators.
function roomConnectionIds(room) {
  const ids = new Set();
  room.seats.forEach((seat) => { if (seat.connectionId) ids.add(seat.connectionId); });
  if (room.host && room.host.connectionId) ids.add(room.host.connectionId);
  (room.spectators || []).forEach((sp) => { if (sp.connectionId) ids.add(sp.connectionId); });
  return ids;
}

function broadcastToRoom(roomCode, message, exceptConnectionId = null) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const payload = JSON.stringify(message);
  roomConnectionIds(room).forEach((id) => {
    if (id === exceptConnectionId) return;
    const conn = connections.get(id);
    if (conn && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(payload);
    }
  });
}

function sendTo(connectionId, message) {
  const conn = connections.get(connectionId);
  if (conn && conn.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(JSON.stringify(message));
  }
}

function broadcastRoomState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  broadcastToRoom(roomCode, { type: 'ROOM_STATE', room: roomPublicView(room) });
}

// ---------------------------------------------------------------------------
// Bot cascade — reuses the exact settleGameLoop the offline client already
// relies on, so server-hosted bots behave identically to local ones.

function runBotCascadeAndBroadcast(room) {
  if (!room.state) return;
  const settled = BrokerBossEngine.settleGameLoop(room.state, { maxIterations: 200 });
  room.state = settled.state;
  broadcastToRoom(room.code, { type: 'STATE_UPDATE', state: room.state });
}

// ---------------------------------------------------------------------------
// Message handlers

function handleCreateRoom(connectionId, ws, msg) {
  if (msg.hostMode === 'presenter') {
    handleCreatePresenterRoom(connectionId, ws, msg);
    return;
  }
  const roomCode = generateRoomCode();
  const maxSeats = Math.min(6, Math.max(2, msg.maxSeats || 4));
  const room = { code: roomCode, hostConnectionId: connectionId, hostMode: 'player', host: null, spectators: [], maxSeats, seats: defaultSeats(maxSeats), state: null };
  const reconnectToken = newPlayerToken();
  room.seats[0] = {
    seatIndex: 0,
    type: 'human',
    connectionId,
    displayName: msg.displayName || 'Host',
    archetype: null,
    connectionStatus: 'connected',
    reconnectToken,
    disconnectedAt: null,
  };
  rooms.set(roomCode, room);
  connections.set(connectionId, { ws, roomCode, seatIndex: 0 });
  sendTo(connectionId, { type: 'ROOM_CREATED', ...sessionCredentials(room, room.seats[0]) });
  broadcastRoomState(roomCode);
}

/**
 * [v68.28] Presenter host: runs the room (seats, Start Game, End Game,
 * laser pointer, pings) without a seat — no turns, no cards. Every seat,
 * including seat 0, is for players or bots.
 */
function handleCreatePresenterRoom(connectionId, ws, msg) {
  const roomCode = generateRoomCode();
  const maxSeats = Math.min(6, Math.max(2, msg.maxSeats || 4));
  const host = { displayName: (msg.displayName || 'Host').slice(0, 24), connectionId, reconnectToken: newPlayerToken(), connectionStatus: 'connected', disconnectedAt: null };
  const room = { code: roomCode, hostConnectionId: connectionId, hostMode: 'presenter', host, spectators: [], maxSeats, seats: defaultSeats(maxSeats, true), state: null };
  rooms.set(roomCode, room);
  connections.set(connectionId, { ws, roomCode, seatIndex: null, role: 'host' });
  sendTo(connectionId, { type: 'ROOM_CREATED', roomId: roomCode, roomCode, seatIndex: null, playerToken: host.reconnectToken, reconnectToken: host.reconnectToken, role: 'host', hostMode: 'presenter' });
  broadcastRoomState(roomCode);
}

/**
 * [v68.28] Spectator: watches the game (live board, laser pointer, pings)
 * without a seat. Allowed before or during a game.
 */
function handleJoinAsSpectator(connectionId, ws, msg) {
  const room = rooms.get(String(msg.roomCode || msg.roomId || '').toUpperCase());
  if (!room) {
    sendTo(connectionId, { type: 'JOIN_ERROR', reason: 'ROOM_NOT_FOUND' });
    return;
  }
  room.spectators = room.spectators || [];
  if (room.spectators.length >= MAX_SPECTATORS) {
    sendTo(connectionId, { type: 'JOIN_ERROR', reason: 'SPECTATORS_FULL' });
    return;
  }
  const spectator = { id: crypto.randomBytes(6).toString('hex'), displayName: (msg.displayName || 'Spectator').slice(0, 24), connectionId, reconnectToken: newPlayerToken(), connectionStatus: 'connected', disconnectedAt: null };
  room.spectators.push(spectator);
  connections.set(connectionId, { ws, roomCode: room.code, seatIndex: null, role: 'spectator', spectatorId: spectator.id });
  sendTo(connectionId, { type: 'ROOM_JOINED', roomId: room.code, roomCode: room.code, seatIndex: null, playerToken: spectator.reconnectToken, reconnectToken: spectator.reconnectToken, role: 'spectator' });
  if (room.state) sendTo(connectionId, { type: 'GAME_STARTED', state: room.state, role: 'spectator' });
  broadcastRoomState(room.code);
}

function handleJoinRoom(connectionId, ws, msg) {
  if (msg.asSpectator) {
    handleJoinAsSpectator(connectionId, ws, msg);
    return;
  }
  const room = rooms.get((msg.roomCode || '').toUpperCase());
  if (!room) {
    sendTo(connectionId, { type: 'JOIN_ERROR', reason: 'ROOM_NOT_FOUND' });
    return;
  }
  if (room.state) {
    // FIX (v57): a player who lost their locally-stored reconnectToken
    // entirely (different browser/device, cleared storage — the normal
    // attemptAutoReconnect() path in app.js has nothing to work with in
    // that case) had no way back into an already-started game at all;
    // the manual "enter room code" flow always landed here and always
    // got flatly rejected, even though they're legitimately still
    // seated. If a currently-disconnected human seat's displayName
    // matches (case-insensitive, trimmed) what they typed, treat this
    // as an implicit reconnect-by-name instead: re-seat them with a
    // fresh token rather than reject. Deliberately scoped to seats that
    // are genuinely disconnected right now — a connected seat with the
    // same display name is never touched, so this can't be used to hijack
    // an active player's seat.
    const trimmedName = (msg.displayName || '').trim().toLowerCase();
    const recoverableSeat = trimmedName
      ? room.seats.find((s) => (s.type === 'human' && s.connectionStatus === 'disconnected' && (s.displayName || '').trim().toLowerCase() === trimmedName) || (s.standIn && (s.originalDisplayName || '').trim().toLowerCase() === trimmedName))
      : null;
    if (!recoverableSeat) {
      sendTo(connectionId, { type: 'JOIN_ERROR', reason: 'GAME_ALREADY_STARTED' });
      return;
    }
    // A fresh token: whoever held the old one (lost device) can't come back in.
    recoverableSeat.reconnectToken = newPlayerToken();
    bindSeatToConnection(room, recoverableSeat, connectionId, ws);
    return;
  }
  const openSeat = room.seats.find((s) => s.type === 'open');
  if (!openSeat) {
    sendTo(connectionId, { type: 'JOIN_ERROR', reason: 'ROOM_FULL' });
    return;
  }
  const reconnectToken = newPlayerToken();
  openSeat.type = 'human';
  openSeat.connectionId = connectionId;
  openSeat.displayName = msg.displayName || `Player ${openSeat.seatIndex + 1}`;
  openSeat.connectionStatus = 'connected';
  openSeat.reconnectToken = reconnectToken;
  openSeat.disconnectedAt = null;
  connections.set(connectionId, { ws, roomCode: room.code, seatIndex: openSeat.seatIndex });
  sendTo(connectionId, { type: 'ROOM_JOINED', ...sessionCredentials(room, openSeat) });
  broadcastRoomState(room.code);
}

/**
 * handleReconnectPlayer — a returning client (browser refresh, or a
 * WebSocket that dropped and is now retrying) presents the seat's real
 * reconnectToken. On match, re-attaches this new connection to that
 * seat (whether the game has started or not) and sends the seat's owner
 * a full current state so their UI can restore itself — no lobby replay,
 * no re-picking a seat.
 */
function handleReconnectPlayer(connectionId, ws, msg) {
  // [v68.27] REJOIN_ROOM { roomId, playerToken } — seatIndex optional (the
  // token alone identifies the seat). The older RECONNECT_PLAYER
  // { roomCode, seatIndex, reconnectToken } is accepted too.
  const roomKey = String(msg.roomId || msg.roomCode || '').toUpperCase();
  const presented = msg.playerToken || msg.reconnectToken;
  const room = rooms.get(roomKey);
  if (!room) {
    sendTo(connectionId, { type: 'RECONNECT_ERROR', reason: 'ROOM_NOT_FOUND' });
    return;
  }
  const claimable = (s) => s && s.reconnectToken && (s.type === 'human' || (s.type === 'bot' && s.standIn)) && tokensMatch(s.reconnectToken, presented);
  const bySeat = Number.isInteger(msg.seatIndex) ? room.seats[msg.seatIndex] : null;
  const seat = claimable(bySeat) ? bySeat : room.seats.find(claimable);
  if (!seat) {
    // [v68.28] not a seat: maybe the presenter host or a spectator
    if (room.host && room.host.reconnectToken && tokensMatch(room.host.reconnectToken, presented)) {
      bindViewerToConnection(room, room.host, 'host', connectionId, ws);
      return;
    }
    const spectator = (room.spectators || []).find((sp) => sp.reconnectToken && tokensMatch(sp.reconnectToken, presented));
    if (spectator) {
      bindViewerToConnection(room, spectator, 'spectator', connectionId, ws);
      return;
    }
    sendTo(connectionId, { type: 'RECONNECT_ERROR', reason: 'INVALID_TOKEN' });
    return;
  }
  bindSeatToConnection(room, seat, connectionId, ws);
}

/**
 * [v68.28] Same job as bindSeatToConnection, for the seatless roles
 * (presenter host, spectator): cancel the timer, retire any other tab on
 * this identity, rebind, resend credentials and the full state.
 */
function bindViewerToConnection(room, viewer, role, connectionId, ws) {
  const timerKey = `${room.code}:${role}:${role === 'host' ? 'host' : viewer.id}`;
  if (pendingSeatTimeouts.has(timerKey)) {
    clearTimeout(pendingSeatTimeouts.get(timerKey));
    pendingSeatTimeouts.delete(timerKey);
  }
  if (viewer.connectionId && viewer.connectionId !== connectionId) {
    const old = connections.get(viewer.connectionId);
    connections.delete(viewer.connectionId);
    if (old && old.ws && old.ws !== ws) {
      try {
        if (old.ws.readyState === WebSocket.OPEN) old.ws.send(JSON.stringify({ type: 'SESSION_REPLACED', reason: 'OPENED_ELSEWHERE' }));
        old.ws.close(SESSION_REPLACED_CLOSE_CODE, 'Session opened elsewhere');
      } catch (err) { /* already gone */ }
    }
  }
  viewer.connectionId = connectionId;
  viewer.connectionStatus = 'connected';
  viewer.disconnectedAt = null;
  if (role === 'host') room.hostConnectionId = connectionId;
  room.emptySince = null;
  connections.set(connectionId, { ws, roomCode: room.code, seatIndex: null, role, spectatorId: role === 'spectator' ? viewer.id : undefined });
  sendTo(connectionId, {
    type: 'RECONNECTED',
    roomId: room.code,
    roomCode: room.code,
    seatIndex: null,
    playerToken: viewer.reconnectToken,
    reconnectToken: viewer.reconnectToken,
    role,
    gameStarted: !!room.state,
    isHost: role === 'host',
  });
  if (room.state) sendTo(connectionId, { type: 'FORCE_STATE_SYNC', state: room.state });
  broadcastRoomState(room.code);
}

function requireHostConnection(connectionId) {
  const conn = connections.get(connectionId);
  if (!conn) return null;
  const room = rooms.get(conn.roomCode);
  if (!room || room.hostConnectionId !== connectionId) {
    sendTo(connectionId, { type: 'ERROR', message: 'Only the host can do that.' });
    return null;
  }
  return { conn, room };
}

/** [v68.28] Host laser pointer: relative position, relayed to everyone else. */
function handleHostPointer(connectionId, msg) {
  const ctx = requireHostConnection(connectionId);
  if (!ctx) return;
  const x = clampUnit(msg.x), y = clampUnit(msg.y);
  if (msg.visible !== false && (x === null || y === null)) return;
  const update = { type: 'HOST_POINTER', x, y, area: msg.area === 'board' ? 'board' : 'page', visible: msg.visible !== false };
  const send = () => {
    ctx.conn.lastPointerAt = Date.now();
    ctx.conn.pendingPointer = null;
    broadcastToRoom(ctx.room.code, ctx.conn.lastPointerUpdate, connectionId);
  };
  ctx.conn.lastPointerUpdate = update;
  const wait = POINTER_MIN_INTERVAL_MS - (Date.now() - (ctx.conn.lastPointerAt || 0));
  if (wait <= 0 || update.visible === false) {
    clearTimeout(ctx.conn.pendingPointer);
    send();
  } else if (!ctx.conn.pendingPointer) {
    // too soon: send the LATEST position when the interval is up, so a fast
    // move never leaves the laser short of where the host stopped
    ctx.conn.pendingPointer = setTimeout(send, wait);
  }
}

/** [v68.28] Host ping: highlight one element (by its data attribute) on every screen. */
function handleHostPing(connectionId, msg) {
  const ctx = requireHostConnection(connectionId);
  if (!ctx) return;
  const now = Date.now();
  if (ctx.conn.lastPingAt && now - ctx.conn.lastPingAt < PING_MIN_INTERVAL_MS) return;
  ctx.conn.lastPingAt = now;
  const ALLOWED_ATTRS = ['data-space-id', 'data-ping-id', 'data-player-id', 'data-catalog-id', 'data-agent-instance-id', 'data-milestone-key'];
  const target = msg.target && ALLOWED_ATTRS.includes(msg.target.attr) && typeof msg.target.value === 'string' && msg.target.value.length <= 80 ? { attr: msg.target.attr, value: msg.target.value } : null;
  broadcastToRoom(ctx.room.code, { type: 'HOST_PING', id: crypto.randomBytes(4).toString('hex'), target, x: clampUnit(msg.x), y: clampUnit(msg.y), area: msg.area === 'board' ? 'board' : 'page', label: typeof msg.label === 'string' ? msg.label.slice(0, 60) : null });
}

/**
 * [v68.28] Host time limit: end after the current round, end now, or
 * cancel a pending end. The engine's own requestEarlyGameEnd does the rules
 * (earlyGameEnd.js); this only checks it's the host and broadcasts.
 */
function handleHostEndGame(connectionId, msg) {
  const ctx = requireHostConnection(connectionId);
  if (!ctx) return;
  const { room } = ctx;
  if (!room.state) {
    sendTo(connectionId, { type: 'ERROR', message: 'The game has not started yet.' });
    return;
  }
  const mode = ['after_round', 'now', 'cancel'].includes(msg.mode) ? msg.mode : null;
  if (!mode) return;
  const hostName = room.host ? room.host.displayName : (room.seats[0] && room.seats[0].displayName) || 'Host';
  const result = BrokerBossEngine.requestEarlyGameEnd(room.state, { mode, requestedBy: hostName });
  if (result.error) {
    sendTo(connectionId, { type: 'ERROR', message: result.error === 'GAME_ALREADY_FINISHED' ? 'The game is already over.' : result.error === 'NO_EARLY_END_PENDING' ? 'There is no early finish to cancel.' : `Could not end the game (${result.error}).` });
    return;
  }
  room.state = result.state;
  broadcastToRoom(room.code, { type: 'HOST_END_GAME_UPDATE', mode, round: room.state.phase.round, hostName });
  broadcastToRoom(room.code, { type: 'STATE_UPDATE', state: room.state });
  runBotCascadeAndBroadcast(room);
}

/** [v68.28] Host setting: may spectators see players' hands in the overview? */
function handleHostSetSpectatorHands(connectionId, msg) {
  const ctx = requireHostConnection(connectionId);
  if (!ctx) return;
  ctx.room.spectatorsSeeHands = !!msg.visible;
  broadcastRoomState(ctx.room.code);
}

/**
 * [v68.27] bindSeatToConnection — the one place a (re)connecting socket is
 * attached to a seat. Cancels the seat's reconnect timer, hands the seat
 * back from a stand-in bot if one took over, retires any other socket
 * still attached to the seat (second tab / zombie connection: it is told
 * SESSION_REPLACED and closed, so it can't keep acting or auto-retrying),
 * moves host status if this is the host seat, and resends the full state.
 */
function bindSeatToConnection(room, seat, connectionId, ws) {
  const timeoutKey = `${room.code}:${seat.seatIndex}`;
  if (pendingSeatTimeouts.has(timeoutKey)) {
    clearTimeout(pendingSeatTimeouts.get(timeoutKey));
    pendingSeatTimeouts.delete(timeoutKey);
  }
  if (seat.connectionId && seat.connectionId !== connectionId) {
    const old = connections.get(seat.connectionId);
    connections.delete(seat.connectionId);
    if (old && old.ws && old.ws !== ws) {
      try {
        if (old.ws.readyState === WebSocket.OPEN) old.ws.send(JSON.stringify({ type: 'SESSION_REPLACED', reason: 'OPENED_ELSEWHERE' }));
        old.ws.close(SESSION_REPLACED_CLOSE_CODE, 'Session opened elsewhere');
      } catch (err) { /* already gone */ }
    }
  }
  if (seat.standIn) reclaimSeatFromStandIn(room, seat);
  seat.connectionId = connectionId;
  seat.connectionStatus = 'connected';
  seat.disconnectedAt = null;
  // The host seat's new connection must carry host rights (Start Game,
  // seat changes) — requireHost() compares against hostConnectionId.
  if (seat.seatIndex === 0) {
    room.hostConnectionId = connectionId;
  }
  room.emptySince = null;
  connections.set(connectionId, { ws, roomCode: room.code, seatIndex: seat.seatIndex, playerId: room.state ? `p${seat.seatIndex + 1}` : undefined });

  sendTo(connectionId, {
    type: 'RECONNECTED',
    ...sessionCredentials(room, seat),
    gameStarted: !!room.state,
    isHost: room.hostConnectionId === connectionId,
  });
  if (room.state) {
    sendTo(connectionId, { type: 'FORCE_STATE_SYNC', state: room.state });
  }
  broadcastRoomState(room.code);
}

/**
 * [v68.27] A player came back after a bot stood in for them: the seat and
 * the engine player go back to human, with the player's own name. All
 * progress the stand-in made (cards, money, Agents) stays with the seat.
 */
function reclaimSeatFromStandIn(room, seat) {
  const playerId = `p${seat.seatIndex + 1}`;
  const name = seat.originalDisplayName || seat.displayName;
  if (room.state && room.state.players[playerId]) {
    const { archetype, ...rest } = room.state.players[playerId];
    room.state = { ...room.state, players: { ...room.state.players, [playerId]: { ...rest, isBot: false, displayName: name } } };
    room.state = { ...room.state, log: [...room.state.log, { seq: room.state.log.length + 1, timestamp: new Date().toISOString(), round: room.state.phase.round, type: 'PLAYER_RECONNECTED_FROM_STAND_IN', playerId, message: `${name} is back and takes over their seat from the stand-in bot.` }] };
    broadcastToRoom(room.code, { type: 'STATE_UPDATE', state: room.state });
  }
  seat.type = 'human';
  seat.displayName = name;
  seat.archetype = null;
  seat.standIn = false;
  seat.originalDisplayName = null;
}

function requireHost(connectionId, room) {
  return room && room.hostConnectionId === connectionId;
}

function handleUpdateSeats(connectionId, msg) {
  const conn = connections.get(connectionId);
  if (!conn) return;
  const room = rooms.get(conn.roomCode);
  if (!requireHost(connectionId, room) || room.state) return;

  if (typeof msg.maxSeats === 'number') {
    const newMax = Math.min(6, Math.max(2, msg.maxSeats));
    if (newMax !== room.maxSeats) {
      if (newMax > room.maxSeats) {
        for (let i = room.maxSeats; i < newMax; i += 1) room.seats.push({ seatIndex: i, type: 'open', connectionId: null, displayName: null, archetype: null });
      } else {
        // Shrinking: disconnect any human occupying a seat past the new limit.
        room.seats.slice(newMax).forEach((s) => {
          if (s.connectionId) connections.delete(s.connectionId);
        });
        room.seats = room.seats.slice(0, newMax);
      }
      room.maxSeats = newMax;
    }
  }

  if (Array.isArray(msg.seatUpdates)) {
    msg.seatUpdates.forEach((update) => {
      const seat = room.seats[update.seatIndex];
      if (!seat || (seat.seatIndex === 0 && room.hostMode !== 'presenter')) return; // a playing host's own seat isn't reassignable
      // A seat occupied by a human — whether currently connected, or
      // disconnected but still within its reconnect window — is not
      // reassignable through this path. Only once that window has
      // genuinely elapsed (or the player explicitly leaves) does the
      // seat become fair game again. Without this, a host could
      // prematurely kick someone who simply refreshed a moment ago.
      const withinReconnectWindow = seat.connectionStatus === 'disconnected' && seat.disconnectedAt && Date.now() - seat.disconnectedAt < RECONNECT_TIMEOUT_MS;
      if (seat.type === 'human' && (seat.connectionStatus === 'connected' || withinReconnectWindow)) return;
      if (update.type === 'bot') {
        seat.type = 'bot';
        seat.connectionId = null;
        seat.archetype = update.archetype || 'Random';
        seat.displayName = null;
      } else if (update.type === 'locked') {
        seat.type = 'locked';
        seat.connectionId = null;
        seat.displayName = null;
        seat.archetype = null;
      } else if (update.type === 'open') {
        seat.type = 'open';
        seat.connectionId = null;
        seat.displayName = null;
        seat.archetype = null;
      }
    });
  }

  broadcastRoomState(room.code);
}

function handleStartGame(connectionId) {
  const conn = connections.get(connectionId);
  if (!conn) return;
  const room = rooms.get(conn.roomCode);
  // FIX (v62): these were silent early returns with zero feedback to the
  // client — not even a server-side log — the exact mechanism behind
  // "click Start Game, nothing visibly happens, no error banner." This
  // bypasses the generic top-level try/catch entirely (it's a deliberate
  // return, not a thrown exception), so that catch-all's own error
  // reporting never had a chance to fire either. Each branch now
  // explains specifically what blocked the start, and app.js's new
  // 'ERROR' case (previously unhandled entirely) actually surfaces it.
  if (!room) {
    console.error(`START_GAME: no room found for connection ${connectionId}`);
    sendTo(connectionId, { type: 'ERROR', message: 'Could not start — this room no longer exists.' });
    return;
  }
  if (!requireHost(connectionId, room)) {
    console.error(`START_GAME: connection ${connectionId} is not the host of room ${room.code}`);
    sendTo(connectionId, { type: 'ERROR', message: 'Only the host can start the game.' });
    return;
  }
  if (room.state) {
    console.error(`START_GAME: room ${room.code} already has a started game`);
    sendTo(connectionId, { type: 'ERROR', message: 'This game has already started.' });
    return;
  }

  const humanSeats = room.seats.filter((s) => s.type === 'human');
  const botSeats = room.seats.filter((s) => s.type === 'bot');
  if (humanSeats.length === 0) {
    console.error(`START_GAME: room ${room.code} has no human seats`);
    sendTo(connectionId, { type: 'ERROR', message: 'Need at least one human player to start.' });
    return;
  }

  if (!BrokerBossEngine) BrokerBossEngine = loadEngine();
  const catalog = loadCatalogs();
  const usedBotNames = {};
  // [v68.21] a bot never takes a human player's name either
  room.seats.forEach((s) => { if (s.type === 'human' && s.displayName) usedBotNames[s.displayName] = 1; });

  const players = room.seats
    .filter((s) => s.type === 'human' || s.type === 'bot')
    .map((seat, i) => {
      if (seat.type === 'human') {
        return {
          playerId: `p${seat.seatIndex + 1}`,
          color: SEAT_COLORS[seat.seatIndex],
          displayName: seat.displayName || `Player ${seat.seatIndex + 1}`,
          startingHandCatalogIds: [...REAL_STARTING_HAND],
          startingDrawPileCatalogIds: [...REAL_STARTING_DRAW_PILE],
        };
      }
      const resolved = resolveBotPersonality(seat.archetype || 'Random', usedBotNames);
      return {
        playerId: `p${seat.seatIndex + 1}`,
        color: SEAT_COLORS[seat.seatIndex],
        displayName: resolved.displayName,
        isBot: true,
        archetype: resolved.archetype,
        startingHandCatalogIds: [...REAL_STARTING_HAND],
        startingDrawPileCatalogIds: [...REAL_STARTING_DRAW_PILE],
      };
    });

  let state = BrokerBossEngine.initializeGame(players, {
    specialistCatalogIds: Array.from({ length: 13 }, (_, i) => `SPEC_${i + 1}`),
    agentCatalog: catalog.agentCards,
    actionCardCatalogIds: Object.keys(catalog.actionCards).filter((id) => !RESERVED_STARTING_DECK_CATALOG_IDS.has(id)),
    shuffle: realShuffle,
    cardCatalog: catalog,
  });
  // Same fixes app.js's own startGame() already documents and applies —
  // kept identical so server games and local games behave the same way.
  state = { ...state, shiftDeck: { drawPile: realShuffle(Object.keys(catalog.shiftCards).map((catalogId) => ({ catalogId }))), discardPile: [] } };
  state = { ...state, phase: { ...state.phase, current: 'WORKER_PLACEMENT' } };

  room.state = state;
  // Map each connected human's connectionId to their assigned playerId
  // for turn-ownership checks on every future GAME_ACTION.
  room.seats.forEach((seat) => {
    if (seat.type === 'human' && seat.connectionId) {
      const c = connections.get(seat.connectionId);
      if (c) c.playerId = `p${seat.seatIndex + 1}`;
    }
  });

  broadcastToRoom(room.code, { type: 'GAME_STARTED', state: room.state });
  runBotCascadeAndBroadcast(room);
}

function handleGameAction(connectionId, msg) {
  const conn = connections.get(connectionId);
  if (conn && !conn.playerId && (conn.role === 'host' || conn.role === 'spectator')) {
    sendTo(connectionId, { type: 'ACTION_ERROR', error: 'VIEWER_CANNOT_ACT', detail: null });
    return;
  }
  if (!conn || !conn.playerId) return;
  const room = rooms.get(conn.roomCode);
  if (!room || !room.state) return;

  const result = BrokerBossEngine.executeUserAction(room.state, { ...msg.action, playerId: conn.playerId });
  if (result.error) {
    sendTo(connectionId, { type: 'ACTION_ERROR', error: result.error, detail: result.detail || null });
    return;
  }
  room.state = result.state;
  broadcastToRoom(room.code, { type: 'STATE_UPDATE', state: room.state });
  runBotCascadeAndBroadcast(room);
}

/**
 * handleRequestStateSync — a client can ask for the room's current real
 * state on demand, sent to just that one connection (not broadcast).
 * Used by the client after an ACTION_ERROR, so a locally-stale view
 * (e.g. a bot cascade finished between this client's last update and its
 * next click) gets corrected immediately instead of leaving the player
 * looking at a view that will keep rejecting their next action too.
 */
function handleRequestStateSync(connectionId) {
  const conn = connections.get(connectionId);
  if (!conn) return;
  const room = rooms.get(conn.roomCode);
  if (!room || !room.state) return;
  sendTo(connectionId, { type: 'STATE_UPDATE', state: room.state });
}

function handleDisconnect(connectionId) {
  const conn = connections.get(connectionId);
  connections.delete(connectionId);
  // A socket retired by bindSeatToConnection (second tab / zombie) is no
  // longer in `connections`, so its late close event changes nothing.
  if (!conn) return;
  const room = rooms.get(conn.roomCode);
  if (!room) return;
  if (conn.role === 'host' && room.host && room.host.connectionId === connectionId) {
    handleViewerDisconnect(room, room.host, 'host');
    return;
  }
  if (conn.role === 'spectator') {
    const sp = (room.spectators || []).find((s) => s.connectionId === connectionId);
    if (sp) handleViewerDisconnect(room, sp, 'spectator');
    return;
  }
  const seat = room.seats.find((s) => s.connectionId === connectionId);
  if (seat) {
    seat.connectionId = null;
    // FIX: this used to free the seat immediately for any pre-game
    // (lobby-stage) disconnect, discarding the reconnectToken — meaning
    // a player (including the host) who simply refreshed their browser
    // while still in the waiting room could never reconnect at all; the
    // stored credential was already worthless by the time the page
    // reloaded. A raw socket close is ambiguous — it could be a refresh,
    // a network blip, or someone actually closing the tab — so now it
    // always preserves the seat and reconnectToken for the same real
    // reconnect window, whether pre-game or mid-game, host seat or not.
    // A genuinely deliberate exit goes through handleLeaveRoom instead,
    // which frees things immediately rather than waiting on a timeout.
    seat.connectionStatus = 'disconnected';
    seat.disconnectedAt = Date.now();
    const timeoutKey = `${room.code}:${seat.seatIndex}`;
    if (pendingSeatTimeouts.has(timeoutKey)) clearTimeout(pendingSeatTimeouts.get(timeoutKey));
    const handle = setTimeout(() => {
      pendingSeatTimeouts.delete(timeoutKey);
      const stillDisconnected = seat.connectionStatus === 'disconnected';
      if (!stillDisconnected) return; // reconnected during the window, nothing to do

      if (room.state) {
        // FIX: mid-game, a disconnected seat used to just sit there
        // until the host manually clicked "Convert to Bot" — meaning if
        // the host themselves was mid-turn or simply didn't notice, the
        // match could freeze indefinitely waiting on a player who never
        // comes back. Now the window expiring is itself the trigger:
        // automatically converts to a real bot (same persona/archetype
        // system every other bot uses) so the remaining players can
        // keep playing without anyone needing to act.
        // [v68.27] ...as a STAND-IN: the seat keeps its token, so the
        // player can still come back and take over again later.
        convertSeatToBot(room, seat, 'Random', { standIn: true });
        runBotCascadeAndBroadcast(room);
        broadcastRoomState(room.code);
        return;
      }

      if (seat.seatIndex === 0) {
        // FIX: the host disconnecting pre-game used to leave the room
        // open indefinitely, waiting on a "convert" action that makes
        // no sense for the host seat (there's no host-migration path —
        // nothing to convert them TO that keeps the room usable).
        // Once their own reconnect window expires, close the room
        // outright with a clear, specific reason so everyone still
        // waiting gets an honest explanation instead of a silent freeze.
        broadcastToRoom(room.code, { type: 'ROOM_CLOSED', reason: 'HOST_DISCONNECTED' });
        rooms.delete(room.code);
        return;
      }

      // Non-host, pre-game: unchanged from before — the seat becomes
      // eligible for the host to convert via the waiting-room dropdown
      // (UPDATE_SEATS), which already reacts to the same
      // reconnectWindowExpired field computed below.
      broadcastToRoom(room.code, { type: 'SEAT_RECONNECT_WINDOW_EXPIRED', seatIndex: seat.seatIndex });
    }, RECONNECT_TIMEOUT_MS);
    pendingSeatTimeouts.set(timeoutKey, handle);
  }
  broadcastRoomState(room.code);
}

/**
 * [v68.28] A presenter host or spectator dropped. Their identity is kept
 * for the reconnect window. Afterwards: a spectator is removed; a presenter
 * host before the game starts closes the room (like a player-host); during
 * a game, the players simply carry on without the host.
 */
function handleViewerDisconnect(room, viewer, role) {
  viewer.connectionId = null;
  viewer.connectionStatus = 'disconnected';
  viewer.disconnectedAt = Date.now();
  const timerKey = `${room.code}:${role}:${role === 'host' ? 'host' : viewer.id}`;
  if (pendingSeatTimeouts.has(timerKey)) clearTimeout(pendingSeatTimeouts.get(timerKey));
  pendingSeatTimeouts.set(timerKey, setTimeout(() => {
    pendingSeatTimeouts.delete(timerKey);
    if (viewer.connectionStatus !== 'disconnected') return;
    if (role === 'spectator') {
      room.spectators = room.spectators.filter((s) => s !== viewer);
      broadcastRoomState(room.code);
      return;
    }
    if (!room.state) {
      broadcastToRoom(room.code, { type: 'ROOM_CLOSED', reason: 'HOST_DISCONNECTED' });
      rooms.delete(room.code);
    }
  }, RECONNECT_TIMEOUT_MS));
  broadcastRoomState(room.code);
}

/**
 * handleLeaveRoom — a deliberate, final exit (the Leave Room button),
 * distinct from handleDisconnect's "might come back" handling above.
 * Frees the seat immediately (pre-game: reopens it for a new joiner;
 * mid-game: same immediate-free, since there's no expectation of
 * returning once you've explicitly chosen to leave). If the host
 * leaves, the room closes outright — there's no one to hand host
 * status to, and leaving it open with an unreachable host would just
 * strand anyone else still in the lobby.
 */
function handleLeaveRoom(connectionId) {
  const conn = connections.get(connectionId);
  connections.delete(connectionId);
  if (!conn) return;
  const room = rooms.get(conn.roomCode);
  if (!room) return;
  const timeoutKey = `${conn.roomCode}:${conn.seatIndex}`;
  if (pendingSeatTimeouts.has(timeoutKey)) {
    clearTimeout(pendingSeatTimeouts.get(timeoutKey));
    pendingSeatTimeouts.delete(timeoutKey);
  }
  if (conn.role === 'spectator') {
    room.spectators = (room.spectators || []).filter((s) => s.connectionId !== connectionId);
    broadcastRoomState(room.code);
    return;
  }
  // [v68.28] A presenter host leaving mid-game doesn't end the players' game.
  if (conn.role === 'host' && room.hostMode === 'presenter' && room.state) {
    room.host.connectionId = null;
    room.host.connectionStatus = 'left';
    room.host.reconnectToken = null;
    room.hostConnectionId = null;
    broadcastRoomState(room.code);
    return;
  }
  if (connectionId === room.hostConnectionId) {
    broadcastToRoom(room.code, { type: 'ROOM_CLOSED', reason: 'HOST_LEFT' });
    rooms.delete(room.code);
    return;
  }
  const seat = room.seats.find((s) => s.seatIndex === conn.seatIndex);
  if (seat) {
    seat.type = 'open';
    seat.connectionId = null;
    seat.displayName = null;
    seat.reconnectToken = null;
    seat.connectionStatus = 'connected';
    seat.disconnectedAt = null;
    seat.archetype = null;
  }
  broadcastRoomState(room.code);
}

/**
 * convertSeatToBot — the actual game-state + seat-metadata mutation for
 * turning a disconnected human seat into a bot. Shared by the manual,
 * host-triggered path (handleConvertDisconnectedSeat) and the automatic
 * mid-game path (handleDisconnect's own timeout, once the reconnect
 * window genuinely expires) — same real persona/archetype system every
 * other bot in this codebase uses, not a special-cased stand-in either
 * way.
 */
function convertSeatToBot(room, seat, archetype, options = {}) {
  // [v68.27] standIn: a bot plays the seat but the human's token is kept,
  // so REJOIN_ROOM can hand the seat back (see reclaimSeatFromStandIn).
  const standIn = !!options.standIn;
  if (standIn) seat.originalDisplayName = seat.displayName;
  if (room.state) {
    const playerId = `p${seat.seatIndex + 1}`;
    const usedNames = {};
    Object.keys(room.state.players).forEach((pid) => {
      if (pid !== playerId) usedNames[room.state.players[pid].displayName] = 1;
    });
    const resolved = resolveBotPersonality(archetype || 'Random', usedNames);
    room.state = {
      ...room.state,
      players: {
        ...room.state.players,
        [playerId]: { ...room.state.players[playerId], isBot: true, archetype: resolved.archetype, displayName: resolved.displayName },
      },
    };
    broadcastToRoom(room.code, { type: 'STATE_UPDATE', state: room.state });
  }
  seat.type = 'bot';
  seat.connectionStatus = 'connected';
  seat.disconnectedAt = null;
  seat.standIn = standIn;
  if (!standIn) seat.reconnectToken = null;
  seat.archetype = archetype || 'Random';
}

/**
 * handleConvertDisconnectedSeat — host-only. Only permitted once the
 * seat's own reconnect window has genuinely elapsed (checked here
 * server-side, not just trusted from the client), so a host can't
 * bounce someone who dropped for 3 seconds.
 */
function handleConvertDisconnectedSeat(connectionId, msg) {
  const conn = connections.get(connectionId);
  if (!conn) return;
  const room = rooms.get(conn.roomCode);
  if (!requireHost(connectionId, room)) return;
  const seat = room.seats[msg.seatIndex];
  if (!seat || seat.type !== 'human' || seat.connectionStatus !== 'disconnected') return;
  if (!seat.disconnectedAt || Date.now() - seat.disconnectedAt < RECONNECT_TIMEOUT_MS) {
    sendTo(connectionId, { type: 'ERROR', message: 'That seat\'s reconnect window has not expired yet.' });
    return;
  }

  const newType = msg.newType === 'open' ? 'open' : 'bot';
  if (newType === 'bot') {
    convertSeatToBot(room, seat, msg.archetype, { standIn: true });
  } else {
    // 'open': mid-game the playerId stays exactly as-is in the real game
    // state (a human seat's data can't just vanish mid-game the way a
    // pre-game seat can) — only the SEAT metadata changes, freeing it
    // for a new human to claim via JOIN mechanics in a future
    // enhancement. The seat's credentials are revoked either way, so
    // the original disconnected player can no longer reconnect into it.
    seat.type = 'open';
    seat.connectionId = null;
    seat.displayName = null;
    seat.reconnectToken = null;
    seat.connectionStatus = 'connected';
    seat.disconnectedAt = null;
    seat.archetype = null;
  }

  if (room.state) runBotCascadeAndBroadcast(room);
  broadcastRoomState(room.code);
}

// ---------------------------------------------------------------------------
// HTTP + WebSocket server

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Broker Boss Online relay server is running. Connect via WebSocket, not HTTP GET.');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  const connectionId = newConnectionId();
  // FIX: sendTo() looks up the ws object via connections.get(connectionId)
  // — without registering the connection here immediately, any message
  // sent before a successful CREATE_ROOM/JOIN_ROOM/RECONNECT_PLAYER
  // (e.g. JOIN_ERROR for a bad room code, RECONNECT_ERROR for a stale
  // credential, or a malformed-JSON ERROR) would silently never be
  // delivered — sendTo's own connections.get() would return undefined
  // and the whole call would just no-op. Confirmed as a real bug by
  // testing the failure path directly, not assumed. roomCode/seatIndex
  // start null and get filled in by whichever handler succeeds.
  connections.set(connectionId, { ws, roomCode: null, seatIndex: null });
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    ws.isAlive = true;
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      sendTo(connectionId, { type: 'ERROR', message: 'Malformed message (not valid JSON).' });
      return;
    }
    try {
      switch (msg.type) {
        case 'CREATE_ROOM':
          handleCreateRoom(connectionId, ws, msg);
          break;
        case 'JOIN_ROOM':
          handleJoinRoom(connectionId, ws, msg);
          break;
        case 'REJOIN_ROOM': // [v68.27] Phase 1 name
        case 'RECONNECT_PLAYER': // older pages
          handleReconnectPlayer(connectionId, ws, msg);
          break;
        case 'UPDATE_SEATS':
          handleUpdateSeats(connectionId, msg);
          break;
        case 'CONVERT_DISCONNECTED_SEAT':
          handleConvertDisconnectedSeat(connectionId, msg);
          break;
        case 'START_GAME':
          handleStartGame(connectionId);
          break;
        case 'GAME_ACTION':
          handleGameAction(connectionId, msg);
          break;
        case 'REQUEST_STATE_SYNC':
          handleRequestStateSync(connectionId);
          break;
        case 'LEAVE_ROOM':
          handleLeaveRoom(connectionId);
          break;
        // [v68.28] Phase 2 host tools (host-only; checked in each handler)
        case 'HOST_POINTER':
          handleHostPointer(connectionId, msg);
          break;
        case 'HOST_PING':
          handleHostPing(connectionId, msg);
          break;
        case 'HOST_END_GAME':
          handleHostEndGame(connectionId, msg);
          break;
        case 'HOST_SET_SPECTATOR_HANDS':
          handleHostSetSpectatorHands(connectionId, msg);
          break;
        default:
          sendTo(connectionId, { type: 'ERROR', message: `Unknown message type "${msg.type}".` });
      }
    } catch (err) {
      console.error('Handler error:', err);
      sendTo(connectionId, { type: 'ERROR', message: 'Server error processing that message.' });
    }
  });

  ws.on('close', () => handleDisconnect(connectionId));
  ws.on('error', () => { /* 'close' follows and does the cleanup */ });
});

// [v68.27] Heartbeat. Browsers answer pings automatically. A socket that
// missed the last round is terminated, which fires 'close' ->
// handleDisconnect -> the seat's normal reconnect window.
const heartbeatTimer = setInterval(() => {
  wss.clients.forEach((client) => {
    if (client.isAlive === false) {
      client.terminate();
      return;
    }
    client.isAlive = false;
    try { client.ping(); } catch (err) { /* terminated next round */ }
  });
}, HEARTBEAT_INTERVAL_MS);

// [v68.27] Room cleanup: a room with no connected human for
// ROOM_IDLE_TTL_MS is deleted (its timers too). Stand-in bots don't count.
const roomSweepTimer = setInterval(() => {
  const now = Date.now();
  rooms.forEach((room, code) => {
    const anyHumanConnected = room.seats.some((s) => s.type === 'human' && s.connectionStatus === 'connected' && s.connectionId) || !!(room.host && room.host.connectionId);
    if (anyHumanConnected) { room.emptySince = null; return; }
    if (!room.emptySince) room.emptySince = now;
    if (now - room.emptySince >= ROOM_IDLE_TTL_MS) {
      room.seats.forEach((s) => {
        const key = `${code}:${s.seatIndex}`;
        if (pendingSeatTimeouts.has(key)) { clearTimeout(pendingSeatTimeouts.get(key)); pendingSeatTimeouts.delete(key); }
      });
      rooms.delete(code);
    }
  });
}, ROOM_SWEEP_INTERVAL_MS);
wss.on('close', () => { clearInterval(heartbeatTimer); clearInterval(roomSweepTimer); });

server.listen(PORT, () => {
  console.log(`Broker Boss Online relay server listening on port ${PORT}.`);
  console.log(`WebSocket URL for same-machine testing: ws://localhost:${PORT}`);
  console.log('For other devices on your network, use this machine\'s LAN IP instead of localhost.');
});

module.exports = { rooms, connections }; // exported for direct testing only
