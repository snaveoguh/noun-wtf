/**
 * InlineEditor — Seamless Noun pixel editor.
 *
 * Pre-loads the current Noun's actual pixels from its seed.
 * In 2D mode: PixelCanvas sits over the hero artwork but keeps its own editor
 * background so erased pixels don't reveal the original noun underneath.
 * Layer visibility toggles let you hide/show body parts.
 * Tools, palette, and actions in floating glass panels.
 */
import { FC, useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import { PixelCanvas, type Tool } from '@/components/Studio/PixelCanvas';
import {
  seedToPixelLayers,
  mergeLayersToGrid,
  DEFAULT_VISIBILITY,
  type NounPixelLayers,
  type LayerVisibility,
} from '@/lib/nounDecoder';
import { getSortedPalette } from '@/lib/nounsPalette';
import { historyReducer } from '@/lib/pixelHistory';
import { INounSeed } from '@/wrappers/nounToken';

import classes from './InlineEditor.module.css';

// ─── Props ───────────────────────────────────────────────────────────────────

interface InlineEditorProps {
  seed: INounSeed;
  nounSvg: string | null;
  onExit: () => void;
  onSave?: (pixels: string[][], thumbnail: string) => void;
  toolRef?: React.MutableRefObject<{
    setTool: (t: Tool) => void;
    undo: () => void;
    redo: () => void;
    getActiveTool: () => Tool;
    getActiveColor: () => string;
  } | null>;
  /** When true, only render floating panels (tools, palette, actions) — no 2D canvas. */
  panelsOnly?: boolean;
  /** Current voxel depth (3D mode) */
  voxelDepth?: number;
  onVoxelDepthChange?: (depth: number) => void;
  /** External pixel state from parent (for 3D mode sync). If provided, editor uses this instead of own reducer. */
  externalPixels?: string[][];
  externalDispatch?: React.Dispatch<import('@/lib/pixelHistory').HistoryAction>;
  externalPast?: string[][][];
  externalFuture?: string[][][];
}

const LAYER_NAMES: { key: keyof LayerVisibility; label: string; emoji: string }[] = [
  { key: 'body', label: 'Body', emoji: '👤' },
  { key: 'accessory', label: 'Acc', emoji: '🎒' },
  { key: 'head', label: 'Head', emoji: '🎩' },
  { key: 'glasses', label: 'Glasses', emoji: '👓' },
];

const InlineEditor: FC<InlineEditorProps> = ({
  seed,
  nounSvg: _nounSvg,
  onExit,
  onSave,
  toolRef,
  panelsOnly = false,
  externalPixels,
  externalDispatch,
  externalPast,
  externalFuture,
  voxelDepth = 1,
  onVoxelDepthChange,
}) => {
  void _nounSvg;
  // Decode seed into per-layer pixel grids
  const nounLayers: NounPixelLayers = useMemo(() => seedToPixelLayers(seed), [seed]);

  // Layer visibility
  const [visibility, setVisibility] = useState<LayerVisibility>({ ...DEFAULT_VISIBILITY });

  // Merge visible layers into initial grid
  const initialGrid = useMemo(
    () => mergeLayersToGrid(nounLayers, visibility),
    [nounLayers, visibility],
  );

  // History (undo/redo) — internal state (used in 2D mode)
  const [internalHistory, internalDispatch] = useReducer(historyReducer, {
    past: [],
    present: initialGrid,
    future: [],
  });

  // When visibility changes, reload merged grid (2D mode only)
  useEffect(() => {
    if (!panelsOnly)
      internalDispatch({ type: 'LOAD', pixels: mergeLayersToGrid(nounLayers, visibility) });
  }, [visibility, nounLayers, panelsOnly]);

  // Use external or internal state
  const pixels = externalPixels ?? internalHistory.present;
  const dispatch = externalDispatch ?? internalDispatch;
  const pastLen = externalPast?.length ?? internalHistory.past.length;
  const futureLen = externalFuture?.length ?? internalHistory.future.length;

  const [activeTool, setActiveTool] = useState<Tool>('pencil');
  const [activeColor, setActiveColor] = useState(() => {
    const grid = externalPixels ?? initialGrid;
    for (const row of grid) {
      for (const c of row) {
        if (c) return c;
      }
    }
    return '#000000';
  });
  const [paletteExpanded, setPaletteExpanded] = useState(false);

  const palette = getSortedPalette();
  const displayPalette = paletteExpanded ? palette : palette.slice(0, 64);

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), [dispatch]);
  const redo = useCallback(() => dispatch({ type: 'REDO' }), [dispatch]);

  // Expose to parent for keyboard shortcuts + 3D sync
  if (toolRef) {
    toolRef.current = {
      setTool: setActiveTool,
      undo,
      redo,
      getActiveTool: () => activeTool,
      getActiveColor: () => activeColor,
    };
  }

  const handlePixelChange = useCallback(
    (x: number, y: number, color: string) => {
      dispatch({ type: 'SET_PIXEL', x, y, color });
    },
    [dispatch],
  );

  const handlePixelsFill = useCallback(
    (changes: [number, number, string][]) => {
      dispatch({ type: 'SET_PIXELS', changes });
    },
    [dispatch],
  );

  const handleColorPick = useCallback((color: string) => {
    setActiveColor(color);
    setActiveTool('pencil');
  }, []);

  const toggleLayer = useCallback((layer: keyof LayerVisibility) => {
    setVisibility(v => ({ ...v, [layer]: !v[layer] }));
  }, []);

  const handleSave = useCallback(() => {
    if (!onSave) return;
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const c = pixels[y]?.[x];
        if (c) {
          ctx.fillStyle = c;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    onSave(pixels, canvas.toDataURL('image/png'));
  }, [pixels, onSave]);

  const hasChanges = pastLen > 0;

  // Compute zoom to fill viewport nicely
  const zoom = useMemo(() => {
    if (typeof window === 'undefined') return 14;
    const maxDim = Math.min(window.innerWidth * 0.7, window.innerHeight * 0.7);
    return Math.max(8, Math.min(20, Math.floor(maxDim / 32)));
  }, []);

  return (
    <div
      className={panelsOnly ? classes.panelsOverlay : classes.editorOverlay}
      onPointerDown={e => e.stopPropagation()}
    >
      {/* Pixel canvas — only in 2D mode (3D uses NounParallax EditableScene) */}
      {!panelsOnly && (
        <div className={classes.canvasWrap}>
          <PixelCanvas
            pixels={pixels}
            onPixelChange={handlePixelChange}
            onPixelsFill={handlePixelsFill}
            onColorPick={handleColorPick}
            activeColor={activeColor}
            activeTool={activeTool}
            zoom={zoom}
          />
        </div>
      )}

      {/* ── Tools + Layers panel (top-left) ──────────────────── */}
      <div className={`${classes.glassFloat} ${classes.toolsPanel}`}>
        <div className={classes.toolRow}>
          {(['pencil', 'eraser', 'fill', 'eyedropper'] as Tool[]).map(tool => (
            <button
              key={tool}
              className={`${classes.toolBtn} ${activeTool === tool ? classes.toolActive : ''}`}
              onClick={() => setActiveTool(tool)}
              title={tool[0].toUpperCase() + tool.slice(1)}
            >
              {tool === 'pencil' && '✏'}
              {tool === 'eraser' && '⌫'}
              {tool === 'fill' && '🪣'}
              {tool === 'eyedropper' && '💉'}
            </button>
          ))}
          <div className={classes.toolDivider} />
          <button
            className={classes.toolBtn}
            onClick={undo}
            disabled={pastLen === 0}
            title="Undo (Ctrl+Z)"
          >
            ↩
          </button>
          <button
            className={classes.toolBtn}
            onClick={redo}
            disabled={futureLen === 0}
            title="Redo (Ctrl+Y)"
          >
            ↪
          </button>
          <div className={classes.toolDivider} />
          <button
            className={classes.toolBtn}
            onClick={() => dispatch({ type: 'CLEAR' })}
            title="Clear all"
          >
            🗑
          </button>
        </div>

        {/* Layer toggles */}
        <div className={classes.layerToggles}>
          {LAYER_NAMES.map(({ key, label, emoji }) => (
            <button
              key={key}
              className={`${classes.layerBtn} ${visibility[key] ? classes.layerOn : classes.layerOff}`}
              onClick={() => toggleLayer(key)}
              title={`Toggle ${label}`}
            >
              <span>{emoji}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* Voxel depth slider (3D mode only) */}
        {panelsOnly && onVoxelDepthChange && (
          <div className={classes.depthSlider}>
            <span className={classes.depthLabel}>Depth</span>
            <input
              type="range"
              min="0.5"
              max="5"
              step="0.5"
              value={voxelDepth}
              onChange={e => onVoxelDepthChange(parseFloat(e.target.value))}
              className={classes.depthRange}
            />
            <span className={classes.depthValue}>{voxelDepth}</span>
          </div>
        )}
      </div>

      {/* ── Color palette (left) ─────────────────────────────── */}
      <div className={`${classes.glassFloat} ${classes.palettePanel}`}>
        <div className={classes.currentColor}>
          <div
            className={classes.colorSwatch}
            style={{
              background:
                activeColor || 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 8px 8px',
            }}
          />
          <span className={classes.colorHex}>{activeColor || 'none'}</span>
        </div>
        <div className={classes.paletteGrid}>
          <button
            className={`${classes.paletteSwatch} ${activeColor === '' ? classes.paletteActive : ''}`}
            onClick={() => setActiveColor('')}
            title="Transparent"
            style={{
              background: 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 6px 6px',
            }}
          />
          {displayPalette.map((color, i) => (
            <button
              key={`${color}-${i}`}
              className={`${classes.paletteSwatch} ${activeColor === color ? classes.paletteActive : ''}`}
              onClick={() => setActiveColor(color)}
              style={{ background: color }}
              title={color}
            />
          ))}
        </div>
        {palette.length > 64 && (
          <button className={classes.showMoreBtn} onClick={() => setPaletteExpanded(e => !e)}>
            {paletteExpanded ? 'Less' : `All ${palette.length}`}
          </button>
        )}
      </div>

      {/* ── Actions (top-right) ──────────────────────────────── */}
      <div className={`${classes.glassFloat} ${classes.actionsPanel}`}>
        {hasChanges && onSave && (
          <button className={classes.actionBtn} onClick={handleSave}>
            Save
          </button>
        )}
        <button className={`${classes.actionBtn} ${classes.exitBtn}`} onClick={onExit}>
          {hasChanges ? 'Discard' : 'Exit'}
        </button>
      </div>

      {/* Hint bar */}
      <div className={classes.hint}>
        <kbd>Esc</kbd> exit · <kbd>B</kbd> pencil · <kbd>E</kbd> eraser · <kbd>G</kbd> fill ·{' '}
        <kbd>I</kbd> picker · <kbd>Ctrl+Z</kbd> undo · Toggle layers to hide parts
      </div>
    </div>
  );
};

export default InlineEditor;
