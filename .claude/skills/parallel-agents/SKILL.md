---
name: parallel-agents
description: Build big game features fast by splitting them across parallel background agents in git worktrees against a shared contract file, then integrating. Use when a request is large and separable (a new mini-game, sim + view + netcode, several independent features at once) or the user says "use separate agents", "smash it all out", "don't clash".
---

# Parallel agents for game dev

This is how Noun Hoops (sim / view / net), Noun Warfare and the scooter / blades / board-shop / bowl / crew batch got built at once without clashing.

## 1. Split along seams, freeze a contract first

- **Write the shared types yourself first.** Commit them to the branch before launching anyone, e.g. `hoops/contract.ts`: `CourtSpec`, `GameConfig`, inputs, `SimState`, `SimEvent`, net messages. Agents build against it and only ever *add* to it.
- **Good seams:**
  - a pure deterministic **sim** (no three.js, no DOM, no clock; JSON state; seeded RNG);
  - a **view** (rendering, HUD, audio) that reads sim state;
  - a **net/flow** layer (lobbies, sync, the relay);
  - unrelated features each in their own directory.
- **Shared files:** give each agent a list of the files it may touch. For shared files (`Game.ts`, `World2Page.tsx`), tell it to keep hooks small and additive.

## 2. Launch

**The owner's standing rule: new big work runs at full speed, in its own cloud session.**
- **Why:** background `Agent`s all share this session's one container. On 2026-10-26, ten at once pushed the load average to 87: tsc and vitest took 10+ minutes, and everyone crawled.
- **How:** each big feature or new game goes to its own session via `create_session` (claude-code-remote MCP; same repo, its own branch). It gets its own container, so it runs at full speed. Hand it the full brief below as the `prompt`, plus "push to branch `claude/<feature>`, don't merge to main". Then `git fetch` + merge its branch here once it reports. Check on it with `get_session` / `list_events`, not by polling.
- **Small things stay local:** quick follow-ups, one-file fixes and integration work.
- **In-session `Agent`s:** at most about 3 at once.

Locally, use `Agent` with `isolation: "worktree"` and `run_in_background: true`, all launched in one message.
- **Each brief stands alone:**
  - the goal and the contract path;
  - the files it owns;
  - a quality bar: tsc clean, a vitest spec list, a browser check following `world-browser-test` on its **own port** (5300+);
  - "commit on your worktree branch, don't push, don't deploy";
  - the commit attribution lines;
  - the shell gotchas: `pkill -f` kills your shell, use `--no-HMR` vite;
  - "report: branch, commits, architecture, tests, screenshot paths, known limits".
- **Worktrees** live at `.claude/worktrees/agent-*` with `node_modules` symlinked from the main checkout.
- Don't duplicate a running agent's work, and don't read its transcript file. Wait for its notification.

## 3. Integrate

- `git merge --no-edit worktree-agent-<id>` into the session branch, one at a time.
- **Contract conflicts:** keep both sides. They're additive by design.
- **Write adapters at the seams** (e.g. `factory.ts` wiring the real sim and view):
  - unify the coordinate transforms, so the view's court-to-world and the input's court-to-world are the same rotation;
  - allow a single results screen (`showFinal: false` on the second);
  - keep NPCs off the play area (`crew.bench(true)`).
- Re-run tsc, every agent's tests, and an end-to-end browser pass on desktop **and** phone before shipping (`ship-noun-wtf`).

## 4. When things break

- **Interrupted agents can't be resumed.** Commit their worktree WIP (`git -C <wt> add -A && git commit -m WIP`) and relaunch with "continue from WIP commit X". Ask the user first if credits matter.
- **An agent may start from an older base.** Check that its branch contains the feature it extends, and fast-forward it if not.
- **Report to the user while agents run:** what's still building, rough ETA, nothing invented.

## Sizing

- Medium features: 1 agent each.
- A new game: 2–3 agents (sim / view / net), or 1 agent for phase 1 and another for the netcode phase.
- Phase online play behind a working offline / bot version, so the game ships early.
