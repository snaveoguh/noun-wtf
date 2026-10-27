// ── The Big Drop's SSX course: its HUD (plain DOM) ───────────────────────
//
// The run clock and split, checkpoint count and best time (top centre,
// under the "nothing here counts" note), a banner for GO / splits / FINISH,
// the boost meter (bottom left) with a BOOST button on touch screens, speed
// lines while boosting and a dark vignette inside the caves. Mounted over
// the game canvas by the course system and removed on the way out; writes
// to the DOM only when something changed.

const CSS = `
.bdssx{position:absolute;inset:0;pointer-events:none;z-index:6;font-family:"Pip3","Courier New",monospace;color:#fff}
.bdssx-top{position:absolute;left:50%;top:118px;transform:translateX(-50%);text-align:center;text-shadow:0 2px 0 #000,0 0 8px rgba(0,0,0,.6)}
.bdssx-t{font:700 34px/1 "Pip3","Courier New",monospace;letter-spacing:1px}
.bdssx-d{font:700 18px/1.2 "Pip3","Courier New",monospace;min-height:20px}
.bdssx-d.up{color:#ff5a4a}.bdssx-d.down{color:#4bff8a}
.bdssx-sub{font:700 11px/1.3 system-ui,sans-serif;color:#ffd400;letter-spacing:.5px}
.bdssx-hint{font:700 12px/1.3 system-ui,sans-serif;color:#cfe8ff;margin-top:4px}
.bdssx-banner{position:absolute;left:50%;top:30%;transform:translate(-50%,-50%) scale(.9);font:700 54px/1 "Pip3","Courier New",monospace;color:#ffd400;text-shadow:0 3px 0 #000,0 0 18px rgba(0,0,0,.7);opacity:0;transition:opacity .25s,transform .25s;white-space:nowrap;text-align:center}
.bdssx-banner small{display:block;font-size:20px;color:#fff;margin-top:8px}
.bdssx-banner.on{opacity:1;transform:translate(-50%,-50%) scale(1)}
.bdssx-boost{position:absolute;left:16px;bottom:120px;width:180px}
.bdssx-boost b{display:flex;justify-content:space-between;font:700 11px/1 system-ui,sans-serif;color:#59e1ff;margin-bottom:4px;text-shadow:0 1px 0 #000}
.bdssx-boost kbd{font:700 10px/1 system-ui,sans-serif;color:#ffd400;border:1px solid rgba(255,212,0,.5);border-radius:4px;padding:1px 4px}
.bdssx-bar{height:12px;border:2px solid #fff;border-radius:3px;background:rgba(0,0,0,.45);overflow:hidden;position:relative}
.bdssx-bar i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#1e88ff,#59e1ff,#ffd400);transition:width .1s}
.bdssx-bar u{position:absolute;top:0;bottom:0;width:2px;background:rgba(255,255,255,.55)}
.bdssx-boost.full .bdssx-bar{border-color:#ffd400;box-shadow:0 0 10px #ffd400}
.bdssx-boost.burn .bdssx-bar i{background:linear-gradient(90deg,#ff3a2a,#ffd400,#fff)}
.bdssx-btn{position:absolute;right:16px;bottom:46%;width:74px;height:74px;border-radius:50%;border:3px solid #fff;background:rgba(30,136,255,.55);color:#fff;font:700 13px/1 system-ui,sans-serif;pointer-events:auto;touch-action:none;display:none}
.bdssx-btn.ready{background:rgba(255,212,0,.75);color:#101216}
.bdssx.touch .bdssx-btn{display:block}
.bdssx.touch .bdssx-boost kbd{display:none}
.bdssx-lines{position:absolute;inset:0;z-index:-1;opacity:0;transition:opacity .2s;background:repeating-conic-gradient(from 0deg at 50% 55%,rgba(255,255,255,0) 0deg 4deg,rgba(255,255,255,.22) 4.4deg 5deg,rgba(255,255,255,0) 5.4deg 9deg);-webkit-mask:radial-gradient(circle at 50% 55%,transparent 32%,#000 70%);mask:radial-gradient(circle at 50% 55%,transparent 32%,#000 70%);animation:bdssx-spin 0.35s linear infinite}
@keyframes bdssx-spin{to{transform:rotate(6deg)}}
.bdssx-lines.on{opacity:1}
.bdssx-cave{position:absolute;inset:0;z-index:-1;opacity:0;transition:opacity .35s;background:radial-gradient(ellipse at 50% 50%,rgba(0,8,30,0) 30%,rgba(0,8,30,.55) 70%,rgba(0,4,16,.85) 100%)}
.bdssx-cave.on{opacity:1}
.bdssx[data-off] .bdssx-top{display:none}
@media (max-width:640px){.bdssx-top{top:150px}.bdssx-t{font-size:26px}.bdssx-banner{font-size:34px}.bdssx-banner small{font-size:15px}.bdssx-boost{width:120px;bottom:44%;left:12px}.bdssx-btn{bottom:30%;right:12px;width:64px;height:64px}}
`;

