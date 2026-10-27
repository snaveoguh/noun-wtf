// ── NOUN PARKOUR routes ──────────────────────────────────────────────────
//
// Laid on the city as it is: the plaza's props and the ring of blocks round
// it (roofs at 6.8 / 10.2 / 13.6 / 17 / 20.4 m, steps between them). Each
// route can add a few course props (planks, poles, ledges, bars) that only
// exist while it runs, so free roam and other features never see them.
// Checkpoint y is roughly chest height where you pass.

import type { RouteDef } from '../sim/route';

/** A course prop: a box (planks, ledges, bars, walls) or an upright pole. */
export type CourseProp =
  | {
      k: 'box';
      x: number;
      y: number;
      z: number;
      sx: number;
      sy: number;
      sz: number;
      ry?: number;
      color?: number;
    }
  | { k: 'pole'; x: number; z: number; y0: number; y1: number; r?: number };

export interface Route extends RouteDef {
  /** Colour of its gates + menu card. */
  color: string;
  props: CourseProp[];
}

const WALL = 0xe9e2d0;
const RED = 0xd22209;
const YEL = 0xffd400;

/**
 * THE GAUNTLET: a built course in the open plaza east of the fountain, one
 * of everything in a row. Wall run → jump across to the other wall → run up
 * the tower → post to post → catch the pole → slide → vault.
 */
const GAUNTLET: Route = {
  id: 'gauntlet',
  name: 'THE GAUNTLET',
  blurb: 'One of every move, back to back. Learn the engine here.',
  color: '#ffd400',
  start: { x: 14, y: 0, z: 19.3, yaw: Math.PI / 2 },
  props: [
    // Wall A: run along it (on your left)
    { k: 'box', x: 22, y: 2, z: 18.3, sx: 8, sy: 4, sz: 0.6, color: WALL },
    // Wall B: jump across to it, run it (on your right), run off its end
    { k: 'box', x: 29, y: 3, z: 22.9, sx: 6, sy: 6, sz: 0.6, color: WALL },
    // The tower: run up its face, pull up on top
    { k: 'box', x: 40, y: 1.75, z: 21.5, sx: 4, sy: 3.5, sz: 4, color: RED },
    // Posts: precision
    { k: 'box', x: 40, y: 1.6, z: 26.3, sx: 0.6, sy: 3.2, sz: 0.6, color: YEL },
    { k: 'box', x: 40, y: 1.6, z: 29.3, sx: 0.6, sy: 3.2, sz: 0.6, color: YEL },
    // The pole
    { k: 'pole', x: 40, z: 33.1, y0: 0, y1: 6.5, r: 0.08 },
    // Slide bar on two uprights
    { k: 'box', x: 40, y: 1.2, z: 44, sx: 3.6, sy: 0.35, sz: 0.3, color: RED },
    { k: 'box', x: 38.1, y: 0.6, z: 44, sx: 0.2, sy: 1.2, sz: 0.3, color: RED },
    { k: 'box', x: 41.9, y: 0.6, z: 44, sx: 0.2, sy: 1.2, sz: 0.3, color: RED },
    // Low wall to vault
    { k: 'box', x: 40, y: 0.45, z: 48, sx: 3.6, sy: 0.9, sz: 0.4, color: WALL },
  ],
  checkpoints: [
    { x: 24, y: 2.7, z: 19.2, r: 1.2, hint: 'SPRINT + JUMP BY THE WALL: WALL RUN' },
    { x: 29.8, y: 3.0, z: 22.0, r: 1.4, hint: 'JUMP ACROSS, RUN THE OTHER WALL' },
    { x: 40, y: 4.4, z: 21.5, r: 1.6, hint: 'RUN OFF ITS END, JUMP AT THE TOWER, PULL UP' },
    { x: 40, y: 4.1, z: 29.3, r: 0.9, hint: 'POST TO POST' },
    { x: 40, y: 3.0, z: 33.1, r: 1.4, hint: 'CATCH THE POLE' },
    { x: 40, y: 1.0, z: 44.2, r: 1.4, hint: 'Q WHILE RUNNING: SLIDE UNDER' },
    { x: 40, y: 1.3, z: 50.5, r: 1.6, hint: 'VAULT · FINISH' },
  ],
  medals: { gold: 21, silver: 28, bronze: 42 },
};

