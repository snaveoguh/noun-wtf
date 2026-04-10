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
import type { VoxelMap } from '@nouns/voxel-engine';

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
 * Y: -10 to match GLB offsetY=-26 (editorY = nativeY - 26 + 15.5)
 * Z: +0 to match GLB offsetZ=-0.25 (centers head on body, back half occluded)
 */
function remapKey(nativeKey: string): string | null {
  const [nx, ny, nz] = nativeKey.split(',').map(Number);
  const ex = clamp(Math.round(nx + 16), 0, 31);
  const ey = clamp(Math.round(ny - 10), 0, 31);
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

    for (const [key, color] of Object.entries(data.head)) {
      const editorKey = remapKey(key);
      if (editorKey) voxelMap.set(editorKey, color);
    }

    return voxelMap;
  } catch {
    return null;
  }
}

/**
 * Get list of available curated heads for the editor picker.
 */
export async function listCuratedHeads(): Promise<Array<{
  index: number;
  name: string;
  hasVoxelData: boolean;
}>> {
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
