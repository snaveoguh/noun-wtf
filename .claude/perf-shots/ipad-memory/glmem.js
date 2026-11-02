// Injected before any page script (Playwright addInitScript). Tracks what the
// page really holds on the GPU and in canvases, whatever made it:
//   window.__glmem.totals()  {textures, renderbuffers, buffers, count...} bytes
//   window.__glmem.list()    every live GL allocation, biggest first
//   window.__glmem.recOf(o)  the record of a WebGLTexture / Renderbuffer / Buffer
//   window.__glmem.canvases(){live, bytes, big: [...]} live canvases (WeakRef census)
//   window.__glmem.bitmaps() {live, bytes}  ImageBitmaps not yet closed
// Bytes: level 0 per face × bytes per texel, + 1/3 when mipmapped
// (generateMipmap or explicit levels), × samples for multisampled storage.
(() => {
  const SIZED = {
    0x8058: 4, 0x8051: 4, 0x8c43: 4, 0x8c41: 4, 0x881a: 8, 0x881b: 8, 0x8814: 16, 0x8815: 16,
    0x8229: 1, 0x822b: 2, 0x822d: 2, 0x822e: 4, 0x822f: 4, 0x8230: 8, 0x81a5: 2, 0x81a6: 4,
    0x8cac: 4, 0x88f0: 4, 0x8cad: 8, 0x8c3a: 4, 0x8059: 4, 0x8056: 2, 0x8d62: 2, 0x8057: 2,
    0x8d48: 1, 0x8c3d: 4,
  };
  const CH = { 0x1908: 4, 0x1907: 4, 0x1906: 1, 0x1909: 1, 0x190a: 2, 0x1903: 1, 0x8227: 2, 0x1902: 1, 0x84f9: 1 };
  const TB = { 0x1401: 1, 0x140b: 2, 0x8d61: 2, 0x1406: 4, 0x1403: 2, 0x1405: 4, 0x84fa: 4, 0x8033: 2, 0x8034: 2, 0x8363: 2 };
  const bpp = (ifmt, format, type) => {
    if (SIZED[ifmt]) return SIZED[ifmt];
    if (type === 0x84fa) return 4; // UNSIGNED_INT_24_8 (depth + stencil)
    return (CH[format ?? ifmt] ?? 4) * (TB[type] ?? 1);
  };
  const recs = new WeakMap();
  const live = new Set();
  let nextId = 1;
  const rec = (obj, kind) => {
    let r = recs.get(obj);
    if (!r) {
      r = { id: nextId++, kind, levels: new Map(), mip: false, w: 0, h: 0, d: 1, fmt: 0, bytes: 0, at: performance.now() };
      if (window.__glmem && window.__glmem.trace) r.stack = (new Error().stack || '').split('\n').slice(3, 12).map(x => x.trim().replace(/@?https?:\/\/[^ ]*\/assets\//, '@').replace(/-[A-Za-z0-9_]{8}\.js/, '').slice(0, 60)).join(' < ');
      recs.set(obj, r);
      live.add(r);
    }
    return r;
  };
  const sum = r => {
    let b = 0;
    for (const v of r.levels.values()) b += v;
    if (r.mip) b *= 4 / 3;
    r.bytes = b;
  };
  const dims = s => {
    if (!s) return [0, 0];
    if (typeof s.videoWidth === 'number' && s.videoWidth > 0) return [s.videoWidth, s.videoHeight];
    if (typeof s.naturalWidth === 'number' && s.naturalWidth > 0) return [s.naturalWidth, s.naturalHeight];
    if (typeof s.displayWidth === 'number' && s.displayWidth > 0) return [s.displayWidth, s.displayHeight];
    return [s.width | 0, s.height | 0];
  };
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    const P = C.prototype;
    const st = new WeakMap();
    const S = gl => {
      let s = st.get(gl);
      if (!s) st.set(gl, (s = { unit: 0, tex: new Map(), rb: null, buf: new Map() }));
      return s;
    };
    const texTarget = t => (t >= 0x8515 && t <= 0x851a ? 0x8513 : t); // cube faces → cube map
    const bound = (gl, target) => S(gl).tex.get(S(gl).unit + ':' + texTarget(target));
    const wrap = (name, after) => {
      const f = P[name];
      if (typeof f !== 'function') return;
      P[name] = function (...a) {
        const out = f.apply(this, a);
        try { after(this, a, out); } catch {}
        return out;
      };
    };
    wrap('activeTexture', (gl, a) => (S(gl).unit = a[0] - 0x84c0));
    wrap('bindTexture', (gl, a) => S(gl).tex.set(S(gl).unit + ':' + a[0], a[1]));
    wrap('texImage2D', (gl, a) => {
      const t = bound(gl, a[0]);
      if (!t) return;
      let w, h, format, type;
      if (a.length >= 8) [w, h, format, type] = [a[3], a[4], a[6], a[7]];
      else { [w, h] = dims(a[5]); [format, type] = [a[3], a[4]]; }
      const r = rec(t, 'texture');
      if (a[1] === 0) { r.w = w; r.h = h; r.fmt = a[2]; }
      r.levels.set(a[0] + ':' + a[1], w * h * bpp(a[2], format, type));
      sum(r);
    });
    wrap('compressedTexImage2D', (gl, a) => {
      const t = bound(gl, a[0]);
      if (!t) return;
      const r = rec(t, 'texture');
      if (a[1] === 0) { r.w = a[3]; r.h = a[4]; r.fmt = a[2]; }
      r.levels.set(a[0] + ':' + a[1], a[6]?.byteLength ?? a[5] ?? 0);
      sum(r);
    });
    wrap('copyTexImage2D', (gl, a) => {
      const t = bound(gl, a[0]);
      if (!t) return;
      const r = rec(t, 'texture');
      r.w = a[5]; r.h = a[6]; r.fmt = a[2];
      r.levels.set(a[0] + ':' + a[1], a[5] * a[6] * bpp(a[2], a[2], 0x1401));
      sum(r);
    });
    wrap('texStorage2D', (gl, a) => {
      const t = bound(gl, a[0]);
      if (!t) return;
      const r = rec(t, 'texture');
      const faces = texTarget(a[0]) === 0x8513 ? 6 : 1;
      let b = 0, w = a[3], h = a[4];
      for (let l = 0; l < a[1]; l++) { b += w * h * bpp(a[2]); w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); }
      r.w = a[3]; r.h = a[4]; r.fmt = a[2];
      r.levels.set('storage', b * faces);
      sum(r);
    });
    for (const n of ['texImage3D', 'texStorage3D']) {
      wrap(n, (gl, a) => {
        const t = bound(gl, a[0]);
        if (!t) return;
        const r = rec(t, 'texture');
        const store = n === 'texStorage3D';
        const [w, h, d] = store ? [a[3], a[4], a[5]] : [a[3], a[4], a[5]];
        r.w = w; r.h = h; r.d = d; r.fmt = a[2];
        r.levels.set(store ? 'storage' : a[0] + ':' + a[1], w * h * d * bpp(a[2], a[7], a[8]) * (store ? (4 / 3) : 1));
        sum(r);
      });
    }
    wrap('generateMipmap', (gl, a) => { const t = bound(gl, a[0]); if (t) { const r = rec(t, 'texture'); r.mip = true; sum(r); } });
    wrap('deleteTexture', (gl, a) => { const r = a[0] && recs.get(a[0]); if (r) { live.delete(r); r.bytes = 0; } });
    wrap('bindRenderbuffer', (gl, a) => (S(gl).rb = a[1]));
    const rbStore = (gl, samples, ifmt, w, h) => {
      const rb = S(gl).rb;
      if (!rb) return;
      const r = rec(rb, 'renderbuffer');
      r.w = w; r.h = h; r.fmt = ifmt; r.samples = samples;
      r.levels.set('rb', w * h * bpp(ifmt) * Math.max(1, samples));
      sum(r);
    };
    wrap('renderbufferStorage', (gl, a) => rbStore(gl, 1, a[1], a[2], a[3]));
    wrap('renderbufferStorageMultisample', (gl, a) => rbStore(gl, a[1], a[2], a[3], a[4]));
    wrap('deleteRenderbuffer', (gl, a) => { const r = a[0] && recs.get(a[0]); if (r) { live.delete(r); r.bytes = 0; } });
    wrap('bindBuffer', (gl, a) => S(gl).buf.set(a[0], a[1]));
    wrap('bufferData', (gl, a) => {
      const b = S(gl).buf.get(a[0]);
      if (!b) return;
      const r = rec(b, 'buffer');
      r.levels.set('data', typeof a[1] === 'number' ? a[1] : a[1]?.byteLength ?? 0);
      sum(r);
    });
    wrap('deleteBuffer', (gl, a) => { const r = a[0] && recs.get(a[0]); if (r) { live.delete(r); r.bytes = 0; } });
  }

  // A lost context frees everything it held: forget it (restored objects are new)
  document.addEventListener('webglcontextlost', () => { for (const r of live) r.bytes = 0; live.clear(); }, true);

  // Canvases + ImageBitmaps (WeakRef census: what the page still holds)
  const canv = [];
  const ce = Document.prototype.createElement;
  Document.prototype.createElement = function (tag, ...rest) {
    const el = ce.call(this, tag, ...rest);
    if (String(tag).toLowerCase() === 'canvas') canv.push({ ref: new WeakRef(el), at: performance.now(), stack: (new Error().stack || '').split('\n').slice(2, 6).map(s => s.trim().replace(/https?:\/\/[^/]+\/assets\//, '').slice(0, 80)).join(' < ') });
    return el;
  };
  if (window.OffscreenCanvas) {
    const OC = window.OffscreenCanvas;
    window.OffscreenCanvas = function (w, h) { const c = new OC(w, h); canv.push({ ref: new WeakRef(c), at: performance.now(), stack: 'OffscreenCanvas' }); return c; };
    window.OffscreenCanvas.prototype = OC.prototype;
  }
  const bms = [];
  const cib = window.createImageBitmap;
  if (cib) {
    window.createImageBitmap = function (...a) {
      return cib.apply(this, a).then(b => { bms.push(new WeakRef(b)); return b; });
    };
  }
  window.__glmem = {
    totals() {
      const t = { textures: 0, renderbuffers: 0, buffers: 0, nTex: 0, nRb: 0, nBuf: 0 };
      for (const r of live) {
        if (r.kind === 'texture') { t.textures += r.bytes; t.nTex++; }
        else if (r.kind === 'renderbuffer') { t.renderbuffers += r.bytes; t.nRb++; }
        else { t.buffers += r.bytes; t.nBuf++; }
      }
      t.total = t.textures + t.renderbuffers + t.buffers;
      return t;
    },
    list() {
      return [...live].sort((a, b) => b.bytes - a.bytes).map(r => ({ id: r.id, kind: r.kind, w: r.w, h: r.h, d: r.d, fmt: r.fmt, mip: r.mip, samples: r.samples, bytes: Math.round(r.bytes), at: Math.round(r.at), stack: r.stack }));
    },
    recOf(o) { const r = o && recs.get(o); return r ? r.id : null; },
    canvases() {
      let live = 0, bytes = 0;
      const big = [];
      for (const c of canv) {
        const el = c.ref.deref();
        if (!el) continue;
        live++;
        const b = (el.width | 0) * (el.height | 0) * 4;
        bytes += b;
        if (b >= 512 * 512 * 4) big.push({ w: el.width, h: el.height, inDom: !!el.isConnected, stack: c.stack });
      }
      big.sort((a, b) => b.w * b.h - a.w * a.h);
      const groups = new Map();
      for (const c of canv) { const el = c.ref.deref(); if (!el) continue; const k = `${el.width}x${el.height} ${c.stack.split(' < ').slice(0, 2).join(' < ')}`; const v = groups.get(k) || [0, 0]; v[0]++; v[1] += el.width * el.height * 4; groups.set(k, v); }
      return { live, created: canv.length, bytes, big: big.slice(0, 25), groups: [...groups].sort((a, b) => b[1][1] - a[1][1]).slice(0, 30) };
    },
    bitmaps() {
      let live = 0, bytes = 0;
      for (const r of bms) { const b = r.deref(); if (b && b.width > 0) { live++; bytes += b.width * b.height * 4; } }
      return { live, created: bms.length, bytes };
    },
  };
})();

// Attribution: walk the object graph from window.__w2 (breadth first, so the
// shortest path names a thing) for three Textures and render targets, and map
// each to its GL allocation through the renderer's properties.
window.__glattrib = (budget = 400000) => {
  const g = window.__w2;
  if (!g) return [];
  const props = g.gfx.renderer.properties;
  const seen = new WeakSet();
  const q = [[g, 'game']];
  const found = new Map(); // glObj -> path
  let n = 0;
  const glOf = o => {
    const out = [];
    try {
      if (o.isTexture) { const p = props.get(o); if (p && p.__webglTexture) out.push(p.__webglTexture); }
      if (o.isWebGLRenderTarget || o.isRenderTarget) {
        const p = props.get(o);
        if (p) for (const k of ['__webglDepthbuffer', '__webglColorRenderbuffer', '__webglMultisampledFramebuffer', '__webglDepthRenderbuffer'])
          for (const x of [].concat(p[k] || [])) if (x && !(x instanceof WebGLFramebuffer)) out.push(x);
        for (const t of [].concat(o.textures || o.texture || [], o.depthTexture || [])) { const tp = props.get(t); if (tp && tp.__webglTexture) out.push(tp.__webglTexture); }
      }
    } catch {}
    return out;
  };
  while (q.length && n < budget) {
    const [o, path] = q.shift();
    n++;
    for (const x of glOf(o)) if (!found.has(x)) found.set(x, path);
    let keys;
    try {
      if (o instanceof Map) { let i = 0; for (const [k, v] of o) { if (v && typeof v === 'object' && !seen.has(v)) { seen.add(v); q.push([v, `${path}{${String(k).slice(0, 24)}}`]); } if (++i > 2000) break; } continue; }
      if (o instanceof Set) { let i = 0; for (const v of o) { if (v && typeof v === 'object' && !seen.has(v)) { seen.add(v); q.push([v, `${path}{#${i}}`]); } if (++i > 2000) break; } continue; }
      keys = Array.isArray(o) ? o.keys() : Object.keys(o);
    } catch { continue; }
    for (const k of keys) {
      let v;
      try { v = o[k]; } catch { continue; }
      if (!v || typeof v !== 'object' || seen.has(v)) continue;
      if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer || v instanceof Node || v === window) continue;
      if (v instanceof WebGLRenderingContext || (window.WebGL2RenderingContext && v instanceof WebGL2RenderingContext)) continue;
      seen.add(v);
      q.push([v, Array.isArray(o) ? `${path}[${k}]` : `${path}.${k}`]);
    }
  }
  const out = [];
  for (const [gl, path] of found) { const id = window.__glmem.recOf(gl); if (id !== null) out.push([id, path]); }
  return { walked: n, named: out };
};
