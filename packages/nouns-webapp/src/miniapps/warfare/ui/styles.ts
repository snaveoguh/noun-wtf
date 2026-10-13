// Sticker-style UI for Noun Warfare (same family as world2's w2-* classes:
// Pip3 italic titles with a red drop, Londrina buttons with a hard shadow,
// yellow "now playing" stickers), plus the FPS HUD bits.

export const WF_CSS = `
.wf-root{font-family:'Londrina Solid','PT Root UI',system-ui,sans-serif;color:#fff}
.wf-root *{box-sizing:border-box}
.wf-title{font-family:'Pip3',system-ui,sans-serif !important;text-transform:uppercase;font-size:clamp(52px,10vw,132px);line-height:.85;font-style:italic;letter-spacing:.01em;text-shadow:0 7px 0 #d22209,0 14px 36px rgba(0,0,0,.6)}
.wf-title span{display:block;color:#ffd400;font-size:.5em;text-align:right}
.wf-btn{pointer-events:auto;background:#d22209;color:#fff;font-family:'Londrina Solid',system-ui,sans-serif !important;font-weight:900;font-size:26px;letter-spacing:.04em;padding:10px 30px;border-radius:14px;box-shadow:0 6px 0 #7a1405,0 10px 30px rgba(0,0,0,.4);transition:transform .08s;border:0;cursor:pointer}
.wf-btn:active{transform:translateY(4px);box-shadow:0 2px 0 #7a1405}
.wf-btn.alt{background:#2b2f3a;box-shadow:0 6px 0 #11131a,0 10px 30px rgba(0,0,0,.4)}
.wf-btn.sm{font-size:18px;padding:6px 18px}
.wf-pulse{animation:wfpulse 1.6s ease-in-out infinite}
@keyframes wfpulse{50%{transform:scale(1.05)}}
.wf-lobby{position:absolute;inset:0;overflow-y:auto;background:radial-gradient(ellipse at 50% 30%,rgba(20,24,50,.35),rgba(5,6,14,.86));pointer-events:auto}
.wf-lobby-inner{max-width:1080px;margin:0 auto;padding:22px 16px 120px}
.wf-panel{background:rgba(10,12,22,.78);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:2px solid rgba(255,255,255,.14);border-radius:16px;padding:12px}
.wf-h{font-size:13px;letter-spacing:.28em;opacity:.7;margin:0 0 8px}
.wf-cards{display:grid;gap:10px}
.wf-card{position:relative;text-align:left;background:#161a28;border:3px solid #2a3046;border-radius:14px;padding:10px 12px;cursor:pointer;transition:transform .12s,border-color .12s;color:#fff}
.wf-card:hover{transform:translateY(-2px) rotate(-.4deg)}
.wf-card.on{border-color:#ffd400;background:#22263a;box-shadow:5px 5px 0 #d22209;transform:rotate(-1deg)}
.wf-card b{display:block;font-size:22px;line-height:1;font-style:italic}
.wf-card small{display:block;font-family:system-ui,sans-serif;font-size:12px;opacity:.75;margin-top:4px;line-height:1.25}
.wf-chip{display:inline-flex;align-items:center;gap:6px;background:rgba(10,12,20,.55);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:4px 12px;white-space:nowrap}
.wf-seg{display:flex;gap:6px;flex-wrap:wrap}
.wf-seg button{flex:1;min-width:64px;background:#161a28;border:3px solid #2a3046;border-radius:12px;padding:6px 10px;font-size:20px;font-weight:900;color:#fff;cursor:pointer;font-style:italic}
.wf-seg button.on{border-color:#ffd400;background:#2a2410;color:#ffd400}
.wf-sticker{display:inline-block;background:#ffd400;color:#000;padding:6px 14px;box-shadow:5px 5px 0 #d22209;transform:rotate(-2deg);font-weight:900;font-style:italic}
.wf-bar{height:12px;border-radius:999px;background:rgba(255,255,255,.12);overflow:hidden}
.wf-bar>i{display:block;height:100%;background:linear-gradient(90deg,#ffd400,#ff7a1a)}
.wf-gun{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;border-radius:10px;background:#141826;border:2px solid #232a40;font-size:16px}
.wf-gun.locked{opacity:.45}
.wf-gun i{font-style:normal;font-family:system-ui;font-size:11px;opacity:.8}
.wf-keys{font-family:system-ui,sans-serif;font-size:12px;display:grid;grid-template-columns:auto 1fr;gap:3px 12px}
.wf-keys b{color:#ffd400;text-align:right;font-family:'Londrina Solid',system-ui}

@media (max-height:900px){.wf-title{font-size:clamp(44px,7.5vw,92px)}.wf-lobby-inner{padding-top:12px}.wf-lobby-inner>.mt-5{margin-top:10px}.wf-card{padding:7px 10px}.wf-card b{font-size:19px}.wf-panel{padding:9px 11px}.wf-cards{gap:8px}.wf-gun{padding:4px 10px}}
.wf-hud{position:absolute;inset:0;pointer-events:none;user-select:none}
.wf-cross{position:absolute;left:50%;top:50%;width:0;height:0}
.wf-cross i{position:absolute;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.65);border-radius:1px}
.wf-dot{position:absolute;left:-2px;top:-2px;width:4px;height:4px;border-radius:50%;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.7)}
.wf-hitmark{position:absolute;left:50%;top:50%;width:0;height:0;animation:wfhit .22s ease-out forwards}
.wf-hitmark i{position:absolute;width:3px;height:12px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.5);left:-1.5px;top:-6px}
.wf-hitmark.kill i{background:#ff3b2f;height:18px;top:-9px;width:4px;left:-2px}
.wf-hitmark.head i{background:#ffd400}
@keyframes wfhit{0%{opacity:1;transform:scale(1.35)}100%{opacity:0;transform:scale(1)}}
.wf-killpop{position:absolute;left:50%;top:calc(50% + 34px);transform:translateX(-50%);font-size:30px;font-weight:900;font-style:italic;color:#fff;text-shadow:0 3px 0 #d22209,0 0 14px rgba(0,0,0,.5);animation:wfkill .9s ease-out forwards;white-space:nowrap}
@keyframes wfkill{0%{transform:translateX(-50%) scale(.4) rotate(-8deg);opacity:0}15%{transform:translateX(-50%) scale(1.25) rotate(-4deg);opacity:1}30%{transform:translateX(-50%) scale(1) rotate(-3deg)}80%{opacity:1}100%{opacity:0;transform:translateX(-50%) translateY(-14px) rotate(-3deg)}}
.wf-callout{font-size:clamp(26px,4.2vw,48px);font-weight:900;font-style:italic;color:#ffd400;text-shadow:0 3px 0 #7a1405,0 0 22px rgba(0,0,0,.55);animation:wfcall 2.2s ease-out forwards;white-space:nowrap}
.wf-callout.t0{font-size:clamp(18px,2.6vw,28px);color:#fff}
.wf-callout.t3,.wf-callout.t4{color:#ff4fd8;text-shadow:0 4px 0 #3a0730,0 0 26px rgba(255,79,216,.55)}
@keyframes wfcall{0%{transform:scale(.3) rotate(-6deg);opacity:0}12%{transform:scale(1.18) rotate(-3deg);opacity:1}24%{transform:scale(1) rotate(-3deg)}80%{opacity:1}100%{opacity:0;transform:translateY(-16px) rotate(-3deg)}}
.wf-feed{position:absolute;right:12px;top:12px;display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:15px}
.wf-feed div{background:rgba(8,10,18,.62);border-radius:8px;padding:3px 10px;animation:wffeed .25s ease-out;white-space:nowrap;font-family:'Londrina Solid',system-ui}
.wf-feed div.mine{border:2px solid #ffd400}
.wf-feed em{font-style:normal;opacity:.75;font-family:system-ui;font-size:12px;margin:0 6px}
@keyframes wffeed{from{transform:translateX(30px);opacity:0}}
.wf-top{position:absolute;left:50%;top:10px;transform:translateX(-50%);display:flex;align-items:center;gap:8px}
.wf-score{min-width:62px;text-align:center;font-size:30px;font-weight:900;font-style:italic;padding:0 12px;border-radius:12px;line-height:1.25;text-shadow:0 2px 0 rgba(0,0,0,.4)}
.wf-clock{font-size:20px;background:rgba(8,10,18,.7);border-radius:10px;padding:2px 12px;font-variant-numeric:tabular-nums}
.wf-zone{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:20px;border:3px solid #fff;position:relative;overflow:hidden;background:#333}
.wf-zone.contested{animation:wfblink .4s steps(2) infinite}
@keyframes wfblink{50%{border-color:#ffd400}}
.wf-hp{position:absolute;left:calc(14px + env(safe-area-inset-left));bottom:calc(14px + env(safe-area-inset-bottom));display:flex;align-items:flex-end;gap:10px}
.wf-hpnum{font-size:46px;font-weight:900;font-style:italic;line-height:.9;text-shadow:0 3px 0 rgba(0,0,0,.5)}
.wf-hpbar{width:180px;height:14px;border-radius:999px;background:rgba(0,0,0,.45);overflow:hidden;border:2px solid rgba(255,255,255,.25)}
.wf-hpbar i{display:block;height:100%;transition:width .15s}
.wf-ammo{position:absolute;right:calc(14px + env(safe-area-inset-right));bottom:calc(64px + env(safe-area-inset-bottom));text-align:right}
.wf-ammonum{font-size:46px;font-weight:900;font-style:italic;line-height:.9;text-shadow:0 3px 0 rgba(0,0,0,.5)}
.wf-ammonum small{font-size:22px;opacity:.7}
.wf-slots{display:flex;gap:4px;justify-content:flex-end;margin-top:6px}
.wf-slot{font-size:12px;padding:2px 7px;border-radius:7px;background:rgba(8,10,18,.6);border:2px solid transparent;opacity:.7;font-family:system-ui}
.wf-slot.on{border-color:#ffd400;opacity:1}
.wf-center{position:absolute;left:50%;top:22%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}
.wf-count{font-size:clamp(70px,14vw,150px);font-weight:900;font-style:italic;color:#ffd400;text-shadow:0 8px 0 #d22209;animation:wfcount 1s ease-out infinite}
@keyframes wfcount{0%{transform:scale(1.4);opacity:.3}20%{transform:scale(1);opacity:1}}
.wf-banner{display:flex;flex-direction:column;align-items:center;background:#ffd400;color:#000;padding:8px 22px;box-shadow:6px 6px 0 #d22209;transform:rotate(-2deg);animation:wfbanner 3.2s ease-out forwards}
.wf-banner b{font-size:clamp(22px,3.4vw,38px);font-style:italic;line-height:1}
.wf-banner span{font-size:12px;letter-spacing:.2em;font-family:system-ui}
@keyframes wfbanner{0%{opacity:0;transform:translateY(-20px) rotate(-2deg)}8%{opacity:1;transform:rotate(-2deg)}85%{opacity:1}100%{opacity:0}}
.wf-dmg{position:absolute;left:50%;top:50%;width:0;height:0}
.wf-dmg i{position:absolute;left:-46px;top:-150px;width:92px;height:26px;border-radius:50% 50% 0 0;border-top:7px solid #ff3b2f;filter:drop-shadow(0 0 6px rgba(255,40,30,.7));animation:wffade 1.2s ease-out forwards}
@keyframes wffade{0%{opacity:1}100%{opacity:0}}
.wf-paint{position:absolute;border-radius:46% 54% 60% 40%/50% 42% 58% 50%;animation:wfdrip 2.6s ease-in forwards;filter:drop-shadow(0 0 2px rgba(0,0,0,.25))}
.wf-paint::after{content:'';position:absolute;left:38%;top:70%;width:18%;height:70%;border-radius:0 0 50% 50%;background:inherit}
@keyframes wfdrip{0%{transform:scale(.4);opacity:.95}8%{transform:scale(1.06)}12%{transform:scale(1)}70%{opacity:.85}100%{opacity:0;transform:translateY(40px) scaleY(1.15)}}
.wf-vignette{position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 55%,rgba(220,20,10,.55));transition:opacity .2s}
.wf-dead{position:absolute;left:50%;bottom:26%;transform:translateX(-50%);text-align:center}
.wf-dead b{display:block;font-size:clamp(42px,8vw,86px);font-style:italic;color:#fff;text-shadow:0 6px 0 #d22209;line-height:.9}
.wf-board{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(760px,94vw);max-height:80vh;overflow:auto;pointer-events:auto}
.wf-board.inline{position:relative;left:auto;top:auto;transform:none;max-height:none;flex:0 1 auto;min-height:0;overflow:auto}
.wf-results{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:64px 12px calc(76px + env(safe-area-inset-bottom));background:rgba(5,6,14,.45);pointer-events:auto;overflow-y:auto}
.wf-results .wf-board.inline{max-height:52vh}
.wf-board table{width:100%;border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px}
.wf-board td,.wf-board th{padding:4px 8px;text-align:right}
.wf-board td:first-child,.wf-board th:first-child{text-align:left}
.wf-board tr.me{background:rgba(255,212,0,.16)}
.wf-board tr.dead{opacity:.5}
.wf-scope{position:absolute;inset:0;background:radial-gradient(circle at center,transparent 0,transparent min(36vh,36vw),#000 calc(min(36vh,36vw) + 2px))}
.wf-scope i{position:absolute;background:#000}
.wf-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(5,6,14,.6);pointer-events:auto;text-align:center;padding:16px}
.wf-nametag{position:absolute;left:0;top:0;font-family:'Londrina Solid',system-ui,sans-serif;font-size:14px;white-space:nowrap;pointer-events:none;will-change:transform}
.wf-nametag span{background:rgba(0,0,0,.55);padding:1px 8px;border-radius:999px;border-bottom:3px solid #fff;color:#fff}
.wf-touch{position:absolute;inset:0;pointer-events:none}
.wf-tbtn{position:absolute;pointer-events:auto;border-radius:50%;background:rgba(10,12,20,.45);border:2px solid rgba(255,255,255,.35);color:#fff;font-weight:900;display:flex;align-items:center;justify-content:center;font-size:13px;touch-action:none;user-select:none;-webkit-user-select:none}
.wf-tbtn.on{background:rgba(255,212,0,.5);border-color:#ffd400}
.wf-tbtn.fire{background:rgba(210,34,9,.55);border-color:#ff8a7a;font-size:16px}
.wf-stick{position:absolute;pointer-events:none;border-radius:50%;border:2px solid rgba(255,255,255,.3);background:rgba(255,255,255,.06)}
.wf-stick i{position:absolute;left:50%;top:50%;width:48px;height:48px;margin:-24px 0 0 -24px;border-radius:50%;background:rgba(255,255,255,.35)}
.wf-protect{position:absolute;left:50%;bottom:120px;transform:translateX(-50%);font-size:13px;letter-spacing:.2em;font-family:system-ui;opacity:.8}

/* Phone HUD: clear of the NounOS tray (top centre on phones) and the thumb buttons */
.wf-hud.touch .wf-top{top:calc(40px + env(safe-area-inset-top))}
.wf-hud.touch .wf-score{font-size:22px;min-width:44px;padding:0 8px}
.wf-hud.touch .wf-clock{font-size:15px}
.wf-hud.touch .wf-zones{top:calc(84px + env(safe-area-inset-top)) !important}
.wf-hud.touch .wf-zone{width:28px;height:28px;font-size:16px}
.wf-hud.touch .wf-feed{top:calc(136px + env(safe-area-inset-top));right:8px;font-size:11px;gap:2px}
.wf-hud.touch .wf-feed div{padding:2px 7px}
.wf-hud.touch .wf-feed em{font-size:10px;margin:0 3px}
.wf-hud.touch .wf-feed div:nth-last-child(n+4){display:none}
.wf-hud.touch .wf-hp{bottom:calc(178px + env(safe-area-inset-bottom));left:12px;gap:6px}
.wf-hud.touch .wf-top .text-\\[10px\\]{white-space:nowrap;font-size:9px}
.wf-hud.touch .wf-hpnum{font-size:28px}
.wf-hud.touch .wf-hpbar{width:84px;height:10px}
.wf-hud.touch .wf-ammo{bottom:calc(262px + env(safe-area-inset-bottom));right:12px}
.wf-hud.touch .wf-ammonum{font-size:30px}
.wf-hud.touch .wf-ammonum small{font-size:15px}
.wf-hud.touch .wf-slots,.wf-hud.touch .wf-nades{display:none}
.wf-hud.touch .wf-protect{bottom:auto;top:48%}
@media (max-height:520px){.wf-hud.touch .wf-ammo{bottom:calc(14px + env(safe-area-inset-bottom));right:250px}}
`;
