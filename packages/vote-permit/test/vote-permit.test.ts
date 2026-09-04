import {
  decodeAbiParameters,
  decodeFunctionData,
  hashStruct,
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  stringToHex,
  toFunctionSelector,
  type Address,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import {
  ABIS,
  buildIsRevokedCall,
  buildRedeemVoteCall,
  buildRevokeCall,
  buildVoteDelegation,
  CAVEAT_TYPEHASH,
  decodeTimestampTerms,
  decodeVoteDelegation,
  DELEGATION_ARRAY_PARAMS,
  DELEGATION_TYPEHASH,
  deserializeDelegation,
  encodeTimestampTerms,
  FRAMEWORK,
  getDelegationHash,
  getDelegationSigningHash,
  GOVERNORS,
  InvalidVoteDelegationError,
  make7702Code,
  MODE_SINGLE_DEFAULT,
  parse7702Code,
  serializeDelegation,
  serializeTypedData,
  VOTE_SELECTORS,
  type Delegation,
  type VoteScope,
} from '../src/index.js';

const RELAYER: Address = '0x1111111111111111111111111111111111111111';
const VOTER: Address = '0x2222222222222222222222222222222222222222';
const NOW = 1_760_000_000;

function scope(overrides: Partial<VoteScope> = {}): VoteScope {
  return {
    chainId: 1,
    governor: GOVERNORS.nouns.address,
    governorKind: 'nouns',
    delegator: VOTER,
    redeemer: RELAYER,
    expiresAt: NOW + 30 * 86_400,
    salt: 1n,
    ...overrides,
  };
}

describe('selectors', () => {
  it('match hand-checked 4-byte values', () => {
    expect(toFunctionSelector('castRefundableVote(uint256,uint8,uint32)')).toBe(
      keccak256(stringToHex('castRefundableVote(uint256,uint8,uint32)')).slice(0, 10),
    );
    expect(VOTE_SELECTORS.nouns).toEqual([
      toFunctionSelector('castRefundableVote(uint256,uint8,uint32)'),
      toFunctionSelector('castRefundableVoteWithReason(uint256,uint8,string,uint32)'),
    ]);
    expect(VOTE_SELECTORS.lil).toEqual([
      toFunctionSelector('castRefundableVote(uint256,uint8)'),
      toFunctionSelector('castRefundableVoteWithReason(uint256,uint8,string)'),
    ]);
    // Pinned literals so a viem regression can't silently move them.
    expect(VOTE_SELECTORS.nouns).toEqual(['0x8f1447d9', '0x8136730f']);
    expect(VOTE_SELECTORS.lil).toEqual(['0x44fac8f6', '0x64c05995']);
  });
});

describe('typehashes', () => {
  it('match Constants.sol', () => {
    expect(DELEGATION_TYPEHASH).toBe(
      keccak256(
        stringToHex(
          'Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)',
        ),
      ),
    );
    expect(CAVEAT_TYPEHASH).toBe(keccak256(stringToHex('Caveat(address enforcer,bytes terms)')));
  });
});

describe('buildVoteDelegation', () => {
  it('builds the fixed caveat set for Nouns', () => {
    const { delegation, summary, typedData } = buildVoteDelegation(scope());
    expect(delegation.delegate).toBe(RELAYER);
    expect(delegation.delegator).toBe(VOTER);
    expect(delegation.authority).toBe(FRAMEWORK.rootAuthority);
    expect(delegation.salt).toBe(1n);
    expect(delegation.caveats.map(c => c.enforcer)).toEqual([
      FRAMEWORK.enforcers.allowedTargets,
      FRAMEWORK.enforcers.allowedMethods,
      FRAMEWORK.enforcers.valueLte,
      FRAMEWORK.enforcers.redeemer,
      FRAMEWORK.enforcers.timestamp,
    ]);
    expect(delegation.caveats[0]?.terms.toLowerCase()).toBe(GOVERNORS.nouns.address.toLowerCase());
    expect(delegation.caveats[1]?.terms).toBe('0x8f1447d98136730f');
    expect(delegation.caveats[2]?.terms).toBe(`0x${'0'.repeat(64)}`);
    expect(delegation.caveats[3]?.terms.toLowerCase()).toBe(RELAYER.toLowerCase());
    expect(delegation.caveats[4]?.terms).toBe(encodeTimestampTerms(0, NOW + 30 * 86_400));
    for (const c of delegation.caveats) expect(c.args).toBe('0x');

    expect(summary).toEqual({
      governor: GOVERNORS.nouns.address,
      governorKind: 'nouns',
      allowedFunctions: [
        'castRefundableVote(uint256,uint8,uint32)',
        'castRefundableVoteWithReason(uint256,uint8,string,uint32)',
      ],
      redeemer: RELAYER,
      expiresAt: NOW + 30 * 86_400,
      valueLimit: 0n,
    });

    expect(typedData.domain).toEqual({
      name: 'DelegationManager',
      version: '1',
      chainId: 1,
      verifyingContract: FRAMEWORK.delegationManager,
    });
    expect(typedData.primaryType).toBe('Delegation');
    // args must not leak into the signed message
    expect(Object.keys(typedData.message.caveats[0] ?? {})).toEqual(['enforcer', 'terms']);
    expect(typedData.message.salt).toBe(1n);
  });

  it('adds LimitedCalls and Nonce when requested, and honours notBefore', () => {
    const { delegation, summary } = buildVoteDelegation(
      scope({ maxVotes: 5, nonce: 3n, notBefore: NOW }),
    );
    expect(delegation.caveats).toHaveLength(7);
    expect(delegation.caveats[5]?.enforcer).toBe(FRAMEWORK.enforcers.limitedCalls);
    expect(delegation.caveats[6]?.enforcer).toBe(FRAMEWORK.enforcers.nonce);
    expect(summary.maxVotes).toBe(5);
    expect(summary.nonce).toBe(3n);
    expect(summary.notBefore).toBe(NOW);
    expect(decodeTimestampTerms(delegation.caveats[4]?.terms as Hex)).toEqual({
      after: NOW,
      before: NOW + 30 * 86_400,
    });
  });

  it('uses a random salt when none is given', () => {
    const a = buildVoteDelegation(scope({ salt: undefined })).delegation.salt;
    const b = buildVoteDelegation(scope({ salt: undefined })).delegation.salt;
    expect(a).not.toBe(b);
    expect(a).toBeGreaterThan(0n);
  });

  it('rejects non-vote selectors and bad time windows', () => {
    expect(() => buildVoteDelegation(scope({ selectors: ['0xa9059cbb'] }))).toThrow(
      /not a vote selector/,
    );
    expect(() => buildVoteDelegation(scope({ notBefore: NOW + 40 * 86_400 }))).toThrow(/notBefore/);
    expect(() => buildVoteDelegation(scope({ maxVotes: 0 }))).toThrow(/maxVotes/);
  });

  it('typed data serializes with bigint salt as a decimal string', () => {
    const { typedData } = buildVoteDelegation(scope({ salt: 123n }));
    const json = JSON.parse(serializeTypedData(typedData)) as { message: { salt: string } };
    expect(json.message.salt).toBe('123');
  });
});

describe('getDelegationHash', () => {
  it('equals viem hashStruct of the EIP-712 message (EncoderLib parity)', () => {
    const { delegation, typedData } = buildVoteDelegation(scope({ maxVotes: 2, nonce: 0n }));
    expect(getDelegationHash(delegation)).toBe(
      hashStruct({ data: typedData.message, primaryType: 'Delegation', types: typedData.types }),
    );
    expect(getDelegationSigningHash(delegation, 1)).toBe(hashTypedData(typedData));
  });

  it('ignores signature and args', () => {
    const { delegation } = buildVoteDelegation(scope());
    const signed: Delegation = {
      ...delegation,
      caveats: delegation.caveats.map(c => ({ ...c, args: '0xdeadbeef' })),
      signature: '0x1234',
    };
    expect(getDelegationHash(signed)).toBe(getDelegationHash(delegation));
  });

  it('signature over the typed data recovers to the delegator', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { delegation, typedData } = buildVoteDelegation(scope({ delegator: account.address }));
    const signature = await account.signTypedData(typedData);
    expect(await recoverTypedDataAddress({ ...typedData, signature })).toBe(account.address);
    expect(getDelegationHash({ ...delegation, signature })).toBe(getDelegationHash(delegation));
  });
});

