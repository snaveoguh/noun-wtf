// ── NOUN TAXI chatter: a tiny template grammar (pure) ─────────────────────
//
// A template is text with slots:
//   {sym}         expand rule `sym` (each rule is a list of templates, so
//                 slots nest)
//   {sym>slot}    expand it and remember the result as memory `slot`, so a
//                 later line can call back to it
//   {@slot}       a remembered value (a template that needs a slot it
//                 doesn't have is never picked: see `needs`)
// Picks come through a `Picker`, so the generator can deal each rule like a
// shuffled deck (every option once before any comes round again). An
// unknown rule throws: the tests expand every template to prove none are
// broken.

export type Rules = Readonly<Record<string, readonly string[]>>;

/** Choose one of `opts` for rule `key`. */
export type Picker = (key: string, opts: readonly string[]) => string;

const SLOT = /{(@?)(\w+)(?:>(\w+))?}/g;

/** Memory slots a template (and only its own text, not its rules) calls back to. */
export function needs(t: string): string[] {
  const out: string[] = [];
  for (const m of t.matchAll(SLOT)) if (m[1] === '@') out.push(m[2]!);
  return out;
}

/** Rule names a template expands. */
export function symbols(t: string): string[] {
  const out: string[] = [];
  for (const m of t.matchAll(SLOT)) if (m[1] !== '@') out.push(m[2]!);
  return out;
}

export class GrammarError extends Error {}

/**
 * Expand `t`. `mem` is read for {@slot}; captures ({sym>slot}) are written
 * to `caught` (the caller decides whether to keep them).
 */
export function expand(
  t: string,
  rules: Rules,
  pick: Picker,
  mem: Readonly<Record<string, string>>,
  caught: Record<string, string>,
  depth = 0,
): string {
  if (depth > 12) throw new GrammarError(`too deep: ${t}`);
  return t.replace(SLOT, (_m, at: string, name: string, slot: string | undefined) => {
    if (at === '@') {
      const v = mem[name] ?? caught[name];
      if (v === undefined) throw new GrammarError(`no memory "${name}" for: ${t}`);
      return v;
    }
    const opts = rules[name];
    if (opts === undefined || opts.length === 0) throw new GrammarError(`no rule "${name}"`);
    const v = expand(pick(name, opts), rules, pick, mem, caught, depth + 1);
    if (slot !== undefined) caught[slot] = v;
    return v;
  });
}

/** Tidy an expansion into a spoken line: spaces, punctuation, capitals. */
export function tidy(s: string): string {
  let t = s
    .replace(/\s+/g, ' ')
    .replace(/\s+([!,.:;?])/g, '$1')
    .replace(/([,:;])(?=[^\d\s])/g, '$1 ')
    .replace(/\.{4,}/g, '...')
    .replace(/([!?])\./g, '$1')
    .replace(/,([!.?])/g, '$1')
    .replace(/\.\s*,/g, '.')
    .trim();
  // Capital after a sentence end (not after "...", which trails on)
  t = t.replace(/(^|[^.][!.?]\s+)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[!.?]$/.test(t)) t += '.';
  return t;
}

/** The key two lines are compared by: same words, any case or punctuation. */
export function lineKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\da-z]+/g, ' ')
    .trim();
}

/** A shuffled deck per rule: every option once (in random order) before any repeats. */
export class Decks {
  private decks = new Map<string, string[]>();
  constructor(private rand: () => number) {}

  readonly pick: Picker = (key, opts) => {
    const id = `${key}#${opts.length}#${opts[0] ?? ''}`;
    let d = this.decks.get(id);
    if (d === undefined || d.length === 0) {
      d = [...opts];
      for (let i = d.length - 1; i > 0; i--) {
        const j = Math.floor(this.rand() * (i + 1));
        [d[i], d[j]] = [d[j]!, d[i]!];
      }
      this.decks.set(id, d);
    }
    return d.pop()!;
  };
}
