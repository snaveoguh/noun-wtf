# Growth plan: moments → ownership → agents → token

Status: a draft, 2026-11-01. Companion to [token-design.md](token-design.md) and
[legal-risks.md](legal-risks.md).

The agreed order:

1. market the game's moments now;
2. make what players do ownable onchain: daily Base snapshots of graffiti and records
   (another session is building this);
3. an agent economy (another session is building the first slice);
4. a token only once there's real activity.

This plan puts milestones and numbers on each step, and **gates the token on retention, not
on a date.**

---

## Where we are (measured 2026-11-01)

From the public `world-stats` and `world-exchange` endpoints:

| metric | now |
| --- | ---: |
| riders ever | 51 |
| sessions | 435 in 23 days (~19 a day; range 4–37) |
| total play time | ~47 h. One account has ~25 h; the median rider played ~4 minutes |
| wallets linked | 2 |
| Grand Exchange | only bots trade. Treasury 0, last fill 5 days before the read |
| D1 / D7 retention | **can't be measured yet** (see below) |
| graffiti pieces a day | **not counted per day yet** (tags are anonymous by design; count them, not who made them) |

That's a promising, very deep game with almost no audience yet. Every step below is about
getting people in, getting them back the next day, and giving them a reason to make things.

### Instrument first (week 1–2, before any marketing push)

You can't gate on numbers you don't collect:

- **Per-rider day bitmap** in `world-stats` (today a rider row has only `first` / `last` /
  `sessions`, and `days` is global). This gives D1, D7 and D30 by cohort, plus weekly actives.