describe('decodeVoteDelegation', () => {
  it('round-trips every scope field', () => {
    const s = scope({
      governor: GOVERNORS.lilNouns.address,
      governorKind: 'lil',
      maxVotes: 7,
      nonce: 42n,
      notBefore: NOW - 10,
    });
    const { delegation, summary } = buildVoteDelegation(s);
    const decoded = decodeVoteDelegation(delegation);
    expect(decoded).toEqual(summary);
    expect(decoded).toEqual({
      governor: GOVERNORS.lilNouns.address,
      governorKind: 'lil',
      allowedFunctions: [
        'castRefundableVote(uint256,uint8)',
        'castRefundableVoteWithReason(uint256,uint8,string)',
      ],
      redeemer: RELAYER,
      expiresAt: s.expiresAt,
      notBefore: NOW - 10,
      maxVotes: 7,
      valueLimit: 0n,
      nonce: 42n,
    });
  });

  it('accepts caveats in any order', () => {
    const { delegation } = buildVoteDelegation(scope({ maxVotes: 1 }));
    const shuffled = { ...delegation, caveats: [...delegation.caveats].reverse() };
    expect(decodeVoteDelegation(shuffled).maxVotes).toBe(1);
  });

  it('rejects anything broader than the SVP profile', () => {
    const { delegation } = buildVoteDelegation(scope());
    const withCaveat = (i: number, patch: Partial<Delegation['caveats'][number]>) => ({
      ...delegation,
      caveats: delegation.caveats.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    });
    const T = (fn: () => unknown, re: RegExp) => expect(fn).toThrow(re);

    // unknown enforcer
    T(
      () =>
        decodeVoteDelegation(
          withCaveat(0, { enforcer: '0x3333333333333333333333333333333333333333' }),
        ),
      /unknown enforcer/,
    );
    // non-root authority (multi-hop)
    T(
      () => decodeVoteDelegation({ ...delegation, authority: `0x${'00'.repeat(32)}` }),
      /ROOT_AUTHORITY/,
    );
    // two targets
    T(
      () =>
        decodeVoteDelegation(
          withCaveat(0, {
            terms: `${GOVERNORS.nouns.address}${GOVERNORS.lilNouns.address.slice(2)}` as Hex,
          }),
        ),
      /exactly one address/,
    );
    // unknown target
    T(() => decodeVoteDelegation(withCaveat(0, { terms: RELAYER })), /not a known governor/);
    // ERC20 transfer selector smuggled in
    T(
      () => decodeVoteDelegation(withCaveat(1, { terms: '0x8f1447d9a9059cbb' })),
      /not a vote function/,
    );
    // lil selectors against nouns governor
    T(() => decodeVoteDelegation(withCaveat(1, { terms: '0x44fac8f6' })), /not a vote function/);
    // non-zero value
    T(
      () => decodeVoteDelegation(withCaveat(2, { terms: `0x${'0'.repeat(63)}1` })),
      /ValueLte must be 0/,
    );
    // redeemer != delegate
    T(() => decodeVoteDelegation(withCaveat(3, { terms: VOTER })), /Redeemer must equal delegate/);
    // no expiry
    T(() => decodeVoteDelegation(withCaveat(4, { terms: encodeTimestampTerms(NOW, 0) })), /expiry/);
    // missing required caveat
    T(
      () => decodeVoteDelegation({ ...delegation, caveats: delegation.caveats.slice(1) }),
      /missing required allowedTargets/,
    );
    // duplicate caveat
    T(
      () =>
        decodeVoteDelegation({
          ...delegation,
          caveats: [...delegation.caveats, delegation.caveats[0] as Delegation['caveats'][number]],
        }),
      /duplicate/,
    );
    // error class
    expect(() => decodeVoteDelegation({ ...delegation, caveats: [] })).toThrow(
      InvalidVoteDelegationError,
    );
  });

  it('supports a custom governor registry', () => {
    const custom: Address = '0x4444444444444444444444444444444444444444';
    const { delegation } = buildVoteDelegation(scope({ governor: custom, governorKind: 'nouns' }));
    expect(() => decodeVoteDelegation(delegation)).toThrow(/not a known governor/);
    const decoded = decodeVoteDelegation(delegation, {
      governors: [{ chainId: 1, address: custom, kind: 'nouns', clientIdParam: true }],
    });
    expect(decoded.governor).toBe(custom);
  });
});

