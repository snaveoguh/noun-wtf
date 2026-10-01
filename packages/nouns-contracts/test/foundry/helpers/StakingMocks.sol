// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.19;

/// @dev Stands in for an exchange-rate liquid staking token, e.g. wstETH / rETH / mETH.
contract LSTMock {
    mapping(address => uint256) public balanceOf;
    uint256 public rate;
    /// @dev when true the rate read reverts, standing in for a paused or upgraded staking token
    bool public broken;

    constructor(uint256 rate_) {
        rate = rate_;
    }

    /// @dev mirrors rETH's `getExchangeRate()`
    function getExchangeRate() external view returns (uint256) {
        require(!broken, 'broken');
        return rate;
    }

    /// @dev mirrors mETH staking's `mETHToETH(uint256)`
    function toETH(uint256 amount) external view returns (uint256) {
        return (amount * rate) / 1e18;
    }

    function setBroken(bool broken_) external {
        broken = broken_;
    }

    function setRate(uint256 rate_) external {
        rate = rate_;
    }

    function setBalance(address account, uint256 amount) external {
        balanceOf[account] = amount;
    }

    function reverting() external pure returns (uint256) {
        revert('nope');
    }

    function notAUint() external pure returns (bool) {
        return true;
    }
}

/// @dev Stands in for a rebasing liquid staking token, e.g. stETH, where yield shows up in the share price.
contract RebasingLSTMock {
    mapping(address => uint256) public sharesOf;
    uint256 public ethPerShare;

    constructor(uint256 ethPerShare_) {
        ethPerShare = ethPerShare_;
    }

    /// @dev mirrors Lido's `getPooledEthByShares(uint256)`
    function getPooledEthByShares(uint256 shares) external view returns (uint256) {
        return (shares * ethPerShare) / 1e18;
    }

    function setEthPerShare(uint256 ethPerShare_) external {
        ethPerShare = ethPerShare_;
    }

    function setShares(address account, uint256 shares) external {
        sharesOf[account] = shares;
    }
}
