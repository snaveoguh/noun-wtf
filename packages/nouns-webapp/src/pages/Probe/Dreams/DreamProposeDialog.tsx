import { FC, useCallback, useMemo, useState } from 'react';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import { buildSVG } from '@nouns/sdk';
import { toast } from 'sonner';
import { type Address } from 'viem';
import { useAccount } from 'wagmi';

import { Button } from '@/components/ui/button';
import { buildDreamSlug, embedArtworkInDescription } from '@/lib/dreamConstants';
import { type SavedDream, updateDream } from '@/lib/dreamStorage';
import {
  useCreateProposalCandidate,
  useGetCreateCandidateCost,
} from '@/wrappers/nounsData';
import { useUserVotes } from '@/wrappers/nounToken';

interface Props {
  dream: SavedDream;
  onClose: () => void;
  onProposed: () => void;
}

const DreamProposeDialog: FC<Props> = ({ dream, onClose, onProposed }) => {
  const { address } = useAccount();
  const availableVotes = useUserVotes();
  const hasVotes = availableVotes && availableVotes > 0;
  const createCandidateCost = useGetCreateCandidateCost();
  const { createProposalCandidate } = useCreateProposalCandidate();

  const [title, setTitle] = useState(dream.title);
  const [description, setDescription] = useState(dream.description);
  const [submitting, setSubmitting] = useState(false);

  // Build SVG for embedding in description
  const svgDataUri = useMemo(() => {
    try {
      const { parts, background } = getNounData(dream.seed);
      const svg = buildSVG(parts, ImageData.palette, background);
      return `data:image/svg+xml;base64,${btoa(svg)}`;
    } catch {
      return '';
    }
  }, [dream.seed]);

  const slug = buildDreamSlug(dream.id);

  const handlePropose = useCallback(async () => {
    if (!address) {
      toast.error('Connect your wallet first');
      return;
    }
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }

    setSubmitting(true);
    try {
      const fullDescription = `# ${title.trim()}\n\n${embedArtworkInDescription(description.trim(), svgDataUri)}\n\n### Proposed via noun.wtf`;

      await createProposalCandidate({
        args: [
          [] as Address[], // targets (no transactions for basic dreams)
          [] as bigint[], // values
          [] as string[], // signatures
          [] as `0x${string}`[], // calldatas
          fullDescription,
          slug,
          0n, // proposalIdToUpdate
        ],
        value: hasVotes ? 0n : (createCandidateCost ?? 0n),
      });

      // Update local dream status
      updateDream(dream.id, { status: 'candidate', candidateSlug: slug });
      toast.success('Dream proposed on-chain!');
      onProposed();
      onClose();
    } catch (err) {
      console.error('Failed to propose dream:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to propose dream');
    } finally {
      setSubmitting(false);
    }
  }, [
    address, title, description, svgDataUri, slug, dream.id,
    createProposalCandidate, createCandidateCost, hasVotes, onClose, onProposed,
  ]);

  const costLabel = !hasVotes && createCandidateCost
    ? `(costs ${(Number(createCandidateCost) / 1e18).toFixed(4)} ETH)`
    : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="mx-4 w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-xl font-bold">Propose Dream On-Chain</h2>
          <button onClick={onClose} className="text-2xl text-gray-400 hover:text-gray-600">
            &times;
          </button>
        </div>

        <div className="space-y-4 p-6">
          {/* Preview */}
          {svgDataUri && (
            <div className="flex justify-center">
              <img
                src={svgDataUri}
                alt="Dream"
                className="h-32 w-32 rounded-xl"
                style={{
                  imageRendering: 'pixelated',
                  backgroundColor: `#${ImageData.bgcolors[dream.seed.background]}`,
                }}
              />
            </div>
          )}

          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Dream title..."
            className="border-border w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />

          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Describe your dream..."
            rows={4}
            className="border-border w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />

          <div className="rounded-lg bg-gray-50 p-3 text-sm">
            <p className="font-semibold">What happens next:</p>
            <ul className="text-muted-foreground mt-1 list-inside list-disc space-y-1 text-xs">
              <li>Your dream is created as a proposal candidate on-chain</li>
              <li>Noun holders can sponsor it with their signatures</li>
              <li>Once enough sponsors, it can be promoted to a full proposal</li>
              <li>The DAO then votes to accept or reject it</li>
            </ul>
          </div>

          {!hasVotes && createCandidateCost && (
            <p className="text-xs text-amber-600">
              Non-nouners pay a small fee to create candidates {costLabel}
            </p>
          )}

          {!address && (
            <p className="text-sm font-semibold text-red-500">Connect your wallet to propose</p>
          )}

          <Button
            onClick={handlePropose}
            disabled={submitting || !address || !title.trim()}
            className="w-full"
          >
            {submitting ? 'Submitting...' : `Propose Dream ${costLabel}`}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default DreamProposeDialog;
