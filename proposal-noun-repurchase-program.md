# Proposal: Noun Repurchase Program (exit at book value, the co-op way)

**Status:** draft for Compliance Administrator review
**Code:** `packages/nouns-contracts/contracts/repurchase/` (`NounsRepurchase.sol`, `EthConverters.sol`), tests in `test/foundry/NounsRepurchase.t.sol`

## TL;DR

Prop 955 set the auction reserve to book value (2.8 ETH). New members now pay book to join. This proposal adds the other half of that policy: any member can leave at book, by selling their Noun back to the DAO.

It does this the way every nonprofit cooperative in America does it. A co-op member who leaves does not get a share of the profits. They hand back their membership share and the co-op redeems it at par. Nobody profits, nobody is diluted, the co-op keeps operating. The Wyoming DUNA Act was written with that model in mind and expressly permits a DUNA to "repurchase membership interests to the extent authorized by the nonprofit association's governing principles." Our bylaws never adopted that authorization. This proposal adopts it, deploys a rate-limited on-chain repurchase queue, and funds it.

The fork is not touched. Nothing is distributed. Every remaining Noun's book value is unchanged or slightly higher after each exit.

## Why the co-op model is the right frame

A Noun is a membership interest in a Wyoming nonprofit association. The closest real-world analogue is a membership share in a consumer or producer co-op: REI, a credit union, a farm supply co-op, a housing co-op. Those entities are nonprofit or non-distributing, yet all of them redeem member shares when a member leaves, and the law lets them because a redemption at par is not a distribution of profit. The member gets back what their share is worth on the books, no more. The co-op is not enriched or impoverished relative to the remaining members.

The Uniform Unincorporated Nonprofit Association Act, which the DUNA Act descends from, carries that co-op logic into its permitted-payments list: reasonable compensation, benefits in conformity with purpose, **repurchase of a membership**, and distributions on winding up. Wyoming kept all four in W.S. 17-32-104(c). The bylaws kept only the first two. That gap, not the Act, is what currently blocks a fair exit.

Three properties make a repurchase compliant where the fork was not:

1. **Price is capped at net asset value.** The DAO never pays a member more than that Noun's pro-rata share of net assets. That is the definition of "not a distribution of profit."
2. **The DAO is the counterparty, and it screens the counterparty.** Sanctions oracle at request and at payout, and an optional KYC attestation from a Compliance Administrator. The fork was permissionless and unscreened.
3. **The DAO keeps the Noun.** Repurchased Nouns go to the treasury, exactly like no-bid Nouns under Auction House V4. They can be re-auctioned at reserve later. The membership interest is repurchased, not destroyed, and not carried off into a new entity with a slice of every treasury asset.

## Legal basis

- **W.S. 17-32-104(b)** prohibits paying dividends or distributing income or profits to members.
- **W.S. 17-32-104(c)(iii)** permits a DUNA to repurchase membership interests to the extent authorized by its governing principles. *(Verify exact wording against the codified statute before the vote; this draft relies on secondary summaries.)*
- **Bylaws §1.3** defines the Governing Principles as the Act, the Code, and the Bylaws, and lets the Bylaws be amended by an ordinary DAO Proposal.
- **Bylaws §3.1** currently lists only compensation and grants as permitted payments. This proposal adds the statutory repurchase exception.
- **Bylaws §2.2(a)** requires the Compliance Administrators to review this proposal for tax and sanctions compliance before it is voted on. That review is requested below, not bypassed.

## Bylaws amendment (Article III, Section 3.1)

Add a new clause 3.1(a)(iii):

> **iii. Repurchase of Membership Interests.** Pursuant to W.S. 17-32-104(c)(iii), the DAO may repurchase Nouns from Members under a Repurchase Program authorized by a DAO Proposal that is approved in accordance with the rules set forth in the Code, provided that: (1) the price paid for any Noun shall not exceed the Net Asset Value per Noun, being the ETH-equivalent value of the DAO's liquid treasury assets, less reserved liabilities, divided by the number of Nouns not held by the DAO, each as computed by the Code; (2) the selling Member has satisfied the sanctions screening and, if required by the Compliance Administrators, the identity verification procedures established under Section 2.2(a); and (3) repurchased Nouns shall be held by the DAO and shall not be counted as Membership Interests while so held. A repurchase under this clause is not a dividend or a distribution of revenue or profits.

Add a clarifying sentence at the start of 3.1(b):

> The restrictions in this Section 3.1(b) apply upon the winding-up or dissolution of the DAO and do not apply to a Repurchase Program conducted under Section 3.1(a)(iii).

