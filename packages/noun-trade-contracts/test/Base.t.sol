// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {NounTradeGoods} from "../src/NounTradeGoods.sol";
import {NounTradeCoin} from "../src/NounTradeCoin.sol";
import {TradeConfig} from "../script/TradeConfig.sol";

/// @dev Shared fixture: a deployed pair with the launch caps and throwaway keys.
abstract contract TradeBase is Test {
    NounTradeGoods internal goods;
    NounTradeCoin internal coin;

    address internal admin = makeAddr("admin");
    address internal pauser = makeAddr("pauser");
    uint256 internal signerPk;
    address internal signer;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal nextNonce = 1;

    function setUp() public virtual {
        (signer, signerPk) = makeAddrAndKey("signer");
        (uint256[] memory keys, uint128[] memory perAddress, uint128[] memory global, uint256[] memory maxSupply) =
            TradeConfig.caps();
        vm.warp(1_800_000_000);
        goods = new NounTradeGoods(
            admin,
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
        coin = goods.coin();
    }

    function _ids1(uint256 id) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = id;
    }

    function _amts1(uint256 x) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = x;
    }

    function _voucher(address player, uint256[] memory ids, uint256[] memory amounts, uint256 coinAmt)
        internal
        returns (NounTradeGoods.Claim memory c)
    {
        c = NounTradeGoods.Claim({
            player: player,
            ids: ids,
            amounts: amounts,
            coin: coinAmt,
            nonce: nextNonce++,
            expiry: block.timestamp + 30 minutes
        });
    }

    /// @dev EIP-712 digest built independently of the contract (checks hashClaim too).
    function _digest(NounTradeGoods.Claim memory c) internal view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("NounTradeGoods"),
                keccak256("1"),
                block.chainid,
                address(goods)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Claim(address player,uint256[] ids,uint256[] amounts,uint256 coin,uint256 nonce,uint256 expiry)"
                ),
                c.player,
                keccak256(abi.encodePacked(c.ids)),
                keccak256(abi.encodePacked(c.amounts)),
                c.coin,
                c.nonce,
                c.expiry
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _sign(uint256 pk, NounTradeGoods.Claim memory c) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(c));
        return abi.encodePacked(r, s, v);
    }

    function _claimAs(address who, NounTradeGoods.Claim memory c) internal {
        bytes memory sig = _sign(signerPk, c);
        vm.prank(who);
        goods.claim(c, sig);
    }
}
