// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.19;

interface IAuctionHouse {
    function settleCurrentAndCreateNewAuction() external;
}

/// @notice Permissionless settle guard for blockhash-seeded noun curation.
/// The noun minted by a settlement is seeded from blockhash(block.number - 1),
/// so a settle tx that lands one block after its target mints a different noun
/// than the one predicted. Routing the settle through this contract makes a
/// missed slot revert (~25k gas) instead of settling with the wrong seed.
/// Stateless, ownerless, works for any auction house with the standard settle.
contract ExactBlockSettler {
    error MissedBlock(uint256 target, uint256 actual);

    function settleAtBlock(IAuctionHouse auctionHouse, uint256 targetBlock) external {
        if (block.number != targetBlock) revert MissedBlock(targetBlock, block.number);
        auctionHouse.settleCurrentAndCreateNewAuction();
    }
}
