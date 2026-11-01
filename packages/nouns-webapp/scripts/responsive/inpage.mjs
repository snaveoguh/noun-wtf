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
  // The app's error boundary (or vite reloading mid-load) is a broken shot, not a layout
  if (
    /Something went wrong/i.test(root.innerText || '') &&
    !root.querySelector('button, a[href], input')
  )
    return {
      error: 'error boundary: "Something went wrong" (cold vite? the shot is retried once)',
    };
  const isDoc = root === document.scrollingElement || root === document.documentElement;

  const rr = isDoc
    ? {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        width: window.innerWidth,
        height: window.innerHeight,
      }
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
  const shortClass = c =>
    c.replace(/^_?([A-Za-z0-9]+)_[A-Za-z0-9]{5}$/, '$1').replace(/_[a-z0-9]{5}_\d+$/, '');
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
    if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse')
      return false;
    if (parseFloat(s.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const hiddenByAncestor = el => {
    for (let a = el; a && a !== root; a = a.parentElement) {
      const s = css(a);
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05)
        return true;
    }
    return false;
  };
  const clips = s => s.overflowX === 'hidden' || s.overflowX === 'clip';
  const clipsY = s => s.overflowY === 'hidden' || s.overflowY === 'clip';
  const srOnly = r => r.width <= 2 || r.height <= 2;
  const text = el =>
    (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48);

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
      // Partly visible in a scroll box (a tab strip, the phone tray) is
      // scrollable into view, not cut off: stop at the first scroller.
      if (
        s.overflowX === 'auto' ||
        s.overflowX === 'scroll' ||
        s.overflowY === 'auto' ||
        s.overflowY === 'scroll'
      )
        return;
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
        rect.right > ar.left + 1 &&
        rect.left < ar.right - 1 &&
        rect.bottom > ar.top + 1 &&
        rect.top < ar.bottom - 1;
      if (partly && !ell && (outX > 2 || outY > 4)) {
        clipped.push({
          kind,
          selector: selector(el),
          clipper: selector(a),
          text: label,
          px: Math.round(Math.max(outX, outY)),
        });
      }
      return;
    }
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let n;
  let textCount = 0;
  // Warnings: reported, never scored. Squeezed = a sentence wrapped to about one
  // word per line (a float or neighbour crushing its column); the overflow and
  // clip checks can't see it.
  const squeezed = [];
  while ((n = walker.nextNode()) && textCount < 4000) {
    const t = n.nodeValue;
    if (!t || !t.trim()) continue;
    const el = n.parentElement;
    if (!el || !visible(el) || hiddenByAncestor(el)) continue;
    textCount++;
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const words = t.trim().split(/\s+/).length;
    if (words >= 4 && squeezed.length < 12) {
      const tops = new Set(Array.from(range.getClientRects(), q => Math.round(q.top)));
      if (tops.size >= 4 && words / tops.size <= 1.5) {
        squeezed.push({
          selector: selector(el),
          text: t.trim().slice(0, 40),
          lines: tops.size,
          w: Math.round(r.width),
        });
      }
    }
    // The text's own box clipping it (white-space:nowrap + overflow:hidden, no ellipsis)
    const s = css(el);
    if ((clips(s) || clipsY(s)) && s.textOverflow !== 'ellipsis') {
      const er = el.getBoundingClientRect();
      const outX = clips(s) ? Math.max(er.left - r.left, r.right - er.right) : 0;
      if (outX > 2 && !srOnly(er)) {
        clipped.push({
          kind: 'text',
          selector: selector(el),
          clipper: '(self)',
          text: t.trim().slice(0, 40),
          px: Math.round(outX),
        });
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
  // The part of a box you can actually see: clipped by every scrolling /
  // clipping ancestor that is its containing block chain, and by the viewport.
  // A control scrolled out of its scroll box has an empty visible rect and is
  // left out of the covered / overlap / on-art checks (it can't be tapped).
  const visibleRect = el => {
    const r = el.getBoundingClientRect();
    let left = r.left;
    let top = r.top;
    let right = r.right;
    let bottom = r.bottom;
    let pos = css(el).position;
    for (
      let a = el.parentElement;
      a && a !== document.documentElement && pos !== 'fixed';
      a = a.parentElement
    ) {
      const s = css(a);
      // an absolutely positioned box escapes non-positioned ancestors' overflow
      if (pos === 'absolute' && s.position === 'static') continue;
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const ar = a.getBoundingClientRect();
        const bl = parseFloat(s.borderLeftWidth) || 0;
        const bt = parseFloat(s.borderTopWidth) || 0;
        if (s.overflowX !== 'visible') {
          left = Math.max(left, ar.left + bl);
          right = Math.min(right, ar.left + bl + a.clientWidth);
        }
        if (s.overflowY !== 'visible') {
          top = Math.max(top, ar.top + bt);
          bottom = Math.min(bottom, ar.top + bt + a.clientHeight);
        }
      }
      pos = s.position === 'absolute' || s.position === 'fixed' ? s.position : 'normal';
    }
    left = Math.max(left, 0);
    top = Math.max(top, 0);
    right = Math.min(right, window.innerWidth);
    bottom = Math.min(bottom, window.innerHeight);
    return {
      left,
      top,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  };
  const ART_OK = '[data-responsive-art-ok]';
  const opaque = el => {
    const bg = css(el).backgroundColor;
    const m = bg && bg.match(/rgba?\(([^)]+)\)/);
    if (!m) return false;
    const parts = m[1].split(/[,\s/]+/).filter(Boolean);
    const alpha = parts.length > 3 ? parseFloat(parts[3]) : 1;
    return alpha >= 0.9 && parseFloat(css(el).opacity) >= 0.9;
  };
  // Is the artwork actually on screen at (x, y), or painted over by an opaque
  // layer (a solid header, a panel) that sits between it and the control?
  const artShows = (artEl, ctrl, x, y) => {
    const prev = artEl.style.pointerEvents;
    artEl.style.pointerEvents = 'auto'; // elementsFromPoint skips pointer-events:none
    const stack = document.elementsFromPoint(x, y);
    artEl.style.pointerEvents = prev;
    const i = stack.findIndex(e => e === artEl || artEl.contains(e));
    if (i < 0) return false; // not at this point at all
    for (let k = 0; k < i; k++) {
      const e = stack[k];
      if (e === ctrl || ctrl.contains(e) || e.contains(artEl)) continue;
      if (opaque(e)) return false;
    }
    return true;
  };

  const art = Array.from(root.querySelectorAll('img,svg,canvas,video'))
    .filter(
      el =>
        !el.closest('button,a,[role=button]') &&
        !el.closest(ART_OK) &&
        visible(el) &&
        !hiddenByAncestor(el),
    )
    .map(el => ({ el, r: visibleRect(el) }))
    .filter(a => a.r.width >= 120 && a.r.height >= 120);
  const inter = (a, b) =>
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

  const covered = [];
  const overArt = [];
  const ctl = [];
  const seen = [];
  for (const el of controls.slice(0, 600)) {
    const r = el.getBoundingClientRect();
    const vr = visibleRect(el);
    const label = (
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      text(el) ||
      el.tagName
    ).slice(0, 32);
    // links inside running text are exempt from the tap-size rule (WCAG 2.5.8)
    const s = css(el);
    const p = el.parentElement;
    const inlineInText =
      el.tagName === 'A' &&
      s.display.startsWith('inline') &&
      !!p &&
      (p.innerText || '').trim().length > (el.innerText || '').trim().length + 12;
    ctl.push({
      selector: selector(el),
      w: r.width,
      h: r.height,
      label,
      inlineInText,
      hidden: false,
    });

    // partly clipped controls
    clipCheck(el, r, label, 'control');

    // Everything below needs the control on screen: one scrolled out of its
    // scroll box (or out of the window) isn't covered by, or on top of, anything.
    if (vr.width < 6 || vr.height < 6) continue;
    seen.push({ el, r: vr });

    // covered: only for a control wholly on screen (as a user would see it
    // before tapping); sample 5 points inside it
    const whole = vr.width >= r.width - 1 && vr.height >= r.height - 1;
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
      const h = document.elementFromPoint(vr.left + vr.width * fx, vr.top + vr.height * fy);
      if (!h || h === el || el.contains(h) || h.contains(el)) continue;
      if (!scope.contains(h)) continue; // OS chrome / site widgets outside the window
      hits++;
      by = h;
    }
    if (whole && hits >= 3 && by) covered.push({ selector: selector(el), label, by: selector(by) });

    // floating on artwork: a control over a big image / canvas / video that is
    // actually showing there (not hidden under an opaque layer), unless a
    // container opted out with data-responsive-art-ok (a deliberate overlay hero)
    const area = vr.width * vr.height;
    if (area > 0 && !el.closest(ART_OK)) {
      for (const a of art) {
        if (a.el.contains(el)) continue;
        if (inter(vr, a.r) < area * 0.5) continue;
        const x = (Math.max(vr.left, a.r.left) + Math.min(vr.right, a.r.right)) / 2;
        const y = (Math.max(vr.top, a.r.top) + Math.min(vr.bottom, a.r.bottom)) / 2;
        if (!artShows(a.el, el, x, y)) continue;
        overArt.push({ selector: selector(el), label, art: selector(a.el) });
        break;
      }
    }
  }

  // controls on top of each other (neither contains the other), visible parts only
  const overlaps = [];
  const boxes = seen.slice(0, 400);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ov = inter(a.r, b.r);
      if (ov <= 0) continue;
      const smaller = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if (smaller > 0 && ov > smaller * 0.2)
        overlaps.push({
          a: selector(a.el),
          b: selector(b.el),
          pct: Math.round((ov / smaller) * 100),
        });
    }
  }

  return {
    url: location.pathname + location.search,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    isDocument: isDoc,
    content,
    overflowOffenders: overflowOffenders.slice(0, 12),
    warnings: {
      squeezed,
      // a page rendering its "… not configured" stub measures as clean: missing VITE_* env?
      notConfigured: /not configured/i.test(root.innerText || '')
        ? ((root.innerText || '').match(/[^\n]*not configured[^\n]*/i) || [''])[0]
            .trim()
            .slice(0, 80)
        : null,
    },
    clipped: clipped.slice(0, 40),
    covered: covered.slice(0, 30),
    overArt: overArt.slice(0, 30),
    overlaps: overlaps.slice(0, 30),
    controls: ctl,
  };
}
