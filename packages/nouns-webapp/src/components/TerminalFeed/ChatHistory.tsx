import { useEffect, useRef } from 'react';

import type { ChatMessage } from './TerminalPrompt';

interface Props {
  messages: ChatMessage[];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#333',
          fontSize: '13px',
        }}
      >
        no messages yet. type below to talk to nounirl.
      </div>
    );
  }

  return (
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
            borderBottom: i < messages.length - 1 ? '1px solid #0a0a0a' : 'none',
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
                color: msg.role === 'user' ? '#60a5fa' : '#00ff41',
                fontSize: '11px',
                letterSpacing: '0.5px',
              }}
            >
              {msg.role === 'user' ? 'you' : 'nounirl'}
            </span>
            <span style={{ color: '#222', fontSize: '11px' }}>
              {formatTime(msg.timestamp)}
            </span>
          </div>

          {/* Content */}
          <div
            style={{
              color: msg.role === 'user' ? '#888' : '#aaa',
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
  );
}
