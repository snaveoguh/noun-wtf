# Client Incentives V2: keep client rewards alive when auctions raise nothing

## TL;DR

Client rewards for proposals and voting are funded out of auction revenue. When
auctions stop raising ETH, that funding does not merely drop to zero — the
reward contract **reverts and stops working entirely**. Clients earn nothing for
governance activity that is still happening.

This proposal upgrades the `Rewards` contract so the same reward pool can also be
funded by a slice of the staking yield the treasury already earns on its stETH,
wstETH, rETH and mETH. It fixes two bugs in the no-auction-revenue path along the
way.

The rewards are smaller than auction-funded rewards. They are not zero, and the
lights stay on.

**The upgrade changes nothing until the DAO explicitly switches it on.** Ship the
upgrade, watch it, then turn on staking revenue in a later vote if you want to.

## The problem

`updateRewardsForProposalWritingAndVoting` measures a period's auction revenue and
splits `proposalRewardBps` / `votingRewardBps` of it across eligible proposals and
votes. Two things break when auctions stop earning:

1. **A period of no-bid auctions reverts.** Since AuctionHouse V4, a noun that gets
   no bid is routed to the treasury and still records a settlement — with an amount
   of `0`. The contract then hits `require(auctionRevenue > 0, 'auctionRevenue must
   be > 0')` and the whole update reverts.

2. **A period with no settlement at all panics.** `getAuctionRevenue` read
   `s[s.length - 1]` off the settlements array. When nothing settled in the window
   that array is empty, so the read is an out-of-bounds panic.

Either way the proposal and voting reward path is stuck. It cannot be nudged along
or called with different arguments — it is bricked until auctions earn again.

Auction *bidding* rewards are a separate path and are deliberately left alone. A
bidding reward with no bids has nothing to attribute to anyone.

## What it does

Adds a new contract, `StakingRevenueOracle`, that measures the ETH the treasury's
liquid staking tokens earned since the last reward update, and lets `Rewards` treat
that as revenue alongside auction revenue.

The measurement is deliberately narrow. For each tracked token the oracle stores
two readings — the size of the DAO's position, and how much ETH one unit is worth —
and a period's yield is:

```
min(positionBefore, positionAfter) x (rateNow - rateLast) / 1e18
```

Only the *rate* term moves, which is the point:

| Situation | What a naive "value now minus value then" would report | What this reports |
|---|---|---|
| DAO stakes 5,000 more ETH | a 5,000 ETH windfall | nothing — principal is not revenue |
| DAO spends from the treasury | negative revenue | yield on what was held all period |
| Someone donates 10,000 ETH mid-period | a huge inflated period | nothing — `min()` ignores the new principal |
| A validator gets slashed | negative revenue | zero |
| A staking token is paused or upgraded | — | that token is skipped, the update still runs |

Rebasing stETH is handled through Lido shares and the share price rather than the
balance, so it works the same way.

## Transactions

All sent from the treasury.

| # | Target | Call |
|---|---|---|
| 1 | `Rewards` proxy — **TODO: fill in** | `upgradeTo(<new Rewards implementation>)` |
| 2 | `StakingRevenueOracle` | `addAsset("wstETH", …)` |
| 3 | `StakingRevenueOracle` | `addAsset("stETH", …)` |
| 4 | `StakingRevenueOracle` | `addAsset("rETH", …)` |
| 5 | `StakingRevenueOracle` | `addAsset("mETH", …)` |
| 6 | `Rewards` proxy | `setStakingRevenueOracle(<oracle>)` |
| 7 | `StakingRevenueOracle` | `setRevenueShareBps(<TODO: bps>)` |

`script/Rewards/DeployClientIncentivesV2Mainnet.s.sol` deploys the two contracts and
prints these transactions with the exact calldata.

