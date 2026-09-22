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

    /// @notice Why a request was pulled out of the queue without being paid.
    enum FreezeReason {
        None,
        /// @dev Owner was on the sanctions list at settle time.
        Sanctioned,
        /// @dev The tick price fell below the owner's minPrice.
        BelowMinPrice
    }

    /// @notice A Noun escrowed by a member awaiting repurchase.
    struct Request {
        /// @dev The member who escrowed the Noun. Zero once cancelled or settled.
        address owner;
        /// @dev Timestamp of the (latest) request or requeue.
        uint40 requestedAt;
        /// @dev Position in `queue` this request is valid for. Stale slots from a prior request are skipped.
        uint48 queueIndex;
        /// @dev Non-zero once the request has been pulled out of the queue; the owner may cancel or requeue.
        FreezeReason frozen;
        /// @dev Slippage protection: the request is not settled below this price (wei).
        uint128 minPrice;
    }

    /// @notice Signed by the KYC attestor (a Compliance Administrator key) to permit a member to request a repurchase.
    struct KycAttestation {
        address member;
        uint256 expiry;
    }

    event RepurchaseRequested(uint256 indexed nounId, address indexed owner, uint256 queueIndex, uint256 minPrice);
    event RepurchaseRequeued(uint256 indexed nounId, address indexed owner, uint256 queueIndex, uint256 minPrice);
    event RepurchaseCancelled(uint256 indexed nounId, address indexed owner);
    event RepurchaseSettled(uint256 indexed nounId, address indexed owner, uint256 price);
    event RequestFrozen(uint256 indexed nounId, address indexed owner, FreezeReason reason);
    event TickSettled(uint256 price, uint256 settledCount, uint256 navPerNoun);
    event InsufficientFunds(uint256 price, uint256 available);

    event SpreadBpsUpdated(uint16 spreadBps);
    event MaxPerTickUpdated(uint16 maxPerTick);
    event TickDurationUpdated(uint32 tickDuration);
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
    error NotRequestOwner(uint256 nounId);
    error RequestNotFrozen(uint256 nounId);
    error NothingToSettle();
    error TickNotElapsed(uint256 nextTickAt);
    error SpreadTooHigh();
    error ZeroMaxPerTick();
    error ZeroTickDuration();
    error ZeroAddress();
    error NoCirculatingNouns();
    error NounIsTracked(uint256 nounId);

    function requestRepurchase(uint256[] calldata nounIds, uint256 minPrice, bytes calldata kycSignature) external;

    function requeue(uint256[] calldata nounIds, uint256 minPrice) external;

    function cancelRequest(uint256[] calldata nounIds) external;

    function settle() external returns (uint256 settledCount);

    function navPerNoun() external view returns (uint256);

    function repurchasePrice() external view returns (uint256);

    function totalAssetsEth() external view returns (uint256);

    function circulatingSupply() external view returns (uint256);

    function pendingCount() external view returns (uint256);
}
