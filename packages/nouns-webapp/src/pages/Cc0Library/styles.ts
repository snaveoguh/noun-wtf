// The few rules Tailwind can't say: fonts (theme CSS forces fonts with
// `[data-theme] * {…!important}` at 0,1,0, so these are 0,2,0 + !important,
// same as the homescreen), the Pip3 title, masonry columns, pixel scaling.
// The overlays render in portals on <body>, hence the `body` prefixes.

const UI = "'Figtree',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif";
const PIP3 = "'Pip3','Londrina Solid',system-ui,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,'SF Mono',Menlo,monospace";

export const CC0_CSS = `
.cc0-root,body .cc0-layer{--bg:#07070a;--tx:#f4f2ea;--dim:#9b998f;--acid:#d4ff3a;--pink:#ff2f8e;--cyan:#20d6ff;--ink:#0b0b0f}
.cc0-root,.cc0-root *,body .cc0-layer,body .cc0-layer *{font-family:${UI} !important;text-transform:none;letter-spacing:normal}
.cc0-root .cc0-mono,.cc0-root .cc0-mono *,body .cc0-layer .cc0-mono,body .cc0-layer .cc0-mono *{font-family:${MONO} !important;letter-spacing:.06em}
.cc0-root .cc0-pip3,.cc0-root .cc0-pip3 *,body .cc0-layer .cc0-pip3,body .cc0-layer .cc0-pip3 *{font-family:${PIP3} !important;text-transform:uppercase !important}
.cc0-root ::selection,body .cc0-layer ::selection{background:var(--acid);color:#000}
.cc0-title{display:inline-flex;flex-wrap:wrap;gap:0 .22em;font-size:clamp(48px,9vw,104px);line-height:.86;color:#fff;transform:rotate(-3deg);transform-origin:0 100%;
  -webkit-text-stroke:.07em var(--ink);paint-order:stroke fill;text-shadow:.045em .045em 0 var(--pink),.09em .09em 0 var(--cyan),.13em .13em 0 var(--ink)}
.cc0-title .is-acc{color:var(--acid)}
.cc0-strap{display:inline-block;font-size:12px;font-weight:800;letter-spacing:.16em !important;color:var(--acid);background:var(--ink);padding:6px 12px 5px;box-shadow:4px 4px 0 var(--pink)}
.cc0-masonry{column-width:150px;column-gap:12px}
.cc0-masonry>*{break-inside:avoid;margin-bottom:12px}
.cc0-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}
.cc0-pixel{image-rendering:pixelated}
.cc0-check{background-color:#15151b;background-image:linear-gradient(45deg,#1d1d25 25%,transparent 25%,transparent 75%,#1d1d25 75%),linear-gradient(45deg,#1d1d25 25%,transparent 25%,transparent 75%,#1d1d25 75%);
  background-size:16px 16px;background-position:0 0,8px 8px}
.cc0-root input,.cc0-root select,body .cc0-layer input,body .cc0-layer select,body .cc0-layer textarea{color:var(--tx);background:rgba(255,255,255,.05) !important;border:1px solid rgba(255,255,255,.14) !important;border-radius:12px !important;box-shadow:none !important}
.cc0-root input:focus,.cc0-root select:focus,body .cc0-layer input:focus,body .cc0-layer textarea:focus{outline:none;border-color:var(--acid) !important;box-shadow:0 0 0 3px rgba(212,255,58,.15) !important}
.cc0-root select option{background:#111116;color:var(--tx)}
.cc0-root :focus-visible:not([tabindex='-1']),body .cc0-layer :focus-visible:not([tabindex='-1']){outline:3px solid var(--acid);outline-offset:2px}
@keyframes cc0-in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
body .cc0-layer .cc0-sheet{animation:cc0-in .18s ease-out}
@media (prefers-reduced-motion:reduce){body .cc0-layer .cc0-sheet{animation:none}}
`;
