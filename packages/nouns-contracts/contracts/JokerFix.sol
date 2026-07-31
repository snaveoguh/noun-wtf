// SPDX-License-Identifier: GPL-3.0

/// @title JokerFix — repair NounV2 head #253
///
/// NounV2 proposal #1 shipped the joker head as raw deflated RLE instead of the
/// DEFLATE of `abi.encode(bytes[])`. `NounsArt.imageByIndex` cannot decode it, so
/// `heads(253)` and any `tokenURI` for a Noun rolling that head REVERT.
///
/// `updateHeads` lives on NounsArt behind `onlyDescriptor`, and the deployed V2
/// descriptor (unlike main Nouns') exposes no `update*` passthrough. So this
/// contract is briefly made the art's descriptor, replaces the head data with a
/// correctly-encoded set, checks its own work, and hands the role straight back —
/// all inside one transaction. If any check fails the whole thing reverts and
/// nothing changes.
///
/// It holds no funds, owns nothing, and is inert once used.

pragma solidity ^0.8.19;

interface INounsArtLike {
    function updateHeads(bytes calldata encodedCompressed, uint80 decompressedLength, uint16 imageCount) external;
    function setDescriptor(address descriptor) external;
    function heads(uint256 index) external view returns (bytes memory);
    function headCount() external view returns (uint256);
    function descriptor() external view returns (address);
}

contract JokerFix {
    /// NounV2 art contract.
    INounsArtLike public constant ART = INounsArtLike(0x3409A4A360A028b7Aa2eBF769d6306d96B976b3f);
    /// The real NounV2 descriptor — the role is returned here before we finish.
    address public constant DESCRIPTOR = 0xAe0247Ca34B211a61b03A95F8008DCb8B3124B89;
    /// The head index that is currently broken.
    uint256 public constant JOKER_INDEX = 253;

    error NotDescriptor();
    error CountMismatch(uint256 got, uint256 want);
    error JokerStillUnreadable();
    error DescriptorNotRestored();

    event Fixed(uint256 headCount, uint256 jokerBytes);

    /// @notice Replace all head art, verify, and hand the descriptor role back.
    /// @dev Callable by anyone, but only *works* while this contract holds the
    ///      art's descriptor role — which only the DAO can grant, and which this
    ///      function gives up before returning. After a successful run it can
    ///      never do anything again.
    /// @param encodedCompressed raw-DEFLATE of abi.encode(bytes[] images)
    /// @param decompressedLength length of the ABI-ENCODED buffer (not the RLE)
    /// @param imageCount number of images in the array
    function fix(bytes calldata encodedCompressed, uint80 decompressedLength, uint16 imageCount) external {
        if (ART.descriptor() != address(this)) revert NotDescriptor();

        ART.updateHeads(encodedCompressed, decompressedLength, imageCount);

        // Self-check: the count must match and the previously-broken index must
        // now actually decode. `heads()` reverts on an undecodable page, so this
        // read is the real test — the one nobody ran in July.
        uint256 count = ART.headCount();
        if (count != imageCount) revert CountMismatch(count, imageCount);

        bytes memory joker = ART.heads(JOKER_INDEX);
        if (joker.length == 0) revert JokerStillUnreadable();

        ART.setDescriptor(DESCRIPTOR);
        if (ART.descriptor() != DESCRIPTOR) revert DescriptorNotRestored();

        emit Fixed(count, joker.length);
    }

    /// @notice Escape hatch: return the descriptor role without touching the art.
    /// @dev Only useful if `fix` is never called; leaves state untouched.
    function abort() external {
        if (ART.descriptor() != address(this)) revert NotDescriptor();
        ART.setDescriptor(DESCRIPTOR);
    }
}
