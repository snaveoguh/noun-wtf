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
 * @notice Lets Noun holders sell their Nouns back to the DAO in a sealed-budget reverse auction, at a discount to
 * the Noun's pro-rata share of treasury net assets.
 *
 * Legal framing (Nouns DUNA Bylaws §3.1 as amended, W.S. 17-32-104(c)(iii)): this is a repurchase of a
 * membership interest by the association, authorized by its governing principles, at a price capped at net
 * asset value. It is the co-op model: a leaving member hands back their share and is paid at most what it is
 * worth on the books, never a share of profits.
 *
 * Every fill is at a discount to NAV, so every exit raises the book value of every Noun that stays: an exit at
 * discount d out of N circulating Nouns adds NAV * d / (N - 1) to each remaining Noun.
 *
 * Mechanics (a modified Dutch auction, the format public companies use for tender-offer buybacks):
 *  - A member escrows Nouns as asks at a discount to NAV of their choosing, in DISCOUNT_STEP_BPS steps between
 *    the DAO's minDiscountBps and MAX_DISCOUNT_BPS, plus an optional absolute minPrice floor. The wallet is
 *    screened against the sanctions oracle and, if a KYC attestor is configured, must present an EIP-712
 *    attestation it signed. Asks are priced against NAV, so they stay valid as NAV moves.
 *  - Once per round anyone may call `settle()`. NAV is frozen for the round. Asks fill deepest discount first
 *    (earliest first within a discount) for as long as everyone filled so far can be paid the current ask's price
 *    within the round budget. Every filled Noun is paid the same clearing price: NAV less the shallowest discount
 *    that filled. Members who will take a bigger haircut leave sooner; nobody is paid less than they asked for.
 *  - The budget, not a count, sets throughput. maxFillsPerRound only bounds gas.
 *  - Repurchased Nouns are transferred to the DAO treasury (not burned); ETH is sent to the member, with a WETH
 *    fallback.
 *  - Asks whose owner is sanctioned at settle time, or whose minPrice is above the price at their discount, are
 *    frozen: pulled from the book but still escrowed. The owner can cancel (take the Noun back) or re-ask.
 *  - NAV = (treasury ETH + this contract's ETH + Σ converter(treasury ERC20 balance) - liabilityReserve)
 *          / (totalSupply - Nouns held by the treasury and other excluded DAO-controlled holders).
 *
 * Owned by the DAO Executor. Every parameter change is a DAO proposal and therefore subject to Compliance
 * Administrator review and the Veto Administrators. Funds can only ever leave to a member (at or below NAV)
 * or back to the treasury.
 */
contract NounsRepurchase is INounsRepurchase, IERC721Receiver, Ownable, Pausable, ReentrancyGuard, EIP712 {
    /// @notice Asks are placed in steps of 0.5%.
    uint16 public constant DISCOUNT_STEP_BPS = 50;

    /// @notice Deepest discount an ask may carry (50%). Guards against a fat-fingered ask.
    uint16 public constant MAX_DISCOUNT_BPS = 5_000;

    /// @notice Hard cap on the DAO's minimum discount (25%), so a proposal cannot close the exit by setting the
    /// floor so deep that no reasonable ask can fill.
    uint16 public constant MAX_MIN_DISCOUNT_BPS = 2_500;

    uint16 internal constant BPS = 10_000;

    /// @dev Levels 0..MAX_LEVEL; one bit per level in `activeLevels`.
    uint8 internal constant MAX_LEVEL = uint8(MAX_DISCOUNT_BPS / DISCOUNT_STEP_BPS);

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

    /// @notice Smallest discount an ask may carry, in basis points.
    uint16 public minDiscountBps;

    /// @notice Most Nouns filled in one round (a gas bound).
    uint16 public maxFillsPerRound;

    /// @notice Minimum seconds between rounds.
    uint32 public roundDuration;

    /// @notice Timestamp of the last round that repurchased at least one Noun.
    uint40 public lastRoundAt;

    /// @notice Most ETH paid out in one round.
    uint256 public budgetPerRound;

    /// @notice ETH-denominated liabilities (committed streams, admin budgets) subtracted from gross assets.
    uint256 public liabilityReserve;

    /// @notice Treasury ERC20 assets counted in NAV.
    Asset[] public assets;

    /// @notice DAO-controlled holders (other than the treasury) whose Nouns are not membership interests,
    /// e.g. the auction house (the Noun currently on auction) and the legacy treasury.
    address[] public extraExcludedHolders;

    /// @notice nounId => ask
    mapping(uint256 => Ask) public asks;

    /// @notice level => FIFO queue of nounIds. Cancelled / frozen / filled / stale slots are skipped at settle.
    mapping(uint8 => uint256[]) internal levelQueue;

    /// @notice level => index of the next queue slot to consider.
    mapping(uint8 => uint256) public levelHead;

    /// @notice level => number of live (unfrozen, unfilled) asks.
    mapping(uint8 => uint256) public levelLive;

    /// @notice Bit i set when level i has at least one live ask.
    uint256 public activeLevels;

    /// @notice Total live asks across all levels.
    uint256 public override liveAsks;

    /// @dev Working state for one settle() call.
    struct Round {
        uint256 budget;
        uint256 maxFills;
        uint256 count;
        uint256 clearingPrice;
        uint8 clearingLevel;
        uint256[] ids;
        address[] owners;
    }

    constructor(
        IERC721Enumerable _nouns,
        address _treasury,
        address _weth,
        IChainalysisSanctionsList _sanctionsOracle,
        address _kycAttestor,
        AuctionParams memory _params,
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
        _setAuctionParams(_params);
        _setLiabilityReserve(_liabilityReserve);
        _setAssets(_assets);
        _setExtraExcludedHolders(_extraExcludedHolders);

        _transferOwnership(_treasury);
    }

    /**
     * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ MEMBER ACTIONS ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
     */

    /**
     * @notice Escrow Nouns as asks at `discountBps` below NAV.
     * @param nounIds Nouns owned by msg.sender (the contract must be approved).
     * @param discountBps Haircut to NAV the member accepts. A multiple of DISCOUNT_STEP_BPS between
     * minDiscountBps and MAX_DISCOUNT_BPS. Deeper discounts fill first.
     * @param minPrice Absolute floor (wei) on top of the discount; 0 for none.
     * @param kycSignature abi.encode(expiry, signature) where signature is the attestor's EIP-712 signature over
     * KycAttestation(msg.sender, expiry). Ignored when no attestor is configured.
     */
    function placeAsks(
        uint256[] calldata nounIds,
        uint16 discountBps,
        uint256 minPrice,
        bytes calldata kycSignature
    ) external override whenNotPaused nonReentrant {
        _requireNotSanctioned(msg.sender);
        _requireKyc(msg.sender, kycSignature);
        uint8 level = _levelOf(discountBps);

        for (uint256 i = 0; i < nounIds.length; ++i) {
            uint256 nounId = nounIds[i];
            // transferFrom enforces ownership / approval.
            nouns.transferFrom(msg.sender, address(this), nounId);
            _enqueue(nounId, msg.sender, level, minPrice);
            emit AskPlaced(nounId, msg.sender, discountBps, minPrice);
        }
    }

    /**
     * @notice Change the discount and floor on escrowed Nouns, or put frozen asks back in the book.
     * @dev Any change goes to the back of the new discount's queue, like re-pricing an order.
     */
    function updateAsks(
        uint256[] calldata nounIds,
        uint16 discountBps,
        uint256 minPrice
    ) external override whenNotPaused nonReentrant {
        _requireNotSanctioned(msg.sender);
        uint8 level = _levelOf(discountBps);

        for (uint256 i = 0; i < nounIds.length; ++i) {
            uint256 nounId = nounIds[i];
            Ask memory a = asks[nounId];
            if (a.owner != msg.sender) revert NotAskOwner(nounId);
            if (a.frozen == FreezeReason.None) _removeLive(a.level);
            _enqueue(nounId, msg.sender, level, minPrice);
            emit AskPlaced(nounId, msg.sender, discountBps, minPrice);
        }
    }

    /**
     * @notice Withdraw Nouns from the book before they are repurchased.
     * @dev Allowed even while paused and even for frozen asks: the Noun is the member's property.
     */
    function cancelAsks(uint256[] calldata nounIds) external override nonReentrant {
        for (uint256 i = 0; i < nounIds.length; ++i) {
            uint256 nounId = nounIds[i];
            Ask memory a = asks[nounId];
            if (a.owner != msg.sender) revert NotAskOwner(nounId);
            if (a.frozen == FreezeReason.None) _removeLive(a.level);
            delete asks[nounId];
            nouns.transferFrom(address(this), msg.sender, nounId);
            emit AskCancelled(nounId, msg.sender);
        }
    }

    /**
     * @notice Clear one round of the auction.
     * @dev Permissionless. Reverts if a round has not elapsed since the last round that filled. Does not start a
     * new round if nothing filled (e.g. the program is unfunded), so the book is retried as soon as the DAO tops
     * the contract up.
     *
     * Walks the book from the deepest discount up. An ask is accepted while (filled + 1) * its price fits in the
     * budget; prices only rise as the walk moves up, so the first ask that does not fit ends the round. All
     * accepted asks are then paid the price of the last (shallowest) one accepted.
     */
    function settle() external override whenNotPaused nonReentrant returns (uint256 filledCount) {
        uint256 nextRoundAt = uint256(lastRoundAt) + roundDuration;
        if (block.timestamp < nextRoundAt) revert RoundNotElapsed(nextRoundAt);
        if (liveAsks == 0) revert NothingToSettle();

        uint256 nav = navPerNoun();
        if (nav == 0) revert ZeroNav();

        Round memory r;
        r.budget = budgetPerRound;
        if (address(this).balance < r.budget) r.budget = address(this).balance;
        r.maxFills = maxFillsPerRound;
        r.ids = new uint256[](r.maxFills);
        r.owners = new address[](r.maxFills);

        uint256 minLevel = minDiscountBps / DISCOUNT_STEP_BPS;
        for (uint256 l = uint256(MAX_LEVEL) + 1; l > minLevel; ) {
            --l;
            if (activeLevels & (uint256(1) << l) == 0) continue;
            if (_fillLevel(r, uint8(l), _priceAtLevel(nav, uint8(l)))) break;
        }

        filledCount = r.count;
        if (filledCount == 0) return 0;

        lastRoundAt = uint40(block.timestamp);

        for (uint256 i = 0; i < filledCount; ++i) {
            nouns.transferFrom(address(this), treasury, r.ids[i]);
            _safeTransferETHWithFallback(r.owners[i], r.clearingPrice);
            emit RepurchaseSettled(r.ids[i], r.owners[i], r.clearingPrice);
        }

        emit RoundSettled(uint16(r.clearingLevel) * DISCOUNT_STEP_BPS, r.clearingPrice, filledCount, nav);
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

    /// @notice What a Noun asked at `discountBps` would be paid if it set the clearing price right now.
    function priceAtDiscount(uint16 discountBps) external view override returns (uint256) {
        if (discountBps > MAX_DISCOUNT_BPS || discountBps % DISCOUNT_STEP_BPS != 0) revert InvalidDiscount(discountBps);
        return _priceAtLevel(navPerNoun(), uint8(discountBps / DISCOUNT_STEP_BPS));
    }

    /**
     * @notice Estimate of what `settle()` would do now: the clearing discount, the price every filled Noun is
     * paid, and how many fill.
     * @dev Counts live asks per discount level, so it does not know about asks that settle would freeze
     * (owner sanctioned since asking, or minPrice above the ask's price). Ignores the round timer.
     */
    function previewSettle()
        external
        view
        override
        returns (uint16 clearingDiscountBps, uint256 price, uint256 filledCount)
    {
        uint256 nav = navPerNoun();
        if (nav == 0) return (0, 0, 0);

        uint256 budget = budgetPerRound;
        if (address(this).balance < budget) budget = address(this).balance;
        uint256 maxFills = maxFillsPerRound;
        uint256 minLevel = minDiscountBps / DISCOUNT_STEP_BPS;

        for (uint256 l = uint256(MAX_LEVEL) + 1; l > minLevel; ) {
            --l;
            uint8 level = uint8(l);
            uint256 live = levelLive[level];
            if (live == 0) continue;

            uint256 levelPrice = _priceAtLevel(nav, level);
            uint256 cap = budget / levelPrice;
            if (cap > maxFills) cap = maxFills;
            if (cap <= filledCount) break;

            uint256 take = cap - filledCount;
            if (take > live) take = live;
            filledCount += take;
            clearingDiscountBps = uint16(level) * DISCOUNT_STEP_BPS;
            price = levelPrice;
            if (take < live) break;
        }
    }

    /// @notice Queue slots at a discount level (includes cancelled / frozen / filled / stale slots).
    function levelQueueLength(uint16 discountBps) external view returns (uint256) {
        return levelQueue[uint8(discountBps / DISCOUNT_STEP_BPS)].length;
    }

    /// @notice nounId in a discount level's queue slot.
    function levelQueueAt(uint16 discountBps, uint256 slot) external view returns (uint256) {
        return levelQueue[uint8(discountBps / DISCOUNT_STEP_BPS)][slot];
    }

    function assetsLength() external view returns (uint256) {
        return assets.length;
    }

    function extraExcludedHoldersLength() external view returns (uint256) {
        return extraExcludedHolders.length;
    }

    /**
     * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ DAO ADMIN ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
     */

    function setAuctionParams(AuctionParams calldata _params) external onlyOwner {
        _setAuctionParams(_params);
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

    /// @notice Move a Noun that was sent here outside of placeAsks (and so has no ask) to the treasury.
    function recoverStrayNoun(uint256 nounId) external onlyOwner {
        if (asks[nounId].owner != address(0)) revert NounIsTracked(nounId);
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

    /// @dev Only Nouns arriving through placeAsks are tracked; reject stray safeTransfers.
    function onERC721Received(
        address operator,
        address,
        uint256,
        bytes calldata
    ) external view override returns (bytes4) {
        require(operator == address(this), 'NounsRepurchase: use placeAsks');
        return IERC721Receiver.onERC721Received.selector;
    }

    /**
     * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ INTERNAL ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
     */

    /**
     * @dev Accept asks from one discount level, earliest first, into `r`. Advances the level's head past every slot
     * it consumed (filled, frozen, or stale). Returns true when the round is full: the next ask at this price does
     * not fit the budget (and asks at shallower levels cost more), or maxFills is reached.
     */
    function _fillLevel(Round memory r, uint8 level, uint256 price) internal returns (bool done) {
        uint256[] storage q = levelQueue[level];
        uint256 head = levelHead[level];
        uint256 len = q.length;

        while (head < len) {
            uint256 nounId = q[head];
            Ask memory a = asks[nounId];

            // Cancelled, filled, frozen, or a stale slot from an earlier ask on the same Noun.
            if (a.owner == address(0) || a.frozen != FreezeReason.None || a.level != level || a.slot != head) {
                ++head;
                continue;
            }

            if (_isSanctioned(a.owner)) {
                // Never pay a sanctioned wallet. Pull it out of the book; the owner may still cancel.
                _freeze(nounId, a, FreezeReason.Sanctioned);
                ++head;
                continue;
            }

            // Checked against the ask's own price, which is never above the clearing price.
            if (price < a.minPrice) {
                _freeze(nounId, a, FreezeReason.BelowMinPrice);
                ++head;
                continue;
            }

            if (r.count == r.maxFills || (r.count + 1) * price > r.budget) {
                done = true;
                break;
            }

            r.ids[r.count] = nounId;
            r.owners[r.count] = a.owner;
            ++r.count;
            r.clearingPrice = price;
            r.clearingLevel = level;

            delete asks[nounId];
            _removeLive(level);
            ++head;
        }

        levelHead[level] = head;
    }

    function _enqueue(uint256 nounId, address owner, uint8 level, uint256 minPrice) internal {
        uint256[] storage q = levelQueue[level];
        uint256 slot = q.length;
        q.push(nounId);
        asks[nounId] = Ask({
            owner: owner,
            placedAt: uint40(block.timestamp),
            level: level,
            slot: uint48(slot),
            frozen: FreezeReason.None,
            minPrice: uint128(minPrice)
        });
        _addLive(level);
    }

    function _freeze(uint256 nounId, Ask memory a, FreezeReason reason) internal {
        asks[nounId].frozen = reason;
        _removeLive(a.level);
        emit AskFrozen(nounId, a.owner, reason);
    }

    function _addLive(uint8 level) internal {
        if (levelLive[level]++ == 0) activeLevels |= (uint256(1) << level);
        ++liveAsks;
    }

    function _removeLive(uint8 level) internal {
        if (--levelLive[level] == 0) activeLevels &= ~(uint256(1) << level);
        --liveAsks;
    }

    /// @dev Validates an ask's discount and converts it to a level.
    function _levelOf(uint16 discountBps) internal view returns (uint8) {
        if (
            discountBps < minDiscountBps || discountBps > MAX_DISCOUNT_BPS || discountBps % DISCOUNT_STEP_BPS != 0
        ) revert InvalidDiscount(discountBps);
        return uint8(discountBps / DISCOUNT_STEP_BPS);
    }

    function _priceAtLevel(uint256 nav, uint8 level) internal pure returns (uint256) {
        return (nav * (BPS - uint256(level) * DISCOUNT_STEP_BPS)) / BPS;
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

    function _setAuctionParams(AuctionParams memory _params) internal {
        if (_params.minDiscountBps > MAX_MIN_DISCOUNT_BPS || _params.minDiscountBps % DISCOUNT_STEP_BPS != 0) {
            revert InvalidMinDiscount();
        }
        if (_params.maxFillsPerRound == 0) revert ZeroMaxFills();
        if (_params.roundDuration == 0) revert ZeroRoundDuration();
        minDiscountBps = _params.minDiscountBps;
        maxFillsPerRound = _params.maxFillsPerRound;
        roundDuration = _params.roundDuration;
        budgetPerRound = _params.budgetPerRound;
        emit AuctionParamsUpdated(
            _params.minDiscountBps,
            _params.maxFillsPerRound,
            _params.roundDuration,
            _params.budgetPerRound
        );
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
