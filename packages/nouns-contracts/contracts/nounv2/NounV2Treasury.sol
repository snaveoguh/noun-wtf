// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title NounV2 Treasury
/// @notice Fork of SmallGrantsTreasury for the NounV2 DAO.
///         Identical governor + treasury logic, with one addition:
///         proposing requires holding >= 1 NounV2 voting unit (immutable).
/// @dev Combined governor + treasury in one contract. Not upgradeable.
contract NounV2Treasury {
    // ─── Errors ─────────────────────────────────────────────────────────
    error InvalidProposal();
    error InvalidState(ProposalState current, ProposalState expected);
    error AlreadyVoted();
    error NoVotingPower();
    error BelowProposalThreshold();
    error NotProposerOrAdmin();
    error TimelockNotReady();
    error TimelockExpired();
    error TxFailed(uint256 index);
    error OnlyAdmin();
    error TooManyOperations();

    // ─── Types ──────────────────────────────────────────────────────────

    enum ProposalState {
        Active,
        Canceled,
        Defeated,
        Succeeded,
        Queued,
        Expired,
        Executed
    }

    struct Proposal {
        address proposer;
        uint256 snapshotBlock;
        uint256 startBlock;
        uint256 endBlock;
        uint256 eta;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        bool canceled;
        bool executed;
        bool queued;
    }

    struct Receipt {
        bool hasVoted;
        uint8 support;
        uint96 votes;
    }

    // ─── Constants ──────────────────────────────────────────────────────

    uint256 public constant VOTING_DELAY = 0;
    uint256 public constant VOTING_PERIOD = 3600;          // ~12 hours
    uint256 public constant TIMELOCK_DELAY = 43200;        // 12 hours
    uint256 public constant GRACE_PERIOD = 604800;         // 7 days
    uint256 public constant MAX_OPERATIONS = 10;

    /// @notice Minimum voting power required to create a proposal. Immutable.
    uint96 public constant PROPOSAL_THRESHOLD = 1;

    // ─── State ──────────────────────────────────────────────────────────

    /// @notice NounV2 token contract used for voting power lookups.
    address public immutable nounsToken;

    /// @notice Admin can cancel proposals. Can be renounced (set to address(0)).
    address public admin;

    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;

    mapping(uint256 => address[]) internal _targets;
    mapping(uint256 => uint256[]) internal _values;
    mapping(uint256 => string[])  internal _signatures;
    mapping(uint256 => bytes[])   internal _calldatas;
    mapping(uint256 => string)    internal _descriptions;

    mapping(uint256 => mapping(address => Receipt)) public receipts;

    uint256 private _locked = 1;
    modifier nonReentrant() {
        require(_locked == 1, "REENTRANCY");
        _locked = 2;
        _;
        _locked = 1;
    }

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

    constructor(address _nounsToken, address _admin) {
        require(_nounsToken.code.length > 0, "INVALID_TOKEN");
        nounsToken = _nounsToken;
        admin = _admin;
    }

    /// @notice Create a grant proposal. Proposer must hold >= PROPOSAL_THRESHOLD voting power.
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

        // Snapshot at previous block to prevent flash-loan manipulation,
        // and enforce the proposal threshold against the same snapshot.
        uint256 snapshot = block.number - 1;
        if (_getVotes(msg.sender, snapshot) < PROPOSAL_THRESHOLD) revert BelowProposalThreshold();

        proposalCount++;
        uint256 id = proposalCount;

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

    function castVote(uint256 proposalId, uint8 support) external {
        _castVote(msg.sender, proposalId, support, "");
    }

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

    function queue(uint256 proposalId) external {
        if (state(proposalId) != ProposalState.Succeeded) revert InvalidState(state(proposalId), ProposalState.Succeeded);

        Proposal storage p = proposals[proposalId];
        p.queued = true;
        p.eta = block.timestamp + TIMELOCK_DELAY;

        emit ProposalQueued(proposalId, p.eta);
    }

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

    function cancel(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        if (p.executed) revert InvalidProposal();
        if (msg.sender != p.proposer && msg.sender != admin) revert NotProposerOrAdmin();

        p.canceled = true;
        emit ProposalCanceled(proposalId);
    }

    function state(uint256 proposalId) public view returns (ProposalState) {
        if (proposalId == 0 || proposalId > proposalCount) revert InvalidProposal();

        Proposal storage p = proposals[proposalId];

        if (p.canceled) return ProposalState.Canceled;
        if (p.executed) return ProposalState.Executed;

        if (block.number <= p.endBlock) return ProposalState.Active;

        if (p.forVotes <= p.againstVotes) return ProposalState.Defeated;

        if (!p.queued) return ProposalState.Succeeded;

        if (block.timestamp > p.eta + GRACE_PERIOD) return ProposalState.Expired;

        return ProposalState.Queued;
    }

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

    function getDescription(uint256 proposalId) external view returns (string memory) {
        return _descriptions[proposalId];
    }

    function getReceipt(uint256 proposalId, address voter) external view returns (Receipt memory) {
        return receipts[proposalId][voter];
    }

    function setAdmin(address newAdmin) external {
        if (msg.sender != admin && msg.sender != address(this)) revert OnlyAdmin();
        emit AdminChanged(admin, newAdmin);
        admin = newAdmin;
    }

    receive() external payable {
        emit ETHReceived(msg.sender, msg.value);
    }

    function _getVotes(address account, uint256 blockNumber) internal view returns (uint96) {
        (bool success, bytes memory data) = nounsToken.staticcall(
            abi.encodeWithSignature("getPriorVotes(address,uint256)", account, blockNumber)
        );
        require(success && data.length >= 32, "VOTE_LOOKUP_FAILED");
        return abi.decode(data, (uint96));
    }
}
