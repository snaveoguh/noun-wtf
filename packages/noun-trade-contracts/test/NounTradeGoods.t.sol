// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IAccessControlDefaultAdminRules} from
    "@openzeppelin/contracts/access/extensions/IAccessControlDefaultAdminRules.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC1155Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {NounTradeGoods} from "../src/NounTradeGoods.sol";
import {NounTradeCoin} from "../src/NounTradeCoin.sol";
import {TradeConfig} from "../script/TradeConfig.sol";
import {TradeBase} from "./Base.t.sol";

contract NounTradeGoodsTest is TradeBase {
    event Claimed(
        address indexed player,
        uint256 indexed nonce,
        address indexed signer,
        uint256[] ids,
        uint256[] amounts,
        uint256 coin
    );
    event Deposited(
        address indexed player,
        bytes32 indexed account,
        uint256 indexed depositId,
        uint256[] ids,
        uint256[] amounts,
        uint256 coin
    );

    // ── Deployment ──

    function test_deploy_state() public view {
        assertEq(coin.name(), "Noun Trade Coin");
        assertEq(coin.symbol(), "NTCOIN");
        assertEq(coin.decimals(), 0);
        assertEq(coin.game(), address(goods));
        assertEq(goods.name(), "Noun Trade Goods");
        assertEq(goods.symbol(), "NTGOODS");
        assertTrue(goods.hasRole(goods.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(goods.hasRole(goods.SIGNER_ROLE(), signer));
        assertTrue(goods.hasRole(goods.PAUSER_ROLE(), pauser));
        assertEq(goods.uri(1), "https://noun.wtf/trade-tokens/1.json");
        assertEq(goods.contractURI(), "https://noun.wtf/trade-tokens/collection.json");
        (uint128 pa, uint128 gl) = goods.caps(TradeConfig.ICECREAM);
        assertEq(pa, TradeConfig.GOOD_CAP_PER_ADDRESS);
        assertEq(gl, TradeConfig.GOOD_CAP_GLOBAL);
        (pa, gl) = goods.caps(TradeConfig.COIN_KEY);
        assertEq(pa, TradeConfig.COIN_CAP_PER_ADDRESS);
        (pa, gl) = goods.caps(8);
        assertEq(gl, 0); // id 8 not claimable until the admin caps it
    }

    function test_digest_matchesContract() public {
        NounTradeGoods.Claim memory c = _voucher(alice, _ids1(1), _amts1(3), 10);
        assertEq(goods.claimDigest(c), _digest(c));
    }

    // ── Claim: happy path ──

    function test_claim_happyPath() public {
        uint256[] memory ids = new uint256[](3);
        uint256[] memory amts = new uint256[](3);
        (ids[0], ids[1], ids[2]) = (TradeConfig.ICECREAM, TradeConfig.FISH, TradeConfig.WATER);
        (amts[0], amts[1], amts[2]) = (5, 2, 40);
        NounTradeGoods.Claim memory c = _voucher(alice, ids, amts, 1234);
        bytes memory sig = _sign(signerPk, c);

        vm.expectEmit(address(goods));
        emit Claimed(alice, c.nonce, signer, ids, amts, 1234);
        vm.prank(alice);
        goods.claim(c, sig);

        assertEq(goods.balanceOf(alice, 1), 5);
        assertEq(goods.balanceOf(alice, 3), 2);
        assertEq(goods.balanceOf(alice, 7), 40);
        assertEq(goods.totalSupply(1), 5);
        assertEq(coin.balanceOf(alice), 1234);
        assertEq(coin.totalSupply(), 1234);
        assertEq(uint8(goods.nonceState(c.nonce)), uint8(NounTradeGoods.NonceState.Claimed));
        (uint256 left,) = goods.remainingToday(alice, 1);
        assertEq(left, TradeConfig.GOOD_CAP_PER_ADDRESS - 5);
    }

    function test_claim_coinOnly() public {
        _claimAs(alice, _voucher(alice, new uint256[](0), new uint256[](0), 77));
        assertEq(coin.balanceOf(alice), 77);
    }

    function test_claim_goodsOnly() public {
        _claimAs(alice, _voucher(alice, _ids1(2), _amts1(9), 0));
        assertEq(goods.balanceOf(alice, 2), 9);
        assertEq(coin.totalSupply(), 0);
    }

    // ── Claim: refusals ──

    function test_revert_badSigner() public {
        (address mallory, uint256 malloryPk) = makeAddrAndKey("mallory");
        NounTradeGoods.Claim memory c = _voucher(alice, _ids1(1), _amts1(1), 0);
        bytes memory sig = _sign(malloryPk, c);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.BadSigner.selector, mallory));
        goods.claim(c, sig);
    }

    function test_revert_tamperedVoucher() public {
        NounTradeGoods.Claim memory c = _voucher(alice, _ids1(1), _amts1(1), 0);
        bytes memory sig = _sign(signerPk, c);
        c.amounts[0] = 400; // player edits the amount after signing
        vm.prank(alice);
        vm.expectPartialRevert(NounTradeGoods.BadSigner.selector);
        goods.claim(c, sig);
    }

    function test_revert_garbageSignature() public {
        NounTradeGoods.Claim memory c = _voucher(alice, _ids1(1), _amts1(1), 0);
        vm.prank(alice);
        vm.expectRevert();
        goods.claim(c, hex"1234");
    }

    function test_revert_replay() public {
        NounTradeGoods.Claim memory c = _voucher(alice, _ids1(1), _amts1(1), 5);
        bytes memory sig = _sign(signerPk, c);
        vm.prank(alice);
        goods.claim(c, sig);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.NonceNotUnused.selector, c.nonce));
        goods.claim(c, sig);
    }

    function test_revert_sameNonceDifferentVoucher() public {
        NounTradeGoods.Claim memory c = _voucher(alice, _ids1(1), _amts1(1), 0);
        _claimAs(alice, c);
        NounTradeGoods.Claim memory c2 = _voucher(alice, _ids1(2), _amts1(1), 0);
        c2.nonce = c.nonce; // server bug: reuses a nonce
        bytes memory sig = _sign(signerPk, c2);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.NonceNotUnused.selector, c.nonce));
        goods.claim(c2, sig);
    }

    function test_revert_notPlayer() public {
        NounTradeGoods.Claim memory c = _voucher(alice, _ids1(1), _amts1(1), 0);
        bytes memory sig = _sign(signerPk, c);
        vm.prank(bob); // front-runner who saw the voucher in the mempool
        vm.expectRevert(NounTradeGoods.NotPlayer.selector);
        goods.claim(c, sig);
    }

    function test_revert_expired() public {
        NounTradeGoods.Claim memory c = _voucher(alice, _ids1(1), _amts1(1), 0);
        bytes memory sig = _sign(signerPk, c);
        vm.warp(c.expiry + 1);
        vm.prank(alice);
        vm.expectRevert(NounTradeGoods.VoucherExpired.selector);
        goods.claim(c, sig);
    }

    function test_claim_atExpiryOk() public {
        NounTradeGoods.Claim memory c = _voucher(alice, _ids1(1), _amts1(1), 0);
        bytes memory sig = _sign(signerPk, c);
        vm.warp(c.expiry);
        vm.prank(alice);
        goods.claim(c, sig);
        assertEq(goods.balanceOf(alice, 1), 1);
    }

    function test_revert_expiryTooFar() public {
        NounTradeGoods.Claim memory c = _voucher(alice, _ids1(1), _amts1(1), 0);
        c.expiry = block.timestamp + goods.MAX_VOUCHER_TTL() + 1;
        bytes memory sig = _sign(signerPk, c);
        vm.prank(alice);
        vm.expectRevert(NounTradeGoods.ExpiryTooFar.selector);
        goods.claim(c, sig);
    }

    function test_revert_shapes() public {
        // length mismatch
        NounTradeGoods.Claim memory c = _voucher(alice, _ids1(1), new uint256[](2), 0);
        bytes memory sig = _sign(signerPk, c);
        vm.prank(alice);
        vm.expectRevert(NounTradeGoods.LengthMismatch.selector);
        goods.claim(c, sig);
        // empty
        c = _voucher(alice, new uint256[](0), new uint256[](0), 0);
        sig = _sign(signerPk, c);
        vm.prank(alice);
        vm.expectRevert(NounTradeGoods.EmptyBatch.selector);
        goods.claim(c, sig);
        // too big
        c = _voucher(alice, new uint256[](17), new uint256[](17), 0);
        sig = _sign(signerPk, c);
        vm.prank(alice);
        vm.expectRevert(NounTradeGoods.BatchTooBig.selector);
        goods.claim(c, sig);
        // zero amount
        c = _voucher(alice, _ids1(1), _amts1(0), 0);
        sig = _sign(signerPk, c);
        vm.prank(alice);
        vm.expectRevert(NounTradeGoods.ZeroAmount.selector);
        goods.claim(c, sig);
        // id 0 is the coin key, never a token
        c = _voucher(alice, _ids1(0), _amts1(1), 0);
        sig = _sign(signerPk, c);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.BadId.selector, 0));
        goods.claim(c, sig);
        // uncapped id (not launched yet)
        c = _voucher(alice, _ids1(8), _amts1(1), 0);
        sig = _sign(signerPk, c);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.NotClaimable.selector, 8));
        goods.claim(c, sig);
    }

    // ── Caps ──

    function test_cap_perAddress() public {
        _claimAs(alice, _voucher(alice, _ids1(1), _amts1(TradeConfig.GOOD_CAP_PER_ADDRESS), 0));
        NounTradeGoods.Claim memory c = _voucher(alice, _ids1(1), _amts1(1), 0);
        bytes memory sig = _sign(signerPk, c);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.AddressCapExceeded.selector, 1));
        goods.claim(c, sig);
        // other ids and other players are unaffected
        _claimAs(alice, _voucher(alice, _ids1(2), _amts1(1), 0));
        _claimAs(bob, _voucher(bob, _ids1(1), _amts1(1), 0));
        // and it resets at the next UTC day
        vm.warp(block.timestamp + 1 days);
        _claimAs(alice, _voucher(alice, _ids1(1), _amts1(1), 0));
        assertEq(goods.balanceOf(alice, 1), TradeConfig.GOOD_CAP_PER_ADDRESS + 1);
    }

    function test_cap_duplicateIdsInOneVoucherCount() public {
        uint256[] memory ids = new uint256[](2);
        uint256[] memory amts = new uint256[](2);
        (ids[0], ids[1]) = (1, 1);
        (amts[0], amts[1]) = (TradeConfig.GOOD_CAP_PER_ADDRESS, 1);
        NounTradeGoods.Claim memory c = _voucher(alice, ids, amts, 0);
        bytes memory sig = _sign(signerPk, c);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.AddressCapExceeded.selector, 1));
        goods.claim(c, sig);
    }

    function test_cap_coinPerAddress() public {
        NounTradeGoods.Claim memory c =
            _voucher(alice, new uint256[](0), new uint256[](0), TradeConfig.COIN_CAP_PER_ADDRESS + 1);
        bytes memory sig = _sign(signerPk, c);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.AddressCapExceeded.selector, 0));
        goods.claim(c, sig);
    }

    function test_cap_global() public {
        vm.prank(admin);
        goods.setCap(3, 10, 15);
        _claimAs(alice, _voucher(alice, _ids1(3), _amts1(10), 0));
        NounTradeGoods.Claim memory c = _voucher(bob, _ids1(3), _amts1(6), 0);
        bytes memory sig = _sign(signerPk, c);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.GlobalCapExceeded.selector, 3));
        goods.claim(c, sig);
        _claimAs(bob, _voucher(bob, _ids1(3), _amts1(5), 0));
        assertEq(goods.totalSupply(3), 15);
    }

    function test_cap_adminCanLaunchNewGood() public {
        vm.prank(admin);
        goods.setCap(8, 100, 1000);
        _claimAs(alice, _voucher(alice, _ids1(8), _amts1(3), 0));
        assertEq(goods.balanceOf(alice, 8), 3);
        assertEq(goods.uri(8), "https://noun.wtf/trade-tokens/8.json");
    }

    function test_cap_disableId() public {
        vm.prank(admin);
        goods.setCap(1, 0, 0);
        NounTradeGoods.Claim memory c = _voucher(alice, _ids1(1), _amts1(1), 0);
        bytes memory sig = _sign(signerPk, c);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.NotClaimable.selector, 1));
        goods.claim(c, sig);
    }

    // ── Pause ──

    function test_pause_blocksClaimAndDeposit_notTransfers() public {
        _claimAs(alice, _voucher(alice, _ids1(1), _amts1(4), 10));
        NounTradeGoods.Claim memory c = _voucher(alice, _ids1(1), _amts1(1), 0);
        bytes memory sig = _sign(signerPk, c);

        vm.prank(pauser);
        goods.pause();

        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        goods.claim(c, sig);

        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        goods.deposit(_ids1(1), _amts1(1), 0, keccak256("rider"));

        vm.prank(alice);
        goods.safeTransferFrom(alice, bob, 1, 1, "");
        vm.prank(alice);
        coin.transfer(bob, 1);
        assertEq(goods.balanceOf(bob, 1), 1);

        // the pauser cannot unpause; the admin can
        bytes32 adminRole = goods.DEFAULT_ADMIN_ROLE();
        vm.prank(pauser);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, pauser, adminRole)
        );
        goods.unpause();
        vm.prank(admin);
        goods.unpause();
        vm.prank(alice);
        goods.claim(c, sig);
    }

    // ── Roles ──

    function test_roles_onlyAdmin() public {
        bytes32 adminRole = goods.DEFAULT_ADMIN_ROLE();
        bytes32 signerRole = goods.SIGNER_ROLE();
        bytes32 pauserRole = goods.PAUSER_ROLE();
        bytes memory denied =
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, adminRole);
        vm.startPrank(bob);
        vm.expectRevert(denied);
        goods.setCap(1, 1, 1);
        vm.expectRevert(denied);
        goods.rotateSigner(signer, bob);
        vm.expectRevert(denied);
        goods.setBaseURI("x");
        vm.expectRevert(denied);
        goods.setContractURI("x");
        vm.expectRevert(denied);
        goods.cancelNonces(_ids1(1));
        vm.expectRevert(denied);
        goods.grantRole(signerRole, bob);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, pauserRole)
        );
        goods.pause();
        vm.stopPrank();
    }

    function test_roles_signerHasNoAdminPowers() public {
        vm.startPrank(signer);
        vm.expectRevert();
        goods.setCap(1, type(uint128).max, type(uint128).max);
        vm.expectRevert();
        goods.pause();
        vm.stopPrank();
    }

    function test_roles_adminCannotBeGrantedDirectly() public {
        bytes32 adminRole = goods.DEFAULT_ADMIN_ROLE();
        vm.prank(admin);
        vm.expectRevert(IAccessControlDefaultAdminRules.AccessControlEnforcedDefaultAdminRules.selector);
        goods.grantRole(adminRole, bob);
    }

    function test_roles_adminTransferIsTwoStepWithDelay() public {
        bytes32 adminRole = goods.DEFAULT_ADMIN_ROLE();
        vm.prank(admin);
        goods.beginDefaultAdminTransfer(bob);
        vm.prank(bob);
        vm.expectRevert();
        goods.acceptDefaultAdminTransfer(); // too early
        vm.warp(block.timestamp + TradeConfig.ADMIN_DELAY + 1);
        vm.prank(bob);
        goods.acceptDefaultAdminTransfer();
        assertTrue(goods.hasRole(adminRole, bob));
        assertFalse(goods.hasRole(adminRole, admin));
    }

    function test_rotateSigner() public {
        (address newSigner, uint256 newPk) = makeAddrAndKey("signer2");
        NounTradeGoods.Claim memory oldV = _voucher(alice, _ids1(1), _amts1(1), 0);
        bytes memory oldSig = _sign(signerPk, oldV);

        vm.prank(admin);
        goods.rotateSigner(signer, newSigner);
        assertFalse(goods.hasRole(goods.SIGNER_ROLE(), signer));
        assertTrue(goods.hasRole(goods.SIGNER_ROLE(), newSigner));

        // vouchers from the retired key die immediately
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.BadSigner.selector, signer));
        goods.claim(oldV, oldSig);

        NounTradeGoods.Claim memory newV = _voucher(alice, _ids1(1), _amts1(1), 0);
        bytes memory newSig = _sign(newPk, newV);
        vm.prank(alice);
        goods.claim(newV, newSig);
        assertEq(goods.balanceOf(alice, 1), 1);
    }

    function test_cancelNonces() public {
        NounTradeGoods.Claim memory c = _voucher(alice, _ids1(1), _amts1(1), 0);
        bytes memory sig = _sign(signerPk, c);
        vm.prank(admin);
        goods.cancelNonces(_ids1(c.nonce));
        assertEq(uint8(goods.nonceState(c.nonce)), uint8(NounTradeGoods.NonceState.Cancelled));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.NonceNotUnused.selector, c.nonce));
        goods.claim(c, sig);
        // a claimed nonce cannot be "cancelled" after the fact
        NounTradeGoods.Claim memory c2 = _voucher(alice, _ids1(1), _amts1(1), 0);
        _claimAs(alice, c2);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(NounTradeGoods.NonceNotUnused.selector, c2.nonce));
        goods.cancelNonces(_ids1(c2.nonce));
    }

    function test_coin_onlyGameMintsAndBurns() public {
        vm.prank(admin);
        vm.expectRevert(NounTradeCoin.OnlyGame.selector);
        coin.mint(admin, 1);
        _claimAs(alice, _voucher(alice, new uint256[](0), new uint256[](0), 5));
        vm.prank(admin);
        vm.expectRevert(NounTradeCoin.OnlyGame.selector);
        coin.burnByGame(alice, 5);
    }

    function test_supportsInterface() public view {
        assertTrue(goods.supportsInterface(0xd9b67a26)); // ERC-1155
        assertTrue(goods.supportsInterface(0x0e89341c)); // ERC-1155 metadata URI
        assertTrue(goods.supportsInterface(type(IAccessControl).interfaceId));
        assertTrue(goods.supportsInterface(type(IERC165).interfaceId));
    }

    // ── Deposit ──

    function test_deposit_burnsAndEmits() public {
        uint256[] memory ids = new uint256[](2);
        uint256[] memory amts = new uint256[](2);
        (ids[0], ids[1]) = (1, 6);
        (amts[0], amts[1]) = (10, 3);
        _claimAs(alice, _voucher(alice, ids, amts, 100));

        (amts[0], amts[1]) = (4, 3);
        bytes32 account = keccak256(bytes("rider-abc"));
        vm.expectEmit(address(goods));
        emit Deposited(alice, account, 1, ids, amts, 60);
        vm.prank(alice);
        goods.deposit(ids, amts, 60, account);

        assertEq(goods.balanceOf(alice, 1), 6);
        assertEq(goods.balanceOf(alice, 6), 0);
        assertEq(goods.totalSupply(1), 6);
        assertEq(goods.totalSupply(6), 0);
        assertEq(coin.balanceOf(alice), 40);
        assertEq(coin.totalSupply(), 40);
        assertEq(goods.depositCount(), 1);

        // the next deposit gets the next id
        vm.expectEmit(address(goods));
        emit Deposited(alice, account, 2, new uint256[](0), new uint256[](0), 40);
        vm.prank(alice);
        goods.deposit(new uint256[](0), new uint256[](0), 40, account);
    }

    function test_deposit_cannotBurnMoreThanYouHold() public {
        _claimAs(alice, _voucher(alice, _ids1(1), _amts1(2), 5));
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IERC1155Errors.ERC1155InsufficientBalance.selector, alice, 2, 3, 1)
        );
        goods.deposit(_ids1(1), _amts1(3), 0, bytes32(0));
        vm.prank(alice);
        vm.expectRevert();
        goods.deposit(new uint256[](0), new uint256[](0), 6, bytes32(0));
        // nor someone else's
        vm.prank(bob);
        vm.expectRevert();
        goods.deposit(_ids1(1), _amts1(1), 0, bytes32(0));
    }

    function test_deposit_shapes() public {
        vm.startPrank(alice);
        vm.expectRevert(NounTradeGoods.EmptyBatch.selector);
        goods.deposit(new uint256[](0), new uint256[](0), 0, bytes32(0));
        vm.expectRevert(NounTradeGoods.LengthMismatch.selector);
        goods.deposit(_ids1(1), new uint256[](0), 0, bytes32(0));
        vm.expectRevert(NounTradeGoods.ZeroAmount.selector);
        goods.deposit(_ids1(1), _amts1(0), 0, bytes32(0));
        vm.stopPrank();
    }

    // ── Reentrancy ──

    function test_reentrancy_receiverCannotReenter() public {
        Reenterer r = new Reenterer(goods);
        NounTradeGoods.Claim memory first = _voucher(address(r), _ids1(1), _amts1(1), 0);
        NounTradeGoods.Claim memory second = _voucher(address(r), _ids1(1), _amts1(1), 0);
        r.arm(second, _sign(signerPk, second));
        bytes memory sig = _sign(signerPk, first);
        vm.prank(address(r));
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        goods.claim(first, sig);
        assertEq(goods.totalSupply(1), 0);
    }

    // ── Fuzz ──

    function testFuzz_claimAmounts(uint256 a, uint256 b, uint256 coinAmt) public {
        a = bound(a, 1, TradeConfig.GOOD_CAP_PER_ADDRESS);
        b = bound(b, 1, TradeConfig.GOOD_CAP_PER_ADDRESS);
        coinAmt = bound(coinAmt, 0, TradeConfig.COIN_CAP_PER_ADDRESS);
        uint256[] memory ids = new uint256[](2);
        uint256[] memory amts = new uint256[](2);
        (ids[0], ids[1]) = (2, 5);
        (amts[0], amts[1]) = (a, b);
        _claimAs(alice, _voucher(alice, ids, amts, coinAmt));
        assertEq(goods.balanceOf(alice, 2), a);
        assertEq(goods.balanceOf(alice, 5), b);
        assertEq(coin.balanceOf(alice), coinAmt);
    }

    function testFuzz_overCapAlwaysReverts(uint256 a) public {
        a = bound(a, uint256(TradeConfig.GOOD_CAP_PER_ADDRESS) + 1, type(uint256).max);
        NounTradeGoods.Claim memory c = _voucher(alice, _ids1(4), _amts1(a), 0);
        bytes memory sig = _sign(signerPk, c);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                a > TradeConfig.GOOD_CAP_GLOBAL
                    ? NounTradeGoods.GlobalCapExceeded.selector
                    : NounTradeGoods.AddressCapExceeded.selector,
                4
            )
        );
        goods.claim(c, sig);
    }

    function testFuzz_depositPartial(uint256 held, uint256 burnt, uint256 coinHeld, uint256 coinBurnt) public {
        held = bound(held, 1, TradeConfig.GOOD_CAP_PER_ADDRESS);
        burnt = bound(burnt, 1, held);
        coinHeld = bound(coinHeld, 0, TradeConfig.COIN_CAP_PER_ADDRESS);
        coinBurnt = bound(coinBurnt, 0, coinHeld);
        _claimAs(alice, _voucher(alice, _ids1(3), _amts1(held), coinHeld));
        vm.prank(alice);
        goods.deposit(_ids1(3), _amts1(burnt), coinBurnt, keccak256("r"));
        assertEq(goods.balanceOf(alice, 3), held - burnt);
        assertEq(goods.totalSupply(3), held - burnt);
        assertEq(coin.totalSupply(), coinHeld - coinBurnt);
    }

    function testFuzz_anyOtherSignerFails(uint256 pk) public {
        pk = bound(pk, 1, 115792089237316195423570985008687907852837564279074904382605163141518161494336);
        vm.assume(pk != signerPk);
        NounTradeGoods.Claim memory c = _voucher(alice, _ids1(1), _amts1(1), 1);
        bytes memory sig = _sign(pk, c);
        vm.prank(alice);
        vm.expectPartialRevert(NounTradeGoods.BadSigner.selector);
        goods.claim(c, sig);
    }
}

/// @dev A player contract that tries to claim a second voucher from inside the
///      ERC-1155 receive hook of the first.
contract Reenterer is IERC1155Receiver {
    NounTradeGoods internal immutable goods;
    NounTradeGoods.Claim internal pending;
    bytes internal pendingSig;
    bool internal armed;

    constructor(NounTradeGoods g) {
        goods = g;
    }

    function arm(NounTradeGoods.Claim memory c, bytes memory sig) external {
        pending = c;
        pendingSig = sig;
        armed = true;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
        _reenter();
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        returns (bytes4)
    {
        _reenter();
        return this.onERC1155BatchReceived.selector;
    }

    function _reenter() internal {
        if (!armed) return;
        armed = false;
        goods.claim(pending, pendingSig);
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IERC1155Receiver).interfaceId || id == type(IERC165).interfaceId;
    }
}
