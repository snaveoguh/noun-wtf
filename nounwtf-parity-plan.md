# noun.wtf — mobile fixes, nouns.camp parity, and what's next

Written overnight 2026-09-19 while you slept. Two parts: what shipped to
`staging` tonight, and a prioritised plan for "parity with nouns.camp, better
than nouns.game". Everything below the fold is a proposal for you to react to,
not something I did.

---

## 1. Shipped to staging tonight

### Draft window (`/draft` from the terminal)
- **Full width.** The window now sizes to the viewport (up to 1320px) instead of a
  fixed 880px, and the panel uses a real `main | 240px rail` grid. The old layout
  had a phantom 320px column that nothing filled — that was the dead space on the
  right in your screenshot.
- **Markdown was rendering — it was unreadable.** The preview existed, but the
  terminal theme's `* { font-weight: normal; text-transform: uppercase }` stripped
  bold and capitalised everything, and tables/lists/code had no styling. Now:
  editor and live preview side by side, tables with borders, bullets, headings
  sized, inline code stays monospace and case-exact.
- **Font picker at the top of the window.** Default **Figtree**. Comic Sans is
  second, Pip3 third (keeps uppercase since it has no lowercase glyphs), then
  Londrina Solid, and ~70 Google fonts grouped Sans / Serif / Display /
  Handwriting / Mono. Faces load lazily on first pick; the choice is remembered.
  Rendered and screenshotted at 1440px and 390px — fits both.

### Proposal page on phones — the "vote bar off the page" bug
Root cause found and fixed: the proposal page grid was an inline
`gridTemplateColumns: '1fr 340px'` with **no breakpoint**. On a 390px phone the
340px sticky vote column can't shrink, the content column collapses, and the page
overflows sideways. Same bug on the Yellow Collective vote page. Both now use a
`.vote-page-grid` class that collapses to one column under 900px, with the vote
panel **first** on phones (the tallies already sit above it). `minmax(0, 1fr)`
also stops long addresses / hashes / wide tables widening the column.

Also fixed while in there: the "Quorum N" label on the voting bar was positioned
*inside* an `overflow: hidden` container at `top: -18px` — it was clipped and has
never actually been visible. It now sits above the bar.

**Caveat:** I could not render the proposal page with real data (the API and RPC
hosts are blocked from this container), so the mobile fix is verified by
reading the CSS, not by screenshot. Please open a live prop on your phone.

---

## 2. Mobile audit — what I found and did not fix

| Where | Finding | Status |
|---|---|---|
| `pages/Vote/index.tsx` | Inline `1fr 340px` grid, no breakpoint | **Fixed** |
| `pages/Vote/YellowCollectiveVotePage.tsx` | Same | **Fixed** |
| `VotingOverview` | Quorum label clipped | **Fixed** |
| `ProposalVoteActivity` | Two `whiteSpace: nowrap` spans in vote rows — likely to overflow long ENS names on phones | Not touched — needs a real render to confirm |
| `pages/Vote/Vote.module.css` | `width: max-content` / `min-width: fit-content` in flex rows | Only used by `ProposalHistory`, not the main page — low priority |
| `NavBar` | Has breakpoints at 992/768 — probably fine, not audited visually | — |
| `GameEditProposal` | Same phantom 320px editor column as the draft window had | Not touched — same one-line fix (`propEditorWrapFull`) if wanted |

The honest gap: **nothing on the site has a mobile render test.** Every page I
looked at is inline-styled with desktop numbers and no breakpoints. A cheap,
high-leverage fix is a Playwright script that loads each route at 390px against
recorded API fixtures and fails on horizontal overflow. I'd do that first.

---

## 3. Parity with nouns.camp — where noun.wtf stands

I couldn't load nouns.camp or nouns.game from this container, so this is from
memory of both sites plus the route map in this repo. Treat the "Camp has it"
column as a checklist to verify against the live site before it sunsets.

