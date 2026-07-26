# Propose a NounV2 art trait via governance

Adds a new head / body / accessory / glasses to the NounV2 collection by submitting a
`NounV2Treasury.propose(...)` that calls the descriptor's `addHeads`-family function.
The descriptor (`0xAe0247…`) is treasury-owned, so this is the only way to add art.

Core lives in [`src/agent/traitProposal.ts`](../src/agent/traitProposal.ts) and is shared by
this CLI, the nounirl agent chat tool, and the `add-nounv2-trait` Claude Code skill.

## Requirements

- The proposing wallet must hold **≥1 NounV2 voting unit** (contract threshold). nounirl.eth
  normally holds 0 — transfer/delegate it a NounV2 first, wait ≥1 block.
- Every colour in the trait must already be in the on-chain palette (253 entries). The core
  throws if not — a palette extension is a separate, larger proposal.
- Use a real RPC for `--send` (a paid dRPC), **not** free publicnode (it drops txs).

## Usage

```bash
# derive from an existing trait (joker = index-card with runs 1 & 7 swapped):
node --experimental-strip-types scripts/propose-trait.mjs \
  --category head --title "Joker" --description-file ./desc.md \
  --derive-from index-card --swap-runs 1,7 \
  --simulate --from 0xYOURPROPOSER

# or supply raw RLE directly:
node --experimental-strip-types scripts/propose-trait.mjs \
  --category head --title "..." --description "..." --rle 0x0007...

# broadcast (key read from env, never printed):
NOUNIRL_PRIVATE_KEY=0x... NOUNIRL_RPC_URL=https://... \
node --experimental-strip-types scripts/propose-trait.mjs \
  --category head --title "Joker" --description-file ./desc.md \
  --derive-from index-card --swap-runs 1,7 --send
```

## Flags

| flag | meaning |
|---|---|
| `--category` | `head` \| `body` \| `accessory` \| `glasses` (default `head`) |
| `--title`, `--description` / `--description-file` | proposal markdown (`# title\n\n body`) |
| `--rle 0x…` | supply the trait image directly (Nouns RLE) |
| `--derive-from <name\|index>` | derive from an existing trait in `image-data-v2.json` |
| `--swap-runs i,j` | swap the colours of RLE run i and run j (0-based over all runs) |
| `--recolor a:b,c:d` | remap palette index a→b, c→d everywhere |
| `--simulate --from 0x…` | eth_call the propose() as `from` (proves it won't revert) |
| `--send [--key-env VAR] [--rpc URL]` | broadcast; key from `VAR` (default `NOUNIRL_PRIVATE_KEY`) |

## Understanding RLE run indices

An RLE image is `[paletteIdx][top,right,bottom,left][ (len,colour) … ]`. Run 0 is the first
`(len,colour)` pair. Decode a source trait to find the run you want to recolour — e.g. index-card
is `cream, RED(run1), cream, blue, cream, blue, cream, BLUE(run7), cream`, so `--swap-runs 1,7`
swaps the top red line with the bottom blue line → joker.

## Governance timeline

`propose` → Active ~12h (`VOTING_PERIOD` 3600 blocks, no quorum, For>Against wins) → anyone
`queue(id)` → 12h timelock → `execute(id)`. Trait enters rotation on the next mint. The proposer
or the Safe admin can `cancel(id)`.
