// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import 'forge-std/Script.sol';
import { NounV2Token } from '../contracts/nounv2/NounV2Token.sol';
import { NounV2AuctionHouse } from '../contracts/nounv2/NounV2AuctionHouse.sol';
import { NounV2Treasury } from '../contracts/nounv2/NounV2Treasury.sol';
import { INounsDescriptorMinimal } from '../contracts/interfaces/INounsDescriptorMinimal.sol';
import { INounsSeeder } from '../contracts/interfaces/INounsSeeder.sol';
import { INounsToken } from '../contracts/interfaces/INounsToken.sol';
import { IProxyRegistry } from '../contracts/external/opensea/IProxyRegistry.sol';

/// @title DeployNounV2 — single-shot mainnet deploy script.
/// @notice Deploys Token + AuctionHouse + Treasury, wires them, starts the first auction.
///         Ownership of Token + AuctionHouse stays with the deployer (memevalue.eth) for
///         day-1 operational control. Auction proceeds route to the Treasury via its
///         `beneficiary` field. Treasury admin = deployer initially.
contract DeployNounV2 is Script {
    // ─── Mainnet constants ──────────────────────────────────────────────

    // Reuse mainnet Nouns art pipeline — same descriptor + seeder means
    // NounV2 #N will be generated the same way a fresh Noun #N would be,
    // producing different-looking nouns from mainnet because the seeder's
    // pseudo-RNG keys on (nounId, blockhash) and our blockhashes differ.
    address constant NOUNS_DESCRIPTOR_V2 = 0x6229c811D04501523C6058bfAAc29c91bb586268;
    address constant NOUNS_SEEDER = 0xCC8a0FB5ab3C7132c1b2A0109142Fb112c4Ce515;
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant OPENSEA_PROXY_REGISTRY = 0xa5409ec958C83C3f309868babACA7c86DCB077c1;

    // ─── Auction parameters ─────────────────────────────────────────────
    // Match mainnet Nouns launch, except reservePrice.

    uint256 constant TIME_BUFFER = 300;             // 5 min anti-snipe
    uint256 constant RESERVE_PRICE = 0.001 ether;   // ~$3, keeps 2% minBidIncrement meaningful
    uint8 constant MIN_BID_INCREMENT_PCT = 2;       // 2%
    uint256 constant DURATION = 86400;              // 24 hours

    function run() external {
        // Hard chain-id guard. Every address constant above is mainnet-only;
        // running this script against any other chain would brick the deploy.
        require(block.chainid == 1, "DeployNounV2: not mainnet");

        address deployer = msg.sender;

        vm.startBroadcast();

        // 1. Deploy token. Minter starts as deployer (placeholder) and is swapped
        //    to the auction house below — setMinter requires onlyOwner, so we can't
        //    pass the AH as minter until we know its address anyway.
        NounV2Token token = new NounV2Token(
            deployer,
            INounsDescriptorMinimal(NOUNS_DESCRIPTOR_V2),
            INounsSeeder(NOUNS_SEEDER),
            IProxyRegistry(OPENSEA_PROXY_REGISTRY)
        );

        // 2. Deploy treasury first so the auction house can take its address as
        //    the immutable beneficiary in the constructor (atomic config, no
        //    front-run window vs a separate initialize()).
        NounV2Treasury treasury = new NounV2Treasury(address(token), deployer);

        // 3. Deploy auction house with full config in the constructor. Paused on deploy.
        NounV2AuctionHouse auctionHouse = new NounV2AuctionHouse(
            INounsToken(address(token)),
            WETH,
            TIME_BUFFER,
            RESERVE_PRICE,
            MIN_BID_INCREMENT_PCT,
            DURATION,
            address(treasury)
        );

        // 4. Hand minter control to the auction house.
        token.setMinter(address(auctionHouse));

        // 5. Unpause → mints NounV2 #0 and opens the first 24hr auction.
        auctionHouse.unpause();

        vm.stopBroadcast();

        console.log("=== NounV2 deployed ===");
        console.log("Token:      ", address(token));
        console.log("AuctionHouse:", address(auctionHouse));
        console.log("Treasury:   ", address(treasury));
        console.log("Deployer:   ", deployer);
        console.log("First noun: #0 - auction live for 24h, reservePrice = 0.001 ether");
    }
}
