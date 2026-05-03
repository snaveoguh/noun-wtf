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

import {
  BoxIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DownloadIcon,
  EraserIcon,
  GripHorizontalIcon,
  PaintBucketIcon,
  PencilIcon,
  PipetteIcon,
  Redo2Icon,
  Trash2Icon,
  Undo2Icon,
} from 'lucide-react';

import { PixelCanvas, type Tool } from '@/components/Studio/PixelCanvas';

type MeshTool = Tool | 'build';
import {
  mergeLayersToGrid,
  resolveEditableVisibility,
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
    setColor: (c: string) => void;
    undo: () => void;
    redo: () => void;
    getActiveTool: () => Tool;
    getActiveColor: () => string;
  } | null>;
  /** When true, only render floating panels (tools, palette, actions) — no 2D canvas. */
  panelsOnly?: boolean;
  /** Current voxel depth (3D voxel mode) */
  voxelDepth?: number;
  onVoxelDepthChange?: (depth: number) => void;
  /** Mesh editor brush size (3D mesh mode) */
  meshBrushSize?: number;
  onMeshBrushSizeChange?: (size: number) => void;
  /** Whether mesh editor is active (hides voxel-specific controls) */
  isMeshMode?: boolean;
  /** Controlled tool value — when provided, the editor's tool is driven by parent state. */
  activeTool?: Tool | 'build';
  /** Controlled color value — when provided, the editor's color is driven by parent state.
   *  Required so the eyedropper picked-color feeds back into the swatch and palette UI. */
  activeColor?: string;
  /** Callback when tool changes (needed in mesh mode to update parent state) */
  onToolChange?: (tool: Tool) => void;
  /** Callback when color changes (needed in mesh mode to update parent state) */
  onColorChange?: (color: string) => void;
  /** Download/export handler (mesh mode) — receives format string */
  onDownload?: (format: 'glb' | 'stl' | 'obj') => void;
  /** External pixel state from parent (for 3D mode sync). If provided, editor uses this instead of own reducer. */
  externalPixels?: string[][];
  externalDispatch?: React.Dispatch<import('@/lib/pixelHistory').HistoryAction>;
  externalPast?: string[][][];
  externalFuture?: string[][][];
  visibility?: LayerVisibility;
  onVisibilityChange?: (visibility: LayerVisibility) => void;
  /** Background color visibility (2D only). When false, exports are transparent
   *  behind the noun. Independent of the 4-layer trait toggles. */
  bgVisible?: boolean;
  onBgVisibilityChange?: (visible: boolean) => void;
  interactionMode?: 'sculpt' | 'grab' | 'twist';
  onInteractionModeChange?: (mode: 'sculpt' | 'grab' | 'twist') => void;
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
  bgVisible = true,
  onBgVisibilityChange,
  interactionMode = 'sculpt',
  onInteractionModeChange,
  voxelDepth = 1,
  onVoxelDepthChange,
  meshBrushSize = 1,
  onMeshBrushSizeChange,
  isMeshMode = false,
  activeTool: controlledTool,
  activeColor: controlledColor,
  onToolChange,
  onColorChange,
  onDownload,
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
  const visiblePixels = useMemo(
    () => resolveEditableVisibility(pixels, nounLayers, visibility),
    [nounLayers, pixels, visibility],
  );

  const [localActiveTool, setLocalActiveTool] = useState<MeshTool>('pencil');
  const [localActiveColor, setLocalActiveColor] = useState(() => {
    const grid = externalPixels ?? initialGrid;
    for (const row of grid) {
      for (const c of row) {
        if (c) return c;
      }
    }
    return '#000000';
  });

  // Use controlled values when provided (3D mode passes parent state).
  // setActiveTool/setActiveColor always update local state and notify the parent
  // via onToolChange/onColorChange — this keeps the swatch UI in sync after the
  // 3D scene's eyedropper picks a color (parent-side onColorPick).
  const activeTool: MeshTool = controlledTool ?? localActiveTool;
  const activeColor = controlledColor ?? localActiveColor;
  const setActiveTool = useCallback(
    (tool: MeshTool) => {
      setLocalActiveTool(tool);
      // onToolChange takes Tool but in mesh mode parent accepts 'build' too
      // (parent's setEdit3dTool is typed Tool | 'build')
      (onToolChange as ((t: MeshTool) => void) | undefined)?.(tool);
    },
    [onToolChange],
  );
  const setActiveColor = useCallback(
    (color: string) => {
      setLocalActiveColor(color);
      onColorChange?.(color);
    },
    [onColorChange],
  );
  const [paletteExpanded, setPaletteExpanded] = useState(false);
  const [collapsedPanels, setCollapsedPanels] = useState<Record<PanelKey, boolean>>({
    tools: false,
    palette: false,
    actions: false,
  });
  const toggleCollapse = useCallback(
    (key: PanelKey) => setCollapsedPanels(prev => ({ ...prev, [key]: !prev[key] })),
    [],
  );
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

  // Expose to parent for keyboard shortcuts + 3D sync.
  // Must live in useEffect so the ref is assigned after mount and cleaned up
  // on unmount — assigning in the render body can be lost across Suspense
  // boundaries or concurrent renders, causing the eyedropper race condition.
  useEffect(() => {
    if (!toolRef) return;
    toolRef.current = {
      setTool: (t: Tool) => setActiveTool(t),
      setColor: setActiveColor,
      undo,
      redo,
      getActiveTool: () => (activeTool === 'build' ? 'pencil' : activeTool),
      getActiveColor: () => activeColor,
    };
    return () => {
      toolRef.current = null;
    };
  }, [toolRef, activeTool, activeColor, undo, redo, setActiveTool, setActiveColor]);

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

  const handleColorPick = useCallback(
    (color: string) => {
      setActiveColor(color);
      setActiveTool('pencil');
    },
    [setActiveColor, setActiveTool],
  );

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
      const rawX = drag.originX + (event.clientX - drag.startX);
      const rawY = drag.originY + (event.clientY - drag.startY);
      // Clamp: keep at least 50px of the panel visible on each edge
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Panels are positioned relative to their CSS initial position (top/left in the overlay)
      // rawX/rawY are translate offsets from that initial position
      // Clamp so the panel handle never leaves the viewport
      setPanelOffsets(prev => ({
        ...prev,
        [drag.key]: {
          x: Math.max(-(vw - 50), Math.min(vw - 50, rawX)),
          y: Math.max(-50, Math.min(vh - 50, rawY)),
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
            activeTool={activeTool === 'build' ? 'pencil' : activeTool}
            zoom={zoom}
          />
        </div>
      )}

      {/* ── Tools + Layers panel (top-left) ──────────────────── */}
      <div className={`${classes.glassFloat} ${classes.toolsPanel}`} style={getPanelStyle('tools')}>
        <div className={classes.panelHandle} onPointerDown={startDraggingPanel('tools')}>
          <GripHorizontalIcon size={14} strokeWidth={2} className={classes.panelHandleDots} />
          <span className={classes.panelHandleLabel}>Tools</span>
          <button
            type="button"
            className={classes.collapseBtn}
            onClick={() => toggleCollapse('tools')}
          >
            {collapsedPanels.tools ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
          </button>
        </div>
        {!collapsedPanels.tools && (
          <>
            <div className={classes.toolRow}>
              {[
                { id: 'pencil' as MeshTool, icon: PencilIcon, label: 'Paint (B)', key: 'b' },
                { id: 'eraser' as MeshTool, icon: EraserIcon, label: 'Erase (E)', key: 'e' },
                { id: 'fill' as MeshTool, icon: PaintBucketIcon, label: 'Fill (G)', key: 'g' },
                { id: 'eyedropper' as MeshTool, icon: PipetteIcon, label: 'Pick (I)', key: 'i' },
                ...(isMeshMode
                  ? [{ id: 'build' as MeshTool, icon: BoxIcon, label: 'Build (V)', key: 'v' }]
                  : []),
              ].map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  type="button"
                  className={`${classes.toolBtn} ${activeTool === id ? classes.toolActive : ''}`}
                  onClick={() => setActiveTool(id)}
                  title={label}
                >
                  <Icon size={16} strokeWidth={2} />
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
                <Undo2Icon size={16} strokeWidth={2} />
              </button>
              <button
                type="button"
                className={classes.toolBtn}
                onClick={redo}
                disabled={futureLen === 0}
                title="Redo (Ctrl+Y)"
              >
                <Redo2Icon size={16} strokeWidth={2} />
              </button>
              <div className={classes.toolDivider} />
              <button
                type="button"
                className={classes.toolBtn}
                onClick={() => dispatch({ type: 'CLEAR' })}
                title="Clear all"
              >
                <Trash2Icon size={16} strokeWidth={2} />
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
              {/* Background visibility (2D only — affects download bg) */}
              {!panelsOnly && onBgVisibilityChange && (
                <button
                  type="button"
                  className={`${classes.layerBtn} ${bgVisible ? classes.layerOn : classes.layerOff}`}
                  onClick={() => onBgVisibilityChange(!bgVisible)}
                  title="Toggle background (off = transparent download)"
                >
                  <span>🎨</span>
                  <span>BG</span>
                </button>
              )}
            </div>

            {/* Brush size slider (3D mode) */}
            {panelsOnly && isMeshMode && onMeshBrushSizeChange && (
              <div className={classes.depthSlider}>
                <span className={classes.depthLabel}>Brush</span>
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  value={meshBrushSize}
                  onChange={e => onMeshBrushSizeChange(parseInt(e.target.value, 10))}
                  className={classes.depthRange}
                />
                <span className={classes.depthValue}>{meshBrushSize}</span>
              </div>
            )}
            {/* Voxel depth slider (3D voxel mode only) */}
            {panelsOnly && !isMeshMode && onVoxelDepthChange && (
              <div className={classes.depthSlider}>
                <span className={classes.depthLabel}>Depth</span>
                <input
                  type="range"
                  min="1"
                  max="4"
                  step="1"
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
                  Build
                </button>
                <button
                  type="button"
                  className={`${classes.modeBtn} ${interactionMode === 'grab' ? classes.modeBtnActive : ''}`}
                  onClick={() => onInteractionModeChange('grab')}
                >
                  Grab
                </button>
                <button
                  type="button"
                  className={`${classes.modeBtn} ${interactionMode === 'twist' ? classes.modeBtnActive : ''}`}
                  onClick={() => onInteractionModeChange('twist')}
                >
                  Twist
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Color palette (left) ─────────────────────────────── */}
      <div
        className={`${classes.glassFloat} ${classes.palettePanel}`}
        style={getPanelStyle('palette')}
      >
        <div className={classes.panelHandle} onPointerDown={startDraggingPanel('palette')}>
          <GripHorizontalIcon size={14} strokeWidth={2} className={classes.panelHandleDots} />
          <span className={classes.panelHandleLabel}>Palette</span>
          <button
            type="button"
            className={classes.collapseBtn}
            onClick={() => toggleCollapse('palette')}
          >
            {collapsedPanels.palette ? (
              <ChevronRightIcon size={12} />
            ) : (
              <ChevronDownIcon size={12} />
            )}
          </button>
        </div>
        {!collapsedPanels.palette && (
          <>
            <div className={classes.currentColor}>
              <div
                className={classes.colorSwatch}
                style={{
                  background:
                    activeColor ||
                    'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 8px 8px',
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
          </>
        )}
      </div>

      {/* ── Actions (top-right) ──────────────────────────────── */}
      <div
        className={`${classes.glassFloat} ${classes.actionsPanel}`}
        style={getPanelStyle('actions')}
      >
        <div className={classes.panelHandle} onPointerDown={startDraggingPanel('actions')}>
          <GripHorizontalIcon size={14} strokeWidth={2} className={classes.panelHandleDots} />
          <span className={classes.panelHandleLabel}>Actions</span>
          <button
            type="button"
            className={classes.collapseBtn}
            onClick={() => toggleCollapse('actions')}
          >
            {collapsedPanels.actions ? (
              <ChevronRightIcon size={12} />
            ) : (
              <ChevronDownIcon size={12} />
            )}
          </button>
        </div>
        {!collapsedPanels.actions && (
          <>
            {hasChanges && onSave && (
              <button type="button" className={classes.actionBtn} onClick={handleSave}>
                Save
              </button>
            )}
            {onDownload && (
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  className={classes.actionBtn}
                  onClick={() => onDownload('glb')}
                  title="GLB (universal 3D)"
                >
                  <DownloadIcon
                    size={14}
                    strokeWidth={2}
                    style={{ marginRight: 3, verticalAlign: -2 }}
                  />
                  GLB
                </button>
                <button
                  type="button"
                  className={`${classes.actionBtn} ${classes.exitBtn}`}
                  onClick={() => onDownload('stl')}
                  title="STL (3D printer)"
                >
                  STL
                </button>
                <button
                  type="button"
                  className={`${classes.actionBtn} ${classes.exitBtn}`}
                  onClick={() => onDownload('obj')}
                  title="OBJ (modeling)"
                >
                  OBJ
                </button>
              </div>
            )}
            <button
              type="button"
              className={`${classes.actionBtn} ${classes.exitBtn}`}
              onClick={onExit}
            >
              {hasChanges ? 'Discard' : 'Exit'}
            </button>
          </>
        )}
      </div>

      {/* Hint bar */}
      <div className={classes.hint}>
        <kbd>Esc</kbd> exit · <kbd>B</kbd> paint · <kbd>E</kbd> erase · <kbd>G</kbd> fill ·{' '}
        <kbd>I</kbd> pick
        {isMeshMode && (
          <>
            {' '}
            · <kbd>V</kbd> build
          </>
        )}{' '}
        · <kbd>Ctrl+Z</kbd> undo
      </div>
    </div>
  );
};

export default InlineEditor;
