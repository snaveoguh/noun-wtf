// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {NounTradeGoods} from "../src/NounTradeGoods.sol";
import {NounTradeCoin} from "../src/NounTradeCoin.sol";
import {TradeConfig} from "../script/TradeConfig.sol";
import {TradeBase} from "./Base.t.sol";

/// @dev Drives the contracts with valid claims, burns and transfers, plus a stream of
///      attacks (forged signers, replays, front-runs, expired vouchers, over-cap claims,
///      direct coin mints). Ghost totals count only what valid vouchers minted and
///      deposits burned.
contract Handler is Test {
    NounTradeGoods internal goods;
    NounTradeCoin internal coin;
    uint256 internal signerPk;
    uint256 internal forgerPk = 0xBADBAD;

    address[] public actors;
    uint256 internal nonce = 1_000_000;

    mapping(uint256 => uint256) public ghostMinted;
    mapping(uint256 => uint256) public ghostBurned;
    uint256 public ghostCoinMinted;
    uint256 public ghostCoinBurned;
    uint256 public okClaims;
    uint256 public okDeposits;

    NounTradeGoods.Claim[] internal spent;
    bytes[] internal spentSigs;

    constructor(NounTradeGoods g, uint256 pk) {
        goods = g;
        coin = g.coin();
        signerPk = pk;
        for (uint256 i; i < 4; ++i) actors.push(makeAddr(string.concat("actor", vm.toString(i))));
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function _digest(NounTradeGoods.Claim memory c) internal view returns (bytes32) {
        return goods.claimDigest(c);
    }

    function _sign(uint256 pk, NounTradeGoods.Claim memory c) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(c));
        return abi.encodePacked(r, s, v);
    }

    function _mk(address who, uint256 idSeed, uint256 amt, uint256 coinAmt)
        internal
        returns (NounTradeGoods.Claim memory c)
    {
        uint256[] memory ids = new uint256[](1);
        uint256[] memory amts = new uint256[](1);
        ids[0] = bound(idSeed, 1, TradeConfig.GOOD_COUNT);
        amts[0] = amt;
        c = NounTradeGoods.Claim(who, ids, amts, coinAmt, nonce++, block.timestamp + 1 hours);
    }

    // ── Valid flows ──

    function claim(uint256 actorSeed, uint256 idSeed, uint256 amt, uint256 coinAmt) external {
        address who = actors[actorSeed % actors.length];
        amt = bound(amt, 1, 200);
        coinAmt = bound(coinAmt, 0, 20_000);
        NounTradeGoods.Claim memory c = _mk(who, idSeed, amt, coinAmt);
        bytes memory sig = _sign(signerPk, c);
        vm.prank(who);
        try goods.claim(c, sig) {
            ghostMinted[c.ids[0]] += amt;
            ghostCoinMinted += coinAmt;
            spent.push(c);
            spentSigs.push(sig);
            ++okClaims;
        } catch {} // caps can legitimately refuse
    }

    function deposit(uint256 actorSeed, uint256 idSeed, uint256 amt, uint256 coinAmt) external {
        uint256 id = bound(idSeed, 1, TradeConfig.GOOD_COUNT);
        // start at a random actor and take the first one holding something
        address who;
        uint256 bal;
        uint256 cbal;
        for (uint256 k; k < actors.length; ++k) {
            who = actors[(actorSeed % actors.length + k) % actors.length];
            bal = goods.balanceOf(who, id);
            cbal = coin.balanceOf(who);
            if (bal > 0 || cbal > 0) break;
        }
        if (bal == 0 && cbal == 0) return;
        uint256[] memory ids = new uint256[](bal == 0 ? 0 : 1);
        uint256[] memory amts = new uint256[](bal == 0 ? 0 : 1);
        if (bal > 0) {
            ids[0] = id;
            amts[0] = bound(amt, 1, bal);
        }
        coinAmt = bound(coinAmt, 0, cbal);
        if (bal == 0 && coinAmt == 0) return;
        vm.prank(who);
        goods.deposit(ids, amts, coinAmt, keccak256(abi.encode(who)));
        if (bal > 0) ghostBurned[id] += amts[0];
        ghostCoinBurned += coinAmt;
        ++okDeposits;
    }

    function transfer(uint256 fromSeed, uint256 toSeed, uint256 idSeed, uint256 amt) external {
        address from = actors[fromSeed % actors.length];
        address to = actors[toSeed % actors.length];
        uint256 id = bound(idSeed, 1, TradeConfig.GOOD_COUNT);
        uint256 bal = goods.balanceOf(from, id);
        if (bal > 0) {
            vm.prank(from);
            goods.safeTransferFrom(from, to, id, bound(amt, 1, bal), "");
        }
        uint256 cbal = coin.balanceOf(from);
        if (cbal > 0) {
            vm.prank(from);
            coin.transfer(to, bound(amt, 1, cbal));
        }
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
    }

    // ── Attacks: none of these may ever change supply ──

    function forgedClaim(uint256 actorSeed, uint256 idSeed, uint256 amt) external {
        address who = actors[actorSeed % actors.length];
        NounTradeGoods.Claim memory c = _mk(who, idSeed, bound(amt, 1, 200), 50);
        bytes memory sig = _sign(forgerPk, c);
        vm.prank(who);
        try goods.claim(c, sig) {
            revert("forged voucher minted");
        } catch {}
    }

    function replay(uint256 idx) external {
        if (spent.length == 0) return;
        idx = idx % spent.length;
        NounTradeGoods.Claim memory c = spent[idx];
        vm.prank(c.player);
        try goods.claim(c, spentSigs[idx]) {
            revert("replay minted");
        } catch {}
    }

    function frontRun(uint256 actorSeed, uint256 thiefSeed, uint256 idSeed) external {
        address who = actors[actorSeed % actors.length];
        address thief = actors[thiefSeed % actors.length];
        if (thief == who) return;
        NounTradeGoods.Claim memory c = _mk(who, idSeed, 1, 1);
        bytes memory sig = _sign(signerPk, c);
        vm.prank(thief);
        try goods.claim(c, sig) {
            revert("front-run minted");
        } catch {}
    }

    function expiredClaim(uint256 actorSeed, uint256 idSeed) external {
        address who = actors[actorSeed % actors.length];
        NounTradeGoods.Claim memory c = _mk(who, idSeed, 1, 1);
        c.expiry = block.timestamp - 1;
        bytes memory sig = _sign(signerPk, c);
        vm.prank(who);
        try goods.claim(c, sig) {
            revert("expired minted");
        } catch {}
    }

    function directCoinMint(uint256 actorSeed, uint256 amt) external {
        address who = actors[actorSeed % actors.length];
        vm.prank(who);
        try coin.mint(who, amt) {
            revert("coin minted outside a voucher");
        } catch {}
    }
}

