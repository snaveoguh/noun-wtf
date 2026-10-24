// CC0 Library community uploads: the rules both sides apply. The browser
// checks before it sends anything, and the `cc0-uploads` Netlify function
// checks again (it trusts nothing the browser says). Pure: no DOM, no Node.
//
// Accepted files (≤ 10 MB): png / jpg / gif / webp / svg images, mp3 / wav /
// ogg audio, glb / gltf 3D. The bytes must match the extension (magic
// numbers), SVGs with scripts, event handlers, external references or
// DOCTYPEs are refused, and a .gltf must embed its buffers / images.

// Relative, not @/: the Netlify functions bundle this file too
import { checkUrl, cleanText, type Checked } from '../../components/NounOS/home/community';

export const UPLOADS_URL = '/.netlify/functions/cc0-uploads';
export const FILE_URL = '/.netlify/functions/cc0-file';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Raw bytes per upload request (base64 grows it by 4/3; Netlify caps a request at 6 MB). */
export const PART_BYTES = 3 * 1024 * 1024;
export const MAX_PARTS = Math.ceil(MAX_FILE_BYTES / PART_BYTES);

export const TITLE_MIN = 2;
export const TITLE_MAX = 80;
export const CREATOR_MIN = 2;
export const CREATOR_MAX = 40;
export const MAX_TAGS = 8;
export const TAG_MAX = 24;

export const CONSENT_TEXT =
  'I made this or have the right to release it, and I release it under CC0 1.0 (public domain)';

export type UploadKind = 'image' | 'audio' | '3d';

export interface FileType {
  ext: string;
  mime: string;
  kind: UploadKind;
}

export const FILE_TYPES: readonly FileType[] = [
  { ext: 'png', mime: 'image/png', kind: 'image' },
  { ext: 'jpg', mime: 'image/jpeg', kind: 'image' },
  { ext: 'gif', mime: 'image/gif', kind: 'image' },
  { ext: 'webp', mime: 'image/webp', kind: 'image' },
  { ext: 'svg', mime: 'image/svg+xml', kind: 'image' },
  { ext: 'mp3', mime: 'audio/mpeg', kind: 'audio' },
  { ext: 'wav', mime: 'audio/wav', kind: 'audio' },
  { ext: 'ogg', mime: 'audio/ogg', kind: 'audio' },
  { ext: 'glb', mime: 'model/gltf-binary', kind: '3d' },
  { ext: 'gltf', mime: 'model/gltf+json', kind: '3d' },
];

/** For the file picker's `accept`. */
export const ACCEPT = FILE_TYPES.map(t => `.${t.ext}`)
  .concat('.jpeg')
  .join(',');

/** The file type for a file name ("Foo.JPEG" → jpg), or undefined. */
export function fileTypeOf(name: string): FileType | undefined {
  const m = /\.([\da-z]{2,5})$/i.exec(name.trim());
  if (!m) return undefined;
  const ext = m[1]!.toLowerCase() === 'jpeg' ? 'jpg' : m[1]!.toLowerCase();
  return FILE_TYPES.find(t => t.ext === ext);
}

/** What the uploader tells us about the asset (everything but the bytes). */
export interface UploadMeta {
  title: string;
  creator: string;
  link?: string;
  tags: string[];
  /** Original file name, cleaned */
  name: string;
  ext: string;
  mime: string;
  kind: UploadKind;
  bytes: number;
}

/** An approved upload, as the library lists it. */
export interface Cc0Upload extends Omit<UploadMeta, 'bytes'> {
  id: string;
  at: number;
  bytes: number;
}

