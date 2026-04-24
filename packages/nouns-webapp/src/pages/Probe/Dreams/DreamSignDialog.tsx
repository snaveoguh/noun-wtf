import { FC, useState } from 'react';

import dayjs from 'dayjs';
import { toast } from 'sonner';
import { useAccount, useSignTypedData } from 'wagmi';

import { Button } from '@/components/ui/button';
import useModalBodyLock from '@/hooks/useModalBodyLock';
import { buildSponsorTypedData } from '@/lib/dreamCandidate';
import { useAddSignature } from '@/wrappers/nounsData';
import { useUserVotes } from '@/wrappers/nounToken';
import { type ProposalCandidate } from '@/wrappers/nounsData';

interface Props { candidate: ProposalCandidate; onClose: () => void; onSigned: () => void; }

const DreamSignDialog: FC<Props> = ({ candidate, onClose, onSigned }) => {
  useModalBodyLock(true);
  const { address } = useAccount();
  const availableVotes = useUserVotes();
  const hasVotes = availableVotes && availableVotes > 0;
  const { signTypedDataAsync } = useSignTypedData();
  const { addSignature } = useAddSignature();
  const defaultDate = dayjs().add(7, 'day').format('YYYY-MM-DD');
  const [expirationDate, setExpirationDate] = useState(defaultDate);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSign = async () => {
    if (!address || !hasVotes) return;
    const expirationTimestamp = Math.floor(new Date(expirationDate).getTime() / 1000);
    if (expirationTimestamp <= Math.floor(Date.now() / 1000)) { toast.error('Expiration must be in the future'); return; }
    setSubmitting(true);
    try {
      const typedData = buildSponsorTypedData(candidate, expirationTimestamp);
      const signature = await signTypedDataAsync({ domain: typedData.domain, types: typedData.types, primaryType: typedData.primaryType, message: typedData.message });
      await addSignature({ args: [signature, BigInt(expirationTimestamp), candidate.proposer, candidate.slug, BigInt(candidate.proposalIdToUpdate ?? 0), typedData.encodedProp, reason] });
      toast.success('Signature added!'); onSigned(); onClose();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to sign'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-[1040] flex items-center justify-center bg-black/60" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mx-4 w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-xl font-bold">Sponsor Dream</h2>
          <button onClick={onClose} className="text-2xl text-gray-400 hover:text-gray-600">&times;</button>
        </div>
        <div className="space-y-4 p-6">
          <p className="text-sm text-gray-600">Sign with your Noun{availableVotes && availableVotes > 1 ? 's' : ''} to sponsor this dream.</p>
          <div><label className="mb-1 block text-sm font-semibold text-gray-700">Expiration date</label><input type="date" value={expirationDate} onChange={e => setExpirationDate(e.target.value)} className="border-border w-full rounded-lg border px-3 py-2 text-sm" /></div>
          <div><label className="mb-1 block text-sm font-semibold text-gray-700">Reason (optional)</label><textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Why are you sponsoring?" rows={3} className="border-border w-full rounded-lg border px-3 py-2 text-sm" /></div>
          {!hasVotes && <p className="text-sm font-semibold text-red-500">You need at least 1 Noun to sponsor</p>}
          <Button onClick={handleSign} disabled={submitting || !address || !hasVotes} className="w-full">{submitting ? 'Signing...' : 'Sign & Sponsor'}</Button>
        </div>
      </div>
    </div>
  );
};

export default DreamSignDialog;