Transactions 1–5 are inert on their own. The oracle is deployed with a revenue share
of **0**, so nothing changes until 6 **and** 7 are both executed. Splitting them
across two proposals is a perfectly reasonable way to run this: ship the fix, watch
the oracle report numbers with `pendingRevenue()`, then vote on the share.

## How much money is this?

Roughly: `staked treasury ETH` x `staking APR` x `revenueShareBps` x the
existing `proposalRewardBps + votingRewardBps`.

**TODO: fill in the real numbers before submitting** — the live values of
`proposalRewardBps` and `votingRewardBps`, and the treasury's current staked
position. The sizing decision is entirely `revenueShareBps`, which the DAO
sets in transaction 7 and can change at any time with a single call.

One note on sizing: with auctions earning nothing, the auction-bidding reward slice
consumes nothing. If the DAO wants total client spend to stay near where it was,
`revenueShareBps` will likely need to be above 10,000 (100%). The parameter is a
`uint16`, so it cannot exceed 655%.

## What could go wrong

**The oracle reports a wrong number.** `maxRevenuePerConsume` caps how much any one
period can report, so a bad rate source is bounded rather than unbounded. The DAO
can point `Rewards` at a different oracle, or at the zero address, with one call.

**A staking token gets paused or upgraded.** Its read fails, that token is dropped
from the period and an `AssetReadSkipped` event fires. The reward update still runs.
This was a deliberate choice: one broken token must not be able to reintroduce the
exact bug this proposal fixes.

**The oracle is a trusted contract.** `Rewards` makes a state-changing call into it
on every update, so a malicious oracle could misbehave. Setting it is `onlyOwner`,
and that owner is the treasury — the same authority that can already replace the
entire `Rewards` implementation. There is no new trust here, but reviewers should
know it is there. No reentrancy guard was added on those grounds; say so on the PR
if you would rather have one.

**Rewards still need funding.** `Rewards` accounts in its own ledger and pays out of
its WETH balance. This proposal changes how much clients are *owed*, not how much
the contract *holds*. If accrued rewards outrun the balance, withdrawals fail until
the DAO tops it up.

## Changes to existing behaviour

`getAuctionRevenue` keeps its signature. Where it previously reverted on a window
with no settlements, it now returns `(0, firstNounId - 1)`, so a caller advancing a
cursor to `lastAuctionId + 1` leaves that cursor where it was.

The one break: `require(auctionRevenue > 0, 'auctionRevenue must be > 0')` is now the
custom error `NoRevenue()`. Anything matching on that revert string needs updating.

Storage is appended to the end of the existing ERC-7201 namespace, so the upgrade is
layout-safe.

## The contract is near the deploy limit

Worth flagging for reviewers. `Rewards` on `main` compiles to **23,896 bytes** against
the EIP-170 limit of 24,576 — only 680 bytes of headroom. This change takes it to
**24,516 bytes at the repo's default optimizer settings, leaving 60 bytes.**

It deploys, and CI's size check passes. But it is tight enough that the next feature
added to this contract will not fit. Several conveniences were already cut to get
here: a `pendingStakingRevenue()` view, two config events, and a mirror of the
oracle's `RevenueConsumed` event. The share parameter lives on the oracle rather than
on `Rewards` for the same reason.

If the DAO wants real headroom back, the obvious candidate is `getVotingClientIds`,
which is documented as "not meant to be called onchain" and could move to a separate
lens contract. That is an API break for whoever builds the reward-update transaction,
so it is deliberately **not** part of this proposal.

## Code

- `contracts/client-incentives/StakingRevenueOracle.sol` — new
- `contracts/client-incentives/IStakingRevenueOracle.sol` — new
- `contracts/client-incentives/Rewards.sol` — +95 lines
- `script/Rewards/DeployClientIncentivesV2Mainnet.s.sol` — new
- `test/foundry/rewards/StakingRevenueOracle.t.sol` — new
- `test/foundry/rewards/ProposalRewards.t.sol` — added `StakingRevenueTest`
