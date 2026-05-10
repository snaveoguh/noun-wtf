// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.6;

import { INounsSeeder } from '../interfaces/INounsSeeder.sol';
import { INounsDescriptorMinimal } from '../interfaces/INounsDescriptorMinimal.sol';

/// @title NounV2 Slobber Seeder
/// @notice Custom seeder for NounV2 with a hidden trait rule:
///
///         Slobber is an accessory that **only appears under one condition**:
///         a noun with `head ∈ {retainer, index-card}` AND a normally-rolled
///         `accessory == grease` has a 50/50 chance to settle with `slobber`
///         instead. Slobber is otherwise excluded from random rotation.
///
/// @dev    Hardcoded indices match the post-deploy state of the V2-owned
///         NounsDescriptorV2 produced by DeployAndSeedV2Descriptor.s.sol:
///           - grease accessory at index 137 (inherited from 0x6229c811…)
///           - retainer head at index 173 (inherited)
///           - index-card head at index 237 (inherited)
///           - slobber accessory at index 143 (added by the deploy script,
///             positioned right after prop-966 multicolor at index 142;
///             note: source descriptor 0x6229c811 had 142 inherited
///             accessories on-chain, not 143 as image-data.json snapshots)
///
///         If governance later adds more accessories via `addAccessories`,
///         slobber's index stays put and the skip-mapping below excludes it
///         from random rotation forever — no seeder redeploy needed.
///
///         To extend the rule (more triggering heads, different accessory,
///         etc.), deploy a new seeder and call `Safe.setSeeder(...)` on the
///         V2 token. NEVER call `lockSeeder` — it's one-way.
contract NounV2SlobberSeeder is INounsSeeder {
    uint256 public constant GREASE_INDEX = 137;
    uint256 public constant RETAINER_INDEX = 173;
    uint256 public constant INDEX_CARD_INDEX = 237;
    uint256 public constant SLOBBER_INDEX = 143;

    function generateSeed(uint256 nounId, INounsDescriptorMinimal descriptor)
        external
        view
        override
        returns (Seed memory)
    {
        uint256 pseudorandomness = uint256(
            keccak256(abi.encodePacked(blockhash(block.number - 1), nounId))
        );

        uint256 backgroundCount = descriptor.backgroundCount();
        uint256 bodyCount = descriptor.bodyCount();
        uint256 accessoryCount = descriptor.accessoryCount();
        uint256 headCount = descriptor.headCount();
        uint256 glassesCount = descriptor.glassesCount();

        // Defensive guard: this seeder assumes slobber sits at SLOBBER_INDEX
        // and is excluded from random rotation via skip-mapping below. If it
        // is ever paired with a descriptor whose accessoryCount is too small
        // for that slot to exist, fail loudly rather than silently mis-roll.
        // (At deploy time accessoryCount == 145 and only grows from there.)
        require(
            accessoryCount > SLOBBER_INDEX,
            'NounV2SlobberSeeder: accessoryCount must exceed SLOBBER_INDEX'
        );

        // Random pick excludes slobber via skip-mapping. Picking from
        // [0, accessoryCount - 1) means we sample N-1 candidates, then
        // shift any pick at-or-above SLOBBER_INDEX up by 1, so the
        // effective range is [0, SLOBBER_INDEX) ∪ (SLOBBER_INDEX, N-1].
        uint48 accessory = uint48(uint48(pseudorandomness >> 96) % (accessoryCount - 1));
        if (accessory >= SLOBBER_INDEX) {
            accessory += 1;
        }

        uint48 head = uint48(uint48(pseudorandomness >> 144) % headCount);

        // Slobber rule: head ∈ {retainer, index-card} && accessory == grease
        // → 50/50 swap to slobber. Use bits 240..255 of the pseudorandomness
        // (untouched by the standard 5 trait selections at bits 0..239).
        if (
            accessory == uint48(GREASE_INDEX) &&
            (head == uint48(RETAINER_INDEX) || head == uint48(INDEX_CARD_INDEX))
        ) {
            if (((pseudorandomness >> 240) & 1) == 1) {
                accessory = uint48(SLOBBER_INDEX);
            }
        }

        return Seed({
            background: uint48(uint48(pseudorandomness) % backgroundCount),
            body: uint48(uint48(pseudorandomness >> 48) % bodyCount),
            accessory: accessory,
            head: head,
            glasses: uint48(uint48(pseudorandomness >> 192) % glassesCount)
        });
    }
}
