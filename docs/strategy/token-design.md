# City token: design

Status: a draft for discussion, written 2026-11-01. Nothing here is built, deployed or promised.
There's no token, no contract, no sale and no date. Read [legal-risks.md](legal-risks.md)
before anything in this doc is said in public.

Working name: **CITY**. It's a placeholder. Don't use NOUN or NOUNS: Nouns DAO already has
`$nouns` (the NFT-backed ERC-20), and the name would suggest the DAO endorses this.

---

## 0. The opinionated summary

1. **One token, later.** It launches only once the gates in [growth-plan.md](growth-plan.md)
   have held for eight weeks. Today the game is about 40× short of them (§5).
2. **Don't ship NTCOIN to Base mainnet.** The repo already has a built, undeployed COIN
   cash-out token (§1). It would be a second token, and its design is play-to-earn: every
   farmed COIN becomes a sell order.
3. **COIN stays in the game forever.** It never converts at a rate. Players earn CITY from a
   score: concave, capped, gated, and backed by server-checked or snapshotted activity. They
   don't earn it from a COIN balance.
4. **No presale, no investor round, no KOL bag, no team premine above 5%.** 60% goes to
   players and creators: a launch conversion, four years of play rewards and creator rewards.
5. **The token is for three things:** spending in the city, paying (and bonding) agents, and
   governing the city's treasury and public space. It pays no yield, shares no revenue, has
   no buyback and no staking APY.
6. **Base, tied to the daily snapshots.** The merkle root that records each day's graffiti
   and proved records also carries that day's scores, so anyone can check every reward
   against public data.

---

## 1. What already exists in the repo (and why it changes the plan)

| Thing | Where | What it means for the token |
| --- | --- | --- |
| **Noun Trade COIN** (off-chain, server-authoritative) | `netlify/functions/world-trade.ts`, rules in `src/miniapps/world2/trade/ledger.ts` | The real economy. 150 COIN starter purse (`RULES.STARTER_COIN`), earned by driving goods between towns, selling and serving. Travel-time and rate-limit checks make it the most farm-resistant signal in the game, but it's still scriptable. |
| **Grand Exchange COIN** (a separate ledger) | `netlify/functions/world-exchange.ts`, `src/miniapps/exchange/engine/` | A second COIN balance: a 500 starter grant (`sim.ts` `STARTER_COIN`), a 1% seller fee to the exchange treasury (`book.ts` `FEE_BPS`), and seven NPC bots minted 27,700 COIN plus goods at genesis. Fees aren't burned. They bail broke bots out (`sim.ts` `bailout`). The live treasury was **0** on 2026-11-01. |
| **NounTradeGoods + NTCOIN** (built, not deployed) | `packages/noun-trade-contracts/` (`SUPPLY.md`, `src/NounTradeGoods.sol`), cash-out `netlify/functions/world-trade-claim.ts`, deposit `world-trade-deposit.ts` | An ERC-1155 for goods plus an ERC-20 **NTCOIN**, minted when players cash out earned COIN through server-signed vouchers. Caps: 5k/wallet/day, 500k/day globally, halving every 180 days, 210M max supply. Off everywhere: `VITE_TRADE_ONCHAIN: ''` in `.github/workflows/netlify-deploy.yml`, `deployments/` is empty. |
| **Respect** | `src/miniapps/world2/respect/rules.ts`, `netlify/functions/world-respect.ts` | Good conduct as a score, with tiers (local 50, regular 200, legend 600), rate limits and decay. **The client reports the events**: the server re-scores them but can't witness most of them ("helped", "ate"). Good as a gate, too weak to pay out on directly. |
| **Records + wallet links** | `netlify/functions/world-stats.ts`, `../lib/runProof.ts`, `../lib/walletAuth.ts` | Speed, air and hang-time records rise only with a ride proof checked against the physics. A signed `link` ties a rider to one ETH address, and `winners` lists linked leaders for payouts. The best existing anti-farm asset. |
| **Graffiti** | `netlify/functions/world-graffiti.ts` | Persisted and validated with the game's own codec, but **anonymous**: a POST has no rider. It can't be rewarded until the snapshot work attributes pieces. |

**On NTCOIN:** NounTradeGoods is careful work: vouchers, caps that only go down, a max
supply, deposit burns. The problem is what it is, not how it's built. A freely tradeable
ERC-20 minted 1:1 from earned COIN:

