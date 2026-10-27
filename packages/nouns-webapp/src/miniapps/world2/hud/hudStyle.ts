// ── The HUD's CSS (the ring, icon buttons, toasts) ──────────────────────
//
// `w2h-` classes are this HUD's own. A few shared classes from older HUD
// pieces are restyled here too (.w2-nowplaying toasts, .w2-respect, the
// missions tracker, prompts), so every corner reads as one system: chunky
// ink outlines, the noun.wtf yellow / pink / cyan on dark ink.
// Pieces other UIs portal into the HUD's places (hud/slots.tsx) lose their
// own absolute placement here: the place lays them out.
// Motion: every animation here is a fade or a small slide, and all of it
// stops under prefers-reduced-motion.

export const HUD_CSS = `
.w2h-num{font-family:'Londrina Solid',system-ui,sans-serif;font-style:italic;font-weight:900;font-variant-numeric:tabular-nums;line-height:1;color:#fff;-webkit-text-stroke:0;text-shadow:2px 2px 0 #0b0b12,-1px -1px 0 #0b0b12,1px -1px 0 #0b0b12,-1px 1px 0 #0b0b12}
.w2h-small{font:800 9px/1 system-ui,sans-serif;letter-spacing:.12em;opacity:.85;text-shadow:0 1px 2px #000}

/* Round icon buttons */
.w2h-ib{position:relative;pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;flex:none;width:var(--w2h-ib,36px);height:var(--w2h-ib,36px);border-radius:50%;background:rgba(11,11,18,.62);border:2px solid #0b0b12;box-shadow:0 0 0 1.5px rgba(255,255,255,.28),0 3px 0 rgba(0,0,0,.35);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:0;color:#fff;transition:transform .08s,box-shadow .15s}
.w2h-ib:hover{box-shadow:0 0 0 2px #ffd400,0 3px 0 rgba(0,0,0,.35)}
.w2h-ib:active{transform:translateY(2px)}
.w2h-ib:focus-visible{outline:2px solid #20d6ff;outline-offset:2px}
.w2h-on{box-shadow:0 0 0 2px #20d6ff,0 3px 0 rgba(0,0,0,.35)}
.w2h-live{box-shadow:0 0 0 2.5px #ff2f8e,0 0 12px rgba(255,47,142,.7);animation:w2hlive 1s ease-in-out infinite}
@keyframes w2hlive{50%{box-shadow:0 0 0 2.5px #ffd400,0 0 16px rgba(255,212,0,.6)}}
.w2h-badge{position:absolute;right:-4px;bottom:-3px;min-width:15px;height:15px;padding:0 3px;border-radius:8px;background:#ffd400;color:#0b0b12;border:1.5px solid #0b0b12;font:900 9px/12px system-ui,sans-serif;text-align:center}
@media (pointer:fine){.w2h-ib[data-tip]:hover::after{content:attr(data-tip);position:absolute;top:calc(100% + 6px);right:0;white-space:nowrap;background:#0b0b12;color:#fff;font:700 11px system-ui,sans-serif;padding:4px 8px;border-radius:6px;border:1px solid rgba(255,212,0,.6);pointer-events:none;z-index:70}}
.w2h-left .w2h-ib[data-tip]:hover::after{right:auto;left:0}
.w2h-bubble{position:absolute;top:calc(100% + 8px);right:0;white-space:nowrap;background:#ffd400;color:#0b0b12;font:900 12px system-ui,sans-serif;padding:5px 9px;border-radius:8px;border:2px solid #0b0b12;box-shadow:3px 3px 0 #ff2f8e;z-index:80;pointer-events:none;animation:w2hfade 1.8s ease forwards}
.w2h-left .w2h-bubble{right:auto;left:0}
/* The phone's icon column: tips open to the left of it */
.w2h-icons.flex-col .w2h-bubble{top:50%;right:calc(100% + 8px);transform:translateY(-50%)}

/* ── The ring: map, speed arc, rim badges ── */
.w2h-ring{position:relative;flex:none}
.w2h-ring>svg.w2h-arc{position:absolute;inset:0;pointer-events:none;z-index:2;overflow:visible}
.w2h-mapdisc{position:absolute;inset:4px;border-radius:50%;background:#0b0b12;box-shadow:0 4px 14px rgba(0,0,0,.4)}
.w2h-ring .w2-minimap{position:absolute!important;inset:7px!important;left:7px!important;bottom:7px!important;width:auto!important;height:auto!important;border-radius:50%!important;border:3px solid #0b0b12!important;box-shadow:0 0 0 2px rgba(255,255,255,.55)!important}
.w2h-ring .w2-minimap-key{right:50%!important;top:auto!important;bottom:4px!important;transform:translateX(50%);border-radius:4px}
.w2h-void{position:absolute;inset:7px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#cfe9ff,#6aa9d8);border:3px solid #0b0b12;display:flex;align-items:center;justify-content:center}
/* Rim badges sit over the map's edge (z above the map, under its tooltips) */
.w2h-rim{z-index:3;white-space:nowrap;pointer-events:none}
.w2h-rim>*{pointer-events:auto}
.w2h-badge2{display:inline-flex;align-items:center;gap:4px;height:100%;padding:0 9px 0 5px;border-radius:999px;background:rgba(11,11,18,.78);border:2px solid #0b0b12;box-shadow:0 0 0 1.5px rgba(255,255,255,.25),0 3px 0 rgba(0,0,0,.3);overflow:hidden}
.w2h-badge2 .w2h-num{font-size:17px}
.w2h-coin .w2h-num{color:#ffd400}
.w2h-score small{font:800 9px system-ui,sans-serif;letter-spacing:.08em;opacity:.7;margin-left:2px}
.w2h-rimslot{display:contents}
.w2h-rimslot>div{height:100%}
.w2h-rimslot .w2-chip{height:100%;padding:0 8px 0 5px!important;border:2px solid #0b0b12;box-shadow:0 0 0 1.5px rgba(255,255,255,.25);background:rgba(11,11,18,.78);border-radius:999px;font-size:11px}
.w2h-rimslot button{height:100%;padding:0 7px!important;font-size:10px!important}
@media (pointer:coarse){
  .w2h-badge2{padding:0 6px 0 3px;gap:3px;border-width:1.5px}
  .w2h-badge2 .w2h-num{font-size:13px}
  .w2h-score small{font-size:8px}
}

/* Respect on the rim: icon, tier, a thin bar */
.w2-respect.w2-chip{gap:5px;padding:2px 8px 2px 4px;height:100%;border:2px solid #0b0b12;box-shadow:0 0 0 1.5px rgba(255,255,255,.25),0 3px 0 rgba(0,0,0,.3);background:rgba(11,11,18,.78);border-radius:999px}
.w2h-rimrespect{display:contents}
.w2h-rimrespect>div{height:100%}
.w2-respect .w2-respect-tier{font-size:12px}
.w2-respect .w2-respect-bar{width:34px;height:4px}
.w2-respect .w2-respect-score{font-size:10px}
@media (pointer:coarse){.w2-respect .w2-respect-score{display:none}.w2-respect .w2-respect-tier{font-size:10px}.w2-respect .w2-respect-bar{width:22px}.w2-respect.w2-chip{padding:1px 6px 1px 3px;border-width:1.5px}}

/* Speed, small, under the map */
.w2h-speedline{z-index:3;pointer-events:none;white-space:nowrap}
.w2h-stat{display:flex;align-items:center;gap:4px;white-space:nowrap}
.w2h-speed .w2h-num{font-size:20px}
.w2h-stat .w2h-num.w2h-sm{font-size:14px}
.w2h-dot{width:7px;height:7px;border-radius:50%;border:1.5px solid #0b0b12;background:#8a8f99}
.w2h-dot.w2h-up{background:#3ddc84}
@media (pointer:coarse){.w2h-speed .w2h-num{font-size:15px}.w2h-speed .w2h-small{font-size:8px}}

/* The FPS / quality readout (dev, behind its setting) */
.w2h-fps{font:600 9px ui-monospace,monospace;opacity:.55;text-shadow:0 1px 2px #000}

/* ── Mode chips: one row ── */
.w2h-modes{pointer-events:none}
.w2h-modes>*{position:relative!important;left:auto!important;top:auto!important;right:auto!important;bottom:auto!important;transform:none!important;translate:none!important;margin:0!important;pointer-events:auto}
.w2h-modes .w2-chip,.w2h-modes .hs-chip,.w2h-modes .fs-chip,.w2h-modes .w2-udnote{height:30px;display:inline-flex;align-items:center;gap:5px;padding:0 11px!important;border-radius:999px!important;border:2px solid #0b0b12!important;box-shadow:0 0 0 1.5px rgba(255,255,255,.25),0 3px 0 rgba(0,0,0,.3)!important;font:900 italic 12px system-ui,sans-serif!important;letter-spacing:.04em;white-space:nowrap}
.w2h-modes .fs-round,.w2h-modes .w2-dragon-call{width:40px;height:40px;font-size:18px;border-width:2px}
.w2h-modes .w2-dragon-chip{height:30px;display:inline-flex;align-items:center}
.w2h-modes .fs-round.fs-stop{font-size:10px}
@media (pointer:coarse){.w2h-modes .w2-chip,.w2h-modes .hs-chip,.w2h-modes .w2-udnote{height:28px;font-size:11px!important;padding:0 9px!important}}

/* ── Panels under the ring ── */
.w2h-panels{pointer-events:none}
.w2h-panels>*{pointer-events:auto;position:relative!important;left:auto!important;top:auto!important;right:auto!important;bottom:auto!important;transform:none!important}

/* Top-centre compass, slim */
.w2h-compass{display:flex;gap:0;pointer-events:none}
.w2h-compass>div{position:absolute;left:0;display:flex;flex-direction:column;align-items:center;white-space:nowrap;font:800 10px system-ui,sans-serif;letter-spacing:.06em;text-shadow:0 1px 2px #000,0 0 6px rgba(0,0,0,.6)}
.w2h-compass>div i{display:block;width:2px;height:6px;background:#ffd400;margin-bottom:2px;box-shadow:0 0 0 1px #0b0b12}
.w2h-compass>div small{font-weight:600;opacity:.7}

/* Chat: small, bottom-left, fades on its own */
.w2h-chat{pointer-events:none}
.w2h-chat>div{font:600 12px system-ui,sans-serif;background:rgba(11,11,18,.6);border:2px solid #0b0b12;border-left:3px solid #20d6ff;border-radius:6px;padding:2px 8px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;animation:w2hchat 12s linear forwards}
.w2h-chat b{color:#20d6ff;margin-right:4px}
@keyframes w2hchat{0%{opacity:0;transform:translateY(4px)}3%{opacity:1;transform:none}85%{opacity:1}100%{opacity:0}}
@media (pointer:coarse){.w2h-chat>div{font-size:11px}}

/* ── Toasts: one top-centre stack ── */
.w2h-toasts{pointer-events:none;width:max-content;max-width:min(520px,calc(100vw - 24px))}
.w2h-toasts>*{position:relative!important;left:auto!important;top:auto!important;right:auto!important;bottom:auto!important;transform:none!important;translate:none!important;margin:0!important;max-width:100%}
.w2h-toasts>.w2-nowplaying{animation:w2hnp 4.5s ease-out forwards}
.w2h-toasts>.hs-toast,.w2h-toasts>.hs-prompt,.w2h-toasts>.fs-toast{animation:w2hin .25s ease-out both}
.w2h-toasts>.w2-car-status,.w2h-toasts>.w2-van-status{animation:w2hpop .35s ease-out}
.w2h-toasts>.hs-bar{flex-wrap:wrap;justify-content:center;row-gap:2px;max-width:calc(100vw - 24px)}
.w2h-combo .w2-combo-label{font-size:clamp(13px,1.6vw,18px)}
.w2h-combo .w2-combo-score{font-size:clamp(20px,2.6vw,32px)}
.w2h-combo .w2-banked{font-size:clamp(20px,3vw,36px)}
@keyframes w2hnp{0%{opacity:0;transform:translateY(-12px) rotate(-3deg)}8%{opacity:1;transform:rotate(-3deg)}85%{opacity:1}100%{opacity:0}}
@keyframes w2hpop{from{transform:scale(1.5);opacity:0}to{transform:scale(1);opacity:1}}

/* Toast cards: small, ink-edged */
.w2-nowplaying{padding:5px 12px!important;box-shadow:3px 3px 0 #ff2f8e!important;border:2px solid #0b0b12;max-width:min(420px,calc(100vw - 24px))}
.w2-nowplaying b{font-size:14px!important}
.w2-nowplaying span{font-size:9px!important}
.w2-np-stations{display:none!important}
.w2h-np{display:flex;flex-direction:row!important;align-items:center;gap:8px}
.w2h-np>div{display:flex;flex-direction:column;align-items:flex-start}
.w2h-np em{font:800 9px system-ui,sans-serif;font-style:normal;letter-spacing:.06em;opacity:.65}

/* Context prompts ("E: enter the board shop"): one small pill */
.w2-prompt{pointer-events:auto;display:inline-flex;align-items:center;gap:8px;background:#ffd400;color:#0b0b12;border:2px solid #0b0b12;box-shadow:3px 3px 0 #ff2f8e;padding:5px 12px 5px 6px;border-radius:999px;font:900 italic 14px system-ui,sans-serif;letter-spacing:.02em;white-space:nowrap;animation:w2hin .25s ease-out}
.w2-prompt kbd{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 5px;border-radius:6px;background:#0b0b12;color:#ffd400;font:900 12px system-ui,sans-serif;font-style:normal}
.w2-prompt-at{position:absolute;left:50%;transform:translateX(-50%);bottom:24%;z-index:35}
@media (pointer:coarse){.w2-prompt-at{bottom:auto;top:calc(136px + env(safe-area-inset-top))}.w2-prompt{font-size:13px}}

/* Replays (RecordsUi) when the ring isn't up */
.w2h-replay{left:12px;top:12px}
@media (pointer:coarse){.w2h-replay{left:8px;top:48px}}

/* The site's NOUN FM while the ring HUD is up: the off pill lives in the
   icon row; a playing tile moves clear of the thumb buttons on phones */
body[data-w2hud-on] [data-nounfm="off"]{display:none!important}
@media (pointer:coarse){body[data-w2hud-on] [data-nounfm]:not([data-nounfm="off"]){top:calc(48px + env(safe-area-inset-top))!important;bottom:auto!important;left:8px!important;right:auto!important}}

@keyframes w2hin{0%{opacity:0;transform:translateY(6px)}100%{opacity:1;transform:none}}
.w2-prompt-at.w2-prompt{animation:none}
@keyframes w2hfade{0%{opacity:0}10%{opacity:1}80%{opacity:1}100%{opacity:0}}
.w2h-hint{font:600 11px system-ui,sans-serif;background:rgba(11,11,18,.6);padding:4px 10px;border-radius:999px;white-space:nowrap;animation:w2hfade 7s ease forwards}

@media (prefers-reduced-motion:reduce){
  .w2h-live,.w2h-bubble,.w2h-chat>div,.w2-prompt,.w2h-hint,.w2-nowplaying,.w2-banked,.w2-speedlines,.w2h-toasts>*{animation:none!important}
  .w2h-ib{transition:none}
}
`;
