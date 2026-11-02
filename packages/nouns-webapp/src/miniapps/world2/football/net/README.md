# Noun Football netcode (football/net)

Host-authoritative, like hoops / breaks: the host runs the sim, everyone else
sends pads and draws the host's snapshots. Pure and Game-free; tests run it over
a `LoopbackHub` routed through the real relay
(`npx vitest run src/miniapps/world2/football/net`).

| file                                              | what                                                                                                                                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transport.ts`                                    | `FootballTransport` (`selfId`, `online`, `send`, `onMessage`), `NetTransport` over `Net.ts` (`sendFootball` / `onFootball`), `LoopbackHub` (latency / jitter / loss, seeded, optional relay) |
| `codec.ts`                                        | quantised `SimState` ↔ base64, compact events, pads, `readMsg` (every message off the socket goes through it)                                                                               |
| `sync.ts`                                         | `FootballHost`, `FootballClient` (and WATCH: `createWatcher`, `me: null`), `HostClock`                                                                                                       |
| `lobby.ts`                                        | `FootballLobby`: discovery, hosting, teams, challenges, watch                                                                                                                                |
| `stubSim.ts`                                      | a tiny `FootballSimApi` for tests (and a stand-in until `sim/` lands)                                                                                                                        |
| `../../../../../nouns-party/src/footballRelay.ts` | the relay (worker side)                                                                                                                                                                      |

## Message flow

```
lobby     host ──football:lobby (every 2 s, open:false = gone)──▶ room
          player ──football:join {to: host, team | leave}──▶ host
          A ──football:challenge {to: B}──▶ B ──football:reply {accept}──▶ A
start     host ──football:start {config}──▶ members (host + connected config.humans)
play      member ──football:input {seq, pad} (30 Hz)──▶ host
          member ──football:ping {c}──▶ host ──football:pong {c, a}──▶ member
          host ──football:s {d, e, a} (15 Hz)──▶ members + watchers
watch     viewer ──football:watch──▶ host ──football:start {to: viewer}──▶ viewer
late join listed human ──football:join──▶ host ──football:start {to}──▶ them (relay makes them a member)
end       host ──football:end {winner, score, pens?, reason: 'final'}──▶ members + watchers
          anyone ──football:leave (or socket close)──▶ the rest; the host leaving ends it ('host_left')
```

- Snapshots: ~450 B binary for 11-a-side (≤ 620 chars base64, ≤ 660 B a message).
  `e` is `[firstSeq, …events]` covering the last ~1.5 s, so a lost snapshot
  loses no events; clients play each seq once, when the drawn tick reaches it.
- Clients draw ≥ 100 ms behind the host clock (more when latency / jitter need it),
  `prev / next / alpha` straight into `FootballViewApi.draw`.
- A remote pad that's late is held; silent for 0.5 s it becomes `NO_PAD`; a human who
  left is left out of `step`'s inputs.

## Deploying

Online play needs the multiplayer worker redeployed (the owner runs it, logged into
Cloudflare):

```
cd packages/nouns-party && npx wrangler deploy
```

An old worker drops `football:*`, so VS CPU (no network) still works without it.
