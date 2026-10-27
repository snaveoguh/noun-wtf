// ── HUD settings → a stylesheet over the tagged HUD blocks ──────────────
//
// HUD code only tags its blocks (`data-w2hud="..."`); show/hide and scale
// live here, so the HUD components never re-render for a settings change.

import type { WorldSettings } from './store';

/** The settings panel's own bits (sliders sized for thumbs). */
export const SETTINGS_CSS = `
.w2-settings{font-family:system-ui,sans-serif}
/* site themes recolour buttons: keep text dark on the yellow picks */
.w2-settings .w2-sel{color:#111!important}
.w2-range{width:100%;height:28px;accent-color:#ffd400;touch-action:pan-x;cursor:pointer}
`;

/** HUD blocks that scale as one piece, and the corner each grows from. */
const SCALED: [string, string][] = [
  // The map cluster carries the minimap, speed and players online
  ['[data-w2hud="cluster"]', 'bottom left'],
  // The top-right corner carries the score too
  ['[data-w2hud="system"]', 'top right'],
  ['[data-w2hud="compass"]', 'top center'],
  ['[data-w2hud="chat"]', 'bottom left'],
  ['[data-w2hud="combo"]', 'bottom center'],
  ['[data-w2hud="toasts"]', 'top center'],
  ['[data-w2hud="missions"]', 'top left'],
];

/** The stylesheet that applies the HUD settings. */
export function hudCss(s: WorldSettings): string {
  const out: string[] = [];
  const hide = (sel: string) => out.push(`${sel}{display:none!important}`);
  for (const id of [
    'speed',
    'session',
    'compass',
    'chat',
    'combo',
    'toasts',
    'fps',
    'missions',
  ] as const)
    if (!s.hud[id]) hide(`[data-w2hud="${id}"]`);
  if (!s.hud.minimap) hide('.w2-minimap,.w2h-void');
  // The cog itself always stays
  if (!s.hud.system)
    hide('[data-w2hud="system"]>:not([data-w2cogrow]),[data-w2cogrow]>:not([data-w2cog])');
  if (!s.hud.nametags) hide('.w2-nametag>span,.w2-pointer');
  if (s.reduceMotion) hide('.w2-speedlines');
  if (s.hudScale !== 1) {
    const k = Math.round(s.hudScale * 100) / 100;
    for (const [sel, origin] of SCALED) out.push(`${sel}{scale:${k};transform-origin:${origin}}`);
  }
  return out.join('\n');
}
