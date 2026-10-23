// ── Text → Piper phoneme ids ─────────────────────────────────────────────
//
// Pure: the worker hands in an eSpeak phonemizer (the `phonemizer` package,
// eSpeak NG compiled to JS) and the model's phoneme_id_map. This is what
// piper-phonemize does natively: eSpeak IPA, punctuation kept as its own
// symbol (Piper's voices pause and inflect on it), then
//   ^ _ p₁ _ p₂ _ … pₙ _ $        (^ start, _ pad after each, $ end)

/** Clause punctuation Piper's models know. */
const PUNCT = /([!,.:;?]+)/;

/** Game text → something eSpeak reads well (no emoji, no stray symbols). */
export function cleanText(text: string, max = 280): string {
  let t = text
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/…/g, '...')
    .replace(/[–—]/g, ', ')
    .replace(/["«»“”]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[#*/<>[\\\]^_`{|}~]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/ ([!,.:;?])/g, '$1')
    .trim();
  if (t.length > max) {
    const cut = t.slice(0, max);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    t = end > max * 0.5 ? cut.slice(0, end + 1) : cut;
  }
  return t;
}

/** Text → [words, punctuation, words, …] (punctuation runs keep their first mark). */
export function clauses(text: string): { words: string; punct: string }[] {
  const out: { words: string; punct: string }[] = [];
  const parts = text.split(PUNCT);
  for (let i = 0; i < parts.length; i += 2) {
    const words = (parts[i] ?? '').trim();
    const punct = (parts[i + 1] ?? '').charAt(0);
    if (words === '' && punct === '') continue;
    if (words === '' && out.length > 0) {
      // "?!" or ", ." after a clause: keep the first mark only
      if (out[out.length - 1]!.punct === '') out[out.length - 1]!.punct = punct;
      continue;
    }
    out.push({ words, punct });
  }
  return out;
}

export type Phonemize = (text: string) => Promise<string>;

/** Clause list → one IPA string with the punctuation put back. */
export async function toPhonemes(text: string, phonemize: Phonemize): Promise<string> {
  let s = '';
  for (const c of clauses(cleanText(text))) {
    const p = c.words === '' ? '' : (await phonemize(c.words)).trim();
    if (p === '' && c.punct === '') continue;
    s += `${s === '' || p === '' ? '' : ' '}${p}${c.punct}`;
  }
  return s.trim();
}

/** IPA string → model input ids (unknown symbols are dropped). */
export function toIds(phonemes: string, map: Record<string, readonly number[]>): number[] {
  const pad = map._?.[0] ?? 0;
  const ids: number[] = [...(map['^'] ?? [1]), pad];
  for (const ch of phonemes) {
    const id = map[ch];
    if (id === undefined) continue;
    for (const x of id) ids.push(x, pad);
  }
  ids.push(...(map.$ ?? [2]));
  return ids;
}