/**
 * NORTH ROOFS: the north side of the ring. Up the 6.8 m block on two sills,
 * up the 3.4 m step, over the parapet onto the infill roof (world/infill.ts;
 * this was an open alley), up block A's wall off a sill, then off the plaza
 * edge onto a pole and down to the street.
 */
const NORTH: Route = {
  id: 'north',
  name: 'NORTH ROOFS',
  blurb: 'Up the facade, up the steps, up the wall, down the pole.',
  color: '#20d6ff',
  start: { x: -20, y: 0, z: -68.5, yaw: Math.PI },
  props: [
    // Sills up the 6.8 m block (face at z −75.9)
    { k: 'box', x: -20, y: 3.55, z: -75.75, sx: 2.4, sy: 0.14, sz: 0.3, color: WALL },
    { k: 'box', x: -20, y: 5.45, z: -75.75, sx: 2.4, sy: 0.14, sz: 0.3, color: WALL },
    // A sill on block A's east face (x −41.2), 2.35 m over the infill roof
    { k: 'box', x: -41.05, y: 12.55, z: -78, sx: 0.3, sy: 0.14, sz: 3, color: WALL },
    // The pole down to the street, off the plaza edge of block A
    { k: 'pole', x: -50, z: -72.6, y0: 0, y1: 13.4, r: 0.1 },
  ],
  checkpoints: [
    { x: -20, y: 7.7, z: -78, r: 1.8, hint: 'JUMP AT THE WALL, LEAP UP THE SILLS' },
    { x: -30, y: 11.1, z: -77.4, r: 2.4, hint: 'RUN UP THE STEP' },
    { x: -46, y: 14.5, z: -77.4, r: 2.4, hint: 'VAULT THE LIP, JUMP AT THE WALL, GRAB THE SILL' },
    { x: -50, y: 12.6, z: -72.6, r: 1.8, hint: 'OFF THE EDGE: CATCH THE POLE' },
    { x: -50, y: 1.2, z: -68.5, r: 2.2, hint: 'SLIDE DOWN · FINISH' },
  ],
  medals: { gold: 18, silver: 25, bronze: 38 },
};

/**
 * LAMP LINE: down the plaza's east side on the poles. Vault in, climb the
 * 8 m lamp mast, then swing round each pole and launch to the next, onto
 * the far mast, and drop off it onto the east platform.
 */
const LAMPS: Route = {
  id: 'lamps',
  name: 'LAMP LINE',
  blurb: 'Pole to pole down the plaza. Swing round, let go, catch the next.',
  color: '#ff2f8e',
  start: { x: 15, y: 0, z: 31, yaw: Math.PI },
  props: [
    { k: 'box', x: 15, y: 0.45, z: 25, sx: 3, sy: 0.9, sz: 0.4, color: WALL },
    { k: 'pole', x: 15, z: 7.5, y0: 0, y1: 6.5, r: 0.09 },
    { k: 'pole', x: 15, z: 0, y0: 0, y1: 6.5, r: 0.09 },
    { k: 'pole', x: 15, z: -7.5, y0: 0, y1: 6.5, r: 0.09 },
  ],
  checkpoints: [
    { x: 15, y: 1.2, z: 22.5, r: 1.8, hint: 'RUN AT THE WALL: VAULT IT' },
    { x: 15, y: 5.9, z: 15, r: 1.5, hint: 'JUMP ON THE LAMP, W TO CLIMB' },
    { x: 15, y: 4.0, z: 7.5, r: 1.6, hint: 'A/D SWING ROUND, SPACE TO LAUNCH' },
    { x: 15, y: 3.6, z: 0, r: 1.7, hint: 'NEXT POLE' },
    { x: 15, y: 3.3, z: -7.5, r: 1.8, hint: 'NEXT POLE' },
    { x: 15, y: 4.2, z: -15, r: 1.8, hint: 'THE BIG MAST' },
    { x: 15, y: 1.5, z: -27, r: 2.4, hint: 'LAUNCH OFF, Q TO ROLL · FINISH' },
  ],
  medals: { gold: 18, silver: 25, bronze: 38 },
};

export const ROUTES: Route[] = [GAUNTLET, NORTH, LAMPS];

export function routeById(id: string): Route | undefined {
  return ROUTES.find(r => r.id === id);
}
