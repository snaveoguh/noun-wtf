/**
 * Server-rendered HTML for /vote/:id and /candidates/:id share unfurls.
 *
 * Crawlers (Slack, Twitter, Farcaster, iMessage, Discord) don't run JS,
 * so the SPA's index.html — which has no og:image — gives them nothing
 * to show. This function returns the same index.html shell with og:image,
 * og:title, og:description, and Twitter Card meta tags injected based on
 * the actual proposal/candidate description fetched from the Ponder API.
 *
 * Routing is via _redirects:
 *   /vote/*       /.netlify/functions/og-proposal  200! (User-Agent crawler)
 *   /candidates/* /.netlify/functions/og-proposal  200! (User-Agent crawler)
 *
 * Falls back to the existing site image (untitled2026.gif) when the
 * proposal has no body image or the upstream API errors.
 *
 * Why a regular function instead of an edge function: the Netlify CLI
 * has a long-standing bug where `netlify deploy --no-build --filter`
 * silently drops bundled edge functions from the deploy archive (the
 * `edge_functions_present` API field comes back null even with successful
 * bundling). Regular functions ship reliably from the same workflow.
 */

interface HandlerEvent {
  path: string;
  headers?: Record<string, string>;
  rawUrl?: string;
}

interface HandlerResponse {
  body: string;
  headers: Record<string, string>;
  statusCode: number;
}

const PONDER_API = 'https://spirited-flexibility-production-3c30.up.railway.app';
const FALLBACK_OG_IMAGE = 'https://noun.wtf/untitled2026.gif';
const SITE_URL = 'https://noun.wtf';
const FETCH_TIMEOUT_MS = 4000;

interface ProposalShape {
  id?: string;
  description?: string;
  title?: string;
  proposer?: string;
}

interface CandidateShape {
  id?: string;
  slug?: string;
  description?: string;
  proposer?: string;
}

function extractFirstImage(description: string): string | null {
  if (description.length === 0) return null;
  const match = description.match(
    /!\[[^\]]*]\((https?:\/\/[^\s)]+)\)|<img[^>]+src=["'](https?:\/\/[^"']+)["']/i,
  );
  if (match === null) return null;
  return match[1] ?? match[2] ?? null;
}

