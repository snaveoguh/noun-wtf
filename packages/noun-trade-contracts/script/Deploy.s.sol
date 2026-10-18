// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

import {NounTradeGoods} from "../src/NounTradeGoods.sol";
import {TradeConfig} from "./TradeConfig.sol";

/// @notice Deploys NounTradeGoods (which deploys NounTradeCoin) with the launch caps.
///
/// Env (nothing is hard-coded, no key is ever generated here):
///   PRIVATE_KEY      deployer key (pays gas only; gets NO role). Optional: omit it and
///                    pass `--account <keystore> --sender <addr>` to use a Foundry keystore.
///   ADMIN_ADDRESS    DEFAULT_ADMIN_ROLE (a Safe on mainnet)
///   SIGNER_ADDRESS   SIGNER_ROLE: the address of the server's TRADE_SIGNER_KEY
///   PAUSER_ADDRESS   optional, PAUSER_ROLE (defaults to ADMIN_ADDRESS)
///   TOKEN_BASE_URI   optional, defaults to https://noun.wtf/trade-tokens/
///   CONFIRM_MAINNET  must be "yes" to deploy on Base mainnet (8453)
///
///   forge script script/Deploy.s.sol:Deploy --rpc-url $BASE_SEPOLIA_RPC --broadcast --verify
contract Deploy is Script {
    uint256 internal constant BASE = 8453;
    uint256 internal constant BASE_SEPOLIA = 84532;
    uint256 internal constant ANVIL = 31337;

    function run() external returns (NounTradeGoods goods) {
        uint256 chainId = block.chainid;
        require(
            chainId == BASE || chainId == BASE_SEPOLIA || chainId == ANVIL, "Deploy: Base, Base Sepolia or anvil only"
        );
        if (chainId == BASE) {
            require(
                keccak256(bytes(vm.envOr("CONFIRM_MAINNET", string("")))) == keccak256("yes"),
                "Deploy: set CONFIRM_MAINNET=yes to deploy on Base mainnet"
            );
        }

        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        address admin = vm.envAddress("ADMIN_ADDRESS");
        address signer = vm.envAddress("SIGNER_ADDRESS");
        address pauser = vm.envOr("PAUSER_ADDRESS", admin);
        string memory baseURI = vm.envOr("TOKEN_BASE_URI", string(TradeConfig.BASE_URI));
        require(admin != address(0) && signer != address(0), "Deploy: ADMIN_ADDRESS / SIGNER_ADDRESS unset");
        require(signer != admin, "Deploy: the server signer must not be the admin");

        (uint256[] memory keys, uint128[] memory perAddress, uint128[] memory global) = TradeConfig.caps();

        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast(); // --account <keystore> --sender <addr>
        goods = new NounTradeGoods(
            admin,
            chainId == ANVIL ? 0 : TradeConfig.ADMIN_DELAY,
            signer,
            pauser,
            baseURI,
            TradeConfig.CONTRACT_URI,
            keys,
            perAddress,
            global
        );
        vm.stopBroadcast();

        _record(goods, admin, signer, pauser);
    }

    function _record(NounTradeGoods goods, address admin, address signer, address pauser) internal {
        address coinAddr = address(goods.coin());
        console2.log("chainId                ", block.chainid);
        console2.log("NounTradeGoods         ", address(goods));
        console2.log("NounTradeCoin (NTCOIN) ", coinAddr);
        console2.log("admin                  ", admin);
        console2.log("signer                 ", signer);
        console2.log("pauser                 ", pauser);

        // Only a real broadcast records addresses (a dry run would write simulated ones).
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) && !vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            return;
        }
        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "block", block.number);
        vm.serializeAddress(obj, "admin", admin);
        vm.serializeAddress(obj, "signer", signer);
        vm.serializeAddress(obj, "pauser", pauser);
        vm.serializeAddress(obj, "coin", coinAddr);
        string memory json = vm.serializeAddress(obj, "goods", address(goods));
        vm.writeJson(json, string.concat("./deployments/", vm.toString(block.chainid), ".json"));
    }
}
