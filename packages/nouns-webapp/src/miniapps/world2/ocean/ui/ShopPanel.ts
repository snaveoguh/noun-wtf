// ── The surf shop counter (plain DOM) ─────────────────────────────────────
//
// Three boards on the wall: name, blurb, what it's like (paddle / catch /
// turn / air bars), price or OWNED, and RIDE IT / BUY / SWIM (no board).
// Buying goes through the trade ledger (surf/shop.ts); the panel only
// shows what it's told and calls back.

import { BOARD_IDS, BOARDS, type BoardId } from '../surf/boards';

const CSS = `
.w2shop{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;background:rgba(11,11,18,.55);pointer-events:auto}
.w2shop-card{width:min(720px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#fff3c4;border:3px solid #0b0b12;border-radius:18px;box-shadow:0 0 0 3px #ff6f61,0 10px 0 rgba(0,0,0,.35);padding:18px;color:#1b4965;font:700 13px/1.35 system-ui,sans-serif}
.w2shop h2{margin:0 0 2px;font:900 34px/1 'Londrina Solid',system-ui,sans-serif;color:#ff6f61;letter-spacing:.02em}
.w2shop-sub{margin:0 0 14px;font-size:12px;opacity:.85}
.w2shop-coin{float:right;font:900 18px/1 'Londrina Solid',system-ui,sans-serif;color:#0b0b12;background:#ffd23f;border:2px solid #0b0b12;border-radius:999px;padding:6px 12px}
.w2shop-row{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
@media (max-width:640px){.w2shop-row{grid-template-columns:1fr}}
.w2shop-b{background:#fff;border:2px solid #0b0b12;border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:6px}
.w2shop-b.sel{box-shadow:0 0 0 3px #2ec4b6}
.w2shop-b h3{margin:0;font:900 22px/1 'Londrina Solid',system-ui,sans-serif;color:#0b0b12}
.w2shop-art{height:34px;border-radius:999px;border:2px solid #0b0b12;position:relative}
.w2shop-art i{position:absolute;left:8%;right:8%;top:50%;height:4px;margin-top:-2px}
.w2shop-st{display:grid;grid-template-columns:52px 1fr;gap:3px 6px;font-size:10px;letter-spacing:.08em;align-items:center}
.w2shop-st u{display:block;height:7px;border-radius:4px;background:#2ec4b6;border:1.5px solid #0b0b12}
.w2shop-b button{margin-top:auto;font:900 16px/1 'Londrina Solid',system-ui,sans-serif;letter-spacing:.04em;border:2px solid #0b0b12;border-radius:999px;padding:9px 10px;background:#ffd23f;color:#0b0b12;cursor:pointer}
.w2shop-b button:disabled{opacity:.5;cursor:default}
.w2shop-b button.go{background:#2ec4b6;color:#fff}
.w2shop-foot{display:flex;gap:10px;justify-content:space-between;align-items:center;margin-top:14px}
.w2shop-foot button{font:900 15px/1 'Londrina Solid',system-ui,sans-serif;border:2px solid #0b0b12;border-radius:999px;padding:8px 14px;background:#fff;color:#0b0b12;cursor:pointer}
.w2shop-msg{font-size:12px;color:#ff2f8e;min-height:1em}
`;

export interface ShopView {
  coin: number | null;
  owned: BoardId[];
  selected: BoardId | null;
  busy: BoardId | null;
  msg: string;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** 0..1 bars for the card (relative across the three boards). */
function stats(id: BoardId) {
  const b = BOARDS[id];
  return {
    PADDLE: (b.paddle - 2) / 1.2,
    CATCH: (0.75 - b.catchFrac) / 0.3,
    TURN: (b.turn - 1.2) / 1.9,
    AIR: (b.air - 0.4) / 1,
  };
}

export class ShopPanel {
  readonly root: HTMLDivElement;
  private style: HTMLStyleElement;

  constructor(
    parent: HTMLElement,
    private on: {
      pick: (id: BoardId | null) => void;
      buy: (id: BoardId) => void;
      close: () => void;
    },
  ) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root = document.createElement('div');
    this.root.className = 'w2shop';
    this.root.setAttribute('data-w2hud', 'surfshop');
    this.root.addEventListener('pointerdown', e => {
      if (e.target === this.root) on.close();
      e.stopPropagation();
    });
    this.root.addEventListener('keydown', e => e.stopPropagation());
    parent.appendChild(this.root);
  }

  render(v: ShopView) {
    const cards = BOARD_IDS.map(id => {
      const b = BOARDS[id];
      const own = v.owned.includes(id);
      const sel = v.selected === id;
      const st = Object.entries(stats(id))
        .map(([k, x]) => `<span>${k}</span><u style="width:${Math.round(18 + 82 * Math.max(0, Math.min(1, x)))}%"></u>`)
        .join('');
      const btn = own
        ? `<button type="button" data-pick="${id}" class="${sel ? '' : 'go'}" ${sel ? 'disabled' : ''}>${sel ? 'RIDING IT' : 'RIDE IT'}</button>`
        : `<button type="button" data-buy="${id}" ${v.busy !== null ? 'disabled' : ''}>${v.busy === id ? '…' : `BUY · ${b.price} COIN`}</button>`;
      return `<div class="w2shop-b${sel ? ' sel' : ''}">
        <h3>${b.name}</h3>
        <div class="w2shop-art" style="background:${hex(b.deck)}"><i style="background:${hex(b.stripe)}"></i></div>
        <div>${b.blurb}</div>
        <div class="w2shop-st">${st}</div>
        ${b.price === 0 ? '<div>FREE RENTAL</div>' : own ? '<div>OWNED</div>' : ''}
        ${btn}
      </div>`;
    }).join('');
    this.root.innerHTML = `<div class="w2shop-card" role="dialog" aria-label="Surf shop">
      <span class="w2shop-coin">${v.coin === null ? '…' : `${v.coin} COIN`}</span>
      <h2>PURA VIDA SURF CO.</h2>
      <p class="w2shop-sub">Pick a board, walk into the sea, paddle out to the line-up past the buoys.</p>
      <div class="w2shop-row">${cards}</div>
      <div class="w2shop-foot">
        <span class="w2shop-msg">${v.msg}</span>
        <span>
          <button type="button" data-pick="none">${v.selected === null ? 'SWIMMING' : 'NO BOARD · SWIM'}</button>
          <button type="button" data-close="1">DONE</button>
        </span>
      </div>
    </div>`;
    this.root.querySelectorAll<HTMLButtonElement>('button').forEach(b =>
      b.addEventListener('click', e => {
        e.stopPropagation();
        const d = b.dataset;
        if (d.close !== undefined) this.on.close();
        else if (d.buy !== undefined) this.on.buy(d.buy as BoardId);
        else if (d.pick !== undefined) this.on.pick(d.pick === 'none' ? null : (d.pick as BoardId));
      }),
    );
  }

  dispose() {
    this.root.remove();
    this.style.remove();
  }
}
