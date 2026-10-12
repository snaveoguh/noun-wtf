// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import 'forge-std/Script.sol';
import { NounWorldDrops } from '../../contracts/world/NounWorldDrops.sol';

/**
 * Deploy NounWorldDrops (not upgradeable, no proxy).
 *
 * Env:
 *   DEPLOYER_PRIVATE_KEY  key that pays for the deploy (any funded key)
 *   DROPS_OWNER           owner: rotates the signer, pauses (e.g. a Safe)
 *   DROPS_SIGNER          address of the game server's voucher key
 *                         (the address of WORLD_DROPS_SIGNER_KEY)
 *
 * Dry run (no broadcast):
 *   forge script script/world/DeployNounWorldDrops.s.sol --rpc-url $RPC_URL
 * Deploy + verify:
 *   forge script script/world/DeployNounWorldDrops.s.sol --rpc-url $RPC_URL \
 *     --broadcast --verify --etherscan-api-key $ETHERSCAN_API_KEY
 *
 * See contracts/world/README.md.
 */
contract DeployNounWorldDrops is Script {
    function run() external returns (NounWorldDrops drops) {
        uint256 deployerKey = vm.envUint('DEPLOYER_PRIVATE_KEY');
        address owner = vm.envAddress('DROPS_OWNER');
        address signer = vm.envAddress('DROPS_SIGNER');
        require(owner != address(0), 'DROPS_OWNER unset');
        require(signer != address(0), 'DROPS_SIGNER unset');

        vm.startBroadcast(deployerKey);
        drops = new NounWorldDrops(owner, signer);
        vm.stopBroadcast();

        console.log('NounWorldDrops:', address(drops));
        console.log('Owner:', owner);
        console.log('Signer:', signer);
        console.log('Chain id:', block.chainid);
    }
}
