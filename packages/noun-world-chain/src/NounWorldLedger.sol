// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title NounWorldLedger
/// @notice An append-only history of Noun World snapshots on Base.
///
///         About once a day the snapshot job builds a Merkle tree over every graffiti
///         piece (or every leaderboard row), uploads the pieces and a manifest to IPFS or
///         Arweave, and commits the tree's root here with the manifest's URI. Each commit
///         is a new version. A version is never edited or deleted: there is no function
///         that writes to an existing version, so anyone can prove a piece or a record was
///         in the world at that version's time with a Merkle proof against its root.
///
///         Leaves are double-hashed and pairs are hashed sorted (the OpenZeppelin
///         `MerkleProof` / `StandardMerkleTree` convention), so `verify` here checks the
///         same proofs the noun.wtf verify page does.
///
///         Roles: the owner (a Safe, ideally) rotates the committer and hands ownership
///         over in two steps. The committer is a hot key on the server that can only append.
contract NounWorldLedger {
    /// @notice What a version snapshots. New kinds can be used without a redeploy (any
    ///         non-zero uint8); these two are what the noun.wtf job writes.
    uint8 public constant KIND_GRAFFITI = 1;
    uint8 public constant KIND_RECORDS = 2;

    /// @notice Longest manifest URI accepted (an `ipfs://<CIDv1>` is ~66 bytes, `ar://` ~48).
    uint256 public constant MAX_URI_BYTES = 256;

    struct Version {
        /// Merkle root over the snapshot's leaves.
        bytes32 root;
        /// Block timestamp of the commit.
        uint64 timestamp;
        /// KIND_GRAFFITI, KIND_RECORDS, …
        uint8 kind;
        /// This version's position among versions of the same kind (0-based).
        uint32 kindIndex;
        /// Content URI of the manifest (ipfs://… or ar://…).
        string uri;
    }

    address public owner;
    address public pendingOwner;
    address public committer;

    Version[] private _versions;
    /// kind => global indices of that kind's versions, oldest first.
    mapping(uint8 => uint256[]) private _byKind;

    event Committed(
        uint256 indexed index,
        uint8 indexed kind,
        bytes32 indexed root,
        uint32 kindIndex,
        uint64 timestamp,
        string uri,
        address committer
    );
    event CommitterChanged(address indexed previousCommitter, address indexed newCommitter);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotPendingOwner();
    error NotCommitter();
    error ZeroAddress();
    error ZeroRoot();
    error BadKind();
    error EmptyURI();
    error URITooLong();
    error SameRoot();
    error NoVersions();
    error OutOfRange();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_, address committer_) {
        if (owner_ == address(0) || committer_ == address(0)) revert ZeroAddress();
        owner = owner_;
        committer = committer_;
        emit OwnershipTransferred(address(0), owner_);
        emit CommitterChanged(address(0), committer_);
    }

    // ── Writing ──────────────────────────────────────────────────────────────

    /// @notice Append a new version. Committer only.
    /// @param root        Merkle root of the snapshot (non-zero).
    /// @param manifestURI Content URI of the snapshot's manifest (1..256 bytes).
    /// @param kind        Non-zero kind; KIND_GRAFFITI or KIND_RECORDS for noun.wtf.
    /// @return index      The new version's global index.
    /// @dev Reverts SameRoot if the root equals the latest version of the same kind:
    ///      a day with no new paint doesn't need (or pay for) a version.
    function commit(bytes32 root, string calldata manifestURI, uint8 kind) external returns (uint256 index) {
        if (msg.sender != committer) revert NotCommitter();
        if (root == bytes32(0)) revert ZeroRoot();
        if (kind == 0) revert BadKind();
        uint256 len = bytes(manifestURI).length;
        if (len == 0) revert EmptyURI();
        if (len > MAX_URI_BYTES) revert URITooLong();

        uint256[] storage list = _byKind[kind];
        uint256 n = list.length;
        if (n > 0 && _versions[list[n - 1]].root == root) revert SameRoot();

        index = _versions.length;
        uint64 ts = uint64(block.timestamp);
        _versions.push(Version({root: root, timestamp: ts, kind: kind, kindIndex: uint32(n), uri: manifestURI}));
        list.push(index);
        emit Committed(index, kind, root, uint32(n), ts, manifestURI, msg.sender);
    }

    // ── Roles ────────────────────────────────────────────────────────────────

    /// @notice Rotate the committer (e.g. after a server key leak). Owner only.
    function setCommitter(address newCommitter) external onlyOwner {
        if (newCommitter == address(0)) revert ZeroAddress();
        emit CommitterChanged(committer, newCommitter);
        committer = newCommitter;
    }

    /// @notice Step 1 of an ownership hand-over. Passing address(0) cancels a pending one.
    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Step 2: the new owner accepts.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner || msg.sender == address(0)) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ── Reading ──────────────────────────────────────────────────────────────

    function versionCount() external view returns (uint256) {
        return _versions.length;
    }

    function versionCountOf(uint8 kind) external view returns (uint256) {
        return _byKind[kind].length;
    }

    function version(uint256 index) external view returns (Version memory) {
        if (index >= _versions.length) revert OutOfRange();
        return _versions[index];
    }

    /// @notice The `n`th version (0-based) of one kind, and its global index.
    function versionOf(uint8 kind, uint256 n) external view returns (uint256 index, Version memory v) {
        uint256[] storage list = _byKind[kind];
        if (n >= list.length) revert OutOfRange();
        index = list[n];
        v = _versions[index];
    }

    /// @notice The newest version of any kind.
    function latest() external view returns (uint256 index, Version memory v) {
        uint256 n = _versions.length;
        if (n == 0) revert NoVersions();
        index = n - 1;
        v = _versions[index];
    }

    /// @notice The newest version of one kind.
    function latestOf(uint8 kind) external view returns (uint256 index, Version memory v) {
        uint256[] storage list = _byKind[kind];
        uint256 n = list.length;
        if (n == 0) revert NoVersions();
        index = list[n - 1];
        v = _versions[index];
    }

    /// @notice Up to `count` versions starting at global index `start`, for pages and indexers.
    function versions(uint256 start, uint256 count) external view returns (Version[] memory out) {
        uint256 n = _versions.length;
        if (start >= n) return new Version[](0);
        uint256 end = start + count > n ? n : start + count;
        out = new Version[](end - start);
        for (uint256 i = start; i < end; i++) {
            out[i - start] = _versions[i];
        }
    }

    /// @notice Check a Merkle proof against version `index`'s root.
    /// @param leaf The leaf hash: keccak256(bytes.concat(keccak256(abi.encode(...)))),
    ///             computed off-chain by the snapshot builder (see the README).
    function verify(uint256 index, bytes32 leaf, bytes32[] calldata proof) external view returns (bool) {
        if (index >= _versions.length) revert OutOfRange();
        bytes32 h = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 p = proof[i];
            h = h < p ? keccak256(abi.encodePacked(h, p)) : keccak256(abi.encodePacked(p, h));
        }
        return h == _versions[index].root;
    }
}
