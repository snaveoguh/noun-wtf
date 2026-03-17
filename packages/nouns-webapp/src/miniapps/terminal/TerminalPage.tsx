import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';

import { useAccount } from 'wagmi';

const CrystalBall = lazy(() => import('@/components/CrystalBall'));

const TERMINAL_GREETING = `╔══════════════════════════════════════════╗
║  NOUN.WTF TERMINAL v1.0                 ║
║  ⌐◨-◨ AI-POWERED NOUNS NAVIGATOR        ║
╠══════════════════════════════════════════╣
║                                          ║
║  TYPE A QUESTION ABOUT NOUNS DAO.        ║
║  EXAMPLES:                               ║
║  > WHAT PROPOSALS ARE ACTIVE?            ║
║  > HOW DOES THE AUCTION WORK?            ║
║  > TELL ME ABOUT THE TREASURY            ║
║                                          ║
╚══════════════════════════════════════════╝`;

const AGENT_GREETING = `╔══════════════════════════════════════════╗
║  AGENT NOUNIRL v1.0                      ║
║  ⌐◨-◨ AUTONOMOUS NOUN SETTLER            ║
╠══════════════════════════════════════════╣
║                                          ║
║  I MONITOR EVERY BLOCK AND SETTLE        ║
║  AUCTIONS WHEN TARGET TRAITS APPEAR.     ║
║                                          ║
║  COMMANDS:                               ║
║  > STATUS                                ║
║  > WATCH FOR [TRAIT]                     ║
║  > MY RESERVATIONS                       ║
║  > TRAITS [CATEGORY]                     ║
║                                          ║
║  TIP ≥ $5 ETH TO NOUNIRL.ETH            ║
║  (ANY CHAIN) TO ACTIVATE A WATCH.        ║
║                                          ║
╚══════════════════════════════════════════╝`;

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface AgentStatus {
  running: boolean;
  lastBlock: number;
  nextNounId: number;
  predictedTraits: Record<string, string> | null;
  reservations: { active: number; total: number };
}

