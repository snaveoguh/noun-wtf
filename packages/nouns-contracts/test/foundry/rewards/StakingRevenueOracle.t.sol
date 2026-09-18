// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.19;

import 'forge-std/Test.sol';
import { StakingRevenueOracle } from '../../../contracts/client-incentives/StakingRevenueOracle.sol';
import { LSTMock, RebasingLSTMock } from '../helpers/StakingMocks.sol';

contract StakingRevenueOracleTest is Test {
    StakingRevenueOracle oracle;
    LSTMock lst;
    RebasingLSTMock rebasing;

    address owner = makeAddr('owner');
    address consumer = makeAddr('consumer');
    address treasury = makeAddr('treasury');
    address rando = makeAddr('rando');

    function setUp() public {
        oracle = new StakingRevenueOracle(owner, consumer, 0);
        lst = new LSTMock(1e18);
        rebasing = new RebasingLSTMock(1e18);
    }

    function addLST(uint256 balance) internal returns (uint256 index) {
        lst.setBalance(treasury, balance);
        vm.prank(owner);
        index = oracle.addAsset({
            name: 'LST',
            balanceProvider: address(lst),
            balanceCalldata: abi.encodeWithSignature('balanceOf(address)', treasury),
            rateProvider: address(lst),
            rateCalldata: abi.encodeWithSignature('getExchangeRate()')
        });
    }

    function consume() internal returns (uint256) {
        vm.prank(consumer);
        return oracle.consumeRevenue();
    }

    ///
    /// Core yield math
    ///

    function test_consumeRevenue_measuresRateDeltaOnHeldPrincipal() public {
        addLST(100 ether);

        // 1% rate increase on 100 ETH of principal is 1 ETH of yield
        lst.setRate(1.01e18);

        assertEq(oracle.pendingRevenue(), 1 ether);
        assertEq(consume(), 1 ether);
    }

    function test_consumeRevenue_isZeroWithoutRateMovement() public {
        addLST(100 ether);

        assertEq(oracle.pendingRevenue(), 0);
        assertEq(consume(), 0);
    }

    function test_consumeRevenue_doesNotDoubleCount() public {
        addLST(100 ether);

        lst.setRate(1.01e18);
        assertEq(consume(), 1 ether);

        // same rate, already consumed
        assertEq(consume(), 0);

        // only the new delta is credited
        lst.setRate(1.02e18);
        assertEq(consume(), 1 ether);
    }

    function test_consumeRevenue_rebasingTokenYieldsViaSharePrice() public {
        rebasing.setShares(treasury, 100 ether);
        vm.prank(owner);
        oracle.addAsset({
            name: 'stETH',
            balanceProvider: address(rebasing),
            balanceCalldata: abi.encodeWithSignature('sharesOf(address)', treasury),
            rateProvider: address(rebasing),
            rateCalldata: abi.encodeWithSignature('getPooledEthByShares(uint256)', 1e18)
        });

        rebasing.setEthPerShare(1.03e18);

        assertEq(consume(), 3 ether);
    }

    function test_consumeRevenue_sumsAcrossAssets() public {
        addLST(100 ether);

        rebasing.setShares(treasury, 200 ether);
        vm.prank(owner);
        oracle.addAsset({
            name: 'stETH',
            balanceProvider: address(rebasing),
            balanceCalldata: abi.encodeWithSignature('sharesOf(address)', treasury),
            rateProvider: address(rebasing),
            rateCalldata: abi.encodeWithSignature('getPooledEthByShares(uint256)', 1e18)
        });

        lst.setRate(1.01e18); // 1 ETH
        rebasing.setEthPerShare(1.005e18); // 1 ETH

        assertEq(consume(), 2 ether);
    }

    ///
    /// Principal is never mistaken for revenue
    ///

    function test_consumeRevenue_depositIsNotRevenue() public {
        addLST(100 ether);

        // the DAO stakes 10x more, with no yield accrued
        lst.setBalance(treasury, 1000 ether);

        assertEq(consume(), 0);
    }

    function test_consumeRevenue_withdrawalIsNotNegativeRevenue() public {
        addLST(100 ether);

        // the DAO spends most of the position, and the rate ticks up
        lst.setBalance(treasury, 10 ether);
        lst.setRate(1.01e18);

        // yield is earned only on what survived the period
        assertEq(consume(), 0.1 ether);
    }

    function test_consumeRevenue_donationCannotInflateThePeriod() public {
        addLST(100 ether);

        // a whole period's worth of rate movement accrues on a 100 ETH position
        lst.setRate(1.01e18);

        // attacker dumps 10,000 ETH into the treasury right before the update
        lst.setBalance(treasury, 10_100 ether);

        // principal is min(before, after), so the donation earns nothing this period
        assertEq(consume(), 1 ether);
    }

    function test_consumeRevenue_slashingReportsZeroRatherThanReverting() public {
        addLST(100 ether);

        lst.setRate(0.9e18);

        assertEq(oracle.pendingRevenue(), 0);
        assertEq(consume(), 0);

        // the snapshot moved down, so recovering to the old rate is credited as yield again
        lst.setRate(1e18);
        assertEq(consume(), 10 ether);
    }

    function test_addAsset_doesNotCreditRetroactively() public {
        // the rate has already run up a long way before the DAO starts tracking the asset
        lst.setRate(2e18);
        addLST(100 ether);

        assertEq(consume(), 0);
    }

    ///
    /// Guards
    ///

    function test_consumeRevenue_onlyConsumer() public {
        addLST(100 ether);
        lst.setRate(1.01e18);

        vm.expectRevert(StakingRevenueOracle.OnlyConsumer.selector);
        vm.prank(rando);
        oracle.consumeRevenue();

        vm.expectRevert(StakingRevenueOracle.OnlyConsumer.selector);
        vm.prank(owner);
        oracle.consumeRevenue();

        assertEq(consume(), 1 ether);
    }

    function test_pendingRevenue_doesNotConsume() public {
        addLST(100 ether);
        lst.setRate(1.01e18);

        assertEq(oracle.pendingRevenue(), 1 ether);
        assertEq(oracle.pendingRevenue(), 1 ether);
        assertEq(consume(), 1 ether);
    }

    function test_maxRevenuePerConsume_capsReportedRevenue() public {
        addLST(100 ether);
        vm.prank(owner);
        oracle.setMaxRevenuePerConsume(0.25 ether);

        lst.setRate(1.01e18); // would be 1 ETH

        assertEq(oracle.pendingRevenue(), 0.25 ether);
        assertEq(consume(), 0.25 ether);

        // the cap discards the excess rather than deferring it: snapshots still moved to the new rate
        assertEq(consume(), 0);
    }

    function test_maxRevenuePerConsume_zeroMeansUncapped() public {
        addLST(100 ether);
        lst.setRate(2e18);

        assertEq(consume(), 100 ether);
    }

    function test_resyncAssets_dropsAccrualWithoutCrediting() public {
        addLST(100 ether);
        lst.setRate(1.01e18);

        vm.prank(owner);
        oracle.resyncAssets();

        assertEq(consume(), 0);
    }

    function test_setAssetEnabled_skipsDisabledAsset() public {
        uint256 index = addLST(100 ether);

        vm.prank(owner);
        oracle.setAssetEnabled(index, false);

        lst.setRate(1.01e18);
        assertEq(consume(), 0);

        vm.prank(owner);
        oracle.setAssetEnabled(index, true);
        assertEq(consume(), 1 ether);
    }

    function test_removeAsset_swapsAndPops() public {
        addLST(100 ether);

        rebasing.setShares(treasury, 200 ether);
        vm.prank(owner);
        oracle.addAsset({
            name: 'stETH',
            balanceProvider: address(rebasing),
            balanceCalldata: abi.encodeWithSignature('sharesOf(address)', treasury),
            rateProvider: address(rebasing),
            rateCalldata: abi.encodeWithSignature('getPooledEthByShares(uint256)', 1e18)
        });
        assertEq(oracle.numAssets(), 2);

        vm.prank(owner);
        oracle.removeAsset(0);

        assertEq(oracle.numAssets(), 1);
        assertEq(oracle.getAsset(0).name, 'stETH');

        // the removed asset no longer contributes
        lst.setRate(1.01e18);
        assertEq(consume(), 0);
    }

    function test_addAsset_revertsOnUnreadableRate() public {
        vm.expectRevert();
        vm.prank(owner);
        oracle.addAsset({
            name: 'broken',
            balanceProvider: address(lst),
            balanceCalldata: abi.encodeWithSignature('balanceOf(address)', treasury),
            rateProvider: address(lst),
            rateCalldata: abi.encodeWithSignature('reverting()')
        });
    }

    function test_adminFunctions_onlyOwner() public {
        vm.startPrank(rando);

        vm.expectRevert('Ownable: caller is not the owner');
        oracle.addAsset('x', address(lst), '', address(lst), '');

        vm.expectRevert('Ownable: caller is not the owner');
        oracle.setConsumer(rando);

        vm.expectRevert('Ownable: caller is not the owner');
        oracle.setMaxRevenuePerConsume(1);

        vm.expectRevert('Ownable: caller is not the owner');
        oracle.resyncAssets();

        vm.stopPrank();
    }

    function test_setConsumer_movesConsumeRights() public {
        addLST(100 ether);
        lst.setRate(1.01e18);

        vm.prank(owner);
        oracle.setConsumer(rando);

        vm.expectRevert(StakingRevenueOracle.OnlyConsumer.selector);
        vm.prank(consumer);
        oracle.consumeRevenue();

        vm.prank(rando);
        assertEq(oracle.consumeRevenue(), 1 ether);
    }

    ///
    /// A broken rate source must not be able to block rewards
    ///

    function test_consumeRevenue_skipsUnreadableAssetInsteadOfReverting() public {
        uint256 index = addLST(100 ether);

        rebasing.setShares(treasury, 100 ether);
        vm.prank(owner);
        oracle.addAsset({
            name: 'stETH',
            balanceProvider: address(rebasing),
            balanceCalldata: abi.encodeWithSignature('sharesOf(address)', treasury),
            rateProvider: address(rebasing),
            rateCalldata: abi.encodeWithSignature('getPooledEthByShares(uint256)', 1e18)
        });

        lst.setRate(1.01e18);
        rebasing.setEthPerShare(1.02e18);

        // the first token becomes unreadable, e.g. paused or upgraded
        lst.setBroken(true);

        vm.expectEmit(true, false, false, false);
        emit StakingRevenueOracle.AssetReadSkipped(index);
        // the healthy asset still contributes its 2 ETH; the update is not blocked
        assertEq(consume(), 2 ether);
    }

    function test_consumeRevenue_creditsSkippedAssetOnceItRecovers() public {
        addLST(100 ether);

        lst.setRate(1.01e18);
        lst.setBroken(true);
        assertEq(consume(), 0);

        // its snapshot was left untouched while unreadable, so nothing is lost
        lst.setBroken(false);
        assertEq(consume(), 1 ether);
    }

    function testFuzz_yieldNeverExceedsRateDeltaOnSmallerBalance(
        uint96 balanceBefore,
        uint96 balanceAfter,
        uint64 rateDelta
    ) public {
        vm.assume(rateDelta > 0);

        addLST(balanceBefore);
        lst.setBalance(treasury, balanceAfter);
        lst.setRate(1e18 + uint256(rateDelta));

        uint256 principal = balanceAfter < balanceBefore ? balanceAfter : balanceBefore;
        assertEq(consume(), (principal * uint256(rateDelta)) / 1e18);
    }
}
