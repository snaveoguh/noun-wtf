// ── TerrainChunks — the big island's ground, 64×64-tile chunks ───────
//
// One BufferGeometry per chunk built straight from tilemap.HEIGHT_FIELD
// (so feet always meet the mesh), with:
//   • analytic normals from the global height field → no chunk seams
//   • per-vertex colours = mean of the 4 surrounding tiles' colours, tinted
//     by forest density + altitude → smooth biome gradients, PS2-style
//   • a fragment-side detail noise so big flat fields don't read as one
//     flat colour, and a "wet" darkening at the waterline
// Chunks that are entirely deep sea are skipped (the ocean plane covers
// them). Everything else is frustum culled per chunk by three.

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Tile, MAP_SIZE, MAP_ORIGIN, TILE_UNITS } from '../types';
import { ISLAND_MAP, HEIGHT_FIELD, HILL_FIELD, forestNoise } from '../tilemap';
import { hash2, clamp01 } from '../noise';
import { CHUNK_TILES, CHUNKS_PER_AXIS } from './floraData';

const V = MAP_SIZE + 1;

function heightAt(vx: number, vz: number): number {
  const x = vx < 0 ? 0 : vx > MAP_SIZE ? MAP_SIZE : vx;
  const z = vz < 0 ? 0 : vz > MAP_SIZE ? MAP_SIZE : vz;
  return HEIGHT_FIELD[z * V + x];
}

type RGB = [number, number, number];

const TILE_RGB: Record<Tile, RGB> = {
  [Tile.DeepWater]: [0.1, 0.31, 0.54],
  [Tile.Water]: [0.36, 0.55, 0.72], // seabed showing through
  [Tile.Shallow]: [0.72, 0.7, 0.55], // sandy bottom
  [Tile.Sand]: [0.91, 0.84, 0.64],
  [Tile.Grass]: [0.35, 0.56, 0.24],
  [Tile.Flower]: [0.42, 0.62, 0.28],
  [Tile.Tree]: [0.24, 0.42, 0.17],
  [Tile.Path]: [0.77, 0.65, 0.43],
  [Tile.Rock]: [0.5, 0.5, 0.48],
  [Tile.Spawn]: [0.42, 0.66, 0.31],
  [Tile.Arena]: [0.55, 0.41, 0.08],
};

const FOREST_TINT: RGB = [0.18, 0.4, 0.16];
const ALT_TINT: RGB = [0.62, 0.68, 0.38];
const SUMMIT_TINT: RGB = [0.58, 0.56, 0.52];

function tileRGB(ix: number, iz: number, out: RGB): void {
  const cx = ix < 0 ? 0 : ix >= MAP_SIZE ? MAP_SIZE - 1 : ix;
  const cz = iz < 0 ? 0 : iz >= MAP_SIZE ? MAP_SIZE - 1 : iz;
  const t = ISLAND_MAP[cz][cx];
  const base = TILE_RGB[t];
  let r = base[0];
  let g = base[1];
  let b = base[2];
  if (t === Tile.Grass || t === Tile.Flower || t === Tile.Tree) {
    const tx = cx + MAP_ORIGIN;
    const tz = cz + MAP_ORIGIN;
    const f = clamp01(forestNoise(tx, tz) * 0.9 + 0.1) * 0.55;
    r += (FOREST_TINT[0] - r) * f;
    g += (FOREST_TINT[1] - g) * f;
    b += (FOREST_TINT[2] - b) * f;
    const h = HILL_FIELD[cz * MAP_SIZE + cx];
    // Only the upper slopes go pale/dry — the lowlands stay green so forests read as forests.
    const alt = clamp01((h - 3.5) / 9) * 0.55;
    r += (ALT_TINT[0] - r) * alt;
    g += (ALT_TINT[1] - g) * alt;
    b += (ALT_TINT[2] - b) * alt;
    const summit = clamp01((h - 9.5) / 3.5);
    r += (SUMMIT_TINT[0] - r) * summit;
    g += (SUMMIT_TINT[1] - g) * summit;
    b += (SUMMIT_TINT[2] - b) * summit;
  }
  // Per-tile brightness jitter breaks up the grid.
  const j = 0.93 + hash2(cx, cz, 5) * 0.14;
  out[0] = r * j;
  out[1] = g * j;
  out[2] = b * j;
}

