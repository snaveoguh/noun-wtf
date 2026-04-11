import { FC, useMemo, useState } from 'react';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import { buildSVG } from '@nouns/sdk';
import { Plus, Trash2, Upload } from 'lucide-react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { useDreamCandidates, type OnChainDream } from '@/hooks/useDreamCandidates';
import { useDreamDrafts } from '@/hooks/useDreamDrafts';
import { useProbeDreams, type ProbeDreamWithPreview } from '@/hooks/useProbeDreams';
import { type SavedDream } from '@/lib/dreamStorage';
import { useCandidateProposal } from '@/wrappers/nounsData';

import DreamDetailPopover from '@/components/DreamDetailPopover';

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
  selected,
  onSelect,
}: {
  dream: OnChainDream;
  selected: boolean;
  onSelect: (dream: OnChainDream) => void;
}) {
  return (
    <div
      onClick={() => onSelect(dream)}
      className={`group relative cursor-pointer overflow-hidden rounded-2xl border-2 bg-white shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg ${
        selected ? 'border-black' : 'border-gray-200'
      }`}
    >
      <div className="flex items-center justify-center bg-gray-100 py-4">
        {dream.artworkUri ? (
          <img
            src={dream.artworkUri}
            alt={dream.title}
            className="h-24 w-24"
            style={{ imageRendering: 'pixelated' }}
          />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center text-3xl text-gray-300">
            ?
          </div>
        )}
      </div>

      <div className="p-3">
        <h3 className="truncate text-sm font-bold">{dream.title}</h3>
        <div className="mt-1 flex items-center gap-2">
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-700">
            On-chain
          </span>
          {dream.signaturesCount > 0 && (
            <span className="text-xs text-gray-500">
              {dream.signaturesCount} sig{dream.signaturesCount !== 1 && 's'}
            </span>
          )}
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          by {dream.proposer.slice(0, 6)}...{dream.proposer.slice(-4)}
        </p>
      </div>
    </div>
  );
}

function ProbeDreamCard({ dream, onClick }: { dream: ProbeDreamWithPreview; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <div onClick={onClick} className="group relative cursor-pointer overflow-hidden rounded-2xl border-2 border-gray-200 bg-white shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
      <div
        className="relative flex items-end justify-center overflow-hidden"
        style={{ backgroundColor: `#${ImageData.bgcolors[dream.seeds.background] ?? 'd5d7e1'}` }}
      >
        {/* Full composed noun */}
        <img
          src={dream.nounSvgUrl}
          alt={`Dream #${dream.id}`}
          className="w-full transition-opacity"
          style={{ imageRendering: 'pixelated', display: 'block' }}
        />
        {/* On hover: dim the noun and overlay just the custom trait, scaled up */}
        {dream.customTraitUrl && (
          <>
            <div className="absolute inset-0 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100" />
            <img
              src={dream.customTraitUrl}
              alt="Custom trait"
              className="absolute inset-0 h-full w-full scale-75 opacity-0 transition-all group-hover:scale-100 group-hover:opacity-100"
              style={{ imageRendering: 'pixelated', objectFit: 'contain' }}
            />
          </>
        )}
      </div>

      <div className="p-3">
        <h3 className="truncate text-sm font-bold">Dream #{dream.id}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {dream.customLayer && (
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
  const [selectedOnChain, setSelectedOnChain] = useState<OnChainDream | null>(null);
  const [dreamPopover, setDreamPopover] = useState<{ dream: ProbeDreamWithPreview; rect: DOMRect } | null>(null);

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
          {([
            { key: 'archive' as const, icon: String.fromCodePoint(0x1F4AD), count: probeDreams.length },
            { key: 'onchain' as const, icon: String.fromCodePoint(0x26D3), count: onChainDreams.length },
            { key: 'drafts' as const, icon: String.fromCodePoint(0x1F58C), count: drafts.length },
          ]).map(t => (
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
                    setDreamPopover(prev => prev?.dream.id === dream.id ? null : { dream, rect });
                  }}
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
                  {selectedDraft.status === 'draft' && (
                    <Button size="sm" className="gap-1" onClick={() => setProposingDream(selectedDraft)}>
                      <Upload className="h-3 w-3" />
                      Propose On-Chain
                    </Button>
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
              <p className="text-muted-foreground">
                Create a dream and propose it to see it here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {onChainDreams.map(dream => (
                <OnChainDreamCard
                  key={dream.id}
                  dream={dream}
                  selected={selectedOnChain?.id === dream.id}
                  onSelect={setSelectedOnChain}
                />
              ))}
            </div>
          )}

          {/* Selected on-chain dream detail */}
          {selectedOnChain && (
            <div className="border-border mt-4 rounded-2xl border bg-white p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-bold">{selectedOnChain.title}</h3>
                  <p className="text-muted-foreground mt-1">{selectedOnChain.description}</p>
                  <p className="text-muted-foreground mt-2 text-sm">
                    Proposer: {selectedOnChain.proposer.slice(0, 6)}...
                    {selectedOnChain.proposer.slice(-4)}
                  </p>
                  {selectedOnChain.signaturesCount > 0 && (
                    <p className="mt-1 text-sm font-semibold text-blue-600">
                      {selectedOnChain.signaturesCount} sponsor signature
                      {selectedOnChain.signaturesCount !== 1 && 's'}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => setSigningCandidateId(selectedOnChain.id)}
                  >
                    Sponsor
                  </Button>
                  <Link to={`/candidates/${selectedOnChain.id}`}>
                    <Button variant="outline" size="sm">
                      View Candidate
                    </Button>
                  </Link>
                </div>
              </div>
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
      {showCreate && (
        <DreamCreatePanel onSave={saveDraft} onClose={() => setShowCreate(false)} />
      )}

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