- **pays farmers in proportion to farming.** Linear in COIN is exactly the "naive" row in §6.
  The model hands farmers 70% of rewards under linear scoring;
- **makes the token before the activity.** It would be the project's first token and would
  set its price and reputation before any gate is met;
- **is the riskiest legal shape.** "Play and cash out" is the earn-to-cash-out pitch
  regulators read as an expectation of profit, and a server that pays out real-value tokens
  for in-game balances looks more like a money-services question. See legal-risks.md.

**Recommendation.** Keep NounTradeGoods on Base Sepolia. If goods go onchain before CITY,
deploy with the NTCOIN key's caps and max supply at 0. `TradeConfig.sol` sets them before
deploy, and the contract can only ever lower them. Goods then become ownable items, and COIN
stays in the game. Two things are uncertain: whether the deploy script handles a zero-cap
COIN key cleanly, and whether goods should wait for the snapshot NFTs. Check both before
deploying. When CITY launches, the deposit path (burn onchain, credit in game) is a good
pattern to reuse for "spend CITY in the city".

---

## 2. What the token is for

### 2.1 Spending in the city (the main sink)

Spending CITY should buy things you want, not things that make you win:

- **Space:** rent a premium wall for a week (your piece stays up and goes in the snapshot
  with a frame), a room in a building, a stall at the plaza, a billboard slot (the
  billboard videos already exist).
- **Style:** van skins and neon (today they're COIN upgrades, `trade/upgrades.ts`), board
  decks, rider outfits, a name-tag style, the legend noggles badge colourway.
- **Keeping things:** mint the onchain edition of your own snapshot piece or record, so the
  free daily snapshot becomes an owned token.
- **Events:** entry to a hosted tournament (Noun Breaks, Pool, Hoops, the Big Drop SSX course)
  where the prize pool comes from entries, not the treasury. The legal check on contests
  applies here, see legal-risks.md §6.
- **One way into COIN:** spend CITY to buy COIN at a fixed in-game rate. The CITY is burned
  or goes to the treasury. **COIN never goes back to CITY.**

Never for sale: competition advantage, record boosts, respect, or anything that changes the
physics or a leaderboard. Proved records stay earned.

Split of every in-game spend (`spendBurnBps` / `spendTreasuryBps` in the model): **50%
burned, 30% city treasury, 20% to the creator** whose thing was bought (a wall's painter, a
cover's artist, a room's builder). If nobody made it, that 20% goes to the treasury.

### 2.2 Agent fees and bonds

The agent economy (another session is building the first slice) needs a unit agents pay and
post as collateral:

- **A bond to operate:** an agent that trades for players or runs a shop posts a CITY bond.
  Misbehaviour proven against the ledger (wash trades, abandoned obligations, scam
  listings) is slashed: half burned, half to the people it harmed.
- **Fees:** every settled agent trade pays a small fee in CITY. The model uses **0.5%**, half
  burned and half to the treasury. Agents compete on service, not on token rewards.
- **The agents bucket (5%)** pays fee rebates and matches bonds for agents with real, distinct
  users. It never pays for volume alone, so wash trading earns nothing.

### 2.3 Governing the city

Holders (or their delegates) vote on what the city does with its treasury and public space:
grants to builders and artists, which walls are permanent, which districts or games get
built next, event calendars, the creator split. Proposals and the vote happen onchain on
Base: OpenZeppelin Governor plus a timelock, Nouns-style delegation, and a quorum.

What governance **doesn't** do: set emissions above the schedule, mint (the contract can't),
or touch player balances. Early on, a veto held by a small multisig of builders protects
against a governance attack. It sunsets after 12 months or once 30% of supply has
delegated, whichever comes first.

---

## 3. Supply and distribution

**Fixed supply: 1,000,000,000 CITY, all minted once at genesis into the contracts below.** The
ERC-20 has no mint function after deploy. It's 18 decimals, an OpenZeppelin ERC20 with
ERC20Votes and ERC20Permit, with no owner, no pause, no blacklist and no transfer tax.

