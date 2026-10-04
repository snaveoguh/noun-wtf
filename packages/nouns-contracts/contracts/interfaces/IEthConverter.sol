// SPDX-License-Identifier: GPL-3.0

/// @title Converts a treasury-held ERC20 balance into its ETH-equivalent value

pragma solidity ^0.8.19;

/**
 * @notice One converter per treasury asset. Used by NounsRepurchase to compute net asset value.
 * Converters must be view-only and must read canonical protocol rates (e.g. wstETH/stETH share rate),
 * never a manipulable spot market price.
 */
interface IEthConverter {
    /// @notice Returns the ETH value (in wei) of `amount` units of the converter's token.
    function toEth(uint256 amount) external view returns (uint256);
}
