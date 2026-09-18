# How to submit Client Incentives V2

## Run it as a candidate first

Unlike the NounV2 treasury (see `proposal-joker-card/SUBMIT.md`), the main Nouns DAO
has a candidate layer, and this proposal should use it. It changes a live money
contract, so it wants eyes on it before it costs anyone a proposal slot.

Order of operations:

1. **Open the PR** (this branch) and let people read the diff.
2. **Deploy to Sepolia**, wire it up end to end, and let a reward period actually run
   with a real staking yield reading. Post the addresses on the candidate.
3. **Create the candidate** with the transactions from `PROPOSAL.md`.
4. **Gather feedback**, then promote to a full proposal.

## Before you can fill in the transactions

Four things in `PROPOSAL.md` are marked TODO and must be resolved first:

- **The live `Rewards` proxy address.** Not hardcoded anywhere in this repo. The
  deploy script reads it from a `REWARDS_PROXY` env var on purpose — verify it on
  Etherscan rather than trusting a remembered address.
- **The live `proposalRewardBps` and `votingRewardBps`.** Read them off the contract
  with `getProposalRewardParams()`.
- **The treasury's current staked position**, for the sizing section.
- **The `revenueShareBps` you want.** This is the only real decision in the proposal.
  It is set on the oracle, not on `Rewards`.

## Deploy

```bash
cd packages/nouns-contracts
REWARDS_PROXY=<verified rewards proxy> \
DEPLOYER_PRIVATE_KEY=<key> \
forge script script/Rewards/DeployClientIncentivesV2Mainnet.s.sol --rpc-url <rpc> --broadcast
```

This deploys the new `Rewards` implementation and the `StakingRevenueOracle`, then
prints all seven proposal transactions with their exact calldata.

It deploys only. Every switch is `onlyOwner` and the owner is the treasury, so
nothing is live until the DAO executes a proposal.

## Verify the asset calldata

The proposal configures four assets. Check each rate function on Etherscan before
submitting:

| Asset | Position read | Rate read |
|---|---|---|
| wstETH | `balanceOf(treasury)` | `stEthPerToken()` |
| stETH | `sharesOf(treasury)` | `getPooledEthByShares(1e18)` |
| rETH | `balanceOf(treasury)` | `getExchangeRate()` |
| mETH | `balanceOf(treasury)` on the token | `mETHToETH(1e18)` on the staking contract |

These fail safe — `addAsset` reads both values and reverts if either fails, so a
wrong selector kills the proposal transaction rather than silently reporting zero
revenue forever. Check them anyway.

## Sanity check after execution

- `oracle.pendingRevenue()` should return a plausible, non-zero number that grows
  over time. It reflects `revenueShareBps`, so it reads 0 until transaction 7 lands.
- `oracle.readAsset(i)` returns the raw rate and position for each asset, for
  comparing against Etherscan by hand.
- The first `updateRewardsForProposalWritingAndVoting` after execution should emit
  `RevenueConsumed` from the oracle, carrying both the reported and the raw measured
  figure.

If the number looks wrong, `oracle.setRevenueShareBps(0)` switches staking revenue
off immediately without touching anything else, `rewards.setStakingRevenueOracle(0)`
detaches it entirely, and `resyncAssets()` drops an accrual the DAO does not want
paid out.