## Mechanism

`NounsRepurchase` is a single non-upgradeable contract owned by the DAO Executor.

| Step | What happens |
|---|---|
| Request | A member escrows Nouns into a FIFO queue. The wallet is checked against the Chainalysis sanctions oracle (the same one Auction House V3 uses). If the DAO has set a KYC attestor, the member presents an EIP-712 attestation signed by that key. |
| Cancel | A member can withdraw an escrowed Noun at any time before it is repurchased, even while the program is paused. The Noun is their property. |
| Settle | Once per tick anyone may call `settle()`. The price for the tick is frozen at NAV less the spread. Up to `maxPerTick` Nouns are repurchased in queue order. The Noun moves to the treasury, ETH goes to the member (WETH fallback if their wallet rejects ETH). |
| Sanctioned at payout | If a queued owner becomes sanctioned before settlement, their entry is frozen and skipped. They can still cancel and take their Noun back. They are never paid. |
| Insufficient funds | Settle stops and does not consume the tick. The queue resumes as soon as the DAO tops the contract up. |

**NAV per Noun** = (treasury ETH + program ETH + Σ converter(treasury LST balances) − liability reserve) ÷ (total supply − Nouns held by the treasury).

Converters read canonical protocol rates only: wstETH via Lido's `getStETHByWstETH`, rETH via Rocket Pool's `getEthValue`, mETH via Mantle's `mETHToETH`. WETH and stETH are 1:1. No spot-market prices, so NAV cannot be manipulated by a trade.

## Proposed initial parameters

| Parameter | Value | Why |
|---|---|---|
| Spread | 300 bps (3%) | Every exit slightly raises remaining members' book value. Also covers LST unwind slippage. |
| Max per tick | 1 Noun | Mirrors "one Noun, every day." Caps outflow at roughly 2.8 ETH/day so the DAO can always respond by proposal. |
| Tick | 1 day | |
| Liability reserve | set by Compliance Admins | Committed payment streams and administrator budgets, in ETH. |
| Sanctions oracle | Auction House V3's Chainalysis oracle | Same screening standard already in the Code. |
| KYC attestor | Compliance Administrator key, or unset | Admins decide whether the KYC guide's "financial transaction counterparty" category applies. |
| Initial funding | 90 ETH | About one month of exits at the cap. Refilled by proposal. |

Reference numbers from Prop 955: about 3,950 ETH of primary assets over 1,344 circulating Nouns, about 2.88 ETH per Noun. NAV is recomputed on-chain at every settle, so those figures are illustrative only.

## On-chain actions

1. `NounsRepurchase` deployment (constructor: Nouns token, Executor, WETH, sanctions oracle, KYC attestor, spread, max per tick, tick, liability reserve, asset list). Ownership transfers to the Executor in the constructor.
2. `Executor.sendETH(repurchase, 90 ether)`.
3. Bylaws amendment recorded via the Data V2 contract's DUNA administrator channel, with the amended text hashed in the proposal description.

No changes to the Governor, token, treasury, or auction house.

## Compliance review requested before vote

Per Bylaws §2.2(a) the Compliance Administrators are asked to confirm:

- **Tax classification.** Whether the DUNA is treated as a partnership, a corporation, or is pursuing 501(c) exemption. Under partnership treatment a repurchase is a Section 731 distribution to the leaving member and is workable. Under corporate treatment it is a Section 302 redemption. Under a 501(c) exemption a book-value buyback would be private inurement and this program should not proceed.
- **Whether the 3.1(b) "under no circumstances" clause** is read as limited to winding-up, as this proposal assumes, and whether the clarifying sentence above is acceptable.
- **Whether KYC is required** for selling members, and if so, whether the EIP-712 attestation flow satisfies the KYC guide.
- **The liability reserve figure** to seed the contract with.

## Risks

- **Treasury drain.** Bounded by the per-tick cap. At 1 Noun/day the whole supply would take over three years to exit, and every parameter is a DAO vote.
- **Veto.** The Veto Administrators may act on existential risk. The cap and spread exist to make that unnecessary.
- **Investment Company Act optics.** A NAV-redeemable interest in a pool of liquid staking tokens looks more fund-like. Counsel should opine.
- **Rate-provider risk.** Converters trust Lido, Rocket Pool, and Mantle contracts. The DAO can swap the asset list by proposal.

## What this is not

It is not a fork, not a ragequit, not a dividend, and not a burn. It is the DAO buying back a membership share at book, which is what nonprofit co-ops have done for a century and what the DUNA Act explicitly allows once the bylaws say so.
