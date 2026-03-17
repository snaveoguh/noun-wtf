// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SketchMint
 * @notice Flat-fee 1/1 mint for daily hand-drawn Noun sketches.
 *
 * Flow:
 * 1. Owner calls listSketch(sketchId, tokenURI, price) — makes it available
 * 2. Anyone calls mint(sketchId) with exact ETH — gets the 1/1 ERC-721
 * 3. ETH goes to owner. That's it. No auction, no bidding.
 *
 * Each sketchId can only be minted once (1/1). Shows "sold out" after.
 */
contract SketchMint is ERC721, Ownable, ReentrancyGuard {
    struct Sketch {
        uint256 price;       // mint price in wei (e.g. 0.01 ether)
        string tokenURI_;    // metadata URI (IPFS/arweave link to GIF)
        bool listed;         // whether this sketch is available
        bool minted;         // whether someone has already minted
    }

    // sketchId => Sketch
    mapping(uint256 => Sketch) public sketches;

    // Default price for new listings (owner can change)
    uint256 public defaultPrice = 0.01 ether;

    // Events
    event SketchListed(uint256 indexed sketchId, uint256 price, string tokenURI);
    event SketchMinted(uint256 indexed sketchId, address buyer, uint256 price);
    event SketchDelisted(uint256 indexed sketchId);
    event DefaultPriceUpdated(uint256 newPrice);

    constructor() ERC721("NounSketches", "SKETCH") Ownable(msg.sender) {}

    /**
     * @notice List a sketch for sale. Only owner.
     * @param sketchId The sketch/noun ID
     * @param tokenURI_ Metadata URI (IPFS link to GIF + metadata)
     * @param price Price in wei (pass 0 to use defaultPrice)
     */
    function listSketch(
        uint256 sketchId,
        string calldata tokenURI_,
        uint256 price
    ) external onlyOwner {
        require(!sketches[sketchId].minted, "Already minted");

        uint256 mintPrice = price > 0 ? price : defaultPrice;

        sketches[sketchId] = Sketch({
            price: mintPrice,
            tokenURI_: tokenURI_,
            listed: true,
            minted: false
        });

        emit SketchListed(sketchId, mintPrice, tokenURI_);
    }

    /**
     * @notice Delist a sketch (remove from sale). Only owner.
     */
    function delistSketch(uint256 sketchId) external onlyOwner {
        require(sketches[sketchId].listed, "Not listed");
        require(!sketches[sketchId].minted, "Already minted");
        sketches[sketchId].listed = false;
        emit SketchDelisted(sketchId);
    }

    /**
     * @notice Mint a sketch. Send exact price in ETH.
     * @param sketchId Must be listed and not yet minted.
     */
    function mint(uint256 sketchId) external payable nonReentrant {
        Sketch storage s = sketches[sketchId];
        require(s.listed, "Not listed");
        require(!s.minted, "Sold out");
        require(msg.value == s.price, "Wrong price");

        s.minted = true;

        // Mint ERC-721 to buyer
        _mint(msg.sender, sketchId);

        // Send ETH to owner
        (bool success, ) = payable(owner()).call{value: msg.value}("");
        require(success, "ETH transfer failed");

        emit SketchMinted(sketchId, msg.sender, msg.value);
    }

    /**
     * @notice Update the default price for future listings. Only owner.
     */
    function setDefaultPrice(uint256 newPrice) external onlyOwner {
        require(newPrice > 0, "Price must be > 0");
        defaultPrice = newPrice;
        emit DefaultPriceUpdated(newPrice);
    }

    // ---- ERC-721 tokenURI ----

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return sketches[tokenId].tokenURI_;
    }

    // ---- View helpers ----

    function isAvailable(uint256 sketchId) external view returns (bool) {
        return sketches[sketchId].listed && !sketches[sketchId].minted;
    }

    function isSoldOut(uint256 sketchId) external view returns (bool) {
        return sketches[sketchId].minted;
    }
}
