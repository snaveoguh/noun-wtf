import { describe, expect, it } from 'vitest';

import { stickToPitch } from './input';

describe('football input: camera-relative stick → pitch', () => {
  const out = { x: 0, z: 0 };
  it('with the camera looking down world +z and the pitch unrotated, up is +z and right is −x', () => {
    stickToPitch(0, 1, 0, 1, { x: 0, y: 0, z: 0, yaw: 0 }, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(1);
    stickToPitch(1, 0, 0, 1, { x: 0, y: 0, z: 0, yaw: 0 }, out);
    expect(out.x).toBeCloseTo(-1);
    expect(out.z).toBeCloseTo(0);
  });

  it('a broadcast camera looking across the pitch (+x): right on the stick runs up the pitch', () => {
    // camera forward world +x (stand on the −x side), pitch unrotated
    stickToPitch(1, 0, 1, 0, { x: 0, y: 0, z: 0, yaw: 0 }, out);
    // right of +x (three.js) is +z
    expect(out.z).toBeCloseTo(1);
    expect(out.x).toBeCloseTo(0);
  });

  it('undoes the stadium yaw', () => {
    const yaw = 0.7;
    // world direction along the pitch's +z is (sin yaw, cos yaw)
    stickToPitch(0, 1, Math.sin(yaw), Math.cos(yaw), { x: 5, y: 0, z: 9, yaw }, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(1);
  });
});
