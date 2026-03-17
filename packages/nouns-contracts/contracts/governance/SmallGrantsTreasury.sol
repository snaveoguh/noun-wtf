// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title Small Grants Treasury
/// @notice Lightweight governor + treasury for noun.wtf small grants.
///         No quorum — 1 FOR vote passes if nobody votes AGAINST.
///         24-hour cycle: 0 delay → 12hr vote → 12hr timelock → execute.
///         Reads voting power from NounsToken (ERC721Checkpointable).
/// @dev Combined governor + treasury in one contract. Not upgradeable.
contract SmallGrantsTreasury {
    // ─── Errors ─────────────────────────────────────────────────────────
    error InvalidProposal();
    error InvalidState(ProposalState current, ProposalState expected);
    error AlreadyVoted();
    error NoVotingPower();
    error NotProposerOrAdmin();
    error TimelockNotReady();
    error TimelockExpired();
    error TxFailed(uint256 index);
    error OnlyAdmin();
    error TooManyOperations();

    // ─── Types ──────────────────────────────────────────────────────────

    enum ProposalState {
        Active,      // 0: Voting in progress
        Canceled,    // 1: Canceled by proposer or admin
        Defeated,    // 2: Voting ended, for <= against
        Succeeded,   // 3: Voting ended, for > against
        Queued,      // 4: Queued in timelock
        Expired,     // 5: Timelock grace period passed without execution
        Executed     // 6: Successfully executed
    }

    struct Proposal {
        address proposer;
        uint256 snapshotBlock;     // block for voting power snapshot
        uint256 startBlock;        // voting starts (same block as creation)
        uint256 endBlock;          // voting ends
        uint256 eta;               // execution timestamp (set on queue)
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        bool canceled;
        bool executed;
        bool queued;
    }

    struct Receipt {
        bool hasVoted;
        uint8 support;    // 0=against, 1=for, 2=abstain
        uint96 votes;
    }

    // ─── Constants ──────────────────────────────────────────────────────

    uint256 public constant VOTING_DELAY = 0;
    uint256 public constant VOTING_PERIOD = 3600;          // ~12 hours
    uint256 public constant TIMELOCK_DELAY = 43200;        // 12 hours
    uint256 public constant GRACE_PERIOD = 604800;         // 7 days
    uint256 public constant MAX_OPERATIONS = 10;

    // ─── State ──────────────────────────────────────────────────────────

    /// @notice NounsToken contract for voting power lookups
    address public immutable nounsToken;

    /// @notice Admin can cancel proposals. Can be renounced (set to address(0)).
    address public admin;

    /// @notice Total proposals created
    uint256 public proposalCount;

    /// @notice Proposals by ID (1-indexed)
    mapping(uint256 => Proposal) public proposals;

    /// @notice Proposal transaction data (proposalId => arrays)
    mapping(uint256 => address[]) internal _targets;
    mapping(uint256 => uint256[]) internal _values;
    mapping(uint256 => string[])  internal _signatures;
    mapping(uint256 => bytes[])   internal _calldatas;
    mapping(uint256 => string)    internal _descriptions;

    /// @notice Vote receipts (proposalId => voter => receipt)
    mapping(uint256 => mapping(address => Receipt)) public receipts;

    // ─── Reentrancy Guard ───────────────────────────────────────────────

    uint256 private _locked = 1;
    modifier nonReentrant() {
        require(_locked == 1, "REENTRANCY");
        _locked = 2;
        _;
        _locked = 1;
    }

    // ─── Events ─────────────────────────────────────────────────────────

    event ProposalCreated(
        uint256 indexed id,
        address indexed proposer,
        uint256 startBlock,
        uint256 endBlock,
        string description
    );
    event VoteCast(
        address indexed voter,
        uint256 indexed proposalId,
        uint8 support,
        uint256 votes,
        string reason
    );
    event ProposalQueued(uint256 indexed id, uint256 eta);
    event ProposalExecuted(uint256 indexed id);
    event ProposalCanceled(uint256 indexed id);
    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);
    event ETHReceived(address indexed sender, uint256 amount);

    // ─── Constructor ────────────────────────────────────────────────────

    constructor(address _nounsToken, address _admin) {
        require(_nounsToken.code.length > 0, "INVALID_TOKEN");
        nounsToken = _nounsToken;
        admin = _admin;
    }

    // ─── Propose ────────────────────────────────────────────────────────

    /// @notice Create a new grant proposal. Anyone can propose. Voting starts immediately.
    function propose(
        address[] calldata targets,
        uint256[] calldata values,
        string[] calldata signatures,
        bytes[] calldata calldatas,
        string calldata description
    ) external returns (uint256) {
        uint256 len = targets.length;
        if (len == 0 || len != values.length || len != signatures.length || len != calldatas.length)
            revert InvalidProposal();
        if (len > MAX_OPERATIONS) revert TooManyOperations();

        proposalCount++;
        uint256 id = proposalCount;

        // Snapshot at previous block to prevent flash-loan manipulation
        uint256 snapshot = block.number - 1;

        proposals[id] = Proposal({
            proposer: msg.sender,
            snapshotBlock: snapshot,
            startBlock: block.number,
            endBlock: block.number + VOTING_PERIOD,
            eta: 0,
            forVotes: 0,
            againstVotes: 0,
            abstainVotes: 0,
            canceled: false,
            executed: false,
            queued: false
        });

        // Store transaction data
        for (uint256 i; i < len;) {
            _targets[id].push(targets[i]);
            _values[id].push(values[i]);
            _signatures[id].push(signatures[i]);
            _calldatas[id].push(calldatas[i]);
            unchecked { ++i; }
        }
        _descriptions[id] = description;

        emit ProposalCreated(id, msg.sender, block.number, block.number + VOTING_PERIOD, description);
        return id;
    }

    // ─── Vote ───────────────────────────────────────────────────────────

    /// @notice Cast a vote on a proposal
    function castVote(uint256 proposalId, uint8 support) external {
        _castVote(msg.sender, proposalId, support, "");
    }

    /// @notice Cast a vote with reason
    function castVoteWithReason(uint256 proposalId, uint8 support, string calldata reason) external {
        _castVote(msg.sender, proposalId, support, reason);
    }

    function _castVote(address voter, uint256 proposalId, uint8 support, string memory reason) internal {
        if (state(proposalId) != ProposalState.Active) revert InvalidState(state(proposalId), ProposalState.Active);
        if (support > 2) revert InvalidProposal();

        Receipt storage receipt = receipts[proposalId][voter];
        if (receipt.hasVoted) revert AlreadyVoted();

        uint96 votes = _getVotes(voter, proposals[proposalId].snapshotBlock);
        if (votes == 0) revert NoVotingPower();

        receipt.hasVoted = true;
        receipt.support = support;
        receipt.votes = votes;

        Proposal storage p = proposals[proposalId];
        if (support == 0) {
            p.againstVotes += votes;
        } else if (support == 1) {
            p.forVotes += votes;
        } else {
            p.abstainVotes += votes;
        }

        emit VoteCast(voter, proposalId, support, votes, reason);
    }

    // ─── Queue ──────────────────────────────────────────────────────────

    /// @notice Queue a succeeded proposal for execution after timelock
    function queue(uint256 proposalId) external {
        if (state(proposalId) != ProposalState.Succeeded) revert InvalidState(state(proposalId), ProposalState.Succeeded);

        Proposal storage p = proposals[proposalId];
        p.queued = true;
        p.eta = block.timestamp + TIMELOCK_DELAY;

        emit ProposalQueued(proposalId, p.eta);
    }

    // ─── Execute ────────────────────────────────────────────────────────

    /// @notice Execute a queued proposal after the timelock delay
    function execute(uint256 proposalId) external nonReentrant {
        if (state(proposalId) != ProposalState.Queued) revert InvalidState(state(proposalId), ProposalState.Queued);

        Proposal storage p = proposals[proposalId];
        if (block.timestamp < p.eta) revert TimelockNotReady();
        if (block.timestamp > p.eta + GRACE_PERIOD) revert TimelockExpired();

        p.executed = true;

        address[] storage targets = _targets[proposalId];
        uint256[] storage values = _values[proposalId];
        string[] storage sigs = _signatures[proposalId];
        bytes[] storage cds = _calldatas[proposalId];

        for (uint256 i; i < targets.length;) {
            bytes memory callData;
            if (bytes(sigs[i]).length > 0) {
                callData = abi.encodePacked(bytes4(keccak256(bytes(sigs[i]))), cds[i]);
            } else {
                callData = cds[i];
            }

            (bool success, ) = targets[i].call{value: values[i]}(callData);
            if (!success) revert TxFailed(i);

            unchecked { ++i; }
        }

        emit ProposalExecuted(proposalId);
    }

    // ─── Cancel ─────────────────────────────────────────────────────────

    /// @notice Cancel a proposal. Only proposer or admin.
    function cancel(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        if (p.executed) revert InvalidProposal();
        if (msg.sender != p.proposer && msg.sender != admin) revert NotProposerOrAdmin();

        p.canceled = true;
        emit ProposalCanceled(proposalId);
    }

    // ─── State ──────────────────────────────────────────────────────────

    /// @notice Compute the current state of a proposal
    function state(uint256 proposalId) public view returns (ProposalState) {
        if (proposalId == 0 || proposalId > proposalCount) revert InvalidProposal();

        Proposal storage p = proposals[proposalId];

        if (p.canceled) return ProposalState.Canceled;
        if (p.executed) return ProposalState.Executed;

        // Still voting
        if (block.number <= p.endBlock) return ProposalState.Active;

        // Voting ended — check result
        // No quorum: passes if forVotes > againstVotes (1-0 is valid)
        if (p.forVotes <= p.againstVotes) return ProposalState.Defeated;

        // Succeeded but not yet queued
        if (!p.queued) return ProposalState.Succeeded;

        // Queued — check timelock
        if (block.timestamp > p.eta + GRACE_PERIOD) return ProposalState.Expired;

        return ProposalState.Queued;
    }

    // ─── View Functions ─────────────────────────────────────────────────

    /// @notice Get proposal transaction data
    function getActions(uint256 proposalId)
        external
        view
        returns (
            address[] memory targets,
            uint256[] memory values,
            string[] memory signatures,
            bytes[] memory calldatas
        )
    {
        return (_targets[proposalId], _values[proposalId], _signatures[proposalId], _calldatas[proposalId]);
    }

    /// @notice Get proposal description
    function getDescription(uint256 proposalId) external view returns (string memory) {
        return _descriptions[proposalId];
    }

    /// @notice Get a voter's receipt for a proposal
    function getReceipt(uint256 proposalId, address voter) external view returns (Receipt memory) {
        return receipts[proposalId][voter];
    }

    // ─── Admin ──────────────────────────────────────────────────────────

    /// @notice Change admin. Callable by current admin OR by governance (via proposal execution).
    /// @dev When a proposal executes setAdmin(), msg.sender is address(this).
    ///      This allows governance to rotate or renounce the admin veto.
    function setAdmin(address newAdmin) external {
        if (msg.sender != admin && msg.sender != address(this)) revert OnlyAdmin();
        emit AdminChanged(admin, newAdmin);
        admin = newAdmin;
    }

    // ─── Treasury ───────────────────────────────────────────────────────

    /// @notice Accept ETH deposits
    receive() external payable {
        emit ETHReceived(msg.sender, msg.value);
    }

    // ─── Internal ───────────────────────────────────────────────────────

    /// @dev Read voting power from NounsToken.getPriorVotes(account, blockNumber).
    ///      Reverts if the call fails (bad token config), returns 0 only if voter has no power.
    function _getVotes(address account, uint256 blockNumber) internal view returns (uint96) {
        // Call NounsToken.getPriorVotes(address, uint256) → uint96
        (bool success, bytes memory data) = nounsToken.staticcall(
            abi.encodeWithSignature("getPriorVotes(address,uint256)", account, blockNumber)
        );
        require(success && data.length >= 32, "VOTE_LOOKUP_FAILED");
        return abi.decode(data, (uint96));
    }
}