contract NounTradeInvariantTest is TradeBase {
    Handler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new Handler(goods, signerPk);
        targetContract(address(handler));
    }

    /// Supply of every good only ever equals valid-voucher mints minus deposit burns.
    function invariant_goodsSupplyOnlyFromVouchersAndBurns() public view {
        for (uint256 id = 0; id <= TradeConfig.GOOD_COUNT + 1; ++id) {
            assertEq(goods.totalSupply(id), handler.ghostMinted(id) - handler.ghostBurned(id));
        }
    }

    function invariant_coinSupplyOnlyFromVouchersAndBurns() public view {
        assertEq(coin.totalSupply(), handler.ghostCoinMinted() - handler.ghostCoinBurned());
    }

    /// The handler's valid paths really mint and burn (so the invariants are not vacuous;
    /// forge's per-selector call table shows how often each ran in the campaign).
    function test_handlerPathsWork() public {
        handler.claim(0, 1, 5, 100);
        handler.deposit(0, 1, 2, 50);
        assertEq(handler.okClaims(), 1);
        assertEq(handler.okDeposits(), 1);
        assertEq(goods.totalSupply(1), 3);
        assertEq(coin.totalSupply(), 50);
    }

    function invariant_balancesSumToSupply() public view {
        uint256 n = handler.actorCount();
        for (uint256 id = 1; id <= TradeConfig.GOOD_COUNT; ++id) {
            uint256 sum;
            for (uint256 i; i < n; ++i) sum += goods.balanceOf(handler.actors(i), id);
            assertEq(sum, goods.totalSupply(id));
        }
        uint256 csum;
        for (uint256 i; i < n; ++i) csum += coin.balanceOf(handler.actors(i));
        assertEq(csum, coin.totalSupply());
    }
}
