# Agent economy (Noun World)

AI agents that are economic actors in Noun World. They keep the city's
economy moving when nobody's online: they own shops, set prices, trade COIN
on the real Grand Exchange order book, and deal with players.

This is the first slice. It ships five agents with rule-based policies, a
scheduled server tick, agent shops in rooms and on the Exchange floor, and an
agent ledger. An optional LLM policy is available but switched off.

Code:
- `packages/nouns-webapp/src/miniapps/agents/` holds the model, the policies, the runner and the UI.
- `src/miniapps/exchange/engine/shops.ts` holds the engine side of agent shops.
- `netlify/functions/world-agents-tick.ts` is the scheduled tick, and `world-agents.ts` is the read and admin endpoint.
- `netlify/lib/agentsTick.ts` holds the shared tick, and `agentLlm.ts` the optional Claude call.

---

## 1. The agent model

An agent has three parts.

| Part | Where it lives | What it holds |
|---|---|---|
| **Identity** (static) | `agents/roster.ts` (`AgentDef`) | id `agent:<slug>`, name, role, Noun seed, shop sign, the room kinds it works in, the goods it trades, its cadence, its biggest order, its goal in words, and its policy knobs |
| **Wallet** | the Grand Exchange's state (Blobs `noun-world-exchange`, `state`) | an ordinary exchange `Account` under its id: free and escrowed COIN, free and escrowed goods |
| **Record** (memory) | Blobs `noun-world-agents`, key `agents` (`AgentsDoc`) | per agent: next turn, turn count, last shop quotes, decayed demand per good, its last 8 notes, how far it has read the fill tape, its stats, a paused flag and its last line. Plus the shared **ledger** (newest last, capped at 300) |

The wallet lives in the exchange because the exchange is the only ledger of
COIN. Every agent balance is covered by `checkInvariants` (COIN and goods
are conserved), so no second balance sheet can drift.

**Roles** (`agents/policies/`):
- **shopkeeper** (Mochi, Reel, Velvet) keeps a target stock per good, restocks on the book, and prices its shop from stock and demand.
- **maker** (Ledger) quotes both sides on the book around fair value and leans against inventory.
- **collector** (Magpie) wants N of a few goods, buys dips, and never overpays.

**Goals** are numbers in the knobs (target stock, markup, want, patience),
plus one sentence (`goal`) shown to players and given to the LLM policy.

**Memory** is deliberately small and numeric:
- last quotes, so prices move at most 10% a turn;
- demand, which halves each turn: units the agent sold, which is how a shopkeeper learns what sells;
- short notes, for the ledger and the LLM.

## 2. The tick loop

`world-agents-tick.ts` is a Netlify scheduled function, set to run every 5
minutes (`*/5 * * * *`). It runs whether or not anyone's online. One run:
1. Load the exchange and the agent records, then tick the exchange's bots to now (the existing `tick`, bounded work).
2. `runAgents(ex, doc, now)` (pure):
   - **Funding.** An agent with no exchange account yet gets one, with the same one-off starter grant a rider gets (`riderAccount`, booked in `minted`). Nothing else ever funds an agent.
   - **Ledger.** Fills the agent was in since its last read go on the ledger and into demand. These are book fills against its resting orders, and shop sales made through `world-exchange`.
   - **Turns.** Each agent that is due and not paused takes one turn: `obsFor`, then a policy decision, then `guard`, then the engine (`place` / `cancel` / `setShop`). Its line goes on the floor feed.
3. `checkInvariants`. If the ledger is broken, **nothing is saved**.
4. Write the exchange with etag optimistic concurrency. If a player wrote in between, reload and redo the run (up to 6 tries), the same pattern `world-exchange` uses. Then write the records.

Each agent's cadence is 6–15 minutes, with a deterministic jitter, so a run
usually moves one or two agents. A run is deterministic from the same state,
which is tested.

Offline (`?offline=1`), or when the server doesn't answer, the browser runs the same
engine, bots and agents in the tab (`LocalAgents` in `agents/client.ts`).

## 3. Guardrails

No real money and nothing onchain: COIN is in-game only, as on the rest of
the Exchange.

**No minting.** The only COIN an agent ever gets from nothing is the
rider's starter grant, once. There are no bailouts and no wages. A broke
agent stays broke, and that is tested. Agents can't call `mint`, `townTrade`
or the treasury. They have no action for it.

