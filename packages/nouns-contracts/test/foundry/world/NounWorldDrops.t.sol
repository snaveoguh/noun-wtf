// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import 'forge-std/Test.sol';
import { ERC20 } from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import { ERC721 } from '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import { ERC1155 } from '@openzeppelin/contracts/token/ERC1155/ERC1155.sol';
import { IERC721Receiver } from '@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol';
import { NounWorldDrops } from '../../../contracts/world/NounWorldDrops.sol';

contract DropsTestERC20 is ERC20('Test', 'TST') {
    function mint(address to, uint256 a) external {
        _mint(to, a);
    }
}

contract DropsTestERC721 is ERC721('Test NFT', 'TNFT') {
    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

contract DropsTestERC1155 is ERC1155('') {
    function mint(address to, uint256 id, uint256 a) external {
        _mint(to, id, a, '');
    }
}

/// @dev A contract without onERC721Received (can't take NFTs via safeTransferFrom).
contract NoReceiver {
    function claim(NounWorldDrops d, uint256 id, uint256 deadline, bytes calldata sig) external {
        d.claim(id, deadline, sig);
    }
}

/// @dev Re-enters the drops contract from inside a payout (ETH or NFT).
contract ReentrantClaimer is IERC721Receiver {
    NounWorldDrops public immutable drops;
    uint256 public nextId;
    uint256 public nextDeadline;
    bytes public nextSig;
    bool public reentered;
    bytes public reentryError;
    bool public tried;

    constructor(NounWorldDrops d) {
        drops = d;
    }

    function arm(uint256 id, uint256 deadline, bytes calldata sig) external {
        nextId = id;
        nextDeadline = deadline;
        nextSig = sig;
    }

    function claim(uint256 id, uint256 deadline, bytes calldata sig) external {
        drops.claim(id, deadline, sig);
    }

    function _reenter() internal {
        if (tried) return;
        tried = true;
        try drops.claim(nextId, nextDeadline, nextSig) {
            reentered = true;
        } catch (bytes memory err) {
            reentryError = err;
        }
    }

    receive() external payable {
        _reenter();
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        _reenter();
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract NounWorldDropsTest is Test {
    NounWorldDrops drops;
    DropsTestERC20 erc20;
    DropsTestERC721 nft;
    DropsTestERC1155 multi;

    address owner = makeAddr('owner');
    address depositor = makeAddr('depositor');
    address player = makeAddr('player');
    address thief = makeAddr('thief');
    uint256 signerPk = 0xA11CE;
    address signer;

    uint256 constant DAY = 1 days;

    function setUp() public {
        signer = vm.addr(signerPk);
        drops = new NounWorldDrops(owner, signer);
        erc20 = new DropsTestERC20();
        nft = new DropsTestERC721();
        multi = new DropsTestERC1155();
        vm.deal(depositor, 100 ether);
        erc20.mint(depositor, 1_000e18);
        nft.mint(depositor, 42);
        multi.mint(depositor, 7, 10);
        vm.startPrank(depositor);
        erc20.approve(address(drops), type(uint256).max);
        nft.setApprovalForAll(address(drops), true);
        multi.setApprovalForAll(address(drops), true);
        vm.stopPrank();
    }

    // ── helpers ──

    function _sign(uint256 pk, uint256 id, address claimer, uint256 deadline) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, drops.hashClaim(id, claimer, deadline));
        return abi.encodePacked(r, s, v);
    }

    function _voucher(uint256 id, address claimer) internal view returns (uint256 deadline, bytes memory sig) {
        deadline = block.timestamp + 5 minutes;
        sig = _sign(signerPk, id, claimer, deadline);
    }

    function _dropEth(uint256 amount) internal returns (uint256) {
        vm.prank(depositor);
        return drops.depositETH{ value: amount }(DAY);
    }

    // ── EIP-712 domain (must match netlify/functions/world-drops.ts) ──

    function test_domainSeparatorMatchesSpec() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
                keccak256('NounWorldDrops'),
                keccak256('1'),
                block.chainid,
                address(drops)
            )
        );
        assertEq(drops.domainSeparator(), expected);
        bytes32 structHash = keccak256(
            abi.encode(keccak256('Claim(uint256 dropId,address claimer,uint256 deadline)'), 1, player, 1234)
        );
        assertEq(drops.hashClaim(1, player, 1234), keccak256(abi.encodePacked('\x19\x01', expected, structHash)));
    }

    // ── Happy paths ──

    function test_claimETH() public {
        uint256 id = _dropEth(1 ether);
        assertEq(id, 1);
        (uint256 deadline, bytes memory sig) = _voucher(id, player);
        vm.prank(player);
        drops.claim(id, deadline, sig);
        assertEq(player.balance, 1 ether);
        assertEq(address(drops).balance, 0);
        NounWorldDrops.Drop memory d = drops.getDrop(id);
        assertEq(uint8(d.status), uint8(NounWorldDrops.Status.Claimed));
        assertEq(d.claimer, player);
    }

    function test_claimERC20() public {
        vm.prank(depositor);
        uint256 id = drops.depositERC20(address(erc20), 50e18, DAY);
        (uint256 deadline, bytes memory sig) = _voucher(id, player);
        vm.prank(player);
        drops.claim(id, deadline, sig);
        assertEq(erc20.balanceOf(player), 50e18);
        assertEq(erc20.balanceOf(address(drops)), 0);
    }

    function test_claimERC721() public {
        vm.prank(depositor);
        uint256 id = drops.depositERC721(address(nft), 42, DAY);
        assertEq(nft.ownerOf(42), address(drops));
        (uint256 deadline, bytes memory sig) = _voucher(id, player);
        vm.prank(player);
        drops.claim(id, deadline, sig);
        assertEq(nft.ownerOf(42), player);
    }

    function test_claimERC1155() public {
        vm.prank(depositor);
        uint256 id = drops.depositERC1155(address(multi), 7, 4, DAY);
        (uint256 deadline, bytes memory sig) = _voucher(id, player);
        vm.prank(player);
        drops.claim(id, deadline, sig);
        assertEq(multi.balanceOf(player, 7), 4);
        assertEq(multi.balanceOf(address(drops), 7), 0);
    }

    function test_dropCreatedEvent() public {
        vm.expectEmit(true, true, true, true);
        emit NounWorldDrops.DropCreated(1, depositor, NounWorldDrops.Kind.ETH, address(0), 0, 2 ether, uint64(block.timestamp + DAY));
        _dropEth(2 ether);
    }

    // ── Bad vouchers ──

    function test_revert_wrongSigner() public {
        uint256 id = _dropEth(1 ether);
        uint256 deadline = block.timestamp + 5 minutes;
        bytes memory sig = _sign(0xBAD, id, player, deadline);
        vm.prank(player);
        vm.expectRevert(NounWorldDrops.BadSignature.selector);
        drops.claim(id, deadline, sig);
    }

    function test_revert_garbageSignature() public {
        uint256 id = _dropEth(1 ether);
        vm.prank(player);
        vm.expectRevert(NounWorldDrops.BadSignature.selector);
        drops.claim(id, block.timestamp + 60, hex'deadbeef');
    }

    function test_revert_voucherForOtherDrop() public {
        uint256 a = _dropEth(1 ether);
        uint256 b = _dropEth(1 ether);
        (uint256 deadline, bytes memory sig) = _voucher(a, player);
        vm.prank(player);
        vm.expectRevert(NounWorldDrops.BadSignature.selector);
        drops.claim(b, deadline, sig);
    }

    function test_revert_tamperedDeadline() public {
        uint256 id = _dropEth(1 ether);
        (uint256 deadline, bytes memory sig) = _voucher(id, player);
        vm.prank(player);
        vm.expectRevert(NounWorldDrops.BadSignature.selector);
        drops.claim(id, deadline + 1 days, sig);
    }

    function test_revert_expiredVoucher() public {
        uint256 id = _dropEth(1 ether);
        (uint256 deadline, bytes memory sig) = _voucher(id, player);
        vm.warp(deadline + 1);
        vm.prank(player);
        vm.expectRevert(NounWorldDrops.VoucherExpired.selector);
        drops.claim(id, deadline, sig);
    }

    function test_revert_expiredDrop() public {
        uint256 id = _dropEth(1 ether);
        vm.warp(block.timestamp + DAY + 1);
        (uint256 deadline, bytes memory sig) = _voucher(id, player);
        vm.prank(player);
        vm.expectRevert(NounWorldDrops.DropExpired.selector);
        drops.claim(id, deadline, sig);
    }

    /// A voucher seen in the mempool is useless to anyone but its claimer.
    function test_revert_wrongClaimer() public {
        uint256 id = _dropEth(1 ether);
        (uint256 deadline, bytes memory sig) = _voucher(id, player);
        vm.prank(thief);
        vm.expectRevert(NounWorldDrops.BadSignature.selector);
        drops.claim(id, deadline, sig);
        // The real claimer still gets it
        vm.prank(player);
        drops.claim(id, deadline, sig);
        assertEq(player.balance, 1 ether);
    }

    function test_revert_doubleClaim() public {
        uint256 id = _dropEth(1 ether);
        _dropEth(1 ether); // funds that a second payout could steal
        (uint256 deadline, bytes memory sig) = _voucher(id, player);
        vm.prank(player);
        drops.claim(id, deadline, sig);
        vm.prank(player);
        vm.expectRevert(NounWorldDrops.NotOpen.selector);
        drops.claim(id, deadline, sig);
        assertEq(player.balance, 1 ether);
    }

    function test_revert_unknownDrop() public {
        (uint256 deadline, bytes memory sig) = _voucher(99, player);
        vm.prank(player);
        vm.expectRevert(NounWorldDrops.NotOpen.selector);
        drops.claim(99, deadline, sig);
    }

    function test_revert_signerUnsetDisablesClaims() public {
        uint256 id = _dropEth(1 ether);
        vm.prank(owner);
        drops.setSigner(address(0));
        (uint256 deadline, bytes memory sig) = _voucher(id, player);
        vm.prank(player);
        vm.expectRevert(NounWorldDrops.BadSignature.selector);
        drops.claim(id, deadline, sig);
    }

    // ── Signer rotation ──

    function test_rotateSigner() public {
        uint256 id = _dropEth(1 ether);
        uint256 newPk = 0xB0B;
        vm.prank(owner);
        drops.setSigner(vm.addr(newPk));
        // Old key's vouchers stop working
        (uint256 deadline, bytes memory oldSig) = _voucher(id, player);
        vm.prank(player);
        vm.expectRevert(NounWorldDrops.BadSignature.selector);
        drops.claim(id, deadline, oldSig);
        bytes memory newSig = _sign(newPk, id, player, deadline);
        vm.prank(player);
        drops.claim(id, deadline, newSig);
        assertEq(player.balance, 1 ether);
    }

    function test_revert_onlyOwnerAdmin() public {
        vm.startPrank(thief);
        vm.expectRevert('Ownable: caller is not the owner');
        drops.setSigner(thief);
        vm.expectRevert('Ownable: caller is not the owner');
        drops.pause();
        vm.stopPrank();
        assertEq(drops.owner(), owner);
    }

    // ── Reclaim ──

    function test_reclaimAfterExpiry() public {
        vm.prank(depositor);
        uint256 id = drops.depositERC721(address(nft), 42, DAY);
        vm.warp(block.timestamp + DAY + 1);
        vm.prank(depositor);
        drops.reclaim(id);
        assertEq(nft.ownerOf(42), depositor);
        assertEq(uint8(drops.getDrop(id).status), uint8(NounWorldDrops.Status.Reclaimed));
        // Gone for good: no claim, no second reclaim
        (uint256 deadline, bytes memory sig) = _voucher(id, player);
        vm.prank(player);
        vm.expectRevert(NounWorldDrops.NotOpen.selector);
        drops.claim(id, deadline, sig);
        vm.prank(depositor);
        vm.expectRevert(NounWorldDrops.NotOpen.selector);
        drops.reclaim(id);
    }

    function test_reclaimETHAfterExpiry() public {
        uint256 id = _dropEth(3 ether);
        uint256 before = depositor.balance;
        vm.warp(block.timestamp + DAY + 1);
        vm.prank(depositor);
        drops.reclaim(id);
        assertEq(depositor.balance, before + 3 ether);
    }

    function test_revert_reclaimBeforeExpiry() public {
        uint256 id = _dropEth(1 ether);
        vm.warp(block.timestamp + DAY); // last claimable second
        vm.prank(depositor);
        vm.expectRevert(NounWorldDrops.NotExpired.selector);
        drops.reclaim(id);
    }

    function test_revert_reclaimByOther() public {
        uint256 id = _dropEth(1 ether);
        vm.warp(block.timestamp + DAY + 1);
        vm.prank(thief);
        vm.expectRevert(NounWorldDrops.NotDepositor.selector);
        drops.reclaim(id);
    }

    function test_revert_reclaimAfterClaim() public {
        uint256 id = _dropEth(1 ether);
        (uint256 deadline, bytes memory sig) = _voucher(id, player);
        vm.prank(player);
        drops.claim(id, deadline, sig);
        vm.warp(block.timestamp + DAY + 1);
        vm.prank(depositor);
        vm.expectRevert(NounWorldDrops.NotOpen.selector);
        drops.reclaim(id);
    }

    // ── Reentrancy ──

    function test_reentrancyBlockedOnETHPayout() public {
        ReentrantClaimer attacker = new ReentrantClaimer(drops);
        uint256 a = _dropEth(1 ether);
        uint256 b = _dropEth(1 ether);
        (uint256 da, bytes memory sa) = _voucher(a, address(attacker));
        (uint256 db, bytes memory sb) = _voucher(b, address(attacker));
        attacker.arm(b, db, sb);
        attacker.claim(a, da, sa);
        assertTrue(attacker.tried());
        assertFalse(attacker.reentered());
        assertEq(keccak256(attacker.reentryError()), keccak256(abi.encodeWithSignature('Error(string)', 'ReentrancyGuard: reentrant call')));
        assertEq(address(attacker).balance, 1 ether);
        assertEq(uint8(drops.getDrop(b).status), uint8(NounWorldDrops.Status.Open));
    }

    function test_reentrancyBlockedOnNFTPayout() public {
        ReentrantClaimer attacker = new ReentrantClaimer(drops);
        vm.prank(depositor);
        uint256 a = drops.depositERC721(address(nft), 42, DAY);
        uint256 b = _dropEth(1 ether);
        (uint256 da, bytes memory sa) = _voucher(a, address(attacker));
        (uint256 db, bytes memory sb) = _voucher(b, address(attacker));
        attacker.arm(b, db, sb);
        attacker.claim(a, da, sa);
        assertFalse(attacker.reentered());
        assertEq(nft.ownerOf(42), address(attacker));
        assertEq(address(attacker).balance, 0);
    }

    /// Re-entering the same drop: already marked claimed before the payout.
    function test_reentrancySameDrop() public {
        ReentrantClaimer attacker = new ReentrantClaimer(drops);
        uint256 a = _dropEth(1 ether);
        _dropEth(5 ether);
        (uint256 da, bytes memory sa) = _voucher(a, address(attacker));
        attacker.arm(a, da, sa);
        attacker.claim(a, da, sa);
        assertFalse(attacker.reentered());
        assertEq(address(attacker).balance, 1 ether);
        assertEq(address(drops).balance, 5 ether);
    }

    function test_revert_claimerWithoutNFTReceiver() public {
        NoReceiver c = new NoReceiver();
        vm.prank(depositor);
        uint256 id = drops.depositERC721(address(nft), 42, DAY);
        (uint256 deadline, bytes memory sig) = _voucher(id, address(c));
        vm.expectRevert('ERC721: transfer to non ERC721Receiver implementer');
        c.claim(drops, id, deadline, sig);
        // Still open, still held
        assertEq(nft.ownerOf(42), address(drops));
        assertEq(uint8(drops.getDrop(id).status), uint8(NounWorldDrops.Status.Open));
    }

    // ── Pause ──

    function test_pauseBlocksDepositsAndClaims() public {
        uint256 id = _dropEth(1 ether);
        vm.prank(owner);
        drops.pause();
        (uint256 deadline, bytes memory sig) = _voucher(id, player);
        vm.prank(player);
        vm.expectRevert('Pausable: paused');
        drops.claim(id, deadline, sig);
        vm.prank(depositor);
        vm.expectRevert('Pausable: paused');
        drops.depositETH{ value: 1 ether }(DAY);
        vm.prank(owner);
        drops.unpause();
        vm.prank(player);
        drops.claim(id, deadline, sig);
        assertEq(player.balance, 1 ether);
    }

    function test_reclaimWorksWhilePaused() public {
        uint256 id = _dropEth(1 ether);
        vm.prank(owner);
        drops.pause();
        vm.warp(block.timestamp + DAY + 1);
        vm.prank(depositor);
        drops.reclaim(id);
        assertEq(address(drops).balance, 0);
    }

    // ── Deposit validation ──

    function test_revert_badDuration() public {
        vm.startPrank(depositor);
        vm.expectRevert(NounWorldDrops.BadDuration.selector);
        drops.depositETH{ value: 1 ether }(59 minutes);
        vm.expectRevert(NounWorldDrops.BadDuration.selector);
        drops.depositETH{ value: 1 ether }(366 days);
        vm.expectRevert(NounWorldDrops.ZeroAmount.selector);
        drops.depositETH(DAY);
        vm.stopPrank();
    }

    function test_revert_directNFTTransfer() public {
        vm.prank(depositor);
        vm.expectRevert(NounWorldDrops.DirectTransferRejected.selector);
        nft.safeTransferFrom(depositor, address(drops), 42);
    }

    function test_revert_plainETHTransfer() public {
        vm.prank(depositor);
        (bool ok, ) = address(drops).call{ value: 1 ether }('');
        assertFalse(ok);
    }

    function testFuzz_onlyVoucherHolderClaims(address caller) public {
        vm.assume(caller != player && caller != address(0));
        uint256 id = _dropEth(1 ether);
        (uint256 deadline, bytes memory sig) = _voucher(id, player);
        vm.prank(caller);
        vm.expectRevert(NounWorldDrops.BadSignature.selector);
        drops.claim(id, deadline, sig);
    }
}