- **Acquisition source:**
  - a `?src=` parameter on every shared link (clip, play-as, mini app, Noun O'Clock), kept
    with the rider's first session;
  - privacy: a source tag, never a profile.
- **Creator counts:** tags per day per wall now, and distinct writer tags (anonymous) once
  tags exist. Never per rider.
- **Trade ledger aggregates:** daily COIN earned, spent and held per rider (the 600/day figure
  in `SUPPLY.md` is a guess).
- **A private dashboard** of the gate metrics below, with weekly numbers kept so the trend
  is visible.

---

## Phase 1: market the moments (now → ~8 weeks)

Goal: a steady stream of people arriving through a moment, and a reason to come back
tomorrow.

### The loop

```
 a moment happens in game ─▶ it becomes a clip / card automatically ─▶ shared with a
   play-as link  ─▶ a newcomer lands IN that moment, as that Noun ─▶ they make their
   own moment ─▶ …
```

### What to build or point at (most of it exists)

- **Clips.** `packages/nouns-webapp/scripts/sizzle/` already renders real gameplay frame by
  frame in headless Chromium (the homepage reels).
  - Next: **record replays**. A proved record already carries its ride trace (`runProof.ts`),
    so a new speed, air or hang-time record can be re-rendered as a 10-second vertical clip
    with the rider's Noun and a play-as link. Every record becomes an ad that's provably real.
- **Play-as links.**
  - Existing: `/world?seed=…` (the crystal ball's PLAY), `/world?play=parkour|pool`,
    `/world?drop=1` and the missingnoun head. Make every share land you as the Noun in the
    clip, at the spot it happened.
  - Unfurls: `og-noun-image.ts` already makes Noun cards. Add record and moment cards.
- **Farcaster mini app.** Nothing exists yet (no `/.well-known/farcaster.json`). Start
  small:
  - today's Noun / Noun O'Clock countdown;
  - the missed-blocks reel with DREAM / PLAY;
  - "play as this Noun".
  - `useFarcasterAuth` exists for sign-in. The mini app is also the natural home of the
    future snapshot mints, since Base and the audience are both there.
- **Noun O'Clock as a daily event.** The auction settles every day. Make it a moment in the
  city:
  - a countdown in game;
  - a plaza gathering (the radio, the van, a Noun Breaks cypher);
  - the new Noun walks out as an NPC rider;
  - a daily "first to …" challenge that resets at Noun O'Clock.

  One reason to show up at the same time every day is the single best retention lever.
- **Crystal ball missed-blocks reel** (`/crystal-ball`, `MissedBlocks.tsx`). Every block after
  the auction ends shows the Noun it would have minted. Post the best of it daily ("the Noun
  that almost was"). DREAM saves it and PLAY rides it: it's a ready-made daily share card.
- **Today's wall.** Once snapshots land, post the day's best piece and its painter (with
  consent) from the snapshot.

### Phase 1 targets (to move to phase 2, sustained 2 weeks)

| metric | target |
| --- | ---: |
| sessions a day | ≥ 250 (from ~19) |
| weekly actives | ≥ 500 |
| D1 | ≥ 25% |
| D7 | ≥ 8% |
| share-link sessions | ≥ 30% of new riders arrive through a `?src=` link |

If D1 stays under 15% after 4 weeks of traffic, stop marketing and fix the first five
minutes (CAMP spawn, controls, what to do next). Traffic into a leaky bucket is wasted.

---

## Phase 2: ownable moments onchain (overlaps phase 1; ~weeks 4–16)

Goal: what you do in the city is kept, and is yours.

- **Daily Base snapshot** of graffiti and proved records (in progress elsewhere): a
  merkle root a day.
  - **Graffiti stays anonymous:** a piece is either untagged or signed with an optional
    writer's tag. The tag key lives on the writer's device and isn't linked to their rider or
    wallet (token-design.md §6a).
  - **Free:** being in the snapshot costs nothing.
- **Minting your own piece or record** as an edition is optional: ETH now, CITY later.
- **Wallet linking becomes worth doing.** World-stats `link` exists (2 linked today). Linking
  is how your pieces and records show up as yours onchain.
- **Keep it CC0 and opt-in.** Publishing to a snapshot defaults to CC0 with a clear checkbox,
  like the voice booth's consent.
- **Keep NTCOIN off.** If goods go onchain, deploy with NTCOIN capped at 0
  (token-design.md §1).

### Phase 2 targets

| metric | target |
| --- | ---: |
| weekly active creators (distinct writer tags painting, plus other creators) | ≥ 100 |
| graffiti pieces a day | ≥ 150 |
| linked wallets | ≥ 500 |
| snapshot pieces minted by their painters | ≥ 50 a week (proves people want ownership) |

---

## Phase 3: the agent economy (~weeks 10–24)

Goal: agents that do useful things in the city for players: running shops, trading goods,
hauling cargo, hosting events. They earn by serving people, not by being paid to exist.

- The Grand Exchange already has the pieces: order books, direct deals and NPC bot
  strategies (`exchange/engine/bots/`).
- Third-party agents should start on in-game goods and COIN only. No real-value tokens until
  counsel has looked (legal-risks.md §6).
- Measure distinct human counterparties, not volume. Volume is trivial to fake.

### Phase 3 targets

| metric | target |
| --- | ---: |
| agent trades a day | ≥ 1,000 |
| distinct linked humans trading with agents, weekly | ≥ 300 |
| agents run by people other than the builders | ≥ 25 |
| share of agent trades with a human on one side | ≥ 50% |

---

## Phase 4: the token gate

**CITY launches only when all of these have held for 8 consecutive weeks:**

| gate | threshold |
| --- | ---: |
| weekly active riders | ≥ 2,000 |
| D1 retention (rolling cohort) | ≥ 30% |
| D7 retention | ≥ 12% |
| weekly active creators | ≥ 200 |
| graffiti pieces a day | ≥ 300 |
| agent trades a day (≥ 50% with a human counterparty) | ≥ 1,000 |
| linked wallets | ≥ 1,500 |

Plus the non-negotiables:

- counsel's written sign-off for the launch jurisdictions, and a geofence;
- anti-farm defences live and tested (token-design.md §6). Respect events made
  server-witnessed, writer's tags and props live;
- a shop of CITY sinks people want (walls, rooms, styles, events) built *before* launch, so the
  first thing anyone can do with CITY is use it;
- contracts audited: ERC-20, merkle distributor, governor and timelock, vesting;
- the snapshot announced in advance, with rules fixed (token-design.md §4).

**Why these numbers.** The model (`docs/strategy/model/`) simulates ~2,000 weekly actives
against ~2,000 farm accounts. Below that, farmers are a bigger share of any reward pool than
any defence can fix, and a token with no users is pure speculation (legal-risks.md §1).

**What would push it later:** retention falling after a marketing spike, creators
plateauing, or agent activity that's mostly agents trading with agents.

**What not to do even if numbers are great:** pre-announce a date, run a points campaign
that promises conversion, sell anything, or list on a CEX in the first months.

---

## Metrics summary

| metric | now | phase 1 | phase 2 | phase 3 | token gate |
| --- | ---: | ---: | ---: | ---: | ---: |
| sessions a day | ~19 | 250 | — | — | — |
| weekly actives | ~30? (unmeasured) | 500 | 1,000 | 1,500 | 2,000 |
| D1 | ? | 25% | 28% | 30% | 30% |
| D7 | ? | 8% | 10% | 12% | 12% |
| weekly active creators | ? | — | 100 | 150 | 200 |
| graffiti pieces a day | ? | — | 150 | 200 | 300 |
| agent trades a day | bots only | — | — | 1,000 | 1,000 |
| linked wallets | 2 | 100 | 500 | 1,000 | 1,500 |

Dates are indicative. The gates are what count.
