# How to submit the joker-card proposal

## Decision: direct `propose()` — there is no candidate system

`NounV2Treasury` is a minimal fork of `SmallGrantsTreasury`. It has **no
candidate / signature-gathering layer** — the only entry point is
`propose(address[],uint256[],string[],bytes[],string)`. So the submission
path is simply: call `propose()` from a wallet that meets the threshold.

## You qualify

| Check | Value |
|---|---|
| Proposer wallet | `0xae4705dC0816ee6d8a13F1C72780Ec5021915Fed` |
| NounV2 balance | 8 |
| Self-delegated? | yes (`delegates(you) == you`) |
| Current votes | 8 |
| Threshold | 1 |
| Total V2 supply | 31 (you control ~26%) |

No quorum requirement — a proposal passes if `forVotes > againstVotes` at the
end of voting. With 8 of 31 votes and a benign append-only art add, this is
a comfortable pass.

## Timeline (all params on-chain)

| Phase | Length | Notes |
|---|---|---|
| Voting delay | 0 | voting is live the instant you propose |
| Voting period | 3600 blocks (~12 h) | cast `castVote(id, 1)` |
| Queue | manual | call `queue(id)` once Succeeded |
| Timelock | 43200 s (12 h) | wait before execute |
| Grace period | 7 days | execute window after timelock |

Minimum propose → execute ≈ **24 hours** (12 h vote + 12 h timelock).

## Steps

1. **Propose** — call `NounV2Treasury.propose(...)` at
   `0x2cdeb0d251674710840d9fa990d1de138dfe7c00` with the arrays in
   `propose-call.json`:
   - targets: `["0xae0247ca34b211a61b03a95f8008dcb8b3124b89"]`
   - values: `["0"]`
   - signatures: `["addHeads(bytes,uint80,uint16)"]`
   - calldatas: the one blob in the json
   - description: the markdown (paste `PROPOSAL.md` body)
2. **Vote** — `castVote(proposalId, 1)` from your wallet (1 = for).
3. **Wait out** the ~12 h voting period.
4. **Queue** — `queue(proposalId)` once `state(id) == Succeeded`.
5. **Wait** 12 h timelock.
6. **Execute** — `execute(proposalId)` within the 7-day grace window.
   This fires the `addHeads` call and the joker-card head enters rotation
   on the next auction settlement.

## Submitting the propose() tx

Two practical options:

**A. Etherscan write tab** (no code) — go to the Treasury contract's
"Write Contract" tab on Etherscan, connect your wallet, expand `propose`,
and paste each array. Etherscan wants arrays as comma-separated / JSON-ish:
- `targets`: `["0xae0247ca34b211a61b03a95f8008dcb8b3124b89"]`
- `values`: `[0]`
- `signatures`: `["addHeads(bytes,uint80,uint16)"]`
- `calldatas`: `["0x0000…0150000"]` (the blob from propose-call.json)
- `description`: the markdown text

**B. A tiny ethers script** (cleaner for the long calldata) — say the word
and I'll write a `submit.ts` that loads `propose-call.json` and sends it via
your wallet (you provide the key / use a ledger). I will not handle a
private key without you explicitly asking.

## Do NOT (descriptor admin footguns)

Per `nounv2_descriptor_handoff_pending.md`, never let a proposal call
`lockParts`, `setArt`, `setArtDescriptor`, `setArtInflator`, `setRenderer`,
`lockDescriptor`, or `lockSeeder` — all one-way / freeze art forever. This
proposal touches none of them; it's a single `addHeads` append.

## Pre-flight verification (recommended)

Fork-simulated against mainnet (anvil) on 2026-05-27 — PASSED:
- `headCount()` went 253 → 254
- the joker-card head landed at index **253**
- `heads(253)` returned `0x00071b14052c0c168d2c0c168d2c0c168d2c0c16392c0c`
  byte-for-byte (matches the RLE exactly)
- executed as the Treasury (descriptor owner), status 1 (success)

Note: live head count was **253**, not 252 as the handoff notes claimed —
the count has drifted since the May 10 ceremony (which is exactly the drift
the nounirl trait-count fix addresses). The joker head appends at 253.
