// ── Home: the noun.wtf shelf ─────────────────────────────────────────────
//
// A Netflix-style homescreen so people can see everything noun.wtf does and
// where to click: a sticky header (wordmark, section jumps, the search / ask
// NounIRL bar), a rotating featured-game hero, then shelves of 2:3 box-art
// cards: Play now, one per catalog section, Other Nouns clients, Community.
// The first visit of a session opens on the noggles ident (home/Intro).
//
// Props and game launching are unchanged from the old agent console, and
// the console itself lives on in the ask bar (home/AskBar + useNounIRL).

import type { AppKind } from './osStore';

import type { UIEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import { bigDropUnlocked } from '@/miniapps/world2/missions/unlocks';

import { CATALOG } from './catalog';
import AskBar from './home/AskBar';
import { parseEntries, SUBMISSIONS_URL } from './home/community';
import { GameSheet, SubmitDialog } from './home/Dialogs';
import Hero from './home/Hero';
import { HOME_CSS } from './home/homeStyles';
import Intro, { shouldPlayIntro } from './home/Intro';
import {
  BIG_DROP_HINT,
  buildRows,
  GAMES,
  HERO_SLIDES,
  type Game,
  type GameId,
  type Item,
} from './home/rows';
import { Shelf } from './home/Shelf';
import { ident, unlockAudio } from './home/sound';
import { cx } from './osStore';

export type { GameId } from './home/rows';

const SOUND_KEY = 'nounwtf-home-sound';

const JUMPS: [string, string][] = [
  ['play', 'Games'],
  ['art', 'Art'],
  ['free', 'Freedom'],
  ['gov', 'The DAO'],
  ['mkt', 'Market'],
  ['net', 'Network'],
  ['clients', 'Clients'],
  ['community', 'Community'],
];

/** Sound is on by default; only an explicit mute ('0') is remembered as off. */
function readSound(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== '0';
  } catch {
    return true;
  }
}

