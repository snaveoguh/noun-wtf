// Scoped styles for the Nonsense page (everything under .nz). Dark ground,
// Pip3 for the headings, acid for the one accent, flow-kind colours from model.ts.
export const NONSENSE_CSS = `
.nz{--nz-bg:#050506;--nz-card:#141518;--nz-card2:#1d1e23;--nz-ink:#ecebe4;--nz-dim:#8d8c84;--nz-acid:#d4ff3a;--nz-pink:#ff4fa3;--nz-red:#ff3b5c;--nz-div:rgba(255,255,255,.08);
  background:var(--nz-bg);color:var(--nz-ink);min-height:100vh;padding:20px 16px 48px;font-family:var(--site-font,system-ui);font-size:15px;line-height:1.45;box-sizing:border-box}
.nz *{box-sizing:border-box}
.nz [data-keep-font],.nz [data-keep-font] *{font-family:'Pip3','Londrina Solid',system-ui,sans-serif !important;text-transform:uppercase !important;font-weight:normal !important}
.nz a{color:var(--nz-acid);text-decoration:none}
.nz a:hover{text-decoration:underline}
.nz-head{max-width:1100px;margin:0 auto 18px}
.nz-head h1,.nz-h,.nz-state h2{font-family:'Pip3',var(--site-font);font-weight:normal;letter-spacing:.04em;text-transform:uppercase;margin:0}
.nz-head h1{font-size:clamp(40px,8vw,72px);line-height:.95;color:var(--nz-acid)}
.nz-head p{margin:8px 0 0;color:var(--nz-dim);max-width:640px}
.nz>section,.nz>.nz-banner,.nz>.nz-loading,.nz>.nz-state{max-width:1100px;margin-left:auto;margin-right:auto}
.nz-banner{background:rgba(212,255,58,.08);color:var(--nz-ink);border-radius:12px;padding:10px 14px;margin-bottom:14px;font-size:14px}
.nz-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:14px}
.nz-tile{background:var(--nz-card);border-radius:18px;padding:16px 18px;display:flex;flex-direction:column;gap:4px;min-width:0}
.nz-tile-k{font-family:'Pip3',var(--site-font);font-size:20px;letter-spacing:.06em;text-transform:uppercase;display:flex;align-items:center;gap:8px}
.nz-tile.is-in .nz-tile-k{color:#a6d61a}
.nz-tile.is-out .nz-tile-k{color:var(--nz-pink)}
.nz-tile.is-net-pos .nz-tile-k{color:var(--nz-acid)}
.nz-tile.is-net-neg .nz-tile-k{color:var(--nz-red)}
.nz-tile-v{font-size:clamp(26px,4.4vw,40px);font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1;overflow-wrap:anywhere}
.nz-tile-v small{font-size:.55em;font-weight:600;color:var(--nz-ink);white-space:nowrap}
.nz-tile-s{color:var(--nz-dim);font-size:13px}
.nz-tile.is-skel{height:118px;background:linear-gradient(90deg,#141518,#1d1e23,#141518);background-size:200% 100%;animation:nz-sh 1.4s infinite linear}
.nz-skel-block{height:320px;border-radius:18px;background:linear-gradient(90deg,#141518,#1d1e23,#141518);background-size:200% 100%;animation:nz-sh 1.4s infinite linear}
.nz-loading p{color:var(--nz-dim);text-align:center;margin-top:14px}
@keyframes nz-sh{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.nz-tile.is-skel,.nz-skel-block{animation:none}}
.nz-state{background:var(--nz-card);border-radius:18px;padding:36px 20px;text-align:center}
.nz-state h2{font-size:28px;color:var(--nz-pink);margin-bottom:8px}
.nz-state p{color:var(--nz-dim);margin:0 0 16px}
.nz-tip{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,.14);color:var(--nz-ink);font:600 12px/1 var(--site-font,system-ui);cursor:help;position:relative;text-transform:none;letter-spacing:0}
.nz-tip:hover::after,.nz-tip:focus::after{content:attr(data-tip);position:absolute;left:50%;top:24px;transform:translateX(-50%);width:min(280px,70vw);background:#24252b;color:var(--nz-ink);padding:10px 12px;border-radius:12px;font:500 13px/1.4 var(--site-font,system-ui);z-index:20;box-shadow:0 8px 30px rgba(0,0,0,.6);white-space:normal}
.nz-card,.nz-legend-card{background:var(--nz-card);border-radius:18px;padding:18px;margin-bottom:14px;position:relative}
.nz-h{font-size:22px;color:var(--nz-ink);margin-bottom:12px}
.nz-h-year{color:var(--nz-acid);margin-left:8px}
.nz-muted{color:var(--nz-dim);font-size:13px;margin:0}
.nz-empty-inline{color:var(--nz-dim);font-size:14px;padding:12px 0;margin:0}
.nz-sub{margin:-6px 0 14px}
.nz-section-h{max-width:1100px;margin:26px auto 12px;font-size:28px;color:var(--nz-acid)}
.nz-tile.is-usdc .nz-tile-k{color:#e89a3c}
/* treasury now */
.nz-now-hero{display:flex;flex-wrap:wrap;align-items:flex-end;gap:6px 28px;margin-bottom:6px}
.nz-now-hero>div{display:flex;flex-direction:column;gap:2px;min-width:0}
.nz-now-v{font-size:clamp(40px,8vw,68px);font-weight:800;line-height:1;font-variant-numeric:tabular-nums;color:var(--nz-acid);overflow-wrap:anywhere}
.nz-now-v.is-usd{font-size:clamp(26px,4.6vw,40px);color:var(--nz-ink)}
.nz-now-k{color:var(--nz-dim);font-size:14px;display:flex;align-items:center;gap:6px}
.nz-holders{display:flex;flex-direction:column;gap:14px;margin-top:16px}
.nz-holder{background:rgba(255,255,255,.03);border-radius:14px;padding:10px 12px}
.nz-holder-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:600}
.nz-holder-sum{margin-left:auto;font-variant-numeric:tabular-nums;color:var(--nz-ink)}
.nz-hold-table td:first-child{min-width:0}
.nz-hold-table tbody tr{cursor:default}
.nz-rate{display:block;color:var(--nz-dim);font-size:11px;font-weight:400}
.nz-share-cell{width:34%}
.nz-share{display:inline-block;vertical-align:middle;width:calc(100% - 52px);height:8px;border-radius:4px;background:rgba(255,255,255,.06);overflow:hidden}
.nz-share b{display:block;height:100%;background:var(--nz-acid);border-radius:4px;min-width:2px}
.nz-share-pct{display:inline-block;width:48px;text-align:right;font-variant-numeric:tabular-nums;color:var(--nz-dim);font-size:12px}
.nz-row-meta .nz-share{width:100%;margin-top:6px;height:6px}
/* waterfall */
.nz-wf-list{list-style:none;margin:0 0 12px;padding:0;display:flex;flex-direction:column;gap:12px}
.nz-wf-row{display:flex;flex-direction:column;gap:4px}
.nz-wf-top{display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap}
.nz-wf-label{display:flex;align-items:center;gap:8px;font-weight:600}
.nz-wf-label i{width:10px;height:10px;border-radius:3px;display:inline-block;flex:none}
.nz-wf-val{font-variant-numeric:tabular-nums;font-weight:700;margin-left:auto}
.nz-wf-val em{font-style:normal;font-weight:500;color:var(--nz-dim)}
.nz-wf-row.is-total .nz-wf-val{font-size:20px}
.nz-wf-row.is-total:last-child .nz-wf-val{color:var(--nz-acid)}
.nz-wf-track{position:relative;height:12px;background:rgba(255,255,255,.04);border-radius:4px}
.nz-wf-track b{position:absolute;top:0;bottom:0;border-radius:4px}
.nz-wf-row small{color:var(--nz-dim);font-size:12px}
.nz-wf-row.is-total:last-child{border-top:1px solid var(--nz-div);padding-top:12px}
/* sankey */
.nz-sankey svg{display:block;overflow:visible}
.nz-sk-label{font-size:13px;fill:var(--nz-ink);dominant-baseline:middle}
.nz-sk-name{font-size:13px;fill:var(--nz-ink);font-weight:600}
.nz-sk-val{font-size:13px;fill:var(--nz-dim);font-variant-numeric:tabular-nums}
.nz-sk-explain{color:var(--nz-dim);font-size:13px;margin:10px 0 0;min-height:2.8em}
.nz-flow-narrow h4{font-size:13px;color:var(--nz-dim);text-transform:uppercase;letter-spacing:.08em;margin:6px 0}
.nz-barlist{list-style:none;margin:0 0 10px;padding:0;display:flex;flex-direction:column;gap:10px}
.nz-barlist li{display:grid;grid-template-columns:1fr auto;gap:2px 10px}
.nz-bl-label{display:flex;align-items:center;gap:8px;font-weight:600}
.nz-bl-label i{width:10px;height:10px;border-radius:3px;display:inline-block}
.nz-bl-val{font-variant-numeric:tabular-nums;text-align:right}
.nz-bl-val em{font-style:normal;color:var(--nz-dim)}
.nz-bl-bar{grid-column:1/-1;height:8px;background:rgba(255,255,255,.05);border-radius:4px;overflow:hidden}
.nz-bl-bar b{display:block;height:100%;border-radius:4px;min-width:2px}
.nz-barlist small{grid-column:1/-1;color:var(--nz-dim);font-size:12px}
.is-hatch{background-image:repeating-linear-gradient(45deg,#3a3a37 0 3px,#77776f 3px 5px)!important}
.nz-facts{list-style:none;padding:0;margin:14px 0 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px 18px;color:var(--nz-dim);font-size:13px}
.nz-facts b{color:var(--nz-ink)}
/* years */
.nz-years-plot{display:flex;gap:6px;align-items:flex-end;overflow-x:auto;padding-bottom:2px}
.nz-year{flex:1 1 0;min-width:56px;background:transparent;border:0;padding:6px 4px;border-radius:12px;color:var(--nz-ink);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px}
.nz-year:hover,.nz-year:focus-visible{background:rgba(255,255,255,.05);outline:none}
.nz-year.is-active{background:rgba(212,255,58,.1)}
.nz-year.is-dim{opacity:.45}
.nz-year-bars{display:flex;align-items:flex-end;gap:3px}
.nz-bar{display:block;width:18px;border-radius:4px 4px 0 0;min-height:1px}
.nz-bar-stack{display:flex;flex-direction:column-reverse;overflow:hidden;gap:2px;background:transparent}
.nz-bar-stack i{display:block;width:100%;min-height:1px}
.nz-year-label{font-size:13px;font-variant-numeric:tabular-nums;color:var(--nz-dim)}
.nz-year.is-active .nz-year-label{color:var(--nz-acid);font-weight:700}
.nz-years-readout{color:var(--nz-dim);font-size:13px;margin-top:10px;min-height:2.8em}
.nz-years-readout b{color:var(--nz-ink)}
/* who */
.nz-who-head{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:10px}
.nz-tabs{display:flex;gap:6px}
.nz-tabs button{font-family:'Pip3',var(--site-font);font-size:18px;letter-spacing:.05em;text-transform:uppercase;background:transparent;border:0;color:var(--nz-dim);padding:4px 8px;border-radius:10px;cursor:pointer}
.nz-tabs button.is-on{color:var(--nz-ink);background:rgba(255,255,255,.08)}
.nz-search{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.08);border-radius:12px;padding:0 10px;flex:1 1 220px;max-width:360px;color:var(--nz-dim)}
.nz-search input{background:transparent!important;border:0;color:var(--nz-ink);padding:9px 0;width:100%;font-size:15px;outline:none}
.nz-filters{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.nz-chip{background:rgba(255,255,255,.1);color:var(--nz-ink);border:0;border-radius:999px;padding:6px 12px;font:600 13px/1.2 var(--site-font,system-ui);cursor:pointer}
.nz-chip:hover{background:rgba(255,255,255,.16)}
.nz-chip.is-on{background:var(--nz-ink);color:#000}
.nz-chip.is-acid{background:var(--nz-acid);color:#000}
.nz-chip.is-clear{background:transparent;color:var(--nz-dim)}
.nz-table{width:100%;border-collapse:collapse;font-size:14px;margin-top:6px}
.nz-table th{text-align:left;font-weight:600;color:var(--nz-dim);padding:6px 8px;border-bottom:1px solid var(--nz-div)}
.nz-table th button{background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:0}
.nz-table th[aria-sort=ascending] button,.nz-table th[aria-sort=descending] button{color:var(--nz-ink)}
.nz-table td{padding:8px;border-bottom:1px solid var(--nz-div);vertical-align:top}
.nz-table tbody tr{cursor:pointer}
.nz-table tbody tr:hover{background:rgba(255,255,255,.04)}
.nz-table tbody tr.is-selected{background:rgba(212,255,58,.08)}
.nz-table .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.nz-table th.num{text-align:right}
.nz-who{background:none;border:0;color:var(--nz-ink);padding:0;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:3px;font:inherit}
.nz-who-name{font-weight:600;overflow-wrap:anywhere}
.nz-table td:first-child{min-width:170px}
.nz-type{font-size:12px;color:var(--nz-dim)}
.nz-kind{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--nz-ink);background:rgba(255,255,255,.06);border-radius:999px;padding:2px 8px;margin:0 4px 4px 0;white-space:nowrap}
.nz-kind i{width:8px;height:8px;border-radius:2px;display:inline-block}
.nz-prop{margin-left:6px}
.nz-more{color:var(--nz-dim)}
.nz-row-meta{display:none;margin-top:4px}
.nz-table-foot{display:flex;justify-content:space-between;align-items:center;color:var(--nz-dim);font-size:13px;padding-top:10px}
/* panel */
.nz-panel{position:sticky;bottom:12px;margin:14px 0 0 auto;width:min(440px,100%);max-height:min(640px,70vh);background:#1b1c21;border-radius:18px;box-shadow:0 -10px 60px rgba(0,0,0,.75),0 0 0 1px rgba(255,255,255,.06);padding:18px;overflow:auto;z-index:30;color:var(--nz-ink);overscroll-behavior:contain}
.nz-panel header{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.nz-panel h3{margin:0 0 4px;font-size:20px;overflow-wrap:anywhere}
.nz-panel h4{font-size:13px;color:var(--nz-dim);text-transform:uppercase;letter-spacing:.08em;margin:16px 0 8px}
.nz-icon-btn{background:rgba(255,255,255,.1);border:0;color:var(--nz-ink);border-radius:999px;width:34px;height:34px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none}
.nz-panel-what{color:var(--nz-dim);font-size:14px;margin:10px 0}
.nz-panel-addr{font-size:12px;overflow-wrap:anywhere;margin:0 0 10px}
.nz-panel-addr span{color:var(--nz-dim)}
.nz-panel-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0}
.nz-panel-stats div{background:rgba(255,255,255,.05);border-radius:12px;padding:10px}
.nz-panel-stats dt{font-size:12px;color:var(--nz-dim)}
.nz-panel-stats dd{margin:2px 0 0;font-weight:700;font-variant-numeric:tabular-nums}
.nz-panel-stats em{font-style:normal;font-weight:500;color:var(--nz-dim)}
.nz-flowlist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.nz-flowlist li{background:rgba(255,255,255,.04);border-radius:12px;padding:10px;position:relative}
.nz-fl-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.nz-fl-top .nz-kind{margin:0}
.nz-fl-date{margin-left:auto;color:var(--nz-dim);font-size:12px;font-variant-numeric:tabular-nums}
.nz-fl-sub,.nz-fl-who{font-size:13px;margin-top:4px;color:var(--nz-dim)}
.nz-fl-tx{font-size:12px;position:absolute;right:10px;bottom:8px}
.nz-stream{margin-top:6px}
.nz-stream-bar{height:6px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden}
.nz-stream-bar span{display:block;height:100%;background:#0098b0}
.nz-stream small{display:block;color:var(--nz-dim);font-size:12px;margin-top:4px;padding-right:28px}
/* explore */
.nz-explore-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.nz-explore-head .nz-h{margin:0}
.nz-3d{position:relative;height:min(70vh,640px);border-radius:14px;overflow:hidden;background:#050506}
.nz-3d-loading{display:flex;align-items:center;justify-content:center;color:var(--nz-dim)}
.nz-3d-label{pointer-events:none;white-space:nowrap;text-align:center;font:600 12px/1.25 var(--site-font,system-ui);color:var(--nz-ink);text-shadow:0 1px 3px #000,0 0 8px #000}
.nz-3d-label b{display:block}
.nz-3d-label span{color:var(--nz-dim);font-weight:500}
.nz-3d-label.is-treasury{color:var(--nz-acid);font-size:14px}
.nz-3d-legend{position:absolute;z-index:20;left:10px;bottom:10px;right:10px;background:rgba(20,21,25,.82);backdrop-filter:blur(8px);border-radius:12px;padding:8px 10px;font-size:12px;color:var(--nz-dim);display:flex;flex-direction:column;gap:4px;pointer-events:none}
.nz-3d-legend div{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center}
.nz-3d-legend b{color:var(--nz-ink);font-weight:600;min-width:44px}
.nz-3d-legend i{width:8px;height:8px;border-radius:2px;display:inline-block}
.nz-3d-legend p{margin:0}
/* legend */
.nz-legend-card dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px 18px;margin:0 0 12px}
.nz-legend-card dt{font-weight:600;display:flex;align-items:center;gap:8px}
.nz-legend-card dt i{width:10px;height:10px;border-radius:3px;display:inline-block}
.nz-legend-card dd{margin:2px 0 0;color:var(--nz-dim);font-size:13px}
@media (max-width:720px){
  .nz-tiles{grid-template-columns:1fr}
  .nz-tile{padding:14px 16px}
  .nz-table .hide-sm{display:none}
  .nz-row-meta.show-sm{display:block}
  .nz-card,.nz-legend-card{padding:14px}
  .nz-holder{padding:8px}
  .nz-hold-table{table-layout:fixed;font-size:13px}
  .nz-hold-table th,.nz-hold-table td{padding:7px 4px}
  .nz-hold-table th:nth-child(1){width:32%}
  .nz-hold-table th:nth-child(3){width:24%}
  .nz-hold-table .num{white-space:normal;overflow-wrap:anywhere}
  .nz-row-meta .nz-share{display:block}
  .nz-tip:hover::after,.nz-tip:focus::after{position:fixed;left:16px;right:16px;top:auto;bottom:84px;transform:none;width:auto;z-index:60}
}
`;
