import { FC, useMemo, useState } from 'react';

/**
 * Image with a deterministic fallback chain. Tries each `srcs` URL in order;
 * if one 404s (or otherwise fails to load) advances to the next. Used for
 * dream cards because the probe-dreams static archive (rendered SVG +
 * custom-trait PNG) lags behind on-chain dreams — recent dreams don't have
 * a baked SVG yet, so the previously-naive `<img src={nounSvgUrl}>` ended
 * up with a broken-image placeholder until the archive caught up. With the
 * cascade we fall through to artworkUri / customTraitUrl / placeholder
 * automatically. Fully client-side, no extra network probes.
 */
function FallbackImg({
  srcs,
  alt,
  className,
  style,
}: {
  srcs: ReadonlyArray<string | null | undefined>;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const candidates = srcs.filter((s): s is string => typeof s === 'string' && s.length > 0);
  const [idx, setIdx] = useState(0);
  if (candidates.length === 0 || idx >= candidates.length) {
    return (
      <div
        className="flex h-32 w-full items-center justify-center text-3xl text-gray-300"
        style={style}
      >
        ?
      </div>
    );
  }
  return (
    <img
      src={candidates[idx]}
      alt={alt}
      className={className}
      style={style}
      onError={() => setIdx(i => i + 1)}
    />
  );
}

// Dreams are V2-era compositions — switch to V2 ImageData so V2-only
// founder traits (slobber, missingnoun, white/black bodies, multicolor)
// resolve correctly when rendering draft / on-chain dreams.
import { ImageDataV2 as ImageData, getNounDataV2 as getNounData } from '@nouns/assets';
import { buildSVG } from '@nouns/sdk';
import { Plus, Trash2, Upload } from 'lucide-react';
import { Link } from 'react-router';
import { useAccount } from 'wagmi';

import DreamDetailPopover from '@/components/DreamDetailPopover';
// Slug-dispatched seeded button — every dream gets a different style
// (Terminal / Neo-Bauhaus / Decay) so the dream feed looks varied without
// being random per render. Same dream always gets the same button.
import { DreamButton } from '@/components/DreamButton';
import { Button } from '@/components/ui/button';
import { useDreamCandidates, type OnChainDream } from '@/hooks/useDreamCandidates';
import { useDreamDrafts } from '@/hooks/useDreamDrafts';
import { useProbeDreams, type ProbeDreamWithPreview } from '@/hooks/useProbeDreams';
import { type SavedDream } from '@/lib/dreamStorage';
import { useCandidateProposal } from '@/wrappers/nounsData';
import { useUserVotes } from '@/wrappers/nounToken';

import DreamCreatePanel from './Dreams/DreamCreatePanel';
import DreamProposeDialog from './Dreams/DreamProposeDialog';
import DreamSignDialog from './Dreams/DreamSignDialog';

type DreamSubTab = 'drafts' | 'archive' | 'onchain';

function DreamDraftCard({
  dream,
  onDelete,
  onSelect,
  selected,
}: {
  dream: SavedDream;
  onDelete: (id: string) => void;
  onSelect: (dream: SavedDream) => void;
  selected: boolean;
}) {
  const svgUri = useMemo(() => {
    try {
      const { parts, background } = getNounData(dream.seed);
      const svg = buildSVG(parts, ImageData.palette, background);
      return `data:image/svg+xml;base64,${btoa(svg)}`;
    } catch {
      return '';
    }
  }, [dream.seed]);

  return (
    <div
      onClick={() => onSelect(dream)}
      className={`group relative cursor-pointer overflow-hidden rounded-2xl border-2 bg-white shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg ${
        selected ? 'border-black' : 'border-gray-200'
      }`}
    >
      <button
        onClick={e => {
          e.stopPropagation();
          onDelete(dream.id);
        }}
        className="absolute right-2 top-2 z-10 hidden rounded-full bg-red-500 p-1.5 text-white transition-colors hover:bg-red-600 group-hover:block"
        title="Delete dream"
      >
        <Trash2 className="h-3 w-3" />
      </button>

      <div
        className="flex items-center justify-center py-4"
        style={{ backgroundColor: `#${ImageData.bgcolors[dream.seed.background] ?? 'd5d7e1'}` }}
      >
        {svgUri && (
          <img
            src={svgUri}
            alt={dream.title}
            className="h-24 w-24 transition-transform group-hover:scale-110"
            style={{ imageRendering: 'pixelated' }}
          />
        )}
      </div>

      <div className="p-3">
        <h3 className="truncate text-sm font-bold">{dream.title}</h3>
        <div className="mt-1 flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
              dream.status === 'draft'
                ? 'bg-gray-100 text-gray-600'
                : dream.status === 'candidate'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-green-100 text-green-700'
            }`}
          >
            {dream.status}
          </span>
          <span className="text-muted-foreground text-xs">
            {new Date(dream.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>
    </div>
  );
}

function OnChainDreamCard({
  dream,
  onSponsor,
  onPromote,
  isProposer,
  hasVotes,
}: {
  dream: OnChainDream;
  onSponsor: () => void;
  onPromote: () => void;
  isProposer: boolean;
  hasVotes: boolean;
}) {
  // Threshold for promotion: need at least 2 noun votes from signatures
  const canPromote = isProposer && dream.signaturesCount >= 2;

  return (
    <div className="group overflow-hidden rounded-2xl border-2 border-gray-200 bg-white shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
      <div className="relative flex items-end justify-center overflow-hidden bg-gray-100">
        {/* Cascading fallback — prefer the pre-rendered full noun SVG (has
            custom trait baked in), then artworkUri, then bare trait. Recent
            dreams aren't in the static archive yet so the first src 404s;
            FallbackImg flips to the next on error rather than leaving a
            broken-image placeholder visible (bug seen on dreams 685, 693). */}
        <FallbackImg
          srcs={[dream.nounSvgUrl, dream.artworkUri, dream.customTraitUrl]}
          alt={dream.title}
          className="w-full"
          style={{ imageRendering: 'pixelated', display: 'block' }}
        />
      </div>

      <div className="p-3">
        <h3 className="truncate text-sm font-bold">{dream.title}</h3>
        <div className="mt-1 flex items-center gap-2">
          {dream.signaturesCount > 0 && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
              {dream.signaturesCount} sig{dream.signaturesCount !== 1 && 's'}
            </span>
          )}
        </div>
        <p className="text-muted-foreground mt-1 text-[10px]">
          {dream.proposer.slice(0, 6)}...{dream.proposer.slice(-4)}
        </p>

        {/* Action buttons — DreamButton dispatches a seeded style per dream
            slug so the feed has visual variety while staying deterministic.
            All three buttons for the same dream share a slug, so they
            render in the *same* style with consistent variant accents
            (sponsor=blue, promote=green, view=gray). */}
        <div className="mt-2 flex gap-1.5">
          {hasVotes && (
            <div className="flex-1">
              <DreamButton
                label="Sponsor"
                variant="sponsor"
                dreamSlug={dream.id}
                onClick={e => {
                  e.stopPropagation();
                  onSponsor();
                }}
              />
            </div>
          )}
          {canPromote ? (
            <div className="flex-1">
              <DreamButton
                label="Promote"
                variant="promote"
                dreamSlug={dream.id}
                onClick={e => {
                  e.stopPropagation();
                  onPromote();
                }}
              />
            </div>
          ) : (
            <Link
              to={`/candidates/${dream.id}`}
              className="flex-1"
              onClick={e => e.stopPropagation()}
            >
              <DreamButton label="View" variant="view" dreamSlug={dream.id} />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function ProbeDreamCard({
  dream,
  onClick,
  onPropose,
}: {
  dream: ProbeDreamWithPreview;
  onClick?: (e: React.MouseEvent) => void;
  onPropose?: () => void;
}) {
  const hasCustomTrait = !!dream.customLayer;

  return (
    <div
      onClick={onClick}
      className="group relative cursor-pointer overflow-hidden rounded-2xl border-2 border-gray-200 bg-white shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
    >
      <div
        className="relative flex items-end justify-center overflow-hidden"
        style={{ backgroundColor: `#${ImageData.bgcolors[dream.seeds.background] ?? 'd5d7e1'}` }}
      >
        {/* useProbeDreams always sets nounSvgUrl to either the bundled
            file (id ≤ 721) or a client-built data URL (data: URLs can't
            404), so the cascade only matters as a defensive belt+braces.
            customTraitUrl is the last-resort placeholder. */}
        <FallbackImg
          srcs={[dream.nounSvgUrl, dream.customTraitUrl]}
          alt={`Dream #${dream.id}`}
          className="w-full"
          style={{ imageRendering: 'pixelated', display: 'block' }}
        />
        {dream.customTraitUrl && !dream.customTraitIsBaked && (
          <img
            src={dream.customTraitUrl}
            alt=""
            className="absolute inset-0 h-full w-full"
            style={{ imageRendering: 'pixelated', objectFit: 'contain' }}
          />
        )}
        {dream.overlayTopSvgUrl && (
          <img
            src={dream.overlayTopSvgUrl}
            alt=""
            className="absolute inset-0 h-full w-full"
            style={{ imageRendering: 'pixelated', objectFit: 'contain' }}
          />
        )}
      </div>

      <div className="p-3">
        <h3 className="truncate text-sm font-bold">Dream #{dream.id}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {hasCustomTrait && (
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold uppercase text-purple-700">
              Custom {dream.customLayer}
            </span>
          )}
          <span className="text-muted-foreground text-[10px]">
            {new Date(dream.createdAt).toLocaleDateString()}
          </span>
        </div>
        <p className="text-muted-foreground mt-1 text-[10px]">
          {dream.dreamer.slice(0, 6)}...{dream.dreamer.slice(-4)}
        </p>

        {/* Propose button — uses DreamButton with the dream id as slug so
            the propose action keeps the same visual style as that dream's
            sponsor/promote/view buttons elsewhere in the feed. */}
        {hasCustomTrait && onPropose && (
          <div className="mt-2 w-full">
            <DreamButton
              label="Propose Trait"
              variant="create"
              dreamSlug={String(dream.id)}
              onClick={e => {
                e.stopPropagation();
                onPropose();
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const DreamsTab: FC = () => {
  const { drafts, saveDraft, removeDraft } = useDreamDrafts();
  const { dreams: onChainDreams, loading: onChainLoading } = useDreamCandidates();
  const { dreams: probeDreams, loading: probeLoading } = useProbeDreams();
  const [subTab, setSubTab] = useState<DreamSubTab>('archive');
  const [showCreate, setShowCreate] = useState(false);
  const [proposingDream, setProposingDream] = useState<SavedDream | null>(null);
  const [signingCandidateId, setSigningCandidateId] = useState<string | null>(null);
  const [selectedDraft, setSelectedDraft] = useState<SavedDream | null>(null);

  const [dreamPopover, setDreamPopover] = useState<{
    dream: ProbeDreamWithPreview;
    rect: DOMRect;
  } | null>(null);

  // Wallet state for sponsor/promote
  const { address } = useAccount();
  const availableVotes = useUserVotes();
  const hasVotes = (availableVotes ?? 0) > 0;

  // Fetch full candidate data when signing
  const { data: signingCandidate } = useCandidateProposal(signingCandidateId ?? '', 0, false);

  const sortedDrafts = useMemo(
    () => [...drafts].sort((a, b) => b.createdAt - a.createdAt),
    [drafts],
  );

  return (
    <div className="py-4">
      {/* Sub-tabs + create button */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-2">
          {[
            {
              key: 'archive' as const,
              icon: String.fromCodePoint(0x1f4ad),
              count: probeDreams.length,
            },
            {
              key: 'onchain' as const,
              icon: String.fromCodePoint(0x26d3),
              count: onChainDreams.length,
            },
            { key: 'drafts' as const, icon: String.fromCodePoint(0x1f58c), count: drafts.length },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-bold transition-colors ${
                subTab === t.key
                  ? 'bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t.icon} {t.count}
            </button>
          ))}
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-1">
          <Plus className="h-4 w-4" />
          Create Dream
        </Button>
      </div>

      {/* Archive view — all probe.wtf dreams */}
      {subTab === 'archive' && (
        <>
          {probeLoading ? (
            <div className="py-16 text-center">
              <p className="text-muted-foreground">Loading dreams...</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {probeDreams.map(dream => (
                <ProbeDreamCard
                  key={dream.id}
                  dream={dream}
                  onClick={e => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setDreamPopover(prev => (prev?.dream.id === dream.id ? null : { dream, rect }));
                  }}
                  onPropose={
                    dream.customLayer &&
                    address &&
                    dream.dreamer.toLowerCase() === address.toLowerCase()
                      ? () => {
                          // Navigate to create-candidate with dream pre-filled
                          // The custom trait image URL and layer info encode into the proposal
                          const params = new URLSearchParams({
                            dreamId: String(dream.id),
                            traitLayer: dream.customLayer!,
                            traitImage: dream.customTraitUrl ?? '',
                            traitName:
                              dream.customImage?.replace(/\.\w+$/, '').replace(/[_-]/g, ' ') ??
                              'Custom Trait',
                          });
                          window.location.href = `/create-candidate?${params}`;
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Drafts view */}
      {subTab === 'drafts' && (
        <>
          {sortedDrafts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="mb-2 text-5xl">&#x1F4AD;</p>
              <p className="mb-1 text-xl font-bold">No dreams yet</p>
              <p className="text-muted-foreground mb-4">
                Dream up a Noun and it will appear here. Propose it to make it real.
              </p>
              <Button onClick={() => setShowCreate(true)} className="gap-1">
                <Plus className="h-4 w-4" />
                Create Your First Dream
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {sortedDrafts.map(dream => (
                <DreamDraftCard
                  key={dream.id}
                  dream={dream}
                  onDelete={removeDraft}
                  onSelect={setSelectedDraft}
                  selected={selectedDraft?.id === dream.id}
                />
              ))}
            </div>
          )}

          {/* Selected draft detail */}
          {selectedDraft && (
            <div className="border-border mt-4 rounded-2xl border bg-white p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-bold">{selectedDraft.title}</h3>
                  {selectedDraft.description && (
                    <p className="text-muted-foreground mt-1">{selectedDraft.description}</p>
                  )}
                  <p className="text-muted-foreground mt-2 text-sm">
                    Created {new Date(selectedDraft.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link to={`/candidates/${selectedDraft.candidateSlug ?? ''}`}>
                    {selectedDraft.status === 'candidate' && (
                      <Button variant="outline" size="sm">
                        View Candidate
                      </Button>
                    )}
                  </Link>
                  {selectedDraft.status === 'draft' && selectedDraft.customTraitLayer && (
                    <Button
                      size="sm"
                      className="gap-1"
                      onClick={() => setProposingDream(selectedDraft)}
                    >
                      <Upload className="h-3 w-3" />
                      Propose Trait
                    </Button>
                  )}
                  {selectedDraft.status === 'draft' && !selectedDraft.customTraitLayer && (
                    <span className="text-xs text-gray-400">
                      Standard traits only — add a custom trait to propose
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* On-chain view */}
      {subTab === 'onchain' && (
        <>
          {onChainLoading ? (
            <div className="py-16 text-center">
              <p className="text-muted-foreground">Loading on-chain dreams...</p>
            </div>
          ) : onChainDreams.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="mb-2 text-5xl">&#x1F30C;</p>
              <p className="mb-1 text-xl font-bold">No on-chain dreams yet</p>
              <p className="text-muted-foreground">Create a dream and propose it to see it here.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {onChainDreams.map(dream => (
                <OnChainDreamCard
                  key={dream.id}
                  dream={dream}
                  isProposer={!!address && dream.proposer.toLowerCase() === address.toLowerCase()}
                  hasVotes={hasVotes}
                  onSponsor={() => setSigningCandidateId(dream.id)}
                  onPromote={() => {
                    // Navigate to create-candidate with dream context
                    window.location.href = `/candidates/${dream.id}`;
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Dream detail popover */}
      {dreamPopover && (
        <DreamDetailPopover
          dream={dreamPopover.dream}
          anchorRect={dreamPopover.rect}
          onClose={() => setDreamPopover(null)}
        />
      )}

      {/* Create dream dialog */}
      {showCreate && <DreamCreatePanel onSave={saveDraft} onClose={() => setShowCreate(false)} />}

      {/* Propose dialog */}
      {proposingDream && (
        <DreamProposeDialog
          dream={proposingDream}
          onClose={() => setProposingDream(null)}
          onProposed={() => {
            setSelectedDraft(null);
            setProposingDream(null);
          }}
        />
      )}

      {/* Sign/sponsor dialog */}
      {signingCandidateId && signingCandidate && (
        <DreamSignDialog
          candidate={signingCandidate}
          onClose={() => setSigningCandidateId(null)}
          onSigned={() => setSigningCandidateId(null)}
        />
      )}
    </div>
  );
};

export default DreamsTab;
