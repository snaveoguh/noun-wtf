import { useEffect, useState } from 'react';

import { Edit3, X } from 'lucide-react';
import { Link } from 'react-router';
import { useAccount } from 'wagmi';

import { useProposal } from '@/wrappers/nounsDao';

interface ProposalEditDialogProps {
  proposalId: string | number;
  open: boolean;
  onClose: () => void;
}

/**
 * A Camp-style edit-proposal dialog. Camp embeds the full editor
 * (description + transactions + diff preview) in a wide tray. We host the
 * lightweight quick-edit shell here and link to our existing `/vote/:id/edit`
 * page (powered by `pages/EditProposal/`) for the actual transaction-form UI.
 *
 * Rationale: rebuilding Camp's diff-block + transaction editor would take
 * roughly a week — re-using our edit page lets us ship the surface today
 * and gives users the same "edit from list view" UX Camp has.
 */
export default function ProposalEditDialog({
  proposalId,
  open,
  onClose,
}: ProposalEditDialogProps) {
  const { address } = useAccount();
  const proposal = useProposal(String(proposalId), true);
  const [body, setBody] = useState('');
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (!open) return;
    if (!proposal?.description) return;
    // Strip the leading `# Title\n` line — same convention noun-wtf uses
    // throughout the app for proposal markdown.
    const desc = proposal.description ?? '';
    const firstNl = desc.indexOf('\n');
    const headLine = firstNl === -1 ? desc : desc.slice(0, firstNl);
    const t = headLine.startsWith('# ') ? headLine.slice(2).trim() : '';
    setTitle(t);
    setBody(firstNl === -1 ? '' : desc.slice(firstNl + 1).replace(/^\n+/, ''));
  }, [open, proposal]);

  // Lock body scroll while open — same pattern berry/game shells use.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const isProposer = !!(
    address &&
    proposal?.proposer &&
    address.toLowerCase() === proposal.proposer.toLowerCase()
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit proposal ${proposalId}`}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.4)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '8vh 16px 16px',
        overflowY: 'auto',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 720,
          background: 'var(--theme-bg-card)',
          color: 'var(--theme-text-primary)',
          border: '1px solid var(--theme-border)',
          borderRadius: 'var(--theme-radius-lg, 10px)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 18px',
            borderBottom: '1px solid var(--theme-border)',
          }}
        >
          <Edit3 size={16} aria-hidden />
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, flex: 1 }}>
            Edit proposal {proposal?.id ?? proposalId}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--theme-text-secondary)',
              padding: 4,
            }}
          >
            <X size={16} />
          </button>
        </header>

        <div style={{ padding: 18 }}>
          {!isProposer && (
            <div
              style={{
                padding: '10px 12px',
                background: 'var(--theme-bg-tertiary, var(--theme-bg-secondary))',
                color: 'var(--theme-text-secondary)',
                borderRadius: 'var(--theme-radius-sm, 4px)',
                fontSize: 12,
                marginBottom: 14,
              }}
            >
              Only the proposer can submit edits. You can preview changes here
              but submission is gated by signature.
            </div>
          )}
          <label
            style={{
              display: 'block',
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'var(--theme-text-secondary)',
              marginBottom: 4,
            }}
          >
            Title
          </label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Proposal title"
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: 14,
              background: 'var(--theme-bg-input, var(--theme-bg-tertiary))',
              border: '1px solid var(--theme-border)',
              borderRadius: 'var(--theme-radius-sm, 4px)',
              color: 'var(--theme-text-primary)',
              fontFamily: 'inherit',
              outline: 'none',
              marginBottom: 14,
            }}
          />
          <label
            style={{
              display: 'block',
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'var(--theme-text-secondary)',
              marginBottom: 4,
            }}
          >
            Description (markdown)
          </label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={10}
            placeholder="Proposal body…"
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 13,
              fontFamily: 'var(--theme-font-mono, ui-monospace, monospace)',
              lineHeight: 1.5,
              background: 'var(--theme-bg-input, var(--theme-bg-tertiary))',
              border: '1px solid var(--theme-border)',
              borderRadius: 'var(--theme-radius-sm, 4px)',
              color: 'var(--theme-text-primary)',
              outline: 'none',
              resize: 'vertical',
              minHeight: 200,
            }}
          />
          <p
            style={{
              fontSize: 12,
              color: 'var(--theme-text-secondary)',
              marginTop: 12,
              marginBottom: 0,
            }}
          >
            Heads-up — this is a preview shell. To change transactions or
            submit on-chain, continue to the full editor.
          </p>
        </div>

        <footer
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '12px 18px',
            borderTop: '1px solid var(--theme-border)',
            background: 'var(--theme-bg-secondary, transparent)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 14px',
              background: 'transparent',
              border: '1px solid var(--theme-border)',
              borderRadius: 'var(--theme-radius-sm, 4px)',
              color: 'var(--theme-text-primary)',
              fontFamily: 'inherit',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <Link
            to={`/vote/${proposal?.id ?? proposalId}/edit`}
            onClick={onClose}
            style={{
              padding: '8px 14px',
              background: 'var(--theme-accent)',
              border: '1px solid var(--theme-accent)',
              borderRadius: 'var(--theme-radius-sm, 4px)',
              color: 'var(--theme-accent-text-inverse, white)',
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 500,
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            Open full editor
          </Link>
        </footer>
      </div>
    </div>
  );
}
