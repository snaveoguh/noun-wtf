# noun-world-chain

Noun World on Base. `NounWorldLedger` keeps an append-only, versioned history of
snapshots of the game: every graffiti piece on the walls, and every leaderboard
record. About once a day a job builds a Merkle tree over the snapshot, uploads the
files to IPFS or Arweave, and commits the root plus the manifest's URI as a new
version. Versions can't be edited or deleted, so anyone can later prove a piece or a
record was there at that version's time. `noun.wtf/onchain` lists the versions and
does that check in the browser.

Positions are only saved as part of a snapshot (the wall a piece is on), never live.

## Contract

`src/NounWorldLedger.sol` (Solidity 0.8.24, no dependencies).

| | |
| --- | --- |
| `commit(bytes32 root, string manifestURI, uint8 kind) → index` | committer only. Appends a version: root, URI (1–256 bytes), `block.timestamp`, kind, and its position among versions of that kind. Refuses a zero root, kind 0, and a root equal to the latest of the same kind (`SameRoot`: a day with no change costs nothing). |
| `setCommitter(address)` | owner only. Rotates the server's hot key, and the old key is locked out at once. |
| `transferOwnership(address)` / `acceptOwnership()` | two-step hand-over. `transferOwnership(address(0))` cancels a pending one. |
| `versionCount()`, `versionCountOf(kind)` | counts |
| `version(i)`, `versionOf(kind, n)`, `latest()`, `latestOf(kind)`, `versions(start, count)` | reads (`OutOfRange` / `NoVersions` when empty) |
| `verify(index, leaf, proof) → bool` | checks a Merkle proof against version `index`'s root |
| `Committed(index, kind, root, kindIndex, timestamp, uri, committer)` | one per version; `index`, `kind` and `root` are indexed |

Kinds: `1` graffiti, `2` records. Any non-zero `uint8` is accepted, so a new kind
needs no redeploy. Nothing writes to an existing version: there is no edit, delete,
fallback or `receive`.

### Leaves

```
file        = one JSON file per piece / row, canonical (keys sorted, no whitespace)
contentHash = keccak256(utf8(file))
leaf        = keccak256(bytes.concat(keccak256(abi.encode(uint8 kind, string key, bytes32 contentHash))))
parent      = keccak256(min(a, b) ‖ max(a, b))      // sorted pairs, OpenZeppelin MerkleProof style
```

Leaves are sorted before the tree is built (an odd node moves up as is), so the root
depends only on what's in the world, not the order it was read. The builder is
`packages/nouns-webapp/src/miniapps/world2/onchain/` (pure TS, tested):

- **graffiti** (`graffitiPieces`): key = `<wallId>/<sha256(tag)[0..24]>`, the same key
  `world-graffiti` files the tag under. The file holds the tag exactly as the game draws
  it (`g3:` strokes or legacy `g2:` dabs), the wall (level, plane normal, distance, cell),
  the tag's public id (hash48 of the author's nonce), strokes the author later took down
  (`hidden`), and when the store first saw it. Undo tags fold into the piece they hide;
  their nonce is never published.
- **records** (`recordRows`): every public board row (top 100 per metric), key =
  `<metric>/<address>` for linked riders, else `<metric>/name:<name>`. Name, linked
  address, value, rank, title. Never a rider id; "last seen" is left out so playing
  doesn't change a record's leaf.

A snapshot directory is `manifest.json` (root, count, every leaf's key, content hash,
file path, search label) plus `p/<contentHash>.json` per leaf. The manifest's URI is
what's committed: `ipfs://<dirCID>/manifest.json` or `ar://<manifestId>/manifest.json`.

On 2026-11-01 a dry run against noun.wtf gave 9,263 graffiti pieces on 3,393 walls
(5.8 MB, manifest 2.1 MB) and 422 record rows (127 KB).

## Tests

```bash
cd packages/noun-world-chain
forge test -vv            # access control, append-only (incl. fuzz), events, views, verify, gas
```

The TS side: `cd packages/nouns-webapp && npx vitest run src/miniapps/world2/onchain src/pages/Onchain`.

## Deploy

Never put a key in the repo or in env for the deploy: sign with `--ledger`,
`--trezor` or `--account <keystore>`.

```bash
cd packages/noun-world-chain
export OWNER_ADDRESS=0x…        # a Safe on mainnet (ALLOW_EOA_OWNER=true to use a wallet)
export COMMITTER_ADDRESS=0x…    # the address of the job's LEDGER_COMMITTER_KEY; not the owner
export BASE_SEPOLIA_RPC=https://sepolia.base.org BASE_RPC=https://mainnet.base.org
export ETHERSCAN_API_KEY=…      # for --verify (Etherscan v2 key works for Basescan)

forge script script/Deploy.s.sol:Deploy --rpc-url base_sepolia --account deployer --sender 0x… --broadcast --verify
forge script script/Deploy.s.sol:Deploy --rpc-url base         --ledger           --sender 0x… --broadcast --verify
```

