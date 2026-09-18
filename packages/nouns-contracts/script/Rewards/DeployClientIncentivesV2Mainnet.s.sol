// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.19;

import 'forge-std/Script.sol';
import { OptimizedScript } from '../OptimizedScript.s.sol';
import { Rewards } from '../../contracts/client-incentives/Rewards.sol';
import { StakingRevenueOracle } from '../../contracts/client-incentives/StakingRevenueOracle.sol';

/**
 * @notice Deploys the two contracts Client Incentives V2 needs on mainnet: a new `Rewards` implementation and
 * the `StakingRevenueOracle` that measures treasury staking yield.
 *
 * @dev This script only deploys. Nothing changes onchain until the DAO executes a proposal, because every
 * switch is behind `onlyOwner` and the owner is the treasury. The script logs the proposal transactions to run.
 *
 * The upgrade is inert until the DAO points `Rewards` at the oracle AND the oracle has a non-zero
 * `revenueShareBps`: until then `Rewards` behaves exactly as it does today, minus the two bug fixes to the
 * no-auction-revenue path. The oracle is deployed with a share of 0, so turning it on is its own decision.
 */
contract DeployClientIncentivesV2Mainnet is OptimizedScript {
    address constant DAO_PROXY = 0x6f3E6272A167e8AcCb32072d08E0957F9c79223d;
    address constant AUCTION_HOUSE = 0x830BD73E4184ceF73443C15111a1DF14e495C706;
    address constant TREASURY = 0xb1a32FC9F9D8b2cf86C068Cae13108809547ef71;

    address constant WSTETH = 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;
    address constant STETH = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84;
    address constant RETH = 0xae78736Cd615f374D3085123A210448E74Fc6393;
    address constant METH = 0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa;
    address constant METH_STAKING = 0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8f;

    /// @dev Bounds one period's reported staking revenue. Roughly a month of yield on a 30k ETH staked
    /// position, so it never binds in normal operation but caps a misbehaving rate source.
    uint256 constant MAX_REVENUE_PER_CONSUME = 100 ether;

    /// @dev Deployed switched off. The DAO turns staking rewards on with `setRevenueShareBps`, which is the
    /// one economic decision in this proposal and is reversible with a single call.
    uint16 constant INITIAL_REVENUE_SHARE_BPS = 0;

    function run() public returns (Rewards newLogic, StakingRevenueOracle oracle) {
        requireDefaultProfile();

        // The live client rewards proxy, passed in rather than hardcoded so it is verified against Etherscan
        // at deploy time. The oracle will only ever accept this address as its consumer.
        address rewardsProxy = vm.envAddress('REWARDS_PROXY');

        uint256 deployerKey = vm.envUint('DEPLOYER_PRIVATE_KEY');
        vm.startBroadcast(deployerKey);

        newLogic = new Rewards(DAO_PROXY, AUCTION_HOUSE);
        oracle = new StakingRevenueOracle({
            owner_: TREASURY,
            consumer_: rewardsProxy,
            maxRevenuePerConsume_: MAX_REVENUE_PER_CONSUME,
            revenueShareBps_: INITIAL_REVENUE_SHARE_BPS
        });

        vm.stopBroadcast();

        _logProposal(newLogic, oracle, rewardsProxy);
    }

    function _logProposal(Rewards newLogic, StakingRevenueOracle oracle, address rewardsProxy) internal view {
        console.log('New Rewards implementation: %s', address(newLogic));
        console.log('StakingRevenueOracle:       %s', address(oracle));
        console.log('');
        console.log('DAO proposal transactions, all sent from the treasury:');
        console.log('');
        console.log('1. %s  upgradeTo(%s)', rewardsProxy, address(newLogic));

        console.log('2. %s  addAsset("wstETH", ...)', address(oracle));
        _logAsset({
            name: 'wstETH',
            balanceProvider: WSTETH,
            balanceCalldata: abi.encodeWithSignature('balanceOf(address)', TREASURY),
            rateProvider: WSTETH,
            rateCalldata: abi.encodeWithSignature('stEthPerToken()')
        });

        console.log('3. %s  addAsset("stETH", ...)', address(oracle));
        _logAsset({
            name: 'stETH',
            balanceProvider: STETH,
            balanceCalldata: abi.encodeWithSignature('sharesOf(address)', TREASURY),
            rateProvider: STETH,
            rateCalldata: abi.encodeWithSignature('getPooledEthByShares(uint256)', 1e18)
        });

        console.log('4. %s  addAsset("rETH", ...)', address(oracle));
        _logAsset({
            name: 'rETH',
            balanceProvider: RETH,
            balanceCalldata: abi.encodeWithSignature('balanceOf(address)', TREASURY),
            rateProvider: RETH,
            rateCalldata: abi.encodeWithSignature('getExchangeRate()')
        });

        console.log('5. %s  addAsset("mETH", ...)', address(oracle));
        _logAsset({
            name: 'mETH',
            balanceProvider: METH,
            balanceCalldata: abi.encodeWithSignature('balanceOf(address)', TREASURY),
            rateProvider: METH_STAKING,
            rateCalldata: abi.encodeWithSignature('mETHToETH(uint256)', 1e18)
        });

        console.log('6. %s  setStakingRevenueOracle(%s)', rewardsProxy, address(oracle));
        console.log('7. %s  setRevenueShareBps(<bps chosen by the DAO>)', address(oracle));
    }

    function _logAsset(
        string memory name,
        address balanceProvider,
        bytes memory balanceCalldata,
        address rateProvider,
        bytes memory rateCalldata
    ) internal view {
        console.log('     name:            %s', name);
        console.log('     balanceProvider: %s', balanceProvider);
        console.log('     balanceCalldata: %s', vm.toString(balanceCalldata));
        console.log('     rateProvider:    %s', rateProvider);
        console.log('     rateCalldata:    %s', vm.toString(rateCalldata));
    }
}
