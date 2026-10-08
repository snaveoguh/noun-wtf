// ── Cinematic post additions: depth of field focused on the player ──────
//
// Inserted as its own EffectPass right before the bloom/tone pass so it
// works on linear HDR (after AO + ink outlines). DoF is a
// convolution effect, so it cannot share the bloom/tone EffectPass anyway.
// Cost: ~5 half-res fullscreen passes. Enabled on 'high' only by default.

import type { EffectComposer, Pass } from 'postprocessing';

import { DepthOfFieldEffect, EffectPass } from 'postprocessing';
import * as THREE from 'three';

export interface CinematicHost {
  composer: EffectComposer;
  camera: THREE.PerspectiveCamera;
  quality: 'low' | 'medium' | 'high';
}

export interface CinematicOptions {
  /** Force DoF on/off (default: on for 'high' only). */
  dof?: boolean;
  /** World-space depth range kept sharp around the focus point (m). */
  focusRange?: number;
  /** Bokeh size; ~1-2 reads as subtle "tilt-shift" softness. */
  bokehScale?: number;
}

export interface CinematicEffects {
  dof: DepthOfFieldEffect | null;
  pass: EffectPass | null;
  /** Point the focus at the player each frame (smoothed). */
  update(dt: number, focus: THREE.Vector3): void;
  setEnabled(on: boolean): void;
  dispose(): void;
}

export function addCinematicEffects(
  gfx: CinematicHost,
  opts: CinematicOptions = {},
): CinematicEffects {
  const want = opts.dof ?? gfx.quality === 'high';
  if (!want) {
    return {
      dof: null,
      pass: null,
      update: () => undefined,
      setEnabled: () => undefined,
      dispose: () => undefined,
    };
  }
  const dof = new DepthOfFieldEffect(gfx.camera, {
    focusDistance: 6,
    focusRange: opts.focusRange ?? 7,
    bokehScale: opts.bokehScale ?? 1.6,
    resolutionScale: 0.5,
  });
  const pass = new EffectPass(gfx.camera, dof);
  // Insert right before the bloom/tone-mapping EffectPass: after the RenderPass,
  // N8AO and the ink-outline pass (inserting ahead of the ink pass breaks
  // its depth input, and blurring the ink with the image is what a lens does)
  // but still on linear HDR. Falls back to "before the last pass" (SMAA).
  const passes = (gfx.composer as unknown as { passes: Pass[] }).passes;
  const bloom = (gfx as unknown as { bloom?: unknown }).bloom;
  let at = passes.findIndex(
    p =>
      p instanceof EffectPass &&
      bloom !== undefined &&
      ((p as unknown as { effects?: unknown[] }).effects ?? []).includes(bloom),
  );
  if (at < 0) at = Math.max(1, passes.length - 1);
  gfx.composer.addPass(pass, at);
  let focus = 6;
  const tmp = new THREE.Vector3();
  return {
    dof,
    pass,
    update(dt: number, target: THREE.Vector3) {
      const d = tmp.copy(target).sub(gfx.camera.position).length();
      focus += (d - focus) * Math.min(1, dt * 6);
      dof.cocMaterial.focusDistance = focus;
    },
    setEnabled(on: boolean) {
      pass.enabled = on;
    },
    dispose() {
      gfx.composer.removePass(pass);
      pass.dispose();
    },
  };
}