function extractTitle(description: string, fallback: string): string {
  const firstLine = description.split('\n').find(l => l.trim().length > 0) ?? fallback;
  return firstLine
    .replace(/^#+\s*/, '')
    .replace(/[*_`]+/g, '')
    .trim()
    .slice(0, 80);
}

function extractExcerpt(description: string): string {
  const cleaned = description
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/<img[^>]+>/gi, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[#*>_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 200);
}

function escapeAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function fetchWithTimeout(url: string): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'noun-wtf-fn/1.0 (OG)' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res;
  } catch {
    return null;
  }
}

async function fetchProposal(id: string): Promise<ProposalShape | null> {
  const res = await fetchWithTimeout(`${PONDER_API}/api/proposals/${encodeURIComponent(id)}`);
  if (res === null || !res.ok) return null;
  try {
    const json = (await res.json()) as { proposal?: ProposalShape } | ProposalShape;
    if (
      json !== null &&
      typeof json === 'object' &&
      'proposal' in json &&
      json.proposal !== undefined
    ) {
      return json.proposal;
    }
    return json as ProposalShape;
  } catch {
    return null;
  }
}

async function fetchCandidate(id: string): Promise<CandidateShape | null> {
  const res = await fetchWithTimeout(`${PONDER_API}/api/candidates/${encodeURIComponent(id)}`);
  if (res === null || !res.ok) return null;
  try {
    const json = (await res.json()) as { candidate?: CandidateShape } | CandidateShape;
    if (
      json !== null &&
      typeof json === 'object' &&
      'candidate' in json &&
      json.candidate !== undefined
    ) {
      return json.candidate;
    }
    return json as CandidateShape;
  } catch {
    return null;
  }
}

interface OgMeta {
  title: string;
  description: string;
  image: string;
  url: string;
}

function buildMetaTags(meta: OgMeta): string {
  const t = escapeAttr(meta.title);
  const d = escapeAttr(meta.description);
  const i = escapeAttr(meta.image);
  const u = escapeAttr(meta.url);
  return [
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="noun.wtf" />`,
    `<meta property="og:url" content="${u}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:image" content="${i}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${i}" />`,
  ].join('\n    ');
}

/**
 * Fetch the SPA's index.html so we serve the same shell crawlers would
 * normally see — they get the full markup plus our injected meta tags.
 * This keeps the page renderable in browsers too (the function is invoked
 * via _redirects rule that matches all UAs, not just bots).
 */
async function fetchIndexHtml(): Promise<string | null> {
  const res = await fetchWithTimeout(`${SITE_URL}/index.html`);
  if (res === null || !res.ok) return null;
  try {
    return await res.text();
  } catch {
    return null;
  }
}

interface RouteData {
  description: string;
  title: string;
  url: string;
}

async function resolveRouteData(path: string): Promise<RouteData | null> {
  const voteMatch = path.match(/^\/vote\/([^#/?]+)/);
  if (voteMatch !== null) {
    const proposal = await fetchProposal(voteMatch[1]);
    if (proposal === null) return null;
    return {
      description: proposal.description ?? '',
      title: `Prop ${proposal.id ?? voteMatch[1]}`,
      url: `${SITE_URL}/vote/${voteMatch[1]}`,
    };
  }
  const candidateMatch = path.match(/^\/candidates\/([^#/?]+)/);
  if (candidateMatch !== null) {
    const candidate = await fetchCandidate(candidateMatch[1]);
    if (candidate === null) return null;
    const slug = candidate.slug ?? '';
    return {
      description: candidate.description ?? '',
      title: slug.length > 0 ? `Candidate · ${slug}` : 'Proposal Candidate',
      url: `${SITE_URL}/candidates/${candidateMatch[1]}`,
    };
  }
  return null;
}

export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  // Netlify functions receive the original path even when invoked via
  // _redirects rewrite — `event.path` is the inbound URL path.
  const inboundPath = event.path || '/';

  const [html, data] = await Promise.all([fetchIndexHtml(), resolveRouteData(inboundPath)]);

  // Couldn't fetch the SPA shell — fall back to a tiny standalone HTML
  // doc so crawlers at least get something with proper meta tags.
  if (html === null) {
    const fallbackTitle = 'Nouns DAO';
    const fallbackDesc = 'One Noun, every day, forever.';
    const meta = buildMetaTags({
      title: fallbackTitle,
      description: fallbackDesc,
      image: FALLBACK_OG_IMAGE,
      url: `${SITE_URL}${inboundPath}`,
    });
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html; charset=UTF-8',
        'Cache-Control': 'public, max-age=60, s-maxage=300',
      },
      body: `<!DOCTYPE html><html><head>${meta}<title>${escapeAttr(fallbackTitle)}</title></head><body></body></html>`,
    };
  }

  let title = 'Nouns DAO';
  let description = 'One Noun, every day, forever.';
  let image = FALLBACK_OG_IMAGE;

  if (data !== null) {
    const firstImage = extractFirstImage(data.description);
    const extractedTitle = extractTitle(data.description, data.title);
    title = extractedTitle.length > 0 ? extractedTitle : data.title;
    const excerpt = extractExcerpt(data.description);
    if (excerpt.length > 0) description = excerpt;
    if (firstImage !== null) image = firstImage;
  }

  const metaTags = buildMetaTags({
    title,
    description,
    image,
    url: data?.url ?? `${SITE_URL}${inboundPath}`,
  });

  // Splice meta tags right before </head>. If for any reason </head>
  // isn't found, append the meta tags at the end so the document is
  // still valid even if our injection point moved.
  const headCloseIdx = html.lastIndexOf('</head>');
  const mutated =
    headCloseIdx === -1
      ? html + metaTags
      : html.slice(0, headCloseIdx) + `\n    ${metaTags}\n  ` + html.slice(headCloseIdx);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300',
    },
    body: mutated,
  };
}
