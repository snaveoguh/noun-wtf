# noun.wtf/terminal — How To Use It

**Client ID 37.** Every bid, vote, feedback signal and candidate action fired from this terminal
carries noun.wtf's onchain client ID, so it counts toward client rewards.

---

## 1. Getting in

| URL | What you get |
|---|---|
| `noun.wtf/terminal` | The terminal feed — full screen, no site chrome |
| `noun.wtf/terminal/vote/567` | Any internal page, rendered in terminal skin |
| `noun.wtf` | Default (abacus) theme — switch to terminal from the theme picker |

The terminal is a **theme**, not a separate app. It owns the homepage when active; any other
route falls back to the normal site unless you keep the `/terminal/...` prefix.

## 2. What's on screen

```
┌──────────────────────────────────────────────────────┐
│ NOUN.WTF                        🪩   0x1234..abcd  ▾ │  header
├──────────────────────────────────────────────────────┤
│ ALL AUCTIONS BIDS PROPS VOTES CAND SPONSORS DELEG …  │  17 filter tabs
├──────────────────────────────────────────────────────┤
│                                                      │
│   live onchain activity feed (infinite scroll)       │
│                                                      │
├──────────────────────────────────────────────────────┤
│ > try: what proposals are active?                    │  prompt
└──────────────────────────────────────────────────────┘
```

- **🪩 disco** — rainbow gradient per feed row. On by default, persists in localStorage.
- **connect** — wallet button. **Required for the prompt to work at all.**
- **Filter tabs** — `ALL · AUCTIONS · BIDS · PROPS · VOTES · CAND · SPONSORS · DELEG · XFERS ·
  SALES · FORKS · STREAMS · GRANTS · DAO · LIL · V2 · CHAT`. `CHAT` swaps the feed for your
  conversation history with the agent and shows a message count.
- **Prompt** — one input line. Enter to send. `esc` closes the response overlay.

## 3. Before you type anything

**Connect your wallet.** The chat endpoint returns `401 requiresWallet` for anonymous users —
you'll get a "connect wallet" button inline instead of an answer. This is deliberate: it's how
per-wallet rate limiting and governance signing work.

Limits: **10 messages/minute**, a daily cap per wallet, **2,000 characters** max per message.

---

## 4. Command reference

Commands are parsed locally first — **free, no AI call, instant**. Anything that isn't a
recognised command falls through to Agent NounIRL (the LLM).

Commands are case-insensitive. `[...]` = optional.

### Governance

| Command | Does |
|---|---|
| `vote for prop <ID> [reason]` | Prepares an onchain vote (refundable, client 37) |
| `vote against prop <ID> [reason]` | Same, AGAINST |
| `vote abstain prop <ID> [reason]` | Same, ABSTAIN |
| `feedback for/against prop <ID> [reason]` | Non-binding signal via `NounsData.sendFeedback` |
| `leave feedback on prop <ID> <text>` | Same, natural phrasing |
| `show prop <ID>` | Status, proposer, For/Against/Abstain, quorum, time left, description |
| `active proposals` | Everything currently live, with time remaining |
| `execute prop <ID>` | Executes a queued prop past its timelock |

Also accepted: `lookup <ID>`, `info <ID>`, `proposal <ID>`, `list proposals`, `what proposals`.

Validity is checked before the wallet ever opens — it'll tell you if voting hasn't started,
has ended, or the prop is already `EXECUTED` / `QUEUED` / `CANCELLED` / `VETOED`.

### Lil Nouns

| Command | Does |
|---|---|
| `vote for lil prop <ID> [reason]` | Votes on the Lil Nouns governor |
| `vote against lil nouns proposal <ID> because <reason>` | Same, verbose form |

### Candidates

| Command | Does |
|---|---|
| `create candidate: <title> - <description>` | New proposal candidate (slug auto-generated) |
| `propose: <title> - <description>` | Alias |
| `sponsor candidate <keyword>` | Signs it via `addSignature` (EIP-712) |
| `promote candidate <keyword>` | Pushes a signed candidate to a real proposal |
| `feedback for/against candidate <keyword>` | Non-binding signal on a candidate |
| `show candidate <keyword>` | Full candidate detail |

`<keyword>` is fuzzy-matched across slug, title and body — exact slug wins, then slug contains,
then title, then description. Re-submitted candidates collapse into one family so you don't
accidentally sponsor a dead row.

