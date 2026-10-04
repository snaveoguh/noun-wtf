nocguild Q3 https://propdates.nouns.wtf

![noun.wtf 1000](https://raw.githubusercontent.com/snaveoguh/noun-wtf/16faf7582d97a6b3cd5b44518351031aa1276712/propdate-nocguild-q3/noun-wtf-1000.png)

credit: nocguild

What got built (July–September)

Kept supporting proposal passage. Main Nouns was mostly losses again, but there was one win at Lil Nouns. I delegated the Lils held in nocguild.eth to the legend @kimmydeuk to get her proposal over the line:
(Lil Prop 388) "Lil Nouns @ ARTOBER" by @kimmydeuk https://lilnouns.camp/proposals/388

My own props this Q:
(Prop 987) "WALL": a new Nouns trait proposal. It won the vote 130 for / 77 against but was defeated anyway, because the for votes fell short of quorum. That's a clear sign the trait has support, so it will come back.
(Prop 1000) "Noun": approves noun.wtf / Client ID 37 for client incentives. It's live now. It's the first four-digit Nouns proposal, written and submitted entirely from the noun.wtf terminal. The proposal is also the full user guide to the client, so the docs live onchain forever. Please vote if you hold or delegate: https://noun.wtf/vote/1000

Wins are rare, but each proposal teaches the client something. Every loss became a terminal feature so the next one is easier to draft, sponsor and pass.

Noun v2 https://noun.wtf/v2 is still running without a reserve. V2 governance is live, and its first three proposals all passed and were executed:
(V2 Prop 1) "Joker — the 254th NounV2 head" (July): the first new trait added by V2 governance
(V2 Prop 2) "Joker 2" (August): a repair prop, because I got Prop 1 wrong. It executed fine, but the trait was packed in the wrong format, so the joker couldn't be read back onchain. Joker 2 fixed it, and the trait tool now checks every new trait can be read back after it executes. Mistakes are how it gets better.
(V2 Prop 3) "Fund nounirl.eth to settle nouns (0.024e)" by cc0ol.eth

The V2 treasury holds ~0.147e, after paying 0.024e to nounirl.eth. That's the settler agent, which now watches both Nouns V1 and V2 auctions and settles them with an exact-block guard so it never double-settles. So V2 pays to keep its own auctions moving, and V1's too. V2 has raised ~0.17e from auction so far (~+0.08e this Q).

noun.wtf/terminal is now a full governance client (guide: Prop 1000):
- Vote, leave feedback, look up and execute proposals from one prompt line (votes are refundable, client 37)
- Draft window: full-width editor with live governor timings. Paste a JSON payload `{title, body, transactions}` and the actions come attached, with ABIs resolved for all Nouns contracts (no Etherscan key needed). Prop 1000 was made this way
- Lil Nouns drafts: `/draft lil` opens a draft window for the Lil Nouns governor. It pays out in USDC / stETH, shows the live Lil treasury, and warns before you ask for more than it holds
- `/cancel <id>` to cancel your own proposals
- Read-only TRADING tab following the pooter.world agents

Autopilot (early): scoped vote permissions (ERC-7710 profile for Governor DAOs). You give a narrow, revocable permission and votes are cast from your own address, so you don't hand over your delegation. Package: @nouns/vote-permit

Activity feed + gamer profiles: noun.wtf/gamer/:id and /explore/wallet show nouns held and delegated, votes, props, and who settled or curated each noun. The feed now tells treasury-routed nouns apart from burned ones (post-AuctionHouse V4), and shows prop lifecycle, forks and streams.

Client incentives on noun.wtf / ID 37: 0e this Q (vs +0.33e in Q2). That's not because nobody's voting. Client rewards are paid from auction revenue, and since AuctionHouse V4, periods where nouns go to the treasury unsold record zero revenue and the rewards contract just stops paying. Every client building on Nouns is affected. I consider it a bug, and fixing it is the first of the new contracts below.

Noun Grants: ~0.08e remains in the nocguild.eth pool. Propose at https://noun.wtf/grants

Side quests:
- stupidfont: an in-browser handwriting font editor (up to 5 takes per letter, cycled randomly). It's now an installable app with App Store + Google Play shells coming
- Nouns world engine: PS2-grade pass (100× island, living scenery)
- Site-wide font switcher (default Figtree), and first-party analytics replacing Plausible
- 🪩 disco mode is now off by default (it was a photosensitivity hazard). Opt in if you like it

What I've been working on: two new contracts, going to a single shared audit first, then each to its own vote with the report.
- Client Incentives V2: fixes the bug above. When auctions go quiet, rewards can also be paid from the treasury's staking yield, so builders aren't left to sunset their clients.
- Noun Repurchase Program: a fair exit that still benefits the holders who stay. Any member can sell their Noun back to the DAO at book value or below, never above, and every exit raises the book value of every Noun left.

Taipei Toy Festival is almost here. @duckhead is totally owning everything on the ground. Toy images and a post-festival update will go on the Prop 965 propdate.

Socials: Farcaster is pretty quiet these days, essentially dead, and the same goes for Zora. Farcaster was sold to Neynar in January, and this quarter Neynar started looking for someone else to run it. Zora changed CEO after its revenue fell ~98%. It's a shame, because so much Nouns artwork was shared on both, and much of it is probably not long for this world. If you posted work there, back it up. nocguild will keep posting to noun.wtf and onchain, where it can't be handed over.

More soon, play along (while it lasts)
https://farcaster.xyz/~/channel/noc

⌐◨-◨
