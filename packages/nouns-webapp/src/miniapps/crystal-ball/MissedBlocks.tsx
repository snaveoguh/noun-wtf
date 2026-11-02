/* eslint-disable react/no-unknown-property -- three.js JSX props (args, vertexColors, …) */
/**
 * MissedBlocks — every block since the auction ended, as the Noun it would
 * have minted (settle in the next block and the seeder hashes this one), on
 * a reel along the bottom of the crystal ball page: each one a small
 * character-select card on its own background colour, standing and turning
 * like a Noun World rider, with a minimal HUD in the game's style (ink
 * outlines, the yellow / pink / cyan, Londrina numbers). Under each card,
 * always: DREAM (save it to your dream drafts) and PLAY (Noun World with
 * that Noun as your rider; V1 only, the game draws riders with V1 art). The reel drifts and stops while you hover it;
 * on touch it holds still and scrolls by finger, with 40 px buttons.
 *
 * One shared canvas, laid over the reel's card band, draws every card (drei `View`): a page can only hold
 * ~16 WebGL contexts, and a canvas per card would hit that in a minute of
 * Noun O'Clock.
 */
import type { NounSeed } from '@/components/CrystalBall';

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  BLING_DEPTH,
  BODY_DEPTH,
  GLASSES_DEPTH,
  HEAD_DEPTH,
  seedToLayers,
  type NounLayers,
} from '@nouns/voxel-engine';
import { PerspectiveCamera, View } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useNavigate } from 'react-router';
import * as THREE from 'three';

import { saveDreamToStorage } from '@/lib/dreamStorage';
import { pickNounAssets } from '@/lib/nounAssets';

export interface MissedBlock {
  block: number;
  nounId: number;
  seed: NounSeed;
  /** Best historical twin (V1 only): the Noun and how many traits match. */
  twin: { nounId: number; matches: number } | null;
}

