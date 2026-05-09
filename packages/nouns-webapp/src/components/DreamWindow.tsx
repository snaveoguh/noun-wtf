import { FC, useCallback, useMemo, useRef, useState } from 'react';

import { ImageDataV2 as ImageData, getNounDataV2 as getNounData } from '@nouns/assets';
import { buildSVG } from '@nouns/sdk';
import { ConnectKitButton } from 'connectkit';
import { Dice5, Save, Sparkles, Upload, X } from 'lucide-react';
import { useAccount } from 'wagmi';

import { ProbeButton } from '@/components/ProbeButton';
import useModalBodyLock from '@/hooks/useModalBodyLock';
import { invalidateProbeDreamsCache } from '@/hooks/useProbeDreams';
import {
  type CustomTraitLayer,
  type SavedDream,
  generateDreamId,
  loadDreams,
  saveDreamToStorage,
} from '@/lib/dreamStorage';
import { syncDreamToProbe } from '@/lib/probeSync';
import { encodeImageToRLE, fileToImageData, type EncodedTrait } from '@/lib/rleEncode';
import { traitName } from '@/lib/traitName';
import { INounSeed } from '@/wrappers/nounToken';

type DreamMode = 'traits' | 'upload';

const LAYER_TO_PART_INDEX: Record<CustomTraitLayer, number> = {
  body: 0,
  accessory: 1,
  head: 2,
  glasses: 3,
};

const LAYER_OPTIONS: { key: CustomTraitLayer; label: string }[] = [
  { key: 'head', label: 'Head' },
  { key: 'glasses', label: 'Noggles' },
  { key: 'body', label: 'Body' },
  { key: 'accessory', label: 'Accessory' },
];

interface DreamWindowProps {
  open: boolean;
  onClose: () => void;
}

