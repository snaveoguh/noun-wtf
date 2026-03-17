// ─── Agent NounIRL — Knowledge Ingestion ──────────────────────────────────────
//
// Fetches URLs, extracts text, uses Claude to distill key facts,
// stores them in persistent memory. Both homepage chat and NounIRL
// terminal share the same knowledge base via the "knowledge" scope.

import { hubGenerate } from './hubClient.js';
import { remember, recall, countByScope } from './memory.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface LearnResult {
  url: string;
  factsLearned: number;
  facts: string[];
  error?: string;
}

export interface KnowledgeStats {
  totalFacts: number;
  sources: string[];
}

// ─── Text Extraction ────────────────────────────────────────────────────────

/**
 * Fetch a URL and extract readable text content.
 * Strips HTML tags, scripts, styles, and collapses whitespace.
 */
async function fetchAndExtract(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'NounIRL-Knowledge-Agent/1.0 (noun.wtf)',
      Accept: 'text/html,application/xhtml+xml,text/plain,application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);

  const contentType = res.headers.get('content-type') || '';
  const raw = await res.text();

  // JSON — just stringify nicely
  if (contentType.includes('application/json')) {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2).slice(0, 50_000);
    } catch {
      return raw.slice(0, 50_000);
    }
  }

  // HTML — strip tags and extract text
  let text = raw
    // Remove scripts, styles, SVG, noscript
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    // Remove all HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();

  // Truncate to ~50k chars (Claude context limit consideration)
  if (text.length > 50_000) {
    text = text.slice(0, 50_000) + '\n[...truncated]';
  }

  return text;
}

// ─── Fact Extraction via Claude ──────────────────────────────────────────────

const EXTRACT_PROMPT = `You are a knowledge extraction system for an AI agent embedded in noun.wtf (a Nouns DAO governance hub).

Your job: Read the provided text from a web page and extract the most important, specific, factual statements. These facts will be stored in the agent's persistent memory and used to answer user questions about Nouns, Ethereum, governance, and the broader ecosystem.

RULES:
1. Extract 5-20 key facts depending on content density
2. Each fact should be a single, self-contained sentence
3. Focus on: specific numbers, dates, names, mechanisms, rules, addresses, relationships
4. Skip: generic marketing copy, navigation text, boilerplate, opinions
5. Include the SOURCE URL context so the agent knows where this came from
6. If the page is about Nouns specifically, extract MORE detail (trait counts, treasury amounts, proposal mechanics, etc.)
7. If the page has no useful factual content, return an empty array

Output format: JSON array of strings. Each string is one fact.
Example: ["Nouns DAO treasury holds over 28,000 ETH as of March 2026", "Each Noun has 5 traits: background, body, accessory, head, glasses"]

Output ONLY the JSON array, no markdown fences, no explanation.`;

export async function extractFacts(text: string, url: string): Promise<string[]> {
  const output = await hubGenerate({
    system: EXTRACT_PROMPT,
    user: `URL: ${url}\n\nPage content:\n${text}`,
    task: 'factExtraction',
    maxTokens: 2048,
    temperature: 0,
  });

  try {
    const facts = JSON.parse(output);
    if (!Array.isArray(facts)) return [];
    return facts.filter((f: unknown) => typeof f === 'string' && f.length > 10);
  } catch {
    console.error('[Knowledge] Failed to parse facts JSON:', output.slice(0, 200));
    return [];
  }
}

// ─── Learn from URL ──────────────────────────────────────────────────────────

/**
 * Fetch a URL, extract facts, and store them in persistent memory.
 * Returns the number of facts learned.
 */
export async function learnFromUrl(url: string): Promise<LearnResult> {
  try {
    console.log(`[Knowledge] Learning from: ${url}`);

    // 1. Fetch and extract text
    const text = await fetchAndExtract(url);
    if (text.length < 50) {
      return { url, factsLearned: 0, facts: [], error: 'Page has no useful content' };
    }

    // 2. Extract facts via Claude
    const facts = await extractFacts(text, url);
    if (facts.length === 0) {
      return { url, factsLearned: 0, facts: [], error: 'No extractable facts found' };
    }

    // 3. Store each fact in memory under "knowledge" scope
    const domain = new URL(url).hostname.replace('www.', '');
    const slug = url
      .replace(/https?:\/\//, '')
      .replace(/[^a-zA-Z0-9]/g, '-')
      .slice(0, 60);

    for (let i = 0; i < facts.length; i++) {
      const key = `${slug}-${i}`;
      await remember('knowledge', key, facts[i]!);
    }

    // Also store a source record
    await remember('knowledge-sources', domain, `Learned ${facts.length} facts from ${url} on ${new Date().toISOString().split('T')[0]}`);

    console.log(`[Knowledge] Learned ${facts.length} facts from ${url}`);
    return { url, factsLearned: facts.length, facts };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Knowledge] Error learning from ${url}:`, msg);
    return { url, factsLearned: 0, facts: [], error: msg };
  }
}

// ─── Batch Learn ─────────────────────────────────────────────────────────────

/**
 * Learn from multiple URLs sequentially.
 * Returns results for each URL.
 */
export async function batchLearn(urls: string[]): Promise<LearnResult[]> {
  const results: LearnResult[] = [];
  for (const url of urls) {
    const result = await learnFromUrl(url);
    results.push(result);
    // Small delay between requests to be polite
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return results;
}

// ─── Knowledge Stats ─────────────────────────────────────────────────────────

export async function getKnowledgeStats(): Promise<KnowledgeStats> {
  const totalFacts = await countByScope('knowledge');
  const sourcesMem = await recall('knowledge-sources');

  return {
    totalFacts,
    sources: sourcesMem.map(m => m.content),
  };
}

// ─── Build Knowledge Context ────────────────────────────────────────────────

/**
 * Build a knowledge context string to inject into system prompts.
 * Returns the most relevant learned facts (up to a token budget).
 */
export async function buildKnowledgeContext(maxFacts = 40): Promise<string> {
  const facts = await recall('knowledge');
  if (facts.length === 0) return '';

  const parts: string[] = ['LEARNED KNOWLEDGE (from ingested sources):'];
  for (const f of facts.slice(0, maxFacts)) {
    parts.push(`• ${f.content}`);
  }

  return '\n\n' + parts.join('\n');
}
