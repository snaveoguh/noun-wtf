# Noun Repurchase Program, Part II of II: turn it on (exit at book value, the co-op way)

**Status:** draft. Goes to a vote only after Part I's audit is published and its findings are fixed. Handed to the Compliance Administrators for review under Bylaws §2.2(a).
**Part I:** `proposal-noun-repurchase-part-1-audit.md` funded the audit and the deployment of the audited contract, paused and owned by the DAO.
**Code:** `packages/nouns-contracts/contracts/repurchase/` (`NounsRepurchase.sol`, `EthConverters.sol`), deploy script `script/DeployNounsRepurchase.s.sol`, tests `test/foundry/NounsRepurchase.t.sol` (64 tests, including a fuzz test of the auction invariants and an end-to-end run against the real `NounsToken`)

## TL;DR

Prop 955 set the auction reserve to book value (2.8 ETH). New members now pay book to join. This proposal adds the other half of that policy: any member can leave by selling their Noun back to the DAO, at book value or below, never above.

The price is set by the members who want out, not by the DAO. Each week the DAO puts up a fixed ETH budget. Members escrow their Nouns and say what haircut to book value they will take. The deepest haircuts fill first, and everyone who fills is paid the same clearing price. A member who wants out fast can ask for a big discount and be first in line. A member who only wants book value waits for a quiet week.

**Every exit raises the book value of every Noun that stays.** The DAO buys each Noun below its share of the treasury, so the difference stays in the treasury and is spread over fewer Nouns. The more people want out at once, the deeper the clearing discount goes, and the more the remaining Nouns gain. The program can never lower anyone's book value.

It does this the way nonprofit cooperatives do it. A co-op member who leaves does not get a share of the profits. They hand back their membership share and the co-op redeems it at no more than par. Nobody profits, nobody is diluted, the co-op keeps operating. The Wyoming DUNA Act was written with that model in mind and expressly permits a DUNA to "repurchase membership interests to the extent authorized by the nonprofit association's governing principles." Our bylaws never adopted that authorization. This proposal adopts it, deploys an on-chain repurchase auction with a weekly budget, and funds it.

The fork is not touched. Nothing is distributed.

## Why the co-op model is the right frame

A Noun is a membership interest in a Wyoming nonprofit association. The closest real-world analogue is a membership share in a consumer or producer co-op: REI, a credit union, a farm supply co-op, a housing co-op. Those entities are nonprofit or non-distributing, yet all of them redeem member shares when a member leaves, and the law lets them because a redemption at par is not a distribution of profit. The member gets back what their share is worth on the books, no more. The co-op is not enriched or impoverished relative to the remaining members.

The Uniform Unincorporated Nonprofit Association Act, which the DUNA Act descends from, carries that co-op logic into its permitted-payments list: reasonable compensation, benefits in conformity with purpose, **repurchase of a membership**, and distributions on winding up. Wyoming kept all four in W.S. 17-32-104(c). The bylaws kept only the first two. That gap, not the Act, is what currently blocks a fair exit.

Three properties make a repurchase compliant where the fork was not:

1. **Price is capped at net asset value.** The DAO never pays a member more than that Noun's pro-rata share of net assets. That is the definition of "not a distribution of profit."
2. **The DAO is the counterparty, and it screens the counterparty.** Sanctions oracle when asking and at payout, and an optional KYC attestation from a Compliance Administrator. The fork was permissionless and unscreened.
3. **The DAO keeps the Noun.** Repurchased Nouns go to the treasury, exactly like no-bid Nouns under Auction House V4. They can be re-auctioned at reserve later. The membership interest is repurchased, not destroyed, and not carried off into a new entity with a slice of every treasury asset.

## Legal basis

- **W.S. 17-32-104(b)** prohibits paying dividends or distributing income or profits to members.
- **W.S. 17-32-104(c)(iii)** permits a DUNA to repurchase membership interests to the extent authorized by its governing principles. _(Admins: please confirm the exact codified wording. This draft relies on secondary summaries.)_
- **Bylaws §1.3** defines the Governing Principles as the Act, the Code, and the Bylaws, and lets the Bylaws be amended by an ordinary DAO Proposal.
- **Bylaws §3.1** currently lists only compensation and grants as permitted payments. This proposal adds the statutory repurchase exception.
- **Bylaws §2.2(a)** requires the Compliance Administrators to review this proposal for tax and sanctions compliance before it is voted on. That review is requested below, not bypassed.