| bucket | % | CITY | how it's released |
| --- | ---: | ---: | --- |
| **Launch conversion** (players' COIN / points) | 22.5 | 225,000,000 | one snapshot, §4. 25% at claim, 75% streamed over 6 months. Unclaimed after 12 months, or clipped by the caps, goes to play rewards. |
| **Play rewards** | 25 | 250,000,000 | weekly epochs for 4 years, halving yearly (`emissionSchedule`), §5 |
| **Creator rewards** | 12.5 | 125,000,000 | weekly for 4 years, halving yearly, pro rata to snapshot-attributed work that other players kept up |
| **Agents** | 5 | 50,000,000 | fee rebates and bond matching against distinct-user agent activity, §2.2 |
| **City treasury** | 20 | 200,000,000 | governed through the timelock, spending at most 5% of the treasury balance a quarter |
| **Liquidity** | 5 | 50,000,000 | single-sided range liquidity on a Uniswap pool on Base (no presale means no ETH to pair). The timelock holds the position, it's never withdrawn for the first 2 years and its fees go to the treasury. |
| **Commons** | 5 | 50,000,000 | half to nouns.eth as a gift (no conditions, no expectation), half as CC0 grants through the CC0 library (`/cc0`) to the artists whose CC0 work the city uses |
| **Builders** | 5 | 50,000,000 | the people building it: 1-year cliff, then 3-year linear. Disclosed by address. |

Players + creators = **60%**. Nothing is sold. Nobody pays for an allocation. There's no
private round, no market maker deal with a loan of tokens, and no paid influencer allocation.

The 5% builders bucket is a deliberate choice. Zero is cleaner on paper (builders would then
be paid by treasury grants instead), but it hides the real cost and moves pressure onto the
treasury. A small, disclosed, long-vested stake is more honest. Raise it with counsel: it's
part of the "efforts of others" analysis.

---

## 4. Converting COIN and points at launch

### 4.1 Why not 1:1

In-game COIN is inflationary by design:

- each rider gets two starter grants (150 trade + 500 exchange);
- a regular earns ~600 COIN a day (that's SUPPLY.md's assumption, never measured; see §7);
- once the van is upgraded, COIN has almost nothing permanent to buy. Every van upgrade costs
  4,420 COIN in total (`trade/upgrades.ts`), about **8 days** of a regular's profit
  (`daysToExhaustSinks`).

After that, COIN only piles up. Its quantity measures time spent scripting a trade loop at
least as well as it measures play. Converting it linearly would pay the best script.

### 4.2 The conversion

At one announced-in-advance snapshot (and never retroactively changed), each account gets
points (`retroPoints` in the model):

```
points = √(trade COIN earned + max(0, exchange equity − exchange grant))
       + 25 · max(0, respect tier − 1)      local 25, regular 50, legend 75
       + 40 · √(proved records held)
       + 15 · √(snapshot-attributed graffiti pieces)
       + 10 · √(distinct days played)
```

and the pool is split pro rata to points, with:

- **Gates:** wallet linked (world-stats `link`) before the snapshot is announced, at least 3
  distinct days played, not staff. Builders' own accounts get nothing here because they have
  their own bucket. Today one account holds about half of all play hours.
- **Cap:** at most **0.5%** of the pool per address (`RETRO_CAP_BPS`). Whatever the cap clips
  is redistributed among the rest (water-filling). What's still left goes to play rewards,
  never to the team (`retroConvert`).
- **Starter grants excluded:** `granted` in the trade ledger's `TradeBook`, and `grant` on the
  exchange `Account`.
- **Bots excluded:** `bot:*` accounts in the exchange.
- **The square root:** 100× the COIN is 10× the points.

At today's size (a few dozen riders), the cap means at most ~10% of the pool could go out and
the rest rolls into play rewards. The test is `retro: tiny populations hit the cap`. That's
on purpose: the conversion rewards early players without making a handful of people the
largest holders.

---

## 5. Emission and sinks, against the real flows

### 5.1 What's grounded and what's assumed

| input | value | source |
| --- | --- | --- |
| trade starter purse | 150 COIN | `trade/ledger.ts` `RULES.STARTER_COIN` (checked by a test) |
| exchange starter grant | 500 COIN | `exchange/engine/sim.ts` `STARTER_COIN` (test) |
| exchange fee | 1% seller → treasury | `exchange/engine/book.ts` `FEE_BPS` (test) |
| all van upgrades | 4,420 COIN one-off | `trade/upgrades.ts` (test) |
| largest building spend | 100 COIN | `RULES.MAX_SPEND` (test) |
| regular's profit | ~600 COIN/day | `noun-trade-contracts/SUPPLY.md`, **an assumption, not measured** |
| lifetime riders | 51 | live `GET /.netlify/functions/world-stats`, 2026-11-01 |
| sessions | 435 over 23 days, ~19/day (4–37) | same, `days` |
| total play | ~47 hours, top account ~25 h, median rider ~4 minutes | same, `playS` board |
| linked wallets | 2 | same |
| exchange | treasury 0, last fill 5 days before the read, bots only | live `GET world-exchange` |
| population at the gate, sell / spend rates, agent volume | see `ARCHETYPES`, `DEFAULT_PARAMS` | **assumptions** |

The honest reading: **there's no economy to tokenise yet.** The model below simulates the
population the gate requires (~2,000 weekly actives plus 2,000 farm accounts trying it on),
not today's.

### 5.2 Model

`docs/strategy/model/token.ts` is a pure TypeScript model: no imports, no clock, no
randomness, and tests prove conservation. Rerun it with:

```
node --experimental-strip-types docs/strategy/model/run.ts
node --experimental-strip-types --test docs/strategy/model/token.test.ts
```

Population: 1,400 casual players, 450 regulars and 150 creators (growing 1–1.5% a week). Two
farmer types try it on: 40 "grinder-bot" accounts scripting the trade loop all week, and
2,000 sybils (growing 5% a week) doing the minimum on fresh accounts. Each week, play and
creator rewards are paid by score. Players sell 20–30% of fresh rewards and farmers sell 100%.
Everyone spends a share of their balance in game (split 50 / 30 / 20 as in §2.1). Agent
volume starts at 2M CITY a week, growing 2% a week, at 0.5% fees.

**Defended rules (proposed):**

| week | emitted | to players | to farmers | sold | burned | to treasury |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 3,846,151 | 3,716,192 | 129,959 | 984,557 | 254,410 | 154,646 |
| 13 | 3,846,150 | 3,692,672 | 153,478 | 1,002,572 | 1,539,947 | 926,503 |
| 52 | 3,846,150 | 3,585,866 | 260,284 | 1,083,961 | 1,749,339 | 1,055,094 |
| 53 | 1,923,074 | 1,791,364 | 131,710 | 543,213 | 1,627,707 | 982,225 |
| 104 | 1,923,074 | 1,673,354 | 249,720 | 633,248 | 853,196 | 527,293 |

Farmers take **6.5%** of play and creator rewards. Over two years: 300M emitted, 84M sold,
132M burned, 80M to the treasury.

**Naive points (linear, no gates, the NTCOIN shape):** farmers take **70.1%**. By year two,
95% of each week's emission goes to farmers, and 232M of 300M is sold.

**Sinks sensitivity (players spend 3× less, agent volume ¼):** burn falls to 117M over two
years. It still passes the year-two emission, but only because emission halves.

What to take from it:

- **The defences matter more than the numbers.** Gates plus concave scoring plus caps move
  farmers from 70% to under 10% (asserted in `token.test.ts`).
- **Burn ≥ emission is an assumption about spending.** It holds if players spend 3–20% of
  their balance a week on things they want. If the shop is dull, it doesn't. Building good
  sinks (walls, rooms, styles, events) is the real tokenomics work.
- **What the model leaves out.** The retro bucket's unlock (it would add up to 56M liquid at
  claim and stream the rest over 6 months), treasury spending, price, and any reflexive
  "number go up" demand. Price is deliberately absent: the design must not depend on one.

