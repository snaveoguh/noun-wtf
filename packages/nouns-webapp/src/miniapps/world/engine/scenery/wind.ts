// ── Wind — one global gusting wind + a vertex-shader sway patch ──────
//
// Every piece of flora (grass tufts, flowers, bushes, tree canopies) and the
// falling leaves read the SAME wind so the whole island moves together:
// a gust rolls through the grass, the canopies lean, leaves stream off.
//
// `applyWindSway` injects a cheap height-weighted sway into any built-in
// three material via onBeforeCompile. Instanced meshes derive a per-instance
// phase from their world position so neighbouring plants don't sway in
// lockstep. Zero per-frame CPU cost — it's all in the vertex shader.

import * as THREE from 'three';

export const windUniforms = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0.78, 0.62) },
  uWindStrength: { value: 1 },
};

/** CPU-side mirror for particle systems (leaves, foam). */
export const WIND = { time: 0, strength: 1, dirX: 0.78, dirZ: 0.62 };

export function tickWind(dt: number): void {
  WIND.time += dt;
  const t = WIND.time;
  // Slow breathing + occasional gust bursts.
  const base = 0.6 + 0.25 * Math.sin(t * 0.31) * Math.sin(t * 0.117 + 1.3);
  const gust = Math.pow(Math.max(0, Math.sin(t * 0.73 + Math.sin(t * 0.19) * 2.0)), 3) * 0.7;
  WIND.strength = base + gust;
  // Direction wanders slowly.
  const a = 0.66 + Math.sin(t * 0.05) * 0.5;
  WIND.dirX = Math.cos(a);
  WIND.dirZ = Math.sin(a);
  windUniforms.uTime.value = t;
  windUniforms.uWindStrength.value = WIND.strength;
  windUniforms.uWindDir.value.set(WIND.dirX, WIND.dirZ);
}

export interface SwayOptions {
  /** Local-space height at which the sway weight reaches 1 (base = 0). */
  height: number;
  /** Max lateral displacement (units) at full weight and strength 1. */
  amount: number;
  /** Oscillation frequency (rad/s). */
  freq?: number;
}

export function applyWindSway(material: THREE.Material, opts: SwayOptions): void {
  const freq = opts.freq ?? 1.6;
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWindDir = windUniforms.uWindDir;
    shader.uniforms.uWindStrength = windUniforms.uWindStrength;
    shader.uniforms.uSwayHeight = { value: opts.height };
    shader.uniforms.uSwayAmount = { value: opts.amount };
    shader.uniforms.uSwayFreq = { value: freq };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uSwayHeight;
uniform float uSwayAmount;
uniform float uSwayFreq;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  float swayW = clamp(position.y / uSwayHeight, 0.0, 1.0);
  swayW *= swayW;
  #ifdef USE_INSTANCING
    vec3 swayOrigin = instanceMatrix[3].xyz;
  #else
    vec3 swayOrigin = vec3(0.0);
  #endif
  float swayPhase = dot(swayOrigin.xz, vec2(0.21, 0.17));
  float swayS = sin(uTime * uSwayFreq + swayPhase) * 0.6
              + sin(uTime * uSwayFreq * 2.3 + swayPhase * 1.9) * 0.4;
  float swayLean = 0.35 * uWindStrength;
  vec2 swayXZ = uWindDir * (swayS * 0.65 + swayLean) * uSwayAmount * uWindStrength * swayW;
  #ifdef USE_INSTANCING
    mat3 swayR = mat3(instanceMatrix);
    float swaySc = dot(swayR[0], swayR[0]);
    transformed += (transpose(swayR) * vec3(swayXZ.x, 0.0, swayXZ.y)) / max(swaySc, 0.0001);
  #else
    transformed += vec3(swayXZ.x, 0.0, swayXZ.y);
  #endif
}`,
      );
  };
  // Distinct program cache key so three doesn't hand us an un-patched program.
  material.customProgramCacheKey = () => `windsway-${opts.height}-${opts.amount}-${freq}`;
}
