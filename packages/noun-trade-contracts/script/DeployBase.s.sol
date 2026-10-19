// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {NounTradeGoods} from "../src/NounTradeGoods.sol";
import {Deploy} from "./Deploy.s.sol";
import {TradeConfig} from "./TradeConfig.sol";

/// @notice Base MAINNET (8453) deploy of NounTradeGoods + NounTradeCoin with the launch
///         supply (SUPPLY.md). Run by the owner with their own wallet; see DEPLOY.md.
///
/// Env (no key is read from env here: sign with --ledger, --trezor or --account <keystore>):
///   OWNER_ADDRESS    DEFAULT_ADMIN_ROLE. Must be a contract (a Safe multisig) unless
///                    ALLOW_EOA_OWNER=true. Hand-over later is two-step with a 2-day delay.
///   SIGNER_ADDRESS   SIGNER_ROLE: the ADDRESS of the server's TRADE_SIGNER_KEY (never the owner)
///   PAUSER_ADDRESS   optional PAUSER_ROLE (defaults to OWNER_ADDRESS)
///
///   forge script script/DeployBase.s.sol:DeployBase --rpc-url base --ledger --sender <you> \
///     --broadcast --verify
contract DeployBase is Deploy {
    function run() external override returns (NounTradeGoods goods) {
        require(block.chainid == BASE, "DeployBase: Base mainnet (8453) only; Deploy.s.sol does Sepolia / anvil");

        address owner = vm.envAddress("OWNER_ADDRESS");
        address signer = vm.envAddress("SIGNER_ADDRESS");
        address pauser = vm.envOr("PAUSER_ADDRESS", owner);
        require(owner != address(0) && signer != address(0), "DeployBase: OWNER_ADDRESS / SIGNER_ADDRESS unset");
        require(signer != owner && signer != pauser, "DeployBase: the server signer must hold no other role");
        require(
            owner.code.length > 0 || vm.envOr("ALLOW_EOA_OWNER", false),
            "DeployBase: OWNER_ADDRESS should be a Safe (set ALLOW_EOA_OWNER=true to use a plain wallet)"
        );

        (uint256[] memory keys, uint128[] memory perAddress, uint128[] memory global, uint256[] memory maxSupply) =
            TradeConfig.caps();

        vm.startBroadcast();
        goods = new NounTradeGoods(
            owner,
            TradeConfig.ADMIN_DELAY,
            signer,
            pauser,
            TradeConfig.BASE_URI,
            TradeConfig.CONTRACT_URI,
            keys,
            perAddress,
            global,
            maxSupply
        );
        vm.stopBroadcast();

        _record(goods, owner, signer, pauser);
    }
}