export default function AgentHome({
  active,
  worldLoaded = false,
  warfareLoaded = false,
  onEnterWorld,
  onEnterHoops,
  onEnterBreaks,
  onEnterWarfare,
  onEnterDrop,
  onOpen,
  onNavigate,
}: {
  active: boolean;
  /** Game already running (play resumes instantly) */
  worldLoaded?: boolean;
  warfareLoaded?: boolean;
  onEnterWorld: () => void;
  onEnterHoops: () => void;
  onEnterBreaks: () => void;
  onEnterWarfare: () => void;
  /** Noun World straight onto the Big Drop (only offered once it's unlocked) */
  onEnterDrop: () => void;
  onOpen: (app: AppKind) => void;
  onNavigate: (path: string) => void;
}) {
  const [intro, setIntro] = useState(shouldPlayIntro);
  const [sound, setSound] = useState(readSound);
  const [scrolled, setScrolled] = useState(false);
  const [sheet, setSheet] = useState<Game | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  // THE BIG DROP opens with the deepest door in Noun World (saved in this
  // browser). Re-read whenever the visitor comes back to the homepage.
  const [dropOpen, setDropOpen] = useState(bigDropUnlocked);
  useEffect(() => {
    const check = () => setDropOpen(bigDropUnlocked());
    check();
    const onVis = () => document.visibilityState === 'visible' && check();
    window.addEventListener('focus', check);
    window.addEventListener('storage', check);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', check);
      window.removeEventListener('storage', check);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [active]);

  const community = useQuery({
    queryKey: ['community-submissions'],
    queryFn: async () => {
      const res = await fetch(SUBMISSIONS_URL);
      if (!res.ok) return [];
      return parseEntries(await res.json().catch(() => null));
    },
    staleTime: 5 * 60_000,
    retry: 0,
  });

  const rows = useMemo(
    () => buildRows(CATALOG, community.data ?? [], { dropUnlocked: dropOpen }),
    [community.data, dropOpen],
  );

  const resumable = useCallback(
    (id: GameId) => (id === 'world' && worldLoaded) || (id === 'warfare' && warfareLoaded),
    [worldLoaded, warfareLoaded],
  );

  const ctaFor = useCallback((id: GameId) => GAMES.find(g => g.id === id)?.cta ?? 'PLAY', []);

  const play = useCallback(
    (id: GameId) => {
      if (id === 'hoops') onEnterHoops();
      else if (id === 'breaks') onEnterBreaks();
      else if (id === 'warfare') onEnterWarfare();
      else if (id === 'drop') {
        // Locked: the sheet says how to open it (its button opens Noun World)
        if (bigDropUnlocked()) onEnterDrop();
        else {
          setDropOpen(false);
          setSheet(GAMES.find(g => g.id === 'drop') ?? null);
        }
      } else onEnterWorld();
    },
    [onEnterHoops, onEnterBreaks, onEnterWarfare, onEnterWorld, onEnterDrop],
  );

  const activate = useCallback(
    (it: Item) => {
      const a = it.action;
      switch (a.t) {
        case 'game':
          play(a.id);
          return;
        case 'submit':
          setSubmitting(true);
          return;
        case 'external':
          window.open(a.url, '_blank', 'noopener,noreferrer');
          return;
        case 'entry':
          if (a.entry.app !== undefined) onOpen(a.entry.app);
          else if (a.entry.path === '/world/classic') window.location.assign(a.entry.path);
          else onNavigate(a.entry.path);
      }
    },
    [play, onOpen, onNavigate],
  );

  // Sound is on by default (the visitor can mute). Browsers won't play audio
  // before a gesture, so the first click, tap or key anywhere unlocks it.
  useEffect(() => {
    if (!sound) return;
    const unlock = () => void unlockAudio();
    const evs = ['pointerdown', 'keydown', 'touchstart'] as const;
    evs.forEach(ev => window.addEventListener(ev, unlock, { once: true, passive: true }));
    return () => evs.forEach(ev => window.removeEventListener(ev, unlock));
  }, [sound]);

  const toggleSound = useCallback(async () => {
    const next = !sound;
    setSound(next);
    try {
      localStorage.setItem(SOUND_KEY, next ? '1' : '0');
    } catch {
      // ignore
    }
    if (next && (await unlockAudio())) ident(true);
  }, [sound]);

  const jump = (id: string) => {
    const el = scroller.current?.querySelector<HTMLElement>(`#row-${id}`);
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  const handlers = useMemo(
    () => ({ onEnterWorld, onEnterHoops, onEnterWarfare, onOpen, onNavigate }),
    [onEnterWorld, onEnterHoops, onEnterWarfare, onOpen, onNavigate],
  );

  const onIntroDone = useCallback(() => setIntro(false), []);
  const closeSheet = useCallback(() => setSheet(null), []);
  const closeSubmit = useCallback(() => setSubmitting(false), []);

  return (
    <div
      ref={scroller}
      className={cx('nh', scrolled && 'is-scrolled', intro && 'is-intro')}
      onScroll={(e: UIEvent<HTMLDivElement>) => setScrolled(e.currentTarget.scrollTop > 24)}
    >
      <style>{HOME_CSS}</style>
      {intro && <Intro onDone={onIntroDone} />}

      <header className="nh-head">
        <a
          className="nh-brand"
          href="/"
          onClick={e => {
            e.preventDefault();
            scroller.current?.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          aria-label="noun.wtf home"
        >
          <span className="nh-wordmark" data-keep-font>
            NOUN.WTF
          </span>
        </a>
        <nav className="nh-nav" aria-label="Sections">
          {JUMPS.map(([id, label]) => (
            <button key={id} type="button" onClick={() => jump(id)}>
              {label}
            </button>
          ))}
        </nav>
        <AskBar
          rows={rows}
          active={active && !intro}
          handlers={handlers}
          onActivate={activate}
          onOpen={onOpen}
        />
      </header>

      {/* The hero (video) and the shelves (dozens of posters) mount once the
          intro is done: mounting them under it kept the main thread so busy
          the noggles froze half built on real machines. */}
      {!intro && (
        <Hero
          slides={HERO_SLIDES}
          active={active && !intro && sheet === null}
          sound={sound}
          resumable={resumable}
          ctaFor={ctaFor}
          lockedFor={id => id === 'drop' && !dropOpen}
          onToggleSound={() => void toggleSound()}
          onPlay={play}
          onGo={onNavigate}
          onMore={id => setSheet(GAMES.find(g => g.id === id) ?? null)}
          onBrowse={() => jump('play')}
        />
      )}

      <div className="nh-manifesto">
        <p>
          <b>the dao got captured. we didn&rsquo;t.</b> noun.wtf is the underground side of nouns:
          games, art, a free dao and every tool for watching the old one.
        </p>
        <div className="nh-manifesto-links">
          <button type="button" onClick={() => onOpen('manifesto')}>
            README
          </button>
          <button type="button" onClick={() => onOpen('directory')}>
            INDEX
          </button>
          <button type="button" onClick={() => onOpen('terminal')}>
            TERMINAL
          </button>
        </div>
      </div>

      <nav className="nh-jumps" aria-label="Jump to section">
        {JUMPS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => jump(id)}>
            {label}
          </button>
        ))}
      </nav>

      <main className="nh-rows">
        {!intro && rows.map(r => <Shelf key={r.id} row={r} onActivate={activate} sound={sound} />)}
      </main>

      <footer className="nh-foot">
        <span>⌐◨-◨</span> noun.wtf · cc0 · one noun a day, forever ·{' '}
        <button type="button" onClick={() => setSubmitting(true)}>
          submit something
        </button>
      </footer>

      {sheet && (
        <GameSheet
          game={sheet}
          resume={resumable(sheet.id)}
          locked={sheet.id === 'drop' && !dropOpen ? { hint: BIG_DROP_HINT } : undefined}
          onPlay={play}
          onClose={closeSheet}
        />
      )}
      {submitting && <SubmitDialog onClose={closeSubmit} />}
    </div>
  );
}
