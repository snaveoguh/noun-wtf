// ── Respect HUD: tier colours and the CSS (RespectHud.tsx) ──────────────

import type { RespectTier } from '../interiors/contract';

export const TIER_COLOR: Record<RespectTier, string> = {
  outcast: '#9aa0a6',
  stranger: '#ffffff',
  local: '#3ddc84',
  regular: '#4fc3ff',
  legend: '#ffd400',
};

export const RESPECT_CSS = `
.w2-respect{display:flex;align-items:center;gap:7px;font-size:12px;cursor:pointer}
.w2-respect-tier{font-weight:900;font-style:italic;letter-spacing:.06em}
.w2-respect-nog{image-rendering:pixelated}
.w2-respect-bar{position:relative;display:inline-block;width:54px;height:5px;border-radius:3px;background:rgba(255,255,255,.18);overflow:hidden}
.w2-respect-bar>i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;transition:width .5s}
.w2-respect-bar-lg{display:block;width:100%;height:7px;margin-top:6px}
.w2-respect-ticker{position:absolute;z-index:5;right:calc(100% + 8px);top:0;display:flex;flex-direction:column;align-items:flex-end;gap:4px;pointer-events:none}
.w2-respect-tick{font:600 11px system-ui,sans-serif;background:rgba(10,12,20,.55);border-left:3px solid;border-radius:4px;padding:2px 8px;max-width:min(320px,calc(100vw - 190px));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;animation:w2rtick 4.5s ease forwards}
@keyframes w2rtick{0%{opacity:0;transform:translateX(-8px)}8%{opacity:1;transform:none}80%{opacity:1}100%{opacity:0}}
.w2-respect-layer{position:absolute;z-index:60}
.w2-respect-panel{text-align:left;white-space:normal;width:min(330px,calc(100vw - 32px));max-height:min(62vh,520px);overflow:auto;background:rgba(10,12,20,.88);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:10px 12px;font:12px system-ui,sans-serif;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.45)}
.w2-respect-panel h4{font-size:10px;font-weight:900;letter-spacing:.14em;margin:8px 0 3px}
.w2-respect-panel ul{margin:0;padding-left:14px;list-style:disc}
.w2-respect-panel li{margin:1px 0;line-height:1.3}
.w2-respect-x{width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,.1)}
.w2-respect-ladder{display:flex;gap:6px;font-size:9px;font-weight:800;letter-spacing:.08em;margin-top:4px}
.w2-respect-ladder>span{opacity:.35}
.w2-respect-cols{display:grid;grid-template-columns:1fr 1fr;gap:8px}
@media (max-width:420px){.w2-respect-cols{grid-template-columns:1fr}}
@media (max-width:640px){.w2-respect-ticker{right:0;top:calc(100% + 4px)}.w2-respect-tick{max-width:calc(100vw - 32px)}.w2-respect-score{display:none}.w2-respect .w2-respect-bar{width:36px}}
.w2-respect-hist{list-style:none!important;padding:0!important}
.w2-respect-hist li{display:grid;grid-template-columns:34px 1fr auto;gap:6px;align-items:baseline}
.w2-respect-hist i{font-style:normal;opacity:.5;font-size:10px}
.w2-respect-banner{position:absolute;left:50%;top:22%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;background:#ffd400;color:#000;padding:8px 22px 10px;box-shadow:6px 6px 0 #d22209;font-style:italic;animation:w2rban 3.4s ease forwards;pointer-events:none;z-index:40}
.w2-respect-banner>span{font:900 11px system-ui,sans-serif;letter-spacing:.24em}
.w2-respect-banner>b{display:flex;align-items:center;gap:8px;font:900 italic 30px system-ui,sans-serif;letter-spacing:.04em}
.w2-respect-banner img{image-rendering:pixelated}
.w2-respect-down{background:rgba(10,12,20,.9);color:#fff;box-shadow:6px 6px 0 #000}
@keyframes w2rban{0%{opacity:0;transform:translateX(-50%) scale(.7)}10%{opacity:1;transform:translateX(-50%) scale(1.06)}16%{transform:translateX(-50%) scale(1)}85%{opacity:1}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){.w2-respect-banner,.w2-respect-tick{animation:none}}
`;
