// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title NounDerivatives
 * @notice Permissionless ERC721 + lazy reserve auctions for Noun derivative art.
 *
 * Modeled on Nouns Auction House (itself a Zora fork), but per-token
 * instead of a single continuous auction. Auctions activate lazily
 * on first bid — no timer ticking until someone actually bids.
 *
 * Flow:
 * 1. Creator calls createDerivative(nounId, tokenURI, reservePrice)
 *    → mints ERC721 to contract (escrow), stores auction params
 * 2. Anyone calls createBid(tokenId) with ETH ≥ reservePrice
 *    → first bid activates the auction (sets endTime = now + duration)
 *    → subsequent bids must exceed previous + minBidIncrementPct
 *    → bids within timeBuffer extend the auction
 * 3. After endTime, anyone calls settleAuction(tokenId)
 *    → NFT transfers to winner, ETH goes to creator
 * 4. Creator can cancelAuction(tokenId) if no bids placed
 *    → burns the token
 */
contract NounDerivatives is ERC721, ReentrancyGuard {

    struct Auction {
        uint256 nounId;          // which Noun this is a derivative of
        address payable creator; // derivative creator (receives proceeds)
        uint128 reservePrice;    // minimum first bid
        uint128 amount;          // current highest bid
        address payable bidder;  // current highest bidder
        uint40 startTime;        // 0 until first bid (lazy activation)
        uint40 endTime;          // startTime + duration, extends on late bids
        bool settled;            // whether auction is finalized
        string tokenURI_;        // IPFS metadata URI
    }

    uint256 public nextTokenId;
    uint40 public duration = 24 hours;
    uint8 public minBidIncrementPercentage = 5;
    uint40 public timeBuffer = 5 minutes;

    mapping(uint256 => Auction) public auctions;

    // ── Events ──────────────────────────────────────────────────────────

    event DerivativeCreated(
        uint256 indexed tokenId,
        uint256 indexed nounId,
        address creator,
        uint128 reservePrice,
        string tokenURI
    );

    event AuctionBid(
        uint256 indexed tokenId,
        address bidder,
        uint256 amount,
        bool extended
    );

    event AuctionSettled(
        uint256 indexed tokenId,
        address winner,
        uint256 amount
    );

    event AuctionCancelled(uint256 indexed tokenId);

    // ── Constructor ─────────────────────────────────────────────────────

    constructor() ERC721("NounDerivatives", "NDERIV") {}

    // ── Create ──────────────────────────────────────────────────────────

    /**
     * @notice Mint a derivative NFT and list it for auction.
     * @param nounId Which Noun this is a derivative of
     * @param tokenURI_ IPFS metadata URI
     * @param reservePrice Minimum first bid in wei
     */
    function createDerivative(
        uint256 nounId,
        string calldata tokenURI_,
        uint128 reservePrice
    ) external returns (uint256 tokenId) {
        require(reservePrice > 0, "Reserve must be > 0");

        tokenId = nextTokenId++;

        // Mint to contract (escrow) — no approval needed for settlement
        _mint(address(this), tokenId);

        auctions[tokenId] = Auction({
            nounId: nounId,
            creator: payable(msg.sender),
            reservePrice: reservePrice,
            amount: 0,
            bidder: payable(address(0)),
            startTime: 0,
            endTime: 0,
            settled: false,
            tokenURI_: tokenURI_
        });

        emit DerivativeCreated(tokenId, nounId, msg.sender, reservePrice, tokenURI_);
    }

    // ── Bid ─────────────────────────────────────────────────────────────

    /**
     * @notice Place a bid on a derivative auction.
     * First bid activates the auction timer.
     */
    function createBid(uint256 tokenId) external payable nonReentrant {
        Auction storage a = auctions[tokenId];
        require(a.creator != address(0), "Auction does not exist");
        require(!a.settled, "Auction already settled");

        // First bid — activate the auction
        if (a.startTime == 0) {
            require(msg.value >= a.reservePrice, "Bid below reserve");
            a.startTime = uint40(block.timestamp);
            a.endTime = uint40(block.timestamp) + duration;
        } else {
            require(block.timestamp < a.endTime, "Auction expired");
            uint256 minBid = a.amount + (a.amount * minBidIncrementPercentage / 100);
            require(msg.value >= minBid, "Bid too low");
        }

        // Refund previous bidder
        address payable lastBidder = a.bidder;
        uint256 lastAmount = a.amount;

        a.amount = uint128(msg.value);
        a.bidder = payable(msg.sender);

        if (lastBidder != address(0)) {
            _safeTransferETH(lastBidder, lastAmount);
        }

        // Extend if bid is within timeBuffer of end
        bool extended = false;
        if (a.endTime - block.timestamp < timeBuffer) {
            a.endTime = uint40(block.timestamp) + timeBuffer;
            extended = true;
        }

        emit AuctionBid(tokenId, msg.sender, msg.value, extended);
    }

    // ── Settle ──────────────────────────────────────────────────────────

    /**
     * @notice Settle an ended auction. Transfers NFT to winner, ETH to creator.
     * Anyone can call this after the auction ends.
     */
    function settleAuction(uint256 tokenId) external nonReentrant {
        Auction storage a = auctions[tokenId];
        require(a.creator != address(0), "Auction does not exist");
        require(a.startTime > 0, "No bids placed");
        require(block.timestamp >= a.endTime, "Auction still active");
        require(!a.settled, "Already settled");

        a.settled = true;

        // Transfer NFT from contract to winner
        _transfer(address(this), a.bidder, tokenId);

        // Send ETH to creator
        _safeTransferETH(a.creator, a.amount);

        emit AuctionSettled(tokenId, a.bidder, a.amount);
    }

    // ── Cancel ──────────────────────────────────────────────────────────

    /**
     * @notice Cancel an auction with no bids. Creator-only.
     * Burns the token.
     */
    function cancelAuction(uint256 tokenId) external {
        Auction storage a = auctions[tokenId];
        require(msg.sender == a.creator, "Not creator");
        require(a.startTime == 0, "Bids already placed");
        require(!a.settled, "Already settled");

        a.settled = true;
        _burn(tokenId);

        emit AuctionCancelled(tokenId);
    }

    // ── ERC721 overrides ────────────────────────────────────────────────

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return auctions[tokenId].tokenURI_;
    }

    // Contract needs to receive ERC721 tokens (it mints to itself)
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    // ── View helpers ────────────────────────────────────────────────────

    /**
     * @notice Get auction state for a derivative.
     */
    function getAuction(uint256 tokenId) external view returns (
        uint256 nounId,
        address creator,
        uint128 reservePrice,
        uint128 amount,
        address bidder,
        uint40 startTime,
        uint40 endTime,
        bool settled
    ) {
        Auction storage a = auctions[tokenId];
        return (a.nounId, a.creator, a.reservePrice, a.amount, a.bidder, a.startTime, a.endTime, a.settled);
    }

    // ── Internal ────────────────────────────────────────────────────────

    function _safeTransferETH(address payable to, uint256 amount) internal {
        (bool success, ) = to.call{value: amount}("");
        require(success, "ETH transfer failed");
    }
}