interface Voxel {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
}

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** The Noun as voxels (the same layering as the crystal ball's 3D view), and its background colour. */
function seedVoxels(seed: NounSeed, isV2: boolean): { voxels: Voxel[]; bg: string } {
  const { ImageData, getNounData } = pickNounAssets(isV2);
  const layers: NounLayers = seedToLayers(seed, getNounData, ImageData.palette);
  const blingZ = BODY_DEPTH / 2 + BLING_DEPTH / 2;
  const headZ = BODY_DEPTH / 2 - BLING_DEPTH / 2 + 0.03;
  const glassesZ = headZ + HEAD_DEPTH / 2 + GLASSES_DEPTH / 2 + 0.02;
  const out: Voxel[] = [];
  const push = (ps: NounLayers['body'], z: number) => {
    for (const p of ps) out.push({ x: p.x - 15.5, y: p.y - 15.5, z, r: p.r, g: p.g, b: p.b });
  };
  push(layers.body, 0);
  push(layers.bling, blingZ);
  push(layers.head, headZ);
  push(layers.glasses, glassesZ);
  const bgHex = ImageData.bgcolors[seed.background] ?? 'd5d7e1';
  return { voxels: out, bg: `#${bgHex}` };
}

const seedKey = (s: NounSeed) => `${s.background}-${s.body}-${s.accessory}-${s.head}-${s.glasses}`;

/** One Noun standing and turning, with a little idle bob (each card at its own phase). */
function CharacterNoun({ voxels, phase }: { voxels: Voxel[]; phase: number }) {
  const group = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const c = new Float32Array(Math.max(1, voxels.length) * 3);
    voxels.forEach((v, i) => {
      c[i * 3] = lin(v.r / 255);
      c[i * 3 + 1] = lin(v.g / 255);
      c[i * 3 + 2] = lin(v.b / 255);
    });
    g.setAttribute('color', new THREE.InstancedBufferAttribute(c, 3));
    return g;
  }, [voxels]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => {
    const m = mesh.current;
    if (m == null) return;
    const d = new THREE.Object3D();
    voxels.forEach((v, i) => {
      d.position.set(v.x, v.y, v.z);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [voxels]);
  useFrame(({ clock }) => {
    const g = group.current;
    if (g == null) return;
    const t = clock.elapsedTime + phase;
    g.rotation.y = phase + t * 0.8;
    g.position.y = Math.abs(Math.sin(t * 2.2)) * 0.9;
  });
  return (
    <group ref={group}>
      <instancedMesh
        ref={mesh}
        args={[geometry, undefined, Math.max(1, voxels.length)]}
        frustumCulled={false}
      >
        <meshBasicMaterial vertexColors toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

const CSS = `
.cbr-wrap{width:100%;margin-top:auto;padding:10px 0 4px;position:relative}
.cbr-scroll{position:relative;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
.cbr-scroll::-webkit-scrollbar{display:none}
.cbr-stage{position:relative}
.cbr-gl{position:absolute;left:0;right:0;top:0;height:108px;pointer-events:none;z-index:1}
.cbr-label{font:800 9px/1 system-ui,sans-serif;letter-spacing:.14em;color:#fff;opacity:.75;margin:0 16px 8px;text-shadow:0 1px 2px #000}
.cbr-label b{color:#ffd400}
.cbr-track{display:flex;gap:10px;width:max-content;padding:4px 16px 8px;animation:cbr-reel var(--cbr-dur,60s) linear infinite}
.cbr-wrap:hover .cbr-track,.cbr-wrap:focus-within .cbr-track{animation-play-state:paused}
@keyframes cbr-reel{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@media (prefers-reduced-motion:reduce){.cbr-track{animation:none}.cbr-scroll{scrollbar-width:thin}}
.cbr-slot{flex:none;width:84px;display:flex;flex-direction:column;gap:5px}
.cbr-card{position:relative;width:84px;height:104px;border-radius:10px;border:2px solid #0b0b12;box-shadow:0 0 0 1.5px rgba(255,255,255,.28),0 3px 0 rgba(0,0,0,.35);overflow:hidden;transition:transform .12s,box-shadow .15s}
.cbr-slot:hover .cbr-card{transform:translateY(-3px);box-shadow:0 0 0 2px #ffd400,0 5px 0 rgba(0,0,0,.35)}
.cbr-card::before,.cbr-card::after{content:'';position:absolute;width:9px;height:9px;border:2px solid rgba(11,11,18,.55);z-index:2;pointer-events:none}
.cbr-card::before{top:4px;left:4px;border-right:0;border-bottom:0}
.cbr-card::after{bottom:20px;right:4px;border-left:0;border-top:0}
.cbr-floor{position:absolute;left:50%;bottom:22px;width:44px;height:7px;margin-left:-22px;border-radius:50%;background:rgba(11,11,18,.22);pointer-events:none}
.cbr-id{position:absolute;top:5px;right:6px;z-index:2;font-family:'Londrina Solid',system-ui,sans-serif;font-style:italic;font-weight:900;font-size:13px;line-height:1;color:#fff;text-shadow:2px 2px 0 #0b0b12,-1px -1px 0 #0b0b12,1px -1px 0 #0b0b12,-1px 1px 0 #0b0b12}
.cbr-twin{position:absolute;top:22px;right:5px;z-index:2;padding:1px 4px;border-radius:5px;border:1.5px solid #0b0b12;font:900 8px/1.2 system-ui,sans-serif;color:#0b0b12}
.cbr-blk{position:absolute;left:0;right:0;bottom:0;height:18px;z-index:2;display:flex;align-items:center;justify-content:center;background:rgba(11,11,18,.82);font:800 9px/1 system-ui,sans-serif;letter-spacing:.06em;color:#fff;font-variant-numeric:tabular-nums}
.cbr-blk i{font-style:normal;opacity:.55;margin-right:3px}
.cbr-btns{display:flex;gap:4px}
.cbr-btn{flex:1;cursor:pointer;padding:4px 0;border-radius:7px;border:2px solid #0b0b12;font:900 9px/1 system-ui,sans-serif;letter-spacing:.06em;color:#0b0b12;background:#ffd400;box-shadow:2px 2px 0 #ff2f8e;transition:transform .08s}
.cbr-btn:active{transform:translate(2px,2px);box-shadow:0 0 0 #ff2f8e}
.cbr-btn:disabled{cursor:default;opacity:.8}
.cbr-btn.cbr-play{background:#20d6ff}
.cbr-btn:focus-visible{outline:2px solid #fff;outline-offset:1px}
@media (pointer:coarse){
.cbr-scroll{overscroll-behavior-x:contain;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch}
.cbr-track{animation:none}
.cbr-slot{width:100px;scroll-snap-align:start}
.cbr-card{width:100px}
.cbr-btn{min-height:40px}
}
`;

function Card({
  m,
  isV2,
  phase,
  onPlay,
}: {
  m: MissedBlock;
  isV2: boolean;
  phase: number;
  onPlay: (m: MissedBlock) => void;
}) {
  const { voxels, bg } = useMemo(() => seedVoxels(m.seed, isV2), [m.seed, isV2]);
  const [saved, setSaved] = useState(false);
  const save = () => {
    saveDreamToStorage({
      id: `missed-${isV2 ? 'v2-' : ''}${m.nounId}-${m.block}`,
      title: `${isV2 ? 'NounV2' : 'Noun'} ${m.nounId} · block ${m.block}`,
      description: `The ${isV2 ? 'NounV2' : 'Noun'} ${m.nounId} that block ${m.block} would have minted (crystal ball, missed block).`,
      seed: m.seed,
      createdAt: Date.now(),
      status: 'draft',
    });
    setSaved(true);
  };
  const twinColour =
    m.twin == null
      ? ''
      : m.twin.matches >= 5
        ? '#8b5cf6'
        : m.twin.matches === 4
          ? '#ff2f8e'
          : '#ffd400';
  return (
    <div className="cbr-slot">
      <div
        className="cbr-card"
        style={{ background: bg }}
        title={`Block ${m.block} → Noun ${m.nounId}`}
      >
        <div className="cbr-floor" />
        <View style={{ position: 'absolute', inset: '0 0 18px' }}>
          <PerspectiveCamera makeDefault position={[0, 0, 58]} fov={38} />
          <CharacterNoun voxels={voxels} phase={phase} />
        </View>
        <div className="cbr-id">#{m.nounId}</div>
        {m.twin != null && m.twin.matches >= 3 && (
          <div className="cbr-twin" style={{ background: twinColour }}>
            {m.twin.matches}/5
          </div>
        )}
        <div className="cbr-blk">
          <i>BLK</i>
          {m.block.toLocaleString()}
        </div>
      </div>
      <div className="cbr-btns">
        <button
          type="button"
          className="cbr-btn"
          onClick={save}
          disabled={saved}
          title="Save this Noun to your dream drafts"
        >
          {saved ? 'SAVED' : 'DREAM'}
        </button>
        <button
          type="button"
          className="cbr-btn cbr-play"
          onClick={() => onPlay(m)}
          // Noun World draws riders with V1 art: a V2 seed would come out wrong
          disabled={isV2}
          title={isV2 ? 'Noun World plays V1 Nouns for now' : 'Open Noun World as this Noun'}
        >
          PLAY
        </button>
      </div>
    </div>
  );
}

export default function MissedBlocks({
  items,
  isV2,
  sinceEnded,
}: {
  items: MissedBlock[];
  isV2: boolean;
  /** Roughly how many blocks have gone by since the auction ended. */
  sinceEnded: number;
}) {
  const navigate = useNavigate();
  // The shared canvas mounts after the first paint (View needs its DOM slots)
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [coarse] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true,
  );
  if (items.length === 0) return null;
  // Twice over, so the reel loops seamlessly (it scrolls by half its width).
  // On touch it doesn't drift (a moving DREAM / PLAY is hard to tap): it
  // scrolls by finger, so each block is shown once.
  const reel = coarse ? items : [...items, ...items];
  const play = (m: MissedBlock) => navigate(`/world?seed=${seedKey(m.seed)}`);
  return (
    <section className="cbr-wrap" aria-label="Missed blocks">
      <style>{CSS}</style>
      <div className="cbr-label">
        MISSED BLOCKS · <b>{sinceEnded.toLocaleString()}</b> SINCE THE AUCTION ENDED
        {sinceEnded > items.length ? ` · LATEST ${items.length}` : ''}
      </div>
      <div className="cbr-stage">
        <div className="cbr-scroll">
          <div className="cbr-track" style={{ ['--cbr-dur' as string]: `${items.length * 3.2}s` }}>
            {reel.map((m, i) => (
              <Card
                key={`${m.block}-${i}`}
                m={m}
                isV2={isV2}
                phase={(i % items.length) * 0.7}
                onPlay={play}
              />
            ))}
          </div>
        </div>
        {/* The shared canvas covers only the cards' band of the strip (the
            Views draw nothing elsewhere), not the page or the buttons. */}
        {ready && (
          <Canvas
            eventSource={document.body}
            className="cbr-gl"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              height: 108,
              pointerEvents: 'none',
              zIndex: 1,
            }}
            gl={{ alpha: true, antialias: true }}
            dpr={[1, 2]}
          >
            <View.Port />
          </Canvas>
        )}
      </div>
    </section>
  );
}
