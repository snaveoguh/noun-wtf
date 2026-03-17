import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import { toast } from 'sonner';

import {
  smallGrantsTreasuryAbi,
  SMALL_GRANTS_TREASURY_ADDRESS,
} from '@/contracts/small-grants-treasury';

import classes from './Grants.module.css';

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
  const [transactions, setTransactions] = useState<GrantTx[]>([
    { target: '', value: '0', signature: '', calldata: '0x' },
  ]);

  const { writeContractAsync, data: txHash, isPending } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    toast.error('Noun Grants is experimental. Unaudited contract — use at your own risk.', {
      duration: 8000,
      id: 'grants-risk-warning',
    });
  }, []);

  if (isSuccess) {
    toast.success('Grant proposal created!');
    navigate('/grants');
  }

  function updateTx(idx: number, field: keyof GrantTx, val: string) {
    setTransactions(prev => prev.map((t, i) => (i === idx ? { ...t, [field]: val } : t)));
  }

  function addTx() {
    if (transactions.length >= 10) return;
    setTransactions(prev => [...prev, { target: '', value: '0', signature: '', calldata: '0x' }]);
  }

  function removeTx(idx: number) {
    setTransactions(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit() {
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

    try {
      await writeContractAsync({
        address: SMALL_GRANTS_TREASURY_ADDRESS,
        abi: smallGrantsTreasuryAbi,
        functionName: 'propose',
        args: [targets, values, signatures, calldatas, description],
      });
    } catch (e: any) {
      toast.error(e?.shortMessage || 'Failed to create grant');
    }
  }

  return (
    <div className={classes.container}>
      <h1 className={classes.title}>Create Grant Proposal</h1>
      <p className={classes.subtitle}>
        This proposal enters a 12-hour voting period immediately.
        <br />
        If it passes (even with just 1 FOR vote), it has a 12-hour timelock before execution.
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
          <div key={idx} className={classes.txRow}>
            <div className={classes.txHeader}>
              <span>Transaction #{idx + 1}</span>
              {transactions.length > 1 && (
                <button className={classes.removeTx} onClick={() => removeTx(idx)}>
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
          <button className={classes.addTxBtn} onClick={addTx}>
            + Add Transaction
          </button>
        )}

        <button
          className={classes.submitBtn}
          disabled={isPending || !address}
          onClick={handleSubmit}
        >
          {isPending ? 'Signing...' : !address ? 'Connect Wallet' : 'Submit Grant Proposal'}
        </button>
      </div>
    </div>
  );
}