## Bylaws amendment (Article III, Section 3.1)

Add a new clause 3.1(a)(iii):

> **iii. Repurchase of Membership Interests.** Pursuant to W.S. 17-32-104(c)(iii), the DAO may repurchase Nouns from Members under a Repurchase Program authorized by a DAO Proposal that is approved in accordance with the rules set forth in the Code, provided that: (1) the price paid for any Noun shall not exceed the Net Asset Value per Noun, being the ETH-equivalent value of the DAO's liquid treasury assets, less reserved liabilities, divided by the number of Nouns not held by the DAO, each as computed by the Code; (2) the selling Member has satisfied the sanctions screening and, if required by the Compliance Administrators, the identity verification procedures established under Section 2.2(a); and (3) repurchased Nouns shall be held by the DAO and shall not be counted as Membership Interests while so held. A repurchase under this clause is not a dividend or a distribution of revenue or profits.

Add a clarifying sentence at the start of 3.1(b):

> The restrictions in this Section 3.1(b) apply upon the winding-up or dissolution of the DAO and do not apply to a Repurchase Program conducted under Section 3.1(a)(iii).

## Why an auction

Two simpler designs were considered and rejected:

- **A fixed number of Nouns per day, first come first served.** With 100 members in line, the last one waits months and has no idea what price they will get when their turn comes.
- **A fixed discount to book.** It charges a member who leaves in a quiet week the same as one who leaves in a rush. In a quiet week it costs the DAO almost nothing to pay close to book, so any fixed discount is too expensive then, and too cheap when everyone wants out at once.

A reverse auction avoids both. Throughput is set by how much ETH the DAO budgets, not by a count. The discount is set by competition between leaving members, so it is small when few people want out and widens on its own when many do.

This is the same format public companies use for tender-offer buybacks (a "modified Dutch auction"): the company names a budget, holders name the price they will sell at, the company buys from the cheapest sellers up, and pays everyone it buys from the same clearing price.

## Mechanism

`NounsRepurchase` is a single non-upgradeable contract owned by the DAO Executor.

| Step                 | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ask                  | A member escrows Nouns with a discount to book value they will accept, in 0.5% steps from the DAO's minimum (proposed 0.5%) to 50%. They can add an absolute minimum price in ETH as well. The wallet is checked against the Chainalysis sanctions oracle (read from the live auction house proxy at deploy time, V4 since Prop 968, so both contracts screen identically). If the DAO has set a KYC attestor, the member presents an EIP-712 attestation signed by that key.                                                       |
| Change or cancel     | A member can change their discount at any time, which moves them to the back of the line at the new discount. They can withdraw an escrowed Noun at any time before it is bought, even while the program is paused. The Noun is their property.                                                                                                                                                                                                                                                                                     |
| Settle               | Once per round (proposed weekly) anyone may call `settle()`. Book value is frozen for the round. Asks fill from the deepest discount up, earliest first at each discount, for as long as everyone filled so far can be paid within the round's budget. Every filled member is paid the same clearing price: book value less the smallest discount that filled. Nobody is paid less than they asked for, and some are paid more. The Noun moves to the treasury, ETH goes to the member (WETH fallback if their wallet rejects ETH). |
| Not filled           | Asks that did not fit the budget stay in the book for the next round, in the same place in line.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Sanctioned at payout | If an owner becomes sanctioned before settlement, their ask is frozen and skipped. They are never paid. They can still cancel and take their Noun back. They cannot re-ask while sanctioned.                                                                                                                                                                                                                                                                                                                                        |
| Below minimum price  | If book value falls far enough that the price at the member's discount is below their ETH floor, the ask is frozen and skipped. The member can cancel, or re-ask with a new floor.                                                                                                                                                                                                                                                                                                                                                  |
| Underfunded          | Settle buys what the contract's balance allows. If it cannot buy anything, the round does not start, and the book is retried as soon as the DAO tops the contract up.                                                                                                                                                                                                                                                                                                                                                               |

