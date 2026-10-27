---
name: live-relay-probe
description: Prove which version of a deployed WebSocket relay / multiplayer server (PartyKit, PartyServer on Cloudflare, any room-based relay) is actually live, by opening two sockets in a throwaway room and checking which message types get relayed. Use when the user asks "did my deploy work?", "is online X live?", or before telling them to redeploy.
---

# Probe a live relay

Don't ask the user whether they deployed: test it. A new relay forwards new message prefixes (e.g. `pool:*`, `hideseek:*`, `break:*`); an old one silently drops them.

## How

- **Two sockets, a throwaway room** (`probe-<random>`): never the real game room.
- **A sends:**
  - one control message every version relays (e.g. a chat transcript);
  - one cheap broadcast message per feature (each relay's `*:lobby` goes to everyone else in the room).
- **B records every `type` it receives.**
- **Read it:** control arrived but feature X didn't → the old relay is live for X. Everything arrived → the deploy is live.

Run it from a browser context through the environment's proxy. Node's global WebSocket ignores `HTTPS_PROXY`; Playwright's `chromium.launch({ proxy: { server, username, password } })` with `--ignore-certificate-errors` works.

```js
const room = 'probe-' + Math.random().toString(36).slice(2, 10);
const url = `wss://<worker-host>/parties/main/${room}`;
// open A and B, B.onmessage → got.push(JSON.parse(e.data).type)
A.send(JSON.stringify({ type: 'world:voip:transcript', text: 'probe' })); // control
A.send(JSON.stringify({ type: 'pool:lobby', tables: [] }));
A.send(JSON.stringify({ type: 'hideseek:lobby', games: [] }));
A.send(JSON.stringify({ type: 'break:lobby', at: [0, 0] }));
// wait ~4 s, then print got
```

On 2026-10-27 noun.wtf's worker returned `world:voip:transcript, pool:lobby, hideseek:lobby, break:lobby`: the user's `wrangler deploy` had gone out, so online pool / hide & seek / breaks were live.

## Design rule that makes this cheap

Prefer adding features without a relay deploy at all: put new per-player state in the existing pose / state blob as optional short keys. Older clients ignore unknown keys and the relay passes the blob untouched. Only add new message prefixes when the routing truly needs the server (lobbies, host-only fan-out), and say "needs a worker deploy" in the PR.
