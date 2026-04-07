// ── MegaRamp3D — Bob Burnquist's Mega Ramp + Hoverboard ─────────────
//
// A MASSIVE structure inspired by Bob Burnquist's backyard mega ramp:
//   1. Platform at top with safety railing (12 units up)
//   2. Near-vertical drop-in (steep initial descent)
//   3. Curved quarter-pipe transition to flat run
//   4. Launch kicker ramp at the end (sends you airborne over a gap)
//   5. Landing ramp on the far side of the gap
//   6. Giant NOGGLES (⌐◧-◧) on the grind rail
//   7. Graffiti patches on side walls
//   8. 50+ stairs on the side to walk up
//   9. Teleport portal (glowing torus) at the bottom → back to top
//
// Also exports:
//   - HoverboardPickup3D — glowing pickup near the ramp
//   - HoverboardAttachment — attaches to player feet when mounted

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// ── Constants ────────────────────────────────────────────────────────

const TILE_SIZE = 16;
const WORLD_SCALE = 0.1;

// Ramp dimensions — MASSIVE Bob Burnquist scale
const RAMP_LENGTH = 30; // total length along slope
const RAMP_HEIGHT = 12; // peak height
const RAMP_WIDTH = 8; // width
const CURVE_SEGMENTS = 48;

// Launch/gap section
const KICKER_LENGTH = 4; // launch kicker at end
const KICKER_HEIGHT = 3; // kicker lip height above flat
const GAP_LENGTH = 6; // gap between launch and landing
const LANDING_LENGTH = 8; // landing ramp
const LANDING_ANGLE = 0.4; // radians — gentle angle

// Position: eastern edge of island
const RAMP_X = 50 * TILE_SIZE * WORLD_SCALE; // 80
const RAMP_Z = 32 * TILE_SIZE * WORLD_SCALE; // 51.2
const RAMP_Y = 0;

// Portal — big enough you can't miss it
const PORTAL_RADIUS = 4.5;

// Hoverboard
const HOVER_COLOR = '#00ffcc';
const HOVER_GLOW_INTENSITY = 3;

// ── Ramp bounds export (for skating.ts collision) ────────────────────

export const MEGA_RAMP_BOUNDS = {
  x: RAMP_X,
  z: RAMP_Z,
  length: RAMP_LENGTH,
  width: RAMP_WIDTH,
  height: RAMP_HEIGHT,
  rotation: 0,
};

// ── Quarter-pipe surface geometry (steep drop-in) ────────────────────

