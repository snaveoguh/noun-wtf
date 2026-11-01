# Legal and regulatory risks: points to raise with a lawyer

> **This is not legal advice.** It was written by an AI assistant from general knowledge,
> to help the team prepare for a conversation with qualified counsel in each relevant
> country. The law here changes quickly: US market-structure legislation, the UK's new
> cryptoasset regime and EU MiCA guidance were all moving through 2025–26. Every point below
> may be out of date or wrong for this project. Nothing here should be relied on to make a
> decision, and **nothing about a token should be said or done publicly before counsel
> signs off.**

Context: [token-design.md](token-design.md) proposes CITY, a fixed-supply ERC-20 on Base. It
has no sale, and it goes to players by score for play and creation, with in-game spending,
agent fees and city governance as its uses. The repo also contains an undeployed cash-out
token, NTCOIN (`packages/noun-trade-contracts/`), which the design recommends not
launching.

---

## 1. The core question: could CITY be a security (or a regulated cryptoasset)?

### United States: the Howey test, in plain English

A court asks whether people (1) invest money (2) in a common enterprise (3) expecting
profit (4) from the efforts of others. All four must be present. The token-design choices
map onto them like this:

| element | what pushes towards "security" | what the design does about it | residual risk |
| --- | --- | --- | --- |
| **Investment of money** | a sale, presale or SAFT; buying an allocation | **no sale of any kind**: CITY is earned by playing and creating | courts have found "investment" in non-cash contributions; time spent or data given could be argued; secondary-market buyers do pay money |
| **Common enterprise** | pooled funds, a treasury everyone's fortunes depend on | no raise; the treasury is funded by tokens, not money | a 20% treasury plus a builders bucket looks like a common pot |
| **Expectation of profit** | marketing about price, "early", "listing", "APY", buybacks, revenue share | **no yield, revenue share, buyback or staking APY**; utility first | people will speculate whatever we say; a liquidity pool makes trading easy; the play-to-earn framing is dangerous |
| **Efforts of others** | a core team whose work drives the value | governance of the treasury and public space; CC0 art; agents run by third parties | today **one person builds almost everything**; the value of CITY obviously depends on that work |

Honest view: **the "efforts of others" prong is the weakest point.** A game built by one
founder, with a token whose usefulness depends entirely on the founder continuing to build
it, is the classic pattern. Decentralisation helps over time: third-party agents, creators
paid by the city, and governance that actually controls the treasury. It doesn't help on day
one.

US posture as we understand it (verify all of this):

- The SEC's stance softened in 2025. Staff statements said meme coins generally aren't
  securities and some forms of staking aren't either, and there's a "Project Crypto"
  rule-making agenda.
- Congress passed stablecoin legislation (GENIUS Act, 2025). Market-structure legislation
  (the CLARITY Act) had passed the House by mid-2025, and its final status should be checked.
- None of this is a safe harbour for a game token. Enforcement priorities change with
  administrations, and **private class actions and state regulators remain a risk whatever
  the SEC does.**

### Questions for US counsel

1. Under current SEC guidance and any enacted market-structure law, how would CITY be
   classified, and does the "earned by play, no sale" design change the analysis?
2. Does a 5% builders allocation, or a 20% treasury governed by token holders, create a
   common enterprise or an "efforts of others" problem we can reduce?
3. Is it better to launch with no liquidity pool at all (transfers only), and let a market
   form on its own, than to seed single-sided liquidity from the treasury?
4. Should US persons be excluded from claims (geofencing) at launch? If so, is IP geofencing
   plus attestation enough, or do we need KYC?
5. Do weekly play rewards to US players raise issues under state money-transmitter laws, or
   under gambling, sweepstakes or contest laws (for paid-entry tournaments)?

---

## 2. United Kingdom

The owner is likely UK-based, so UK rules may apply to the project itself, not just to UK
players. **Raise this first.**

