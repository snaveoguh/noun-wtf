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
    address carol = makeAddr('carol');
    uint256 attestorPk = 0xA11CE;
    address attestor;

    uint16 constant MIN_DISCOUNT = 0;
    uint16 constant MAX_FILLS = 10;
    uint32 constant ROUND = 7 days;
    uint256 constant BUDGET = 1_000 ether;

    function setUp() public {
        vm.warp(1_700_000_000);
        attestor = vm.addr(attestorPk);

        nouns = new NounsEnumerableMock();
        sanctions = new ChainalysisSanctionsListMock();
        lst = new ERC20Mock();
        weth = new WETH();

        repurchase = _deploy(_params(MIN_DISCOUNT, BUDGET), address(0));

        // 11 minted: 5 to alice (0-4), 4 to bob (5-8), 1 to the treasury, 1 on auction. 9 circulating.
        for (uint256 i = 0; i < 5; ++i) nouns.mintTo(alice);
        for (uint256 i = 0; i < 4; ++i) nouns.mintTo(bob);
        nouns.mintTo(treasury);
        nouns.mintTo(auctionHouse);

        // Gross assets: 200 ETH in treasury + 300 ETH in the program + 500 LST at 1:1 = 1000 ETH over 9 Nouns.
        vm.deal(treasury, 200 ether);
        vm.deal(address(repurchase), 300 ether);
        lst.mint(treasury, 500 ether);

        _approve(alice);
        _approve(bob);
    }

    function _params(uint16 minDiscount, uint256 budget) internal pure returns (INounsRepurchase.AuctionParams memory) {
        return
            INounsRepurchase.AuctionParams({
                minDiscountBps: minDiscount,
                maxFillsPerRound: MAX_FILLS,
                roundDuration: ROUND,
                budgetPerRound: budget
            });
    }

    function _deploy(
        INounsRepurchase.AuctionParams memory params,
        address kycAttestor
    ) internal returns (NounsRepurchase r) {
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
            params,
            0,
            assets,
            excluded
        );
        vm.prank(treasury);
        r.unpause();
    }

    function _approve(address who) internal {
        vm.prank(who);
        nouns.setApprovalForAll(address(repurchase), true);
    }

    function _setParams(uint16 minDiscount, uint256 budget) internal {
        vm.prank(treasury);
        repurchase.setAuctionParams(_params(minDiscount, budget));
    }

    function _setBudget(uint256 budget) internal {
        _setParams(MIN_DISCOUNT, budget);
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

    function _ask(address who, uint256[] memory ids, uint16 discountBps) internal {
        vm.prank(who);
        repurchase.placeAsks(ids, discountBps, 0, '');
    }

    function _ask(address who, uint256[] memory ids, uint16 discountBps, uint256 minPrice) internal {
        vm.prank(who);
        repurchase.placeAsks(ids, discountBps, minPrice, '');
    }

    function _price(uint16 discountBps) internal view returns (uint256) {
        return repurchase.priceAtDiscount(discountBps);
    }

    // ───────────────────────────── NAV ─────────────────────────────

    function test_navPerNoun_excludesDaoHeldNounsAndCountsAllAssets() public {
        assertEq(repurchase.circulatingSupply(), 9);
        assertEq(repurchase.totalAssetsEth(), 1000 ether);
        assertEq(repurchase.navPerNoun(), uint256(1000 ether) / 9);
        assertEq(_price(0), uint256(1000 ether) / 9);
        assertEq(_price(1000), ((uint256(1000 ether) / 9) * 9000) / 10_000);
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
        assertEq(_price(0), 0);
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
        _ask(alice, _ids(0, 1), 1000);
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
            _params(0, 1 ether),
            0,
            assets,
            excluded
        );
        vm.expectRevert(INounsRepurchase.NoCirculatingNouns.selector);
        r.navPerNoun();
    }

    function test_priceAtDiscount_rejectsOffStepDiscount() public {
        vm.expectRevert(abi.encodeWithSelector(INounsRepurchase.InvalidDiscount.selector, 75));
        repurchase.priceAtDiscount(75);
    }

    // ───────────────────────────── place / update / cancel ─────────────────────────────

    function test_placeAsks_escrowsNounsIntoTheirLevel() public {
        _ask(alice, _ids(0, 1), 1500, 1 ether);

        assertEq(nouns.ownerOf(0), address(repurchase));
        assertEq(nouns.ownerOf(1), address(repurchase));
        (
            address owner,
            uint40 placedAt,
            uint8 level,
            uint48 slot,
            INounsRepurchase.FreezeReason frozen,
            uint128 minPrice
        ) = repurchase.asks(1);
        assertEq(owner, alice);
        assertEq(placedAt, block.timestamp);
        assertEq(level, 30); // 1500 bps / 50
        assertEq(slot, 1);
        assertEq(uint8(frozen), uint8(INounsRepurchase.FreezeReason.None));
        assertEq(minPrice, 1 ether);

        assertEq(repurchase.liveAsks(), 2);
        assertEq(repurchase.levelLive(30), 2);
        assertEq(repurchase.activeLevels(), uint256(1) << 30);
        assertEq(repurchase.levelQueueLength(1500), 2);
        assertEq(repurchase.levelQueueAt(1500, 1), 1);
    }

    function test_placeAsks_revertsForNonOwner() public {
        vm.prank(bob);
        vm.expectRevert('ERC721: transfer from incorrect owner');
        repurchase.placeAsks(_ids(0), 0, 0, '');
    }

    function test_placeAsks_revertsWithoutApproval() public {
        vm.prank(alice);
        nouns.setApprovalForAll(address(repurchase), false);
        vm.prank(alice);
        vm.expectRevert('ERC721: caller is not token owner or approved');
        repurchase.placeAsks(_ids(0), 0, 0, '');
    }

    function test_placeAsks_revertsForSanctionedWallet() public {
        sanctions.setSanctioned(alice, true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(INounsRepurchase.SanctionedMember.selector, alice));
        repurchase.placeAsks(_ids(0), 0, 0, '');
    }

    function test_placeAsks_revertsWhenPaused() public {
        vm.prank(treasury);
        repurchase.pause();
        vm.prank(alice);
        vm.expectRevert('Pausable: paused');
        repurchase.placeAsks(_ids(0), 0, 0, '');
    }

    function test_placeAsks_rejectsInvalidDiscounts() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(INounsRepurchase.InvalidDiscount.selector, 75));
        repurchase.placeAsks(_ids(0), 75, 0, ''); // not a 0.5% step
        vm.expectRevert(abi.encodeWithSelector(INounsRepurchase.InvalidDiscount.selector, 5050));
        repurchase.placeAsks(_ids(0), 5050, 0, ''); // deeper than 50%
        vm.stopPrank();

        _setParams(200, BUDGET);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(INounsRepurchase.InvalidDiscount.selector, 150));
        repurchase.placeAsks(_ids(0), 150, 0, ''); // shallower than the DAO's minimum
    }

    function test_placeAsks_acceptsMaxDiscount() public {
        _ask(alice, _ids(0), 5000);
        assertEq(repurchase.levelLive(100), 1);
        assertEq(repurchase.activeLevels(), uint256(1) << 100);
    }

    function test_cancelAsks_returnsNoun() public {
        _ask(alice, _ids(0), 1000);
        vm.prank(alice);
        repurchase.cancelAsks(_ids(0));
        assertEq(nouns.ownerOf(0), alice);
        (address owner, , , , , ) = repurchase.asks(0);
        assertEq(owner, address(0));
        assertEq(repurchase.liveAsks(), 0);
        assertEq(repurchase.activeLevels(), 0);
    }

    function test_cancelAsks_revertsForNonOwner() public {
        _ask(alice, _ids(0), 1000);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(INounsRepurchase.NotAskOwner.selector, 0));
        repurchase.cancelAsks(_ids(0));
    }

    function test_cancelAsks_allowedWhilePaused() public {
        _ask(alice, _ids(0), 1000);
        vm.prank(treasury);
        repurchase.pause();
        vm.prank(alice);
        repurchase.cancelAsks(_ids(0));
        assertEq(nouns.ownerOf(0), alice);
    }

    function test_updateAsks_movesLevelAndCounts() public {
        _ask(alice, _ids(0), 1000);
        vm.prank(alice);
        repurchase.updateAsks(_ids(0), 2000, 0);

        (, , uint8 level, uint48 slot, , ) = repurchase.asks(0);
        assertEq(level, 40);
        assertEq(slot, 0);
        assertEq(repurchase.levelLive(20), 0);
        assertEq(repurchase.levelLive(40), 1);
        assertEq(repurchase.liveAsks(), 1);
        assertEq(repurchase.activeLevels(), uint256(1) << 40);
    }

    function test_updateAsks_revertsForNonOwner() public {
        _ask(alice, _ids(0), 1000);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(INounsRepurchase.NotAskOwner.selector, 0));
        repurchase.updateAsks(_ids(0), 1000, 0);
    }

    /// @dev Re-pricing (or cancel + re-ask) loses time priority at that discount.
    function test_updateAsks_goesToBackOfLevel() public {
        _ask(alice, _ids(0), 1000);
        _ask(bob, _ids(5), 1000);
        vm.prank(alice);
        repurchase.updateAsks(_ids(0), 1000, 0);

        _setBudget(_price(1000)); // room for exactly one Noun
        assertEq(repurchase.settle(), 1);
        assertEq(nouns.ownerOf(5), treasury); // bob first
        assertEq(nouns.ownerOf(0), address(repurchase)); // alice still waiting

        vm.warp(block.timestamp + ROUND);
        _setBudget(BUDGET);
        assertEq(repurchase.settle(), 1);
        assertEq(nouns.ownerOf(0), treasury);
    }

    function test_cancelThenReask_goesToBackOfLevel() public {
        _ask(alice, _ids(0), 1000);
        _ask(bob, _ids(5), 1000);
        vm.prank(alice);
        repurchase.cancelAsks(_ids(0));
        _ask(alice, _ids(0), 1000);

        _setBudget(_price(1000));
        assertEq(repurchase.settle(), 1);
        assertEq(nouns.ownerOf(5), treasury);
        assertEq(nouns.ownerOf(0), address(repurchase));
    }

    // ───────────────────────────── settle: auction ─────────────────────────────

    function test_settle_paysAndMovesNounToTreasury() public {
        _ask(alice, _ids(0), 1000);

        uint256 price = _price(1000);
        uint256 aliceBefore = alice.balance;

        assertEq(repurchase.settle(), 1);

        assertEq(alice.balance, aliceBefore + price);
        assertEq(nouns.ownerOf(0), treasury);
        assertEq(repurchase.liveAsks(), 0);
        assertEq(repurchase.activeLevels(), 0);
        assertEq(repurchase.lastRoundAt(), block.timestamp);
        (address owner, , , , , ) = repurchase.asks(0);
        assertEq(owner, address(0));
    }

    /// @dev The member willing to take the bigger haircut leaves first, even if they asked later.
    function test_settle_deepestDiscountFillsFirst() public {
        _ask(alice, _ids(0), 500);
        _ask(bob, _ids(5), 2000);

        _setBudget(_price(2000)); // room for one Noun at the 20% price
        assertEq(repurchase.settle(), 1);
        assertEq(nouns.ownerOf(5), treasury);
        assertEq(nouns.ownerOf(0), address(repurchase));
    }

    /// @dev Uniform clearing price: everyone filled gets the shallowest discount that filled.
    function test_settle_uniformClearingPrice() public {
        _ask(alice, _ids(0), 2000);
        _ask(bob, _ids(5), 1000);

        uint256 clearing = _price(1000);
        uint256 nav = repurchase.navPerNoun();
        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;

        vm.expectEmit(true, true, true, true);
        emit INounsRepurchase.RoundSettled(1000, clearing, 2, nav);
        assertEq(repurchase.settle(), 2);

        // Alice asked for 20% off but is paid at the 10% clearing discount, like bob.
        assertEq(alice.balance - aliceBefore, clearing);
        assertEq(bob.balance - bobBefore, clearing);
    }

    /// @dev A shallower ask only fills if everyone already filled can be paid its (higher) price.
    function test_settle_shallowerAskWaitsWhenItWouldBustBudget() public {
        _ask(alice, _ids(0), 4000); // 40% off
        _ask(bob, _ids(5), 0); // at NAV

        // 1.5 NAV: alice alone fits (0.6 NAV), both at NAV (2 NAV) does not.
        _setBudget((repurchase.navPerNoun() * 3) / 2);

        uint256 expected = _price(4000);
        uint256 aliceBefore = alice.balance;
        assertEq(repurchase.settle(), 1);
        assertEq(alice.balance - aliceBefore, expected);
        assertEq(nouns.ownerOf(5), address(repurchase));
        assertEq(repurchase.liveAsks(), 1);
    }

    function test_settle_budgetLimitsFillsAndKeepsFifoWithinLevel() public {
        _ask(alice, _ids(0, 1), 1000);
        _ask(bob, _ids(5), 1000);

        _setBudget(2 * _price(1000));
        assertEq(repurchase.settle(), 2);
        assertEq(nouns.ownerOf(0), treasury);
        assertEq(nouns.ownerOf(1), treasury);
        assertEq(nouns.ownerOf(5), address(repurchase));
        assertEq(repurchase.levelHead(20), 2);

        vm.expectRevert(abi.encodeWithSelector(INounsRepurchase.RoundNotElapsed.selector, block.timestamp + ROUND));
        repurchase.settle();

        vm.warp(block.timestamp + ROUND);
        _setBudget(BUDGET);
        vm.deal(address(repurchase), 300 ether); // DAO tops the program up for the next round
        assertEq(repurchase.settle(), 1);
        assertEq(nouns.ownerOf(5), treasury);
    }

    /// @dev Throughput is set by the budget, not a count: a backlog clears in one round when funded.
    function test_settle_clearsBacklogInOneRound() public {
        _ask(alice, _ids(0, 1), 1000);
        _ask(bob, _ids(5, 6), 1500);
        vm.deal(address(repurchase), 1_000 ether);

        assertEq(repurchase.settle(), 4);
        assertEq(repurchase.liveAsks(), 0);
    }

    function test_settle_respectsMaxFills() public {
        vm.prank(treasury);
        repurchase.setAuctionParams(
            INounsRepurchase.AuctionParams({
                minDiscountBps: 0,
                maxFillsPerRound: 1,
                roundDuration: ROUND,
                budgetPerRound: BUDGET
            })
        );
        _ask(alice, _ids(0, 1), 1000);
        assertEq(repurchase.settle(), 1);
        assertEq(repurchase.liveAsks(), 1);
    }

    function test_settle_budgetCappedByBalance() public {
        uint256 keep = _price(1000); // leaves exactly one Noun's worth
        vm.prank(treasury);
        repurchase.returnFundsToTreasury(300 ether - keep);
        _ask(alice, _ids(0, 1), 1000);
        assertEq(repurchase.settle(), 1);
    }

    /// @dev Asks shallower than a newly raised DAO minimum stay in the book but do not fill.
    function test_settle_ignoresAsksBelowRaisedMinimum() public {
        _ask(alice, _ids(0), 100);
        _ask(bob, _ids(5), 1000);
        _setParams(500, BUDGET);

        assertEq(repurchase.settle(), 1);
        assertEq(nouns.ownerOf(5), treasury);
        assertEq(nouns.ownerOf(0), address(repurchase));
        assertEq(repurchase.liveAsks(), 1);
    }

    function test_settle_skipsCancelledEntries() public {
        _ask(alice, _ids(0, 1), 1000);
        vm.prank(alice);
        repurchase.cancelAsks(_ids(0));

        assertEq(repurchase.settle(), 1);
        assertEq(nouns.ownerOf(0), alice);
        assertEq(nouns.ownerOf(1), treasury);
        assertEq(repurchase.levelHead(20), 2);
    }

    function test_settle_skipsStaleSlotAfterUpdate() public {
        _ask(alice, _ids(0), 1000);
        vm.prank(alice);
        repurchase.updateAsks(_ids(0), 1000, 0); // slot 0 stale, slot 1 live
        assertEq(repurchase.settle(), 1);
        assertEq(nouns.ownerOf(0), treasury);
        assertEq(repurchase.levelHead(20), 2);
    }

    function test_settle_freezesSanctionedOwnerAndAllowsCancel() public {
        _ask(alice, _ids(0), 2000);
        _ask(bob, _ids(5), 1000);

        sanctions.setSanctioned(alice, true);
        uint256 aliceBefore = alice.balance;

        assertEq(repurchase.settle(), 1);
        assertEq(alice.balance, aliceBefore);
        assertEq(nouns.ownerOf(0), address(repurchase));
        assertEq(nouns.ownerOf(5), treasury);
        (address owner, , , , INounsRepurchase.FreezeReason frozen, ) = repurchase.asks(0);
        assertEq(owner, alice);
        assertEq(uint8(frozen), uint8(INounsRepurchase.FreezeReason.Sanctioned));
        assertEq(repurchase.liveAsks(), 0);

        // Frozen ask is out of the book, but the Noun is still alice's to withdraw.
        vm.prank(alice);
        repurchase.cancelAsks(_ids(0));
        assertEq(nouns.ownerOf(0), alice);
        assertEq(repurchase.liveAsks(), 0);
    }

    function test_settle_sanctionedOwnerCannotUpdate() public {
        _ask(alice, _ids(0), 1000);
        sanctions.setSanctioned(alice, true);
        repurchase.settle();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(INounsRepurchase.SanctionedMember.selector, alice));
        repurchase.updateAsks(_ids(0), 1000, 0);
    }

    function test_settle_freezesBelowMinPriceAndUpdateReenters() public {
        uint256 price = _price(1000);
        _ask(alice, _ids(0), 1000, price + 1);
        _ask(bob, _ids(5), 1000);

        assertEq(repurchase.settle(), 1);
        assertEq(nouns.ownerOf(5), treasury);
        (, , , , INounsRepurchase.FreezeReason frozen, ) = repurchase.asks(0);
        assertEq(uint8(frozen), uint8(INounsRepurchase.FreezeReason.BelowMinPrice));

        // Alice drops her floor and goes back in the book.
        vm.prank(alice);
        repurchase.updateAsks(_ids(0), 1000, 0);
        (, , , uint48 slot, INounsRepurchase.FreezeReason frozenAfter, ) = repurchase.asks(0);
        assertEq(slot, 2);
        assertEq(uint8(frozenAfter), uint8(INounsRepurchase.FreezeReason.None));
        assertEq(repurchase.liveAsks(), 1);

        vm.warp(block.timestamp + ROUND);
        assertEq(repurchase.settle(), 1);
        assertEq(nouns.ownerOf(0), treasury);
    }

    /// @dev A proposal that slashes NAV right before settle cannot sell a member below their floor.
    function test_settle_minPriceProtectsAgainstNavDrop() public {
        uint256 price = _price(1000);
        _ask(alice, _ids(0), 1000, price);
        vm.prank(treasury);
        repurchase.setLiabilityReserve(500 ether);

        assertEq(repurchase.settle(), 0);
        assertEq(nouns.ownerOf(0), address(repurchase));
    }

    function test_settle_noFillsDoesNotStartRound() public {
        vm.prank(treasury);
        repurchase.returnFundsToTreasury(300 ether);

        _ask(alice, _ids(0), 1000);

        assertEq(repurchase.settle(), 0);
        assertEq(repurchase.lastRoundAt(), 0);
        assertEq(nouns.ownerOf(0), address(repurchase));
        assertEq(repurchase.liveAsks(), 1);

        // Top up and retry immediately: no round wait because nothing filled.
        vm.deal(address(repurchase), 200 ether);
        assertEq(repurchase.settle(), 1);
    }

    function test_settle_revertsWhenBookEmpty() public {
        vm.expectRevert(INounsRepurchase.NothingToSettle.selector);
        repurchase.settle();
    }

    function test_settle_revertsAtZeroNav() public {
        _ask(alice, _ids(0), 1000);
        vm.prank(treasury);
        repurchase.setLiabilityReserve(5000 ether);
        vm.expectRevert(INounsRepurchase.ZeroNav.selector);
        repurchase.settle();
    }

    function test_settle_revertsWhenPaused() public {
        _ask(alice, _ids(0), 1000);
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
        repurchase.placeAsks(_ids(id), 1000, 0, '');

        uint256 price = _price(1000);
        repurchase.settle();
        assertEq(weth.balanceOf(address(member)), price);
        assertEq(nouns.ownerOf(id), treasury);
    }

    // ───────────────────────────── settle: book value ─────────────────────────────

    /// @dev The core legal invariant: an exit at NAV leaves remaining members' book value unchanged.
    function test_settle_navUnchangedAtZeroDiscount() public {
        uint256 navBefore = repurchase.navPerNoun();
        _ask(alice, _ids(0), 0);
        repurchase.settle();
        assertApproxEqAbs(repurchase.navPerNoun(), navBefore, 1);
    }

    /// @dev An exit at discount d out of N circulating adds NAV * d / (N - 1) to every remaining Noun.
    function test_settle_exitAtDiscountRaisesEveryRemainingNoun() public {
        uint256 navBefore = repurchase.navPerNoun();
        _ask(alice, _ids(0), 2000);
        repurchase.settle();

        uint256 expected = navBefore + (navBefore * 2000) / 10_000 / 8;
        assertApproxEqAbs(repurchase.navPerNoun(), expected, 2);
    }

    /// @dev Fuzz: whatever the asks and budget, nobody is paid more than NAV or less than they asked, the round
    /// stays within budget, and NAV per remaining Noun never falls.
    function testFuzz_settle_auctionInvariants(uint16[4] memory discounts, uint96 budget, uint96 treasuryEth) public {
        treasuryEth = uint96(bound(treasuryEth, 0, 100_000 ether));
        vm.deal(treasury, treasuryEth);
        vm.deal(address(repurchase), 100_000 ether);
        budget = uint96(bound(budget, 1 ether, 50_000 ether));
        _setBudget(budget);

        uint256[4] memory ids = [uint256(0), 1, 5, 6];
        uint16[4] memory asked;
        for (uint256 i = 0; i < 4; ++i) {
            asked[i] = uint16(bound(discounts[i], 0, 100)) * 50;
            _ask(i < 2 ? alice : bob, _ids(ids[i]), asked[i]);
        }

        uint256 navBefore = repurchase.navPerNoun();
        (uint16 previewDiscount, uint256 previewPrice, uint256 previewCount) = repurchase.previewSettle();
        uint256 balanceBefore = address(repurchase).balance;
        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;

        uint256 filled = repurchase.settle();
        uint256 paid = balanceBefore - address(repurchase).balance;

        assertEq(filled, previewCount);
        assertLe(paid, budget);
        assertEq(paid, (alice.balance - aliceBefore) + (bob.balance - bobBefore));
        if (filled > 0) {
            uint256 clearing = paid / filled;
            assertEq(clearing, previewPrice);
            assertLe(clearing, navBefore);
            for (uint256 i = 0; i < 4; ++i) {
                if (nouns.ownerOf(ids[i]) == treasury) {
                    assertGe(clearing, (navBefore * (10_000 - uint256(asked[i]))) / 10_000);
                    assertGe(asked[i], previewDiscount);
                }
            }
        }
        assertGe(repurchase.navPerNoun() + 1, navBefore); // +1 absorbs integer rounding
    }

    function test_previewSettle_matchesSettle() public {
        _ask(alice, _ids(0, 1), 3000);
        _ask(bob, _ids(5), 1000);
        _ask(bob, _ids(6), 500);
        _setBudget(3 * _price(1000) + 1);

        (uint16 discount, uint256 price, uint256 count) = repurchase.previewSettle();
        assertEq(discount, 1000);
        assertEq(price, _price(1000));
        assertEq(count, 3);

        uint256 bobBefore = bob.balance;
        assertEq(repurchase.settle(), 3);
        assertEq(bob.balance - bobBefore, price);
        assertEq(nouns.ownerOf(6), address(repurchase));
    }

    function test_settle_gasForFullRound() public {
        address whale = makeAddr('whale');
        uint256[] memory ids = new uint256[](MAX_FILLS);
        for (uint256 i = 0; i < MAX_FILLS; ++i) ids[i] = nouns.mintTo(whale);
        _approve(whale);
        vm.prank(whale);
        repurchase.placeAsks(ids, 1000, 0, '');
        vm.deal(address(repurchase), 10_000 ether);
        _setBudget(10_000 ether);

        uint256 gasBefore = gasleft();
        assertEq(repurchase.settle(), MAX_FILLS);
        assertLt(gasBefore - gasleft(), 1_500_000);
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
        repurchase.placeAsks(_ids(0), 1000, 0, '');
    }

    function test_kyc_validAttestationPasses() public {
        _enableKyc();
        bytes memory sig = _kycSig(alice, block.timestamp + 30 days, attestorPk);
        vm.prank(alice);
        repurchase.placeAsks(_ids(0), 1000, 0, sig);
        assertEq(nouns.ownerOf(0), address(repurchase));
    }

    function test_kyc_expiredAttestationReverts() public {
        _enableKyc();
        bytes memory sig = _kycSig(alice, block.timestamp - 1, attestorPk);
        vm.prank(alice);
        vm.expectRevert(INounsRepurchase.InvalidKycAttestation.selector);
        repurchase.placeAsks(_ids(0), 1000, 0, sig);
    }

    function test_kyc_wrongSignerReverts() public {
        _enableKyc();
        bytes memory sig = _kycSig(alice, block.timestamp + 1 days, 0xBAD);
        vm.prank(alice);
        vm.expectRevert(INounsRepurchase.InvalidKycAttestation.selector);
        repurchase.placeAsks(_ids(0), 1000, 0, sig);
    }

    function test_kyc_attestationForAnotherMemberReverts() public {
        _enableKyc();
        bytes memory sig = _kycSig(bob, block.timestamp + 1 days, attestorPk);
        vm.prank(alice);
        vm.expectRevert(INounsRepurchase.InvalidKycAttestation.selector);
        repurchase.placeAsks(_ids(0), 1000, 0, sig);
    }

    function test_kyc_disablingAttestorReopensProgram() public {
        _enableKyc();
        vm.prank(treasury);
        repurchase.setKycAttestor(address(0));
        _ask(alice, _ids(0), 1000);
        assertEq(nouns.ownerOf(0), address(repurchase));
    }

    // ───────────────────────────── admin ─────────────────────────────

    function test_admin_ownerIsTreasury() public {
        assertEq(repurchase.owner(), treasury);
    }

    /// @dev Deployment does nothing on its own: asks and settles wait for the DAO to unpause.
    function test_admin_deploysPausedUntilDaoUnpauses() public {
        NounsRepurchase fresh = new NounsRepurchase(
            IERC721Enumerable(address(nouns)),
            treasury,
            address(weth),
            IChainalysisSanctionsList(address(sanctions)),
            address(0),
            _params(MIN_DISCOUNT, BUDGET),
            0,
            new INounsRepurchase.Asset[](0),
            new address[](0)
        );
        assertTrue(fresh.paused());
        assertEq(fresh.owner(), treasury);

        vm.startPrank(alice);
        nouns.setApprovalForAll(address(fresh), true);
        vm.expectRevert('Pausable: paused');
        fresh.placeAsks(_ids(0), 1000, 0, '');
        vm.expectRevert('Ownable: caller is not the owner');
        fresh.unpause();
        vm.stopPrank();

        vm.prank(treasury);
        fresh.unpause();
        vm.prank(alice);
        fresh.placeAsks(_ids(0), 1000, 0, '');
        assertEq(nouns.ownerOf(0), address(fresh));
    }

    function test_admin_onlyOwner() public {
        address[] memory holders = new address[](0);
        INounsRepurchase.Asset[] memory assets = new INounsRepurchase.Asset[](0);
        INounsRepurchase.AuctionParams memory params = _params(0, 1 ether);
        vm.startPrank(alice);
        vm.expectRevert('Ownable: caller is not the owner');
        repurchase.setAuctionParams(params);
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

    function test_admin_minDiscountCappedAndStepped() public {
        vm.startPrank(treasury);
        repurchase.setAuctionParams(_params(2_500, BUDGET));
        vm.expectRevert(INounsRepurchase.InvalidMinDiscount.selector);
        repurchase.setAuctionParams(_params(2_550, BUDGET));
        vm.expectRevert(INounsRepurchase.InvalidMinDiscount.selector);
        repurchase.setAuctionParams(_params(125, BUDGET));
        vm.stopPrank();
    }

    function test_admin_zeroParamsRejected() public {
        vm.startPrank(treasury);
        INounsRepurchase.AuctionParams memory p = _params(0, BUDGET);
        p.maxFillsPerRound = 0;
        vm.expectRevert(INounsRepurchase.ZeroMaxFills.selector);
        repurchase.setAuctionParams(p);
        p = _params(0, BUDGET);
        p.roundDuration = 0;
        vm.expectRevert(INounsRepurchase.ZeroRoundDuration.selector);
        repurchase.setAuctionParams(p);
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
        nouns.transferFrom(alice, address(repurchase), 0); // plain transfer, no ask
        vm.prank(treasury);
        repurchase.recoverStrayNoun(0);
        assertEq(nouns.ownerOf(0), treasury);
    }

    function test_admin_recoverStrayNoun_cannotTouchTrackedNoun() public {
        _ask(alice, _ids(0), 1000);
        vm.prank(treasury);
        vm.expectRevert(abi.encodeWithSelector(INounsRepurchase.NounIsTracked.selector, 0));
        repurchase.recoverStrayNoun(0);
    }

    function test_straySafeTransferRejected() public {
        vm.prank(alice);
        vm.expectRevert('NounsRepurchase: use placeAsks');
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
            INounsRepurchase.AuctionParams({
                minDiscountBps: 50,
                maxFillsPerRound: 50,
                roundDuration: 7 days,
                budgetPerRound: 30 ether
            }),
            0,
            assets,
            excluded
        );
        vm.prank(treasury);
        repurchase.unpause();

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
        // supply 3 (nounders' #0, alice's #1 and #2), gross 60 ETH => NAV 20 ETH; a 15% ask clears at 17 ETH
        assertEq(nouns.totalSupply(), 3);
        assertEq(repurchase.navPerNoun(), 20 ether);
        assertEq(repurchase.priceAtDiscount(1500), 17 ether);

        vm.startPrank(alice);
        nouns.setApprovalForAll(address(repurchase), true);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        repurchase.placeAsks(ids, 1500, 16 ether, '');
        vm.stopPrank();

        uint256 before = alice.balance;
        assertEq(repurchase.settle(), 1);
        assertEq(alice.balance - before, 17 ether);
        assertEq(nouns.ownerOf(1), treasury);

        // Treasury-held Noun leaves the denominator; NAV per remaining Noun rose by the 3 ETH haircut / 2.
        assertEq(repurchase.circulatingSupply(), 2);
        assertEq(repurchase.navPerNoun(), 21.5 ether);
    }
}
