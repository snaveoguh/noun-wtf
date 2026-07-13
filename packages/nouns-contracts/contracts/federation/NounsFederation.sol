// SPDX-License-Identifier: GPL-3.0

/// @title NounsFederation — cross-DAO meta-governance relay (V2 → V1)
/// @notice Lets NounV2 holders steer the V1 voting power that has been
///         delegated to this contract. For each V1 proposal, anyone can open a
///         *mirror* here; NounV2 holders vote on the mirror weighted by their
///         `getPriorVotes` at the mirror's snapshot; once the mirror's voting
///         window closes, anyone can `relay()` the aggregated result as a single
///         V1 `castVote`.
///
/// @dev Trust model & safety:
///      - This contract NEVER takes custody of any NFT. V1 holders opt in by
///        calling `delegate(federation)` on the V1 NounsToken; they keep their
///        tokens and can re-delegate away at any time. The only power at stake
///        is V1 *voting* power that holders explicitly delegated here.
///      - The V1 support that gets cast is derived deterministically on-chain
///        from the mirror tally. No operator (keeper) can choose the vote; a
///        keeper only *triggers* `mirror()` on schedule and `relay()` after the
///        window closes. Both are permissionless, so a dead keeper cannot brick
///        a mirror — anyone can call them.
///      - Timing is enforced against the live V1 proposal so a mirror cannot be
///        opened too early (result would be stale) or too late (V2 window would
///        not close before the V1 deadline).
///
///      Support encoding matches Compound Bravo / Nouns on both sides:
///      0 = Against, 1 = For, 2 = Abstain.
pragma solidity ^0.8.19;

/// @notice Minimal view into the NounV2 voting token.
interface INounV2VotingToken {
    function getPriorVotes(address account, uint256 blockNumber) external view returns (uint96);
}

/// @notice Backwards-compatible V1 proposal view (mirrors NounsDAOTypes.ProposalCondensedV2).
struct V1ProposalCondensed {
    uint256 id;
    address proposer;
    uint256 proposalThreshold;
    uint256 quorumVotes;
    uint256 eta;
    uint256 startBlock;
    uint256 endBlock;
    uint256 forVotes;
    uint256 againstVotes;
    uint256 abstainVotes;
    bool canceled;
    bool vetoed;
    bool executed;
    uint256 totalSupply;
    uint256 creationBlock;
}

/// @notice Minimal view into the V1 NounsDAO governor.
interface INounsDAOV1 {
    /// @dev Returns the NounsDAO ProposalState enum. Active == 1.
    function state(uint256 proposalId) external view returns (uint256);

    function castVote(uint256 proposalId, uint8 support) external;

    function proposals(uint256 proposalId) external view returns (V1ProposalCondensed memory);
}

