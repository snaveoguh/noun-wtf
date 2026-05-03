/**
 * Install — single-import side-effect bootstrapper for the dnd / clipboard /
 * vfs subsystem.
 *
 * Importing this module at app startup:
 *   1. patches the static `APP_REGISTRY` so `AuctionDropTarget` shadows the
 *      raw `AuctionApp` and the new `Clipboard` app appears in the dock,
 *   2. swaps the Finder entry over to the VFS-backed `FinderVfs`,
 *   3. exports a `<DndClipboardVfsRoot />` component the host shell mounts
 *      once so the drag-ghost overlay + VFS seeders are alive.
 *
 * This is what lets us do the integration without editing any existing
 * BerryShell file. To wire it into the running shell, add:
 *
 *     import { DndClipboardVfsRoot } from './integrations/installDndClipboardVfs';
 *     // ...inside the BerryShell component tree:
 *     <DndClipboardVfsRoot />
 *
 * (5 lines of diff — see `Finder integration patch` in the report.)
 */

import { PINNED_APPS } from '../store/dockStore';
import type { DockApp } from '../store/dockStore';
import { APP_REGISTRY } from '../apps/registry';
import ClipboardApp, { clipboardAppEntry } from '../apps/ClipboardApp';
import AuctionDropTarget from './AuctionDropTarget';
import FinderVfs from './FinderVfs';

import { DragGhost } from '../system/DragGhost';
import { VfsSeeders } from '../system/vfsSeeders';

// ---------------------------------------------------------------------------
// Side-effect: extend the registry + dock once on first import.
// ---------------------------------------------------------------------------

let installed = false;

function install(): void {
  if (installed) return;
  installed = true;

  // 1. Swap Auction component → AuctionDropTarget wrapper.
  if (APP_REGISTRY.auction) {
    APP_REGISTRY.auction = {
      ...APP_REGISTRY.auction,
      Component: AuctionDropTarget,
    };
  }

  // 2. Swap Finder component → FinderVfs.
  if (APP_REGISTRY.finder) {
    APP_REGISTRY.finder = {
      ...APP_REGISTRY.finder,
      Component: FinderVfs,
    };
  }

  // 3. Register Clipboard app.
  if (!APP_REGISTRY.clipboard) {
    APP_REGISTRY.clipboard = {
      appId: clipboardAppEntry.appId,
      title: clipboardAppEntry.title,
      emoji: clipboardAppEntry.emoji,
      Component: ClipboardApp,
      width: clipboardAppEntry.width,
      height: clipboardAppEntry.height,
    };
    // Pin to the dock too. PINNED_APPS is a `readonly` array but the
    // underlying value is a plain JS array — safe to push for the demo.
    const pinned = PINNED_APPS as readonly DockApp[] as DockApp[];
    if (!pinned.some(p => p.appId === 'clipboard')) {
      pinned.push({
        appId: clipboardAppEntry.appId,
        title: clipboardAppEntry.title,
        emoji: clipboardAppEntry.emoji,
      });
    }
  }
}

install();

// ---------------------------------------------------------------------------
// Mount component — caller renders this once anywhere in the tree.
// ---------------------------------------------------------------------------

/**
 * Renders the always-on overlay + reactive seeders that wire dnd / clipboard
 * / vfs into the live shell.
 */
export function DndClipboardVfsRoot() {
  return (
    <>
      <VfsSeeders />
      <DragGhost />
    </>
  );
}

export { ClipboardApp, AuctionDropTarget, FinderVfs };