- **Financial promotions:** since October 2023, marketing "qualifying cryptoassets" to UK
  consumers is a regulated financial promotion. It must be made or approved by an authorised
  firm (or a registered cryptoasset business using the exemption), with:
  - prescribed risk warnings;
  - a 24-hour cooling-off period for first-time investors;
  - appropriateness checks;
  - **no referral bonuses.**

  A tweet, a Farcaster cast, an in-game banner or a homepage card saying "earn CITY" to UK
  users could count. This is a criminal-offence regime, not a technicality.
- **The new regime:** the UK was legislating a full authorisation regime for cryptoasset
  activities (issuing, operating trading venues, staking, etc.) through 2025–26, expected to
  apply from around 2027. Check where it is, and whether making a token available to the
  public, or running the agent marketplace, would need authorisation.
- **AML registration:** running exchange-like or custody-like services (the agent economy, a
  cash-out bridge) may need FCA AML registration.
- **Tax:** HMRC generally treats tokens received for doing something (playing, creating) as
  income at their value when received. Players may owe tax on rewards they never sold. The
  project may have PAYE-like or reporting questions if contributors are paid in tokens.

### Questions for UK counsel

1. Is CITY a "qualifying cryptoasset" for the financial promotion rules? If so, can *any*
   in-game or social mention of rewards be made to UK users without an authorised approver?
2. Would the project, or the owner personally, be "issuing" or "offering" a cryptoasset under
   the forthcoming regime? What's the timeline?
3. Should UK users be excluded from claiming until there's an approved promotion route? How
   do we handle UK players who earned points before launch?
4. What does the builders allocation mean for the owner's personal tax (at grant, vesting or
   sale)?

---

## 3. European Union (MiCA)

- CITY would most likely be an "other crypto-asset" under MiCA Title II. Offering it to the
  public, or seeking admission to trading, generally needs a **crypto-asset white paper**
  notified to a national regulator, with liability for its content.
- **Exemptions to ask about:**
  - an offer **free of charge**. Airdrops can fall in this, but EU regulators have said that
    "free" doesn't cover tokens given in exchange for personal data or other consideration,
    and players' play and data may count;
  - small offers, or offers to under 150 people per member state;
  - tokens giving access to an **existing** good or service.
- If CITY is traded on a centralised exchange, that exchange will want a white paper, and the
  issuer may still be responsible for it.
- Running agent-economy services for EU users could be a crypto-asset service (CASP)
  needing authorisation.
- Consumer protection (unfair practices, minors), and GDPR for anti-sybil data: IP hashes,
  device fingerprints and wallet clustering are personal data.

### Questions for EU counsel

1. Does a free, score-based distribution to players count as an "offer to the public"?
   Does the free-of-charge exemption apply when players give play time and data?
2. Do we need a MiCA white paper before any liquidity pool or exchange listing? Who would be
   the "offeror"?
3. Is the agent marketplace a CASP activity?
4. What's the lawful basis, and the data-minimisation approach, for anti-sybil clustering
   under GDPR?

---

## 4. Why no presale (and no private round)

- **A sale is the clearest "investment of money"** and moves the token squarely into
  securities and prospectus territory in the US, UK and EU.
- **It creates people with a financial stake in the price,** who then pressure the
  project's marketing towards price. That's exactly the language we have to avoid.
- **It front-runs the activity.** A sale before the game has retention would price the token on
  hope. The design gates the token on real use instead ([growth-plan.md](growth-plan.md)).
- **It brings in farmers and flippers rather than players.**

The same reasoning argues against:

- market-maker loan deals;
- paid KOL allocations;
- "whitelist" mints for a fee;
- any discounted allocation for advisors.

---

## 5. Airdrop and points considerations

- **Points programmes are being watched.** Regulators and courts have looked at points
  programmes that clearly promise a later token. Don't call COIN, respect or records
  "points" that will become a token, and don't promise conversion before the decision is
  made. Today COIN is in-game only, with no cash value (`exchange/engine/types.ts` says so),
  and it must stay that way in all copy until counsel agrees otherwise.
- **The retroactive snapshot must be announced before it's taken** (no rule changes after
  people have played) and applied fairly. Excluding builders' own accounts is good practice.
- **Vesting a player's claim** reduces day-one dumping. Ask whether it changes the analysis,
  for example by making it look like a compensation plan.
