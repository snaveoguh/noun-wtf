// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.19;

import 'forge-std/Test.sol';
import { NounsFederation, V1ProposalCondensed } from '../../contracts/federation/NounsFederation.sol';

/// @dev Records the V1 vote the federation relays; lets tests drive proposal state/endBlock.
contract MockV1Governor {
    mapping(uint256 => uint256) public stateOf;
    mapping(uint256 => uint256) public endBlockOf;

    uint256 public castCount;
    uint256 public lastProposalId;
    uint8 public lastSupport;

    function setProposal(uint256 id, uint256 _state, uint256 _endBlock) external {
        stateOf[id] = _state;
        endBlockOf[id] = _endBlock;
    }

    function setState(uint256 id, uint256 _state) external {
        stateOf[id] = _state;
    }

    function state(uint256 id) external view returns (uint256) {
        return stateOf[id];
    }

    function castVote(uint256 id, uint8 support) external {
        castCount++;
        lastProposalId = id;
        lastSupport = support;
    }

    function proposals(uint256 id) external view returns (V1ProposalCondensed memory p) {
        p.id = id;
        p.endBlock = endBlockOf[id];
    }
}

/// @dev Fixed voting-power lookup (block-agnostic) — enough to exercise tallying.
contract MockV2Token {
    mapping(address => uint96) public votes;

    function setVotes(address account, uint96 amount) external {
        votes[account] = amount;
    }

    function getPriorVotes(address account, uint256) external view returns (uint96) {
        return votes[account];
    }
}

