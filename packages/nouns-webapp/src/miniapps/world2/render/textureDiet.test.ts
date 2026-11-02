import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';

import { barkTextures, lawnTexture, rockNormalTexture } from '../nature/textures';

import {
  LIGHT_CAP,
  LIGHTER_FOR_MS,
  MINOR_CAP,
  RELOAD_WINDOW_MS,
  UPLOAD_CAP,
  WEAK_TEXTURE_BUDGET,
  bootsAfterLoss,
  downsampleRGBA,
  envMapSize,
  lossAction,
  releaseAfterUpload,
  estimateTextureBytes,
  fitSize,
  reloadAfterLoss,
  shrinkTexture,
  textureBytes,
  textureDiet,
  uploadCap,
} from './textureDiet';

const rgba = (w: number, h: number, fill: (x: number, y: number) => number[]) => {
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(fill(x, y), (y * w + x) * 4);
  return d;
};

afterEach(() => {
  textureDiet.on = false;
  textureDiet.light = false;
});

describe('fitSize', () => {
  it('keeps the aspect and never upscales', () => {
    expect(fitSize(1024, 1024, 512)).toEqual([512, 512]);
    expect(fitSize(2048, 1024, 512)).toEqual([512, 256]);
    expect(fitSize(768, 192, 256)).toEqual([256, 64]);
    expect(fitSize(200, 100, 512)).toEqual([200, 100]);
    expect(fitSize(4096, 2, 256)).toEqual([256, 1]);
  });
});

describe('downsampleRGBA', () => {
  it('box-filters each block', () => {
    // 4x2 → 2x1: left block is black/white, right block all red
    const src = rgba(4, 2, x =>
      x < 2 ? (x === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]) : [255, 0, 0, 255],
    );
    expect([...downsampleRGBA(src, 4, 2, 2, 1)]).toEqual([128, 128, 128, 255, 255, 0, 0, 255]);
  });

  it('handles ratios that are not whole numbers', () => {
    const src = rgba(5, 5, () => [10, 20, 30, 40]);
    const out = downsampleRGBA(src, 5, 5, 2, 2);
    expect(out.length).toBe(16);
    expect([...out.slice(0, 4)]).toEqual([10, 20, 30, 40]);
  });
});

describe('shrinkTexture', () => {
  it('shrinks an RGBA8 DataTexture in place, once per source', () => {
    const t = new THREE.DataTexture(
      rgba(512, 256, () => [1, 2, 3, 4]),
      512,
      256,
    );
    const v = t.version;
    expect(shrinkTexture(t, 256)).toBe(true);
    expect(t.image.width).toBe(256);
    expect(t.image.height).toBe(128);
    expect(t.image.data!.length).toBe(256 * 128 * 4);
    expect(t.version).toBeGreaterThan(v);
    // a texture sharing the source isn't shrunk twice
    const twin = t.clone();
    expect(shrinkTexture(twin, 64)).toBe(false);
    expect(twin.image.width).toBe(256);
  });

  it('leaves small, float and hand-mipmapped textures alone', () => {
    expect(
      shrinkTexture(
        new THREE.DataTexture(
          rgba(64, 64, () => [0, 0, 0, 0]),
          64,
          64,
        ),
        256,
      ),
    ).toBe(false);
    const f = new THREE.DataTexture(
      new Float32Array(1024 * 1024 * 4),
      1024,
      1024,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    expect(shrinkTexture(f, 256)).toBe(false);
    const m = new THREE.DataTexture(
      rgba(1024, 1024, () => [0, 0, 0, 0]),
      1024,
      1024,
    );
    m.mipmaps = [{ data: new Uint8Array(4), width: 1, height: 1 }];
    expect(shrinkTexture(m, 256)).toBe(false);
  });
});

describe('texture memory estimate', () => {
  const img = (w: number, h: number) => {
    const t = new THREE.Texture({ width: w, height: h } as unknown as HTMLImageElement);
    return t;
  };

  it('counts mips, the upload cap and shared sources once', () => {
    const big = img(1024, 1024);
    expect(textureBytes(big)).toBeCloseTo((1024 * 1024 * 4 * 4) / 3);
    expect(textureBytes(big, 512)).toBeCloseTo((512 * 512 * 4 * 4) / 3);
    const flat = img(256, 256);
    flat.generateMipmaps = false;
    expect(textureBytes(flat)).toBe(256 * 256 * 4);

    const scene = new THREE.Scene();
    const geo = new THREE.PlaneGeometry();
    scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: big, lightMap: flat })));
    scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: big.clone() })));
    expect(estimateTextureBytes(scene, 512)).toBeCloseTo((512 * 512 * 4 * 4) / 3 + 256 * 256 * 4);
  });

  it('a weak device budget is well under what the world used to hold', () => {
    // 2026-10-27 baseline on the emulated Moto G06: ~165 MB uploaded
    expect(WEAK_TEXTURE_BUDGET).toBeLessThanOrEqual(50e6);
    expect(UPLOAD_CAP).toBeLessThanOrEqual(512);
    expect(MINOR_CAP).toBeLessThanOrEqual(256);
  });
});

