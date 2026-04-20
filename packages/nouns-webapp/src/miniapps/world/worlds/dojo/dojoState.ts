// ── dojoState — module-level bridge for dojo <-> game loop ───────────
//
// The dojo scene (GravityZones, TrainingDummies) needs the player's
// live MovementBody, but WorldPage.tsx is being edited by another agent
// in parallel, so we don't plumb a prop through it. Instead, the host
// game-logic tick calls `setPlayerBodyForDojo(body)` once, and dojo
// components read via `getPlayerBodyForDojo()` inside their useFrame.
//
// This is intentionally a module singleton — only one local player body
// is relevant to dojo interactions at a time.

import type { MovementBody } from '../../engine/movementBody';

let playerBodyRef: MovementBody | null = null;

/**
 * Called by WorldPage.tsx's game-logic tick (integration step) to wire
 * the live player body into the dojo scene. Passing `null` disables
 * dojo-side body reads.
 */
export function setPlayerBodyForDojo(body: MovementBody | null): void {
  playerBodyRef = body;
}

/**
 * Read the currently wired player body. Returns null if no body is
 * wired — dojo interactors should tolerate null gracefully.
 */
export function getPlayerBodyForDojo(): MovementBody | null {
  return playerBodyRef;
}