**Book value (NAV) per Noun** = (treasury ETH + program ETH + Σ converter(treasury LST balances) − liability reserve) ÷ (total supply − Nouns held by the treasury, the auction house, and the legacy treasury).

Converters read canonical protocol rates only: wstETH via Lido's `getStETHByWstETH`, rETH via Rocket Pool's `getEthValue`, mETH via Mantle's `mETHToETH`. WETH and stETH are 1:1. No spot-market prices, so NAV cannot be manipulated by a trade. A converter that reverts (protocol paused) is valued at zero, which can only lower the price the DAO pays.

## How every exit raises book value

If the DAO buys one Noun at a discount _d_ to NAV when there are _N_ circulating Nouns, every one of the _N − 1_ Nouns that stay gains NAV × _d_ ÷ (_N_ − 1) of book value. At _d_ = 0 nobody gains or loses. The program cannot pay above NAV, so it can never make the remaining members poorer.

A worked round, using the Prop 955 reference figures (NAV about 2.88 ETH, 1,344 circulating Nouns) and the proposed 45 ETH weekly budget. Suppose these asks are in the book:

| Discount asked | Nouns | Price at that discount |
| -------------- | ----- | ---------------------- |
| 20%            | 5     | 2.304 ETH              |
| 10%            | 8     | 2.592 ETH              |
| 5%             | 10    | 2.736 ETH              |
| 2%             | 20    | 2.822 ETH              |

Settle fills the 5 at 20%, then the 8 at 10% (13 × 2.592 = 33.7 ETH, within budget), then 3 of the 10 at 5% (16 × 2.736 = 43.8 ETH; a 17th would need 46.5 ETH). The clearing discount is 5%, so all 16 members are paid 2.736 ETH, including the five who would have taken 20% off. The other 7 asks at 5% fill first next week, then the asks at 2%.

The DAO keeps 16 × 0.144 = 2.3 ETH of book value it would have paid out at NAV. NAV per remaining Noun goes from 2.880 to about 2.882 ETH. That is small for one round, but it compounds: it is paid every round the program runs, and it grows when more members want out at once.

**Guard rails baked into the code, not just the parameters:**

- The price never exceeds NAV. That is what keeps a repurchase from being a distribution of profit.
- The DAO's minimum discount is hard-capped at 25%, so no future proposal can close the exit by refusing every reasonable ask. A member chooses their own haircut, up to 50%.
- Funds can only leave the contract to a member at or below NAV, or back to the treasury. There is no other withdrawal path.
- Changing or cancelling and re-asking sends a member to the back of the line at that discount. Place in line cannot be gamed.
- A member's optional ETH floor protects them if NAV drops while they wait, including from a proposal that raises the liability reserve right before settlement.
- Nouns sent to the contract outside the program can only be moved to the treasury.

## Proposed initial parameters

| Parameter           | Value                                            | Why                                                                                                                                         |
| ------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Minimum discount    | 50 bps (0.5%)                                    | The smallest step. Every exit adds at least a little book value for the members who stay, without making leaving expensive in a quiet week. |
| Budget per round    | 45 ETH                                           | About 15 Nouns a week at book. The budget, not a count, is the throughput control. Raise or lower it by proposal.                           |
| Round               | 7 days                                           | Long enough for asks to collect and compete, short enough that nobody waits long when the budget covers them.                               |
| Max fills per round | 50 Nouns                                         | Bounds settle gas (about 76k gas per Noun). Not meant to bind.                                                                              |
| Liability reserve   | set by Compliance Admins                         | Committed payment streams and administrator budgets, in ETH.                                                                                |
| Sanctions oracle    | the live auction house's Chainalysis oracle (V4) | Same screening standard already in the Code.                                                                                                |
| KYC attestor        | Compliance Administrator key, or unset           | Admins decide whether the KYC guide's "financial transaction counterparty" category applies.                                                |
| Initial funding     | 90 ETH                                           | Two full rounds. Refilled by proposal.                                                                                                      |

