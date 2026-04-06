// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title TreasureChest (UUPS Upgradeable)
 * @notice Accepts ERC20 and ERC721 deposits from anyone. At settlement time,
 *         the operator scatters deposits as claimable drops on the Nouns World
 *         island. First player to reach the drop location and sign a claim tx
 *         receives the item.
 */
contract TreasureChest is
    Initializable,
    ERC721Holder,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ── Types ────────────────────────────────────────────────────────────

    enum ItemType { ERC20, ERC721 }

    struct Deposit {
        address depositor;
        address token;
        uint256 amountOrId;
        ItemType itemType;
        uint64 timestamp;
        bool dropped;
    }

    struct Drop {
        uint256 depositIndex;
        address claimer;
        uint64 droppedAt;
        uint64 claimedAt;
        int16 worldX;
        int16 worldY;
    }

    // ── State ────────────────────────────────────────────────────────────

    Deposit[] public deposits;
    Drop[] public drops;
    address public operator;
    uint64 public constant DROP_EXPIRY = 24 hours;

    // ── Events ───────────────────────────────────────────────────────────

    event Deposited(uint256 indexed depositId, address indexed depositor, address token, uint256 amountOrId, ItemType itemType);
    event Dropped(uint256 indexed dropId, uint256 indexed depositId, int16 worldX, int16 worldY);
    event Claimed(uint256 indexed dropId, address indexed claimer);
    event Expired(uint256 indexed dropId);
    event OperatorUpdated(address indexed newOperator);

    // ── Initializer (replaces constructor for proxy) ─────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    function initialize(address _operator) public initializer {
        __Ownable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        operator = _operator;
    }

    // ── UUPS ─────────────────────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ── Modifiers ────────────────────────────────────────────────────────

    modifier onlyOperator() {
        require(msg.sender == operator || msg.sender == owner(), "Not operator");
        _;
    }

    // ── Deposit Functions ────────────────────────────────────────────────

    function depositERC20(address token, uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        uint256 depositId = deposits.length;
        deposits.push(Deposit({
            depositor: msg.sender,
            token: token,
            amountOrId: amount,
            itemType: ItemType.ERC20,
            timestamp: uint64(block.timestamp),
            dropped: false
        }));
        emit Deposited(depositId, msg.sender, token, amount, ItemType.ERC20);
    }

    function depositERC721(address token, uint256 tokenId) external nonReentrant {
        IERC721(token).safeTransferFrom(msg.sender, address(this), tokenId);

        uint256 depositId = deposits.length;
        deposits.push(Deposit({
            depositor: msg.sender,
            token: token,
            amountOrId: tokenId,
            itemType: ItemType.ERC721,
            timestamp: uint64(block.timestamp),
            dropped: false
        }));
        emit Deposited(depositId, msg.sender, token, tokenId, ItemType.ERC721);
    }

    function depositETH() external payable nonReentrant {
        require(msg.value > 0, "Zero ETH");

        uint256 depositId = deposits.length;
        deposits.push(Deposit({
            depositor: msg.sender,
            token: address(0),
            amountOrId: msg.value,
            itemType: ItemType.ERC20,
            timestamp: uint64(block.timestamp),
            dropped: false
        }));
        emit Deposited(depositId, msg.sender, address(0), msg.value, ItemType.ERC20);
    }

    // ── Drop Functions (operator only) ───────────────────────────────────

    function drop(int16[] calldata positions) external onlyOperator nonReentrant {
        require(positions.length % 2 == 0, "Positions must be pairs");

        uint256 pairCount = positions.length / 2;
        uint256 dropped = 0;

        for (uint256 i = 0; i < deposits.length && dropped < pairCount; i++) {
            if (!deposits[i].dropped) {
                deposits[i].dropped = true;

                uint256 dropId = drops.length;
                drops.push(Drop({
                    depositIndex: i,
                    claimer: address(0),
                    droppedAt: uint64(block.timestamp),
                    claimedAt: 0,
                    worldX: positions[dropped * 2],
                    worldY: positions[dropped * 2 + 1]
                }));
                emit Dropped(dropId, i, positions[dropped * 2], positions[dropped * 2 + 1]);
                dropped++;
            }
        }
    }

    // ── Claim Functions ──────────────────────────────────────────────────

    function claim(uint256 dropId) external nonReentrant {
        require(dropId < drops.length, "Invalid drop");
        Drop storage d = drops[dropId];
        require(d.claimer == address(0), "Already claimed");
        require(block.timestamp <= d.droppedAt + DROP_EXPIRY, "Drop expired");

        d.claimer = msg.sender;
        d.claimedAt = uint64(block.timestamp);

        Deposit storage dep = deposits[d.depositIndex];

        if (dep.token == address(0)) {
            (bool ok, ) = payable(msg.sender).call{value: dep.amountOrId}("");
            require(ok, "ETH transfer failed");
        } else if (dep.itemType == ItemType.ERC20) {
            IERC20(dep.token).safeTransfer(msg.sender, dep.amountOrId);
        } else {
            IERC721(dep.token).safeTransferFrom(address(this), msg.sender, dep.amountOrId);
        }
        emit Claimed(dropId, msg.sender);
    }

    // ── Cancel / Return ──────────────────────────────────────────────────

    function cancelDeposit(uint256 depositId) external nonReentrant {
        require(depositId < deposits.length, "Invalid deposit");
        Deposit storage dep = deposits[depositId];
        require(dep.depositor == msg.sender, "Not your deposit");
        require(!dep.dropped, "Already dropped");

        dep.dropped = true;

        if (dep.token == address(0)) {
            (bool ok, ) = payable(msg.sender).call{value: dep.amountOrId}("");
            require(ok, "ETH return failed");
        } else if (dep.itemType == ItemType.ERC20) {
            IERC20(dep.token).safeTransfer(msg.sender, dep.amountOrId);
        } else {
            IERC721(dep.token).safeTransferFrom(address(this), msg.sender, dep.amountOrId);
        }
    }

    function returnExpired(uint256[] calldata dropIds) external nonReentrant {
        for (uint256 i = 0; i < dropIds.length; i++) {
            uint256 dropId = dropIds[i];
            require(dropId < drops.length, "Invalid drop");
            Drop storage d = drops[dropId];
            require(d.claimer == address(0), "Already claimed");
            require(block.timestamp > d.droppedAt + DROP_EXPIRY, "Not expired");

            d.claimer = address(0xdead);
            Deposit storage dep = deposits[d.depositIndex];

            if (dep.token == address(0)) {
                (bool ok, ) = payable(dep.depositor).call{value: dep.amountOrId}("");
                require(ok, "ETH return failed");
            } else if (dep.itemType == ItemType.ERC20) {
                IERC20(dep.token).safeTransfer(dep.depositor, dep.amountOrId);
            } else {
                IERC721(dep.token).safeTransferFrom(address(this), dep.depositor, dep.amountOrId);
            }
            emit Expired(dropId);
        }
    }

    // ── View Functions ───────────────────────────────────────────────────

    function getDepositCount() external view returns (uint256) { return deposits.length; }
    function getDropCount() external view returns (uint256) { return drops.length; }

    function getPendingDeposits() external view returns (uint256 count) {
        for (uint256 i = 0; i < deposits.length; i++) {
            if (!deposits[i].dropped) count++;
        }
    }

    function getActiveDrops() external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < drops.length; i++) {
            if (drops[i].claimer == address(0) && block.timestamp <= drops[i].droppedAt + DROP_EXPIRY) count++;
        }
        uint256[] memory active = new uint256[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < drops.length; i++) {
            if (drops[i].claimer == address(0) && block.timestamp <= drops[i].droppedAt + DROP_EXPIRY) active[j++] = i;
        }
        return active;
    }

    // ── Admin ────────────────────────────────────────────────────────────

    function setOperator(address _operator) external onlyOwner {
        operator = _operator;
        emit OperatorUpdated(_operator);
    }

    function emergencyWithdrawETH() external onlyOwner {
        (bool ok, ) = payable(owner()).call{value: address(this).balance}("");
        require(ok, "ETH transfer failed");
    }

    function emergencyWithdrawERC20(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(owner(), balance);
    }

    function emergencyWithdrawERC721(address token, uint256 tokenId) external onlyOwner {
        IERC721(token).safeTransferFrom(address(this), owner(), tokenId);
    }

    receive() external payable {}
}
