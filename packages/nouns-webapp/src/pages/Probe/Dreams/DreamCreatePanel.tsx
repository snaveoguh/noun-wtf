import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import { buildSVG } from '@nouns/sdk';
import { ChevronLeft, ChevronRight, Lock, Shuffle, Target, Unlock, Upload } from 'lucide-react';
import { parseEther } from 'viem';
import { useAccount, useChainId, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';

import { Trait } from '@/components/Trait';
import { Button } from '@/components/ui/button';
import useModalBodyLock from '@/hooks/useModalBodyLock';
import { invalidateProbeDreamsCache } from '@/hooks/useProbeDreams';
import { generateDreamId, type CustomTraitLayer, type SavedDream } from '@/lib/dreamStorage';
import { syncDreamToProbe } from '@/lib/probeSync';
import {
  NOUNIRL_ADDRESS,
  RESERVABLE_LAYERS,
  RESERVE_SUPPORTED_CHAINS,
  RESERVE_TIP_ETH,
  type ReservableLayer,
  type ReserveResult,
  buildReserveTraits,
  isReserveChainSupported,
  reserveDream,
} from '@/lib/reserveDream';
import { encodeImageToRLE, fileToImageData, type EncodedTrait } from '@/lib/rleEncode';
import { traitName } from '@/lib/traitName';
import { INounSeed } from '@/wrappers/nounToken';

const traitTypes = [
  { key: 'head' as const, label: 'Head', category: 'heads' as const },
  { key: 'glasses' as const, label: 'Noggles', category: 'glasses' as const },
  { key: 'body' as const, label: 'Body', category: 'bodies' as const },
  { key: 'accessory' as const, label: 'Accessory', category: 'accessories' as const },
] as const;

type LockableLayer = (typeof traitTypes)[number]['key'];

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

const CATEGORY_BY_LAYER: Record<LockableLayer, 'heads' | 'glasses' | 'bodies' | 'accessories'> = {
  head: 'heads',
  glasses: 'glasses',
  body: 'bodies',
  accessory: 'accessories',
};

interface Props {
  onSave: (dream: SavedDream) => void;
  onClose: () => void;
}

type CreateMode = 'traits' | 'upload';
type ActionMode = 'gallery' | 'reserve';

const DreamCreatePanel: FC<Props> = ({ onSave, onClose }) => {
  useModalBodyLock(true);
  const [mode, setMode] = useState<CreateMode>('traits');
  const [action, setAction] = useState<ActionMode>('gallery');
  const [seed, setSeed] = useState<INounSeed>(randomSeed);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [customLayer, setCustomLayer] = useState<CustomTraitLayer>('head');
  const [customEncoded, setCustomEncoded] = useState<EncodedTrait | null>(null);
  const [customFile, setCustomFile] = useState<File | null>(null);
  const [customArtError, setCustomArtError] = useState<string | null>(null);
  // Locked traits survive a Randomize — lets a dreamer pin the head they love
  // and reroll everything else.
  const [locked, setLocked] = useState<Record<LockableLayer, boolean>>({
    head: false,
    glasses: false,
    body: false,
    accessory: false,
  });
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

  const handleRandomize = useCallback(() => {
    setSeed(prev => {
      const next = randomSeed();
      // Keep background from prev only if nothing else — background has no lock,
      // it rerolls freely. Preserve any locked trait layers.
      (Object.keys(locked) as LockableLayer[]).forEach(k => {
        if (locked[k]) next[k] = prev[k];
      });
      return next;
    });
  }, [locked]);

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

  const stepTrait = useCallback((key: LockableLayer, delta: number) => {
    const count = ImageData.images[CATEGORY_BY_LAYER[key]].length;
    setSeed(prev => ({ ...prev, [key]: (prev[key] + delta + count) % count }));
  }, []);

  const toggleLock = useCallback((key: LockableLayer) => {
    setLocked(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Custom uploaded art isn't a real on-chain trait, so it can never match a
  // settled Noun — reserving only makes sense from the trait picker.
  useEffect(() => {
    if (mode === 'upload') setAction('gallery');
  }, [mode]);

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

  // ── Reserve flow ──────────────────────────────────────────────────────────
  const chainId = useChainId();
  const chainSupported = isReserveChainSupported(chainId);
  const [reserveLayers, setReserveLayers] = useState<Record<ReservableLayer, boolean>>({
    head: true,
    glasses: true,
    body: false,
    accessory: false,
  });
  const selectedReserveLayers = (Object.keys(reserveLayers) as ReservableLayer[]).filter(
    l => reserveLayers[l],
  );

  const {
    sendTransaction,
    data: tipTxHash,
    isPending: tipSending,
    error: tipSendError,
    reset: resetTip,
  } = useSendTransaction();
  const { isLoading: tipConfirming, isSuccess: tipConfirmed } = useWaitForTransactionReceipt({
    hash: tipTxHash,
  });

  const [reserveState, setReserveState] = useState<'idle' | 'reserving' | 'done' | 'error'>('idle');
  const [reserveResult, setReserveResult] = useState<ReserveResult | null>(null);
  const [reserveError, setReserveError] = useState<string | null>(null);
  // Traits snapshotted at deposit time so later edits don't change what we book.
  const pendingTraitsRef = useRef<string[] | null>(null);
  // Guard so the confirm effect POSTs the reservation exactly once per tip tx.
  const reservedForTxRef = useRef<string | null>(null);

  const reserveBusy = tipSending || tipConfirming || reserveState === 'reserving';

  const toggleReserveLayer = (key: ReservableLayer) => {
    setReserveLayers(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleDeposit = () => {
    if (!address || !chainSupported) return;
    if (selectedReserveLayers.length === 0) {
      setReserveError('Pick at least one trait to require.');
      return;
    }
    setReserveError(null);
    setReserveResult(null);
    setReserveState('idle');
    reservedForTxRef.current = null;
    pendingTraitsRef.current = buildReserveTraits(seed, selectedReserveLayers);
    sendTransaction({ to: NOUNIRL_ADDRESS, value: parseEther(String(RESERVE_TIP_ETH)) });
  };

  // Once the tip is mined, create the reservation (the API requires a confirmed
  // tx). Runs once per tx hash.
  useEffect(() => {
    if (!tipConfirmed || !tipTxHash || !address || !chainId) return;
    if (reservedForTxRef.current === tipTxHash) return;
    const traits = pendingTraitsRef.current;
    if (!traits || traits.length === 0) return;

    reservedForTxRef.current = tipTxHash;
    setReserveState('reserving');
    reserveDream({ wallet: address, txHash: tipTxHash, chainId, traits })
      .then(result => {
        setReserveResult(result);
        setReserveState('done');
      })
      .catch(err => {
        setReserveError(err instanceof Error ? err.message : 'Failed to create reservation');
        setReserveState('error');
      });
  }, [tipConfirmed, tipTxHash, address, chainId]);

  const resetReserve = () => {
    resetTip();
    reservedForTxRef.current = null;
    pendingTraitsRef.current = null;
    setReserveState('idle');
    setReserveResult(null);
    setReserveError(null);
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
                  className="h-56 w-56"
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
              rows={2}
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
                      <span className="w-14 text-xs font-bold text-gray-500">{label}</span>
                      <button
                        type="button"
                        onClick={() => stepTrait(key, -1)}
                        className="border-border rounded border p-1 text-gray-500 hover:bg-gray-100"
                        title={`Previous ${label.toLowerCase()}`}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
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
                      <button
                        type="button"
                        onClick={() => stepTrait(key, 1)}
                        className="border-border rounded border p-1 text-gray-500 hover:bg-gray-100"
                        title={`Next ${label.toLowerCase()}`}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleLock(key)}
                        className={`rounded border p-1 transition-colors ${
                          locked[key]
                            ? 'border-black bg-black text-white'
                            : 'border-border text-gray-300 hover:text-gray-500'
                        }`}
                        title={locked[key] ? 'Locked — kept on randomize' : 'Lock this trait'}
                      >
                        {locked[key] ? (
                          <Lock className="h-3.5 w-3.5" />
                        ) : (
                          <Unlock className="h-3.5 w-3.5" />
                        )}
                      </button>
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

            {/* ── Action: save to gallery OR reserve at noc ── */}
            <div className="mt-auto space-y-3">
              <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
                <button
                  onClick={() => setAction('gallery')}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${action === 'gallery' ? 'bg-white shadow' : 'text-gray-500'}`}
                >
                  💾 Save to gallery
                </button>
                <button
                  onClick={() => mode === 'traits' && setAction('reserve')}
                  disabled={mode === 'upload'}
                  title={
                    mode === 'upload'
                      ? 'Custom art can’t be matched on-chain — pick traits to reserve'
                      : undefined
                  }
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
                    action === 'reserve' ? 'bg-white shadow' : 'text-gray-500'
                  } ${mode === 'upload' ? 'cursor-not-allowed opacity-40' : ''}`}
                >
                  🎯 Reserve at noc
                </button>
              </div>

              {action === 'gallery' ? (
                <>
                  <Button
                    onClick={handleSave}
                    disabled={!title.trim() || publishing}
                    className="w-full"
                  >
                    {publishing ? 'Publishing…' : address ? 'Publish Dream' : 'Save as Draft'}
                  </Button>
                  {!address && (
                    <p className="text-xs text-gray-500">
                      Connect a wallet to publish to probe.wtf. Otherwise this saves as a local
                      draft.
                    </p>
                  )}
                  {publishError && <p className="text-xs text-red-500">{publishError}</p>}
                </>
              ) : (
                <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <p className="flex items-start gap-1.5 text-xs text-gray-600">
                    <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" />
                    <span>
                      nounirl.eth watches every settlement and auto-settles the next Noun matching
                      your traits. Tip ~$5 to reserve — refunded by the win, withdraw anytime
                      before.
                    </span>
                  </p>

                  <div>
                    <p className="mb-1.5 text-[11px] font-bold uppercase text-gray-500">
                      Require these traits
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {RESERVABLE_LAYERS.map(({ key, label }) => {
                        const on = reserveLayers[key];
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => toggleReserveLayer(key)}
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                              on
                                ? 'border-black bg-black text-white'
                                : 'border-gray-300 bg-white text-gray-500 hover:border-gray-400'
                            }`}
                            title={`${label}: ${traitName(key, seed[key])}`}
                          >
                            {label}: {traitName(key, seed[key])}
                          </button>
                        );
                      })}
                    </div>
                    {selectedReserveLayers.length === 0 && (
                      <p className="mt-1 text-[11px] text-amber-600">
                        Select at least one trait to require.
                      </p>
                    )}
                  </div>

                  {reserveState === 'done' && reserveResult ? (
                    <div className="space-y-1 rounded-lg bg-green-50 p-2.5 text-xs text-green-700">
                      <p className="font-bold">✅ Reservation active</p>
                      <p>Watching for: {reserveResult.traits.join(', ')}</p>
                      <button
                        type="button"
                        onClick={resetReserve}
                        className="mt-1 text-[11px] font-bold text-green-800 underline"
                      >
                        Reserve another
                      </button>
                    </div>
                  ) : (
                    <>
                      <Button
                        onClick={handleDeposit}
                        disabled={
                          !address ||
                          !chainSupported ||
                          selectedReserveLayers.length === 0 ||
                          reserveBusy
                        }
                        className="w-full"
                      >
                        {tipSending
                          ? 'Confirm in wallet…'
                          : tipConfirming
                            ? 'Confirming tip…'
                            : reserveState === 'reserving'
                              ? 'Creating reservation…'
                              : `Deposit ~$5 (${RESERVE_TIP_ETH} ETH) to reserve`}
                      </Button>
                      {!address && (
                        <p className="text-[11px] text-gray-500">Connect a wallet to reserve.</p>
                      )}
                      {address && !chainSupported && (
                        <p className="text-[11px] text-amber-600">
                          Switch to a supported chain:{' '}
                          {Object.values(RESERVE_SUPPORTED_CHAINS).join(', ')}.
                        </p>
                      )}
                      {address && chainSupported && (
                        <p className="text-[11px] text-gray-400">
                          Tipping on {RESERVE_SUPPORTED_CHAINS[chainId]}.
                        </p>
                      )}
                      {tipSendError && (
                        <p className="text-[11px] text-red-500">
                          {tipSendError.message.includes('User rejected')
                            ? 'Transaction rejected.'
                            : tipSendError.message}
                        </p>
                      )}
                      {reserveError && <p className="text-[11px] text-red-500">{reserveError}</p>}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DreamCreatePanel;
