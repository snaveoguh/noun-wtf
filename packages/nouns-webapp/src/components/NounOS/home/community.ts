// Community submissions: anyone can suggest a game / page / tool for the
// homescreen's Community row. Shared by the browser (form + rendering) and
// the `community-submissions` Netlify function, so both apply the same
// rules. Nothing submitted is ever rendered as anything but plain text and
// a plain external link.

export const SUBMISSIONS_URL = '/.netlify/functions/community-submissions';

export const SUBMISSION_KINDS = ['game', 'page', 'tool', 'art', 'client'] as const;
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];

export const KIND_LABEL: Record<SubmissionKind, string> = {
  game: 'GAME',
  page: 'PAGE',
  tool: 'TOOL',
  art: 'ART',
  client: 'CLIENT',
};

export const NAME_MIN = 2;
export const NAME_MAX = 40;
export const BLURB_MIN = 8;
export const BLURB_MAX = 140;
export const URL_MAX = 200;

export interface Submission {
  name: string;
  url: string;
  blurb: string;
  kind: SubmissionKind;
}

/** An approved entry, as GET returns it. */
export interface CommunityEntry extends Submission {
  id: string;
  at: number;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** Trim, drop control / bidi-override characters, collapse whitespace. */
export function cleanText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v

    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** https only, a real public-looking host, no credentials. Returns the normalised href. */
export function checkUrl(v: unknown): Checked<string> {
  if (typeof v !== 'string') return { ok: false, error: 'add a link' };
  const raw = v.trim();
  if (raw === '' || /^https?:\/*$/i.test(raw)) return { ok: false, error: 'add a link' };
  if (raw.length > URL_MAX)
    return { ok: false, error: `links are capped at ${URL_MAX} characters` };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: "that link doesn't parse" };
  }
  if (u.protocol !== 'https:') return { ok: false, error: 'links have to be https://' };
  if (u.username !== '' || u.password !== '')
    return { ok: false, error: 'no logins in the link please' };
  const host = u.hostname.toLowerCase();
  if (
    !host.includes('.') ||
    host.endsWith('.') ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.startsWith('[') ||
    IPV4.test(host)
  )
    return { ok: false, error: 'that needs to be a public website' };
  if (u.port !== '') return { ok: false, error: 'no custom ports please' };
  if (u.href.length > URL_MAX)
    return { ok: false, error: `links are capped at ${URL_MAX} characters` };
  return { ok: true, value: u.href };
}

/** A submission as it arrives: cleaned and checked, or why not. */
export function validateSubmission(input: unknown): Checked<Submission> {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return { ok: false, error: 'bad request' };
  const o = input as Record<string, unknown>;
  // Honeypot: a hidden field people never fill
  if (typeof o.website === 'string' && o.website.trim() !== '')
    return { ok: false, error: 'bad request' };
  const name = cleanText(o.name);
  if (name.length < NAME_MIN) return { ok: false, error: 'give it a name' };
  if (name.length > NAME_MAX)
    return { ok: false, error: `names are capped at ${NAME_MAX} characters` };
  const url = checkUrl(o.url);
  if (!url.ok) return url;
  const blurb = cleanText(o.blurb);
  if (blurb.length < BLURB_MIN) return { ok: false, error: 'say a few words about it' };
  if (blurb.length > BLURB_MAX)
    return { ok: false, error: `keep the blurb under ${BLURB_MAX} characters` };
  const kind = typeof o.kind === 'string' ? o.kind.toLowerCase() : '';
  if (!(SUBMISSION_KINDS as readonly string[]).includes(kind))
    return { ok: false, error: 'pick what kind of thing it is' };
  return { ok: true, value: { name, url: url.value, blurb, kind: kind as SubmissionKind } };
}

/** Approved entries off the wire, keeping only ones that still pass the rules. */
export function parseEntries(v: unknown): CommunityEntry[] {
  const list = (v as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(list)) return [];
  const out: CommunityEntry[] = [];
  for (const e of list) {
    const c = validateSubmission(e);
    const r = e as { id?: unknown; at?: unknown };
    if (!c.ok || typeof r.id !== 'string' || typeof r.at !== 'number') continue;
    out.push({ ...c.value, id: r.id.slice(0, 32), at: r.at });
  }
  return out;
}

/** Short host for a card ("nouns.game"). */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
