// ── Road trip looks: a side town or station as a list of anchored parts ──
//
// The older towns build in one go in the chunk holding their market square.
// These are split into parts, each anchored at a spot in town coords: a
// chunk builds only the parts anchored inside it (road/decorator.ts), so a
// town lands over several frames, one chunk's worth at a time (the stream
// builds one chunk's props a frame), and is freed chunk by chunk as you
// leave. Doors (interiors/townDoors.ts) still see the whole build: they run
// every part into a recorder.
//
// Stations sit on a forecourt that follows the road's grade (pads.ts):
// `lift(u)` is the forecourt's height over the frame's P at u (0 for the
// level side towns and in the door recorder), so `on(b, …)` puts a prop on
// the forecourt wherever it is.

import type { SignSpec, TownBuilder } from '../kit';
import type { PadFrame } from '../site';
import type * as THREE from 'three';

import { Matrix4 } from 'three';

export interface PartCtx {
  /** World ground height at town (v', u) (0 in the door recorder). */
  ground(vp: number, u: number): number;
  /** Forecourt height over the frame's P at u (stations: grade · u; else 0). */
  lift(u: number): number;
  /** Forecourt grade along u (stations; 0 on level pads): pitch for things parked on it. */
  grade: number;
  /** Phones / weak devices: fewer small props. */
  low: boolean;
}

export interface RoadPart {
  /** Anchor (town coords): the chunk holding it builds the part. */
  vp: number;
  u: number;
  build(b: TownBuilder, ctx: PartCtx): void;
}

export interface RoadLook {
  signs(): SignSpec[];
  parts(f: PadFrame): RoadPart[];
  /** Instanced plant (b.plant(...) calls in the parts), if any. */
  plant?: () => THREE.BufferGeometry;
  /** A water plane (v' / u rectangle, y under the pad), if any. */
  water?: (f: PadFrame) => {
    v0: number;
    v1: number;
    u0: number;
    u1: number;
    y: number;
    color: number;
  };
}

/** A prop matrix on the pad / forecourt at (v', u), y above it, facing (dv', du). */
export function on(
  b: TownBuilder,
  ctx: PartCtx,
  vp: number,
  u: number,
  y = 0,
  dvp = 0,
  du = 1,
): THREE.Matrix4 {
  return b.at(vp, u, y + ctx.lift(u), dvp, du);
}

/**
 * Like `on`, pitched to the forecourt's grade: for things lying along u
 * (parked trucks, decals). Local +Z points along +u when du > 0.
 */
export function onGraded(
  b: TownBuilder,
  ctx: PartCtx,
  vp: number,
  u: number,
  y = 0,
  du: 1 | -1 = 1,
): THREE.Matrix4 {
  const m = on(b, ctx, vp, u, y, 0, du);
  if (ctx.grade === 0) return m;
  return m.multiply(new Matrix4().makeRotationX(-Math.atan(ctx.grade * du)));
}

/** Ground-following decal rectangle on the pad / forecourt (town coords). */
export function decalOn(
  b: TownBuilder,
  ctx: PartCtx,
  v0: number,
  v1: number,
  u0: number,
  u1: number,
  color: number,
  y = 0.02,
) {
  if (ctx.grade === 0) {
    b.decal(v0, v1, u0, u1, color, y);
    return;
  }
  const P = b.f.P;
  b.sheet([v0, v1], [u0, u1], u => P + ctx.lift(u) + y, color);
}

/** Recorder / level-pad context. */
export const LEVEL_CTX: PartCtx = { ground: () => 0, lift: () => 0, grade: 0, low: false };

/** Run every part of a look into one builder (door recorder, tests). */
export function buildAll(look: RoadLook, b: TownBuilder, ctx: PartCtx = LEVEL_CTX) {
  for (const p of look.parts(b.f)) p.build(b, ctx);
}
