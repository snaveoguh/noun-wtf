import { FC, useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import { ImageData } from '@noundry/nouns-assets';
import { Download, FolderOpen, Save, ScrollText, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router';

import { ColorPalette } from '@/components/Studio/ColorPalette';
import { PixelCanvas, Tool } from '@/components/Studio/PixelCanvas';
import { ToolBar } from '@/components/Studio/ToolBar';
import { TraitPreview } from '@/components/Studio/TraitPreview';
import { Button } from '@/components/ui/button';
import { traitName } from '@/lib/traitName';
import { INounSeed } from '@/wrappers/nounToken';

// ── Saved traits localStorage ──
interface SavedTrait {
  id: string;
  name: string;
  pixels: string[][];
  traitType: string;
  createdAt: number;
  thumbnail?: string; // data URI
}

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(traits.slice(0, 50))); // max 50
}

function deleteSavedTrait(id: string) {
  const traits = loadSavedTraits().filter(t => t.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(traits));
}

function pixelsToThumbnail(pixels: string[][]): string {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const color = pixels[y]?.[x];
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return canvas.toDataURL('image/png');
}

const GRID_SIZE = 32;

function createEmptyGrid(): string[][] {
  return Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(''));
}

// Undo/redo state
type HistoryAction =
  | { type: 'SET_PIXEL'; x: number; y: number; color: string }
  | { type: 'SET_PIXELS'; changes: [number, number, string][] }
  | { type: 'CLEAR' }
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
      return {
        past: [...state.past, state.present],
        present: newGrid,
        future: [],
      };
    }
    case 'SET_PIXELS': {
      const newGrid = state.present.map(row => [...row]);
      for (const [x, y, color] of action.changes) {
        newGrid[y][x] = color;
      }
      return {
        past: [...state.past, state.present],
        present: newGrid,
        future: [],
      };
    }
    case 'CLEAR':
      return {
        past: [...state.past, state.present],
        present: createEmptyGrid(),
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

const StudioPage: FC = () => {
  const [history, dispatch] = useReducer(historyReducer, {
    past: [],
    present: createEmptyGrid(),
    future: [],
  });

  const navigate = useNavigate();
  const [activeTool, setActiveTool] = useState<Tool>('pencil');
  const [activeColor, setActiveColor] = useState('#e1d7d5');
  const [zoom, setZoom] = useState(16);
  const [traitName_, setTraitName] = useState('');
  const [traitType, setTraitType] = useState('head');
  const [savedTraits, setSavedTraits] = useState<SavedTrait[]>([]);
  const [showGallery, setShowGallery] = useState(false);

  // Load saved traits on mount
  useEffect(() => {
    setSavedTraits(loadSavedTraits());
  }, []);

  // Preview noun seed
  const [previewSeed, setPreviewSeed] = useState<INounSeed>({
    background: 0,
    body: Math.floor(Math.random() * ImageData.images.bodies.length),
    accessory: Math.floor(Math.random() * ImageData.images.accessories.length),
    head: Math.floor(Math.random() * ImageData.images.heads.length),
    glasses: Math.floor(Math.random() * ImageData.images.glasses.length),
  });

  const handlePixelChange = useCallback((x: number, y: number, color: string) => {
    dispatch({ type: 'SET_PIXEL', x, y, color });
  }, []);

  const handlePixelsFill = useCallback((changes: [number, number, string][]) => {
    dispatch({ type: 'SET_PIXELS', changes });
  }, []);

  const handleColorPick = useCallback((color: string) => {
    setActiveColor(color);
    setActiveTool('pencil');
  }, []);

  const randomizeSeed = useCallback(() => {
    setPreviewSeed({
      background: Math.floor(Math.random() * ImageData.bgcolors.length),
      body: Math.floor(Math.random() * ImageData.images.bodies.length),
      accessory: Math.floor(Math.random() * ImageData.images.accessories.length),
      head: Math.floor(Math.random() * ImageData.images.heads.length),
      glasses: Math.floor(Math.random() * ImageData.images.glasses.length),
    });
  }, []);

  const hasPixels = useMemo(() => {
    return history.present.some(row => row.some(c => c !== ''));
  }, [history.present]);

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
    // Replace current canvas with saved trait
    dispatch({ type: 'CLEAR' });
    const changes: [number, number, string][] = [];
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const color = trait.pixels[y]?.[x];
        if (color) changes.push([x, y, color]);
      }
    }
    if (changes.length > 0) {
      dispatch({ type: 'SET_PIXELS', changes });
    }
    setTraitType(trait.traitType);
    setTraitName(trait.name);
    setShowGallery(false);
  }, []);

  const handleDelete = useCallback((id: string) => {
    deleteSavedTrait(id);
    setSavedTraits(loadSavedTraits());
  }, []);

  const handlePropose = useCallback(() => {
    if (!hasPixels) return;
    const name = traitName_ || `New ${traitType} trait`;
    // Generate a data URL of the trait for the proposal description
    const thumbnail = pixelsToThumbnail(history.present);
    // Save the trait first
    handleSave();
    // Navigate to proposal creation with pre-filled description
    const description = `# Add New Noun Trait: ${name}\n\n## Trait Type\n${traitType}\n\n## Description\nThis proposal adds a new **${traitType}** trait "${name}" to the Nouns art collection.\n\nCreated with the Noundry Studio on noun.wtf.\n\n## Preview\n![${name}](${thumbnail})`;
    // Store in sessionStorage for the proposal page to pick up
    sessionStorage.setItem('studio-proposal-description', description);
    sessionStorage.setItem('studio-proposal-title', `Add Noun Trait: ${name}`);
    navigate('/create-proposal');
  }, [history.present, traitName_, traitType, hasPixels, handleSave, navigate]);

  const exportPNG = useCallback(() => {
    const canvas = document.createElement('canvas');
    canvas.width = GRID_SIZE;
    canvas.height = GRID_SIZE;
    const ctx = canvas.getContext('2d')!;

    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const color = history.present[y][x];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }

    const link = document.createElement('a');
    link.download = 'noun-trait.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, [history.present]);

  // Trait selector options
  const traitOptions = useMemo(() => ({
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
  }), []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-4xl font-bold">Noundry Studio</h1>
        <p className="text-muted-foreground mt-1">
          Create custom Noun traits with the pixel art editor
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Left: Canvas + Tools */}
        <div className="space-y-4">
          <ToolBar
            activeTool={activeTool}
            onToolChange={setActiveTool}
            onUndo={() => dispatch({ type: 'UNDO' })}
            onRedo={() => dispatch({ type: 'REDO' })}
            onClear={() => dispatch({ type: 'CLEAR' })}
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
          />

          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Zoom:</label>
            <input
              type="range"
              min={8}
              max={24}
              value={zoom}
              onChange={e => setZoom(Number(e.target.value))}
              className="w-32"
            />
            <span className="text-muted-foreground text-xs">{zoom}x</span>
          </div>

          <PixelCanvas
            pixels={history.present}
            onPixelChange={handlePixelChange}
            onPixelsFill={handlePixelsFill}
            onColorPick={handleColorPick}
            activeColor={activeColor}
            activeTool={activeTool}
            zoom={zoom}
          />

          <ColorPalette activeColor={activeColor} onColorSelect={setActiveColor} />

          {/* Save & Export Actions */}
          <div className="space-y-3 rounded-xl border bg-white p-4 shadow-sm">
            <div className="flex gap-2">
              <input
                type="text"
                value={traitName_}
                onChange={e => setTraitName(e.target.value)}
                placeholder="Trait name..."
                className="flex-1 rounded-lg border px-3 py-1.5 text-sm"
              />
              <select
                value={traitType}
                onChange={e => setTraitType(e.target.value)}
                className="rounded-lg border px-2 py-1.5 text-sm"
              >
                <option value="head">Head</option>
                <option value="body">Body</option>
                <option value="accessory">Accessory</option>
                <option value="glasses">Glasses</option>
              </select>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleSave} disabled={!hasPixels} size="sm" className="gap-1.5">
                <Save className="h-3.5 w-3.5" />
                Save Trait
              </Button>
              <Button onClick={exportPNG} variant="outline" size="sm" className="gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Export PNG
              </Button>
              <Button
                onClick={handlePropose}
                disabled={!hasPixels}
                variant="outline"
                size="sm"
                className="gap-1.5 border-green-300 text-green-700 hover:bg-green-50"
              >
                <ScrollText className="h-3.5 w-3.5" />
                Propose Trait
              </Button>
              <Button
                onClick={() => setShowGallery(!showGallery)}
                variant="outline"
                size="sm"
                className="gap-1.5"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {showGallery ? 'Hide' : 'Saved'} ({savedTraits.length})
              </Button>
            </div>
          </div>

          {/* Saved Traits Gallery */}
          {showGallery && (
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-lg font-bold">Saved Traits</h3>
              {savedTraits.length === 0 ? (
                <p className="text-sm text-gray-400">No saved traits yet. Draw something and hit Save!</p>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {savedTraits.map(trait => (
                    <div
                      key={trait.id}
                      className="group relative cursor-pointer rounded-lg border p-1 transition-colors hover:bg-gray-50"
                      onClick={() => handleLoad(trait)}
                      title={`Load "${trait.name}"`}
                    >
                      {trait.thumbnail && (
                        <img
                          src={trait.thumbnail}
                          alt={trait.name}
                          className="mx-auto h-14 w-14 rounded"
                          style={{ imageRendering: 'pixelated' }}
                        />
                      )}
                      <p className="mt-1 truncate text-center text-xs">{trait.name}</p>
                      <span className="text-muted-foreground text-center text-xs block">{trait.traitType}</span>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handleDelete(trait.id);
                        }}
                        className="absolute -right-1 -top-1 hidden rounded-full bg-red-500 p-0.5 text-white group-hover:block"
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Preview */}
        <div className="flex-1 space-y-4">
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold">Live Preview</h3>
              <Button variant="outline" size="sm" onClick={randomizeSeed}>
                Randomize
              </Button>
            </div>

            <div
              className="mx-auto w-fit rounded-xl p-4"
              style={{
                backgroundColor: `#${ImageData.bgcolors[previewSeed.background]}`,
              }}
            >
              <TraitPreview seed={previewSeed} customPixels={history.present} className="h-64 w-64" />
            </div>
          </div>

          {/* Trait selectors */}
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-lg font-bold">Preview Traits</h3>
            <div className="space-y-2">
              <div>
                <label className="text-xs font-semibold uppercase text-gray-500">Background</label>
                <select
                  value={previewSeed.background}
                  onChange={e =>
                    setPreviewSeed(s => ({ ...s, background: Number(e.target.value) }))
                  }
                  className="border-border w-full rounded-lg border px-3 py-1.5 text-sm"
                >
                  {ImageData.bgcolors.map((_, i) => (
                    <option key={i} value={i}>
                      {i === 0 ? 'Cool' : 'Warm'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase text-gray-500">Head</label>
                <select
                  value={previewSeed.head}
                  onChange={e => setPreviewSeed(s => ({ ...s, head: Number(e.target.value) }))}
                  className="border-border w-full rounded-lg border px-3 py-1.5 text-sm"
                >
                  {traitOptions.heads.map(t => (
                    <option key={t.index} value={t.index}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase text-gray-500">Body</label>
                <select
                  value={previewSeed.body}
                  onChange={e => setPreviewSeed(s => ({ ...s, body: Number(e.target.value) }))}
                  className="border-border w-full rounded-lg border px-3 py-1.5 text-sm"
                >
                  {traitOptions.bodies.map(t => (
                    <option key={t.index} value={t.index}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase text-gray-500">Accessory</label>
                <select
                  value={previewSeed.accessory}
                  onChange={e =>
                    setPreviewSeed(s => ({ ...s, accessory: Number(e.target.value) }))
                  }
                  className="border-border w-full rounded-lg border px-3 py-1.5 text-sm"
                >
                  {traitOptions.accessories.map(t => (
                    <option key={t.index} value={t.index}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase text-gray-500">Noggles</label>
                <select
                  value={previewSeed.glasses}
                  onChange={e => setPreviewSeed(s => ({ ...s, glasses: Number(e.target.value) }))}
                  className="border-border w-full rounded-lg border px-3 py-1.5 text-sm"
                >
                  {traitOptions.glasses.map(t => (
                    <option key={t.index} value={t.index}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StudioPage;
