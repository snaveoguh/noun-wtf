// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import 'forge-std/Script.sol';
import { SmallGrantsTreasury } from '../contracts/governance/SmallGrantsTreasury.sol';

contract DeploySmallGrants is Script {
    // Mainnet NounsToken
    address constant NOUNS_TOKEN = 0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03;

    function run() external {
        address deployer = msg.sender;

        vm.startBroadcast();

        SmallGrantsTreasury treasury = new SmallGrantsTreasury(NOUNS_TOKEN, deployer);

        vm.stopBroadcast();

        console.log("SmallGrantsTreasury deployed at:", address(treasury));
        console.log("Admin:", deployer);
        console.log("NounsToken:", NOUNS_TOKEN);
    }
}
