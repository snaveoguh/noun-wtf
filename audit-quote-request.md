# Audit quote request: Noun Repurchase Program + Client Incentives V2

Outreach kit for the audit funding proposal (`proposal-audit-part-1.md`). It covers two pieces of code in one
engagement. Send the message below to a few of the auditors listed, collect quotes, then name the winner (and their
payment address) in the proposal so the DAO pays them directly.

| Code                    | Branch                       | Commit to audit  | What it is                                                                |
| ----------------------- | ---------------------------- | ---------------- | ------------------------------------------------------------------------- |
| Noun Repurchase Program | `claude/adoring-ride-e4i6e3` | latest on branch | New contract: members sell Nouns back to the DAO in a reverse auction     |
| Client Incentives V2    | `claude/relaxed-cray-85nce2` | `3be31db04`      | Upgrade to the live `Rewards` contract, plus a new staking-revenue oracle |

Pin an exact commit for each before sending, so the quote and the audit are on the same code.

## Who to ask

Start with the first two: they have audited Nouns before, so they already know the token, the Executor and the
DAO's governance. Sherlock audited the original `Rewards` contract, so they can review the Client Incentives V2
changes as a diff.

| Auditor                    | Why them                                                                                                                                                                                         | How to reach them                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sherlock**               | Audited Nouns client incentives (`Rewards`) in 2024 (report in `packages/nouns-contracts/audits/`).                                                                                              | Form at [sherlock.xyz/contact](https://sherlock.xyz/contact). They say quotes come back within 24 hours.                                                                                                       |
| **Spearbit** (via Cantina) | Audited Nouns DAO V3 (report in `packages/nouns-contracts/audits/`).                                                                                                                             | "Request a quote" on [cantina.xyz/solutions/spearbit](https://cantina.xyz/solutions/spearbit/smart-contract-security-reviews). Cantina can also put a solo researcher on it, which suits a codebase this size. |
| **Code4rena / Zenith**     | Ran two public Nouns DAO audit contests ([2022](https://code4rena.com/reports/2022-08-nounsdao), [2023](https://code4rena.com/reports/2023-07-nounsdao)). Zenith is their private-audit service. | Request through [code4rena.com](https://code4rena.com).                                                                                                                                                        |
| **Pashov Audit Group**     | Well known for small, fast private audits.                                                                                                                                                       | Telegram [@pashovkrum](https://github.com/pashov/audits), or [pashov.com](https://pashov.com/).                                                                                                                |
| **Cyfrin**                 | Private audits; also runs CodeHawks competitive audits.                                                                                                                                          | [cyfrin.io/services/audits](https://www.cyfrin.io/services/audits).                                                                                                                                            |

Three or four quotes is plenty. Ask each the same questions so the quotes are comparable.

## Message to send

Fill in the bracketed bits (the two commit links and how to reach you) before sending.

---

**Subject: Quote request: two small Nouns DAO codebases (~770 nSLOC new or changed), paid by DAO proposal**

Hi,

I'm putting a proposal to Nouns DAO to fund one audit covering two pieces of code, and I'd like a quote I can attach
to it. If it passes, the DAO treasury pays you directly on-chain. Both are Solidity 0.8.23 with Foundry tests.

### 1. Noun Repurchase Program (new contract)

`NounsRepurchase` lets Nouns holders sell their Noun back to the DAO at or below its share of treasury net asset
value. Members escrow Nouns with the discount they will accept. Once a round (weekly), a permissionless `settle()`
fills the deepest discounts first within an ETH budget and pays everyone filled one uniform clearing price (a
modified Dutch auction). Bought-back Nouns go to the DAO treasury. NAV is computed on-chain from the treasury's ETH
and LST balances, using the protocols' own rates for wstETH, rETH and mETH. Owned by the DAO Executor, deploys
paused, not upgradeable. OpenZeppelin 4.9.6.

| File                                            | Lines (code only) |
| ----------------------------------------------- | ----------------- |
| `contracts/repurchase/NounsRepurchase.sol`      | ~410              |
| `contracts/repurchase/EthConverters.sol`        | ~45               |
| `contracts/interfaces/INounsRepurchase.sol`     | ~80               |
| `contracts/interfaces/IEthConverter.sol`        | ~5                |
| `script/DeployNounsRepurchase.s.sol` (optional) | ~75               |

Code: [commit link]. 64 Foundry tests, including fuzz tests of the core guarantees (nobody paid above NAV or below
their own ask, rounds stay in budget, NAV per remaining Noun never falls) and an end-to-end test against the real
`NounsToken`.

Areas I'd most like eyes on: the order-book walk and uniform pricing in `settle()`; gas bounds and griefing via
cancelled or stale queue slots; NAV manipulation (what feeds it, and who can move it); the sanctions and EIP-712 KYC
gates; the ETH/WETH payout fallback; and whether escrowed Nouns can ever get stuck.

### 2. Client Incentives V2 (upgrade to the live `Rewards` contract)

Nouns pays client rewards for proposals and votes out of auction revenue. Since Auction House V4 routes no-bid
Nouns to the treasury, a period with no auction revenue makes the reward update revert, and a period with no
settlements panics, so rewards stop. This change fixes both, and adds a `StakingRevenueOracle` that measures the
treasury's LST staking yield (rate growth only, so deposits, withdrawals and donations don't count) and reports it
as revenue `Rewards` can split among clients. It is off until the DAO sets a revenue share.

| File                                                    | Lines (code only)                         |
| ------------------------------------------------------- | ----------------------------------------- |
| `contracts/client-incentives/StakingRevenueOracle.sol`  | ~180 (new)                                |
| `contracts/client-incentives/IStakingRevenueOracle.sol` | ~5 (new)                                  |
| `contracts/client-incentives/Rewards.sol`               | ~50 changed, of ~450 (UUPS proxy upgrade) |
| `script/Rewards/DeployClientIncentivesV2Mainnet.s.sol`  | ~90 (optional)                            |

Code: [commit link]. Tests for the oracle and the new reward paths, plus a simulation of reward sizes run against
the real contract.

Areas I'd most like eyes on: storage-layout safety of the upgrade (new fields are appended to the existing ERC-7201
namespace); the yield arithmetic and its `maxRevenuePerConsume` cap; behaviour when a staking token's rate or
balance read fails; the state-changing call from `Rewards` into the oracle (no reentrancy guard was added because
both are owned by the treasury); and the changed `getAuctionRevenue` edge cases. Note `Rewards` is 60 bytes under
the EIP-170 size limit after this change.

### What I'm asking

1. Your price for both together, and whether that includes reviewing the fixes. If you'd price them separately,
   please show both.
2. Who would do it and how long it would take.
3. Whether you'll take payment in ETH (or USDC) from the Nouns DAO treasury when the proposal executes. That means
   paying on execution, not up front, about two weeks after submission if the vote passes.
4. Your earliest start date after that.
5. The address you'd want the DAO to pay. It goes in the proposal, which is public.

The final report should be publishable, since the DAO will vote on switching each one on with the report in hand.

Thanks,
[name / how to reach you]

---

## After the quotes come back

- Put the chosen auditor, their quote and their payment address into `proposal-audit-part-1.md`. Replace the
  estimate with their quote plus a small contingency.
- The contingency (deployment gas, Etherscan verification, anything unforeseen) can't sensibly go to the auditor.
  Either send it as a second, small transfer to `nocguild.eth`, or have the deployer cover gas themselves and drop
  the contingency.
- The proposal needs the address as `0x…`, not the ENS name. Check the auditor's address and `nocguild.eth`'s
  resolved address yourself before submitting.
