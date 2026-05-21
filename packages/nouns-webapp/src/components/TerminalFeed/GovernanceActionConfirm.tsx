import React, { useCallback, useState } from 'react';

import { ConnectKitButton } from 'connectkit';
import { useAccount } from 'wagmi';

import { useGovernanceAction } from './useGovernanceAction';

// ─── Types ────────────────────────────────────────────────────────────────

export interface GovernanceAction {
  type:
    | 'VOTE'
    | 'PROPOSAL_FEEDBACK'
    | 'CANDIDATE_FEEDBACK'
    | 'CREATE_CANDIDATE'
    | 'SPONSOR'
    | 'BID'
    | 'PROMOTE'
    | 'UPDATE_CANDIDATE'
    | 'UPDATE_PROPOSAL'
    | 'UPDATE_PROPOSAL_DESCRIPTION'
    | 'UPDATE_PROPOSAL_TRANSACTIONS'
    | 'GRANT_VOTE'
    | 'GRANT_PROPOSAL'
    | 'QUEUE_PROPOSAL'
    | 'QUEUE_GRANT'
    | 'EXECUTE_PROPOSAL'
    | 'EXECUTE_GRANT';
  proposalId?: number;
  support?: 0 | 1 | 2;
  reason?: string;
  title?: string;
  proposer?: string;
  /**
   * DAO identifier for actions that can target multiple DAOs (e.g. VOTE).
   * The agent server populates this so the dispatcher can route to the
   * correct governor contract. Defaults to mainnet Nouns when omitted.
   */
  dao?: 'nouns' | 'lil-nouns' | 'lilnouns' | 'lil';
  slug?: string;
  description?: string;
  encodedProp?: string;
  updateMessage?: string;
  updatePeriodEndBlock?: string;
  // BID fields
  nounId?: number;
  bidAmountEth?: string;
  // GRANT fields
  grantId?: number;
  // PROMOTE / CREATE_CANDIDATE / UPDATE fields
  targets?: string[];
  values?: string[];
  signatures?: string[];
  calldatas?: string[];
  sponsorSignatures?: Array<{ sig: string; signer: string; expirationTimestamp: string }>;
}

interface Props {
  action: GovernanceAction;
  onSuccess: (txHash: string) => void;
  onCancel: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const SUPPORT_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: 'AGAINST', color: '#ef4444' },
  1: { label: 'FOR', color: '#4ade80' },
  2: { label: 'ABSTAIN', color: '#94a3b8' },
};

const ACTION_LABELS: Record<string, { verb: string; color: string }> = {
  VOTE: { verb: 'vote on', color: '#c084fc' },
  PROPOSAL_FEEDBACK: { verb: 'give feedback on', color: '#94a3b8' },
  CANDIDATE_FEEDBACK: { verb: 'give feedback on candidate', color: '#94a3b8' },
  CREATE_CANDIDATE: { verb: 'create candidate', color: '#facc15' },
  SPONSOR: { verb: 'sponsor candidate', color: '#f472b6' },
  BID: { verb: 'bid on', color: '#60a5fa' },
  PROMOTE: { verb: 'promote candidate to proposal', color: '#fb923c' },
  UPDATE_CANDIDATE: { verb: 'update candidate', color: '#fbbf24' },
  UPDATE_PROPOSAL: { verb: 'update proposal', color: '#a78bfa' },
  UPDATE_PROPOSAL_DESCRIPTION: { verb: 'update proposal description', color: '#a78bfa' },
  UPDATE_PROPOSAL_TRANSACTIONS: { verb: 'update proposal transactions', color: '#a78bfa' },
  GRANT_VOTE: { verb: 'vote on grant', color: '#22d3ee' },
  GRANT_PROPOSAL: { verb: 'create grant proposal', color: '#06b6d4' },
  QUEUE_PROPOSAL: { verb: 'queue proposal', color: '#eab308' },
  QUEUE_GRANT: { verb: 'queue grant', color: '#eab308' },
  EXECUTE_PROPOSAL: { verb: 'execute proposal', color: '#f97316' },
  EXECUTE_GRANT: { verb: 'execute grant', color: '#f97316' },
};

