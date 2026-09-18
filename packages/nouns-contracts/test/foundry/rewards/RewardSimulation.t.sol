// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.19;

import 'forge-std/Test.sol';
import { Rewards } from '../../../contracts/client-incentives/Rewards.sol';
import { RewardsProxy } from '../../../contracts/client-incentives/RewardsProxy.sol';
import { INounsDAOLogic } from '../../../contracts/interfaces/INounsDAOLogic.sol';
import { INounsAuctionHouseV2 } from '../../../contracts/interfaces/INounsAuctionHouseV2.sol';
import { ERC20Mock } from '../helpers/ERC20Mock.sol';
import { DAOMockForSim, AuctionHouseMockForSim, OracleStubForSim } from '../helpers/RewardSimMocks.sol';

/**
 * @notice Sizing simulation for Client Incentives V2.
 *
 * Runs the real `Rewards.updateRewardsForProposalWritingAndVoting` over synthetic periods in which
 * auctions raised nothing and staking revenue funded the pool, then prints what a proposal and a single
 * vote are actually worth. The point is to measure against the shipped arithmetic rather than against a
 * spreadsheet copy of it.
 *
 *   forge test --match-contract RewardSimulationTest -vv
 *
 * Adjust the constants below to model a different treasury, APR or reward rate.
 */
contract RewardSimulationTest is Test {
    /// @dev Existing reward rates. Confirm against `getProposalRewardParams()` before quoting these.
    uint16 constant PROPOSAL_REWARD_BPS = 100; // 1%
    uint16 constant VOTING_REWARD_BPS = 50; // 0.5%

    uint256 constant STAKED_ETH = 10_000 ether;
    uint256 constant APR_BPS = 300; // 3%
    uint256 constant PERIODS_PER_YEAR = 26; // two-week reward periods

    address owner = makeAddr('owner');

    uint32[] votingClientIds;

    function test_printRewardSizing() public {
        emit log_string('');
        emit log_string('Client reward sizing (real contract, staking-funded, zero auction revenue)');
        emit log_named_uint('staked ETH', STAKED_ETH / 1 ether);
        emit log_named_uint('APR bps', APR_BPS);
        emit log_string('');
        emit log_string('shareBps | proposals | votes each | per proposal (wei) | per vote (wei)');

        _run(2_500, 3, 60);
        _run(5_000, 3, 60);
        _run(10_000, 3, 60);
        _run(10_000, 1, 60);
        _run(10_000, 6, 60);
        _run(10_000, 3, 150);
    }

    function _run(uint16 shareBps, uint256 proposals, uint256 votesEach) internal {
        uint256 yieldPerPeriod = (STAKED_ETH * APR_BPS) / 10_000 / PERIODS_PER_YEAR;
        uint256 revenue = (yieldPerPeriod * shareBps) / 10_000;

        (Rewards rewards, DAOMockForSim dao, AuctionHouseMockForSim ah) = _deploy();

        // A period of nouns that drew no bids: auction revenue is exactly zero.
        ah.addSettlement(1000, 0, uint32(block.timestamp));

        vm.startPrank(owner);
        rewards.setStakingRevenueOracle(address(new OracleStubForSim(revenue, address(rewards))));
        vm.stopPrank();

        // Client 1 writes every proposal, client 2 facilitates every vote.
        vm.prank(makeAddr('client1'));
        rewards.registerClient('proposer', '');
        vm.prank(makeAddr('client2'));
        rewards.registerClient('voter', '');

        dao.setPeriod(proposals, votesEach, 1, block.timestamp);

        delete votingClientIds;
        votingClientIds.push(2);
        rewards.updateRewardsForProposalWritingAndVoting(uint32(proposals), votingClientIds);

        uint256 perProposal = rewards.clientBalance(1) / proposals;
        uint256 perVote = rewards.clientBalance(2) / (proposals * votesEach);

        emit log_string(
            string.concat(
                vm.toString(uint256(shareBps)),
                ' | ',
                vm.toString(proposals),
                ' | ',
                vm.toString(votesEach),
                ' | ',
                vm.toString(perProposal),
                ' | ',
                vm.toString(perVote)
            )
        );
    }

    function _deploy() internal returns (Rewards rewards, DAOMockForSim dao, AuctionHouseMockForSim ah) {
        dao = new DAOMockForSim();
        ah = new AuctionHouseMockForSim();
        ERC20Mock weth = new ERC20Mock();

        Rewards logic = new Rewards(address(dao), address(ah));
        RewardsProxy proxy = new RewardsProxy(
            address(logic),
            abi.encodeWithSignature(
                'initialize(address,address,address,address)',
                owner,
                owner,
                address(weth),
                address(0)
            )
        );
        rewards = Rewards(address(proxy));
        weth.mint(address(rewards), 1_000 ether);

        vm.startPrank(owner);
        rewards.setProposalRewardParams(
            Rewards.ProposalRewardParams({
                minimumRewardPeriod: 0,
                numProposalsEnoughForReward: 1,
                proposalRewardBps: PROPOSAL_REWARD_BPS,
                votingRewardBps: VOTING_REWARD_BPS,
                proposalEligibilityQuorumBps: 1000
            })
        );
        rewards.enableProposalRewards();
        rewards.setClientApproval(1, true);
        rewards.setClientApproval(2, true);
        vm.stopPrank();
    }
}
