# Broker Boss Online — Multiplayer Setup

This build has TWO independent pieces:

1. **The game client** (`index.html`, `app.js`, `engine.bundle.js`, `style.css`,
   `catalog.json`, `agentCatalog.json`, `assets/`) — the same static files you've
   already been serving on `localhost:8080`. Nothing about how you serve these
   has changed.

2. **The relay server** (`relay-server.js`) — a NEW, separate Node.js process
   that powers real-time multiplayer (rooms, live opponent sync). Offline
   play against Bots does not need this at all.

## Running multiplayer

```
npm install        # only needed once, installs the 'ws' package
node relay-server.js
```

You should see:
```
Broker Boss Online relay server listening on port 8081.
```

Leave that running in its own terminal window/tab while players connect.

### Same computer / testing alone
Everything defaults to `ws://localhost:8081` — just open your game client as
usual and click "Play Online."

### Other devices on your home network (LAN)
Find this machine's local network IP (e.g. `192.168.1.23` — on Mac/Linux,
`ifconfig` or `ip addr`; on Windows, `ipconfig`). Other devices should open
the game client with a `relay` URL parameter pointing at that IP:

```
http://<this-machine-IP>:8080/index.html?relay=ws://<this-machine-IP>:8081
```

### Different networks / the real internet
The relay server needs a public address for that — either port-forwarding
on your router (opens security considerations worth understanding first) or
deploying `relay-server.js` to a hosting provider (Render, Fly.io, a VPS,
etc.) that gives you a public URL. That deployment step is genuinely outside
what can be done from a sandboxed dev environment — this file is what you'd
run wherever you host it. Once deployed, the same `?relay=` URL parameter
points players at that public address instead of a local IP.

## What's server-authoritative vs. client-side

The relay server actually runs your real `engine.bundle.js` (loaded via
Node's `vm` module) — every action from every player goes through the real
engine on the server, which then broadcasts the resulting state to everyone
in the room. This avoids two players' games ever silently drifting apart
from each other, which is a real risk if each client tried to compute game
logic independently off relayed clicks.

## Verified

- Two separate WebSocket connections: room creation, real-time join
  visibility, host-only permission checks, and a real in-game action
  (Place Meeple) broadcasting identical resulting state to both.
- Two separate full `app.js` client instances (not just raw WebSocket
  messages) driving the actual UI: landing screen → Create/Join Room →
  waiting room → bot assignment → game start → in-game action → both
  clients seeing the same result.
- Offline "Play vs Bots" mode confirmed unaffected — it never touches the
  WebSocket client at all.

## Not yet covered

- Reconnecting mid-game after a dropped connection (the server keeps your
  seat's data but the current UI doesn't offer a "rejoin with my old seat"
  flow).
- Spectator mode, chat, or any persistence across server restarts (rooms
  live in memory only).
