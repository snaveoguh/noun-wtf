// V1 trait set — preserved as the canonical pre-V2 snapshot.
// Most webapp consumers import V1 from `@noundry/nouns-assets` (npm) which
// is V1's *current* chain state. This workspace `ImageData` is a frozen V1
// snapshot used by 2 decorative components.
export { default as ImageData } from './image-data.json';

// V2 trait set — mirrors the on-chain V2-owned NounsDescriptorV2 exactly:
//   palette 239→253, bodies 30→32, accessories 143→144, heads 254→253.
// V2 webapp render paths import this via `@nouns/assets` (workspace).
export { default as ImageDataV2 } from './image-data-v2.json';

// V1 utils — pin to original file. (Imports `image-data.json` internally.)
export {
  getNounData,
  getPartData,
  getRandomNounSeed,
  shiftRightAndCast,
  getPseudorandomPart,
  getNounSeedFromBlockHash,
} from './utils';

// V2 utils — `getNounDataV2(seed)` mirrors `getNounData` shape but reads
// from `image-data-v2.json`. `getRandomNounSeedV2` picks within V2's trait
// ranges (32 bodies / 144 accessories / 253 heads / 23 glasses) so the
// resulting seed is guaranteed to resolve cleanly through `getNounDataV2`.
export { getNounDataV2, getRandomNounSeedV2 } from './utils-v2';
