// Thin WebSocket adapter — ships strokes and snapshots over any WS-like object.
// PartySocket and vanilla WebSocket both satisfy WsLike.

import type {
  ProtocolMessage,
  SnapshotRequestMessage,
  SnapshotSendMessage,
  StrokeApplyMessage,
} from '../core/protocol.js';
import type { Stroke } from '../core/types.js';

import { BRUSHES } from '../brushes/index.js';
import {
  legacySaveToSnapshot,
  legacyTagsToSnapshot,
  parseProtocolMessage,
  snapshotToLegacySave,
} from '../core/protocol.js';
import { surfaces } from '../core/registry.js';
import { applyStroke } from '../core/stroke.js';

export interface WsLike {
  readyState: number;
  send(data: string): void;
}

/** Send a finished stroke for real-time multiplayer sync. */
export function sendStroke(ws: WsLike, stroke: Stroke): void {
  if (ws.readyState !== 1 /* OPEN */) return;
  const msg: StrokeApplyMessage = { type: 'graffiti:stroke', stroke };
  ws.send(JSON.stringify(msg));
}

/** Send a snapshot upload (after a stroke) — bakes current canvas to PNG. */
export function sendSnapshot(ws: WsLike, surfaceId: string, playerId: string): void {
  if (ws.readyState !== 1) return;
  const surface = surfaces.get(surfaceId);
  if (!surface) return;
  const png = surface.toPng();
  // Use the legacy shape so existing servers keep working.
  ws.send(JSON.stringify(snapshotToLegacySave({ surfaceId, png }, playerId)));
}

/** Ask the server for the current state of a surface. */
export function requestSnapshot(ws: WsLike, surfaceId: string, sinceWatermark?: string): void {
  if (ws.readyState !== 1) return;
  const msg: SnapshotRequestMessage = {
    type: 'graffiti:snapshot:request',
    surfaceId,
    sinceWatermark,
  };
  ws.send(JSON.stringify(msg));
}

/**
 * Handle any incoming string payload. Returns the parsed message so consumers
 * can do their own UI updates. Applies strokes/snapshots to the registry.
 */
export async function handleIncoming(data: string): Promise<ProtocolMessage | null> {
  const msg = parseProtocolMessage(data);
  if (!msg) return null;

  switch (msg.type) {
    case 'graffiti:stroke':
      await applyIncomingStroke(msg.stroke);
      break;
    case 'graffiti:stroke:batch':
      for (const s of msg.strokes) await applyIncomingStroke(s);
      break;
    case 'graffiti:snapshot':
      await applyIncomingSnapshot(msg);
      break;
    case 'world:graffiti:save':
      await applyIncomingSnapshot(legacySaveToSnapshot(msg));
      break;
    case 'world:graffiti:tags': {
      const snap = legacyTagsToSnapshot(msg);
      if (snap) await applyIncomingSnapshot(snap);
      break;
    }
    // requests/loads are server-bound; ignored on client
    case 'graffiti:snapshot:request':
    case 'world:graffiti:load':
      break;
  }
  return msg;
}

async function applyIncomingStroke(stroke: Stroke): Promise<void> {
  const surface = surfaces.get(stroke.surfaceId);
  if (!surface) return;
  const fn = BRUSHES[stroke.brush];
  fn(surface.ctx, stroke, surface.width, surface.height);
  surface.recordStroke(stroke);
  surface.notify();
}

async function applyIncomingSnapshot(msg: SnapshotSendMessage): Promise<void> {
  const surface = surfaces.get(msg.surfaceId);
  if (!surface) return;
  await surface.applyBaseline(msg.pngBase64);
  if (msg.strokesSince) {
    for (const s of msg.strokesSince) {
      applyStroke(s, surface.ctx, surface.width, surface.height);
      surface.recordStroke(s);
    }
  }
  surface.notify();
}
