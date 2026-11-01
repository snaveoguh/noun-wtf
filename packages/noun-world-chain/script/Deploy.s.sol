// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {NounWorldLedger} from "../src/NounWorldLedger.sol";

/// @notice Deploys NounWorldLedger to Base Sepolia (84532), Base (8453) or anvil (31337) and
///         writes deployments/<chainId>.json. Never reads a private key: sign with
///         --ledger, --trezor or --account <keystore>, and pass --sender <that address>.
///
/// Env:
///   OWNER_ADDRESS      rotates the committer, hands ownership over. Use a Safe on mainnet:
///                      on 8453 a plain wallet needs ALLOW_EOA_OWNER=true.
///   COMMITTER_ADDRESS  the ADDRESS of the snapshot job's LEDGER_COMMITTER_KEY. Holds a little
///                      ETH for gas and nothing else; must not be the owner.
///
///   forge script script/Deploy.s.sol:Deploy --rpc-url base_sepolia --account deployer \
///     --sender <deployer> --broadcast --verify
contract Deploy is Script {
    uint256 constant BASE = 8453;
    uint256 constant BASE_SEPOLIA = 84532;
    uint256 constant ANVIL = 31337;

    function run() external returns (NounWorldLedger ledger) {
        uint256 id = block.chainid;
        require(id == BASE || id == BASE_SEPOLIA || id == ANVIL, "Deploy: Base, Base Sepolia or anvil only");

        address owner = vm.envAddress("OWNER_ADDRESS");
        address committer = vm.envAddress("COMMITTER_ADDRESS");
        require(owner != address(0) && committer != address(0), "Deploy: OWNER_ADDRESS / COMMITTER_ADDRESS unset");
        require(owner != committer, "Deploy: the committer hot key must not be the owner");
        if (id == BASE) {
            require(
                owner.code.length > 0 || vm.envOr("ALLOW_EOA_OWNER", false),
                "Deploy: OWNER_ADDRESS should be a Safe on mainnet (ALLOW_EOA_OWNER=true to override)"
            );
        }

        vm.startBroadcast();
        ledger = new NounWorldLedger(owner, committer);
        vm.stopBroadcast();

        console2.log("NounWorldLedger", address(ledger));
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", id);
        vm.serializeUint(k, "block", block.number);
        vm.serializeAddress(k, "owner", owner);
        vm.serializeAddress(k, "committer", committer);
        string memory out = vm.serializeAddress(k, "ledger", address(ledger));
        vm.writeJson(out, string.concat("deployments/", vm.toString(id), ".json"));
    }
}
