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

```
client rewards/yr = staked ETH x staking APR x revenueShareBps x (proposalRewardBps + votingRewardBps)
```

Per **10,000 ETH staked** at a 3% APR, that is 300 ETH/yr of yield. Running it
through the reward percentages (using 1% proposal + 0.5% voting — **TODO: confirm the
live values with `getProposalRewardParams()`**):

| `revenueShareBps` | Counted as revenue | To clients per year | Per 2-week period |
|---|---|---|---|
| 2,500 (25%) | 75 ETH | 1.13 ETH | 0.04 ETH |
| 5,000 (50%) | 150 ETH | 2.25 ETH | 0.09 ETH |
| 10,000 (100%) | 300 ETH | 4.50 ETH | 0.17 ETH |
| 20,000 (200%) | 600 ETH | 9.00 ETH | 0.35 ETH |

Scale linearly for the treasury's actual staked position.

### What a proposal and a vote are actually worth

Run against the real contract, not a spreadsheet — `test/foundry/rewards/RewardSimulation.t.sol` drives
`updateRewardsForProposalWritingAndVoting` over synthetic periods where auctions raised nothing and
staking revenue funded the pool:

```
forge test --match-contract RewardSimulationTest -vv
```

At 10,000 ETH staked, 3% APR, 1% proposal + 0.5% voting:

| share | proposals | votes each | revenue | per proposal | per vote | to clients / period |
|---|---|---|---|---|---|---|
| 25% | 3 | 60 | 2.885 ETH | 0.0096 ETH | 0.000080 ETH | 0.043 ETH |
| 50% | 3 | 60 | 5.769 ETH | 0.0192 ETH | 0.000160 ETH | 0.087 ETH |
| 100% | 3 | 60 | 11.538 ETH | 0.0385 ETH | 0.000321 ETH | 0.173 ETH |
| 100% | 1 | 60 | 11.538 ETH | 0.1154 ETH | 0.000962 ETH | 0.173 ETH |
| 100% | 6 | 60 | 11.538 ETH | 0.0192 ETH | 0.000160 ETH | 0.173 ETH |
| 100% | 3 | 150 | 11.538 ETH | 0.0385 ETH | 0.000128 ETH | 0.173 ETH |

Two things to read off this:

**The pool is fixed; activity only splits it differently.** The last three rows all pay out the same
0.173 ETH per period. Doubling the proposals halves the per-proposal reward; more votes dilute the
per-vote reward. Nobody earns more by doing more in aggregate — this is a revenue share, not a bounty.

**A single vote is worth well under a cent at these settings.** 0.00032 ETH is around $1 at $3,000/ETH,
and that is the *client's* share for facilitating the vote, not the voter's. Writing a proposal is worth
around 0.04 ETH. Those are the honest numbers to quote.

**Be honest about the magnitude.** At 100% of staking yield this is single-digit ETH
per year across every client, every proposal and every vote. It is meaningfully
smaller than auction-funded rewards were. The argument for it is continuity — clients
stay funded and the reward machinery keeps running — not replacing the old numbers.

If the DAO decides that is too small, **`revenueShareBps` is the wrong knob to reach
for.** Counting more than 100% of yield as revenue is conceptually odd and the
parameter caps out at 655%. `proposalRewardBps` and `votingRewardBps` already exist,
are already DAO-settable via `setProposalRewardParams`, and are the natural place to
size rewards. Leave `revenueShareBps` as a plain 0-100% dial for how much of the
treasury's yield is earmarked for clients.

**TODO before submitting:** the treasury's actual staked position across stETH,
wstETH, rETH and mETH, and the live reward bps. `packages/nouns-sdk`'s
`readNounsTreasuryBalancesInEth` already reads exactly those balances.

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
