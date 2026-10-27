// Parkour poses on the real Noun skeleton: finite, hands where the moves
// put them, and the big head kept out of the wall it's facing.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { PoseDriver } from '../../breakdance/view/rig';
import { ANIM, PK, type AnimKind, type PkAnim } from '../contract';
import { decodePk, encodePk, PkSmoother } from '../net/pk';

import { pkPose } from './poses';

// The Noun rig's skeleton as public/world2/noun_character.glb ships it
// (bind translations + rotations from the file).
type Node = [string, [number, number, number], [number, number, number, number], Node[]];
const SKELETON: Node = [
  'root',
  [0, 0, 0],
  [0, 0, 0, 1],
  [
    [
      'hips',
      [0, 0.56, 0],
      [0, 0, 0, 1],
      [
        [
          'spine',
          [0, 0.12, 0],
          [0, 0, 0, 1],
          [
            [
              'chest',
              [0, 0.18, 0],
              [0, 0, 0, 1],
              [
                ['neck', [0, 0.18, 0], [0, 0, 0, 1], [['head', [0, 0.11, 0], [0, 0, 0, 1], []]]],
                [
                  'shoulder.L',
                  [0.05, 0.14, 0],
                  [-0.5, -0.5, -0.5, 0.5],
                  [
                    [
                      'upperarm.L',
                      [0, 0.22, 0],
                      [-0.5, -0.5, 0.5, 0.5],
                      [
                        [
                          'forearm.L',
                          [0, 0.225, 0],
                          [0, 0, 0, 1],
                          [['hand.L', [0, 0.19, 0], [0, 0, 0, 1], []]],
                        ],
                      ],
                    ],
                  ],
                ],
                [
                  'shoulder.R',
                  [-0.05, 0.14, 0],
                  [-0.5, 0.5, 0.5, 0.5],
                  [
                    [
                      'upperarm.R',
                      [0, 0.22, 0],
                      [-0.5, 0.5, -0.5, 0.5],
                      [
                        [
                          'forearm.R',
                          [0, 0.225, 0],
                          [0, 0, 0, 1],
                          [['hand.R', [0, 0.19, 0], [0, 0, 0, 1], []]],
                        ],
                      ],
                    ],
                  ],
                ],
              ],
            ],
          ],
        ],
        ...(['L', 'R'] as const).map(
          (s): Node => [
            `thigh.${s}`,
            [s === 'L' ? 0.09 : -0.09, -0.04, 0],
            [1, 0, 0, 0],
            [
              [
                `shin.${s}`,
                [0, 0.22, 0],
                [0, 0, 0, 1],
                [
                  [
                    `foot.${s}`,
                    [0, 0.215, 0],
                    [-0.502, 0, 0, 0.865],
                    [[`toe.${s}`, [0, 0.115, 0], [0, 0.967, -0.256, 0], []]],
                  ],
                ],
              ],
            ],
          ],
        ),
      ],
    ],
  ],
];

function build(n: Node): THREE.Bone {
  const b = new THREE.Bone();
  b.name = n[0];
  b.position.set(...n[1]);
  b.quaternion.set(...n[2]).normalize();
  for (const c of n[3]) b.add(build(c));
  return b;
}

export function makeRig() {
  const space = new THREE.Group();
  const body = new THREE.Group();
  space.add(body);
  const model = new THREE.Group();
  body.add(model);
  model.add(build(SKELETON));
  // The Noun head: a 1.15 × 1.0 × 0.85 box sitting on the head bone, origin bottom-centre
  const headBone = model.getObjectByName('head')!;
  const head = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.0, 0.85));
  box.position.y = 0.5;
  head.add(box);
  head.position.y = -0.15;
  headBone.add(head);
  space.updateMatrixWorld(true);
  const driver = new PoseDriver(space, body, body, head);
  return { space, body, model, driver };
}

const world = (rig: ReturnType<typeof makeRig>, name: string) => {
  rig.space.updateMatrixWorld(true);
  return rig.model.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
};

/** Largest z of the head box (rider space): how far the face reaches ahead. */
function headFront(rig: ReturnType<typeof makeRig>) {
  rig.space.updateMatrixWorld(true);
  const box = new THREE.Box3();
  rig.model.getObjectByName('head')!.traverse(o => {
    if ((o as THREE.Mesh).isMesh) box.expandByObject(o);
  });
  return box;
}

const KINDS = (Object.keys(ANIM) as AnimKind[]).filter(k => k !== 'none');
const pose = (rig: ReturnType<typeof makeRig>, a: PkAnim) => {
  const out = pkPose(a);
  expect(out, a.kind).not.toBeNull();
  rig.driver.drive(1, [{ out: out!, w: 1 }], 1);
};

