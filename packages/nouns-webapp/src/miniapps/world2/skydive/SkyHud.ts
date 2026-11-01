// ── Skydiving HUD (plain DOM, in the Noun World HUD style) ────────────────
//
// While skydiving: an altimeter (height over whatever is under you) and
// fall speed, centre right; the body position / canopy hints under it; a
// big PULL prompt once you're low enough to want the canopy (and still
// high enough to open it), TOO LOW when it's too late; on touch screens a
// round PULL button. Mounted over the game canvas by SkydiveSystem, writes
// to the DOM only when something changed; no animation under reduced motion.

const CSS = `
.w2sky{position:absolute;inset:0;pointer-events:none;z-index:6;display:none}
.w2sky.on{display:block}
.w2sky-alt{position:absolute;right:22px;top:50%;transform:translateY(-50%);text-align:right;color:#fff}
.w2sky-num{font-family:'Londrina Solid',system-ui,sans-serif;font-style:italic;font-weight:900;font-variant-numeric:tabular-nums;line-height:1;text-shadow:2px 2px 0 #0b0b12,-1px -1px 0 #0b0b12,1px -1px 0 #0b0b12,-1px 1px 0 #0b0b12}
.w2sky-m{font-size:54px}
.w2sky-m small{font-size:22px;margin-left:3px}
.w2sky-v{font-size:22px;color:#20d6ff;margin-top:4px}
.w2sky-lbl{font:800 10px/1 system-ui,sans-serif;letter-spacing:.14em;opacity:.9;text-shadow:0 1px 2px #000;margin-bottom:4px}
.w2sky-bar{position:relative;width:12px;height:150px;margin:8px 0 0 auto;border:2px solid #0b0b12;border-radius:6px;background:rgba(11,11,18,.55);box-shadow:0 0 0 1.5px rgba(255,255,255,.3);overflow:hidden}
.w2sky-bar i{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(0deg,#ff2f8e,#ffd400 45%,#20d6ff)}
.w2sky-bar u{position:absolute;left:0;right:0;height:2px;background:#fff}
.w2sky-hint{position:absolute;left:50%;bottom:118px;transform:translateX(-50%);white-space:nowrap;font:800 12px/1.3 system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000;background:rgba(11,11,18,.55);border:2px solid #0b0b12;border-radius:999px;padding:5px 12px;box-shadow:0 0 0 1.5px rgba(255,255,255,.22)}
.w2sky-hint b{color:#ffd400}
.w2sky-pull{position:absolute;left:50%;top:30%;transform:translate(-50%,-50%);font-size:64px;color:#ffd400;opacity:0;transition:opacity .15s}
.w2sky-pull small{display:block;font:800 13px/1 system-ui,sans-serif;letter-spacing:.14em;color:#fff;margin-top:6px;font-style:normal}
.w2sky-pull.on{opacity:1;animation:w2skyblink .5s steps(2) infinite}
.w2sky-pull.low{color:#ff2f8e}
@keyframes w2skyblink{50%{opacity:.35}}
.w2sky-btn{position:absolute;right:18px;bottom:40%;width:86px;height:86px;border-radius:50%;border:3px solid #0b0b12;box-shadow:0 0 0 2px #fff,0 4px 0 rgba(0,0,0,.35);background:#ffd400;color:#0b0b12;font:900 18px/1 'Londrina Solid',system-ui,sans-serif;letter-spacing:.04em;pointer-events:auto;touch-action:none;display:none}
.w2sky.touch.ff .w2sky-btn{display:block}
.w2sky-btn.ready{background:#ff2f8e;color:#fff}
@media (max-width:640px){.w2sky-alt{right:12px;top:38%}.w2sky-m{font-size:40px}.w2sky-bar{height:100px}.w2sky-pull{font-size:44px}.w2sky-hint{bottom:auto;top:96px;font-size:11px}}
@media (prefers-reduced-motion:reduce){.w2sky-pull.on{animation:none}.w2sky-pull{transition:none}}
`;

