import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { seatHeight, seatRoofs } from './roofs';

/** Highest surface of `mesh` straight under (x, z), from up high. */
function topAt(mesh: THREE.Mesh, x: number, z: number) {
  const rc = new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
  const hit = rc.intersectObject(mesh, false)[0];
  return hit === undefined ? null : hit.point.y;
}

const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y + h / 2, z);
  return g;
}

/**
 * A 20 × 20 block: the render roof at 10 m with a 0.9 m parapet along one
 * edge, and its baked collision box running up to the parapet top.
 */
function block() {
  const body = box(20, 10, 20, 0, 0, 0);
  const parapet = box(20, 0.9, 0.3, 0, 10, 9.85);
  const render = new THREE.Mesh(
    new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [...body.attributes.position.array, ...parapet.attributes.position.array],
        3,
      ),
    ),
    material,
  );
  const col = new THREE.Mesh(box(20, 10.9, 20, 0, 0, 0), material);
  render.updateMatrixWorld(true);
  col.updateMatrixWorld(true);
  return { render, col };
}

describe('seatRoofs', () => {
  it('puts the collision roof on the roof you see', () => {
    const { render, col } = block();
    expect(topAt(col, 0, 0)).toBeCloseTo(10.9);
    seatRoofs(col, [render]);
    expect(topAt(col, 0, 0)).toBeCloseTo(10);
    expect(topAt(col, 9.5, -9.5)).toBeCloseTo(10);
    // The walls still reach the ground
    expect(topAt(col, 30, 0)).toBeNull();
  });

  it('keeps a collision parapet where the render has one, and only there', () => {
    const { render, col } = block();
    const parapets = seatRoofs(col, [render]);
    expect(parapets).not.toBeNull();
    parapets!.material = material;
    expect(topAt(parapets!, 0, 9.85)).toBeCloseTo(10.9);
    expect(topAt(parapets!, 0, 0)).toBeNull();
  });

  it('leaves a block whose collision already matches its roof', () => {
    const body = box(20, 10, 20, 0, 0, 0);
    const render = new THREE.Mesh(body, material);
    const col = new THREE.Mesh(box(20, 10, 20, 0, 0, 0), material);
    render.updateMatrixWorld(true);
    col.updateMatrixWorld(true);
    seatRoofs(col, [render]);
    expect(topAt(col, 0, 0)).toBeCloseTo(10);
  });
});

describe('seatHeight', () => {
  it('drops a slab top onto the roof floor under it', () => {
    expect(seatHeight(14.5, [[13.6, 0], [], [14.5, 13.6]])).toBeCloseTo(13.6);
  });

  it('leaves street level, matching roofs and anything with render just above', () => {
    expect(seatHeight(1, [[0.2]])).toBe(1);
    expect(seatHeight(10, [[10, 0]])).toBe(10);
    expect(seatHeight(11.1, [[10.2, 11.6]])).toBe(11.1);
    // A roof far below (a different, lower building) is not this one's floor
    expect(seatHeight(18.8, [[13.6]])).toBe(18.8);
  });
});