describe('buildRedeemVoteCall', () => {
  const signed = (): Delegation => ({
    ...buildVoteDelegation(scope()).delegation,
    signature: `0x${'ab'.repeat(65)}`,
  });

  it('encodes redeemDelegations with single-call default mode and castRefundableVoteWithReason + clientId', () => {
    const delegation = signed();
    const call = buildRedeemVoteCall({
      delegation,
      governorKind: 'nouns',
      governor: GOVERNORS.nouns.address,
      proposalId: 987n,
      support: 1,
      reason: 'gm',
    });
    expect(call.to).toBe(FRAMEWORK.delegationManager);
    expect(call.value).toBe(0n);

    const outer = decodeFunctionData({ abi: ABIS.delegationManager, data: call.data });
    expect(outer.functionName).toBe('redeemDelegations');
    const [contexts, modes, executions] = outer.args as readonly [
      readonly Hex[],
      readonly Hex[],
      readonly Hex[],
    ];
    expect(contexts).toHaveLength(1);
    expect(modes).toEqual([MODE_SINGLE_DEFAULT]);
    expect(executions).toHaveLength(1);

    // permission context decodes back to [delegation]
    const [decodedDelegations] = decodeAbiParameters(DELEGATION_ARRAY_PARAMS, contexts[0] as Hex);
    expect(decodedDelegations).toHaveLength(1);
    expect(decodedDelegations[0]?.delegator).toBe(VOTER);
    expect(decodedDelegations[0]?.signature).toBe(delegation.signature);
    expect(decodedDelegations[0]?.salt).toBe(1n);
    expect(decodedDelegations[0]?.caveats).toHaveLength(5);

    // execution = target(20) || value(32) || calldata
    const exec = executions[0] as Hex;
    expect(exec.slice(0, 42).toLowerCase()).toBe(GOVERNORS.nouns.address.toLowerCase());
    expect(exec.slice(42, 42 + 64)).toBe('0'.repeat(64));
    const inner = decodeFunctionData({
      abi: ABIS.nounsGovernorVotes,
      data: `0x${exec.slice(42 + 64)}` as Hex,
    });
    expect(inner.functionName).toBe('castRefundableVoteWithReason');
    expect(inner.args).toEqual([987n, 1, 'gm', 37]);
  });

  it('uses castRefundableVote (no reason) and omits clientId for lil', () => {
    const call = buildRedeemVoteCall({
      delegation: signed(),
      governorKind: 'lil',
      governor: GOVERNORS.lilNouns.address,
      proposalId: 388n,
      support: 0,
      reason: '',
    });
    const outer = decodeFunctionData({ abi: ABIS.delegationManager, data: call.data });
    const executions = outer.args?.[2] as readonly Hex[];
    const exec = executions[0] as Hex;
    const inner = decodeFunctionData({
      abi: ABIS.lilNounsGovernorVotes,
      data: `0x${exec.slice(42 + 64)}` as Hex,
    });
    expect(inner.functionName).toBe('castRefundableVote');
    expect(inner.args).toEqual([388n, 0]);
    expect(exec.slice(42 + 64, 42 + 64 + 8)).toBe('44fac8f6');
  });

  it('rejects invalid support', () => {
    expect(() =>
      buildRedeemVoteCall({
        delegation: signed(),
        governorKind: 'nouns',
        governor: GOVERNORS.nouns.address,
        proposalId: 1n,
        support: 3 as 0,
      }),
    ).toThrow(/support/);
  });
});

