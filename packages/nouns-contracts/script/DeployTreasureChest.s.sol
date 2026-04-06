// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../contracts/TreasureChest.sol";

/**
 * Deploy TreasureChest as UUPS proxy on Ethereum mainnet.
 *
 * Usage:
 *   export WALLET_PRIVATE_KEY=0x...
 *   export OPERATOR_ADDRESS=0x...  # nounirl.eth
 *   cd packages/nouns-contracts
 *   forge script script/DeployTreasureChest.s.sol \
 *     --rpc-url https://ethereum-rpc.publicnode.com \
 *     --broadcast \
 *     --verify \
 *     --etherscan-api-key $ETHERSCAN_API_KEY
 */
contract DeployTreasureChest is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("WALLET_PRIVATE_KEY");
        address operator = vm.envAddress("OPERATOR_ADDRESS");

        vm.startBroadcast(deployerKey);

        // 1. Deploy implementation
        TreasureChest impl = new TreasureChest();

        // 2. Deploy proxy + initialize
        bytes memory initData = abi.encodeWithSelector(
            TreasureChest.initialize.selector,
            operator
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);

        vm.stopBroadcast();

        console.log("Implementation:", address(impl));
        console.log("Proxy:", address(proxy));
        console.log("Operator:", operator);
    }
}
