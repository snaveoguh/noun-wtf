// Re-export the wire protocol for external adapters (visionOS, server tests).
// This file exists so consumers can pin to a stable path without importing /core directly.

export type {
  ProtocolMessage,
  StrokeApplyMessage,
  StrokeBatchMessage,
  SnapshotRequestMessage,
  SnapshotSendMessage,
  LegacySaveMessage,
  LegacyLoadMessage,
  LegacyTagsMessage,
  LegacyTagData,
} from '../core/protocol.js';

export {
  parseProtocolMessage,
  legacySaveToSnapshot,
  legacyTagsToSnapshot,
  snapshotToLegacySave,
} from '../core/protocol.js';

export type { Stroke, StrokePoint, BrushKind, HexColor, SurfaceSnapshot } from '../core/types.js';
