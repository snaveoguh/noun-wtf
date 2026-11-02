// The NounIRL agent behind the homescreen's ask bar. Same command layer the
// old full-screen console had (and TERMINAL.EXE has): local verbs drive the
// OS, /cancel /draft /propose and pasted proposal JSON open the draft window
// or the confirm card, anything else goes to /api/chat.

import type { AppKind } from '../osStore';
import type { GovernanceAction } from '@/components/TerminalFeed/GovernanceActionConfirm';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAccount } from 'wagmi';

import { DRAFT_DAO_LABEL, normalizeDraftDao } from '@/components/GameShell/draftDao';
import {
  openProposalDraft,
  type ProposalDraftPrefill,
} from '@/components/GameShell/openProposalDraft';
import {
  detectCancelIntent,
  detectDraftPayload,
  detectProposalDraftIntent,
} from '@/components/TerminalFeed/TerminalPrompt';

import { game } from './rows';

const apiBaseEnv = import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined;
const API_BASE =
  typeof apiBaseEnv === 'string' && apiBaseEnv.length > 0
    ? apiBaseEnv
    : 'https://spirited-flexibility-production-3c30.up.railway.app';

export interface Line {
  who: 'agent' | 'you' | 'sys';
  text: string;
  /** characters revealed so far (agent lines type out) */
  shown: number;
}

export interface AgentHandlers {
  onEnterWorld: () => void;
  onEnterHoops: () => void;
  /** NOUN DRIVE (optional: older hosts don't pass it) */
  onEnterDrive?: () => void;
  onEnterWarfare: () => void;
  onOpen: (app: AppKind) => void;
  onNavigate: (path: string) => void;
}

/** Words that run something locally instead of asking the agent. */
export const LOCAL_VERBS = [
  'play',
  'skate',
  'world',
  'noun world',
  'hoops',
  'bball',
  'basketball',
  'noun hoops',
  'drive',
  'car',
  'cars',
  'noun drive',
  'taxi',
  'cab',
  'noun taxi',
  'warfare',
  'paintball',
  'noun warfare',
  'parkour',
  'freerun',
  'noun parkour',
  'index',
  'menu',
  'help',
  'ls',
  'readme',
  'manifesto',
  'pip3',
  'art',
  'feed',
  'terminal',
  'vote',
  'props',
  'bid',
  'auction',
  'clear',
];

export function useNounIRL(h: AgentHandlers) {
  const { address } = useAccount();
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<GovernanceAction | null>(null);
  const history = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const hr = useRef(h);
  useEffect(() => {
    hr.current = h;
  });

  const say = useCallback((text: string, who: Line['who'] = 'agent') => {
    setLines(ls => [...ls, { who, text, shown: who === 'agent' ? 0 : text.length }]);
  }, []);

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

  /** Runs a line. Returns true when it was handled locally (no agent reply to wait for). */
  const run = useCallback(
    async (raw: string): Promise<boolean> => {
      const text = raw.trim();
      if (text === '') return true;
      const { onEnterWorld, onEnterHoops, onEnterDrive, onEnterWarfare, onOpen, onNavigate } =
        hr.current;
      const cmd = text.toLowerCase().replace(/^\//, '');
      const world = game('world').loading;
      const hoops = game('hoops').loading;
      const war = game('warfare').loading;
      const drive = game('drive').loading;
      const goDrive = onEnterDrive ?? onEnterWorld;
      const local: Record<string, [() => void, string?]> = {
        play: [onEnterWorld, world],
        skate: [onEnterWorld, world],
        world: [onEnterWorld, world],
        'noun world': [onEnterWorld, world],
        hoops: [onEnterHoops, hoops],
        bball: [onEnterHoops, hoops],
        basketball: [onEnterHoops, hoops],
        'noun hoops': [onEnterHoops, hoops],
        drive: [goDrive, drive],
        car: [goDrive, drive],
        cars: [goDrive, drive],
        'noun drive': [goDrive, drive],
        taxi: [() => onNavigate('/world?play=taxi'), game('taxi').loading],
        cab: [() => onNavigate('/world?play=taxi'), game('taxi').loading],
        'noun taxi': [() => onNavigate('/world?play=taxi'), game('taxi').loading],
        warfare: [onEnterWarfare, war],
        paintball: [onEnterWarfare, war],
        'noun warfare': [onEnterWarfare, war],
        parkour: [() => onNavigate('/world?play=parkour'), game('parkour').loading],
        freerun: [() => onNavigate('/world?play=parkour'), game('parkour').loading],
        'noun parkour': [() => onNavigate('/world?play=parkour'), game('parkour').loading],
        index: [() => onOpen('directory')],
        menu: [() => onOpen('directory')],
        help: [() => onOpen('directory')],
        ls: [() => onOpen('directory')],
        readme: [() => onOpen('manifesto'), 'read it. then go make something'],
        manifesto: [() => onOpen('manifesto'), 'read it. then go make something'],
        pip3: [() => onOpen('pip3')],
        art: [() => onOpen('pip3')],
        feed: [() => onOpen('terminal')],
        terminal: [() => onOpen('terminal')],
        vote: [() => onNavigate('/vote')],
        props: [() => onNavigate('/vote')],
        bid: [() => onNavigate('/v2')],
        auction: [() => onNavigate('/v2')],
        clear: [() => setLines([])],
      };
      if (Object.hasOwn(local, cmd)) {
        const [fn, reply] = local[cmd]!;
        if (cmd !== 'clear') say(text, 'you');
        if (reply) say(reply);
        fn();
        return true;
      }
      say(text, 'you');
      // Same command layer as TERMINAL.EXE
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
        return false;
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
        return false;
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
      return false;
    },
    [address, say],
  );

  return { lines, busy, action, setAction, run, say };
}
