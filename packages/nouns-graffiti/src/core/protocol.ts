// Wire protocol for syncing strokes between clients.
// Pure TS. Swift/visionOS will implement the same shapes.

import type { Stroke, SurfaceSnapshot } from './types.js';

export type ProtocolMessage =
  | StrokeApplyMessage
  | StrokeBatchMessage
  | SnapshotRequestMessage
  | SnapshotSendMessage
  | LegacySaveMessage
  | LegacyLoadMessage
  | LegacyTagsMessage;

export interface StrokeApplyMessage {
  type: 'graffiti:stroke';
  stroke: Stroke;
}

export interface StrokeBatchMessage {
  type: 'graffiti:stroke:batch';
  surfaceId: string;
  strokes: Stroke[];
}

export interface SnapshotRequestMessage {
  type: 'graffiti:snapshot:request';
  surfaceId: string;
  /** optional: only need strokes after this watermark; server may still send full snapshot */
  sinceWatermark?: string;
}

export interface SnapshotSendMessage {
  type: 'graffiti:snapshot';
  surfaceId: string;
  pngBase64: string;
  /** strokes applied on top of the snapshot but not yet baked into it */
  strokesSince?: Stroke[];
  /** watermark for client to use next time it requests */
  watermark?: string;
}

// ── Legacy shapes — kept wire-compatible with the old graffiti.ts ────────

export interface LegacySaveMessage {
  type: 'world:graffiti:save';
  wallId: string;
  imageData: string;
  playerId: string;
}

export interface LegacyLoadMessage {
  type: 'world:graffiti:load';
  wallId: string;
}

export interface LegacyTagData {
  imageData: string;
  playerId: string;
  timestamp: number;
}

export interface LegacyTagsMessage {
  type: 'world:graffiti:tags';
  wallId: string;
  tags: LegacyTagData[];
}

/** Parse any incoming JSON string into a typed message, or null if not ours. */
export function parseProtocolMessage(data: string): ProtocolMessage | null {
  try {
    const msg = JSON.parse(data) as { type?: unknown };
    if (typeof msg.type !== 'string') return null;
    if (
      msg.type === 'graffiti:stroke' ||
      msg.type === 'graffiti:stroke:batch' ||
      msg.type === 'graffiti:snapshot:request' ||
      msg.type === 'graffiti:snapshot' ||
      msg.type === 'world:graffiti:save' ||
      msg.type === 'world:graffiti:load' ||
      msg.type === 'world:graffiti:tags'
    ) {
      return msg as ProtocolMessage;
    }
  } catch {
    // not JSON
  }
  return null;
}

/** Promote a legacy save message into a snapshot message (for registry consumption). */
export function legacySaveToSnapshot(msg: LegacySaveMessage): SnapshotSendMessage {
  return {
    type: 'graffiti:snapshot',
    surfaceId: msg.wallId,
    pngBase64: msg.imageData,
  };
}

/** Promote legacy tag list into a snapshot (server-authoritative baked image). */
export function legacyTagsToSnapshot(msg: LegacyTagsMessage): SnapshotSendMessage | null {
  // Prefer the newest tag as the authoritative snapshot — server is assumed to have
  // composited older tags into it if it wanted layered persistence.
  if (msg.tags.length === 0) return null;
  const newest = msg.tags.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
  return {
    type: 'graffiti:snapshot',
    surfaceId: msg.wallId,
    pngBase64: newest.imageData,
  };
}

/** Serialize a snapshot back to a legacy save message for servers that only speak legacy. */
export function snapshotToLegacySave(snap: SurfaceSnapshot, playerId: string): LegacySaveMessage {
  return {
    type: 'world:graffiti:save',
    wallId: snap.surfaceId,
    imageData: snap.png,
    playerId,
  };
}
