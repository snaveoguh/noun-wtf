// ── The HUD's CSS (GTA-style corners, icon buttons, toasts) ─────────────
//
// `w2h-` classes are this HUD's own. A few shared classes from older HUD
// pieces are restyled here too (.w2-nowplaying toasts, .w2-respect, the
// missions tracker, prompts), so every corner reads as one system.
// Motion: every animation here is a fade or a small slide, and all of it
// stops under prefers-reduced-motion.

export const HUD_CSS = `
.w2h-num{font-family:'Londrina Solid',system-ui,sans-serif;font-style:italic;font-weight:900;font-variant-numeric:tabular-nums;line-height:1;color:#fff;-webkit-text-stroke:0;text-shadow:2px 2px 0 #0b0b12,-1px -1px 0 #0b0b12,1px -1px 0 #0b0b12,-1px 1px 0 #0b0b12}
.w2h-small{font:800 9px/1 system-ui,sans-serif;letter-spacing:.12em;opacity:.85;text-shadow:0 1px 2px #000}

/* Round icon buttons */
.w2h-ib{position:relative;pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:rgba(11,11,18,.62);border:2px solid #0b0b12;box-shadow:0 0 0 1.5px rgba(255,255,255,.28),0 3px 0 rgba(0,0,0,.35);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:0;color:#fff;transition:transform .08s,box-shadow .15s}
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
@media (pointer:coarse){.w2h-ib{width:34px;height:34px}}

/* Top-right: score, wallet, system row */
.w2h-score{display:flex;align-items:baseline;gap:6px;justify-content:flex-end}
.w2h-score .w2h-num{font-size:26px}
.w2h-score small{font:800 10px system-ui,sans-serif;letter-spacing:.1em;opacity:.75;text-shadow:0 1px 2px #000}
.w2h-wallet{display:flex;align-items:center;gap:8px;justify-content:flex-end}
.w2h-coin{display:flex;align-items:center;gap:4px}
.w2h-coin .w2h-num{font-size:19px;color:#ffd400}
.w2h-row{display:flex;align-items:center;gap:6px;justify-content:flex-end}
.w2h-fps{font:600 9px ui-monospace,monospace;opacity:.55;text-shadow:0 1px 2px #000}
@media (pointer:coarse){.w2h-score .w2h-num{font-size:20px}.w2h-coin .w2h-num{font-size:16px}}

/* Respect, compact: icon, tier, a thin bar */
.w2-respect.w2-chip{gap:5px;padding:2px 8px 2px 4px;border:2px solid #0b0b12;box-shadow:0 0 0 1.5px rgba(255,255,255,.25);background:rgba(11,11,18,.6)}
.w2-respect .w2-respect-tier{font-size:12px}
.w2-respect .w2-respect-bar{width:34px;height:4px}
.w2-respect .w2-respect-score{font-size:10px}
@media (pointer:coarse){.w2-respect .w2-respect-score{display:none}.w2-respect .w2-respect-tier{font-size:11px}}

/* Bottom-left: the round minimap with the speed ring + the stat rail */
.w2h-cluster{display:flex;align-items:flex-end;gap:8px}
.w2h-ring{position:relative;flex:none}
.w2h-ring>svg.w2h-arc{position:absolute;inset:0;pointer-events:none;z-index:2;overflow:visible}
.w2h-ring .w2-minimap{position:absolute!important;inset:7px!important;left:7px!important;bottom:7px!important;width:auto!important;height:auto!important;border-radius:50%!important;border:3px solid #0b0b12!important;box-shadow:0 0 0 2px rgba(255,255,255,.5)!important}
.w2h-ring .w2-minimap-key{right:50%!important;top:auto!important;bottom:4px!important;transform:translateX(50%);border-radius:4px}
.w2h-void{position:absolute;inset:7px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#cfe9ff,#6aa9d8);border:3px solid #0b0b12;display:flex;align-items:center;justify-content:center}
.w2h-rail{display:flex;flex-direction:column;gap:5px;padding-bottom:6px}
.w2h-stat{display:flex;align-items:center;gap:5px;white-space:nowrap}
.w2h-speed .w2h-num{font-size:30px}
.w2h-stat .w2h-num.w2h-sm{font-size:15px}
.w2h-dot{width:7px;height:7px;border-radius:50%;border:1.5px solid #0b0b12;background:#8a8f99}
.w2h-dot.w2h-up{background:#3ddc84}
@media (pointer:coarse){.w2h-speed .w2h-num{font-size:22px}.w2h-rail{gap:3px;padding-bottom:4px}}

/* Top-centre compass, slim */
.w2h-compass{display:flex;gap:0;pointer-events:none}
.w2h-compass>div{position:absolute;left:0;display:flex;flex-direction:column;align-items:center;white-space:nowrap;font:800 10px system-ui,sans-serif;letter-spacing:.06em;text-shadow:0 1px 2px #000,0 0 6px rgba(0,0,0,.6)}
.w2h-compass>div i{display:block;width:2px;height:6px;background:#ffd400;margin-bottom:2px;box-shadow:0 0 0 1px #0b0b12}
.w2h-compass>div small{font-weight:600;opacity:.7}

/* Chat: small, fades on its own */
.w2h-chat>div{font:600 12px system-ui,sans-serif;background:rgba(11,11,18,.55);border-left:3px solid #20d6ff;border-radius:4px;padding:2px 8px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;animation:w2hchat 12s linear forwards}
.w2h-chat b{color:#20d6ff;margin-right:4px}
@keyframes w2hchat{0%{opacity:0;transform:translateY(4px)}3%{opacity:1;transform:none}85%{opacity:1}100%{opacity:0}}
@media (pointer:coarse){.w2h-chat>div{font-size:11px}}

/* Combo: the trick name as a toast, the score under it */
.w2h-combo .w2-combo-label{font-size:clamp(13px,1.6vw,18px)}
.w2h-combo .w2-combo-score{font-size:clamp(20px,2.6vw,32px)}
.w2h-combo .w2-banked{font-size:clamp(20px,3vw,36px)}

/* Toasts: small cards, fade */
.w2-nowplaying{padding:5px 12px!important;box-shadow:3px 3px 0 #ff2f8e!important;border:2px solid #0b0b12;max-width:min(420px,calc(100vw - 24px))}
.w2-nowplaying b{font-size:14px!important}
.w2-nowplaying span{font-size:9px!important}
.w2-np-stations{display:none!important}
.w2h-np{display:flex;align-items:center;gap:8px}
.w2h-np>div{display:flex;flex-direction:column;align-items:flex-start}
.w2h-np em{font:800 9px system-ui,sans-serif;font-style:normal;letter-spacing:.06em;opacity:.65}

/* Context prompts ("E: enter the board shop"): one small pill */
.w2-prompt{pointer-events:auto;display:inline-flex;align-items:center;gap:8px;background:#ffd400;color:#0b0b12;border:2px solid #0b0b12;box-shadow:3px 3px 0 #ff2f8e;padding:5px 12px 5px 6px;border-radius:999px;font:900 italic 14px system-ui,sans-serif;letter-spacing:.02em;white-space:nowrap;animation:w2hin .25s ease-out}
.w2-prompt kbd{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 5px;border-radius:6px;background:#0b0b12;color:#ffd400;font:900 12px system-ui,sans-serif;font-style:normal}
.w2-prompt-at{position:absolute;left:50%;transform:translateX(-50%);bottom:24%;z-index:35}
@media (pointer:coarse){.w2-prompt-at{bottom:auto;top:calc(136px + env(safe-area-inset-top))}.w2-prompt{font-size:13px}}

/* Top-left row: missions (MissionsUi), replays (RecordsUi), cargo (TradeUi) */
.w2h-replay{left:52px;top:12px}
@media (pointer:coarse){.w2h-replay{left:46px;top:48px}}

@keyframes w2hin{0%{opacity:0;transform:translateY(6px)}100%{opacity:1;transform:none}}
.w2-prompt-at.w2-prompt{animation:none}
@keyframes w2hfade{0%{opacity:0}10%{opacity:1}80%{opacity:1}100%{opacity:0}}
.w2h-hint{font:600 11px system-ui,sans-serif;background:rgba(11,11,18,.6);padding:4px 10px;border-radius:999px;white-space:nowrap;animation:w2hfade 7s ease forwards}

@media (prefers-reduced-motion:reduce){
  .w2h-live,.w2h-bubble,.w2h-chat>div,.w2-prompt,.w2h-hint,.w2-nowplaying,.w2-banked,.w2-speedlines{animation:none!important}
  .w2h-ib{transition:none}
}
`;