describe('parkour poses', () => {
  it('every move at every phase, side and amount stays finite', () => {
    for (const kind of KINDS)
      for (const side of [1, -1] as const)
        for (const amt of [0, 0.5, 1])
          for (const phase of [0, 0.1, 0.33, 0.5, 0.71, 0.99]) {
            const rig = makeRig();
            pose(rig, { kind, phase, side, amt });
            expect(rig.driver.finite(), `${kind} ${phase} ${side} ${amt}`).toBe(true);
          }
  });

  it('hanging: both hands on the lip, the head out of the wall', () => {
    for (const phase of [0, 0.25, 0.5, 0.75])
      for (const amt of [0, 1]) {
        const rig = makeRig();
        pose(rig, { kind: 'hang', phase, side: 1, amt });
        for (const h of ['hand.L', 'hand.R']) {
          const p = world(rig, h);
          expect(Math.abs(p.y - PK.hangDrop), `${h} y @${phase}`).toBeLessThan(0.09);
          expect(Math.abs(p.z - PK.hangDist), `${h} z @${phase}`).toBeLessThan(0.1);
          expect(Math.abs(p.x)).toBeGreaterThan(0.12);
        }
        // Below the lip the face may touch the wall, not go through it
        expect(headFront(rig).max.z).toBeLessThan(PK.hangDist + 0.12);
      }
  });

  it('climbing: hands on the wall, alternating high and low', () => {
    const rig = makeRig();
    pose(rig, { kind: 'climb', phase: 0.25, side: 1, amt: 1 });
    const l = world(rig, 'hand.L');
    const r = world(rig, 'hand.R');
    expect(l.y - r.y).toBeGreaterThan(0.15);
    for (const p of [l, r]) expect(p.z).toBeGreaterThan(0.36);
    pose(rig, { kind: 'climb', phase: 0.75, side: 1, amt: 1 });
    expect(world(rig, 'hand.R').y - world(rig, 'hand.L').y).toBeGreaterThan(0.15);
    // Feet on the wall, not dangling under the hips
    expect(world(rig, 'foot.L').z).toBeGreaterThan(0.3);
    expect(headFront(rig).max.z).toBeLessThan(0.52 + 0.12);
  });

  it('wall run: feet out to the wall side, mirrored for the other side', () => {
    const rig = makeRig();
    pose(rig, { kind: 'wallrun', phase: 0.2, side: 1, amt: 1 });
    const fl = world(rig, 'foot.L');
    expect(fl.x).toBeGreaterThan(0.3);
    const head = headFront(rig);
    expect(head.max.x).toBeLessThan(PK.wallRunDist + 0.1);
    pose(rig, { kind: 'wallrun', phase: 0.2, side: -1, amt: 1 });
    expect(world(rig, 'foot.R').x).toBeLessThan(-0.3);
  });

  it('pole: hands stacked on the pole in front', () => {
    const rig = makeRig();
    pose(rig, { kind: 'pole', phase: 0.3, side: 1, amt: 0.2 });
    const l = world(rig, 'hand.L');
    const r = world(rig, 'hand.R');
    expect(Math.abs(l.x)).toBeLessThan(0.15);
    expect(l.y).toBeGreaterThan(r.y + 0.1);
    expect(l.z).toBeGreaterThan(0.3);
  });

  it('a roll turns the body over', () => {
    const rig = makeRig();
    pose(rig, { kind: 'roll', phase: 0.5, side: 1, amt: 0 });
    // Half way: hips above the head bone
    expect(world(rig, 'hips').y).toBeGreaterThan(world(rig, 'head').y);
  });
});

describe('the pk key', () => {
  it('round-trips every kind and rejects junk', () => {
    for (const kind of KINDS) {
      const a: PkAnim = { kind, phase: 0.4567, side: -1, amt: 0.333 };
      const back = decodePk(JSON.parse(JSON.stringify(encodePk(a))));
      expect(back).toEqual({ kind, phase: 0.457, side: -1, amt: 0.33 });
    }
    expect(encodePk({ kind: 'none', phase: 0, side: 1, amt: 0 })).toBeNull();
    for (const junk of [
      null,
      3,
      'x',
      [],
      [0, 0, 1, 0],
      [99, 0, 1, 0],
      [1, 'a', 1, 0],
      [1.5, 0, 1, 0],
    ])
      expect(decodePk(junk)).toBeNull();
    // Old / new codes are stable (append-only)
    expect(ANIM.wallrun).toBe(1);
    expect(ANIM.stick).toBe(15);
  });

  it('a remote gait keeps moving between 15 Hz samples', () => {
    const s = new PkSmoother();
    s.feed({ kind: 'wallrun', phase: 0.1, side: 1, amt: 1 }, 0);
    s.feed({ kind: 'wallrun', phase: 0.3, side: 1, amt: 1 }, 66);
    const a = s.step(0)!.phase;
    const b = s.step(1 / 60)!.phase;
    expect(b).toBeGreaterThan(a);
    // Wraps
    s.feed({ kind: 'wallrun', phase: 0.95, side: 1, amt: 1 }, 400);
    s.feed({ kind: 'wallrun', phase: 0.05, side: 1, amt: 1 }, 466);
    expect(s.step(1 / 60)!.phase).toBeLessThan(1);
    s.feed(null, 500);
    expect(s.step(1 / 60)).toBeNull();
  });
});
