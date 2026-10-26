// ── The Big Drop: the shared contract every Big Drop system builds on ───
//
// The Big Drop (missions/peak.ts) is a per-player dimension: a 1,000 km snow
// peak (missions/peakTerrain.ts). Everything that makes the ride epic (the
// carved track, jumps, loops, trees, sky, distant ranges, birds, NPC
// hoverboarders, snow spray) is a PeakSystem: created when the rider goes
// through the door, updated every frame while inside, disposed on the way
// out. Systems register in ./systems.ts (one line each).
//
// ── Coordinates (read this) ──
//
// PEAK coordinates: the summit pad is at (0, 0, 0); the mountain falls away
// in every direction and is 1,000 km deep. The race TRACK (./track.ts) runs
// from the pad down the +Z fall line, weaving in x. All design happens here.
//
// LOCAL coordinates: what three.js and the physics see. The world recentres
// under the rider every few km (a floating origin), so local = peak − origin
// + (0, ALT, 0), and `origin` changes on a rebase. Rules:
//   • Object3D positions are JS doubles: set them from ctx.toLocal(...) and
//     re-set them (or shift them in `rebase(d)`) when the origin moves.
//   • Float32 data (vertex buffers, instance matrices, particle buffers)
//     must stay within ~10 km of its object's origin: build meshes in
//     chunk-local coordinates and position the mesh, never bake peak
//     coordinates (up to 1e6 m) into a buffer.
//   • Skinned characters (NounCharacter) must stay near the rider (their
//     bone matrices are world-space float32): only show NPCs within a few km.
//   • Colliders: ctx.setCollider(id, geometry, peakOffset). The geometry is
//     relative to `peakOffset` (peak coordinates); the dimension keeps it in
//     the right local place across rebases. Remove with geometry = null.
//
// ── Budgets (phones run this) ──
//
// Per frame, all systems together: ≤ 3 ms of JS on a desktop at 500 km/h,
// ≤ 150 draw calls added, nothing allocated per frame in hot loops. Honour
// ctx.quality ('low' = phones: fewer trees, fewer NPCs, smaller view).
// Riding speeds run from 0 to 2,000+ km/h: anything streamed round the rider
// must keep up at 600 m/s (stream by distance ahead along the track, not a
// fixed radius).

import type { Game } from '../../Game';
import type { Quality } from '../../render/Graphics';

import * as THREE from 'three';

/** Local y of the summit (peak y = 0): far above anything in the city's coordinates. */
export const ALT = 20_000;

/** What the dimension hands each system. */
export interface PeakCtx {
  readonly game: Game;
  /** Parent for everything a system draws; in the scene only while inside. */
  readonly group: THREE.Group;
  readonly quality: Quality;
  /** Toon rendering on (pass meshes through render/Toon.ts `toonify` if so). */
  readonly toon: boolean;
  /** Peak coordinates of the local point (0, ALT, 0). Changes on a rebase. */
  readonly origin: Readonly<THREE.Vector3>;
  /** Peak → local. */
  toLocal(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3;
  /** Local → peak. */
  toPeak(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3;
  /** Rider position in peak coordinates (updated every frame). */
  readonly riderPeak: Readonly<THREE.Vector3>;
  /** Metres below the summit. */
  readonly depth: number;
  /**
   * Add, replace (same id) or remove (null) a static collider. Geometry
   * positions are relative to `peakOffset` (peak coordinates). Ids are
   * namespaced by the dimension; colliders are dropped on the way out.
   */
  setCollider(id: string, geometry: THREE.BufferGeometry | null, peakOffset?: THREE.Vector3): void;
}

/** One piece of the Big Drop. */
export interface PeakSystem {
  /** Per frame while inside, after the rider's physics and the camera. */
  update(dt: number): void;
  /**
   * The floating origin moved: every LOCAL position shifted by `d` (peak
   * coordinates didn't move). Shift anything you keep in local coordinates.
   */
  rebase?(d: THREE.Vector3): void;
  /** Leaving: remove and free everything (the group is cleared after). */
  dispose(): void;
}

export type PeakSystemFactory = (ctx: PeakCtx) => PeakSystem;

// ── The track (implemented in ./track.ts) ───────────────────────────────

/** What a stretch of track is for. */
export type SectionKind =
  /** Wide groomed carving with a powder field either side (spray snow). */
  | 'cruise'
  /** Tight left-right berms (banked turns). */
  | 'slalom'
  /** Huge kickers with long landings. */
  | 'jumps'
  /** A loop-de-loop on the line. */
  | 'loop'
  /** A carved halfpipe gully. */
  | 'gully';

export interface Section {
  kind: SectionKind;
  /** Track distance (peak z, m) where it starts and ends. */
  s0: number;
  s1: number;
  /** Deterministic per-section random seed. */
  seed: number;
}

/**
 * A feature on the line. Kickers carry `size` (lip height, m); loops their
 * radius (m); berms their side (+1 = the turn bends toward +x).
 */
export interface Feature {
  id: string;
  kind: 'kicker' | 'loop' | 'berm' | 'gate' | 'marker';
  /** Track distance (peak z) of its start. */
  s: number;
  /** Length along the track (m). */
  len: number;
  size: number;
  side: -1 | 1;
}

/** A point on the track's centre line. */
export interface TrackPoint {
  /** Peak coordinates of the centre line (y = the bare cone there). */
  x: number;
  y: number;
  z: number;
  /** Unit heading in xz (downhill along the line). */
  dirX: number;
  dirZ: number;
  /** Groomed lane width (m). */
  width: number;
  section: SectionKind;
}
