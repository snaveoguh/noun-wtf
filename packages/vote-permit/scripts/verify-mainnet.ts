/**
 * Read-only mainnet verification for @nouns/vote-permit.
 *
 *   pnpm -F @nouns/vote-permit verify:mainnet
 *   RPC_URL=https://... pnpm -F @nouns/vote-permit verify:mainnet
 *
 * Sends only eth_call / eth_getCode / eth_getStorageAt. Never broadcasts. Uses throwaway keys.
 */
import {
  createPublicClient,
  decodeErrorResult,
  fallback,
  hashDomain,
  http,
  parseAbi,
  toHex,
  type Address,
  type Hex,
  type StateOverride,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

import {
  ABIS,
  buildRedeemVoteCall,
  buildVoteDelegation,
  delegationDomain,
  FRAMEWORK,
  getDelegationHash,
  GOVERNORS,
  make7702Code,
  parse7702Code,
  VOTE_SELECTORS,
  type Delegation,
  type GovernorKind,
} from '../src/index.js';

const RPCS = process.env.RPC_URL
  ? [process.env.RPC_URL]
  : [
      'https://ethereum-rpc.publicnode.com',
      'https://eth.drpc.org',
      'https://1rpc.io/eth',
      'https://eth.merkle.io',
    ];

const LIL_PROPOSAL_ID = BigInt(process.env.LIL_PROPOSAL_ID ?? '388'); // ACTIVE as of 2026-09-03
const NONEXISTENT_PROPOSAL_ID = 10_000_000n;

const client = createPublicClient({
  chain: mainnet,
  transport: fallback(
    RPCS.map(u => http(u, { timeout: 20_000 })),
    { rank: false },
  ),
});

const REVERT_ABI = [...ABIS.delegationManager, ...ABIS.deleGatorErrors] as const;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

type RevertInfo =
  | { kind: 'success'; data: Hex }
  | { kind: 'revert'; data: Hex | null; decoded: string; raw: string };

function extractRevertData(err: unknown): Hex | null {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur);
    const o = cur as Record<string, unknown>;
    const d = o.data;
    if (typeof d === 'string' && d.startsWith('0x')) return d as Hex;
    if (d && typeof d === 'object') {
      const dd = (d as Record<string, unknown>).data;
      if (typeof dd === 'string' && dd.startsWith('0x')) return dd as Hex;
    }
    cur = o.cause;
  }
  return null;
}

function decodeRevert(data: Hex | null): string {
  if (!data || data === '0x') return 'empty revert data';
  try {
    const d = decodeErrorResult({ abi: REVERT_ABI, data });
    return `${d.errorName}(${(d.args ?? []).map(a => String(a)).join(', ')})`;
  } catch {
    return `unknown selector ${data.slice(0, 10)} (${(data.length - 2) / 2} bytes)`;
  }
}

async function simulate(
  from: Address,
  call: { to: Address; data: Hex },
  stateOverride?: StateOverride,
): Promise<RevertInfo> {
  try {
    const res = await client.call({ account: from, to: call.to, data: call.data, stateOverride });
    return { kind: 'success', data: res.data ?? '0x' };
  } catch (err) {
    const data = extractRevertData(err);
    const raw = err instanceof Error ? (err.message.split('\n')[0] ?? '') : String(err);
    return { kind: 'revert', data, decoded: decodeRevert(data), raw };
  }
}

function show(r: RevertInfo): string {
  return r.kind === 'success' ? `SUCCESS returndata=${r.data}` : `REVERT ${r.decoded}`;
}

