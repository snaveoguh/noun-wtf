/**
 * Server-rendered HTML for /vote/:id, /candidates/:id and /noun/:id
 * (+ /v2/noun/:id) share unfurls. A Noun's card image is drawn by
 * og-noun-image.
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

import { miniAppEmbed, worldShareMeta } from '../../src/miniapps/world2/share/playLink';

interface HandlerEvent {
  path: string;
  headers?: Record<string, string>;
  rawUrl?: string;
  queryStringParameters?: Record<string, string | undefined> | null;
}

/**
 * Lil Nouns proposals share the /vote/:id route with Nouns DAO and are told
 * apart only by `?dao=lil` (see VotePageRouter). Without this, a Lil prop
 * link unfurled as the Nouns DAO prop with the same number.
 */
function queryParam(event: HandlerEvent, key: string): string | undefined {
  let v = event.queryStringParameters?.[key];
  if (v === undefined && event.rawUrl !== undefined) {
    try {
      v = new URL(event.rawUrl).searchParams.get(key) ?? undefined;
    } catch {
      // Malformed rawUrl: no such param.
    }
  }
  return v;
}

function isLilNounsRequest(event: HandlerEvent): boolean {
  const dao = queryParam(event, 'dao');
  const v = (dao ?? '').toLowerCase();
  return v === 'lil' || v === 'lilnouns' || v === 'lil-nouns';
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

async function fetchLilProposal(id: string): Promise<ProposalShape | null> {
  const res = await fetchWithTimeout(`${PONDER_API}/api/lil-proposals/${encodeURIComponent(id)}`);
  if (res === null || !res.ok) return null;
  try {
    return (await res.json()) as ProposalShape;
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
  /** Extra tags (the Farcaster mini app embed on /world). */
  extra?: string[];
}

function buildMetaTags(meta: OgMeta): string {
  const t = escapeAttr(meta.title);
  const d = escapeAttr(meta.description);
  const i = escapeAttr(meta.image);
  const u = escapeAttr(meta.url);
  return [
    ...(meta.extra ?? []),
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
async function fetchIndexHtml(origin = SITE_URL): Promise<string | null> {
  const res = await fetchWithTimeout(`${origin}/index.html`);
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
  /** A ready-made card image (a Noun's page); else the description's first image. */
  image?: string;
  extra?: string[];
}

/**
 * The Farcaster mini app embed for a /world link: `fc:miniapp`, plus
 * `fc:frame` (type launch_frame) for clients that only know the old name.
 */
export function miniAppTags(imageUrl: string, url: string, button: string): string[] {
  return [
    `<meta name="fc:miniapp" content="${escapeAttr(JSON.stringify(miniAppEmbed({ imageUrl, url, button })))}" />`,
    `<meta name="fc:frame" content="${escapeAttr(JSON.stringify(miniAppEmbed({ imageUrl, url, button }, true)))}" />`,
  ];
}

/**
 * Who may frame /world: Farcaster's web clients open a mini app in an
 * iframe. Every other page keeps `frame-ancestors 'self'` (public/_headers).
 */
export const WORLD_FRAME_ANCESTORS =
  "frame-ancestors 'self' https://farcaster.xyz https://*.farcaster.xyz https://warpcast.com https://*.warpcast.com";

/** The site the request came to (dev, deploy previews), else noun.wtf. */
function requestOrigin(event: HandlerEvent): string {
  if (event.rawUrl === undefined) return SITE_URL;
  try {
    const u = new URL(event.rawUrl);
    if (u.hostname === 'noun.wtf' || u.hostname.endsWith('.netlify.app')) return u.origin;
  } catch {
    // fall through
  }
  return SITE_URL;
}

async function resolveRouteData(
  path: string,
  isLil: boolean,
  event: HandlerEvent = { path },
): Promise<RouteData | null> {
  // Noun World: a play-as link (?seed=) unfurls as that rider, plain /world as the game
  if (/^\/world\/?$/.test(path)) {
    const m = worldShareMeta({ seed: queryParam(event, 'seed'), name: queryParam(event, 'name') });
    return {
      description: m.description,
      title: m.title,
      url: m.url,
      image: m.image,
      extra: miniAppTags(m.fcImage, m.url, m.button),
    };
  }
  // A Noun's page unfurls as that Noun, big (og-noun-image draws it)
  const nounMatch = path.match(/^\/(v2\/)?noun\/(\d{1,6})\/?$/);
  if (nounMatch !== null) {
    const v2 = nounMatch[1] !== undefined;
    const id = nounMatch[2]!;
    return {
      description: v2
        ? `NounV2 ${id} on noun.wtf.`
        : `Noun ${id} on noun.wtf. One Noun, every day, forever.`,
      title: v2 ? `NounV2 ${id}` : `Noun ${id}`,
      url: `${SITE_URL}/${v2 ? 'v2/' : ''}noun/${id}`,
      image: `${SITE_URL}/og/${v2 ? 'v2/' : ''}noun/${id}.png`,
    };
  }
  const voteMatch = path.match(/^\/vote\/([^#/?]+)/);
  if (voteMatch !== null && isLil) {
    const proposal = await fetchLilProposal(voteMatch[1]);
    if (proposal === null) return null;
    return {
      description: proposal.description ?? '',
      title: proposal.title ?? `Lil Nouns Prop ${proposal.id ?? voteMatch[1]}`,
      url: `${SITE_URL}/vote/${voteMatch[1]}?dao=lil`,
    };
  }
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
  const isLil = isLilNounsRequest(event);
  const siteName = isLil ? 'Lil Nouns DAO' : 'Nouns DAO';
  const siteTagline = isLil
    ? 'A Lil Nouns DAO proposal on noun.wtf'
    : 'One Noun, every day, forever.';
  // Nouns and Lil props share a path, so the CDN must key the cache on ?dao.
  const isWorld = /^\/world\/?$/.test(inboundPath);
  const cacheHeaders: Record<string, string> = {
    'Cache-Control': 'public, max-age=60, s-maxage=300',
    // Nouns and Lil props share a path; a play-as link is keyed by its rider
    'Netlify-Vary': isWorld ? 'query=seed|name' : 'query=dao',
    ...(isWorld
      ? { 'Content-Security-Policy': `upgrade-insecure-requests; ${WORLD_FRAME_ANCESTORS}` }
      : {}),
  };

  const [html, data] = await Promise.all([
    fetchIndexHtml(requestOrigin(event)),
    resolveRouteData(inboundPath, isLil, event),
  ]);

  // Couldn't fetch the SPA shell — fall back to a tiny standalone HTML
  // doc so crawlers at least get something with proper meta tags.
  if (html === null) {
    const fallbackTitle = siteName;
    const fallbackDesc = siteTagline;
    const meta = buildMetaTags({
      title: data?.image !== undefined ? data.title : fallbackTitle,
      description: data?.image !== undefined ? data.description : fallbackDesc,
      image: data?.image ?? FALLBACK_OG_IMAGE,
      url: data?.url ?? `${SITE_URL}${inboundPath}`,
      extra: data?.extra,
    });
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html; charset=UTF-8',
        ...cacheHeaders,
      },
      // /world is the game itself, not just a card: try the real page again shortly
      body: `<!DOCTYPE html><html><head>${meta}${isWorld ? '<meta http-equiv="refresh" content="3" />' : ''}<title>${escapeAttr(fallbackTitle)}</title></head><body></body></html>`,
    };
  }

  let title = siteName;
  let description = siteTagline;
  let image = FALLBACK_OG_IMAGE;

  if (data !== null && data.image !== undefined) {
    title = data.title;
    description = data.description;
    image = data.image;
  } else if (data !== null) {
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
    extra: data?.extra,
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
      ...cacheHeaders,
    },
    body: mutated,
  };
}
