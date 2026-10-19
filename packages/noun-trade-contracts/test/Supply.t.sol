// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {NounTradeGoods} from "../src/NounTradeGoods.sol";
import {TradeConfig} from "../script/TradeConfig.sol";
import {TradeBase} from "./Base.t.sol";

/// @dev The supply model (SUPPLY.md): halving daily caps, lifetime ceilings the admin
///      can only lower, caps that only go down, ice cream that never leaves the game.
contract SupplyTest is TradeBase {
    function _claimCoin(address who, uint256 amt) internal {
        _claimAs(who, _voucher(who, new uint256[](0), new uint256[](0), amt));
    }

    function _expectRevertClaim(address who, NounTradeGoods.Claim memory c, bytes memory err) internal {
        bytes memory sig = _sign(signerPk, c);
        vm.prank(who);
        vm.expectRevert(err);
        goods.claim(c, sig);
    }

    // ── Ice cream ──

    function test_icecream_neverMints() public {
        _expectRevertClaim(
            alice,
            _voucher(alice, _ids1(TradeConfig.ICECREAM), _amts1(1), 0),
            abi.encodeWithSelector(NounTradeGoods.NotClaimable.selector, TradeConfig.ICECREAM)
        );
        // the admin cannot open it with setCap (caps only go down) ...
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.CapCanOnlyGoDown.selector, TradeConfig.ICECREAM));
        goods.setCap(TradeConfig.ICECREAM, 1, 1);
    }

    // ── Halving ──

    function test_globalCap_halvesEvery180Days_fourTimes() public view {
        uint256 d0 = goods.launchDay();
        uint256 base = TradeConfig.COIN_CAP_GLOBAL;
        assertEq(goods.globalCapOn(0, d0), base);
        assertEq(goods.globalCapOn(0, d0 + 179), base);
        assertEq(goods.globalCapOn(0, d0 + 180), base / 2);
        assertEq(goods.globalCapOn(0, d0 + 360), base / 4);
        assertEq(goods.globalCapOn(0, d0 + 540), base / 8);
        assertEq(goods.globalCapOn(0, d0 + 720), base / 16);
        assertEq(goods.globalCapOn(0, d0 + 10_000), base / 16); // tail: stays
        assertEq(goods.globalCapOn(0, d0 - 1), base); // (a day before launch reads as epoch 0)
    }

    function test_globalCap_enforcedAfterHalving() public {
        vm.warp(block.timestamp + 180 days);
        uint256 todayCap = TradeConfig.COIN_CAP_GLOBAL / 2;
        // fill the day's halved cap with many wallets at the per-address limit
        uint256 per = TradeConfig.COIN_CAP_PER_ADDRESS;
        uint256 n = todayCap / per;
        for (uint256 i; i < n; ++i) {
            _claimCoin(makeAddr(string(abi.encodePacked("w", vm.toString(i)))), per);
        }
        assertEq(coin.totalSupply(), n * per);
        _expectRevertClaim(
            bob,
            _voucher(bob, new uint256[](0), new uint256[](0), 1),
            abi.encodeWithSelector(NounTradeGoods.GlobalCapExceeded.selector, 0)
        );
        (uint256 forBob, uint256 global) = goods.remainingToday(bob, 0);
        assertEq(global, 0);
        assertEq(forBob, 0);
    }

    // ── Lifetime ceiling ──

    function test_maxSupply_isAHardCeiling() public {
        vm.prank(admin);
        goods.lowerMaxSupply(TradeConfig.FISH, 150);
        _claimAs(alice, _voucher(alice, _ids1(TradeConfig.FISH), _amts1(100), 0));
        // burning it back does NOT free headroom: the ceiling counts mints
        vm.prank(alice);
        goods.deposit(_ids1(TradeConfig.FISH), _amts1(100), 0, bytes32(0));
        _claimAs(bob, _voucher(bob, _ids1(TradeConfig.FISH), _amts1(50), 0));
        (, uint256 global) = goods.remainingToday(alice, TradeConfig.FISH);
        assertEq(global, 0);
        vm.warp(block.timestamp + 1 days);
        _expectRevertClaim(
            alice,
            _voucher(alice, _ids1(TradeConfig.FISH), _amts1(1), 0),
            abi.encodeWithSelector(NounTradeGoods.MaxSupplyExceeded.selector, TradeConfig.FISH)
        );
        assertEq(goods.totalMinted(TradeConfig.FISH), 150);
    }

    function test_lowerMaxSupply_neverUpNorBelowMinted() public {
        _claimAs(alice, _voucher(alice, _ids1(TradeConfig.DRIP), _amts1(20), 0));
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.BadMaxSupply.selector, TradeConfig.DRIP));
        goods.lowerMaxSupply(TradeConfig.DRIP, TradeConfig.GOOD_MAX_SUPPLY + 1);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.BadMaxSupply.selector, TradeConfig.DRIP));
        goods.lowerMaxSupply(TradeConfig.DRIP, 19);
        goods.lowerMaxSupply(TradeConfig.DRIP, 20);
        vm.stopPrank();
        assertEq(goods.maxSupply(TradeConfig.DRIP), 20);
    }

    // ── Caps only go down ──

    function test_setCap_onlyLowers() public {
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.CapCanOnlyGoDown.selector, 0));
        goods.setCap(0, TradeConfig.COIN_CAP_PER_ADDRESS + 1, TradeConfig.COIN_CAP_GLOBAL);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.CapCanOnlyGoDown.selector, 0));
        goods.setCap(0, TradeConfig.COIN_CAP_PER_ADDRESS, TradeConfig.COIN_CAP_GLOBAL + 1);
        goods.setCap(0, 10, 100);
        vm.stopPrank();
        (uint128 pa, uint128 gl) = goods.caps(0);
        assertEq(pa, 10);
        assertEq(gl, 100);
    }

    // ── New goods ──

    function test_launchGood_onceOnly_andNeverCoinOrALaunchedId() public {
        vm.startPrank(admin);
        goods.launchGood(9, 50, 500, 10_000);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.AlreadyLaunched.selector, 9));
        goods.launchGood(9, 50, 500, 10_000);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.AlreadyLaunched.selector, TradeConfig.FRIES));
        goods.launchGood(TradeConfig.FRIES, 1, 1, 1);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.BadId.selector, 0));
        goods.launchGood(0, 1, 1, 1);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.BadMaxSupply.selector, 10));
        goods.launchGood(10, 1, 1, 0);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert();
        goods.launchGood(11, 1, 1, 1);
    }

    // ── Fuzz: nothing ever mints past a ceiling ──

    function testFuzz_mintsNeverPassCeiling(uint256 ceiling, uint256 a, uint256 b) public {
        ceiling = bound(ceiling, 1, TradeConfig.GOOD_CAP_PER_ADDRESS);
        a = bound(a, 1, TradeConfig.GOOD_CAP_PER_ADDRESS);
        b = bound(b, 1, TradeConfig.GOOD_CAP_PER_ADDRESS);
        vm.prank(admin);
        goods.lowerMaxSupply(TradeConfig.PIZZA, ceiling);
        NounTradeGoods.Claim memory ca = _voucher(alice, _ids1(TradeConfig.PIZZA), _amts1(a), 0);
        bytes memory sa = _sign(signerPk, ca);
        vm.prank(alice);
        try goods.claim(ca, sa) {} catch {}
        NounTradeGoods.Claim memory cb = _voucher(bob, _ids1(TradeConfig.PIZZA), _amts1(b), 0);
        bytes memory sb = _sign(signerPk, cb);
        vm.prank(bob);
        try goods.claim(cb, sb) {} catch {}
        assertLe(goods.totalSupply(TradeConfig.PIZZA), ceiling);
        assertEq(goods.totalMinted(TradeConfig.PIZZA), goods.totalSupply(TradeConfig.PIZZA));
    }
}
