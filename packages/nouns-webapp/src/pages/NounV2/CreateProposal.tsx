/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';

import { CopyIcon } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { parseEther } from 'viem';
import { useAccount, useReadContract, useWriteContract } from 'wagmi';

import { NOUNV2_TOKEN_ADDRESS, nounV2TokenAbi } from '@/contracts/nounv2-token';
import {
  NOUNV2_TREASURY_ADDRESS,
  nounV2TreasuryAbi,
} from '@/contracts/nounv2-treasury';

import classes from './NounV2.module.css';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

interface ProposalTx {
  target: string;
  value: string;
  signature: string;
  calldata: string;
}

export default function CreateNounV2ProposalPage() {
  const { address } = useAccount();
  const navigate = useNavigate();

  const addressMissing =
    NOUNV2_TREASURY_ADDRESS === ZERO_ADDRESS || NOUNV2_TOKEN_ADDRESS === ZERO_ADDRESS;

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedTx, setSubmittedTx] = useState<string | null>(null);
  const [txIdCounter, setTxIdCounter] = useState(1);
  const [advanced, setAdvanced] = useState(false);
  const [ethAmount, setEthAmount] = useState('');
  const [transactions, setTransactions] = useState<(ProposalTx & { _id: number })[]>([
    { _id: 0, target: address ?? '', value: '0', signature: '', calldata: '0x' },
  ]);

  useEffect(() => {
    if (address) {
      setTransactions(prev =>
        prev.map((t, i) => (i === 0 && !t.target ? { ...t, target: address } : t)),
      );
    }
  }, [address]);

  // Check voting power — proposing requires >= PROPOSAL_THRESHOLD (1).
  const { data: currentVotes } = useReadContract({
    address: NOUNV2_TOKEN_ADDRESS,
    abi: nounV2TokenAbi,
    functionName: 'getCurrentVotes',
    args: address ? [address] : undefined,
    query: { enabled: !!address && NOUNV2_TOKEN_ADDRESS !== ZERO_ADDRESS },
  });
  const votingPower = currentVotes != null ? Number(currentVotes) : 0;
  const meetsThreshold = votingPower >= 1;

  const { writeContractAsync } = useWriteContract();

  function updateTx(idx: number, field: keyof ProposalTx, val: string) {
    setTransactions(prev => prev.map((t, i) => (i === idx ? { ...t, [field]: val } : t)));
  }

  function addTx() {
    if (transactions.length >= 10) return;
    setTxIdCounter(c => c + 1);
    setTransactions(prev => [
      ...prev,
      { _id: txIdCounter, target: '', value: '0', signature: '', calldata: '0x' },
    ]);
  }

  function removeTx(idx: number) {
    setTransactions(prev => prev.filter((_, i) => i !== idx));
  }

  function buildProposal(): {
    targets: `0x${string}`[];
    values: bigint[];
    signatures: string[];
    calldatas: `0x${string}`[];
    description: string;
  } | null {
    if (!address) {
      toast.error('Connect your wallet first');
      return null;
    }
    if (!title.trim()) {
      toast.error('Title is required');
      return null;
    }
    if (advanced) {
      const validTxs = transactions.filter(
        t => t.target.startsWith('0x') && t.target.length === 42,
      );
      if (validTxs.length === 0) {
        toast.error('At least one transaction is required');
        return null;
      }
      try {
        return {
          targets: validTxs.map(t => t.target as `0x${string}`),
          values: validTxs.map(t => parseEther(t.value || '0')),
          signatures: validTxs.map(t => t.signature || ''),
          calldatas: validTxs.map(t => (t.calldata || '0x') as `0x${string}`),
          description: `# ${title.trim()}\n\n${body.trim()}`,
        };
      } catch {
        toast.error('Invalid transaction values');
        return null;
      }
    }

    const amt = parseFloat(ethAmount || '0');
    if (amt <= 0) {
      toast.error('Enter an ETH amount');
      return null;
    }
    return {
      targets: [address],
      values: [parseEther(ethAmount)],
      signatures: [''],
      calldatas: ['0x'],
      description: `# ${title.trim()}\n\n${body.trim()}`,
    };
  }

  async function handleSubmit() {
    const proposal = buildProposal();
    if (!proposal) return;
    if (!meetsThreshold) {
      toast.error('You need at least 1 NounV2 voting unit to propose');
      return;
    }

    setSubmitting(true);
    try {
      const hash = await writeContractAsync({
        address: NOUNV2_TREASURY_ADDRESS,
        abi: nounV2TreasuryAbi,
        functionName: 'propose',
        args: [
          proposal.targets,
          proposal.values,
          proposal.signatures,
          proposal.calldatas,
          proposal.description,
        ],
      });
      setSubmittedTx(hash);
    } catch (e: any) {
      const msg = e?.shortMessage || (e instanceof Error ? e.message : 'Failed to propose');
      if (!String(msg).includes('User rejected')) toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (addressMissing) {
    return (
      <div className={classes.container}>
        <h1 className={classes.title}>Create NounV2 Proposal</h1>
        <div className={classes.missingAddress}>
          NounV2 contracts not deployed yet — set{' '}
          <code>VITE_NOUNV2_TREASURY_ADDRESS</code> and <code>VITE_NOUNV2_TOKEN_ADDRESS</code>{' '}
          after deploy.
        </div>
      </div>
    );
  }

  if (submittedTx) {
    return (
      <div className={classes.container}>
        <div
          style={{
            maxWidth: 480,
            margin: '4rem auto',
            textAlign: 'center',
            padding: '2.5rem 2rem',
            border: '2px solid #fecaca',
            borderRadius: 16,
            background: '#fff',
          }}
        >
          <h2 style={{ fontSize: '1.3rem', marginBottom: '0.75rem', color: '#1e293b' }}>
            Proposal Submitted On-Chain
          </h2>
          <p style={{ color: '#64748b', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>
            Voting is open immediately for ~12 hours. After it succeeds, anyone can queue it and
            execute after the 12h timelock.
          </p>
          <a
            href={`https://etherscan.io/tx/${submittedTx}`}
            target="_blank"
            rel="noreferrer"
            style={{ display: 'inline-block', fontFamily: 'monospace', fontSize: '0.8rem', color: '#3b82f6', marginBottom: '1.5rem' }}
          >
            {submittedTx.slice(0, 18)}... (view on Etherscan)
          </a>
          <br />
          <button
            className={classes.submitBtn}
            onClick={() => navigate('/nounv2')}
            style={{ marginTop: '0.5rem' }}
          >
            Back to NounV2
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={classes.container}>
      <h1 className={classes.title}>Create NounV2 Proposal</h1>
      <p className={classes.subtitle}>
        Requires holding at least 1 NounV2 voting unit. Voting starts immediately and lasts ~12
        hours; execution waits a 12h timelock.
      </p>

      {address && !meetsThreshold && (
        <div className={classes.missingAddress}>
          Your wallet has <strong>{votingPower}</strong> NounV2 votes — below the proposal
          threshold of 1. You can still fill out the form, but the transaction will revert with
          <code> BelowProposalThreshold</code>.
        </div>
      )}

      <div className={classes.form}>
        <label className={classes.label}>Title</label>
        <input
          className={classes.input}
          type="text"
          placeholder="Fund community event"
          value={title}
          onChange={e => setTitle(e.target.value)}
        />

        <label className={classes.label}>Description</label>
        <textarea
          className={classes.textarea}
          placeholder="Describe the proposal in detail. Markdown supported."
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={8}
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            marginTop: '1.25rem',
            marginBottom: '0.25rem',
          }}
        >
          <button
            type="button"
            onClick={() => setAdvanced(a => !a)}
            style={{
              position: 'relative',
              width: 40,
              height: 22,
              borderRadius: 11,
              border: 'none',
              background: advanced ? '#dc2626' : '#d1d5db',
              cursor: 'pointer',
              transition: 'background 0.2s',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 2,
                left: advanced ? 20 : 2,
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: '#fff',
                transition: 'left 0.2s',
              }}
            />
          </button>
          <span
            style={{
              fontSize: '0.8rem',
              color: advanced ? '#b91c1c' : '#888',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Advanced
          </span>
        </div>

        <label className={classes.label}>Transactions</label>
        <div
          style={{
            padding: '8px 12px',
            borderRadius: '8px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            fontSize: '0.8rem',
            marginBottom: '8px',
            textTransform: 'none',
            color: '#7f1d1d',
          }}
        >
          Funded by{' '}
          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
            {NOUNV2_TREASURY_ADDRESS.slice(0, 6)}...{NOUNV2_TREASURY_ADDRESS.slice(-4)}
          </span>{' '}
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(NOUNV2_TREASURY_ADDRESS);
              toast.success('Address copied');
            }}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0 4px',
              fontSize: '0.75rem',
              color: '#7f1d1d',
              textTransform: 'none',
            }}
            title="Copy full address"
          >
            <CopyIcon size={13} />
          </button>
        </div>

        {advanced ? (
          <>
            {transactions.map((tx, idx) => (
              <div key={tx._id} className={classes.txRow}>
                <div className={classes.txHeader}>
                  <span>Transaction #{idx + 1}</span>
                  {transactions.length > 1 && (
                    <button
                      type="button"
                      className={classes.removeTx}
                      onClick={() => removeTx(idx)}
                    >
                      remove
                    </button>
                  )}
                </div>
                <input
                  className={classes.input}
                  placeholder="Recipient address (0x...)"
                  value={tx.target}
                  onChange={e => updateTx(idx, 'target', e.target.value)}
                />
                <input
                  className={classes.input}
                  placeholder="ETH value (e.g. 0.5)"
                  value={tx.value}
                  onChange={e => updateTx(idx, 'value', e.target.value)}
                />
                <input
                  className={classes.input}
                  placeholder="Function signature (optional, e.g. transfer(address,uint256))"
                  value={tx.signature}
                  onChange={e => updateTx(idx, 'signature', e.target.value)}
                />
                <input
                  className={classes.input}
                  placeholder="Calldata hex (optional, 0x)"
                  value={tx.calldata}
                  onChange={e => updateTx(idx, 'calldata', e.target.value)}
                />
              </div>
            ))}
            {transactions.length < 10 && (
              <button type="button" className={classes.addTxBtn} onClick={addTx}>
                + Add Transaction
              </button>
            )}
          </>
        ) : (
          <div className={classes.txRow}>
            <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: '0.5rem' }}>
              How much ETH do you need?
            </div>
            <input
              className={classes.input}
              type="number"
              step="0.01"
              min="0"
              placeholder="ETH amount"
              value={ethAmount}
              onChange={e => setEthAmount(e.target.value)}
              style={{ marginBottom: 0 }}
            />
          </div>
        )}

        <button
          type="button"
          className={classes.submitBtn}
          disabled={submitting || !address}
          onClick={handleSubmit}
        >
          {submitting
            ? 'Submitting...'
            : !address
              ? 'Connect Wallet'
              : 'Submit Proposal'}
        </button>
      </div>
    </div>
  );
}
