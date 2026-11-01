// ── HUD icons: inline SVG in the house style ────────────────────────────
//
// Chunky ink outlines (INK, 2.5 on a 24 grid), flat fills from the noun.wtf
// palette: yellow, pink, cyan. Every icon is `currentColor`-free on purpose:
// they read the same on a sunny plaza and at night. Decorative by default
// (aria-hidden); the button around one carries the label.

import type { ReactNode } from 'react';

export const INK = '#0b0b12';
export const YELLOW = '#ffd400';
export const PINK = '#ff2f8e';
export const CYAN = '#20d6ff';
export const WHITE = '#ffffff';

const SNOW = 'M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 3.5l3 2 3-2M9 20.5l3-2 3 2';

const S = {
  stroke: INK,
  strokeWidth: 2.5,
  strokeLinejoin: 'round',
  strokeLinecap: 'round',
} as const;

export type IconName =
  | 'mic'
  | 'micLive'
  | 'micMuted'
  | 'radio'
  | 'radioOff'
  | 'next'
  | 'sun'
  | 'golden'
  | 'blue'
  | 'moon'
  | 'trophy'
  | 'help'
  | 'map'
  | 'coin'
  | 'respect'
  | 'star'
  | 'board'
  | 'walk'
  | 'people'
  | 'snow'
  | 'mountain'
  | 'missions'
  | 'replay'
  | 'spray'
  | 'respawn'
  | 'flip'
  | 'grab'
  | 'stop'
  | 'push'
  | 'ollie'
  | 'cargo'
  | 'shop'
  | 'decks'
  | 'chat'
  | 'fm'
  | 'cog'
  | 'share';

