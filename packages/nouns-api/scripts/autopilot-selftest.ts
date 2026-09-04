/**
 * Autopilot self-test — no keys, no Postgres, no sends.
 *
 *   AUTOPILOT_DRY_RUN=1 npx tsx packages/nouns-api/scripts/autopilot-selftest.ts
 *
 * 1. builds + signs a scoped vote delegation for a throwaway account → the
 *    noun.wtf relayer, and pushes it through `validateDelegationSubmission`
 *    (the exact function the POST /delegations route calls) — plus a set of
 *    negative cases that must be rejected
 * 2. stores it in the in-memory store (DATABASE_URL unset) with a stub 'auto'
 *    prefs record + a stub recommendation, and runs the relayer sweep in
 *    dry-run mode against the LIVE Lil Nouns active proposal(s)
 * 3. simulates the redeem call directly from the relayer address and prints
 *    the decoded result (expected to revert for a throwaway EOA: it carries no
 *    EIP-7702 code, so the DelegationManager's call into it fails — that
 *    proves the path up to the delegator boundary)
 */
import {
  buildVoteDelegation,
  getDelegationHash,
  GOVERNORS,
  serializeDelegation,
  type Delegation,
} from '@nouns/vote-permit';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { validateDelegationSubmission } from '../src/agent/autopilotDelegations.js';
import {
  listLilActiveProposals,
  readProposalState,
  readReceipt,
} from '../src/agent/autopilotGov.js';
import { parsePrefs, type AutopilotRecord } from '../src/agent/autopilotPrefs.js';
import {
  getRelayerAddress,
  registerAutopilotProviders,
  runSweep,
  simulateVote,
} from '../src/agent/autopilotRelayer.js';
import { insertDelegation, listVotes, storeBackend } from '../src/agent/autopilotStore.js';

process.env.AUTOPILOT_DRY_RUN = '1';
if (process.env.DATABASE_URL) {
  console.error('Refusing to run against a real DATABASE_URL — unset it.');
  process.exit(1);
}

