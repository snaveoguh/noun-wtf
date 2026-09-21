// SPDX-License-Identifier: GPL-3.0

/// @title Nouns DAO membership-interest repurchase program

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
import { Pausable } from '@openzeppelin/contracts/security/Pausable.sol';
import { ReentrancyGuard } from '@openzeppelin/contracts/security/ReentrancyGuard.sol';
import { EIP712 } from '@openzeppelin/contracts/utils/cryptography/EIP712.sol';
import { ECDSA } from '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { IERC721Receiver } from '@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol';
import { IERC721Enumerable } from '@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol';
import { INounsRepurchase } from '../interfaces/INounsRepurchase.sol';
import { IEthConverter } from '../interfaces/IEthConverter.sol';
import { IWETH } from '../interfaces/IWETH.sol';
import { IChainalysisSanctionsList } from '../external/chainalysis/IChainalysisSanctionsList.sol';

/**
 * @notice Lets a Noun holder exit at no more than the Noun's pro-rata share of treasury net assets.
 *
 * Legal framing (Nouns DUNA Bylaws §3.1 as amended, W.S. 17-32-104(c)(iii)): this is a repurchase of a
 * membership interest by the association, authorized by its governing principles, at a price capped at net
 * asset value. It is the co-op model: a leaving member hands back their share and is paid what it is worth on
 * the books, never a share of profits. Every remaining Noun's book value is unchanged (spread == 0) or
 * increased (spread > 0) by each repurchase.
 *
 * Mechanics:
 *  - A member escrows Nouns into a FIFO queue with an optional minimum price. The wallet is screened against
 *    the sanctions oracle and, if a KYC attestor is configured, must present an EIP-712 attestation it signed.
 *  - Once per tick (e.g. daily) anyone may call `settle()`. The price is frozen for the tick at
 *    NAV * (1 - spread). Up to `maxPerTick` Nouns are repurchased in queue order. Repurchased Nouns are
 *    transferred to the DAO treasury (not burned); ETH is sent to the member, with a WETH fallback.
 *  - Entries whose owner is sanctioned at settle time, or whose minPrice is above the tick price, are frozen:
 *    pulled from the queue but still escrowed. The owner can cancel (take the Noun back) or requeue.
 *  - NAV = (treasury ETH + this contract's ETH + Σ converter(treasury ERC20 balance) - liabilityReserve)
 *          / (totalSupply - Nouns held by the treasury and other excluded DAO-controlled holders).
 *
 * Owned by the DAO Executor. Every parameter change is a DAO proposal and therefore subject to Compliance
 * Administrator review and the Veto Administrators. Funds can only ever leave to a member (at the tick price)
 * or back to the treasury.
 */
