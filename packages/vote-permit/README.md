# @nouns/vote-permit

**Scoped Vote Permission (SVP)** — let a relayer cast governance votes _from your own EOA_ and nothing else.

Built on [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702) (MetaMask smart accounts) and the
[MetaMask Delegation Framework](https://github.com/MetaMask/delegation-framework) v1.3.0
([ERC-7710](https://eips.ethereum.org/EIPS/eip-7710) delegations with caveat enforcers).
Targets Nouns DAO and Lil Nouns DAO out of the box; the profile generalises to any Governor-style DAO
(see [SPEC.md](./SPEC.md)).

No new contracts. Everything runs through audited, already-deployed framework contracts. The package is a
thin, typed, viem-based encoder/decoder plus a validation profile that relayers **must** enforce.

```
pnpm add @nouns/vote-permit viem
```

MIT. Verified read-only against mainnet on 2026-09-03 (see [Verification](#verification)).

---

## What it does

A voter who has upgraded their EOA to a MetaMask smart account (EIP-7702) signs one EIP-712 message — a
_delegation_ — that says:

> `relayer` may call **`castRefundableVote` / `castRefundableVoteWithReason`** on **this governor**, with
> **0 ETH**, from **my address**, **until `expiresAt`** [, at most `maxVotes` times].

The relayer later redeems it through the framework's `DelegationManager`, which:

1. checks the delegation signature (ECDSA for an EOA, ERC-1271 once the EOA carries 7702 code),
2. runs every caveat enforcer (target, method, value, redeemer, time window, call count, nonce),
3. calls `executeFromExecutor` on the voter's account, which calls the governor.

The governor therefore sees `msg.sender == voter`. Votes count as the voter's own — no token delegation, no
custody, no separate "voting wallet".

The voter can revoke at any time with one transaction, and the permission dies on its own at `expiresAt`.

---

## 60-second usage

### 1. Grant (voter, in the browser)

```ts
import { buildVoteDelegation, GOVERNORS, serializeDelegation } from '@nouns/vote-permit';
import { walletClient } from './wagmi'; // MetaMask, connected as the voter

const { delegation, typedData, summary } = buildVoteDelegation({
  chainId: 1,
  governor: GOVERNORS.nouns.address,
  governorKind: 'nouns',
  delegator: voter, // the connected EOA
  redeemer: RELAYER_ADDRESS, // your server's hot wallet
  expiresAt: Math.floor(Date.now() / 1000) + 30 * 86_400,
  maxVotes: 50, // optional
});

// Show `summary` to the user — it is exactly what the caveats enforce.
const signature = await walletClient.signTypedData({ account: voter, ...typedData });

await fetch('/api/vote-permit', {
  method: 'POST',
  body: serializeDelegation({ ...delegation, signature }),
});
```

MetaMask asks the user to upgrade the EOA to a smart account the first time (it can be bundled in the same
flow). Until the account carries `0xef0100‖0x63c0…E32B` code, redemption reverts at `executeFromExecutor`.
Check with:

```ts
import { parse7702Code } from '@nouns/vote-permit';
const { isMetaMaskDelegator } = parse7702Code(await publicClient.getCode({ address: voter }));
```

### 2. Redeem (relayer, on the server)

```ts
import { buildRedeemVoteCall, decodeVoteDelegation, deserializeDelegation } from '@nouns/vote-permit';

const delegation = deserializeDelegation(row.json);

// REQUIRED: reject anything broader than "vote on this governor".
const scope = decodeVoteDelegation(delegation); // throws InvalidVoteDelegationError otherwise
if (scope.expiresAt <= now) throw new Error('expired');

const { to, data, value } = buildRedeemVoteCall({
  delegation,
  governorKind: scope.governorKind,
  governor: scope.governor,
  proposalId: 987n,
  support: 1, // 0 against, 1 for, 2 abstain
  reason: 'gm', // optional → castRefundableVoteWithReason
  clientId: 37, // nouns only; defaults to noun.wtf's id
});

await relayerWallet.sendTransaction({ to, data, value });
```

### 3. Revoke (voter)

```ts
import { buildRevokeCall, buildIsRevokedCall } from '@nouns/vote-permit';

const { to, data } = buildRevokeCall(delegation); // DelegationManager.disableDelegation — msg.sender must be the voter
await walletClient.sendTransaction({ account: voter, to, data });
```

Bulk revocation: build delegations with a `nonce`, then `buildIncrementNonceCall()` invalidates all of them at once.

---

## API

| Export                                                | Purpose                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `FRAMEWORK`                                           | v1.3.0 DelegationManager, enforcer and 7702-delegator addresses, `ROOT_AUTHORITY`           |
| `GOVERNORS`                                           | Nouns / Lil Nouns governor configs (`kind`, `clientIdParam`)                                |
| `buildVoteDelegation(scope)`                          | → `{ delegation, typedData, summary }`                                                      |
| `decodeVoteDelegation(d, opts?)`                      | Parse caveats → `ScopeSummary`; **throws** on anything outside the SVP profile              |
| `getDelegationHash(d)`                                | `EncoderLib._getDelegationHash` — equals `DelegationManager.getDelegationHash` on-chain     |
| `getDelegationSigningHash(d, chainId)`                | The EIP-712 digest that is actually signed                                                  |
| `buildRedeemVoteCall(args)`                           | `redeemDelegations` calldata for one vote                                                   |
| `buildRevokeCall(d)` / `buildIsRevokedCall(d)`        | `disableDelegation` / `disabledDelegations(hash)`                                           |
| `buildIncrementNonceCall()`                           | `NonceEnforcer.incrementNonce(delegationManager)`                                           |
| `parse7702Code(code)` / `make7702Code(impl?)`         | Inspect / construct an EIP-7702 designation                                                 |
| `serializeDelegation` / `deserializeDelegation`       | bigint-safe JSON                                                                            |
| `serializeTypedData`                                  | Typed data JSON with decimal `salt` for raw `eth_signTypedData_v4`                          |
| `ABIS`                                                | Minimal ABIs: DelegationManager, governors' vote functions, LimitedCalls/Nonce enforcers    |
| `VOTE_SELECTORS`, `encode*Terms` / `decode*Terms`     | Lower-level building blocks                                                                 |

`ScopeSummary` (what the voter approved / what a server must display):

```ts
{
  governor: Address; governorKind: 'nouns' | 'lil';
  allowedFunctions: string[]; // e.g. 'castRefundableVote(uint256,uint8,uint32)'
  redeemer: Address; expiresAt: number; notBefore?: number;
  maxVotes?: number; valueLimit: 0n; nonce?: bigint;
}
```

---

## Wallet support matrix

| Voter's account                                     | Works?  | Notes                                                                                                       |
| --------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| MetaMask (extension / mobile) EOA → smart account   | **Yes** | MetaMask upgrades the EOA via EIP-7702 to `EIP7702StatelessDeleGator`; signs the delegation as plain EIP-712 |
| Hardware wallet through MetaMask                    | Yes     | Ledger/Trezor must support EIP-7702 authorization + `eth_signTypedData_v4`                                  |
| Other EOA wallets (Rainbow, Rabby, Coinbase Wallet) | Not yet | They can sign the typed data, but redemption needs the EOA to carry a DeleGator-compatible 7702 code        |
| Safe (Gnosis) multisig                              | No      | Use [Zodiac Roles](https://github.com/gnosisguild/zodiac-modifier-roles) — same idea, Safe-native           |
| Other ERC-4337 smart accounts                       | No      | Unless they implement `IDeleGatorCore.executeFromExecutor` and ERC-1271                                     |

The DelegationManager takes the ERC-1271 path once the EOA has code. MetaMask's 7702 delegator implements
`isValidSignature` as a plain `ECDSA.recover(hash, sig) == address(this)`, so **the same EIP-712 signature is
valid before and after the upgrade**. You can collect the signature first and let the user upgrade later.

---

## Security model

**What a compromised relayer can do:** cast votes on the allowed governor, from the voter's address, until
`expiresAt` (or `maxVotes` is hit). That is the entire blast radius:

- `AllowedTargetsEnforcer` — only the governor. No token contract, no treasury, no other DAO.
- `AllowedMethodsEnforcer` — only `castRefundableVote(...)` / `castRefundableVoteWithReason(...)`. No
  `propose`, `cancel`, `queue`, `execute`, `delegate`, `transfer`, `setApprovalForAll`.
- `ValueLteEnforcer(0)` — no ETH can move.
- `RedeemerEnforcer` — only the named relayer can redeem, even if the delegation JSON leaks.
- `TimestampEnforcer` — hard expiry, on-chain, no revocation transaction needed.
- Single-hop only (`authority == ROOT_AUTHORITY`) — the relayer cannot re-delegate.

**What it cannot do:** move assets, change token delegation, act on any contract other than the governor, or
outlive the expiry.

**Revocation paths (all voter-initiated, all one tx):**

1. `DelegationManager.disableDelegation(delegation)` — kills one delegation by hash.
2. `NonceEnforcer.incrementNonce(delegationManager)` — kills every delegation carrying a `nonce` caveat.
3. Removing the 7702 designation (`eth_getCode` → `0x`) — redemption reverts at `executeFromExecutor`.
4. Do nothing — it expires.

**Relayer obligations:** always run `decodeVoteDelegation` before storing or redeeming; store the full
delegation JSON; never accept a delegation whose `delegate`/`Redeemer` is not your own key; treat the
delegation as a bearer credential for votes and protect it like one.

**Trust assumptions:** the MetaMask Delegation Framework contracts (audited, immutable at these addresses; the
DelegationManager has an owner-only `pause`), MetaMask's 7702 delegator implementation, and the governor
itself. This package adds no on-chain code.

---

## Gas notes

- Nouns / Lil Nouns `castRefundableVote*` refund gas to **`tx.origin`**, i.e. the relayer — which is what you
  want. The refund only covers the governor's own execution (measured from function entry) and is capped by the
  DAO's refund parameters. The DelegationManager + enforcer + 7702 dispatch overhead (roughly 60–90k gas for a
  five-caveat delegation) is **not** refunded; the relayer eats it.
- Nouns' refund only pays when `votes > 0`; a voter with no voting power still burns relayer gas. Check
  `getPriorVotes` / `getVotes` before redeeming.
- `LimitedCallsEnforcer` writes storage on every redemption (+~5k gas, first write ~22k).
- `castRefundableVoteWithReason` costs more with longer reasons; the relayer pays for calldata.

---

## Verification

`pnpm -F @nouns/vote-permit verify:mainnet` runs read-only checks against a public RPC:

- `eth_getCode` non-empty at the DelegationManager, all seven enforcers and the 7702 delegator;
  `VERSION() == "1.3.0"`, `NAME() == "DelegationManager"`, `ROOT_AUTHORITY`, and the EIP-712 domain separator
  all match `FRAMEWORK` / this package's `delegationDomain`.
- Local `getDelegationHash` equals `DelegationManager.getDelegationHash` on-chain for 5- and 7-caveat samples.
- Vote selectors are present in the Nouns and Lil Nouns governor implementation bytecode.
- A throwaway key signs a delegation; `eth_call` of the redeem from the relayer:
  - plain EOA (no code): revert with empty data — i.e. signature and every enforcer passed and the call died
    at `executeFromExecutor` (no code), as expected;
  - controls: tampered signature → `InvalidEOASignature()`, wrong caller → `InvalidDelegate()`, wrong target →
    `AllowedTargetsEnforcer:target-address-not-allowed`, expired → `TimestampEnforcer:expired-delegation`,
    redeemer mismatch → `RedeemerEnforcer:unauthorized-redeemer`;
  - with a `stateOverride` giving the EOA MetaMask's 7702 code: an active Lil Nouns proposal **succeeds** (0
    votes cast from a fresh key), a nonexistent id reverts inside the governor with
    `NounsDAO::state: invalid proposal id` — on both governors.

---

## Development

```
pnpm -F @nouns/vote-permit test        # vitest
pnpm -F @nouns/vote-permit typecheck
pnpm -F @nouns/vote-permit build       # tsup → dist/
pnpm -F @nouns/vote-permit verify:mainnet
```

Inside the noun.wtf monorepo the package is consumed straight from `src/` (`exports` → `./src/index.ts`);
`publishConfig` switches to `dist/` on `pnpm publish`.
