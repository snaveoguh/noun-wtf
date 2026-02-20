import Anthropic from '@anthropic-ai/sdk';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { graphql } from 'ponder';
import { db } from 'ponder:api';
import schema from 'ponder:schema';

const app = new Hono();

// CORS — allow noun.wtf and localhost
app.use('*', cors({
  origin: ['https://noun.wtf', 'http://localhost:5173', 'http://localhost:3000'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Accept'],
}));

// ============================================================
// GraphQL (Ponder)
// ============================================================
app.use('/', graphql({ db, schema }));
app.use('/graphql', graphql({ db, schema }));

// ============================================================
// Terminal — Claude AI chat for Nouns governance
// ============================================================

const NOUNS_SYSTEM_PROMPT = `You are a helpful AI assistant embedded in noun.wtf, a Nouns DAO governance hub. You help users navigate Nouns governance, understand proposals, auctions, and the DAO.

Key facts about Nouns:
- Nouns is a generative NFT project where one Noun is auctioned every 24 hours, forever.
- 100% of auction proceeds go to the Nouns DAO treasury.
- Each Noun = 1 vote in governance. Nouns can be delegated.
- Proposals require a minimum number of votes to be submitted (proposal threshold).
- Voting period is typically 5 days. Proposals need quorum to pass.
- The treasury is managed onchain — funds are released via successful proposals.
- Nouns have pixel art traits: background, body, accessory, head, and glasses (noggles).
- noun.wtf uses client ID 37 for DAO client incentive rewards.

Keep responses concise, helpful, and focused on Nouns. Use uppercase style when appropriate since noun.wtf uses a fun Comic Sans uppercase aesthetic. If you don't know something specific, say so rather than making it up.`;

// Simple in-memory rate limiter
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10; // messages per minute
const RATE_WINDOW = 60_000; // 1 minute

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

app.post('/api/chat', async (c) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'Terminal not configured (missing API key)' }, 503);
  }

  try {
    const body = await c.req.json();
    const { message, wallet, history } = body as {
      message: string;
      wallet?: string;
      history?: Array<{ role: string; content: string }>;
    };

    if (!message || typeof message !== 'string') {
      return c.json({ error: 'Message is required' }, 400);
    }

    if (message.length > 2000) {
      return c.json({ error: 'Message too long (max 2000 chars)' }, 400);
    }

    // Rate limit by wallet or IP
    const rateLimitKey = wallet || c.req.header('x-forwarded-for') || 'anonymous';
    if (!checkRateLimit(rateLimitKey)) {
      return c.json({ error: 'Rate limited. Max 10 messages per minute.' }, 429);
    }

    const anthropic = new Anthropic({ apiKey });

    // Build messages array from history
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (history && Array.isArray(history)) {
      for (const msg of history.slice(-10)) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    }
    messages.push({ role: 'user', content: message });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: NOUNS_SYSTEM_PROMPT,
      messages,
    });

    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    return c.json({ response: text });
  } catch (err) {
    console.error('Terminal chat error:', err);
    return c.json({ error: 'AI request failed' }, 500);
  }
});

// ============================================================
// Feed — Neynar Farcaster proxy for /nouns and /noc channels
// ============================================================

const ALLOWED_CHANNELS = ['nouns', 'noc'];
const feedCaches = new Map<string, { data: unknown; fetchedAt: number }>();
const FEED_CACHE_TTL = 60_000; // 60 seconds

app.get('/api/feed/:channel', async (c) => {
  const channel = c.req.param('channel');

  if (!ALLOWED_CHANNELS.includes(channel)) {
    return c.json({ error: `Unknown channel: ${channel}. Allowed: ${ALLOWED_CHANNELS.join(', ')}` }, 400);
  }

  const neynarKey = process.env.NEYNAR_API_KEY;
  if (!neynarKey) {
    return c.json({ error: 'Feed not configured (missing Neynar key)' }, 503);
  }

  // Return cached if fresh
  const cached = feedCaches.get(channel);
  if (cached && Date.now() - cached.fetchedAt < FEED_CACHE_TTL) {
    return c.json(cached.data);
  }

  try {
    const url = `https://api.neynar.com/v2/farcaster/feed/?feed_type=filter&filter_type=channel_id&channel_id=${channel}&limit=25`;
    const res = await fetch(url, {
      headers: {
        'x-api-key': neynarKey,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Neynar API error (/${channel}):`, res.status, errText);
      return c.json({ error: `Neynar API error: ${res.status}` }, 502);
    }

    const data = await res.json();
    feedCaches.set(channel, { data, fetchedAt: Date.now() });
    return c.json(data);
  } catch (err) {
    console.error(`Feed fetch error (/${channel}):`, err);
    return c.json({ error: 'Failed to fetch feed' }, 500);
  }
});

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() });
});

export default app;