// ─── Component ────────────────────────────────────────────────────────────

export default function GovernanceActionConfirm({ action, onSuccess, onCancel }: Props) {
  const { isConnected } = useAccount();
  const { execute, isPending, error: txError } = useGovernanceAction();
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [resultHash, setResultHash] = useState<string | null>(null);

  const handleConfirm = useCallback(async () => {
    if (isPending || status === 'success') return;
    setStatus('pending');
    try {
      const hash = await execute(action);
      if (hash) {
        setStatus('success');
        setResultHash(hash);
        onSuccess(hash);
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }, [action, execute, isPending, status, onSuccess]);

  const actionInfo = ACTION_LABELS[action.type] ?? { verb: action.type, color: '#ccc' };
  const supportInfo = action.support !== undefined ? SUPPORT_LABELS[action.support] : null;

  if (!isConnected) {
    return (
      <div style={containerStyle}>
        <div style={{ color: '#ef4444', fontSize: '13px' }}>
          wallet not connected — connect to sign this transaction.
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
          <ConnectKitButton.Custom>
            {({ show }) => (
              <button type="button" onClick={() => show?.()} style={confirmBtnStyle}>
                connect wallet
              </button>
            )}
          </ConnectKitButton.Custom>
          <button type="button" onClick={onCancel} style={cancelBtnStyle}>
            dismiss
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid #111', paddingBottom: '8px', marginBottom: '8px' }}>
        <span style={{ color: actionInfo.color, fontSize: '12px', letterSpacing: '0.5px' }}>
          {actionInfo.verb.toUpperCase()}
        </span>
        {action.title != null && action.title !== '' && (
          <div style={{ color: '#ccc', fontSize: '13px', marginTop: '4px' }}>
            {action.proposalId != null ? `prop #${action.proposalId}: ` : ''}
            {action.title}
          </div>
        )}
        {action.slug && (
          <div style={{ color: '#888', fontSize: '12px', marginTop: '4px' }}>
            slug: {action.slug}
          </div>
        )}
      </div>

      {/* Details */}
      <div style={{ fontSize: '12px', lineHeight: 1.6 }}>
        {supportInfo && (
          <div>
            <span style={{ color: '#666' }}>support: </span>
            <span style={{ color: supportInfo.color, fontWeight: 500 }}>{supportInfo.label}</span>
          </div>
        )}
        {action.reason != null && action.reason !== '' && (
          <div>
            <span style={{ color: '#666' }}>reason: </span>
            <span style={{ color: '#aaa' }}>&quot;{action.reason}&quot;</span>
          </div>
        )}
        {(action.type === 'CREATE_CANDIDATE' || action.type === 'UPDATE_CANDIDATE') &&
          action.description && (
            <div style={{ marginTop: '4px' }}>
              <span style={{ color: '#666' }}>description: </span>
              <span style={{ color: '#aaa' }}>
                {action.description.length > 200
                  ? action.description.slice(0, 200) + '...'
                  : action.description}
              </span>
            </div>
          )}
        {(action.type === 'CREATE_CANDIDATE' || action.type === 'UPDATE_CANDIDATE') &&
          (action.targets?.length ?? 0) > 0 && (
            <div style={{ marginTop: '4px' }}>
              <span style={{ color: '#666' }}>transactions: </span>
              <span style={{ color: '#4ade80' }}>{action.targets?.length} executable</span>
              {action.targets?.map((t, i) => (
                <div
                  key={i}
                  style={{ color: '#555', fontSize: '11px', marginLeft: '8px', marginTop: '2px' }}
                >
                  → {t.slice(0, 6)}...{t.slice(-4)}
                  {action.values?.[i] && action.values[i] !== '0' && (
                    <span style={{ color: '#fbbf24' }}>
                      {' '}
                      ({(Number(BigInt(action.values[i])) / 1e18).toFixed(4)} ETH)
                    </span>
                  )}
                  {action.signatures?.[i] && (
                    <span style={{ color: '#888' }}> {action.signatures[i]}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        {action.type === 'UPDATE_CANDIDATE' && (
          <div style={{ color: '#fbbf24', fontSize: '11px', marginTop: '4px' }}>
            warning: updating resets all sponsor signatures
          </div>
        )}
        {(action.type === 'UPDATE_PROPOSAL' ||
          action.type === 'UPDATE_PROPOSAL_DESCRIPTION' ||
          action.type === 'UPDATE_PROPOSAL_TRANSACTIONS') && (
          <>
            {action.updateMessage && (
              <div>
                <span style={{ color: '#666' }}>update reason: </span>
                <span style={{ color: '#aaa' }}>&quot;{action.updateMessage}&quot;</span>
              </div>
            )}
            {action.updatePeriodEndBlock && (
              <div style={{ color: '#444', fontSize: '11px', marginTop: '4px' }}>
                update period ends at block {action.updatePeriodEndBlock}
              </div>
            )}
            {(action.targets?.length ?? 0) > 0 && (
              <div style={{ marginTop: '4px' }}>
                <span style={{ color: '#666' }}>transactions: </span>
                <span style={{ color: '#4ade80' }}>{action.targets?.length} executable</span>
              </div>
            )}
          </>
        )}
        {action.type === 'SPONSOR' && (
          <div>
            <span style={{ color: '#666' }}>proposer: </span>
            <span style={{ color: '#aaa' }}>
              {action.proposer
                ? `${action.proposer.slice(0, 6)}...${action.proposer.slice(-4)}`
                : 'unknown'}
            </span>
          </div>
        )}
        {action.type === 'BID' && (
          <>
            <div>
              <span style={{ color: '#666' }}>noun: </span>
              <span style={{ color: '#60a5fa' }}>#{action.nounId}</span>
            </div>
            <div>
              <span style={{ color: '#666' }}>amount: </span>
              <span style={{ color: '#4ade80', fontWeight: 500 }}>{action.bidAmountEth} ETH</span>
            </div>
            <div style={{ color: '#444', fontSize: '11px', marginTop: '4px' }}>
              client id 37 (noun.wtf) included
            </div>
          </>
        )}
        {action.type === 'PROMOTE' && (
          <>
            <div>
              <span style={{ color: '#666' }}>proposer: </span>
              <span style={{ color: '#aaa' }}>
                {action.proposer
                  ? `${action.proposer.slice(0, 6)}...${action.proposer.slice(-4)}`
                  : 'unknown'}
              </span>
            </div>
            <div>
              <span style={{ color: '#666' }}>
                {(action.sponsorSignatures?.length ?? 0) > 0 ? 'signatures: ' : 'method: '}
              </span>
              <span style={{ color: '#fb923c' }}>
                {(action.sponsorSignatures?.length ?? 0) > 0
                  ? `${action.sponsorSignatures?.length} valid — proposeBySigs`
                  : 'direct propose (proposer has voting power)'}
              </span>
            </div>
            <div style={{ color: '#444', fontSize: '11px', marginTop: '4px' }}>
              client id 37 (noun.wtf) — creates a real onchain proposal
            </div>
          </>
        )}
        {action.type === 'VOTE' && (
          <div style={{ color: '#444', fontSize: '11px', marginTop: '4px' }}>
            {action.dao === 'lil-nouns' || action.dao === 'lilnouns' || action.dao === 'lil'
              ? 'lil nouns dao — no gas refund'
              : 'gas refunded by nouns dao — client id 37 (noun.wtf)'}
          </div>
        )}
        {action.type === 'GRANT_VOTE' && (
          <>
            <div>
              <span style={{ color: '#666' }}>grant: </span>
              <span style={{ color: '#22d3ee' }}>#{action.grantId}</span>
            </div>
            <div style={{ color: '#444', fontSize: '11px', marginTop: '4px' }}>
              small grants treasury — noun.wtf only
            </div>
          </>
        )}
        {action.type === 'GRANT_PROPOSAL' && (
          <>
            {action.description && (
              <div style={{ marginTop: '4px' }}>
                <span style={{ color: '#666' }}>description: </span>
                <span style={{ color: '#aaa' }}>
                  {action.description.length > 200
                    ? action.description.slice(0, 200) + '...'
                    : action.description}
                </span>
              </div>
            )}
            {(action.targets?.length ?? 0) > 0 && (
              <div style={{ marginTop: '4px' }}>
                <span style={{ color: '#666' }}>transactions: </span>
                <span style={{ color: '#4ade80' }}>{action.targets?.length} executable</span>
                {action.targets?.map((t, i) => (
                  <div
                    key={i}
                    style={{ color: '#555', fontSize: '11px', marginLeft: '8px', marginTop: '2px' }}
                  >
                    → {t.slice(0, 6)}...{t.slice(-4)}
                    {action.values?.[i] && action.values[i] !== '0' && (
                      <span style={{ color: '#fbbf24' }}>
                        {' '}
                        ({(Number(BigInt(action.values[i])) / 1e18).toFixed(4)} ETH)
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div style={{ color: '#22d3ee', fontSize: '11px', marginTop: '4px' }}>
              enters 12hr voting immediately — no quorum required
            </div>
          </>
        )}
        {action.type === 'QUEUE_PROPOSAL' && (
          <div style={{ color: '#eab308', fontSize: '11px', marginTop: '4px' }}>
            this will place the proposal in the timelock — after the waiting period it can be
            executed
          </div>
        )}
        {action.type === 'QUEUE_GRANT' && (
          <div style={{ color: '#eab308', fontSize: '11px', marginTop: '4px' }}>
            this will place the grant in the 12hr timelock — after that it can be executed
          </div>
        )}
        {action.type === 'EXECUTE_PROPOSAL' && (
          <div style={{ color: '#f97316', fontSize: '11px', marginTop: '4px' }}>
            this will execute all queued transactions onchain — irreversible
          </div>
        )}
        {action.type === 'EXECUTE_GRANT' && (
          <>
            <div>
              <span style={{ color: '#666' }}>grant: </span>
              <span style={{ color: '#f97316' }}>#{action.grantId}</span>
            </div>
            <div style={{ color: '#f97316', fontSize: '11px', marginTop: '4px' }}>
              this will execute all queued transactions onchain — irreversible
            </div>
          </>
        )}
      </div>

      {/* Error */}
      {(status === 'error' || txError) && (
        <div
          style={{ color: '#ef4444', fontSize: '11px', marginTop: '8px', wordBreak: 'break-word' }}
        >
          {txError || 'transaction failed or was rejected'}
        </div>
      )}

      {/* Success */}
      {status === 'success' && resultHash && (
        <div style={{ marginTop: '8px' }}>
          <span style={{ color: '#4ade80', fontSize: '12px' }}>tx submitted </span>
          <a
            href={`https://etherscan.io/tx/${resultHash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#60a5fa', fontSize: '11px', textDecoration: 'none' }}
          >
            {resultHash.slice(0, 10)}...
          </a>
        </div>
      )}

      {/* Buttons */}
      {status !== 'success' && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isPending}
            style={{
              ...confirmBtnStyle,
              opacity: isPending ? 0.5 : 1,
              cursor: isPending ? 'wait' : 'pointer',
            }}
          >
            {isPending ? 'signing...' : 'confirm — sign tx'}
          </button>
          <button type="button" onClick={onCancel} disabled={isPending} style={cancelBtnStyle}>
            cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  background: '#000',
  border: '1px solid #1a1a1a',
  borderRadius: '2px',
  padding: '12px 16px',
  marginTop: '12px',
};

const confirmBtnStyle: React.CSSProperties = {
  background: '#111',
  border: '1px solid #00ff41',
  color: '#00ff41',
  cursor: 'pointer',
  fontSize: '12px',
  padding: '6px 16px',
  borderRadius: '2px',
};

const cancelBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #222',
  color: '#444',
  cursor: 'pointer',
  fontSize: '12px',
  padding: '6px 16px',
  borderRadius: '2px',
};
