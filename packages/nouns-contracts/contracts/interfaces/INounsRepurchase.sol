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

    /// @notice A Noun escrowed by a member awaiting repurchase.
    struct Request {
        /// @dev The member who escrowed the Noun. Zero once cancelled or settled.
        address owner;
        /// @dev Timestamp of the request.
        uint40 requestedAt;
        /// @dev True if the Noun was pulled out of the queue because its owner became sanctioned.
        bool frozen;
    }

    /// @notice Signed by the KYC attestor (a Compliance Administrator key) to permit a member to request a repurchase.
    struct KycAttestation {
        address member;
        uint256 expiry;
    }

    event RepurchaseRequested(uint256 indexed nounId, address indexed owner, uint256 queueIndex);
    event RepurchaseCancelled(uint256 indexed nounId, address indexed owner);
    event RepurchaseSettled(uint256 indexed nounId, address indexed owner, uint256 price);
    event RequestFrozen(uint256 indexed nounId, address indexed owner);
    event TickSettled(uint256 price, uint256 settledCount, uint256 navPerNoun);
    event InsufficientFunds(uint256 price, uint256 available);

    event SpreadBpsUpdated(uint16 spreadBps);
    event MaxPerTickUpdated(uint16 maxPerTick);
    event TickDurationUpdated(uint32 tickDuration);
    event LiabilityReserveUpdated(uint256 liabilityReserve);
    event SanctionsOracleUpdated(address sanctionsOracle);
    event KycAttestorUpdated(address kycAttestor);
    event AssetsUpdated(uint256 count);
    event FundsReturnedToTreasury(uint256 amount);

    error SanctionedMember(address member);
    error KycAttestationRequired();
    error InvalidKycAttestation();
    error NotRequestOwner(uint256 nounId);
    error NothingToSettle();
    error TickNotElapsed(uint256 nextTickAt);
    error SpreadTooHigh();
    error ZeroMaxPerTick();
    error ZeroTickDuration();
    error NoCirculatingNouns();

    function requestRepurchase(uint256[] calldata nounIds, bytes calldata kycSignature) external;

    function cancelRequest(uint256[] calldata nounIds) external;

    function settle() external returns (uint256 settledCount);

    function navPerNoun() external view returns (uint256);

    function repurchasePrice() external view returns (uint256);

    function totalAssetsEth() external view returns (uint256);

    function circulatingSupply() external view returns (uint256);

    function pendingCount() external view returns (uint256);
}
