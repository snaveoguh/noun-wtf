// ── Home: the agent. A full-screen typable feed that greets you ──────────
//
// The background of noun.wtf is a conversation with NounIRL (same /api/chat
// agent as the terminal). Local verbs (play, index, readme, pip3, feed, bid)
// drive the OS; anything else goes to the agent. The Noun World cover hangs
// behind it as a poster — click it (or type `play`) to load the game. The
// other games (Noun Hoops, …) are stacked behind it like a deck: click a
// back card (or its chip) to bring it forward, click the front one to play.

import type { AppKind } from './osStore';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAccount } from 'wagmi';

import { DRAFT_DAO_LABEL, normalizeDraftDao } from '@/components/GameShell/draftDao';
import {
  openProposalDraft,
  type ProposalDraftPrefill,
} from '@/components/GameShell/openProposalDraft';
import GovernanceActionConfirm, {
  type GovernanceAction,
} from '@/components/TerminalFeed/GovernanceActionConfirm';
import {
  detectCancelIntent,
  detectDraftPayload,
  detectProposalDraftIntent,
} from '@/components/TerminalFeed/TerminalPrompt';

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

export type GameId = 'world' | 'hoops';

const GAMES: { id: GameId; name: string; cover: string; cta: string; loading: string }[] = [
  {
    id: 'world',
    name: 'Noun World',
    cover: '/world2/cover-1200.webp',
    cta: 'PRESS TO PLAY ▸',
    loading: 'loading noun world. grab a board',
  },
  {
    id: 'hoops',
    name: 'Noun Hoops',
    cover: '/world2/hoops-cover.webp',
    cta: 'PLAY 3V3 ▸',
    loading: 'lacing up. off to the noun jersey court',
  },
];

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
  'hoops    3v3 on the jersey court',
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
  onEnterHoops,
  onOpen,
  onNavigate,
}: {
  active: boolean;
  /** Game already loaded once (play resumes instantly) */
  gameLoaded?: boolean;
  onEnterWorld: () => void;
  onEnterHoops: () => void;
  onOpen: (app: AppKind) => void;
  onNavigate: (path: string) => void;
}) {
  const { address } = useAccount();
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<GovernanceAction | null>(null);
  const [front, setFront] = useState<GameId>('world');
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
      hoops: onEnterHoops,
      bball: onEnterHoops,
      basketball: onEnterHoops,
      'noun hoops': onEnterHoops,
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
        hoops: GAMES[1]!.loading,
        bball: GAMES[1]!.loading,
        basketball: GAMES[1]!.loading,
        'noun hoops': GAMES[1]!.loading,
        readme: 'read it. then go make something',
        manifesto: 'read it. then go make something',
      };
      if (replies[cmd]) say(replies[cmd]);
      local[cmd]!();
      return;
    }
    // Same command layer as TERMINAL.EXE: /cancel, /draft, /propose [lil],
    // pasted proposal JSON/markdown open the draft window or confirm card.
    const cancel = detectCancelIntent(text);
    if (cancel) {
      const dao = cancel.lil ? 'lil-nouns' : 'nouns';
      setAction({
        type: 'CANCEL_PROPOSAL',
        proposalId: cancel.proposalId,
        dao,
      } as GovernanceAction);
      say(
        `ready to cancel ${dao === 'lil-nouns' ? 'lil nouns' : 'nouns'} prop #${cancel.proposalId}. confirm below, only the proposer can cancel`,
      );
      return;
    }
    const draft = detectDraftPayload(text) ?? detectProposalDraftIntent(text);
    if (draft) {
      openProposalDraft(draft);
      const label = DRAFT_DAO_LABEL[normalizeDraftDao(draft.dao)];
      const tx = draft.transactions?.length ?? 0;
      say(
        tx > 0
          ? `opened a ${label} draft with ${tx} transaction${tx === 1 ? '' : 's'}. review and submit`
          : `opened a ${label} draft. write it up, add actions, submit`,
      );
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
      const data = (await res.json().catch(() => ({}))) as {
        response?: string;
        error?: string;
        action?: GovernanceAction;
        proposalDraft?: ProposalDraftPrefill;
      };
      if (data.proposalDraft) openProposalDraft(data.proposalDraft);
      if (data.action?.type !== undefined) setAction(data.action);
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
      {GAMES.map((g, i) => {
        // Depth in the stack: 0 = front, then the rest in order behind it
        const fi = GAMES.findIndex(x => x.id === front);
        const d = (i - fi + GAMES.length) % GAMES.length;
        const resume = g.id === 'world' && gameLoaded;
        return (
          <button
            key={g.id}
            type="button"
            className={`nos-poster-card${d > 0 ? 'is-back' : ''}`}
            style={{ '--d': d, zIndex: 10 - d } as CSSProperties}
            data-nos-reflect={d === 0 ? 'poster' : undefined}
            tabIndex={d === 0 ? 0 : -1}
            onPointerDown={e => e.stopPropagation()}
            onClick={() => {
              if (d > 0) {
                setFront(g.id);
                return;
              }
              if (g.id === 'hoops') {
                say(g.loading);
                onEnterHoops();
              } else {
                say(resume ? 'back to the plaza' : g.loading);
                onEnterWorld();
              }
            }}
            aria-label={d === 0 ? `Play ${g.name}` : `Show ${g.name}`}
          >
            <img src={g.cover} alt={g.name} draggable={false} />
            {d === 0 && <span className="nos-poster-cta">{resume ? 'RESUME ▸' : g.cta}</span>}
          </button>
        );
      })}
      <div className="nos-game-tabs" onPointerDown={e => e.stopPropagation()}>
        {GAMES.map(g => (
          <button
            key={g.id}
            type="button"
            className={g.id === front ? 'is-on' : undefined}
            onClick={() => setFront(g.id)}
          >
            {g.name}
          </button>
        ))}
      </div>

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
          {action && (
            <div className="nos-action">
              <GovernanceActionConfirm
                action={action}
                onSuccess={hash =>
                  say(`tx submitted: ${hash.slice(0, 10)}… etherscan.io/tx/${hash}`)
                }
                onCancel={() => {
                  setAction(null);
                  say('cancelled');
                }}
              />
            </div>
          )}
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
            className="nos-bare"
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