contract NounsFederation {
    // ─── Errors ─────────────────────────────────────────────────────────
    error Paused();
    error V1ProposalNotActive();
    error AlreadyMirrored(uint256 mirrorId);
    error MirrorTooEarly(uint256 blocksRemaining, uint256 maxLeadBlocks);
    error MirrorTooLate(uint256 blocksRemaining, uint256 minLeadBlocks);
    error UnknownMirror();
    error VotingClosed();
    error VotingOpen();
    error AlreadyVoted();
    error NoVotingPower();
    error InvalidSupport();
    error AlreadyRelayed();
    error QuorumNotReached(uint256 totalVotes, uint256 quorum);
    error OnlyOwner();

    // ─── V1 ProposalState mirror (only the value we branch on) ──────────
    /// @dev NounsDAO ProposalState.Active is index 1 in the V1 enum.
    uint256 internal constant V1_STATE_ACTIVE = 1;

    // ─── Timing constants (in blocks; ~12s blocks) ──────────────────────

    /// @notice How long a mirror stays open for NounV2 voting. Matches the
    ///         NounV2Treasury voting period (~12h).
    uint256 public constant VOTING_PERIOD = 3600;

    /// @notice Minimum blocks that must sit between a mirror closing and the V1
    ///         deadline, so `relay()` has room to land before V1 voting ends (~1h).
    uint256 public constant RELAY_BUFFER = 300;

    /// @notice Fewest V1 blocks-remaining a mirror may be opened at. Below this,
    ///         the mirror's own voting window could not close in time to relay.
    uint256 public constant MIN_LEAD_BLOCKS = VOTING_PERIOD + RELAY_BUFFER;

    // ─── Types ──────────────────────────────────────────────────────────

    struct Mirror {
        uint256 v1ProposalId;
        uint256 snapshotBlock; // NounV2 voting power is read at this block
        uint256 endBlock; // mirror voting closes after this block
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        bool relayed;
        uint8 relayedSupport;
    }

    // ─── Immutable wiring ───────────────────────────────────────────────

    /// @notice V1 NounsDAO governor that votes are relayed into.
    INounsDAOV1 public immutable nounsDAOV1;

    /// @notice NounV2 voting token used to weight mirror votes.
    INounV2VotingToken public immutable nounV2Token;

    // ─── Owner-tunable params ───────────────────────────────────────────

    /// @notice Owner may pause new mirror creation and adjust timing/quorum.
    ///         Can be renounced (set to address(0)); existing mirrors are
    ///         unaffected and remain relayable by anyone.
    address public owner;

    /// @notice Most V1 blocks-remaining a mirror may be opened at. Stops a mirror
    ///         from opening so early that its result is stale by the V1 deadline.
    ///         Default ~30h at 12s blocks.
    uint256 public maxLeadBlocks = 9000;

    /// @notice Minimum total NounV2 votes a mirror must gather to be relayable.
    ///         0 = participation-gate only (any non-zero turnout relays).
    uint256 public quorumVotes;

    /// @notice When true, `mirror()` is disabled. `castVote`/`relay` on existing
    ///         mirrors keep working.
    bool public mirrorPaused;

    // ─── State ──────────────────────────────────────────────────────────

    uint256 public mirrorCount;
    mapping(uint256 => Mirror) public mirrors; // mirrorId => Mirror
    mapping(uint256 => uint256) public v1ToMirror; // v1ProposalId => mirrorId (0 = none)
    mapping(uint256 => mapping(address => bool)) public hasVoted; // mirrorId => voter => voted

    uint256 private _locked = 1;
    modifier nonReentrant() {
        require(_locked == 1, 'REENTRANCY');
        _locked = 2;
        _;
        _locked = 1;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    // ─── Events ─────────────────────────────────────────────────────────

    event MirrorCreated(
        uint256 indexed mirrorId,
        uint256 indexed v1ProposalId,
        address indexed creator,
        uint256 snapshotBlock,
        uint256 endBlock
    );
    event MirrorVoteCast(
        address indexed voter,
        uint256 indexed mirrorId,
        uint8 support,
        uint256 votes,
        string reason
    );
    event VoteRelayed(
        uint256 indexed mirrorId,
        uint256 indexed v1ProposalId,
        uint8 support,
        uint256 forVotes,
        uint256 againstVotes,
        uint256 abstainVotes
    );
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event MaxLeadBlocksChanged(uint256 oldValue, uint256 newValue);
    event QuorumVotesChanged(uint256 oldValue, uint256 newValue);
    event MirrorPausedChanged(bool paused);

    constructor(address _nounsDAOV1, address _nounV2Token, address _owner) {
        require(_nounsDAOV1.code.length > 0, 'INVALID_DAO');
        require(_nounV2Token.code.length > 0, 'INVALID_TOKEN');
        nounsDAOV1 = INounsDAOV1(_nounsDAOV1);
        nounV2Token = INounV2VotingToken(_nounV2Token);
        owner = _owner;
    }

    // ─── Mirror lifecycle ───────────────────────────────────────────────

    /// @notice Open a mirror for an active V1 proposal so NounV2 holders can
    ///         vote on how the delegated V1 power should be cast. Permissionless.
    /// @param v1ProposalId The V1 NounsDAO proposal to mirror.
    /// @return mirrorId The id of the newly created mirror.
    function mirror(uint256 v1ProposalId) external returns (uint256 mirrorId) {
        if (mirrorPaused) revert Paused();
        if (v1ToMirror[v1ProposalId] != 0) revert AlreadyMirrored(v1ToMirror[v1ProposalId]);

        if (nounsDAOV1.state(v1ProposalId) != V1_STATE_ACTIVE) revert V1ProposalNotActive();

        uint256 v1EndBlock = nounsDAOV1.proposals(v1ProposalId).endBlock;
        // `state == Active` already implies voting is open, so v1EndBlock >= block.number.
        uint256 blocksRemaining = v1EndBlock - block.number;
        if (blocksRemaining > maxLeadBlocks) revert MirrorTooEarly(blocksRemaining, maxLeadBlocks);
        if (blocksRemaining < MIN_LEAD_BLOCKS) revert MirrorTooLate(blocksRemaining, MIN_LEAD_BLOCKS);

        // Snapshot NounV2 voting power at the previous block (flash-loan safe).
        uint256 snapshot = block.number - 1;

        mirrorId = ++mirrorCount;
        mirrors[mirrorId] = Mirror({
            v1ProposalId: v1ProposalId,
            snapshotBlock: snapshot,
            endBlock: block.number + VOTING_PERIOD,
            forVotes: 0,
            againstVotes: 0,
            abstainVotes: 0,
            relayed: false,
            relayedSupport: 0
        });
        v1ToMirror[v1ProposalId] = mirrorId;

        emit MirrorCreated(mirrorId, v1ProposalId, msg.sender, snapshot, block.number + VOTING_PERIOD);
    }

    /// @notice Vote on a mirror with your NounV2 power. 0=Against, 1=For, 2=Abstain.
    function castVote(uint256 mirrorId, uint8 support) external {
        _castVote(mirrorId, support, '');
    }

    /// @notice Vote on a mirror with an attached reason string.
    function castVoteWithReason(uint256 mirrorId, uint8 support, string calldata reason) external {
        _castVote(mirrorId, support, reason);
    }

    function _castVote(uint256 mirrorId, uint8 support, string memory reason) internal {
        Mirror storage m = mirrors[mirrorId];
        if (m.v1ProposalId == 0) revert UnknownMirror();
        if (block.number > m.endBlock) revert VotingClosed();
        if (support > 2) revert InvalidSupport();
        if (hasVoted[mirrorId][msg.sender]) revert AlreadyVoted();

        uint96 votes = nounV2Token.getPriorVotes(msg.sender, m.snapshotBlock);
        if (votes == 0) revert NoVotingPower();

        hasVoted[mirrorId][msg.sender] = true;
        if (support == 0) {
            m.againstVotes += votes;
        } else if (support == 1) {
            m.forVotes += votes;
        } else {
            m.abstainVotes += votes;
        }

        emit MirrorVoteCast(msg.sender, mirrorId, support, votes, reason);
    }

    /// @notice After a mirror's voting window closes, cast the aggregated result
    ///         as a single V1 vote. Permissionless and idempotent (one relay per
    ///         mirror). Reverts if the V1 proposal is no longer Active, if turnout
    ///         is zero, or if the quorum floor is unmet.
    function relay(uint256 mirrorId) external nonReentrant returns (uint8 support) {
        Mirror storage m = mirrors[mirrorId];
        if (m.v1ProposalId == 0) revert UnknownMirror();
        if (m.relayed) revert AlreadyRelayed();
        if (block.number <= m.endBlock) revert VotingOpen();

        uint256 forVotes = m.forVotes;
        uint256 againstVotes = m.againstVotes;
        uint256 abstainVotes = m.abstainVotes;
        uint256 total = forVotes + againstVotes + abstainVotes;
        if (total == 0) revert QuorumNotReached(0, quorumVotes == 0 ? 1 : quorumVotes);
        if (total < quorumVotes) revert QuorumNotReached(total, quorumVotes);

        // V1 must still be accepting votes, or castVote below would revert.
        if (nounsDAOV1.state(m.v1ProposalId) != V1_STATE_ACTIVE) revert V1ProposalNotActive();

        // Deterministic tally → support. Ties fall back to Abstain.
        if (forVotes > againstVotes) {
            support = 1;
        } else if (againstVotes > forVotes) {
            support = 0;
        } else {
            support = 2;
        }

        // Effects before the external call (CEI): mark relayed first.
        m.relayed = true;
        m.relayedSupport = support;

        nounsDAOV1.castVote(m.v1ProposalId, support);

        emit VoteRelayed(mirrorId, m.v1ProposalId, support, forVotes, againstVotes, abstainVotes);
    }

    // ─── Views ──────────────────────────────────────────────────────────

    /// @notice True once a mirror's voting window has closed and it can be relayed.
    function isRelayable(uint256 mirrorId) external view returns (bool) {
        Mirror storage m = mirrors[mirrorId];
        if (m.v1ProposalId == 0 || m.relayed || block.number <= m.endBlock) return false;
        uint256 total = m.forVotes + m.againstVotes + m.abstainVotes;
        if (total == 0 || total < quorumVotes) return false;
        return nounsDAOV1.state(m.v1ProposalId) == V1_STATE_ACTIVE;
    }

    function getMirror(uint256 mirrorId) external view returns (Mirror memory) {
        return mirrors[mirrorId];
    }

    // ─── Owner controls ─────────────────────────────────────────────────

    function setMaxLeadBlocks(uint256 newValue) external onlyOwner {
        require(newValue >= MIN_LEAD_BLOCKS, 'BELOW_MIN_LEAD');
        emit MaxLeadBlocksChanged(maxLeadBlocks, newValue);
        maxLeadBlocks = newValue;
    }

    function setQuorumVotes(uint256 newValue) external onlyOwner {
        emit QuorumVotesChanged(quorumVotes, newValue);
        quorumVotes = newValue;
    }

    function setMirrorPaused(bool paused) external onlyOwner {
        mirrorPaused = paused;
        emit MirrorPausedChanged(paused);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnerChanged(owner, newOwner);
        owner = newOwner;
    }
}
