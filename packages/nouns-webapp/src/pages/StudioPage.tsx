import { FC, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { ImageData } from '@noundry/nouns-assets';
import {
  ChevronDown,
  ChevronUp,
  Crop,
  Dice5,
  Download,
  Eraser,
  Eye,
  EyeOff,
  FolderOpen,
  PaintBucket,
  Pencil,
  Pipette,
  RotateCcw,
  RotateCw,
  Save,
  ScrollText,
  Trash2,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router';

import { TraitPreview, type LayerVisibility } from '@/components/Studio/TraitPreview';
import { traitName } from '@/lib/traitName';
import { INounSeed } from '@/wrappers/nounToken';

// ── Types ──
type Tool = 'pencil' | 'eraser' | 'fill' | 'eyedropper' | 'select';

interface SavedTrait {
  id: string;
  name: string;
  pixels: string[][];
  traitType: string;
  createdAt: number;
  thumbnail?: string;
}

// ── LocalStorage helpers ──
const STORAGE_KEY = 'noun-wtf-studio-traits';

function loadSavedTraits(): SavedTrait[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveTrait(trait: SavedTrait) {
  const traits = loadSavedTraits();
  traits.unshift(trait);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(traits.slice(0, 50)));
}

function deleteSavedTrait(id: string) {
  const traits = loadSavedTraits().filter(t => t.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(traits));
}

function pixelsToThumbnail(pixels: string[][], region?: SelectionRegion): string {
  const canvas = document.createElement('canvas');
  const sx = region?.x ?? 0;
  const sy = region?.y ?? 0;
  const sw = region?.w ?? 32;
  const sh = region?.h ?? 32;
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const color = pixels[sy + y]?.[sx + x];
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return canvas.toDataURL('image/png');
}

interface SelectionRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── Grid constants ──
const GRID_SIZE = 32;

function createEmptyGrid(): string[][] {
  return Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(''));
}

// ── Undo/Redo ──
type HistoryAction =
  | { type: 'SET_PIXEL'; x: number; y: number; color: string }
  | { type: 'SET_PIXELS'; changes: [number, number, string][] }
  | { type: 'CLEAR' }
  | { type: 'LOAD'; pixels: string[][] }
  | { type: 'UNDO' }
  | { type: 'REDO' };

interface HistoryState {
  past: string[][][];
  present: string[][];
  future: string[][][];
}

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'SET_PIXEL': {
      const newGrid = state.present.map(row => [...row]);
      newGrid[action.y][action.x] = action.color;
      return { past: [...state.past.slice(-50), state.present], present: newGrid, future: [] };
    }
    case 'SET_PIXELS': {
      const newGrid = state.present.map(row => [...row]);
      for (const [x, y, color] of action.changes) newGrid[y][x] = color;
      return { past: [...state.past.slice(-50), state.present], present: newGrid, future: [] };
    }
    case 'CLEAR':
      return {
        past: [...state.past.slice(-50), state.present],
        present: createEmptyGrid(),
        future: [],
      };
    case 'LOAD':
      return {
        past: [...state.past.slice(-50), state.present],
        present: action.pixels.map(row => [...row]),
        future: [],
      };
    case 'UNDO':
      if (state.past.length === 0) return state;
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future],
      };
    case 'REDO':
      if (state.future.length === 0) return state;
      return {
        past: [...state.past, state.present],
        present: state.future[0],
        future: state.future.slice(1),
      };
    default:
      return state;
  }
}

