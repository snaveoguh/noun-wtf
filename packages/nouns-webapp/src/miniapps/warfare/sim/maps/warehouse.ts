// ── "Warehouse" — crates, catwalks and paint tanks ──────────────────────
//
// A paint factory floor. Catwalks run along the north and south walls at
// 4 m, joined by a centre bridge, with stairs up at each team's end. Four
// big paint tanks anchor the mid, container walls screen each spawn, and
// crate clusters give cover on the floor. Turf zones sit under the bridge
// (B) and either side of it (A, C), so the catwalks overlook every zone.

import type { BoxDef, MapDef, RampDef, SpawnDef } from '../world';

import {
  FACE_EAST,
  box,
  mirrorBoxX,
  mirrorBoxZ,
  mirrorRampX,
  mirrorRampZ,
  mirrorSpawnX,
  ramp,
} from './kit';

function build(): MapDef {
  const shared: BoxDef[] = [
    box(-33, 33, -1, 0, -25, 25, 'floor'),
    box(-33, 33, 0, 10, -25, -21.5, 'wall'),
    box(-33, 33, 0, 10, 21.5, 25, 'wall'),
    // Centre bridge (N–S) joining the two catwalks; drop-gap in the middle
    box(-1.3, 1.3, 3.7, 4.0, -18.5, 18.5, 'catwalk'),
    box(-1.5, -1.3, 4.0, 4.95, -18.5, -2.2, 'parapet'),
    box(1.3, 1.5, 4.0, 4.95, -18.5, -2.2, 'parapet'),
    box(-1.5, -1.3, 4.0, 4.95, 2.2, 18.5, 'parapet'),
    box(1.3, 1.5, 4.0, 4.95, 2.2, 18.5, 'parapet'),
    // Bridge pillars (thin cover in the centre lane)
    box(-0.3, 0.3, 0, 3.7, -10.3, -9.7, 'pillar'),
    box(-0.3, 0.3, 0, 3.7, 9.7, 10.3, 'pillar'),
    // Centre crates beside zone B
    box(-3.4, -2.2, 0, 1.2, -0.6, 0.6, 'crate'),
    box(2.2, 3.4, 0, 1.2, -0.6, 0.6, 'crate'),
  ];

  // North-west quarter: mirrored in z (south) then the whole west half in x.
  const nwQuarter: BoxDef[] = [
    // North catwalk (west half) + railing on the floor side
    box(-21, -1.3, 3.7, 4.0, -21.5, -18.5, 'catwalk'),
    box(-19.5, -1.5, 4.0, 4.95, -18.7, -18.5, 'parapet'),
    // Paint tank
    box(-11.4, -8.6, 0, 5.4, -10.4, -7.6, 'tank'),
    // Crate cluster mid-north
    box(-7.2, -5.6, 0, 1.4, -6.8, -5.2, 'crate'),
    box(-5.6, -4.6, 0, 1.0, -6.6, -5.6, 'crate'),
    box(-7.0, -6.0, 1.4, 2.4, -6.6, -5.6, 'crate'),
    // Crates near zone A
    box(-3.6, -2.4, 0, 1.2, -13.4, -12.2, 'crate'),
    box(-16, -14.8, 0, 1.2, -15.6, -14.4, 'crate'),
    box(-14.8, -14, 0, 0.8, -15.4, -14.6, 'crate'),
    // Pallet stack near the stairs
    box(-24, -22.6, 0, 1.1, -16, -14.4, 'crate'),
  ];

  const westOnly: BoxDef[] = [
    box(-33, -29.5, 0, 10, -25, 25, 'wall'),
    // Long container across the west-centre lane
    box(-19, -13, 0, 2.6, -1.25, 1.25, 'container', 0x2f8f6b),
    // Spawn screen: containers end-on in front of the red spawn
    box(-24.2, -21.6, 0, 2.6, -6.5, -2.2, 'container', 0xd8752a),
    box(-24.2, -21.6, 0, 2.6, 2.2, 6.5, 'container', 0xd8752a),
    box(-26.8, -26.2, 0, 1.2, -1.4, 1.4, 'base'),
  ];

  const nwRamps: RampDef[] = [
    // Stairs up to the north catwalk at the red end
    ramp(-28, -21, -21.5, -18.6, 0, 4, '+x', 'stairs'),
  ];

  const westBoxes = [...nwQuarter, ...nwQuarter.map(mirrorBoxZ), ...westOnly];
  const westRamps = [...nwRamps, ...nwRamps.map(mirrorRampZ)];

  const redSpawns: SpawnDef[] = [
    { x: -27.5, y: 0, z: -4.5, yaw: FACE_EAST, team: 0 },
    { x: -27.5, y: 0, z: 4.5, yaw: FACE_EAST, team: 0 },
    { x: -28, y: 0, z: -9, yaw: FACE_EAST, team: 0 },
    { x: -28, y: 0, z: 9, yaw: FACE_EAST, team: 0 },
    { x: -25.5, y: 0, z: -12.5, yaw: FACE_EAST, team: 0 },
    { x: -25.5, y: 0, z: 12.5, yaw: FACE_EAST, team: 0 },
    { x: -27.5, y: 0, z: 17, yaw: FACE_EAST, team: 0 },
    { x: -27.5, y: 0, z: -17, yaw: FACE_EAST, team: 0 },
  ];
  const neutral: SpawnDef[] = [
    { x: -14, y: 0, z: -18, yaw: FACE_EAST, team: -1 },
    { x: -14, y: 0, z: 18, yaw: FACE_EAST, team: -1 },
    { x: -10, y: 4, z: -20, yaw: FACE_EAST, team: -1 },
  ];

  return {
    id: 'warehouse',
    name: 'Warehouse',
    blurb: 'Paint factory floor. Catwalks overhead, tanks and crates below.',
    half: [31, 23],
    boxes: [...shared, ...westBoxes, ...westBoxes.map(mirrorBoxX)],
    ramps: [...westRamps, ...westRamps.map(mirrorRampX)],
    spawns: [
      ...redSpawns,
      ...redSpawns.map(mirrorSpawnX),
      ...neutral,
      ...neutral.map(mirrorSpawnX),
    ],
    zones: [
      { id: 'A', x: 0, y: 0, z: -13.5, r: 3.8 },
      { id: 'B', x: 0, y: 0, z: 0, r: 4.2 },
      { id: 'C', x: 0, y: 0, z: 13.5, r: 3.8 },
    ],
    killY: -8,
  };
}

export const WAREHOUSE: MapDef = build();
