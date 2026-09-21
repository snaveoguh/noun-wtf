// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.19;

import 'forge-std/Test.sol';
import { NounsRepurchase } from '../../contracts/repurchase/NounsRepurchase.sol';
import { INounsRepurchase } from '../../contracts/interfaces/INounsRepurchase.sol';
import { IEthConverter } from '../../contracts/interfaces/IEthConverter.sol';
import { OneToOneConverter } from '../../contracts/repurchase/EthConverters.sol';
import { IChainalysisSanctionsList } from '../../contracts/external/chainalysis/IChainalysisSanctionsList.sol';
import { ChainalysisSanctionsListMock } from './helpers/ChainalysisSanctionsListMock.sol';
import { ERC20Mock } from './helpers/ERC20Mock.sol';
import { DeployUtils } from './helpers/DeployUtils.sol';
import { NounsToken } from '../../contracts/NounsToken.sol';
import { WETH } from '../../contracts/test/WETH.sol';
import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { IERC721Enumerable } from '@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol';
import { ERC721Enumerable, ERC721 } from '@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol';

/// @dev Minimal enumerable Noun stand-in so unit tests don't need the descriptor/art pipeline.
contract NounsEnumerableMock is ERC721Enumerable {
    uint256 public nextId;

    constructor() ERC721('Nouns', 'NOUN') {}

    function mintTo(address to) external returns (uint256 id) {
        id = nextId++;
        _mint(to, id);
    }
}

/// @dev Converter that values every token at a fixed ETH rate (1e18 = 1:1).
contract FixedRateConverter is IEthConverter {
    uint256 public immutable rate;

    constructor(uint256 _rate) {
        rate = _rate;
    }

    function toEth(uint256 amount) external view returns (uint256) {
        return (amount * rate) / 1e18;
    }
}

/// @dev Converter whose protocol is "paused": must be valued at zero, never revert NAV.
contract RevertingConverter is IEthConverter {
    function toEth(uint256) external pure returns (uint256) {
        revert('paused');
    }
}

/// @dev A member wallet that refuses ETH, to exercise the WETH fallback.
contract RejectsEth {
    receive() external payable {
        revert('no');
    }
}

