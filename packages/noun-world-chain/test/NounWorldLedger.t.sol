// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {NounWorldLedger} from "../src/NounWorldLedger.sol";

contract NounWorldLedgerTest is Test {
    NounWorldLedger ledger;

    address owner = makeAddr("owner");
    address committer = makeAddr("committer");
    address stranger = makeAddr("stranger");

    uint8 constant G = 1; // KIND_GRAFFITI
    uint8 constant R = 2; // KIND_RECORDS
    string constant URI = "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

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

    function setUp() public {
        vm.warp(1_790_000_000);
        ledger = new NounWorldLedger(owner, committer);
    }

    function _commit(bytes32 root, uint8 kind) internal returns (uint256) {
        vm.prank(committer);
        return ledger.commit(root, URI, kind);
    }

    // ── Construction ─────────────────────────────────────────────────────────

    function test_constructor_setsRoles() public view {
        assertEq(ledger.owner(), owner);
        assertEq(ledger.committer(), committer);
        assertEq(ledger.pendingOwner(), address(0));
        assertEq(ledger.versionCount(), 0);
        assertEq(ledger.KIND_GRAFFITI(), 1);
        assertEq(ledger.KIND_RECORDS(), 2);
    }

    function test_constructor_emitsRoles() public {
        vm.expectEmit(true, true, false, false);
        emit OwnershipTransferred(address(0), owner);
        vm.expectEmit(true, true, false, false);
        emit CommitterChanged(address(0), committer);
        new NounWorldLedger(owner, committer);
    }

    function test_constructor_rejectsZero() public {
        vm.expectRevert(NounWorldLedger.ZeroAddress.selector);
        new NounWorldLedger(address(0), committer);
        vm.expectRevert(NounWorldLedger.ZeroAddress.selector);
        new NounWorldLedger(owner, address(0));
    }

    // ── Access control ───────────────────────────────────────────────────────

    function test_commit_onlyCommitter() public {
        vm.prank(stranger);
        vm.expectRevert(NounWorldLedger.NotCommitter.selector);
        ledger.commit(keccak256("a"), URI, G);
        // not even the owner
        vm.prank(owner);
        vm.expectRevert(NounWorldLedger.NotCommitter.selector);
        ledger.commit(keccak256("a"), URI, G);
    }

    function testFuzz_commit_onlyCommitter(address who) public {
        vm.assume(who != committer);
        vm.prank(who);
        vm.expectRevert(NounWorldLedger.NotCommitter.selector);
        ledger.commit(keccak256("a"), URI, G);
    }

    function test_setCommitter_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(NounWorldLedger.NotOwner.selector);
        ledger.setCommitter(stranger);
        vm.prank(committer);
        vm.expectRevert(NounWorldLedger.NotOwner.selector);
        ledger.setCommitter(stranger);
    }

    function test_setCommitter_rotates() public {
        address next = makeAddr("next");
        vm.expectEmit(true, true, false, false);
        emit CommitterChanged(committer, next);
        vm.prank(owner);
        ledger.setCommitter(next);
        assertEq(ledger.committer(), next);

        // the old key is locked out at once
        vm.prank(committer);
        vm.expectRevert(NounWorldLedger.NotCommitter.selector);
        ledger.commit(keccak256("a"), URI, G);

        vm.prank(next);
        assertEq(ledger.commit(keccak256("a"), URI, G), 0);
    }

    function test_setCommitter_rejectsZero() public {
        vm.prank(owner);
        vm.expectRevert(NounWorldLedger.ZeroAddress.selector);
        ledger.setCommitter(address(0));
    }

    function test_ownership_twoStep() public {
        address next = makeAddr("nextOwner");
        vm.prank(stranger);
        vm.expectRevert(NounWorldLedger.NotOwner.selector);
        ledger.transferOwnership(next);

        vm.expectEmit(true, true, false, false);
        emit OwnershipTransferStarted(owner, next);
        vm.prank(owner);
        ledger.transferOwnership(next);
        assertEq(ledger.owner(), owner, "owner stays until accepted");
        assertEq(ledger.pendingOwner(), next);

        vm.prank(stranger);
        vm.expectRevert(NounWorldLedger.NotPendingOwner.selector);
        ledger.acceptOwnership();

        vm.expectEmit(true, true, false, false);
        emit OwnershipTransferred(owner, next);
        vm.prank(next);
        ledger.acceptOwnership();
        assertEq(ledger.owner(), next);
        assertEq(ledger.pendingOwner(), address(0));

        // the old owner has nothing left
        vm.prank(owner);
        vm.expectRevert(NounWorldLedger.NotOwner.selector);
        ledger.setCommitter(stranger);
        vm.prank(next);
        ledger.setCommitter(stranger);
        assertEq(ledger.committer(), stranger);
    }

    function test_ownership_cancel() public {
        address next = makeAddr("nextOwner");
        vm.startPrank(owner);
        ledger.transferOwnership(next);
        ledger.transferOwnership(address(0));
        vm.stopPrank();
        vm.prank(next);
        vm.expectRevert(NounWorldLedger.NotPendingOwner.selector);
        ledger.acceptOwnership();
        // nobody can accept a cancelled hand-over, not even address(0)
        vm.prank(address(0));
        vm.expectRevert(NounWorldLedger.NotPendingOwner.selector);
        ledger.acceptOwnership();
        assertEq(ledger.owner(), owner);
    }

    // ── Validation ───────────────────────────────────────────────────────────

    function test_commit_rejectsZeroRoot() public {
        vm.prank(committer);
        vm.expectRevert(NounWorldLedger.ZeroRoot.selector);
        ledger.commit(bytes32(0), URI, G);
    }

    function test_commit_rejectsKindZero() public {
        vm.prank(committer);
        vm.expectRevert(NounWorldLedger.BadKind.selector);
        ledger.commit(keccak256("a"), URI, 0);
    }

    function test_commit_rejectsEmptyURI() public {
        vm.prank(committer);
        vm.expectRevert(NounWorldLedger.EmptyURI.selector);
        ledger.commit(keccak256("a"), "", G);
    }

    function test_commit_rejectsLongURI() public {
        bytes memory long = new bytes(257);
        for (uint256 i = 0; i < long.length; i++) long[i] = "a";
        vm.prank(committer);
        vm.expectRevert(NounWorldLedger.URITooLong.selector);
        ledger.commit(keccak256("a"), string(long), G);

        bytes memory max = new bytes(256);
        for (uint256 i = 0; i < max.length; i++) max[i] = "a";
        vm.prank(committer);
        ledger.commit(keccak256("a"), string(max), G);
    }

    function test_commit_rejectsSameRootSameKind() public {
        bytes32 root = keccak256("day1");
        _commit(root, G);
        vm.prank(committer);
        vm.expectRevert(NounWorldLedger.SameRoot.selector);
        ledger.commit(root, URI, G);
        // a different kind may share it, and a root may come back after a change
        _commit(root, R);
        _commit(keccak256("day2"), G);
        _commit(root, G);
        assertEq(ledger.versionCountOf(G), 3);
    }

    function test_commit_newKindWithoutRedeploy() public {
        _commit(keccak256("x"), 7);
        assertEq(ledger.versionCountOf(7), 1);
    }

    // ── Append-only history ──────────────────────────────────────────────────

    function test_commit_appendsAndStores() public {
        bytes32 r0 = keccak256("g0");
        bytes32 r1 = keccak256("r0");
        bytes32 r2 = keccak256("g1");

        assertEq(_commit(r0, G), 0);
        vm.warp(block.timestamp + 1 days);
        assertEq(_commit(r1, R), 1);
        vm.warp(block.timestamp + 1 days);
        assertEq(_commit(r2, G), 2);

        assertEq(ledger.versionCount(), 3);
        assertEq(ledger.versionCountOf(G), 2);
        assertEq(ledger.versionCountOf(R), 1);

        NounWorldLedger.Version memory v = ledger.version(0);
        assertEq(v.root, r0);
        assertEq(v.kind, G);
        assertEq(v.kindIndex, 0);
        assertEq(v.timestamp, 1_790_000_000);
        assertEq(v.uri, URI);

        v = ledger.version(2);
        assertEq(v.root, r2);
        assertEq(v.kindIndex, 1);
        assertEq(v.timestamp, 1_790_000_000 + 2 days);

        (uint256 i, NounWorldLedger.Version memory l) = ledger.latest();
        assertEq(i, 2);
        assertEq(l.root, r2);

        (i, l) = ledger.latestOf(R);
        assertEq(i, 1);
        assertEq(l.root, r1);

        (i, l) = ledger.versionOf(G, 0);
        assertEq(i, 0);
        assertEq(l.root, r0);
        (i, l) = ledger.versionOf(G, 1);
        assertEq(i, 2);
        assertEq(l.root, r2);
    }

    function test_history_neverChanges() public {
        bytes32 r0 = keccak256("first");
        _commit(r0, G);
        NounWorldLedger.Version memory before = ledger.version(0);

        for (uint256 d = 1; d <= 20; d++) {
            vm.warp(block.timestamp + 1 days);
            _commit(keccak256(abi.encode(d)), d % 2 == 0 ? G : R);
        }
        vm.prank(owner);
        ledger.setCommitter(stranger);
        vm.prank(stranger);
        ledger.commit(keccak256("later"), "ar://abc", G);

        NounWorldLedger.Version memory afterwards = ledger.version(0);
        assertEq(afterwards.root, before.root);
        assertEq(afterwards.timestamp, before.timestamp);
        assertEq(afterwards.kind, before.kind);
        assertEq(afterwards.kindIndex, before.kindIndex);
        assertEq(afterwards.uri, before.uri);
        assertEq(ledger.versionCount(), 22);
    }

    /// The contract has no selector that writes to an existing version: anything but the
    /// known functions falls through to a revert (no fallback / receive).
    function test_noEditOrDeleteEntryPoints() public {
        _commit(keccak256("a"), G);
        bytes4[4] memory bogus = [
            bytes4(keccak256("edit(uint256,bytes32,string)")),
            bytes4(keccak256("remove(uint256)")),
            bytes4(keccak256("deleteVersion(uint256)")),
            bytes4(keccak256("setVersion(uint256,bytes32)"))
        ];
        for (uint256 i = 0; i < bogus.length; i++) {
            vm.prank(owner);
            (bool ok,) = address(ledger).call(abi.encodeWithSelector(bogus[i], 0, keccak256("b")));
            assertFalse(ok);
        }
        vm.deal(owner, 1 ether);
        vm.prank(owner);
        (bool sent,) = address(ledger).call{value: 1}("");
        assertFalse(sent, "no ether accepted");
        assertEq(ledger.version(0).root, keccak256("a"));
    }

    function testFuzz_appendOnly(bytes32[8] memory roots, uint8[8] memory kinds) public {
        uint256 expected;
        for (uint256 i = 0; i < 8; i++) {
            bytes32 root = roots[i];
            uint8 kind = kinds[i];
            if (root == bytes32(0) || kind == 0) continue;
            if (ledger.versionCountOf(kind) > 0) {
                (, NounWorldLedger.Version memory last) = ledger.latestOf(kind);
                if (last.root == root) continue;
            }
            uint256 idx = _commit(root, kind);
            assertEq(idx, expected);
            expected++;
        }
        assertEq(ledger.versionCount(), expected);
        // every stored version still holds what was committed for it
        uint256 j;
        for (uint256 i = 0; i < 8 && j < expected; i++) {
            NounWorldLedger.Version memory v = ledger.version(j);
            if (v.root == roots[i] && v.kind == kinds[i]) j++;
        }
        assertEq(j, expected);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function test_views_emptyAndOutOfRange() public {
        vm.expectRevert(NounWorldLedger.NoVersions.selector);
        ledger.latest();
        vm.expectRevert(NounWorldLedger.NoVersions.selector);
        ledger.latestOf(G);
        vm.expectRevert(NounWorldLedger.OutOfRange.selector);
        ledger.version(0);
        vm.expectRevert(NounWorldLedger.OutOfRange.selector);
        ledger.versionOf(G, 0);
        assertEq(ledger.versions(0, 10).length, 0);

        _commit(keccak256("a"), G);
        vm.expectRevert(NounWorldLedger.OutOfRange.selector);
        ledger.version(1);
        vm.expectRevert(NounWorldLedger.NoVersions.selector);
        ledger.latestOf(R);
    }

    function test_versions_pages() public {
        for (uint256 i = 0; i < 5; i++) _commit(keccak256(abi.encode(i)), G);
        NounWorldLedger.Version[] memory page = ledger.versions(1, 3);
        assertEq(page.length, 3);
        assertEq(page[0].root, keccak256(abi.encode(uint256(1))));
        assertEq(page[2].root, keccak256(abi.encode(uint256(3))));
        assertEq(ledger.versions(3, 100).length, 2);
        assertEq(ledger.versions(5, 1).length, 0);
        assertEq(ledger.versions(0, 0).length, 0);
    }

    // ── Events ───────────────────────────────────────────────────────────────

    function test_commit_emits() public {
        bytes32 root = keccak256("evt");
        vm.expectEmit(true, true, true, true, address(ledger));
        emit Committed(0, G, root, 0, uint64(block.timestamp), URI, committer);
        _commit(root, G);

        vm.warp(block.timestamp + 1 days);
        bytes32 root2 = keccak256("evt2");
        vm.expectEmit(true, true, true, true, address(ledger));
        emit Committed(1, G, root2, 1, uint64(block.timestamp), URI, committer);
        _commit(root2, G);
    }

    // ── Merkle verification ──────────────────────────────────────────────────

    function _leaf(uint8 kind, string memory key, bytes32 contentHash) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(kind, key, contentHash))));
    }

    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function test_verify_threeLeaves() public {
        bytes32 a = _leaf(G, "plaza|0.00,0.00,1.00|-12|3|1/abc", keccak256("piece a"));
        bytes32 b = _leaf(G, "plaza|0.00,0.00,1.00|-12|3|1/def", keccak256("piece b"));
        bytes32 c = _leaf(G, "park|1.00,0.00,0.00|4|0|0/123", keccak256("piece c"));
        bytes32 ab = _pair(a, b);
        bytes32 root = _pair(ab, c);
        _commit(root, G);

        bytes32[] memory proofA = new bytes32[](2);
        proofA[0] = b;
        proofA[1] = c;
        assertTrue(ledger.verify(0, a, proofA));

        bytes32[] memory proofC = new bytes32[](1);
        proofC[0] = ab;
        assertTrue(ledger.verify(0, c, proofC));

        bytes32 forged = _leaf(G, "plaza|0.00,0.00,1.00|-12|3|1/abc", keccak256("edited"));
        assertFalse(ledger.verify(0, forged, proofA));

        vm.expectRevert(NounWorldLedger.OutOfRange.selector);
        ledger.verify(1, a, proofA);
    }

    function test_verify_singleLeafRoot() public {
        bytes32 a = _leaf(R, "kmh/0x00", keccak256("row"));
        _commit(a, R);
        assertTrue(ledger.verify(0, a, new bytes32[](0)));
    }

    // ── Gas ──────────────────────────────────────────────────────────────────

    /// A daily commit with a real-length ipfs:// URI (66 bytes: 4 storage slots) costs
    /// ~180k gas of execution, ~200k for the whole transaction (README cost table).
    /// gasleft() here leaves out the 21k base + calldata, hence the lower bounds.
    function test_gas_commit() public {
        _commit(keccak256("warm"), R); // first write of the arrays' length slot is paid here
        vm.prank(committer);
        uint256 g = gasleft();
        ledger.commit(keccak256("day"), URI, G);
        uint256 used = g - gasleft();
        emit log_named_uint("commit gas (first of its kind)", used);
        assertLt(used, 215_000);

        vm.prank(committer);
        g = gasleft();
        ledger.commit(keccak256("day+1"), URI, G);
        used = g - gasleft();
        emit log_named_uint("commit gas (steady state)", used);
        assertLt(used, 190_000);
    }

    function test_gas_viewsAreCheap() public {
        for (uint256 i = 0; i < 30; i++) _commit(keccak256(abi.encode(i)), G);
        uint256 g = gasleft();
        ledger.latestOf(G);
        assertLt(g - gasleft(), 30_000);
    }
}