Reference numbers from Prop 955: about 3,950 ETH of primary assets over 1,344 circulating Nouns, about 2.88 ETH per Noun. NAV is recomputed on-chain at every settle, so those figures are illustrative only.

## On-chain actions

The contract is already deployed from the audited commit (Part I), owned by the Executor and paused. The proposal description links the audit report and the deployment, and anyone can check that the deployed bytecode matches the audited commit.

1. Bylaws amendment recorded via the Data V2 contract's DUNA administrator channel, with the amended text hashed in the proposal description.
2. `Executor.sendETH(repurchase, 90 ether)`.
3. `NounsRepurchase.unpause()`. Until this executes, nobody can ask or settle.

No changes to the Governor, token, treasury, or auction house.

## Compliance Administrator review packet

This section is the hand-off. Per Bylaws §2.2(a) the Compliance Administrators are asked to review and respond on each point through the Data V2 channel.

**Tax.** The DUNA is not a tax-exempt organization and this proposal does not assume one. (If a 501(c)(3) exists it is a sister entity, and nothing here touches it.) The question is only the DUNA's own federal classification. Under partnership treatment a repurchase is a Section 731 distribution to the leaving member, taxable to them against their basis and neutral to the DAO. Under a corporate election it is a Section 302 redemption. Both are ordinary and neither turns a repurchase into a dividend. Please confirm the classification and whether any information reporting to selling members is required, since the KYC gate can collect what is needed.

**Sanctions.** The contract screens the escrowing wallet against the same oracle the live Auction House (V4, Prop 968) uses, and screens again at payout. The auction house ABI regenerated from Etherscan on 2026-07-31, after V4 went live, still exposes `sanctionsOracle` and `setSanctionsOracle`, and the deploy script reads the oracle from the proxy and refuses to deploy if it is unset; please still confirm on-chain that V4's oracle is non-zero. A sanctioned wallet is never paid. Please confirm this satisfies the §2.2(a)(i)(2) procedure for "any wallet which interacts with any aspect of the Code," and whether returning a sanctioned wallet's own Noun to it on cancel is acceptable (the contract allows it because the Noun is their property; it can be changed).

**KYC.** Please decide whether a selling member is a "financial transaction counterparty" under the KYC guide. If yes, name the attestor key and the contract will refuse asks without a valid attestation. If no, leave the attestor unset.

**Bylaws.** Please confirm (a) the exact wording of W.S. 17-32-104(c)(iii), (b) that the "under no circumstances" sentence in §3.1(b) is read as limited to winding-up, and (c) the amendment text above.

**Liability reserve.** Please provide the ETH figure for committed streams and administrator budgets to seed the contract with.

**Governing Principles compliance.** Under §2.2(a)(i)(3), please confirm nothing in the Act, the Code, or the Bylaws as amended conflicts with the program, or tell us what does.

## Risks

- **Treasury drain.** Bounded by the per-round budget and the program's balance, which only the DAO refills. At 45 ETH a week the whole treasury would take well over a year to leave, and every parameter is a DAO vote.
- **Buy-cheap, sell-to-the-DAO trading.** If Nouns trade on the market below NAV, traders can buy them and ask. They compete in the same auction, so they push the clearing discount deeper, which raises book value for the Nouns that stay. They cannot be paid more than the clearing price.
- **Veto.** The Veto Administrators may act on existential risk. The budget, the minimum discount and the NAV cap exist to make that unnecessary.
- **Investment Company Act optics.** An interest redeemable at up to NAV in a pool of liquid staking tokens looks more fund-like. Counsel should opine.
- **Rate-provider risk.** Converters trust Lido, Rocket Pool, and Mantle contracts. The DAO can swap the asset list by proposal, and a failing provider only lowers the price.
- **Audit.** Funded by Part I. This proposal goes to a vote only once the audit report is public and every finding is fixed or answered in it. An audit lowers the risk of a bug; it does not remove it. The contract has no upgrade path, so a serious bug found later means pausing it, returning its funds to the treasury, and deploying a fixed version by proposal.

## What this is not

It is not a fork, not a ragequit, not a dividend, and not a burn. It is the DAO buying back a membership share at book, which is what nonprofit co-ops have done for a century and what the DUNA Act explicitly allows once the bylaws say so.
