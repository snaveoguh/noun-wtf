import type { GovernanceAction } from './GovernanceActionConfirm';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ConnectKitButton } from 'connectkit';
import { useLocation } from 'react-router';
import { useAccount } from 'wagmi';

import {
  openProposalDraft,
  type ProposalDraftPrefill,
} from '@/components/GameShell/openProposalDraft';
import useActiveDao from '@/hooks/useActiveDao';

import { normalizeTerminalErrorMessage } from './errorMessages';
import GovernanceActionConfirm from './GovernanceActionConfirm';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface Props {
  history: ChatMessage[];
  onNewMessages: (userMsg: ChatMessage, assistantMsg: ChatMessage) => void;
  onError: (userMsg: ChatMessage, errorMsg: string) => void;
}

const apiBaseEnv = import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined;
const API_BASE =
  typeof apiBaseEnv === 'string' && apiBaseEnv.length > 0
    ? apiBaseEnv
    : 'https://spirited-flexibility-production-3c30.up.railway.app';

// Tailwind `md` breakpoint is 768px; treat anything below as mobile so we can
// use a fixed-position overlay anchored above the on-screen keyboard.
const MOBILE_BREAKPOINT = 768;

// Single source of truth for example agent prompts. Used by both the rotating
// idle placeholder and the "while you wait" loading hints strip. Replaces the
// old /terminal ASCII greeting box now that we've sunset that route.
const AGENT_HINTS: readonly string[] = [
  'watch for ice cream',
  'what proposals are active?',
  'my reservations',
  'tell me about the treasury',
  'status',
  'traits head',
  'how does the auction work?',
  'tip nounirl.eth on any chain to reserve',
  'ask about noun 10000',
  'ask about missingnoun',
];

const HINT_ROTATE_MS = 3500;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.innerWidth < MOBILE_BREAKPOINT,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return isMobile;
}

// Pull the noun id out of `/noun/:id` or `/v2/noun/:id`. Mirrors the regexes
// in `useActiveDao` so the chat sees the same id the URL is rendering. We
// don't try to disambiguate other routes — the API only needs the id when the
// user is on a noun-detail page.
const NOUN_ID_RE = /^\/(?:v2\/)?noun\/(\d+)\/?$/;