**Same rules as players:**
- Orders go through `place` / `cancel`, with escrow, price-time priority, the 1% seller fee to the treasury and self-trade prevention.
- An agent has the same 12-open-order cap as a rider (`MAX_OPEN`, not the bots' 32).
- Shop sales are ordinary direct deals (`deals.ts` `settle`), so they go on the tape like any deal.

**No backdoors:**
- `playerAct` and `dealAct` refuse any owner that starts `agent:`, so nobody can act as an agent through the player API.
- Rider ids can't contain `:`, because the server strips it.
- Agent ids are public names, not keys.

**Caps** (`agents/guard.ts`, applied to every decision, rules or LLM):
- at most 12 actions a turn;
- only the agent's own goods, and only cancels of its own orders;
- prices are whole COIN within ±50% of fair value (`SHOP_BAND`);
- quantity is between 1 and the agent's `maxQty`;
- buying spends at most 60% of the agent's COIN a turn;
- text is short plain text.

**Shops** (`engine/shops.ts`):
- `setShop` clamps every line into the band, always keeps the bid under the ask, and caps a sale at 25 units.
- A shop whose quotes are over 2 hours old is shut, because fair value drifts and a stale quote would be free money.
- `shopTakes` sells only from free stock and buys only with free COIN.

**Rate limits:**
- one turn per agent per run, at the agent's cadence;
- the LLM is called at most once per agent per hour, and for at most 2 agents a run;
- the player's own trades with agents count against `world-exchange`'s 40 actions a minute.

**Bounded:** each run is a fixed loop over a fixed roster, with no recursion
and no retries beyond the etag loop. Tests run a simulated day of 288 runs
with a shopper and check, every step, that COIN is conserved, that minting
stays flat after the first run, and that every posted price is in the band.

**Admin.** `POST world-agents` with `X-World-Admin: $WORLD_ADMIN_TOKEN`:
`{action: 'pause' | 'resume', agent}`, or `{action: 'run'}` to tick now.

## 4. Players and agents

- **Rooms.** About half the owned rooms of a kind an agent covers have that agent behind the counter (`agents/rooms.ts`, the same on every client). The agent replaces the seeded owner: their name and Noun, with a 🤖 AGENT tag on their name label. A HUD chip, "<NAME>'S SHOP 🤖 AGENT", opens their shop. The board shows each good's stock, a BUY button at their ask and a SELL button at their bid.
- **The Exchange floor.** The agents walk the floor like the bots, labelled "Name · AGENT". Click one to open the same shop panel. The **🤖 AGENT LEDGER** button shows every agent's COIN and equity and their recent trades: who, what, at what price, and with whom. Counterparties appear as tags only, never a raw rider id.
- Agents also trade on the book, so players meet them as ordinary counterparties there as well.

Buying is an `offer` to the agent's id at its posted price through
`world-exchange` (POST). The agent answers at once, the way a bot does.

## 5. The optional LLM policy

`agents/llm.ts` is pure: it builds the prompt and parses the reply.
`netlify/lib/agentLlm.ts` makes the Claude call.

**Off by default.** It runs only when `AGENT_LLM=1` and `ANTHROPIC_API_KEY`
are both set, and only for agents marked `llm: true` (Mochi and Magpie).
`AGENT_LLM_MODEL` picks the model. The default is `claude-opus-5-5`, the
same as the repo's other Claude call. The Haiku model is far cheaper if this
runs often.

How a turn works:
- The model sees the same observation a rule policy sees, as compact JSON, and answers with JSON actions.
- Anything malformed is dropped. What's left goes through `guard` and the engine, exactly like a rule decision.
- An error or a refusal makes the agent fall back to its rule policy for that turn.

Tests never make a network call; they inject a fake.

## 6. Mapping onto onchain assets later

Goods are already token-shaped: an uppercase symbol and integer units. The
exchange's types file (`engine/types.ts`) describes the custody-contract
bridge. For agents specifically:
- **Snapshots.** Another session is building daily Base snapshots. An agent is just an exchange account, so it shows up in a snapshot like any rider. Add `role: 'agent'` (from the `agent:` prefix) so indexers can separate AI actors from people. The ledger (`noun-world-agents`) can be snapshotted alongside as an audit trail of why each agent traded.
- **Agent wallets.** If COIN or goods are ever bridged, each agent would get its own address (a smart account whose owner is the server signer). Every agent trade would then be a normal onchain transfer within the same caps. The guard rules would become a policy module on the account: spend cap per period, allowed tokens, max order size.
- **Supply.** Agents would hold only tokens bought with their bridged starter grant, never minted ones. The no-mint invariant becomes checkable onchain.
- **Until then**, COIN has no cash value and nothing here touches a chain.

## 7. Next steps

- Wire the Exchange's `TownFeed` to the trade/ economy, so agents respond to real town prices and van deliveries.
- Agents that commission things: post a buy-order "bounty" for a good players make (graffiti, recordings).
- Per-agent respect, so being a good customer gets better prices.
- More agents per town, with names from the residents' name tables.
