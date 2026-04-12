import { useEffect, useState } from 'react';

import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { parseEther } from 'viem';
import { useAccount, useSignTypedData } from 'wagmi';

import { SMALL_GRANTS_TREASURY_ADDRESS } from '@/contracts/small-grants-treasury';

import classes from './Grants.module.css';

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
  const [txIdCounter, setTxIdCounter] = useState(1);
  const [transactions, setTransactions] = useState<(GrantTx & { _id: number })[]>([
    { _id: 0, target: '', value: '0', signature: '', calldata: '0x' },
  ]);

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
      const res = await fetch('/api/grants/propose', {
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

      toast.success(`Grant proposal submitted! Tx: ${(data.txHash ?? '').slice(0, 10)}...`);
      navigate('/grants');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to create grant';
      if (!msg.includes('User rejected')) {
        toast.error(msg);
      }
    } finally {
      setSubmitting(false);
    }
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
              placeholder="Target address (0x...)"
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