contract NounsRepurchaseTest is Test {
    NounsEnumerableMock nouns;
    ChainalysisSanctionsListMock sanctions;
    ERC20Mock lst;
    WETH weth;
    NounsRepurchase repurchase;

    address treasury = makeAddr('treasury');
    address auctionHouse = makeAddr('auctionHouse');
    address alice = makeAddr('alice');
    address bob = makeAddr('bob');
    uint256 attestorPk = 0xA11CE;
    address attestor;

    uint16 constant SPREAD_BPS = 0;
    uint16 constant MAX_PER_TICK = 2;
    uint32 constant TICK = 1 days;

    function setUp() public {
        vm.warp(1_700_000_000);
        attestor = vm.addr(attestorPk);

        nouns = new NounsEnumerableMock();
        sanctions = new ChainalysisSanctionsListMock();
        lst = new ERC20Mock();
        weth = new WETH();

        repurchase = _deploy(SPREAD_BPS, address(0));

        // 11 minted: 5 to alice, 4 to bob, 1 to the treasury, 1 on auction. 9 circulating.
        for (uint256 i = 0; i < 5; ++i) nouns.mintTo(alice);
        for (uint256 i = 0; i < 4; ++i) nouns.mintTo(bob);
        nouns.mintTo(treasury);
        nouns.mintTo(auctionHouse);

        // Gross assets: 200 ETH in treasury + 300 ETH in the program + 500 LST at 1:1 = 1000 ETH over 9 Nouns.
        vm.deal(treasury, 200 ether);
        vm.deal(address(repurchase), 300 ether);
        lst.mint(treasury, 500 ether);

        vm.prank(alice);
        nouns.setApprovalForAll(address(repurchase), true);
        vm.prank(bob);
        nouns.setApprovalForAll(address(repurchase), true);
    }

    function _deploy(uint16 spread, address kycAttestor) internal returns (NounsRepurchase r) {
        INounsRepurchase.Asset[] memory assets = new INounsRepurchase.Asset[](1);
        assets[0] = INounsRepurchase.Asset({
            token: IERC20(address(lst)),
            converter: IEthConverter(address(new OneToOneConverter()))
        });
        address[] memory excluded = new address[](1);
        excluded[0] = auctionHouse;
        r = new NounsRepurchase(
            IERC721Enumerable(address(nouns)),
            treasury,
            address(weth),
            IChainalysisSanctionsList(address(sanctions)),
            kycAttestor,
            spread,
            MAX_PER_TICK,
            TICK,
            0,
            assets,
            excluded
        );
    }

    function _ids(uint256 a) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = a;
    }

    function _ids(uint256 a, uint256 b) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](2);
        ids[0] = a;
        ids[1] = b;
    }

    function _request(address who, uint256[] memory ids) internal {
        vm.prank(who);
        repurchase.requestRepurchase(ids, 0, '');
    }

    function _request(address who, uint256[] memory ids, uint256 minPrice) internal {
        vm.prank(who);
        repurchase.requestRepurchase(ids, minPrice, '');
    }

    // ───────────────────────────── NAV ─────────────────────────────

    function test_navPerNoun_excludesDaoHeldNounsAndCountsAllAssets() public {
        assertEq(repurchase.circulatingSupply(), 9);
        assertEq(repurchase.totalAssetsEth(), 1000 ether);
        assertEq(repurchase.navPerNoun(), uint256(1000 ether) / 9);
        assertEq(repurchase.repurchasePrice(), uint256(1000 ether) / 9);
    }

    function test_navPerNoun_subtractsLiabilityReserve() public {
        vm.prank(treasury);
        repurchase.setLiabilityReserve(100 ether);
        assertEq(repurchase.navPerNoun(), uint256(900 ether) / 9);
    }

    function test_navPerNoun_zeroWhenLiabilitiesExceedAssets() public {
        vm.prank(treasury);
        repurchase.setLiabilityReserve(5000 ether);
        assertEq(repurchase.navPerNoun(), 0);
        assertEq(repurchase.repurchasePrice(), 0);
    }

    function test_navPerNoun_usesConverterRate() public {
        INounsRepurchase.Asset[] memory assets = new INounsRepurchase.Asset[](1);
        assets[0] = INounsRepurchase.Asset({
            token: IERC20(address(lst)),
            converter: IEthConverter(address(new FixedRateConverter(1.2e18)))
        });
        vm.prank(treasury);
        repurchase.setAssets(assets);
        assertEq(repurchase.totalAssetsEth(), 1100 ether);
    }

    function test_navPerNoun_revertingConverterCountsAsZero() public {
        INounsRepurchase.Asset[] memory assets = new INounsRepurchase.Asset[](1);
        assets[0] = INounsRepurchase.Asset({
            token: IERC20(address(lst)),
            converter: IEthConverter(address(new RevertingConverter()))
        });
        vm.prank(treasury);
        repurchase.setAssets(assets);
        assertEq(repurchase.totalAssetsEth(), 500 ether);
    }

    function test_navPerNoun_escrowedNounsStillCount() public {
        _request(alice, _ids(0, 1));
        assertEq(repurchase.circulatingSupply(), 9);
    }

    function test_navPerNoun_excludedHoldersConfigurable() public {
        address[] memory none = new address[](0);
        vm.prank(treasury);
        repurchase.setExtraExcludedHolders(none);
        assertEq(repurchase.circulatingSupply(), 10);
    }

    function test_navPerNoun_revertsWithNoCirculatingSupply() public {
        NounsEnumerableMock empty = new NounsEnumerableMock();
        INounsRepurchase.Asset[] memory assets = new INounsRepurchase.Asset[](0);
        address[] memory excluded = new address[](0);
        NounsRepurchase r = new NounsRepurchase(
            IERC721Enumerable(address(empty)),
            treasury,
            address(weth),
            IChainalysisSanctionsList(address(0)),
            address(0),
            0,
            1,
            1,
            0,
            assets,
            excluded
        );
        vm.expectRevert(INounsRepurchase.NoCirculatingNouns.selector);
        r.navPerNoun();
    }

    // ───────────────────────────── request / cancel / requeue ─────────────────────────────

    function test_requestRepurchase_escrowsNouns() public {
        _request(alice, _ids(0, 1), 1 ether);

        assertEq(nouns.ownerOf(0), address(repurchase));
        assertEq(nouns.ownerOf(1), address(repurchase));
        (address owner, , uint48 queueIndex, INounsRepurchase.FreezeReason frozen, uint128 minPrice) = repurchase
            .requests(1);
        assertEq(owner, alice);
        assertEq(queueIndex, 1);
        assertEq(uint8(frozen), uint8(INounsRepurchase.FreezeReason.None));
        assertEq(minPrice, 1 ether);
        assertEq(repurchase.pendingCount(), 2);
    }

    function test_requestRepurchase_revertsForNonOwner() public {
        vm.prank(bob);
        vm.expectRevert('ERC721: transfer from incorrect owner');
        repurchase.requestRepurchase(_ids(0), 0, '');
    }

    function test_requestRepurchase_revertsWithoutApproval() public {
        vm.prank(alice);
        nouns.setApprovalForAll(address(repurchase), false);
        vm.prank(alice);
        vm.expectRevert('ERC721: caller is not token owner or approved');
        repurchase.requestRepurchase(_ids(0), 0, '');
    }

    function test_requestRepurchase_revertsForSanctionedWallet() public {
        sanctions.setSanctioned(alice, true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(INounsRepurchase.SanctionedMember.selector, alice));
        repurchase.requestRepurchase(_ids(0), 0, '');
    }

    function test_requestRepurchase_revertsWhenPaused() public {
        vm.prank(treasury);
        repurchase.pause();
        vm.prank(alice);
        vm.expectRevert('Pausable: paused');
        repurchase.requestRepurchase(_ids(0), 0, '');
    }

    function test_cancelRequest_returnsNoun() public {
        _request(alice, _ids(0));
        vm.prank(alice);
        repurchase.cancelRequest(_ids(0));
        assertEq(nouns.ownerOf(0), alice);
        (address owner, , , , ) = repurchase.requests(0);
        assertEq(owner, address(0));
    }

    function test_cancelRequest_revertsForNonOwner() public {
        _request(alice, _ids(0));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(INounsRepurchase.NotRequestOwner.selector, 0));
        repurchase.cancelRequest(_ids(0));
    }

    function test_cancelRequest_allowedWhilePaused() public {
        _request(alice, _ids(0));
        vm.prank(treasury);
        repurchase.pause();
        vm.prank(alice);
        repurchase.cancelRequest(_ids(0));
        assertEq(nouns.ownerOf(0), alice);
    }

    /// @dev Cancel + re-request must not let a member keep their original queue position.
    function test_cancelThenRerequest_goesToBackOfQueue() public {
        _request(alice, _ids(0));
        _request(bob, _ids(5));
        vm.prank(alice);
        repurchase.cancelRequest(_ids(0));
        _request(alice, _ids(0));

        vm.prank(treasury);
        repurchase.setMaxPerTick(1);

        assertEq(repurchase.settle(), 1);
        assertEq(nouns.ownerOf(5), treasury); // bob first
        assertEq(nouns.ownerOf(0), address(repurchase)); // alice still queued

        vm.warp(block.timestamp + TICK);
        assertEq(repurchase.settle(), 1);
        assertEq(nouns.ownerOf(0), treasury);
    }

    function test_requeue_revertsIfNotFrozen() public {
        _request(alice, _ids(0));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(INounsRepurchase.RequestNotFrozen.selector, 0));
        repurchase.requeue(_ids(0), 0);
    }

    function test_requeue_revertsForNonOwner() public {
        _request(alice, _ids(0), type(uint128).max);
        repurchase.settle(); // freezes 0 (below min price)
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(INounsRepurchase.NotRequestOwner.selector, 0));
        repurchase.requeue(_ids(0), 0);
    }

    // ───────────────────────────── settle ─────────────────────────────

    function test_settle_paysPriceAndMovesNounToTreasury() public {
        _request(alice, _ids(0));

        uint256 price = repurchase.repurchasePrice();
        uint256 aliceBefore = alice.balance;

        uint256 settled = repurchase.settle();

        assertEq(settled, 1);
        assertEq(alice.balance, aliceBefore + price);
        assertEq(nouns.ownerOf(0), treasury);
        assertEq(repurchase.pendingCount(), 0);
        assertEq(repurchase.lastTickAt(), block.timestamp);
        (address owner, , , , ) = repurchase.requests(0);
        assertEq(owner, address(0));
    }

    /// @dev The core legal invariant: at zero spread, remaining members' book value is unchanged by an exit.
    function test_settle_navUnchangedAtZeroSpread() public {
        uint256 navBefore = repurchase.navPerNoun();
        _request(alice, _ids(0));
        repurchase.settle();
        assertApproxEqAbs(repurchase.navPerNoun(), navBefore, 1);
    }

    /// @dev With a positive spread, every exit accretes value to the remaining members.
    function test_settle_navIncreasesWithSpread() public {
        repurchase = _deploy(500, address(0)); // 5%
        vm.deal(address(repurchase), 300 ether);
        vm.prank(alice);
        nouns.setApprovalForAll(address(repurchase), true);

        uint256 navBefore = repurchase.navPerNoun();
        assertEq(repurchase.repurchasePrice(), (navBefore * 9500) / 10_000);

        _request(alice, _ids(0));
        repurchase.settle();
        assertGt(repurchase.navPerNoun(), navBefore);
    }

    /// @dev Fuzz: whatever the spread and treasury size, the DAO never pays more than NAV and NAV never falls.
    function testFuzz_settle_neverPaysAboveNavAndNavNeverFalls(uint16 spread, uint96 treasuryEth) public {
        spread = uint16(bound(spread, 0, repurchase.MAX_SPREAD_BPS()));
        treasuryEth = uint96(bound(treasuryEth, 0, 100_000 ether));

        repurchase = _deploy(spread, address(0));
        vm.deal(treasury, treasuryEth);
        vm.deal(address(repurchase), 100_000 ether);
        vm.prank(alice);
        nouns.setApprovalForAll(address(repurchase), true);

        uint256 navBefore = repurchase.navPerNoun();
        uint256 price = repurchase.repurchasePrice();
        assertLe(price, navBefore);

        _request(alice, _ids(0));
        uint256 aliceBefore = alice.balance;
        repurchase.settle();

        assertEq(alice.balance - aliceBefore, price);
        assertGe(repurchase.navPerNoun() + 1, navBefore); // +1 absorbs integer rounding
    }

    function test_settle_respectsMaxPerTickAndFifo() public {
        _request(alice, _ids(0, 1));
        _request(bob, _ids(5));

        assertEq(repurchase.settle(), 2);
        assertEq(nouns.ownerOf(0), treasury);
        assertEq(nouns.ownerOf(1), treasury);
        assertEq(nouns.ownerOf(5), address(repurchase));

        vm.expectRevert(abi.encodeWithSelector(INounsRepurchase.TickNotElapsed.selector, block.timestamp + TICK));
        repurchase.settle();

        vm.warp(block.timestamp + TICK);
        vm.deal(address(repurchase), 300 ether); // DAO tops the program up for the next tick
        assertEq(repurchase.settle(), 1);
        assertEq(nouns.ownerOf(5), treasury);
    }

    function test_settle_priceFrozenPerTick() public {
        _request(alice, _ids(0, 1));
        uint256 price = repurchase.repurchasePrice();
        uint256 before = alice.balance;
        repurchase.settle();
        // Both Nouns in the tick paid the same price, even though NAV shifts after the first.
        assertEq(alice.balance - before, 2 * price);
    }

    function test_settle_skipsCancelledEntries() public {
        _request(alice, _ids(0, 1));
        vm.prank(alice);
        repurchase.cancelRequest(_ids(0));

        assertEq(repurchase.settle(), 1);
        assertEq(nouns.ownerOf(0), alice);
        assertEq(nouns.ownerOf(1), treasury);
        assertEq(repurchase.pendingCount(), 0);
    }

    function test_settle_freezesSanctionedOwnerAndAllowsCancel() public {
        _request(alice, _ids(0));
        _request(bob, _ids(5));

        sanctions.setSanctioned(alice, true);
        uint256 aliceBefore = alice.balance;

        assertEq(repurchase.settle(), 1);
        assertEq(alice.balance, aliceBefore);
        assertEq(nouns.ownerOf(0), address(repurchase));
        assertEq(nouns.ownerOf(5), treasury);
        (address owner, , , INounsRepurchase.FreezeReason frozen, ) = repurchase.requests(0);
        assertEq(owner, alice);
        assertEq(uint8(frozen), uint8(INounsRepurchase.FreezeReason.Sanctioned));

        // Frozen entry is out of the queue, but the Noun is still alice's to withdraw.
        vm.prank(alice);
        repurchase.cancelRequest(_ids(0));
        assertEq(nouns.ownerOf(0), alice);
    }

    function test_settle_sanctionedOwnerCannotRequeue() public {
        _request(alice, _ids(0));
        sanctions.setSanctioned(alice, true);
        repurchase.settle();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(INounsRepurchase.SanctionedMember.selector, alice));
        repurchase.requeue(_ids(0), 0);
    }

    function test_settle_freezesBelowMinPriceAndRequeueWorks() public {
        uint256 price = repurchase.repurchasePrice();
        _request(alice, _ids(0), price + 1);
        _request(bob, _ids(5));

        assertEq(repurchase.settle(), 1);
        assertEq(nouns.ownerOf(5), treasury);
        (, , , INounsRepurchase.FreezeReason frozen, ) = repurchase.requests(0);
        assertEq(uint8(frozen), uint8(INounsRepurchase.FreezeReason.BelowMinPrice));

        // Alice lowers her floor and goes to the back of the queue.
        vm.prank(alice);
        repurchase.requeue(_ids(0), 0);
        (, , uint48 queueIndex, INounsRepurchase.FreezeReason frozenAfter, ) = repurchase.requests(0);
        assertEq(queueIndex, 2);
        assertEq(uint8(frozenAfter), uint8(INounsRepurchase.FreezeReason.None));

        vm.warp(block.timestamp + TICK);
        assertEq(repurchase.settle(), 1);
        assertEq(nouns.ownerOf(0), treasury);
    }

    function test_settle_stopsOnInsufficientFundsWithoutAdvancingTick() public {
        vm.prank(treasury);
        repurchase.returnFundsToTreasury(300 ether);
        assertEq(address(repurchase).balance, 0);

        _request(alice, _ids(0));

        assertEq(repurchase.settle(), 0);
        assertEq(repurchase.lastTickAt(), 0);
        assertEq(nouns.ownerOf(0), address(repurchase));
        assertEq(repurchase.pendingCount(), 1);

        // Top up and retry immediately: no tick wait because nothing was settled.
        vm.deal(address(repurchase), 200 ether);
        assertEq(repurchase.settle(), 1);
    }

    function test_settle_revertsWhenQueueEmpty() public {
        vm.expectRevert(INounsRepurchase.NothingToSettle.selector);
        repurchase.settle();
    }

    function test_settle_revertsWhenPaused() public {
        _request(alice, _ids(0));
        vm.prank(treasury);
        repurchase.pause();
        vm.expectRevert('Pausable: paused');
        repurchase.settle();
    }

    function test_settle_fallsBackToWethForRejectingReceiver() public {
        RejectsEth member = new RejectsEth();
        uint256 id = nouns.mintTo(address(member));
        vm.prank(address(member));
        nouns.setApprovalForAll(address(repurchase), true);
        vm.prank(address(member));
        repurchase.requestRepurchase(_ids(id), 0, '');

        uint256 price = repurchase.repurchasePrice();
        repurchase.settle();
        assertEq(weth.balanceOf(address(member)), price);
        assertEq(nouns.ownerOf(id), treasury);
    }

    // ───────────────────────────── KYC ─────────────────────────────

    function _kycSig(address member, uint256 expiry, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(repurchase.KYC_ATTESTATION_TYPEHASH(), member, expiry));
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
                keccak256('NounsRepurchase'),
                keccak256('1'),
                block.chainid,
                address(repurchase)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked('\x19\x01', domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encode(expiry, abi.encodePacked(r, s, v));
    }

    function _enableKyc() internal {
        vm.prank(treasury);
        repurchase.setKycAttestor(attestor);
    }

    function test_kyc_requiredWhenAttestorSet() public {
        _enableKyc();
        vm.prank(alice);
        vm.expectRevert(INounsRepurchase.KycAttestationRequired.selector);
        repurchase.requestRepurchase(_ids(0), 0, '');
    }

    function test_kyc_validAttestationPasses() public {
        _enableKyc();
        bytes memory sig = _kycSig(alice, block.timestamp + 30 days, attestorPk);
        vm.prank(alice);
        repurchase.requestRepurchase(_ids(0), 0, sig);
        assertEq(nouns.ownerOf(0), address(repurchase));
    }

    function test_kyc_expiredAttestationReverts() public {
        _enableKyc();
        bytes memory sig = _kycSig(alice, block.timestamp - 1, attestorPk);
        vm.prank(alice);
        vm.expectRevert(INounsRepurchase.InvalidKycAttestation.selector);
        repurchase.requestRepurchase(_ids(0), 0, sig);
    }

    function test_kyc_wrongSignerReverts() public {
        _enableKyc();
        bytes memory sig = _kycSig(alice, block.timestamp + 1 days, 0xBAD);
        vm.prank(alice);
        vm.expectRevert(INounsRepurchase.InvalidKycAttestation.selector);
        repurchase.requestRepurchase(_ids(0), 0, sig);
    }

    function test_kyc_attestationForAnotherMemberReverts() public {
        _enableKyc();
        bytes memory sig = _kycSig(bob, block.timestamp + 1 days, attestorPk);
        vm.prank(alice);
        vm.expectRevert(INounsRepurchase.InvalidKycAttestation.selector);
        repurchase.requestRepurchase(_ids(0), 0, sig);
    }

    function test_kyc_disablingAttestorReopensProgram() public {
        _enableKyc();
        vm.prank(treasury);
        repurchase.setKycAttestor(address(0));
        _request(alice, _ids(0));
        assertEq(nouns.ownerOf(0), address(repurchase));
    }

    // ───────────────────────────── admin ─────────────────────────────

    function test_admin_ownerIsTreasury() public {
        assertEq(repurchase.owner(), treasury);
    }

    function test_admin_onlyOwner() public {
        address[] memory holders = new address[](0);
        INounsRepurchase.Asset[] memory assets = new INounsRepurchase.Asset[](0);
        vm.startPrank(alice);
        vm.expectRevert('Ownable: caller is not the owner');
        repurchase.setSpreadBps(1);
        vm.expectRevert('Ownable: caller is not the owner');
        repurchase.setMaxPerTick(1);
        vm.expectRevert('Ownable: caller is not the owner');
        repurchase.setTickDuration(1);
        vm.expectRevert('Ownable: caller is not the owner');
        repurchase.setLiabilityReserve(1);
        vm.expectRevert('Ownable: caller is not the owner');
        repurchase.setSanctionsOracle(IChainalysisSanctionsList(address(0)));
        vm.expectRevert('Ownable: caller is not the owner');
        repurchase.setKycAttestor(address(0));
        vm.expectRevert('Ownable: caller is not the owner');
        repurchase.setAssets(assets);
        vm.expectRevert('Ownable: caller is not the owner');
        repurchase.setExtraExcludedHolders(holders);
        vm.expectRevert('Ownable: caller is not the owner');
        repurchase.returnFundsToTreasury(1);
        vm.expectRevert('Ownable: caller is not the owner');
        repurchase.recoverStrayNoun(0);
        vm.expectRevert('Ownable: caller is not the owner');
        repurchase.pause();
        vm.expectRevert('Ownable: caller is not the owner');
        repurchase.unpause();
        vm.stopPrank();
    }

    function test_admin_spreadCappedAt25Percent() public {
        vm.startPrank(treasury);
        repurchase.setSpreadBps(2_500);
        vm.expectRevert(INounsRepurchase.SpreadTooHigh.selector);
        repurchase.setSpreadBps(2_501);
        vm.stopPrank();
    }

    function test_admin_zeroParamsRejected() public {
        vm.startPrank(treasury);
        vm.expectRevert(INounsRepurchase.ZeroMaxPerTick.selector);
        repurchase.setMaxPerTick(0);
        vm.expectRevert(INounsRepurchase.ZeroTickDuration.selector);
        repurchase.setTickDuration(0);
        address[] memory holders = new address[](1);
        vm.expectRevert(INounsRepurchase.ZeroAddress.selector);
        repurchase.setExtraExcludedHolders(holders);
        INounsRepurchase.Asset[] memory assets = new INounsRepurchase.Asset[](1);
        vm.expectRevert(INounsRepurchase.ZeroAddress.selector);
        repurchase.setAssets(assets);
        vm.stopPrank();
    }

    function test_admin_returnFundsGoesOnlyToTreasury() public {
        uint256 before = treasury.balance;
        vm.prank(treasury);
        repurchase.returnFundsToTreasury(10 ether);
        assertEq(treasury.balance, before + 10 ether);
    }

    function test_admin_recoverStrayNoun() public {
        vm.prank(alice);
        nouns.transferFrom(alice, address(repurchase), 0); // plain transfer, no request
        vm.prank(treasury);
        repurchase.recoverStrayNoun(0);
        assertEq(nouns.ownerOf(0), treasury);
    }

    function test_admin_recoverStrayNoun_cannotTouchTrackedNoun() public {
        _request(alice, _ids(0));
        vm.prank(treasury);
        vm.expectRevert(abi.encodeWithSelector(INounsRepurchase.NounIsTracked.selector, 0));
        repurchase.recoverStrayNoun(0);
    }

    function test_straySafeTransferRejected() public {
        vm.prank(alice);
        vm.expectRevert('NounsRepurchase: use requestRepurchase');
        nouns.safeTransferFrom(alice, address(repurchase), 0);
    }
}

