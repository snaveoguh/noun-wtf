import type { ChatMessage } from './TerminalPrompt';

import { useCallback, useEffect, useState } from 'react';

import { ConnectKitButton } from 'connectkit';

import { useSiteTheme } from '@/contexts/SiteThemeContext';

import ActivityFeed from './ActivityFeed';
import ChatHistory from './ChatHistory';
import { normalizeTerminalErrorMessage } from './errorMessages';
import { FILTER_TABS } from './eventFormatters';
import TerminalPrompt from './TerminalPrompt';
import { useActivityFeed } from './useActivityFeed';

export default function TerminalFeedShell() {
  const { setMode, isEmbedded } = useSiteTheme();
  const [activeFilter, setActiveFilter] = useState('');
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

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000000',
        color: '#ccc',
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
          borderBottom: '1px solid #111',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: '#00ff41', fontSize: '14px', letterSpacing: '1px' }}>NOUN.WTF</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Wallet */}
          <ConnectKitButton.Custom>
            {({ isConnected, show, address }) => (
              <button
                onClick={show}
                style={{
                  background: 'transparent',
                  border: '1px solid #222',
                  color: isConnected ? '#00ff41' : '#444',
                  cursor: 'pointer',
                  fontSize: '11px',
                  padding: '4px 8px',
                  borderRadius: '2px',
                }}
              >
                {isConnected && address
                  ? `${address.slice(0, 6)}..${address.slice(-4)}`
                  : 'connect'}
              </button>
            )}
          </ConnectKitButton.Custom>

          {/* Theme toggle — exits terminal/classic and lands on the graphical site.
              Symmetric to the NavBar's >_ button: same two ASCII chars in green. */}
          {!isEmbedded && (
            <button
              onClick={() => {
                setMode('new');
                window.location.replace('/');
              }}
              title="Exit terminal"
              aria-label="Exit terminal"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#00ff41',
                cursor: 'pointer',
                fontSize: '14px',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontWeight: 700,
                padding: '2px 4px',
                lineHeight: 1,
              }}
            >
              &gt;_
            </button>
          )}
        </div>
      </div>

      {/* Filter bar — 32px */}
      <div
        style={{
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '0 16px',
          borderBottom: '1px solid #111',
          flexShrink: 0,
          overflowX: 'auto',
          overflowY: 'hidden',
        }}
        className="terminal-scrollbar"
      >
        {FILTER_TABS.map(tab => {
          const isActive = activeFilter === tab.key;
          const isChatButton = tab.key === '_CHAT';
          return (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              style={{
                background: isActive ? '#111' : 'transparent',
                border: 'none',
                color: isActive
                  ? isChatButton
                    ? '#00ff41'
                    : '#00ff41'
                  : isChatButton && chatHistory.length > 0
                    ? '#00ff41'
                    : '#444',
                cursor: 'pointer',
                fontSize: '11px',
                padding: '4px 10px',
                borderRadius: '2px',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                transition: 'color 0.15s',
                opacity: isChatButton && chatHistory.length > 0 && !isActive ? 0.6 : 1,
              }}
              onMouseEnter={e => {
                if (!isActive) (e.target as HTMLElement).style.color = '#666';
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  (e.target as HTMLElement).style.color =
                    isChatButton && chatHistory.length > 0 ? '#00ff41' : '#444';
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
