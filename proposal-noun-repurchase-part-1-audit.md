# Noun Repurchase Program, Part I of II: audit it first

**Status:** draft
**Asks for:** 5 ETH
**Part II:** `proposal-noun-repurchase-part-2-program.md`, which turns the program on. It is not voted on until this part is done.
**Code:** `packages/nouns-contracts/contracts/repurchase/NounsRepurchase.sol` (with `EthConverters.sol` and `INounsRepurchase.sol`), tests in `test/foundry/NounsRepurchase.t.sol`

## TL;DR

We want to give members a way to leave the DAO by selling their Noun back at book value or below, never above. Each exit raises the book value of every Noun that stays. The full design is in Part II.

The contract that runs it will hold treasury ETH and members' Nouns, so it should be audited before the DAO votes to switch it on. This proposal asks for 5 ETH to pay for that audit and to cover the costs around it. It does not deploy anything live, move any Nouns, or change the bylaws.

## The program in one paragraph

Each week the DAO sets an ETH budget. Members who want out escrow their Noun and say what discount to book value they will accept. The deepest discounts fill first, and everyone filled that week is paid the same price. Nobody is paid more than book value, so the DAO never pays a member more than their share, and the Nouns that stay end up with slightly more book value after every exit. Bought-back Nouns go to the treasury. Part II has the mechanism, the legal basis under the DUNA Act, the parameters, and the Compliance Administrator review packet.

## Why audit first

- The contract holds ETH set aside for buybacks and escrows members' Nouns while they wait.
- It cannot be upgraded. That is deliberate: nobody can change the rules later without a new contract and a new vote. It also means bugs have to be caught before launch.
- The auction logic is new code: matching asks, pricing them, and walking the order book under a budget. It has 64 passing tests, including randomized tests of its core guarantees, but tests written by the author are not a substitute for an independent review.

Splitting this into two proposals means the DAO only votes on turning the program on once it can read the audit.

## What the 5 ETH pays for

| Item                       | Notes                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent security audit | Scope: `NounsRepurchase.sol`, `EthConverters.sol`, `INounsRepurchase.sol` and the deploy script. Auditor and quote to be named before this goes to a vote. |
| Fix review                 | The auditor checks the fixes for anything they find.                                                                                                       |
| Deployment and contingency | Gas to deploy the audited contract and verify it on Etherscan, plus unforeseen costs.                                                                      |

Any ETH not spent is returned to the treasury when the work is done, and the proposal thread will get an itemized account of what was spent.

## What happens if this passes

1. The audit is done on a fixed commit of the code.
2. Findings are fixed, the auditor reviews the fixes, and the report is published.
3. The audited commit is deployed. The contract is owned by the DAO from the moment it exists and starts **paused**: nobody can place an ask or settle a round until the DAO votes to unpause it. The deployer has no control over it at any point.
4. Part II goes up for a vote, linking the audit report and the deployed contract. Part II adopts the bylaws amendment, funds the contract, and unpauses it.

If the audit turns up something that cannot be fixed, or the DAO votes Part II down, the deployed contract stays paused, holds nothing, and does nothing.

## On-chain actions

1. Send the audit fee straight to the auditor: _[auditor name], [quote] ETH to [auditor 0x address]_. The DAO pays the auditor directly; no money passes through the proposer.
2. Send the contingency (deployment gas, Etherscan verification, unforeseen costs) to `nocguild.eth` (_[0x address]_). Unspent contingency goes back to the treasury.

The auditor, quote and both addresses are filled in once quotes are back (see `audit-quote-request.md`). The total replaces the 5 ETH estimate above.

## Compliance

This is a payment for services: an audit and the work around it. The proposer's reading is that it falls under the payments Bylaws §3.1 already permits, so it does not depend on the bylaws amendment in Part II. Compliance Administrators, please confirm.

The Compliance Administrator review of Part II under Bylaws §2.2(a) can start in parallel, so it is ready when the audit is.
