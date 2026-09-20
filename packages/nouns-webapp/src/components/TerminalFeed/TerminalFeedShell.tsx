import type { ChatMessage } from './TerminalPrompt';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';

import { ConnectKitButton } from 'connectkit';

import FontSwitcher from '@/components/FontSwitcher';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import { useSiteTheme } from '@/contexts/SiteThemeContext';

import ActivityFeed from './ActivityFeed';
import ChatHistory from './ChatHistory';
import { normalizeTerminalErrorMessage } from './errorMessages';
import { FILTER_TABS } from './eventRegistry';
import TerminalPrompt from './TerminalPrompt';
import { useActivityFeed } from './useActivityFeed';

const DISCO_STORAGE_KEY = 'noun-wtf-disco';

export default function TerminalFeedShell() {
  const { isEmbedded } = useSiteTheme();
  const [activeFilter, setActiveFilter] = useState('');
  const [discoMode, setDiscoMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    // Default-on for the terminal: only honour an explicit 'off' choice.
    // Anything else (first visit, lingering legacy 'on', unset) → disco lit.
    return localStorage.getItem(DISCO_STORAGE_KEY) !== 'off';
  });
  const isChatTab = activeFilter === '_CHAT';
  // Only pass filter to activity feed when not in chat mode
  const { events, loading, hasMore, error, loadMore } = useActivityFeed(
    isChatTab ? '' : activeFilter,
  );

  // Chat history (persisted across tab switches)
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);

  const handleNewMessages = useCallback((userMsg: ChatMessage, assistantMsg: ChatMessage) => {
    setChatHistory(prev => [...prev, userMsg, assistantMsg]);
  }, []);

  const handleChatError = useCallback((userMsg: ChatMessage, errorMsg: string) => {
    const errAssistant: ChatMessage = {
      role: 'assistant',
      content: normalizeTerminalErrorMessage(errorMsg),
      timestamp: Date.now(),
    };
    setChatHistory(prev => [...prev, userMsg, errAssistant]);
  }, []);

  // Add terminal-mode class to document for CSS isolation
  useEffect(() => {
    document.documentElement.classList.add('terminal-mode');
    // Set meta theme-color for mobile browsers
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', '#000000');

    return () => {
      document.documentElement.classList.remove('terminal-mode');
      meta?.setAttribute('content', '#ffffff');
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-disco', discoMode ? 'on' : 'off');
    localStorage.setItem(DISCO_STORAGE_KEY, discoMode ? 'on' : 'off');
    return () => {
      document.documentElement.removeAttribute('data-disco');
    };
  }, [discoMode]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--theme-bg-primary)',
        color: 'var(--theme-text-secondary)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 1000,
      }}
    >
      {/* Header — 40px */}
      <div
        style={{
          height: '40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          borderBottom: '1px solid var(--theme-border)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span
            className="terminal-brand"
            style={{ color: 'var(--theme-accent)', fontSize: '14px', letterSpacing: '1px' }}
          >
            NOUN.WTF
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* 🪩 disco mode — animated rainbow gradient blocks per event row.
              Styles live in src/index.css under "DISCO MODE — terminal feed". */}
          <button
            className="disco-toggle"
            onClick={() => setDiscoMode(d => !d)}
            title={discoMode ? 'turn off disco' : 'turn on disco'}
            aria-label="toggle disco mode"
            aria-pressed={discoMode}
          >
            🪩
          </button>

          {/* Wallet */}
          <ConnectKitButton.Custom>
            {({ isConnected, show, address }) => (
              <button
                onClick={show}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--theme-border)',
                  color: isConnected ? 'var(--theme-accent)' : 'var(--theme-text-muted)',
                  cursor: 'pointer',
                  fontSize: '11px',
                  padding: '4px 8px',
                  borderRadius: 'var(--theme-radius-sm)',
                }}
              >
                {isConnected && address
                  ? `${address.slice(0, 6)}..${address.slice(-4)}`
                  : 'connect'}
              </button>
            )}
          </ConnectKitButton.Custom>

          {/* Theme switcher — ThemeSwitcher already sets the theme and
              client-side navigates to `/<theme>`, which ThemePrefixRoute
              resolves into that theme's home. We deliberately do NOT do a
              `window.location.replace` here: a hard reload tore down this
              whole fixed-position shell (and its terminal-mode/disco document
              classes), which is what made the homepage visibly flash to black
              on every theme change. */}
          {/* Site-wide font — see src/lib/siteFonts.ts. Default Figtree. */}
          <FontSwitcher variant="terminal" />
          {!isEmbedded && <ThemeSwitcher variant="terminal" />}
        </div>
      </div>

      {/* Filter bar — 32px. 17 tabs fit a 1280px viewport; narrower screens
          scroll horizontally with the scrollbar hidden (rule below — scoped
          here rather than index.css so the feed stays self-contained). */}
      <style>{`
        .terminal-filter-bar { scrollbar-width: none; -ms-overflow-style: none; }
        .terminal-filter-bar::-webkit-scrollbar { display: none; width: 0; height: 0; }
      `}</style>
      <div
        style={{
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          padding: '0 12px',
          borderBottom: '1px solid var(--theme-border)',
          flexShrink: 0,
          overflowX: 'auto',
          overflowY: 'hidden',
          WebkitOverflowScrolling: 'touch',
        }}
        className="terminal-filter-bar"
      >
        {FILTER_TABS.map(tab => {
          const isActive = activeFilter === tab.key;
          const isChatButton = tab.key === '_CHAT';
          return (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              className="terminal-filter-tab"
              data-tab-all={tab.color == null ? 'true' : undefined}
              style={
                {
                  background: isActive ? 'var(--theme-bg-tertiary)' : 'transparent',
                  border: 'none',
                  color: isActive
                    ? isChatButton
                      ? 'var(--theme-accent)'
                      : 'var(--theme-accent)'
                    : isChatButton && chatHistory.length > 0
                      ? 'var(--theme-accent)'
                      : 'var(--theme-text-muted)',
                  cursor: 'pointer',
                  fontSize: '11px',
                  padding: '4px 8px',
                  borderRadius: 'var(--theme-radius-sm)',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  transition: 'color 0.15s',
                  opacity: isChatButton && chatHistory.length > 0 && !isActive ? 0.6 : 1,
                  // Anchor for the disco-mode gradient ink. Null for ALL → CSS
                  // handles the rainbow case via [data-tab-all].
                  ...(tab.color ? { ['--tab-color' as string]: tab.color } : {}),
                } as CSSProperties
              }
              onMouseEnter={e => {
                if (!isActive)
                  (e.target as HTMLElement).style.color = 'var(--theme-text-secondary)';
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  (e.target as HTMLElement).style.color =
                    isChatButton && chatHistory.length > 0
                      ? 'var(--theme-accent)'
                      : 'var(--theme-text-muted)';
                  (e.target as HTMLElement).style.opacity =
                    isChatButton && chatHistory.length > 0 ? '0.6' : '1';
                }
              }}
            >
              {tab.label}
              {isChatButton && chatHistory.length > 0 && (
                <span style={{ marginLeft: '4px', fontSize: '9px', opacity: 0.7 }}>
                  ({chatHistory.filter(m => m.role === 'user').length})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Feed area — either activity feed or chat history */}
      {isChatTab ? (
        <ChatHistory messages={chatHistory} />
      ) : (
        <ActivityFeed
          events={events}
          loading={loading}
          hasMore={hasMore}
          error={error}
          onLoadMore={loadMore}
        />
      )}

      {/* Prompt bar — 48px (plus response overlay) */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <TerminalPrompt
          history={chatHistory}
          onNewMessages={handleNewMessages}
          onError={handleChatError}
        />
      </div>
    </div>
  );
}
