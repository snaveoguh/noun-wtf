/**
 * Load a curated 3D Noun head as an editable VoxelMap.
 *
 * Fetches the pre-extracted voxel data from /models/heads/voxeldata/
 * and returns a VoxelMap compatible with the 3D editor.
 *
 * The voxel data coordinates are in the 3DNouns native space:
 *   X: -13 to 12, Y: 21 to 39, Z: -5 to 5
 *
 * For the editor, we remap to the standard 32x32 grid centered at (0,0):
 *   X: x + 16, Y: 31 - (y - 21), Z: z + 5
 */
/* eslint-disable @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-explicit-any */
import { fillVoxelMapInterior, type VoxelMap } from '@nouns/voxel-engine';

interface CuratedVoxelData {
  head: Record<string, string>; // "x,y,z" -> "#rrggbb"
  glasses: Record<string, string>;
  source: string;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Remap a 3DNouns native coordinate key to editor grid space.
 *
 * 3DNouns native: X≈-16..16, Y≈-3..42, Z≈-9..8
 * Editor grid:    X=0..31,   Y=0..31,   Z=any integer
 *
 * X: +16 to center in the 32-wide grid
 * Y: dynamic — each head is centered on sprite grid Y=12 based on its native range
 * Z: +0 (native Z centered near 0, matches background head at z≈0.78)
 */
function remapKey(nativeKey: string, yOffset: number = 15): string | null {
  const [nx, ny, nz] = nativeKey.split(',').map(Number);
  const ex = clamp(Math.round(nx + 16), 0, 31);
  const ey = clamp(Math.round(ny - yOffset), 0, 31);
  const ez = Math.round(nz);
  return `${ex},${ey},${ez}`;
}

/**
 * Load curated voxel data for a head trait and return as editor-compatible VoxelMap.
 * Returns null if no curated data available.
 */
export async function loadCuratedVoxelMap(headIndex: number): Promise<VoxelMap | null> {
  try {
    // First check manifest for the filename
    const manifestRes = await fetch('/models/heads/manifest.json');
    if (!manifestRes.ok) return null;
    const manifest = await manifestRes.json();
    const entry = manifest[headIndex];
    if (!entry?.threeDNounsGlb) return null;

    // Derive voxeldata filename from GLB filename
    const glbName = entry.threeDNounsGlb.split('/').pop()!.replace('.glb', '');
    const jsonUrl = `/models/heads/voxeldata/${glbName}.json`;

    const res = await fetch(jsonUrl);
    if (!res.ok) return null;
    const data: CuratedVoxelData = await res.json();

    // Only load head voxels — skip glasses (curated glasses don't match
    // the noun's actual glasses trait; standard glasses come from background body)
    const voxelMap: VoxelMap = new Map();

    // Align voxel head around glasses: native glasses always at Y≈25-31 (mid=28),
    // sprite glasses at Y≈11-16 (mid=13.5). Offset = 28 - 13.5 ≈ 15.
    // This is constant because all 3DNouns GLBs have glasses at the same native Y.
    const yOffset = 15;

    for (const [key, color] of Object.entries(data.head)) {
      const editorKey = remapKey(key, yOffset);
      if (editorKey) voxelMap.set(editorKey, color);
    }

    // Curated voxeldata captures only the SURFACE of each head — erasing a
    // voxel reveals empty space, not material. Fill the interior with
    // nearest-neighbor color so chipping into the head reveals the layer
    // underneath.
    return fillVoxelMapInterior(voxelMap);
  } catch {
    return null;
  }
}

/**
 * Get list of available curated heads for the editor picker.
 */
export async function listCuratedHeads(): Promise<
  Array<{
    index: number;
    name: string;
    hasVoxelData: boolean;
  }>
> {
  try {
    const res = await fetch('/models/heads/manifest.json');
    if (!res.ok) return [];
    const manifest = await res.json();
    return manifest.map((entry: any) => ({
      index: entry.traitIndex ?? entry.index,
      name: entry.traitName ?? entry.name,
      hasVoxelData: !!entry.threeDNounsGlb,
    }));
  } catch {
    return [];
  }
}
