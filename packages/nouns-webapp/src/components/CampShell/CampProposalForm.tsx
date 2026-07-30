import { useEffect, useMemo, useRef, useState } from 'react';

import { PlusIcon, XIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { decodeFunctionData, formatEther, parseAbi } from 'viem';

import ProposalActionModal from '@/components/ProposalActionsModal';
import { ProposalTransaction } from '@/wrappers/nounsDao';

/**
 * Bare-bones Camp-themed editor surface shared by `CampCreateProposal` and
 * `CampEditProposal`. Renders:
 *  - title input
 *  - markdown body textarea + tabbed preview
 *  - transaction list with add/remove buttons
 *
 * Submit/cancel buttons live on the parent (so the submit logic can
 * stay in the parent and decide between propose / propose-on-V1 / update /
 * candidate-update).
 */
export interface CampProposalFormProps {
  title: string;
  onTitleChange: (next: string) => void;
  body: string;
  onBodyChange: (next: string) => void;
  transactions: ProposalTransaction[];
  onAddTransaction: (txn: ProposalTransaction | ProposalTransaction[]) => void;
  onRemoveTransaction: (index: number) => void;
  isProposalUpdate?: boolean;
}

const labelStyle = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.04em',
  color: 'var(--theme-text-secondary)',
  marginBottom: 6,
};

const inputBaseStyle = {
  width: '100%',
  padding: '10px 12px',
  background: 'var(--theme-bg-input, var(--theme-bg-tertiary))',
  border: '1px solid var(--theme-border)',
  borderRadius: 'var(--theme-radius-md, 6px)',
  color: 'var(--theme-text-primary)',
  fontFamily: 'inherit',
  outline: 'none',
};

function decodeCalldataPreview(tx: ProposalTransaction, isUpdate?: boolean): string {
  if (tx.calldata === '0x') return 'No calldata';
  if (isUpdate === true && tx.signature !== '') {
    try {
      const abi = parseAbi([`function ${tx.signature}` as never]);
      const { args } = decodeFunctionData({ abi, data: tx.calldata as `0x${string}` });
      return JSON.stringify(args);
    } catch {
      // fall through to raw
    }
  }
  if (tx.decodedCalldata != null && tx.decodedCalldata !== '') return tx.decodedCalldata;
  return tx.calldata;
}

function TransactionRow({
  index,
  tx,
  onRemove,
  isProposalUpdate,
}: {
  index: number;
  tx: ProposalTransaction;
  onRemove: () => void;
  isProposalUpdate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const calldataPreview = decodeCalldataPreview(tx, isProposalUpdate);

  return (
    <div
      style={{
        background: 'var(--theme-bg-secondary, var(--theme-bg-card))',
        border: '1px solid var(--theme-border)',
        borderRadius: 'var(--theme-radius-md, 6px)',
        marginBottom: 8,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 12px',
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: 'var(--theme-text-muted, var(--theme-text-secondary))',
            minWidth: 28,
          }}
        >
          #{index + 1}
        </span>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'transparent',
            border: 'none',
            color: 'var(--theme-text-primary)',
            fontFamily: 'inherit',
            fontSize: 13,
            cursor: 'pointer',
            textAlign: 'left',
            padding: 0,
            minWidth: 0,
          }}
          aria-expanded={open}
        >
          <span
            style={{
              fontFamily: 'var(--theme-font-mono, ui-monospace, monospace)',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {tx.signature || 'transfer()'}
          </span>
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove transaction ${index + 1}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            padding: 0,
            background: 'transparent',
            border: 'none',
            color: 'var(--theme-text-muted, var(--theme-text-secondary))',
            cursor: 'pointer',
            borderRadius: 4,
          }}
        >
          <XIcon size={14} />
        </button>
      </div>
      {open && (
        <dl
          style={{
            margin: 0,
            padding: '10px 14px 12px',
            borderTop: '1px solid var(--theme-border-light, var(--theme-border))',
            display: 'grid',
            gridTemplateColumns: '90px 1fr',
            gap: '6px 12px',
            fontSize: 12,
            color: 'var(--theme-text-secondary)',
          }}
        >
          <dt style={{ fontWeight: 600 }}>Address</dt>
          <dd
            style={{
              margin: 0,
              fontFamily: 'var(--theme-font-mono, ui-monospace, monospace)',
              wordBreak: 'break-all',
              color: 'var(--theme-text-primary)',
            }}
          >
            {tx.address}
          </dd>
          <dt style={{ fontWeight: 600 }}>Value</dt>
          <dd style={{ margin: 0, color: 'var(--theme-text-primary)' }}>
            {tx.value ? `${formatEther(BigInt(tx.value))} ETH` : 'None'}
          </dd>
          <dt style={{ fontWeight: 600 }}>Function</dt>
          <dd style={{ margin: 0, color: 'var(--theme-text-primary)' }}>
            {tx.signature || 'None'}
          </dd>
          <dt style={{ fontWeight: 600 }}>Calldata</dt>
          <dd
            style={{
              margin: 0,
              fontFamily: 'var(--theme-font-mono, ui-monospace, monospace)',
              wordBreak: 'break-all',
              color: 'var(--theme-text-primary)',
            }}
          >
            {calldataPreview}
          </dd>
        </dl>
      )}
    </div>
  );
}

