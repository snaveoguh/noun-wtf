/**
 * AddressTag — renders a 0x address as a readable chip.
 * Name resolution: hardcoded addressBook → API `resolved` map → truncated 0x.
 * Optional per-source leading glyph (noggles / ▚ / ◆ / 🐸).
 * Clicking links to the wallet explorer at /explore/wallet/<address>.
 */
import type { FeedSource } from '@/hooks/useOnchainFeed';

import { CSSProperties, FC } from 'react';

import { Link } from 'react-router';

import NogglesLogo from '@/assets/noggles.svg?react';

import { displayNameFor, truncateAddress } from './addressBook';

// ─── Source glyphs ────────────────────────────────────────────────────────────

export const SOURCE_COLOR: Record<FeedSource, string> = {
  nouns: '#d53c5e', // noggles red
  nounv2: '#7c3aed', // v2 purple
  punks: '#648596', // classic punks blue-grey
  ens: '#5284ff', // ENS blue
  toadz: '#4e9c2e', // toad green
};

export const SOURCE_LABEL: Record<FeedSource, string> = {
  nouns: 'NOUN',
  nounv2: 'V2',
  punks: 'PUNK',
  ens: 'ENS',
  toadz: 'TOAD',
};

/** Tiny per-source glyph: ⌐◨-◨ noggles (svg) for nouns, ▚ punk, ◆ ens, 🐸 toad. */
export const SourceGlyph: FC<{ source: FeedSource; size?: number }> = ({ source, size = 12 }) => {
  if (source === 'nouns' || source === 'nounv2') {
    return (
      <NogglesLogo
        aria-hidden
        style={{
          width: size * 1.6,
          height: size,
          display: 'inline-block',
          flexShrink: 0,
          // Purple-shift the red noggles for V2
          filter: source === 'nounv2' ? 'hue-rotate(255deg) saturate(1.4)' : undefined,
        }}
      />
    );
  }
  const glyph = source === 'punks' ? '▚' : source === 'ens' ? '◆' : '🐸';
  return (
    <span
      aria-hidden
      style={{
        fontSize: size,
        lineHeight: 1,
        color: SOURCE_COLOR[source],
        display: 'inline-block',
        flexShrink: 0,
      }}
    >
      {glyph}
    </span>
  );
};

// ─── AddressTag ───────────────────────────────────────────────────────────────

interface AddressTagProps {
  address: string;
  /** API `resolved` map: lowercase address -> display name */
  resolved?: Record<string, string>;
  /** show a tiny per-source glyph before the name */
  source?: FeedSource;
  /** dark-surface styling (terminal variant) */
  dark?: boolean;
  style?: CSSProperties;
}

const AddressTag: FC<AddressTagProps> = ({ address, resolved, source, dark, style }) => {
  const isDark = dark === true;
  const name = displayNameFor(address, resolved);
  const label = name ?? truncateAddress(address);
  const isRaw = name === null;

  return (
    <Link
      to={`/explore/wallet/${encodeURIComponent(address)}`}
      title={address}
      onClick={e => e.stopPropagation()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 6px',
        borderRadius: 5,
        background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
        border: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.04)',
        color: isDark ? (isRaw ? '#8b8ba0' : '#e8e8f2') : isRaw ? '#777' : '#2a2a3a',
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
        fontSize: '0.66rem',
        fontWeight: 600,
        lineHeight: '16px',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        maxWidth: 160,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        verticalAlign: 'middle',
        transition: 'background 0.12s',
        ...style,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)';
      }}
    >
      {source && <SourceGlyph source={source} size={9} />}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </Link>
  );
};

export default AddressTag;
