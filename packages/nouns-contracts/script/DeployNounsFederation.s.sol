// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.19;

import 'forge-std/Script.sol';
import { NounsFederation } from '../contracts/federation/NounsFederation.sol';

/// @title DeployNounsFederation — single-shot mainnet deploy for the V2→V1 relay.
/// @notice Deploys NounsFederation wired to the live V1 NounsDAO governor and the
///         NounV2 voting token. Owner starts as the deployer (can renounce later).
///
///         After deploy:
///           1. V1 holders opt in by calling `delegate(<federation>)` on the V1
///              NounsToken — the federation then holds their V1 voting power.
///           2. Set env vars so the rest of the stack picks it up:
///                - webapp:  VITE_NOUNS_FEDERATION_ADDRESS
///                - indexer: NOUNS_FEDERATION_ADDRESS + NOUNS_FEDERATION_START_BLOCK
///                - keeper:  NOUNS_FEDERATION_ADDRESS (+ FEDERATION_KEEPER_PRIVATE_KEY)
contract DeployNounsFederation is Script {
    // ─── Mainnet constants ──────────────────────────────────────────────

    /// @notice Nouns DAO V1 governor proxy (NounsDAOLogicV4 behind NounsDAOProxyV3).
    address constant NOUNS_DAO_V1 = 0x6f3E6272A167e8AcCb32072d08E0957F9c79223d;

    /// @notice NounV2 voting token (ERC721Checkpointable — exposes getPriorVotes).
    address constant NOUNV2_TOKEN = 0xB1d6Bdf9326Dd09183C2E9D25af5e22c637293b9;

    function run() external {
        // Address constants above are mainnet-only; guard against a mis-targeted run.
        require(block.chainid == 1, 'DeployNounsFederation: not mainnet');

        address owner = msg.sender;

        vm.startBroadcast();

        NounsFederation federation = new NounsFederation(NOUNS_DAO_V1, NOUNV2_TOKEN, owner);

        vm.stopBroadcast();

        console.log('NounsFederation deployed at:', address(federation));
        console.log('  nounsDAOV1 :', NOUNS_DAO_V1);
        console.log('  nounV2Token:', NOUNV2_TOKEN);
        console.log('  owner      :', owner);
    }
}
