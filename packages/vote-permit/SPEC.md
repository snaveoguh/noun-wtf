# Scoped Vote Permission (SVP)

**An ERC-7710 profile for Governor-style DAOs**
Version 1 · Status: Draft · License: MIT · Reference implementation: `@nouns/vote-permit`

---

## 1. Abstract

SVP defines a fixed set of [ERC-7710](https://eips.ethereum.org/EIPS/eip-7710) caveats, built on the
[MetaMask Delegation Framework](https://github.com/MetaMask/delegation-framework) v1.3.0, that lets a token
holder grant a specific relayer the ability to cast governance votes **from the holder's own account** and
nothing else. It also defines the validation rules a relayer or server MUST apply before accepting such a
delegation, so that "SVP-compliant" means "cannot do anything except vote".

SVP introduces no contracts. A delegation is an off-chain EIP-712 signature; enforcement is entirely by the
framework's deployed `DelegationManager` and caveat enforcers.

## 2. Motivation

DAO tooling frequently wants to act on a voter's behalf: auto-voting on a schedule, "vote with my delegate's
recommendation", agent voting, mobile push-to-vote, gas abstraction. The existing options are poor:

- **Token delegation** moves voting power to another key; the delegate's votes are not the holder's, and
  many DAOs attach reputation, refunds, or client rewards to the actual voter address.
- **Session keys / hot wallets** require moving tokens.
- **Unrestricted account permissions** (raw 7702 batch execution, unlimited `redeemDelegations`) let the
  relayer do anything.

SVP gives the relayer exactly two function selectors on exactly one contract with exactly zero value, for a
bounded time, optionally a bounded count — while the governor still sees `msg.sender == voter`.

## 3. Profile

### 3.1 Prerequisites

- Voter account MUST be an EIP-7702-delegated EOA whose designated implementation implements
  `IDeleGatorCore.executeFromExecutor(bytes32 mode, bytes executionCalldata)` guarded by
  `onlyDelegationManager`, and ERC-1271 `isValidSignature`. MetaMask's `EIP7702StatelessDeleGator`
  (`0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B`) satisfies this. (A signature may be collected before the
  upgrade; redemption simply reverts until the code is present.)
- Relayer is an EOA or contract that calls `DelegationManager.redeemDelegations`.

### 3.2 Delegation struct

```
Delegation {
  delegate   = relayer                     // MUST equal the Redeemer caveat's single address
  delegator  = voter
  authority  = ROOT_AUTHORITY (bytes32 max) // single-hop; re-delegation is out of profile
  caveats    = [ see 3.3 ]
  salt       = any uint256 (unique per grant; random recommended)
  signature  = EIP-712 signature by `voter` over the DelegationManager domain
}
```

EIP-712 domain: `{ name: "DelegationManager", version: "1", chainId, verifyingContract: DelegationManager }`.
Types (verbatim from the framework — `signature` and `args` are excluded from hashing):

```
Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)
Caveat(address enforcer,bytes terms)
```

### 3.3 Caveat set

Order is fixed by the reference builder so that identical scopes hash identically; validators MUST accept any
order.

| #   | Enforcer (v1.3.0 mainnet)                                  | `terms`                                                       | Required | Constraint                                                       |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------- | -------- | ---------------------------------------------------------------- |
| 1   | `AllowedTargetsEnforcer` `0x7F20…4EeB`                     | `bytes20 governor`                                            | yes      | exactly one address; MUST be a governor in the validator's registry |
| 2   | `AllowedMethodsEnforcer` `0x2c21…42B5`                     | `bytes4[] selectors` packed                                   | yes      | non-empty; every selector MUST be a vote selector for that governor kind |
| 3   | `ValueLteEnforcer` `0x92Bf…6A8F`                           | `bytes32(0)`                                                  | yes      | MUST be zero                                                      |
| 4   | `RedeemerEnforcer` `0xE144…65c5`                           | `bytes20 relayer`                                             | yes      | exactly one address; MUST equal `delegation.delegate`             |
| 5   | `TimestampEnforcer` `0x1046…c069`                          | `uint128 notBefore ‖ uint128 expiresAt` (both exclusive; 0 = unset) | yes | `expiresAt` MUST be non-zero; `notBefore < expiresAt` if set     |
| 6   | `LimitedCallsEnforcer` `0x0465…5416`                       | `bytes32(uint256 maxCalls)`                                   | optional | `maxCalls ≥ 1`                                                    |
| 7   | `NonceEnforcer` `0xDE4f…254f`                              | `bytes32(uint256 nonce)`                                      | optional | MUST equal `NonceEnforcer.currentNonce(DelegationManager, voter)` at redemption |

`args` MUST be empty (`0x`) for every caveat in this profile.

Any caveat whose enforcer is not one of the seven above puts the delegation **out of profile**. Validators
MUST reject it rather than "ignore the unknown caveat" — an unknown enforcer might be a no-op, but a validator
cannot know that, and an SVP claim must be provable from the caveat set alone.

### 3.4 Vote selectors

| Governor kind | Contract                                     | Allowed selectors                                                                                     |
| ------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `nouns`       | `0x6f3E6272A167e8AcCb32072d08E0957F9c79223d` | `0x8f1447d9` `castRefundableVote(uint256,uint8,uint32)` · `0x8136730f` `castRefundableVoteWithReason(uint256,uint8,string,uint32)` |
| `lil`         | `0x5d2C31ce16924C2a71D317e5BbFd5ce387854039` | `0x44fac8f6` `castRefundableVote(uint256,uint8)` · `0x64c05995` `castRefundableVoteWithReason(uint256,uint8,string)` |

A scope MAY allow a strict subset (e.g. only the `WithReason` variant). Selectors for one kind MUST NOT be
accepted against a governor of another kind, even when the bytecode happens to also expose them.

### 3.5 Redemption

```
DelegationManager.redeemDelegations(
  permissionContexts = [ abi.encode(Delegation[]{ delegation }) ],
  modes              = [ bytes32(0) ],                 // CALLTYPE_SINGLE, EXECTYPE_DEFAULT
  executionCallDatas = [ abi.encodePacked(governor, uint256(0), voteCalldata) ]
)
```

Exactly one delegation per context, exactly one context per transaction for this profile. `voteCalldata` is
one of the allowed selectors with the voter's chosen `proposalId`, `support ∈ {0,1,2}`, optional `reason`, and
(kind `nouns`) a `uint32 clientId`.

The framework's order of checks (v1.3.0 `redeemDelegations`): delegate == `msg.sender` → signature (ECDSA
or ERC-1271) → not disabled → authority is root → `beforeAllHook`s → `beforeHook`s (all caveats) →
`executeFromExecutor` on the voter → `afterHook`s → `afterAllHook`s.

## 4. Validation rules (normative, for relayers and servers)

Before **storing** and again before **every redemption**, an SVP relayer MUST verify:

1. `authority == ROOT_AUTHORITY`.
2. Every caveat's `enforcer` is one of the seven profile enforcers; no duplicates; all five required present.
3. `AllowedTargets` decodes to exactly one address that is a governor the relayer explicitly supports.
4. `AllowedMethods` decodes to ≥1 selectors, all in the allowed set for that governor's kind.
5. `ValueLte == 0`.
6. `Redeemer` decodes to exactly one address equal to `delegate`, and that address is the relayer's own key.
7. `Timestamp.expiresAt != 0`; `now < expiresAt`; if `notBefore != 0`, `now > notBefore`.
8. If `LimitedCalls` present: `LimitedCallsEnforcer.callCounts(DelegationManager, hash) < limit`.
9. If `Nonce` present: `NonceEnforcer.currentNonce(DelegationManager, voter) == nonce`.
10. `DelegationManager.disabledDelegations(getDelegationHash(d)) == false`.
11. The signature recovers to `delegator` over the typed data in 3.2 (or ERC-1271 passes once the account has code).

A relayer SHOULD additionally verify, before spending gas: the account carries a compatible 7702 designation
(`eth_getCode == 0xef0100‖impl`), the proposal is `Active`, the voter has not already voted, and the voter's
voting power at the proposal snapshot is > 0.

Rules 1–7 are pure functions of the delegation (`decodeVoteDelegation` in the reference implementation).
Rules 8–11 need chain reads. Failure of any rule MUST result in rejection, never in a "best-effort" redeem.

## 5. Revocation

| Method                                                    | Who   | Effect                                                      |
| --------------------------------------------------------- | ----- | ----------------------------------------------------------- |
| `DelegationManager.disableDelegation(delegation)`         | voter | disables that one hash; reversible via `enableDelegation`   |
| `NonceEnforcer.incrementNonce(DelegationManager)`         | voter | invalidates all delegations with a `Nonce` caveat ≤ old nonce |
| Clearing / changing the 7702 designation                  | voter | redemption reverts at `executeFromExecutor`                 |
| Expiry                                                    | —     | `TimestampEnforcer` reverts after `expiresAt`               |

`disableDelegation` is guarded by `msg.sender == delegator`; the voter sends it directly from the EOA, with or
without 7702 code. Relayers SHOULD watch `DisabledDelegation` and `UsedNonce` events and drop stored grants.

## 6. Rationale

- **Why caveats instead of a custom "vote relayer" contract?** No new attack surface, no audit, no upgrade
  path to maintain; the framework is already what MetaMask users' accounts trust as root authority.
- **Why both `AllowedTargets` and `AllowedMethods`?** Either alone is insufficient: methods without a target
  lets the relayer call `castRefundableVote` on any contract that happens to expose that selector (a different
  DAO); a target without methods lets it call `propose`, `cancel`, `execute`, etc.
- **Why `ValueLte(0)` when the vote functions are non-payable?** Defence in depth against a governor upgrade
  that adds a payable path, and to make the "cannot move ETH" claim checkable from the caveat set alone.
- **Why `Redeemer` when `delegate` already restricts the caller?** `delegate` is checked by the
  DelegationManager; `Redeemer` is enforced per-caveat and survives being placed inside a delegation chain.
  Requiring them to match closes the gap where a leaked delegation could be redeemed via an intermediary.
- **Why single-hop only?** Chained delegations make the "who can redeem" answer depend on other signatures the
  validator does not hold. SVP is meant to be auditable from one JSON blob.
- **Why `expiresAt` mandatory?** A vote permission without expiry is a standing power of attorney. Relayer key
  rotation and voter forgetfulness both argue for a hard stop; renewals are one signature.
- **Why timestamps rather than proposal ids?** The framework has no "allowed uint256 argument" enforcer for
  arbitrary positions; timestamps are the closest cheap bound. A per-proposal profile can be layered via
  `LimitedCalls(1)` + short expiry.

## 7. Security considerations

- **Blast radius of a compromised relayer:** votes on the allowed governor as the voter, until expiry /
  count. Votes can be reputationally costly and, in DAOs with vote-dependent rewards or refunds, financially
  relevant; scope expiry and `maxVotes` accordingly.
- **Front-running a revocation:** a relayer that sees `disableDelegation` in the mempool can redeem first.
  Voters who suspect compromise should revoke via a private relay, or rely on `LimitedCalls`.
- **Gas griefing:** `RedeemerEnforcer` prevents third parties from redeeming; the only party who can waste
  the relayer's gas is the relayer.
- **Governor upgrades:** Nouns-style governors are proxies. A future implementation could change what those
  selectors do. Validators SHOULD pin selectors to a known implementation or re-verify after upgrades.
- **Signature replay across chains:** prevented by `chainId` in the EIP-712 domain. The framework addresses are
  identical on every chain it is deployed on, so `verifyingContract` alone would not be enough.
- **Args field:** `Caveat.args` is not signed and can be set by the redeemer. None of the profile enforcers
  read `args`, so it MUST be empty and MUST be ignored by validators.
- **Pause:** the DelegationManager owner can `pause()` redemption globally. This can only deny service, never
  widen scope.
- **Account implementation trust:** the voter's 7702 implementation is the real root of trust. A malicious
  implementation could ignore the DelegationManager entirely; SVP only makes claims for accounts using an
  implementation with the semantics in 3.1.

## 8. Extension to other governors

Any Governor whose vote functions are plain external calls with `msg.sender` as the voter fits the profile.
Register the governor and its selector set, then reuse everything else:

| Governor                      | Vote selectors                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| OpenZeppelin Governor         | `castVote(uint256,uint8)` `0x56781388` · `castVoteWithReason(uint256,uint8,string)` `0x7b3c71d3` · `castVoteWithReasonAndParams(uint256,uint8,string,bytes)` `0x5f398a14` |
| Compound Bravo                | `castVote(uint256,uint8)` `0x56781388` · `castVoteWithReason(uint256,uint8,string)` `0x7b3c71d3`                                       |
| Nouns-style (V3+, client ids) | `castRefundableVote(uint256,uint8,uint32)` `0x8f1447d9` · `castRefundableVoteWithReason(uint256,uint8,string,uint32)` `0x8136730f`     |
| Lil Nouns / Nouns V2-style    | `castRefundableVote(uint256,uint8)` `0x44fac8f6` · `castRefundableVoteWithReason(uint256,uint8,string)` `0x64c05995`                    |

The `castVoteBySig` family MUST NOT be allowed (it votes for whoever signed, not `msg.sender`, and is
pointless through a delegation). `castVoteWithReasonAndParams` SHOULD be reviewed per-DAO since `params` can
change semantics (fractional voting, etc.).

In the reference implementation, pass a custom registry: `decodeVoteDelegation(d, { governors: [...] })`
and extend `VOTE_FUNCTION_SIGNATURES` for new kinds.

## 9. Reference implementation

`@nouns/vote-permit` (this package). Conformance is tested by:

- caveat term encode/decode round-trips for all seven enforcers;
- `getDelegationHash` parity with `DelegationManager.getDelegationHash` on Ethereum mainnet;
- `eth_call` simulations proving the revert ladder (`InvalidEOASignature` → `InvalidDelegate` → enforcer
  reverts → `executeFromExecutor`) and, with a 7702 state override, execution reaching the governor.

## 10. Deployed addresses (v1.3.0, CREATE2 — same on mainnet and Sepolia)

```
DelegationManager           0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3
EIP7702StatelessDeleGator   0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B
AllowedTargetsEnforcer      0x7F20f61b1f09b08D970938F6fa563634d65c4EeB
AllowedMethodsEnforcer      0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5
ValueLteEnforcer            0x92Bf12322527cAA612fd31a0e810472BBB106A8F
RedeemerEnforcer            0xE144b0b2618071B4E56f746313528a669c7E65c5
TimestampEnforcer           0x1046bb45C8d673d4ea75321280DB34899413c069
LimitedCallsEnforcer        0x04658B29F6b82ed55274221a06Fc97D318E25416
NonceEnforcer               0xDE4f2FAC4B3D87A1d9953Ca5FC09FCa7F366254f
ROOT_AUTHORITY              0xffff…ffff (bytes32 max)
```

## Appendix A — Typed-data example

```json
{
  "domain": {
    "name": "DelegationManager",
    "version": "1",
    "chainId": 1,
    "verifyingContract": "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3"
  },
  "primaryType": "Delegation",
  "types": {
    "Delegation": [
      { "name": "delegate", "type": "address" },
      { "name": "delegator", "type": "address" },
      { "name": "authority", "type": "bytes32" },
      { "name": "caveats", "type": "Caveat[]" },
      { "name": "salt", "type": "uint256" }
    ],
    "Caveat": [
      { "name": "enforcer", "type": "address" },
      { "name": "terms", "type": "bytes" }
    ]
  },
  "message": {
    "delegate": "0x1111111111111111111111111111111111111111",
    "delegator": "0x2222222222222222222222222222222222222222",
    "authority": "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    "caveats": [
      { "enforcer": "0x7F20f61b1f09b08D970938F6fa563634d65c4EeB", "terms": "0x6f3e6272a167e8accb32072d08e0957f9c79223d" },
      { "enforcer": "0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5", "terms": "0x8f1447d98136730f" },
      { "enforcer": "0x92Bf12322527cAA612fd31a0e810472BBB106A8F", "terms": "0x0000000000000000000000000000000000000000000000000000000000000000" },
      { "enforcer": "0xE144b0b2618071B4E56f746313528a669c7E65c5", "terms": "0x1111111111111111111111111111111111111111" },
      { "enforcer": "0x1046bb45C8d673d4ea75321280DB34899413c069", "terms": "0x00000000000000000000000000000000000000000000000000000000691e6d80" },
      { "enforcer": "0x04658B29F6b82ed55274221a06Fc97D318E25416", "terms": "0x0000000000000000000000000000000000000000000000000000000000000032" }
    ],
    "salt": "1"
  }
}
```

(`salt` shown as a decimal string, as `eth_signTypedData_v4` expects; the reference implementation's
`typedData.message.salt` is a `bigint` for viem and `serializeTypedData` produces the form above.)
