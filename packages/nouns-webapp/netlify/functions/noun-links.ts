import { connectLambda, getStore } from '@netlify/blobs';

interface NounLink {
  id: string;
  nounId: number;
  url: string;
  name?: string;
  ogImage?: string;
  ogTitle?: string;
  createdAt: string;
}

interface HandlerEvent {
  body: string | null;
  blobs?: string;
  headers?: Record<string, string>;
  httpMethod: string;
  rawUrl?: string;
}

interface HandlerResponse {
  body: string;
  headers: Record<string, string>;
  statusCode: number;
}

const STORE_NAME = 'noun-links';
const META_KEY = 'all-links';
const FALLBACK_URL = 'https://noun.wtf/.netlify/functions/noun-links';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── OG meta scraper ─────────────────────────────────────────────────────

async function scrapeOG(url: string): Promise<{ ogImage?: string; ogTitle?: string }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'noun-wtf-bot/1.0 (OG scraper)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return {};
    const html = await res.text();

    // Extract og:image
    const imageMatch =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);

    // Extract og:title (fallback to <title>)
    const titleMatch =
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i);

    return {
      ogImage: imageMatch?.[1] || undefined,
      ogTitle: titleMatch?.[1]?.trim() || undefined,
    };
  } catch {
    return {};
  }
}

// ── Handler ─────────────────────────────────────────────────────────────

async function handleRequest(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  const store = getStore(STORE_NAME);
  const url = new URL(req.url);

  // ── GET: list links for a noun ──────────────────────────────────────
  if (req.method === 'GET') {
    const nounId = url.searchParams.get('nounId');
    if (!nounId) return new Response(JSON.stringify([]), { headers });

    const raw = await store.get(META_KEY);
    if (!raw) return new Response(JSON.stringify([]), { headers });

    const all: NounLink[] = JSON.parse(raw);
    const filtered = all
      .filter(l => l.nounId === Number(nounId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return new Response(JSON.stringify(filtered), { headers });
  }

  // ── POST: add a link ────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = (await req.json()) as { nounId?: number; url?: string; name?: string };
    if (!body.nounId || !body.url) {
      return new Response(JSON.stringify({ error: 'nounId and url required' }), {
        status: 400,
        headers,
      });
    }

    // Validate URL
    try {
      new URL(body.url);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), { status: 400, headers });
    }
    const trimmedName = body.name?.trim();
    if (trimmedName && trimmedName.length > 60) {
      return new Response(JSON.stringify({ error: 'Name too long' }), { status: 400, headers });
    }

    // Scrape OG metadata
    const og = await scrapeOG(body.url);

    const link: NounLink = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      nounId: body.nounId,
      url: body.url,
      ...(trimmedName ? { name: trimmedName } : {}),
      ogImage: og.ogImage,
      ogTitle: og.ogTitle,
      createdAt: new Date().toISOString(),
    };

    const raw = await store.get(META_KEY);
    const all: NounLink[] = raw ? JSON.parse(raw) : [];
    all.unshift(link);
    await store.set(META_KEY, JSON.stringify(all));

    return new Response(JSON.stringify(link), { status: 201, headers });
  }

  // ── DELETE: remove a link ───────────────────────────────────────────
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id)
      return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers });

    const raw = await store.get(META_KEY);
    if (!raw) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });

    const all: NounLink[] = JSON.parse(raw);
    const filtered = all.filter(l => l.id !== id);
    if (filtered.length === all.length) {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
    }

    await store.set(META_KEY, JSON.stringify(filtered));
    return new Response(JSON.stringify({ ok: true }), { headers });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
}

export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  const method = event.httpMethod || 'GET';
  connectLambda({
    blobs: event.blobs ?? '',
    headers: event.headers ?? {},
  });
  const request = new Request(event.rawUrl ?? FALLBACK_URL, {
    method,
    ...(method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
      ? {}
      : {
          body: event.body ?? undefined,
          headers: { 'Content-Type': 'application/json' },
        }),
  });

  const response = await handleRequest(request);
  return {
    body: await response.text(),
    headers: Object.fromEntries(response.headers.entries()),
    statusCode: response.status,
  };
}
