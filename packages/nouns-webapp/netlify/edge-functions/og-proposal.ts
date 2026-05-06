import type { Context } from 'https://edge.netlify.com';

/**
 * Inject Open Graph meta tags into the SPA's index.html for proposal-style
 * pages so Slack/Twitter/Farcaster/iMessage unfurls show the first image
 * embedded in the proposal body instead of a generic fallback.
 *
 * Why an edge function? noun.wtf is a Vite SPA — index.html is identical for
 * every route, and crawlers don't run JS, so they'd otherwise see no og:image
 * at all. The edge layer is the smallest server-side patch we can make: it
 * runs before the response is sent, fetches the proposal description from the
 * already-deployed Ponder API, extracts the first markdown image, and
 * splices the meta tags into the existing <head>.
 *
 * Path matches: declared inline via `export const config` (Netlify discovers
 * them at deploy time) — `/vote/:id`, `/candidates/:id`.
 *
 * Falls back to https://noun.wtf/untitled2026.gif when:
 *   - the proposal/candidate isn't found,
 *   - the body has no image,
 *   - or the API request fails for any reason.
 *
 * The crawler timeout is short (3.5s) so a slow upstream never bricks the
 * unfurl response — we serve the un-augmented HTML in that case.
 */

const PONDER_API = 'https://spirited-flexibility-production-3c30.up.railway.app';
const FALLBACK_OG_IMAGE = 'https://noun.wtf/untitled2026.gif';
const SITE_URL = 'https://noun.wtf';
const FETCH_TIMEOUT_MS = 3500;

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

/**
 * Pull the first image URL out of a markdown/HTML proposal body. Handles both
 * markdown image syntax (`![alt](url)`) and inline HTML `<img src="...">`.
 * Mirrors the regex used by the Ponder API's existing `/api/og/proposal/:id`
 * ASCII generator so behaviour stays consistent across surfaces.
 */
function extractFirstImage(description: string): string | null {
  if (description.length === 0) return null;
  const match = description.match(
    /!\[[^\]]*]\((https?:\/\/[^\s)]+)\)|<img[^>]+src=["'](https?:\/\/[^"']+)["']/i,
  );
  if (match === null) return null;
  return match[1] ?? match[2] ?? null;
}

/**
 * Pull the first non-empty markdown line as a proposal title. Matches the
 * Ponder API's behaviour — strips leading `# ` from H1 headings and caps the
 * length so og:title doesn't blow past Twitter's 70-char preview budget.
 */
function extractTitle(description: string, fallback: string): string {
  const firstLine = description.split('\n').find(l => l.trim().length > 0) ?? fallback;
  return firstLine
    .replace(/^#+\s*/, '')
    .replace(/[*_`]+/g, '')
    .trim()
    .slice(0, 80);
}

/**
 * Pull a short description excerpt — strip markdown decorations and image
 * tags so unfurls show actual prose, not raw image URLs. Capped at ~200
 * chars so the og:description stays under the platform truncation point.
 */
function extractExcerpt(description: string): string {
  const cleaned = description
    // strip markdown images entirely
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    // strip inline HTML images
    .replace(/<img[^>]+>/gi, '')
    // collapse markdown links to their label
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    // strip remaining markdown decorations
    .replace(/[#*>_`]/g, '')
    // collapse whitespace
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
      headers: { 'User-Agent': 'noun-wtf-edge/1.0 (OG)' },
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
  // Candidate REST endpoint may not exist yet — fall through to fallback if
  // the API 404s. We keep the call cheap so the unfurl path stays fast.
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
 * The handler signature here is the Netlify edge runtime contract: receives
 * the original Request plus a Context carrying `next()` (continue the chain
 * to the static asset / SPA fallback). We always call next() first so we get
 * the real index.html back, then mutate the body before returning.
 */
export default async function handler(request: Request, context: Context) {
  const url = new URL(request.url);

  // Only mutate HTML responses for navigation requests. Asset requests slip
  // straight through.
  const accept = request.headers.get('accept') ?? '';
  const isHtmlRequest =
    accept.includes('text/html') || accept.length === 0 || accept.includes('*/*');
  if (!isHtmlRequest) {
    return context.next();
  }

  // Match `/vote/:id` and `/candidates/:id`. Reject deeper sub-paths
  // (`/vote/:id/edit`, `/vote/:id/history/...`) — those are not the canonical
  // share URLs and we don't want to delay their TTFB unnecessarily.
  const voteMatch = url.pathname.match(/^\/vote\/([^/]+)\/?$/);
  const candidateMatch = url.pathname.match(/^\/candidates\/([^/]+)\/?$/);

  if (voteMatch === null && candidateMatch === null) {
    return context.next();
  }

  // Fetch the underlying SPA shell (index.html) and the proposal payload in
  // parallel — the edge runtime runs in low-latency PoPs so this round-trip
  // is cheap, and we save ~150ms by not serializing the API call after the
  // origin response.
  const upstreamPromise = context.next();

  const dataPromise: Promise<{ description: string; title: string } | null> = (async () => {
    if (voteMatch !== null) {
      const proposal = await fetchProposal(voteMatch[1]);
      if (proposal === null) return null;
      return {
        description: proposal.description ?? '',
        title: `Prop ${proposal.id ?? voteMatch[1]}`,
      };
    }
    if (candidateMatch !== null) {
      const candidate = await fetchCandidate(candidateMatch[1]);
      if (candidate === null) return null;
      const slug = candidate.slug ?? '';
      return {
        description: candidate.description ?? '',
        title: slug.length > 0 ? `Candidate · ${slug}` : 'Proposal Candidate',
      };
    }
    return null;
  })();

  const [upstreamRaw, data] = await Promise.all([upstreamPromise, dataPromise]);
  const upstream = upstreamRaw as Response;

  // Only mutate successful HTML responses — pass through redirects, errors,
  // anything that isn't text/html.
  const contentType = upstream.headers.get('content-type') ?? '';
  if (upstream.ok !== true || !contentType.includes('text/html')) {
    return upstream;
  }

  const html = await upstream.text();

  // Build the meta payload. Even when the data fetch failed we still inject
  // a generic og:image so the unfurl card looks intentional rather than blank.
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
    url: `${SITE_URL}${url.pathname}`,
  });

  // Splice meta tags right before </head>. If for any reason </head> is
  // missing (manual HTML edits, build glitch), bail and serve the original
  // response so we never break the page.
  const headCloseIdx = html.lastIndexOf('</head>');
  if (headCloseIdx === -1) {
    return new Response(html, {
      headers: upstream.headers,
      status: upstream.status,
    });
  }

  const mutated = html.slice(0, headCloseIdx) + `\n    ${metaTags}\n  ` + html.slice(headCloseIdx);

  // Preserve original headers (CSP, etc.) but force a fresh content-length
  // by letting the runtime recompute it.
  const newHeaders = new Headers(upstream.headers);
  newHeaders.delete('content-length');
  newHeaders.set('cache-control', 'public, max-age=60, s-maxage=300');

  return new Response(mutated, {
    headers: newHeaders,
    status: upstream.status,
  });
}

export const config = {
  path: ['/vote/:id', '/candidates/:id'],
};
