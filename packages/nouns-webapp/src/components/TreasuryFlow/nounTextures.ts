/**
 * Noun Texture Generator — creates 32x32 pixelated Noun face textures
 * from Ethereum addresses using deterministic seed generation.
 * Each address gets a unique Noun face based on its bytes.
 * Textures are cached in-memory for reuse across renders.
 *
 * Supports async texture upgrade: pixel art → Noun SVG (if owned) → ENS avatar.
 * Textures are mapped onto 3D spheres in Scene.tsx.
 */
import { ImageData, getNounData } from '@noundry/nouns-assets';
import * as THREE from 'three';

// ─── Seed Generation ─────────────────────────────────────────────────────────

export interface NounSeed {
  background: number;
  body: number;
  accessory: number;
  head: number;
  glasses: number;
}

/** Deterministic seed from an Ethereum address (uses address bytes) */
function addressToSeed(addr: string): NounSeed {
  const hex = addr.replace(/^0x/i, '').toLowerCase().padEnd(40, '0');
  const b = (off: number) => parseInt(hex.substring(off, off + 2), 16);
  return {
    background: b(0) % ImageData.bgcolors.length,
    body: b(4) % ImageData.images.bodies.length,
    accessory: b(10) % ImageData.images.accessories.length,
    head: b(20) % ImageData.images.heads.length,
    glasses: b(30) % ImageData.images.glasses.length,
  };
}

/** Deterministic seed from any string (for special nodes like 'treasury') */
function stringToSeed(str: string): NounSeed {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  const h = Math.abs(hash);
  return {
    background: h % ImageData.bgcolors.length,
    body: (h >> 2) % ImageData.images.bodies.length,
    accessory: (h >> 7) % ImageData.images.accessories.length,
    head: (h >> 12) % ImageData.images.heads.length,
    glasses: (h >> 17) % ImageData.images.glasses.length,
  };
}

// ─── RLE Decoder ─────────────────────────────────────────────────────────────

function decodeRLE(data: string) {
  const hex = data.replace(/^0x/, '');
  const bounds = {
    top: parseInt(hex.substring(2, 4), 16),
    right: parseInt(hex.substring(4, 6), 16),
    bottom: parseInt(hex.substring(6, 8), 16),
    left: parseInt(hex.substring(8, 10), 16),
  };
  const pairs: [number, number][] =
    hex.substring(10).match(/.{1,4}/g)?.map(r => [
      parseInt(r.substring(0, 2), 16),
      parseInt(r.substring(2, 4), 16),
    ]) ?? [];
  return { bounds, pairs };
}

// ─── Pixel Generation ────────────────────────────────────────────────────────

/** Generate 32x32 RGBA pixel data from a Noun seed */
function seedToPixels(seed: NounSeed): Uint8Array {
  const { parts, background } = getNounData(seed);
  const palette = ImageData.palette;
  const pixels = new Uint8Array(32 * 32 * 4);

  // Fill background
  const bgR = parseInt(background.substring(0, 2), 16);
  const bgG = parseInt(background.substring(2, 4), 16);
  const bgB = parseInt(background.substring(4, 6), 16);
  for (let i = 0; i < 32 * 32; i++) {
    pixels[i * 4] = bgR;
    pixels[i * 4 + 1] = bgG;
    pixels[i * 4 + 2] = bgB;
    pixels[i * 4 + 3] = 255;
  }

  // Layer parts (body → accessory → head → glasses)
  for (const part of parts) {
    const { bounds, pairs } = decodeRLE(part.data);
    let x = bounds.left;
    let y = bounds.top;

    for (const [runLength, colorIndex] of pairs) {
      for (let i = 0; i < runLength; i++) {
        if (colorIndex !== 0 && y < 32 && x < 32) {
          const hex = palette[colorIndex];
          if (hex) {
            const idx = (y * 32 + x) * 4;
            pixels[idx] = parseInt(hex.substring(0, 2), 16);
            pixels[idx + 1] = parseInt(hex.substring(2, 4), 16);
            pixels[idx + 2] = parseInt(hex.substring(4, 6), 16);
            pixels[idx + 3] = 255;
          }
        }
        x++;
        if (x >= bounds.right) {
          x = bounds.left;
          y++;
        }
      }
    }
  }

  // Flip Y for Three.js (texture origin at bottom-left)
  const flipped = new Uint8Array(32 * 32 * 4);
  for (let row = 0; row < 32; row++) {
    flipped.set(
      pixels.subarray(row * 128, row * 128 + 128),
      (31 - row) * 128,
    );
  }
  return flipped;
}