/** "Pixel Art, voxels;  3d!!" → ['pixel-art', 'voxels', '3d'] */
export function cleanTags(v: unknown): string[] {
  const raw = Array.isArray(v) ? v.join(',') : typeof v === 'string' ? v : '';
  const out: string[] = [];
  for (const t of raw.split(/[\n#,;]+/)) {
    const tag = t
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\da-z-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, TAG_MAX);
    if (tag !== '' && !out.includes(tag)) out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

/** A file name safe to show and to put in Content-Disposition. */
export function cleanFileName(v: unknown, ext: string): string {
  const base = cleanText(v)
    .replace(/\.[\da-z]{2,5}$/i, '')
    .replace(/[^\w ().-]/g, '')
    .trim()
    .slice(0, 60);
  return `${base === '' ? 'cc0-asset' : base}.${ext}`;
}

/** The form / `begin` request, cleaned and checked. Consent must be literally true. */
export function validateUploadMeta(input: unknown): Checked<UploadMeta> {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return { ok: false, error: 'bad request' };
  const o = input as Record<string, unknown>;
  // Honeypot: a hidden field people never fill
  if (typeof o.website === 'string' && o.website.trim() !== '')
    return { ok: false, error: 'bad request' };
  if (o.consent !== true)
    return { ok: false, error: 'tick the box to release it under CC0 (public domain)' };
  const title = cleanText(o.title);
  if (title.length < TITLE_MIN) return { ok: false, error: 'give it a title' };
  if (title.length > TITLE_MAX)
    return { ok: false, error: `titles are capped at ${TITLE_MAX} characters` };
  const creator = cleanText(o.creator).replace(/^@+/, '@');
  if (creator.replace(/^@/, '').length < CREATOR_MIN)
    return { ok: false, error: 'who made it? a name or handle' };
  if (creator.length > CREATOR_MAX)
    return { ok: false, error: `names are capped at ${CREATOR_MAX} characters` };
  let link: string | undefined;
  if (typeof o.link === 'string' && o.link.trim() !== '') {
    const u = checkUrl(o.link);
    if (!u.ok) return u;
    link = u.value;
  }
  const type = typeof o.name === 'string' ? fileTypeOf(o.name) : undefined;
  if (type === undefined)
    return {
      ok: false,
      error: 'that file type is not accepted (png, jpg, gif, webp, svg, mp3, wav, ogg, glb, gltf)',
    };
  // Browsers report mime types inconsistently (audio/x-wav, empty for .glb):
  // the extension decides, and the bytes have to agree with it.
  const bytes = o.bytes;
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0)
    return { ok: false, error: 'that file is empty' };
  if (bytes > MAX_FILE_BYTES) return { ok: false, error: 'files are capped at 10 MB' };
  return {
    ok: true,
    value: {
      title,
      creator,
      ...(link !== undefined ? { link } : {}),
      tags: cleanTags(o.tags),
      name: cleanFileName(o.name, type.ext),
      ext: type.ext,
      mime: type.mime,
      kind: type.kind,
      bytes,
    },
  };
}

// ── Bytes ─────────────────────────────────────────────────────────────

const ascii = (b: Uint8Array, at: number, s: string) => {
  if (b.length < at + s.length) return false;
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false;
  return true;
};

const decodeText = (b: Uint8Array) => new TextDecoder('utf-8', { fatal: false }).decode(b);

/** Do the first bytes match what the extension promises? (svg / gltf get their own checks) */
export function magicOk(b: Uint8Array, ext: string): boolean {
  switch (ext) {
    case 'png':
      return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x);
    case 'jpg':
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'gif':
      return ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a');
    case 'webp':
      return ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP');
    case 'wav':
      return ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE');
    case 'ogg':
      return ascii(b, 0, 'OggS');
    case 'mp3':
      // ID3 tag, or straight into an MPEG audio frame (11 sync bits)
      return ascii(b, 0, 'ID3') || (b[0] === 0xff && b[1] !== undefined && (b[1] & 0xe0) === 0xe0);
    case 'glb':
      return ascii(b, 0, 'glTF') && b[4] === 2;
    case 'svg':
    case 'gltf':
      return b.length > 0;
    default:
      return false;
  }
}

/**
 * Why an SVG can't go up, or null if it's fine. Refused rather than
 * rewritten: an SVG that needs scripts, handlers or remote content isn't a
 * static asset, and a sanitiser that misses one case is worse than a no.
 */
export function svgProblem(text: string): string | null {
  const t = text.replace(/^﻿/, '');
  if (!/<svg[\s>]/i.test(t)) return "that doesn't look like an SVG";
  const lower = t.toLowerCase();
  if (/<!doctype|<!entity/i.test(t)) return 'SVGs with a DOCTYPE or entities are not accepted';
  if (/<script[\s/>]/i.test(t)) return 'SVGs with scripts are not accepted';
  if (/<(foreignobject|iframe|embed|object|audio|video|handler|listener)[\s/>]/i.test(t))
    return 'SVGs with embedded HTML or media are not accepted';
  if (/[\s"'/]on[a-z]+\s*=/i.test(t)) return 'SVGs with event handlers are not accepted';
  if (/javascript:|vbscript:|data:text\/html/i.test(lower.replace(/\s+/g, '')))
    return 'SVGs with script links are not accepted';
  // Only same-document (#id) and inline image data references
  for (const m of t.matchAll(/(?:xlink:)?href\s*=\s*["']\s*([^"']*)["']/gi)) {
    const ref = m[1]!.trim();
    if (!(ref.startsWith('#') || /^data:image\/(png|jpeg|gif|webp);base64,/i.test(ref)))
      return 'SVGs that load outside files are not accepted';
  }
  if (/url\(\s*["']?\s*(?![\s"#']|data:image\/)/i.test(t))
    return 'SVGs that load outside files are not accepted';
  if (/@import/i.test(t)) return 'SVGs that load outside files are not accepted';
  return null;
}

/** A .gltf must be JSON with an `asset` block and only embedded (data:) buffers / images. */
export function gltfProblem(text: string): string | null {
  let j: unknown;
  try {
    j = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return "that .gltf isn't valid JSON";
  }
  if (typeof j !== 'object' || j === null || typeof (j as { asset?: unknown }).asset !== 'object')
    return "that doesn't look like a glTF file";
  const g = j as { buffers?: { uri?: unknown }[]; images?: { uri?: unknown }[] };
  for (const x of [...(g.buffers ?? []), ...(g.images ?? [])]) {
    if (x.uri !== undefined && !(typeof x.uri === 'string' && x.uri.startsWith('data:')))
      return 'pack the model into one file: export a .glb, or a .gltf with embedded buffers';
  }
  return null;
}

/** Full check of an uploaded file's bytes against its declared extension. */
export function checkFileBytes(b: Uint8Array, ext: string): Checked<true> {
  if (b.length === 0) return { ok: false, error: 'that file is empty' };
  if (b.length > MAX_FILE_BYTES) return { ok: false, error: 'files are capped at 10 MB' };
  if (!magicOk(b, ext))
    return { ok: false, error: `that file isn't really a .${ext} (its bytes don't match)` };
  if (ext === 'svg') {
    const p = svgProblem(decodeText(b));
    if (p !== null) return { ok: false, error: p };
  }
  if (ext === 'gltf') {
    const p = gltfProblem(decodeText(b));
    if (p !== null) return { ok: false, error: p };
  }
  return { ok: true, value: true };
}

/**
 * Drop a JPEG's metadata segments (APP1 = EXIF / XMP, APP13 = IPTC, COM) so
 * camera GPS and serial numbers don't get published. Leaves the image data
 * untouched; returns the input if it can't parse the structure.
 */
export function stripJpegMetadata(b: Uint8Array): Uint8Array {
  if (b[0] !== 0xff || b[1] !== 0xd8) return b;
  const keep: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return b;
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    // Start of scan: the rest is entropy-coded image data
    if (marker === 0xda) {
      keep.push(b.subarray(i));
      return concatBytes(keep);
    }
    if (marker === 0xd9) {
      keep.push(b.subarray(i, i + 2));
      return concatBytes(keep);
    }
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (len < 2 || i + 2 + len > b.length) return b;
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!drop) keep.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return b;
}

/** Drop a PNG's text / EXIF chunks (tEXt, zTXt, iTXt, eXIf). */
export function stripPngMetadata(b: Uint8Array): Uint8Array {
  if (!magicOk(b, 'png')) return b;
  const keep: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
    const end = i + 12 + len;
    if (end > b.length) return b;
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    if (!['tEXt', 'zTXt', 'iTXt', 'eXIf'].includes(type)) keep.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') return concatBytes(keep);
  }
  return b;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Where an approved upload's file is served from. */
export const fileUrl = (id: string) => `${FILE_URL}?id=${encodeURIComponent(id)}`;

const ID_RE = /^[\da-f]{16}$/;

/** Approved uploads off the wire, keeping only well-formed ones. */
export function parseUploads(v: unknown): Cc0Upload[] {
  const list = (v as { uploads?: unknown } | null)?.uploads;
  if (!Array.isArray(list)) return [];
  const out: Cc0Upload[] = [];
  for (const u of list) {
    if (typeof u !== 'object' || u === null) continue;
    const r = u as Record<string, unknown>;
    const m = validateUploadMeta({ ...r, consent: true });
    if (!m.ok || typeof r.id !== 'string' || !ID_RE.test(r.id) || typeof r.at !== 'number')
      continue;
    out.push({ ...m.value, id: r.id, at: r.at });
  }
  return out;
}
