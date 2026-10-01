// SPDX-License-Identifier: GPL-3.0

/// @title Interface for a source of non-auction DAO revenue usable for client rewards

pragma solidity ^0.8.19;

interface IStakingRevenueOracle {
    /**
     * @notice Measure revenue accrued since the previous call and consume it.
     * @dev Consuming means the internal snapshots move forward, so the same revenue is never reported twice.
     * Must only be callable by the configured consumer (the Rewards contract).
     * @return revenueInWei revenue accrued since the last call, denominated in wei
     */
    function consumeRevenue() external returns (uint256 revenueInWei);

    /**
     * @notice Measure revenue accrued since the previous `consumeRevenue` call, without consuming it.
     * @return revenueInWei revenue accrued since the last call, denominated in wei
     */
    function pendingRevenue() external view returns (uint256 revenueInWei);
}
