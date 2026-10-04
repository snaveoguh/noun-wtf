# Noun Repurchase Program: audit quote request

Outreach kit for Part I (`proposal-noun-repurchase-part-1-audit.md`). Send the message below to a few of the
auditors listed, collect quotes, then name the winner (and their payment address) in Part I so the DAO pays them
directly.

## Who to ask

Start with the first two: they have audited Nouns before, so they already know the token, the Executor and the
DAO's governance.

| Auditor                    | Why them                                                                                                                                                                                         | How to reach them                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spearbit** (via Cantina) | Audited Nouns DAO V3 (report in `packages/nouns-contracts/audits/`).                                                                                                                             | "Request a quote" on [cantina.xyz/solutions/spearbit](https://cantina.xyz/solutions/spearbit/smart-contract-security-reviews). Cantina can also put a solo researcher on it, which suits a codebase this size. |
| **Sherlock**               | Audited Nouns client incentives in 2024 (report in `packages/nouns-contracts/audits/`).                                                                                                          | Form at [sherlock.xyz/contact](https://sherlock.xyz/contact). They say quotes come back within 24 hours.                                                                                                       |
| **Code4rena / Zenith**     | Ran two public Nouns DAO audit contests ([2022](https://code4rena.com/reports/2022-08-nounsdao), [2023](https://code4rena.com/reports/2023-07-nounsdao)). Zenith is their private-audit service. | Request through [code4rena.com](https://code4rena.com).                                                                                                                                                        |
| **Pashov Audit Group**     | Well known for small, fast private audits.                                                                                                                                                       | Telegram [@pashovkrum](https://github.com/pashov/audits), or [pashov.com](https://pashov.com/).                                                                                                                |
| **Cyfrin**                 | Private audits; also runs CodeHawks competitive audits.                                                                                                                                          | [cyfrin.io/services/audits](https://www.cyfrin.io/services/audits).                                                                                                                                            |

Three or four quotes is plenty. Ask each the same questions so the quotes are comparable.

## Message to send

Fill in the two bracketed bits (the commit link and how to reach you) before sending.

---

**Subject: Quote request: small Nouns DAO contract (~530 nSLOC), paid by DAO proposal**

Hi,

I'm putting a proposal to Nouns DAO to fund an audit of a new contract, and I'd like a quote I can attach to it.
If it passes, the DAO treasury pays you directly on-chain.

**What it is.** `NounsRepurchase` lets Nouns holders sell their Noun back to the DAO at or below its share of
treasury net asset value. Members escrow Nouns with the discount they will accept. Once a round (weekly), a
permissionless `settle()` fills the deepest discounts first within an ETH budget and pays everyone filled one
uniform clearing price (a modified Dutch auction). Bought-back Nouns go to the DAO treasury. NAV is computed
on-chain from the treasury's ETH and LST balances, using the protocols' own rates for wstETH, rETH and mETH.
The contract is owned by the DAO Executor, deploys paused, and is not upgradeable.

**Scope** (Solidity 0.8.23, OpenZeppelin 4.9.6, Foundry):

| File                                            | Lines (code only) |
| ----------------------------------------------- | ----------------- |
| `contracts/repurchase/NounsRepurchase.sol`      | ~410              |
| `contracts/repurchase/EthConverters.sol`        | ~45               |
| `contracts/interfaces/INounsRepurchase.sol`     | ~80               |
| `contracts/interfaces/IEthConverter.sol`        | ~5                |
| `script/DeployNounsRepurchase.s.sol` (optional) | ~75               |

Code: [link to the commit]. There are 64 Foundry tests, including fuzz tests of the core guarantees (nobody paid
above NAV or below their own ask, rounds stay in budget, NAV per remaining Noun never falls), plus an end-to-end
test against the real `NounsToken`.

**Areas I'd most like eyes on:** the order-book walk and uniform pricing in `settle()`; gas bounds and griefing via
cancelled or stale queue slots; NAV manipulation (what feeds it, and who can move it); the sanctions and EIP-712
KYC gates; the ETH/WETH payout fallback; and whether escrowed Nouns can ever get stuck.

**What I'm asking:**

1. Your price, and whether that includes reviewing the fixes.
2. Who would do it and how long it would take.
3. Whether you'll take payment in ETH (or USDC) from the Nouns DAO treasury when the proposal executes. That
   means paying on execution, not up front, about two weeks after submission if the vote passes.
4. Your earliest start date after that.
5. The address you'd want the DAO to pay. It goes in the proposal, which is public.

The final report should be publishable, since the DAO will vote on switching the contract on with the report in
hand.

Thanks,
[name / how to reach you]

---

## After the quotes come back

- Put the chosen auditor, their quote and their payment address into Part I. Replace the 5 ETH figure with their
  quote plus a small contingency.
- The contingency (deployment gas, Etherscan verification, anything unforeseen) can't sensibly go to the
  auditor. Either send it as a second, small transfer to `nocguild.eth`, or have the deployer cover gas themselves
  and drop the contingency.
- The proposal needs the address as `0x…`, not the ENS name. Check the auditor's address and `nocguild.eth`'s
  resolved address yourself before submitting.
