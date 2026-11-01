// Daily Noun World snapshot → IPFS / Arweave → NounWorldLedger on Base.
//
//   cd packages/nouns-webapp && pnpm dlx tsx@4.20.3 scripts/onchain/snapshot.ts
//
// With no keys it's a dry run: it reads noun.wtf, builds the snapshots, logs
// their roots and (with SNAPSHOT_OUT=<dir>) writes the files there. Env is
// documented in src/miniapps/world2/onchain/job.ts and
// packages/noun-world-chain/README.md. Keys come from env only.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { runSnapshot } from '../../src/miniapps/world2/onchain/job';

const out = process.env.SNAPSHOT_OUT;

runSnapshot({
  env: process.env,
  log: m => console.log(m),
  onSnapshot: out
    ? snap => {
        for (const f of snap.files) {
          const p = join(out, snap.kind, f.path);
          mkdirSync(dirname(p), { recursive: true });
          writeFileSync(p, f.body);
        }
      }
    : undefined,
}).then(
  res => {
    const summary = res.map(r => `${r.kind}: ${r.status}${r.tx ? ` ${r.tx}` : ''}`).join(', ');
    console.log(`done. ${summary}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      const rows = res.map(
        r =>
          `| ${r.kind} | ${r.status} | ${r.count ?? 0} | \`${r.root ?? ''}\` | ${r.uri ?? ''} | ${r.tx ?? ''} |`,
      );
      writeFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        [
          '| kind | status | leaves | root | manifest | tx |',
          '| --- | --- | --- | --- | --- | --- |',
          ...rows,
          '',
        ].join('\n'),
        { flag: 'a' },
      );
    }
  },
  e => {
    console.error(e);
    process.exit(1);
  },
);
