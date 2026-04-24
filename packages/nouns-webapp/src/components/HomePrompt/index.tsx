/**
 * HomePrompt — Always-visible intrigue + search/chat bar at the bottom of the hero.
 *
 * Shows a mysterious, poetic line about the current noun that invites engagement.
 * The input doubles as search (type a noun # to jump) and chat reply.
 */
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useNavigate } from 'react-router';
import { useAccount } from 'wagmi';

import useActiveDao from '@/hooks/useActiveDao';
import { traitName } from '@/lib/traitName';
import { nounPath } from '@/utils/history';
import type { INounSeed } from '@/wrappers/nounToken';

import classes from './HomePrompt.module.css';

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  response?: string;
  error?: string;
}

interface Props {
  nounId?: number;
  seed?: INounSeed;
}

function createMessage(role: Message['role'], content: string): Message {
  return { id: `${role}-${crypto.randomUUID()}`, role, content };
}

function generateIntrigue(nounId: number, seed: INounSeed): string {
  const head = traitName('head', seed.head).toLowerCase();
  const body = traitName('body', seed.body).toLowerCase();
  const acc = traitName('accessory', seed.accessory).toLowerCase();
  const bg = seed.background === 0 ? 'cool' : 'warm';

  const lines = [
    `a ${head} watches through noggles, ${acc} catching ${bg} light...`,
    `this ${head} appeared from the chain. its ${acc} hums quietly.`,
    `${bg} haze. a ${head} in ${body}. the noggles see everything.`,
    `born onchain — a ${head}, draped in ${body}. what does it want?`,
    `the ${head} stares through noggles. ${acc} whispers of what's next.`,
    `a ${head} wearing ${body} emerged today. it knows something...`,
    `through noggles, a ${head} contemplates its ${acc}. and you.`,
    `${head}. ${body}. ${acc}. three fragments of an onchain mystery.`,
    `in the ${bg} between blocks, a ${head} stirs. ${acc} at the ready.`,
    `a ${head} peers through noggles at forever, ${acc} gleaming.`,
    `every ${head} keeps a secret. this one wears ${body}, carries ${acc}.`,
    `the noggles see further than you think. ask this ${head}.`,
  ];

  return lines[nounId % lines.length];
}

const HomePrompt: FC<Props> = ({ nounId, seed }) => {
  const { address } = useAccount();
  const { activeDao } = useActiveDao();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const intrigueText = useMemo(() => {
    if (seed == null || nounId == null) return 'the noggles see everything. what do you see?';
    return generateIntrigue(nounId, seed);
  }, [nounId, seed]);

  // Auto-scroll conversation
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      const userMsg = createMessage('user', text);
      setMessages(prev => [...prev, userMsg]);
      setInput('');
      setIsLoading(true);

      try {
        const res = await fetch(`${API_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            wallet: address ?? null,
            history: messages.slice(-8),
            view_context: {
              dao: activeDao,
              nounId: nounId ?? null,
            },
          }),
        });

        const data = (await res.json()) as ChatResponse;

        if (!res.ok || data.error != null) {
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }

        const responseText =
          typeof data.response === 'string' ? data.response : 'Connection failed';
        setMessages(prev => [...prev, createMessage('assistant', responseText)]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Connection failed';
        setMessages(prev => [...prev, createMessage('assistant', msg)]);
      } finally {
        setIsLoading(false);
      }
    },
    [activeDao, address, isLoading, messages, nounId],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || isLoading) return;

      // Noun # navigation: "123" or "#123"
      const nounMatch = text.match(/^#?(\d+)$/);
      if (nounMatch) {
        navigate(nounPath(parseInt(nounMatch[1], 10)));
        setInput('');
        return;
      }

      sendMessage(text);
    },
    [input, isLoading, navigate, sendMessage],
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setMessages([]);
      inputRef.current?.blur();
    }
  }, []);

  return (
    <div className={classes.wrapper}>
      <p className={classes.intrigue}>{intrigueText}</p>

      {messages.length > 0 && (
        <div ref={scrollRef} className={classes.conversation}>
          {messages.map(msg => (
            <div
              key={msg.id}
              className={msg.role === 'user' ? classes.msgUser : classes.msgAssistant}
            >
              <span className={classes.msgLabel}>{msg.role === 'user' ? '>' : '\u2310\u25E8-\u25E8'}</span>
              <span className={classes.msgText}>{msg.content}</span>
            </div>
          ))}
          {isLoading && (
            <div className={classes.msgAssistant}>
              <span className={classes.msgLabel}>{'\u2310\u25E8-\u25E8'}</span>
              <span className={classes.thinking}>thinking</span>
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className={classes.inputBar}>
        <span className={classes.caret}>{'>'}</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="reply... or # to jump to a noun"
          className={classes.input}
          disabled={isLoading}
          autoComplete="off"
          spellCheck={false}
        />
        {messages.length > 0 && (
          <button
            type="button"
            className={classes.closeBtn}
            onClick={() => setMessages([])}
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
