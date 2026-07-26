# NounV2 Proposal: Add head trait `joker-card`

## TL;DR

Add a single new head trait to the `NounV2Descriptor` (`0xae0247…3124b89`).
The new head is `head-joker-card` — the existing `head-index-card` head with
its top red line and bottom blue line swapped, so the card reads upside-down
and gives the head a face-down playing-card / joker silhouette.

One on-chain call. Zero ETH. No palette changes. No new colors. No risk to
existing nouns 0..N — `addHeads` only appends to the heads page set, it
cannot modify or remove existing traits.

## What it does

A single call to `NounV2Descriptor.addHeads(bytes,uint80,uint16)`, executed
by the V2 Treasury (which owns the descriptor):

| Field | Value |
|---|---|
| target | `0xae0247ca34b211a61b03a95f8008dcb8b3124b89` (NounV2Descriptor) |
| value | `0` wei |
| signature | `addHeads(bytes,uint80,uint16)` |
| imageCount | `1` |
| originalLength | `160` bytes |
| encodedCompressed | `0x6360c00b14f04b3330129027a45f9c815d5a84558747ac17095beaf0c0150000` (32 B) |
| selector (FYI) | `0x94f3df61` |

## The art

```
INDEX CARD (existing trait 237)        JOKER CARD (proposed)

    ──────────────────                     ──────────────────
                                                            
    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓        red          ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  blue
                                                            
    ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒        blue         ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  blue
                                                            
    ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒        blue         ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  blue
                                                            
    ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒        blue         ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  red
                                                            
    ──────────────────                     ──────────────────
```

Source PNG: `proposal-joker-card/head-joker-card.png` (32×32 RGBA).
RLE: `0x00071b14052c0c168d2c0c168d2c0c168d2c0c16392c0c` (23 bytes).

Palette indices used:
- `0x0c` — `#fffdf2` (cream / card body, already in slot 12)
- `0x39` — `#f38b7c` (red, already in slot 57)
- `0x8d` — `#a3baed` (blue, already in slot 141)

All three colors are already in the live V2 palette — no `setPalette` call
needed.

## Why

The index card has been a quietly beloved head since the original mainnet
descriptor set. It's the only "object that reads as paper" in the head pool,
and the chromatic asymmetry (red on top, three blue ruled lines below) is
what makes it instantly recognisable.

`joker-card` is the inversion: red on the bottom, blue on top. The head
reads as the same kind of thing but face-down — a sealed envelope, an
upside-down playing card, a tarot-style "reversed" card. It introduces
exactly one new symbol to the rotation without changing any existing art.

This is also a useful **first V2 proposal**: minimal scope, fully reversible
in spirit (V2 governance can always add another head to "cancel it out" if
the community hates it), and exercises the descriptor → Treasury → proposal
path end-to-end, surfacing any kinks for bigger art proposals later.

## Safety / what this proposal does NOT do

- ❌ does not modify any existing head (heads `addHeads` only **appends**)
- ❌ does not touch palettes, bodies, accessories, glasses, or backgrounds
- ❌ does not call `lockParts`, `setArt`, `setArtDescriptor`, `setRenderer`,
  or any other admin surface (see `nounv2_descriptor_handoff_pending.md`
  "Things to never do")
- ❌ does not transfer ownership of the descriptor
- ❌ does not move any treasury ETH

Existing minted nouns are unaffected — their on-chain seeds reference
indices in the current head range and are immutable.

## Effect on rotation

After execution, `headCount()` increments by 1 (253 → 254, fork-verified)
and the joker-card head lands at index **253**. Random head selection in
`NounV2SlobberSeeder` uses `pseudorandomness % headCount`, so the new head
joins the rotation immediately on the next auction settlement.

The slobber-trigger set in the seeder is `head ∈ {retainer, index-card}`
with hardcoded indices `RETAINER_INDEX = 173` and `INDEX_CARD_INDEX = 237`
(see `NounV2SlobberSeeder.sol`). The joker-card head appears at the new
appended index and is **not** a slobber-trigger head. Slobber rule is
unchanged.

## How to verify

The compressed bytes decompress to a single-item `bytes[]` whose only
element is the RLE above. Anyone can verify locally:

```js
const { inflateRawSync } = require('zlib');
const enc = '6360c00b14f04b3330129027a45f9c815d5a84558747ac17095beaf0c0150000';
const decompressed = inflateRawSync(Buffer.from(enc, 'hex')).toString('hex');
// 160 bytes, ABI-encodes to [['0x00071b14052c0c168d2c0c168d2c0c168d2c0c16392c0c']]
```

Or render the RLE in the noun.wtf SDK to see the head before voting:
`packages/nouns-sdk` has the decoder used by the playground.
