import { useCallback, useEffect, useRef, useState } from 'react';

import { useAccount } from 'wagmi';

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

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

const TerminalPage: React.FC = () => {
  const { address } = useAccount();
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: TERMINAL_GREETING, timestamp: Date.now() },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
    [address, isLoading, messages],
  );

  return (
    <div className="flex min-h-[calc(100vh-80px)] flex-col bg-black p-4 font-mono">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between border-b border-green-800 pb-2">
        <span className="text-sm text-green-500">
          NOUN.WTF TERMINAL {address ? `| ${address.slice(0, 6)}...${address.slice(-4)}` : '| NOT CONNECTED'}
        </span>
        <span className="text-xs text-green-700">
          {messages.filter(m => m.role === 'user').length} QUERIES
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto pb-4" style={{ maxHeight: 'calc(100vh - 200px)' }}>
        {messages.map((msg, i) => (
          <div key={i} className="mb-3">
            {msg.role === 'system' ? (
              <pre className="whitespace-pre-wrap text-xs text-green-600 sm:text-sm">{msg.content}</pre>
            ) : msg.role === 'user' ? (
              <div>
                <span className="text-green-400">&gt; </span>
                <span className="text-green-300">{msg.content}</span>
              </div>
            ) : (
              <div className="ml-2 border-l-2 border-green-800 pl-3">
                <pre className="whitespace-pre-wrap text-sm text-green-200">{msg.content}</pre>
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="ml-2 animate-pulse text-green-500">
            PROCESSING<span className="animate-ping">...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex items-center border-t border-green-800 pt-3">
        <span className="mr-2 text-green-400">&gt;</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') sendMessage(input);
          }}
          placeholder="ASK ABOUT NOUNS..."
          className="flex-1 border-none bg-transparent text-sm text-green-300 caret-green-400 outline-none placeholder:text-green-800"
          disabled={isLoading}
          style={{ textTransform: 'uppercase' }}
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={isLoading || !input.trim()}
          className="ml-2 rounded border border-green-700 px-3 py-1 text-xs text-green-500 transition-colors hover:bg-green-900 disabled:opacity-30"
        >
          SEND
        </button>
      </div>
    </div>
  );
};

export default TerminalPage;
