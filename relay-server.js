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

const BOT_PERSONALITY_REGISTRY = {
  Aggressive: { name: 'Vince "The Shark" Steel', title: 'Aggressive / Shark' },
  Engine: { name: 'Calculated Carl', title: 'Efficiency / Operations' },
  Growth: { name: 'Hunter Hayes', title: 'Recruiter / Headhunter' },
  Cautious: { name: 'Morgan Trust', title: 'Balanced / Defensive' },
};
const RANDOMIZABLE_ARCHETYPES = Object.keys(BOT_PERSONALITY_REGISTRY);
const BOT_COLORS = ['blue', 'green', 'gold', 'purple', 'grey'];
const SEAT_COLORS = ['red', 'blue', 'green', 'gold', 'purple', 'grey'];

function resolveBotPersonality(requestedArchetype, usedNames) {
  const resolvedArchetype = requestedArchetype === 'Random' ? RANDOMIZABLE_ARCHETYPES[Math.floor(Math.random() * RANDOMIZABLE_ARCHETYPES.length)] : requestedArchetype;
  const persona = BOT_PERSONALITY_REGISTRY[resolvedArchetype] || { name: 'Bot', title: resolvedArchetype };
  usedNames[persona.name] = (usedNames[persona.name] || 0) + 1;
  const occurrence = usedNames[persona.name];
  const displayName = occurrence > 1 ? `${persona.name} ${['I', 'II', 'III', 'IV', 'V'][occurrence - 1] || occurrence}` : persona.name;
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

function defaultSeats(maxSeats) {
  return Array.from({ length: maxSeats }, (_, i) => ({
    seatIndex: i,
    type: i === 0 ? 'human' : 'open', // seat 0 is always the host
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
      const { reconnectToken, ...publicSeat } = s;
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
  };
}

function broadcastToRoom(roomCode, message) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const payload = JSON.stringify(message);
  room.seats.forEach((seat) => {
    if (!seat.connectionId) return;
    const conn = connections.get(seat.connectionId);
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
  const roomCode = generateRoomCode();
  const maxSeats = Math.min(6, Math.max(2, msg.maxSeats || 4));
  const room = { code: roomCode, hostConnectionId: connectionId, maxSeats, seats: defaultSeats(maxSeats), state: null };
  const reconnectToken = crypto.randomBytes(16).toString('hex');
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
  sendTo(connectionId, { type: 'ROOM_CREATED', roomCode, seatIndex: 0, reconnectToken });
  broadcastRoomState(roomCode);
}

function handleJoinRoom(connectionId, ws, msg) {
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
      ? room.seats.find((s) => s.type === 'human' && s.connectionStatus === 'disconnected' && (s.displayName || '').trim().toLowerCase() === trimmedName)
      : null;
    if (!recoverableSeat) {
      sendTo(connectionId, { type: 'JOIN_ERROR', reason: 'GAME_ALREADY_STARTED' });
      return;
    }
    const reconnectToken = crypto.randomBytes(16).toString('hex');
    if (recoverableSeat.connectionId) {
      connections.delete(recoverableSeat.connectionId);
    }
    if (pendingSeatTimeouts.has(`${room.code}:${recoverableSeat.seatIndex}`)) {
      clearTimeout(pendingSeatTimeouts.get(`${room.code}:${recoverableSeat.seatIndex}`));
      pendingSeatTimeouts.delete(`${room.code}:${recoverableSeat.seatIndex}`);
    }
    recoverableSeat.connectionId = connectionId;
    recoverableSeat.connectionStatus = 'connected';
    recoverableSeat.disconnectedAt = null;
    recoverableSeat.reconnectToken = reconnectToken;
    if (recoverableSeat.seatIndex === 0) {
      room.hostConnectionId = connectionId;
    }
    connections.set(connectionId, { ws, roomCode: room.code, seatIndex: recoverableSeat.seatIndex, playerId: `p${recoverableSeat.seatIndex + 1}` });
    sendTo(connectionId, {
      type: 'RECONNECTED',
      roomCode: room.code,
      seatIndex: recoverableSeat.seatIndex,
      reconnectToken,
      gameStarted: true,
      isHost: room.hostConnectionId === connectionId,
    });
    sendTo(connectionId, { type: 'FORCE_STATE_SYNC', state: room.state });
    broadcastRoomState(room.code);
    return;
  }
  const openSeat = room.seats.find((s) => s.type === 'open');
  if (!openSeat) {
    sendTo(connectionId, { type: 'JOIN_ERROR', reason: 'ROOM_FULL' });
    return;
  }
  const reconnectToken = crypto.randomBytes(16).toString('hex');
  openSeat.type = 'human';
  openSeat.connectionId = connectionId;
  openSeat.displayName = msg.displayName || `Player ${openSeat.seatIndex + 1}`;
  openSeat.connectionStatus = 'connected';
  openSeat.reconnectToken = reconnectToken;
  openSeat.disconnectedAt = null;
  connections.set(connectionId, { ws, roomCode: room.code, seatIndex: openSeat.seatIndex });
  sendTo(connectionId, { type: 'ROOM_JOINED', roomCode: room.code, seatIndex: openSeat.seatIndex, reconnectToken });
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
  const room = rooms.get((msg.roomCode || '').toUpperCase());
  if (!room) {
    sendTo(connectionId, { type: 'RECONNECT_ERROR', reason: 'ROOM_NOT_FOUND' });
    return;
  }
  const seat = room.seats[msg.seatIndex];
  if (!seat || seat.type !== 'human' || !seat.reconnectToken || seat.reconnectToken !== msg.reconnectToken) {
    sendTo(connectionId, { type: 'RECONNECT_ERROR', reason: 'INVALID_TOKEN' });
    return;
  }
  // A stale/duplicate connection for this seat (e.g. an old tab still
  // technically open) shouldn't linger once a fresher one takes over.
  if (seat.connectionId && seat.connectionId !== connectionId) {
    connections.delete(seat.connectionId);
  }
  if (pendingSeatTimeouts.has(`${room.code}:${seat.seatIndex}`)) {
    clearTimeout(pendingSeatTimeouts.get(`${room.code}:${seat.seatIndex}`));
    pendingSeatTimeouts.delete(`${room.code}:${seat.seatIndex}`);
  }
  seat.connectionId = connectionId;
  seat.connectionStatus = 'connected';
  seat.disconnectedAt = null;
  // FIX: if the reconnecting seat is the host seat (0), room.hostConnectionId
  // must move to this new connection too — otherwise every future
  // requireHost() check (Start Game, seat updates, converting a
  // disconnected seat) would keep comparing against the old, now-dead
  // connectionId and silently reject a legitimate host forever.
  if (seat.seatIndex === 0) {
    room.hostConnectionId = connectionId;
  }
  connections.set(connectionId, { ws, roomCode: room.code, seatIndex: seat.seatIndex, playerId: room.state ? `p${seat.seatIndex + 1}` : undefined });

  sendTo(connectionId, {
    type: 'RECONNECTED',
    roomCode: room.code,
    seatIndex: seat.seatIndex,
    reconnectToken: seat.reconnectToken,
    gameStarted: !!room.state,
    isHost: room.hostConnectionId === connectionId,
  });
  if (room.state) {
    sendTo(connectionId, { type: 'FORCE_STATE_SYNC', state: room.state });
  }
  broadcastRoomState(room.code);
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
      if (!seat || seat.seatIndex === 0) return; // host seat isn't reassignable
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
  if (!requireHost(connectionId, room) || room.state) return;

  const humanSeats = room.seats.filter((s) => s.type === 'human');
  const botSeats = room.seats.filter((s) => s.type === 'bot');
  if (humanSeats.length === 0) return;

  if (!BrokerBossEngine) BrokerBossEngine = loadEngine();
  const catalog = loadCatalogs();
  const usedBotNames = {};

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
  if (!conn) return;
  const room = rooms.get(conn.roomCode);
  if (!room) return;
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
        convertSeatToBot(room, seat, 'Random');
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
function convertSeatToBot(room, seat, archetype) {
  if (room.state) {
    const playerId = `p${seat.seatIndex + 1}`;
    const usedNames = {};
    room.seats.forEach((s) => {
      if (s.type === 'bot' && room.state.players[`p${s.seatIndex + 1}`]) {
        usedNames[room.state.players[`p${s.seatIndex + 1}`].displayName] = 1;
      }
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
  seat.reconnectToken = null;
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
    convertSeatToBot(room, seat, msg.archetype);
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

  ws.on('message', (raw) => {
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
        case 'RECONNECT_PLAYER':
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
        default:
          sendTo(connectionId, { type: 'ERROR', message: `Unknown message type "${msg.type}".` });
      }
    } catch (err) {
      console.error('Handler error:', err);
      sendTo(connectionId, { type: 'ERROR', message: 'Server error processing that message.' });
    }
  });

  ws.on('close', () => handleDisconnect(connectionId));
});

server.listen(PORT, () => {
  console.log(`Broker Boss Online relay server listening on port ${PORT}.`);
  console.log(`WebSocket URL for same-machine testing: ws://localhost:${PORT}`);
  console.log('For other devices on your network, use this machine\'s LAN IP instead of localhost.');
});

module.exports = { rooms, connections }; // exported for direct testing only