contract NounsFederationTest is Test {
    uint256 constant V1_ACTIVE = 1;
    uint256 constant V1_DEFEATED = 3;

    NounsFederation federation;
    MockV1Governor gov;
    MockV2Token token;

    address owner = makeAddr('owner');
    address alice = makeAddr('alice');
    address bob = makeAddr('bob');
    address carol = makeAddr('carol');
    address keeper = makeAddr('keeper');

    uint256 constant V1_PROP = 1;

    function setUp() public {
        vm.roll(1_000_000);

        gov = new MockV1Governor();
        token = new MockV2Token();
        federation = new NounsFederation(address(gov), address(token), owner);

        // A live V1 proposal well inside the mirror window: 5000 blocks remaining
        // (MIN_LEAD 3900 <= 5000 <= maxLead 9000).
        gov.setProposal(V1_PROP, V1_ACTIVE, block.number + 5000);
    }

    function _openMirror() internal returns (uint256 mirrorId) {
        vm.prank(keeper);
        mirrorId = federation.mirror(V1_PROP);
    }

    function _closeWindow(uint256 mirrorId) internal {
        vm.roll(federation.getMirror(mirrorId).endBlock + 1);
    }

    // ─── mirror() ───────────────────────────────────────────────────────

    function test_Mirror_StoresSnapshotAndWindow() public {
        uint256 id = _openMirror();

        NounsFederation.Mirror memory m = federation.getMirror(id);
        assertEq(id, 1, 'mirrorId');
        assertEq(federation.mirrorCount(), 1, 'count');
        assertEq(m.v1ProposalId, V1_PROP, 'v1 id');
        assertEq(m.snapshotBlock, block.number - 1, 'snapshot');
        assertEq(m.endBlock, block.number + federation.VOTING_PERIOD(), 'endBlock');
        assertEq(federation.v1ToMirror(V1_PROP), id, 'index');
        assertFalse(m.relayed, 'not relayed');
    }

    function test_Mirror_RevertsWhenAlreadyMirrored() public {
        _openMirror();
        vm.expectRevert(abi.encodeWithSelector(NounsFederation.AlreadyMirrored.selector, 1));
        federation.mirror(V1_PROP);
    }

    function test_Mirror_RevertsWhenV1NotActive() public {
        gov.setState(V1_PROP, V1_DEFEATED);
        vm.expectRevert(NounsFederation.V1ProposalNotActive.selector);
        federation.mirror(V1_PROP);
    }

    function test_Mirror_RevertsWhenTooEarly() public {
        // 9001 blocks remaining > maxLeadBlocks (9000).
        gov.setProposal(V1_PROP, V1_ACTIVE, block.number + 9001);
        vm.expectRevert(abi.encodeWithSelector(NounsFederation.MirrorTooEarly.selector, 9001, 9000));
        federation.mirror(V1_PROP);
    }

    function test_Mirror_RevertsWhenTooLate() public {
        // 1000 blocks remaining < MIN_LEAD_BLOCKS (3900).
        gov.setProposal(V1_PROP, V1_ACTIVE, block.number + 1000);
        vm.expectRevert(
            abi.encodeWithSelector(NounsFederation.MirrorTooLate.selector, 1000, federation.MIN_LEAD_BLOCKS())
        );
        federation.mirror(V1_PROP);
    }

    function test_Mirror_RevertsWhenPaused() public {
        vm.prank(owner);
        federation.setMirrorPaused(true);
        vm.expectRevert(NounsFederation.Paused.selector);
        federation.mirror(V1_PROP);
    }

    // ─── castVote() ─────────────────────────────────────────────────────

    function test_CastVote_WeightsBySnapshotVotes() public {
        token.setVotes(alice, 5);
        token.setVotes(bob, 3);
        uint256 id = _openMirror();

        vm.prank(alice);
        federation.castVote(id, 1); // For
        vm.prank(bob);
        federation.castVote(id, 0); // Against

        NounsFederation.Mirror memory m = federation.getMirror(id);
        assertEq(m.forVotes, 5, 'for');
        assertEq(m.againstVotes, 3, 'against');
        assertEq(m.abstainVotes, 0, 'abstain');
        assertTrue(federation.hasVoted(id, alice), 'alice voted');
    }

    function test_CastVote_RevertsOnDoubleVote() public {
        token.setVotes(alice, 5);
        uint256 id = _openMirror();
        vm.prank(alice);
        federation.castVote(id, 1);
        vm.prank(alice);
        vm.expectRevert(NounsFederation.AlreadyVoted.selector);
        federation.castVote(id, 0);
    }

    function test_CastVote_RevertsWithoutPower() public {
        uint256 id = _openMirror();
        vm.prank(alice); // 0 votes
        vm.expectRevert(NounsFederation.NoVotingPower.selector);
        federation.castVote(id, 1);
    }

    function test_CastVote_RevertsOnInvalidSupport() public {
        token.setVotes(alice, 5);
        uint256 id = _openMirror();
        vm.prank(alice);
        vm.expectRevert(NounsFederation.InvalidSupport.selector);
        federation.castVote(id, 3);
    }

    function test_CastVote_RevertsAfterWindow() public {
        token.setVotes(alice, 5);
        uint256 id = _openMirror();
        _closeWindow(id);
        vm.prank(alice);
        vm.expectRevert(NounsFederation.VotingClosed.selector);
        federation.castVote(id, 1);
    }

    function test_CastVote_RevertsOnUnknownMirror() public {
        token.setVotes(alice, 5);
        vm.prank(alice);
        vm.expectRevert(NounsFederation.UnknownMirror.selector);
        federation.castVote(42, 1);
    }

    // ─── relay() ────────────────────────────────────────────────────────

    function test_Relay_ForWinsCastsFor() public {
        token.setVotes(alice, 5);
        token.setVotes(bob, 3);
        uint256 id = _openMirror();
        vm.prank(alice);
        federation.castVote(id, 1);
        vm.prank(bob);
        federation.castVote(id, 0);
        _closeWindow(id);

        vm.prank(keeper);
        uint8 support = federation.relay(id);

        assertEq(support, 1, 'support For');
        assertEq(gov.castCount(), 1, 'one cast');
        assertEq(gov.lastProposalId(), V1_PROP, 'v1 id');
        assertEq(gov.lastSupport(), 1, 'v1 support');
        assertTrue(federation.getMirror(id).relayed, 'relayed');
    }

    function test_Relay_AgainstWinsCastsAgainst() public {
        token.setVotes(alice, 2);
        token.setVotes(bob, 7);
        uint256 id = _openMirror();
        vm.prank(alice);
        federation.castVote(id, 1);
        vm.prank(bob);
        federation.castVote(id, 0);
        _closeWindow(id);

        federation.relay(id);
        assertEq(gov.lastSupport(), 0, 'Against');
    }

    function test_Relay_TieCastsAbstain() public {
        token.setVotes(alice, 4);
        token.setVotes(bob, 4);
        uint256 id = _openMirror();
        vm.prank(alice);
        federation.castVote(id, 1);
        vm.prank(bob);
        federation.castVote(id, 0);
        _closeWindow(id);

        federation.relay(id);
        assertEq(gov.lastSupport(), 2, 'Abstain on tie');
    }

    function test_Relay_AbstainDoesNotDecideDirection() public {
        token.setVotes(alice, 2); // For
        token.setVotes(bob, 1); // Against
        token.setVotes(carol, 100); // Abstain
        uint256 id = _openMirror();
        vm.prank(alice);
        federation.castVote(id, 1);
        vm.prank(bob);
        federation.castVote(id, 0);
        vm.prank(carol);
        federation.castVote(id, 2);
        _closeWindow(id);

        federation.relay(id);
        assertEq(gov.lastSupport(), 1, 'For wins on for>against');
    }

    function test_Relay_RevertsOnNoParticipation() public {
        uint256 id = _openMirror();
        _closeWindow(id);
        vm.expectRevert(abi.encodeWithSelector(NounsFederation.QuorumNotReached.selector, 0, 1));
        federation.relay(id);
    }

    function test_Relay_RevertsWhileVotingOpen() public {
        token.setVotes(alice, 5);
        uint256 id = _openMirror();
        vm.prank(alice);
        federation.castVote(id, 1);
        vm.expectRevert(NounsFederation.VotingOpen.selector);
        federation.relay(id);
    }

    function test_Relay_RevertsOnDoubleRelay() public {
        token.setVotes(alice, 5);
        uint256 id = _openMirror();
        vm.prank(alice);
        federation.castVote(id, 1);
        _closeWindow(id);
        federation.relay(id);
        vm.expectRevert(NounsFederation.AlreadyRelayed.selector);
        federation.relay(id);
    }

    function test_Relay_RevertsWhenV1NoLongerActive() public {
        token.setVotes(alice, 5);
        uint256 id = _openMirror();
        vm.prank(alice);
        federation.castVote(id, 1);
        _closeWindow(id);
        gov.setState(V1_PROP, V1_DEFEATED);
        vm.expectRevert(NounsFederation.V1ProposalNotActive.selector);
        federation.relay(id);
    }

    function test_Relay_RespectsQuorumFloor() public {
        vm.prank(owner);
        federation.setQuorumVotes(10);
        token.setVotes(alice, 5);
        uint256 id = _openMirror();
        vm.prank(alice);
        federation.castVote(id, 1);
        _closeWindow(id);
        vm.expectRevert(abi.encodeWithSelector(NounsFederation.QuorumNotReached.selector, 5, 10));
        federation.relay(id);
    }

    function test_Relay_IsPermissionless() public {
        token.setVotes(alice, 5);
        uint256 id = _openMirror();
        vm.prank(alice);
        federation.castVote(id, 1);
        _closeWindow(id);
        vm.prank(makeAddr('rando'));
        federation.relay(id);
        assertEq(gov.castCount(), 1, 'anyone can relay');
    }

    function test_IsRelayable_Transitions() public {
        token.setVotes(alice, 5);
        uint256 id = _openMirror();
        assertFalse(federation.isRelayable(id), 'open: not relayable');
        vm.prank(alice);
        federation.castVote(id, 1);
        _closeWindow(id);
        assertTrue(federation.isRelayable(id), 'closed w/ votes: relayable');
        federation.relay(id);
        assertFalse(federation.isRelayable(id), 'after relay: not relayable');
    }

    // ─── owner controls ─────────────────────────────────────────────────

    function test_Owner_SetMaxLeadBlocks() public {
        vm.prank(owner);
        federation.setMaxLeadBlocks(12000);
        assertEq(federation.maxLeadBlocks(), 12000);
    }

    function test_Owner_SetMaxLeadBlocksRevertsBelowMin() public {
        vm.prank(owner);
        vm.expectRevert('BELOW_MIN_LEAD');
        federation.setMaxLeadBlocks(100);
    }

    function test_Owner_OnlyOwnerGuarded() public {
        vm.prank(alice);
        vm.expectRevert(NounsFederation.OnlyOwner.selector);
        federation.setQuorumVotes(5);
    }

    function test_Owner_TransferOwnership() public {
        vm.prank(owner);
        federation.transferOwnership(alice);
        assertEq(federation.owner(), alice);
        vm.prank(alice);
        federation.setMirrorPaused(true);
        assertTrue(federation.mirrorPaused());
    }
}
