// Homescreen styles (same TS-string convention as ../styles.ts). Theme CSS
// forces fonts with `[data-theme] * {…!important}` (0,1,0), so every font
// rule here is ≥ 0,2,0 and !important. The intro and the dialogs render in
// portals on <body>, outside .nos-root, so they're prefixed with `body`.

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='.6'/></svg>\")";

const UI = "'Figtree',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif";
const DISPLAY = "'Londrina Solid','Pip3',system-ui,sans-serif";
const PIP3 = "'Pip3','Londrina Solid',system-ui,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,'SF Mono',Menlo,monospace";

export const HOME_CSS = `
.nh{--bg:#07070a;--tx:#f4f2ea;--dim:#9b998f;--acid:#d4ff3a;--pink:#ff2f8e;--cyan:#20d6ff;--ink:#0b0b0f;
  --gut:clamp(16px,4vw,56px);--cw:clamp(148px,13.6vw,204px);--hh:68px;
  position:absolute;inset:0;z-index:2;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;
  background:var(--bg);color:var(--tx);scrollbar-width:thin;scrollbar-color:#2a2a30 transparent;
  transition:opacity .5s ease}
.mode-world .nh{opacity:0;pointer-events:none}
.nh.is-intro{overflow:hidden}
.nos-root .nh,.nos-root .nh *{font-family:${UI} !important;text-transform:none;letter-spacing:normal}
.nos-root .nh .nh-wordmark,.nos-root .nh .nh-gtitle,.nos-root .nh .nh-gtitle *{font-family:${PIP3} !important;text-transform:uppercase !important}
.nos-root .nh .nh-title,.nos-root .nh .nh-cover-tag span,.nos-root .nh .nh-plus,.nos-root .nh .nh-hot,.nos-root .nh .nh-shelf-head h2{font-family:${DISPLAY} !important}
.nos-root .nh .nh-url,.nos-root .nh .nh-label,.nos-root .nh .nh-eyebrow,.nos-root .nh .nh-eyebrow *,.nos-root .nh .nh-strapline,
.nos-root .nh .nh-count,.nos-root .nh kbd,.nos-root .nh .nh-agent-log,.nos-root .nh .nh-agent-log *,.nos-root .nh .nh-agent-prompt *,
.nos-root .nh .nh-drop em,.nos-root .nh .nh-tape,.nos-root .nh .nh-band,.nos-root .nh .nh-band *,.nos-root .nh .nh-foot span{font-family:${MONO} !important}
.nh button{font:inherit;color:inherit}
.nh ::selection{background:var(--acid);color:#000}

/* ── header ─────────────────────────────────────────── */
.nh-head{position:sticky;top:0;z-index:30;height:var(--hh);margin-bottom:calc(var(--hh) * -1);display:flex;align-items:center;gap:22px;
  padding:0 var(--gut) 0 72px;background:linear-gradient(180deg,rgba(0,0,0,.72),rgba(0,0,0,0));transition:background .35s ease,box-shadow .35s}
.nh.is-scrolled .nh-head{background:rgba(7,7,10,.88);backdrop-filter:blur(14px) saturate(150%);-webkit-backdrop-filter:blur(14px) saturate(150%);
  box-shadow:0 1px 0 rgba(255,255,255,.06),0 12px 30px rgba(0,0,0,.4)}
.nh-brand{display:flex;align-items:baseline;gap:9px;color:var(--tx);text-decoration:none;flex-shrink:0}
/* Quiet lockup: dark grey letters; a light band sweeps across on hover */
.nh-wordmark{font-size:14px;line-height:1;letter-spacing:.06em;text-shadow:none;color:#34343b;
  background:linear-gradient(100deg,#34343b 0 40%,#d9d9e0 50%,#34343b 60% 100%) 100% 0/250% 100% no-repeat;
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.nh-brand:hover .nh-wordmark,.nh-brand:focus-visible .nh-wordmark{animation:nh-shimmer .9s ease-out both}
@keyframes nh-shimmer{from{background-position:100% 0}to{background-position:0 0}}
.nh-nav{display:flex;gap:2px;flex:1;min-width:0}
.nh-nav button{border:0;background:none;padding:8px 10px;border-radius:8px;font-size:14px;font-weight:600;color:rgba(244,242,234,.78);cursor:pointer;white-space:nowrap;transition:color .15s,background .15s}
.nh-nav button:hover{color:#fff;background:rgba(255,255,255,.08)}
.nh :focus-visible{outline:3px solid var(--acid);outline-offset:3px;border-radius:8px}
@media (max-width:1180px){.nh-nav{display:none}.nh-head{justify-content:space-between}}

/* ask bar */
.nh-ask{position:relative;margin-left:auto;width:min(380px,34vw);flex-shrink:0}
.nh-ask-toggle{display:none}
.nh-ask-form{display:flex;align-items:center;gap:9px;height:42px;padding:0 10px 0 13px;border-radius:999px;
  background:rgba(12,12,16,.62);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);transition:box-shadow .2s,background .2s}
.nh-ask-form:focus-within{background:rgba(12,12,16,.92);box-shadow:inset 0 0 0 1.5px var(--acid),0 0 0 4px rgba(212,255,58,.12)}
.nh-ask-icon{width:17px;height:17px;color:var(--dim);flex-shrink:0}
/* !important: the site theme's global input style adds its own box + background here */
.nh .nh-ask-form input{flex:1;min-width:0;height:100%;background:none !important;border:0 !important;box-shadow:none !important;border-radius:0 !important;
  outline:none;color:#fff;font-size:14.5px;padding:0 0 0 4px !important;margin:0 !important}
.nh-ask-form input::placeholder{color:rgba(244,242,234,.45)}
.nh-ask-form:focus-within .nh-ask-icon{color:var(--acid)}
.nh kbd{font-size:11px;color:var(--dim);border:1px solid rgba(255,255,255,.18);border-radius:5px;padding:1px 6px;line-height:1.4}
.nh-ask-form:focus-within kbd{display:none}
.nh-drop{position:absolute;right:0;top:calc(100% + 8px);width:max(100%,420px);max-width:calc(100vw - 24px);padding:6px;border-radius:16px;
  background:rgba(16,16,21,.97);box-shadow:0 0 0 1px rgba(255,255,255,.1),0 30px 70px rgba(0,0,0,.65);z-index:5;animation:nh-in .16s ease-out}
.nh-drop>button{display:grid;grid-template-columns:1fr auto;gap:1px 12px;width:100%;text-align:left;border:0;background:none;padding:9px 12px;border-radius:10px;cursor:pointer}
.nh-drop>button b{font-size:14px;font-weight:700;color:#fff}
.nh-drop>button span{grid-column:1;font-size:12.5px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nh-drop>button em{grid-row:1/3;grid-column:2;align-self:center;font-style:normal;font-size:10px;color:var(--dim);letter-spacing:.06em}
.nh-drop>button.is-sel{background:rgba(255,255,255,.08)}
.nh-drop>button.nh-drop-ask{margin-top:4px;box-shadow:inset 0 1px 0 rgba(255,255,255,.07);border-radius:0 0 10px 10px}
.nh-drop>button.nh-drop-ask b{color:var(--acid)}
.nh-drop.is-hint{padding:12px}
.nh-drop-h{display:block;font-size:11px;color:var(--dim);margin:0 0 8px 2px;text-transform:uppercase !important;letter-spacing:.12em}
.nh-sugg{display:flex;flex-wrap:wrap;gap:6px}
.nh-sugg button{border:0;border-radius:999px;padding:7px 12px;font-size:13px;background:rgba(255,255,255,.07);cursor:pointer}
.nh-sugg button:hover{background:rgba(212,255,58,.9);color:#000}
.nh-agent{position:absolute;right:0;top:calc(100% + 8px);width:min(460px,calc(100vw - 24px));max-height:min(60vh,520px);display:flex;flex-direction:column;
  border-radius:18px;background:rgba(12,12,16,.97);box-shadow:0 0 0 1px rgba(255,255,255,.1),0 30px 80px rgba(0,0,0,.7);z-index:4;overflow:hidden;animation:nh-in .2s ease-out}
.nh-agent-head{display:flex;align-items:center;gap:8px;padding:10px 10px 10px 16px;border-bottom:1px solid rgba(255,255,255,.07)}
.nh-agent-head b{flex:1;font-size:13px;color:var(--acid)}
.nh-agent-head button{border:0;background:rgba(255,255,255,.07);border-radius:999px;padding:5px 10px;font-size:12px;cursor:pointer}
.nh-agent-head button:hover{background:rgba(255,255,255,.16)}
.nh-agent-log{flex:1;overflow-y:auto;padding:12px 16px}
.nh-agent-log p{margin:0 0 10px;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.55;color:rgba(244,242,234,.92)}
.nh-agent-log p.who-you{color:var(--acid)}
.nh-agent-log p.who-sys{color:var(--dim)}
.nh-caret{color:var(--acid);animation:nh-blink .9s steps(2) infinite}
.nh-agent-action{margin:6px 0 10px}
.nh-agent-prompt{display:flex;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid rgba(255,255,255,.07);color:var(--acid)}
.nh-agent-prompt input{flex:1;background:none;border:0;outline:none;color:#fff;font-size:13px}
@media (max-width:760px){
  .nh{--hh:60px;--cw:clamp(118px,33vw,150px)}
  .nh-head{padding:0 12px 0 72px;gap:10px}
  /* phones: the dark-grey lockup disappears on small screens; quiet white instead */
  .nh-wordmark{font-size:12px;background:none;-webkit-text-fill-color:rgba(255,255,255,.5);color:rgba(255,255,255,.5)}
  .nh-brand:hover .nh-wordmark{animation:none}
  .nh-ask{width:auto;position:static}
  .nh-ask-toggle{display:grid;place-items:center;width:42px;height:42px;border-radius:50%;border:0;background:rgba(12,12,16,.6);
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);cursor:pointer}
  .nh-ask-toggle svg{width:19px;height:19px}
  .nh-ask-form{display:none}
  .nh-ask.is-expanded .nh-ask-toggle{display:none}
  .nh-ask.is-expanded .nh-ask-form{display:flex;position:absolute;left:10px;right:10px;top:9px;z-index:3;background:rgba(12,12,16,.98)}
  .nh-drop,.nh-agent{left:10px;right:10px;width:auto;top:calc(var(--hh) + 2px)}
  .nh-ask kbd{display:none}
}

/* ── hero ───────────────────────────────────────────── */
.nh-hero{position:relative;z-index:1}
.nh-hero-frame{position:relative;height:clamp(480px,72vh,700px);overflow:hidden;background:#000;transform-origin:50% 0;
  transition:transform .7s cubic-bezier(.2,.8,.2,1),box-shadow .7s}
.nh-hero:hover .nh-hero-frame{transform:scale(1.012)}
.nh-hero-slide{position:absolute;inset:0;opacity:0;transition:opacity 1s ease}
.nh-hero-slide.is-on{opacity:1}
.nh-hero-slide img,.nh-hero-slide video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scale(1.05);filter:saturate(1.08);
  transition:filter .6s,transform 1.2s cubic-bezier(.2,.8,.2,1)}
.nh-hero-slide.is-clip img,.nh-hero-slide video{transform:none}
.nh-hero-slide.is-on:not(.is-clip) img{animation:nh-kb 22s cubic-bezier(.3,.1,.3,1) forwards}
.nh-hero:hover .nh-hero-slide.is-on img,.nh-hero:hover .nh-hero-slide.is-on video{filter:saturate(1.2) brightness(1.06)}
.nh-hero:hover .nh-hero-slide.is-clip.is-on video{transform:scale(1.03)}
@keyframes nh-kb{from{transform:scale(1.05) translate3d(0,0,0)}to{transform:scale(1.18) translate3d(-2.2%,-1.6%,0)}}
.nh-hero-shade{position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(90deg,rgba(7,7,10,.94) 0%,rgba(7,7,10,.72) 28%,rgba(7,7,10,.15) 58%,rgba(7,7,10,0) 75%),
    linear-gradient(0deg,var(--bg) 0%,rgba(7,7,10,.6) 16%,rgba(7,7,10,0) 42%),
    linear-gradient(180deg,rgba(7,7,10,.55) 0%,rgba(7,7,10,0) 22%)}
.nh-hero-frame::after{content:'';position:absolute;inset:0;pointer-events:none;background-image:${GRAIN};opacity:.08;mix-blend-mode:overlay}
.nh-hero-copy{position:absolute;left:var(--gut);bottom:clamp(64px,10vh,120px);width:min(560px,calc(100% - 2 * var(--gut)));z-index:2;
  animation:nh-rise .8s cubic-bezier(.2,.8,.2,1) both}
.nh-eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:11.5px;font-weight:700;letter-spacing:.18em !important;color:rgba(244,242,234,.86)}
.nh-eyebrow b{color:#ff3b3b;letter-spacing:-.04em}
.nh-eyebrow span{color:var(--dim);font-weight:500;margin-left:4px}
.nh-hero h1{margin:14px 0 18px;line-height:1}
.nh-gtitle{display:inline-flex;flex-direction:column;font-size:clamp(52px,6.8vw,108px);line-height:.84;color:#fff;transform:rotate(-3deg);transform-origin:0 100%;
  -webkit-text-stroke:.07em var(--ink);paint-order:stroke fill;
  text-shadow:.045em .045em 0 var(--pink),.09em .09em 0 var(--cyan),.13em .13em 0 var(--ink)}
.nh-gtitle .is-acc{color:var(--acc,#ffd400);margin-left:.08em}
.nh-strapline{display:inline-block;font-size:12.5px;font-weight:800;letter-spacing:.16em !important;color:var(--acc,var(--acid));
  background:var(--ink);padding:6px 12px 5px;box-shadow:4px 4px 0 var(--pink);margin-bottom:14px}
.nh-hero-copy p{margin:0 0 24px;font-size:clamp(15px,1.25vw,17.5px);line-height:1.5;color:rgba(244,242,234,.9);text-shadow:0 1px 18px rgba(0,0,0,.8);max-width:500px}
.nh-hero-cta{display:flex;gap:12px;flex-wrap:wrap}
.nh .nh-play,body .nh-modal .nh-play{display:inline-flex;align-items:center;gap:10px;border:0;border-radius:10px;padding:13px 26px 13px 22px;
  background:#fff;color:#000;font-size:16px;font-weight:800;letter-spacing:.06em;cursor:pointer;
  transition:transform .15s,background .15s,box-shadow .2s}
.nh .nh-play:hover,body .nh-modal .nh-play:hover{background:var(--acid);transform:translateY(-1px);box-shadow:0 10px 30px rgba(212,255,58,.3)}
.nh .nh-play:disabled{opacity:.6;cursor:wait}
.nh-more{display:inline-flex;align-items:center;gap:9px;border:0;border-radius:10px;padding:13px 22px;background:rgba(120,120,128,.42);
  color:#fff;font-size:16px;font-weight:700;letter-spacing:.04em;cursor:pointer;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);transition:background .15s}
.nh-more:hover{background:rgba(150,150,158,.55)}
.nh-hero-side{position:absolute;right:0;bottom:clamp(64px,10vh,120px);display:flex;align-items:center;gap:12px;z-index:2}
.nh-sound{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;border:0;background:rgba(0,0,0,.35);
  box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.55);color:#fff;cursor:pointer;transition:background .15s,box-shadow .15s}
.nh-sound:hover{background:rgba(255,255,255,.12);box-shadow:inset 0 0 0 1.5px #fff}
.nh-sound.is-on{box-shadow:inset 0 0 0 1.5px var(--acid);color:var(--acid)}
.nh-sound svg{width:22px;height:22px}
.nh-tap-hint{align-self:center;margin-right:10px;font-size:12px;font-weight:700;letter-spacing:.06em;color:var(--acid);white-space:nowrap;animation:nh-hint 1.6s ease-in-out infinite}
@keyframes nh-hint{0%,100%{opacity:.55}50%{opacity:1}}
.nh-hero-side::after{content:'CC0 · FREE TO PLAY';font-family:${MONO};font-size:11px;font-weight:700;letter-spacing:.12em;color:#fff;
  padding:9px 30px 9px 14px;background:rgba(40,40,46,.6);border-left:3px solid rgba(255,255,255,.7);white-space:nowrap}
.nh-pips{position:absolute;right:var(--gut);bottom:clamp(30px,6vh,60px);display:flex;gap:7px;z-index:2}
.nh-pips button{width:32px;height:16px;border:0;padding:6px 0;background:none;cursor:pointer}
.nh-pips button i{display:block;height:3px;border-radius:2px;background:rgba(255,255,255,.28);position:relative;overflow:hidden}
.nh-pips button.is-on i::after{content:'';position:absolute;inset:0;background:#fff;transform-origin:0 50%;animation:nh-fill linear forwards;animation-duration:inherit}
.nh-hero.is-paused .nh-pips button.is-on i::after{animation:none;transform:none}
@keyframes nh-fill{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes nh-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@media (max-width:760px){
  .nh-hero-frame{height:min(80vh,600px);min-height:500px}
  .nh-hero-shade{background:linear-gradient(0deg,var(--bg) 0%,rgba(7,7,10,.92) 30%,rgba(7,7,10,.35) 55%,rgba(7,7,10,0) 72%),
    linear-gradient(180deg,rgba(7,7,10,.6) 0%,rgba(7,7,10,0) 20%)}
  .nh-hero-copy{bottom:58px}
  .nh-gtitle{font-size:clamp(52px,15vw,72px)}
  .nh-hero-copy p{font-size:14.5px;margin-bottom:18px}
  .nh-play,.nh-more{padding:11px 18px;font-size:15px}
  .nh-hero-side{right:16px;bottom:auto;top:calc(var(--hh) + 10px)}
  .nh-hero-side::after{display:none}
  .nh-sound{width:40px;height:40px}
  .nh-pips{left:var(--gut);right:auto;bottom:24px}
}

/* ── manifesto strip + jump chips ───────────────────── */
.nh-manifesto{position:relative;z-index:3;display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin:-18px var(--gut) 18px;padding:14px 18px;
  border-radius:14px;background:linear-gradient(90deg,rgba(255,47,142,.14),rgba(32,214,255,.06) 60%,rgba(255,255,255,.03));box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
.nh-manifesto p{margin:0;flex:1;min-width:260px;font-size:14px;line-height:1.5;color:rgba(244,242,234,.82)}
.nh-manifesto b{color:#fff;font-weight:800}
.nh-manifesto-links{display:flex;gap:6px}
.nh-manifesto-links button{border:0;border-radius:999px;padding:7px 13px;font-size:12px;font-weight:800;letter-spacing:.08em;background:rgba(255,255,255,.08);cursor:pointer}
.nh-manifesto-links button:hover{background:#fff;color:#000}
.nh-jumps{display:none}
@media (max-width:1180px){
  .nh-jumps{display:flex;gap:6px;overflow-x:auto;padding:2px var(--gut) 6px;scrollbar-width:none;position:relative;z-index:3}
  .nh-jumps::-webkit-scrollbar{display:none}
  .nh-jumps button{flex-shrink:0;border:0;border-radius:999px;padding:8px 14px;font-size:13px;font-weight:700;background:rgba(255,255,255,.08);cursor:pointer}
}
@media (max-width:760px){.nh-manifesto{margin:4px 16px 14px;padding:12px 14px;gap:10px}.nh-manifesto p{min-width:0;flex-basis:100%;font-size:13px}}

/* ── shelves ─────────────────────────────────────────── */
.nh-rows{position:relative;z-index:2;padding-bottom:150px}
.nh-shelf{margin:8px 0 10px;scroll-margin-top:calc(var(--hh) + 8px)}
.nh-shelf-head{display:flex;align-items:baseline;gap:14px;padding:0 var(--gut);flex-wrap:wrap}
.nh-shelf-head h2{margin:0;display:flex;align-items:center;gap:10px;font-size:clamp(24px,2.3vw,32px);font-weight:900;line-height:1;letter-spacing:.01em;color:#fff;text-transform:uppercase}
.nh-shelf-head h2 i{width:10px;height:10px;border-radius:2px;background:var(--acc);box-shadow:0 0 14px var(--acc);transform:rotate(45deg)}
.nh-shelf-head p{margin:0;font-size:14px;color:var(--dim)}
.nh-count{font-size:11px;color:rgba(155,153,143,.7);margin-left:auto;letter-spacing:.08em}
.nh-strip-wrap{position:relative}
.nh-strip{display:flex;gap:clamp(10px,1.1vw,16px);overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scroll-padding-inline:var(--gut);
  padding:16px var(--gut) 30px;scrollbar-width:none;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch}
.nh-strip::-webkit-scrollbar{display:none}
.nh-slot{flex:0 0 var(--cw);scroll-snap-align:start;position:relative}
.nh-slot:hover,.nh-slot:focus-within{z-index:2}
.nh-arrow{position:absolute;top:16px;bottom:30px;z-index:4;width:calc(var(--gut) - 4px);min-width:40px;border:0;display:grid;place-items:center;
  font-size:44px;font-weight:300;color:#fff;cursor:pointer;opacity:0;transition:opacity .2s,background .2s}
.nh-arrow.is-prev{left:0;background:linear-gradient(90deg,rgba(7,7,10,.92),rgba(7,7,10,0))}
.nh-arrow.is-next{right:0;background:linear-gradient(270deg,rgba(7,7,10,.92),rgba(7,7,10,0))}
.nh-strip-wrap:hover .nh-arrow{opacity:1}
.nh-arrow:hover{color:var(--acc)}
.nh-arrow[hidden]{display:none}
@media (hover:none),(max-width:760px){.nh-arrow{display:none}}

/* card */
.nh-card{display:block;position:relative;width:100%;aspect-ratio:2/3;padding:0;border:0;border-radius:12px;background:#15151a;color:#fff;text-decoration:none;
  text-align:left;cursor:pointer;transform:translateZ(0);
  box-shadow:0 10px 26px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.07);
  transition:transform .38s cubic-bezier(.2,.8,.2,1),box-shadow .38s cubic-bezier(.2,.8,.2,1)}
.nh-card:hover,.nh-card:focus-visible{transform:translateY(-8px) scale(1.055);
  box-shadow:0 28px 60px rgba(0,0,0,.75),0 0 0 2px var(--acc),0 0 46px color-mix(in srgb,var(--acc) 45%,transparent)}
.nh .nh-card:focus-visible{outline:3px solid #fff;outline-offset:5px;border-radius:12px}
.nh-box{position:absolute;inset:0;border-radius:inherit;overflow:hidden;container-type:inline-size;display:block}
.nh-box::after{content:'';position:absolute;inset:0;pointer-events:none;background-image:${GRAIN};opacity:.13;mix-blend-mode:overlay;z-index:6}
.nh-cover{position:absolute;inset:0;display:block;background:#000}
.nh-cover-main{position:absolute;left:0;right:0;top:11cqw;width:100%;height:139cqw;object-fit:cover;display:block;transition:transform .6s cubic-bezier(.2,.8,.2,1)}
.nh-card:hover .nh-cover-main{transform:scale(1.04)}
.nh-cover.is-wide .nh-cover-main{height:80cqw;object-fit:contain;box-shadow:0 2cqw 6cqw rgba(0,0,0,.6)}
.nh-card:hover .nh-cover.is-wide .nh-cover-main{transform:scale(1.03) rotate(-1deg)}
.nh-cover-bg{position:absolute;inset:-10%;width:120%;height:120%;object-fit:cover;filter:blur(5cqw) saturate(1.5) brightness(.55);transform:scale(1.2)}
.nh-band{position:absolute;left:0;right:0;top:0;height:11cqw;z-index:2;display:flex;align-items:center;gap:2cqw;padding:0 4.5cqw;
  background:linear-gradient(180deg,#141418,#050507);box-shadow:inset 0 -.6cqw 0 var(--acc);font-size:max(8px,4.8cqw);font-weight:800;letter-spacing:.06em;color:#fff;white-space:nowrap}
.nh-band b{color:#ff3b3b;letter-spacing:-.04em}
.nh-band em{margin-left:auto;font-style:normal;font-weight:700;color:rgba(255,255,255,.55);font-size:max(7px,3.8cqw)}
.nh-cover-tag{position:absolute;left:7cqw;right:5cqw;bottom:8cqw;z-index:2;display:flex;flex-direction:column;transform:rotate(-4deg);transform-origin:0 100%}
.nh-cover-tag span{font-size:15cqw;font-weight:900;line-height:.9;color:#fff;-webkit-text-stroke:1.3cqw var(--ink);paint-order:stroke fill;
  text-shadow:1.2cqw 1.2cqw 0 var(--pink),2.4cqw 2.4cqw 0 var(--ink)}
.nh-cover-tag span:nth-child(2){color:var(--acc);margin-left:5cqw}
.nh-cover-tag span:nth-child(3){margin-left:10cqw}
.nh-preview{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:3;opacity:0;transition:opacity .45s ease}
.nh-preview.is-playing{opacity:1}
.nh-tape{position:absolute;left:6cqw;bottom:6cqw;z-index:4;font-size:max(9px,4.8cqw);font-weight:800;letter-spacing:.1em;color:#fff;
  background:rgba(0,0,0,.7);padding:1.6cqw 2.6cqw;border-radius:1.4cqw;opacity:0;transition:opacity .3s}
.nh-tape::before{content:'';display:inline-block;width:2.4cqw;height:2.4cqw;border-radius:50%;background:#ff2a2a;margin-right:1.6cqw;vertical-align:.2cqw;animation:nh-blink 1s steps(2) infinite}
.nh-card.is-previewing .nh-tape{opacity:1}
.nh-card.is-previewing .nh-info{transform:translateY(102%)}
.nh-label{position:absolute;left:6cqw;top:6cqw;z-index:4;max-width:70cqw;font-size:max(9px,5cqw);font-weight:800;letter-spacing:.08em;line-height:1;
  padding:1.8cqw 2.6cqw;border-radius:1.6cqw;background:var(--ink);color:var(--acc);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-transform:uppercase}
.nh-cover~.nh-label{display:none}
.nh-hot{position:absolute;right:5cqw;top:5cqw;z-index:4;width:20cqw;height:20cqw;border-radius:50%;display:grid;place-items:center;
  font-size:7.2cqw;font-weight:900;letter-spacing:.02em;color:#fff;background:#ff3b3b;box-shadow:0 0 0 1.2cqw var(--ink),1.6cqw 1.6cqw 0 1.2cqw var(--ink);transform:rotate(12deg)}
.nh-cover~.nh-hot{display:none}
.nh-sheen{position:absolute;inset:0;z-index:5;pointer-events:none;
  background:linear-gradient(115deg,rgba(255,255,255,0) 30%,rgba(255,255,255,.22) 45%,rgba(255,255,255,0) 60%);
  transform:translateX(-120%);transition:transform .9s cubic-bezier(.2,.8,.2,1)}
.nh-card:hover .nh-sheen,.nh-card:focus-visible .nh-sheen{transform:translateX(120%)}
.nh-box::before{content:'';position:absolute;inset:0;z-index:5;pointer-events:none;border-radius:inherit;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),inset 0 1.4cqw 0 rgba(255,255,255,.12),inset 0 0 16cqw rgba(0,0,0,.45)}
.nh-info{position:absolute;left:0;right:0;bottom:0;z-index:7;display:flex;flex-direction:column;gap:2cqw;padding:22cqw 7cqw 7cqw;
  background:linear-gradient(180deg,rgba(6,6,9,0) 0%,rgba(6,6,9,.86) 34%,rgba(6,6,9,.97) 100%);
  transform:translateY(102%);transition:transform .38s cubic-bezier(.2,.8,.2,1)}
.nh-card:hover .nh-info,.nh-card:focus-visible .nh-info{transform:none}
.nh-title{transition:opacity .25s ease}
.nh-card:hover .nh-art .nh-title,.nh-card:focus-visible .nh-art .nh-title{opacity:0}
.nh-info b{font-size:max(12px,8cqw);font-weight:800;line-height:1.05;color:#fff;letter-spacing:.01em}
.nh-info span{font-size:max(11px,6.6cqw);line-height:1.35;color:rgba(244,242,234,.82);display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.nh-info em{font-style:normal;align-self:flex-start;margin-top:2cqw;font-size:max(10px,5.6cqw);font-weight:900;letter-spacing:.1em;color:#000;background:var(--acc);
  padding:1.8cqw 3.4cqw;border-radius:1.6cqw}
@media (hover:none){.nh-info{display:none}}

/* generated box art */
.nh-art{position:absolute;inset:0;overflow:hidden;
  background:radial-gradient(130% 85% at var(--lx) 12%,color-mix(in srgb,var(--g1) 72%,#fff) 0%,var(--g1) 26%,color-mix(in srgb,var(--g1) 30%,var(--g2)) 55%,var(--g2) 82%,color-mix(in srgb,var(--g2) 55%,#000) 110%)}
.nh-rays{position:absolute;inset:-30%;opacity:.5;mix-blend-mode:soft-light;
  background:repeating-conic-gradient(from 4deg at calc(var(--lx) * .6 + 20%) 34%,rgba(255,255,255,.55) 0 5deg,rgba(255,255,255,0) 5deg 15deg);
  -webkit-mask-image:radial-gradient(closest-side,#000 20%,transparent 100%);mask-image:radial-gradient(closest-side,#000 20%,transparent 100%)}
.nh-dots{position:absolute;inset:0;opacity:.32;background-image:radial-gradient(rgba(0,0,0,.65) 0.9cqw,transparent 1.05cqw);background-size:4.6cqw 4.6cqw;
  -webkit-mask-image:linear-gradient(200deg,transparent 30%,#000 90%);mask-image:linear-gradient(200deg,transparent 30%,#000 90%)}
.nh-noun{position:absolute;display:block;image-rendering:pixelated;filter:drop-shadow(1.8cqw 1.8cqw 0 rgba(11,11,15,.9));
  transition:transform .8s cubic-bezier(.2,.8,.2,1)}
.crop-face .nh-noun{width:172cqw;left:-36cqw;top:-18cqw}
.crop-full .nh-noun{width:132cqw;left:-16cqw;top:24cqw}
.crop-peek .nh-noun{width:230cqw;left:-42cqw;top:-34cqw;transform:rotate(-9deg)}
.nh-card:hover .nh-noun{transform:scale(1.04) translateY(-1cqw)}
.nh-card:hover .crop-peek .nh-noun{transform:rotate(-6deg) scale(1.04)}
.nh-floor{position:absolute;left:0;right:0;bottom:0;height:62%;
  background:linear-gradient(0deg,rgba(9,9,13,.9) 0%,rgba(9,9,13,.55) 40%,rgba(9,9,13,0) 100%)}
.nh-title{position:absolute;left:7cqw;right:6cqw;bottom:17cqw;z-index:2;font-weight:900;line-height:.86;color:#fff;letter-spacing:.005em;
  overflow-wrap:anywhere;transform:rotate(var(--tilt));transform-origin:0 100%;
  -webkit-text-stroke:1.5cqw var(--ink);paint-order:stroke fill;text-shadow:1.3cqw 1.3cqw 0 var(--pink),2.6cqw 2.6cqw 0 var(--cyan),3.6cqw 3.6cqw 0 var(--ink)}
.nh-title.is-xl{font-size:31cqw}.nh-title.is-l{font-size:24cqw}.nh-title.is-m{font-size:19cqw}.nh-title.is-s{font-size:14.5cqw}
.nh-url{position:absolute;left:7cqw;bottom:6.5cqw;z-index:2;max-width:84cqw;font-size:max(8px,4.6cqw);font-weight:800;letter-spacing:.04em;line-height:1;
  color:var(--ink);background:var(--pink);padding:1.5cqw 2.4cqw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transform:rotate(var(--tilt));transform-origin:0 100%}
.crop-submit{background:repeating-linear-gradient(135deg,rgba(0,0,0,.07) 0 4cqw,rgba(0,0,0,0) 4cqw 8cqw),
  radial-gradient(120% 90% at 50% 20%,#fff2a8 0%,#ffd400 30%,#ff2f8e 100%)}
.crop-submit::before{content:'';position:absolute;inset:5cqw;border:1.4cqw dashed rgba(11,11,15,.7);border-radius:4cqw}
.nh-plus{position:absolute;left:0;right:0;top:12cqw;text-align:center;font-size:92cqw;font-weight:900;line-height:1;color:#fff;
  -webkit-text-stroke:2.6cqw var(--ink);paint-order:stroke fill;text-shadow:2.4cqw 2.4cqw 0 var(--cyan),4.8cqw 4.8cqw 0 var(--ink);transition:transform .5s cubic-bezier(.2,.8,.2,1)}
.nh-card:hover .nh-plus{transform:rotate(90deg) scale(1.05)}
.crop-submit .nh-floor{display:none}
.nh-ghost{flex:0 0 var(--cw);aspect-ratio:2/3;border-radius:12px;display:grid;place-items:center;text-align:center;padding:12px;
  border:2px dashed rgba(255,255,255,.12);color:rgba(255,255,255,.28);font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}

.nh-foot{padding:0 var(--gut) 160px;margin-top:-110px;font-size:13px;color:var(--dim);position:relative;z-index:2}
.nh-foot span{color:#ff3b3b;margin-right:4px}
.nh-foot button{border:0;background:none;padding:0;color:var(--tx);text-decoration:underline;text-underline-offset:3px;cursor:pointer}

@keyframes nh-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
@keyframes nh-blink{50%{opacity:.3}}

/* ── dialogs (portal on body) ───────────────────────── */
body .nh-modal{position:fixed;inset:0;z-index:9500;display:grid;place-items:center;padding:16px;background:rgba(3,3,5,.72);
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);animation:nh-fade .2s ease-out;color:#f4f2ea}
body .nh-modal,body .nh-modal *{font-family:${UI} !important;text-transform:none;letter-spacing:normal}
body .nh-modal .nh-gtitle,body .nh-modal .nh-gtitle *{font-family:${PIP3} !important;text-transform:uppercase !important}
body .nh-modal .nh-eyebrow,body .nh-modal .nh-eyebrow *,body .nh-modal .nh-strapline,body .nh-modal .nh-done-nog{font-family:${MONO} !important}
body .nh-modal h2,body .nh-modal h2 *{font-family:${DISPLAY} !important}
body .nh-modal :focus-visible{outline:3px solid #d4ff3a;outline-offset:3px}
body .nh-sheet{position:relative;width:min(560px,100%);max-height:calc(100dvh - 32px);overflow:auto;border-radius:20px;background:#121217;
  box-shadow:0 0 0 1px rgba(255,255,255,.1),0 40px 120px rgba(0,0,0,.8);animation:nh-pop .32s cubic-bezier(.2,.9,.25,1)}
body .nh-sheet.is-game{width:min(820px,100%);display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr)}
body .nh-x{position:absolute;right:12px;top:12px;z-index:3;width:36px;height:36px;border-radius:50%;border:0;background:rgba(0,0,0,.6);color:#fff;font-size:22px;line-height:1;cursor:pointer}
body .nh-x:hover{background:#fff;color:#000}
body .nh-sheet-art{position:relative;min-height:260px;background:#000}
body .nh-sheet-art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
body .nh-sheet-body{padding:30px 28px 28px}
body .nh-sheet h2{margin:4px 0 16px;font-size:inherit;font-weight:900;line-height:1}
body .nh-sheet .nh-gtitle{display:inline-flex;flex-direction:column;font-size:clamp(44px,6vw,64px) !important;line-height:.84;color:#fff;transform:rotate(-3deg);transform-origin:0 100%;
  -webkit-text-stroke:.07em #0b0b0f;paint-order:stroke fill;text-shadow:.045em .045em 0 #ff2f8e,.09em .09em 0 #20d6ff,.13em .13em 0 #0b0b0f}
body .nh-sheet .nh-gtitle .is-acc{color:var(--acc);margin-left:.08em}
body .nh-sheet .nh-strapline{display:inline-block;font-size:12px;font-weight:800;letter-spacing:.16em;color:#d4ff3a;background:#0b0b0f;padding:6px 12px 5px;box-shadow:4px 4px 0 #ff2f8e;margin:6px 0 14px}
body .nh-sheet p{margin:0 0 14px;font-size:15px;line-height:1.55;color:rgba(244,242,234,.86)}
body .nh-sheet ul{margin:0 0 22px;padding:0;list-style:none}
body .nh-sheet li{position:relative;padding:5px 0 5px 22px;font-size:14px;color:#f4f2ea}
body .nh-sheet li::before{content:'';position:absolute;left:2px;top:12px;width:8px;height:8px;background:#d4ff3a;transform:rotate(45deg)}
body .nh-modal .nh-play{display:inline-flex;align-items:center;gap:10px;border:0;border-radius:10px;padding:13px 24px;background:#fff;color:#000;font-size:15px;font-weight:800;letter-spacing:.06em;cursor:pointer}
body .nh-modal .nh-play:disabled{opacity:.6;cursor:wait}
body .nh-form{padding:28px 26px 24px;display:flex;flex-direction:column;gap:14px}
body .nh-form .nh-eyebrow{font-size:11.5px;font-weight:800;letter-spacing:.18em;color:#ffd400}
body .nh-form .nh-eyebrow b{color:#ff2f8e}
body .nh-form h2{margin:0;font-size:38px !important;font-weight:900;line-height:.95;color:#fff;text-shadow:2px 2px 0 #ff2f8e}
body .nh-form-lede{margin:0 !important;font-size:14px !important;color:rgba(244,242,234,.72) !important}
body .nh-form label{display:flex;flex-direction:column;gap:6px}
body .nh-form label>span{display:flex;justify-content:space-between;font-size:12px;font-weight:700;letter-spacing:.06em;color:rgba(244,242,234,.75);text-transform:uppercase}
body .nh-form label>span em{font-style:normal;font-weight:500;color:#9b998f}
body .nh-form input,body .nh-form textarea{width:100%;border:0;border-radius:10px;padding:11px 13px;background:#1c1c23;color:#fff;font-size:15px;outline:none;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.1);resize:vertical}
body .nh-form input:focus,body .nh-form textarea:focus{box-shadow:inset 0 0 0 1.5px #ffd400}
body .nh-form fieldset{border:0;margin:0;padding:0}
body .nh-form legend{font-size:12px;font-weight:700;letter-spacing:.06em;color:rgba(244,242,234,.75);margin-bottom:6px;text-transform:uppercase}
body .nh-kinds{display:flex;flex-wrap:wrap;gap:6px}
body .nh-kinds label{flex-direction:row;align-items:center;cursor:pointer;padding:7px 13px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:.08em;
  background:#1c1c23;box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)}
body .nh-kinds label.is-on{background:#ffd400;color:#000;box-shadow:none}
body .nh-kinds label:focus-within{outline:3px solid #d4ff3a;outline-offset:2px}
body .nh-kinds input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
body .nh-trap{position:absolute !important;left:-9999px;width:1px;height:1px;overflow:hidden}
body .nh-form-err{margin:0;padding:10px 12px;border-radius:10px;background:rgba(255,59,92,.14);color:#ff8fa3;font-size:13.5px}
body .nh-form-foot{display:flex;align-items:center;gap:14px;justify-content:space-between;flex-wrap:wrap;margin-top:4px}
body .nh-form-foot>span{flex:1;min-width:180px;font-size:12px;color:#9b998f;line-height:1.4}
body .nh-form-done{padding:40px 28px 32px;text-align:center}
body .nh-done-nog{display:block;font-size:44px;color:#ff3b3b;margin-bottom:10px;letter-spacing:-.04em}
body .nh-form-done h2{margin:0 0 10px;font-size:44px !important;font-weight:900;color:#fff}
body .nh-form-done p{margin:0 auto 22px;max-width:380px}
@keyframes nh-fade{from{opacity:0}to{opacity:1}}
@keyframes nh-pop{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}
@media (max-width:640px){body .nh-sheet.is-game{grid-template-columns:1fr}body .nh-sheet-art{min-height:0;aspect-ratio:5/4}}

/* ── intro (portal on body) ─────────────────────────── */
body .nh-intro{position:fixed;inset:0;z-index:10000;background:radial-gradient(ellipse 46% 40% at 50% 50%,#2a2a31 0%,#141418 55%,#000 100%);display:grid;place-items:center;overflow:hidden;cursor:pointer;
  --nog:#f3322c;--px:min(4.6vw,36px);transition:opacity .26s ease}
body .nh-intro.is-leaving{opacity:0}
body .nh-intro-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
body .nh-intro-skip{position:absolute;bottom:28px;left:0;right:0;text-align:center;font-family:${MONO} !important;font-size:11px;letter-spacing:.14em !important;
  color:rgba(255,255,255,.3);animation:nh-fade .4s ease .5s both}

@media (prefers-reduced-motion:reduce){
  .nh *,.nh *::before,.nh *::after{animation-duration:.001ms !important;animation-iteration-count:1 !important;transition-duration:.001ms !important}
  .nh-hero-slide.is-on img{animation:none !important;transform:scale(1.05)}
  .nh-card:hover,.nh-card:focus-visible{transform:none}
  .nh-hero:hover .nh-hero-frame{transform:none}
  body .nh-modal,body .nh-sheet{animation:none !important}
}
`;