const TerminalPage: React.FC = () => {
  const { address } = useAccount();
  const [agentMode, setAgentMode] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: TERMINAL_GREETING, timestamp: Date.now() },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Fetch agent status periodically when in agent mode
  useEffect(() => {
    if (!agentMode) return;

    const fetchStatus = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'https://spirited-flexibility-production-3c30.up.railway.app';
        const res = await fetch(`${apiUrl}/api/agent/status`);
        if (res.ok) {
          const data = await res.json();
          setAgentStatus({
            running: data.running,
            lastBlock: data.lastBlock,
            nextNounId: data.nextNounId,
            predictedTraits: data.predictedTraits,
            reservations: data.reservations,
          });
        }
      } catch { /* silent fail */ }
    };

    fetchStatus();
    const timer = setInterval(fetchStatus, 12_000); // every 2 blocks
    return () => clearInterval(timer);
  }, [agentMode]);

  // Switch mode — reset messages with appropriate greeting
  const toggleAgentMode = useCallback(() => {
    const newMode = !agentMode;
    setAgentMode(newMode);
    setMessages([{
      role: 'system',
      content: newMode ? AGENT_GREETING : TERMINAL_GREETING,
      timestamp: Date.now(),
    }]);
    setAgentStatus(null);
  }, [agentMode]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      const userMsg: Message = { role: 'user', content: text, timestamp: Date.now() };
      setMessages(prev => [...prev, userMsg]);
      setInput('');
      setIsLoading(true);

      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'https://spirited-flexibility-production-3c30.up.railway.app';
        const res = await fetch(`${apiUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            wallet: address ?? null,
            history: messages.filter(m => m.role !== 'system').slice(-10),
            agent_mode: agentMode ? 'nounirl' : undefined,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(errText || `HTTP ${res.status}`);
        }

        const data = await res.json();
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: data.response, timestamp: Date.now() },
        ]);
      } catch (err) {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: `ERROR: ${err instanceof Error ? err.message : 'Connection failed'}. The Terminal backend may not be deployed yet.`,
            timestamp: Date.now(),
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [address, isLoading, messages, agentMode],
  );

  // Colors based on mode
  const accentColor = agentMode ? '#f59e0b' : '#22c55e';
  const accentDim = agentMode ? '#92400e' : '#166534';
  const accentBright = agentMode ? '#fbbf24' : '#4ade80';
  const accentMuted = agentMode ? '#78350f' : '#14532d';
  const textColor = agentMode ? '#fcd34d' : '#86efac';
  const textLight = agentMode ? '#fde68a' : '#bbf7d0';

  return (
    <div className="flex min-h-[calc(100vh-80px)] flex-col bg-black p-4 font-mono">
      {/* Header row with crystal ball */}
      <div className="mb-2 flex items-start gap-4">
        {/* Left: header + status + messages */}
        <div className="min-w-0 flex-1">
          {/* Header */}
          <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: accentDim }}>
            <div className="flex items-center gap-3">
              <span className="text-sm" style={{ color: accentColor }}>
                {agentMode ? 'AGENT NOUNIRL' : 'NOUN.WTF TERMINAL'}
                {address ? ` | ${address.slice(0, 6)}...${address.slice(-4)}` : ' | NOT CONNECTED'}
              </span>

              {/* Agent mode toggle */}
              <button
                onClick={toggleAgentMode}
                className="rounded px-2 py-0.5 text-xs font-bold transition-all"
                style={{
                  background: agentMode ? 'rgba(245, 158, 11, 0.2)' : 'rgba(34, 197, 94, 0.15)',
                  color: accentBright,
                  border: `1px solid ${agentMode ? 'rgba(245, 158, 11, 0.4)' : 'rgba(34, 197, 94, 0.3)'}`,
                }}
                title={agentMode ? 'Switch to Terminal' : 'Switch to Agent NounIRL'}
              >
                {agentMode ? '\u2190 TERMINAL' : 'AGENT \u2310\u25E8-\u25E8 \u2192'}
              </button>
            </div>

            <span className="text-xs" style={{ color: accentDim }}>
              {messages.filter(m => m.role === 'user').length} QUERIES
            </span>
          </div>

          {/* Agent status bar (only in agent mode) */}
          {agentMode && agentStatus && (
            <div
              className="mt-2 flex flex-wrap items-center gap-3 rounded px-3 py-1.5 text-xs"
              style={{
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.15)',
                color: '#d97706',
              }}
            >
              <span>
                {agentStatus.running ? '\uD83D\uDFE2' : '\uD83D\uDD34'} {agentStatus.running ? 'ACTIVE' : 'OFFLINE'}
              </span>
              <span>BLOCK {agentStatus.lastBlock}</span>
              <span>NEXT: #{agentStatus.nextNounId}</span>
              <span>{agentStatus.reservations.active} WATCHES</span>
              {agentStatus.predictedTraits && (
                <span style={{ opacity: 0.6 }}>
                  PREDICTED: {Object.values(agentStatus.predictedTraits).join(' \u00B7 ')}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right: Crystal Ball — hidden on small screens */}
        <div className="hidden shrink-0 lg:block">
          <Suspense fallback={
            <div style={{ width: 160, height: 212, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontFamily: '"Courier New", monospace', fontSize: 10, color: '#333', letterSpacing: '0.1em' }}>
                SCRYING...
              </span>
            </div>
          }>
            <CrystalBall size={160} />
          </Suspense>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto pb-4" style={{ maxHeight: 'calc(100vh - 240px)' }}>
        {messages.map((msg, i) => (
          <div key={i} className="mb-3">
            {msg.role === 'system' ? (
              <pre className="whitespace-pre-wrap text-xs sm:text-sm" style={{ color: accentDim }}>{msg.content}</pre>
            ) : msg.role === 'user' ? (
              <div>
                <span style={{ color: accentBright }}>&gt; </span>
                <span style={{ color: textColor }}>{msg.content}</span>
              </div>
            ) : (
              <div className="ml-2 border-l-2 pl-3" style={{ borderColor: accentDim }}>
                <pre className="whitespace-pre-wrap text-sm" style={{ color: textLight }}>{msg.content}</pre>
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="ml-2 animate-pulse" style={{ color: accentColor }}>
            {agentMode ? 'SCANNING' : 'PROCESSING'}<span className="animate-ping">...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex items-center border-t pt-3" style={{ borderColor: accentDim }}>
        <span className="mr-2" style={{ color: accentBright }}>&gt;</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && address) sendMessage(input);
          }}
          placeholder={address ? (agentMode ? 'COMMAND AGENT NOUNIRL...' : 'ASK ABOUT NOUNS...') : 'CONNECT WALLET TO CHAT...'}
          className="flex-1 border-none bg-transparent text-sm outline-none"
          style={{
            color: textColor,
            caretColor: accentColor,
            textTransform: 'uppercase',
          }}
          disabled={isLoading || !address}
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={isLoading || !input.trim() || !address}
          className="ml-2 rounded border px-3 py-1 text-xs transition-colors disabled:opacity-30"
          style={{
            borderColor: accentDim,
            color: accentColor,
            background: 'transparent',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = accentMuted;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          SEND
        </button>
      </div>
    </div>
  );
};

export default TerminalPage;