// ─── Texture Cache & Factory ─────────────────────────────────────────────────

const cache = new Map<string, THREE.DataTexture>();

/**
 * Get or create a pixelated Noun DataTexture for any node ID.
 * Addresses (0x...) → deterministic seed from address bytes.
 * Strings → deterministic seed from string hash.
 * Results are cached for reuse.
 */
export function getNounTexture(id: string): THREE.DataTexture {
  const key = id.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;

  const seed = key.startsWith('0x') ? addressToSeed(key) : stringToSeed(key);
  const pixels = seedToPixels(seed);
  const texture = new THREE.DataTexture(pixels, 32, 32, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  cache.set(key, texture);
  return texture;
}

// ─── Noun SVG Texture (from actual seed) ─────────────────────────────────────

const nounSvgCache = new Map<string, THREE.Texture>();

/** Create a texture from an actual Noun seed (not address-derived) */
export function loadNounSvgTexture(
  nodeId: string,
  seed: NounSeed,
): Promise<THREE.Texture | null> {
  const key = `noun-svg-${nodeId}`;
  if (nounSvgCache.has(key)) return Promise.resolve(nounSvgCache.get(key)!);

  return new Promise((resolve) => {
    try {
      const { parts, background } = getNounData(seed);
      const palette = ImageData.palette;

      // Build SVG manually (inline, no external dep on @nouns/sdk buildSVG)
      const SIZE = 320;
      const PIXEL = SIZE / 32;
      let rects = '';
      // Background fill
      rects += `<rect width="${SIZE}" height="${SIZE}" fill="#${background}" />`;
      // Render each part
      for (const part of parts) {
        const { bounds, pairs } = decodeRLE(part.data);
        let x = bounds.left;
        let y = bounds.top;
        for (const [runLength, colorIndex] of pairs) {
          if (colorIndex !== 0) {
            const hex = palette[colorIndex];
            if (hex) {
              // Coalesce run if same row
              const startX = x;
              const runEnd = Math.min(x + runLength, bounds.right);
              const sameRowLen = runEnd - startX;
              if (sameRowLen > 0 && y < 32) {
                rects += `<rect x="${startX * PIXEL}" y="${y * PIXEL}" width="${sameRowLen * PIXEL}" height="${PIXEL}" fill="#${hex}" />`;
              }
            }
          }
          for (let i = 0; i < runLength; i++) {
            x++;
            if (x >= bounds.right) { x = bounds.left; y++; }
          }
        }
      }

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" shape-rendering="crispEdges">${rects}</svg>`;
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);

      const img = new Image();
      img.onload = () => {
        const texture = new THREE.Texture(img);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        nounSvgCache.set(key, texture);
        URL.revokeObjectURL(url);
        resolve(texture);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    } catch {
      resolve(null);
    }
  });
}

// ─── ENS Avatar Texture ──────────────────────────────────────────────────────

const ensAvatarCache = new Map<string, THREE.Texture | null>();

/** Load an ENS avatar image as a texture. Returns null on 404/error. */
export function loadEnsAvatarTexture(
  nodeId: string,
  avatarUrl: string,
): Promise<THREE.Texture | null> {
  const key = `ens-avatar-${nodeId}`;
  if (ensAvatarCache.has(key)) return Promise.resolve(ensAvatarCache.get(key)!);

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const texture = new THREE.Texture(img);
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      ensAvatarCache.set(key, texture);
      resolve(texture);
    };
    img.onerror = () => {
      ensAvatarCache.set(key, null);
      resolve(null);
    };
    img.src = avatarUrl;
  });
}