### 5.3 Rules the contracts enforce

- Fixed supply, no mint.
- Each epoch's play and creator pools are capped by `emissionSchedule`. A merkle distributor
  receives exactly the week's amount, and unpaid remainders go back to the pool, never to an
  admin.
- Rewards for a week become claimable two weeks later (the review window, §6).
- Treasury: timelock, at most 5% of balance a quarter, and every spend onchain.

---

## 6. Anti-bot and anti-farm

Assume every rule will be attacked on the first day. In order of importance:

1. **Reward only what the server can check.** Records need run proofs (`runProof.ts`, exists).
   COIN must come from the server ledger (`world-trade.ts`, exists). Graffiti counts only
   once a signed daily snapshot attributes it. **Gaps to close first:** graffiti POSTs carry
   no rider (`world-graffiti.ts`), and respect events are client-claimed. Respect gates; it
   never pays out on its own.
2. **Wallet link with age:** a world-stats `link` at least 2 weeks before an epoch counts
   (`minLinkedWeeks`). One address per identity is already enforced, and merging browsers is
   fine.
3. **Gates, not points:** ≥ 3 active days in the week and respect ≥ local (50).
4. **Concave and capped:** √ on every input and 100 points per account per week. One script
   running 13× a regular's COIN gets the cap, not 13×.
