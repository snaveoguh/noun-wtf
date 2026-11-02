import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import { toToon } from './Toon';

describe('toToon', () => {
  it('keeps the source material reachable as userData.toonSrc', () => {
    const src = new THREE.MeshStandardMaterial({ color: 0x336699 });
    const toon = toToon(src);
    expect(toon).not.toBe(src);
    expect(toon.userData.toonSrc).toBe(src);
    expect(toon.userData.toonFrom).toBe('MeshStandardMaterial');
  });

  it("cloning a toon material doesn't serialise the source and its textures", () => {
    const map = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
    const src = new THREE.MeshStandardMaterial({ map });
    src.userData.flag = true;
    const toon = toToon(src);
    const texJson = vi.spyOn(map, 'toJSON');
    const srcJson = vi.spyOn(src, 'toJSON');
    const copy = toon.clone();
    expect(texJson).not.toHaveBeenCalled();
    expect(srcJson).not.toHaveBeenCalled();
    // Other userData still copies
    expect(copy.userData.flag).toBe(true);
    expect(copy.userData.toonFrom).toBe('MeshStandardMaterial');
    expect(copy.userData.toonSrc).toBeUndefined();
  });
});
