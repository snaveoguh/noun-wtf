/**
 * HomePrompt — Minimal inline chat bar for the homepage.
 *
 * Sits above the auction, same background color as the noun of the day.
 * "What would you like to do here?" — user types, gets AI response inline.
 * Thin, quiet, unobtrusive. Expands to show conversation when active.
 */
import { FC, useCallback, useEffect, useRef, useState } from 'react';

import { useAccount } from 'wagmi';

import classes from './HomePrompt.module.css';

const API_URL =
  import.meta.env.VITE_API_URL ||
  'https://spirited-flexibility-production-3c30.up.railway.app';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const HomePrompt: FC = () => {
  const { address } = useAccount();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll conversation
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      const userMsg: Message = { role: 'user', content: text };
      setMessages(prev => [...prev, userMsg]);
      setInput('');
      setIsExpanded(true);
      setIsLoading(true);

      try {
        const res = await fetch(`${API_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            wallet: address ?? null,
            history: messages.slice(-8),
          }),
        });

        const data = await res.json();

        if (!res.ok || data.error) {
          const errMsg = data.error || `HTTP ${res.status}`;
          throw new Error(errMsg);
        }

        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: data.response },
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Connection failed';
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: msg },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [address, isLoading, messages],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      sendMessage(input);
    },
    [input, sendMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsExpanded(false);
        inputRef.current?.blur();
      }
    },
    [],
  );

  return (
    <div className={classes.wrapper}>
      {/* Conversation area (visible when expanded and has messages) */}
      {isExpanded && messages.length > 0 && (
        <div ref={scrollRef} className={classes.conversation}>
          {messages.map((msg, i) => (
            <div
              key={i}
              className={msg.role === 'user' ? classes.msgUser : classes.msgAssistant}
            >
              <span className={classes.msgLabel}>
                {msg.role === 'user' ? '>' : '⌐◨-◨'}
              </span>
              <span className={classes.msgText}>{msg.content}</span>
            </div>
          ))}
          {isLoading && (
            <div className={classes.msgAssistant}>
              <span className={classes.msgLabel}>⌐◨-◨</span>
              <span className={classes.thinking}>thinking</span>
            </div>
          )}
        </div>
      )}

      {/* Input bar */}
      <form onSubmit={handleSubmit} className={classes.inputBar}>
        <span className={classes.caret}>{'>'}</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onFocus={() => setIsExpanded(true)}
          onKeyDown={handleKeyDown}
          placeholder="what would you like to know about nouns?"
          className={classes.input}
          disabled={isLoading}
          autoComplete="off"
          spellCheck={false}
        />
        {isExpanded && messages.length > 0 && (
          <button
            type="button"
            className={classes.closeBtn}
            onClick={() => {
              setIsExpanded(false);
              setMessages([]);
            }}
            title="Clear"
          >
            ×
          </button>
        )}
        {input.trim() && (
          <button type="submit" className={classes.sendBtn} disabled={isLoading}>
            ↵
          </button>
        )}
      </form>
    </div>
  );
};

export default HomePrompt;
