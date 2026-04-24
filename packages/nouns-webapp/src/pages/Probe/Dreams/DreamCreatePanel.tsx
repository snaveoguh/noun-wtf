import { FC, useCallback, useMemo, useRef, useState } from 'react';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import { buildSVG } from '@nouns/sdk';
import { Shuffle, Upload } from 'lucide-react';
import { useAccount } from 'wagmi';

import { Trait } from '@/components/Trait';
import { Button } from '@/components/ui/button';
import useModalBodyLock from '@/hooks/useModalBodyLock';
import { invalidateProbeDreamsCache } from '@/hooks/useProbeDreams';
import { generateDreamId, type CustomTraitLayer, type SavedDream } from '@/lib/dreamStorage';
import { syncDreamToProbe } from '@/lib/probeSync';
import { encodeImageToRLE, fileToImageData, type EncodedTrait } from '@/lib/rleEncode';
import { traitName } from '@/lib/traitName';
import { INounSeed } from '@/wrappers/nounToken';

const traitTypes = [
  { key: 'head' as const, label: 'Head', category: 'heads' as const },
  { key: 'glasses' as const, label: 'Noggles', category: 'glasses' as const },
  { key: 'body' as const, label: 'Body', category: 'bodies' as const },
  { key: 'accessory' as const, label: 'Accessory', category: 'accessories' as const },
] as const;

const layerOptions: { key: CustomTraitLayer; label: string }[] = [
  { key: 'head', label: 'Head' },
  { key: 'glasses', label: 'Noggles' },
  { key: 'body', label: 'Body' },
  { key: 'accessory', label: 'Accessory' },
];

function randomSeed(): INounSeed {
  return {
    background: Math.floor(Math.random() * ImageData.bgcolors.length),
    body: Math.floor(Math.random() * ImageData.images.bodies.length),
    accessory: Math.floor(Math.random() * ImageData.images.accessories.length),
    head: Math.floor(Math.random() * ImageData.images.heads.length),
    glasses: Math.floor(Math.random() * ImageData.images.glasses.length),
  };
}

const LAYER_TO_PART_INDEX: Record<CustomTraitLayer, number> = {
  body: 0,
  accessory: 1,
  head: 2,
  glasses: 3,
};

interface Props {
  onSave: (dream: SavedDream) => void;
  onClose: () => void;
}

type CreateMode = 'traits' | 'upload';

