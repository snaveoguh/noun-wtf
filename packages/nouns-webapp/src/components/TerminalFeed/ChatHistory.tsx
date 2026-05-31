import { useEffect, useRef, useState } from 'react';

import type { ChatMessage } from './TerminalPrompt';

interface Props {
  messages: ChatMessage[];
}

interface TraitChange {
  descriptor: string;
  previous: Record<string, number>;
  current: Record<string, number>;
  changed: string[];
  fetchedAt: number; // unix seconds
}

interface AgentStatus {
  running: boolean;
  lastBlock: number;
  nextNounId: number;
  predictedTraits: Record<string, string> | null;
  reservations: { active: number; total: number };
  recentTraitChanges?: TraitChange[];
}

// Only surface a descriptor change for a week — it's a "this just happened"
// alert, not a permanent banner. The on-chain art-add that moved the count is
// the same drift that broke trait predictions on 2026-05-30.
const TRAIT_CHANGE_TTL_SECONDS = 7 * 24 * 60 * 60;

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const apiBaseEnv = import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined;
const API_BASE =
  typeof apiBaseEnv === 'string' && apiBaseEnv.length > 0
    ? apiBaseEnv
    : 'https://spirited-flexibility-production-3c30.up.railway.app';

/**
 * Compact live status of the agent-nounirl block watcher (ported from the
 * standalone /terminal page on 2026-04-27 when that route was sunset).
 * Polls /api/agent/status every ~2 blocks (12s).
 */
function AgentStatusBar() {
  const [status, setStatus] = useState<AgentStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/agent/status`);
        if (!res.ok) return;
        const data = (await res.json()) as AgentStatus;
        if (!cancelled) setStatus(data);
      } catch {
        /* silent fail */
      }
    };
    fetchStatus();
    const timer = setInterval(fetchStatus, 12_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!status) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '12px',
        padding: '6px 16px',
        borderBottom: '1px solid var(--theme-feed-row-border)',
        fontSize: '11px',
        color: 'var(--theme-text-muted)',
        flexShrink: 0,
      }}
    >
      <span style={{ color: status.running ? 'var(--theme-positive)' : 'var(--theme-negative)' }}>
        {status.running ? 'agent active' : 'agent offline'}
      </span>
      <span>block {status.lastBlock}</span>
      <span>next #{status.nextNounId}</span>
      <span>{status.reservations.active} watches</span>
      {status.predictedTraits && (
        <span style={{ opacity: 0.5 }}>
          predicted: {Object.values(status.predictedTraits).join(' · ')}
        </span>
      )}
      {(() => {
        const nowSec = Math.floor(Date.now() / 1000);
        const fresh = (status.recentTraitChanges ?? []).find(
          c => nowSec - c.fetchedAt < TRAIT_CHANGE_TTL_SECONDS,
        );
        if (!fresh) return null;
        const summary = fresh.changed
          .map(k => `${k} ${fresh.previous[k]}→${fresh.current[k]}`)
          .join(', ');
        return (
          <span
            title={`Descriptor ${fresh.descriptor} changed — predictions auto-updated`}
            style={{ color: 'var(--theme-accent, #e8a33d)', fontWeight: 600 }}
          >
            🎨 art updated: {summary}
          </span>
        );
      })()}
    </div>
  );
}

export default function ChatHistory({ messages }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        <AgentStatusBar />
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--theme-text-muted)',
            fontSize: '13px',
          }}
        >
          no messages yet. type below to talk to nounirl.
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <AgentStatusBar />
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '12px 16px',
        }}
        className="terminal-scrollbar"
      >
      {messages.map((msg, i) => (
        <div
          key={`${msg.timestamp}-${i}`}
          style={{
            marginBottom: '16px',
            paddingBottom: '12px',
            borderBottom: i < messages.length - 1 ? '1px solid var(--theme-feed-row-border)' : 'none',
          }}
        >
          {/* Header: role + time */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '6px',
            }}
          >
            <span
              style={{
                color: msg.role === 'user' ? '#60a5fa' : 'var(--theme-accent)',
                fontSize: '11px',
                letterSpacing: '0.5px',
              }}
            >
              {msg.role === 'user' ? 'you' : 'nounirl'}
            </span>
            <span style={{ color: 'var(--theme-text-muted)', fontSize: '11px' }}>
              {formatTime(msg.timestamp)}
            </span>
          </div>

          {/* Content */}
          <div
            style={{
              color: msg.role === 'user' ? 'var(--theme-text-muted)' : 'var(--theme-text-secondary)',
              fontSize: '13px',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              paddingLeft: '0px',
            }}
          >
            {msg.content}
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}
