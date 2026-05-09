// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import 'forge-std/Script.sol';
import { NounsDescriptorV2 } from '../contracts/NounsDescriptorV2.sol';

/// @title Sanity-check trait counts on the freshly deployed V2 descriptor.
/// @dev   Run AFTER DeployAndSeedV2Descriptor and BEFORE deploying the seeder.
///        If any expected count is wrong, do NOT proceed to seeder deploy —
///        ping me first.
///
/// Usage: NEW_DESCRIPTOR=0x... forge script script/PrintTraitIndices.s.sol --rpc-url $RPC_URL
contract PrintTraitIndices is Script {
    function run() external view {
        address newDescriptor = vm.envAddress('NEW_DESCRIPTOR');
        NounsDescriptorV2 d = NounsDescriptorV2(newDescriptor);

        uint256 bodyC = d.bodyCount();
        uint256 accC  = d.accessoryCount();
        uint256 headC = d.headCount();
        uint256 bgC   = d.backgroundCount();

        console.log('=== Trait counts on V2 descriptor', newDescriptor, '===');
        console.log('  bodyCount:       %s   (expected 32:  30 inherited + 2 founder = white,black)', bodyC);
        console.log('  accessoryCount:  %s  (expected 145: 143 inherited + 2 founder = prop966,slobber)', accC);
        console.log('  headCount:       %s  (expected 255: 254 inherited + 1 founder = missingnoun)', headC);
        console.log('  backgroundCount: %s    (expected 2)', bgC);
        console.log('');

        bool ok = (bodyC == 32 && accC == 145 && headC == 255 && bgC == 2);
        if (ok) {
            console.log('Counts match expected. Seeder indices are safe to deploy:');
            console.log('  GREASE_INDEX     = 137');
            console.log('  RETAINER_INDEX   = 173');
            console.log('  INDEX_CARD_INDEX = 237');
            console.log('  SLOBBER_INDEX    = 144 (= accessoryCount - 1)');
        } else {
            console.log('!! COUNT MISMATCH - seeder indices may be wrong. STOP and investigate.');
        }
    }
}
