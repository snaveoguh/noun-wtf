/**
 * Centralized keyboard shortcuts for the auction hero page.
 * Handles both viewing mode and editing mode shortcuts.
 */
import { useCallback, useEffect } from 'react';

import { type Tool } from '@/components/Studio/PixelCanvas';

export interface AuctionShortcutConfig {
  isEditing: boolean;
  viewMode: string;

  // Navigation
  onPrevNoun: () => void;
  onNextNoun: () => void;
  isFirstAuction: boolean;
  isLastAuction: boolean;

  // View modes
  onSetViewMode: (mode: string) => void;
  onEnterEdit: () => void;
  onExitEdit: () => void;

  // View controls
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onToggleFullscreen: () => void;
  onSaveScreenshot: () => void;
  onToggleHelp: () => void;

  // Edit mode (optional — only used when editing)
  onSetTool?: (tool: Tool) => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

export function useAuctionKeyboardShortcuts(config: AuctionShortcutConfig) {
  const handler = useCallback(
    (e: KeyboardEvent) => {
      // Skip when typing in form fields
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // ── Edit mode shortcuts ─────────────────────────────────
      if (config.isEditing) {
        if (key === 'escape') {
          e.preventDefault();
          config.onExitEdit();
          return;
        }
        if (ctrl && key === 'z' && !e.shiftKey) {
          e.preventDefault();
          config.onUndo?.();
          return;
        }
        if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) {
          e.preventDefault();
          config.onRedo?.();
          return;
        }
        if (!ctrl) {
          switch (key) {
            case 'b':
            case 'p':
              config.onSetTool?.('pencil');
              return;
            case 'e':
              config.onSetTool?.('eraser');
              return;
            case 'g':
              config.onSetTool?.('fill');
              return;
            case 'i':
              config.onSetTool?.('eyedropper');
              return;
          }
        }
        // ] / [ zoom in edit mode
        if (key === ']') {
          config.onZoomIn();
          return;
        }
        if (key === '[') {
          config.onZoomOut();
          return;
        }
        return;
      }

      // ── Viewing mode shortcuts ──────────────────────────────
      switch (key) {
        case 'arrowleft':
          if (!config.isFirstAuction) {
            e.preventDefault();
            config.onPrevNoun();
          }
          return;
        case 'arrowright':
          if (!config.isLastAuction) {
            e.preventDefault();
            config.onNextNoun();
          }
          return;
        case '1':
          config.onSetViewMode('real');
          return;
        case '2':
          config.onSetViewMode('3d');
          return;
        case '3':
          config.onSetViewMode('ascii');
          return;
        case 'e':
          config.onEnterEdit();
          return;
        case ']':
          config.onZoomIn();
          return;
        case '[':
          config.onZoomOut();
          return;
        case 'r':
          config.onResetView();
          return;
        case 'f':
          e.preventDefault();
          config.onToggleFullscreen();
          return;
        case 's':
          if (!ctrl) {
            e.preventDefault();
            config.onSaveScreenshot();
          }
          return;
        case 'escape':
          config.onExitEdit();
          return;
      }

      // ? (Shift + /)
      if (e.key === '?' || (e.shiftKey && key === '/')) {
        config.onToggleHelp();
        return;
      }
    },
    [config],
  );

  useEffect(() => {
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handler]);
}
