/**
 * InlineEditor — Seamless Noun pixel editor.
 *
 * Pre-loads the current Noun's actual pixels from its seed.
 * In 2D mode: PixelCanvas sits over the hero artwork but keeps its own editor
 * background so erased pixels don't reveal the original noun underneath.
 * Layer visibility toggles let you hide/show body parts.
 * Tools, palette, and actions in floating glass panels.
 */
import {
  FC,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import { PixelCanvas, type Tool } from '@/components/Studio/PixelCanvas';
import {
  applyVisibilityMask,
  buildVisibilityMask,
  mergeLayersToGrid,
  seedToPixelLayers,
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
  visibility?: LayerVisibility;
  onVisibilityChange?: (visibility: LayerVisibility) => void;
  interactionMode?: 'sculpt' | 'orbit';
  onInteractionModeChange?: (mode: 'sculpt' | 'orbit') => void;
}

type PanelKey = 'tools' | 'palette' | 'actions';

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
  visibility: controlledVisibility,
  onVisibilityChange,
  interactionMode = 'sculpt',
  onInteractionModeChange,
  voxelDepth = 1,
  onVoxelDepthChange,
}) => {
  void _nounSvg;
  // Decode seed into per-layer pixel grids
  const nounLayers: NounPixelLayers = useMemo(() => seedToPixelLayers(seed), [seed]);

  // Layer visibility
  const [localVisibility, setLocalVisibility] = useState<LayerVisibility>({
    ...DEFAULT_VISIBILITY,
  });
  const visibility = controlledVisibility ?? localVisibility;

  // Merge visible layers into initial grid
  const initialGrid = useMemo(
    () => mergeLayersToGrid(nounLayers, DEFAULT_VISIBILITY),
    [nounLayers],
  );

  // History (undo/redo) — internal state (used in 2D mode)
  const [internalHistory, internalDispatch] = useReducer(historyReducer, {
    past: [],
    present: initialGrid,
    future: [],
  });

  // Use external or internal state
  const pixels = externalPixels ?? internalHistory.present;
  const dispatch = externalDispatch ?? internalDispatch;
  const pastLen = externalPast?.length ?? internalHistory.past.length;
  const futureLen = externalFuture?.length ?? internalHistory.future.length;
  const visibilityMask = useMemo(
    () => buildVisibilityMask(nounLayers, visibility),
    [nounLayers, visibility],
  );
  const visiblePixels = useMemo(
    () => applyVisibilityMask(pixels, visibilityMask),
    [pixels, visibilityMask],
  );

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
  const [panelOffsets, setPanelOffsets] = useState<Record<PanelKey, { x: number; y: number }>>({
    tools: { x: 0, y: 0 },
    palette: { x: 0, y: 0 },
    actions: { x: 0, y: 0 },
  });
  const dragRef = useRef<{
    key: PanelKey;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

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

  const toggleLayer = useCallback(
    (layer: keyof LayerVisibility) => {
      const next = { ...visibility, [layer]: !visibility[layer] };
      if (controlledVisibility) {
        onVisibilityChange?.(next);
        return;
      }
      setLocalVisibility(next);
      onVisibilityChange?.(next);
    },
    [controlledVisibility, onVisibilityChange, visibility],
  );

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

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setPanelOffsets(prev => ({
        ...prev,
        [drag.key]: {
          x: drag.originX + (event.clientX - drag.startX),
          y: drag.originY + (event.clientY - drag.startY),
        },
      }));
    };

    const onPointerUp = () => {
      dragRef.current = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  const startDraggingPanel = useCallback(
    (key: PanelKey) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = {
        key,
        startX: event.clientX,
        startY: event.clientY,
        originX: panelOffsets[key].x,
        originY: panelOffsets[key].y,
      };
    },
    [panelOffsets],
  );

  const getPanelStyle = useCallback(
    (key: PanelKey) => ({
      transform: `translate3d(${panelOffsets[key].x}px, ${panelOffsets[key].y}px, 0)`,
    }),
    [panelOffsets],
  );

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
            pixels={visiblePixels}
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
      <div className={`${classes.glassFloat} ${classes.toolsPanel}`} style={getPanelStyle('tools')}>
        <div className={classes.panelHandle} onPointerDown={startDraggingPanel('tools')}>
          <span className={classes.panelHandleDots}>:::</span>
          <span className={classes.panelHandleLabel}>Tools</span>
        </div>
        <div className={classes.toolRow}>
          {(['pencil', 'eraser', 'fill', 'eyedropper'] as Tool[]).map(tool => (
            <button
              key={tool}
              type="button"
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
            type="button"
            className={classes.toolBtn}
            onClick={undo}
            disabled={pastLen === 0}
            title="Undo (Ctrl+Z)"
          >
            ↩
          </button>
          <button
            type="button"
            className={classes.toolBtn}
            onClick={redo}
            disabled={futureLen === 0}
            title="Redo (Ctrl+Y)"
          >
            ↪
          </button>
          <div className={classes.toolDivider} />
          <button
            type="button"
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
              type="button"
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

        {panelsOnly && onInteractionModeChange && (
          <div className={classes.editorModeRow}>
            <button
              type="button"
              className={`${classes.modeBtn} ${interactionMode === 'sculpt' ? classes.modeBtnActive : ''}`}
              onClick={() => onInteractionModeChange('sculpt')}
            >
              Sculpt
            </button>
            <button
              type="button"
              className={`${classes.modeBtn} ${interactionMode === 'orbit' ? classes.modeBtnActive : ''}`}
              onClick={() => onInteractionModeChange('orbit')}
            >
              Twist
            </button>
          </div>
        )}
      </div>

      {/* ── Color palette (left) ─────────────────────────────── */}
      <div
        className={`${classes.glassFloat} ${classes.palettePanel}`}
        style={getPanelStyle('palette')}
      >
        <div className={classes.panelHandle} onPointerDown={startDraggingPanel('palette')}>
          <span className={classes.panelHandleDots}>:::</span>
          <span className={classes.panelHandleLabel}>Palette</span>
        </div>
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
            type="button"
            className={`${classes.paletteSwatch} ${activeColor === '' ? classes.paletteActive : ''}`}
            onClick={() => setActiveColor('')}
            title="Transparent"
            style={{
              background: 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 6px 6px',
            }}
          />
          {displayPalette.map(color => (
            <button
              key={color}
              type="button"
              className={`${classes.paletteSwatch} ${activeColor === color ? classes.paletteActive : ''}`}
              onClick={() => setActiveColor(color)}
              style={{ background: color }}
              title={color}
            />
          ))}
        </div>
        {palette.length > 64 && (
          <button
            type="button"
            className={classes.showMoreBtn}
            onClick={() => setPaletteExpanded(e => !e)}
          >
            {paletteExpanded ? 'Less' : `All ${palette.length}`}
          </button>
        )}
      </div>

      {/* ── Actions (top-right) ──────────────────────────────── */}
      <div
        className={`${classes.glassFloat} ${classes.actionsPanel}`}
        style={getPanelStyle('actions')}
      >
        <div className={classes.panelHandle} onPointerDown={startDraggingPanel('actions')}>
          <span className={classes.panelHandleDots}>:::</span>
          <span className={classes.panelHandleLabel}>Actions</span>
        </div>
        {hasChanges && onSave && (
          <button type="button" className={classes.actionBtn} onClick={handleSave}>
            Save
          </button>
        )}
        <button
          type="button"
          className={`${classes.actionBtn} ${classes.exitBtn}`}
          onClick={onExit}
        >
          {hasChanges ? 'Discard' : 'Exit'}
        </button>
      </div>

      {/* Hint bar */}
      <div className={classes.hint}>
        <kbd>Esc</kbd> exit · <kbd>B</kbd> pencil · <kbd>E</kbd> eraser · <kbd>G</kbd> fill ·{' '}
        <kbd>I</kbd> picker · <kbd>Ctrl+Z</kbd> undo · Drag the panel grips to move them
      </div>
    </div>
  );
};

export default InlineEditor;