function createMegaRampGeometry(): THREE.BufferGeometry {
  const halfW = RAMP_WIDTH / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Generate vertices along the curve
  // Bob Burnquist profile: steep initial drop then smooth transition
  // Using a modified curve: y = H * (1 - cos(t * PI/2))^1.4 for steeper top
  for (let j = 0; j <= 1; j++) {
    const xPos = j === 0 ? -halfW : halfW;
    for (let i = 0; i <= CURVE_SEGMENTS; i++) {
      const t = i / CURVE_SEGMENTS;
      const z = -RAMP_LENGTH / 2 + t * RAMP_LENGTH;

      // Steep drop profile: almost vertical at top, smooth curve at bottom
      const curveT = 1 - Math.pow(1 - t, 1.8);
      const y = RAMP_HEIGHT * Math.sin((curveT * Math.PI) / 2);

      // Surface normal
      const dt = 0.001;
      const t2 = Math.min(1, t + dt);
      const curveT2 = 1 - Math.pow(1 - t2, 1.8);
      const y2 = RAMP_HEIGHT * Math.sin((curveT2 * Math.PI) / 2);
      const dydz = (y2 - y) / (dt * RAMP_LENGTH);
      const nLen = Math.sqrt(1 + dydz * dydz);

      positions.push(xPos, y, z);
      normals.push(0, 1 / nLen, -dydz / nLen);
      uvs.push(j, t);
    }
  }

  // Build triangles
  for (let i = 0; i < CURVE_SEGMENTS; i++) {
    const a = i;
    const b = i + 1;
    const c = CURVE_SEGMENTS + 1 + i;
    const d = CURVE_SEGMENTS + 1 + i + 1;
    indices.push(a, c, b);
    indices.push(b, c, d);
  }

  // Bottom surface (thickness)
  const thickness = 0.4;
  const baseVertCount = positions.length / 3;
  for (let j = 0; j <= 1; j++) {
    const xPos = j === 0 ? -halfW : halfW;
    for (let i = 0; i <= CURVE_SEGMENTS; i++) {
      const t = i / CURVE_SEGMENTS;
      const z = -RAMP_LENGTH / 2 + t * RAMP_LENGTH;
      const curveT = 1 - Math.pow(1 - t, 1.8);
      const y = RAMP_HEIGHT * Math.sin((curveT * Math.PI) / 2) - thickness;

      positions.push(xPos, y, z);
      normals.push(0, -1, 0);
      uvs.push(j, t);
    }
  }

  for (let i = 0; i < CURVE_SEGMENTS; i++) {
    const a = baseVertCount + i;
    const b = baseVertCount + i + 1;
    const c = baseVertCount + CURVE_SEGMENTS + 1 + i;
    const d = baseVertCount + CURVE_SEGMENTS + 1 + i + 1;
    indices.push(a, b, c);
    indices.push(b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ── Launch Kicker Geometry ───────────────────────────────────────────

function LaunchKicker() {
  // Kicker at the end of the flat run — sends you over the gap
  const kickerZ = -RAMP_LENGTH / 2 - KICKER_LENGTH / 2;
  return (
    <group position={[0, 0, kickerZ]}>
      {/* Curved kicker surface */}
      <mesh rotation={[0.3, 0, 0]} position={[0, KICKER_HEIGHT / 2, 0]}>
        <boxGeometry args={[RAMP_WIDTH, 0.3, KICKER_LENGTH]} />
        <meshStandardMaterial color="#b0b0b0" roughness={0.5} metalness={0.2} />
      </mesh>
      {/* Support structure */}
      <mesh position={[0, KICKER_HEIGHT / 4, KICKER_LENGTH * 0.3]}>
        <boxGeometry args={[RAMP_WIDTH, KICKER_HEIGHT / 2, 0.3]} />
        <meshStandardMaterial color="#666666" roughness={0.8} />
      </mesh>
      {/* Side supports */}
      {[-1, 1].map(side => (
        <mesh key={side} position={[(side * RAMP_WIDTH) / 2, KICKER_HEIGHT / 4, 0]}>
          <boxGeometry args={[0.3, KICKER_HEIGHT / 2, KICKER_LENGTH]} />
          <meshStandardMaterial color="#555555" roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

// ── Landing Ramp ─────────────────────────────────────────────────────

function LandingRamp() {
  const landingZ = -RAMP_LENGTH / 2 - KICKER_LENGTH - GAP_LENGTH - LANDING_LENGTH / 2;
  return (
    <group position={[0, 0, landingZ]}>
      <mesh rotation={[-LANDING_ANGLE, 0, 0]} position={[0, 1.5, 0]}>
        <boxGeometry args={[RAMP_WIDTH, 0.3, LANDING_LENGTH]} />
        <meshStandardMaterial color="#999999" roughness={0.6} metalness={0.1} />
      </mesh>
      {/* Support pillars */}
      {[-1, 0, 1].map(i => (
        <mesh key={i} position={[i * 2.5, 0.75, 0]}>
          <boxGeometry args={[0.4, 1.5, 0.4]} />
          <meshStandardMaterial color="#777777" roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

// ── Giant Noggles on Grind Rail ──────────────────────────────────────

function GiantNoggles({ position }: { position: [number, number, number] }) {
  const barThickness = 0.12;
  const frameW = 1.4; // bigger than original
  const frameH = 0.9;

  const metalMat = useMemo(
    () => (
      <meshStandardMaterial
        color="#cccccc"
        metalness={0.85}
        roughness={0.15}
        emissive="#222222"
        emissiveIntensity={0.3}
      />
    ),
    [],
  );

  const Frame = ({ offset }: { offset: number }) => (
    <group position={[offset, 0, 0]}>
      {/* Top */}
      <mesh position={[0, frameH / 2, 0]}>
        <boxGeometry args={[frameW, barThickness, barThickness]} />
        {metalMat}
      </mesh>
      {/* Bottom */}
      <mesh position={[0, -frameH / 2, 0]}>
        <boxGeometry args={[frameW, barThickness, barThickness]} />
        {metalMat}
      </mesh>
      {/* Left */}
      <mesh position={[-frameW / 2, 0, 0]}>
        <boxGeometry args={[barThickness, frameH, barThickness]} />
        {metalMat}
      </mesh>
      {/* Right */}
      <mesh position={[frameW / 2, 0, 0]}>
        <boxGeometry args={[barThickness, frameH, barThickness]} />
        {metalMat}
      </mesh>
      {/* Tinted lens fill */}
      <mesh position={[0, 0, 0.01]}>
        <planeGeometry args={[frameW - barThickness, frameH - barThickness]} />
        <meshStandardMaterial
          color="#ff0044"
          transparent
          opacity={0.25}
          side={THREE.DoubleSide}
          emissive="#ff0044"
          emissiveIntensity={0.2}
        />
      </mesh>
    </group>
  );

  return (
    <group position={position} scale={[1.5, 1.5, 1.5]}>
      {/* Left lens */}
      <Frame offset={-0.85} />
      {/* Right lens */}
      <Frame offset={0.85} />
      {/* Bridge */}
      <mesh position={[0, frameH / 2, 0]}>
        <boxGeometry args={[0.5, barThickness, barThickness]} />
        {metalMat}
      </mesh>
      {/* Temple arm */}
      <mesh position={[-1.55 - 0.4, frameH / 2 - 0.05, 0]}>
        <boxGeometry args={[0.8, barThickness * 0.8, barThickness * 0.8]} />
        {metalMat}
      </mesh>
    </group>
  );
}

// ── Stairs (50+ steps) ──────────────────────────────────────────────

function MegaStairs() {
  const STEP_COUNT = 52;
  const stepHeight = RAMP_HEIGHT / STEP_COUNT;
  const stepDepth = RAMP_LENGTH / STEP_COUNT;
  const stepWidth = 1.4;

  const steps = useMemo(() => {
    const arr: Array<{ y: number; z: number }> = [];
    for (let i = 0; i < STEP_COUNT; i++) {
      arr.push({
        y: i * stepHeight + stepHeight / 2,
        z: -RAMP_LENGTH / 2 + i * stepDepth + stepDepth / 2,
      });
    }
    return arr;
  }, []);

  return (
    <group position={[RAMP_WIDTH / 2 + stepWidth / 2 + 0.3, 0, 0]}>
      {steps.map((step, i) => (
        <mesh key={i} position={[0, step.y, step.z]}>
          <boxGeometry args={[stepWidth, stepHeight, stepDepth]} />
          <meshStandardMaterial color={i % 2 === 0 ? '#707070' : '#7a7a7a'} roughness={0.8} />
        </mesh>
      ))}
      {/* Railing */}
      <mesh position={[stepWidth / 2 + 0.06, RAMP_HEIGHT / 2 + 0.5, 0]}>
        <cylinderGeometry args={[0.05, 0.05, Math.sqrt(RAMP_HEIGHT ** 2 + RAMP_LENGTH ** 2), 8]} />
        <meshStandardMaterial color="#444444" metalness={0.6} roughness={0.3} />
      </mesh>
      {/* Railing posts */}
      {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map((frac, i) => {
        const postY = frac * RAMP_HEIGHT;
        const postZ = -RAMP_LENGTH / 2 + frac * RAMP_LENGTH;
        return (
          <mesh key={`post-${i}`} position={[stepWidth / 2 + 0.06, postY + 0.4, postZ]}>
            <cylinderGeometry args={[0.04, 0.04, 0.8, 6]} />
            <meshStandardMaterial color="#555555" metalness={0.5} roughness={0.4} />
          </mesh>
        );
      })}
    </group>
  );
}

// ── Teleport Portal ──────────────────────────────────────────────────

function TeleportPortal({ position }: { position: [number, number, number] }) {
  const torusRef = useRef<THREE.Mesh>(null);
  const particlesRef = useRef<THREE.Points>(null);

  const particleGeo = useMemo(() => {
    const count = 120;
    const pos = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * PORTAL_RADIUS * 0.85;
      pos[i * 3] = Math.cos(angle) * r;
      pos[i * 3 + 1] = Math.sin(angle) * r;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
      seeds[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
    return geo;
  }, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (torusRef.current) {
      torusRef.current.rotation.z = t * 0.5;
    }
    if (particlesRef.current) {
      const posAttr = particlesRef.current.geometry.attributes.position;
      const seedAttr = particlesRef.current.geometry.attributes.seed;
      for (let i = 0; i < posAttr.count; i++) {
        const seed = (seedAttr as THREE.BufferAttribute).getX(i);
        const angle = t * (0.4 + seed * 0.6) + seed * Math.PI * 2;
        const r = (0.2 + seed * 0.85) * PORTAL_RADIUS;
        posAttr.setX(i, Math.cos(angle) * r);
        posAttr.setY(i, Math.sin(angle) * r);
        posAttr.setZ(i, Math.sin(t * 2.5 + seed * 7) * 0.25);
      }
      posAttr.needsUpdate = true;
    }
  });

  return (
    <group position={position}>
      {/* Glowing torus */}
      <mesh ref={torusRef}>
        <torusGeometry args={[PORTAL_RADIUS, 0.15, 16, 40]} />
        <meshStandardMaterial
          color="#00ddff"
          emissive="#00ddff"
          emissiveIntensity={2.5}
          metalness={0.3}
          roughness={0.2}
          transparent
          opacity={0.9}
        />
      </mesh>
      {/* Inner disc */}
      <mesh>
        <circleGeometry args={[PORTAL_RADIUS * 0.9, 32]} />
        <meshBasicMaterial color="#00aaff" transparent opacity={0.25} side={THREE.DoubleSide} />
      </mesh>
      {/* Particles */}
      <points ref={particlesRef}>
        <primitive object={particleGeo} attach="geometry" />
        <pointsMaterial
          color="#88eeff"
          size={0.07}
          transparent
          opacity={0.7}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
      <pointLight color="#00ddff" intensity={5} distance={10} />
    </group>
  );
}

// ── Graffiti Patches ─────────────────────────────────────────────────

function GraffitiPatches({ wallHeight, wallLength }: { wallHeight: number; wallLength: number }) {
  const patches = useMemo(() => {
    const colors = [
      '#e74c3c',
      '#f39c12',
      '#2ecc71',
      '#3498db',
      '#9b59b6',
      '#e91e63',
      '#ff5722',
      '#00bcd4',
      '#ffeb3b',
      '#4caf50',
      '#ff6f00',
      '#7c4dff',
    ];
    const arr: Array<{ x: number; y: number; w: number; h: number; color: string; rot: number }> =
      [];
    for (let i = 0; i < 18; i++) {
      const seed = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      const frac = seed - Math.floor(seed);
      const seed2 = Math.sin(i * 269.3 + 183.1) * 31758.9;
      const frac2 = seed2 - Math.floor(seed2);
      const seed3 = Math.sin(i * 419.7 + 71.3) * 12345.6;
      const frac3 = seed3 - Math.floor(seed3);
      arr.push({
        x: (frac - 0.5) * wallLength * 0.85,
        y: frac2 * wallHeight * 0.65 + wallHeight * 0.12,
        w: 0.5 + frac * 1.2,
        h: 0.4 + frac2 * 0.7,
        color: colors[i % colors.length],
        rot: (frac3 - 0.5) * 0.3,
      });
    }
    return arr;
  }, [wallHeight, wallLength]);

  return (
    <>
      {patches.map((p, i) => (
        <mesh key={i} position={[0.02, p.y, p.x]} rotation={[0, 0, p.rot]}>
          <planeGeometry args={[p.w, p.h]} />
          <meshBasicMaterial color={p.color} transparent opacity={0.55} />
        </mesh>
      ))}
    </>
  );
}

// ── Hoverboard Pickup (world item to mount) ──────────────────────────

interface HoverboardPickup3DProps {
  position: [number, number, number];
  onPickup?: () => void;
  playerDistance?: number;
}

export function HoverboardPickup3D({
  position,
  onPickup,
  playerDistance,
}: HoverboardPickup3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.PointLight>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (groupRef.current) {
      // Float and spin
      groupRef.current.position.y = position[1] + 0.5 + Math.sin(t * 2) * 0.15;
      groupRef.current.rotation.y = t * 1.2;
    }
    if (glowRef.current) {
      glowRef.current.intensity = 2 + Math.sin(t * 3) * 0.8;
    }
    // Auto-pickup proximity
    if (onPickup && playerDistance !== undefined && playerDistance < 1.5) {
      onPickup();
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* Board body — flat rounded rectangle */}
      <mesh>
        <boxGeometry args={[0.6, 0.06, 0.2]} />
        <meshStandardMaterial
          color={HOVER_COLOR}
          emissive={HOVER_COLOR}
          emissiveIntensity={HOVER_GLOW_INTENSITY}
          metalness={0.4}
          roughness={0.2}
          transparent
          opacity={0.9}
        />
      </mesh>
      {/* Rounded ends */}
      {[-0.3, 0.3].map(x => (
        <mesh key={x} position={[x, 0, 0]}>
          <cylinderGeometry args={[0.1, 0.1, 0.06, 12]} />
          <meshStandardMaterial
            color={HOVER_COLOR}
            emissive={HOVER_COLOR}
            emissiveIntensity={HOVER_GLOW_INTENSITY}
            metalness={0.4}
            roughness={0.2}
          />
        </mesh>
      ))}
      {/* Thruster lights underneath */}
      <pointLight position={[-0.15, -0.1, 0]} color={HOVER_COLOR} intensity={1.5} distance={1.5} />
      <pointLight position={[0.15, -0.1, 0]} color={HOVER_COLOR} intensity={1.5} distance={1.5} />
      {/* Pickup glow */}
      <pointLight ref={glowRef} color={HOVER_COLOR} intensity={2} distance={4} />
      {/* "S to mount" indicator — small floating text plane */}
      <mesh position={[0, 0.4, 0]}>
        <planeGeometry args={[0.5, 0.15]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ── Hoverboard Attachment (attaches to player feet when mounted) ─────

interface HoverboardAttachmentProps {
  speed: number; // current speed (for trail intensity)
  crouching: boolean; // shift held
  surfaceTilt: [number, number]; // [rotX, rotZ] from getSurfaceTilt
}

export function HoverboardAttachment({ speed, crouching, surfaceTilt }: HoverboardAttachmentProps) {
  const trailRef = useRef<THREE.Points>(null);
  const leftThrusterRef = useRef<THREE.PointLight>(null);
  const rightThrusterRef = useRef<THREE.PointLight>(null);

  // Trail particles
  const trailGeo = useMemo(() => {
    const count = 40;
    const pos = new Float32Array(count * 3);
    const ages = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = 0;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = i * 0.08; // spread behind
      ages[i] = i / count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('age', new THREE.BufferAttribute(ages, 1));
    return geo;
  }, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;

    // Animate trail based on speed
    if (trailRef.current) {
      const posAttr = trailRef.current.geometry.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        const age = i / posAttr.count;
        // Trail fades and spreads behind
        posAttr.setX(i, (Math.random() - 0.5) * 0.05 * speed);
        posAttr.setY(i, -0.05 + Math.random() * 0.02);
        posAttr.setZ(i, age * 0.5 * Math.max(1, speed));
      }
      posAttr.needsUpdate = true;
      // Hide trail when slow
      trailRef.current.visible = speed > 0.5;
    }

    // Thruster pulse
    const pulse = 1.5 + Math.sin(t * 8) * 0.5;
    const thrusterIntensity = crouching ? pulse * 2 : pulse;
    if (leftThrusterRef.current) leftThrusterRef.current.intensity = thrusterIntensity;
    if (rightThrusterRef.current) rightThrusterRef.current.intensity = thrusterIntensity;
  });

  const boardY = crouching ? -0.08 : -0.15; // board tucks up when crouching

  return (
    <group rotation={[surfaceTilt[0], 0, surfaceTilt[1]]}>
      {/* Board platform */}
      <group position={[0, boardY, 0]}>
        {/* Main deck */}
        <mesh>
          <boxGeometry args={[0.5, 0.04, 0.18]} />
          <meshStandardMaterial
            color={HOVER_COLOR}
            emissive={HOVER_COLOR}
            emissiveIntensity={2}
            metalness={0.5}
            roughness={0.15}
            transparent
            opacity={0.85}
          />
        </mesh>
        {/* Rounded nose/tail */}
        {[-0.25, 0.25].map(x => (
          <mesh key={x} position={[x, 0, 0]}>
            <cylinderGeometry args={[0.09, 0.09, 0.04, 10]} />
            <meshStandardMaterial
              color={HOVER_COLOR}
              emissive={HOVER_COLOR}
              emissiveIntensity={2}
              metalness={0.5}
              roughness={0.15}
            />
          </mesh>
        ))}
        {/* Edge glow strip */}
        <mesh position={[0, -0.025, 0]}>
          <boxGeometry args={[0.52, 0.005, 0.19]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.4} />
        </mesh>

        {/* Thruster lights underneath */}
        <pointLight
          ref={leftThrusterRef}
          position={[-0.12, -0.08, 0]}
          color={HOVER_COLOR}
          intensity={1.5}
          distance={0.8}
        />
        <pointLight
          ref={rightThrusterRef}
          position={[0.12, -0.08, 0]}
          color={HOVER_COLOR}
          intensity={1.5}
          distance={0.8}
        />
        {/* Thruster glow meshes */}
        {[-0.12, 0.12].map(x => (
          <mesh key={`thruster-${x}`} position={[x, -0.06, 0]}>
            <sphereGeometry args={[0.025, 8, 8]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.8} />
          </mesh>
        ))}

        {/* Neon trail particles behind board */}
        <points ref={trailRef} position={[0, -0.03, 0.1]}>
          <primitive object={trailGeo} attach="geometry" />
          <pointsMaterial
            color={HOVER_COLOR}
            size={0.03}
            transparent
            opacity={0.5}
            sizeAttenuation
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </points>
      </group>
    </group>
  );
}

// ── Main MegaRamp3D Component ────────────────────────────────────────

interface MegaRamp3DProps {
  playerPosition?: [number, number, number];
  onPortalEnter?: () => void;
}

export function MegaRamp3D({ playerPosition, onPortalEnter }: MegaRamp3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const rampGeo = useMemo(() => createMegaRampGeometry(), []);

  // Portal collision check
  useFrame(() => {
    if (!playerPosition || !onPortalEnter) return;
    const portalWorldX = RAMP_X;
    const portalWorldZ = RAMP_Z - RAMP_LENGTH / 2 - 6;
    const dx = playerPosition[0] - portalWorldX;
    const dz = playerPosition[2] - portalWorldZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < PORTAL_RADIUS * 1.3 && playerPosition[1] < 2) {
      onPortalEnter();
    }
  });

  return (
    <group ref={groupRef} position={[RAMP_X, RAMP_Y, RAMP_Z]}>
      {/* ── Main curved ramp surface (steep drop-in) ── */}
      <mesh geometry={rampGeo}>
        <meshStandardMaterial
          color="#a0a0a0"
          roughness={0.55}
          metalness={0.15}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* ── Flat run at bottom (transition zone) ── */}
      <mesh position={[0, 0.15, -RAMP_LENGTH / 2 + 1]}>
        <boxGeometry args={[RAMP_WIDTH, 0.3, 4]} />
        <meshStandardMaterial color="#909090" roughness={0.6} />
      </mesh>

      {/* ── Launch kicker ── */}
      <LaunchKicker />

      {/* ── Landing ramp (far side of gap) ── */}
      <LandingRamp />

      {/* ── Side walls (red broken brick, double-sided, with graffiti) ── */}
      {[-1, 1].map(side => (
        <group key={side} position={[side * (RAMP_WIDTH / 2 + 0.2), RAMP_HEIGHT / 2, 0]}>
          {/* Main wall body */}
          <mesh>
            <boxGeometry args={[0.4, RAMP_HEIGHT + 1, RAMP_LENGTH + 2]} />
            <meshStandardMaterial
              color="#8B3A3A"
              roughness={0.95}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* Brick detail bumps (procedural broken brick look) */}
          {Array.from({ length: 60 }, (_, i) => {
            const seed = i * 7919 + side * 3571;
            const bx = ((seed * 13) % 100) / 100 * 0.3 - 0.15;
            const by = ((seed * 17) % 100) / 100 * (RAMP_HEIGHT + 0.5) - (RAMP_HEIGHT + 0.5) / 2;
            const bz = ((seed * 23) % 100) / 100 * (RAMP_LENGTH + 1) - (RAMP_LENGTH + 1) / 2;
            const brickW = 0.18 + ((seed * 31) % 100) / 100 * 0.08;
            const brickH = 0.06 + ((seed * 37) % 100) / 100 * 0.04;
            const colors = ['#6B2A2A', '#7A3232', '#8B3A3A', '#5A2020', '#9B4A4A'];
            const col = colors[i % colors.length];
            const missing = (seed * 41) % 100 < 15; // 15% gaps for broken look
            if (missing) return null;
            return (
              <mesh key={i} position={[bx + side * 0.02, by, bz]}>
                <boxGeometry args={[0.05, brickH, brickW]} />
                <meshStandardMaterial color={col} roughness={0.95} />
              </mesh>
            );
          })}
          {/* Graffiti on inner face */}
          <group position={[-side * 0.22, 0, 0]} rotation={[0, side > 0 ? Math.PI : 0, 0]}>
            <GraffitiPatches wallHeight={RAMP_HEIGHT} wallLength={RAMP_LENGTH} />
          </group>
        </group>
      ))}

      {/* ── Platform at top with safety railing ── */}
      <mesh position={[0, RAMP_HEIGHT, RAMP_LENGTH / 2 + 2]}>
        <boxGeometry args={[RAMP_WIDTH + 3, 0.5, 4]} />
        <meshStandardMaterial color="#888888" roughness={0.6} />
      </mesh>
      {/* Safety railing — back */}
      <mesh position={[0, RAMP_HEIGHT + 0.7, RAMP_LENGTH / 2 + 3.8]}>
        <boxGeometry args={[RAMP_WIDTH + 3, 1.0, 0.1]} />
        <meshStandardMaterial color="#444444" metalness={0.6} roughness={0.3} />
      </mesh>
      {/* Safety railing — sides */}
      {[-1, 1].map(side => (
        <mesh
          key={`rail-side-${side}`}
          position={[side * (RAMP_WIDTH / 2 + 1.3), RAMP_HEIGHT + 0.7, RAMP_LENGTH / 2 + 2]}
        >
          <boxGeometry args={[0.1, 1.0, 4]} />
          <meshStandardMaterial color="#444444" metalness={0.6} roughness={0.3} />
        </mesh>
      ))}
      {/* Railing posts */}
      {[-1, 0, 1].map(i => (
        <mesh
          key={`top-post-${i}`}
          position={[i * (RAMP_WIDTH / 3), RAMP_HEIGHT + 0.5, RAMP_LENGTH / 2 + 3.8]}
        >
          <cylinderGeometry args={[0.05, 0.05, 1.0, 6]} />
          <meshStandardMaterial color="#555555" metalness={0.5} roughness={0.4} />
        </mesh>
      ))}

      {/* ── Grind rail running down the ramp center ── */}
      {(() => {
        const segCount = 24;
        const railSegs: Array<{ pos: [number, number, number]; rot: number }> = [];
        for (let i = 0; i < segCount; i++) {
          const t0 = (i + 0.5) / segCount;
          const t1 = (i + 1.5) / segCount;
          const z0 = -RAMP_LENGTH / 2 + t0 * RAMP_LENGTH;
          const z1 = -RAMP_LENGTH / 2 + t1 * RAMP_LENGTH;
          const curveT0 = 1 - Math.pow(1 - t0, 1.8);
          const curveT1 = 1 - Math.pow(1 - t1, 1.8);
          const y0 = RAMP_HEIGHT * Math.sin((curveT0 * Math.PI) / 2) + 0.18;
          const y1 = RAMP_HEIGHT * Math.sin((curveT1 * Math.PI) / 2) + 0.18;
          const midZ = (z0 + z1) / 2;
          const midY = (y0 + y1) / 2;
          const angle = Math.atan2(y1 - y0, z1 - z0);
          railSegs.push({ pos: [0, midY, midZ], rot: angle });
        }
        return railSegs.map((seg, i) => (
          <mesh key={`rail-${i}`} position={seg.pos} rotation={[seg.rot, 0, 0]}>
            <cylinderGeometry args={[0.05, 0.05, (RAMP_LENGTH / segCount) * 1.05, 8]} />
            <meshStandardMaterial color="#bbbbbb" metalness={0.85} roughness={0.12} />
          </mesh>
        ));
      })()}

      {/* ── Giant NOGGLES at rail midpoint ── */}
      {(() => {
        const midT = 0.5;
        const curveT = 1 - Math.pow(1 - midT, 1.8);
        const midY = RAMP_HEIGHT * Math.sin((curveT * Math.PI) / 2) + 0.8;
        return <GiantNoggles position={[0, midY, 0]} />;
      })()}

      {/* ── 50+ Stairs on the right side ── */}
      <MegaStairs />

      {/* ── Teleport portal at the launch edge — impossible to miss ── */}
      <TeleportPortal position={[0, PORTAL_RADIUS + 0.2, -RAMP_LENGTH / 2 - 6]} />

      {/* ── Ground shadow ── */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <planeGeometry
          args={[RAMP_WIDTH + 6, RAMP_LENGTH + KICKER_LENGTH + GAP_LENGTH + LANDING_LENGTH + 8]}
        />
        <meshBasicMaterial color="#000000" transparent opacity={0.12} />
      </mesh>

      {/* ── Lighting ── */}
      <pointLight position={[0, RAMP_HEIGHT + 3, 0]} color="#ffffff" intensity={3} distance={30} />
      <pointLight
        position={[0, 2, -RAMP_LENGTH / 2]}
        color="#88ccff"
        intensity={1.5}
        distance={12}
      />
      <pointLight
        position={[0, RAMP_HEIGHT + 1, RAMP_LENGTH / 2 + 2]}
        color="#ffcc88"
        intensity={1}
        distance={8}
      />
    </group>
  );
}
