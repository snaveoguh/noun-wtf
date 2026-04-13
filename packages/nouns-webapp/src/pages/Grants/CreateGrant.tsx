import { useEffect, useState } from 'react';

import { CopyIcon } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { parseEther } from 'viem';
import { useAccount, useSignTypedData } from 'wagmi';

import { SMALL_GRANTS_TREASURY_ADDRESS } from '@/contracts/small-grants-treasury';

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

  useEffect(() => {
    toast.info('Grant proposals are gasless — you only sign a message, no ETH needed.', {
      duration: 6000,
      id: 'grants-gasless-info',
    });
  }, []);

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

  async function handleSubmit() {
    if (!address) {
      toast.error('Connect your wallet first');
      return;
    }
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    const validTxs = transactions.filter(t => t.target.startsWith('0x') && t.target.length === 42);
    if (validTxs.length === 0) {
      toast.error('At least one transaction is required');
      return;
    }

    const description = `# ${title.trim()}\n\n${body.trim()}`;
    const targets = validTxs.map(t => t.target as `0x${string}`);
    const values = validTxs.map(t => parseEther(t.value || '0'));
    const signatures = validTxs.map(t => t.signature || '');
    const calldatas = validTxs.map(t => (t.calldata || '0x') as `0x${string}`);

    setSubmitting(true);
    try {
      // Step 1: Sign EIP-712 typed data (free, no gas)
      const signature = await signTypedDataAsync({
        domain: GRANT_PROPOSAL_DOMAIN,
        types: GRANT_PROPOSAL_TYPES,
        primaryType: 'Proposal',
        message: {
          targets,
          values,
          signatures,
          calldatas,
          description,
        },
      });

      // Step 2: Submit to relay API (relayer pays gas)
      const res = await fetch(`${API_BASE}/api/grants/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposer: address,
          targets,
          values: values.map(v => v.toString()),
          signatures,
          calldatas,
          description,
          signature,
        }),
      });

      const data = (await res.json()) as { error?: string; txHash?: string };

      if (!res.ok) {
        throw new Error(data.error ?? 'Relay failed');
      }

      setSubmittedTx(data.txHash ?? '');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to create grant';
      if (!msg.includes('User rejected')) {
        toast.error(msg);
      }
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
        Gasless — you sign a message, we submit the transaction.
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
        {transactions.map((tx, idx) => (
          <div key={tx._id} className={classes.txRow}>
            <div className={classes.txHeader}>
              <span>Transaction #{idx + 1}</span>
              {transactions.length > 1 && (
                <button type="button" className={classes.removeTx} onClick={() => removeTx(idx)}>
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

        <button
          type="button"
          className={classes.submitBtn}
          disabled={submitting || !address}
          onClick={handleSubmit}
        >
          {submitting
            ? 'Signing & submitting...'
            : !address
              ? 'Connect Wallet'
              : 'Submit Grant Proposal (Gasless)'}
        </button>
      </div>
    </div>
  );
}