const DreamWindow: FC<DreamWindowProps> = ({ open, onClose }) => {
  useModalBodyLock(open);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'published' | 'draft-only' | 'error'>(
    'idle',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<DreamMode>('traits');
  const [customLayer, setCustomLayer] = useState<CustomTraitLayer>('head');
  const [customEncoded, setCustomEncoded] = useState<EncodedTrait | null>(null);
  const [customFile, setCustomFile] = useState<File | null>(null);
  const [customArtError, setCustomArtError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { address, isConnected } = useAccount();

  const [seed, setSeed] = useState<INounSeed>({
    background: Math.floor(Math.random() * ImageData.bgcolors.length),
    body: Math.floor(Math.random() * ImageData.images.bodies.length),
    accessory: Math.floor(Math.random() * ImageData.images.accessories.length),
    head: Math.floor(Math.random() * ImageData.images.heads.length),
    glasses: Math.floor(Math.random() * ImageData.images.glasses.length),
  });

  const svgUri = useMemo(() => {
    try {
      const { parts, background } = getNounData(seed);
      const finalParts = [...parts];
      if (mode === 'upload' && customEncoded !== null) {
        finalParts[LAYER_TO_PART_INDEX[customLayer]] = customEncoded;
      }
      const svg = buildSVG(finalParts, ImageData.palette, background);
      return `data:image/svg+xml;base64,${btoa(svg)}`;
    } catch {
      return '';
    }
  }, [seed, mode, customEncoded, customLayer]);

  const handleFileUpload = useCallback(async (file: File) => {
    setCustomArtError(null);
    setCustomFile(file);
    try {
      const imgData = await fileToImageData(file);
      const encoded = encodeImageToRLE(imgData, `custom-${file.name.replace(/\.\w+$/, '')}`);
      setCustomEncoded(encoded);
    } catch (err) {
      setCustomArtError(err instanceof Error ? err.message : 'Failed to process image');
      setCustomEncoded(null);
    }
  }, []);

  const randomize = useCallback(() => {
    setSeed({
      background: Math.floor(Math.random() * ImageData.bgcolors.length),
      body: Math.floor(Math.random() * ImageData.images.bodies.length),
      accessory: Math.floor(Math.random() * ImageData.images.accessories.length),
      head: Math.floor(Math.random() * ImageData.images.heads.length),
      glasses: Math.floor(Math.random() * ImageData.images.glasses.length),
    });
    setStatus('idle');
  }, []);

  const handleSave = useCallback(async () => {
    setStatus('saving');
    setErrorMessage(null);

    const hasCustom = mode === 'upload' && customEncoded !== null;
    const dream: SavedDream = {
      id: generateDreamId(),
      title: title.trim() || 'Untitled Dream',
      description: description.trim(),
      seed,
      createdAt: Date.now(),
      status: isConnected ? 'published' : 'draft',
      ...(hasCustom && customEncoded !== null
        ? {
            customTraitData: customEncoded.data,
            customTraitLayer: customLayer,
            customTraitPreview: svgUri,
          }
        : {}),
    };

    // Always save locally so the user has a record.
    saveDreamToStorage(dream);

    // If no wallet, we can't POST to probe (dreamer address required).
    if (address === undefined || address === null) {
      setStatus('draft-only');
      return;
    }

    try {
      await syncDreamToProbe(dream, address, customFile ?? undefined);
      invalidateProbeDreamsCache();
      setStatus('published');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to publish to probe.wtf');
      setStatus('error');
    }
  }, [
    title,
    description,
    seed,
    mode,
    customEncoded,
    customLayer,
    customFile,
    svgUri,
    address,
    isConnected,
  ]);

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

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[998] bg-black/40" onClick={onClose} />

      {/* Retro Window */}
      <div
        className="fixed z-[999] flex flex-col"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(95vw, 820px)',
          maxHeight: '90vh',
          border: '3px solid #000',
          boxShadow: '12px 12px 0 0 rgba(0,0,0,0.3)',
          background: '#f0f0f0',
          fontFamily: "'Comic Sans MS', 'Comic Sans', cursive",
        }}
      >
        {/* Title bar — retro style */}
        <div
          style={{
            background: 'linear-gradient(90deg, #000080 0%, #1084d0 100%)',
            padding: '4px 8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            minHeight: '32px',
            cursor: 'default',
            userSelect: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles className="h-4 w-4 text-yellow-300" />
            <span
              style={{
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.875rem',
                letterSpacing: '0.05em',
              }}
            >
              DREAM CREATOR — NOUN.WTF
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: '#c0c0c0',
              border: '2px outset #fff',
              width: '22px',
              height: '22px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        {/* Menu bar */}
        <div
          style={{
            borderBottom: '1px solid #999',
            padding: '2px 8px',
            fontSize: '0.75rem',
            background: '#f0f0f0',
            display: 'flex',
            gap: '16px',
            color: '#333',
          }}
        >
          <span style={{ textDecoration: 'underline', cursor: 'pointer' }}>File</span>
          <span style={{ textDecoration: 'underline', cursor: 'pointer' }}>Edit</span>
          <span style={{ textDecoration: 'underline', cursor: 'pointer' }}>View</span>
          <span style={{ color: '#999' }}>Help</span>
        </div>

        {/* Content */}
        <div
          style={{
            overflow: 'auto',
            flex: 1,
            padding: '16px',
          }}
        >
          <div className="flex flex-col gap-5 md:flex-row">
            {/* Left — Preview */}
            <div className="flex flex-col items-center gap-3">
              <div
                className="rounded-lg"
                style={{
                  backgroundColor: `#${ImageData.bgcolors[seed.background]}`,
                  padding: '12px',
                  border: '2px inset #999',
                }}
              >
                {svgUri && (
                  <img
                    src={svgUri}
                    alt="Dream preview"
                    className="h-48 w-48 md:h-56 md:w-56"
                    style={{ imageRendering: 'pixelated' }}
                  />
                )}
              </div>
              <button
                onClick={randomize}
                style={{
                  background: '#c0c0c0',
                  border: '2px outset #fff',
                  padding: '4px 16px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  width: '100%',
                  justifyContent: 'center',
                }}
              >
                <Dice5 className="h-4 w-4" />
                RANDOMIZE
              </button>
            </div>

            {/* Right — Form */}
            <div className="flex flex-1 flex-col gap-3">
              {/* Dream title */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    marginBottom: '2px',
                    color: '#333',
                  }}
                >
                  DREAM TITLE
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Name your dream noun..."
                  style={{
                    width: '100%',
                    border: '2px inset #999',
                    padding: '6px 8px',
                    fontSize: '0.875rem',
                    fontFamily: "'Comic Sans MS', 'Comic Sans', cursive",
                    fontWeight: 700,
                    background: '#fff',
                    textTransform: 'none',
                  }}
                />
              </div>

              {/* Description */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    marginBottom: '2px',
                    color: '#333',
                  }}
                >
                  DESCRIPTION
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="What inspired this design?"
                  rows={2}
                  style={{
                    width: '100%',
                    border: '2px inset #999',
                    padding: '6px 8px',
                    fontSize: '0.8rem',
                    fontFamily: "'Comic Sans MS', 'Comic Sans', cursive",
                    background: '#fff',
                    resize: 'vertical',
                    textTransform: 'none',
                  }}
                />
              </div>

              {/* Mode toggle: pick traits vs upload art */}
              <div
                style={{
                  display: 'flex',
                  border: '2px inset #999',
                  background: '#e0e0e0',
                  padding: 2,
                }}
              >
                <button
                  type="button"
                  onClick={() => setMode('traits')}
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: mode === 'traits' ? '#c0c0c0' : 'transparent',
                    border: mode === 'traits' ? '2px outset #fff' : '2px solid transparent',
                    fontFamily: "'Comic Sans MS', 'Comic Sans', cursive",
                  }}
                >
                  PICK TRAITS
                </button>
                <button
                  type="button"
                  onClick={() => setMode('upload')}
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: mode === 'upload' ? '#c0c0c0' : 'transparent',
                    border: mode === 'upload' ? '2px outset #fff' : '2px solid transparent',
                    fontFamily: "'Comic Sans MS', 'Comic Sans', cursive",
                  }}
                >
                  UPLOAD ART
                </button>
              </div>

              {mode === 'traits' ? (
                <fieldset
                  style={{
                    border: '2px groove #ccc',
                    padding: '8px 12px',
                    margin: 0,
                  }}
                >
                  <legend
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      padding: '0 6px',
                      color: '#333',
                    }}
                  >
                    CHOOSE TRAITS
                  </legend>

                  <div className="grid grid-cols-2 gap-2">
                    <RetroSelect
                      label="Background"
                      value={seed.background}
                      onChange={v => setSeed(s => ({ ...s, background: v }))}
                      options={ImageData.bgcolors.map((_, i) => ({
                        value: i,
                        label: i === 0 ? 'Cool' : 'Warm',
                      }))}
                    />
                    <RetroSelect
                      label="Head"
                      value={seed.head}
                      onChange={v => setSeed(s => ({ ...s, head: v }))}
                      options={traitOptions.heads.map(t => ({
                        value: t.index,
                        label: t.name,
                      }))}
                    />
                    <RetroSelect
                      label="Body"
                      value={seed.body}
                      onChange={v => setSeed(s => ({ ...s, body: v }))}
                      options={traitOptions.bodies.map(t => ({
                        value: t.index,
                        label: t.name,
                      }))}
                    />
                    <RetroSelect
                      label="Accessory"
                      value={seed.accessory}
                      onChange={v => setSeed(s => ({ ...s, accessory: v }))}
                      options={traitOptions.accessories.map(t => ({
                        value: t.index,
                        label: t.name,
                      }))}
                    />
                    <RetroSelect
                      label="Noggles"
                      value={seed.glasses}
                      onChange={v => setSeed(s => ({ ...s, glasses: v }))}
                      options={traitOptions.glasses.map(t => ({
                        value: t.index,
                        label: t.name,
                      }))}
                    />
                  </div>
                </fieldset>
              ) : (
                <fieldset
                  style={{
                    border: '2px groove #ccc',
                    padding: '8px 12px',
                    margin: 0,
                  }}
                >
                  <legend
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      padding: '0 6px',
                      color: '#333',
                    }}
                  >
                    UPLOAD CUSTOM TRAIT (32×32 PNG)
                  </legend>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div>
                      <div
                        style={{
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          marginBottom: 4,
                          color: '#555',
                        }}
                      >
                        REPLACE LAYER
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {LAYER_OPTIONS.map(l => (
                          <button
                            key={l.key}
                            type="button"
                            onClick={() => setCustomLayer(l.key)}
                            style={{
                              padding: '2px 8px',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              background: customLayer === l.key ? '#000080' : '#c0c0c0',
                              color: customLayer === l.key ? '#fff' : '#000',
                              border: '2px outset #fff',
                              fontFamily: "'Comic Sans MS', 'Comic Sans', cursive",
                            }}
                          >
                            {l.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png"
                      style={{ display: 'none' }}
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) void handleFileUpload(file);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        background: '#c0c0c0',
                        border: '2px outset #fff',
                        padding: '6px 12px',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        justifyContent: 'center',
                        fontFamily: "'Comic Sans MS', 'Comic Sans', cursive",
                      }}
                    >
                      <Upload className="h-3 w-3" />
                      {customEncoded !== null ? 'CHANGE FILE…' : 'CHOOSE PNG FILE…'}
                    </button>
                    {customEncoded !== null && (
                      <div style={{ fontSize: '0.7rem', color: '#007700' }}>
                        ✓ {customEncoded.filename}
                      </div>
                    )}
                    {customArtError !== null && (
                      <div style={{ fontSize: '0.7rem', color: '#c00000' }}>
                        ⚠ {customArtError}
                      </div>
                    )}
                  </div>
                </fieldset>
              )}

              {/* Publish / save button */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {isConnected ? (
                  <ProbeButton
                    onClick={handleSave}
                    disabled={status === 'saving'}
                    className="flex-1"
                  >
                    <span className="flex items-center justify-center gap-2">
                      <Save className="h-4 w-4" />
                      {status === 'saving'
                        ? 'PUBLISHING…'
                        : status === 'published'
                          ? 'PUBLISHED ✓'
                          : status === 'error'
                            ? 'RETRY'
                            : 'PUBLISH DREAM'}
                    </span>
                  </ProbeButton>
                ) : (
                  <>
                    <ConnectKitButton.Custom>
                      {({ show }) => (
                        <ProbeButton onClick={() => show?.()} className="flex-1">
                          <span className="flex items-center justify-center gap-2">
                            CONNECT WALLET TO PUBLISH
                          </span>
                        </ProbeButton>
                      )}
                    </ConnectKitButton.Custom>
                    <button
                      type="button"
                      onClick={handleSave}
                      style={{
                        background: '#c0c0c0',
                        border: '2px outset #fff',
                        padding: '4px 12px',
                        cursor: 'pointer',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        fontFamily: "'Comic Sans MS', 'Comic Sans', cursive",
                      }}
                    >
                      {status === 'draft-only' ? 'SAVED TO DRAFTS ✓' : 'SAVE AS DRAFT'}
                    </button>
                  </>
                )}
                {status === 'error' && errorMessage !== null && (
                  <div style={{ fontSize: '0.7rem', color: '#c00000' }}>⚠ {errorMessage}</div>
                )}
                {status === 'published' && (
                  <div style={{ fontSize: '0.7rem', color: '#007700' }}>✓ Live on probe.wtf</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Status bar */}
        <div
          style={{
            borderTop: '2px groove #ccc',
            padding: '2px 8px',
            fontSize: '0.7rem',
            color: '#666',
            background: '#f0f0f0',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>🦋 noun.wtf dream creator</span>
          <span>{loadDreams().length} dreams saved</span>
        </div>
      </div>
    </>
  );
};

// Retro-styled select dropdown
function RetroSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  options: { value: number; label: string }[];
}) {
  return (
    <div>
      <label
        style={{
          display: 'block',
          fontSize: '0.65rem',
          fontWeight: 700,
          marginBottom: '1px',
          color: '#555',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </label>
      <select
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          width: '100%',
          border: '2px inset #999',
          padding: '3px 4px',
          fontSize: '0.75rem',
          fontFamily: "'Comic Sans MS', 'Comic Sans', cursive",
          fontWeight: 700,
          background: '#fff',
          cursor: 'pointer',
        }}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default DreamWindow;
