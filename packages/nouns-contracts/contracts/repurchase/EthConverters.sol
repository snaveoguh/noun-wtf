// SPDX-License-Identifier: GPL-3.0

/// @title ETH converters for the liquid staking tokens the Nouns treasury holds

pragma solidity ^0.8.19;

import { IEthConverter } from '../interfaces/IEthConverter.sol';

/// @notice For WETH and stETH: 1 token == 1 ETH.
contract OneToOneConverter is IEthConverter {
    function toEth(uint256 amount) external pure override returns (uint256) {
        return amount;
    }
}

interface IWstETH {
    function getStETHByWstETH(uint256 wstETHAmount) external view returns (uint256);
}

/// @notice wstETH -> stETH via Lido's share rate; stETH is treated 1:1 with ETH.
/// Mainnet wstETH: 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0
contract WstETHConverter is IEthConverter {
    IWstETH public immutable wstETH;

    constructor(IWstETH _wstETH) {
        wstETH = _wstETH;
    }

    function toEth(uint256 amount) external view override returns (uint256) {
        return wstETH.getStETHByWstETH(amount);
    }
}

interface IRocketTokenRETH {
    function getEthValue(uint256 rethAmount) external view returns (uint256);
}

/// @notice rETH -> ETH via Rocket Pool's protocol exchange rate.
/// Mainnet rETH: 0xae78736Cd615f374D3085123A210448E74Fc6393
contract RETHConverter is IEthConverter {
    IRocketTokenRETH public immutable rETH;

    constructor(IRocketTokenRETH _rETH) {
        rETH = _rETH;
    }

    function toEth(uint256 amount) external view override returns (uint256) {
        return rETH.getEthValue(amount);
    }
}

interface IMantleStaking {
    function mETHToETH(uint256 mETHAmount) external view returns (uint256);
}

/// @notice mETH -> ETH via Mantle's staking contract exchange rate.
/// Mainnet Mantle staking: 0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8f
contract METHConverter is IEthConverter {
    IMantleStaking public immutable staking;

    constructor(IMantleStaking _staking) {
        staking = _staking;
    }

    function toEth(uint256 amount) external view override returns (uint256) {
        return staking.mETHToETH(amount);
    }
}
