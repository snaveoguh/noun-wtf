import type { MoveId } from '../contract';

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { MOVE_IDS, moveFamily, VIEW_MOVES } from './moves';
import { crashPose, movePose, vibePose } from './pose';
import { PoseDriver } from './rig';

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

function makeRig() {
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

const at = (rig: ReturnType<typeof makeRig>, name: string) => {
  rig.space.updateMatrixWorld(true);
  const o = rig.model.getObjectByName(name)!;
  return o.getWorldPosition(new THREE.Vector3());
};

describe('PoseDriver on the Noun skeleton', () => {
  it('finds every bone', () => {
    expect(makeRig().driver.ok).toBe(true);
  });

  it('every move, mirrored or not, stays finite and never sinks into the floor', () => {
    for (const id of MOVE_IDS) {
      const n = VIEW_MOVES[id].beats;
      for (const mirror of [false, true]) {
        const rig = makeRig();
        for (const b of [0, 0.13, 0.5, 0.77, 1.25, n * 0.6, n - 0.01]) {
          rig.driver.drive(1, [{ out: movePose(id, b, n, mirror), w: 1 }], 1);
          expect(rig.driver.finite(), `${id} @${b}`).toBe(true);
          expect(rig.driver.lowest(), `${id} @${b} lowest`).toBeGreaterThan(-0.04);
        }
      }
    }
  });

  it('power moves and freezes sit on the floor (snap)', () => {
    const snap: MoveId[] = [
      'windmill',
      'headspin',
      'backspin',
      'baby_freeze',
      'headstand',
      'hollowback',
      'chair_freeze',
    ];
    for (const id of snap) {
      const rig = makeRig();
      rig.driver.drive(1, [{ out: movePose(id, 0.6, VIEW_MOVES[id].beats), w: 1 }], 1);
      expect(Math.abs(rig.driver.lowest()), id).toBeLessThan(0.03);
    }
  });

  it('headspin and headstand are upside down; the head is on the floor', () => {
    for (const id of ['headspin', 'headstand', 'hollowback'] as MoveId[]) {
      const rig = makeRig();
      rig.driver.drive(1, [{ out: movePose(id, 1.3, 4), w: 1 }], 1);
      const head = at(rig, 'head');
      const hips = at(rig, 'hips');
      expect(head.y, id).toBeLessThan(hips.y - 0.3);
      // The 1 m head is under the body: the hips are way up
      expect(hips.y, id).toBeGreaterThan(1.2);
    }
  });

  it('a windmill lies the body flat and spins it round', () => {
    const rig = makeRig();
    const yaws: number[] = [];
    for (const b of [0, 0.25, 0.5, 0.75]) {
      rig.driver.drive(1, [{ out: movePose('windmill', b, 4), w: 1 }], 1);
      const hips = at(rig, 'hips');
      const neck = at(rig, 'neck');
      // Long axis near horizontal: neck and hips within a hand of the same height
      expect(Math.abs(neck.y - hips.y)).toBeLessThan(0.4);
      expect(hips.y).toBeLessThan(1.5);
      yaws.push(Math.atan2(neck.x - hips.x, neck.z - hips.z));
    }
    // Quarter beats → the body points four different ways (a full lap per beat)
    const spread = new Set(
      yaws.map(y => Math.round(((y + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2)) % 4),
    );
    expect(spread.size).toBe(4);
  });

  it('a six-step plants the hands and walks the feet round them', () => {
    const rig = makeRig();
    const feet: THREE.Vector3[] = [];
    for (let k = 0; k < 6; k++) {
      // Mid-plant of each step (steps are half a beat)
      rig.driver.drive(1, [{ out: movePose('six_step', k * 0.5 + 0.45, 3), w: 1 }], 1);
      const hL = at(rig, 'hand.L');
      const hR = at(rig, 'hand.R');
      // At least one hand on the floor every step
      expect(Math.min(hL.y, hR.y), `step ${k}`).toBeLessThan(0.1);
      // Low: hips under knee height of a stander
      expect(at(rig, 'hips').y).toBeLessThan(0.45);
      const fL = at(rig, 'foot.L');
      const fR = at(rig, 'foot.R');
      feet.push(fL.add(fR).multiplyScalar(0.5));
    }
    // The feet go all the way round: their midpoint visits front, both sides and behind
    const ang = feet.map(f => Math.atan2(f.x, f.z + 0.14));
    const quad = new Set(
      ang.map(a => Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2)) % 4),
    );
    expect(quad.size).toBeGreaterThanOrEqual(3);
  });

  it('toprock stands up with a foot on the floor', () => {
    const rig = makeRig();
    for (const b of [0, 0.5, 1, 1.5]) {
      rig.driver.drive(1, [{ out: movePose('indian_step', b, 4), w: 1 }], 1);
      const fL = at(rig, 'foot.L');
      const fR = at(rig, 'foot.R');
      expect(Math.min(fL.y, fR.y)).toBeLessThan(0.12);
      expect(at(rig, 'head').y).toBeGreaterThan(0.95);
    }
  });

  it('blends layers (move → crash) without blowing up', () => {
    const rig = makeRig();
    for (let i = 0; i <= 10; i++) {
      rig.driver.drive(
        1 / 60,
        [
          { out: movePose('flare', i * 0.1, 4), w: 1 },
          { out: movePose('baby_freeze', 0, 2), w: i / 10 },
          { out: crashPose(0, i * 0.1), w: i / 20 },
        ],
        0.5 + i / 20,
      );
      expect(rig.driver.finite()).toBe(true);
    }
    rig.driver.drive(1 / 60, [{ out: vibePose(0.5), w: 1 }], 1);
    expect(rig.driver.finite()).toBe(true);
  });

  it('every family is represented', () => {
    const fams = new Set(MOVE_IDS.map(m => moveFamily(m)));
    expect([...fams].sort()).toEqual(['footwork', 'freeze', 'power', 'toprock', 'transition']);
  });
});