describe('revoke', () => {
  it('encodes disableDelegation with the same struct the hash was computed over', () => {
    const { delegation } = buildVoteDelegation(scope());
    const call = buildRevokeCall(delegation);
    expect(call.to).toBe(FRAMEWORK.delegationManager);
    const decoded = decodeFunctionData({ abi: ABIS.delegationManager, data: call.data });
    expect(decoded.functionName).toBe('disableDelegation');
    const arg = decoded.args?.[0] as Delegation;
    expect(arg.signature).toBe('0x');
    expect(getDelegationHash(arg)).toBe(getDelegationHash(delegation));

    const read = decodeFunctionData({
      abi: ABIS.delegationManager,
      data: buildIsRevokedCall(delegation).data,
    });
    expect(read.functionName).toBe('disabledDelegations');
    expect(read.args?.[0]).toBe(getDelegationHash(delegation));
  });
});

describe('parse7702Code', () => {
  it('recognises the MetaMask delegator designation', () => {
    const none = { isDelegated: false, implementation: null, isMetaMaskDelegator: false };
    expect(parse7702Code(undefined)).toEqual(none);
    expect(parse7702Code('0x')).toEqual(none);
    expect(parse7702Code('0x6080604052')).toEqual(none);
    expect(parse7702Code(make7702Code())).toEqual({
      isDelegated: true,
      implementation: FRAMEWORK.metamask7702Delegator,
      isMetaMaskDelegator: true,
    });
    expect(parse7702Code(`0xef0100${'11'.repeat(20)}`)).toEqual({
      isDelegated: true,
      implementation: RELAYER,
      isMetaMaskDelegator: false,
    });
  });
});

describe('serialize', () => {
  it('round-trips bigints and tolerates decimal salts', () => {
    const { delegation } = buildVoteDelegation(scope({ salt: 2n ** 200n + 5n, nonce: 9n }));
    const signed: Delegation = { ...delegation, signature: '0xabcdef' };
    const json = serializeDelegation(signed);
    expect(() => JSON.parse(json)).not.toThrow();
    const back = deserializeDelegation(json);
    expect(back).toEqual(signed);
    expect(getDelegationHash(back)).toBe(getDelegationHash(signed));
    expect(decodeVoteDelegation(back).nonce).toBe(9n);

    const decimal = JSON.parse(json) as { salt: string };
    decimal.salt = (2n ** 200n + 5n).toString(10);
    expect(deserializeDelegation(decimal).salt).toBe(2n ** 200n + 5n);
    expect(() => deserializeDelegation('{"delegate":"nope"}')).toThrow();
  });
});
