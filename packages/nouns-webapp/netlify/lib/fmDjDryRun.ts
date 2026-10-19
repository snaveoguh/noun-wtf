// Read-only dry run of the DJ update against the real chain (no Blobs, no
// keys): bundle with esbuild and run with node. Prints the facts + script.
//
//   npx esbuild netlify/lib/fmDjDryRun.ts --bundle --platform=node --format=esm \
//     --outfile=/tmp/fm-dj-dry.mjs && node /tmp/fm-dj-dry.mjs

import {
  composeAlert,
  composeScript,
  unbackedNumbers,
} from '../../src/miniapps/world2/radio/djScript';

import { readFacts, viemReader } from './fmDj';

async function main() {
  const t0 = Date.now();
  const facts = await readFacts(viemReader(), Date.now());
  const script = composeScript(facts);
  console.log(JSON.stringify(facts, null, 2));
  console.log('\nSCRIPT:', script);
  console.log('words:', script.split(/\s+/).length);
  console.log('ALERT:', composeAlert(facts));
  console.log('unbacked numbers:', unbackedNumbers(script, facts));
  console.log('took', Date.now() - t0, 'ms');
}

void main();