export default function CampProposalForm({
  title,
  onTitleChange,
  body,
  onBodyChange,
  transactions,
  onAddTransaction,
  onRemoveTransaction,
  isProposalUpdate,
}: CampProposalFormProps) {
  const [showActionModal, setShowActionModal] = useState(false);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize the body textarea so the editor grows with content (matching
  // Camp's vertical-scroll editor pane behavior). Cap at ~70vh so it never
  // pushes the submit row off-screen.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const cap = Math.round(window.innerHeight * 0.7);
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
  }, [body, tab]);

  const previewMarkdown = useMemo(() => body || '_Body is empty._', [body]);

  return (
    <>
      {showActionModal && (
        <ProposalActionModal
          show={showActionModal}
          onDismiss={() => setShowActionModal(false)}
          onActionAdd={txn => {
            onAddTransaction(txn);
            setShowActionModal(false);
          }}
        />
      )}

      <section style={{ marginBottom: 24 }}>
        <label style={labelStyle} htmlFor="camp-prop-title">
          Title
        </label>
        <input
          id="camp-prop-title"
          value={title}
          onChange={e => onTitleChange(e.target.value)}
          placeholder="Proposal title"
          style={{
            ...inputBaseStyle,
            fontSize: 18,
            fontWeight: 600,
          }}
        />
      </section>

      <section style={{ marginBottom: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            marginBottom: 6,
          }}
        >
          <span style={labelStyle as React.CSSProperties}>Description</span>
          <div role="tablist" aria-label="Description tabs" style={{ display: 'flex', gap: 4 }}>
            {(['write', 'preview'] as const).map(t => {
              const selected = tab === t;
              return (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setTab(t)}
                  style={{
                    padding: '4px 10px',
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: selected
                      ? 'var(--theme-text-primary)'
                      : 'var(--theme-text-muted, var(--theme-text-secondary))',
                    background: selected
                      ? 'var(--theme-bg-tertiary, var(--theme-bg-card))'
                      : 'transparent',
                    border: '1px solid var(--theme-border)',
                    borderRadius: 'var(--theme-radius-sm, 4px)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>
        {tab === 'write' ? (
          <textarea
            ref={textareaRef}
            value={body}
            onChange={e => onBodyChange(e.target.value)}
            placeholder={`## Summary\n\nDescribe what this proposal does and why.\n\n## Methodology\n\nHow will it be carried out?\n\n## Conclusion\n\nWhat happens after?`}
            rows={14}
            style={{
              ...inputBaseStyle,
              fontFamily: 'var(--theme-font-mono, ui-monospace, monospace)',
              fontSize: 13,
              lineHeight: 1.55,
              resize: 'vertical',
              minHeight: 240,
            }}
          />
        ) : (
          <div
            style={{
              ...inputBaseStyle,
              minHeight: 240,
              fontSize: 14,
              lineHeight: 1.6,
              padding: '14px 18px',
            }}
            className="camp-prop-preview"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeRaw]}>
              {previewMarkdown}
            </ReactMarkdown>
          </div>
        )}
      </section>

      <section style={{ marginBottom: 8 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 6,
          }}
        >
          <span style={labelStyle as React.CSSProperties}>
            Transactions{transactions.length > 0 ? ` (${transactions.length})` : ''}
          </span>
          <button
            type="button"
            onClick={() => setShowActionModal(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--theme-text-primary)',
              background: 'var(--theme-bg-tertiary, var(--theme-bg-card))',
              border: '1px solid var(--theme-border)',
              borderRadius: 'var(--theme-radius-sm, 4px)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <PlusIcon size={12} aria-hidden />
            Add action
          </button>
        </div>

        {transactions.length === 0 ? (
          <div
            style={{
              padding: '16px 14px',
              fontSize: 12,
              color: 'var(--theme-text-muted, var(--theme-text-secondary))',
              border: '1px dashed var(--theme-border)',
              borderRadius: 'var(--theme-radius-md, 6px)',
              textAlign: 'center',
            }}
          >
            No actions yet. Add at least one transaction to make this proposal executable.
          </div>
        ) : (
          <div>
            {transactions.map((tx, i) => (
              <TransactionRow
                key={`${tx.address}-${tx.signature}-${tx.calldata}-${i}`}
                index={i}
                tx={tx}
                onRemove={() => onRemoveTransaction(i)}
                isProposalUpdate={isProposalUpdate}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
