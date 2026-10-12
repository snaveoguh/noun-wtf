// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import { Ownable2Step } from '@openzeppelin/contracts/access/Ownable2Step.sol';
import { Pausable } from '@openzeppelin/contracts/security/Pausable.sol';
import { ReentrancyGuard } from '@openzeppelin/contracts/security/ReentrancyGuard.sol';
import { EIP712 } from '@openzeppelin/contracts/utils/cryptography/EIP712.sol';
import { ECDSA } from '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import { ERC165 } from '@openzeppelin/contracts/utils/introspection/ERC165.sol';
import { IERC165 } from '@openzeppelin/contracts/utils/introspection/IERC165.sol';
import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { SafeERC20 } from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import { IERC721 } from '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import { IERC721Receiver } from '@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol';
import { IERC1155 } from '@openzeppelin/contracts/token/ERC1155/IERC1155.sol';
import { IERC1155Receiver } from '@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol';

/**
 * @title NounWorldDrops
 * @notice Items (ETH, ERC20, ERC721, ERC1155) dropped in Noun World for
 *         players to pick up.
 *
 *         Anyone can deposit an item; each deposit is one drop with an id and
 *         an expiry. A drop can only be claimed with an EIP-712 voucher from
 *         `signer`, the game server's key, which signs one only after the
 *         player has shown a ride trace that reaches the drop in the world.
 *         The voucher names the claimer and is checked against `msg.sender`,
 *         so a voucher seen in the mempool is useless to anyone else, and a
 *         drop pays out once. Unclaimed drops go back to their depositor
 *         after expiry, whenever the depositor asks (even while paused).
 *
 *         The owner can rotate the signer and pause deposits + claims. The
 *         owner can never move deposited items. Not upgradeable.
 */
