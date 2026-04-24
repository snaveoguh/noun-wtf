import type { GovernanceAction } from './GovernanceActionConfirm';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAccount } from 'wagmi';

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

export default function TerminalPrompt({ history, onNewMessages, onError }: Props) {
  const { address } = useAccount();
  const { activeDao } = useActiveDao();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<GovernanceAction | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll response panel
  useEffect(() => {
    if (response !== null) {
      responseRef.current?.scrollTo({ top: 0 });
    }
  }, [response]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (response !== null || pendingAction !== null)) {
        setResponse(null);
        setPendingAction(null);
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [response, pendingAction]);

  const dismiss = useCallback(() => {
    setResponse(null);
    setPendingAction(null);
    inputRef.current?.focus();
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      setInput('');
      setIsLoading(true);
      setResponse(null);
      setPendingAction(null);

      const userMsg: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
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
            view_context: { dao: activeDao },
          }),
        });

        if (!res.ok) {
          let errText: string;
          try {
            const errData = (await res.json()) as { error?: string };
            errText = errData.error ?? `HTTP ${res.status}`;
          } catch {
            errText = (await res.text()) || `HTTP ${res.status}`;
          }
          throw new Error(errText);
        }

        const data = (await res.json()) as { action?: GovernanceAction; response?: string };
        const responseText = data.response ?? '';
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: responseText,
          timestamp: Date.now(),
        };
        onNewMessages(userMsg, assistantMsg);
        setResponse(responseText);

        // Check for governance action
        if (data.action !== undefined && data.action.type !== undefined) {
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
    [activeDao, address, isLoading, history, onNewMessages, onError],
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

  return (
    <>
      {/* Response overlay */}
      {showOverlay && (
        <div
          style={{
            position: 'absolute',
            bottom: '48px',
            left: 0,
            right: 0,
            maxHeight: '60vh',
            background: '#000',
            borderTop: '1px solid #111',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 16px',
              borderBottom: '1px solid #111',
            }}
          >
            <span style={{ color: '#00ff41', fontSize: '11px' }}>agent nounirl</span>
            <button
              type="button"
              onClick={dismiss}
              style={{
                background: 'none',
                border: 'none',
                color: '#333',
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
              color: '#aaa',
              fontSize: '13px',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
            className="terminal-scrollbar"
          >
            {/* Agent text response */}
            {response !== null && <div>{response}</div>}

            {/* Governance action confirmation */}
            {pendingAction !== null && (
              <GovernanceActionConfirm
                action={pendingAction}
                onSuccess={handleActionSuccess}
                onCancel={handleActionCancel}
              />
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
          borderTop: '1px solid #111',
          background: '#000',
          flexShrink: 0,
        }}
      >
        <span style={{ color: '#00ff41', marginRight: '8px', fontSize: '14px' }}>&gt;</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') sendMessage(input);
          }}
          placeholder={isLoading ? 'thinking...' : 'vote, propose, ask nounirl anything...'}
          disabled={isLoading}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#ccc',
            fontSize: '14px',
            caretColor: '#00ff41',
          }}
        />
        {isLoading && (
          <span
            style={{
              color: '#00ff41',
              fontSize: '12px',
              opacity: 0.6,
              animation: 'pulse 1.5s infinite',
            }}
          >
            ...
          </span>
        )}
      </div>
    </>
  );
}