function pathnameToNounId(pathname: string): number | null {
  const m = NOUN_ID_RE.exec(pathname);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Detect when the user is asking to open the proposal draft window. Two
 * shapes match:
 *   1. Short triggers — "draft proposal", "/prop", "give me a proposal window"
 *      → open an empty draft.
 *   2. Long pasted proposal-shaped markdown — starts with `# title` and/or
 *      contains a `## Summary` / `## Specification` heading → open with the
 *      pasted text loaded into the body and (when present) the H1 lifted out
 *      as the title.
 *
 * Returns a prefill payload to open with, or `null` to fall through to the
 * normal chat flow.
 */
function detectProposalDraftIntent(text: string): ProposalDraftPrefill | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lc = trimmed.toLowerCase();

  const triggerPatterns: readonly RegExp[] = [
    /^\/(?:draft|prop|proposal)\b/,
    /^(?:give me|open|show)\s+(?:a |the )?(?:proposal|prop)(?:\s+(?:window|builder|draft))?\s*\.?$/,
    /^(?:draft|create|new|start)\s+(?:a |the )?(?:proposal|prop)\s*\.?$/,
    /^proposal\s+(?:window|builder|draft)\s*\.?$/,
  ];
  if (triggerPatterns.some(re => re.test(lc))) {
    return {};
  }

  // Treat long markdown-shaped pastes as a proposal draft.
  const looksLikeProposalMarkdown =
    trimmed.length > 120 &&
    (/^#\s+\S/.test(trimmed) ||
      /##\s+(?:summary|specification|rationale|proposal action|risks?)\b/i.test(trimmed));
  if (!looksLikeProposalMarkdown) return null;

  const h1Match = trimmed.match(/^#\s+(.+?)\s*$/m);
  const title = h1Match?.[1]?.trim();
  const body = title ? trimmed.replace(/^#\s+.+?\n+/, '') : trimmed;
  return title ? { title, body } : { body };
}

export default function TerminalPrompt({ history, onNewMessages, onError }: Props) {
  const { address, isConnected } = useAccount();
  const { activeDao } = useActiveDao();
  const location = useLocation();
  const viewContext = useMemo(
    () => ({
      dao: activeDao,
      pathname: location.pathname,
      nounId: pathnameToNounId(location.pathname),
    }),
    [activeDao, location.pathname],
  );
  const isMobile = useIsMobile();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<GovernanceAction | null>(null);
  const [requiresWallet, setRequiresWallet] = useState(false);
  const [hintIndex, setHintIndex] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const actionCardRef = useRef<HTMLDivElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Rotate the placeholder/hints array. Pause while the user is interacting
  // (focused or typing) so we never yank text out from under them, and pause
  // during loading because the input switches to a 'thinking...' placeholder.
  // The same index drives the inline pending-state hints strip below the input.
  useEffect(() => {
    const paused = isLoading || isFocused || input.length > 0;
    if (paused) return;
    const id = window.setInterval(() => {
      setHintIndex(i => (i + 1) % AGENT_HINTS.length);
    }, HINT_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [isLoading, isFocused, input]);

  // While the agent is thinking, advance the loading hints faster so the
  // strip feels alive and gives the user something to read.
  useEffect(() => {
    if (!isLoading) return;
    const id = window.setInterval(() => {
      setHintIndex(i => (i + 1) % AGENT_HINTS.length);
    }, 1800);
    return () => window.clearInterval(id);
  }, [isLoading]);

  // Scroll response panel
  useEffect(() => {
    if (response !== null) {
      responseRef.current?.scrollTo({ top: 0 });
    }
  }, [response]);

  // Scroll the action card into view when it mounts (mobile keyboard can hide it).
  useEffect(() => {
    if (pendingAction !== null) {
      // Defer one frame so the card is mounted before we scroll.
      const id = window.requestAnimationFrame(() => {
        actionCardRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
      });
      return () => window.cancelAnimationFrame(id);
    }
  }, [pendingAction]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (response !== null || pendingAction !== null)) {
        setResponse(null);
        setPendingAction(null);
        setRequiresWallet(false);
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [response, pendingAction]);

  const dismiss = useCallback(() => {
    setResponse(null);
    setPendingAction(null);
    setRequiresWallet(false);
    inputRef.current?.focus();
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      setInput('');
      setIsLoading(true);
      setResponse(null);
      setPendingAction(null);
      setRequiresWallet(false);

      const userMsg: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };

      // Short-circuit: if the user typed a draft-proposal trigger or pasted
      // proposal-shaped markdown, open the draft window directly without a
      // round-trip through the agent backend. Faster feedback + saves tokens.
      const draftIntent = detectProposalDraftIntent(text);
      if (draftIntent) {
        openProposalDraft(draftIntent);
        const confirmation: ChatMessage = {
          role: 'assistant',
          content: draftIntent.title
            ? `opened a draft window with "${draftIntent.title}". add your action(s) and submit when ready.`
            : 'opened a draft window. paste your prop text or use the editor + add actions, then submit.',
          timestamp: Date.now(),
        };
        onNewMessages(userMsg, confirmation);
        setResponse(confirmation.content);
        setIsLoading(false);
        return;
      }

      // Build API history from last 10 messages
      const apiHistory = [...history, userMsg]
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content }));

      try {
        const res = await fetch(`${API_BASE}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            wallet: address ?? null,
            history: apiHistory,
            agent_mode: 'nounirl',
            view_context: viewContext,
          }),
        });

        if (!res.ok) {
          let errText: string;
          let needsWallet = false;
          try {
            const errData = (await res.json()) as { error?: string; requiresWallet?: boolean };
            errText = errData.error ?? `HTTP ${res.status}`;
            needsWallet = errData.requiresWallet === true;
          } catch {
            errText = (await res.text()) || `HTTP ${res.status}`;
          }
          // 401 with requiresWallet means the user needs to connect — surface a CTA
          // instead of a bare error string. Most common cause of "no green button on
          // mobile": wagmi's useAccount() returns no address yet (WalletConnect race).
          if (res.status === 401 || needsWallet) {
            setRequiresWallet(true);
            const friendly = `wallet not connected — connect to run governance commands.\n\n(server said: ${errText})`;
            onError(userMsg, errText);
            setResponse(friendly);
            return;
          }
          throw new Error(errText);
        }

        const data = (await res.json()) as {
          action?: GovernanceAction;
          response?: string;
          proposalDraft?: ProposalDraftPrefill;
        };
        const responseText = data.response ?? '';
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: responseText,
          timestamp: Date.now(),
        };
        onNewMessages(userMsg, assistantMsg);
        setResponse(responseText);

        // Backend-driven draft hook: NounIRL can return a structured
        // `proposalDraft` payload (extracted txs / title / body) which opens
        // the draft window automatically. Same entry point as the local
        // intent detector above.
        if (data.proposalDraft) {
          openProposalDraft(data.proposalDraft);
        }

        // Check for governance action
        if (data.action !== undefined && data.action.type !== undefined) {
          // Debug log so we can confirm in mobile devtools whether the API
          // returned an action even when the green button isn't visible.
          if (import.meta.env.DEV || (typeof window !== 'undefined' && window.localStorage?.getItem('nounwtf:debug') === '1')) {
            // eslint-disable-next-line no-console
            console.log('[TerminalPrompt] action received', {
              type: data.action.type,
              isConnected,
              hasAddress: !!address,
              isMobile,
            });
          }
          setPendingAction(data.action as GovernanceAction);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'connection failed';
        const friendlyError = normalizeTerminalErrorMessage(errMsg);
        onError(userMsg, errMsg);
        setResponse(friendlyError);
      } finally {
        setIsLoading(false);
      }
    },
    [viewContext, address, isConnected, isMobile, isLoading, history, onNewMessages, onError],
  );

  const handleActionSuccess = useCallback(
    (txHash: string) => {
      // Add success message to chat
      const successContent = `tx submitted: ${txHash.slice(0, 10)}... — check etherscan.io/tx/${txHash}`;
      onNewMessages(
        { role: 'user', content: '[governance action confirmed]', timestamp: Date.now() },
        { role: 'assistant', content: successContent, timestamp: Date.now() },
      );
      // Keep the overlay open to show the tx link
    },
    [onNewMessages],
  );

  const handleActionCancel = useCallback(() => {
    setPendingAction(null);
    onNewMessages(
      { role: 'user', content: '[governance action cancelled]', timestamp: Date.now() },
      { role: 'assistant', content: 'action cancelled.', timestamp: Date.now() },
    );
  }, [onNewMessages]);

  const showOverlay = response !== null || pendingAction !== null;

  // Mobile: pin the overlay to viewport bottom (above the input bar) using
  // fixed positioning + safe-area padding so the iOS keyboard can't clip it.
  // Desktop: keep the existing absolute-positioned panel inside the prompt
  // wrapper (unchanged visual behavior).
  const overlayStyle: React.CSSProperties = isMobile
    ? {
        position: 'fixed',
        bottom: 'calc(48px + env(safe-area-inset-bottom, 0px))',
        left: 0,
        right: 0,
        maxHeight: '70vh',
        background: 'var(--theme-bg-primary)',
        borderTop: '1px solid var(--theme-border)',
        zIndex: 1100,
        display: 'flex',
        flexDirection: 'column',
      }
    : {
        position: 'absolute',
        bottom: '48px',
        left: 0,
        right: 0,
        maxHeight: '60vh',
        background: 'var(--theme-bg-primary)',
        borderTop: '1px solid var(--theme-border)',
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
      };

  return (
    <>
      {/* Response overlay */}
      {showOverlay && (
        <div ref={overlayRef} style={overlayStyle}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 16px',
              borderBottom: '1px solid var(--theme-border)',
            }}
          >
            <span style={{ color: 'var(--theme-accent)', fontSize: '11px' }}>agent nounirl</span>
            <button
              type="button"
              onClick={dismiss}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--theme-text-muted)',
                cursor: 'pointer',
                fontSize: '12px',
                padding: '2px 6px',
              }}
            >
              esc
            </button>
          </div>
          <div
            ref={responseRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '12px 16px',
              color: 'var(--theme-text-secondary)',
              fontSize: '13px',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
            className="terminal-scrollbar"
          >
            {/* Agent text response */}
            {response !== null && <div>{response}</div>}

            {/* Wallet-required CTA — shown when /api/chat returns 401 +
                requiresWallet. Without this, the user just sees error text
                and has no obvious next step on mobile. */}
            {requiresWallet && (
              <div style={{ marginTop: '12px' }}>
                <ConnectKitButton.Custom>
                  {({ show }) => (
                    <button
                      type="button"
                      onClick={() => show?.()}
                      style={{
                        background: 'var(--theme-bg-tertiary)',
                        border: '1px solid var(--theme-accent)',
                        color: 'var(--theme-accent)',
                        cursor: 'pointer',
                        fontSize: '12px',
                        padding: '6px 16px',
                        borderRadius: 'var(--theme-radius-sm)',
                      }}
                    >
                      connect wallet
                    </button>
                  )}
                </ConnectKitButton.Custom>
              </div>
            )}

            {/* Governance action confirmation */}
            {pendingAction !== null && (
              <div ref={actionCardRef}>
                <GovernanceActionConfirm
                  action={pendingAction}
                  onSuccess={handleActionSuccess}
                  onCancel={handleActionCancel}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Input bar */}
      <div
        style={{
          height: '48px',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          borderTop: '1px solid var(--theme-border)',
          background: 'var(--theme-bg-primary)',
          flexShrink: 0,
        }}
      >
        <span style={{ color: 'var(--theme-accent)', marginRight: '8px', fontSize: '14px' }}>&gt;</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={e => {
            if (e.key === 'Enter') sendMessage(input);
          }}
          placeholder={isLoading ? 'thinking...' : `try: ${AGENT_HINTS[hintIndex]}`}
          disabled={isLoading}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--theme-text-secondary)',
            fontSize: '14px',
            caretColor: 'var(--theme-accent)',
          }}
        />
        {isLoading && (
          <span
            style={{
              color: 'var(--theme-accent)',
              fontSize: '12px',
              opacity: 0.6,
              animation: 'pulse 1.5s infinite',
            }}
          >
            ...
          </span>
        )}
      </div>

      {/* Pending-state hints strip — only visible while the agent is thinking.
          Replaces the old /terminal ASCII greeting box for command discovery.
          Renders inside the same column as the input so layout doesn't shift;
          uses fixed positioning on mobile to sit just above the input bar
          (matching the response overlay anchoring). */}
      {isLoading && (
        <div
          aria-hidden="true"
          style={{
            position: isMobile ? 'fixed' : 'absolute',
            bottom: isMobile
              ? 'calc(48px + env(safe-area-inset-bottom, 0px))'
              : '48px',
            left: 0,
            right: 0,
            padding: '4px 16px 6px',
            background: 'var(--theme-bg-primary)',
            borderTop: '1px solid var(--theme-feed-row-border)',
            color: 'var(--theme-text-muted)',
            fontSize: '11px',
            fontFamily: 'var(--theme-font-body)',
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            animation: 'pulse 2.4s infinite',
            zIndex: isMobile ? 1099 : 9,
            pointerEvents: 'none',
          }}
        >
          while you wait, try: <span style={{ color: 'var(--theme-text-secondary)' }}>{AGENT_HINTS[hintIndex]}</span>
        </div>
      )}
    </>
  );
}
