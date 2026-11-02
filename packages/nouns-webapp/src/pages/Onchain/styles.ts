// Fonts the theme CSS would otherwise override (same approach as /cc0).

const UI = "'Figtree',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif";
const PIP3 = "'Pip3','Londrina Solid',system-ui,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,'SF Mono',Menlo,monospace";

export const ONCHAIN_CSS = `
.oc-root{--bg:#07070a;--tx:#f4f2ea;--dim:#9b998f;--acid:#d4ff3a;--pink:#ff2f8e;--cyan:#20d6ff;--ink:#0b0b0f}
.oc-root,.oc-root *{font-family:${UI} !important;text-transform:none;letter-spacing:normal}
.oc-root .oc-mono,.oc-root .oc-mono *{font-family:${MONO} !important;letter-spacing:.04em}
.oc-root .oc-pip3,.oc-root .oc-pip3 *{font-family:${PIP3} !important;text-transform:uppercase !important}
.oc-root ::selection{background:var(--acid);color:#000}
.oc-title{display:inline-flex;flex-wrap:wrap;gap:0 .22em;font-size:clamp(48px,9cqi,104px);line-height:.86;color:#fff;transform:rotate(-3deg);transform-origin:0 100%;
  -webkit-text-stroke:.07em var(--ink);paint-order:stroke fill;text-shadow:.045em .045em 0 var(--pink),.09em .09em 0 var(--cyan),.13em .13em 0 var(--ink)}
.oc-title .is-acc{color:var(--acid)}
.oc-strap{display:inline-block;font-size:12px;font-weight:800;letter-spacing:.16em !important;color:var(--acid);background:var(--ink);padding:6px 12px 5px;box-shadow:4px 4px 0 var(--pink)}
.oc-root input{color:var(--tx);background:rgba(255,255,255,.05) !important;border:1px solid rgba(255,255,255,.14) !important;border-radius:12px !important;box-shadow:none !important}
.oc-root input:focus{outline:none;border-color:var(--acid) !important;box-shadow:0 0 0 3px rgba(212,255,58,.15) !important}
.oc-root :focus-visible:not([tabindex='-1']){outline:3px solid var(--acid);outline-offset:2px}
.oc-wall{background-color:#2a2a30;background-image:linear-gradient(#ffffff08 1px,transparent 1px),linear-gradient(90deg,#ffffff08 1px,transparent 1px);background-size:12.5% 20%}
.oc-break{overflow-wrap:anywhere;word-break:break-word}
`;