const PATHS: Record<IconName, ReactNode> = {
  mic: (
    <>
      <rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill={CYAN} {...S} />
      <path d="M5 11.5a7 7 0 0 0 14 0M12 18.5v3M8.5 21.5h7" fill="none" {...S} />
    </>
  ),
  micLive: (
    <>
      <rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill={YELLOW} {...S} />
      <path d="M5 11.5a7 7 0 0 0 14 0M12 18.5v3M8.5 21.5h7" fill="none" {...S} />
      <path d="M2 6v5M22 6v5" fill="none" {...S} stroke={PINK} />
    </>
  ),
  micMuted: (
    <>
      <rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill="#8a8f99" {...S} />
      <path d="M5 11.5a7 7 0 0 0 14 0M12 18.5v3" fill="none" {...S} />
      <path d="M3 3l18 18" fill="none" {...S} stroke={PINK} strokeWidth={3} />
    </>
  ),
  radio: (
    <>
      <path d="M6 7.5L17 3" fill="none" {...S} />
      <rect x="2.5" y="7.5" width="19" height="13" rx="2.5" fill={PINK} {...S} />
      <circle cx="15.5" cy="14" r="3.5" fill={YELLOW} {...S} />
      <path d="M6 12h3.5M6 16h3.5" fill="none" {...S} />
    </>
  ),
  radioOff: (
    <>
      <path d="M6 7.5L17 3" fill="none" {...S} />
      <rect x="2.5" y="7.5" width="19" height="13" rx="2.5" fill="#8a8f99" {...S} />
      <circle cx="15.5" cy="14" r="3.5" fill="#c9ccd2" {...S} />
      <path d="M6 12h3.5M6 16h3.5" fill="none" {...S} />
    </>
  ),
  next: (
    <>
      <path d="M3.5 5v14l9-7zM12.5 5v14l7-7z" fill={YELLOW} {...S} />
      <path d="M20.5 5v14" fill="none" {...S} />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="5" fill={YELLOW} {...S} />
      <path
        d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"
        fill="none"
        {...S}
      />
    </>
  ),
  golden: (
    <>
      <path d="M5 16a7 7 0 0 1 14 0z" fill="#ff8a1f" {...S} />
      <path d="M2 16h20M5 20h14M12 4v3M4.5 8.5l2 2M19.5 8.5l-2 2" fill="none" {...S} />
    </>
  ),
  blue: (
    <>
      <path d="M3 21V11h4v-4h4v6h3V8h4v13z" fill={CYAN} {...S} />
      <path d="M19 3.5a2.5 2.5 0 1 0 2 4 3 3 0 0 1-2-4z" fill={YELLOW} {...S} strokeWidth={1.8} />
    </>
  ),
  moon: <path d="M15 3a8.5 8.5 0 1 0 6 13.5A9 9 0 0 1 15 3z" fill={YELLOW} {...S} />,
  trophy: (
    <>
      <path d="M7 3.5h10v5a5 5 0 0 1-10 0z" fill={YELLOW} {...S} />
      <path
        d="M7 5.5H3.5a3.5 3.5 0 0 0 3.8 4.5M17 5.5h3.5a3.5 3.5 0 0 1-3.8 4.5M12 13.5v4"
        fill="none"
        {...S}
      />
      <rect x="7" y="17.5" width="10" height="3.5" rx="1" fill={PINK} {...S} />
    </>
  ),
  help: (
    <>
      <rect x="2.5" y="4" width="19" height="16" rx="3" fill={CYAN} {...S} />
      <path d="M6 16h12M6.5 8.5h1M10.5 8.5h1M14.5 8.5h1M8.5 12h1M12.5 12h1" fill="none" {...S} />
    </>
  ),
  map: (
    <>
      <path d="M2.5 5.5l6-2.5 7 2.5 6-2.5v15.5l-6 2.5-7-2.5-6 2.5z" fill={CYAN} {...S} />
      <path d="M8.5 3v15.5M15.5 5.5V21" fill="none" {...S} />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="9.5" fill={YELLOW} {...S} />
      <path
        d="M6.5 10.5h4.5v3H6.5zM13 10.5h4.5v3H13zM11 12h2"
        fill={INK}
        stroke={INK}
        strokeWidth={1.2}
      />
    </>
  ),
  respect: (
    <>
      <path
        d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.6L12 17.2l-5.9 3.2 1.3-6.6-4.9-4.5 6.6-.8z"
        fill={PINK}
        {...S}
      />
    </>
  ),
  star: (
    <path
      d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.6L12 17.2l-5.9 3.2 1.3-6.6-4.9-4.5 6.6-.8z"
      fill={YELLOW}
      {...S}
    />
  ),
  board: (
    <>
      <path d="M2.5 11.5h19a2 2 0 0 1 0 3h-19a2 2 0 0 1 0-3z" fill={PINK} {...S} />
      <circle cx="6.5" cy="18" r="2" fill={YELLOW} {...S} />
      <circle cx="17.5" cy="18" r="2" fill={YELLOW} {...S} />
    </>
  ),
  walk: (
    <>
      <circle cx="13" cy="4.5" r="2.5" fill={YELLOW} {...S} />
      <path
        d="M11 9l-3 4M13 8.5l-1.5 6 3.5 3 1 4M11.5 14.5L9 21.5M13 8.5l3.5 3.5 3 0"
        fill="none"
        {...S}
      />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3.5" fill={CYAN} {...S} />
      <path d="M2.5 20.5a6.5 6.5 0 0 1 13 0z" fill={CYAN} {...S} />
      <circle cx="17" cy="9" r="2.5" fill={YELLOW} {...S} />
      <path d="M15.5 14.5a5 5 0 0 1 6 6h-4" fill={YELLOW} {...S} />
    </>
  ),
  snow: (
    <>
      <path d={SNOW} fill="none" {...S} strokeWidth={5} />
      <path d={SNOW} fill="none" {...S} stroke={CYAN} strokeWidth={2.4} />
    </>
  ),
  mountain: (
    <>
      <path d="M1.5 20.5l7-13 4 6 2.5-3.5 7.5 10.5z" fill={CYAN} {...S} />
      <path d="M6.5 11.3l2-3.8 2 3" fill={WHITE} {...S} strokeWidth={1.6} />
    </>
  ),
  missions: (
    // The noggles
    <>
      <path d="M1.5 9h4M5.5 9v5" fill="none" {...S} />
      <rect x="5.5" y="6" width="7" height="9" fill={WHITE} {...S} />
      <rect x="14" y="6" width="7" height="9" fill={WHITE} {...S} />
      <rect x="9" y="8" width="3" height="5" fill={INK} stroke="none" />
      <rect x="17.5" y="8" width="3" height="5" fill={INK} stroke="none" />
      <path d="M12.5 9.5H14" fill="none" {...S} />
      <path d="M2 18.5h20" fill="none" {...S} stroke={PINK} />
    </>
  ),
  replay: (
    <>
      <path d="M4 12a8 8 0 1 0 2.5-5.8" fill="none" {...S} strokeWidth={3} />
      <path d="M3.5 2.5v5h5" fill="none" {...S} strokeWidth={3} />
      <path d="M10 8.5v7l5.5-3.5z" fill={PINK} {...S} strokeWidth={1.8} />
    </>
  ),
  spray: (
    <>
      <rect x="6" y="8" width="9" height="13.5" rx="2" fill={PINK} {...S} />
      <path d="M8 8V5.5h5V8M10.5 5.5V3h2.5" fill="none" {...S} />
      <path
        d="M18 4h.5M20.5 2.5h.5M20.5 6h.5M18.5 8h.5"
        fill="none"
        {...S}
        stroke={CYAN}
        strokeWidth={2.6}
      />
    </>
  ),
  respawn: (
    <>
      <path d="M12 21.5s-7-6.3-7-11.5a7 7 0 0 1 14 0c0 5.2-7 11.5-7 11.5z" fill={YELLOW} {...S} />
      <path d="M9 10a3 3 0 1 0 1-2.3M9 5.5v2.5h2.5" fill="none" {...S} strokeWidth={2} />
    </>
  ),
  flip: (
    <>
      <path d="M4 14.5h16a1.5 1.5 0 0 1 0 3H4a1.5 1.5 0 0 1 0-3z" fill={PINK} {...S} />
      <path d="M6 9.5a7 4.5 0 0 1 12 0M18 9.5l.5-3.5M18 9.5l-3.5-.5" fill="none" {...S} />
    </>
  ),
  grab: (
    <>
      <path
        d="M7 11.5V5a1.5 1.5 0 0 1 3 0v5V3.8a1.5 1.5 0 0 1 3 0V10V4.8a1.5 1.5 0 0 1 3 0v6.5l1.2-2a1.6 1.6 0 0 1 2.7 1.6l-3.4 6.3a6 6 0 0 1-5.3 3.3h-.7A5.5 5.5 0 0 1 4 15v-3.5a1.5 1.5 0 0 1 3 0z"
        fill={YELLOW}
        {...S}
        strokeWidth={2}
      />
    </>
  ),
  stop: (
    <>
      <path d="M8 2.5h8l5.5 5.5v8L16 21.5H8L2.5 16V8z" fill={PINK} {...S} />
      <path d="M8 12h8" fill="none" {...S} stroke={WHITE} strokeWidth={3} />
    </>
  ),
  push: (
    <>
      <path d="M4 5l7 7-7 7M12 5l7 7-7 7" fill="none" {...S} strokeWidth={5.5} />
      <path d="M4 5l7 7-7 7M12 5l7 7-7 7" fill="none" {...S} stroke={WHITE} strokeWidth={3} />
    </>
  ),
  ollie: (
    <>
      <path d="M12 3l7 8h-4v5H9v-5H5z" fill={INK} {...S} />
      <path d="M4 20.5h16" fill="none" {...S} />
    </>
  ),
  cargo: (
    <>
      <path d="M3 8l9-4.5L21 8v9l-9 4.5L3 17z" fill="#ff8a1f" {...S} />
      <path d="M3 8l9 4.5L21 8M12 12.5v9" fill="none" {...S} />
    </>
  ),
  shop: (
    <>
      <path d="M3 9.5L5 4h14l2 5.5z" fill={PINK} {...S} />
      <path d="M4.5 9.5v11h15v-11" fill={WHITE} {...S} />
      <rect x="10" y="14" width="4" height="6.5" fill={CYAN} {...S} />
    </>
  ),
  decks: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" fill={CYAN} {...S} />
      <circle cx="8" cy="12" r="3" fill={YELLOW} {...S} />
      <circle cx="16" cy="12" r="3" fill={YELLOW} {...S} />
    </>
  ),
  chat: (
    <>
      <path
        d="M3 5.5a2.5 2.5 0 0 1 2.5-2.5h13A2.5 2.5 0 0 1 21 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-5 4.5V16h-.5A2.5 2.5 0 0 1 3 13.5z"
        fill={WHITE}
        {...S}
      />
      <path d="M7.5 8h9M7.5 11.5h6" fill="none" {...S} strokeWidth={2} />
    </>
  ),
  fm: (
    <>
      <path d="M8 2.5l4 4 4-4" fill="none" {...S} strokeWidth={2} />
      <rect x="2.5" y="6.5" width="19" height="14" rx="3" fill={PINK} {...S} />
      <path d="M10 10v6.5l5.5-3.25z" fill={YELLOW} {...S} strokeWidth={2} />
    </>
  ),
  cog: (
    <>
      <path
        d="M10 2.5h4l.6 2.6 2.2 1.3 2.6-.8 2 3.4-2 1.9v2.2l2 1.9-2 3.4-2.6-.8-2.2 1.3-.6 2.6h-4l-.6-2.6-2.2-1.3-2.6.8-2-3.4 2-1.9v-2.2l-2-1.9 2-3.4 2.6.8 2.2-1.3z"
        fill="#c9ccd2"
        {...S}
        strokeWidth={2}
      />
      <circle cx="12" cy="12" r="3" fill={INK} />
    </>
  ),
  share: (
    <>
      <path d="M4.5 11v9.5h15V11" fill={CYAN} {...S} />
      <path d="M12 15.5V3M7.5 7.5L12 3l4.5 4.5" fill="none" {...S} />
    </>
  ),
};

export function HudIcon({
  name,
  size = 20,
  className,
  title,
}: {
  name: IconName;
  size?: number;
  className?: string;
  /** Give it a name only when it stands alone (no labelled button around it). */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden={title === undefined ? true : undefined}
      role={title === undefined ? undefined : 'img'}
      focusable="false"
      style={{ overflow: 'visible', flex: 'none' }}
    >
      {title !== undefined && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}

/** Every icon name (the tests check each one draws). */
export const ICON_NAMES = Object.keys(PATHS) as IconName[];
