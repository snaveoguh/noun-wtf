// ── propCatalog — authoritative manifest of city props ───────────────
//
// Every placeable prop in the world game lives here. Each entry has a
// stable `id` (used by the build-mode UI later), a pointer to a GLB file
// (or `null` for proc-only props), a baseline scale, a collision AABB in
// Three.js units, and optional paintable surface descriptors.
//
// If `glbUrl` is null OR the file isn't on disk yet, the consumer component
// falls back to its procedural mesh — nothing crashes. See `glbProps.ts`.
//
// File layout (see public/assets/README.md for the user):
//   public/assets/kenney/city-kit/{lamp-post,fire-hydrant,...}.glb
//   public/assets/kenney/car-kit/{sedan,taxi,police,delivery,sport}.glb
//   public/assets/kenney/weapon-pack/{pistol,smg,shotgun,...}.glb

import { preloadProps } from './glbProps';

export type PropCategory = 'street' | 'vehicle' | 'building' | 'weapon' | 'debris';

export interface PaintableDescriptor {
  face: 'front' | 'back' | 'sides' | 'top';
  scale?: number;
}

export interface PropEntry {
  id: string;
  name: string;
  category: PropCategory;
  /** Path under /public. `null` means no GLB yet — always use proc fallback. */
  glbUrl: string | null;
  /** Uniform scale applied to the GLB on render. Kenney kits are ~1u, tune per prop. */
  defaultScale?: number;
  /** [width, depth, height] in Three.js units. Matches CityBlock's useStructure sig. */
  collisionSize: [number, number, number];
  /** Describes where paintable overlays should go (used by build mode, not by CityBlock directly). */
  paintable?: PaintableDescriptor[];
}

// ── Root path for all Kenney assets ──────────────────────────────────
const KENNEY = '/assets/kenney';