function buildChunk(cx: number, cz: number): THREE.BufferGeometry | null {
  const ix0 = cx * CHUNK_TILES;
  const iz0 = cz * CHUNK_TILES;
  // Skip pure deep-sea chunks.
  let anyLand = false;
  for (let iz = iz0; iz < iz0 + CHUNK_TILES && !anyLand; iz++) {
    const row = ISLAND_MAP[iz];
    for (let ix = ix0; ix < ix0 + CHUNK_TILES; ix++) {
      if (row[ix] !== Tile.DeepWater) {
        anyLand = true;
        break;
      }
    }
  }
  if (!anyLand) return null;

  const n = CHUNK_TILES + 1;
  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const c0: RGB = [0, 0, 0];
  const c1: RGB = [0, 0, 0];
  const c2: RGB = [0, 0, 0];
  const c3: RGB = [0, 0, 0];
  let p = 0;
  for (let j = 0; j < n; j++) {
    const vz = iz0 + j;
    for (let i = 0; i < n; i++) {
      const vx = ix0 + i;
      positions[p] = (vx + MAP_ORIGIN) * TILE_UNITS;
      positions[p + 1] = heightAt(vx, vz);
      positions[p + 2] = (vz + MAP_ORIGIN) * TILE_UNITS;
      // Normal from central differences on the global field (seamless).
      const nx = heightAt(vx - 1, vz) - heightAt(vx + 1, vz);
      const nz = heightAt(vx, vz - 1) - heightAt(vx, vz + 1);
      const ny = 2 * TILE_UNITS;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      normals[p] = nx * inv;
      normals[p + 1] = ny * inv;
      normals[p + 2] = nz * inv;
      // Colour = mean of the 4 tiles that share this vertex.
      tileRGB(vx - 1, vz - 1, c0);
      tileRGB(vx, vz - 1, c1);
      tileRGB(vx - 1, vz, c2);
      tileRGB(vx, vz, c3);
      colors[p] = (c0[0] + c1[0] + c2[0] + c3[0]) * 0.25;
      colors[p + 1] = (c0[1] + c1[1] + c2[1] + c3[1]) * 0.25;
      colors[p + 2] = (c0[2] + c1[2] + c2[2] + c3[2]) * 0.25;
      p += 3;
    }
  }
  const quads = CHUNK_TILES * CHUNK_TILES;
  const index = new Uint16Array(quads * 6);
  let q = 0;
  for (let j = 0; j < CHUNK_TILES; j++) {
    for (let i = 0; i < CHUNK_TILES; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      index[q++] = a;
      index[q++] = c;
      index[q++] = b;
      index[q++] = b;
      index[q++] = c;
      index[q++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

let terrainMaterial: THREE.MeshStandardMaterial | null = null;

export function getTerrainMaterial(): THREE.MeshStandardMaterial {
  if (terrainMaterial) return terrainMaterial;
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
  });
  mat.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainWP;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvTerrainWP = (modelMatrix * vec4(position, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vTerrainWP;
float tnHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tnNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = tnHash(i);
  float b = tnHash(i + vec2(1.0, 0.0));
  float c = tnHash(i + vec2(0.0, 1.0));
  float d = tnHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float n1 = tnNoise(vTerrainWP.xz * 1.9);
  float n2 = tnNoise(vTerrainWP.xz * 7.3);
  diffuseColor.rgb *= 0.86 + 0.18 * n1 + 0.08 * n2;
  // Wet darkening right at the waterline.
  diffuseColor.rgb *= 1.0 - 0.18 * (1.0 - smoothstep(-0.2, 0.12, vTerrainWP.y));
}`,
      );
  };
  mat.customProgramCacheKey = () => 'terrain-detail-v1';
  terrainMaterial = mat;
  return mat;
}

export function buildTerrainChunks(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let cz = 0; cz < CHUNKS_PER_AXIS; cz++) {
    for (let cx = 0; cx < CHUNKS_PER_AXIS; cx++) {
      const g = buildChunk(cx, cz);
      if (g) out.push(g);
    }
  }
  return out;
}

export function TerrainChunks() {
  const chunks = useMemo(() => buildTerrainChunks(), []);
  const material = useMemo(() => getTerrainMaterial(), []);
  useEffect(() => {
    return () => {
      for (const g of chunks) g.dispose();
    };
  }, [chunks]);
  return (
    <group name="terrain-chunks">
      {chunks.map((g, i) => (
        <mesh key={i} geometry={g} material={material} frustumCulled />
      ))}
    </group>
  );
}
