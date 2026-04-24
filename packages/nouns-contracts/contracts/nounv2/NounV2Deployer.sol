// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { NounV2Token } from './NounV2Token.sol';
import { NounV2AuctionHouse } from './NounV2AuctionHouse.sol';
import { NounV2Treasury } from './NounV2Treasury.sol';
import { INounsDescriptorMinimal } from '../interfaces/INounsDescriptorMinimal.sol';
import { INounsSeeder } from '../interfaces/INounsSeeder.sol';
import { INounsToken } from '../interfaces/INounsToken.sol';
import { IProxyRegistry } from '../external/opensea/IProxyRegistry.sol';

/// @title NounV2Deployer
/// @notice One-shot deploy helper. Its constructor atomically deploys the Token,
///         Treasury, and AuctionHouse; wires them together; starts auction #0;
///         and transfers ownership of Token + AuctionHouse to SAFE (Treasury
///         admin is already SAFE from its constructor).
/// @dev    Has no callable methods. Deploying this contract IS the launch.
///         Intended use: Safe{Wallet} "Create new contract" (delegatecalls
///         CreateCall) or any CREATE path. All config is hardcoded so the
///         bytecode carries no constructor args.
///
///         End state after deploy:
///           - Token       owner = SAFE, minter = AuctionHouse
///           - AuctionHouse owner = SAFE, beneficiary = Treasury, auction #0 live
///           - Treasury     admin = SAFE, nounsToken = Token
contract NounV2Deployer {
    // ─── Hardcoded addresses ────────────────────────────────────────────

    /// @notice Destination of all ownership + admin after deploy.
    address constant SAFE = 0xADa31Add8450CA0422983B9a3103633b78938617;

    // Mainnet Nouns art pipeline (shared with mainnet Nouns).
    address constant NOUNS_DESCRIPTOR_V2 = 0x6229c811D04501523C6058bfAAc29c91bb586268;
    address constant NOUNS_SEEDER = 0xCC8a0FB5ab3C7132c1b2A0109142Fb112c4Ce515;
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant OPENSEA_PROXY_REGISTRY = 0xa5409ec958C83C3f309868babACA7c86DCB077c1;

    // ─── Auction parameters ─────────────────────────────────────────────

    uint256 constant TIME_BUFFER = 300;             // 5 min anti-snipe
    uint256 constant RESERVE_PRICE = 0.001 ether;   // ~$3, keeps 2% minBid meaningful
    uint8 constant MIN_BID_INCREMENT_PCT = 2;       // 2%
    uint256 constant DURATION = 86400;              // 24 hours

    // ─── Event ──────────────────────────────────────────────────────────

    /// @notice Emitted once by the constructor. Use Etherscan event search on
    ///         the deployer's address to recover the 3 contract addresses.
    event Deployed(address indexed token, address indexed auctionHouse, address indexed treasury);

    // ─── Constructor (does all the work) ────────────────────────────────

    constructor() {
        require(block.chainid == 1, "NounV2Deployer: not mainnet");

        // 1. Deploy token. Minter placeholder = this contract, swapped to AH below.
        NounV2Token token = new NounV2Token(
            address(this),
            INounsDescriptorMinimal(NOUNS_DESCRIPTOR_V2),
            INounsSeeder(NOUNS_SEEDER),
            IProxyRegistry(OPENSEA_PROXY_REGISTRY)
        );

        // 2. Deploy treasury with SAFE as admin (permanent).
        NounV2Treasury treasury = new NounV2Treasury(address(token), SAFE);

        // 3. Deploy AH; treasury is the immutable beneficiary.
        NounV2AuctionHouse auctionHouse = new NounV2AuctionHouse(
            INounsToken(address(token)),
            WETH,
            TIME_BUFFER,
            RESERVE_PRICE,
            MIN_BID_INCREMENT_PCT,
            DURATION,
            address(treasury)
        );

        // 4. Hand minter control to AH (this contract still owns the token here).
        token.setMinter(address(auctionHouse));

        // 5. Unpause AH -> mints noun #0 and opens the first 24h auction.
        auctionHouse.unpause();

        // 6. Transfer ownership to SAFE. EOA/deployer holds nothing after this.
        token.transferOwnership(SAFE);
        auctionHouse.transferOwnership(SAFE);

        emit Deployed(address(token), address(auctionHouse), address(treasury));
    }
}