### Grants (Small Grants treasury)

| Command | Does |
|---|---|
| `create grant: <title> - <description>` | New small-grant proposal |
| `vote for/against grant <ID> [reason]` | Vote (voting starts immediately, no pending state) |
| `show grant <ID>` | Grant detail |
| `active grants` | Live grant rounds |
| `execute grant <ID>` | Execute a passed grant |

### Auction

| Command | Does |
|---|---|
| `bid <amount> eth` | Bid on the current auction |
| `bid 0.5` | ETH implied |
| `bid 0.5 eth on noun <ID>` | Explicit noun id |

### Agent / settler

| Command | Does |
|---|---|
| `status` | Watcher state, transport, last block, next noun id + predicted traits for **both** V1 and V2, standing trait targets, reservation counts, total settlements |
| `check block` / `check` | Forces an immediate block check |
| `list traits <category>` | Every trait name in `background` / `body` / `accessory` / `head` / `glasses` |
| `my reservations` / `reservations` | Your active trait watches and their status |
| `watch for <trait>` | Explains the reservation flow and sets it up |

### Trading bot (pooter.world)

| Command | Does |
|---|---|
| `trading status` / `trading` / `positions` | Open positions, account value, win rate, realized P&L, trade count, watched markets |
| `market signals` / `signals` | Current bullish/bearish/neutral reads with confidence % |

### Meta

| Command | Does |
|---|---|
| `help` or `?` | Prints the full command list |

---

## 5. Natural language (Agent NounIRL)

Anything not matching a command goes to the agent, which has live governance context, the
trait database, a people database, and these tools:

`lookup_proposal` · `lookup_candidate` · `lookup_grant` · `prepare_vote` ·
`prepare_proposal_feedback` · `prepare_candidate_feedback` · `prepare_candidate` ·
`prepare_update_candidate` · `prepare_update_proposal` · `prepare_sponsor` ·
`prepare_promote` · `prepare_bid` · `prepare_queue_proposal` · `prepare_execute_proposal` ·
`prepare_grant_vote` · `prepare_grant_proposal` · `prepare_queue_grant` ·
`prepare_execute_grant` · `propose_trait` · `get_trading_positions` ·
`get_trading_performance` · `get_trading_signals`

There's also a loose natural-language layer that maps fuzzy phrasing onto canonical commands —
`"i want to bid 0.25 eth"` → `bid 0.25 eth`, `"sponsor the treasury diversification candidate"`
→ `sponsor candidate treasury-diversification`.

The agent knows which DAO and which noun you're looking at (V1 vs V2 vs Lil), so `"who owns
this one?"` resolves against the page you're on.

**Prompts that work well** (these rotate as placeholder hints):

```
watch for ice cream
what proposals are active?
my reservations
tell me about the treasury
status
traits head
how does the auction work?
tip nounirl.eth on any chain to reserve
ask about noun 10000
ask about missingnoun
```

Other things it handles: `philosophy` · `what's in the treasury` · `who is <ens or address>` ·
`explain prop 968` · `can I still update my proposal?` · `what are the rarest heads` ·
`what happened to noun 1234`.

## 6. Opening a proposal draft window

Three ways, all instant (no AI round-trip):

1. **Slash triggers** — `/draft`, `/prop`, `/proposal`
2. **Phrases** — `draft proposal`, `create a proposal`, `open a proposal window`,
   `proposal builder`, `give me a prop`
3. **Paste it** — paste >120 chars of proposal-shaped markdown (starts with `# Title`, or
   contains `## Summary` / `## Specification` / `## Rationale` / `## Proposal Action` /
   `## Risks`) and the draft window opens with the H1 lifted into the title field and the rest
   into the body.

The agent can also return a structured draft itself — ask it to build a multi-transaction
candidate ("pay three builders 2 ETH each and fund a multisig") and it assembles the
targets/values/calldatas for you.

## 7. Reserving a noun (the settler)

1. Tip **≥ $5 in ETH** to `nounirl.eth` — Ethereum, Base, Optimism, Arbitrum or Zora
2. Tell the terminal what you want: `watch for head:shark, glasses:blue`
3. The agent predicts each block's seed via the NounsSeeder keccak256 math
4. When the prediction matches **and** the auction has ended, it settles for you