const DreamCreatePanel: FC<Props> = ({ onSave, onClose }) => {
  useModalBodyLock(true);
  const [mode, setMode] = useState<CreateMode>('traits');
  const [seed, setSeed] = useState<INounSeed>(randomSeed);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [customLayer, setCustomLayer] = useState<CustomTraitLayer>('head');
  const [customEncoded, setCustomEncoded] = useState<EncodedTrait | null>(null);
  const [customFile, setCustomFile] = useState<File | null>(null);
  const [customArtError, setCustomArtError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { address } = useAccount();

  const svgUri = useMemo(() => {
    try {
      const { parts, background } = getNounData(seed);
      const finalParts = [...parts];
      if (mode === 'upload' && customEncoded) {
        finalParts[LAYER_TO_PART_INDEX[customLayer]] = customEncoded;
      }
      const svg = buildSVG(finalParts, ImageData.palette, background);
      return `data:image/svg+xml;base64,${btoa(svg)}`;
    } catch {
      return '';
    }
  }, [seed, mode, customEncoded, customLayer]);

  const handleRandomize = useCallback(() => setSeed(randomSeed()), []);

  const handleFileUpload = useCallback(async (file: File) => {
    setCustomArtError(null);
    setCustomFile(file);
    try {
      const imgData = await fileToImageData(file);
      const encoded = encodeImageToRLE(imgData, `custom-${file.name.replace(/\.\w+$/, '')}`);
      setCustomEncoded(encoded);
    } catch (err) {
      setCustomArtError(err instanceof Error ? err.message : 'Failed to process image');
    }
  }, []);

  const updateTrait = useCallback((key: keyof INounSeed, value: number) => {
    setSeed(prev => ({ ...prev, [key]: value }));
  }, []);

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!title.trim()) return;
    setPublishError(null);
    const dream: SavedDream = {
      id: generateDreamId(),
      title: title.trim(),
      description: description.trim(),
      seed,
      createdAt: Date.now(),
      status: address ? 'published' : 'draft',
      ...(mode === 'upload' && customEncoded
        ? {
            customTraitData: customEncoded.data,
            customTraitLayer: customLayer,
            customTraitPreview: svgUri,
          }
        : {}),
    };
    onSave(dream);

    // Publish to probe.wtf if connected. Await so we can show real status / errors.
    if (address) {
      setPublishing(true);
      try {
        await syncDreamToProbe(dream, address, customFile ?? undefined);
        invalidateProbeDreamsCache();
        onClose();
      } catch (err) {
        setPublishError(err instanceof Error ? err.message : 'Failed to publish');
        setPublishing(false);
      }
    } else {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1040] flex items-center justify-center bg-black/60"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="mx-4 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-xl font-bold">Create a Dream</h2>
          <button onClick={onClose} className="text-2xl text-gray-400 hover:text-gray-600">
            &times;
          </button>
        </div>
        <div className="flex flex-col gap-6 p-6 md:flex-row">
          <div className="flex flex-col items-center gap-3">
            <div
              className="overflow-hidden rounded-2xl"
              style={{ backgroundColor: `#${ImageData.bgcolors[seed.background]}` }}
            >
              {svgUri && (
                <img
                  src={svgUri}
                  alt="Dream preview"
                  className="h-48 w-48"
                  style={{ imageRendering: 'pixelated' }}
                />
              )}
            </div>
            <Button variant="outline" size="sm" onClick={handleRandomize} className="gap-1">
              <Shuffle className="h-4 w-4" />
              Randomize
            </Button>
            <div className="flex gap-1">
              {ImageData.bgcolors.map((color, i) => (
                <button
                  key={i}
                  onClick={() => updateTrait('background', i)}
                  className={`h-6 w-6 rounded-full border-2 ${seed.background === i ? 'border-black' : 'border-transparent'}`}
                  style={{ backgroundColor: `#${color}` }}
                />
              ))}
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-4">
            <input
              type="text"
              placeholder="Dream title..."
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="border-border rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
            <textarea
              placeholder="Description (optional)..."
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="border-border rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
            <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
              <button
                onClick={() => setMode('traits')}
                className={`flex-1 rounded-md px-3 py-1 text-xs font-bold transition-colors ${mode === 'traits' ? 'bg-white shadow' : 'text-gray-500'}`}
              >
                Pick Traits
              </button>
              <button
                onClick={() => setMode('upload')}
                className={`flex-1 rounded-md px-3 py-1 text-xs font-bold transition-colors ${mode === 'upload' ? 'bg-white shadow' : 'text-gray-500'}`}
              >
                Upload Art
              </button>
            </div>
            {mode === 'traits' ? (
              <div className="space-y-2">
                {traitTypes.map(({ key, label, category }) => {
                  const count = ImageData.images[category].length;
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <Trait type={key} seed={seed[key]} className="h-8 w-8 rounded" />
                      <span className="w-16 text-xs font-bold text-gray-500">{label}</span>
                      <select
                        value={seed[key]}
                        onChange={e => updateTrait(key, Number(e.target.value))}
                        className="border-border flex-1 rounded border px-2 py-1 text-xs"
                      >
                        {Array.from({ length: count }, (_, i) => (
                          <option key={i} value={i}>
                            {traitName(key, i)}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-gray-600">
                    Which layer does this replace?
                  </label>
                  <div className="flex gap-1">
                    {layerOptions.map(l => (
                      <button
                        key={l.key}
                        onClick={() => setCustomLayer(l.key)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${customLayer === l.key ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  Upload a 32x32 pixel PNG. It will replace the{' '}
                  <strong>{layerOptions.find(l => l.key === customLayer)?.label}</strong> layer.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                  }}
                />
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4" />
                  Choose PNG File
                </Button>
                {customEncoded && (
                  <p className="text-xs text-green-600">
                    Custom trait loaded ({customEncoded.filename})
                  </p>
                )}
                {customArtError && <p className="text-xs text-red-500">{customArtError}</p>}
                <div className="space-y-2 border-t pt-2">
                  <p className="text-xs font-bold text-gray-500">Other traits:</p>
                  {traitTypes
                    .filter(t => t.key !== customLayer)
                    .map(({ key, label, category }) => {
                      const count = ImageData.images[category].length;
                      return (
                        <div key={key} className="flex items-center gap-2">
                          <Trait type={key} seed={seed[key]} className="h-6 w-6 rounded" />
                          <span className="w-14 text-[10px] font-bold text-gray-400">{label}</span>
                          <select
                            value={seed[key]}
                            onChange={e => updateTrait(key, Number(e.target.value))}
                            className="border-border flex-1 rounded border px-2 py-1 text-xs"
                          >
                            {Array.from({ length: count }, (_, i) => (
                              <option key={i} value={i}>
                                {traitName(key, i)}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
            <div className="mt-auto space-y-2">
              <Button
                onClick={handleSave}
                disabled={!title.trim() || publishing}
                className="w-full"
              >
                {publishing ? 'Publishing…' : address ? 'Publish Dream' : 'Save as Draft'}
              </Button>
              {!address && (
                <p className="text-xs text-gray-500">
                  Connect a wallet to publish to probe.wtf. Otherwise this saves as a local draft.
                </p>
              )}
              {publishError && <p className="text-xs text-red-500">{publishError}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DreamCreatePanel;
