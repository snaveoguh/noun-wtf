// SPDX-License-Identifier: GPL-3.0

/// @title Measures ETH-denominated staking yield earned by the Nouns treasury

/*********************************
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ *
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ *
 * ░░░░░░█████████░░█████████░░░ *
 * ░░░░░░██░░░████░░██░░░████░░░ *
 * ░░██████░░░████████░░░████░░░ *
 * ░░██░░██░░░████░░██░░░████░░░ *
 * ░░██░░██░░░████░░██░░░████░░░ *
 * ░░░░░░█████████░░█████████░░░ *
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ *
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ *
 *********************************/

pragma solidity ^0.8.19;

import { Ownable } from '@openzeppelin/contracts/access/Ownable.sol';
import { IStakingRevenueOracle } from './IStakingRevenueOracle.sol';

/**
 * @notice Reports the ETH-denominated yield earned by the DAO treasury's liquid staking tokens, so that
 * `Rewards` can fund client incentives from staking revenue in addition to auction revenue.
 *
 * @dev The central design goal is to measure *yield only*, never principal. A naive "treasury value now minus
 * treasury value last time" measurement is unusable: the DAO spends from the treasury (which would read as
 * negative revenue) and deposits into it (which would read as an enormous windfall). Instead, every asset is
 * described by two reads:
 *
 *   - `balanceCalldata` returns the size of the DAO's position (an ERC20 balance for exchange-rate tokens such
 *     as wstETH / rETH / mETH, or Lido shares for the rebasing stETH).
 *   - `rateCalldata` returns how much ETH one 1e18 units of that position is worth.
 *
 * Yield for a period is then `principal * (rateNow - rateLast) / 1e18`. Because only the *rate* term moves,
 * deposits and withdrawals cannot be mistaken for revenue. Two further guards keep the measurement conservative:
 *
 *   - `principal` is `min(balanceLast, balanceNow)`, so a position that grew during the period only earns on the
 *     part that was held for the whole period, and a flash-donation to the treasury cannot inflate a period.
 *   - A falling rate (a slashing event) reports zero rather than reverting or going negative.
 *
 * Both reads are `staticcall`s with owner-supplied calldata because every liquid staking token exposes its rate
 * under a different signature. `staticcall` cannot mutate state or re-enter, and only the DAO (the owner) can
 * configure an asset. `maxRevenuePerConsume` bounds the blast radius of a misconfigured or compromised rate
 * source to one period's cap.
 *
 * Reference mainnet configuration:
 *
 *   wstETH  balance: balanceOf(treasury)           on 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0
 *           rate:    stEthPerToken()               on 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0
 *   stETH   balance: sharesOf(treasury)            on 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84
 *           rate:    getPooledEthByShares(1e18)    on 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84
 *   rETH    balance: balanceOf(treasury)           on 0xae78736Cd615f374D3085123A210448E74Fc6393
 *           rate:    getExchangeRate()             on 0xae78736Cd615f374D3085123A210448E74Fc6393
 *   mETH    balance: balanceOf(treasury)           on 0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa
 *           rate:    mETHToETH(1e18)               on 0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8f
 */