- **Minors:** Noun World is a game kids could play. Token claims should be 18+, using
  age-gated wallet linking or attestation, and the in-game economy should keep working
  without a token.
- **Sanctions:** block claims from sanctioned jurisdictions and screen addresses (OFAC, UK
  HMT, EU lists). Ask which screening tools count as reasonable.
- **Tax information:** tell players plainly that rewards may be taxable income where they live.
- **Clawback:** the two-week review window, and voiding farmed clusters, need clear published
  terms so it isn't arbitrary confiscation.

---

## 6. The game-specific risks

- **Cash-out of in-game currency (NTCOIN).** Turning earned COIN into a tradeable token through
  server-signed vouchers puts the project in the position of paying out value for activity on
  its own ledger. That raises **money transmission / e-money** questions, as well as
  securities ones. The design recommends not deploying it (token-design.md §1). If it ever
  ships, it needs its own legal review.
- **Paid-entry tournaments** with CITY prizes may be gambling, or a regulated prize
  competition, depending on the skill element and the jurisdiction. In the UK, a free entry
  route or genuine skill tests matter. The existing prize payouts to linked winners
  (`world-stats` `winners`) should get the same review.
- **Spending CITY to buy COIN.** A one-way, fixed-rate, in-game-only path is the safer shape.
  Never offer a COIN → CITY route.
- **Agents trading for players** may be investment management or a trading venue if they
  touch real-value tokens. Keep agents to in-game goods until counsel has looked.
- **Loot boxes and randomness:** don't sell random rewards for CITY.
- **App stores:** the owner is leaving the stores. Store rules around crypto then matter less,
  but the web app is still a consumer product under consumer law.

---

## 7. Marketing language

**Never say (anywhere, including Discord, Farcaster, X, in-game, the homepage, or a cover
caption):**

- "investment", "invest", "ROI", "returns", "yield", "APY", "passive income";
- "early", "get in before", "moon", "100x", "price", "pump", "listing", "launchpad";
- "airdrop farming", "points = tokens", "earn money playing", "play-to-earn", "cash out";
- "backed by Nouns DAO", "official Nouns token", or anything implying endorsement;
- "limited supply, buy now", "deflationary, so it goes up", "burn makes it scarce";
- price predictions, treasury value per token, or token comparisons.

**Prefer:** describe the game and what you can *do* or *make*. "Paint a wall, it's kept in
today's snapshot." "Rent the big wall for a week." "Vote on what gets built next." Talk
about the city, not the chart.

Every public post about the token should go through one person with a checklist. In the UK,
assume a financial-promotion approver is needed until counsel says otherwise.

---

## 8. Geofencing (to discuss)

A possible default at launch, pending advice:

- **Claims blocked:** sanctioned jurisdictions, and any jurisdiction counsel flags (likely the
  US and UK at first, possibly others such as Canada, China and some EU states).
- **The game stays open to everyone.** Only token claims and token-denominated features are
  fenced.
- **Layers:** IP geolocation plus a self-attestation at claim, and terms that make
  misrepresentation the claimant's problem. Ask whether that's enough, or whether KYC is
  needed above a claim size.
- **Points earned before launch** by players in fenced places: does excluding them later
  create a fairness or consumer-law issue? Get advice before any snapshot is announced.

---

## 9. A short list for the first call with counsel

1. Classification of CITY in the US, UK and EU, given no sale and earned-by-play.
2. The UK financial promotions regime: what we may say in game and on social, to whom, and when.
3. MiCA white paper and the free-offer exemption.
4. Builders allocation and treasury: structure, disclosure, personal tax.
5. Geofencing scope and method, and what happens to fenced players' pre-launch activity.
6. Tournaments and prizes, including the existing prize payouts to record winners.
7. The agent economy: is any part of it a regulated service?
8. NTCOIN: confirm not deploying it is the right call, or what it would take.
9. Which entity issues CITY (foundation, company, none), where, and how it's governed.
10. Terms of service, risk disclosures, privacy notice for anti-sybil data, and age gating.
