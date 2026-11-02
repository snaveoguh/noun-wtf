import Anthropic from '@anthropic-ai/sdk';

import {
  LLM_SYSTEM,
  llmPrompt,
  parseAsk,
  parseLlmLines,
} from '../../src/miniapps/world2/taxi/chatter/llm';

// NOUN TAXI chatter, LLM edition (optional, off by default).
//
// POST { role, persona, name, dest, tod, places, recent } → { lines: string[] }
// Answers only when TAXI_LLM=1 and both ANTHROPIC_API_KEY and TAXI_LLM_MODEL
// are set; otherwise 404 { off: true } and the client stops asking for the
// session (it falls back to its own grammar generator, which is the normal
// path). The key stays here. A best-effort per-instance limit of 40 batches
// an hour per client IP keeps a script from running up the bill; the client
// cleans every line again before saying it.

const LIMIT = 40;
const hits = new Map<string, number[]>();

function limited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter(t => now - t < 3_600_000);
  if (list.length >= LIMIT) return true;
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export default async (req: Request): Promise<Response> => {
  const key = process.env.ANTHROPIC_API_KEY;
  const model = process.env.TAXI_LLM_MODEL;
  if (process.env.TAXI_LLM !== '1' || !key || !model) return json(404, { off: true });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const ip =
    req.headers.get('x-nf-client-connection-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0] ??
    'anon';
  if (limited(ip)) return json(429, { error: 'slow down' });
  let ask;
  try {
    ask = parseAsk(await req.json());
  } catch {
    ask = null;
  }
  if (ask === null) return json(400, { error: 'bad request' });
  try {
    const client = new Anthropic({ apiKey: key, timeout: 20_000, maxRetries: 1 });
    const res = await client.messages.create({
      model,
      max_tokens: 1200,
      system: LLM_SYSTEM,
      messages: [{ role: 'user', content: llmPrompt(ask) }],
    });
    if (res.stop_reason === 'refusal') return json(200, { lines: [] });
    const text = res.content.map(b => (b.type === 'text' ? b.text : '')).join('');
    return json(200, { lines: parseLlmLines(text).slice(0, 8) });
  } catch {
    return json(502, { error: 'llm failed' });
  }
};
