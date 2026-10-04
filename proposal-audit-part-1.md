# Part I of II: audit the Noun Repurchase Program and Client Incentives V2

**Status:** draft
**Asks for:** about 5 ETH (estimate; replaced by the chosen auditor's quote plus a small contingency)
**Part II:** two separate proposals, each voted on only after this audit is published:

- `proposal-noun-repurchase-part-2-program.md`: turns the Noun Repurchase Program on.
- `proposal-client-incentives-v2/PROPOSAL.md` (branch `claude/relaxed-cray-85nce2`): upgrades `Rewards`.

## TL;DR

Two pieces of code are ready for the DAO and both touch treasury money, so both should be independently audited
before anyone votes to use them. Auditing them together, in one engagement with one auditor, costs less than two
separate audits and needs one vote instead of two.

This proposal pays for that audit and the costs around it. It does not deploy anything live, upgrade any contract,
move any Nouns or change the bylaws. Each piece then goes to its own vote with the audit report attached, so the
DAO can approve one without the other.

## What is being audited

**1. Noun Repurchase Program.** A way for members to leave the DAO by selling their Noun back at book value or
below, never above. Each week the DAO sets an ETH budget. Members escrow their Noun and say what discount to book
value they will accept. The deepest discounts fill first, and everyone filled that week is paid the same price.
Because nobody is paid more than book value, every exit raises the book value of every Noun that stays.
Bought-back Nouns go to the treasury. New contract, about 530 lines.

**2. Client Incentives V2.** Client rewards for proposals and votes are paid out of auction revenue. Since Auction
House V4, a period where every auction ends without a bid has no revenue, and the reward update reverts, so
rewards stop. This fixes that, and lets the treasury's staking yield fund rewards as well, off until the DAO sets
a share. An upgrade to the live `Rewards` contract plus a new oracle, about 235 new or changed lines.

## Why audit first

- Both hold or direct treasury money. The repurchase contract holds ETH for buybacks and escrows members' Nouns.
  `Rewards` holds the WETH that clients are paid from.
- The repurchase contract cannot be upgraded, which is deliberate: nobody can change its rules without a new
  contract and a new vote. It also means bugs have to be caught before launch.
- The `Rewards` change upgrades a live contract that is 60 bytes under the deploy size limit, and adds a call into
  a new contract on every reward update. Upgrades are where storage-layout mistakes happen.
- Both have extensive tests, including randomized tests of their core guarantees. Tests written by the author are
  not a substitute for an independent review.

## What the money pays for

| Item                       | Notes                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Independent security audit | Both codebases, one auditor. Auditor and quote named before this goes to a vote (see `audit-quote-request.md`). |
| Fix review                 | The auditor checks the fixes for anything they find.                                                            |
| Deployment and contingency | Gas to deploy the audited contracts and verify them on Etherscan, plus unforeseen costs.                        |

Any ETH not spent is returned to the treasury when the work is done, and the proposal thread will get an itemized
account of what was spent.

## What happens if this passes

1. The audit is done on fixed commits of both codebases.
2. Findings are fixed, the auditor reviews the fixes, and the report is published.
3. The audited code is deployed:
   - The repurchase contract is owned by the DAO from the moment it exists and starts **paused**: nobody can place
     an ask or settle a round until the DAO votes to unpause it.
   - The new `Rewards` implementation and the oracle are deployed but do nothing until the DAO votes to point the
     `Rewards` proxy at them.

   The deployer has no control over either at any point.

4. Each Part II goes up for its own vote, linking the audit report and the deployed contracts.

If the audit finds something that can't be fixed in either piece, or the DAO votes either Part II down, that
piece stays inert: the repurchase contract stays paused and empty, and the `Rewards` proxy keeps its current
implementation.

## On-chain actions

1. Send the audit fee straight to the auditor: _[auditor name], [quote] ETH to [auditor 0x address]_. The DAO pays
   the auditor directly; no money passes through the proposer.
2. Send the contingency (deployment gas, Etherscan verification, unforeseen costs) to `nocguild.eth`
   (_[0x address]_). Unspent contingency goes back to the treasury.

The auditor, quote and both addresses are filled in once quotes are back. The total replaces the 5 ETH estimate
above.

## Compliance

This is a payment for services: an audit and the work around it. The proposer's reading is that it falls under
the payments Bylaws §3.1 already permits, so it does not depend on the bylaws amendment in the repurchase Part II.
Compliance Administrators, please confirm.

The Compliance Administrator review of the repurchase Part II under Bylaws §2.2(a) can start in parallel, so it is
ready when the audit is.
