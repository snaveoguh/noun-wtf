// ── Combo System — Track hits and detect special sequences ───────────

import type { MoveType, Player } from './types';
import {
  COMBO_WINDOW,
  COMBO_3_MULT,
  COMBO_5_MULT,
  ROUNDHOUSE_SEQ,
  METEOR_SEQ,
  CYCLONE_SEQ,
} from './types';

/** Check if the last N moves match a sequence */
function matchesSequence(moves: MoveType[], seq: MoveType[]): boolean {
  if (moves.length < seq.length) return false;
  const recent = moves.slice(-seq.length);
  return seq.every((m, i) => recent[i] === m);
}

/** Register a hit on the combo tracker. Returns the combo multiplier and any special move triggered. */
export function registerHit(
  player: Player,
  move: MoveType,
): { multiplier: number; special: MoveType | null } {
  // Reset if combo window expired
  if (player.comboTimer <= 0) {
    player.comboHits = 0;
    player.lastMoves = [];
  }

  player.comboHits++;
  player.comboTimer = COMBO_WINDOW;
  player.lastMoves.push(move);
  if (player.lastMoves.length > 5) player.lastMoves.shift();

  // Check for special combo sequences
  if (matchesSequence(player.lastMoves, CYCLONE_SEQ)) {
    player.lastMoves = [];
    player.comboHits = 0;
    return { multiplier: 1, special: 'cyclone' };
  }
  if (matchesSequence(player.lastMoves, METEOR_SEQ)) {
    player.lastMoves = [];
    player.comboHits = 0;
    return { multiplier: 1, special: 'meteor' };
  }
  if (matchesSequence(player.lastMoves, ROUNDHOUSE_SEQ)) {
    player.lastMoves = [];
    player.comboHits = 0;
    return { multiplier: 1, special: 'roundhouse' };
  }

  // Standard combo multipliers
  let multiplier = 1;
  if (player.comboHits >= 5) multiplier = COMBO_5_MULT;
  else if (player.comboHits >= 3) multiplier = COMBO_3_MULT;

  return { multiplier, special: null };
}

/** Tick combo timer each frame */
export function tickCombo(player: Player) {
  if (player.comboTimer > 0) {
    player.comboTimer--;
    if (player.comboTimer <= 0) {
      player.comboHits = 0;
      player.lastMoves = [];
    }
  }
}
