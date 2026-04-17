// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import 'forge-std/Script.sol';
import { NounsAuctionPricePredictionMarket } from '../contracts/NounsAuctionPricePredictionMarket.sol';

/// @notice Deploy NounsAuctionPricePredictionMarket.
/// @dev Env:
///       DEPLOYER_PRIVATE_KEY - deployer key (becomes owner / fee recipient)
///       AUCTION_HOUSE        - NounsAuctionHouseV2 (proxy) address on target chain
///
/// Known addresses (pass via env or set here when calling subclass):
///   Mainnet:  0x830BD73E4184ceF73443C15111a1DF14e495C706
///   Sepolia:  0xf459b7573a9c2B37eF21F2f7a1a96339E343CdD8
contract DeployAuctionPredictionMarket is Script {
    function run() public returns (NounsAuctionPricePredictionMarket market) {
        uint256 deployerKey = vm.envUint('DEPLOYER_PRIVATE_KEY');
        address auctionHouse = vm.envAddress('AUCTION_HOUSE');

        vm.startBroadcast(deployerKey);
        market = new NounsAuctionPricePredictionMarket(auctionHouse);
        vm.stopBroadcast();

        console.log('NounsAuctionPricePredictionMarket deployed at:', address(market));
        console.log('Owner:', market.owner());
        console.log('Auction house:', address(market.auctionHouse()));
    }
}

contract DeployAuctionPredictionMarketSepolia is Script {
    address constant AUCTION_HOUSE_SEPOLIA = 0xf459b7573a9c2B37eF21F2f7a1a96339E343CdD8;

    function run() public returns (NounsAuctionPricePredictionMarket market) {
        uint256 deployerKey = vm.envUint('DEPLOYER_PRIVATE_KEY');
        vm.startBroadcast(deployerKey);
        market = new NounsAuctionPricePredictionMarket(AUCTION_HOUSE_SEPOLIA);
        vm.stopBroadcast();
        console.log('Sepolia market:', address(market));
    }
}

contract DeployAuctionPredictionMarketMainnet is Script {
    address constant AUCTION_HOUSE_MAINNET = 0x830BD73E4184ceF73443C15111a1DF14e495C706;

    function run() public returns (NounsAuctionPricePredictionMarket market) {
        uint256 deployerKey = vm.envUint('DEPLOYER_PRIVATE_KEY');
        vm.startBroadcast(deployerKey);
        market = new NounsAuctionPricePredictionMarket(AUCTION_HOUSE_MAINNET);
        vm.stopBroadcast();
        console.log('Mainnet market:', address(market));
    }
}
