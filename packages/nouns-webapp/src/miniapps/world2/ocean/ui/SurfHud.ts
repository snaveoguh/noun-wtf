// ── Surf HUD (plain DOM, the Noun World HUD style) ────────────────────────
//
// In the sea: a hint line for what you're doing (wading / swimming /
// paddling / riding), POP UP! when a wave is yours, a speed readout while
// you ride, a wipeout flash; on touch screens a round button (POP / DUCK).
// Near the shop: a SURF SHOP prompt. Writes to the DOM only on change.

const CSS = `
.w2surf{position:absolute;inset:0;pointer-events:none;z-index:6;display:none}
.w2surf.on{display:block}
.w2surf-num{font-family:'Londrina Solid',system-ui,sans-serif;font-style:italic;font-weight:900;line-height:1;text-shadow:2px 2px 0 #0b0b12,-1px -1px 0 #0b0b12,1px -1px 0 #0b0b12,-1px 1px 0 #0b0b12}
.w2surf-hint{position:absolute;left:50%;bottom:118px;transform:translateX(-50%);white-space:nowrap;font:800 12px/1.3 system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000;background:rgba(11,11,18,.55);border:2px solid #0b0b12;border-radius:999px;padding:5px 12px;box-shadow:0 0 0 1.5px rgba(255,255,255,.22)}
.w2surf-hint b{color:#ffd400}
.w2surf-hint:empty{display:none}
.w2surf-pop{position:absolute;left:50%;top:30%;transform:translate(-50%,-50%);font-size:60px;color:#ffd400;opacity:0;transition:opacity .12s;text-align:center}
.w2surf-pop small{display:block;font:800 13px/1 system-ui,sans-serif;letter-spacing:.14em;color:#fff;margin-top:6px;font-style:normal}
.w2surf-pop.on{opacity:1;animation:w2surfblink .45s steps(2) infinite}
.w2surf-pop.wipe{opacity:1;color:#ff2f8e;animation:none}
@keyframes w2surfblink{50%{opacity:.4}}
.w2surf-spd{position:absolute;right:22px;top:50%;transform:translateY(-50%);text-align:right;color:#fff;display:none}
/* (the game's own speedometer already shows km/h: the surf one stays off) */
.w2surf-spd .w2surf-num{font-size:46px;color:#20d6ff}
.w2surf-spd small{display:block;font:800 10px/1 system-ui,sans-serif;letter-spacing:.14em;margin-top:4px;text-shadow:0 1px 2px #000}
.w2surf-btn{position:absolute;right:18px;bottom:40%;width:86px;height:86px;border-radius:50%;border:3px solid #0b0b12;box-shadow:0 0 0 2px #fff,0 4px 0 rgba(0,0,0,.35);background:#20d6ff;color:#0b0b12;font:900 17px/1 'Londrina Solid',system-ui,sans-serif;letter-spacing:.04em;pointer-events:auto;touch-action:none;display:none}
.w2surf.touch.btn .w2surf-btn{display:block}
.w2surf-btn.pop{background:#ffd400}
.w2surf-shop{position:absolute;left:50%;bottom:160px;transform:translateX(-50%);pointer-events:auto;display:none;font:900 15px/1 'Londrina Solid',system-ui,sans-serif;letter-spacing:.04em;color:#0b0b12;background:#ffd23f;border:3px solid #0b0b12;border-radius:999px;padding:9px 16px;box-shadow:0 0 0 2px #fff,0 4px 0 rgba(0,0,0,.35);cursor:pointer}
.w2surf-shop.on{display:block}
@media (max-width:640px){.w2surf-pop{font-size:42px}.w2surf-hint{bottom:auto;top:128px;left:12px;right:72px;transform:none;white-space:normal;text-align:center;border-radius:14px;font-size:11px}}
@media (prefers-reduced-motion:reduce){.w2surf-pop.on{animation:none}.w2surf-pop{transition:none}}
`;

export interface SurfHudView {
  /** In the sea at all. */
  on: boolean;
  hint: string;
  /** '' | 'pop' (a wave is yours) | 'wipe' (wiped out). */
  prompt: '' | 'pop' | 'wipe';
  popKey: string;
  wipeText: string;
  /** Riding: the speed (km/h). */
  ride: boolean;
  kmh: number;
  touch: boolean;
  /** Touch button: '' none, 'pop', 'duck'. */
  button: '' | 'pop' | 'duck';
  /** The SURF SHOP prompt (near the shop, on foot). */
  shop: string;
}

export class SurfHud {
  readonly root: HTMLDivElement;
  private style: HTMLStyleElement;
  private el: Record<string, HTMLElement> = {};
  private last: Record<string, string> = {};

  constructor(parent: HTMLElement, onButton: (b: 'pop' | 'duck') => void, onShop: () => void) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    const r = document.createElement('div');
    r.className = 'w2surf';
    r.setAttribute('data-w2hud', 'surf');
    r.innerHTML = `
      <div class="w2surf-hint"></div>
      <div class="w2surf-num w2surf-pop"><span>POP UP!</span><small></small></div>
      <div class="w2surf-spd"><div class="w2surf-num">0</div><small>KM/H</small></div>
      <button type="button" class="w2surf-btn" aria-label="Pop up"></button>
      <button type="button" class="w2surf-shop"></button>`;
    for (const [k, sel] of Object.entries({
      hint: '.w2surf-hint',
      pop: '.w2surf-pop',
      spd: '.w2surf-spd .w2surf-num',
      btn: '.w2surf-btn',
      shop: '.w2surf-shop',
    }))
      this.el[k] = r.querySelector(sel)!;
    this.el.btn!.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      onButton(this.last.button === 'duck' ? 'duck' : 'pop');
    });
    this.el.shop!.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      onShop();
    });
    parent.appendChild(r);
    this.root = r;
  }

  private set(k: string, v: string, f: (el: HTMLElement, v: string) => void) {
    if (this.last[k] === v) return;
    this.last[k] = v;
    f(this.el[k] ?? this.root, v);
  }

  update(v: SurfHudView) {
    const cls = [
      'w2surf',
      v.on || v.shop !== '' ? 'on' : '',
      v.ride ? 'ride' : '',
      v.touch ? 'touch' : '',
      v.button !== '' && v.on ? 'btn' : '',
    ]
      .filter(Boolean)
      .join(' ');
    this.set('root', cls, (el, c) => (el.className = c));
    this.set('hint', v.on ? v.hint : '', (el, h) => (el.innerHTML = h));
    this.set('pop', `${v.prompt}|${v.popKey}|${v.wipeText}`, el => {
      el.className = `w2surf-num w2surf-pop${v.prompt === 'pop' ? ' on' : v.prompt === 'wipe' ? ' wipe' : ''}`;
      el.firstChild!.textContent = v.prompt === 'wipe' ? v.wipeText : 'POP UP!';
      el.lastChild!.textContent = v.prompt === 'pop' ? v.popKey : '';
    });
    this.set('spd', v.ride ? String(Math.round(v.kmh)) : '', (el, t) => (el.textContent = t));
    this.set('button', v.button, (_el, b) => {
      const el = this.el.btn!;
      el.textContent = b === 'duck' ? 'DUCK' : b === 'pop' ? 'POP' : '';
      el.classList.toggle('pop', b === 'pop');
    });
    this.set('shop', v.shop, (el, s) => {
      el.textContent = s;
      el.classList.toggle('on', s !== '');
    });
  }

  dispose() {
    this.root.remove();
    this.style.remove();
  }
}
