// Browser side of a CC0 upload: check locally with the shared rules, then
// begin → part × n → finish against the cc0-uploads function.

import {
  checkFileBytes,
  PART_BYTES,
  UPLOADS_URL,
  validateUploadMeta,
  type UploadMeta,
} from './uploadRules';

export interface SubmitForm {
  title: string;
  creator: string;
  link: string;
  tags: string;
  consent: boolean;
  /** Honeypot */
  website: string;
}

export type SubmitResult = { ok: true; id: string } | { ok: false; error: string };

export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The request body for `begin`, or why the form isn't ready. */
export function beginBody(
  form: SubmitForm,
  file: { name: string; size: number },
): { ok: true; body: Record<string, unknown>; meta: UploadMeta } | { ok: false; error: string } {
  const input = {
    action: 'begin',
    title: form.title,
    creator: form.creator,
    link: form.link,
    tags: form.tags,
    consent: form.consent,
    website: form.website,
    name: file.name,
    bytes: file.size,
  };
  const v = validateUploadMeta(input);
  return v.ok ? { ok: true, body: input, meta: v.value } : v;
}

async function post(f: typeof fetch, body: unknown): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await f(UPLOADS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("couldn't reach noun.wtf. check your connection and try again");
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON (proxy error page, dev server)
  }
  if (!res.ok || data.ok !== true)
    throw new Error(typeof data.error === 'string' ? data.error : `upload failed (${res.status})`);
  return data;
}

export async function submitAsset(
  form: SubmitForm,
  file: File,
  opts: { fetch?: typeof fetch; onProgress?: (done: number) => void } = {},
): Promise<SubmitResult> {
  const f = opts.fetch ?? fetch;
  const b = beginBody(form, file);
  if (!b.ok) return b;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkFileBytes(bytes, b.meta.ext);
  if (!check.ok) return check;
  try {
    const start = await post(f, b.body);
    const id = String(start.id);
    const token = String(start.token);
    const parts = Number(start.parts);
    for (let n = 0; n < parts; n++) {
      const data = toBase64(bytes.subarray(n * PART_BYTES, (n + 1) * PART_BYTES));
      await post(f, { action: 'part', id, token, n, data });
      opts.onProgress?.((n + 1) / (parts + 1));
    }
    await post(f, { action: 'finish', id, token });
    opts.onProgress?.(1);
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'upload failed' };
  }
}

export async function reportUpload(
  id: string,
  reason: string,
  f: typeof fetch = fetch,
): Promise<SubmitResult> {
  try {
    await post(f, { action: 'report', id, reason });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'report failed' };
  }
}