async function implementationOf(proxy: Address): Promise<Address | null> {
  const slot = await client.getStorageAt({
    address: proxy,
    slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
  });
  if (slot && BigInt(slot) !== 0n) return `0x${slot.slice(-40)}` as Address;
  try {
    return await client.readContract({
      address: proxy,
      abi: parseAbi(['function implementation() view returns (address)']),
      functionName: 'implementation',
    });
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log(`RPC candidates: ${RPCS.join(', ')}`);
  console.log(`block ${await client.getBlockNumber()}\n`);

  // ------------------------------------------------------------ (b) deployments
  console.log('== (b) deployments ==');
  const deployments: [string, Address][] = [
    ['DelegationManager', FRAMEWORK.delegationManager],
    ['EIP7702StatelessDeleGator', FRAMEWORK.metamask7702Delegator],
    ...(Object.entries(FRAMEWORK.enforcers) as [string, Address][]),
  ];
  for (const [name, addr] of deployments) {
    const code = await client.getCode({ address: addr });
    check(
      `code at ${name} ${addr}`,
      !!code && code !== '0x',
      `${code ? (code.length - 2) / 2 : 0} bytes`,
    );
  }
  const versionAbi = parseAbi([
    'function VERSION() view returns (string)',
    'function NAME() view returns (string)',
    'function ROOT_AUTHORITY() view returns (bytes32)',
  ]);
  const [version, name, root, domainHash] = await Promise.all([
    client.readContract({
      address: FRAMEWORK.delegationManager,
      abi: versionAbi,
      functionName: 'VERSION',
    }),
    client.readContract({
      address: FRAMEWORK.delegationManager,
      abi: versionAbi,
      functionName: 'NAME',
    }),
    client.readContract({
      address: FRAMEWORK.delegationManager,
      abi: versionAbi,
      functionName: 'ROOT_AUTHORITY',
    }),
    client.readContract({
      address: FRAMEWORK.delegationManager,
      abi: ABIS.delegationManager,
      functionName: 'getDomainHash',
    }),
  ]);
  check('DelegationManager.VERSION == 1.3.0', version === FRAMEWORK.version, version);
  check('DelegationManager.NAME == DelegationManager', name === 'DelegationManager', name);
  check('ROOT_AUTHORITY matches', root.toLowerCase() === FRAMEWORK.rootAuthority, root);
  const localDomain = hashDomain({
    domain: delegationDomain(1),
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
    },
  });
  check('EIP-712 domain separator matches getDomainHash()', domainHash === localDomain, domainHash);
  const implVersion = await client.readContract({
    address: FRAMEWORK.metamask7702Delegator,
    abi: versionAbi,
    functionName: 'VERSION',
  });
  check('EIP7702StatelessDeleGator.VERSION == 1.3.0', implVersion === '1.3.0', implVersion);

  // ------------------------------------------------------------ selectors vs governor bytecode
  console.log('\n== governor selectors present in implementation bytecode ==');
  for (const [kind, gov] of [
    ['nouns', GOVERNORS.nouns.address],
    ['lil', GOVERNORS.lilNouns.address],
  ] as [GovernorKind, Address][]) {
    const impl = await implementationOf(gov);
    check(`${kind} governor implementation resolved`, !!impl, impl ?? 'none');
    if (!impl) continue;
    const code = (await client.getCode({ address: impl })) ?? '0x';
    for (const sel of VOTE_SELECTORS[kind]) {
      check(
        `${kind} bytecode contains selector ${sel}`,
        code.toLowerCase().includes(sel.slice(2).toLowerCase()),
        impl,
      );
    }
    // negative control: the other kind's unique selectors must NOT match
    const other: GovernorKind = kind === 'nouns' ? 'lil' : 'nouns';
    for (const sel of VOTE_SELECTORS[other]) {
      const present = code.toLowerCase().includes(sel.slice(2).toLowerCase());
      console.log(
        `      info: ${kind} bytecode ${present ? 'ALSO contains' : 'does not contain'} ${other} selector ${sel}`,
      );
    }
  }

  // ------------------------------------------------------------ (a) hash equality
  console.log('\n== (a) getDelegationHash parity ==');
  const now = Math.floor(Date.now() / 1000);
  const voter = privateKeyToAccount(generatePrivateKey());
  const relayer = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  console.log(`throwaway voter   ${voter.address}`);
  console.log(`throwaway relayer ${relayer.address}`);

  const samples = [
    buildVoteDelegation({
      chainId: 1,
      governor: GOVERNORS.nouns.address,
      governorKind: 'nouns',
      delegator: voter.address,
      redeemer: relayer.address,
      expiresAt: now + 7 * 86_400,
      notBefore: now - 60,
      maxVotes: 3,
      nonce: 0n,
      salt: 12_345n,
    }),
    buildVoteDelegation({
      chainId: 1,
      governor: GOVERNORS.lilNouns.address,
      governorKind: 'lil',
      delegator: voter.address,
      redeemer: relayer.address,
      expiresAt: now + 7 * 86_400,
      salt: 0n,
    }),
  ];
  for (const [i, s] of samples.entries()) {
    const onchain = await client.readContract({
      address: FRAMEWORK.delegationManager,
      abi: ABIS.delegationManager,
      functionName: 'getDelegationHash',
      args: [{ ...s.delegation, signature: '0x' }],
    });
    const local = getDelegationHash(s.delegation);
    check(
      `sample ${i} (${s.summary.governorKind}, ${s.delegation.caveats.length} caveats) hash parity`,
      onchain === local,
      local,
    );
  }

  // ------------------------------------------------------------ (c) EOA delegator, no code
  console.log('\n== (c) redeem simulation, plain EOA delegator (no code) ==');
  const lil = samples[1]!;
  const signature = await voter.signTypedData(lil.typedData);
  const signed: Delegation = { ...lil.delegation, signature };
  const voterCode = await client.getCode({ address: voter.address });
  check('throwaway voter has no code', !voterCode || voterCode === '0x');
  check('parse7702Code(voter) → not delegated', !parse7702Code(voterCode).isDelegated);

  const redeem = buildRedeemVoteCall({
    delegation: signed,
    governorKind: 'lil',
    governor: GOVERNORS.lilNouns.address,
    proposalId: LIL_PROPOSAL_ID,
    support: 2,
  });

  const base = await simulate(relayer.address, redeem);
  console.log(`      base call: ${show(base)}`);
  check(
    'valid sig + caveats → fails only at executeFromExecutor (empty revert: EOA has no code)',
    base.kind === 'revert' && (!base.data || base.data === '0x'),
    base.kind === 'revert' ? base.decoded : 'unexpected success',
  );

  // negative controls prove where the failure sits
  const badSig: Delegation = {
    ...signed,
    signature: (signature.slice(0, -2) + (signature.endsWith('1b') ? '1c' : '1b')) as Hex,
  };
  const r1 = await simulate(
    relayer.address,
    buildRedeemVoteCall({
      ...redeem,
      delegation: badSig,
      governorKind: 'lil',
      governor: GOVERNORS.lilNouns.address,
      proposalId: LIL_PROPOSAL_ID,
      support: 2,
    }),
  );
  check(
    'control: tampered signature → InvalidEOASignature',
    r1.kind === 'revert' && r1.decoded.startsWith('InvalidEOASignature'),
    show(r1),
  );

  const r2 = await simulate(other.address, redeem);
  check(
    'control: wrong msg.sender → InvalidDelegate (delegate check precedes enforcers)',
    r2.kind === 'revert' && r2.decoded.startsWith('InvalidDelegate'),
    show(r2),
  );

  const wrongTarget = buildRedeemVoteCall({
    delegation: signed,
    governorKind: 'nouns',
    governor: GOVERNORS.nouns.address,
    proposalId: 1n,
    support: 2,
  });
  const r3 = await simulate(relayer.address, wrongTarget);
  check(
    'control: wrong target → AllowedTargetsEnforcer revert',
    r3.kind === 'revert' &&
      r3.decoded.includes('AllowedTargetsEnforcer:target-address-not-allowed'),
    show(r3),
  );

  const expired = buildVoteDelegation({
    chainId: 1,
    governor: GOVERNORS.lilNouns.address,
    governorKind: 'lil',
    delegator: voter.address,
    redeemer: relayer.address,
    expiresAt: now - 3600,
    salt: 7n,
  });
  const expiredSigned: Delegation = {
    ...expired.delegation,
    signature: await voter.signTypedData(expired.typedData),
  };
  const r4 = await simulate(
    relayer.address,
    buildRedeemVoteCall({
      delegation: expiredSigned,
      governorKind: 'lil',
      governor: GOVERNORS.lilNouns.address,
      proposalId: LIL_PROPOSAL_ID,
      support: 2,
    }),
  );
  check(
    'control: expired → TimestampEnforcer:expired-delegation',
    r4.kind === 'revert' && r4.decoded.includes('TimestampEnforcer:expired-delegation'),
    show(r4),
  );

  // a delegation with a Redeemer caveat naming someone else, but delegate == relayer, isolates the RedeemerEnforcer
  const redeemerMismatch: Delegation = {
    ...signed,
    caveats: signed.caveats.map(c =>
      c.enforcer.toLowerCase() === FRAMEWORK.enforcers.redeemer.toLowerCase()
        ? { ...c, terms: other.address.toLowerCase() as Hex }
        : c,
    ),
  };
  const mismatchSigned: Delegation = {
    ...redeemerMismatch,
    signature: await voter.signTypedData({
      ...lil.typedData,
      message: {
        ...lil.typedData.message,
        caveats: redeemerMismatch.caveats.map(c => ({ enforcer: c.enforcer, terms: c.terms })),
      },
    }),
  };
  const r5 = await simulate(
    relayer.address,
    buildRedeemVoteCall({
      delegation: mismatchSigned,
      governorKind: 'lil',
      governor: GOVERNORS.lilNouns.address,
      proposalId: LIL_PROPOSAL_ID,
      support: 2,
    }),
  );
  check(
    'control: Redeemer caveat ≠ caller → RedeemerEnforcer:unauthorized-redeemer',
    r5.kind === 'revert' && r5.decoded.includes('RedeemerEnforcer:unauthorized-redeemer'),
    show(r5),
  );

  // ------------------------------------------------------------ (d) state override: EOA carries 7702 code
  console.log('\n== (d) redeem simulation with EIP-7702 code override on the voter ==');
  const override: StateOverride = [{ address: voter.address, code: make7702Code() }];
  check(
    'parse7702Code(make7702Code()) → MetaMask delegator',
    parse7702Code(make7702Code()).isMetaMaskDelegator,
  );

  const d0 = await simulate(relayer.address, redeem, override);
  console.log(
    `      active lil proposal #${LIL_PROPOSAL_ID}, support=2, voter holds 0 votes: ${show(d0)}`,
  );
  if (d0.kind === 'revert' && d0.raw && !d0.data) {
    console.log(`      raw: ${d0.raw}`);
  }

  const nonexistent = buildRedeemVoteCall({
    delegation: signed,
    governorKind: 'lil',
    governor: GOVERNORS.lilNouns.address,
    proposalId: NONEXISTENT_PROPOSAL_ID,
    support: 2,
  });
  const d1 = await simulate(relayer.address, nonexistent, override);
  console.log(`      nonexistent lil proposal #${NONEXISTENT_PROPOSAL_ID}: ${show(d1)}`);
  const reachedGovernor =
    d1.kind === 'revert' &&
    (d1.decoded.includes('invalid proposal id') || d1.decoded.includes('NounsDAO'));
  const overridesRejected =
    d1.kind === 'revert' &&
    (!d1.data || d1.data === '0x') &&
    /override|not supported|invalid argument/i.test(d1.raw);
  if (overridesRejected) {
    console.log(`      NOTE: this RPC appears to reject state overrides: ${d1.raw}`);
  }
  check(
    'state-override call reaches the governor (governor-level revert for a nonexistent proposal)',
    reachedGovernor,
    d1.kind === 'revert' ? `${d1.decoded} | ${d1.raw}` : 'unexpected success',
  );
  check(
    'active proposal call ends at governor level (success or governor revert), not at framework level',
    d0.kind === 'success' ||
      (d0.kind === 'revert' &&
        (d0.decoded.includes('NounsDAO') || d0.decoded.includes('invalid proposal id'))),
    show(d0),
  );

  // same thing on the Nouns governor for completeness
  const nounsSample = samples[0]!;
  const nounsSigned: Delegation = {
    ...nounsSample.delegation,
    signature: await voter.signTypedData(nounsSample.typedData),
  };
  const d2 = await simulate(
    relayer.address,
    buildRedeemVoteCall({
      delegation: nounsSigned,
      governorKind: 'nouns',
      governor: GOVERNORS.nouns.address,
      proposalId: NONEXISTENT_PROPOSAL_ID,
      support: 1,
      reason: 'svp verify',
    }),
    override,
  );
  console.log(`      nouns governor, nonexistent proposal, with reason + clientId=37: ${show(d2)}`);
  check(
    'nouns path reaches the governor too',
    d2.kind === 'revert' &&
      (d2.decoded.includes('invalid proposal id') ||
        d2.decoded.includes('NounsDAO') ||
        d2.decoded.includes('unknown selector')),
    d2.kind === 'revert' ? d2.decoded : 'unexpected success',
  );

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  console.log(
    `(sample delegation hash for the record: ${getDelegationHash(signed)}, salt ${toHex(signed.salt)})`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