describe('builders on the diet', () => {
  it('nature textures come out at the minor cap', () => {
    textureDiet.on = true;
    const bark = barkTextures('palm');
    for (const t of [lawnTexture(), rockNormalTexture(), bark.map, bark.normal]) {
      const { width, height } = t.image as { width: number; height: number };
      expect(Math.max(width, height)).toBeLessThanOrEqual(MINOR_CAP);
    }
  });
});

describe('reloadAfterLoss', () => {
  it('reloads once, then gives up inside the window', () => {
    const now = 1_000_000;
    expect(reloadAfterLoss(now, null)).toBe(true);
    expect(reloadAfterLoss(now, now - 5_000)).toBe(false);
    expect(reloadAfterLoss(now, now - RELOAD_WINDOW_MS)).toBe(true);
    expect(reloadAfterLoss(now, Number.NaN)).toBe(true);
  });
});

describe('diet levels', () => {
  it('caps uploads at 512 (weak), 1024 (light), never off the diet', () => {
    expect(uploadCap({ on: true, light: false })).toBe(UPLOAD_CAP);
    expect(uploadCap({ on: false, light: true })).toBe(LIGHT_CAP);
    expect(uploadCap({ on: false, light: false })).toBe(Infinity);
    expect(uploadCap({ on: true, light: true })).toBe(UPLOAD_CAP);
  });
  it('bakes the env map smaller on a diet', () => {
    expect(envMapSize()).toBe(256);
    textureDiet.light = true;
    expect(envMapSize()).toBe(128);
    textureDiet.on = true;
    expect(envMapSize()).toBe(64);
  });
});

describe('after a lost context', () => {
  const now = 10_000_000;
  it('boots lighter for half an hour after a loss', () => {
    expect(bootsAfterLoss(now, null)).toBe(false);
    expect(bootsAfterLoss(now, now - 1_000)).toBe(true);
    expect(bootsAfterLoss(now, now - LIGHTER_FOR_MS + 1)).toBe(true);
    expect(bootsAfterLoss(now, now - LIGHTER_FOR_MS)).toBe(false);
    expect(bootsAfterLoss(now, now + 5_000)).toBe(false); // clock went backwards
  });
  it('reloads the first time, stops on a notice when it happens again soon', () => {
    expect(lossAction(now, null)).toBe('reload');
    expect(lossAction(now, now - 10_000)).toBe('notice');
    expect(lossAction(now, now - RELOAD_WINDOW_MS)).toBe('reload');
  });
});

describe('releaseAfterUpload', () => {
  const canvasLike = () => ({ width: 2048, height: 2048, getContext: () => null });
  it('frees a static canvas once it is on the GPU, only on a diet', () => {
    const off = new THREE.Texture(canvasLike() as unknown as HTMLCanvasElement);
    releaseAfterUpload(off);
    expect(off.onUpdate).toBeNull();
    textureDiet.light = true;
    const c = canvasLike();
    const t = new THREE.Texture(c as unknown as HTMLCanvasElement);
    releaseAfterUpload(t);
    expect(c.width).toBe(2048);
    t.onUpdate!(t); // three calls it after the upload
    expect([c.width, c.height]).toEqual([1, 1]);
    expect(t.onUpdate).toBeNull();
  });
});
