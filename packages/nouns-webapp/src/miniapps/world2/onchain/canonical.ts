// Canonical JSON: keys sorted, no whitespace, no undefined, integers and
// finite numbers only. The same object always gives the same bytes, so its
// hash is a content hash anyone can recompute from the published file.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function canonical(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error('canonical: non-finite number');
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter(k => obj[k] !== undefined)
        .sort();
      return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
    }
    default:
      throw new Error(`canonical: can't encode ${typeof value}`);
  }
}
