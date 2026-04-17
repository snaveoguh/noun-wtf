// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { Ownable } from '@openzeppelin/contracts/access/Ownable.sol';
import { ReentrancyGuard } from '@openzeppelin/contracts/security/ReentrancyGuard.sol';

/// @title NounsAuctionPricePredictionMarket
/// @notice Parimutuel market: "Will the next Nouns auction clearing price be
///         HIGHER or LOWER than the 7-count trailing average of prior settlements?"
///         Fully on-chain resolution: reads `NounsAuctionHouseV2.getSettlements(...)` directly.
/// @dev Ties (price == avg) resolve as LOWER. Strict `>` wins HIGHER.
interface INounsAuctionHouseGetter {
    struct AuctionV2View {
        uint96 nounId;
        uint128 amount;
        uint40 startTime;
        uint40 endTime;
        address payable bidder;
        bool settled;
    }

    struct Settlement {
        uint32 blockTimestamp;
        uint256 amount;
        address winner;
        uint256 nounId;
        uint32 clientId;
    }

    function auction() external view returns (AuctionV2View memory);

    function getSettlements(
        uint256 startId,
        uint256 endId,
        bool skipEmptyValues
    ) external view returns (Settlement[] memory);
}

contract NounsAuctionPricePredictionMarket is Ownable, ReentrancyGuard {
    enum Outcome {
        UNRESOLVED,
        HIGHER,
        LOWER,
        VOID
    }

    struct Market {
        uint256 higherPool;
        uint256 lowerPool;
        uint256 higherStakers;
        uint256 lowerStakers;
        uint40 createdAt;
        uint40 resolvedAt;
        Outcome outcome;
        bool exists;
        uint16 feeBps; // fee snapshot at creation — locks economics for this market
        uint256 priceWei; // target auction clearing price at resolution
        uint256 avgWei; // trailing avg at resolution
    }

    struct Position {
        uint256 higherStake;
        uint256 lowerStake;
        bool claimed;
    }

    /// @notice Sample size for the trailing average (count of prior settlements).
    uint256 public constant SAMPLE_SIZE = 7;

    /// @notice Buffer for range lookup to absorb Nounder-reward skips and
    /// zero-amount no-bid auctions. Requesting [nounId - SAMPLE_SIZE - BUFFER, nounId + 1]
    /// tolerates up to BUFFER skipped/zero-amount settlements in the lookback window.
    uint256 public constant LOOKBACK_BUFFER = 10;

    INounsAuctionHouseGetter public immutable auctionHouse;

    uint256 public protocolFeeBps;
    uint256 public totalFeesCollected;

    /// @dev nounId => Market
    mapping(uint256 => Market) public markets;
    /// @dev nounId => user => Position
    mapping(uint256 => mapping(address => Position)) public positions;

    event MarketCreated(uint256 indexed nounId);
    event StakePlaced(uint256 indexed nounId, address indexed staker, bool isHigher, uint256 amount);
    event MarketResolved(uint256 indexed nounId, Outcome outcome, uint256 priceWei, uint256 avgWei);
    event WinningsClaimed(uint256 indexed nounId, address indexed staker, uint256 payout);
    event ProtocolFeeUpdated(uint256 newFeeBps);

    constructor(address _auctionHouse) {
        require(_auctionHouse != address(0), 'Zero auction house');
        auctionHouse = INounsAuctionHouseGetter(_auctionHouse);
        protocolFeeBps = 200; // 2%
    }

    // ========================================================================
    // MARKET CREATION
    // ========================================================================

    /// @notice Create a market for the currently live auction. Permissionless.
    function createMarket(uint256 nounId) external {
        require(!markets[nounId].exists, 'Market exists');

        INounsAuctionHouseGetter.AuctionV2View memory current = auctionHouse.auction();
        require(uint256(current.nounId) == nounId, 'Not current auction');
        require(!current.settled, 'Auction settled');
        require(block.timestamp < current.endTime, 'Auction ended');

        Market storage m = markets[nounId];
        m.createdAt = uint40(block.timestamp);
        m.exists = true;
        // Snapshot fee so later owner changes cannot retroactively alter economics
        // for stakers already locked into this market.
        m.feeBps = uint16(protocolFeeBps);

        emit MarketCreated(nounId);
    }

    // ========================================================================
    // STAKING
    // ========================================================================

    /// @notice Stake ETH on HIGHER (true) or LOWER (false) outcome.
    ///         Staking closes once the auction ends (endTime reached).
    function stake(uint256 nounId, bool isHigher) external payable {
        require(msg.value > 0, 'Must stake ETH');

        Market storage m = markets[nounId];
        require(m.exists, 'No market');
        require(m.outcome == Outcome.UNRESOLVED, 'Resolved');

        // Close staking when the auction itself closes.
        INounsAuctionHouseGetter.AuctionV2View memory current = auctionHouse.auction();
        if (uint256(current.nounId) == nounId) {
            require(block.timestamp < current.endTime, 'Staking closed');
        } else {
            // A later auction is live — target auction already ended.
            revert('Staking closed');
        }

        Position storage pos = positions[nounId][msg.sender];
        if (isHigher) {
            if (pos.higherStake == 0) m.higherStakers++;
            pos.higherStake += msg.value;
            m.higherPool += msg.value;
        } else {
            if (pos.lowerStake == 0) m.lowerStakers++;
            pos.lowerStake += msg.value;
            m.lowerPool += msg.value;
        }

        emit StakePlaced(nounId, msg.sender, isHigher, msg.value);
    }

    // ========================================================================
    // RESOLUTION
    // ========================================================================

    /// @notice Resolve a market by reading settlement data on-chain. Permissionless.
    ///         Resolves to HIGHER/LOWER when the target + 7 non-zero priors are
    ///         available. Resolves to VOID (refund all stakes) if the target
    ///         auction settled with zero bids, or if fewer than SAMPLE_SIZE
    ///         non-zero priors exist within the lookback window.
    function resolve(uint256 nounId) external {
        Market storage m = markets[nounId];
        require(m.exists, 'No market');
        require(m.outcome == Outcome.UNRESOLVED, 'Resolved');

        // If nounId is too low for a valid lookback, void rather than brick.
        if (nounId <= SAMPLE_SIZE + LOOKBACK_BUFFER) {
            _finalize(m, nounId, Outcome.VOID, 0, 0);
            return;
        }

        uint256 startId = nounId - SAMPLE_SIZE - LOOKBACK_BUFFER;
        uint256 endId = nounId + 1;

        INounsAuctionHouseGetter.Settlement[] memory s = auctionHouse.getSettlements(startId, endId, true);

        // Target must be settled (last entry in the ascending array) to resolve.
        // If not, the auction hasn't been settled yet — caller should retry later.
        require(s.length >= 1, 'Target not settled');
        INounsAuctionHouseGetter.Settlement memory target = s[s.length - 1];
        require(target.nounId == nounId, 'Target not settled');

        // Zero-amount target (no bids): VOID, refund all stakes.
        // `skipEmptyValues=true` only filters unset entries (blockTimestamp<=1),
        // not settled auctions with zero bid amount, so we must guard here.
        if (target.amount == 0) {
            _finalize(m, nounId, Outcome.VOID, 0, 0);
            return;
        }

        // Walk backward from target, summing the first SAMPLE_SIZE non-zero priors.
        uint256 sum;
        uint256 counted;
        for (uint256 i = s.length - 1; i > 0 && counted < SAMPLE_SIZE; ) {
            i--;
            uint256 amt = s[i].amount;
            if (amt == 0) continue;
            sum += amt;
            counted++;
        }

        // Not enough non-zero priors in the lookback window: VOID.
        if (counted < SAMPLE_SIZE) {
            _finalize(m, nounId, Outcome.VOID, target.amount, 0);
            return;
        }

        uint256 avg = sum / SAMPLE_SIZE;
        Outcome outcome = target.amount > avg ? Outcome.HIGHER : Outcome.LOWER;
        _finalize(m, nounId, outcome, target.amount, avg);
    }

    function _finalize(
        Market storage m,
        uint256 nounId,
        Outcome outcome,
        uint256 priceWei,
        uint256 avgWei
    ) internal {
        m.outcome = outcome;
        m.resolvedAt = uint40(block.timestamp);
        m.priceWei = priceWei;
        m.avgWei = avgWei;
        emit MarketResolved(nounId, outcome, priceWei, avgWei);
    }

    // ========================================================================
    // CLAIMING
    // ========================================================================

    /// @notice Claim winnings after resolution. Winners split the total pot pro-rata.
    ///         VOID markets and degenerate one-sided losing markets refund all stakes.
    ///         Uses the fee snapshotted at market creation (not the current owner value).
    function claim(uint256 nounId) external nonReentrant {
        Market storage m = markets[nounId];
        require(m.exists, 'No market');
        require(m.outcome != Outcome.UNRESOLVED, 'Not resolved');

        Position storage pos = positions[nounId][msg.sender];
        require(!pos.claimed, 'Already claimed');
        pos.claimed = true;

        uint256 payout;

        if (m.outcome == Outcome.VOID) {
            // Full refund of both sides.
            payout = pos.higherStake + pos.lowerStake;
        } else {
            uint256 totalPot = m.higherPool + m.lowerPool;
            uint256 winningPool = m.outcome == Outcome.HIGHER ? m.higherPool : m.lowerPool;
            uint256 winnerStake = m.outcome == Outcome.HIGHER ? pos.higherStake : pos.lowerStake;

            if (winningPool == 0) {
                // Degenerate: no one bet the winning side. Refund all stakes.
                payout = pos.higherStake + pos.lowerStake;
            } else if (winnerStake > 0) {
                payout = (winnerStake * totalPot) / winningPool;

                uint256 profit = payout > winnerStake ? payout - winnerStake : 0;
                uint256 fee = (profit * uint256(m.feeBps)) / 10000;
                totalFeesCollected += fee;
                payout -= fee;
            }
        }

        require(payout > 0, 'Nothing to claim');

        (bool ok, ) = payable(msg.sender).call{ value: payout }('');
        require(ok, 'Transfer failed');

        emit WinningsClaimed(nounId, msg.sender, payout);
    }

    // ========================================================================
    // VIEWS
    // ========================================================================

    function getMarket(uint256 nounId)
        external
        view
        returns (
            uint256 higherPool,
            uint256 lowerPool,
            uint256 higherStakers,
            uint256 lowerStakers,
            uint256 higherOddsBps,
            uint256 lowerOddsBps,
            uint8 outcome,
            uint256 priceWei,
            uint256 avgWei,
            uint16 feeBps,
            bool exists
        )
    {
        Market memory m = markets[nounId];
        uint256 total = m.higherPool + m.lowerPool;
        uint256 _higherOdds = total == 0 ? 5000 : (m.higherPool * 10000) / total;
        uint256 _lowerOdds = total == 0 ? 5000 : (m.lowerPool * 10000) / total;
        return (
            m.higherPool,
            m.lowerPool,
            m.higherStakers,
            m.lowerStakers,
            _higherOdds,
            _lowerOdds,
            uint8(m.outcome),
            m.priceWei,
            m.avgWei,
            m.feeBps,
            m.exists
        );
    }

    function getPosition(uint256 nounId, address user)
        external
        view
        returns (uint256 higherStake, uint256 lowerStake, bool claimed)
    {
        Position memory p = positions[nounId][user];
        return (p.higherStake, p.lowerStake, p.claimed);
    }

    // ========================================================================
    // ADMIN
    // ========================================================================

    function setProtocolFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 1000, 'Fee too high'); // max 10%
        protocolFeeBps = _feeBps;
        emit ProtocolFeeUpdated(_feeBps);
    }

    function withdrawFees() external onlyOwner nonReentrant {
        uint256 fees = totalFeesCollected;
        totalFeesCollected = 0;
        (bool ok, ) = payable(owner()).call{ value: fees }('');
        require(ok, 'Withdraw failed');
    }

    receive() external payable {}
}
