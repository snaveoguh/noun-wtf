// ── Who sees whose name (pure) ───────────────────────────────────────────
//
// A hider's name tag gives them away (it floats over walls and rooftops,
// the edge-of-screen pointer gives their direction and distance, the
// minimap a dot). So while a round is on, an unfound hider's giveaways are
// HIDDEN from everyone except the other hiders in the same game, who see
// them faintly (no pointer, no minimap dot). That includes bystanders in
// the room who aren't playing: anyone could be a seeker's friend on voice.
//
// Hidden means, in Game.ts / WorldMap: no name tag (and so no legend
// badge, speaking 🔊, chat bubble or trick text over them), no pointer, no
// minimap dot, no positional callouts or voiced chat (they'd pan towards
// them), and their chat lines say "a hider" instead of their name.
//
// Seekers, found hiders, and everyone in the reveal / after the game show
// normally. Players in no game at all always show.

import type { HsPhase, HsStanding } from './contract';

export type LabelShow = 'show' | 'faint' | 'hide';

export interface Viewer {
  /** The game I'm in (null: none), and my standing in it. */
  gid: string | null;
  st: HsStanding | null;
}

export interface Target {
  /** The game they're hiding in (null: none, or not hiding). */
  gid: string | null;
  st: HsStanding | null;
  phase: HsPhase | null;
}

export function labelFor(viewer: Viewer, target: Target): LabelShow {
  if (target.gid === null || target.st !== 'h') return 'show';
  if (target.phase !== 'hide' && target.phase !== 'seek') return 'show';
  if (viewer.gid === target.gid && viewer.st === 'h') return 'faint';
  return 'hide';
}

/** The minimap shows a dot only for a tag that shows in full. */
export const onMinimap = (s: LabelShow) => s === 'show';
/** The edge pointer (direction + distance) likewise. */
export const hasPointer = (s: LabelShow) => s === 'show';
/** Positional sounds (callouts, voiced chat) only when they'd show. */
export const audible = (s: LabelShow) => s !== 'hide';
