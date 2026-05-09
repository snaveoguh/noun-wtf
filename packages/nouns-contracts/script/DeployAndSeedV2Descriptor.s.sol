// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import 'forge-std/Script.sol';
import { NounsDescriptorV2 } from '../contracts/NounsDescriptorV2.sol';
import { ISVGRenderer } from '../contracts/interfaces/ISVGRenderer.sol';
import { IInflator } from '../contracts/interfaces/IInflator.sol';
import { INounsArt } from '../contracts/interfaces/INounsArt.sol';
import { NounsArt } from '../contracts/NounsArt.sol';

/// @title Deploy + seed V2-owned NounsDescriptorV2 (same-broadcast handoff)
/// @notice Deploys a fresh NounsDescriptorV2 + NounsArt pair, copies the
///         current V2 art set 1:1 from the older mainnet descriptor at
///         0x6229c811…, appends 14 palette colors, adds Hugo's founder
///         traits (2 bodies white/black, 2 accessories prop-966/slobber,
///         1 head missingnoun), then `transferOwnership` to NounV2Treasury
///         as the final tx of the same `forge script` broadcast.
///
///         This is NOT a single onchain atomic transaction — each
///         `addX` / `setPalette` is its own tx (and `--slow` puts each
///         in its own block). The deployer's window of unilateral
///         control is the wall-clock duration of one `forge script`
///         run on Hugo's machine; in practice that's a few minutes,
///         and the bad-window only matters if Hugo's signing key is
///         compromised mid-run AND the descriptor were already wired
///         into V2 (it is not — the Safe `setDescriptor` is a
///         separate later step).
///
///         After the script returns, only V2 governance can mutate
///         the descriptor (addX, setPalette, etc.).
///
///         You can still verify counts with PrintTraitIndices.s.sol after
///         the run, but if anything's wrong recovery is "deploy a new one
///         from scratch" rather than "patch the existing one" — by design.
///
/// @dev    Pattern lifted from UpgradeDescriptorV2PopulateArtFromExisting.s.sol.
///         Run with --broadcast.
contract DeployAndSeedV2Descriptor is Script {
    // ─── Mainnet source contracts (V2 currently reads from these) ────────
    NounsDescriptorV2 public constant SOURCE_DESCRIPTOR =
        NounsDescriptorV2(0x6229c811D04501523C6058bfAAc29c91bb586268);
    NounsArt public constant SOURCE_ART =
        NounsArt(0x48A7C62e2560d1336869D6550841222942768C49);
    ISVGRenderer public constant RENDERER =
        ISVGRenderer(0x81d94554A4b072BFcd850205f0c79e97c92aab56);
    IInflator public constant INFLATOR =
        IInflator(0xa2acee85Cd81c42BcAa1FeFA8eD2516b68872Dbe);

    // ─── V2 ecosystem ───────────────────────────────────────────────────
    address public constant V2_TREASURY = 0x2cDeb0d251674710840d9fa990D1de138dfe7C00;

    // ─── 14 new palette colors (RGB triplets, append-order) ─────────────
    // slot 239..252 — see ARTIST_HANDOFF.md for the mapping.
    bytes public constant NEW_PALETTE_COLORS =
        hex'068941807f7d2985fbcdc1a9857b1d639ff885e4d8fe4f0d44f9fdfefefefeefecf2897ce0d6d4fe628c';

    // ─── Founder trait payloads (compressed deflate, ABI-bytes[] envelope) ───
    // All sourced from the local nouns-assets palette + encoder. The prop-966
    // accessory uses the original on-chain compressed bytes from the V3 governor
    // proposal — already battle-tested as a valid `addAccessories` input.

    // Body 0 (white): recolor of body-bege-bsod with palette index 2 (#ffffff)
    bytes public constant WHITE_BODY_COMPRESSED =
        hex'6360c00b14f04b33303250a65f9941545c9ed38a8991811707e666c26b0000';
    uint80 public constant WHITE_BODY_DECOMPRESSED_LEN = 192;
    uint16 public constant WHITE_BODY_IMAGE_COUNT = 1;

    // Body 1 (black): recolor of body-bege-bsod with palette index 36 (#000000)
    bytes public constant BLACK_BODY_COMPRESSED =
        hex'6360c00b14f04b33303250a65f9941545c9ed34a8591811707e656c16b0000';
    uint80 public constant BLACK_BODY_DECOMPRESSED_LEN = 192;
    uint16 public constant BLACK_BODY_IMAGE_COUNT = 1;

    // Accessory 0 (prop-966 multicolor) — original on-chain compressed bytes.
    // Source: noun.wtf prop 966, calldata to V1 NounsDescriptorV2 0x33A9c445…
    bytes public constant PROP966_ACCESSORY_COMPRESSED =
        hex'858c310e803010c39cdcc084d4811337217ec1d3fafd0a06c6368b07cb81e9eeb9460bbfea1fcee3daa384bb70f9a32ad0cbbea10cd48cd3b8894811ed3f18';
    uint80 public constant PROP966_ACCESSORY_DECOMPRESSED_LEN = 192;
    uint16 public constant PROP966_ACCESSORY_IMAGE_COUNT = 1;

    // Accessory 1 (slobber) — recolor of grease with #caeff9 (palette slot 6).
    // This is the index the seeder will hardcode as SLOBBER_INDEX (143 + 1 = 144).
    bytes public constant SLOBBER_ACCESSORY_COMPRESSED =
        hex'6360c00b14f04b33303250a6df9141545c8653988d9181938d8981118899c0342303331b2b900661762066068b413037548c174c130000';
    uint80 public constant SLOBBER_ACCESSORY_DECOMPRESSED_LEN = 224;
    uint16 public constant SLOBBER_ACCESSORY_IMAGE_COUNT = 1;

    // Head: missingnoun — uses 14 new palette colors (slots 239..252) + slot 176.
    bytes public constant MISSINGNOUN_HEAD_COMPRESSED =
        hex'6360c00b14f04b33303250a6df9581554a9e9d9d81f1bdc106960f021fed18f83e797f66fd24f051f003d37b838fcc5f04be0259df80f2df597f087c64fcc6f81384997e31fe64f9c6fa5bf113e37b8d3f782c0000';
    uint80 public constant MISSINGNOUN_HEAD_DECOMPRESSED_LEN = 224;
    uint16 public constant MISSINGNOUN_HEAD_IMAGE_COUNT = 1;

    function run() external {
        // Read the deployer's key from env. msg.sender inside `forge script`
        // defaults to Foundry's DEFAULT_SENDER (0x1804c8…) unless --sender is
        // passed, so we cannot rely on it for the predictedArt nonce math.
        // Pattern matches the existing UpgradeDescriptorV2PopulateArtFromExisting.s.sol.
        uint256 deployerKey = vm.envUint('DEPLOYER_KEY');
        address deployer = vm.addr(deployerKey);

        // Read source state BEFORE broadcast (these are view calls, no tx)
        bytes memory existingPalette = SOURCE_ART.palettes(0);

        uint256 backgroundCount = SOURCE_DESCRIPTOR.backgroundCount();
        string[] memory backgrounds = new string[](backgroundCount);
        for (uint256 i = 0; i < backgroundCount; i++) {
            backgrounds[i] = SOURCE_ART.backgrounds(i);
        }

        INounsArt.Trait memory bodies = SOURCE_ART.getBodiesTrait();
        INounsArt.Trait memory accessories = SOURCE_ART.getAccessoriesTrait();
        INounsArt.Trait memory heads = SOURCE_ART.getHeadsTrait();
        INounsArt.Trait memory glasses = SOURCE_ART.getGlassesTrait();

        // The new NounsArt is deployed in the next-but-one tx of this broadcast
        // (descriptor first, then art) — predict its address so the descriptor
        // can take it in the constructor.
        INounsArt predictedArt = INounsArt(
            computeCreateAddress(deployer, vm.getNonce(deployer) + 1)
        );

        vm.startBroadcast(deployerKey);

        // ─── 1. Deploy descriptor + art ─────────────────────────────────
        NounsDescriptorV2 descriptor = new NounsDescriptorV2(predictedArt, RENDERER);
        new NounsArt(address(descriptor), INFLATOR);

        // ─── 2. Palette: existing 239 colors + 14 new ───────────────────
        descriptor.setPalette(0, abi.encodePacked(existingPalette, NEW_PALETTE_COLORS));

        // ─── 3. Backgrounds (copy 1:1) ──────────────────────────────────
        descriptor.addManyBackgrounds(backgrounds);

        // ─── 4. Bodies / accessories / heads / glasses (copy via SSTORE2 pointers) ───
        for (uint256 i = 0; i < bodies.storagePages.length; i++) {
            descriptor.addBodiesFromPointer(
                bodies.storagePages[i].pointer,
                bodies.storagePages[i].decompressedLength,
                bodies.storagePages[i].imageCount
            );
        }
        for (uint256 i = 0; i < accessories.storagePages.length; i++) {
            descriptor.addAccessoriesFromPointer(
                accessories.storagePages[i].pointer,
                accessories.storagePages[i].decompressedLength,
                accessories.storagePages[i].imageCount
            );
        }
        for (uint256 i = 0; i < heads.storagePages.length; i++) {
            descriptor.addHeadsFromPointer(
                heads.storagePages[i].pointer,
                heads.storagePages[i].decompressedLength,
                heads.storagePages[i].imageCount
            );
        }
        for (uint256 i = 0; i < glasses.storagePages.length; i++) {
            descriptor.addGlassesFromPointer(
                glasses.storagePages[i].pointer,
                glasses.storagePages[i].decompressedLength,
                glasses.storagePages[i].imageCount
            );
        }

        // ─── 5. Founder additions (in a fixed order so indices are predictable) ───
        // Bodies: white at index 30, black at index 31
        descriptor.addBodies(
            WHITE_BODY_COMPRESSED,
            WHITE_BODY_DECOMPRESSED_LEN,
            WHITE_BODY_IMAGE_COUNT
        );
        descriptor.addBodies(
            BLACK_BODY_COMPRESSED,
            BLACK_BODY_DECOMPRESSED_LEN,
            BLACK_BODY_IMAGE_COUNT
        );

        // Accessories: prop966 at 143, slobber at 144 (= SLOBBER_INDEX in the seeder)
        descriptor.addAccessories(
            PROP966_ACCESSORY_COMPRESSED,
            PROP966_ACCESSORY_DECOMPRESSED_LEN,
            PROP966_ACCESSORY_IMAGE_COUNT
        );
        descriptor.addAccessories(
            SLOBBER_ACCESSORY_COMPRESSED,
            SLOBBER_ACCESSORY_DECOMPRESSED_LEN,
            SLOBBER_ACCESSORY_IMAGE_COUNT
        );

        // Heads: missingnoun at index 254
        descriptor.addHeads(
            MISSINGNOUN_HEAD_COMPRESSED,
            MISSINGNOUN_HEAD_DECOMPRESSED_LEN,
            MISSINGNOUN_HEAD_IMAGE_COUNT
        );

        // ─── 6. Hand the keys to the DAO (final tx of the same broadcast) ───
        // After this tx confirms, only V2 governance proposals can mutate
        // the descriptor. The deployer controlled it across steps 1-5
        // above (one tx each, in successive blocks under --slow); this is
        // a same-broadcast handoff, not a single onchain atomic op.
        descriptor.transferOwnership(V2_TREASURY);

        vm.stopBroadcast();

        console.log('=== V2 Descriptor deployed, seeded, and handed to DAO ===');
        console.log('Descriptor:    ', address(descriptor));
        console.log('NounsArt:      ', address(predictedArt));
        console.log('Owner (now):   ', descriptor.owner(), '(should be V2 Treasury)');
        console.log('');
        console.log('Final counts (verify with PrintTraitIndices.s.sol):');
        console.log('  bodyCount:        ', descriptor.bodyCount());
        console.log('  accessoryCount:   ', descriptor.accessoryCount());
        console.log('  headCount:        ', descriptor.headCount());
        console.log('  backgroundCount:  ', descriptor.backgroundCount());
        console.log('');
        console.log('NEXT STEPS:');
        console.log('  1. (optional) Run PrintTraitIndices.s.sol as a sanity check');
        console.log('  2. Deploy NounV2SlobberSeeder');
        console.log('  3. Safe: NounV2Token.setDescriptor(<this descriptor>)');
        console.log('  4. Safe: NounV2Token.setSeeder(<seeder address>)');
    }
}
