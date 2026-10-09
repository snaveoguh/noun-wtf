// ── Home: the agent. A full-screen typable feed that greets you ──────────
//
// The background of noun.wtf is a conversation with NounIRL (same /api/chat
// agent as the terminal). Local verbs (play, index, readme, pip3, feed, bid)
// drive the OS; anything else goes to the agent. The Noun World cover hangs
// behind it as a poster — click it (or type `play`) to load the game.

import type { AppKind } from './osStore';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAccount } from 'wagmi';

const apiBaseEnv = import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined;
const API_BASE =
  typeof apiBaseEnv === 'string' && apiBaseEnv.length > 0
    ? apiBaseEnv
    : 'https://spirited-flexibility-production-3c30.up.railway.app';

interface Line {
  who: 'agent' | 'you' | 'sys';
  text: string;
  /** characters revealed so far (agent lines type out) */
  shown: number;
}

const GREETING = [
  '⌐◨-◨ you made it',
  '',
  'the dao got captured',
  "we didn't",
  '',
  'this is noun.wtf. the underground side of nouns',
  'say something, or type one of these',
  '',
  'play     skate noun world',
  'index    everything else',
  'readme   what happened',
  'pip3     the art',
].join('\n');

const RETURNING = ['⌐◨-◨ back again', '', 'play, index, readme, pip3', 'or just talk'].join('\n');

const SEEN_KEY = 'nounos-home-seen';

export default function AgentHome({
  active,
  gameLoaded = false,
  onEnterWorld,
  onOpen,
  onNavigate,
}: {
  active: boolean;
  /** Game already loaded once (play resumes instantly) */
  gameLoaded?: boolean;
  onEnterWorld: () => void;
  onOpen: (app: AppKind) => void;
  onNavigate: (path: string) => void;
}) {
  const { address } = useAccount();
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const history = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const say = useCallback((text: string, who: Line['who'] = 'agent') => {
    setLines(ls => [...ls, { who, text, shown: who === 'agent' ? 0 : text.length }]);
  }, []);

  // Greeting, typed out on arrival
  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN_KEY) === '1';
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // private mode
    }
    const t = window.setTimeout(() => say(seen ? RETURNING : GREETING), 450);
    return () => window.clearTimeout(t);
  }, [say]);

  // Typewriter
  useEffect(() => {
    const pending = lines.findIndex(l => l.shown < l.text.length);
    if (pending < 0) return;
    const t = window.setTimeout(() => {
      setLines(ls =>
        ls.map((l, i) =>
          i === pending ? { ...l, shown: Math.min(l.text.length, l.shown + 2) } : l,
        ),
      );
    }, 18);
    return () => window.clearTimeout(t);
  }, [lines]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  useEffect(() => {
    if (active) inputRef.current?.focus({ preventScroll: true });
  }, [active]);

  const run = async (raw: string) => {
    const text = raw.trim();
    if (text === '') return;
    say(text, 'you');
    const cmd = text.toLowerCase().replace(/^\//, '');
    const local: Record<string, () => void> = {
      play: onEnterWorld,
      skate: onEnterWorld,
      world: onEnterWorld,
      'noun world': onEnterWorld,
      index: () => onOpen('directory'),
      menu: () => onOpen('directory'),
      help: () => onOpen('directory'),
      ls: () => onOpen('directory'),
      readme: () => onOpen('manifesto'),
      manifesto: () => onOpen('manifesto'),
      pip3: () => onOpen('pip3'),
      art: () => onOpen('pip3'),
      feed: () => onOpen('terminal'),
      terminal: () => onOpen('terminal'),
      vote: () => onNavigate('/vote'),
      props: () => onNavigate('/vote'),
      bid: () => onNavigate('/v2'),
      auction: () => onNavigate('/v2'),
      clear: () => setLines([]),
    };
    if (Object.hasOwn(local, cmd)) {
      const replies: Record<string, string> = {
        play: 'loading noun world. grab a board',
        skate: 'loading noun world. grab a board',
        world: 'loading noun world. grab a board',
        'noun world': 'loading noun world. grab a board',
        readme: 'read it. then go make something',
        manifesto: 'read it. then go make something',
      };
      if (replies[cmd]) say(replies[cmd]);
      local[cmd]!();
      return;
    }
    setBusy(true);
    history.current.push({ role: 'user', content: text });
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          wallet: address ?? null,
          history: history.current.slice(-10),
          agent_mode: 'nounirl',
          view_context: { page: 'home' },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { response?: string; error?: string };
      const reply =
        data.response ??
        (res.status === 401
          ? 'connect a wallet for that one, bottom of the screen'
          : (data.error ?? 'static on the line, try again'));
      history.current.push({ role: 'assistant', content: reply });
      say(reply);
    } catch {
      say('signal lost. give it a sec', 'sys');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="nos-home"
      onPointerDown={() => inputRef.current?.focus({ preventScroll: true })}
    >
      <div className="nos-poster" aria-hidden>
        <img src="/world2/cover-blur.webp" alt="" draggable={false} />
      </div>
      <button
        type="button"
        className="nos-poster-card"
        data-nos-reflect="poster"
        onPointerDown={e => e.stopPropagation()}
        onClick={() => {
          say(gameLoaded ? 'back to the plaza' : 'loading noun world. grab a board');
          onEnterWorld();
        }}
        aria-label="Play Noun World"
      >
        <img src="/world2/cover-1200.webp" alt="Noun World" draggable={false} />
        <span className="nos-poster-cta">{gameLoaded ? 'RESUME ▸' : 'PRESS TO PLAY ▸'}</span>
      </button>

      <div className="nos-console">
        <div ref={logRef} className="nos-log">
          {lines.map((l, i) => (
            <pre key={i} className={`nos-line who-${l.who}`}>
              {l.who === 'you' ? '> ' : ''}
              {l.text.slice(0, l.shown)}
              {l.shown < l.text.length && <span className="nos-caret">▌</span>}
            </pre>
          ))}
          {busy && <pre className="nos-line who-sys">…</pre>}
        </div>
        <form
          className="nos-prompt"
          onSubmit={e => {
            e.preventDefault();
            const v = input;
            setInput('');
            void run(v);
          }}
        >
          <span>›</span>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="say something"
            spellCheck={false}
            autoComplete="off"
          />
        </form>
      </div>
    </div>
  );
}
