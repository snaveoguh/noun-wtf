import type { ReactNode } from 'react';

import { useReadNounsTreasuryBalancesInEth } from '@nouns/sdk/react/treasury';
import clsx from 'clsx';
import { ConnectKitButton } from 'connectkit';
import { ExternalLink, Search, Triangle } from 'lucide-react';
import { formatEther } from 'viem';

import ThemeSwitcher from '@/components/ThemeSwitcher';
import { useActiveDao } from '@/hooks/useActiveDao';
import { useUserVotes } from '@/wrappers/nounToken';

interface CampShellProps {
  children: ReactNode;
  /**
   * If true, expose a tiny search affordance in the top nav that focuses an
   * input with id="camp-search-input" elsewhere on the page. CampHome owns
   * the actual input and renders it above the activity feed.
   */
  showSearchAffordance?: boolean;
}

/**
 * Site-level chrome wrapper that mimics nouns.camp's dark dashboard — a thin
 * top bar with tiny brand glyphs on the left and treasury/actions/connect on
 * the right, and a fluid full-width content area underneath. Theme-driven via
 * the `--theme-*` CSS vars set by `[data-theme='camp']`.
 *
 * The shell renders no routes itself; the consumer passes `children`
 * (typically the bespoke CampHome two-pane layout).
 */
export default function CampShell({
  children,
  showSearchAffordance = false,
}: CampShellProps) {
  const { activeDao } = useActiveDao();
  const treasuryBalance = useReadNounsTreasuryBalancesInEth({
    query: { select: data => data.total },
  }).data;
  const userVotes = useUserVotes();

  const treasuryEth =
    treasuryBalance === undefined
      ? null
      : Math.round(Number(formatEther(treasuryBalance))).toLocaleString();

  const showSearch = showSearchAffordance;

  return (
    <div
      className={clsx('camp-shell')}
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--theme-bg-primary)',
        color: 'var(--theme-text-primary)',
        fontFamily: 'var(--theme-font-body)',
      }}
    >
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 30,
          background: 'var(--theme-bg-primary)',
          borderBottom: '1px solid var(--theme-border)',
        }}
      >
        <div
          style={{
            maxWidth: 1280,
            margin: '0 auto',
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 48,
          }}
        >
          {/* Brand — tiny pyramid icon + tiny site icon (static — emulation only) */}
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--theme-text-primary)',
              textDecoration: 'none',
              flexShrink: 0,
              padding: '4px 6px',
              borderRadius: 4,
            }}
            title="noun.wtf — Camp emulation"
          >
            <Triangle
              size={14}
              aria-hidden
              style={{ color: 'var(--theme-text-primary)', fill: 'var(--theme-text-primary)' }}
            />
            <span
              aria-hidden
              style={{
                width: 14,
                height: 14,
                borderRadius: 3,
                background: 'var(--theme-accent)',
                display: 'inline-block',
              }}
            />
            {activeDao === 'nounv2' && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  padding: '1px 5px',
                  borderRadius: 3,
                  background: 'var(--theme-bg-tertiary)',
                  color: 'var(--theme-text-secondary)',
                  marginLeft: 2,
                }}
              >
                v2
              </span>
            )}
          </span>

          {/* Spacer pushes everything to the right (camp.wtf has no top-bar search) */}
          <div style={{ flex: 1 }} />

          {/* "Visit camp.wtf" — opens the real site in a new tab */}
          <a
            href="https://nouns.camp"
            target="_blank"
            rel="noreferrer"
            title="Visit camp.wtf"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '5px 10px',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--theme-text-secondary)',
              background: 'transparent',
              border: '1px solid var(--theme-border)',
              borderRadius: 999,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            <ExternalLink size={11} aria-hidden />
            <span>nouns.camp</span>
          </a>

          {/* Treasury pill — "Treasury Ξ X,XXX" */}
          {treasuryEth !== null && (
            <a
              href="https://etherscan.io/address/0xb1a32fc9f9d8b2cf86c068cae13108809ad8ca58"
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 10px',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--theme-text-primary)',
                background: 'transparent',
                border: '1px solid var(--theme-border)',
                borderRadius: 999,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
              title="Treasury balance"
            >
              <span style={{ color: 'var(--theme-text-secondary)', fontWeight: 500 }}>
                Treasury
              </span>
              <span>Ξ {treasuryEth}</span>
            </a>
          )}

          {/* Search icon — focuses inline search input below the nav */}
          {showSearch && (
            <button
              type="button"
              aria-label="Search"
              onClick={() => {
                const el = document.getElementById('camp-search-input');
                el?.focus();
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                background: 'transparent',
                border: 'none',
                color: 'var(--theme-text-secondary)',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              <Search size={16} aria-hidden />
            </button>
          )}

          {/* Theme switcher — settings cog visible inside */}
          <ThemeSwitcher variant="navbar" />

          {/* Connect (with voting-power chip when connected) */}
          <ConnectKitButton.Custom>
            {({ isConnected, show, address, ensName, truncatedAddress }) => (
              <button
                type="button"
                onClick={show}
                title={
                  isConnected && userVotes != null
                    ? `${userVotes} voting ${userVotes === 1 ? 'vote' : 'votes'}`
                    : undefined
                }
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: isConnected ? '4px 10px 4px 4px' : '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  color: isConnected ? 'var(--theme-text-primary)' : 'var(--theme-text-primary)',
                  background: isConnected
                    ? 'var(--theme-bg-tertiary)'
                    : 'var(--theme-accent)',
                  border: isConnected
                    ? '1px solid var(--theme-border)'
                    : '1px solid transparent',
                  borderRadius: 999,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >
                {isConnected ? (
                  <>
                    {/* Tiny avatar dot — placeholder until we wire ENS avatars */}
                    <span
                      aria-hidden
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background:
                          'linear-gradient(135deg, var(--theme-accent), var(--theme-positive))',
                        display: 'inline-block',
                        flexShrink: 0,
                      }}
                    />
                    <span>{ensName ?? truncatedAddress ?? address}</span>
                    {userVotes != null && userVotes > 0 && (
                      <span
                        aria-hidden
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: 3,
                          background: 'var(--theme-accent)',
                          color: '#ffffff',
                          marginLeft: 2,
                        }}
                      >
                        {userVotes}
                      </span>
                    )}
                  </>
                ) : (
                  'Connect'
                )}
              </button>
            )}
          </ConnectKitButton.Custom>
        </div>
      </header>

      <main
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 1480,
          margin: '0 auto',
          padding: '16px 20px 24px',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        {children}
      </main>
    </div>
  );
}
