/**
 * Module augmentation that extends the BerryEventMap defined in
 * `./eventBus.ts` with the event categories owned by the
 * dnd / clipboard / vfs sub-systems.
 *
 * Keeping these declarations in a separate `.d.ts` lets the read-only
 * `eventBus.ts` stay untouched while still giving us strongly-typed
 * `berryBus.emit('dnd:start', ...)` / `useBerryEvent('clipboard:copy', ...)`
 * call sites elsewhere in this folder.
 */

import type { BerryDragPayload, BerryDragType } from './dnd';
import type { BerryClipboardItem } from './clipboard';
import type { BerryFile } from './vfs';

declare module './eventBus' {
  interface BerryEventMap {
    // Drag-and-drop
    'dnd:start': { payload: BerryDragPayload };
    'dnd:end': {
      payload: BerryDragPayload | null;
      droppedOnTargetId?: string;
      accepted: boolean;
    };
    'dnd:targetEnter': { targetId: string; appId: string; accept: BerryDragType[] };
    'dnd:targetLeave': { targetId: string; appId: string };

    // Clipboard
    'clipboard:copy': { item: BerryClipboardItem };
    'clipboard:paste': { item: BerryClipboardItem | null };
    'clipboard:cleared': Record<string, never>;

    // Virtual filesystem
    'fs:created': { file: BerryFile };
    'fs:modified': { file: BerryFile };
    'fs:deleted': { path: string; toTrash: boolean };
    'fs:moved': { from: string; to: string };
  }
}
