// NounOS styles. Lives in a TS string (like the world2 HUD) so the whole shell
// is one import. Theme CSS forces `font-family` with `[data-theme] *
// {…!important}` (specificity 0,1,0) — chrome selectors here are all ≥ 0,2,0.

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='.55'/></svg>\")";

export const NOS_CSS = `
.nos-root{--ink:#060607;--paper:#ecebe4;--acid:#d4ff3a;--red:#ff3b5c;--cyan:#5ef1ff;--dim:#8d8c84;
  position:fixed;inset:0;overflow:hidden;background:var(--ink);color:var(--paper);z-index:1}
.nos-root::after{content:'';position:absolute;inset:0;pointer-events:none;z-index:20;background-image:${GRAIN};
  opacity:.07;mix-blend-mode:overlay}

.nos-root .nos-titlebar,.nos-root .nos-titlebar *,.nos-root .nos-tray,.nos-root .nos-tray *,
.nos-root .nos-manifesto,.nos-root .nos-manifesto *,.nos-root .nos-dir,.nos-root .nos-dir *,
.nos-root .nos-navbar,.nos-root .nos-navbar *,.nos-root .nos-empty,.nos-root .nos-empty *,
.nos-root .nos-loading{font-family:'JetBrains Mono',ui-monospace,Menlo,monospace !important;text-transform:none}
.nos-root .nos-wordmark,.nos-root .nos-wordmark *{font-family:'Pip3',system-ui,sans-serif !important;text-transform:uppercase !important}
.nos-root .nos-manifesto h1,.nos-root .nos-manifesto h1 *,.nos-root .nos-manifesto .nos-big{font-family:'Londrina Solid',system-ui,sans-serif !important}

/* ── 1. world ─────────────────────────────────────────── */
.nos-world{position:absolute;inset:0;z-index:0;transform-origin:50% 42%;
  transition:transform .8s cubic-bezier(.2,.9,.25,1),filter .8s ease}
.mode-desk .nos-world{transform:scale(.9) translateY(-3%);filter:blur(7px) brightness(.5) saturate(.8);pointer-events:none}
.nos-world-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(120% 80% at 50% 20%,#14262b 0%,#07090b 55%,#030304 100%)}
.nos-noggles{font-size:min(30vw,340px);color:rgba(212,255,58,.06);letter-spacing:-.05em;transform:translateY(-12%)}

/* ── 2. desk (3D) ─────────────────────────────────────── */
.nos-backdrop{position:absolute;inset:0;z-index:1}
.mode-world .nos-backdrop{pointer-events:none}
.nos-stage{position:absolute;inset:0;z-index:2;perspective:1500px;perspective-origin:50% 32%;transition:opacity .45s ease;pointer-events:none}
.mode-world .nos-stage{opacity:0}
.mode-world .nos-stage *{pointer-events:none !important}
.nos-space{position:absolute;inset:0;transform-style:preserve-3d;pointer-events:none;
  transform:rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg))}
.nos-win{position:absolute;pointer-events:auto;display:flex;flex-direction:column;background:#0b0b0d;
  border:1px solid rgba(236,235,228,.5);
  box-shadow:0 40px 90px rgba(0,0,0,.6),9px 9px 0 rgba(0,0,0,.7);
  animation:nos-pop .55s cubic-bezier(.2,.9,.25,1);will-change:transform}
.nos-win.is-focused{border-color:var(--acid);
  box-shadow:0 0 0 1px var(--acid),0 50px 120px rgba(0,0,0,.65),12px 12px 0 rgba(212,255,58,.18)}
.nos-win.is-sunk{opacity:0;pointer-events:none}
.nos-win.is-mobile{left:0 !important;right:0;top:0;bottom:64px;width:auto !important;height:auto !important;transform:none !important}
@keyframes nos-pop{from{opacity:0;scale:.9}to{opacity:1;scale:1}}
.nos-titlebar{height:28px;display:flex;align-items:center;gap:8px;padding:0 5px 0 10px;flex-shrink:0;cursor:grab;user-select:none;
  background:#111114 repeating-linear-gradient(90deg,transparent 0 3px,rgba(255,255,255,.04) 3px 4px);
  color:var(--paper);font-size:11px;letter-spacing:.14em;border-bottom:1px solid rgba(236,235,228,.28)}
.nos-titlebar:active{cursor:grabbing}
.is-focused>.nos-titlebar{background:var(--acid);color:#000;border-color:#000}
.nos-title{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700}
.nos-status{font-size:10px;opacity:.7}
.nos-ctrls{display:flex}
.nos-ctrls button{width:22px;height:20px;margin-left:4px;border:1px solid currentColor;background:transparent;color:inherit;
  font-size:12px;line-height:1;cursor:pointer;padding:0}
.nos-ctrls button:hover{background:currentColor}
.nos-ctrls button:hover{color:inherit;filter:invert(1)}
.nos-content{flex:1;overflow:auto;position:relative;background:#000;color:var(--paper);overscroll-behavior:contain}
.is-dark>.nos-content{background:#000;color:var(--paper)}
.nos-haze{position:absolute;inset:0;background:#020304;pointer-events:none;transition:opacity .5s ease}
.nos-resize{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;
  background:linear-gradient(135deg,transparent 50%,rgba(236,235,228,.7) 50% 57%,transparent 57% 70%,rgba(236,235,228,.7) 70% 77%,transparent 77%)}
.nos-page{min-height:100%}
.nos-loading{display:flex;height:100%;min-height:200px;align-items:center;justify-content:center;color:var(--dim);font-size:12px;letter-spacing:.2em}

.nos-navbar{display:flex;gap:4px;align-items:center;padding:4px 6px;background:#151518;border-bottom:1px solid rgba(236,235,228,.2);flex-shrink:0}
.nos-navbar button{width:26px;height:22px;border:1px solid rgba(236,235,228,.35);background:transparent;color:var(--paper);font-size:12px;cursor:pointer;padding:0}
.nos-navbar button:hover{border-color:var(--acid);color:var(--acid)}
.nos-proto{font-size:11px;color:var(--acid);padding:0 2px 0 6px}
.nos-navbar input{flex:1;min-width:0;height:22px;background:#000;color:var(--paper);border:1px solid rgba(236,235,228,.25);font-size:12px;padding:0 6px;outline:none}
.nos-navbar input:focus{border-color:var(--acid)}

.nos-empty{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);text-align:center;pointer-events:auto}
.nos-empty .nos-wordmark{font-size:min(16vw,150px);line-height:.9;color:var(--paper);text-shadow:6px 6px 0 rgba(212,255,58,.25)}
.nos-empty p{color:var(--dim);font-size:12px;letter-spacing:.2em;margin:14px 0 22px}

/* ── shared bits ──────────────────────────────────────── */
.nos-row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.nos-btn{font-size:12px;letter-spacing:.12em;padding:10px 14px;border:1px solid var(--paper);background:transparent;color:var(--paper);
  cursor:pointer;transition:transform .12s,box-shadow .12s}
.nos-btn:hover{transform:translate(-2px,-2px);box-shadow:4px 4px 0 var(--paper)}
.nos-btn.is-acid{background:var(--acid);color:#000;border-color:var(--acid)}
.nos-btn.is-acid:hover{box-shadow:4px 4px 0 var(--paper)}
.nos-input{background:#000;border:1px solid rgba(236,235,228,.35);color:var(--paper);padding:8px 10px;font-size:12px;outline:none;min-width:200px}
.nos-input:focus{border-color:var(--acid)}
.nos-mono-dim{color:var(--dim);font-size:11px;letter-spacing:.08em}
@keyframes nos-blink{50%{opacity:.35}}

/* ── README_CAPTURED.TXT ─────────────────────────────── */
.nos-manifesto{padding:26px 28px 34px;max-width:620px;margin:0 auto;font-size:14px;line-height:1.65;color:#d9d7cd}
.nos-manifesto h1{font-size:clamp(46px,9vw,78px);line-height:.86;font-weight:900;color:var(--paper);margin:14px 0 22px;letter-spacing:.01em}
.nos-stamp{display:inline-block;color:var(--red);border:4px solid var(--red);padding:2px 10px 0;transform:rotate(-4deg);margin-top:8px;
  box-shadow:0 0 0 2px #000,0 0 30px rgba(255,59,92,.35)}
.nos-manifesto p{margin:0 0 14px}
.nos-manifesto b{color:var(--paper);background:rgba(255,59,92,.22);padding:0 3px}
.nos-big{font-size:30px !important;line-height:1.05;color:var(--acid) !important;margin:20px 0 !important}
.nos-tenets{list-style:none !important;padding:14px 0;margin:18px 0;border-top:1px dashed rgba(236,235,228,.3);border-bottom:1px dashed rgba(236,235,228,.3)}
.nos-tenets li{padding:3px 0;color:var(--paper)}
.nos-manifesto .nos-row{justify-content:flex-start;margin:20px 0}

/* ── INDEX ─────────────────────────────────────────────── */
.nos-dir{padding:20px 22px 30px;min-height:100%;
  background:#050506 linear-gradient(rgba(236,235,228,.035) 1px,transparent 1px) 0 0/100% 22px}
.nos-dir-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:18px;
  padding-bottom:14px;border-bottom:2px solid var(--paper)}
.nos-dir .nos-wordmark{font-size:54px;line-height:.9;color:var(--paper)}
.nos-dir-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:22px}
.nos-dir-sec h2{font-size:13px !important;letter-spacing:.18em;margin:0 0 8px;padding:6px 8px;color:#000;background:var(--sec,var(--paper));font-weight:800}
.nos-dir-sec h2 span{font-weight:400;opacity:.7;letter-spacing:.06em;margin-left:6px;text-transform:lowercase}
.sec-art{--sec:var(--acid)} .sec-gov{--sec:var(--red)} .sec-mkt{--sec:var(--cyan)} .sec-net{--sec:var(--paper)}
.nos-dir-sec ul{list-style:none !important;margin:0;padding:0}
.nos-dir-sec li button{display:flex;width:100%;gap:10px;align-items:baseline;text-align:left;background:transparent;border:0;
  border-bottom:1px dotted rgba(236,235,228,.18);padding:7px 6px;color:var(--paper);cursor:pointer}
.nos-dir-sec li button b{min-width:130px;font-size:12px;letter-spacing:.08em;color:var(--sec,var(--paper))}
.nos-dir-sec li button span{font-size:11px;color:var(--dim)}
.nos-dir-sec li button:hover{background:var(--sec,var(--paper))}
.nos-dir-sec li button:hover b,.nos-dir-sec li button:hover span{color:#000}
.nos-hot{font-style:normal;font-size:9px;background:var(--red);color:#fff;padding:1px 4px;margin-right:6px;animation:nos-blink 1s steps(2) infinite}
.nos-dir-foot{margin-top:26px;text-align:center}

/* ── 3. pond ──────────────────────────────────────────── */
.nos-water{position:absolute;left:0;bottom:0;width:100vw;z-index:1;pointer-events:none;transition:opacity .7s ease;
  -webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 64px);mask-image:linear-gradient(to bottom,transparent 0,#000 64px)}
.mode-world .nos-water{opacity:0}

/* ── 4. tray ──────────────────────────────────────────── */
.nos-tray{position:absolute;z-index:6;left:50%;bottom:14px;transform:translateX(-50%);display:flex;flex-wrap:wrap;width:max-content;justify-content:center;
  gap:6px;align-items:center;padding:6px;max-width:calc(100vw - 24px);
  background:rgba(5,6,7,.78);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(236,235,228,.35);
  box-shadow:6px 6px 0 rgba(0,0,0,.6);transition:all .5s cubic-bezier(.2,.9,.25,1)}
.mode-world .nos-tray{left:auto;right:14px;transform:none;justify-content:flex-end;flex-wrap:nowrap;max-width:calc(100vw - 24px)}
@media (max-width:760px){
  .nos-tray{left:0;right:0;bottom:0;transform:none;max-width:none;width:auto;flex-wrap:nowrap;justify-content:flex-start;overflow-x:auto;
    border-width:1px 0 0;padding:6px 8px calc(6px + env(safe-area-inset-bottom));scrollbar-width:none}
  .nos-tray::-webkit-scrollbar{display:none}
  .mode-world .nos-tray{top:52px;bottom:auto;left:8px;right:8px;border-width:1px;padding:4px;gap:4px}
  .nos-tray .nos-chip{padding:5px 8px;font-size:10px;flex-shrink:0}
  .nos-auction-card{display:none !important}
  .nos-win.is-mobile{bottom:46px}
}
.nos-chip{font-size:11px;letter-spacing:.08em;padding:6px 10px;border:1px solid rgba(236,235,228,.35);background:transparent;color:var(--paper);
  white-space:nowrap;cursor:pointer;display:inline-flex;align-items:center;gap:6px;line-height:1.2}
.nos-chip:hover{border-color:var(--acid);color:var(--acid)}
.nos-chip.is-on{background:var(--paper);color:#000;border-color:var(--paper)}
.nos-chip.is-sunk{opacity:.45;border-style:dashed}
.nos-chip.is-dim{opacity:.5;cursor:default}
.nos-chip.is-brand{font-weight:800}
.nos-chip.is-brand .nos-glyph{color:var(--acid)}
.nos-chip.is-alert{border-color:var(--red);color:var(--red);animation:nos-blink 1.2s steps(2) infinite}
.nos-chip.is-mode{background:var(--acid);color:#000;border-color:var(--acid);font-weight:800}
.nos-key{font-size:10px;border:1px solid currentColor;padding:0 4px;line-height:1.3}
.nos-clock{font-size:11px;color:var(--dim);padding:0 6px}

.nos-auction{position:relative;display:inline-flex}
.nos-auction-thumb{width:20px;height:20px;display:inline-block;overflow:hidden;image-rendering:pixelated;background:#d5d7e1}
.nos-auction-thumb img,.nos-auction-img img{width:100%;height:100%;display:block;image-rendering:pixelated}
.nos-auction-card{position:absolute;bottom:calc(100% + 12px);left:50%;width:310px;display:flex;gap:12px;padding:12px;
  background:#060607;border:1px solid var(--acid);box-shadow:8px 8px 0 rgba(212,255,58,.2);
  opacity:0;pointer-events:none;transform:translate(-50%,8px);transition:opacity .18s,transform .18s}
.mode-world .nos-auction-card{left:auto;right:0;transform:translate(0,8px)}
.nos-auction:hover .nos-auction-card,.nos-auction:focus-within .nos-auction-card{opacity:1;pointer-events:auto;transform:translate(-50%,0)}
.mode-world .nos-auction:hover .nos-auction-card,.mode-world .nos-auction:focus-within .nos-auction-card{transform:translate(0,0)}
@media (max-width:760px){.mode-world .nos-auction-card{bottom:auto;top:calc(100% + 10px)}}
.nos-auction-img{width:120px;height:120px;flex-shrink:0;background:#d5d7e1;overflow:hidden}
.nos-auction-meta{display:flex;flex-direction:column;gap:2px;font-size:11px;color:var(--dim);min-width:0}
.nos-auction-meta b{color:var(--paper);font-size:13px;letter-spacing:.1em;margin-bottom:4px}
.nos-auction-meta strong{color:var(--acid);font-size:16px;margin-bottom:4px}
.nos-auction-meta .nos-btn{margin-top:auto;padding:6px 10px}

@media (prefers-reduced-motion:reduce){.nos-win,.nos-world,.nos-tray{transition:none !important;animation:none !important}}
`;
