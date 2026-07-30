/**
 * CandidateVersionSlider — timeline slider for candidate proposal versions.
 *
 * Inline bar: version slider with labels.
 * Play button: opens a modal player that renders the full proposal content
 * for each version, auto-advancing on a timer (looping).
 */
import type { CandidateVersionSnapshot } from '@/hooks/useCandidatesFromLogs';

import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import { processProposalDescriptionText } from '@/utils/processProposalDescriptionText';
import { formatProposalTransactionDetails } from '@/wrappers/nounsDao';

import ProposalTransactions from '../ProposalContent/ProposalTransactions';

interface CandidateVersionSliderProps {
  versions: CandidateVersionSnapshot[];
  /** Currently selected version index (0-based). Parent controls this. */
  activeVersion: number;
  /** Called when slider changes */
  onChange: (versionIndex: number) => void;
}

// ── Inline Slider Bar ─────────────────────────────────────────────────────────

export const CandidateVersionSlider: FC<CandidateVersionSliderProps> = ({
  versions,
  activeVersion,
  onChange,
}) => {
  const [showPlayer, setShowPlayer] = useState(false);
  const v = versions[activeVersion];
  const total = versions.length;

  if (total <= 1) return null;

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 16px',
          borderRadius: 12,
          background: 'rgba(255,255,255,0.95)',
          border: '1px solid rgba(0,0,0,0.1)',
          fontFamily: "'PT Root UI', sans-serif",
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          marginBottom: 16,
        }}
      >
        {/* Play button — opens modal player */}
        <button
          type="button"
          onClick={() => setShowPlayer(true)}
          title="Play version history"
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            border: '1px solid rgba(0,0,0,0.12)',
            background: '#f8fafc',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#6b7280',
            flexShrink: 0,
            fontSize: 14,
          }}
        >
          ▶
        </button>

        {/* Version label (left) */}
        <span style={{ fontSize: '0.75rem', color: '#6b7280', flexShrink: 0, fontWeight: 600 }}>
          v1
        </span>

        {/* Slider */}
        <input
          type="range"
          min={0}
          max={total - 1}
          step={1}
          value={activeVersion}
          onChange={e => onChange(Number(e.target.value))}
          style={{
            flex: 1,
            height: 4,
            accentColor: '#e11d48',
            cursor: 'pointer',
          }}
        />

        {/* Version label (right) */}
        <span style={{ fontSize: '0.75rem', color: '#6b7280', flexShrink: 0, fontWeight: 600 }}>
          v{total}
        </span>

        {/* Current version badge */}
        <span
          style={{
            padding: '3px 10px',
            borderRadius: 6,
            background: activeVersion === total - 1 ? '#dcfce7' : '#fef3c7',
            border: `1px solid ${activeVersion === total - 1 ? '#86efac' : '#fcd34d'}`,
            fontSize: '0.7rem',
            fontWeight: 700,
            color: activeVersion === total - 1 ? '#166534' : '#92400e',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          Version {v?.versionNumber ?? activeVersion + 1}
          {activeVersion === total - 1 ? ' (latest)' : ''}
        </span>

        {/* Date */}
        {v != null && (
          <span
            style={{
              fontSize: '0.65rem',
              color: '#9ca3af',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            {new Date(v.timestamp * 1000).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        )}
      </div>

      {/* Modal Player */}
      {showPlayer && (
        <VersionPlayerModal
          versions={versions}
          initialVersion={activeVersion}
          onClose={() => setShowPlayer(false)}
          onVersionChange={onChange}
        />
      )}
    </>
  );
};

// ── Modal Player ──────────────────────────────────────────────────────────────
// Renders the proposal at a miniature scale so the whole thing is visible
// in the viewport — like watching a document being built in real time.

const PLAY_INTERVAL_MS = 2500; // 2.5 seconds per version

const VersionPlayerModal: FC<{
  versions: CandidateVersionSnapshot[];
  initialVersion: number;
  onClose: () => void;
  onVersionChange: (idx: number) => void;
}> = ({ versions, onClose, onVersionChange }) => {
  const [current, setCurrent] = useState(0); // always start from v1
  const [isPlaying, setIsPlaying] = useState(true); // auto-play on open
  const [speed, setSpeed] = useState(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const total = versions.length;
  const v = versions[current];

  // Sync parent slider
  useEffect(() => {
    onVersionChange(current);
  }, [current, onVersionChange]);

  // Auto-play loop
  useEffect(() => {
    if (isPlaying && total > 1) {
      const ms = PLAY_INTERVAL_MS / speed;
      intervalRef.current = setInterval(() => {
        setCurrent(prev => (prev + 1) % total);
      }, ms);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, speed, total]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const details = useMemo(() => {
    if (v == null) return [];
    return formatProposalTransactionDetails({
      targets: v.targets,
      signatures: v.signatures,
      values: v.values,
      calldatas: v.calldatas,
    });
  }, [v]);

  const handleSliderChange = useCallback((idx: number) => {
    setCurrent(idx);
    setIsPlaying(false);
  }, []);

  if (v == null) return null;

  // Progress percentage for the bar
  const progress = total > 1 ? (current / (total - 1)) * 100 : 100;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(8px)',
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '92vw',
          maxWidth: 1000,
          height: '88vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Top controls bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            background: 'rgba(255,255,255,0.08)',
            borderRadius: '12px 12px 0 0',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={() => {
              if (!isPlaying && current >= total - 1) setCurrent(0);
              setIsPlaying(!isPlaying);
            }}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: 'none',
              background: isPlaying ? 'rgba(225,29,72,0.3)' : 'rgba(255,255,255,0.15)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isPlaying ? '#fb7185' : '#9ca3af',
              fontSize: 12,
            }}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>

          <button
            type="button"
            onClick={() =>
              setSpeed(s => {
                const speeds = [1, 2, 5, 10, 25, 50];
                const idx = speeds.indexOf(s);
                return speeds[(idx + 1) % speeds.length];
              })
            }
            style={{
              padding: '2px 6px',
              borderRadius: 4,
              border: 'none',
              background: 'rgba(255,255,255,0.1)',
              cursor: 'pointer',
              color: '#9ca3af',
              fontSize: '0.6rem',
              fontWeight: 700,
            }}
          >
            {speed}x
          </button>

          {/* Thin progress bar instead of range slider */}
          <div
            style={{
              flex: 1,
              height: 3,
              background: 'rgba(255,255,255,0.1)',
              borderRadius: 2,
              cursor: 'pointer',
              position: 'relative',
            }}
            onClick={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              handleSliderChange(Math.round(pct * (total - 1)));
            }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: '100%',
                background: '#e11d48',
                borderRadius: 2,
                transition: 'width 0.15s ease',
              }}
            />
          </div>

          <span
            style={{
              fontSize: '0.6rem',
              fontWeight: 700,
              color: '#9ca3af',
              fontFamily: 'monospace',
              minWidth: 50,
              textAlign: 'center',
            }}
          >
            v{v.versionNumber}/{total}
          </span>

          <span style={{ fontSize: '0.55rem', color: '#6b7280' }}>
            {new Date(v.timestamp * 1000).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: '2-digit',
            })}
          </span>

          <button
            type="button"
            onClick={onClose}
            style={{
              marginLeft: 'auto',
              width: 24,
              height: 24,
              borderRadius: 4,
              border: 'none',
              background: 'rgba(255,255,255,0.1)',
              cursor: 'pointer',
              fontSize: 12,
              color: '#9ca3af',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        {/* Miniature proposal — scaled down to fit viewport */}
        <div
          style={{
            flex: 1,
            overflow: 'hidden',
            background: '#fff',
            borderRadius: '0 0 12px 12px',
            position: 'relative',
          }}
        >
          {/* Update message overlay */}
          {v.updateMessage && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                padding: '4px 12px',
                background: 'rgba(239,246,255,0.95)',
                borderBottom: '1px solid #dbeafe',
                fontSize: '0.55rem',
                color: '#1e40af',
                zIndex: 1,
              }}
            >
              <strong>v{v.versionNumber}:</strong> {v.updateMessage}
            </div>
          )}

          {/* Scaled content — CSS transform to shrink it */}
          <div
            style={{
              transform: 'scale(0.45)',
              transformOrigin: 'top left',
              width: '222%', // 1/0.45 to fill the container width
              height: '222%',
              overflow: 'hidden',
              padding: '40px 60px',
              fontFamily: "'PT Root UI', sans-serif",
            }}
          >
            <h1
              style={{
                fontFamily: "'Londrina Solid', cursive",
                fontSize: '2.8rem',
                margin: '0 0 20px',
                lineHeight: 1.1,
              }}
            >
              {v.title}
            </h1>

            <div style={{ lineHeight: 1.8, fontSize: '1.1rem' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeRaw]}>
                {processProposalDescriptionText(v.description, v.title)}
              </ReactMarkdown>
            </div>

            {details.length > 0 && (
              <div style={{ marginTop: 32 }}>
                <h3
                  style={{
                    fontFamily: "'Londrina Solid', cursive",
                    fontSize: '1.8rem',
                    marginBottom: 16,
                  }}
                >
                  Proposed Transactions
                </h3>
                <ProposalTransactions details={details} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CandidateVersionSlider;
