import { useEffect, useState } from 'react';

import { CopyIcon } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { parseEther } from 'viem';
import { useAccount, useSignTypedData, useWriteContract } from 'wagmi';

import { smallGrantsTreasuryAbi, SMALL_GRANTS_TREASURY_ADDRESS } from '@/contracts/small-grants-treasury';

import classes from './Grants.module.css';

const API_BASE = (
  (import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app'
).replace(/\/graphql\/?$/, '');

// EIP-712 domain and types — must match the API relayer
const GRANT_PROPOSAL_DOMAIN = {
  name: 'NounGrants',
  version: '1',
  chainId: 1,
  verifyingContract: SMALL_GRANTS_TREASURY_ADDRESS,
} as const;

const GRANT_PROPOSAL_TYPES = {
  Proposal: [
    { name: 'targets', type: 'address[]' },
    { name: 'values', type: 'uint256[]' },
    { name: 'signatures', type: 'string[]' },
    { name: 'calldatas', type: 'bytes[]' },
    { name: 'description', type: 'string' },
  ],
} as const;

interface GrantTx {
  target: string;
  value: string; // ETH
  signature: string;
  calldata: string;
}

export default function CreateGrantPage() {
  const { address } = useAccount();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedTx, setSubmittedTx] = useState<string | null>(null);
  const [txIdCounter, setTxIdCounter] = useState(1);
  const [advanced, setAdvanced] = useState(false);
  const [ethAmount, setEthAmount] = useState('');
  const [transactions, setTransactions] = useState<(GrantTx & { _id: number })[]>([
    { _id: 0, target: address ?? '', value: '0', signature: '', calldata: '0x' },
  ]);

  // Prefill target with connected wallet when it becomes available
  useEffect(() => {
    if (address) {
      setTransactions(prev =>
        prev.map((t, i) => (i === 0 && !t.target ? { ...t, target: address } : t)),
      );
    }
  }, [address]);

  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();

  function updateTx(idx: number, field: keyof GrantTx, val: string) {
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
      return {
        targets: validTxs.map(t => t.target as `0x${string}`),
        values: validTxs.map(t => parseEther(t.value || '0')),
        signatures: validTxs.map(t => t.signature || ''),
        calldatas: validTxs.map(t => (t.calldata || '0x') as `0x${string}`),
        description: `# ${title.trim()}\n\n${body.trim()}`,
      };
    }

    const amt = parseFloat(ethAmount || '0');
    if (amt <= 0) {
      toast.error('Enter an ETH amount');
      return null;
    }
    if (amt > 0.42) {
      toast.error('Max 0.42 ETH');
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

  async function handleGasless() {
    const proposal = buildProposal();
    if (!proposal) return;

    setSubmitting(true);
    try {
      const signature = await signTypedDataAsync({
        domain: GRANT_PROPOSAL_DOMAIN,
        types: GRANT_PROPOSAL_TYPES,
        primaryType: 'Proposal',
        message: proposal,
      });

      const res = await fetch(`${API_BASE}/api/grants/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposer: address,
          targets: proposal.targets,
          values: proposal.values.map(v => v.toString()),
          signatures: proposal.signatures,
          calldatas: proposal.calldatas,
          description: proposal.description,
          signature,
        }),
      });

      const data = (await res.json()) as { error?: string; txHash?: string };
      if (!res.ok) throw new Error(data.error ?? 'Relay failed');
      setSubmittedTx(data.txHash ?? '');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to create grant';
      if (!msg.includes('User rejected')) toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWithGas() {
    const proposal = buildProposal();
    if (!proposal) return;

    setSubmitting(true);
    try {
      const hash = await writeContractAsync({
        address: SMALL_GRANTS_TREASURY_ADDRESS,
        abi: smallGrantsTreasuryAbi,
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to create grant';
      if (!msg.includes('User rejected')) toast.error(msg);
    } finally {
      setSubmitting(false);
    }
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
            border: '2px solid #e2e8f0',
            borderRadius: 16,
            background: '#fff',
          }}
        >
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>{'\u2310\u25E8-\u25E8'}</div>
          <h2 style={{ fontSize: '1.3rem', marginBottom: '0.75rem', color: '#1e293b' }}>
            Grant Submitted On-Chain
          </h2>
          <p
            style={{
              color: '#64748b',
              fontSize: '0.9rem',
              lineHeight: 1.6,
              marginBottom: '1.5rem',
            }}
          >
            Your proposal is confirmed on Ethereum. The indexer needs ~1-2 minutes to pick it up
            before it appears in the grants list. Voting starts immediately.
          </p>
          <a
            href={`https://etherscan.io/tx/${submittedTx}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-block',
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              color: '#3b82f6',
              marginBottom: '1.5rem',
            }}
          >
            {submittedTx.slice(0, 18)}... (view on Etherscan)
          </a>
          <br />
          <button
            className={classes.submitBtn}
            onClick={() => navigate('/grants')}
            style={{ marginTop: '0.5rem' }}
          >
            Go to Grants
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={classes.container}>
      <h1 className={classes.title}>Create Grant Proposal</h1>
      <p className={classes.subtitle}>
        Submit gasless (we pay the gas) or pay gas yourself.
        <br />
        The proposal enters a 12-hour voting period immediately.
      </p>

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
          placeholder="Describe the grant proposal in detail. Markdown supported."
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={8}
        />

        {/* Advanced toggle */}
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
              background: advanced ? '#22d3ee' : '#d1d5db',
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
              color: advanced ? '#0891b2' : '#888',
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
            background: '#f0f9ff',
            border: '1px solid #bae6fd',
            fontSize: '0.8rem',
            marginBottom: '8px',
            textTransform: 'none',
            color: '#334155',
          }}
        >
          Funded by{' '}
          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
            {SMALL_GRANTS_TREASURY_ADDRESS.slice(0, 6)}...{SMALL_GRANTS_TREASURY_ADDRESS.slice(-4)}
          </span>{' '}
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(SMALL_GRANTS_TREASURY_ADDRESS);
              toast.success('Address copied');
            }}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0 4px',
              fontSize: '0.75rem',
              color: '#64748b',
              textTransform: 'none',
            }}
            title="Copy full address"
          >
            <CopyIcon size={13} />
          </button>{' '}
          <span style={{ color: '#64748b' }}>(Small Grants Treasury)</span>
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
              max="0.42"
              placeholder="ETH amount (max 0.42)"
              value={ethAmount}
              onChange={e => {
                const v = e.target.value;
                if (v === '' || (parseFloat(v) >= 0 && parseFloat(v) <= 0.42)) {
                  setEthAmount(v);
                }
              }}
              style={{ marginBottom: 0 }}
            />
            {parseFloat(ethAmount) > 0.42 && (
              <div style={{ fontSize: '0.75rem', color: '#f87171', marginTop: 4 }}>
                Max 0.42 ETH
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '2rem' }}>
          <button
            type="button"
            className={classes.submitBtn}
            style={{ flex: 1, marginTop: 0 }}
            disabled={submitting || !address}
            onClick={handleGasless}
          >
            {submitting ? 'Submitting...' : !address ? 'Connect Wallet' : 'Submit Gasless'}
          </button>
          <button
            type="button"
            className={classes.submitBtn}
            style={{
              flex: 1,
              marginTop: 0,
              background: 'transparent',
              border: '2px solid #22d3ee',
              color: '#0891b2',
            }}
            disabled={submitting || !address}
            onClick={handleWithGas}
          >
            {submitting ? 'Submitting...' : 'Pay Gas'}
          </button>
        </div>
      </div>
    </div>
  );
}
