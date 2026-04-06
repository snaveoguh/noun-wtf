// ── Spatial Password — Gesture-Based Wallet Key Derivation ──────────
//
// Your wallet private key is derived from a sequence of actions
// performed at specific locations in the Nouns World. Like a dance
// routine that generates cryptographic entropy.
//
// Example sequence:
//   1. Walk to the big tree at (28,22)
//   2. Punch 3 times
//   3. Backflip
//   4. Walk to the rock at (35,19)
//   5. Headbutt
//   6. Walk to the ocean edge
//   7. Spin attack
//
// The hash of this sequence = your deterministic private key.
// Nobody can steal your wallet without knowing your exact dance.
//
// Uses keccak256 for hashing (same as Ethereum).

import { keccak256, toBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ── Types ────────────────────────────────────────────────────────────

export interface SpatialAction {
  type: 'move' | 'punch' | 'kick' | 'headbutt' | 'backflip' | 'spin' | 'force' | 'block';
  // Grid position (tile coordinates, not world coords)
  tileX: number;
  tileY: number;
  // Timestamp relative to sequence start (for timing-based entropy)
  relativeTime: number;
}

export interface SpatialPasswordState {
  isRecording: boolean;
  actions: SpatialAction[];
  startTime: number;
  // Derived wallet
  privateKey: Hex | null;
  address: string | null;
}

// ── Constants ────────────────────────────────────────────────────────

const MIN_ACTIONS = 5; // minimum actions for a valid password
const MAX_ACTIONS = 50; // cap to prevent abuse
const SALT = 'nouns-world-spatial-password-v1'; // domain separator

// ── State ────────────────────────────────────────────────────────────

export function createSpatialPasswordState(): SpatialPasswordState {
  return {
    isRecording: false,
    actions: [],
    startTime: 0,
    privateKey: null,
    address: null,
  };
}

// ── Recording ────────────────────────────────────────────────────────

export function startRecording(state: SpatialPasswordState) {
  state.isRecording = true;
  state.actions = [];
  state.startTime = Date.now();
  state.privateKey = null;
  state.address = null;
}

export function recordAction(
  state: SpatialPasswordState,
  type: SpatialAction['type'],
  tileX: number,
  tileY: number,
) {
  if (!state.isRecording) return;
  if (state.actions.length >= MAX_ACTIONS) return;

  const relativeTime = Math.floor((Date.now() - state.startTime) / 100); // 100ms resolution

  state.actions.push({
    type,
    tileX: Math.floor(tileX),
    tileY: Math.floor(tileY),
    relativeTime,
  });
}

// ── Key Derivation ───────────────────────────────────────────────────

/**
 * Derive a deterministic private key from the recorded action sequence.
 * Uses keccak256(salt || action1 || action2 || ... || actionN).
 *
 * The same sequence of actions at the same tile positions will always
 * produce the same private key. Timing is quantized to 100ms buckets
 * to allow slight variations.
 */
export function deriveKey(state: SpatialPasswordState): { privateKey: Hex; address: string } | null {
  if (state.actions.length < MIN_ACTIONS) {
    return null; // not enough entropy
  }

  // Encode actions into a deterministic byte string
  const parts: string[] = [SALT];

  for (const action of state.actions) {
    // Each action contributes: type(1 char) + tileX(4 digits) + tileY(4 digits) + time(6 digits)
    parts.push(
      `${action.type}:${action.tileX.toString().padStart(4, '0')}:${action.tileY.toString().padStart(4, '0')}:${action.relativeTime.toString().padStart(6, '0')}`,
    );
  }

  const encoded = parts.join('|');
  const hash = keccak256(toBytes(encoded));

  // Use the hash as a private key
  const privateKey = hash as Hex;
  const account = privateKeyToAccount(privateKey);

  state.privateKey = privateKey;
  state.address = account.address;
  state.isRecording = false;

  return { privateKey, address: account.address };
}

/**
 * Replay a saved sequence to re-derive the same key.
 * The user performs the same dance and gets the same wallet.
 */
export function replaySequence(actions: SpatialAction[]): { privateKey: Hex; address: string } | null {
  const state = createSpatialPasswordState();
  state.actions = actions;
  return deriveKey(state);
}

/**
 * Get a fingerprint of the current sequence (for display, not the actual key).
 * Shows the first/last 4 chars of the derived address.
 */
export function getSequenceFingerprint(state: SpatialPasswordState): string {
  if (state.address) {
    return `${state.address.slice(0, 6)}...${state.address.slice(-4)}`;
  }
  return `${state.actions.length} actions recorded`;
}

/**
 * Export the action sequence as a JSON string for backup.
 * This is NOT the private key — it's the "password" (the dance moves).
 */
export function exportSequence(state: SpatialPasswordState): string {
  return JSON.stringify({
    version: 1,
    salt: SALT,
    actions: state.actions,
  });
}

/**
 * Import a previously exported sequence.
 */
export function importSequence(json: string): SpatialAction[] | null {
  try {
    const data = JSON.parse(json);
    if (data.version !== 1 || !Array.isArray(data.actions)) return null;
    return data.actions;
  } catch {
    return null;
  }
}

/**
 * Estimate the entropy (in bits) of the current sequence.
 * More actions at more diverse locations = more entropy.
 */
export function estimateEntropy(state: SpatialPasswordState): number {
  const n = state.actions.length;
  if (n === 0) return 0;

  // Each action has: type (8 options = 3 bits) + position (64x64 grid = 12 bits) + timing (~6 bits)
  // Total per action: ~21 bits
  // But repeated actions at same position reduce entropy
  const uniquePositions = new Set(state.actions.map(a => `${a.tileX},${a.tileY}`)).size;
  const uniqueTypes = new Set(state.actions.map(a => a.type)).size;

  const positionEntropy = Math.log2(Math.max(1, uniquePositions)) * n;
  const typeEntropy = Math.log2(Math.max(1, uniqueTypes)) * n;
  const timingEntropy = n * 4; // rough estimate

  return Math.floor(positionEntropy + typeEntropy + timingEntropy);
}

export { MIN_ACTIONS, MAX_ACTIONS };