export interface HudView {
  /** Show the clock (false out on the free-ride mountain). */
  clock: boolean;
  time: string;
  delta: string;
  /** −1 = ahead (green), +1 = behind (red), 0 = none. */
  deltaSign: number;
  sub: string;
  hint: string;
  meter: number;
  full: boolean;
  burning: boolean;
  cave: boolean;
  touch: boolean;
}

export class CourseHud {
  readonly root: HTMLDivElement;
  private el: Record<string, HTMLElement> = {};
  private last: Record<string, string> = {};
  private bannerUntil = 0;
  private style: HTMLStyleElement;

  constructor(parent: HTMLElement, onBoost: () => void) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    const r = document.createElement('div');
    r.className = 'bdssx';
    r.setAttribute('data-w2hud', 'bigdrop-ssx');
    r.innerHTML = `
      <div class="bdssx-lines"></div>
      <div class="bdssx-cave"></div>
      <div class="bdssx-top"><div class="bdssx-t">0:00.00</div><div class="bdssx-d"></div><div class="bdssx-sub"></div><div class="bdssx-hint"></div></div>
      <div class="bdssx-banner"></div>
      <div class="bdssx-boost"><b><span>BOOST</span><kbd>TAB</kbd></b><div class="bdssx-bar"><i></i><u style="left:25%"></u><u style="left:50%"></u><u style="left:75%"></u></div></div>
      <button type="button" class="bdssx-btn" aria-label="Boost">BOOST</button>`;
    for (const [k, sel] of Object.entries({
      lines: '.bdssx-lines',
      cave: '.bdssx-cave',
      t: '.bdssx-t',
      d: '.bdssx-d',
      sub: '.bdssx-sub',
      hint: '.bdssx-hint',
      banner: '.bdssx-banner',
      boost: '.bdssx-boost',
      fill: '.bdssx-bar i',
      btn: '.bdssx-btn',
    }))
      this.el[k] = r.querySelector(sel)!;
    const press = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      onBoost();
    };
    this.el.btn!.addEventListener('pointerdown', press);
    parent.appendChild(r);
    this.root = r;
  }

  private set(key: string, value: string, apply: (v: string) => void) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply(value);
  }

  /** A big line in the middle for `ms` (and an optional small one under it). */
  banner(text: string, ms = 1400, small = '') {
    const b = this.el.banner!;
    b.innerHTML = '';
    b.append(text);
    if (small !== '') {
      const s = document.createElement('small');
      s.textContent = small;
      b.append(s);
    }
    b.classList.add('on');
    this.bannerUntil = performance.now() + ms;
  }

  update(v: HudView) {
    const e = this.el;
    this.set('clock', v.clock ? '1' : '', x => this.root.toggleAttribute('data-off', x === ''));
    this.set('touch', v.touch ? '1' : '', x => this.root.classList.toggle('touch', x === '1'));
    this.set('t', v.time, x => (e.t!.textContent = x));
    this.set('d', v.delta, x => (e.d!.textContent = x));
    this.set('ds', String(v.deltaSign), x => {
      e.d!.classList.toggle('up', x === '1');
      e.d!.classList.toggle('down', x === '-1');
    });
    this.set('sub', v.sub, x => (e.sub!.textContent = x));
    this.set('hint', v.hint, x => (e.hint!.textContent = x));
    this.set(
      'fill',
      (Math.round(v.meter * 200) / 2).toString(),
      x => (e.fill!.style.width = `${x}%`),
    );
    this.set('full', v.full ? '1' : '', x => {
      e.boost!.classList.toggle('full', x === '1');
    });
    this.set('ready', v.meter >= 0.25 ? '1' : '', x => e.btn!.classList.toggle('ready', x === '1'));
    this.set('burn', v.burning ? '1' : '', x => {
      e.boost!.classList.toggle('burn', x === '1');
      e.lines!.classList.toggle('on', x === '1');
    });
    this.set('cave', v.cave ? '1' : '', x => e.cave!.classList.toggle('on', x === '1'));
    if (this.bannerUntil > 0 && performance.now() > this.bannerUntil) {
      this.bannerUntil = 0;
      e.banner!.classList.remove('on');
    }
  }

  dispose() {
    this.root.remove();
    this.style.remove();
  }
}
