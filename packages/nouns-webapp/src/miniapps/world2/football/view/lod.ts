// ── Noun Football: footballer LOD (pure) ────────────────────────────────
//
// 22 Nouns posed through the PoseDriver every frame is the view's biggest
// CPU cost (a pose solve walks the rig a few times), so how often each
// footballer is solved depends on how far it is from the camera and
// whether it's on screen. Positions and facing still update every frame;
// a skipped pose just holds the bones (anime "on twos" at 40 m reads fine).
//
//   tier 0  near (or the controlled player / the ball carrier): every frame,
//           crossfades between actions
//   tier 1  mid: every 2nd frame (staggered by index), no crossfade
//   tier 2  far: every 3rd frame (low: every 4th)
//   off screen: no pose at all until it's back in view

export type Tier = 0 | 1 | 2;

export interface LodCfg {
  near: number;
  far: number;
  /** Frames between far poses. */
  farEvery: number;
}

export const LOD_HIGH: LodCfg = { near: 32, far: 70, farEvery: 3 };
export const LOD_LOW: LodCfg = { near: 22, far: 50, farEvery: 4 };

export function tierOf(dist: number, important: boolean, cfg: LodCfg): Tier {
  if (important || dist < cfg.near) return 0;
  return dist < cfg.far ? 1 : 2;
}

/** Pose this footballer on this frame? (`index` staggers them so the cost spreads evenly.) */
export function posesThisFrame(
  tier: Tier,
  frame: number,
  index: number,
  cfg: LodCfg,
  onScreen: boolean,
): boolean {
  if (!onScreen) return false;
  if (tier === 0) return true;
  const every = tier === 1 ? 2 : cfg.farEvery;
  return (frame + index) % every === 0;
}