const hr = (t: string) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 70 - t.length))}`);
const j = (x: unknown) =>
  JSON.stringify(x, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2);

async function main() {
  const relayer = getRelayerAddress();
  const { getReadClient } = await import('../src/agent/autopilotGov.js');
  const client = getReadClient();
  console.log(`store backend: ${storeBackend()} | relayer: ${relayer} | dry-run: yes`);

  // ── 1. build + sign a delegation for a throwaway account ─────────────────
  hr('1. build + validate delegation');
  const pk = generatePrivateKey();
  const voter = privateKeyToAccount(pk);
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 86400;
  const {
    delegation: unsigned,
    typedData,
    summary,
  } = buildVoteDelegation({
    chainId: 1,
    governor: GOVERNORS.lilNouns.address,
    governorKind: 'lil',
    delegator: voter.address,
    redeemer: relayer,
    expiresAt,
    maxVotes: 3,
  });
  const signature = await voter.signTypedData(typedData);
  const delegation: Delegation = { ...unsigned, signature };
  const serialized = serializeDelegation(delegation);
  console.log('throwaway voter:', voter.address);
  console.log('scope summary:', j(summary));
  console.log('delegation hash:', getDelegationHash(delegation));

  const ok = await validateDelegationSubmission({
    address: voter.address.toLowerCase(),
    dao: 'lil-nouns',
    delegation: serialized,
    relayer,
    client,
  });
  console.log('validate(valid):', ok.ok ? `OK via ${ok.signatureMethod}` : `REJECTED ${ok.error}`);
  if (!ok.ok) throw new Error('valid delegation was rejected');

  const negatives: Array<[string, Parameters<typeof validateDelegationSubmission>[0]]> = [
    [
      'wrong dao',
      { address: voter.address, dao: 'nouns', delegation: serialized, relayer, client },
    ],
    [
      'wrong address',
      { address: relayer, dao: 'lil-nouns', delegation: serialized, relayer, client },
    ],
    [
      'wrong redeemer',
      {
        address: voter.address,
        dao: 'lil-nouns',
        delegation: serialized,
        relayer: voter.address,
        client,
      },
    ],
    [
      'tampered signature',
      {
        address: voter.address,
        dao: 'lil-nouns',
        delegation: serializeDelegation({ ...delegation, salt: delegation.salt + 1n }),
        relayer,
        client,
      },
    ],
    [
      'unsigned',
      {
        address: voter.address,
        dao: 'lil-nouns',
        delegation: serializeDelegation({ ...delegation, signature: '0x' }),
        relayer,
        client,
      },
    ],
    [
      'foreign caveat',
      {
        address: voter.address,
        dao: 'lil-nouns',
        delegation: serializeDelegation({
          ...delegation,
          caveats: [
            ...delegation.caveats,
            { enforcer: '0x000000000000000000000000000000000000dEaD', terms: '0x', args: '0x' },
          ],
        }),
        relayer,
        client,
      },
    ],
    [
      'garbage',
      { address: voter.address, dao: 'lil-nouns', delegation: '{"nope":1}', relayer, client },
    ],
  ];
  for (const [label, args] of negatives) {
    const r = await validateDelegationSubmission(args);
    console.log(
      `validate(${label}):`,
      r.ok ? 'ACCEPTED (BUG)' : `rejected ${r.status} — ${r.error}`,
    );
    if (r.ok) throw new Error(`negative case "${label}" was accepted`);
  }

  // ── 2. store it + run the sweep in dry-run against live Lil proposals ────
  hr('2. sweep (dry-run) against live Lil Nouns proposals');
  const row = await insertDelegation(ok.row);
  console.log('stored delegation row:', row.id, 'expires', new Date(row.expiresAt).toISOString());

  const prefs = parsePrefs({
    philosophy: 'self-test: abstain on everything',
    mode: 'auto',
    daos: ['lil-nouns'],
    minConfidence: 0.6,
    autoVoteDelayHours: 0,
    voteReasonStyle: 'short',
  });
  if ('error' in prefs) throw new Error(prefs.error);
  const record: AutopilotRecord = {
    enabled: true,
    prefs: prefs.prefs,
    prefsHash: 'selftest',
    updatedAt: Date.now(),
    lastNonce: 0,
  };
  registerAutopilotProviders({
    readAutopilot: async () => record,
    recommend: async (_address, _record, proposal) => ({
      dao: proposal.dao,
      proposalId: proposal.id,
      title: proposal.title,
      support: 2,
      confidence: 0.9,
      reason: 'self-test abstain',
      generatedAt: Date.now(),
      model: 'stub',
    }),
  });

  const active = await listLilActiveProposals(client, { fresh: true });
  console.log(
    `live Lil active proposals: ${active.length}`,
    active.map(
      p => `#${p.id} "${p.title}" blocks ${p.startBlock}-${p.endBlock} snapshot ${p.snapshotBlock}`,
    ),
  );
  for (const p of active) {
    console.log(
      `  #${p.id} on-chain state=${await readProposalState('lil-nouns', p.id, client)} relayer receipt=${j(
        await readReceipt('lil-nouns', p.id, relayer, client),
      )}`,
    );
  }

  const report = await runSweep({ trigger: 'selftest', dryRun: true, addresses: [voter.address] });
  console.log('sweep report:', j(report));
  console.log('vote rows:', j(await listVotes(voter.address)));

  // ── 3. direct simulation from the relayer ───────────────────────────────
  hr('3. direct redeem simulation (expected to revert: throwaway EOA has no 7702 code)');
  if (active.length === 0) {
    console.log('no active Lil proposal — skipping simulation');
  } else {
    const target = active[0]!;
    for (const reason of ['', 'self-test abstain']) {
      const sim = await simulateVote({
        delegation,
        dao: 'lil-nouns',
        proposalId: target.id,
        support: 2,
        reason,
      });
      console.log(
        `simulate(#${target.id}, abstain${reason ? ', with reason' : ''}): ok=${sim.ok} gas=${sim.gas ?? '-'} to=${sim.to} calldata=${sim.data.length / 2 - 1} bytes`,
      );
      if (sim.error) console.log('  →', sim.error);
    }
  }
  hr('done');
}

main().catch(err => {
  console.error('SELFTEST FAILED:', err);
  process.exit(1);
});
