// Opens a GitHub issue for every live NounV2 treasury proposal that doesn't
// have one yet, so the repo owner (and anyone @-mentioned) gets emailed.
//
// Why: V2 prop 4 (2026-10-21) tried to send the whole treasury to its
// proposer, who had bought Noun 95 for 50 wei. NounV2Treasury has no quorum,
// so 1 FOR / 0 AGAINST passes. The Ponder indexer had silently stalled, so
// the noun.wtf feed never showed it; the admin Safe cancelled it with ~10h
// to spare. This runs on GitHub, independent of Railway and the indexer.
//
// Stateless: dedupes on issue titles ("[V2 Prop #N] ..."), so a missed run
// just catches up on the next one. Env:
//   GITHUB_TOKEN, GITHUB_REPOSITORY  (provided by Actions)
//   ALERT_MENTIONS                   e.g. "@snaveoguh @someone"
//   DRY_RUN=1                        print instead of opening issues
//   FORCE_IDS=4,5                    treat these ids as live (testing)

import { createPublicClient, fallback, formatEther, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';

const TREASURY = '0x2cdeb0d251674710840d9fa990d1de138dfe7c00';
const ADMIN_SAFE = '0xADa31Add8450CA0422983B9a3103633b78938617';
const STATES = ['Active', 'Canceled', 'Defeated', 'Succeeded', 'Queued', 'Expired', 'Executed'];
const LIVE = new Set(['Active', 'Succeeded', 'Queued']);
const SCAN_LAST = 25;

const treasuryAbi = parseAbi([
  'function proposalCount() view returns (uint256)',
  'function state(uint256) view returns (uint8)',
  'function proposals(uint256) view returns (address proposer, uint256 snapshotBlock, uint256 startBlock, uint256 endBlock, uint256 eta, uint256 forVotes, uint256 againstVotes, uint256 abstainVotes, bool canceled, bool executed, bool queued)',
  'function getActions(uint256) view returns (address[] targets, uint256[] values, string[] signatures, bytes[] calldatas)',
  'function getDescription(uint256) view returns (string)',
  'function nounsToken() view returns (address)',
  'function TIMELOCK_DELAY() view returns (uint256)',
]);
const tokenAbi = parseAbi([
  'function getPriorVotes(address, uint256) view returns (uint96)',
  'function totalSupply() view returns (uint256)',
]);

// Same RPC set the indexer trusts for reads, publicnode first.
const client = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http('https://ethereum-rpc.publicnode.com'),
    http('https://gateway.tenderly.co/public/mainnet'),
    http('https://rpc.mevblocker.io'),
  ]),
});

const { GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;
const DRY_RUN = process.env.DRY_RUN === '1';
const MENTIONS = (process.env.ALERT_MENTIONS ?? '').trim();
const FORCE_IDS = new Set(
  (process.env.FORCE_IDS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
);

async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok)
    throw new Error(`GitHub ${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function alertedIds() {
  const ids = new Set();
  if (DRY_RUN && !GITHUB_TOKEN) return ids;
  for (let page = 1; page <= 5; page++) {
    const issues = await gh(
      `/issues?state=all&per_page=100&page=${page}&sort=created&direction=desc`,
    );
    for (const issue of issues) {
      const m = /^\[V2 Prop #(\d+)\]/.exec(issue.title);
      if (m) ids.add(m[1]);
    }
    if (issues.length < 100) break;
  }
  return ids;
}

const eth = wei =>
  `${Number(formatEther(wei)).toLocaleString('en-US', { maximumFractionDigits: 6 })} ETH`;
const short = a => `${a.slice(0, 6)}…${a.slice(-4)}`;
const addrLink = a => `[\`${short(a)}\`](https://etherscan.io/address/${a})`;
function inHours(seconds) {
  if (seconds <= 0) return 'now';
  const h = seconds / 3600;
  return h >= 1 ? `in ~${h.toFixed(1)}h` : `in ~${Math.round(seconds / 60)}m`;
}

async function describe(id, head, ctx) {
  const [stateIdx, p, actions, description] = await Promise.all([
    client.readContract({ address: TREASURY, abi: treasuryAbi, functionName: 'state', args: [id] }),
    client.readContract({
      address: TREASURY,
      abi: treasuryAbi,
      functionName: 'proposals',
      args: [id],
    }),
    client.readContract({
      address: TREASURY,
      abi: treasuryAbi,
      functionName: 'getActions',
      args: [id],
    }),
    client.readContract({
      address: TREASURY,
      abi: treasuryAbi,
      functionName: 'getDescription',
      args: [id],
    }),
  ]);
  const [proposer, snapshotBlock, , endBlock, eta, forVotes, againstVotes, abstainVotes] = p;
  const [targets, values, signatures, calldatas] = actions;
  const state = STATES[stateIdx] ?? `state ${stateIdx}`;
  const proposerVotes = await client.readContract({
    address: ctx.token,
    abi: tokenAbi,
    functionName: 'getPriorVotes',
    args: [proposer, snapshotBlock],
  });

  const requested = values.reduce((sum, v) => sum + v, 0n);
  const share = ctx.balance > 0n ? Number((requested * 10_000n) / ctx.balance) / 100 : 0;
  const callsTreasury = targets.some(t => t.toLowerCase() === TREASURY.toLowerCase());
  const setsAdmin = signatures.some(s => s.startsWith('setAdmin'));

  const flags = [];
  if (requested > 0n && share >= 50) flags.push(`asks for **${share}%** of the treasury`);
  if (proposerVotes < 3n) flags.push(`proposer held only **${proposerVotes}** vote(s) at snapshot`);
  if (setsAdmin) flags.push('calls **setAdmin** (admin takeover)');
  else if (callsTreasury) flags.push('calls the treasury contract itself');
  if (againstVotes === 0n && forVotes > 0n && forVotes < 3n)
    flags.push(`passing on **${forVotes}** FOR vote(s) — there is no quorum`);

  const nowTs = Number(head.timestamp);
  let deadline;
  if (state === 'Active') {
    const secs = (Number(endBlock) - Number(head.number)) * 12;
    deadline = `Voting ends at block ${endBlock} (${inHours(secs)}). Voting AGAINST before then defeats it; after that only a cancel can stop it.`;
  } else if (state === 'Succeeded') {
    deadline = `Passed, not queued yet. Once queued it can execute ${Number(ctx.timelockDelay) / 3600}h later.`;
  } else if (state === 'Queued') {
    deadline = `**Anyone can execute it ${inHours(Number(eta) - nowTs)}** (${new Date(Number(eta) * 1000).toISOString()}).`;
  } else {
    deadline = `State: ${state}.`;
  }

  const title0 =
    description
      .replace(/^\s+/, '')
      .split('\n')[0]
      .replace(/^#+\s*/, '')
      .slice(0, 80) || 'Untitled';
  const actionRows = targets
    .map(
      (t, i) =>
        `| ${i + 1} | ${addrLink(t)} | ${eth(values[i])} | \`${signatures[i] || '(none)'}\` | \`${calldatas[i].length > 66 ? `${calldatas[i].slice(0, 66)}…` : calldatas[i]}\` |`,
    )
    .join('\n');
  const cancelData = `0x40e58ee5${id.toString(16).padStart(64, '0')}`;

  const body = `${flags.length > 0 ? '## ⚠️ Looks like a drain\n' + flags.map(f => `- ${f}`).join('\n') + '\n\n' : ''}**${state}** · ${deadline}

| | |
|---|---|
| Proposer | ${addrLink(proposer)} (${proposerVotes} vote(s) at snapshot, of ${ctx.supply} nouns) |
| Votes | ${forVotes} FOR · ${againstVotes} AGAINST · ${abstainVotes} ABSTAIN |
| Requested | ${eth(requested)} of ${eth(ctx.balance)} in the treasury${requested > 0n ? ` (${share}%)` : ''} |

### Actions
| # | Target | Value | Signature | Calldata |
|---|---|---|---|---|
${actionRows || '| – | – | – | – | – |'}

### Description
${description
  .slice(0, 3000)
  .split('\n')
  .map(l => `> ${l}`)
  .join('\n')}

### Links
- noun.wtf: https://noun.wtf/v2/vote/${id}
- Treasury: https://etherscan.io/address/${TREASURY}

### To cancel (admin Safe ${addrLink(ADMIN_SAFE)}, 1-of-3)
Safe → New transaction → Transaction Builder → to \`${TREASURY}\`, value 0, method \`cancel\`, proposalId \`${id}\`
(raw data \`${cancelData}\`). Sign **and execute** before the deadline above.

${MENTIONS}`;

  const title = `[V2 Prop #${id}] ${flags.length > 0 ? '⚠️ ' : ''}${title0} — ${state}${requested > 0n ? `, ${eth(requested)}` : ''}`;
  return { state, title, body };
}

const [count, balance, token, timelockDelay, head] = await Promise.all([
  client.readContract({ address: TREASURY, abi: treasuryAbi, functionName: 'proposalCount' }),
  client.getBalance({ address: TREASURY }),
  client.readContract({ address: TREASURY, abi: treasuryAbi, functionName: 'nounsToken' }),
  client.readContract({ address: TREASURY, abi: treasuryAbi, functionName: 'TIMELOCK_DELAY' }),
  client.getBlock({ blockTag: 'latest' }),
]);
const supply = await client.readContract({
  address: token,
  abi: tokenAbi,
  functionName: 'totalSupply',
});
const ctx = { balance, token, timelockDelay, supply };
const seen = await alertedIds();

console.log(
  `proposalCount=${count} treasury=${eth(balance)} alreadyAlerted=[${[...seen].join(',')}]`,
);

const from = count > BigInt(SCAN_LAST) ? count - BigInt(SCAN_LAST) + 1n : 1n;
for (let id = count; id >= from; id--) {
  if (seen.has(String(id))) continue;
  const forced = FORCE_IDS.has(String(id));
  const stateIdx = await client.readContract({
    address: TREASURY,
    abi: treasuryAbi,
    functionName: 'state',
    args: [id],
  });
  if (!forced && !LIVE.has(STATES[stateIdx])) continue;

  const { title, body } = await describe(id, head, ctx);
  if (DRY_RUN) {
    console.log(`--- would open: ${title}\n${body}\n`);
    continue;
  }
  const issue = await gh('/issues', { method: 'POST', body: JSON.stringify({ title, body }) });
  console.log(`opened #${issue.number}: ${title}`);
}
