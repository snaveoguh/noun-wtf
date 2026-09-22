import { resolve } from 'path';
import { writeFileSync } from 'fs';

const viemPath = resolve('packages/nouns-webapp/node_modules/viem/_cjs/index.js');
const chainsPath = resolve('packages/nouns-webapp/node_modules/viem/_cjs/chains/index.js');
const [v, c] = await Promise.all([import(viemPath), import(chainsPath)]);

const client = v.createPublicClient({ chain: c.mainnet,
  transport: v.http(process.env.RPC_URL ?? 'https://ethereum-rpc.publicnode.com') });

console.log('Fetching tokenSVG(1)...');
const svg = await client.readContract({
  address: '0x4E1f41613c9084FdB9E34E11fAE9412427480e56',
  abi: [{ name: 'tokenSVG', type: 'function', stateMutability: 'view',
    inputs: [{name:'tokenId',type:'uint256'}], outputs: [{name:'',type:'string'}]}],
  functionName: 'tokenSVG', args: [1n],
});

const match = svg.match(/src:url\(data:application\/font-woff2?;charset=utf-8;base64,([^)]+)\)/);
if (match) {
  const buf = Buffer.from(match[1], 'base64');
  writeFileSync('packages/nouns-webapp/public/data/terraforms-font.woff', buf);
  console.log('Font extracted:', buf.length, 'bytes →', 'packages/nouns-webapp/public/data/terraforms-font.woff');
} else {
  console.log('No font found in SVG');
  console.log('First 200 chars of style:', svg.match(/<style>([\s\S]{0,200})/)?.[1]);
}