contract StakingRevenueOracle is IStakingRevenueOracle, Ownable {
    error OnlyConsumer();
    error AssetReadFailed(address target, bytes data);
    error BadAssetIndex();

    event AssetAdded(uint256 indexed index, string name, address balanceProvider, address rateProvider);
    event AssetRemoved(uint256 indexed index, string name);
    event AssetEnabledSet(uint256 indexed index, bool enabled);
    event AssetsResynced();
    /// @dev A tracked asset whose rate or balance could not be read, and was therefore left out of the period.
    event AssetReadSkipped(uint256 indexed index);
    event RevenueConsumed(uint256 revenueInWei, uint256 measuredInWei);
    event ConsumerSet(address oldConsumer, address newConsumer);
    event MaxRevenuePerConsumeSet(uint256 oldMax, uint256 newMax);

    struct Asset {
        /// @dev Human readable label, e.g. "wstETH". Only used for events and offchain tooling.
        string name;
        /// @dev Contract to staticcall for the DAO's position size
        address balanceProvider;
        /// @dev Contract to staticcall for the ETH value of 1e18 units of the position
        address rateProvider;
        /// @dev Calldata returning a uint256 position size, e.g. balanceOf(treasury) / sharesOf(treasury)
        bytes balanceCalldata;
        /// @dev Calldata returning a uint256 of wei per 1e18 units, e.g. stEthPerToken() / getExchangeRate()
        bytes rateCalldata;
        /// @dev Position size observed at the last consume/resync
        uint256 lastBalance;
        /// @dev Rate observed at the last consume/resync
        uint256 lastRate;
        /// @dev A disabled asset is skipped entirely, and its snapshots are frozen
        bool enabled;
    }

    /// @notice The only address allowed to consume revenue; the `Rewards` contract
    address public consumer;

    /// @notice Upper bound on the revenue a single `consumeRevenue` call may report. Zero means unbounded.
    uint256 public maxRevenuePerConsume;

    Asset[] internal assets;

    constructor(address owner_, address consumer_, uint256 maxRevenuePerConsume_) {
        _transferOwnership(owner_);
        consumer = consumer_;
        maxRevenuePerConsume = maxRevenuePerConsume_;

        emit ConsumerSet(address(0), consumer_);
        emit MaxRevenuePerConsumeSet(0, maxRevenuePerConsume_);
    }

    /**
     * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
     *   REVENUE
     * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
     */

    /// @inheritdoc IStakingRevenueOracle
    function consumeRevenue() external returns (uint256 revenueInWei) {
        if (msg.sender != consumer) revert OnlyConsumer();

        uint256 measured;
        uint256 len = assets.length;
        for (uint256 i; i < len; ++i) {
            Asset storage a = assets[i];
            if (!a.enabled) continue;

            (uint256 rate, uint256 balance, bool ok) = _tryRead(a);
            if (!ok) {
                // Leave the snapshots alone so the yield is credited once the source recovers.
                emit AssetReadSkipped(i);
                continue;
            }
            measured += _yield(a.lastRate, a.lastBalance, rate, balance);

            a.lastRate = rate;
            a.lastBalance = balance;
        }

        uint256 cap = maxRevenuePerConsume;
        revenueInWei = (cap != 0 && measured > cap) ? cap : measured;

        emit RevenueConsumed(revenueInWei, measured);
    }

    /// @inheritdoc IStakingRevenueOracle
    function pendingRevenue() external view returns (uint256 revenueInWei) {
        uint256 measured;
        uint256 len = assets.length;
        for (uint256 i; i < len; ++i) {
            Asset storage a = assets[i];
            if (!a.enabled) continue;

            (uint256 rate, uint256 balance, bool ok) = _tryRead(a);
            if (!ok) continue;

            measured += _yield(a.lastRate, a.lastBalance, rate, balance);
        }

        uint256 cap = maxRevenuePerConsume;
        revenueInWei = (cap != 0 && measured > cap) ? cap : measured;
    }

    /**
     * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
     *   READ
     * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
     */

    function numAssets() external view returns (uint256) {
        return assets.length;
    }

    function getAsset(uint256 index) external view returns (Asset memory) {
        if (index >= assets.length) revert BadAssetIndex();
        return assets[index];
    }

    /// @notice Current (rate, balance) reads for an asset, for offchain monitoring of the oracle's inputs
    function readAsset(uint256 index) external view returns (uint256 rate, uint256 balance) {
        if (index >= assets.length) revert BadAssetIndex();
        return _read(assets[index]);
    }

    /**
     * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
     *   ADMIN
     * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
     */

    /**
     * @notice Add an asset to track. Its snapshots are taken immediately, so no yield is credited retroactively.
     * @dev Both calldata blobs must return a single uint256. Reverts if either read fails, which makes a
     * misconfigured asset impossible to add.
     */
    function addAsset(
        string calldata name,
        address balanceProvider,
        bytes calldata balanceCalldata,
        address rateProvider,
        bytes calldata rateCalldata
    ) external onlyOwner returns (uint256 index) {
        index = assets.length;
        assets.push(
            Asset({
                name: name,
                balanceProvider: balanceProvider,
                rateProvider: rateProvider,
                balanceCalldata: balanceCalldata,
                rateCalldata: rateCalldata,
                lastBalance: 0,
                lastRate: 0,
                enabled: true
            })
        );

        Asset storage a = assets[index];
        (uint256 rate, uint256 balance) = _read(a);
        a.lastRate = rate;
        a.lastBalance = balance;

        emit AssetAdded(index, name, balanceProvider, rateProvider);
    }

    /**
     * @notice Remove an asset. The last asset is moved into the removed slot, so indices are not stable
     * across removals.
     */
    function removeAsset(uint256 index) external onlyOwner {
        uint256 len = assets.length;
        if (index >= len) revert BadAssetIndex();

        emit AssetRemoved(index, assets[index].name);

        if (index != len - 1) assets[index] = assets[len - 1];
        assets.pop();
    }

    /**
     * @notice Enable or disable an asset. A disabled asset is skipped and its snapshots stop moving, so
     * re-enabling it credits the yield accrued while it was disabled. Resync first to avoid that.
     */
    function setAssetEnabled(uint256 index, bool enabled) external onlyOwner {
        if (index >= assets.length) revert BadAssetIndex();
        assets[index].enabled = enabled;

        emit AssetEnabledSet(index, enabled);
    }

    /**
     * @notice Move every snapshot to the current reads without crediting anything.
     * @dev Used to drop an accrual the DAO does not want paid out, e.g. yield that piled up while client
     * rewards were paused.
     */
    function resyncAssets() external onlyOwner {
        uint256 len = assets.length;
        for (uint256 i; i < len; ++i) {
            Asset storage a = assets[i];
            (uint256 rate, uint256 balance, bool ok) = _tryRead(a);
            if (!ok) {
                emit AssetReadSkipped(i);
                continue;
            }
            a.lastRate = rate;
            a.lastBalance = balance;
        }

        emit AssetsResynced();
    }

    function setConsumer(address newConsumer) external onlyOwner {
        emit ConsumerSet(consumer, newConsumer);
        consumer = newConsumer;
    }

    function setMaxRevenuePerConsume(uint256 newMax) external onlyOwner {
        emit MaxRevenuePerConsumeSet(maxRevenuePerConsume, newMax);
        maxRevenuePerConsume = newMax;
    }

    /**
     * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
     *   INTERNAL
     * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
     */

    /**
     * @dev Yield is earned only on principal held for the whole period, and only when the rate rose.
     */
    function _yield(
        uint256 lastRate,
        uint256 lastBalance,
        uint256 rate,
        uint256 balance
    ) internal pure returns (uint256) {
        if (rate <= lastRate) return 0;
        uint256 principal = balance < lastBalance ? balance : lastBalance;
        return (principal * (rate - lastRate)) / 1e18;
    }

    /// @dev Strict read, used when configuring an asset so a bad config cannot be stored.
    function _read(Asset storage a) internal view returns (uint256 rate, uint256 balance) {
        bool ok;
        (rate, balance, ok) = _tryRead(a);
        if (!ok) revert AssetReadFailed(a.rateProvider, a.rateCalldata);
    }

    /**
     * @dev Non-reverting read, used on the revenue path. A liquid staking token that is paused, upgraded or
     * otherwise temporarily unreadable must not be able to block client rewards altogether, so its asset is
     * dropped from the period rather than reverting the caller.
     */
    function _tryRead(Asset storage a) internal view returns (uint256 rate, uint256 balance, bool ok) {
        bool rateOk;
        bool balanceOk;
        (rate, rateOk) = _tryStaticcallUint(a.rateProvider, a.rateCalldata);
        (balance, balanceOk) = _tryStaticcallUint(a.balanceProvider, a.balanceCalldata);
        ok = rateOk && balanceOk;
    }

    function _tryStaticcallUint(address target, bytes memory data) internal view returns (uint256, bool) {
        (bool success, bytes memory returndata) = target.staticcall(data);
        if (!success || returndata.length < 32) return (0, false);
        return (abi.decode(returndata, (uint256)), true);
    }
}