// ── The manifest ─────────────────────────────────────────────────────
// IDs are stable — treat them like enum values.
const ENTRIES: PropEntry[] = [
  // Street furniture (Kenney City Kit Suburban)
  {
    id: 'lamp-post',
    name: 'Lamppost',
    category: 'street',
    glbUrl: `${KENNEY}/city-kit/lamp-post.glb`,
    defaultScale: 1,
    collisionSize: [0.3, 0.3, 3.5],
  },
  {
    id: 'fire-hydrant',
    name: 'Fire Hydrant',
    category: 'street',
    glbUrl: `${KENNEY}/city-kit/fire-hydrant.glb`,
    defaultScale: 1,
    collisionSize: [0.4, 0.4, 0.95],
  },
  {
    id: 'mailbox',
    name: 'Mailbox',
    category: 'street',
    glbUrl: `${KENNEY}/city-kit/mailbox.glb`,
    defaultScale: 1,
    collisionSize: [0.7, 0.5, 1.3],
  },
  {
    id: 'trash-bin',
    name: 'Trash Can',
    category: 'street',
    glbUrl: `${KENNEY}/city-kit/trash-bin.glb`,
    defaultScale: 1,
    collisionSize: [0.6, 0.6, 1.1],
  },
  {
    id: 'dumpster',
    name: 'Dumpster',
    category: 'street',
    glbUrl: `${KENNEY}/city-kit/dumpster.glb`,
    defaultScale: 1,
    collisionSize: [2.6, 1.3, 1.3],
    paintable: [
      { face: 'front', scale: 0.92 },
      { face: 'back', scale: 0.92 },
    ],
  },
  {
    id: 'bench',
    name: 'Park Bench',
    category: 'street',
    glbUrl: `${KENNEY}/city-kit/bench.glb`,
    defaultScale: 1,
    collisionSize: [1.8, 0.5, 0.85],
  },
  {
    id: 'traffic-cone',
    name: 'Traffic Cone',
    category: 'street',
    glbUrl: `${KENNEY}/city-kit/traffic-cone.glb`,
    defaultScale: 1,
    collisionSize: [0.3, 0.3, 0.5],
  },
  {
    id: 'newspaper-stand',
    name: 'Newspaper Box',
    category: 'street',
    glbUrl: `${KENNEY}/city-kit/newspaper-stand.glb`,
    defaultScale: 1,
    collisionSize: [0.5, 0.4, 1.1],
    paintable: [{ face: 'front', scale: 1 }],
  },

  // Vehicles (Kenney Car Kit) — a single `parked-car` logical prop,
  // cycled through variants by id hash.
  {
    id: 'car-sedan',
    name: 'Sedan',
    category: 'vehicle',
    glbUrl: `${KENNEY}/car-kit/sedan.glb`,
    defaultScale: 1,
    collisionSize: [3.8, 1.6, 1.2],
    paintable: [{ face: 'sides', scale: 0.55 }],
  },
  {
    id: 'car-taxi',
    name: 'Taxi',
    category: 'vehicle',
    glbUrl: `${KENNEY}/car-kit/taxi.glb`,
    defaultScale: 1,
    collisionSize: [3.8, 1.6, 1.2],
    paintable: [{ face: 'sides', scale: 0.55 }],
  },
  {
    id: 'car-police',
    name: 'Police Cruiser',
    category: 'vehicle',
    glbUrl: `${KENNEY}/car-kit/police.glb`,
    defaultScale: 1,
    collisionSize: [3.8, 1.6, 1.2],
    paintable: [{ face: 'sides', scale: 0.55 }],
  },
  {
    id: 'car-delivery',
    name: 'Delivery Van',
    category: 'vehicle',
    glbUrl: `${KENNEY}/car-kit/delivery.glb`,
    defaultScale: 1,
    collisionSize: [3.8, 1.6, 1.2],
    paintable: [{ face: 'sides', scale: 0.55 }],
  },
  {
    id: 'car-sport',
    name: 'Sports Car',
    category: 'vehicle',
    glbUrl: `${KENNEY}/car-kit/sport.glb`,
    defaultScale: 1,
    collisionSize: [3.8, 1.6, 1.2],
    paintable: [{ face: 'sides', scale: 0.55 }],
  },

  // Buildings
  {
    id: 'shop-small',
    name: 'Bodega (small shop)',
    category: 'building',
    glbUrl: `${KENNEY}/city-kit/shop-small.glb`,
    defaultScale: 1,
    collisionSize: [6, 2.5, 4],
    paintable: [
      { face: 'front', scale: 0.9 },
      { face: 'sides', scale: 0.9 },
    ],
  },

  // Proc-only fallbacks (no GLB target, but we still want them in the catalog
  // so build mode can place them)
  {
    id: 'manhole-cover',
    name: 'Manhole Cover',
    category: 'debris',
    glbUrl: null,
    collisionSize: [1, 1, 0.02],
  },
  {
    id: 'sewer-grate',
    name: 'Sewer Grate',
    category: 'debris',
    glbUrl: null,
    collisionSize: [0.7, 0.5, 0.02],
  },

  // Weapons (Kenney Weapon Pack) — referenced here so build mode / pickup
  // drops can pull from the same catalog. CityBlock doesn't render these.
  {
    id: 'weapon-pistol',
    name: 'Pistol',
    category: 'weapon',
    glbUrl: `${KENNEY}/weapon-pack/pistol.glb`,
    defaultScale: 1,
    collisionSize: [0.3, 0.1, 0.2],
  },
  {
    id: 'weapon-smg',
    name: 'SMG',
    category: 'weapon',
    glbUrl: `${KENNEY}/weapon-pack/smg.glb`,
    defaultScale: 1,
    collisionSize: [0.5, 0.1, 0.25],
  },
  {
    id: 'weapon-shotgun',
    name: 'Shotgun',
    category: 'weapon',
    glbUrl: `${KENNEY}/weapon-pack/shotgun.glb`,
    defaultScale: 1,
    collisionSize: [0.8, 0.1, 0.2],
  },
];

const BY_ID = new Map<string, PropEntry>(ENTRIES.map(e => [e.id, e]));

/** Look up an entry by id. Throws in dev if missing — catalog is authoritative. */
export function getProp(id: string): PropEntry {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`[propCatalog] unknown prop id: ${id}`);
  return entry;
}

/** Same as getProp but returns undefined instead of throwing. */
export function findProp(id: string): PropEntry | undefined {
  return BY_ID.get(id);
}

/** All entries (handy for build-mode palette). */
export function allProps(): ReadonlyArray<PropEntry> {
  return ENTRIES;
}

/** All entries of a given category. */
export function propsByCategory(cat: PropCategory): ReadonlyArray<PropEntry> {
  return ENTRIES.filter(e => e.category === cat);
}

/** Pick a car variant deterministically from an id (e.g. 'car-1' → sedan). */
const CAR_VARIANTS = ['car-sedan', 'car-taxi', 'car-police', 'car-delivery', 'car-sport'] as const;
export function pickCarVariant(instanceId: string): PropEntry {
  let h = 0;
  for (let i = 0; i < instanceId.length; i++) {
    h = (h * 31 + instanceId.charCodeAt(i)) >>> 0;
  }
  const idx = h % CAR_VARIANTS.length;
  return getProp(CAR_VARIANTS[idx]!);
}

/** Preload every GLB in the manifest. Call once on world boot. */
export function preloadCatalog(): void {
  const urls: string[] = [];
  for (const e of ENTRIES) {
    if (e.glbUrl) urls.push(e.glbUrl);
  }
  preloadProps(urls);
}
