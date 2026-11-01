// ── One full-screen grade pass for CAMP's opening shot (the trip wearing off) ──
//
// A single ShaderMaterial whose `uStyle` picks the look (introStyles.ts:
// trip / anime / haze / b&w), so a cut is uniform changes only, never a new
// program. It's compiled during the loader (`warm`), slotted into the
// composer just before the pass that draws to the screen when the shot
// starts (so no pass changes renderToScreen, which would relink it), and
// taken out and freed when the grade ends, well before the camera hands
// off: the last frames of the shot are the untouched game look.
//
// The trip's melting trails feed back through two small render targets
// of its own (allocated only while the trip plays): +1 draw then, 1 draw
// for every other look.

import type { Graphics } from './Graphics';
import type { IntroStyle } from '../world/camp/introStyles';

import { Pass } from 'postprocessing';
import * as THREE from 'three';

import { STYLE_CODE } from '../world/camp/introStyles';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tPrev;
uniform float uMode;   // 0 grade, 1 copy tDiffuse
uniform float uStyle;  // 1 trip, 2 anime, 3 haze, 4 b&w
uniform float uAmt;
uniform float uTime;
uniform float uFeed;   // trip feedback weight (0 on its first frame)
uniform vec2 uRes;     // buffer pixels
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 toG(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
vec3 toL(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 tex(vec2 uv) { return texture2D(tDiffuse, uv).rgb; }
/** Hue turn that keeps luma (YIQ): colour cycling without brightness flashes. */
vec3 hueTurn(vec3 c, float a) {
  const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 y = toYIQ * c;
  float cs = cos(a);
  float sn = sin(a);
  y.yz = mat2(cs, sn, -sn, cs) * y.yz;
  return toRGB * y;
}
/** Take the edge off saturated red (photosensitivity: no big red fields). */
vec3 tameRed(vec3 c) {
  float red = clamp((c.r - max(c.g, c.b)) * 1.6, 0.0, 1.0);
  return mix(c, vec3(luma(c)) * vec3(1.0, 0.9, 0.95), red * 0.55);
}
vec2 mirror(vec2 uv) { return 1.0 - abs(1.0 - mod(uv, 2.0)); }
float vignette(float asp, float k) {
  return 1.0 - smoothstep(0.35, 0.95, length((vUv - 0.5) * vec2(asp * 0.75, 1.0))) * k;
}

vec3 trip(float asp) {
  vec2 c = vUv - 0.5;
  c.x *= asp;
  float r = length(c);
  float a = atan(c.y, c.x);
  // kaleidoscope round the edge, the middle left readable
  float seg = 6.2831853 / 6.0;
  float ka = abs(mod(a + uTime * 0.25, seg) - seg * 0.5);
  vec2 kc = vec2(cos(ka), sin(ka)) * r;
  c = mix(c, kc, smoothstep(0.18, 0.6, r) * 0.55 * uAmt);
  // melt + breathe
  c += vec2(sin(c.y * 9.0 + uTime * 2.1), cos(c.x * 7.0 - uTime * 1.7)) * 0.03 * uAmt;
  c *= 1.0 - 0.06 * sin(uTime * 1.3) * uAmt;
  vec2 uv = mirror(vec2(c.x / asp, c.y) + 0.5);
  // chromatic split, outward
  vec2 off = (r > 1e-4 ? c / r : vec2(0.0)) * vec2(1.0 / asp, 1.0) * 0.016 * uAmt * r;
  vec3 col = toG(vec3(tex(mirror(uv + off)).r, tex(uv).g, tex(mirror(uv - off)).b));
  // acid: saturated, hue-cycled in rings that drift outward, posterised
  float l = luma(col);
  col = mix(vec3(l), col, 1.0 + 0.9 * uAmt);
  col = hueTurn(col, uTime * 1.1 + r * 1.6 * uAmt);
  col = floor(clamp(col, 0.0, 1.0) * 6.0 + 0.5) / 6.0;
  // feedback trails, pulled into the middle and turned in hue
  vec2 pu = (vUv - 0.5) * 0.965 + 0.5;
  vec3 prev = hueTurn(toG(texture2D(tPrev, pu).rgb), 0.35);
  col = mix(col, prev, uFeed * 0.45 * uAmt);
  return tameRed(clamp(col, 0.0, 1.0));
}

vec3 anime(float asp) {
  vec2 c = vUv - 0.5;
  c.x *= asp;
  float r = length(c);
  // print misregistration
  vec2 mis = vec2(2.0, -1.2) / uRes * (uRes.y / 720.0) * uAmt;
  vec3 col = toG(vec3(tex(vUv + mis).r, tex(vUv).g, tex(vUv - mis).b));
  // flat cel bands, punchy colour
  float l = luma(col);
  float band = l < 0.2 ? 0.1 : l < 0.48 ? 0.36 : l < 0.78 ? 0.68 : 0.96;
  col = col / max(l, 1e-3) * band;
  col = mix(vec3(band), col, 1.35);
  // screentone in the two darker bands
  float cell = max(3.0, 7.0 * uRes.y / 1080.0);
  vec2 q = mat2(0.7071, -0.7071, 0.7071, 0.7071) * gl_FragCoord.xy / cell;
  float d = length(fract(q) - 0.5);
  float tone = band < 0.5 ? (band < 0.2 ? 0.48 : 0.3) : 0.0;
  col *= mix(1.0, 0.25, step(d, tone));
  // speed lines (thin, round the edge; new ones on every drawing)
  float a = atan(c.y, c.x) / 6.2831853 + 0.5;
  float n = 90.0;
  float id = floor(a * n);
  float drawing = floor(uTime * 12.0);
  float on = step(0.8, hash(vec2(id, drawing)));
  float w = abs(fract(a * n) - 0.5);
  float lines = on * step(w, 0.12) * smoothstep(0.34, 0.75, r * (0.85 + 0.3 * hash(vec2(id, 3.0))));
  col = mix(col, vec3(1.0), lines * 0.85);
  // paper
  col = mix(col, col * vec3(1.0, 0.97, 0.9) + vec3(0.03, 0.025, 0.0), 0.5);
  return tameRed(clamp(col, 0.0, 1.0));
}

vec3 haze(float asp) {
  float fr = floor(uTime * 24.0);
  // gate weave + a rolling tracking band
  vec2 j = (vec2(hash(vec2(fr, 1.0)), hash(vec2(fr, 2.0))) - 0.5) * vec2(0.0025, 0.004) * uAmt;
  float band = fract(vUv.y * 0.6 - uTime * 0.21);
  float track = smoothstep(0.035, 0.0, abs(band - 0.5));
  vec2 uv = vUv + j + vec2(track * 0.007 * uAmt, 0.0);
  // soft focus: a ring of taps
  vec2 px = (1.5 + 2.0 * uAmt) * (uRes.y / 720.0) / uRes;
  vec3 s = tex(uv);
  for (int i = 0; i < 8; i++) {
    float t = float(i) * 0.7853982;
    s += tex(uv + vec2(cos(t), sin(t)) * px);
  }
  vec3 col = toG(s / 9.0);
  // chroma bleed sideways
  col.r = mix(col.r, toG(tex(uv + vec2(4.0, 0.0) * px)).r, 0.6);
  // bloom haze, lifted blacks, a warm wash
  col += col * col * 0.4 * uAmt;
  col = mix(vec3(0.09, 0.07, 0.11), col, 0.86);
  col *= vec3(1.06, 1.0, 0.9);
  // grain, scan lines, vignette
  col += (hash(gl_FragCoord.xy + fr * 17.0) - 0.5) * 0.13 * uAmt;
  col *= 1.0 - 0.06 * step(0.5, fract(gl_FragCoord.y / max(2.0, uRes.y / 360.0)));
  col *= vignette(asp, 0.6);
  return clamp(col, 0.0, 1.0);
}

vec3 bw(float asp) {
  float fr = floor(uTime * 24.0);
  vec2 j = vec2(0.0, (hash(vec2(fr, 5.0)) - 0.5) * 0.003 * uAmt);
  float l = luma(toG(tex(vUv + j)));
  // hard contrast
  l = smoothstep(0.1, 0.82, l);
  l = mix(l, l * l * (3.0 - 2.0 * l), 0.6);
  // exposure flutter (small: well under a flash), grain, a scratch now and then
  l *= 1.0 + (hash(vec2(fr, 7.0)) - 0.5) * 0.05;
  l += (hash(gl_FragCoord.xy * 1.3 + fr * 31.0) - 0.5) * 0.14 * uAmt;
  float sx = hash(vec2(fr, 9.0));
  float scratch = step(0.72, hash(vec2(fr, 11.0))) * smoothstep(1.5 / uRes.x, 0.0, abs(vUv.x - sx));
  l = mix(l, 0.9, scratch * 0.6);
  l *= vignette(asp, 0.7);
  return vec3(clamp(l, 0.0, 1.0));
}

void main() {
  float asp = uRes.x / max(1.0, uRes.y);
  vec3 col;
  if (uMode > 0.5) col = toG(tex(vUv));
  else if (uStyle < 1.5) col = trip(asp);
  else if (uStyle < 2.5) col = anime(asp);
  else if (uStyle < 3.5) col = haze(asp);
  else if (uStyle < 4.5) col = bw(asp);
  else col = toG(tex(vUv));
  gl_FragColor = vec4(toL(col), 1.0);
  // (identity into the composer's buffers; sRGB only if it ever ends up last)
  #include <colorspace_fragment>
}`;

export class TripPass extends Pass {
  readonly material: THREE.ShaderMaterial;
  private fb: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private fbFresh = true;
  private w = 1;
  private h = 1;
  private style: IntroStyle = 'none';
  private trails = false;

  constructor() {
    super('TripPass');
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: null },
        tPrev: { value: null },
        uMode: { value: 0 },
        uStyle: { value: 1 },
        uAmt: { value: 1 },
        uTime: { value: 0 },
        uFeed: { value: 0 },
        uRes: { value: new THREE.Vector2(1, 1) },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.fullscreenMaterial = this.material;
  }

  /** Set the look for this frame (uniforms only). */
  set(style: IntroStyle, amt: number, time: number, trails: boolean) {
    const u = this.material.uniforms;
    if (style !== this.style && style === 'trip') this.fbFresh = true;
    this.style = style;
    this.trails = trails && style === 'trip';
    u.uStyle!.value = STYLE_CODE[style];
    u.uAmt!.value = amt;
    u.uTime!.value = time;
  }

  override setSize(width: number, height: number) {
    this.w = Math.max(1, width);
    this.h = Math.max(1, height);
    (this.material.uniforms.uRes!.value as THREE.Vector2).set(this.w, this.h);
    this.fb?.forEach(t => t.setSize(this.w, this.h));
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
  ) {
    const u = this.material.uniforms;
    const out = this.renderToScreen ? null : outputBuffer;
    u.tDiffuse!.value = inputBuffer.texture;
    u.uMode!.value = 0;
    if (!this.trails) {
      u.uFeed!.value = 0;
      renderer.setRenderTarget(out);
      renderer.render(this.scene, this.camera);
      return;
    }
    // Trails: grade into fb[0] reading last frame's fb[1], copy out, swap
    const fb = this.feedback(inputBuffer);
    u.tPrev!.value = fb[1].texture;
    u.uFeed!.value = this.fbFresh ? 0 : 1;
    this.fbFresh = false;
    renderer.setRenderTarget(fb[0]);
    renderer.render(this.scene, this.camera);
    u.uMode!.value = 1;
    u.tDiffuse!.value = fb[0].texture;
    renderer.setRenderTarget(out);
    renderer.render(this.scene, this.camera);
    this.fb = [fb[1], fb[0]];
  }

  private feedback(like: THREE.WebGLRenderTarget) {
    if (this.fb === null) {
      const mk = () =>
        new THREE.WebGLRenderTarget(this.w, this.h, {
          type: like.texture.type,
          colorSpace: like.texture.colorSpace as THREE.ColorSpace,
          depthBuffer: false,
          stencilBuffer: false,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
        });
      this.fb = [mk(), mk()];
      this.fbFresh = true;
    }
    return this.fb;
  }

  /** Link the program now (compileAsync where the renderer has it). */
  compileWith(renderer: THREE.WebGLRenderer) {
    const r = renderer as THREE.WebGLRenderer & {
      compileAsync?: (o: THREE.Object3D, c: THREE.Camera) => Promise<unknown>;
    };
    if (r.compileAsync !== undefined) void r.compileAsync(this.scene, this.camera).catch(() => {});
    else r.compile(this.scene, this.camera);
  }

  /** The trail targets go as soon as the trip's over. */
  dropFeedback() {
    this.fb?.forEach(t => t.dispose());
    this.fb = null;
  }

  override dispose() {
    this.dropFeedback();
    this.material.dispose();
  }
}

/**
 * The grade over CAMP's opening shot: owns the pass's life in the
 * composer. `warm` compiles it while the loader is up; `start` slots it in
 * (false when there's no post stack to slot into: then the shot plays
 * ungraded); `stop` takes it out and frees it.
 */
export class TripGrade {
  private pass: TripPass | null = null;
  private live = false;

  constructor(private readonly gfx: Graphics) {}

  /** Compile the program now, against the buffer it will draw into. */
  warm() {
    const g = this.gfx;
    const p = (this.pass ??= new TripPass());
    try {
      g.asDrawn(() => {
        g.renderer.setRenderTarget(g.composer.outputBuffer);
        p.compileWith(g.renderer);
      });
    } catch {
      // (a compile failure shows up on first draw instead)
    }
  }

  /** Is it in the composer? */
  get active(): boolean {
    return this.live;
  }

  start(): boolean {
    const g = this.gfx;
    if (this.live) return true;
    if (g.rawRender || !g.lite.post) return false;
    const p = (this.pass ??= new TripPass());
    const passes = (g.composer as unknown as { passes: Pass[] }).passes;
    // Just before whichever pass draws to the screen (SMAA, or ink on low)
    let at = -1;
    for (let i = passes.length - 1; i >= 0; i--)
      if (passes[i]!.enabled) {
        at = i;
        break;
      }
    if (at < 1) return false;
    g.composer.addPass(p, at);
    this.live = true;
    return true;
  }

  /** `trails`: the trip section proper (a 3-frame trip flicker has none). */
  set(style: IntroStyle, amt: number, time: number, trails = style === 'trip') {
    const p = this.pass;
    if (p === null || !this.live) return;
    p.set(style, amt, time, trails);
    if (!trails) p.dropFeedback();
  }

  stop() {
    const p = this.pass;
    if (p === null) return;
    if (this.live) this.gfx.composer.removePass(p);
    this.live = false;
    p.dispose();
    this.pass = null;
  }
}