/// @dev End-to-end against the real NounsToken (descriptor, seeder, nounders mint) rather than a mock.
contract NounsRepurchaseWithRealTokenTest is Test, DeployUtils {
    NounsToken nouns;
    NounsRepurchase repurchase;
    ChainalysisSanctionsListMock sanctions;
    WETH weth;

    address treasury = makeAddr('treasury');
    address noundersDAO = makeAddr('nounders');
    address minter = makeAddr('minter');
    address alice = makeAddr('alice');

    function setUp() public {
        vm.warp(1_700_000_000);
        nouns = deployToken(noundersDAO, minter);
        sanctions = new ChainalysisSanctionsListMock();
        weth = new WETH();

        INounsRepurchase.Asset[] memory assets = new INounsRepurchase.Asset[](0);
        address[] memory excluded = new address[](0);
        repurchase = new NounsRepurchase(
            IERC721Enumerable(address(nouns)),
            treasury,
            address(weth),
            IChainalysisSanctionsList(address(sanctions)),
            address(0),
            300,
            1,
            1 days,
            0,
            assets,
            excluded
        );

        // Mint Nouns 0 (nounders) and 1, then 2 (minter). Give 1 and 2 to alice.
        vm.startPrank(minter);
        uint256 id1 = nouns.mint();
        uint256 id2 = nouns.mint();
        nouns.transferFrom(minter, alice, id1);
        nouns.transferFrom(minter, alice, id2);
        vm.stopPrank();

        vm.deal(treasury, 30 ether);
        vm.deal(address(repurchase), 30 ether);
    }

    function test_realToken_fullExit() public {
        // supply 3 (nounders' #0, alice's #1 and #2), gross 60 ETH => NAV 20 ETH, price 19.4 ETH
        assertEq(nouns.totalSupply(), 3);
        assertEq(repurchase.navPerNoun(), 20 ether);
        assertEq(repurchase.repurchasePrice(), 19.4 ether);

        vm.startPrank(alice);
        nouns.setApprovalForAll(address(repurchase), true);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        repurchase.requestRepurchase(ids, 19 ether, '');
        vm.stopPrank();

        uint256 before = alice.balance;
        assertEq(repurchase.settle(), 1);
        assertEq(alice.balance - before, 19.4 ether);
        assertEq(nouns.ownerOf(1), treasury);

        // Treasury-held Noun leaves the denominator; NAV per remaining Noun rose because of the spread.
        assertEq(repurchase.circulatingSupply(), 2);
        assertGt(repurchase.navPerNoun(), 20 ether);
    }
}
