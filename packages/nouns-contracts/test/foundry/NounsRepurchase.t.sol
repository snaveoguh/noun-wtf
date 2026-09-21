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
import { WETH } from '../../contracts/test/WETH.sol';
import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { IERC721Enumerable } from '@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol';
import { ERC721Enumerable, ERC721 } from '@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol';

/// @dev Minimal enumerable Noun stand-in so tests don't need the descriptor/art pipeline.
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

        // 10 circulating Nouns: 5 to alice, 4 to bob, 1 to the treasury (must be excluded from supply).
        for (uint256 i = 0; i < 5; ++i) nouns.mintTo(alice);
        for (uint256 i = 0; i < 4; ++i) nouns.mintTo(bob);
        nouns.mintTo(treasury);

        // Treasury: 500 ETH + 500 LST valued at 1:1 => 1000 ETH gross over 9 circulating Nouns.
        vm.deal(treasury, 500 ether);
        lst.mint(treasury, 500 ether);

        // Fund the program with 300 ETH (enough for two exits); this ETH still counts as DAO assets.
        vm.deal(address(repurchase), 300 ether);
        vm.deal(treasury, 200 ether);

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
            assets
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

    // ───────────────────────────── NAV ─────────────────────────────

    function test_navPerNoun_excludesTreasuryNounsAndCountsAllAssets() public {
        // gross = 200 (treasury ETH) + 300 (program ETH) + 500 (LST) = 1000; supply = 10 - 1 = 9
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
    }

    function test_navPerNoun_usesConverterRate() public {
        INounsRepurchase.Asset[] memory assets = new INounsRepurchase.Asset[](1);
        assets[0] = INounsRepurchase.Asset({
            token: IERC20(address(lst)),
            converter: IEthConverter(address(new FixedRateConverter(1.2e18)))
        });
        vm.prank(treasury);
        repurchase.setAssets(assets);
        // 500 ETH + 500 * 1.2 = 1100
        assertEq(repurchase.totalAssetsEth(), 1100 ether);
    }

    function test_navPerNoun_escrowedNounsStillCount() public {
        vm.prank(alice);
        repurchase.requestRepurchase(_ids(0, 1), '');
        assertEq(repurchase.circulatingSupply(), 9);
    }

    // ───────────────────────────── request / cancel ─────────────────────────────

    function test_requestRepurchase_escrowsNouns() public {
        vm.prank(alice);
        repurchase.requestRepurchase(_ids(0, 1), '');

        assertEq(nouns.ownerOf(0), address(repurchase));
        assertEq(nouns.ownerOf(1), address(repurchase));
        (address owner, , bool frozen) = repurchase.requests(0);
        assertEq(owner, alice);
        assertFalse(frozen);
        assertEq(repurchase.pendingCount(), 2);
    }

    function test_requestRepurchase_revertsForNonOwner() public {
        vm.prank(bob);
        vm.expectRevert('ERC721: transfer from incorrect owner');
        repurchase.requestRepurchase(_ids(0), '');
    }

    function test_requestRepurchase_revertsForSanctionedWallet() public {
        sanctions.setSanctioned(alice, true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(INounsRepurchase.SanctionedMember.selector, alice));
        repurchase.requestRepurchase(_ids(0), '');
    }

    function test_cancelRequest_returnsNoun() public {
        vm.prank(alice);
        repurchase.requestRepurchase(_ids(0), '');
        vm.prank(alice);
        repurchase.cancelRequest(_ids(0));
        assertEq(nouns.ownerOf(0), alice);
        (address owner, , ) = repurchase.requests(0);
        assertEq(owner, address(0));
    }

    function test_cancelRequest_revertsForNonOwner() public {
        vm.prank(alice);
        repurchase.requestRepurchase(_ids(0), '');
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(INounsRepurchase.NotRequestOwner.selector, 0));
        repurchase.cancelRequest(_ids(0));
    }

    function test_cancelRequest_allowedWhilePaused() public {
        vm.prank(alice);
        repurchase.requestRepurchase(_ids(0), '');
        vm.prank(treasury);
        repurchase.pause();
        vm.prank(alice);
        repurchase.cancelRequest(_ids(0));
        assertEq(nouns.ownerOf(0), alice);
    }

    // ───────────────────────────── settle ─────────────────────────────

    function test_settle_paysPriceAndMovesNounToTreasury() public {
        vm.prank(alice);
        repurchase.requestRepurchase(_ids(0), '');

        uint256 price = repurchase.repurchasePrice();
        uint256 aliceBefore = alice.balance;

        uint256 settled = repurchase.settle();

        assertEq(settled, 1);
        assertEq(alice.balance, aliceBefore + price);
        assertEq(nouns.ownerOf(0), treasury);
        assertEq(repurchase.pendingCount(), 0);
        assertEq(repurchase.lastTickAt(), block.timestamp);
    }

    /// @dev The core legal invariant: at zero spread, remaining members' book value is unchanged by an exit.
    function test_settle_navUnchangedAtZeroSpread() public {
        uint256 navBefore = repurchase.navPerNoun();
        vm.prank(alice);
        repurchase.requestRepurchase(_ids(0), '');
        repurchase.settle();
        // 1000 - 1000/9 assets over 8 nouns == 1000/9 (up to wei rounding)
        assertApproxEqAbs(repurchase.navPerNoun(), navBefore, 1);
    }

    /// @dev With a positive spread, every exit accretes value to the remaining members.
    function test_settle_navIncreasesWithSpread() public {
        repurchase = _deploy(500, address(0)); // 5%
        vm.deal(address(repurchase), 300 ether);
        vm.deal(treasury, 200 ether);
        vm.prank(alice);
        nouns.setApprovalForAll(address(repurchase), true);

        uint256 navBefore = repurchase.navPerNoun();
        assertEq(repurchase.repurchasePrice(), (navBefore * 9500) / 10_000);

        vm.prank(alice);
        repurchase.requestRepurchase(_ids(0), '');
        repurchase.settle();
        assertGt(repurchase.navPerNoun(), navBefore);
    }

    function test_settle_respectsMaxPerTickAndFifo() public {
        vm.prank(alice);
        repurchase.requestRepurchase(_ids(0, 1), '');
        vm.prank(bob);
        repurchase.requestRepurchase(_ids(5), '');

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
        vm.prank(alice);
        repurchase.requestRepurchase(_ids(0, 1), '');
        uint256 price = repurchase.repurchasePrice();
        uint256 before = alice.balance;
        repurchase.settle();
        // Both Nouns in the tick paid the same price, even though NAV shifts after the first.
        assertEq(alice.balance - before, 2 * price);
    }

    function test_settle_skipsCancelledEntries() public {
        vm.prank(alice);
        repurchase.requestRepurchase(_ids(0, 1), '');
        vm.prank(alice);
        repurchase.cancelRequest(_ids(0));

        assertEq(repurchase.settle(), 1);
        assertEq(nouns.ownerOf(0), alice);
        assertEq(nouns.ownerOf(1), treasury);
        assertEq(repurchase.pendingCount(), 0);
    }

    function test_settle_freezesSanctionedOwnerAndAllowsCancel() public {
        vm.prank(alice);
        repurchase.requestRepurchase(_ids(0), '');
        vm.prank(bob);
        repurchase.requestRepurchase(_ids(5), '');

        sanctions.setSanctioned(alice, true);
        uint256 aliceBefore = alice.balance;

        assertEq(repurchase.settle(), 1);
        assertEq(alice.balance, aliceBefore);
        assertEq(nouns.ownerOf(0), address(repurchase));
        assertEq(nouns.ownerOf(5), treasury);
        (address owner, , bool frozen) = repurchase.requests(0);
        assertEq(owner, alice);
        assertTrue(frozen);

        // Frozen entry is out of the queue for good, but the Noun is still alice's to withdraw.
        vm.prank(alice);
        repurchase.cancelRequest(_ids(0));
        assertEq(nouns.ownerOf(0), alice);
    }

    function test_settle_stopsOnInsufficientFundsWithoutAdvancingTick() public {
        // Drain program funding down to less than one Noun's price.
        vm.prank(treasury);
        repurchase.returnFundsToTreasury(300 ether);
        assertEq(address(repurchase).balance, 0);

        vm.prank(alice);
        repurchase.requestRepurchase(_ids(0), '');

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
        vm.prank(alice);
        repurchase.requestRepurchase(_ids(0), '');
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
        repurchase.requestRepurchase(_ids(id), '');

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
        repurchase.requestRepurchase(_ids(0), '');
    }

    function test_kyc_validAttestationPasses() public {
        _enableKyc();
        bytes memory sig = _kycSig(alice, block.timestamp + 30 days, attestorPk);
        vm.prank(alice);
        repurchase.requestRepurchase(_ids(0), sig);
        assertEq(nouns.ownerOf(0), address(repurchase));
    }

    function test_kyc_expiredAttestationReverts() public {
        _enableKyc();
        bytes memory sig = _kycSig(alice, block.timestamp - 1, attestorPk);
        vm.prank(alice);
        vm.expectRevert(INounsRepurchase.InvalidKycAttestation.selector);
        repurchase.requestRepurchase(_ids(0), sig);
    }

    function test_kyc_wrongSignerReverts() public {
        _enableKyc();
        bytes memory sig = _kycSig(alice, block.timestamp + 1 days, 0xBAD);
        vm.prank(alice);
        vm.expectRevert(INounsRepurchase.InvalidKycAttestation.selector);
        repurchase.requestRepurchase(_ids(0), sig);
    }

    function test_kyc_attestationForAnotherMemberReverts() public {
        _enableKyc();
        bytes memory sig = _kycSig(bob, block.timestamp + 1 days, attestorPk);
        vm.prank(alice);
        vm.expectRevert(INounsRepurchase.InvalidKycAttestation.selector);
        repurchase.requestRepurchase(_ids(0), sig);
    }

    // ───────────────────────────── admin ─────────────────────────────

    function test_admin_ownerIsTreasury() public {
        assertEq(repurchase.owner(), treasury);
    }

    function test_admin_onlyOwner() public {
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
        repurchase.returnFundsToTreasury(1);
        vm.expectRevert('Ownable: caller is not the owner');
        repurchase.pause();
        vm.stopPrank();
    }

    function test_admin_spreadCannotExceed100Percent() public {
        vm.prank(treasury);
        vm.expectRevert(INounsRepurchase.SpreadTooHigh.selector);
        repurchase.setSpreadBps(10_001);
    }

    function test_admin_zeroParamsRejected() public {
        vm.startPrank(treasury);
        vm.expectRevert(INounsRepurchase.ZeroMaxPerTick.selector);
        repurchase.setMaxPerTick(0);
        vm.expectRevert(INounsRepurchase.ZeroTickDuration.selector);
        repurchase.setTickDuration(0);
        vm.stopPrank();
    }

    function test_admin_returnFundsGoesOnlyToTreasury() public {
        uint256 before = treasury.balance;
        vm.prank(treasury);
        repurchase.returnFundsToTreasury(10 ether);
        assertEq(treasury.balance, before + 10 ether);
    }

    function test_straySafeTransferRejected() public {
        vm.prank(alice);
        vm.expectRevert('NounsRepurchase: use requestRepurchase');
        nouns.safeTransferFrom(alice, address(repurchase), 0);
    }
}
