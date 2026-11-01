// The in-page half of the width harness. `collect` is passed to
// page.evaluate, so it must be self-contained: no imports, no outer scope.
// It only gathers geometry; lib.mjs `analyse` decides what counts.

export function collect(opts) {
  const o = opts || {};
  const win = document.querySelector('.nos-win[data-nos-win="navigator"]');
  const root =
    (win && win.querySelector('.nos-content')) ||
    (o.allowDocument ? document.scrollingElement || document.documentElement : null);
  if (!root) return { error: 'no navigator .nos-content on the page' };
  const isDoc = root === document.scrollingElement || root === document.documentElement;

  const rr = isDoc
    ? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight }
    : root.getBoundingClientRect();
  const scope = win || document.body;

  const content = {
    clientWidth: root.clientWidth,
    scrollWidth: root.scrollWidth,
    clientHeight: root.clientHeight,
    scrollHeight: root.scrollHeight,
    left: rr.left,
    top: rr.top,
  };

  const cssCache = new Map();
  const css = el => {
    let s = cssCache.get(el);
    if (!s) {
      s = getComputedStyle(el);
      cssCache.set(el, s);
    }
    return s;
  };
  const shortClass = c => c.replace(/^_?([A-Za-z0-9]+)_[A-Za-z0-9]{5}$/, '$1').replace(/_[a-z0-9]{5}_\d+$/, '');
  const selector = el => {
    const parts = [];
    let cur = el;
    for (let i = 0; cur && cur !== root && cur.nodeType === 1 && i < 4; i++) {
      let s = cur.tagName.toLowerCase();
      if (cur.id) s += '#' + cur.id;
      const cls = (typeof cur.className === 'string' ? cur.className : '')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(shortClass);
      if (cls.length) s += '.' + cls.join('.');
      parts.unshift(s);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  };
  const visible = el => {
    const s = css(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') return false;
    if (parseFloat(s.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const hiddenByAncestor = el => {
    for (let a = el; a && a !== root; a = a.parentElement) {
      const s = css(a);
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) return true;
    }
    return false;
  };
  const clips = s => s.overflowX === 'hidden' || s.overflowX === 'clip';
  const clipsY = s => s.overflowY === 'hidden' || s.overflowY === 'clip';
  const srOnly = r => r.width <= 2 || r.height <= 2;
  const text = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48);

  const all = Array.from(root.querySelectorAll('*'));

  // 1. Horizontal overflow: the first elements that poke past the content box
  //    (their parent doesn't), and no clipping ancestor hides them.
  const overflowOffenders = [];
  if (root.scrollWidth > root.clientWidth + 1) {
    const limit = rr.left + root.clientWidth - root.scrollLeft + 1;
    const pokes = el => el.getBoundingClientRect().right > limit;
    const contained = el => {
      for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
        const s = css(a);
        if (clips(s) || s.overflowX === 'auto' || s.overflowX === 'scroll') return true;
      }
      return false;
    };
    for (const el of all) {
      if (!visible(el) || !pokes(el)) continue;
      const p = el.parentElement;
      if (p && p !== root && pokes(p)) continue;
      if (contained(el)) continue;
      const s = css(el);
      if (s.position === 'fixed') continue;
      overflowOffenders.push({
        selector: selector(el),
        px: Math.round(el.getBoundingClientRect().right - limit),
        text: text(el).slice(0, 32),
      });
    }
    overflowOffenders.sort((a, b) => b.px - a.px);
  }

  // 2. Text (and controls) cut off by an overflow:hidden ancestor inside the page.
  const clipped = [];
  const clipCheck = (el, rect, label, kind) => {
    for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
      const s = css(a);
      const cx = clips(s);
      const cy = clipsY(s);
      if (!cx && !cy) continue;
      const ar = a.getBoundingClientRect();
      if (srOnly(ar)) return;
      const bl = parseFloat(s.borderLeftWidth) || 0;
      const br = parseFloat(s.borderRightWidth) || 0;
      const bt = parseFloat(s.borderTopWidth) || 0;
      const bb = parseFloat(s.borderBottomWidth) || 0;
      const outX = cx ? Math.max(ar.left + bl - rect.left, rect.right - (ar.right - br)) : 0;
      const outY = cy ? Math.max(ar.top + bt - rect.top, rect.bottom - (ar.bottom - bb)) : 0;
      // Text-overflow: ellipsis on the clipper (or the text's own box) is deliberate truncation.
      const ell = css(el).textOverflow === 'ellipsis' || s.textOverflow === 'ellipsis';
      // A box clipping content that sits entirely outside it is a scroller /
      // carousel / reveal, not a cut-off: only partly visible things count.
      const partly =
        rect.right > ar.left + 1 && rect.left < ar.right - 1 && rect.bottom > ar.top + 1 && rect.top < ar.bottom - 1;
      if (partly && !ell && (outX > 2 || outY > 4)) {
        clipped.push({ kind, selector: selector(el), clipper: selector(a), text: label, px: Math.round(Math.max(outX, outY)) });
      }
      return;
    }
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let n;
  let textCount = 0;
  while ((n = walker.nextNode()) && textCount < 4000) {
    const t = n.nodeValue;
    if (!t || !t.trim()) continue;
    const el = n.parentElement;
    if (!el || !visible(el) || hiddenByAncestor(el)) continue;
    textCount++;
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // The text's own box clipping it (white-space:nowrap + overflow:hidden, no ellipsis)
    const s = css(el);
    if ((clips(s) || clipsY(s)) && s.textOverflow !== 'ellipsis') {
      const er = el.getBoundingClientRect();
      const outX = clips(s) ? Math.max(er.left - r.left, r.right - er.right) : 0;
      if (outX > 2 && !srOnly(er)) {
        clipped.push({ kind: 'text', selector: selector(el), clipper: '(self)', text: t.trim().slice(0, 40), px: Math.round(outX) });
        continue;
      }
    }
    clipCheck(el, r, t.trim().slice(0, 40), 'text');
  }

  // 3. Controls: covered by something else, sitting on artwork, overlapping each other, size.
  const controlSel =
    'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=link],[role=switch],summary';
  const controls = Array.from(root.querySelectorAll(controlSel)).filter(
    el => visible(el) && !hiddenByAncestor(el) && css(el).pointerEvents !== 'none',
  );
  const art = Array.from(root.querySelectorAll('img,svg,canvas,video'))
    .filter(el => !el.closest('button,a,[role=button]') && visible(el))
    .map(el => ({ el, r: el.getBoundingClientRect() }))
    .filter(a => a.r.width >= 120 && a.r.height >= 120);
  const inter = (a, b) =>
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

  const vis = {
    left: Math.max(0, rr.left),
    top: Math.max(0, rr.top),
    right: Math.min(window.innerWidth, rr.left + root.clientWidth),
    bottom: Math.min(window.innerHeight, rr.top + root.clientHeight),
  };
  const covered = [];
  const overArt = [];
  const ctl = [];
  for (const el of controls.slice(0, 600)) {
    const r = el.getBoundingClientRect();
    const label = (el.getAttribute('aria-label') || el.getAttribute('title') || text(el) || el.tagName).slice(0, 32);
    // links inside running text are exempt from the tap-size rule (WCAG 2.5.8)
    const s = css(el);
    const p = el.parentElement;
    const inlineInText =
      el.tagName === 'A' &&
      s.display.startsWith('inline') &&
      !!p &&
      (p.innerText || '').trim().length > (el.innerText || '').trim().length + 12;
    ctl.push({ selector: selector(el), w: r.width, h: r.height, label, inlineInText, hidden: false });

    // partly clipped controls
    clipCheck(el, r, label, 'control');

    // covered: sample 5 points inside the visible part of the control
    const inView = r.left >= vis.left - 1 && r.right <= vis.right + 1 && r.top >= vis.top - 1 && r.bottom <= vis.bottom + 1;
    if (inView && r.width >= 6 && r.height >= 6) {
      const pts = [
        [0.5, 0.5],
        [0.25, 0.3],
        [0.75, 0.3],
        [0.25, 0.7],
        [0.75, 0.7],
      ];
      let hits = 0;
      let by = null;
      for (const [fx, fy] of pts) {
        const h = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
        if (!h || h === el || el.contains(h) || h.contains(el)) continue;
        if (!scope.contains(h)) continue; // OS chrome / site widgets outside the window
        hits++;
        by = h;
      }
      if (hits >= 3 && by) covered.push({ selector: selector(el), label, by: selector(by) });
    }

    // floating on artwork: a positioned control over a big image / canvas
    const area = r.width * r.height;
    if (area > 0) {
      for (const a of art) {
        if (a.el.contains(el)) continue;
        if (inter(r, a.r) >= area * 0.5) {
          overArt.push({ selector: selector(el), label, art: selector(a.el) });
          break;
        }
      }
    }
  }

  // controls on top of each other (neither contains the other)
  const overlaps = [];
  const boxes = controls.slice(0, 400).map(el => ({ el, r: el.getBoundingClientRect() }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ov = inter(a.r, b.r);
      if (ov <= 0) continue;
      const smaller = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if (smaller > 0 && ov > smaller * 0.2) overlaps.push({ a: selector(a.el), b: selector(b.el), pct: Math.round((ov / smaller) * 100) });
    }
  }

  return {
    url: location.pathname + location.search,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    isDocument: isDoc,
    content,
    overflowOffenders: overflowOffenders.slice(0, 12),
    clipped: clipped.slice(0, 40),
    covered: covered.slice(0, 30),
    overArt: overArt.slice(0, 30),
    overlaps: overlaps.slice(0, 30),
    controls: ctl,
  };
}
