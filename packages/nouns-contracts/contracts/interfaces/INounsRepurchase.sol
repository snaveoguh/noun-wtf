// SPDX-License-Identifier: GPL-3.0

/// @title Interface for NounsRepurchase

pragma solidity ^0.8.19;

import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { IEthConverter } from './IEthConverter.sol';

interface INounsRepurchase {
    /// @notice A treasury asset that counts toward net asset value.
    struct Asset {
        IERC20 token;
        IEthConverter converter;
    }

    /// @notice Why an ask was pulled out of the book without being filled.
    enum FreezeReason {
        None,
        /// @dev Owner was on the sanctions list at settle time.
        Sanctioned,
        /// @dev The price at the ask's discount fell below the owner's minPrice.
        BelowMinPrice
    }

    /// @notice A Noun escrowed by a member, offered back to the DAO at a discount to NAV.
    struct Ask {
        /// @dev The member who escrowed the Noun. Zero once cancelled or filled.
        address owner;
        /// @dev Timestamp of the (latest) ask. Earlier asks at the same discount fill first.
        uint40 placedAt;
        /// @dev Discount level: discountBps = level * DISCOUNT_STEP_BPS.
        uint8 level;
        /// @dev Position in that level's queue this ask is valid for. Stale slots from a prior ask are skipped.
        uint48 slot;
        /// @dev Non-zero once the ask has been pulled out of the book; the owner may cancel or re-ask.
        FreezeReason frozen;
        /// @dev Absolute floor (wei) on top of the discount, in case NAV falls while the ask waits. 0 for none.
        uint128 minPrice;
    }

    /// @notice Auction parameters set by the DAO.
    struct AuctionParams {
        /// @dev Smallest discount an ask may carry, so every exit adds book value for the members who stay.
        uint16 minDiscountBps;
        /// @dev Most Nouns filled in one round. A gas bound, not the throughput control: that is the budget.
        uint16 maxFillsPerRound;
        /// @dev Minimum seconds between rounds that filled at least one Noun.
        uint32 roundDuration;
        /// @dev Most ETH paid out in one round.
        uint256 budgetPerRound;
    }

    /// @notice Signed by the KYC attestor (a Compliance Administrator key) to permit a member to place asks.
    struct KycAttestation {
        address member;
        uint256 expiry;
    }

    event AskPlaced(uint256 indexed nounId, address indexed owner, uint16 discountBps, uint256 minPrice);
    event AskCancelled(uint256 indexed nounId, address indexed owner);
    event AskFrozen(uint256 indexed nounId, address indexed owner, FreezeReason reason);
    event RepurchaseSettled(uint256 indexed nounId, address indexed owner, uint256 price);
    event RoundSettled(uint16 clearingDiscountBps, uint256 price, uint256 filledCount, uint256 navPerNoun);

    event AuctionParamsUpdated(
        uint16 minDiscountBps,
        uint16 maxFillsPerRound,
        uint32 roundDuration,
        uint256 budgetPerRound
    );
    event LiabilityReserveUpdated(uint256 liabilityReserve);
    event SanctionsOracleUpdated(address sanctionsOracle);
    event KycAttestorUpdated(address kycAttestor);
    event AssetsUpdated(uint256 count);
    event ExcludedHoldersUpdated(uint256 count);
    event FundsReturnedToTreasury(uint256 amount);
    event StrayNounRecovered(uint256 indexed nounId);

    error SanctionedMember(address member);
    error KycAttestationRequired();
    error InvalidKycAttestation();
    error NotAskOwner(uint256 nounId);
    error InvalidDiscount(uint16 discountBps);
    error NothingToSettle();
    error ZeroNav();
    error RoundNotElapsed(uint256 nextRoundAt);
    error InvalidMinDiscount();
    error ZeroMaxFills();
    error ZeroRoundDuration();
    error ZeroAddress();
    error NoCirculatingNouns();
    error NounIsTracked(uint256 nounId);

    function placeAsks(
        uint256[] calldata nounIds,
        uint16 discountBps,
        uint256 minPrice,
        bytes calldata kycSignature
    ) external;

    function updateAsks(uint256[] calldata nounIds, uint16 discountBps, uint256 minPrice) external;

    function cancelAsks(uint256[] calldata nounIds) external;

    function settle() external returns (uint256 filledCount);

    function previewSettle() external view returns (uint16 clearingDiscountBps, uint256 price, uint256 filledCount);

    function navPerNoun() external view returns (uint256);

    function priceAtDiscount(uint16 discountBps) external view returns (uint256);

    function totalAssetsEth() external view returns (uint256);

    function circulatingSupply() external view returns (uint256);

    function liveAsks() external view returns (uint256);
}
