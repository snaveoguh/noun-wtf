# noun.wtf strategy: tokens and an agent economy, in one page

*Draft, 2026-11-01. Not legal or financial advice. Don't share outside the team, and don't
post anything about a token publicly, before counsel has signed off (see
[legal-risks.md](legal-risks.md)).*

## The decision

We're leaving the App Store route. Instead, what players do in the city becomes ownable
onchain, agents get a real economy, and a token comes **last**, once there's activity worth
tokenising. In that order:

1. **Market the game's moments now.** Record replays as clips, play-as links, a Farcaster
   mini app, Noun O'Clock as a daily event in the city, the crystal ball's missed-blocks reel
   (DREAM / PLAY).
2. **Make play ownable:** free daily Base snapshots of graffiti and proved records; paint
   it or set it and it's kept, and yours to mint.
3. **The agent economy:** agents that serve players (shops, trading, hauling), measured by
   the humans they serve.
4. **A token, CITY (working name),** only when the retention gates hold for 8 weeks.

## Where we really are

These are the public numbers from 2026-11-01:

- 51 riders ever, ~19 sessions a day, ~47 hours of total play, 2 linked wallets;
- only bots trade on the Grand Exchange;
- retention isn't measured yet.

The game is deep and the audience is tiny. The token gate is about 40× away, so **the next
job is getting people in and getting them back tomorrow, not tokenomics.**

## The token in six lines

- **For:** spending in the city (walls, rooms, styles, events, minting your snapshot piece),
  agent fees and bonds, governing the city's treasury and public space.
- **Not for:** yield, revenue share, buybacks, staking APY, pay-to-win.
- **1B fixed supply, minted once, no sale of any kind.** 60% goes to players and creators:
  - a capped launch conversion;
  - 4 years of play rewards;
  - creator rewards.

  The rest: 20% city treasury (timelocked), 5% agents, 5% liquidity, 5% to nouns.eth and CC0
  artists, 5% builders (1-year cliff, 3-year vest).
- **COIN stays in-game forever.** It never converts at a rate. Rewards come from a score:
  concave, capped, gated on a linked wallet, real days played and respect, and built only
  from what the server can check (run proofs, the trade ledger), plus graffiti other players
  keep up. Graffiti stays anonymous: writers can earn under an optional tag that's never
  linked to them.
- **Every in-game spend:** 50% burned, 30% treasury, 20% to the creator of what you bought.
- **Base,** with rewards computed from the same daily snapshot roots as the art and records,
  so anyone can check them.

## Two things to decide now

1. **Don't deploy NTCOIN to Base mainnet.** The repo has a finished, undeployed COIN
   cash-out token (`packages/noun-trade-contracts/`). Converting COIN 1:1 into a tradeable
   token pays farmers in proportion to farming. In the model, linear rewards send **70%**
   to farmers, against **6.5%** with the proposed defences. It would also be our first token,
   priced before any activity, and it's the riskiest legal shape. If goods go onchain, ship
   them with NTCOIN capped at 0.
2. **Instrument retention this week.** Per-rider day tracking in `world-stats`, a `?src=` tag
   on every shared link, and daily trade-ledger aggregates. We can't gate on numbers we don't
   collect.

## The token gate (all of these, for 8 weeks running)

| | |
| --- | ---: |
| weekly active riders | ≥ 2,000 |
| D1 / D7 retention | ≥ 30% / ≥ 12% |
| weekly active creators | ≥ 200 |
| graffiti pieces a day | ≥ 300 |
| agent trades a day (≥ half with a human) | ≥ 1,000 |
| linked wallets | ≥ 1,500 |

Plus: counsel's sign-off and a geofence, the anti-farm defences live, a CITY shop people want
before launch, audited contracts, and the snapshot rules announced in advance.

## Biggest risks

- **Legal:** a one-founder game with a token is a classic "efforts of others" pattern. The UK
  financial-promotion rules may cover even in-game mentions to UK players, and MiCA may need
  a white paper. Never use investment language.
- **Farming:** respect events are client-reported, so they must be made server-witnessed
  before they pay anything. Graffiti stays anonymous on purpose. It's rewarded through
  writers' tags that other, verified players vouch for, so farm tags earn nothing.
- **No sinks, no token:** burn only beats emission if people want to spend CITY in the city.
  The shop is the real tokenomics.

## The documents

- [token-design.md](token-design.md): purpose, distribution, launch conversion, emission and
  sinks against the real COIN flows, anti-farm, Base / snapshots / Nouns / CC0.
- [legal-risks.md](legal-risks.md): risk factors and questions for counsel (US, UK, EU, Costa Rica).
- [growth-plan.md](growth-plan.md): phases, milestones, metrics, the marketing loop.
- [model/](model/): a pure TS model of supply, sinks and player vs farmer rewards, with tests.
  Run it with `node --experimental-strip-types docs/strategy/model/run.ts`, or test it with
  `--test docs/strategy/model/token.test.ts`.
