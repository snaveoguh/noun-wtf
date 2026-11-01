// HSV ↔ RGB for the mural colour picker (pure). h 0..360, s / v 0..1.

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export function rgbToHsv(c: number): Hsv {
  const r = ((c >> 16) & 255) / 255;
  const g = ((c >> 8) & 255) / 255;
  const b = (c & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): number {
  const hh = (((h % 360) + 360) % 360) / 60;
  const ss = Math.max(0, Math.min(1, s));
  const vv = Math.max(0, Math.min(1, v));
  const c = vv * ss;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = vv - c;
  const [r, g, b] =
    hh < 1
      ? [c, x, 0]
      : hh < 2
        ? [x, c, 0]
        : hh < 3
          ? [0, c, x]
          : hh < 4
            ? [0, x, c]
            : hh < 5
              ? [x, 0, c]
              : [c, 0, x];
  const to = (k: number) => Math.round((k + m) * 255);
  return (to(r) << 16) | (to(g) << 8) | to(b);
}

/** Parse what someone typed into the hex box: "f33", "#F3322C", "f3322c". */
export function parseHex(text: string): number | null {
  const t = text.trim().replace(/^#/, '');
  if (/^[\da-f]{3}$/i.test(t))
    return parseInt(
      t
        .split('')
        .map(ch => ch + ch)
        .join(''),
      16,
    );
  if (/^[\da-f]{6}$/i.test(t)) return parseInt(t, 16);
  return null;
}
