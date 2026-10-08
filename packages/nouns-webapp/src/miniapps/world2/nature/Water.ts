// ── Shallow stylised-realistic water ────────────────────────────────────
//
// Approach
// --------
// 1. Refraction pre-pass: once per frame (WaterSystem.update) the camera
//    renders ONLY objects on NATURE_BED_LAYER (water beds, rocks, basin
//    walls) into a half-float target with a DepthTexture. Rendering just
//    the bed layer keeps it to a handful of draw calls and means nothing
//    above the water (player, trees) can leak into the refraction. Shadow
//    maps are not re-rendered for this pass (last frame's are reused).
// 2. The water surface is an *opaque* MeshStandardMaterial with a patched
//    shader, so it gets three's shadowed sun specular (glints), PMREM env
//    reflection, fog and tone mapping for free. In the fragment shader:
//      - world-space normals from two scrolling tileable normal maps, a
//        two-phase flow map along stream paths, and analytic ring ripples;
//      - the bed position is reconstructed from the depth texture; the
//        vertical depth drives Beer–Lambert absorption (clear → teal) and
//        refraction strength, refracted samples that land on geometry above
//        the surface are rejected;
//      - shoreline/rock foam = small water depth × animated noise, fed in as
//        the diffuse albedo so it is lit (and shadowed) like any surface;
//      - Fresnel blends refraction against three's reflection terms, fading
//        out in the last few cm so shorelines have no hard edge.
// 3. Caustics: materials under the water (bed, rocks, basin) get a patch
//    that adds an animated two-layer Voronoi caustic (thresholded into hard
//    graphic shapes) inside the shadowed sun loop, plus a darker wet band.
// Low quality: no pre-pass, the water is a simple translucent surface.

import * as THREE from 'three';

import {
  type NatureQuality,
  NATURE_BED_LAYER,
  type Region,
  chainPatch,
  injectDirLightHook,
  natureUniforms,
  regionSampler,
  toonMaterial,
} from './shared';
import { causticsTexture, pebbleTextures, waterNormalTexture } from './textures';

// ── Caustics / wetness patch for submerged materials ────────────────────

const CAUSTIC_VERT_PARS = /* glsl */ `varying vec3 vNwCW;`;
const CAUSTIC_VERT = /* glsl */ `
{
  vec4 nwCW = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
  nwCW = instanceMatrix * nwCW;
  #endif
  vNwCW = ( modelMatrix * nwCW ).xyz;
}
`;
const CAUSTIC_FRAG_PARS = /* glsl */ `
varying vec3 vNwCW;
uniform sampler2D uCaustics;
uniform float uTime;
uniform float uCausticLevel;
uniform float uCausticStrength;
float nwCaustic( vec2 p, float t ) {
  float a = texture2D( uCaustics, p + vec2( t * 0.031, t * 0.017 ) ).r;
  float b = texture2D( uCaustics, p * 1.37 + vec2( -t * 0.023, t * 0.027 ) ).b;
  return min( a, b );
}
`;
const CAUSTIC_WET = /* glsl */ `
float nwWet = 1.0 - smoothstep( uCausticLevel - 0.01, uCausticLevel + 0.07, vNwCW.y );
diffuseColor.rgb *= mix( 1.0, 0.72, nwWet );
`;
const CAUSTIC_ROUGH = /* glsl */ `
roughnessFactor = mix( roughnessFactor, 0.28, nwWet );
`;
const CAUSTIC_HOOK = /* glsl */ `
{
  float nwDepth = uCausticLevel - vNwCW.y;
  if ( nwDepth > 0.0 ) {
    vec3 nwUpV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
    float nwUp = 0.35 + 0.65 * saturate( dot( geometryNormal, nwUpV ) );
    vec2 p = vNwCW.xz * 0.45;
    float c = nwCaustic( p, uTime );
    // Graphic, hard-edged caustic shapes (cel look) with AA
    float fw = fwidth( c ) + 1e-3;
    float band = smoothstep( 0.42 - fw, 0.42 + fw, c );
    float fade = smoothstep( 0.0, 0.06, nwDepth ) * step( nwDepth, 2.5 );
    reflectedLight.directDiffuse += directLight.color * diffuseColor.rgb * band * uCausticStrength * fade * nwUp;
  }
}
`;

