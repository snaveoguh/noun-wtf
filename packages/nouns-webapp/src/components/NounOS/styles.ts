// NounOS styles. Lives in a TS string (like the world2 HUD) so the whole shell
// is one import. Theme CSS forces `font-family` with `[data-theme] *
// {…!important}` (specificity 0,1,0) — chrome selectors here are all ≥ 0,2,0.

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='.55'/></svg>\")";

export const NOS_CSS = `
.nos-root{--ink:#060607;--paper:#ecebe4;--acid:#d4ff3a;--red:#ff3b5c;--cyan:#5ef1ff;--dim:#8d8c84;
  position:fixed;inset:0;overflow:hidden;background:var(--ink);color:var(--paper);z-index:1;
  --glass:rgba(20,21,25,.74);--glass-hi:rgba(255,255,255,.07);--glass-edge:transparent;--r:18px;
  font-weight:500;-webkit-font-smoothing:auto}
.nos-root,.nos-root *{cursor:url('/cursor-cd.png') 1 1,auto}
.nos-root a,.nos-root a *,.nos-root button,.nos-root button *,.nos-root [role=button],.nos-root label,.nos-root select,
.nos-root summary{cursor:url('/cursor-cd.png') 1 1,pointer !important}
.nos-root input,.nos-root textarea,.nos-root [contenteditable=true]{cursor:text !important}
.nos-root canvas{cursor:inherit}
.nos-root::after{content:'';position:absolute;inset:0;pointer-events:none;z-index:20;background-image:${GRAIN};
  opacity:.07;mix-blend-mode:overlay}

.nos-root .nos-titlebar,.nos-root .nos-titlebar *,.nos-root .nos-tray,.nos-root .nos-tray *,
.nos-root .nos-manifesto,.nos-root .nos-manifesto *,.nos-root .nos-dir,.nos-root .nos-dir *,
.nos-root .nos-navbar,.nos-root .nos-navbar *,.nos-root .nos-empty,.nos-root .nos-empty *,
.nos-root .nos-loading{font-family:var(--site-font) !important;text-transform:none}
.nos-root .nos-home,.nos-root .nos-home *{font-family:ui-monospace,'SF Mono',SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono',monospace !important;text-transform:none}
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
.nos-stage{position:absolute;inset:0;z-index:3;perspective:1500px;perspective-origin:50% 32%;transition:opacity .45s ease;pointer-events:none}
.mode-world .nos-stage{opacity:0}
.mode-world .nos-stage *{pointer-events:none !important}
.nos-space{position:absolute;inset:0;transform-style:preserve-3d;pointer-events:none;
  transform:rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg))}
.nos-win{position:absolute;pointer-events:auto;display:flex;flex-direction:column;border-radius:var(--r);overflow:hidden;
  background:var(--glass);backdrop-filter:blur(8px) saturate(140%);-webkit-backdrop-filter:blur(8px) saturate(140%);
  border:0;box-shadow:inset 0 1px 0 var(--glass-hi),0 30px 80px rgba(0,0,0,.5),0 8px 24px rgba(0,0,0,.3);
  animation:nos-pop .55s cubic-bezier(.2,.9,.25,1);will-change:transform}
.nos-win::before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:3;
  background:linear-gradient(160deg,rgba(255,255,255,.14),rgba(255,255,255,0) 28%,rgba(255,255,255,0) 72%,rgba(255,255,255,.06));
  mix-blend-mode:screen}
.nos-win.is-focused{background:rgba(24,25,30,.8);box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 40px 110px rgba(0,0,0,.6)}
.nos-win.is-sunk{opacity:0;pointer-events:none}
.nos-win.is-mobile{left:0 !important;right:0;top:0;bottom:64px;width:auto !important;height:auto !important;transform:none !important;border-radius:0 0 var(--r) var(--r)}
@keyframes nos-pop{from{opacity:0;scale:.92}to{opacity:1;scale:1}}
.nos-titlebar{height:38px;display:flex;align-items:center;gap:8px;padding:0 10px 0 16px;flex-shrink:0;cursor:grab;user-select:none;
  background:linear-gradient(180deg,rgba(255,255,255,.09),rgba(255,255,255,.02));
  color:rgba(236,235,228,.7);font-size:12.5px;letter-spacing:.04em;font-weight:600}
.nos-titlebar:active{cursor:grabbing}
.is-focused>.nos-titlebar{color:#fff}
.is-focused>.nos-titlebar .nos-title::before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--acid);
  box-shadow:0 0 10px var(--acid);margin-right:9px;vertical-align:1px}
.nos-title{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700}
.nos-status{font-size:10px;opacity:.7}
.nos-ctrls{display:flex;gap:6px}
.nos-ctrls button{width:22px;height:22px;border-radius:50%;border:0;background:rgba(255,255,255,.08);
  color:rgba(255,255,255,.8);font-size:12px;line-height:1;padding:0;transition:background .15s,transform .15s}
.nos-ctrls button:hover{background:rgba(255,255,255,.22);transform:scale(1.08)}
.nos-ctrls button:last-child:hover{background:var(--red);color:#fff;border-color:var(--red)}
.nos-content{flex:1;overflow:auto;position:relative;background:transparent;color:var(--paper);overscroll-behavior:contain}
.is-dark>.nos-content{background:transparent;color:var(--paper)}
.nos-haze{position:absolute;inset:0;background:#020304;pointer-events:none;transition:opacity .5s ease;z-index:4}
.nos-resize{position:absolute;right:4px;bottom:4px;width:14px;height:14px;cursor:nwse-resize;z-index:5;border-radius:0 0 10px 0;
  border-right:2px solid rgba(255,255,255,.35);border-bottom:2px solid rgba(255,255,255,.35)}
.nos-page{min-height:100%}
.nos-loading{display:flex;height:100%;min-height:200px;align-items:center;justify-content:center;color:var(--dim);font-size:12px;letter-spacing:.2em}

.nos-navbar{display:flex;gap:6px;align-items:center;padding:6px 10px;background:transparent;flex-shrink:0}
.nos-navbar button{width:26px;height:26px;border-radius:50%;border:0;background:rgba(255,255,255,.08);color:var(--paper);font-size:12px;padding:0}
.nos-navbar button:hover{border-color:var(--acid);color:var(--acid)}
.nos-proto{font-size:11px;color:var(--acid);padding:0 2px 0 6px}
.nos-navbar input{flex:1;min-width:0;height:28px;border-radius:14px;background:rgba(0,0,0,.35);color:var(--paper);border:0;font-size:13px;padding:0 12px;outline:none}
.nos-navbar input:focus{border-color:var(--acid)}

.nos-empty{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);text-align:center;pointer-events:auto}
.nos-empty .nos-wordmark{font-size:min(16vw,150px);line-height:.9;color:var(--paper);text-shadow:6px 6px 0 rgba(212,255,58,.25)}
.nos-empty p{color:var(--dim);font-size:12px;letter-spacing:.2em;margin:14px 0 22px}

/* ── shared bits ──────────────────────────────────────── */
.nos-row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.nos-btn{font-size:13px;letter-spacing:.04em;font-weight:600;padding:10px 16px;border-radius:999px;border:0;
  background:rgba(255,255,255,.08);color:var(--paper);backdrop-filter:blur(10px);transition:transform .15s,box-shadow .15s,background .15s}
.nos-btn:hover{transform:translateY(-1px);background:rgba(255,255,255,.16);box-shadow:0 6px 20px rgba(0,0,0,.35)}
.nos-btn.is-acid{background:var(--acid);color:#000;border-color:var(--acid);box-shadow:0 0 24px rgba(212,255,58,.25)}
.nos-btn.is-acid:hover{box-shadow:0 0 34px rgba(212,255,58,.45)}
.nos-input{background:rgba(0,0,0,.35);border:0;border-radius:12px;color:var(--paper);padding:9px 12px;font-size:14px;outline:none;min-width:200px}
.nos-input:focus{border-color:var(--acid)}
.nos-mono-dim{color:#a9a8a0;font-size:13px}
@keyframes nos-blink{50%{opacity:.35}}

/* ── README_CAPTURED.TXT ─────────────────────────────── */
.nos-manifesto{padding:26px 28px 34px;max-width:620px;margin:0 auto;font-size:16px;line-height:1.6;color:#e4e2d9}
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
.nos-dir{padding:20px 22px 30px;min-height:100%}
.nos-dir-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:18px;
  padding-bottom:4px}
.nos-dir .nos-wordmark{font-size:54px;line-height:.9;color:var(--paper)}
.nos-dir-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:22px}
.nos-dir-sec h2{font-size:13px !important;letter-spacing:.08em;margin:0 0 8px;padding:7px 12px;border-radius:10px;color:#000;background:var(--sec,var(--paper));font-weight:800}
.nos-dir-sec h2 span{font-weight:400;opacity:.7;letter-spacing:.06em;margin-left:6px;text-transform:lowercase}
.sec-art{--sec:var(--acid)} .sec-free{--sec:#3dff8a} .sec-gov{--sec:var(--red)} .sec-mkt{--sec:var(--cyan)} .sec-net{--sec:var(--paper)}
.nos-dir-sec ul{list-style:none !important;margin:0;padding:0}
.nos-dir-sec li button{display:flex;width:100%;gap:10px;align-items:baseline;text-align:left;background:transparent;border:0;border-radius:8px;
  padding:8px 10px;color:var(--paper)}
.nos-dir-sec li button b{min-width:130px;font-size:13.5px;letter-spacing:.02em;font-weight:700;color:var(--sec,var(--paper))}
.nos-dir-sec li button span{font-size:13px;color:#a9a8a0}
.nos-dir-sec li button:hover{background:rgba(255,255,255,.05)}
.nos-hot{font-style:normal;font-size:9px;background:var(--red);color:#fff;padding:1px 4px;margin-right:6px;animation:nos-blink 1s steps(2) infinite}
.nos-dir-foot{margin-top:26px;text-align:center}

/* ── home: agent console over the poster ──────────────── */
.nos-home{position:absolute;inset:0;z-index:2;pointer-events:none}
.nos-home .nos-poster-card,.nos-home .nos-console{pointer-events:auto}
.mode-world .nos-home{opacity:0;pointer-events:none}
.nos-poster{position:absolute;inset:-6%;overflow:hidden;pointer-events:none}
.nos-poster img{width:100%;height:100%;object-fit:cover;filter:blur(28px) brightness(.32) saturate(1.3)}
.nos-poster::after{content:'';position:absolute;inset:0;
  background:radial-gradient(110% 80% at 15% 95%,rgba(0,0,0,.85) 0%,rgba(0,0,0,.4) 45%,rgba(0,0,0,0) 75%)}
.nos-home{perspective:1400px}
.nos-poster-card{position:absolute;z-index:2;right:clamp(16px,6vw,110px);top:clamp(24px,9vh,110px);width:min(46vw,620px);aspect-ratio:5/4;
  padding:0;border:0;border-radius:22px;overflow:hidden;background:#000;transform-style:preserve-3d;
  transform:rotateY(calc(-16deg + var(--ry,0deg) * 2)) rotateX(calc(5deg + var(--rx,0deg) * 2)) translateZ(0);
  box-shadow:0 50px 120px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.14),inset 0 1px 0 rgba(255,255,255,.3);
  animation:nos-float 7s ease-in-out infinite;transition:box-shadow .3s}
.nos-poster-card img{width:100%;height:100%;object-fit:cover;display:block;filter:saturate(1.08)}
.nos-poster-card::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(115deg,rgba(255,255,255,.22) 0%,rgba(255,255,255,0) 32%,rgba(255,255,255,0) 70%,rgba(255,255,255,.08))}
.nos-poster-card:hover{box-shadow:0 60px 140px rgba(0,0,0,.75),0 0 0 1px rgba(212,255,58,.6),0 0 60px rgba(212,255,58,.25)}
.nos-poster-cta{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);z-index:2;font-size:12px;letter-spacing:.16em;font-weight:800;
  padding:10px 18px;border-radius:999px;background:rgba(212,255,58,.92);color:#000;box-shadow:0 0 26px rgba(212,255,58,.4);white-space:nowrap}
@keyframes nos-float{0%,100%{translate:0 0}50%{translate:0 -10px}}
@media (max-width:760px){.nos-poster-card{left:16px;right:16px;width:auto;top:16px;transform:rotateX(6deg)}}
.nos-console{position:absolute;left:clamp(16px,4vw,56px);bottom:calc(26vh + 70px);width:min(680px,calc(100vw - 32px));z-index:2;
  display:flex;flex-direction:column;gap:10px;max-height:calc(74vh - 120px)}
.nos-log{overflow-y:auto;scrollbar-width:none;-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 40px);mask-image:linear-gradient(to bottom,transparent 0,#000 40px);padding-top:40px}
.nos-log::-webkit-scrollbar{display:none}
.nos-line{margin:0 0 10px;white-space:pre-wrap;word-break:break-word;font-size:clamp(13px,1.1vw,15px);line-height:1.55;font-weight:500;
  color:rgba(236,235,228,.92);text-shadow:0 1px 12px rgba(0,0,0,.9);background:none;border:0;padding:0}
.nos-line.who-you{color:var(--acid)}
.nos-line.who-sys{color:var(--dim)}
.nos-action{margin:6px 0 14px;max-width:520px;padding:12px;border-radius:14px;background:rgba(10,11,13,.82);backdrop-filter:blur(8px)}
.nos-caret{color:var(--acid);animation:nos-blink .9s steps(2) infinite}
.nos-prompt{display:flex;align-items:center;gap:10px;font-size:clamp(13px,1.1vw,15px);font-weight:500;color:var(--acid)}
.nos-prompt input{flex:1;background:transparent;border:0;outline:none;color:#fff;font-size:inherit;caret-color:var(--acid);
  text-shadow:0 1px 12px rgba(0,0,0,.9)}
.nos-prompt input::placeholder{color:rgba(236,235,228,.35)}
@media (max-width:760px){.nos-console{bottom:calc(26vh + 60px);max-height:28vh}}

.nos-icon{position:absolute;z-index:7;left:16px;top:16px;width:46px;height:46px;padding:9px;border:0;border-radius:14px;
  background:var(--glass);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:inset 0 1px 0 var(--glass-hi),0 10px 30px rgba(0,0,0,.4);
  transition:transform .15s}
.nos-icon:hover{transform:scale(1.06)}
.nos-icon svg{width:100%;height:100%;display:block}
.mode-world .nos-icon{opacity:0;pointer-events:none}

/* ── 3. pond ──────────────────────────────────────────── */
.nos-water{position:absolute;left:0;bottom:0;width:100vw;z-index:1;pointer-events:none;transition:opacity .7s ease;
  -webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 64px);mask-image:linear-gradient(to bottom,transparent 0,#000 64px)}
.mode-world .nos-water{opacity:0}

/* ── 4. tray ──────────────────────────────────────────── */
.nos-tray{position:absolute;z-index:6;left:50%;bottom:14px;transform:translateX(-50%);display:flex;flex-wrap:wrap;width:max-content;justify-content:center;
  gap:6px;align-items:center;padding:6px;max-width:calc(100vw - 24px);
  border-radius:20px;background:var(--glass);backdrop-filter:blur(10px) saturate(140%);-webkit-backdrop-filter:blur(10px) saturate(140%);
  border:0;box-shadow:inset 0 1px 0 var(--glass-hi),0 18px 50px rgba(0,0,0,.5);transition:all .5s cubic-bezier(.2,.9,.25,1)}
.mode-world .nos-tray{left:auto;right:14px;transform:none;justify-content:flex-end;flex-wrap:nowrap;max-width:calc(100vw - 24px)}
@media (max-width:760px){
  .nos-tray{left:0;right:0;bottom:0;transform:none;max-width:none;width:auto;flex-wrap:nowrap;justify-content:flex-start;overflow-x:auto;
    border-width:1px 0 0;border-radius:18px 18px 0 0;padding:6px 8px calc(6px + env(safe-area-inset-bottom));scrollbar-width:none}
  .nos-tray::-webkit-scrollbar{display:none}
  .mode-world .nos-tray{top:52px;bottom:auto;left:8px;right:8px;border-width:1px;padding:4px;gap:4px}
  .nos-tray .nos-chip{padding:5px 8px;font-size:10px;flex-shrink:0}
  .nos-auction-card{display:none !important}
  .nos-win.is-mobile{bottom:46px}
}
/* Phones in the game (portrait, or landscape where the height is the
   squeeze): the tray shrinks to the brand + DESK chips, top centre, so it
   stops covering the game's HUD, touch buttons and character select. */
@media (max-width:760px),(pointer:coarse) and (max-height:520px){
  .mode-world .nos-tray{top:calc(6px + env(safe-area-inset-top));bottom:auto;left:50%;right:auto;transform:translateX(-50%);
    width:max-content;max-width:none;padding:3px;gap:3px;border-radius:14px;overflow:visible;flex-wrap:nowrap}
  .mode-world .nos-tray .nos-chip{padding:4px 8px;font-size:10px}
  .mode-world .nos-tray > :not(.is-brand):not(.is-mode){display:none !important}
}
.nos-chip{font-size:12.5px;letter-spacing:.02em;font-weight:600;padding:7px 12px;border-radius:12px;border:0;
  background:rgba(255,255,255,.06);color:var(--paper);white-space:nowrap;display:inline-flex;align-items:center;gap:6px;line-height:1.2;
  transition:background .15s,color .15s,border-color .15s}
.nos-chip:hover{background:rgba(255,255,255,.14);color:#fff}
.nos-chip.is-on{background:rgba(255,255,255,.88);color:#000;border-color:transparent}
.nos-chip.is-sunk{opacity:.45;border-style:dashed}
.nos-chip.is-dim{opacity:.5;cursor:default}
.nos-chip.is-brand{font-weight:800}
.nos-chip.is-brand .nos-glyph{color:var(--acid)}
.nos-chip.is-alert{border-color:var(--red);color:var(--red);animation:nos-blink 1.2s steps(2) infinite}
.nos-chip.is-mode{background:var(--acid);color:#000;border-color:var(--acid);font-weight:800}
.nos-key{font-size:10px;border:1px solid currentColor;border-radius:4px;padding:0 4px;line-height:1.3}
.nos-clock{font-size:11px;color:var(--dim);padding:0 6px}

.nos-auction{position:relative;display:inline-flex}
.nos-auction-thumb{width:20px;height:20px;border-radius:6px;display:inline-block;overflow:hidden;image-rendering:pixelated;background:#d5d7e1}
.nos-auction-thumb img,.nos-auction-img img{width:100%;height:100%;display:block;image-rendering:pixelated}
.nos-auction-card{position:absolute;bottom:calc(100% + 12px);left:50%;width:310px;display:flex;gap:12px;padding:12px;
  border-radius:18px;background:rgba(14,15,18,.72);backdrop-filter:blur(24px) saturate(170%);-webkit-backdrop-filter:blur(24px) saturate(170%);
  border:0;box-shadow:inset 0 1px 0 var(--glass-hi),0 20px 60px rgba(0,0,0,.55);
  opacity:0;pointer-events:none;transform:translate(-50%,8px);transition:opacity .18s,transform .18s}
.mode-world .nos-auction-card{left:auto;right:0;transform:translate(0,8px)}
.nos-auction:hover .nos-auction-card,.nos-auction:focus-within .nos-auction-card{opacity:1;pointer-events:auto;transform:translate(-50%,0)}
.mode-world .nos-auction:hover .nos-auction-card,.mode-world .nos-auction:focus-within .nos-auction-card{transform:translate(0,0)}
@media (max-width:760px){.mode-world .nos-auction-card{bottom:auto;top:calc(100% + 10px)}}
.nos-auction-card::after{content:'';position:absolute;left:0;right:0;top:100%;height:16px}
@media (max-width:760px){.mode-world .nos-auction-card::after{top:auto;bottom:100%}}
.nos-auction-img{width:120px;height:120px;flex-shrink:0;background:#d5d7e1;overflow:hidden;border-radius:12px}
.nos-auction-meta{display:flex;flex-direction:column;gap:2px;font-size:11px;color:var(--dim);min-width:0}
.nos-auction-meta b{color:var(--paper);font-size:13px;letter-spacing:.1em;margin-bottom:4px}
.nos-auction-meta strong{color:var(--acid);font-size:16px;margin-bottom:4px}
.nos-auction-meta .nos-btn{margin-top:auto;padding:6px 10px}

@media (prefers-reduced-motion:reduce){.nos-win,.nos-world,.nos-tray{transition:none !important;animation:none !important}}
`;
