// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.19;

import 'forge-std/Test.sol';
import { NounV2Token } from '../../contracts/nounv2/NounV2Token.sol';
import { NounV2AuctionHouse } from '../../contracts/nounv2/NounV2AuctionHouse.sol';
import { NounV2Treasury } from '../../contracts/nounv2/NounV2Treasury.sol';
import { INounsDescriptorMinimal } from '../../contracts/interfaces/INounsDescriptorMinimal.sol';
import { INounsSeeder } from '../../contracts/interfaces/INounsSeeder.sol';
import { INounsToken } from '../../contracts/interfaces/INounsToken.sol';
import { INounsAuctionHouse } from '../../contracts/interfaces/INounsAuctionHouse.sol';
import { IProxyRegistry } from '../../contracts/external/opensea/IProxyRegistry.sol';

/// @title NounV2 end-to-end fork test.
/// @notice Replicates DeployNounV2 logic on a mainnet fork, exercises a full
///         bid -> settle flow, then proves the propose() gate on the treasury.
contract NounV2Test is Test {
    // Mirror the constants from script/DeployNounV2.s.sol
    address constant NOUNS_DESCRIPTOR_V2 = 0x6229c811D04501523C6058bfAAc29c91bb586268;
    address constant NOUNS_SEEDER = 0xCC8a0FB5ab3C7132c1b2A0109142Fb112c4Ce515;
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant OPENSEA_PROXY_REGISTRY = 0xa5409ec958C83C3f309868babACA7c86DCB077c1;

    uint256 constant TIME_BUFFER = 300;
    uint256 constant RESERVE_PRICE = 0.001 ether;
    uint8 constant MIN_BID_INCREMENT_PCT = 2;
    uint256 constant DURATION = 86400;

    address deployer = makeAddr('deployer');
    address bidder = makeAddr('bidder');
    address broke = makeAddr('broke');

    NounV2Token token;
    NounV2AuctionHouse auctionHouse;
    NounV2Treasury treasury;

    function setUp() public {
        vm.deal(deployer, 100 ether);
        vm.deal(bidder, 100 ether);

        vm.startPrank(deployer);

        // 1. Deploy token (minter placeholder = deployer; swapped to AH below).
        token = new NounV2Token(
            deployer,
            INounsDescriptorMinimal(NOUNS_DESCRIPTOR_V2),
            INounsSeeder(NOUNS_SEEDER),
            IProxyRegistry(OPENSEA_PROXY_REGISTRY)
        );

        // 2. Deploy treasury first so AH can take it as constructor arg.
        treasury = new NounV2Treasury(address(token), deployer);

        // 3. Deploy AH with full config in constructor (atomic, no front-run window).
        auctionHouse = new NounV2AuctionHouse(
            INounsToken(address(token)),
            WETH,
            TIME_BUFFER,
            RESERVE_PRICE,
            MIN_BID_INCREMENT_PCT,
            DURATION,
            address(treasury)
        );

        // 4. Hand minter to AH.
        token.setMinter(address(auctionHouse));

        // 5. Unpause -> mints NounV2 #0 and opens first auction.
        auctionHouse.unpause();

        vm.stopPrank();
    }

    function test_DeployState() public {
        // Token identity
        assertEq(token.name(), 'NounV2', 'token.name');
        assertEq(token.symbol(), 'NOUNV2', 'token.symbol');

        // AH post-deploy state
        assertEq(auctionHouse.paused(), false, 'AH should be unpaused');
        assertEq(auctionHouse.beneficiary(), address(treasury), 'beneficiary == treasury');
        assertEq(auctionHouse.reservePrice(), 0.001 ether, 'reservePrice == 0.001 ether');
        assertEq(auctionHouse.duration(), 86400, 'duration == 86400');

        // First auction initialized
        (
            uint256 nounId,
            uint256 amount,
            uint256 startTime,
            uint256 endTime,
            address payable bidderAddr,
            bool settled
        ) = auctionHouse.auction();
        assertEq(nounId, 0, 'first auction nounId == 0');
        assertGt(endTime, block.timestamp, 'endTime in the future');
        assertEq(amount, 0, 'starting amount 0');
        assertEq(bidderAddr, address(0), 'no bidder yet');
        assertEq(settled, false, 'not settled');
        assertGt(startTime, 0, 'startTime set');

        // Wiring
        assertEq(token.minter(), address(auctionHouse), 'token.minter == AH');
        assertEq(token.ownerOf(0), address(auctionHouse), 'noun #0 held by AH');

        // Treasury config
        assertEq(treasury.nounsToken(), address(token), 'treasury.nounsToken');
        assertEq(treasury.admin(), deployer, 'treasury.admin == deployer');
    }

    function test_BidSettleAndProposeGate() public {
        // --- bid on noun #0 ---
        (, , , uint256 endTime0, , ) = auctionHouse.auction();

        vm.prank(bidder);
        auctionHouse.createBid{ value: 0.01 ether }(0);

        // Confirm bid recorded
        (, uint256 amt, , , address payable bidderAfter, ) = auctionHouse.auction();
        assertEq(amt, 0.01 ether, 'bid amount recorded');
        assertEq(bidderAfter, bidder, 'bidder recorded');

        // Warp past auction end (account for possible anti-snipe extension).
        (, , , uint256 liveEnd, , ) = auctionHouse.auction();
        vm.warp(liveEnd + 1);
        // silence unused warning
        endTime0;

        uint256 treasuryBalBefore = address(treasury).balance;

        // Settle + create next auction (anyone can call).
        vm.prank(address(0xBEEF));
        auctionHouse.settleCurrentAndCreateNewAuction();

        // Bidder now owns noun #0
        assertEq(token.ownerOf(0), bidder, 'bidder owns noun #0');

        // Treasury received the proceeds
        assertEq(
            address(treasury).balance - treasuryBalBefore,
            0.01 ether,
            'treasury received 0.01 ETH'
        );

        // New auction is for noun #1
        (uint256 newNounId, , , uint256 newEnd, , bool newSettled) = auctionHouse.auction();
        assertEq(newNounId, 1, 'new auction nounId == 1');
        assertGt(newEnd, block.timestamp, 'new auction live');
        assertEq(newSettled, false);

        // --- propose() gate ---
        // Token transfers auto-delegate to `to` in ERC721Checkpointable; bidder already holds 1 noun
        // so has >= 1 voting power. Mine a block so the snapshot (block.number - 1) sees it.
        vm.roll(block.number + 1);

        address[] memory targets = new address[](1);
        uint256[] memory values = new uint256[](1);
        string[] memory sigs = new string[](1);
        bytes[] memory calldatas = new bytes[](1);
        targets[0] = address(0xCAFE);
        values[0] = 0;
        sigs[0] = '';
        calldatas[0] = '';

        vm.prank(bidder);
        uint256 pid = treasury.propose(targets, values, sigs, calldatas, 'test');
        assertEq(pid, 1, 'first proposal id == 1');
        assertEq(treasury.proposalCount(), 1, 'proposalCount incremented');

        // Non-holder should revert with BelowProposalThreshold()
        vm.prank(broke);
        vm.expectRevert(NounV2Treasury.BelowProposalThreshold.selector);
        treasury.propose(targets, values, sigs, calldatas, 'nope');
    }
}