| Feature | Camp | noun.wtf today | Gap |
|---|---|---|---|
| Proposal list with status, tallies, time left | ✓ | ✓ `/vote` | — |
| Proposal page: content, votes, timeline | ✓ | ✓ `/vote/:id` | mobile layout (fixed tonight) |
| **Vote reasons as threads** (replies, quote/repost) | ✓ | partial — reasons shown flat | **P1** |
| Revote / vote with reason prefill | ✓ | ✓ (`InlineVotePanel` prefill) | — |
| Objection period handling | ✓ | ✓ | — |
| Candidates: create, sponsor progress bar, promote | ✓ | ✓ `/candidates` + terminal cmds | — |
| **Topics** (discussion-only candidates) | ✓ | feed shows `TOPIC` badge; no dedicated view | P2 |
| Propdates | ✓ | ✓ `ProposalPropdates` | — |
| **Draft autosave** (drafts survive reload) | ✓ | ✗ — draft window state is in memory | **P1** |
| **Tx builder templates** (ETH / USDC transfer, stream, custom) | ✓ | partial — `ProposalActionModal` | verify coverage |
| **Tx simulation before propose** | ✓ (Tenderly) | ✗ | P2 — needs a key |
| Delegation UI | ✓ | ✓ `/delegate` | — |
| Voter / account profile: votes, delegations, power | ✓ | ✓ `/gamer/:id` (richer: settled/curated) | — |
| ENS + avatars everywhere | ✓ | partial — some views show raw addresses | P1 (cheap) |
| Search (props, candidates, voters) | ✓ | ✗ | **P1** |
| Auction page | ✓ | ✓ (and V2) | — |
| Treasury dashboard | ✓ | ✓ `/dashboard`, `/nonsense`, `/stats` | ahead |
| Activity feed | ✓ | ✓ terminal feed — ahead (17 filters, V2, Lil, grants) | — |
| **Farcaster comments on proposals** | ✓ | ✗ | P2 |
| Mobile-first layout, bottom vote sheet | ✓ | ✗ — desktop-first | **P0** |
| Dark mode | ✓ | terminal is dark; abacus is light-only | P2 |
| PWA / installable | ✓ | stupidfont only | P2 |
| Client-ID attribution in UI | partial | ✓ client registry + `/settlers` breakdown | ahead |
| Agent / natural-language governance | ✗ | ✓ — nothing else has this | ahead |
| Small grants, prediction markets, 3D treasury, settlers/curators | ✗ | ✓ | ahead |

**Where noun.wtf is already ahead:** the terminal + NounIRL agent, the activity
feed, V2 + Lil + grants coverage, settlers/curators, the treasury visualisations,
and the sheer amount of play. Camp's advantage is polish on the core governance
loop and mobile. That's a narrower gap than "parity with everything" sounds.

---

## 4. Proposed order of work

**P0 — Mobile, because it's the thing people notice first**
1. Playwright mobile-overflow test across every route (fixtures for API/RPC).
   This turns "looks shit on mobile" into a list of failing routes.
2. Proposal page bottom sheet on phones: sticky "Vote" button that opens the
   `InlineVotePanel` as a sheet. Camp's single best mobile idea.
3. Sweep every inline `gridTemplateColumns: '… Npx'` on pages (found 3 more:
   `AssetDetailModal`, `CampProposalForm`, `FinderApp`) and add breakpoints.

**P1 — Governance-loop parity**
4. Vote reasons as threads: replies and quotes rendered inline, grouped by
   voter, with "revote" from a reply. Data is already in the feed.
5. Draft autosave: persist the draft window's title/body/actions to
   `localStorage` keyed by draft id; restore on reopen. Small.
6. Search: one input over proposals, candidates, and voters. The Ponder API
   already has the tables; needs one endpoint and a palette-style UI.
7. ENS + avatar pass on every address in `ProposalVoteActivity`, the feed, and
   `/settlers` (the `/api/ens` batch endpoint already exists — the gas page uses it).

**P2 — Delight / longer tail**
8. Farcaster comments on proposal pages (Neynar).
9. Tx simulation on the draft window's actions.
10. Abacus dark mode; PWA manifest for the main site.

Rough sizing: P0 ≈ 2–3 days, P1 ≈ 4–6 days, P2 ≈ 1–2 weeks. Happy to start on
P0.1 + P1.5 immediately — both are self-contained and verifiable here.

---

## 5. Questions for you

1. **"Default to Figtree as our font"** — I applied that to the draft window
   only. Did you mean site-wide? Pip3 is documented as *the* site font in both
   themes; swapping it is a brand decision I didn't want to make while you slept.
   It's a two-line change in `index.css` if yes.
2. Vote panel **first** on phones (my choice) vs. after the proposal content —
   which do you prefer?
3. For the parity table: any Camp feature you'd rank higher than I have?
