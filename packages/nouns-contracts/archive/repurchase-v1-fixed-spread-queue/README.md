# Archived: Noun Repurchase Program v1 (fixed spread, 1 a day)

A record of the first design. It was superseded by the reverse auction now in
`contracts/repurchase/NounsRepurchase.sol`, proposed in two parts: `proposal-noun-repurchase-part-1-audit.md` and
`proposal-noun-repurchase-part-2-program.md` at the repo root.

These files are not compiled or tested: Hardhat and Foundry only build `contracts/`, `test/` and `script/`.
Import paths are the originals, so they only resolve from those folders.

## What v1 did

- Members escrowed Nouns into a single first-come, first-served queue, with an optional minimum price.
- Once a day, `settle()` bought up to `maxPerTick` Nouns (proposed: 1) at NAV less a fixed spread (proposed: 3%).

## Why it was replaced

Feedback on the draft:

- "1 a day sucks": a queue of 100 members means the last one waits over three months, at an unknown price.
- "Not putting a fair price on liquidity": a fixed 3% is too expensive in a quiet week, when paying close to book
  costs the DAO nothing.

v2 lets members name their own discount, fills the deepest discounts first within a weekly ETH budget, and pays
everyone filled one clearing price. See the "Why an auction" section of Part II.

## Provenance

Copied verbatim from `snaveoguh/noun-wtf` PR #17, merged to `staging` in commit `861ffbcb2` (2026-09-22).

| File                                  | Original path                                                        |
| ------------------------------------- | -------------------------------------------------------------------- |
| `NounsRepurchase.sol`                 | `packages/nouns-contracts/contracts/repurchase/NounsRepurchase.sol`  |
| `INounsRepurchase.sol`                | `packages/nouns-contracts/contracts/interfaces/INounsRepurchase.sol` |
| `DeployNounsRepurchase.s.sol`         | `packages/nouns-contracts/script/DeployNounsRepurchase.s.sol`        |
| `NounsRepurchase.t.sol`               | `packages/nouns-contracts/test/foundry/NounsRepurchase.t.sol`        |
| `proposal-noun-repurchase-program.md` | `proposal-noun-repurchase-program.md`                                |

`EthConverters.sol` and `IEthConverter.sol` were unchanged in v2, so they are not duplicated here.