5. **Diversity:** fewer than two kinds of activity (trade, graffiti, records, agents) halves the
   score. A pure trade bot is a one-trick account.
6. **Quality over quantity for creators:** pieces other players kept up, reacted to or didn't
   paint over in the next snapshot (`piecesKept`, weighted 2×) count more than raw pieces.
   Spamming walls earns little.
7. **A review window and clawback:** rewards unlock two weeks after each epoch. In that time,
   clustering (shared IP hash, device fingerprint, a common funding wallet, identical paths or
   timing) can void a cluster. Publish the method, not the exact thresholds.
8. **Optional proofs of personhood boost, never gate:** a Farcaster FID (`useFarcasterAuth`
   exists), Coinbase Verifications on Base, ENS age. Gating on these would shut out new
   players.
9. **No referral rewards and no quests for followers.** They are the farmer's favourite input.
10. **Agents:** fees and rebates count distinct, linked, active counterparties, never
    volume. A bond is slashed for proven wash trading.
11. **Human review at the top:** the top 1% of each epoch by payout gets a manual look before
    unlock.

---

## 7. Chain, snapshots, Nouns and CC0

- **Base.** It's cheap enough for weekly claims and daily roots, it's where the Farcaster and
  Coinbase audience already is, and NounTradeGoods already targets it (`TRADE_CHAIN_ID`
  8453).
- **The snapshot is the source of truth.** The daily Base snapshot (another session is building
  it) commits a merkle root of the day's attributed graffiti and proved records. Extend each
  leaf with the account's daily score inputs. The weekly epoch root is computed from seven
  daily roots by a published script, so anyone can recompute every payout. CITY rewards
  then become a function of public data, not of a server's say-so.
- **Ownable pieces stay free.** Being in a daily snapshot is free and automatic. Minting your
  own piece or record as an edition costs CITY, which is a sink. The art is CC0 like Nouns.
- **Nouns DAO:** the commons bucket sends 25M CITY to nouns.eth unconditionally. Don't ask
  the DAO to endorse, list or govern CITY, and never imply it did. Noun art in the game is
  CC0. CITY never claims rights over it.
- **CC0:** a 25M grants pool for artists whose CC0 work appears in the city (curated archive
  and community uploads, `src/pages/Cc0Library/`). The city's own output (graffiti, covers,
  voice packs shared under consent) defaults to CC0 when it's published to a snapshot, with
  a clear opt-in. Voice clips already need consent (`shareRecordings`). Keep it that way.

---

## 8. Open questions and uncertainties

- **The 600 COIN/day figure is unmeasured.** The first build is server-side daily aggregates
  of the trade ledger: earned, spent, distribution per rider.
- **Retention can't be measured today.** World-stats keeps `first` / `last` / `sessions` per
  rider and only global `days`. D1 and D7 need a per-rider day bitmap. See growth-plan.md.
- **Two COIN ledgers.** The exchange and trade balances are separate. Decide whether they
  merge before any conversion snapshot: the seam is noted in `world-exchange.ts`.
- **Respect is client-reported.** Make the high-value events server-witnessed (spends are
  already ledger actions) before respect gates anything that pays.
- **Graffiti attribution** needs a signed rider (or linked address) on every stroke batch,
  with privacy that matches the voice booth's public-tag approach.
- **Agent economy shape** isn't known yet. The 5% agent bucket and the 0.5% fee are
  placeholders.
- **Legal:** everything in §2–§4 needs counsel's read. In particular: the builders bucket, the
  treasury, the "spend CITY → COIN" path, tournaments, and whether a fixed-supply token with a
  scheduled emission to players is fine where the players are. See legal-risks.md.