/**
 * Add animated caustics (below `level`) and a wet band (around `level`) to
 * any MeshStandardMaterial. Use a dedicated material instance per water
 * level (the level is a per-material uniform).
 */
export function applyCaustics<T extends THREE.MeshStandardMaterial | THREE.MeshToonMaterial>(
  mat: T,
  level: number,
  strength = 0.9,
): T {
  if (natureUniforms.uCaustics.value === null) natureUniforms.uCaustics.value = causticsTexture();
  const uLevel = new THREE.Uniform(level);
  const uStrength = new THREE.Uniform(strength);
  mat.userData.causticLevel = uLevel;
  chainPatch(mat, 'caustics', shader => {
    shader.uniforms.uCaustics = natureUniforms.uCaustics;
    shader.uniforms.uTime = natureUniforms.uTime;
    shader.uniforms.uCausticLevel = uLevel;
    shader.uniforms.uCausticStrength = uStrength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${CAUSTIC_VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${CAUSTIC_VERT}`);
    let fs = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CAUSTIC_FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${CAUSTIC_WET}`)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\n${CAUSTIC_ROUGH}`,
      );
    fs = injectDirLightHook(fs, CAUSTIC_HOOK);
    shader.fragmentShader = fs;
  });
  return mat;
}

// ── Water surface material ──────────────────────────────────────────────

const WATER_VERT_PARS = /* glsl */ `
attribute vec2 flow;
varying vec3 vNwW;
varying vec2 vNwFlow;
`;
const WATER_VERT = /* glsl */ `
vNwW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vNwFlow = flow;
`;
const WATER_FRAG_PARS = /* glsl */ `
varying vec3 vNwW;
varying vec2 vNwFlow;
uniform float uTime;
uniform sampler2D uCaustics;
uniform sampler2D tRefr;
uniform sampler2D tDepth;
uniform float uHasRefr;
uniform vec2 uScreen;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform float uLevel;
uniform sampler2D uWaterNormal;
uniform float uTiling;
uniform float uNormalStrength;
uniform float uRefrStrength;
uniform vec3 uDeep;
uniform vec3 uAbsorb;
uniform vec3 uWaterLight;
uniform float uFoamWidth;
uniform vec3 uFoamColor;
uniform vec4 uRipples[ 6 ];
uniform float uFlowSpeed;
vec3 nwReconstruct( vec2 uv, float d ) {
  vec4 ndc = vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );
  vec4 v = uProjInv * ndc;
  v /= v.w;
  return ( uCamWorld * v ).xyz;
}
vec2 nwSlope( vec2 uv ) {
  return texture2D( uWaterNormal, uv ).xy * 2.0 - 1.0;
}
`;
const WATER_COLOR = /* glsl */ `
vec2 nwSuv = gl_FragCoord.xy / uScreen;
float nwD0 = texture2D( tDepth, nwSuv ).x;
vec3 nwBed0 = nwReconstruct( nwSuv, nwD0 );
float nwDepth0 = uHasRefr > 0.5 ? ( nwD0 >= 0.99999 ? 10.0 : max( uLevel - nwBed0.y, 0.0 ) ) : 0.4;
float nwFoam = 0.0;
{
  // Crisp cel foam: a solid shoreline band with a wobbly edge, a thin
  // second contour line just offshore, and hard-edged flow streaks.
  float n1 = texture2D( uCaustics, vNwW.xz * 0.21 + vec2( uTime * 0.013, -uTime * 0.009 ) - vNwFlow * uTime * 0.12 ).g;
  float n2 = texture2D( uCaustics, vNwW.xz * 0.53 - vec2( uTime * 0.02, uTime * 0.011 ) - vNwFlow * uTime * 0.3 ).g;
  float wob = ( n1 - 0.5 ) * 0.06 + ( n2 - 0.5 ) * 0.03;
  float d = nwDepth0 + wob;
  float fw = fwidth( d ) + 1e-4;
  float band = 1.0 - smoothstep( uFoamWidth - fw, uFoamWidth + fw, d );
  float lineD = abs( d - uFoamWidth * 2.1 - sin( uTime * 1.3 + n1 * 6.0 ) * 0.012 );
  float line = 1.0 - smoothstep( 0.012 - fw, 0.012 + fw, lineD );
  line *= step( 0.35, n2 );
  float sv = n2 + length( vNwFlow ) * 0.12;
  float sfw = fwidth( sv ) + 1e-4;
  float streak = smoothstep( 0.8 - sfw, 0.8 + sfw, sv ) * step( 0.3, length( vNwFlow ) );
  nwFoam = saturate( max( max( band, line ), streak ) );
}
diffuseColor.rgb = uFoamColor * nwFoam;
`;
const WATER_NORMAL = /* glsl */ `
vec3 nwWN;
{
  float t = uTime;
  vec2 wuv = vNwW.xz * uTiling;
  vec2 s = nwSlope( wuv + vec2( t * 0.021, t * 0.013 ) ) * 0.6
         + nwSlope( wuv * 1.73 + vec2( -t * 0.017, t * 0.024 ) ) * 0.4;
  // Two-phase flow map
  vec2 fl = vNwFlow * uFlowSpeed;
  float ph0 = fract( t * 0.35 );
  float ph1 = fract( t * 0.35 + 0.5 );
  float w0 = 1.0 - abs( 1.0 - 2.0 * ph0 );
  vec2 sf = nwSlope( wuv * 1.3 - fl * ph0 ) * w0 + nwSlope( wuv * 1.3 - fl * ph1 + 0.37 ) * ( 1.0 - w0 );
  float fm = saturate( length( vNwFlow ) );
  s = mix( s, sf * 1.4, fm * 0.75 );
  // Ring ripples (fountain jets, rocks)
  for ( int i = 0; i < 6; i ++ ) {
    vec4 r = uRipples[ i ];
    if ( r.z <= 0.0 ) continue;
    vec2 d = vNwW.xz - r.xy;
    float dist = length( d );
    float wv = sin( dist * 14.0 - t * 5.5 + r.w ) * exp( -dist * 0.9 ) * r.z;
    s += ( d / max( dist, 1e-3 ) ) * wv * 0.5;
  }
  s *= uNormalStrength * ( 0.35 + 0.65 * smoothstep( 0.0, 0.08, nwDepth0 ) );
  nwWN = normalize( vec3( -s.x, 1.0, -s.y ) );
  normal = normalize( ( viewMatrix * vec4( nwWN, 0.0 ) ).xyz );
}
`;
const WATER_OUT = /* glsl */ `
{
  vec3 V = normalize( vViewPosition );
  float NoV = saturate( dot( normal, V ) );
  // Cel Fresnel: two flat reflection steps instead of a smooth curve
  float Fs = 0.02 + 0.98 * pow( 1.0 - NoV, 5.0 );
  float F = Fs > 0.5 ? 0.75 : ( Fs > 0.12 ? 0.3 : 0.06 );
  float edgeFade = smoothstep( 0.0, 0.05, nwDepth0 );
  vec3 waterCol;
  if ( uHasRefr > 0.5 ) {
    float distFade = 1.0 / ( 1.0 + length( vViewPosition ) * 0.06 );
    vec2 off = nwWN.xz * uRefrStrength * saturate( nwDepth0 * 4.0 ) * distFade;
    vec2 ruv = clamp( nwSuv + off, vec2( 0.001 ), vec2( 0.999 ) );
    float d1 = texture2D( tDepth, ruv ).x;
    vec3 bed1 = nwReconstruct( ruv, d1 );
    if ( bed1.y > uLevel + 0.01 ) { ruv = nwSuv; bed1 = nwBed0; d1 = nwD0; }
    vec3 refr = texture2D( tRefr, ruv ).rgb;
    float vert = d1 >= 0.99999 ? 4.0 : max( uLevel - bed1.y, 0.0 );
    float path = d1 >= 0.99999 ? 6.0 : min( distance( bed1, vNwW ), vert * 3.5 + 0.02 );
    // Quantise the optical depth into flat colour bands (clear / aqua / teal / deep)
    float pq = path < 0.12 ? path : ( path < 0.45 ? 0.3 : ( path < 1.0 ? 0.7 : 1.4 ) );
    vec3 T = exp( -uAbsorb * pq );
    waterCol = refr * T + uDeep * uWaterLight * ( 1.0 - T );
  } else {
    waterCol = uDeep * uWaterLight;
  }
  // Specular: env reflection posterised, sun glints as hard white blobs
  float sl = dot( totalSpecular, vec3( 0.333 ) );
  vec3 spec = floor( totalSpecular * 4.0 / max( 1.0, F * 4.0 ) ) * 0.25 * F * 3.0;
  spec += vec3( smoothstep( 1.6, 1.9, sl ) ) * 2.2;
  spec *= edgeFade;
  outgoingLight = waterCol * ( 1.0 - F * edgeFade * 0.6 ) * ( 1.0 - nwFoam ) + totalDiffuse + spec;
}
`;

export interface WaterLook {
  /** Colour of light scattered back from deep water (multiplied by ambient). */
  deep?: THREE.Color;
  /** Beer–Lambert absorption per metre of path (R absorbed fastest). */
  absorb?: THREE.Vector3;
  foamColor?: THREE.Color;
  /** Water depth (m) at which shoreline foam fades out. */
  foamWidth?: number;
  normalStrength?: number;
  /** Normal-map tiles per metre. */
  tiling?: number;
  /** Screen-space refraction offset scale. */
  refraction?: number;
}

const DEFAULT_LOOK: Required<WaterLook> = {
  deep: new THREE.Color(0.0, 0.5, 0.72),
  absorb: new THREE.Vector3(2.2, 0.55, 0.32),
  foamColor: new THREE.Color(0.95, 0.97, 0.95),
  foamWidth: 0.07,
  normalStrength: 0.55,
  tiling: 0.42,
  refraction: 0.035,
};

// ── Shapes ──────────────────────────────────────────────────────────────

export type WaterShape =
  | Region
  /** Stream: centreline (XZ, world) + width. Flow runs from first to last point. */
  | { type: 'path'; points: (THREE.Vector2 | [number, number])[]; width: number };

interface ShapeInfo {
  bbox: THREE.Box2;
  edgeDistance(x: number, z: number): number;
  surface: THREE.BufferGeometry;
}

function toV2(p: THREE.Vector2 | [number, number]) {
  return Array.isArray(p) ? new THREE.Vector2(p[0], p[1]) : p.clone();
}

function shapeInfo(shape: WaterShape, level: number, flowSpeed: number): ShapeInfo {
  if (shape.type === 'path') {
    const pts = shape.points.map(toV2);
    const curve = new THREE.SplineCurve(pts);
    const samples = Math.max(16, Math.ceil(curve.getLength() / 0.35));
    const cps = curve.getSpacedPoints(samples);
    const hw = shape.width / 2;
    const pos: number[] = [];
    const flow: number[] = [];
    const idx: number[] = [];
    const across = 6;
    for (let i = 0; i <= samples; i++) {
      const t = curve.getTangentAt(i / samples);
      const n = new THREE.Vector2(-t.y, t.x);
      // widen slightly at bends / randomly so banks look natural
      const w = hw * (1 + 0.18 * Math.sin(i * 0.37) + 0.1 * Math.sin(i * 1.13));
      for (let j = 0; j <= across; j++) {
        const s = j / across - 0.5;
        const p = cps[i].clone().addScaledVector(n, s * 2 * w * 1.04);
        pos.push(p.x, level, p.y);
        const center = 1 - Math.pow(Math.abs(s) * 2, 2) * 0.6;
        flow.push(t.x * flowSpeed * center, t.y * flowSpeed * center);
      }
    }
    for (let i = 0; i < samples; i++) {
      for (let j = 0; j < across; j++) {
        const a = i * (across + 1) + j;
        const b = a + across + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
    g.setIndex(idx);
    // Fix winding so faces point up
    g.computeVertexNormals();
    const ny = g.attributes.normal.getY(0);
    if (ny < 0) {
      const ix = g.index;
      if (ix !== null) {
        for (let k = 0; k < ix.count; k += 3) {
          const tmp = ix.getX(k + 1);
          ix.setX(k + 1, ix.getX(k + 2));
          ix.setX(k + 2, tmp);
        }
      }
    }
    g.computeVertexNormals();
    const bbox = new THREE.Box2().setFromPoints(cps).expandByScalar(hw * 1.4);
    const edgeDistance = (x: number, z: number) => {
      let best = Infinity;
      let bi = 0;
      for (let i = 0; i < cps.length; i++) {
        const d = (cps[i].x - x) ** 2 + (cps[i].y - z) ** 2;
        if (d < best) {
          best = d;
          bi = i;
        }
      }
      const w = hw * (1 + 0.18 * Math.sin(bi * 0.37) + 0.1 * Math.sin(bi * 1.13));
      return w - Math.sqrt(best);
    };
    return { bbox, edgeDistance, surface: g };
  }
  const s = regionSampler(shape);
  let g: THREE.BufferGeometry;
  if (shape.type === 'circle') {
    const c = toV2(shape.center);
    g = new THREE.CircleGeometry(shape.radius, 64);
    g.rotateX(-Math.PI / 2);
    g.translate(c.x, level, c.y);
  } else {
    const pts =
      shape.type === 'polygon'
        ? shape.points.map(toV2)
        : [
            new THREE.Vector2(s.bbox.min.x, s.bbox.min.y),
            new THREE.Vector2(s.bbox.max.x, s.bbox.min.y),
            new THREE.Vector2(s.bbox.max.x, s.bbox.max.y),
            new THREE.Vector2(s.bbox.min.x, s.bbox.max.y),
          ];
    g = new THREE.ShapeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(p.x, -p.y))), 24);
    g.rotateX(-Math.PI / 2);
    g.translate(0, level, 0);
  }
  g.setAttribute(
    'flow',
    new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2),
  );
  return { bbox: s.bbox, edgeDistance: s.edgeDistance, surface: g };
}

// ── Water bodies ────────────────────────────────────────────────────────

export interface WaterOptions {
  shape: WaterShape;
  /** Water surface height (world Y). */
  level: number;
  /** Generate a pebbly bed under the water (default true). */
  bed?: boolean;
  /** Max depth of the generated bed (m). */
  depth?: number;
  /** Distance (m) over which the bed slopes from the bank to full depth. */
  shoreWidth?: number;
  /** Width (m) of the dry pebble beach generated outside the water edge. */
  beach?: number;
  /** Flow speed along a 'path' (m/s-ish). */
  flowSpeed?: number;
  /** Ring-ripple emitters: [x, z, strength]. */
  ripples?: [number, number, number][];
  look?: WaterLook;
  name?: string;
}

export interface WaterBody {
  mesh: THREE.Mesh;
  bed: THREE.Mesh | null;
  /** Material to use for anything submerged in this body (caustics + wet band). */
  submergedMaterial(base?: THREE.MeshToonMaterial): THREE.MeshToonMaterial;
  level: number;
  edgeDistance(x: number, z: number): number;
  bbox: THREE.Box2;
  group: THREE.Group;
}

export interface WaterHost {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
}

const RT_SCALE: Record<NatureQuality, number> = { low: 0, medium: 0.5, high: 0.75 };

export class WaterSystem {
  readonly group = new THREE.Group();
  readonly bodies: WaterBody[] = [];
  private host: WaterHost;
  private quality: NatureQuality;
  private rt: THREE.WebGLRenderTarget | null = null;
  private shared = {
    tRefr: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uHasRefr: { value: 0 },
    uScreen: { value: new THREE.Vector2(1, 1) },
    uProjInv: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uWaterLight: { value: new THREE.Color(1, 1, 1) },
  };
  private size = new THREE.Vector2();
  private tmpV = new THREE.Vector3();
  private clear = new THREE.Color();
  private deepClear = new THREE.Color(0.02, 0.12, 0.12);
  /** Disable the refraction pre-pass at runtime (falls back to tinted water). */
  enabled = true;

  constructor(host: WaterHost, quality: NatureQuality = 'medium') {
    this.host = host;
    this.quality = quality;
    this.group.name = 'nature-water';
    if (natureUniforms.uCaustics.value === null) natureUniforms.uCaustics.value = causticsTexture();
    // Lights must be on the bed layer to light the refraction pass.
    host.sun.layers.enable(NATURE_BED_LAYER);
    host.hemi.layers.enable(NATURE_BED_LAYER);
    if (RT_SCALE[quality] > 0) {
      const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
      this.rt = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        depthTexture: depth,
        depthBuffer: true,
        stencilBuffer: false,
        samples: 0,
      });
      this.rt.texture.minFilter = THREE.LinearFilter;
      this.rt.texture.generateMipmaps = false;
      this.shared.tRefr.value = this.rt.texture;
      this.shared.tDepth.value = depth;
      this.shared.uHasRefr.value = 1;
    }
  }

  /** Make any object visible to the refraction pass (basin walls, rocks). */
  addToRefraction(obj: THREE.Object3D) {
    obj.traverse(o => o.layers.enable(NATURE_BED_LAYER));
  }

  private makeMaterial(
    level: number,
    look: Required<WaterLook>,
    flowSpeed: number,
    ripples: THREE.Vector4[],
  ) {
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.06,
      metalness: 0,
      envMapIntensity: 1,
    });
    m.userData.noToon = true; // keep PBR spec/env for glints if the scene gets toonified
    const lowQ = this.rt === null;
    if (lowQ) {
      m.transparent = true;
      m.opacity = 0.82;
    }
    const sh = this.shared;
    const uniforms = {
      uLevel: { value: level },
      uWaterNormal: { value: waterNormalTexture() },
      uTiling: { value: look.tiling },
      uNormalStrength: { value: look.normalStrength },
      uRefrStrength: { value: look.refraction },
      uDeep: { value: look.deep },
      uAbsorb: { value: look.absorb },
      uFoamWidth: { value: look.foamWidth },
      uFoamColor: { value: look.foamColor },
      uRipples: { value: ripples },
      uFlowSpeed: { value: flowSpeed > 0 ? 0.6 : 0 },
    };
    m.userData.water = uniforms;
    chainPatch(m, `water${lowQ ? 'L' : 'H'}`, shader => {
      Object.assign(shader.uniforms, uniforms, sh, {
        uTime: natureUniforms.uTime,
        uCaustics: natureUniforms.uCaustics,
      });
      // Dummy textures so the low tier still compiles without a pre-pass
      if (lowQ) {
        shader.uniforms.tRefr = { value: natureUniforms.uCaustics.value };
        shader.uniforms.tDepth = { value: natureUniforms.uCaustics.value };
      }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${WATER_VERT_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WATER_VERT}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${WATER_FRAG_PARS}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${WATER_COLOR}`)
        .replace('#include <normal_fragment_maps>', WATER_NORMAL)
        .replace('#include <opaque_fragment>', `${WATER_OUT}\n#include <opaque_fragment>`);
    });
    return m;
  }

  create(o: WaterOptions): WaterBody {
    const look = { ...DEFAULT_LOOK, ...(o.look ?? {}) };
    const flowSpeed = o.flowSpeed ?? (o.shape.type === 'path' ? 1 : 0);
    const info = shapeInfo(o.shape, o.level, flowSpeed);
    const ripples = Array.from({ length: 6 }, (_, i) => {
      const r = o.ripples?.[i];
      return r !== undefined
        ? new THREE.Vector4(r[0], r[1], r[2], i * 1.7)
        : new THREE.Vector4(0, 0, 0, 0);
    });
    const group = new THREE.Group();
    group.name = o.name ?? 'water';
    const mat = this.makeMaterial(o.level, look, flowSpeed, ripples);
    const mesh = new THREE.Mesh(info.surface, mat);
    mesh.name = `${group.name}-surface`;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    group.add(mesh);
    let bed: THREE.Mesh | null = null;
    const depth = o.depth ?? 0.6;
    if (o.bed !== false) {
      bed = this.makeBed(
        info,
        o.level,
        depth,
        o.shoreWidth ?? Math.min(2, depth * 3),
        o.beach ?? 0.7,
      );
      bed.name = `${group.name}-bed`;
      group.add(bed);
    }
    this.group.add(group);
    const body: WaterBody = {
      mesh,
      bed,
      level: o.level,
      edgeDistance: info.edgeDistance,
      bbox: info.bbox,
      group,
      submergedMaterial: (base?: THREE.MeshToonMaterial) =>
        applyCaustics(base ?? toonMaterial({ color: 0xffffff }), o.level),
    };
    this.bodies.push(body);
    return body;
  }

  /** Grid bed: slopes from the bank down to `depth`, rising into a dry pebble beach outside. */
  private makeBed(info: ShapeInfo, level: number, depth: number, shore: number, beach: number) {
    const step = 0.22;
    const minX = info.bbox.min.x - beach - 0.4;
    const minZ = info.bbox.min.y - beach - 0.4;
    const nx = Math.ceil((info.bbox.max.x + beach + 0.4 - minX) / step);
    const nz = Math.ceil((info.bbox.max.y + beach + 0.4 - minZ) / step);
    const pos: number[] = [];
    const uv: number[] = [];
    const keep: boolean[] = [];
    const ids = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = minX + i * step;
        const z = minZ + j * step;
        const d = info.edgeDistance(x, z);
        if (d < -beach - step * 1.5) {
          keep.push(false);
          continue;
        }
        const wob =
          Math.sin(x * 1.7) * Math.cos(z * 1.3) * 0.03 + Math.sin(x * 4.1 + z * 3.3) * 0.012;
        let y: number;
        if (d >= 0) {
          const t = Math.min(1, d / shore);
          y = level - depth * (t * t * (3 - 2 * t)) * 0.97 - 0.015 + wob * t;
        } else {
          const t = Math.min(1, -d / beach);
          y = level - 0.015 + 0.05 * Math.sin(t * Math.PI * 0.5) - 0.04 * Math.max(0, t - 0.8) * 5;
        }
        ids[j * (nx + 1) + i] = pos.length / 3;
        pos.push(x, y, z);
        uv.push(x / 2.2, z / 2.2);
        keep.push(true);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = ids[j * (nx + 1) + i];
        const b = ids[j * (nx + 1) + i + 1];
        const c = ids[(j + 1) * (nx + 1) + i];
        const d = ids[(j + 1) * (nx + 1) + i + 1];
        if (a < 0 || b < 0 || c < 0 || d < 0) continue;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const peb = pebbleTextures();
    const mat = applyCaustics(toonMaterial({ map: peb.map }), level);
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.layers.enable(NATURE_BED_LAYER);
    return mesh;
  }

  /** Render the refraction pre-pass. Call once per frame, before the composer. */
  update() {
    const { renderer, scene, camera, sun, hemi } = this.host;
    const sh = this.shared;
    // Ambient-ish light level for in-scattering (darkens water at night)
    const sunUp = Math.max(0, this.tmpV.copy(sun.position).sub(sun.target.position).normalize().y);
    sh.uWaterLight.value
      .copy(hemi.color)
      .multiplyScalar(hemi.intensity * 0.9)
      .add(sun.color.clone().multiplyScalar(sun.intensity * (0.08 + 0.12 * sunUp)));
    if (this.rt === null || !this.enabled || this.bodies.length === 0) return;
    let any = false;
    for (const b of this.bodies) if (b.mesh.visible) any = true;
    if (!any) return;
    renderer.getDrawingBufferSize(this.size);
    const s = RT_SCALE[this.quality];
    const w = Math.max(1, Math.floor(this.size.x * s));
    const h = Math.max(1, Math.floor(this.size.y * s));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    sh.uScreen.value.copy(this.size);
    camera.updateMatrixWorld();
    sh.uProjInv.value.copy(camera.projectionMatrixInverse);
    sh.uCamWorld.value.copy(camera.matrixWorld);

    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.shadowMap.autoUpdate;
    const prevMask = camera.layers.mask;
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clear);
    renderer.shadowMap.autoUpdate = false;
    camera.layers.set(NATURE_BED_LAYER);
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(this.deepClear, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(this.clear, prevAlpha);
    camera.layers.mask = prevMask;
    renderer.shadowMap.autoUpdate = prevAuto;
  }

  dispose() {
    this.rt?.dispose();
    for (const b of this.bodies) {
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
      b.bed?.geometry.dispose();
    }
  }
}
