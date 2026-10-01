// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.19;

import { NounsDAOTypes } from '../../../contracts/governance/NounsDAOInterfaces.sol';
import { INounsAuctionHouseV2 } from '../../../contracts/interfaces/INounsAuctionHouseV2.sol';

/**
 * @dev Minimal stand-ins for the DAO and auction house, used to drive the real
 * `Rewards.updateRewardsForProposalWritingAndVoting` over synthetic periods so reward sizing can be
 * measured against the shipped arithmetic rather than a re-implementation of it.
 *
 * Only the functions `Rewards` actually calls are implemented.
 */
contract DAOMockForSim {
    uint256 public proposalCount;

    uint256 internal numProposals;
    uint256 internal votesPerProposal;
    uint32 internal proposalClientId;
    uint256 internal creationTimestamp;

    /// @param numProposals_ eligible proposals in the period
    /// @param votesPerProposal_ total votes cast on each of them
    /// @param proposalClientId_ client credited with writing every proposal
    function setPeriod(
        uint256 numProposals_,
        uint256 votesPerProposal_,
        uint32 proposalClientId_,
        uint256 creationTimestamp_
    ) external {
        numProposals = numProposals_;
        votesPerProposal = votesPerProposal_;
        proposalClientId = proposalClientId_;
        creationTimestamp = creationTimestamp_;
        proposalCount += numProposals_;
    }

    function proposalDataForRewards(
        uint256,
        uint256,
        uint16,
        bool,
        bool,
        uint32[] calldata votingClientIds
    ) external view returns (NounsDAOTypes.ProposalForRewards[] memory data) {
        data = new NounsDAOTypes.ProposalForRewards[](numProposals);

        for (uint256 i; i < numProposals; ++i) {
            NounsDAOTypes.ClientVoteData[] memory voteData = new NounsDAOTypes.ClientVoteData[](
                votingClientIds.length
            );
            // All votes are attributed to the first voting client id, which keeps the per-vote reward
            // easy to read off a single client's balance.
            voteData[0] = NounsDAOTypes.ClientVoteData({ votes: uint32(votesPerProposal), txs: 1 });

            data[i].forVotes = votesPerProposal;
            data[i].creationTimestamp = creationTimestamp;
            data[i].clientId = proposalClientId;
            data[i].voteData = voteData;
        }
    }
}

contract AuctionHouseMockForSim {
    INounsAuctionHouseV2.Settlement[] internal settlements;
    uint96 public currentNounId = 1000;

    /// @dev Adds a settled auction to the period. `amount` of 0 models a noun that drew no bid.
    function addSettlement(uint256 nounId, uint256 amount, uint32 blockTimestamp) external {
        settlements.push(
            INounsAuctionHouseV2.Settlement({
                blockTimestamp: blockTimestamp,
                amount: amount,
                winner: address(0),
                nounId: nounId,
                clientId: 0
            })
        );
    }

    function getSettlementsFromIdtoTimestamp(
        uint256,
        uint256,
        bool
    ) external view returns (INounsAuctionHouseV2.Settlement[] memory) {
        return settlements;
    }

    function auction() external view returns (INounsAuctionHouseV2.AuctionV2View memory a) {
        a.nounId = currentNounId;
    }
}

/// @dev Reports a fixed revenue figure once, so a simulation can control the period's revenue directly.
contract OracleStubForSim {
    uint256 public amount;
    address public consumer;
    bool public spent;

    constructor(uint256 amount_, address consumer_) {
        amount = amount_;
        consumer = consumer_;
    }

    function consumeRevenue() external returns (uint256) {
        require(msg.sender == consumer, 'only consumer');
        if (spent) return 0;
        spent = true;
        return amount;
    }

    function pendingRevenue() external view returns (uint256) {
        return spent ? 0 : amount;
    }
}
