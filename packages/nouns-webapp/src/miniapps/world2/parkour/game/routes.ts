// ── NOUN PARKOUR routes ──────────────────────────────────────────────────
//
// Laid on the city as it is: the plaza's props and the ring of blocks round
// it (roofs at 6.8 / 10.2 / 13.6 / 17 / 20.4 m, alleys between them). Each
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

export const ROUTES: Route[] = [];

export function routeById(id: string): Route | undefined {
  return ROUTES.find(r => r.id === id);
}