contract NounWorldDrops is Ownable2Step, Pausable, ReentrancyGuard, EIP712, ERC165, IERC721Receiver, IERC1155Receiver {
    using SafeERC20 for IERC20;

    // ── Types ────────────────────────────────────────────────────────────

    enum Kind {
        ETH,
        ERC20,
        ERC721,
        ERC1155
    }

    enum Status {
        None,
        Open,
        Claimed,
        Reclaimed
    }

    struct Drop {
        address depositor;
        uint64 expiresAt;
        Kind kind;
        Status status;
        /// @dev address(0) for ETH
        address token;
        /// @dev Token id (ERC721 / ERC1155), 0 otherwise
        uint256 tokenId;
        /// @dev Wei / ERC20 units / ERC1155 count; 1 for ERC721
        uint256 amount;
        address claimer;
    }

    // ── Constants ────────────────────────────────────────────────────────

    bytes32 public constant CLAIM_TYPEHASH = keccak256('Claim(uint256 dropId,address claimer,uint256 deadline)');
    uint256 public constant MIN_DURATION = 1 hours;
    uint256 public constant MAX_DURATION = 365 days;

    // ── State ────────────────────────────────────────────────────────────

    /// @notice Key that signs claim vouchers (the game server). address(0) turns claims off.
    address public signer;
    /// @notice Number of drops created; ids run 1..dropCount.
    uint256 public dropCount;
    mapping(uint256 => Drop) public drops;

    // ── Events ───────────────────────────────────────────────────────────

    event DropCreated(
        uint256 indexed dropId,
        address indexed depositor,
        Kind kind,
        address indexed token,
        uint256 tokenId,
        uint256 amount,
        uint64 expiresAt
    );
    event DropClaimed(uint256 indexed dropId, address indexed claimer);
    event DropReclaimed(uint256 indexed dropId, address indexed depositor);
    event SignerUpdated(address indexed previousSigner, address indexed newSigner);

    // ── Errors ───────────────────────────────────────────────────────────

    error BadDuration();
    error ZeroAmount();
    error ZeroAddress();
    error NotOpen();
    error DropExpired();
    error VoucherExpired();
    error BadSignature();
    error NotDepositor();
    error NotExpired();
    error EthTransferFailed();
    error DirectTransferRejected();

    constructor(address owner_, address signer_) EIP712('NounWorldDrops', '1') {
        if (owner_ == address(0)) revert ZeroAddress();
        _transferOwnership(owner_);
        signer = signer_;
        emit SignerUpdated(address(0), signer_);
    }

    // ── Deposits ─────────────────────────────────────────────────────────

    /// @notice Drop the ETH sent, claimable for `duration` seconds.
    function depositETH(uint256 duration) external payable nonReentrant whenNotPaused returns (uint256) {
        if (msg.value == 0) revert ZeroAmount();
        return _create(Kind.ETH, address(0), 0, msg.value, duration);
    }

    /// @notice Drop `amount` of `token` (the amount actually received is what drops).
    function depositERC20(
        address token,
        uint256 amount,
        uint256 duration
    ) external nonReentrant whenNotPaused returns (uint256) {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - before;
        if (received == 0) revert ZeroAmount();
        return _create(Kind.ERC20, token, 0, received, duration);
    }

    /// @notice Drop one NFT (approve this contract first).
    function depositERC721(
        address token,
        uint256 tokenId,
        uint256 duration
    ) external nonReentrant whenNotPaused returns (uint256) {
        if (token == address(0)) revert ZeroAddress();
        IERC721(token).safeTransferFrom(msg.sender, address(this), tokenId);
        return _create(Kind.ERC721, token, tokenId, 1, duration);
    }

    /// @notice Drop `amount` of an ERC1155 id (setApprovalForAll first).
    function depositERC1155(
        address token,
        uint256 tokenId,
        uint256 amount,
        uint256 duration
    ) external nonReentrant whenNotPaused returns (uint256) {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        IERC1155(token).safeTransferFrom(msg.sender, address(this), tokenId, amount, '');
        return _create(Kind.ERC1155, token, tokenId, amount, duration);
    }

    function _create(
        Kind kind,
        address token,
        uint256 tokenId,
        uint256 amount,
        uint256 duration
    ) internal returns (uint256 dropId) {
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert BadDuration();
        dropId = ++dropCount;
        uint64 expiresAt = uint64(block.timestamp + duration);
        drops[dropId] = Drop({
            depositor: msg.sender,
            expiresAt: expiresAt,
            kind: kind,
            status: Status.Open,
            token: token,
            tokenId: tokenId,
            amount: amount,
            claimer: address(0)
        });
        emit DropCreated(dropId, msg.sender, kind, token, tokenId, amount, expiresAt);
    }

    // ── Claim / reclaim ──────────────────────────────────────────────────

    /**
     * @notice Pick up a drop with a voucher the game server signed for the
     *         caller: Claim(dropId, claimer = msg.sender, deadline).
     */
    function claim(uint256 dropId, uint256 deadline, bytes calldata signature) external nonReentrant whenNotPaused {
        Drop storage d = drops[dropId];
        if (d.status != Status.Open) revert NotOpen();
        if (block.timestamp > d.expiresAt) revert DropExpired();
        if (block.timestamp > deadline) revert VoucherExpired();
        (address recovered, ECDSA.RecoverError err) = ECDSA.tryRecover(
            hashClaim(dropId, msg.sender, deadline),
            signature
        );
        if (err != ECDSA.RecoverError.NoError || recovered == address(0) || recovered != signer)
            revert BadSignature();

        d.status = Status.Claimed;
        d.claimer = msg.sender;
        emit DropClaimed(dropId, msg.sender);
        _send(d, msg.sender);
    }

    /// @notice The depositor takes back a drop nobody claimed before it expired.
    function reclaim(uint256 dropId) external nonReentrant {
        Drop storage d = drops[dropId];
        if (d.status != Status.Open) revert NotOpen();
        if (msg.sender != d.depositor) revert NotDepositor();
        if (block.timestamp <= d.expiresAt) revert NotExpired();

        d.status = Status.Reclaimed;
        emit DropReclaimed(dropId, msg.sender);
        _send(d, msg.sender);
    }

    function _send(Drop storage d, address to) internal {
        if (d.kind == Kind.ETH) {
            (bool ok, ) = to.call{ value: d.amount }('');
            if (!ok) revert EthTransferFailed();
        } else if (d.kind == Kind.ERC20) {
            IERC20(d.token).safeTransfer(to, d.amount);
        } else if (d.kind == Kind.ERC721) {
            // safeTransferFrom: a contract claimer must implement onERC721Received
            IERC721(d.token).safeTransferFrom(address(this), to, d.tokenId);
        } else {
            IERC1155(d.token).safeTransferFrom(address(this), to, d.tokenId, d.amount, '');
        }
    }

    // ── Views ────────────────────────────────────────────────────────────

    /// @notice EIP-712 digest the signer signs for a voucher.
    function hashClaim(uint256 dropId, address claimer, uint256 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, dropId, claimer, deadline)));
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function getDrop(uint256 dropId) external view returns (Drop memory) {
        return drops[dropId];
    }

    // ── Admin ────────────────────────────────────────────────────────────

    function setSigner(address newSigner) external onlyOwner {
        emit SignerUpdated(signer, newSigner);
        signer = newSigner;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ── Token receivers ──────────────────────────────────────────────────
    // Only accept tokens this contract pulled in itself (operator == this):
    // a token sent here directly would have no drop and be stuck forever.

    function onERC721Received(address operator, address, uint256, bytes calldata) external view returns (bytes4) {
        if (operator != address(this)) revert DirectTransferRejected();
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(
        address operator,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external view returns (bytes4) {
        if (operator != address(this)) revert DirectTransferRejected();
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        revert DirectTransferRejected();
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC165, IERC165) returns (bool) {
        return
            interfaceId == type(IERC721Receiver).interfaceId ||
            interfaceId == type(IERC1155Receiver).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