Trait format is `category:name` — `head:shark`, `glasses:blue`, `body:hot dog`.
Reservations persist across deploys and work against both V1 and V2.

## 8. Gotchas

- No wallet = no prompt. The error is explicit but easy to miss on mobile.
- Every governance command **prepares** an action and shows a green confirm card — nothing is
  signed until you approve in your wallet. `esc` or `cancel` aborts.
- The agent will never cite a proposal's status from memory; if it doesn't have live data it
  says so.
- Filter tabs scroll horizontally on narrow screens (scrollbar hidden).

---
---

# Also in development on noun.wtf

A short tour of what else is live or in flight on the site.

### 🕸 `/nonsense` — the DAO as a 3D spider diagram
A Three.js "Neural Treasury": every fund flow through `nouns.eth` rendered as a live
force-directed graph. Glowing nodes, particle streams between them, type-specific 3D shapes,
bloom post-processing. Entities are typed and colour-coded — treasury, governance, nounders,
delegates, sub-DAOs, builders, culture, infra, education, public goods, art, events, media,
dev, community, bidders, wallets — with filter pills, search, a detail panel and a legend.
It's the DAO's whole spending history as one navigable object. `/stats` is a sibling: the same
data as a 3D "Treasury Corridor" you fly through.

### 🔤 stupidfont — the stupid font maker
Draw your own typeface in the browser, export a real font. Seeded from **Pip3 Beef** (five
hand-drawn takes per letter so repeated characters never look identical), with line smoothing
and the ability to load and remix any existing font. Now an installable PWA with a native
share bridge, and wrapped in Capacitor shells for **iOS and Google Play** (`wtf.noun.stupidfont`)
— Android release build is signed and ready; iOS is pending an Xcode pass. Store listings and
screenshots are written.

### ⛽ `/gas` — gas leaderboard
Dashboard of who has spent the most gas participating in Nouns, broken down by action:
bidding, settling, proposing, voting, queuing, executing, canceling, creating/updating/
canceling candidates, sponsoring, feedback, grant proposing, grant voting, grant admin,
delegation. Turns "who actually shows up" into a number.

### ⌐◨-◨ `/v2` — NounV2 auction + governance
A full second DAO namespace, launched day-one alongside V1: `/v2` for the live auction,
`/v2/noun/:id`, `/v2/vote`, `/v2/vote/:id`, `/v2/candidates/:id`, `/v2/crystal-ball`. Separate
token, IDs from 0, its own treasury and proposal flow — indexed, feed-integrated (`V2` tab) and
fully wired into the terminal's governance commands.

### 💸 `/grants` — small grants mechanic
An onchain Small Grants treasury with its own lightweight proposal lifecycle: propose, vote
(no pending period — voting opens immediately), queue, execute. Lower ceremony than a full DAO
prop, indexed end to end, with `GRANTS` as a first-class feed filter and full terminal command
coverage.

### 🔮 `/crystal-ball` — next-noun prediction
Predicts the next noun's traits from the parent block hash, rendered three ways — 2D SVG, 3D
morphing voxels (Tetris-style per-voxel reshuffle between seeds), or ASCII orb. Matches the
prediction against every existing noun to find "twins", and offers a SETTLE button on a 4/5 or
5/5 hit. Works for V1 and V2.

### 🎲 Everything else in flight
- **`/probe`** — the noun explorer (collection browse, plus community **Dreams**)
- **`/marketplace`** — cross-marketplace listings and per-noun detail
- **`/predictions`** — prediction markets on auctions and governance outcomes
- **`/gamer`** / **`/explore/wallet`** — wallet profiles: nouns held and delegated, governance
  activity, transfer history
- **`/settlers`** — the auto-settler bot's leaderboard and settlement maps
- **`/world`** — a full-screen 3D island sim (fixed-timestep, living scenery)
- **`/playground`** + **`/studio`** — trait playground and the 2D noun editor
- **`/terraforms`**, **`/highway`**, **`/pip3`** — onchain-art side quests
- **`/dashboard`**, **`/feed`**, **`/traits`**, **`/delegate`**, **`/hackathons`**,
  **`/underground`** — DAO analytics, chronological feed, trait stats, delegation UI, and
  event pages

Backlog items in progress: "Save as Dream" from the playground, and a "held by Nouns DAO
Treasury" branch for V4 auctions that settle with no bid (V4 routes those nouns to the treasury
rather than burning them).