contract NounsRepurchase is INounsRepurchase, IERC721Receiver, Ownable, Pausable, ReentrancyGuard, EIP712 {
    /// @notice Hard cap on the spread (25%). Protects queued members from a proposal that would buy them out for ~0.
    uint16 public constant MAX_SPREAD_BPS = 2_500;

    uint16 internal constant BPS = 10_000;

    bytes32 public constant KYC_ATTESTATION_TYPEHASH = keccak256('KycAttestation(address member,uint256 expiry)');

    /// @notice The Nouns ERC721 token contract
    IERC721Enumerable public immutable nouns;

    /// @notice The DAO treasury (NounsDAOExecutor). Receives repurchased Nouns; its balances define NAV.
    address public immutable treasury;

    /// @notice WETH, used as a fallback when a member cannot receive ETH.
    address public immutable weth;

    /// @notice Chainalysis-style sanctions oracle. Zero address disables screening (not recommended).
    IChainalysisSanctionsList public sanctionsOracle;

    /// @notice Signer for KYC attestations. Zero address disables the KYC gate.
    address public kycAttestor;

    /// @notice Discount below NAV, in basis points. price = NAV * (10_000 - spreadBps) / 10_000.
    uint16 public spreadBps;

    /// @notice Maximum number of Nouns repurchased per tick.
    uint16 public maxPerTick;

    /// @notice Minimum seconds between ticks.
    uint32 public tickDuration;

    /// @notice Timestamp of the last tick that repurchased at least one Noun.
    uint40 public lastTickAt;

    /// @notice ETH-denominated liabilities (committed streams, admin budgets) subtracted from gross assets.
    uint256 public liabilityReserve;

    /// @notice Treasury ERC20 assets counted in NAV.
    Asset[] public assets;

    /// @notice DAO-controlled holders (other than the treasury) whose Nouns are not membership interests,
    /// e.g. the auction house (the Noun currently on auction) and the legacy treasury.
    address[] public extraExcludedHolders;

    /// @notice nounId => request
    mapping(uint256 => Request) public requests;

    /// @notice FIFO queue of nounIds. Cancelled / frozen / stale entries are skipped at settle time.
    uint256[] public queue;

    /// @notice Index of the next queue entry to consider.
    uint256 public queueHead;

    constructor(
        IERC721Enumerable _nouns,
        address _treasury,
        address _weth,
        IChainalysisSanctionsList _sanctionsOracle,
        address _kycAttestor,
        uint16 _spreadBps,
        uint16 _maxPerTick,
        uint32 _tickDuration,
        uint256 _liabilityReserve,
        Asset[] memory _assets,
        address[] memory _extraExcludedHolders
    ) EIP712('NounsRepurchase', '1') {
        if (address(_nouns) == address(0) || _treasury == address(0) || _weth == address(0)) revert ZeroAddress();
        nouns = _nouns;
        treasury = _treasury;
        weth = _weth;

        _setSanctionsOracle(_sanctionsOracle);
        _setKycAttestor(_kycAttestor);
        _setSpreadBps(_spreadBps);
        _setMaxPerTick(_maxPerTick);
        _setTickDuration(_tickDuration);
        _setLiabilityReserve(_liabilityReserve);
        _setAssets(_assets);
        _setExtraExcludedHolders(_extraExcludedHolders);

        _transferOwnership(_treasury);
    }

    /**
     * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ MEMBER ACTIONS ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
     */

    /**
     * @notice Escrow Nouns into the repurchase queue.
     * @param nounIds Nouns owned by msg.sender (the contract must be approved).
     * @param minPrice Lowest tick price (wei) the member will accept; 0 for no floor.
     * @param kycSignature abi.encode(expiry, signature) where signature is the attestor's EIP-712 signature over
     * KycAttestation(msg.sender, expiry). Ignored when no attestor is configured.
     */
    function requestRepurchase(
        uint256[] calldata nounIds,
        uint256 minPrice,
        bytes calldata kycSignature
    ) external override whenNotPaused nonReentrant {
        _requireNotSanctioned(msg.sender);
        _requireKyc(msg.sender, kycSignature);

        for (uint256 i = 0; i < nounIds.length; ++i) {
            uint256 nounId = nounIds[i];
            // transferFrom enforces ownership / approval.
            nouns.transferFrom(msg.sender, address(this), nounId);
            uint256 index = _enqueue(nounId, msg.sender, minPrice);
            emit RepurchaseRequested(nounId, msg.sender, index, minPrice);
        }
    }

    /**
     * @notice Put frozen requests back at the end of the queue, optionally with a new minPrice.
     */
    function requeue(uint256[] calldata nounIds, uint256 minPrice) external override whenNotPaused nonReentrant {
        _requireNotSanctioned(msg.sender);

        for (uint256 i = 0; i < nounIds.length; ++i) {
            uint256 nounId = nounIds[i];
            Request memory r = requests[nounId];
            if (r.owner != msg.sender) revert NotRequestOwner(nounId);
            if (r.frozen == FreezeReason.None) revert RequestNotFrozen(nounId);
            uint256 index = _enqueue(nounId, msg.sender, minPrice);
            emit RepurchaseRequeued(nounId, msg.sender, index, minPrice);
        }
    }

    /**
     * @notice Withdraw Nouns from the program before they are repurchased.
     * @dev Allowed even while paused and even for frozen requests: the Noun is the member's property.
     */
    function cancelRequest(uint256[] calldata nounIds) external override nonReentrant {
        for (uint256 i = 0; i < nounIds.length; ++i) {
            uint256 nounId = nounIds[i];
            if (requests[nounId].owner != msg.sender) revert NotRequestOwner(nounId);
            delete requests[nounId];
            nouns.transferFrom(address(this), msg.sender, nounId);
            emit RepurchaseCancelled(nounId, msg.sender);
        }
    }

    /**
     * @notice Repurchase up to `maxPerTick` queued Nouns at the current tick's frozen price.
     * @dev Permissionless. Reverts if a tick has not elapsed since the last successful settle.
     * Does not advance the tick if nothing could be repurchased (e.g. insufficient funds), so the
     * queue is retried as soon as the DAO tops the contract up.
     */
    function settle() external override whenNotPaused nonReentrant returns (uint256 settledCount) {
        uint256 nextTickAt = uint256(lastTickAt) + tickDuration;
        if (block.timestamp < nextTickAt) revert TickNotElapsed(nextTickAt);
        if (queueHead >= queue.length) revert NothingToSettle();

        uint256 nav = navPerNoun();
        uint256 price = _priceFromNav(nav);
        uint256 head = queueHead;
        uint256 len = queue.length;
        uint16 max = maxPerTick;

        while (head < len && settledCount < max) {
            uint256 nounId = queue[head];
            Request memory r = requests[nounId];

            // Cancelled, settled, already frozen, or a stale slot from an earlier request of the same Noun.
            if (r.owner == address(0) || r.frozen != FreezeReason.None || r.queueIndex != head) {
                ++head;
                continue;
            }

            if (_isSanctioned(r.owner)) {
                // Never pay a sanctioned wallet. Pull it out of the queue; the owner may still cancel.
                requests[nounId].frozen = FreezeReason.Sanctioned;
                emit RequestFrozen(nounId, r.owner, FreezeReason.Sanctioned);
                ++head;
                continue;
            }

            if (price < r.minPrice) {
                requests[nounId].frozen = FreezeReason.BelowMinPrice;
                emit RequestFrozen(nounId, r.owner, FreezeReason.BelowMinPrice);
                ++head;
                continue;
            }

            if (address(this).balance < price) {
                emit InsufficientFunds(price, address(this).balance);
                break;
            }

            ++head;
            delete requests[nounId];
            nouns.transferFrom(address(this), treasury, nounId);
            _safeTransferETHWithFallback(r.owner, price);
            emit RepurchaseSettled(nounId, r.owner, price);
            ++settledCount;
        }

        queueHead = head;

        if (settledCount > 0) {
            lastTickAt = uint40(block.timestamp);
            emit TickSettled(price, settledCount, nav);
        }
    }

    /**
     * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ VIEWS ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
     */

    /// @notice Gross ETH-equivalent assets: treasury ETH, this contract's ETH, and converted treasury ERC20s.
    /// @dev A failing token or converter is valued at zero, which can only lower the price the DAO pays.
    function totalAssetsEth() public view override returns (uint256 total) {
        total = treasury.balance + address(this).balance;
        uint256 len = assets.length;
        for (uint256 i = 0; i < len; ++i) {
            Asset memory a = assets[i];
            try a.token.balanceOf(treasury) returns (uint256 bal) {
                if (bal == 0) continue;
                try a.converter.toEth(bal) returns (uint256 value) {
                    total += value;
                } catch {}
            } catch {}
        }
    }

    /// @notice Nouns that represent member interests: total supply less Nouns held by the treasury and other
    /// DAO-controlled addresses. Escrowed Nouns are still owned by members and still count.
    function circulatingSupply() public view override returns (uint256) {
        uint256 excluded = nouns.balanceOf(treasury);
        uint256 len = extraExcludedHolders.length;
        for (uint256 i = 0; i < len; ++i) {
            excluded += nouns.balanceOf(extraExcludedHolders[i]);
        }
        uint256 supply = nouns.totalSupply();
        return supply > excluded ? supply - excluded : 0;
    }

    /// @notice Net asset value per circulating Noun, in wei.
    function navPerNoun() public view override returns (uint256) {
        uint256 supply = circulatingSupply();
        if (supply == 0) revert NoCirculatingNouns();
        uint256 gross = totalAssetsEth();
        uint256 reserve = liabilityReserve;
        if (gross <= reserve) return 0;
        return (gross - reserve) / supply;
    }

    /// @notice The price the next tick would pay per Noun: NAV less the spread.
    function repurchasePrice() public view override returns (uint256) {
        return _priceFromNav(navPerNoun());
    }

    /// @notice Number of queue slots not yet considered by settle (includes cancelled / frozen / stale slots).
    function pendingCount() external view override returns (uint256) {
        return queue.length - queueHead;
    }

    function assetsLength() external view returns (uint256) {
        return assets.length;
    }

    function extraExcludedHoldersLength() external view returns (uint256) {
        return extraExcludedHolders.length;
    }

    function queueLength() external view returns (uint256) {
        return queue.length;
    }

    /**
     * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ DAO ADMIN ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
     */

    function setSpreadBps(uint16 _spreadBps) external onlyOwner {
        _setSpreadBps(_spreadBps);
    }

    function setMaxPerTick(uint16 _maxPerTick) external onlyOwner {
        _setMaxPerTick(_maxPerTick);
    }

    function setTickDuration(uint32 _tickDuration) external onlyOwner {
        _setTickDuration(_tickDuration);
    }

    function setLiabilityReserve(uint256 _liabilityReserve) external onlyOwner {
        _setLiabilityReserve(_liabilityReserve);
    }

    function setSanctionsOracle(IChainalysisSanctionsList _sanctionsOracle) external onlyOwner {
        _setSanctionsOracle(_sanctionsOracle);
    }

    function setKycAttestor(address _kycAttestor) external onlyOwner {
        _setKycAttestor(_kycAttestor);
    }

    function setAssets(Asset[] calldata _assets) external onlyOwner {
        _setAssets(_assets);
    }

    function setExtraExcludedHolders(address[] calldata _holders) external onlyOwner {
        _setExtraExcludedHolders(_holders);
    }

    /// @notice Send unspent funding back to the treasury. Funds can only ever go to the treasury or to members.
    function returnFundsToTreasury(uint256 amount) external onlyOwner {
        _safeTransferETHWithFallback(treasury, amount);
        emit FundsReturnedToTreasury(amount);
    }

    /// @notice Move a Noun that was sent here outside of requestRepurchase (and so has no request) to the treasury.
    function recoverStrayNoun(uint256 nounId) external onlyOwner {
        if (requests[nounId].owner != address(0)) revert NounIsTracked(nounId);
        nouns.transferFrom(address(this), treasury, nounId);
        emit StrayNounRecovered(nounId);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Accept funding from the treasury (or anyone; donations only raise NAV).
    receive() external payable {}

    /// @dev Only Nouns arriving through requestRepurchase are tracked; reject stray safeTransfers.
    function onERC721Received(
        address operator,
        address,
        uint256,
        bytes calldata
    ) external view override returns (bytes4) {
        require(operator == address(this), 'NounsRepurchase: use requestRepurchase');
        return IERC721Receiver.onERC721Received.selector;
    }

    /**
     * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ INTERNAL ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
     */

    function _enqueue(uint256 nounId, address owner, uint256 minPrice) internal returns (uint256 index) {
        index = queue.length;
        queue.push(nounId);
        requests[nounId] = Request({
            owner: owner,
            requestedAt: uint40(block.timestamp),
            queueIndex: uint48(index),
            frozen: FreezeReason.None,
            minPrice: uint128(minPrice)
        });
    }

    function _priceFromNav(uint256 nav) internal view returns (uint256) {
        return (nav * (BPS - spreadBps)) / BPS;
    }

    function _isSanctioned(address account) internal view returns (bool) {
        IChainalysisSanctionsList oracle = sanctionsOracle;
        return address(oracle) != address(0) && oracle.isSanctioned(account);
    }

    function _requireNotSanctioned(address account) internal view {
        if (_isSanctioned(account)) revert SanctionedMember(account);
    }

    function _requireKyc(address member, bytes calldata kycSignature) internal view {
        address attestor = kycAttestor;
        if (attestor == address(0)) return;
        if (kycSignature.length == 0) revert KycAttestationRequired();

        (uint256 expiry, bytes memory signature) = abi.decode(kycSignature, (uint256, bytes));
        if (expiry < block.timestamp) revert InvalidKycAttestation();

        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(KYC_ATTESTATION_TYPEHASH, member, expiry)));
        (address signer, ECDSA.RecoverError err) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || signer != attestor) revert InvalidKycAttestation();
    }

    function _setSpreadBps(uint16 _spreadBps) internal {
        if (_spreadBps > MAX_SPREAD_BPS) revert SpreadTooHigh();
        spreadBps = _spreadBps;
        emit SpreadBpsUpdated(_spreadBps);
    }

    function _setMaxPerTick(uint16 _maxPerTick) internal {
        if (_maxPerTick == 0) revert ZeroMaxPerTick();
        maxPerTick = _maxPerTick;
        emit MaxPerTickUpdated(_maxPerTick);
    }

    function _setTickDuration(uint32 _tickDuration) internal {
        if (_tickDuration == 0) revert ZeroTickDuration();
        tickDuration = _tickDuration;
        emit TickDurationUpdated(_tickDuration);
    }

    function _setLiabilityReserve(uint256 _liabilityReserve) internal {
        liabilityReserve = _liabilityReserve;
        emit LiabilityReserveUpdated(_liabilityReserve);
    }

    function _setSanctionsOracle(IChainalysisSanctionsList _sanctionsOracle) internal {
        sanctionsOracle = _sanctionsOracle;
        emit SanctionsOracleUpdated(address(_sanctionsOracle));
    }

    function _setKycAttestor(address _kycAttestor) internal {
        kycAttestor = _kycAttestor;
        emit KycAttestorUpdated(_kycAttestor);
    }

    function _setAssets(Asset[] memory _assets) internal {
        delete assets;
        for (uint256 i = 0; i < _assets.length; ++i) {
            if (address(_assets[i].token) == address(0) || address(_assets[i].converter) == address(0)) {
                revert ZeroAddress();
            }
            assets.push(_assets[i]);
        }
        emit AssetsUpdated(_assets.length);
    }

    function _setExtraExcludedHolders(address[] memory _holders) internal {
        delete extraExcludedHolders;
        for (uint256 i = 0; i < _holders.length; ++i) {
            if (_holders[i] == address(0)) revert ZeroAddress();
            extraExcludedHolders.push(_holders[i]);
        }
        emit ExcludedHoldersUpdated(_holders.length);
    }

    /// @dev Mirrors NounsAuctionHouse: try a plain ETH transfer, fall back to WETH so a member can never block settle.
    function _safeTransferETHWithFallback(address to, uint256 amount) internal {
        if (!_safeTransferETH(to, amount)) {
            IWETH(weth).deposit{ value: amount }();
            IERC20(weth).transfer(to, amount);
        }
    }

    function _safeTransferETH(address to, uint256 value) internal returns (bool) {
        (bool success, ) = to.call{ value: value, gas: 30_000 }(new bytes(0));
        return success;
    }
}