The script writes `deployments/<chainId>.json`. Then put the address in
`LEDGER_DEPLOYMENTS` in `packages/nouns-webapp/src/miniapps/world2/onchain/contract.ts`
(the page and the job both read it), or set `VITE_LEDGER_ADDRESS` /
`VITE_LEDGER_CHAIN_ID` in `.github/workflows/netlify-deploy.yml` for the page.

## Turning it on

The job is `.github/workflows/world-onchain-snapshot.yml` (daily 04:17 UTC, plus a
manual run), running `scripts/onchain/snapshot.ts` in `packages/nouns-webapp`. With no
secrets it's a dry run: it reads noun.wtf, builds both snapshots, logs their roots and
keeps the files as a workflow artifact. It commits only when real storage **and** a
committer key and ledger address are set; a dry-run upload is never committed.

| GitHub setting | kind | what |
| --- | --- | --- |
| `PINATA_JWT` | secret | IPFS: a Pinata API JWT with `pinFileToIPFS` |
| `IRYS_KEY` | secret | or Arweave: a Base-funded EVM key for Irys (also `pnpm --filter @nouns/webapp add -D @irys/upload @irys/upload-ethereum`) |
| `SNAPSHOT_STORAGE` | variable | `pinata`, `irys` or `dryrun` (unset: whichever key is set) |
| `LEDGER_COMMITTER_KEY` | secret | `0x…` key of `COMMITTER_ADDRESS`. Holds a little ETH on Base for gas, nothing else |
| `LEDGER_ADDRESS` | variable | the ledger (or set `LEDGER_DEPLOYMENTS`) |
| `LEDGER_CHAIN_ID` | variable | `84532` (default) or `8453` |
| `LEDGER_RPC` | variable | optional RPC override |

Order: deploy to Base Sepolia → set the secrets with `LEDGER_CHAIN_ID=84532` → run
the workflow by hand → check `/onchain` on the dev site with
`VITE_LEDGER_CHAIN_ID=84532` → deploy to Base → switch the variables.

Locally: `cd packages/nouns-webapp && SNAPSHOT_OUT=/tmp/snap pnpm dlx tsx@4.20.3 scripts/onchain/snapshot.ts`.

The job is a GitHub Action, not a Netlify scheduled function. Scheduled functions stop
at 30 s, and reading ~3,400 walls, uploading ~6 MB and waiting for two receipts can
take longer than that.

## Costs and who pays

**Gas: the committer key pays, and the owner tops it up.** A commit stores a root, a
packed timestamp/kind/index word, the URI (an `ipfs://` CIDv1 manifest URI is ~80
bytes, 4 slots) and an index entry. That's about **180k gas of execution and ~200k for
the transaction** (measured on a local EVM: 201,318 in steady state, 211k for the very
first commit; `test_gas_commit` keeps it in bounds).

On Base, cost = gas × L2 gas price + a small L1 data fee (~300 bytes of calldata).

| L2 gas price | per commit (200k gas) | per day (2 commits) | per year |
| --- | --- | --- | --- |
| 0.005 gwei | 0.000001 ETH | 0.000002 ETH | ~0.0007 ETH |
| 0.05 gwei | 0.00001 ETH | 0.00002 ETH | ~0.007 ETH |

Add the L1 data fee on top, typically well under a cent per commit. Days with no new
paint or records cost nothing: the job skips a kind whose root didn't change. About
0.01 ETH on the committer covers a year at ordinary Base prices. Deploying costs
about 1.5M gas once, paid by the deployer.

**Storage: the site owner's Pinata or Irys account pays.**

- *IPFS / Pinata*: a version is ~6 MB today. Piece files are content-addressed, so an
  unchanged piece is the same block every day, and what's new each day is mostly the
  ~2 MB manifest plus new pieces: roughly 60–100 MB a month. That fits Pinata's paid
  tiers easily. Unpinning old manifests frees space, but don't: a version whose
  manifest is gone can't be checked any more (its root stays on-chain).
- *Arweave / Irys*: paid once and permanent. Every file is a data item, so a full
  snapshot is ~9,700 items a day. Check the current price with Irys (`irys price`)
  before switching: per-item minimums make many small files cost more than their
  bytes suggest.

## Security

- The committer can only append. A leaked key can add junk versions but can't change
  history. The owner rotates it with `setCommitter`, and junk versions are visible
  for what they are (their manifests won't rebuild their roots).
- The owner should be a Safe on mainnet (the deploy script insists unless
  `ALLOW_EOA_OWNER=true`). It has no power over versions, only over who commits.
- Data published: graffiti as drawn in the game, public tag ids, and leaderboard rows
  already shown publicly. Private rider ids and graffiti undo nonces never leave the
  server.