export interface SkyHudView {
  on: boolean;
  freefall: boolean;
  /** Height over what's under you (m). */
  alt: number;
  /** Fall speed (km/h). */
  kmh: number;
  /** 0..1 of the bar (alt / scale). */
  bar: number;
  /** Where on the bar the canopy stops opening in time (0..1). */
  floor: number;
  hint: string;
  /** 'pull' | 'low' | '' */
  prompt: '' | 'pull' | 'low';
  touch: boolean;
  /** The touch button would pull now. */
  ready: boolean;
}

export class SkyHud {
  readonly root: HTMLDivElement;
  private style: HTMLStyleElement;
  private el: Record<string, HTMLElement> = {};
  private last: Record<string, string> = {};

  constructor(
    parent: HTMLElement,
    onPull: () => void,
    private pullKey: string,
    private lowKey: string,
  ) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    const r = document.createElement('div');
    r.className = 'w2sky';
    r.setAttribute('data-w2hud', 'skydive');
    r.innerHTML = `
      <div class="w2sky-alt"><div class="w2sky-lbl">ALTITUDE</div>
        <div class="w2sky-num w2sky-m"><span>0</span><small>M</small></div>
        <div class="w2sky-num w2sky-v">0 KM/H</div>
        <div class="w2sky-bar"><i></i><u></u></div></div>
      <div class="w2sky-hint"></div>
      <div class="w2sky-num w2sky-pull">PULL!<small>${pullKey}</small></div>
      <button type="button" class="w2sky-btn" aria-label="Pull the parachute">PULL</button>`;
    for (const [k, sel] of Object.entries({
      m: '.w2sky-m span',
      v: '.w2sky-v',
      bar: '.w2sky-bar i',
      floor: '.w2sky-bar u',
      hint: '.w2sky-hint',
      pull: '.w2sky-pull',
      btn: '.w2sky-btn',
    }))
      this.el[k] = r.querySelector(sel)!;
    const press = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      onPull();
    };
    this.el.btn!.addEventListener('pointerdown', press);
    parent.appendChild(r);
    this.root = r;
  }

  private set(k: string, v: string, f: (el: HTMLElement, v: string) => void) {
    if (this.last[k] === v) return;
    this.last[k] = v;
    f(this.el[k] ?? this.root, v);
  }

  update(v: SkyHudView) {
    const cls = ['w2sky', v.on ? 'on' : '', v.touch ? 'touch' : '', v.freefall ? 'ff' : '']
      .filter(Boolean)
      .join(' ');
    this.set('root', cls, (el, c) => (el.className = c));
    if (!v.on) return;
    this.set('m', String(Math.round(v.alt)), (el, t) => (el.textContent = t));
    this.set('v', `${Math.round(v.kmh)} KM/H`, (el, t) => (el.textContent = t));
    this.set('bar', `${Math.round(v.bar * 100)}%`, (el, h) => (el.style.height = h));
    this.set('floor', `${Math.round(v.floor * 100)}%`, (el, b) => (el.style.bottom = b));
    this.set('hint', v.hint, (el, h) => (el.innerHTML = h));
    this.set(
      'hintShow',
      v.hint === '' ? 'none' : '',
      (_el, d) => (this.el.hint!.style.display = d),
    );
    this.set('pull', v.prompt, (el, p) => {
      el.className = `w2sky-num w2sky-pull${p === '' ? '' : ' on'}${p === 'low' ? ' low' : ''}`;
      el.firstChild!.textContent = p === 'low' ? 'TOO LOW!' : 'PULL!';
      el.lastChild!.textContent = p === 'low' ? this.lowKey : this.pullKey;
    });
    this.set('ready', v.ready ? '1' : '', (_el, r) =>
      this.el.btn!.classList.toggle('ready', r === '1'),
    );
  }

  dispose() {
    this.root.remove();
    this.style.remove();
  }
}