// ── Main component ──
const StudioPage: FC = () => {
  const navigate = useNavigate();
  const [history, dispatch] = useReducer(historyReducer, {
    past: [],
    present: createEmptyGrid(),
    future: [],
  });

  // Drawing state
  const [activeTool, setActiveTool] = useState<Tool>('pencil');
  const [activeColor, setActiveColor] = useState('#e1d7d5');
  const [traitName_, setTraitName] = useState('');
  const [traitType, setTraitType] = useState('head');
  const [savedTraits, setSavedTraits] = useState<SavedTrait[]>([]);
  const [showGallery, setShowGallery] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [showPalette, setShowPalette] = useState(true);

  // Selection state for export
  const [selection, setSelection] = useState<SelectionRegion | null>(null);
  const [selectStart, setSelectStart] = useState<{ x: number; y: number } | null>(null);

  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 });
  const [pixelSize, setPixelSize] = useState(20);

  // Layer visibility
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>({
    background: true,
    body: true,
    accessory: true,
    head: true,
    glasses: true,
  });

  // Preview seed
  const [previewSeed, setPreviewSeed] = useState<INounSeed>({
    background: 0,
    body: Math.floor(Math.random() * ImageData.images.bodies.length),
    accessory: Math.floor(Math.random() * ImageData.images.accessories.length),
    head: Math.floor(Math.random() * ImageData.images.heads.length),
    glasses: Math.floor(Math.random() * ImageData.images.glasses.length),
  });

  // Load saved traits
  useEffect(() => {
    setSavedTraits(loadSavedTraits());
  }, []);

  // Center canvas on mount and resize
  useEffect(() => {
    const updateCenter = () => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const canvasW = GRID_SIZE * pixelSize;
      const canvasH = GRID_SIZE * pixelSize;
      setCanvasOffset({
        x: Math.max(0, (rect.width - canvasW) / 2),
        y: Math.max(0, (rect.height - canvasH) / 2),
      });
    };
    updateCenter();
    window.addEventListener('resize', updateCenter);
    return () => window.removeEventListener('resize', updateCenter);
  }, [pixelSize]);

  // Trait options
  const traitOptions = useMemo(
    () => ({
      heads: Array.from({ length: ImageData.images.heads.length }, (_, i) => ({
        index: i,
        name: traitName('head', i),
      })),
      bodies: Array.from({ length: ImageData.images.bodies.length }, (_, i) => ({
        index: i,
        name: traitName('body', i),
      })),
      accessories: Array.from({ length: ImageData.images.accessories.length }, (_, i) => ({
        index: i,
        name: traitName('accessory', i),
      })),
      glasses: Array.from({ length: ImageData.images.glasses.length }, (_, i) => ({
        index: i,
        name: traitName('glasses', i),
      })),
    }),
    [],
  );

  // ── Canvas drawing ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const cw = GRID_SIZE * pixelSize;
    const ch = GRID_SIZE * pixelSize;
    canvas.width = cw;
    canvas.height = ch;

    // Checkerboard background
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const isLight = (x + y) % 2 === 0;
        ctx.fillStyle = isLight ? '#f5f5f5' : '#e0e0e0';
        ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
      }
    }

    // Draw pixels
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const color = history.present[y]?.[x];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
        }
      }
    }

    // Grid lines
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= GRID_SIZE; x++) {
      ctx.beginPath();
      ctx.moveTo(x * pixelSize, 0);
      ctx.lineTo(x * pixelSize, ch);
      ctx.stroke();
    }
    for (let y = 0; y <= GRID_SIZE; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * pixelSize);
      ctx.lineTo(cw, y * pixelSize);
      ctx.stroke();
    }

    // Selection rectangle
    if (selection) {
      ctx.strokeStyle = '#7c3aed';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(
        selection.x * pixelSize,
        selection.y * pixelSize,
        selection.w * pixelSize,
        selection.h * pixelSize,
      );
      ctx.setLineDash([]);

      // Semi-transparent overlay outside selection
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      // Top
      ctx.fillRect(0, 0, cw, selection.y * pixelSize);
      // Bottom
      ctx.fillRect(
        0,
        (selection.y + selection.h) * pixelSize,
        cw,
        ch - (selection.y + selection.h) * pixelSize,
      );
      // Left
      ctx.fillRect(
        0,
        selection.y * pixelSize,
        selection.x * pixelSize,
        selection.h * pixelSize,
      );
      // Right
      ctx.fillRect(
        (selection.x + selection.w) * pixelSize,
        selection.y * pixelSize,
        cw - (selection.x + selection.w) * pixelSize,
        selection.h * pixelSize,
      );
    }
  }, [history.present, pixelSize, selection]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Pixel coords from mouse event
  const getPixelCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = Math.floor(((e.clientX - rect.left) * scaleX) / pixelSize);
      const y = Math.floor(((e.clientY - rect.top) * scaleY) / pixelSize);
      if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return null;
      return { x, y };
    },
    [pixelSize],
  );

  // Flood fill
  const floodFill = useCallback(
    (startX: number, startY: number, fillColor: string) => {
      const targetColor = history.present[startY]?.[startX] || '';
      if (targetColor === fillColor) return;
      const changes: [number, number, string][] = [];
      const visited = new Set<string>();
      const queue: [number, number][] = [[startX, startY]];
      while (queue.length > 0) {
        const [x, y] = queue.shift()!;
        const key = `${x},${y}`;
        if (visited.has(key)) continue;
        if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) continue;
        if ((history.present[y]?.[x] || '') !== targetColor) continue;
        visited.add(key);
        changes.push([x, y, fillColor]);
        queue.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
      }
      if (changes.length > 0) dispatch({ type: 'SET_PIXELS', changes });
    },
    [history.present],
  );

  // Handle tool actions
  const handleAction = useCallback(
    (x: number, y: number) => {
      switch (activeTool) {
        case 'pencil':
          dispatch({ type: 'SET_PIXEL', x, y, color: activeColor });
          break;
        case 'eraser':
          dispatch({ type: 'SET_PIXEL', x, y, color: '' });
          break;
        case 'fill':
          floodFill(x, y, activeColor);
          break;
        case 'eyedropper': {
          const color = history.present[y]?.[x];
          if (color) {
            setActiveColor(color);
            setActiveTool('pencil');
          }
          break;
        }
        // select handled separately
      }
    },
    [activeTool, activeColor, floodFill, history.present],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const coords = getPixelCoords(e);
      if (!coords) return;

      if (activeTool === 'select') {
        setSelectStart(coords);
        setSelection(null);
        return;
      }

      setIsDrawing(true);
      handleAction(coords.x, coords.y);
    },
    [getPixelCoords, activeTool, handleAction],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const coords = getPixelCoords(e);
      if (!coords) return;

      if (activeTool === 'select' && selectStart) {
        const x = Math.min(selectStart.x, coords.x);
        const y = Math.min(selectStart.y, coords.y);
        const w = Math.abs(coords.x - selectStart.x) + 1;
        const h = Math.abs(coords.y - selectStart.y) + 1;
        setSelection({ x, y, w, h });
        return;
      }

      if (!isDrawing) return;
      if (activeTool === 'fill' || activeTool === 'eyedropper') return;
      handleAction(coords.x, coords.y);
    },
    [getPixelCoords, activeTool, selectStart, isDrawing, handleAction],
  );

  const handleMouseUp = useCallback(() => {
    setIsDrawing(false);
    if (activeTool === 'select') {
      setSelectStart(null);
    }
  }, [activeTool]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: 'UNDO' });
      }
      if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        dispatch({ type: 'REDO' });
      }
      if (e.key === 'b' || e.key === 'p') setActiveTool('pencil');
      if (e.key === 'e') setActiveTool('eraser');
      if (e.key === 'g') setActiveTool('fill');
      if (e.key === 'i') setActiveTool('eyedropper');
      if (e.key === 's' && !mod) setActiveTool('select');
      if (e.key === 'Escape') setSelection(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Zoom with scroll wheel
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setPixelSize(prev => Math.min(40, Math.max(8, prev + (e.deltaY > 0 ? -2 : 2))));
    };
    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handler, { passive: false });
      return () => container.removeEventListener('wheel', handler);
    }
  }, []);

  const hasPixels = useMemo(
    () => history.present.some(row => row.some(c => c !== '')),
    [history.present],
  );

  // ── Actions ──
  const handleSave = useCallback(() => {
    if (!hasPixels) return;
    const name = traitName_ || `Untitled ${traitType}`;
    const trait: SavedTrait = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      pixels: history.present,
      traitType,
      createdAt: Date.now(),
      thumbnail: pixelsToThumbnail(history.present),
    };
    saveTrait(trait);
    setSavedTraits(loadSavedTraits());
    setTraitName('');
  }, [history.present, traitName_, traitType, hasPixels]);

  const handleLoad = useCallback((trait: SavedTrait) => {
    dispatch({ type: 'LOAD', pixels: trait.pixels });
    setTraitType(trait.traitType);
    setTraitName(trait.name);
    setShowGallery(false);
  }, []);

  const handleDelete = useCallback((id: string) => {
    deleteSavedTrait(id);
    setSavedTraits(loadSavedTraits());
  }, []);

  const exportPNG = useCallback(
    (region?: SelectionRegion | null) => {
      const r = region || { x: 0, y: 0, w: GRID_SIZE, h: GRID_SIZE };
      const canvas = document.createElement('canvas');
      canvas.width = r.w;
      canvas.height = r.h;
      const ctx = canvas.getContext('2d')!;
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
          const color = history.present[r.y + y]?.[r.x + x];
          if (color) {
            ctx.fillStyle = color;
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }
      const link = document.createElement('a');
      link.download = `noun-trait-${r.w}x${r.h}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    },
    [history.present],
  );

  const handlePropose = useCallback(() => {
    if (!hasPixels) return;
    const name = traitName_ || `New ${traitType} trait`;
    const thumbnail = pixelsToThumbnail(history.present);
    handleSave();
    const description = `# Add New Noun Trait: ${name}\n\n## Trait Type\n${traitType}\n\n## Description\nThis proposal adds a new **${traitType}** trait "${name}" to the Nouns art collection.\n\nCreated with the Noundry Studio on noun.wtf.\n\n## Preview\n![${name}](${thumbnail})`;
    sessionStorage.setItem('studio-proposal-description', description);
    sessionStorage.setItem('studio-proposal-title', `Add Noun Trait: ${name}`);
    navigate('/create-proposal');
  }, [history.present, traitName_, traitType, hasPixels, handleSave, navigate]);

  const randomizeSeed = useCallback(() => {
    setPreviewSeed({
      background: Math.floor(Math.random() * ImageData.bgcolors.length),
      body: Math.floor(Math.random() * ImageData.images.bodies.length),
      accessory: Math.floor(Math.random() * ImageData.images.accessories.length),
      head: Math.floor(Math.random() * ImageData.images.heads.length),
      glasses: Math.floor(Math.random() * ImageData.images.glasses.length),
    });
  }, []);

  const toggleLayer = useCallback((layer: keyof LayerVisibility) => {
    setLayerVisibility(prev => ({ ...prev, [layer]: !prev[layer] }));
  }, []);

  // Nouns palette colors
  const nounsPalette = useMemo(() => ImageData.palette.map(hex => `#${hex}`), []);
  const extraColors = [
    '#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00',
    '#ff00ff', '#00ffff', '#ff8800', '#8800ff', '#888888', '#cccccc',
  ];
  const allColors = useMemo(() => [...new Set([...extraColors, ...nounsPalette])], [nounsPalette]);

  const canvasW = GRID_SIZE * pixelSize;
  const canvasH = GRID_SIZE * pixelSize;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: 'calc(100vh - 73px)',
        overflow: 'hidden',
        background: '#2a2a2a',
        cursor:
          activeTool === 'eyedropper'
            ? 'crosshair'
            : activeTool === 'select'
              ? 'crosshair'
              : activeTool === 'fill'
                ? 'cell'
                : 'default',
      }}
    >
      {/* ─── Main canvas ─── */}
      <canvas
        ref={canvasRef}
        width={canvasW}
        height={canvasH}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          setIsDrawing(false);
          if (activeTool === 'select') setSelectStart(null);
        }}
        style={{
          position: 'absolute',
          left: canvasOffset.x,
          top: canvasOffset.y,
          width: canvasW,
          height: canvasH,
          imageRendering: 'pixelated',
          boxShadow: '0 0 40px rgba(0,0,0,0.5)',
          borderRadius: '4px',
        }}
      />

      {/* ─── Top toolbar ─── */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(8px)',
          padding: '6px 10px',
          borderRadius: '12px',
          boxShadow: '0 2px 20px rgba(0,0,0,0.2)',
          zIndex: 10,
        }}
      >
        {/* Drawing tools */}
        {(
          [
            ['pencil', Pencil, 'Pencil (B)'],
            ['eraser', Eraser, 'Eraser (E)'],
            ['fill', PaintBucket, 'Fill (G)'],
            ['eyedropper', Pipette, 'Eyedropper (I)'],
            ['select', Crop, 'Select area (S)'],
          ] as const
        ).map(([tool, Icon, label]) => (
          <button
            key={tool}
            onClick={() => setActiveTool(tool)}
            title={label}
            style={{
              width: 34,
              height: 34,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '8px',
              border: 'none',
              background: activeTool === tool ? '#7c3aed' : 'transparent',
              color: activeTool === tool ? '#fff' : '#333',
              cursor: 'pointer',
              transition: 'all 0.1s',
            }}
          >
            <Icon style={{ width: 16, height: 16 }} />
          </button>
        ))}

        <div style={{ width: 1, height: 24, background: '#ddd', margin: '0 4px' }} />

        {/* Undo / Redo */}
        <button
          onClick={() => dispatch({ type: 'UNDO' })}
          disabled={history.past.length === 0}
          title="Undo (Ctrl+Z)"
          style={{
            width: 34,
            height: 34,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '8px',
            border: 'none',
            background: 'transparent',
            color: history.past.length === 0 ? '#ccc' : '#333',
            cursor: history.past.length === 0 ? 'default' : 'pointer',
          }}
        >
          <RotateCcw style={{ width: 16, height: 16 }} />
        </button>
        <button
          onClick={() => dispatch({ type: 'REDO' })}
          disabled={history.future.length === 0}
          title="Redo (Ctrl+Y)"
          style={{
            width: 34,
            height: 34,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '8px',
            border: 'none',
            background: 'transparent',
            color: history.future.length === 0 ? '#ccc' : '#333',
            cursor: history.future.length === 0 ? 'default' : 'pointer',
          }}
        >
          <RotateCw style={{ width: 16, height: 16 }} />
        </button>

        <div style={{ width: 1, height: 24, background: '#ddd', margin: '0 4px' }} />

        <button
          onClick={() => dispatch({ type: 'CLEAR' })}
          title="Clear canvas"
          style={{
            width: 34,
            height: 34,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '8px',
            border: 'none',
            background: 'transparent',
            color: '#ef4444',
            cursor: 'pointer',
          }}
        >
          <Trash2 style={{ width: 16, height: 16 }} />
        </button>

        <div style={{ width: 1, height: 24, background: '#ddd', margin: '0 4px' }} />

        {/* Active color swatch */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '6px',
            border: '2px solid #333',
            background: activeColor || 'repeating-conic-gradient(#e8e8e8 0% 25%, #c8c8c8 0% 50%) 50% / 8px 8px',
            cursor: 'pointer',
            flexShrink: 0,
          }}
          onClick={() => setShowPalette(p => !p)}
          title="Toggle color palette"
        />

        <div style={{ width: 1, height: 24, background: '#ddd', margin: '0 4px' }} />

        {/* Zoom display */}
        <span
          style={{
            fontSize: '0.7rem',
            fontWeight: 700,
            color: '#666',
            whiteSpace: 'nowrap',
            userSelect: 'none',
          }}
        >
          {pixelSize}px
        </span>
        <input
          type="range"
          min={8}
          max={40}
          step={2}
          value={pixelSize}
          onChange={e => setPixelSize(Number(e.target.value))}
          style={{ width: 60 }}
          title="Zoom (Ctrl+scroll)"
        />
      </div>

      {/* ─── Color palette (bottom) ─── */}
      {showPalette && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(8px)',
            padding: '8px 12px',
            borderRadius: '12px',
            boxShadow: '0 2px 20px rgba(0,0,0,0.2)',
            zIndex: 10,
            maxWidth: '90vw',
          }}
        >
          <div
            style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', justifyContent: 'center' }}
          >
            {/* Transparent */}
            <button
              onClick={() => setActiveColor('')}
              style={{
                width: 22,
                height: 22,
                borderRadius: '4px',
                border: activeColor === '' ? '2px solid #7c3aed' : '1px solid #ccc',
                background:
                  'repeating-conic-gradient(#e8e8e8 0% 25%, #c8c8c8 0% 50%) 50% / 6px 6px',
                cursor: 'pointer',
              }}
              title="Transparent"
            />
            {allColors.slice(0, 64).map((color, i) => (
              <button
                key={`${color}-${i}`}
                onClick={() => setActiveColor(color)}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '4px',
                  border: activeColor === color ? '2px solid #7c3aed' : '1px solid rgba(0,0,0,0.1)',
                  background: color,
                  cursor: 'pointer',
                }}
                title={color}
              />
            ))}
            <input
              type="color"
              value={activeColor || '#000000'}
              onChange={e => setActiveColor(e.target.value)}
              style={{
                width: 22,
                height: 22,
                borderRadius: '4px',
                border: '1px solid #ccc',
                cursor: 'pointer',
                padding: 0,
              }}
              title="Custom color"
            />
          </div>
        </div>
      )}

      {/* ─── Noun preview (top-right) ─── */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 10,
        }}
      >
        <button
          onClick={() => setShowPreview(p => !p)}
          style={{
            background: 'rgba(255,255,255,0.9)',
            backdropFilter: 'blur(8px)',
            border: 'none',
            borderRadius: '8px',
            padding: '4px 8px',
            cursor: 'pointer',
            fontSize: '0.65rem',
            fontWeight: 700,
            color: '#666',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            marginBottom: showPreview ? '8px' : 0,
            boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          }}
        >
          {showPreview ? <ChevronUp style={{ width: 12, height: 12 }} /> : <ChevronDown style={{ width: 12, height: 12 }} />}
          PREVIEW
        </button>

        {showPreview && (
          <div
            style={{
              background: 'rgba(255,255,255,0.95)',
              backdropFilter: 'blur(8px)',
              borderRadius: '12px',
              padding: '10px',
              boxShadow: '0 2px 20px rgba(0,0,0,0.2)',
              width: 200,
            }}
          >
            <div
              style={{
                borderRadius: '8px',
                overflow: 'hidden',
                background: layerVisibility.background
                  ? `#${ImageData.bgcolors[previewSeed.background]}`
                  : 'repeating-conic-gradient(#e8e8e8 0% 25%, #c8c8c8 0% 50%) 50% / 12px 12px',
              }}
            >
              <TraitPreview
                seed={previewSeed}
                customPixels={history.present}
                layerVisibility={layerVisibility}
                className="w-full"
              />
            </div>

            <button
              onClick={randomizeSeed}
              style={{
                width: '100%',
                marginTop: '6px',
                padding: '4px',
                borderRadius: '6px',
                border: '1px solid #ddd',
                background: '#f9f9f9',
                cursor: 'pointer',
                fontSize: '0.6rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                color: '#666',
              }}
            >
              <Dice5 style={{ width: 12, height: 12 }} /> RANDOMIZE
            </button>

            {/* Layer visibility toggles with trait selectors */}
            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {(
                [
                  ['background', 'BG', null, previewSeed.background, (v: number) => setPreviewSeed(s => ({ ...s, background: v })), ImageData.bgcolors.map((_, i) => ({ value: i, label: i === 0 ? 'Cool' : 'Warm' }))],
                  ['head', 'Head', 'heads', previewSeed.head, (v: number) => setPreviewSeed(s => ({ ...s, head: v })), traitOptions.heads.map(t => ({ value: t.index, label: t.name }))],
                  ['body', 'Body', 'bodies', previewSeed.body, (v: number) => setPreviewSeed(s => ({ ...s, body: v })), traitOptions.bodies.map(t => ({ value: t.index, label: t.name }))],
                  ['accessory', 'Acc', 'accessories', previewSeed.accessory, (v: number) => setPreviewSeed(s => ({ ...s, accessory: v })), traitOptions.accessories.map(t => ({ value: t.index, label: t.name }))],
                  ['glasses', 'Nog', 'glasses', previewSeed.glasses, (v: number) => setPreviewSeed(s => ({ ...s, glasses: v })), traitOptions.glasses.map(t => ({ value: t.index, label: t.name }))],
                ] as [keyof LayerVisibility, string, string | null, number, (v: number) => void, { value: number; label: string }[]][]
              ).map(([layer, label, _key, value, onChange, options]) => (
                <div key={layer} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button
                    onClick={() => toggleLayer(layer)}
                    title={`Toggle ${label} visibility`}
                    style={{
                      width: 22,
                      height: 22,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '4px',
                      border: 'none',
                      background: layerVisibility[layer] ? 'transparent' : 'rgba(239,68,68,0.1)',
                      color: layerVisibility[layer] ? '#666' : '#ef4444',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    {layerVisibility[layer] ? (
                      <Eye style={{ width: 12, height: 12 }} />
                    ) : (
                      <EyeOff style={{ width: 12, height: 12 }} />
                    )}
                  </button>
                  <select
                    value={value}
                    onChange={e => onChange(Number(e.target.value))}
                    style={{
                      flex: 1,
                      fontSize: '0.6rem',
                      fontWeight: 600,
                      border: '1px solid #e5e7eb',
                      borderRadius: '4px',
                      padding: '2px 4px',
                      background: '#fff',
                      cursor: 'pointer',
                      color: layerVisibility[layer] ? '#333' : '#999',
                      minWidth: 0,
                    }}
                  >
                    {options.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ─── Left panel: Save/Export/Gallery ─── */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        {/* Trait name & type */}
        <div
          style={{
            background: 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(8px)',
            borderRadius: '12px',
            padding: '8px 10px',
            boxShadow: '0 2px 20px rgba(0,0,0,0.2)',
            width: 180,
          }}
        >
          <input
            type="text"
            value={traitName_}
            onChange={e => setTraitName(e.target.value)}
            placeholder="Trait name..."
            style={{
              width: '100%',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              padding: '4px 8px',
              fontSize: '0.7rem',
              fontWeight: 600,
              marginBottom: '4px',
            }}
          />
          <select
            value={traitType}
            onChange={e => setTraitType(e.target.value)}
            style={{
              width: '100%',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              padding: '4px 8px',
              fontSize: '0.7rem',
              fontWeight: 600,
              marginBottom: '6px',
              cursor: 'pointer',
            }}
          >
            <option value="head">Head</option>
            <option value="body">Body</option>
            <option value="accessory">Accessory</option>
            <option value="glasses">Glasses</option>
          </select>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            <ToolButton
              icon={Save}
              label="Save"
              onClick={handleSave}
              disabled={!hasPixels}
            />
            <ToolButton
              icon={Download}
              label={selection ? 'Export sel.' : 'Export PNG'}
              onClick={() => exportPNG(selection)}
            />
            <ToolButton
              icon={ScrollText}
              label="Propose"
              onClick={handlePropose}
              disabled={!hasPixels}
              accent
            />
            <ToolButton
              icon={FolderOpen}
              label={`Saved (${savedTraits.length})`}
              onClick={() => setShowGallery(g => !g)}
              active={showGallery}
            />
          </div>
        </div>

        {/* Selection info */}
        {selection && (
          <div
            style={{
              background: 'rgba(124,58,237,0.95)',
              borderRadius: '8px',
              padding: '6px 10px',
              color: '#fff',
              fontSize: '0.65rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              boxShadow: '0 2px 10px rgba(124,58,237,0.3)',
            }}
          >
            <span>
              {selection.w}×{selection.h}px @ ({selection.x},{selection.y})
            </span>
            <button
              onClick={() => setSelection(null)}
              style={{
                background: 'none',
                border: 'none',
                color: '#fff',
                cursor: 'pointer',
                padding: '2px',
              }}
            >
              <X style={{ width: 12, height: 12 }} />
            </button>
          </div>
        )}

        {/* Gallery */}
        {showGallery && (
          <div
            style={{
              background: 'rgba(255,255,255,0.95)',
              backdropFilter: 'blur(8px)',
              borderRadius: '12px',
              padding: '8px 10px',
              boxShadow: '0 2px 20px rgba(0,0,0,0.2)',
              width: 180,
              maxHeight: '40vh',
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                fontSize: '0.65rem',
                fontWeight: 800,
                color: '#666',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                marginBottom: '6px',
              }}
            >
              SAVED TRAITS
            </div>
            {savedTraits.length === 0 ? (
              <p style={{ fontSize: '0.65rem', color: '#999' }}>Nothing saved yet</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                {savedTraits.map(trait => (
                  <div
                    key={trait.id}
                    onClick={() => handleLoad(trait)}
                    style={{
                      cursor: 'pointer',
                      borderRadius: '6px',
                      border: '1px solid #eee',
                      padding: '4px',
                      textAlign: 'center',
                      position: 'relative',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.background = '#f5f3ff';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }}
                  >
                    {trait.thumbnail && (
                      <img
                        src={trait.thumbnail}
                        alt={trait.name}
                        style={{
                          width: 48,
                          height: 48,
                          imageRendering: 'pixelated',
                          margin: '0 auto',
                          display: 'block',
                          borderRadius: '4px',
                        }}
                      />
                    )}
                    <div
                      style={{
                        fontSize: '0.55rem',
                        fontWeight: 600,
                        marginTop: '2px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {trait.name}
                    </div>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleDelete(trait.id);
                      }}
                      style={{
                        position: 'absolute',
                        top: -4,
                        right: -4,
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: '#ef4444',
                        color: '#fff',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.5rem',
                        opacity: 0,
                        transition: 'opacity 0.1s',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.opacity = '1';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.opacity = '0';
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Bottom-right: keyboard hints ─── */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          right: 12,
          zIndex: 5,
          background: 'rgba(0,0,0,0.4)',
          borderRadius: '8px',
          padding: '6px 10px',
          color: 'rgba(255,255,255,0.5)',
          fontSize: '0.55rem',
          fontWeight: 600,
          lineHeight: 1.8,
        }}
      >
        <div>
          <kbd style={kbdStyle}>B</kbd> Pencil{' '}
          <kbd style={kbdStyle}>E</kbd> Eraser{' '}
          <kbd style={kbdStyle}>G</kbd> Fill{' '}
          <kbd style={kbdStyle}>I</kbd> Pick
        </div>
        <div>
          <kbd style={kbdStyle}>S</kbd> Select{' '}
          <kbd style={kbdStyle}>Esc</kbd> Deselect{' '}
          <kbd style={kbdStyle}>⌘Z</kbd> Undo
        </div>
        <div>
          <kbd style={kbdStyle}>⌘+scroll</kbd> Zoom
        </div>
      </div>
    </div>
  );
};

// ── Small button component for the panel ──
function ToolButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  accent,
}: {
  icon: FC<{ style?: React.CSSProperties }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '3px',
        padding: '3px 8px',
        borderRadius: '6px',
        border: active ? '1px solid #7c3aed' : '1px solid #ddd',
        background: accent ? '#f0fdf4' : active ? '#f5f3ff' : '#fff',
        color: disabled ? '#ccc' : accent ? '#16a34a' : '#333',
        cursor: disabled ? 'default' : 'pointer',
        fontSize: '0.6rem',
        fontWeight: 700,
        whiteSpace: 'nowrap',
        transition: 'all 0.1s',
      }}
    >
      <Icon style={{ width: 12, height: 12 }} />
      {label}
    </button>
  );
}

const kbdStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.15)',
  borderRadius: '3px',
  padding: '1px 4px',
  fontSize: '0.5rem',
  fontFamily: 'monospace',
  marginRight: '2px',
};

export default StudioPage;
