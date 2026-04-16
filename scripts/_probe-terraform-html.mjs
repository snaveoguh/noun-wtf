/**
 * Quick probe: fetch tokenHTML + tokenSVG and dump structures.
 * Usage: node scripts/_probe-terraform-html.mjs [tokenId]
 */
import { resolve } from 'path';
import { writeFileSync } from 'fs';

const viemPath = resolve('packages/nouns-webapp/node_modules/viem/_cjs/index.js');
const chainsPath = resolve('packages/nouns-webapp/node_modules/viem/_cjs/chains/index.js');

const [v, c] = await Promise.all([import(viemPath), import(chainsPath)]);

const rpc = 'https://mainnet.infura.io/v3/03c669afb3a948d588e7f41dd1f5a70b';
const client = v.createPublicClient({ chain: c.mainnet, transport: v.http(rpc) });

const ABI = [
  { name: 'tokenHTML', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'string' }] },
  { name: 'tokenSVG', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'string' }] },
];

const tokenId = BigInt(process.argv[2] || 1);

console.log(`Fetching token #${tokenId} SVG...`);
const svg = await client.readContract({
  address: '0x4E1f41613c9084FdB9E34E11fAE9412427480e56',
  abi: ABI, functionName: 'tokenSVG', args: [tokenId],
});
writeFileSync('/tmp/terraform-sample.svg', svg);
console.log(`SVG length: ${svg.length}, saved to /tmp/terraform-sample.svg`);

// Parse the SVG: look for text elements with tspan
const textMatches = [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)];
console.log(`\nFound ${textMatches.length} <text> elements`);

if (textMatches.length > 0) {
  for (let i = 0; i < Math.min(3, textMatches.length); i++) {
    const tspans = [...textMatches[i][1].matchAll(/<tspan[^>]*>([\s\S]*?)<\/tspan>/g)];
    console.log(`  Text ${i}: ${tspans.length} tspans`);
    if (tspans.length > 0) {
      console.log(`    First 5 tspans: ${tspans.slice(0, 5).map(m => `'${m[1]}'`).join(', ')}`);
      // Show attributes of first tspan
      const attrs = textMatches[i][1].match(/<tspan[^>]*>/);
      if (attrs) console.log(`    First tspan attrs: ${attrs[0]}`);
    }
  }
}

// Look for color classes in style
const styleMatch = svg.match(/<style>([\s\S]*?)<\/style>/);
if (styleMatch) {
  const colorClasses = [...styleMatch[1].matchAll(/\.(\w+)\s*\{([^}]*)\}/g)];
  console.log(`\nCSS classes: ${colorClasses.length}`);
  for (const [, cls, rules] of colorClasses.slice(0, 20)) {
    console.log(`  .${cls} { ${rules.trim()} }`);
  }
}

// Show SVG structure (strip font data)
const noFont = svg.replace(/src:url\(data:[^)]+\)/g, 'src:url(FONT_DATA)');
const first2k = noFont.slice(0, 3000);
console.log(`\n=== SVG structure (first 3000 chars, font stripped) ===`);
console.log(first2k);

// Also show around the rect/text area
const rectIdx = noFont.indexOf('<rect');
if (rectIdx > 0) {
  console.log(`\n=== From <rect> (2000 chars) ===`);
  console.log(noFont.slice(rectIdx, rectIdx + 2000));
}
